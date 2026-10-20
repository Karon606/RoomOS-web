// 납부 확인서의 달 축 정본(순수) — 고를 수 있는 귀속월, 발행일 기본값, 최신 발급본 판정, 묶음 발급 적용취소 토큰.
//
// 왜 한 곳인가(신고 2026-10-19, 납부영수증 여러 달). 발급 화면(한 달·여러 달), 묶음 발급 서버, 서류 시트가
// 같은 물음을 묻는다. "이 계약의 어느 달에 돈이 실제로 들어왔나, 그 달 몫의 마지막 입금일은 언제인가."
// 사본을 두면 화면은 고를 수 있다고 하는데 서버가 거절하거나, 발행일 기본값이 자리마다 갈린다.
//
// 실입금 술어는 lib/rentPaid 정본(isRealRentPayment)이 쥔다. 여기서는 그 술어를 지난 행을 달로 묶을 뿐이다.
import { isRealRentPayment } from './rentPaid'
import { kstYmdStr } from './kstDate'
import { kstMonthOf } from './fmtDate'
import { withParticle } from './koParticle'

/** 실입금 판정에 필요한 칸 + 묶을 축(귀속월)과 날짜(입금일). */
export type RentPaymentRow = {
  targetMonth: string | null
  actualAmount: number
  isBillingAdjust: boolean
  memo: string | null
  payDate: Date
}

/** 발급할 수 있는 귀속월 하나. lastPayDate 는 그 달 몫 마지막 실입금일(KST 'YYYY-MM-DD'). */
export type IssuableMonth = { month: string; amount: number; lastPayDate: string }

/**
 * 실입금이 있는 귀속월들 — 최근 달이 앞이다.
 *
 * 한 달 화면의 금액·납부일 자동값과 같은 규칙이다(getRentReceiptData: 실입금 합 + 최종 입금일).
 * 보증금·양도인 몫은 부르는 쪽 조회가 이미 거른다(where isDeposit false, isPrevOwner false).
 */
export function issuableRentMonths(rows: readonly RentPaymentRow[]): IssuableMonth[] {
  const byMonth = new Map<string, IssuableMonth>()
  for (const r of rows) {
    if (!r.targetMonth || !/^\d{4}-\d{2}$/.test(r.targetMonth)) continue
    if (!isRealRentPayment(r)) continue
    const ymd = kstYmdStr(r.payDate)
    const cur = byMonth.get(r.targetMonth)
    if (!cur) byMonth.set(r.targetMonth, { month: r.targetMonth, amount: r.actualAmount, lastPayDate: ymd })
    else {
      cur.amount += r.actualAmount
      if (ymd > cur.lastPayDate) cur.lastPayDate = ymd
    }
  }
  return [...byMonth.values()].sort((a, b) => (a.month < b.month ? 1 : a.month > b.month ? -1 : 0))
}

/**
 * 발행일 기본값 — 그 달 몫 마지막 실입금일. 실입금이 없는 달이면 오늘(종전 기본값).
 *
 * 왜 납부일인가(UX 패널 채택, 운영자 승인 2026-10-20 '추천대로'). 여러 달을 한 번에 뽑을 때 발행일이
 * 전부 오늘이면 7월분 종이가 10월에 나간 것처럼 읽힌다. 423호 운영자는 손으로 발행일을 소급하다
 * 8월분을 실입금(9/18)보다 앞선 8/21 로 적었다. 받기 전 날짜의 확인서는 허위 서류다.
 * 미래 입금일(앞당겨 적은 기록)이면 오늘로 자른다. 발행일은 미래일 수 없다(서버 assertNotFuture).
 */
export function defaultIssueDate(lastPayDate: string | null | undefined, today: string = kstYmdStr()): string {
  if (!lastPayDate || !/^\d{4}-\d{2}-\d{2}$/.test(lastPayDate)) return today
  return lastPayDate > today ? today : lastPayDate
}

/** 묶음 한 번에 고를 수 있는 달 수 상한. 함수 시간 상한(60초) 안에서 장마다 PDF·업로드가 끝나야 한다(검수 2026-10-20, 12 → 6). */
export const RENT_RECEIPT_BATCH_MAX = 6

