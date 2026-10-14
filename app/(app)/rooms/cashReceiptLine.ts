// 현금영수증 발행 줄·도장을 읽고 쓰는 내부 엔진. 서버 액션이 아니다('use server' 없음).
//
// 왜 별도 모듈인가. 발행 줄을 건드리는 쓰기가 rooms/actions.ts 와 tenants/actions.ts 두 파일에 걸쳐
// 있다(수납 삭제·수정·토글·일괄 기록, 그리고 예약 선납 취소·이용료 환불 적용취소). 'use server'
// 파일에서 export 하면 그 자체가 권한 검사 없는 엔드포인트가 되므로(paymentEngine.ts 머리말과 같은
// 이유) 여기 둔다. 권한·영업장 확인은 이 함수를 부르는 액션이 requireEdit + propertyId 로 먼저 한다.
// 그래도 모든 조회·쓰기에 propertyId 를 다시 건다. 화면을 거쳐 돌아온 적용취소 스냅샷이 다른
// 영업장의 줄이나 record 를 가리켜도 아무것도 못 바꾸게 하려는 것이다.
//
// 판정(줄이 어떻게 되나)은 전부 lib/cashReceipt 의 순수 함수가 한다. 여기는 읽고 쓰기만 한다.
//
// 소프트삭제 조건은 **손으로 건다.** 이 함수들은 인터랙티브 트랜잭션 안에서도 불리는데, 그때도
// 익스텐션의 자동 필터에 기대지 않고 where 에 deletedAt 을 직접 적는다(CashReceipt 는 원래 익스텐션
// 대상이 아니라 늘 손으로 거른다).
import { createHmac, timingSafeEqual } from 'node:crypto'
import prisma from '@/lib/prisma'
import { CLEANING_FEE_CATEGORY } from '@/lib/incomeCategories'
import { ymdToDbDate } from '@/lib/kstDate'
import { derivedServerKey } from '@/lib/pii'
import { isLiveEnv } from '@/lib/env'
import {
  buildCashReceiptUndo, canonicalCashReceiptUndo, cashReceiptKey, cashReceiptLineView, cashReceiptUndoConflict, parseCashReceiptUndo,
  planCashReceiptRemoval, summarizeCashReceiptKey,
  type CashReceiptKeyParts, type CashReceiptLineSnap, type CashReceiptLineState, type CashReceiptLineTarget,
  type CashReceiptLineView, type CashReceiptUndo,
} from '@/lib/cashReceipt'

/** 트랜잭션 클라이언트와 전역 클라이언트가 둘 다 들어온다. 쓰는 표 셋과 키 잠금용 raw 쿼리만 요구한다. */
export type CrDb = Pick<typeof prisma, 'cashReceipt' | 'paymentRecord' | 'extraIncome' | '$executeRaw'>

/** 발행 키. 계약·입금일·수단. 영업장은 서버가 정한 값만 들어온다. */
export type CrKeyRef = { propertyId: string; leaseTermId: string; payDate: Date; payMethod: string | null }

type LineRow = { id: string; amount: number; issuedAt: Date; inclDeposit: boolean; inclCleaning: boolean; inclRent: boolean; deletedAt: Date | null }
type RecRow = { id: string; isDeposit: boolean; actualAmount: number; cashReceiptIssuedAt: Date | null }

export type CrKeyState = {
  ref: CrKeyRef
  /** 그 키의 줄. 살아 있는 줄이 있으면 그것, 없으면 가장 오래된(지워 둔) 줄, 없으면 null. */
  line: LineRow | null
  /** 살아 있고 조정 전표가 아닌 record. 보증금 포함. */
  records: RecRow[]
  parts: CashReceiptKeyParts
}

const LINE_SELECT = { id: true, amount: true, issuedAt: true, inclDeposit: true, inclCleaning: true, inclRent: true, deletedAt: true } as const
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null)
const ymdOf = (d: Date) => d.toISOString().slice(0, 10)   // @db.Date 는 UTC 자정 저장이라 UTC 날짜부가 달력 날짜다

export const crKeyOf = (ref: CrKeyRef) => cashReceiptKey(ref)

/** 같은 키를 두 번 보지 않게 한 번씩만 남긴다(순서 보존). */
export function uniqueCrRefs(refs: CrKeyRef[]): CrKeyRef[] {
  const seen = new Set<string>()
  return refs.filter(r => { const k = crKeyOf(r); if (seen.has(k)) return false; seen.add(k); return true })
}

function preferredLine(rows: LineRow[]): LineRow | null {
  return rows.find(r => !r.deletedAt) ?? rows[0] ?? null
}

