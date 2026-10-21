// 월별 청구액 단일 규칙 — 순수함수(부수효과 없음).
// 읽기 3곳(rooms getRoomPaymentStatus · dashboard page.tsx · dashboard/unpaid.ts)과
// 쓰기 경로(rooms savePayment 등)가 전부 이 헬퍼를 쓴다. 우선순위:
//   ① 퇴실 일할 정산(checkoutProratedMonth === 그 달) — 저장된 일할액 최우선
//   ② 락인된 record.expectedAmount(그 달 최대) — 월세 변경의 과거 소급 방지
//   ③ 현재 월세(할인 반영) fallback — record 없는 달
// 여기 규칙을 바꾸면 세 화면·푸시·수납 등록이 한 번에 같이 바뀐다.
import { RentDiscountInput, discountedRent } from './rentDiscount'
import { kstYmdStr } from './kstDate'
import { cycleDayOf, hasSplitCycle, sameDueDay } from './dueDay'
import { isDueDayAdjust, parseDueDayAdjustMemo, type BillingDueDayAdjust } from './dueDayAdjust'

export type BillingLeaseFields = {
  rentAmount: number
  // 계약 상태 — **필수**. 비거주(NON_RESIDENT)는 거주와 예약 인상 축이 다르다(아래 effectiveBaseRent).
  // 옵셔널로 두면 select 에서 빠뜨려도 컴파일이 통과하고, 그러면 비거주 계약이 거주 인상가로 청구된다
  // (100,000 이 480,000 으로 4.8배 — 418호 유형). 이 타입이 곧 감지망이다.
  status: string
  checkoutProratedAmount?: number | null
  checkoutProratedMonth?: string | null
  discounts?: RentDiscountInput[] | null
  // 단기 입주월 단일 청구 — 단기는 rentAmount가 월액이 아니라 체류 전체 사용료라
  // 월 루프가 달마다 fallback을 물면 이중 청구가 된다(운영자 승인 2026-07-20).
  // 둘 다 제공될 때만 발동 — 미제공 호출부는 기존 동작(회귀 0).
  isShortTerm?: boolean
  moveInDate?: Date | string | null
  // 매월 납부일 — **필수**(값은 null 가능). 입주달 첫 달 규칙(아래 firstMonthGap)이 읽는다.
  // 옵셔널로 두면 select 에서 빠뜨려도 컴파일이 통과하고, 납부일을 따로 정한 계약의 입주달이
  // 조용히 만월로 청구된다. status 와 같은 관례 — 이 타입이 곧 감지망이다.
  dueDay: string | null
  // 이용 기간 시작일 — **필수**(값은 null 가능, null 이면 dueDay 와 같다. lib/dueDay cycleDayOf 정본).
  // 입주달 첫 달 규칙·무청구 판정·첫 달 기한이 기간 경계로 읽는다(운영자 승인 2026-10-21, 504호 '납부일만 옮김').
  // 옵셔널로 두면 select 에서 빠뜨려도 컴파일이 통과하고, 납부일만 옮긴 계약의 첫 달·퇴실월이 납부일 기준으로 조용히 갈린다.
  cycleDay: string | null
  // 이 계약의 살아 있는 납입일 변경 조정 행 — **필수**(없으면 빈 배열). 입주달 첫 달 규칙이 읽는다
  // (아래 firstMonthRuleDueDay). 채우는 자리는 정본 하나다(lib/dueDayAdjust attachDueDayAdjusts).
  // 옵셔널로 두면 select 에서 빠뜨린 화면만 입주달 일할을 두 번 받는다. dueDay 와 같은 관례로 이 타입이 감지망이다.
  dueDayAdjusts: readonly BillingDueDayAdjust[]
  // 예약 인상(미래월 미리 반영) — 인상 적용월 이상의 달은 scheduledRent 로 청구한다.
  // "7/1부 인상"은 곧 "7월 이용료부터" 라서, 적용일 전에 7월분을 미리 납부해도 인상가가 맞다.
  // 둘 중 한 형태로 제공: 평탄화된 scheduledRent/rentUpdateMonth, 또는 room 객체(스케줄러가 baseRent로
  // 옮기기 전까지의 예약값). 둘 다 없으면 기존처럼 rentAmount 사용(회귀 0).
  scheduledRent?: number | null
  rentUpdateMonth?: string | null       // 'YYYY-MM' — 이 달부터 scheduledRent 적용
  room?: {
    scheduledRent?: number | null
    rentUpdateDate?: Date | string | null
    // 비거주 축 — 엔진은 nonResidentRent 를 읽지 않는다(기준액은 계약의 rentAmount 다).
    nonResidentRent?: number | null
    nonResidentScheduled?: number | null
    nonResidentRentDate?: Date | string | null
  } | null
}

