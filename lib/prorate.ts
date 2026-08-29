// 납입일 변경 일할 계산 — 한 달은 항상 30일로 고정 (실제 월 길이와 무관)
// 고객관리(TenantClient)·수납관리(RoomsClient) 공용.
export const PRORATE_BASE_DAYS = 30
import { settlementPeriodFor } from './settlementPeriod'

export type ProRataResult =
  | { days: 0; amount: 0; type: 'none' }
  | { days: number; amount: number; type: 'extra' | 'refund' }

export function calcProRata(
  rentAmount: number,
  oldDueDay: string | null,
  newDueDayStr: string,
  targetMonth: string,
): ProRataResult | null {
  const str = newDueDayStr.trim()
  if (!str) return null
  const [y, m] = targetMonth.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const parseDay = (d: string): number | null => {
    if (d.includes('말')) return daysInMonth
    const n = parseInt(d, 10)
    if (isNaN(n) || n < 1 || n > 31) return null
    return Math.min(n, daysInMonth)
  }
  const oldDay = oldDueDay ? parseDay(oldDueDay) : null
  const newDay = parseDay(str)
  if (oldDay === null || newDay === null) return null
  const diff = newDay - oldDay
  if (diff === 0) return { days: 0, amount: 0, type: 'none' }
  const amount = Math.floor((Math.abs(diff) * rentAmount) / PRORATE_BASE_DAYS)
  return { days: Math.abs(diff), amount, type: diff > 0 ? 'extra' : 'refund' }
}

// ── 퇴실 정산(일할) ──────────────────────────────────────────────────
// 선납 모델: 그 서비스 기간의 시작일부터 퇴실일까지(양끝 포함) 사용 일수만큼만 청구한다.
// 예) 납부일 8일, 퇴실 6/26 → 6/8~6/26 = 19일치 = 월 × 19/30.
//
// 2026-08-02 정산 기간 기반으로 교체. 종전에는 기간을 **퇴실월 안에서만** 잡아, 납부일 20일인 사람이
// 9월 3일에 나가면 실제 기간(8/20~9/19)을 못 보고 9/20 부터로 잡아 통째로 어긋났다.
// 이제 lib/settlementPeriod 의 settlementPeriodFor 가 기간·귀속월·사용 일수를 전부 정한다.
// moveOutMonth 는 이름을 유지하되 의미가 **정산 귀속월**(기간 시작이 속한 달)로 바뀌었다 —
// 호출부가 이 값을 checkoutProratedMonth 에 저장하므로 이름을 바꾸면 접점이 넓어져 유지한다.
// null 은 여전히 '정산할 기간이 없다'는 뜻이나, 발동 조건이 '퇴실일 < 그 달 납부일'에서
// '퇴실일 < 기간 시작(입주일 보정 포함)'으로 바뀌었다. 후자는 잘못된 입력일 때만 참이다.
export type CheckoutProrationResult = {
  daysUsed: number       // 청구 일수 (퇴실일 - 납부일 + 1, 양끝 포함, 1~30 클램프)
  amount: number         // 일할 청구액 = floor(monthlyRent × daysUsed / 30)
  fullAmount: number     // 일할 전 한 달 청구액
  reduction: number      // 감액 = fullAmount - amount
  moveOutMonth: string   // 'YYYY-MM' — **정산 귀속월**(기간 시작이 속한 달). 퇴실월과 다를 수 있다
  startYmd: string       // 기간 시작일 — 화면 안내 문구용
  mustLeaveYmd: string   // 퇴실해야 하는 날(다음 기간 시작 −1일)
}