export function lineStateOf(row: LineRow | null): CashReceiptLineState | null {
  if (!row) return null
  return {
    amount: row.amount, issuedAt: row.issuedAt, deleted: !!row.deletedAt,
    incl: { deposit: row.inclDeposit, cleaning: row.inclCleaning, rent: row.inclRent },
  }
}

export function lineSnapOf(row: LineRow | null): CashReceiptLineSnap | null {
  if (!row) return null
  return {
    id: row.id, amount: row.amount, issuedAt: row.issuedAt.toISOString(),
    inclDeposit: row.inclDeposit, inclCleaning: row.inclCleaning, inclRent: row.inclRent,
    deleted: !!row.deletedAt,
  }
}

/** 살아 있는 줄이면 화면에 싣는 모양, 아니면 null. */
export function liveLineView(row: LineRow | null): CashReceiptLineView | null {
  return row && !row.deletedAt ? cashReceiptLineView(row) : null
}

/**
 * 키 잠금(검수 W6). 같은 키(계약·입금일·수단)를 만지는 트랜잭션을 줄 세운다. **키를 만지는 트랜잭션의
 * 첫머리에서** 그 트랜잭션이 만질 키를 전부 한 번에 잠근다.
 *
 * 왜. 줄 쓰기는 '읽고 판정하고 쓴다'라 두 조작이 같은 키를 동시에 읽으면 한쪽 쓰기가 다른 쪽 판정을
 * 덮는다(삭제 두 건을 동시에 보내는 보증금 패널 적용취소가 실제 경로였다). 스키마를 안 바꾸고 트랜잭션
 * 단위 권고 잠금(pg_advisory_xact_lock)을 쓴다. 커밋·롤백 때 저절로 풀려 놓칠 해제가 없다.
 * 여러 키는 정렬해 같은 순서로 잠근다(두 트랜잭션이 서로의 키를 기다리는 교착을 피한다).
 * 트랜잭션 밖(전역 클라이언트)에서 부르면 문장 하나 동안만 잡혀 아무것도 막지 못한다. 트랜잭션 안에서만 부른다.
 */