// 그 달(mon)에 유효한 기준 월세 — 예약 인상 적용월 이상이면 scheduledRent, 아니면 현재 rentAmount.
// 비거주 계약은 축이 다르다 — 거주 예약(scheduledRent/rentUpdateDate)이 아니라
// 비거주 예약(nonResidentScheduled/nonResidentRentDate)을 같은 규칙으로 읽는다.
// 기준액은 어느 축이든 l.rentAmount 다. room.nonResidentRent 를 기준액으로 쓰면
// 계약별 협의가가 방 기본값으로 덮여 사라진다.
//
// export 인 이유 — 청구 전체(billForLeaseMonth)가 아니라 **기준 월세만** 필요한 호출부가 있다.
// 수납 관리 행 조립(rooms/actions buildLeaseRow)이 그렇다. 그 자리는 일할·락인·단기 규칙을
// 자기 순서로 이미 세워 두었고 필요한 것은 '그 달 기준액' 한 조각뿐이라, 종전에는 이 함수를
// 손으로 두 벌 베껴 놓고 있었다(2026-08-12 구조 부채 정리). 손사본은 상태 분기를 빠뜨려
// 비거주 계약에 거주 인상 예약을 물릴 수 있었다 — 418호 4.8배와 같은 클래스다.
export function effectiveBaseRent(l: Omit<BillingLeaseFields, 'dueDayAdjusts' | 'cycleDay'>, mon: string): number {
  if (l.status === 'NON_RESIDENT') {
    const nrSched = l.room?.nonResidentScheduled ?? null
    const nrMon = l.room?.nonResidentRentDate ? monthOfDate(l.room.nonResidentRentDate) : null
    if (nrSched != null && nrSched > 0 && nrMon && mon >= nrMon) return nrSched
    return l.rentAmount
  }
  const sched = l.scheduledRent ?? l.room?.scheduledRent ?? null
  const rum = l.rentUpdateMonth ?? (l.room?.rentUpdateDate ? monthOfDate(l.room.rentUpdateDate) : null)
  if (sched != null && sched > 0 && rum && mon >= rum) return sched
  return l.rentAmount
}

// 계약이 아직 없는 방을 그 달에 얼마로 내놓는가 — 제시가. 기준액은 계약의 rentAmount 가 아니라 방의 baseRent 다.
//
// effectiveBaseRent 가 기준액으로 rentAmount 를 고집하는 이유는 협의가 보호다(계약별 협의가가 방 기본값으로
// 덮여 사라지는 것을 막는다). 아직 계약이 없는 방에는 보호할 협의가가 없고, 그 방을 내놓는 값은 baseRent 다
// (소개 페이지 공개가·매칭 조건 필터도 같은 축을 쓴다). 예약 인상 규칙은 그대로 물려받는다.
//
// 왜 달로 묻는가 — 인상은 '그 달 이용료부터'라 적용일이 8/20 이어도 8월분은 전부 인상가다. 8/16 에 비는 방을
// 날짜로 비교하면 구가라 말하는데 그 사람이 실제로 내는 첫 달 청구는 인상가가 된다. 화면과 청구가 갈린다.
// 할인·퇴실 일할·락인은 계약에 붙는 값이라 계약 없는 방에는 존재할 수 없다 — 생략이 아니라 항등이다.
export function offerRentForMonth(
  room: { baseRent: number; scheduledRent?: number | null; rentUpdateDate?: Date | string | null },
  mon: string,                  // 'YYYY-MM'
): number {
  return effectiveBaseRent({ rentAmount: room.baseRent, status: 'ACTIVE', dueDay: null, room }, mon)
}