export function calcCheckoutProration(
  monthlyRent: number,
  dueDay: string | null,
  expectedMoveOut: string,   // 'YYYY-MM-DD'
  moveInYmd?: string | null, // 'YYYY-MM-DD' — 입주 달 보정(기간 시작은 입주일보다 앞설 수 없다)
): CheckoutProrationResult | null {
  if (!monthlyRent || monthlyRent <= 0) return null
  // 기간·귀속월·사용 일수는 전부 정본이 정한다. 여기서 날짜 산술을 다시 하지 않는다 —
  // 손으로 다시 짠 계산이 말일·짧은 달·연말 경계에서 갈리는 것이 이 코드베이스의 반복된 사고다.
  const period = settlementPeriodFor({ dueDay, moveInDate: moveInYmd ?? null }, expectedMoveOut)
  if (!period) return null
  const amount = Math.floor((monthlyRent * period.daysUsed) / PRORATE_BASE_DAYS)
  return {
    daysUsed: period.daysUsed,
    amount,
    fullAmount: monthlyRent,
    reduction: monthlyRent - amount,
    moveOutMonth: period.month,
    startYmd: period.startYmd,
    mustLeaveYmd: period.mustLeaveYmd,
  }
}


// 고객관리에서 퇴실 예정일을 입력했을 때 '퇴실 정산?' 팝업을 띄울지 판정.
// 조건: ① 일할이 실제로 의미 있음(부분 기간 — daysUsed<30, 감액>0) ② 근접 — 퇴실일이 '오늘 + 1달'(달력 기준) 이내.
//   ②는 고정 31일이 아니라 달력상 한 달: 입력일 6/2면 7/2까지(6월=30일), 5/2면 6/2까지(5월=31일).
//   달의 실제 길이에 맞춰 '한 달'이 되게 한다(사용자 기준 2026-06-10).
// 선납·완납 후 일찍 나가는(환불) 경우도, 미납 상태로 늦게 정산하는 경우도 모두 ①②로 잡힌다.
// 정산 자체를 자동 적용하진 않음 — 팝업으로 물어보기만.
export function shouldOfferCheckoutProration(
  monthlyRent: number,
  dueDay: string | null,
  expectedMoveOut: string,   // 'YYYY-MM-DD'
  todayYmd: string,          // 'YYYY-MM-DD' (KST 오늘)
  moveInYmd?: string | null, // 입주 달 퇴실 보정(위와 동일)
  isShortTerm?: boolean,     // 단기는 기간 요금 — 일할 정산 대상이 아니다
): boolean {
  // 단기 차단 — 정산 엔진의 단기 일할 차단(B페이즈 정책)과 같은 선. 엔진만 막고 제안 팝업이
  // 물으면 화면이 정책과 모순되는 제안을 한다(402호 황인정 단기 실사례, 운영자 신고 2026-08-13).
  if (isShortTerm) return false
  const calc = calcCheckoutProration(monthlyRent, dueDay, expectedMoveOut, moveInYmd)
  if (!calc || calc.reduction <= 0 || calc.daysUsed >= PRORATE_BASE_DAYS) return false
  return isMoveOutNear(expectedMoveOut, todayYmd)
}

// 퇴실일이 '오늘+1달' 이내인가(과거 포함 — 늦은 정산 케이스). 달력 기준, 일 클램프.
// 정산 팝업(shouldOfferCheckoutProration)과 자동적용 안내 문구가 같은 기준을 공유하는 정본 —
// 두 달 뒤 퇴실 저장에도 환불·추가납부 금액 안내가 즉시 뜨던 문제(신고 0df59b92)의 단일 게이트.
export function isMoveOutNear(expectedMoveOut: string, todayYmd: string): boolean {
  const tp = todayYmd.split('-').map(Number)
  if (tp.length !== 3 || tp.some(n => isNaN(n))) return false
  const [ty, tm, td] = tp
  const y2 = tm === 12 ? ty + 1 : ty
  const m2 = tm === 12 ? 1 : tm + 1            // 1-based 다음 달
  const lastDay = new Date(y2, m2, 0).getDate() // m2 의 말일
  const limit = new Date(y2, m2 - 1, Math.min(td, lastDay))
  const mo = new Date(expectedMoveOut + 'T00:00:00')
  if (isNaN(mo.getTime())) return false
  return mo.getTime() <= limit.getTime()
}

