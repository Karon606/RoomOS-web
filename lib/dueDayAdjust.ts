// 납입일 변경 조정 행 판정·메모 정본. 메모 앞머리 '[납입일변경]' 이 기계 키다(화면·서버·감사가 같은 함수를 쓴다)
//
// 조정 행은 납입일 영구 변경(tenants/actions changeDueDay)이 만드는 PaymentRecord 다. 들어온 돈이 아니라
// 그 달 받을 돈을 고치는 장부 줄이라 금액 부호가 뜻을 가진다.
//   음수 = 추가로 받을 금액(추가납부). 그 달 수납 합에서 빠져 미납으로 잡힌다.
//   양수 = 돌려줄 금액(과입금). 그 달 수납 합에 더해진다.
// 음수가 정당한 수납 행은 이 조정 행뿐이다. 일반 수납 행은 0원 이상이다(updatePayment 가 거부한다).
//
// 메모의 앞부분('[납입일변경] 9일→20 변경')은 기계가 읽는다. 변경 전 납부일을 복원해 인수월 판정에 쓰고
// (rooms/actions·dashboard 의 dueDayBeforeChange), 조정 행인지 가른다(isDueDayAdjust). 그래서 운영자는
// 이 앞부분을 못 고친다. 뒤 설명(note)만 고친다(신고 df82ce57, 운영자 승인 2026-10-20 A안).
//
// 메모 모양(빌더가 만드는 그대로, 협의 금액이 없으면 2026-10-20 이전 메모와 글자까지 같다).
//   [납입일변경] {전}일→{후} 변경, 일할 {규칙값}원[, 협의 {협의값}원] ({추가납부|과입금})[ {설명}]
import type { Prisma } from '@prisma/client'
import type { DueDayDb } from './dueDay'
import { fmtWon } from './fmtMoney'
import { withParticle } from './koParticle'

export const DUE_DAY_ADJUST_PREFIX = '[납입일변경]'

/** 조정 행인가. 메모 앞머리가 기계 키다. */
export function isDueDayAdjust(memo: string | null | undefined): boolean {
  return !!memo && memo.startsWith(DUE_DAY_ADJUST_PREFIX)
}

/** 조정 행만 고르는 Prisma 조각. */
export function dueDayAdjustWhere(): Prisma.PaymentRecordWhereInput {
  return { memo: { startsWith: DUE_DAY_ADJUST_PREFIX } }
}

/**
 * 조정 행을 빼는 Prisma 조각. `NOT: { memo: ... }` 만 쓰면 메모가 null 인 행까지 빠진다
 * (SQL 의 NOT 이 null 을 거짓으로 친다. 2026-10-20 실측 367행 중 null 45행이 함께 빠짐).
 * 그래서 null 을 따로 살린다. 다른 OR 와 부딪히지 않게 AND 로 감싸 넣는다.
 */
export function notDueDayAdjustWhere(): Prisma.PaymentRecordWhereInput {
  return { AND: [{ OR: [{ memo: null }, { NOT: { memo: { startsWith: DUE_DAY_ADJUST_PREFIX } } }] }] }
}

/** 청구 엔진(lib/billing firstMonthRuleDueDay)이 읽는 조정 행 조각. */
export type BillingDueDayAdjust = { targetMonth: string; memo: string | null; seqNo: number }

/**
 * 청구 엔진에 넘길 조정 행을 계약별로 읽는다. 엔진을 부르는 모든 자리가 이 정본으로 채운다
 * (BillingLeaseFields.dueDayAdjusts 가 필수라 안 거친 자리는 tsc 가 잡는다).
 * 쿼리는 한 번이다(영업장 범위 또는 leaseTermId IN, 메모 앞머리, 살아 있는 행). 영업장 범위는 계약 조회와 나란히(Promise.all)
 * 돌릴 수 있어 화면 응답 시간을 늘리지 않는다. 소프트삭제 익스텐션이 없는 클라이언트(스크립트)에서도 같게 deletedAt 을 직접 건다.
 */