// 아직 제시가에 반영되지 않은 예약 가격변경 — 홈 타일 가격 예고의 발화 판정. 없으면 null.
//
// 두 끝점을 모두 offerRentForMonth 로 구한다. 예고가 말하는 값과 타일이 세운 값이 갈릴 자리를
// 구조적으로 없애는 것이 이 함수의 전부다. scheduledRent 를 직접 읽어 조립하면 가드(0·음수·
// 고아 적용일·파싱 실패)를 손으로 다시 써야 하고, 그 손사본이 언젠가 정본과 갈린다.
//
// 왜 날짜가 아니라 달로 비교하는가 — offerRentForMonth 와 같은 이유다. 적용일이 8/20 이어도
// 8월분은 전부 인상가라, 날짜로 비교하면 8/5 에 보는 타일이 이미 38만을 세워 놓고 그 아래
// "8/20 부터 38만"을 예고한다. 이미 그 값인데 곧 그 값이 된다고 말하는 것이고, 8/20 에는
// 아무 숫자도 안 변한 날 예고만 사라져 화면이 혼자 움직인다.
//
// 기준월(mon)은 '오늘'이 아니라 그 자리가 지금 보여 주는 달이다 — 빈 방 타일은 대시보드
// 선택월, 입주 가능 블락은 그 방이 비는 달. 오늘로 잡으면 9월을 열어 둔 화면에 이미 지나간
// 전환이 예고로 뜬다.
//
// 인상·인하를 가르지 않는다(운영자 지시 2026-08-12). 방향은 표기가 아니라 두 금액의 대소가 말한다.
export function offerRentChangeAfterMonth(
  room: { baseRent: number; scheduledRent?: number | null; rentUpdateDate?: Date | string | null },
  mon: string,                  // 'YYYY-MM' — 그 자리가 지금 보여 주는 달
): { month: string; rent: number } | null {
  const applyMon = monthOfDate(room.rentUpdateDate)
  if (!applyMon || applyMon <= mon) return null
  const rent = offerRentForMonth(room, applyMon)
  // 값이 안 움직이면 변경이 아니다 — 같은 값 예약(35만을 35만으로)은 예고할 것이 없다.
  if (rent === offerRentForMonth(room, mon)) return null
  return { month: applyMon, rent }
}

/**
 * 입주달 앞 구간 일수 — 입주일부터 첫 납부일 전날까지(운영자 승인 2026-09-07, 해석 1).
 *
 * 납부일이 입주일과 같으면(파생 등가 포함, sameDueDay) 0 이다 — 기존 계약 전부가 이 갈래라
 * 청구가 한 글자도 안 바뀐다. 다르면 두 방향이 있다.
 *   - 납부일이 입주일보다 뒤(9/5 입주·20일): 앞 구간 15일. 입주달 = 만월 + 일할 가산.
 *   - 납부일이 입주일보다 앞(9/25 입주·5일): 첫 납부일이 다음 달로 넘어가 앞 구간 10일.
 *     입주달 = 일할만(만월 몫은 다음 달 기간이라 다음 달에 청구된다).
 * 상한 30 — "1일 이용요금은 월 이용료의 30분의 1" 규칙의 귀결(퇴실 정산과 같은 단가).
 */
export function firstMonthGap(moveInDate: Date | string, dueDay: string): { days: number; fullMonthToo: boolean } | null {
  const d = new Date(moveInDate)
  if (isNaN(d.getTime())) return null
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  const lastOfMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const derived = day >= lastOfMonth ? '말일' : String(day)
  // 등가면 발동 안 함 — 30일 입주 + '말일' 같은 파생 등가 쌍 포함(sameDueDay 와 같은 판정).
  const norm = (v: string) => (v.includes('말') ? '말일' : String(parseInt(v, 10)))
  if (norm(dueDay) === norm(derived)) return null
  const pIn = (yy: number, mm: number): number => {
    const last = new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
    if (dueDay.includes('말')) return last
    const n = parseInt(dueDay, 10)
    return isNaN(n) ? NaN : Math.min(n, last)
  }
  const pThis = pIn(y, m)
  if (isNaN(pThis)) return null
  const moveInUtc = Date.UTC(y, m, day)
  const nextP = pThis > day ? Date.UTC(y, m, pThis) : Date.UTC(y, m + 1, pIn(y, m + 1))
  const days = Math.min(30, Math.round((nextP - moveInUtc) / 86400000))
  if (days <= 0) return null
  // 첫 납부일이 입주달 안이면 그날부터 시작하는 만월 몫도 입주달 귀속이다(귀속월 = 기간 시작 달).
  return { days, fullMonthToo: pThis > day }
}