// ── 퇴실 환불 계산 (공정거래위원회 기준 + 모드 선택) ───────────────────────
// 환불액 = 총 결제금액 − 사용분(1일요금 × 실제 이용일수) − 위약금. 1일요금 = 월 이용료 ÷ 30.
//  · legal(법정/공정위): 위약금 = 총 결제금액 × 위약금율. 원칙(납부일에 총액 납부 후 정산)대로 처리.
//  · goodwill(선의/일할): 위약금 0 — 사용분만 청구하고 나머지를 환불(기존 봐주기 동작).
// companyKeeps(퇴실월 회사 귀속 = 적용 금액) = 사용분 + 위약금. refund = max(0, 선납액 − companyKeeps).
// 위약금율은 공정위 기준 10%가 상한 캡 — 그 이하로만 조정 가능(영업장 기본값 설정 + 퇴실 시 사람별 입력,
// 운영자 결정 2026-07-20). 계산식 자체(총 결제금액 기준)는 고정.
export type RefundMode = 'legal' | 'goodwill'
export const LEGAL_PENALTY_PCT = 10

// 위약금율 정규화 — 0~10 정수 클램프(상한 = 공정위 10%). null·비수치는 상한값.
export function clampPenaltyPct(pct: number | null | undefined): number {
  if (pct == null || !Number.isFinite(pct)) return LEGAL_PENALTY_PCT
  return Math.min(LEGAL_PENALTY_PCT, Math.max(0, Math.round(pct)))
}
export type CheckoutRefundResult = {
  mode: RefundMode
  penaltyPct: number        // 적용 위약금율(0~10) — goodwill은 항상 0
  daysUsed: number          // 사용일수 (납부일~퇴실일, 양끝 포함)
  dailyRate: number         // 1일요금 = 월 이용료 ÷ 30
  usedAmount: number        // 사용분 = daysUsed × dailyRate
  penalty: number           // legal: 선납액 × 위약금율, goodwill: 0
  companyKeeps: number      // 사용분 + 위약금 (= 퇴실월 적용 금액)
  refund: number            // max(0, 선납액 − companyKeeps)
}
export function calcCheckoutRefund(input: {
  prepaidAmount: number      // 총 결제금액 (그 기간에 낸 금액)
  monthlyRent: number        // 월 이용료 (1일요금 = ÷30)
  daysUsed: number           // 실제 이용일수
  mode: RefundMode
  penaltyPct?: number | null // 위약금율(%) — 미지정 시 공정위 상한 10. 0~10 클램프, goodwill이면 무시
}): CheckoutRefundResult {
  const { prepaidAmount, monthlyRent, daysUsed, mode } = input
  const pct = mode === 'legal' ? clampPenaltyPct(input.penaltyPct) : 0
  const dailyRate = Math.round(monthlyRent / PRORATE_BASE_DAYS)   // 표시용 1일요금
  // 사용분은 일할 청구(calcCheckoutProration.amount)와 동일하게 floor → '적용 금액'이 매출과 일치
  const usedAmount = Math.floor((monthlyRent * Math.max(0, daysUsed)) / PRORATE_BASE_DAYS)
  // **위약금은 잔여 이용금액의 %다. 총 결제금액이 아니다.**
  //
  // 소비자분쟁해결기준(공정거래위원회 고시, 고시원운영업)이 개시일 전후를 가른다.
  //   · 개시일 이전 해지 — 총 이용요금의 10%. 서비스를 하나도 안 썼으므로 공실 리스크가 기준이다.
  //   · 개시일 이후 해지 — 「총 이용금액 − 일할계산 이용료 − **잔여이용금액의 10%**」.
  //     이미 제공한 몫은 사용분으로 받았으니, 위약금은 아직 제공하지 않은 기간에만 건다.
  //
  // 종전에는 총 결제금액의 %였다. 오래 살수록 격차가 커졌다 — 20일 살고 나가면 기준(14,000)의
  // 세 배(42,000)를 뗐다. 게다가 계약서 §2 가 "소비자분쟁해결기준을 적용합니다"라고 스스로
  // 약정한 상태였으므로, 종이와 계산이 서로 다른 말을 하고 있었다(2026-08-29 확인).
  //
  // 이 함수는 개시일 **이후** 해지만 다룬다. 개시일 이전(입주 전 취소)은 정산할 기간이 없어
  // calcCheckoutProration 이 애초에 null 을 내고 이 경로에 오지 않는다.
  const remaining = Math.max(0, Math.max(0, prepaidAmount) - usedAmount)
  const penalty = pct > 0 ? Math.round((remaining * pct) / 100) : 0
  const companyKeeps = usedAmount + penalty
  const refund = Math.max(0, prepaidAmount - companyKeeps)
  return { mode, penaltyPct: pct, daysUsed, dailyRate, usedAmount, penalty, companyKeeps, refund }
}