/**
 * 묶음 발급 요청 검사 — 고른 달이 모두 실입금이 있는 달이고, 겹치지 않고, 발행일이 형식에 맞고 미래가 아니며
 * 그 달 몫 입금보다 앞서지 않는가. 통과하면 null, 아니면 화면에 갈 한국어 한 문장.
 *
 * 입금보다 앞선 발행일을 막는 이유. 받기 전 날짜의 납부 확인서는 허위 서류다(423호 8월분 8/21 < 실입금 9/18).
 * 한 달 화면은 운영자가 자동값을 고쳐 쓰는 자리라 막지 않지만(회계 오더 '자동값은 초기값일 뿐'), 묶음은 금액·납부일을
 * 서버가 기록에서 채우므로 기록과 어긋나는 날짜를 받을 이유가 없다.
 */
export function batchRequestError(
  picks: readonly { month: string; issueDate: string }[],
  issuable: readonly IssuableMonth[],
  today: string = kstYmdStr(),
): string | null {
  if (picks.length === 0) return '발급할 달을 고르세요.'
  if (picks.length > RENT_RECEIPT_BATCH_MAX) return `한 번에 ${RENT_RECEIPT_BATCH_MAX}달까지 발급할 수 있습니다.`
  const seen = new Set<string>()
  const byMonth = new Map(issuable.map(m => [m.month, m]))
  for (const p of picks) {
    if (!/^\d{4}-\d{2}$/.test(p.month)) return '발급할 달 형식이 올바르지 않습니다.'
    if (seen.has(p.month)) return `${withParticle(monthLabel(p.month), '이/가')} 두 번 들어 있습니다.`
    seen.add(p.month)
    const m = byMonth.get(p.month)
    if (!m) return `${withParticle(monthLabel(p.month), '은/는')} 실제 입금 기록이 없어 묶음으로 발급할 수 없습니다.`
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.issueDate)) return `${monthLabel(p.month)}의 발행일이 비어 있습니다.`
    if (p.issueDate > today) return `${monthLabel(p.month)}의 발행일이 미래입니다.`
    if (p.issueDate < m.lastPayDate) return `${monthLabel(p.month)}의 발행일이 입금일(${m.lastPayDate.replace(/-/g, '.')})보다 앞섭니다.`
  }
  return null
}

// ── 자동값 → 종이 칸 ─────────────────────────────────────────────────────────────
/** 화면 폼의 칸(문자열) — 발급 화면 상태와 묶음 서버가 같은 모양을 쓴다. */
export type RentReceiptFormFields = {
  name: string; room: string; period: string; targetMonth: string
  amount: string; payDate: string; payMethod: string; note: string; recipientName: string
}

/**
 * 서버 자동값(getRentReceiptData)을 종이 칸으로 옮긴다. 이름은 표기가 적용된 값을 부르는 쪽이 넘긴다.
 * 한 달 화면의 첫 값과 묶음 서버가 달마다 채우는 값이 이 함수 하나다(사본이면 묶음 종이만 금액 표기가 갈린다).
 */
export function autoFormFields(
  data: { room: string; period: string; targetMonth: string; amount: number; payDate: string; payMethod: string; note: string; recipientName: string },
  name: string,
): RentReceiptFormFields {
  return {
    name,
    room: data.room,
    period: data.period,
    targetMonth: data.targetMonth,
    amount: data.amount ? data.amount.toLocaleString() : '',
    payDate: data.payDate,
    payMethod: data.payMethod,
    note: data.note,
    recipientName: data.recipientName,
  }
}

/** 같은 해(todayMonth 의 해)면 '8월분', 다른 해면 '2025년 12월분'. 확인창처럼 여러 달을 한 줄에 늘어놓는 자리가 쓴다. */
export function monthLabelShort(month: string, todayMonth: string): string {
  return month.slice(0, 4) === todayMonth.slice(0, 4) ? `${Number(month.slice(5, 7))}월분` : monthLabel(month)
}

/** '2026-08' 을 '2026년 8월분' 으로. 화면 목록 제목과 오류 문장이 같은 표기를 쓴다. */
export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return `${y}년 ${m}월분`
}

/**
 * 납부 확인서 최신 판정 — **귀속월이 늦은 것이 최신**이고, 같은 달이면 발행일·생성 순서로 가른다.
 *
 * 종전에는 발행일 최신 한 장이었다. 10월에 7·8·9월분을 소급 발급하면 발행일 순서가 곧 작업 순서라
 * 시트가 9월분이 아닌 마지막으로 누른 달을 '최신'으로 세웠다(423호 10-18 7장). 귀속월이 없는 옛 발급본은
 * 발행일의 달로 읽는다(stale 판정과 같은 폴백).
 * 입력 순서는 상관없다. 같은 키면 입력에서 앞에 있던 것을 남긴다(안정 정렬, 호출부가 발행일 내림차순으로 넘긴다).
 */