/**
 * 입주달 첫 달 규칙이 읽을 납부일(운영자 승인 2026-10-20, 방안 2).
 *
 * 입주한 달에 납입일을 바꾸면(changeDueDay) 그 바꿈으로 늘거나 준 날수는 조정 행이 받을 돈·돌려줄 돈으로 이미 센다.
 * 그런데 첫 달 규칙이 지금 납부일로 앞 구간을 다시 재면 같은 날수를 한 번 더 센다(513호. 10-09 입주, 9일에서 20일,
 * 락이 없으면 청구 350,000 + 128,333 위에 조정 −128,333 이 또 붙는다). 그래서 그 경우에만 첫 달 규칙을
 * **바꾸기 전 납부일**로 잰다. 조정 행이 그 바꿈의 유일한 원천이 된다(협의 금액·수동 수정이 모두 조정 행 기준이다).
 *
 * 바꾸기 전 납부일을 쓰는 것은 조정 행과 첫 달 규칙이 같은 날수를 셀 때뿐이다. 판정은 셋이 모두 참일 때다.
 *   1. 입주달(moveInDate 의 달)을 귀속월로 둔 살아 있는 조정 행이 있다(다른 달 조정 행은 보지 않는다).
 *   2. 그 행들의 메모를 모두 읽을 수 있고, seqNo 순으로 이어진다(앞 행의 바꾼 뒤 = 다음 행의 바꾸기 전).
 *   3. 마지막 행의 바꾼 뒤가 지금 납부일과 같다(그 뒤 다른 경로로 납부일을 또 바꿨으면 같은 날수가 아니다).
 * 하나라도 거짓이면 지금 납부일 그대로다(종전 동작). 참이면 첫 행의 바꾸기 전 납부일을 돌려준다.
 * 바꾸기 전 납부일이 입주일과 같은 날이면 첫 달 규칙은 발동하지 않는다(513호, 만월만). 다르면 바꾸기 전에 이미 서 있던
 * 앞 구간은 남고 바꿈으로 생긴 몫만 조정 행이 센다. 바꾸기 전 납부일이 없던 계약('?')은 null 이다(규칙 무발동).
 * 락(우선순위 ②)이 먼저 이기므로 그 달 수납이 있으면 여기까지 오지 않는다.
 */
/**
 * 조정 행 입력이 실려 왔는가. 타입(필수 칸)은 tsc 가 보는 앱 코드에서만 걸리고 scripts 는 tsconfig 밖이라,
 * 실행 중에도 같은 계약을 강제한다. 빠뜨린 호출자는 조용히 종전 이중 셈으로 떨어지는 대신 여기서 멈춘다.
 */
function requireDueDayAdjusts(l: Pick<BillingLeaseFields, 'dueDayAdjusts'>): readonly BillingDueDayAdjust[] {
  if (!Array.isArray(l.dueDayAdjusts)) throw new Error('청구 엔진 입력에 조정 행(dueDayAdjusts)이 없습니다. lib/dueDayAdjust 정본(attachDueDayAdjusts 등)으로 채워 주세요.')
  return l.dueDayAdjusts
}

export function firstMonthRuleDueDay(l: Pick<BillingLeaseFields, 'moveInDate' | 'dueDay' | 'cycleDay' | 'dueDayAdjusts'>): string | null {
  return firstMonthRule(l).due
}

/**
 * 위 판정의 속사정까지. fallback 은 입주달 조정 행이 있는데 조건 2·3 이 깨져 지금 납부일로 떨어진 이유다
 * (unreadable = 메모를 못 읽음, chain-gap = 사슬이 끊김, chain-end = 사슬 끝이 지금 납부일과 다름).
 * 그 경우 락이 없으면 종전 이중 셈이 돌아오므로 정합 감사(lib/integrityAudit 규칙 10)가 이 값으로 알린다.
 */