export async function loadDueDayAdjustMap(
  db: Pick<DueDayDb, 'paymentRecord'>,
  scope: { propertyId: string } | { leaseTermIds: readonly string[] },
): Promise<Map<string, BillingDueDayAdjust[]>> {
  const out = new Map<string, BillingDueDayAdjust[]>()
  const ids = 'leaseTermIds' in scope ? [...new Set(scope.leaseTermIds)] : null
  if (ids && ids.length === 0) return out
  const rows = await db.paymentRecord.findMany({
    where: { ...(ids ? { leaseTermId: { in: ids } } : { propertyId: (scope as { propertyId: string }).propertyId }), deletedAt: null, ...dueDayAdjustWhere() },
    select: { leaseTermId: true, targetMonth: true, memo: true, seqNo: true },
  })
  for (const r of rows) out.set(r.leaseTermId, [...(out.get(r.leaseTermId) ?? []), ...dueDayAdjustsFrom([r])])
  return out
}

/** 읽어 둔 지도로 계약마다 조정 행을 붙인다(쿼리 없음). 지도에 없는 계약은 빈 배열이다. */
export function withDueDayAdjusts<T extends { id: string }>(
  leases: readonly T[],
  map: ReadonlyMap<string, readonly BillingDueDayAdjust[]>,
): (T & { dueDayAdjusts: BillingDueDayAdjust[] })[] {
  return leases.map(l => ({ ...l, dueDayAdjusts: [...(map.get(l.id) ?? [])] }))
}

/** 계약 묶음에 조정 행을 붙인다(leaseTermId IN 한 번). */
export async function attachDueDayAdjusts<T extends { id: string }>(
  db: Pick<DueDayDb, 'paymentRecord'>,
  leases: readonly T[],
): Promise<(T & { dueDayAdjusts: BillingDueDayAdjust[] })[]> {
  if (leases.length === 0) return []
  return withDueDayAdjusts(leases, await loadDueDayAdjustMap(db, { leaseTermIds: leases.map(l => l.id) }))
}

/**
 * 이미 읽어 둔 그 계약의 수납 행에서 조정 행 조각만 고른다(쿼리 없이). 그 행들이 그 계약의 살아 있는 조정 행을
 * 빠짐없이 담고 있을 때만 쓴다(수납 관리 getRoomPaymentStatus 의 조회는 조정 행을 달과 무관하게 늘 싣는다).
 * attachDueDayAdjusts 도 이 함수로 고른다. 두 길의 판정이 갈리지 않는다.
 */
export function dueDayAdjustsFrom(
  records: readonly { targetMonth: string; memo: string | null; seqNo: number; deletedAt?: Date | null }[],
): BillingDueDayAdjust[] {
  return records
    .filter(r => !r.deletedAt && isDueDayAdjust(r.memo))
    .map(r => ({ targetMonth: r.targetMonth, memo: r.memo, seqNo: r.seqNo }))
}

/** 계약 하나(findUnique·findFirst 결과)용. null 은 그대로 null. */
export async function attachDueDayAdjustsOne<T extends { id: string }>(
  db: Pick<DueDayDb, 'paymentRecord'>,
  lease: T | null,
): Promise<(T & { dueDayAdjusts: BillingDueDayAdjust[] }) | null> {
  if (!lease) return null
  const [out] = await attachDueDayAdjusts(db, [lease])
  return out
}

/**
 * 조정 메모에서 변경 전 납부일을 숫자로(말일은 31). 못 읽으면 null.
 * 종전 네 자리(rooms/actions 두 곳·dashboard 두 곳)의 정규식 사본을 모은 것이고 식은 그대로다.
 * '말일' 이 전 값이면 메모가 '말일일→' 이 되어 이 식이 못 읽는다(종전과 같다, null).
 */
export function dueDayBeforeChange(memo: string | null | undefined): number | null {
  if (!memo || !isDueDayAdjust(memo)) return null
  const m = memo.match(/\[납입일변경\]\s*([^일→]+?)일?\s*→/)
  if (!m) return null
  const t = m[1].trim()
  const parsed = t.includes('말') ? 31 : Number(t)
  if (isNaN(parsed) || parsed <= 0) return null
  return parsed
}

export type DueDayAdjustKind = 'extra' | 'refund'
const KIND_LABEL: Record<DueDayAdjustKind, string> = { extra: '추가납부', refund: '과입금' }

/** 화면 어휘. 방향 세그먼트와 행 제목이 같은 말을 쓴다. */
export const DUE_DAY_ADJUST_KIND_TEXT: Record<DueDayAdjustKind, string> = { extra: '추가로 받을 금액', refund: '돌려줄 금액' }

