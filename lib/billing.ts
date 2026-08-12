// 월별 청구액 단일 규칙 — 순수함수(부수효과 없음).
// 읽기 3곳(rooms getRoomPaymentStatus · dashboard page.tsx · dashboard/unpaid.ts)과
// 쓰기 경로(rooms savePayment 등)가 전부 이 헬퍼를 쓴다. 우선순위:
//   ① 퇴실 일할 정산(checkoutProratedMonth === 그 달) — 저장된 일할액 최우선
//   ② 락인된 record.expectedAmount(그 달 최대) — 월세 변경의 과거 소급 방지
//   ③ 현재 월세(할인 반영) fallback — record 없는 달
// 여기 규칙을 바꾸면 세 화면·푸시·수납 등록이 한 번에 같이 바뀐다.
import { RentDiscountInput, discountedRent } from './rentDiscount'
import { kstYmdStr } from './kstDate'

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
function effectiveBaseRent(l: BillingLeaseFields, mon: string): number {
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
  return effectiveBaseRent({ rentAmount: room.baseRent, status: 'ACTIVE', room }, mon)
}

export function billForLeaseMonth(
  l: BillingLeaseFields,
  mon: string,                  // 'YYYY-MM'
  locked?: number | null,       // 그 달 record들의 최대 expectedAmount (없으면 null)
): number {
  if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return l.checkoutProratedAmount
  if (locked && locked > 0) return locked
  // 단기 입주월 단일 청구 — 일할·락인은 위에서 이미 존중(record 있는 달의 과거 결산 불변),
  // record 없는 달의 fallback만 차단해 월 경계를 넘는 단기의 이중 청구를 막는다.
  if (l.isShortTerm && l.moveInDate) {
    const inMonth = monthOfDate(l.moveInDate)
    if (inMonth && mon !== inMonth) return 0
  }
  return discountedRent(l.discounts, mon, effectiveBaseRent(l, mon))
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

// 선납 모델: 퇴실예정일이 그 월 납부일(서비스 기간 시작) 이전이면 그 기간을 안 쓰므로 청구 0.
// lib/prorate calcCheckoutProration 이 null 을 반환하는 영역(일할 저장값이 없는 케이스).
// 퇴실월 당월에만 적용 — 이후 월은 isAfterMoveOutMonth 로 제외.
export function isCheckoutNoBillingMonth(
  expectedMoveOut: Date | string | null | undefined,
  mon: string,
  dueDate: Date | null,         // 그 월의 실제 만기(override 반영은 호출부 책임)
): boolean {
  if (!expectedMoveOut || !dueDate) return false
  if (monthOfDate(expectedMoveOut) !== mon) return false
  return new Date(expectedMoveOut).getTime() <= dueDate.getTime()
}

// 무청구 판정 + 일할 권위 — 그 달에 확정 정산액(checkoutProrated: 일할 또는 사용분+위약금)이 있으면
// 그 값이 청구 권위(billForLeaseMonth 우선순위 ①)이므로 무청구를 적용하지 않는다.
// 퇴실일 = 납부일 같은 날(경계일) 케이스에서 무청구 스킵이 정산액을 덮어 과납이 허수로 잡히던 문제 방지
// (중도퇴실 환불 통합, 운영자 승인 2026-07-20). 호출부는 기존 isCheckoutNoBillingMonth 대신 이걸 쓴다.
export function isCheckoutNoBillingMonthFor(
  l: Pick<BillingLeaseFields, 'checkoutProratedAmount' | 'checkoutProratedMonth'>,
  expectedMoveOut: Date | string | null | undefined,
  mon: string,
  dueDate: Date | null,
): boolean {
  if (l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon) return false
  return isCheckoutNoBillingMonth(expectedMoveOut, mon, dueDate)
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