export function latestByTargetMonth<T extends { targetMonth?: string | null; at: Date }>(files: readonly T[]): T | undefined {
  let best: T | undefined
  let bestKey = ''
  for (const f of files) {
    const key = f.targetMonth ?? kstMonthOf(f.at)
    if (!best || key > bestKey || (key === bestKey && f.at.getTime() > best.at.getTime())) {
      best = f
      bestKey = key
    }
  }
  return best
}

// ── 발급 적용취소 토큰 ─────────────────────────────────────────────────────────────
// 한 장 발급과 묶음 발급이 같은 토큰을 쓴다(한 장 = 길이 1 인 묶음). 서명은 현금영수증 적용취소와 같은 정본
// (rooms/cashReceiptLine signUndoBody)이고 용도 라벨만 다르다. 행마다 '발급 직후 모양'을 싣고 서버가 지금 행과
// 글자 그대로 같을 때만 되돌린다(CAS). 하나라도 달라졌으면 아무것도 안 바꾼다(묶음은 한 번에 되돌린다).
export const RENT_RECEIPT_UNDO_DOMAIN = 'rent-receipt-issue'
export type RentReceiptIssueRow = {
  id: string; driveFileId: string; fileName: string; receiptNo: string | null; issuedAt: string
  kind: string; targetMonth: string | null; tenantId: string; leaseTermId: string | null; nameStyle: string | null
}
export type RentReceiptIssueUndo = { v: 1; rows: RentReceiptIssueRow[]; sig?: string }
export const RENT_RECEIPT_UNDO_STALE = '발급한 뒤 그 서류가 지워졌거나 바뀌어 적용취소할 수 없습니다. 발급 이력에서 직접 확인해 주세요.'
export const RENT_RECEIPT_UNDO_INVALID = '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.'

/** 서명할 정본 문자열. 필드 순서를 고정한 배열의 JSON 이라 객체 키 순서·시각 표기가 달라져도 같다. */
export function canonicalRentReceiptUndo(u: RentReceiptIssueUndo): string {
  return JSON.stringify([u.v, u.rows.map(r => [
    r.id, r.driveFileId, r.fileName, r.receiptNo, new Date(r.issuedAt).toISOString(),
    r.kind, r.targetMonth, r.tenantId, r.leaseTermId, r.nameStyle,
  ])])
}

/** 화면을 거쳐 돌아온 값이 토큰 모양인가. 아니면 null(모양이 틀린 값으로는 아무것도 안 쓴다). */
export function parseRentReceiptUndo(x: unknown): RentReceiptIssueUndo | null {
  if (!x || typeof x !== 'object') return null
  const u = x as Partial<RentReceiptIssueUndo>
  if (u.v !== 1 || !Array.isArray(u.rows) || u.rows.length === 0 || u.rows.length > RENT_RECEIPT_BATCH_MAX) return null
  if (u.sig !== undefined && typeof u.sig !== 'string') return null
  const str = (v: unknown) => typeof v === 'string'
  const strOrNull = (v: unknown) => v === null || typeof v === 'string'
  for (const r of u.rows) {
    if (!r || !str(r.id) || !str(r.driveFileId) || !str(r.fileName) || !strOrNull(r.receiptNo) || !str(r.kind)
      || !strOrNull(r.targetMonth) || !str(r.tenantId) || !strOrNull(r.leaseTermId) || !strOrNull(r.nameStyle)) return null
    if (typeof r.issuedAt !== 'string' || Number.isNaN(new Date(r.issuedAt).getTime())) return null
  }
  if (new Set(u.rows.map(r => r.id)).size !== u.rows.length) return null
  return u as RentReceiptIssueUndo
}

/** DB 행이 토큰이 적어 둔 '발급 직후 모양' 그대로인가. 지워졌으면(deletedAt) 아니다. */
export function rentReceiptRowUnchanged(
  db: { id: string; driveFileId: string; fileName: string; receiptNo: string | null; issuedAt: Date; kind: string
    targetMonth: string | null; tenantId: string; leaseTermId: string | null; nameStyle: string | null; deletedAt: Date | null },
  t: RentReceiptIssueRow,
): boolean {
  return db.deletedAt === null && db.id === t.id && db.driveFileId === t.driveFileId && db.fileName === t.fileName
    && db.receiptNo === t.receiptNo && db.issuedAt.toISOString() === new Date(t.issuedAt).toISOString()
    && db.kind === t.kind && db.targetMonth === t.targetMonth && db.tenantId === t.tenantId
    && db.leaseTermId === t.leaseTermId && db.nameStyle === t.nameStyle
}