export type DueDayAdjustMemo = {
  from: string
  to: string
  ruleAmount: number
  agreedAmount: number | null
  kind: DueDayAdjustKind
  note: string
}

const MEMO_RE = /^\[납입일변경\] (.+?)일→(.+?) 변경, 일할 ([\d,]+)원(?:, 협의 ([\d,]+)원)? \((추가납부|과입금)\)(?: ([\s\S]*))?$/
const num = (s: string) => Number(s.replace(/,/g, ''))
// 메모 금액은 서버 기본 로캘(en-US)의 천 단위 쉼표로 적혀 왔다. 같은 글자를 내도록 로캘을 못박는다.
const won = (n: number) => n.toLocaleString('en-US')

/** 빌더가 만든 모양이면 칸으로 나눈다. 아니면 null(손으로 고친 옛 메모 등). */
export function parseDueDayAdjustMemo(memo: string | null | undefined): DueDayAdjustMemo | null {
  if (!memo) return null
  const m = memo.match(MEMO_RE)
  if (!m) return null
  return {
    from: m[1], to: m[2], ruleAmount: num(m[3]), agreedAmount: m[4] ? num(m[4]) : null,
    kind: m[5] === '과입금' ? 'refund' : 'extra', note: (m[6] ?? '').trim(),
  }
}

/** 메모를 만든다. 협의값이 규칙값과 같거나 없으면 협의 조각을 안 적는다. */
export function buildDueDayAdjustMemo(m: DueDayAdjustMemo): string {
  const agreed = m.agreedAmount != null && m.agreedAmount !== m.ruleAmount ? `, 협의 ${won(m.agreedAmount)}원` : ''
  const note = m.note.trim()
  return `${DUE_DAY_ADJUST_PREFIX} ${m.from}일→${m.to} 변경, 일할 ${won(m.ruleAmount)}원${agreed} (${KIND_LABEL[m.kind]})${note ? ` ${note}` : ''}`
}

/** 화면에 보이는 앞부분(기계 키 빼고). 운영자가 못 고치는 자리라 설명과 따로 보인다. */
export function dueDayAdjustLabel(memo: string | null | undefined): string {
  if (!memo) return ''
  return memo.startsWith(`${DUE_DAY_ADJUST_PREFIX} `) ? memo.slice(DUE_DAY_ADJUST_PREFIX.length + 1) : memo.replace(DUE_DAY_ADJUST_PREFIX, '').trim()
}

/**
 * 행 아래 표시용. 기계 키와 방향 조각('(추가납부)'·'(과입금)')을 뗀다. 방향은 행 제목이 화면 어휘('추가로 받을 금액'·'돌려줄 금액')로
 * 이미 말하므로 저장 메모의 옛 어휘를 같은 자리에 또 세우지 않는다. 저장 형식·파서는 기계 키라 그대로다(표시만).
 */
export function dueDayAdjustDisplayLabel(memo: string | null | undefined): string {
  return dueDayAdjustLabel(memo).replace(/ \((추가납부|과입금)\)/, '')
}

/**
 * 행 아래 표시 메모(2026-10-21 운영자 요청 '통일감'). 저장 글자 '9일→20 변경, 일할 128,333원, 협의 130,000원' 을
 * §29 값 전환 표기('9일 → 20일', 띄어 쓰고 단위)로 보인다. 말일은 '말일'. 저장 메모는 그대로다(표시만).
 * 빌더 모양이 아닌 옛 메모는 종전 표시(dueDayAdjustDisplayLabel)로 둔다.
 */
export function dueDayAdjustDisplayMemo(memo: string | null | undefined): string {
  const p = parseDueDayAdjustMemo(memo)
  if (!p) return dueDayAdjustDisplayLabel(memo)
  const day = (s: string) => (s.includes('말') ? '말일' : `${s}일`)
  const agreed = p.agreedAmount != null && p.agreedAmount !== p.ruleAmount ? `, 협의 ${fmtWon(p.agreedAmount)}` : ''
  // 바꾸기 전 납부일을 몰라 '?' 로 저장된 행은 앞 조각을 빼고 '20일로 변경' 으로 보인다('?일 → 20일' 은 읽을 수 없는 글자다).
  const change = p.from.trim() === '?' ? `${withParticle(day(p.to), '으로/로')} 변경` : `${day(p.from)} → ${day(p.to)} 변경`
  return `${change}, 일할 ${fmtWon(p.ruleAmount)}${agreed}${p.note ? ` ${p.note}` : ''}`
}