//
// 첫 달 규칙이 재는 것은 기간이다. 그래서 지금 값도, 사슬 끝과 견주는 값도 이용 기간 시작일(cycleDayOf)이다
// (운영자 승인 2026-10-21). 조정 행은 '기간도 옮김' 변경만 만들고, '납부일만 옮김' 은 기간을 그대로 두어 조정 행이 없다.
// cycleDay 가 없는 계약(지금 전부)은 cycleDayOf 가 dueDay 라 종전과 글자 하나 다르지 않다.
export function firstMonthRule(l: Pick<BillingLeaseFields, 'moveInDate' | 'dueDay' | 'cycleDay' | 'dueDayAdjusts'>): {
  due: string | null
  fallback: null | 'unreadable' | 'chain-gap' | 'chain-end'
} {
  const cycle = cycleDayOf(l)
  const inMonth = monthOfDate(l.moveInDate ?? null)
  if (!inMonth) return { due: cycle, fallback: null }
  const rows = requireDueDayAdjusts(l)
    .filter(r => r.targetMonth === inMonth && isDueDayAdjust(r.memo))
    .slice()
    .sort((a, b) => a.seqNo - b.seqNo)
  if (rows.length === 0) return { due: cycle, fallback: null }
  const memos = rows.map(r => parseDueDayAdjustMemo(r.memo))
  if (memos.some(m => m === null)) return { due: cycle, fallback: 'unreadable' }
  for (let i = 1; i < memos.length; i++) {
    if (!sameDueDay(memos[i - 1]!.to, memos[i]!.from)) return { due: cycle, fallback: 'chain-gap' }
  }
  if (!sameDueDay(memos[memos.length - 1]!.to, cycle)) return { due: cycle, fallback: 'chain-end' }
  const from = memos[0]!.from
  return { due: from === '?' ? null : from, fallback: null }
}

/**
 * 입주달 이중 셈이 종전 동작으로 남는 모양인가(정합 감사 규칙 10의 판정 정본). 엔진은 같은 날수일 때만 봉합하고
 * 나머지는 종전 그대로라, 그 나머지를 데이터에서 알린다. 돌려주는 값은 이유, 아니면 null.
 *   - unreadable·chain-gap·chain-end: 입주달 조정 행이 있는데 firstMonthRule 이 지금 납부일로 떨어졌다(락 유무와 무관하게 알린다.
 *     그 달 수납이 지워지는 순간 이중 셈이 된다).
 *   - other-month: 조정 행이 입주달이 아닌 달에 있고, 입주달에 락이 없으며(지금 노출), 입주달이 청구 창(인수 기준월 이상) 안이고,
 *     입주달 청구가 지금 납부일과 바꾸기 전 납부일로 갈린다(그 차이를 조정 행이 또 센다).
 */
export function firstMonthAdjustExposure(
  l: BillingLeaseFields,
  opts: { moveInMonthLocked: number | null; cutoffMonth: string | null },
): null | 'unreadable' | 'chain-gap' | 'chain-end' | 'other-month' {
  if (l.isShortTerm) return null
  const inMonth = monthOfDate(l.moveInDate ?? null)
  if (!inMonth) return null
  const rule = firstMonthRule(l)
  if (rule.fallback) return rule.fallback
  if (opts.moveInMonthLocked && opts.moveInMonthLocked > 0) return null
  if (opts.cutoffMonth && inMonth < opts.cutoffMonth) return null
  const others = requireDueDayAdjusts(l)
    .filter(r => r.targetMonth !== inMonth && isDueDayAdjust(r.memo))
    .slice()
    .sort((a, b) => (a.targetMonth === b.targetMonth ? a.seqNo - b.seqNo : a.targetMonth < b.targetMonth ? -1 : 1))
  if (others.length === 0) return null
  const first = parseDueDayAdjustMemo(others[0].memo)
  if (!first) return null
  const before = first.from === '?' ? null : first.from
  const now = billForLeaseMonth(l, inMonth, null)
  const then = billForLeaseMonth({ ...l, dueDay: before, cycleDay: null, dueDayAdjusts: [] }, inMonth, null)
  return now !== then ? 'other-month' : null
}