// ── 단기 입실 요금 시뮬레이션 (2026-07-05, 운영자 요청) ─────────────────────
// 입실일~퇴실일 총 요금을 회차(입주일 기준 월 단위) + 마지막 부분 기간 일할로 분해.
// 선납 모델과 동일 규칙: 각 회차 = [시작일, 다음 달 같은 날 - 1] (말일 클램프),
// 마지막 부분 기간은 양끝 포함 일수 × 월세/30 (calcCheckoutProration 과 같은 수학) —
// 등록 없이 견적만 내도 실제 정산과 금액이 일치한다.
export type StayQuoteItem = {
  start: string; end: string       // 'YYYY-MM-DD' (양끝 포함)
  days: number | null              // 부분 기간 일수 (전액 회차는 null)
  amount: number
  full: boolean                    // true = 한 달 전액 회차
}
export type StayQuote = {
  items: StayQuoteItem[]
  total: number
  fullMonths: number               // 전액 회차 수
  partialDays: number              // 마지막 부분 기간 일수 (없으면 0)
}

const ymdToUtc = (s: string): Date | null => {
  const p = s.split('-').map(Number)
  if (p.length !== 3 || p.some(isNaN)) return null
  return new Date(Date.UTC(p[0], p[1] - 1, p[2]))
}
const utcToYmd = (d: Date): string => d.toISOString().slice(0, 10)
const addMonthsClamped = (d: Date, n: number): Date => {
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate()
  const last = new Date(Date.UTC(y, m + n + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m + n, Math.min(day, last)))
}
const addDays = (d: Date, n: number): Date => new Date(d.getTime() + n * 86400000)

export function calcStayQuote(monthlyRent: number, moveInYmd: string, moveOutYmd: string): StayQuote | null {
  if (!monthlyRent || monthlyRent <= 0) return null
  const start = ymdToUtc(moveInYmd)
  const end = ymdToUtc(moveOutYmd)
  if (!start || !end || end.getTime() < start.getTime()) return null

  const items: StayQuoteItem[] = []
  let cursor = start
  let fullMonths = 0
  let partialDays = 0
  // 안전 상한 36회차(3년) — 단기 시뮬 용도라 충분
  for (let i = 0; i < 36; i++) {
    const nextStart = addMonthsClamped(start, fullMonths + 1)
    const cycleEnd = addDays(nextStart, -1)
    if (end.getTime() >= cycleEnd.getTime()) {
      items.push({ start: utcToYmd(cursor), end: utcToYmd(cycleEnd), days: null, amount: monthlyRent, full: true })
      fullMonths++
      cursor = nextStart
      if (end.getTime() === cycleEnd.getTime()) break   // 회차 마지막 날 퇴실 = 딱 떨어짐
    } else {
      // 마지막 부분 기간 — 양끝 포함, 30일 기준(일할과 동일)
      const days = Math.max(1, Math.min(Math.round((end.getTime() - cursor.getTime()) / 86400000) + 1, PRORATE_BASE_DAYS))
      const amount = Math.floor((monthlyRent * days) / PRORATE_BASE_DAYS)
      items.push({ start: utcToYmd(cursor), end: utcToYmd(end), days, amount, full: false })
      partialDays = days
      break
    }
  }
  const total = items.reduce((s, it) => s + it.amount, 0)
  return { items, total, fullMonths, partialDays }
}