// ── 받았는지 상태(표시 전용, 2026-10-21) ──────────────────────────────
// 조정 행은 들어온 돈이 아니라 그 달 받을 돈을 고치는 줄이라 행 자체의 isPaid 는 뜻이 없다(513호 실측 isPaid=false 인데
// 그 달은 완납). 그래서 그 달 완납 정본식(그 달 수납 합(조정 행 포함) ≥ 그 달 청구)과 같은 근거로 남은 조정분을 잰다.
//   남은 조정분 = min(max(0, 청구 − 그 달 전체 합), 그 달 추가로 받을 금액 합)
// 한 달에 조정 행이 여럿이면 같은 달 값이다. 돌려줄 금액 방향은 상태가 없다(칩 없음). 돈 계산은 바꾸지 않는다.

export type DueDayAdjustStatus =
  | { kind: 'paid' }                        // 남은 조정분 0
  | { kind: 'before' }                      // 다 남음, 기한 안 옴(미래 달 포함)
  | { kind: 'unpaid' }                      // 다 남음, 기한 옴(납부일 당일부터, 호실 목록 미납 묶음과 같다)
  | { kind: 'short'; remaining: number }    // 일부 남음

/**
 * 그 달 상태. extraTotal 이 0 이면(추가로 받을 금액이 없는 달) null.
 * bill·duePassed 는 호실 목록과 같은 판정(lib/roomMonth roomMonthBill)에서 온다. 그래서 목록이 그 달을 완납
 * (청구 없는 달이거나 받은 돈 ≥ 청구)으로 보면 칩도 수납 완료다. 기한은 납부일 당일부터 옴이다(목록 미납 묶음과 같다).
 */
export function dueDayAdjustMonthStatus(input: {
  bill: number
  monthTotal: number
  extraTotal: number
  duePassed: boolean
}): DueDayAdjustStatus | null {
  if (input.extraTotal <= 0) return null
  const remaining = Math.min(Math.max(0, input.bill - input.monthTotal), input.extraTotal)
  if (remaining <= 0) return { kind: 'paid' }
  if (remaining < input.extraTotal) return { kind: 'short', remaining }
  return input.duePassed ? { kind: 'unpaid' } : { kind: 'before' }
}

/**
 * 달마다 그 달 수납 합(조정 행 포함)과 추가로 받을 금액 합. 조정 행이 있는 달만 낸다.
 * 양도인 행과 인수 전 입금은 귀속월 선택지(rooms/actions getTargetMonthOptions)와 같은 방식으로 뺀다. 보증금은 넘기지 않는다.
 */
export function dueDayAdjustMonthSums(
  rows: readonly { targetMonth: string; actualAmount: number; memo: string | null; isPrevOwner: boolean; payDate: Date; deletedAt?: Date | null }[],
  cutoff: Date | null,
): Map<string, { total: number; extra: number }> {
  const out = new Map<string, { total: number; extra: number }>()
  const months = new Set(rows.filter(r => !r.deletedAt && isDueDayAdjust(r.memo)).map(r => r.targetMonth))
  for (const r of rows) {
    if (r.deletedAt || !months.has(r.targetMonth) || r.isPrevOwner) continue
    if (cutoff && new Date(r.payDate) < cutoff) continue
    const s = out.get(r.targetMonth) ?? { total: 0, extra: 0 }
    s.total += r.actualAmount
    if (isDueDayAdjust(r.memo) && r.actualAmount < 0) s.extra += -r.actualAmount
    out.set(r.targetMonth, s)
  }
  return out
}

/** 상태 칩 글자와 톤. 형제 보증금 패널(DepositStatusPanel)의 수납 상태 어휘와 같다. */
export function dueDayAdjustStatusChip(s: DueDayAdjustStatus): { label: string; tone: 'success' | 'month' | 'warning' } {
  switch (s.kind) {
    case 'paid': return { label: '수납 완료', tone: 'success' }
    // '수납 전' 은 형제 월분 칩 톤(month)이다. neutral 틴트는 행 바탕 --canvas 위 3.56:1 이라 형제에 없는 조합이었다(독립 검수 2026-10-21).
    case 'before': return { label: '수납 전', tone: 'month' }
    case 'unpaid': return { label: '미수납', tone: 'warning' }
    case 'short': return { label: `부족 ${fmtWon(s.remaining)}`, tone: 'warning' }
  }
}