export function billForLeaseMonth(
  l: BillingLeaseFields,
  mon: string,                  // 'YYYY-MM'
  locked?: number | null,       // 그 달 record들의 최대 expectedAmount (없으면 null)
): number {
  requireDueDayAdjusts(l)   // 우선순위와 무관하게 늘 검사한다(어느 갈래로 빠지든 입력 누락은 누락이다)
  if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return l.checkoutProratedAmount
  if (locked && locked > 0) return locked
  // 단기 입주월 단일 청구 — 일할·락인은 위에서 이미 존중(record 있는 달의 과거 결산 불변),
  // record 없는 달의 fallback만 차단해 월 경계를 넘는 단기의 이중 청구를 막는다.
  if (l.isShortTerm && l.moveInDate) {
    const inMonth = monthOfDate(l.moveInDate)
    if (inMonth && mon !== inMonth) return 0
  }
  const base = discountedRent(l.discounts, mon, effectiveBaseRent(l, mon))
  // 입주달 첫 달 규칙(운영자 승인 2026-09-07) — 납부일이 입주일과 다를 때만 발동한다.
  // 락인(우선순위 ②)이 위에서 이미 이겼으므로 수납 기록이 있는 과거 입주달은 불변이다.
  // 입주달에 납입일을 바꾼 계약은 바꾸기 전 납부일로 잰다(firstMonthRuleDueDay, 조정 행과 같은 날수를 두 번 세지 않게).
  if (!l.isShortTerm && l.moveInDate && monthOfDate(l.moveInDate) === mon) {
    const ruleDue = firstMonthRuleDueDay(l)
    const gap = ruleDue ? firstMonthGap(l.moveInDate, ruleDue) : null
    if (gap) {
      const prorated = Math.floor(base * gap.days / 30)
      return gap.fullMonthToo ? base + prorated : prorated
    }
  }
  return base
}

// 예약 가격변경(scheduledRent/nonResidentScheduled)이 '오늘 적용되었는가'를 가르는 경계.
// rentUpdateDate·nonResidentRentDate 는 @db.Date 라 UTC 자정 Date 로 읽힌다. 그래서 경계도
// KST 오늘의 UTC 자정으로 맞춘다 — 같은 기준끼리 비교해야 실행 환경 타임존이 결과에 안 섞인다.
// 로컬 자정(new Date().setHours(0,0,0,0))을 쓰면 서버(UTC)에서는 KST 00~09 시에 아직 어제라
// 적용일 당일 아침 9시까지 인상이 안 걸리고, KST 기기에서는 하루가 통째로 밀린다.
export function scheduledRentApplyCutoff(now: Date = new Date()): Date {
  return new Date(`${kstYmdStr(now)}T00:00:00.000Z`)
}

// 'YYYY-MM' 추출 (Date | 'YYYY-MM-DD' | null)
export function monthOfDate(d: Date | string | null | undefined): string | null {
  if (!d) return null
  const dt = new Date(d)
  if (isNaN(dt.getTime())) return null
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
}

// 퇴실월 이후 청구 제외 — mon이 퇴실월보다 뒤면 true (상태 무관, 날짜 기준)
export function isAfterMoveOutMonth(expectedMoveOut: Date | string | null | undefined, mon: string): boolean {
  const mo = monthOfDate(expectedMoveOut ?? null)
  return !!mo && mon > mo
}

// dueDay 문자열('N' | '말' | 'YYYY-MM-DD')을 그 월(mon)의 실제 만기 Date로 환산
export function resolveDueDateForMonth(raw: string | null | undefined, mon: string): Date | null {
  if (!raw) return null
  if (raw.includes('-')) {
    const [fy, fm, fd] = raw.split('-').map(Number)
    if ([fy, fm, fd].some(isNaN)) return null
    return new Date(fy, fm - 1, fd, 23, 59, 59, 999)
  }
  const [y, m] = mon.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  let day: number
  if (raw.includes('말')) day = last
  else { day = parseInt(raw, 10); if (isNaN(day)) return null; day = Math.min(day, last) }
  return new Date(y, m - 1, day, 23, 59, 59, 999)
}

// 선납 모델: 퇴실예정일이 그 월 기간 시작 이전이면 그 기간을 안 쓰므로 청구 0.
// lib/prorate calcCheckoutProration 이 null 을 반환하는 영역(일할 저장값이 없는 케이스).
// 퇴실월 당월에만 적용 — 이후 월은 isAfterMoveOutMonth 로 제외.
// 계약을 보는 화면은 이 함수 대신 isCheckoutNoBillingMonthFor 를 쓴다(경계를 계약에서 스스로 푼다).
export function isCheckoutNoBillingMonth(
  expectedMoveOut: Date | string | null | undefined,
  mon: string,
  dueDate: Date | null,         // 그 월의 기간 시작(경계) 날짜
): boolean {
  if (!expectedMoveOut || !dueDate) return false
  if (monthOfDate(expectedMoveOut) !== mon) return false
  return new Date(expectedMoveOut).getTime() <= dueDate.getTime()
}