export async function lockCrKeys(db: CrDb, refs: CrKeyRef[]): Promise<void> {
  const keys = [...new Set(refs.map(r => `cash-receipt|${crKeyOf(r)}`))].sort()
  for (const k of keys) await db.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${k}))`
}

/** 키 하나 잠금. lockCrKeys 의 한 키짜리. */
export async function lockCrKey(db: CrDb, ref: CrKeyRef): Promise<void> {
  await lockCrKeys(db, [ref])
}

/** 한 키의 줄·record·몫을 읽는다. 순서대로 부른다. 트랜잭션 한 연결에서 겹쳐 부르지 않는다. */
export async function readCrKey(db: CrDb, ref: CrKeyRef): Promise<CrKeyState> {
  const where = { propertyId: ref.propertyId, leaseTermId: ref.leaseTermId, payMethod: ref.payMethod }
  const lines = await db.cashReceipt.findMany({
    where: { ...where, payDate: ref.payDate }, orderBy: { createdAt: 'asc' }, select: LINE_SELECT,
  })
  const records = await db.paymentRecord.findMany({
    where: { ...where, payDate: ref.payDate, isBillingAdjust: false, deletedAt: null },
    select: { id: true, isDeposit: true, actualAmount: true, cashReceiptIssuedAt: true },
  })
  // 청소비 몫은 ExtraIncome 에 산다(분해 수납). 한쪽만 세면 그 키의 몫이 작게 뜬다.
  const incomes = await db.extraIncome.findMany({
    where: { ...where, date: ref.payDate, category: CLEANING_FEE_CATEGORY, deletedAt: null },
    select: { amount: true },
  })
  const cleaning = incomes.reduce((s, r) => s + r.amount, 0)
  return { ref, line: preferredLine(lines), records, parts: summarizeCashReceiptKey(records, cleaning) }
}

/**
 * 줄을 세우거나(next) 내리고(null), 그 키의 도장을 줄에 맞춘다. **발행 줄을 쓰는 단 하나의 자리다.**
 *
 * 도장 맞추기(stamp).
 *   key      키의 이용료 행 전부가 줄을 따른다. 켜면 줄 발행일, 내리면 null(결함 D7, 도장 단위를
 *            키로). 종전 토글은 생성 시각 2초 안의 형제만, 수정 폼은 한 record 만 바꿔서 같은 줄을
 *            두고 행마다 표시가 갈렸다. 0원·음수 행은 발행할 돈이 아니라 도장을 지우기만 한다.
 *   stamped  지금 도장이 찍힌 행만 새 발행일을 따른다. 금액을 지키는 재저장(redate)과 합치기(merge).
 *            아직 안 덮인 새 돈의 행에 도장을 찍어 '발행됨'이라 말하지 않는다.
 *   none     도장을 안 건드린다.
 * 보증금 행은 줄이 보증금을 들었을 때만 찍힌다(운영자 확정 2026-09-21). 어느 방식이든 같다.
 */
export async function writeCrKey(
  db: CrDb, state: CrKeyState, next: CashReceiptLineTarget | null, tenantId: string,
  stamp: 'key' | 'stamped' | 'none',
): Promise<void> {
  const { ref } = state
  if (next) {
    const data = {
      amount: next.amount, issuedAt: next.issuedAt,
      inclDeposit: next.incl.deposit, inclCleaning: next.incl.cleaning, inclRent: next.incl.rent,
      deletedAt: null,
    }
    if (state.line) {
      await db.cashReceipt.updateMany({ where: { id: state.line.id, propertyId: ref.propertyId }, data })
    } else {
      await db.cashReceipt.create({
        data: { propertyId: ref.propertyId, leaseTermId: ref.leaseTermId, tenantId, payDate: ref.payDate, payMethod: ref.payMethod, ...data },
      })
    }
  } else if (state.line && !state.line.deletedAt) {
    await db.cashReceipt.updateMany({ where: { id: state.line.id, propertyId: ref.propertyId }, data: { deletedAt: new Date() } })
  }
  if (stamp === 'none') return

  const want = new Map<string, Date | null>()
  for (const r of state.records) {
    if (r.isDeposit) {
      want.set(r.id, next && next.incl.deposit ? next.issuedAt : null)
      continue
    }
    if (stamp === 'key') want.set(r.id, next && r.actualAmount > 0 ? next.issuedAt : null)
    else if (r.cashReceiptIssuedAt) want.set(r.id, next ? next.issuedAt : null)
  }
  const byValue = new Map<string, string[]>()
  for (const r of state.records) {
    if (!want.has(r.id)) continue
    const v = want.get(r.id) ?? null
    if (iso(v) === iso(r.cashReceiptIssuedAt)) continue
    const k = iso(v) ?? ''
    byValue.set(k, [...(byValue.get(k) ?? []), r.id])
  }
  for (const [k, ids] of byValue) {
    await db.paymentRecord.updateMany({
      where: { id: { in: ids }, propertyId: ref.propertyId, deletedAt: null },
      data: { cashReceiptIssuedAt: k ? new Date(k) : null },
    })
  }
}

/** 몇몇 record 의 도장만 바꾼다(수정 저장의 unstamp). 지워진 record 는 안 건드린다. */
export async function setStamps(db: CrDb, propertyId: string, ids: string[], value: Date | null): Promise<void> {
  if (ids.length === 0) return
  await db.paymentRecord.updateMany({ where: { id: { in: ids }, propertyId, deletedAt: null }, data: { cashReceiptIssuedAt: value } })
}

// ── 적용취소 스냅샷 ───────────────────────────────────────────────

/** 키 몇 개의 줄과 도장을 한 시점에 떠 둔다. extraIds 는 키 밖이거나 지워진 record 의 도장까지 볼 때. */
export type CrCapture = { refs: CrKeyRef[]; lines: (CashReceiptLineSnap | null)[]; stamps: Map<string, string | null> }

export async function captureCr(db: CrDb, refs: CrKeyRef[], extraIds: string[] = []): Promise<CrCapture> {
  const list = uniqueCrRefs(refs)
  const lines: (CashReceiptLineSnap | null)[] = []
  const stamps = new Map<string, string | null>()
  for (const ref of list) {
    const s = await readCrKey(db, ref)
    lines.push(lineSnapOf(s.line))
    for (const r of s.records) stamps.set(r.id, iso(r.cashReceiptIssuedAt))
  }
  const rest = extraIds.filter(id => !stamps.has(id))
  if (rest.length > 0 && list.length > 0) {
    const rows = await db.paymentRecord.findMany({
      // 지워진 record 도 본다. deletedAt 을 명시하면 익스텐션 자동 필터가 안 붙는다(lib/prisma).
      where: { id: { in: rest }, propertyId: list[0].propertyId, deletedAt: undefined },
      select: { id: true, cashReceiptIssuedAt: true },
    })
    for (const r of rows) stamps.set(r.id, iso(r.cashReceiptIssuedAt))
  }
  return { refs: list, lines, stamps }
}

/**
 * 쓰기 전 캡처와 같은 키·같은 record 로 쓴 직후를 떠서 적용취소 스냅샷을 만들고 서버가 서명한다.
 * 운영에서 서명 키가 없으면 바뀐 것이 있는 토큰은 내지 않는다(null, 독립 검수 R-7). 화면은 그때 적용취소를 숨긴다.
 * 쓰기 전에 줄이 있던 키는 쓴 직후도 **그 같은 줄**을 뜬다. 한 키에 줄이 둘 이상 남은 옛 데이터에서
 * '살아 있는 줄, 없으면 가장 오래된 줄' 선택이 다른 줄을 집어 쓰기 전·쓴 직후 id 가 갈리지 않게(검수 W4).
 */
export async function finishCrUndo(db: CrDb, before: CrCapture): Promise<CashReceiptUndo | null> {
  const after = await captureCr(db, before.refs, [...before.stamps.keys()])
  const lines = []
  for (let i = 0; i < before.refs.length; i++) {
    const ref = before.refs[i]
    let a = after.lines[i]
    const b = before.lines[i]
    if (b && a && a.id !== b.id) {
      const row = await db.cashReceipt.findFirst({ where: { id: b.id, propertyId: ref.propertyId }, select: LINE_SELECT })
      a = lineSnapOf(row)
    }
    lines.push({ leaseTermId: ref.leaseTermId, payYmd: ymdOf(ref.payDate), payMethod: ref.payMethod, before: b, after: a })
  }
  const keys = before.refs.map(ref => ({ leaseTermId: ref.leaseTermId, payYmd: ymdOf(ref.payDate), payMethod: ref.payMethod }))
  const undo = buildCashReceiptUndo(lines, before.stamps, after.stamps, keys)
  return before.refs.length > 0 ? signCrUndo(before.refs[0].propertyId, undo) : undo
}

// ── 적용취소 토큰 서명(검수 W4) ─────────────────────────────────────
//
// 토큰은 화면을 거쳐 돌아오는 값이다. 영업장 경계는 모든 조회·쓰기의 propertyId 가 막지만, 같은 영업장
// 안에서 금액·도장을 지어낸 토큰(9,990,000·2099-01-01, 검수 R8)은 모양 검사만으로 못 막는다. 서버 전용
// 비밀(STAYEUM_PII_KEY 에서 용도 라벨로 파생한 키, lib/pii derivedServerKey)로 서명하고 복원 때 대조한다.
// 영업장 id 를 서명에 넣어 다른 영업장으로 옮긴 토큰도 서명에서 떨어진다.
//
// 키가 있으면 서명 없는 토큰·틀린 서명은 거부한다.
//
// **키가 없을 때는 운영과 그 밖을 가른다**(독립 검수 R-7, 2026-10-14). 종전에는 어느 환경이든 키가 없으면 대조를
// 건너뛰었다(fail-open). 운영에서 키 등록이 빠지면 위조 토큰이 통째로 통과한다. 이제 운영(NODE_ENV 나 VERCEL_ENV 가
// production)에서는 키가 없으면 서명을 거부해 토큰을 내지 않고(화면은 적용취소 버튼을 숨긴다) 들어온 토큰은 거부한다.
// 키 미등록 개발 DB·통합 하네스에서만 건너뛴다. 그때 막을 길은 아래 구조 검사뿐이다.
const CR_UNDO_KEY_LABEL = 'stayeum-cash-receipt-undo-v1'

/**
 * 서명 키 없이 토큰을 내고 받으면 안 되는 환경인가. 운영 빌드(NODE_ENV production)이거나 운영 배포(VERCEL_ENV
 * production, 판정 정본 lib/env isLiveEnv)면 참이다. 환경 변수를 여기서 직접 읽지 않는다(감지망 check-env-isolation).
 */
export function crUndoSigningRequired(): boolean {
  return process.env.NODE_ENV === 'production' || isLiveEnv()
}

/** 토큰 종류(domain)·영업장·정본 문자열 위의 서명. 키가 없으면 null. */
function undoMac(domain: string, propertyId: string, body: string): Buffer | null {
  const key = derivedServerKey(CR_UNDO_KEY_LABEL)
  if (!key) return null
  return createHmac('sha256', key).update(`${domain}\n${propertyId}\n${body}`).digest()
}

function macMatches(mac: Buffer | null, sig: unknown): boolean {
  // 키가 없다. 운영이면 대조할 수 없는 토큰은 거부하고(fail-closed), 개발·하네스에서만 구조 검사에 맡긴다.
  if (!mac) return !crUndoSigningRequired()
  if (typeof sig !== 'string') return false
  const got = Buffer.from(sig, 'base64url')
  return got.length === mac.length && timingSafeEqual(got, mac)
}

/**
 * 토큰에 서버 서명을 붙인다. 키가 없으면 개발·하네스에서는 서명 없이 돌려주고, 운영에서는 바뀐 것이 있는 토큰을
 * 내지 않는다(null). 바뀐 것이 없는 빈 토큰은 복원이 아무것도 안 쓰므로(applyCrUndo 첫머리) 그대로 낸다.
 */
export function signCrUndo(propertyId: string, undo: CashReceiptUndo): CashReceiptUndo | null {
  const mac = undoMac('cash-receipt', propertyId, canonicalCashReceiptUndo(undo))
  if (mac) return { ...undo, sig: mac.toString('base64url') }
  if (crUndoSigningRequired() && (undo.lines.length > 0 || undo.stamps.length > 0)) return null
  return { ...undo }
}

/** 이 영업장에서 서버가 만든 토큰 그대로인가. 키가 없으면 개발·하네스는 true(구조 검사에 맡긴다), 운영은 false. */
export function verifyCrUndo(propertyId: string, undo: CashReceiptUndo): boolean {
  return macMatches(undoMac('cash-receipt', propertyId, canonicalCashReceiptUndo(undo)), undo.sig)
}

/** 적용취소가 막힐 때 화면에 갈 말. 무엇이 바뀌었는지 단정하지 않고 볼 자리를 준다. */
export const CR_UNDO_CONFLICT_MESSAGE = '그 사이 현금영수증 발행 기록이 다시 바뀌어 되돌리지 않았습니다. 수납 내역에서 지금 상태를 확인해 주세요.'
/** 여러 키를 한 번에 쓴 조작(일괄 발행 기록)의 적용취소가 한 키 때문에 막혔을 때의 말. */
export const CR_UNDO_BATCH_CONFLICT_MESSAGE = '그 사이 고른 입금 중 일부의 발행 기록이 다시 바뀌어 일괄 기록 전체를 되돌리지 않았습니다. 수납 내역에서 지금 상태를 확인해 주세요.'
/** 토큰이 모양·서명·범위 검사에서 떨어졌을 때의 말. */
export const CR_UNDO_INVALID_MESSAGE = '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.'

export class CrUndoConflict extends Error {
  constructor(message = CR_UNDO_CONFLICT_MESSAGE) { super(message); this.name = 'CrUndoConflict' }
}

/**
 * 스냅샷의 '쓰기 전'을 복원한다. 지금 상태가 '쓴 직후'와 다르면 아무것도 안 쓰고 CrUndoConflict 를
 * 던진다. 부르는 쪽 트랜잭션이 함께 되감긴다.
 *
 * 스냅샷은 화면을 거쳐 돌아온 값이다. 그래서 (1) 모양을 다시 검사하고 (2) 줄 id 가 그 영업장·그 키의
 * 줄인지 확인하고 (3) 도장은 그 영업장의 record 에만 쓴다. 살아 있는 줄로 되돌릴 발행일이 미래면
 * 거부한다(발행일 정본의 미래 거부와 같은 규칙).
 */
export async function applyCrUndo(db: CrDb, propertyId: string, raw: unknown): Promise<void> {
  const undo = parseCashReceiptUndo(raw)
  const invalid = () => new CrUndoConflict(CR_UNDO_INVALID_MESSAGE)
  if (!undo) throw invalid()
  if (undo.lines.length === 0 && undo.stamps.length === 0) return
  // 서버가 이 영업장에서 만든 토큰인가(검수 W4). 아래 구조 검사는 서명과 상관없이 늘 한다.
  if (!verifyCrUndo(propertyId, undo)) throw invalid()
  const now = Date.now()
  // 되돌릴 도장이 미래면 거부한다. 아직 하지 않은 발행이다(발행일 정본의 미래 거부와 같은 규칙).
  if (undo.stamps.some(st => st.before != null && new Date(st.before).getTime() > now + 60_000)) throw invalid()
  await lockCrKeys(db, undo.keys.map(k => ({ propertyId, leaseTermId: k.leaseTermId, payDate: ymdToDbDate(k.payYmd), payMethod: k.payMethod })))
  // 도장은 토큰이 뜬 키에 걸린 record 에만 되돌린다. 키 밖 record 의 id 를 끼워 넣어도 안 쓴다.
  if (undo.stamps.length > 0) {
    const allowed = new Set(undo.keys.map(k => cashReceiptKey({ leaseTermId: k.leaseTermId, payDate: ymdToDbDate(k.payYmd), payMethod: k.payMethod })))
    const owners = await db.paymentRecord.findMany({
      where: { id: { in: undo.stamps.map(st => st.id) }, propertyId, deletedAt: undefined },
      select: { id: true, leaseTermId: true, payDate: true, payMethod: true },
    })
    const inKey = new Set(owners.filter(r => allowed.has(cashReceiptKey(r))).map(r => r.id))
    if (undo.stamps.some(st => !inKey.has(st.id))) throw invalid()
  }

  const keyRows: LineRow[][] = []
  for (const l of undo.lines) {
    const rows = await db.cashReceipt.findMany({
      where: { propertyId, leaseTermId: l.leaseTermId, payDate: ymdToDbDate(l.payYmd), payMethod: l.payMethod },
      orderBy: { createdAt: 'asc' }, select: LINE_SELECT,
    })
    for (const snap of [l.before, l.after]) {
      if (snap && !rows.some(r => r.id === snap.id)) throw new CrUndoConflict()
    }
    keyRows.push(rows)
  }
  const stampRows = undo.stamps.length > 0
    ? await db.paymentRecord.findMany({
        where: { id: { in: undo.stamps.map(s => s.id) }, propertyId, deletedAt: undefined },
        select: { id: true, cashReceiptIssuedAt: true },
      })
    : []
  const conflict = cashReceiptUndoConflict(undo, {
    lines: keyRows.map(rows => lineSnapOf(preferredLine(rows))),
    stamps: new Map(stampRows.map(r => [r.id, iso(r.cashReceiptIssuedAt)])),
  })
  if (conflict) throw new CrUndoConflict()

  const at = new Date(now)
  for (let i = 0; i < undo.lines.length; i++) {
    const l = undo.lines[i]
    const rows = keyRows[i]
    if (l.before) {
      const b = l.before
      if (!b.deleted && new Date(b.issuedAt).getTime() > now + 60_000) {
        throw new CrUndoConflict('되돌릴 발행일이 미래입니다. 적용취소 정보가 올바르지 않습니다.')
      }
      const cur = rows.find(r => r.id === b.id)
      await db.cashReceipt.updateMany({
        where: { id: b.id, propertyId, leaseTermId: l.leaseTermId },
        data: {
          amount: b.amount, issuedAt: new Date(b.issuedAt),
          inclDeposit: b.inclDeposit, inclCleaning: b.inclCleaning, inclRent: b.inclRent,
          deletedAt: b.deleted ? (cur?.deletedAt ?? at) : null,
        },
      })
    } else if (l.after && !l.after.deleted) {
      // 이 쓰기가 만든 줄이다. 쓰기 전에는 줄이 없었다. 지워 둔다(합계에서 빠진다).
      await db.cashReceipt.updateMany({ where: { id: l.after.id, propertyId, leaseTermId: l.leaseTermId }, data: { deletedAt: at } })
    }
  }
  const byValue = new Map<string, string[]>()
  for (const s of undo.stamps) {
    const k = s.before ?? ''
    byValue.set(k, [...(byValue.get(k) ?? []), s.id])
  }
  for (const [k, ids] of byValue) {
    await db.paymentRecord.updateMany({ where: { id: { in: ids }, propertyId }, data: { cashReceiptIssuedAt: k ? new Date(k) : null } })
  }
}

// ── 되살린 수납의 도장 ───────────────────────────────────────────

/** 되살린 수납 한 건. 도장을 지금 줄에 맞출 재료. */
export type CrRevived = { id: string; leaseTermId: string; payDate: Date; payMethod: string | null; cashReceiptIssuedAt: Date | null }

/**
 * 되살린 수납의 도장을 지금 줄에 맞춘다. 수납 삭제·예약 선납 취소·이용료 환불의 적용취소 공통(검수 W1).
 *
 * 왜. 삭제는 줄을 그대로 두는 경우(keep)가 있어 적용취소 스냅샷에 줄이 없다. 그 사이 운영자가 같은 키의
 * 발행을 끄거나 다시 켜면, 되살린 수납이 지울 때 들고 있던 옛 도장이 줄 없이 남거나(유령 도장, 검수 R6)
 * 지금 줄과 다른 날짜를 말한다. 그래서 되살린 **직후 같은 트랜잭션에서** 맞춘다.
 *
 *   도장이 있던 수납만 본다. 살아 있는 줄이 있으면 그 줄 발행일로, 없으면 null.
 *   도장이 없던 수납은 그대로 둔다. 발행 없이 받은 돈을 '발행됨'이라 말하지 않는다.
 *   줄 금액은 안 덮는다(국세청 금액 보호). 기본 구성 줄이 지금 키의 이용료 몫과 다르면 mismatch 로 돌려준다.
 */
export async function alignRevivedStamps(db: CrDb, propertyId: string, revived: CrRevived[]): Promise<CrMismatch[]> {
  const mismatch: CrMismatch[] = []
  const groups = new Map<string, CrRevived[]>()
  for (const r of revived) groups.set(cashReceiptKey(r), [...(groups.get(cashReceiptKey(r)) ?? []), r])
  for (const group of groups.values()) {
    const ref: CrKeyRef = { propertyId, leaseTermId: group[0].leaseTermId, payDate: group[0].payDate, payMethod: group[0].payMethod }
    const s = await readCrKey(db, ref)
    const live = s.line && !s.line.deletedAt ? s.line : null
    const want = live ? live.issuedAt : null
    const off = group.filter(r => r.cashReceiptIssuedAt && iso(r.cashReceiptIssuedAt) !== iso(want)).map(r => r.id)
    await setStamps(db, propertyId, off, want)
    if (live && !live.inclDeposit && !live.inclCleaning && live.amount !== s.parts.rent) {
      mismatch.push({ payYmd: ymdOf(ref.payDate), payMethod: ref.payMethod, lineAmount: live.amount, basis: s.parts.rent })
    }
  }
  return mismatch
}

// ── record 가 빠진 뒤의 줄 ─────────────────────────────────────────

export type CrDroppedLine = CashReceiptLineView & { payYmd: string; payMethod: string | null }
/** 남은 몫과 발행 금액이 갈린 키. 금액은 자동으로 안 덮었다(국세청 금액 보호). */
export type CrMismatch = { payYmd: string; payMethod: string | null; lineAmount: number; basis: number }
export type CrRemovalResult = { dropped: CrDroppedLine[]; mismatch: CrMismatch[] }

/**
 * record 를 지운 **뒤에** 부른다. 덮을 돈이 안 남은 키의 줄은 내리고, 남았으면 금액은 그대로 두되
 * 남은 몫과 다르면 그 사실을 돌려준다(lib/cashReceipt planCashReceiptRemoval).
 */
export async function reconcileCrAfterRemoval(db: CrDb, refs: CrKeyRef[]): Promise<CrRemovalResult> {
  const out: CrRemovalResult = { dropped: [], mismatch: [] }
  for (const ref of uniqueCrRefs(refs)) {
    const s = await readCrKey(db, ref)
    const plan = planCashReceiptRemoval(lineStateOf(s.line), s.parts)
    if (plan.kind === 'drop') {
      const view = cashReceiptLineView(s.line!)
      await writeCrKey(db, s, null, '', 'key')
      out.dropped.push({ ...view, payYmd: ymdOf(ref.payDate), payMethod: ref.payMethod })
    } else if (plan.kind === 'keep' && plan.amount !== plan.basis) {
      out.mismatch.push({ payYmd: ymdOf(ref.payDate), payMethod: ref.payMethod, lineAmount: plan.amount, basis: plan.basis })
    }
  }
  return out
}

// ── 수납 삭제·수정의 적용취소 스냅샷 ────────────────────────────────

/** 수납 삭제의 적용취소 재료. restorePayment 가 받는다. */
export type PaymentDeleteUndo = { paymentId: string; cr: CashReceiptUndo }

/** 수납 수정 전·후의 돈 칸. 도장은 cr 스냅샷이 맡는다(같은 값이 두 자리에 서면 갈린다). */
export type PaymentEditFields = {
  actualAmount: number; payYmd: string; payMethod: string | null; memo: string | null
  targetMonth: string; seqNo: number
}

/**
 * 수납 수정 저장의 적용취소 재료. undoPaymentEdit 이 받는다(운영자 원칙: 모든 쓰기에 적용취소).
 * sig 는 수정 전·후 칸과 발행 줄 토큰을 함께 묶은 서버 서명이다(검수 W4, 되돌릴 칸을 지어내지 못하게).
 */
export type PaymentEditUndo = { paymentId: string; before: PaymentEditFields; after: PaymentEditFields; cr: CashReceiptUndo; sig?: string }

function paymentEditBody(u: PaymentEditUndo): string {
  const f = (x: PaymentEditFields) => [x.actualAmount, x.payYmd, x.payMethod, x.memo, x.targetMonth, x.seqNo]
  return JSON.stringify([u.paymentId, f(u.before), f(u.after), canonicalCashReceiptUndo(u.cr), u.cr.sig ?? null])
}

/** 수정 저장 토큰에 서버 서명을 붙인다. 키가 없으면 개발·하네스는 서명 없이, 운영은 토큰을 내지 않는다(null, 검수 R-7). */
export function signPaymentEditUndo(propertyId: string, u: PaymentEditUndo): PaymentEditUndo | null {
  const mac = undoMac('payment-edit', propertyId, paymentEditBody(u))
  if (mac) return { ...u, sig: mac.toString('base64url') }
  return crUndoSigningRequired() ? null : { ...u }
}

/** 이 영업장에서 서버가 만든 수정 저장 토큰 그대로인가. 모양 검사를 지난 값에만 부른다. */
export function verifyPaymentEditUndo(propertyId: string, u: PaymentEditUndo): boolean {
  if (!parseCashReceiptUndo(u.cr)) return false
  return macMatches(undoMac('payment-edit', propertyId, paymentEditBody(u)), u.sig)
}

/** 수납 수정이 발행 줄에 한 일. 화면이 토스트·확인으로 말할 재료(2단계). */
export type PaymentEditEffect = {
  /** 끝난 뒤 이 record 키의 살아 있는 줄. */
  line: CashReceiptLineView | null
  /** 입금일·수단을 옮기며 옛 키에 덮을 돈이 안 남아 내린 줄. */
  dropped?: CrDroppedLine
  /** 옛 줄이 이 record 와 함께 새 키로 옮겨 갔다(금액·구성 유지). */
  transferred?: CashReceiptLineView
  /** 새 키의 살아 있는 줄에 옛 줄 금액을 합쳤다(한 장 규칙). */
  merged?: { prevAmount: number; amount: number }
  /** 발행을 새로 켜서 세운 줄. 직전에 줄이 있었으면 그 금액·발행일. */
  issued?: { replaced?: { amount: number; issuedYmd: string; was: 'deleted' | 'live' } }
  /**
   * 살아 있는 줄에 이 키의 새 돈(도장 없던 이용료 행)을 더했다(F4). 앞 발행일을 지켰다.
   * requestedYmd 는 폼이 고른 날짜라 issuedYmd 와 다르면 화면이 '앞 발행일 유지'를 말한다.
   */
  added?: { prevAmount: number; added: number; amount: number; issuedYmd: string; requestedYmd: string }
  /** 켰지만 이 키의 이용료는 이미 다 덮여 있어 아무것도 안 바꿨다(이 수납에는 발행할 이용료 몫이 없다). */
  kept?: true
  /** 이용료 몫이 없어 켜지 못했다. */
  notIssued?: string
  /** 옛 줄이 다른 수납 때문에 남아 이 record 의 도장만 지웠다(이 돈은 옛 영수증 안에 있다). */
  unstamped?: boolean
  /** 줄이 남은 키의 남은 몫과 발행 금액이 다르다(자동으로 안 덮었다). */
  mismatch: CrMismatch[]
}

/**
 * 조회 결과에 싣는 키 정보. 화면이 행마다 '발행 금액 대 받은 몫'을 말할 재료(2단계).
 * unstampedRent 는 도장 없는 이용료 행의 합이다. 일부만 도장 찍힌 키에서 캡션의 비교 기준을 도장 찍힌 몫으로
 * 잡는 데 쓴다(독립 검수 R-2, 아직 어느 영수증에도 안 덮인 새 돈 때문에 '적음' 경고가 늘 서지 않게).
 */
export type CrKeyInfo = { line: CashReceiptLineView | null; rent: number; rentRows: number; stampedRentRows: number; unstampedRent: number }

/**
 * 한 계약의 여러 입금일에 걸친 키 정보를 한 번에 읽는다. 이용료 몫은 점검 (바)와 같은 식이다
 * (summarizeCashReceiptKey). 키는 cashReceiptKey 모양이다.
 */
export async function crKeyInfoForLease(propertyId: string, leaseTermId: string, payDates: Date[]): Promise<Map<string, CrKeyInfo>> {
  const out = new Map<string, CrKeyInfo>()
  const days = [...new Map(payDates.map(d => [d.getTime(), d])).values()]
  if (days.length === 0) return out
  const [records, lines] = await Promise.all([
    prisma.paymentRecord.findMany({
      where: { propertyId, leaseTermId, payDate: { in: days }, isBillingAdjust: false, deletedAt: null },
      select: { leaseTermId: true, payDate: true, payMethod: true, isDeposit: true, actualAmount: true, cashReceiptIssuedAt: true },
    }),
    prisma.cashReceipt.findMany({
      where: { propertyId, leaseTermId, payDate: { in: days }, deletedAt: null },
      orderBy: { createdAt: 'asc' },
      select: { leaseTermId: true, payDate: true, payMethod: true, amount: true, issuedAt: true, inclDeposit: true, inclCleaning: true, inclRent: true },
    }),
  ])
  const rowsByKey = new Map<string, typeof records>()
  for (const r of records) {
    const k = cashReceiptKey(r)
    rowsByKey.set(k, [...(rowsByKey.get(k) ?? []), r])
  }
  const lineByKey = new Map<string, (typeof lines)[number]>()
  for (const l of lines) if (!lineByKey.has(cashReceiptKey(l))) lineByKey.set(cashReceiptKey(l), l)
  for (const k of new Set([...rowsByKey.keys(), ...lineByKey.keys()])) {
    const p = summarizeCashReceiptKey(rowsByKey.get(k) ?? [])
    const l = lineByKey.get(k)
    out.set(k, { line: l ? cashReceiptLineView(l) : null, rent: p.rent, rentRows: p.rentRows, stampedRentRows: p.stampedRentRows, unstampedRent: p.unstampedRent })
  }
  return out
}