/** 부호로 방향을 읽는다. 0 은 방향이 없다. */
export function dueDayAdjustKindOf(actualAmount: number): DueDayAdjustKind | null {
  return actualAmount < 0 ? 'extra' : actualAmount > 0 ? 'refund' : null
}

export const DUE_DAY_ADJUST_NOTE_MAX = 100

// ── 거절 문구(서버·화면·진리표가 같은 글자를 쓴다) ─────────────────────
export const DUE_DAY_ADJUST_NOT_ADJUST = '납입일 변경 조정 기록이 아닙니다.'
export const DUE_DAY_ADJUST_UNREADABLE = '이 조정 기록의 메모 모양을 읽을 수 없어 고칠 수 없습니다. 삭제한 뒤 납입일 변경을 다시 해 주세요.'
export const DUE_DAY_ADJUST_AMOUNT_INVALID = '조정 금액은 1원 이상의 정수로 적어 주세요.'
export const DUE_DAY_ADJUST_NOTE_INVALID = `설명은 ${DUE_DAY_ADJUST_NOTE_MAX}자 이내로, [납입일변경] 없이 적어 주세요.`
export const DUE_DAY_ADJUST_EDIT_ELSEWHERE = '납입일 변경 조정 기록입니다. 수납 내역 아래 납입일 변경 조정에서 방향과 금액을 고쳐 주세요.'
export const DUE_DAY_ADJUST_CR_REFUSED = '납입일 변경 조정은 들어온 돈이 아니라 현금영수증 대상이 아닙니다.'
export const PAYMENT_PREFIX_RESERVED = '메모 앞머리 [납입일변경] 은 납입일 변경 기록에만 씁니다. 다른 말로 적어 주세요.'
export const PAYMENT_NEGATIVE_REFUSED = '수납 금액은 0원보다 작을 수 없습니다. 추가로 받을 금액은 납입일 변경 조정에서만 기록합니다.'
export const dueDayAdjustOverCap = (cap: number) => `조정 금액은 ${won(cap)}원을 넘을 수 없습니다. 금액을 다시 확인해 주세요.`

/** 상한. 한 달 이용료(또는 규칙값이 더 크면 규칙값). 자릿수 실수(1,300,000)를 막는 그물이다. */
export function dueDayAdjustCap(rentAmount: number, ruleAmount: number): number {
  return Math.max(rentAmount, ruleAmount)
}

function cleanNote(note: string): string | null {
  const t = note.replace(/\s+/g, ' ').trim()
  if (t.length > DUE_DAY_ADJUST_NOTE_MAX || t.includes(DUE_DAY_ADJUST_PREFIX)) return null
  return t
}

/**
 * 조정 행 수정 판정 정본(서버 updateDueDayAdjust 와 진리표가 부른다).
 * 방향과 양수 금액을 받아 부호 붙은 금액과 새 메모를 낸다. 메모 앞부분(기계 키·규칙값)은 지금 메모에서 가져온다.
 */
export function planDueDayAdjustEdit(
  current: { memo: string | null; isDeposit?: boolean; isBillingAdjust?: boolean },
  input: { direction: DueDayAdjustKind; amount: number; note: string },
  rentAmount: number,
): { ok: true; actualAmount: number; memo: string } | { ok: false; error: string } {
  if (current.isDeposit || current.isBillingAdjust || !isDueDayAdjust(current.memo)) return { ok: false, error: DUE_DAY_ADJUST_NOT_ADJUST }
  const parsed = parseDueDayAdjustMemo(current.memo)
  if (!parsed) return { ok: false, error: DUE_DAY_ADJUST_UNREADABLE }
  if (input.direction !== 'extra' && input.direction !== 'refund') return { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID }
  if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID }
  const cap = dueDayAdjustCap(rentAmount, parsed.ruleAmount)
  if (input.amount > cap) return { ok: false, error: dueDayAdjustOverCap(cap) }
  const note = cleanNote(typeof input.note === 'string' ? input.note : '')
  if (note === null) return { ok: false, error: DUE_DAY_ADJUST_NOTE_INVALID }
  const memo = buildDueDayAdjustMemo({ ...parsed, agreedAmount: input.amount, kind: input.direction, note })
  return { ok: true, actualAmount: input.direction === 'extra' ? -input.amount : input.amount, memo }
}