// 무청구 판정 + 일할 권위 — 그 달에 확정 정산액(checkoutProrated: 일할 또는 사용분+위약금)이 있으면
// 그 값이 청구 권위(billForLeaseMonth 우선순위 ①)이므로 무청구를 적용하지 않는다.
// 퇴실일 = 납부일 같은 날(경계일) 케이스에서 무청구 스킵이 정산액을 덮어 과납이 허수로 잡히던 문제 방지
// (중도퇴실 환불 통합, 운영자 승인 2026-07-20). 호출부는 기존 isCheckoutNoBillingMonth 대신 이걸 쓴다.
//
// 경계는 **기간 시작**(이용 기간 시작일 cycleDayOf, 임시 조정은 보지 않는다)이다(운영자 승인 2026-10-21 10번).
// '유예는 기한만 미루고 기간 경계는 옮기지 않는다'(lib/settlementPeriod) 원칙이 무청구 판정에도 같다. 종전에는 호출부가
// 임시 조정이 반영된 기한을 넘겨, 정산(기간 경계)과 무청구(미룬 기한)가 같은 퇴실을 다르게 셌다. 그래서 날짜 인자를 없애고
// 계약에서 스스로 푼다(호출부가 다른 날짜를 넘길 길 자체를 없앤다). 2026-10-21 운영 138계약 퇴실월 판정 변화 0건.
export function isCheckoutNoBillingMonthFor(
  l: Pick<BillingLeaseFields, 'checkoutProratedAmount' | 'checkoutProratedMonth' | 'moveInDate' | 'dueDay' | 'cycleDay'>,
  expectedMoveOut: Date | string | null | undefined,
  mon: string,
): boolean {
  if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return false
  // 입주달 첫 달 규칙이 발동하는 달은 무청구가 아니다 — "퇴실예정일이 납부일 이전이면 0원"은
  // 그 기간을 안 썼다는 뜻인데, 입주달은 앞 구간(입주일부터)을 실제로 쓴다(2026-09-07). 앞 구간은 기간 시작일로 잰다.
  const cycle = cycleDayOf(l)
  if (l.moveInDate && cycle && monthOfDate(l.moveInDate) === mon && firstMonthGap(l.moveInDate, cycle)) return false
  // 납부일만 옮긴 계약(기간 1일·납부일 6일)도 같다. 기한(6일)으로 가리면 12/3 퇴실이 3일 쓴 12월을 0원으로 만든다.
  return isCheckoutNoBillingMonth(expectedMoveOut, mon, resolveDueDateForMonth(cycle, mon))
}

/**
 * 입주달의 실효 만기(YYYY-MM-DD) — 첫 달 규칙이 발동하면 기한은 **입주일**이다
 * (운영자 승인 2026-09-07, 질문 2 = 가. 선납 모델 — 입주하는 날 첫 달 몫을 낸다).
 * 발동하지 않으면 null — 종전 만기(그 달 납부일)를 쓴다.
 */