/**
 * 납입일 변경이 만들 조정 행(changeDueDay 정본). adjustAmount 는 규칙(일할)이 정한 부호 붙은 값,
 * agreedAmount 는 운영자가 적은 협의 금액(양수, 선택). 방향은 규칙이 정한 대로 둔다(협의 금액은 크기만 바꾼다).
 */
export function planDueDayAdjustCreate(input: {
  fromDue: string | null; toDue: string; adjustAmount: number; agreedAmount?: number | null; rentAmount: number
}): { ok: true; actualAmount: number; memo: string; isPaid: boolean } | { ok: false; error: string } {
  const kind: DueDayAdjustKind = input.adjustAmount > 0 ? 'refund' : 'extra'
  const rule = Math.abs(input.adjustAmount)
  const agreed = input.agreedAmount ?? null
  if (agreed != null) {
    if (!Number.isInteger(agreed) || agreed <= 0) return { ok: false, error: DUE_DAY_ADJUST_AMOUNT_INVALID }
    const cap = dueDayAdjustCap(input.rentAmount, rule)
    if (agreed > cap) return { ok: false, error: dueDayAdjustOverCap(cap) }
  }
  const amount = agreed ?? rule
  const memo = buildDueDayAdjustMemo({ from: input.fromDue ?? '?', to: input.toDue, ruleAmount: rule, agreedAmount: agreed, kind, note: '' })
  return { ok: true, actualAmount: kind === 'extra' ? -amount : amount, memo, isPaid: kind === 'refund' }
}

/**
 * 수납 생성·수정 문이 받는 메모 검사. 기계 키 '[납입일변경]' 은 납입일 변경만 쓴다. 일반 수납 메모에 들어가면 그 행이 조정 행으로
 * 읽혀 실입금·현금영수증에서 빠지고 감사가 방향을 판정한다(독립 검수 2026-10-20). 앞머리만이 아니라 어디에 있든 막는다.
 */
export function paymentMemoGuard(memo: string | null | undefined): string | null {
  return memo && memo.includes(DUE_DAY_ADJUST_PREFIX) ? PAYMENT_PREFIX_RESERVED : null
}

/**
 * 일반 수납 수정 문(updatePayment)의 거절 판정. 조정 행은 전용 문으로 보내고, 일반 행에 음수·기계 키를 못 넣게 한다.
 * 조정 행을 여기서 통째로 막는 이유. 부호만 막으면 메모 앞머리를 지우는 길(기계 키 삭제)이 남는다.
 */
export function paymentEditGuard(input: { currentMemo: string | null; nextMemo: string | null | undefined; nextAmount: number }): string | null {
  if (isDueDayAdjust(input.currentMemo)) return DUE_DAY_ADJUST_EDIT_ELSEWHERE
  const memoErr = paymentMemoGuard(input.nextMemo)
  if (memoErr) return memoErr
  if (input.nextAmount < 0) return PAYMENT_NEGATIVE_REFUSED
  return null
}

/**
 * 감사 축. 조정 행 메모가 말하는 방향과 금액 부호가 맞는가(신고 df82ce57 의 513호 +130,000 '(추가납부)' 를 잡는다).
 * 맞으면 null. 방향 글자가 없으면 판정하지 않는다(null).
 */
export function dueDayAdjustSignMismatch(r: { memo: string | null; actualAmount: number }): string | null {
  if (!isDueDayAdjust(r.memo)) return null
  const label = r.memo!.match(/\((추가납부|과입금)\)/)?.[1]
  if (!label) return null
  if (label === '추가납부' && r.actualAmount >= 0) return `메모는 추가납부인데 금액이 ${r.actualAmount === 0 ? '0원' : `+${won(r.actualAmount)}원`}입니다`
  if (label === '과입금' && r.actualAmount <= 0) return `메모는 과입금인데 금액이 ${r.actualAmount === 0 ? '0원' : `−${won(-r.actualAmount)}원`}입니다`
  return null
}