//
// 납부일만 옮긴 계약(cycleDay 가 있고 납부일과 다름)은 첫 달 규칙이 안 돌아도 입주 첫 달 기한이 입주일이다
// (운영자 승인 2026-10-21 4번). 기간이 입주일에 시작하니 그 달 몫도 입주하는 날 낸다. 둘째 달부터가 납부일이다.
export function firstMonthDueYmd(
  l: Pick<BillingLeaseFields, 'moveInDate' | 'dueDay' | 'cycleDay'>,
  mon: string,
): string | null {
  if (!l.moveInDate || !l.dueDay) return null
  if (monthOfDate(l.moveInDate) !== mon) return null
  const cycle = cycleDayOf(l)
  if (!(cycle && firstMonthGap(l.moveInDate, cycle)) && !hasSplitCycle(l)) return null
  const d = new Date(l.moveInDate)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// ── 계약 누적 미납액 정본 ────────────────────────────────────────────
//
// 신고 2026-08-02 — 520호 김민정 미납액이 2,128,000 으로 떴다(실제 91,000).
// 원인은 화면이 그 달 청구액을 **record 의 합**으로 잡은 것이다. 청구액은 그 달 record 의
// **최댓값 하나**여야 한다(청구 락 규칙, prisma schema 의 isBillingAdjust 주석에 명문화).
//
// 한 달에 나눠 낸 사람은 record 가 늘고, 늘어난 만큼 청구가 곱해져 전원 미납으로 표시됐다.
//   516호 이동찬 7월  [청구 350,000 수납 100,000] + [청구 350,000 수납 250,000]
//     합 방식 700,000 − 350,000 = 350,000 (완납인데 미납)
//     정본     350,000 − 350,000 = 0
// 실측 11건 5,987,000원이 부풀려져 있었다.
//
// 합산 규칙이 화면 컴포넌트 안에 인라인으로 박혀 있어 테스트가 붙을 자리가 없었던 것이 뿌리다.
// 정본을 여기 두고 네 곳(TenantBody·AI 프롬프트·리포트 미수율·리포트 누적 미수)이 전부 이걸 부른다.
// 세 플래그는 **필수**다. 옵셔널로 두면 select 에서 빠뜨려도 컴파일이 통과하고, 그러면 보증금이
// 월세 record 로 취급돼 미납액이 정확히 보증금만큼 어긋난다. 실제로 그렇게 두 번 났다
// (2026-08-02 커밋이 형제 화면만 고치고 getTenantDetail 을 빠뜨려 완납 8명이 -5만원으로 떴다).
// 이 타입이 곧 감지망이다 — 안 실어 보내는 호출부는 tsc 에서 죽는다.
export type UnpaidRecord = {
  targetMonth: string
  expectedAmount: number
  actualAmount: number
  isDeposit: boolean | null
  isPrevOwner: boolean | null
  isBillingAdjust: boolean | null
}

/**
 * 계약 누적 미납액 = Σ월 [ 그 달 청구 최댓값 − 그 달 수납 합 ] + (보증금 청구 − 보증금 수납).
 *
 * - 청구 조정 전표(isBillingAdjust)는 **청구 최댓값 계산에는 포함**하고(락이 그 값으로 서 있다)
 *   수납 합에서는 제외한다. 전표는 수납이 아니라 청구 락 마커다.
 * - 양도인 귀속(isPrevOwner)은 현 소유주 장부가 아니라 통째로 제외한다(dashboard/unpaid.ts 와 같은 규칙).
 * - 보증금은 월 청구와 축이 달라 따로 더한다.
 * - 선납·과납으로 음수가 나올 수 있다. 호출부가 표시 규칙을 정한다(형제 화면은 0 초과일 때만 노출).
 */
export function unpaidForLease(records: UnpaidRecord[]): number {
  const byMonth = new Map<string, { billed: number; paid: number }>()
  let depositBilled = 0
  let depositPaid = 0
  for (const r of records) {
    if (r.isDeposit) { depositBilled += r.expectedAmount; depositPaid += r.actualAmount; continue }
    if (r.isPrevOwner) continue
    const cur = byMonth.get(r.targetMonth) ?? { billed: 0, paid: 0 }
    if (r.expectedAmount > cur.billed) cur.billed = r.expectedAmount
    if (!r.isBillingAdjust) cur.paid += r.actualAmount
    byMonth.set(r.targetMonth, cur)
  }
  let sum = depositBilled - depositPaid
  for (const v of byMonth.values()) sum += v.billed - v.paid
  return sum
}

/** 같은 규칙의 청구 합계 — 미수율 분모용. 전표·양도인 제외, 보증금 포함. */
export function billedForLease(records: UnpaidRecord[]): number {
  const byMonth = new Map<string, number>()
  let deposit = 0
  for (const r of records) {
    if (r.isDeposit) { deposit += r.expectedAmount; continue }
    if (r.isPrevOwner) continue
    const cur = byMonth.get(r.targetMonth) ?? 0
    if (r.expectedAmount > cur) byMonth.set(r.targetMonth, r.expectedAmount)
    else byMonth.set(r.targetMonth, cur)
  }
  let sum = deposit
  for (const v of byMonth.values()) sum += v
  return sum
}
