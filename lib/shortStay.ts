// 단기 입실 정책 (2026-07-06, 운영자 기준) — 영업장별 템플릿.
// 제기역점 기준(기본 시드): 최소 1주 · 주 단위 계약(일할 아님) · 1달 이내는 계약일수 × 1.5 청구
// (1주 = 10일치, 2주 = 21일치, 3주부터는 1개월 요금 상한) + 청소비 2만원.
// 다른 영업장은 설정에서 수치만 바꾸면 시뮬레이션·정산 안내가 그대로 따라간다(§4 — 기준 변경은 운영자 승인).
// 순수함수 — scripts/test-money.ts 가 케이스를 고정한다.

import { PRORATE_BASE_DAYS } from './prorate'

// 단기 예약금을 어떻게 쓰는가 — 'refundableDeposit'(퇴실 시 환불하는 보증금, 현행)
// | 'applyToRent'(청소비를 먼저 떼고 남은 몫을 이용료 선납으로 충당).
// 계약(LeaseTerm.reservationDepositMode)의 개별 선택이 이보다 앞선다.
export type ShortStayReservationMode = 'applyToRent' | 'refundableDeposit'

export type ShortStayPolicy = {
  enabled: boolean
  unitDays: number        // 계약 단위 일수 (7 = 주 단위 계약)
  minUnits: number        // 최소 계약 단위 수 (1 = 최소 1주)
  thresholdDays: number   // 이 거주일수 이하일 때 정책 적용 (30 = 1달 이내)
  multiplier: number      // 청구 배율 (1.5 = 계약일수의 1.5배 일수만큼 청구)
  cleaningFee: number     // 단기 청소비 (원)
  roundTo: number         // 기본요금 절삭 단위 (1000 = 천원 단위 반올림, 1 = 절삭 없음)
  // 단기 보증금 (원) — 요금이 아니라 별도 예치금이고 퇴실 시 환불한다 (운영자 요청 2026-07-09).
  // 예약 때 받는 예약금과는 다른 돈이다. 예약금의 쓰임은 아래 reservationMode 가 정한다.
  deposit: number
  // 단기 계약의 예약금 처리 — null = 미설정. 미설정이면 영업장 공통 기본값
  // (Property.reservationDepositMode)을 그대로 따른다(현행 해석 그대로).
  reservationMode: ShortStayReservationMode | null
}

// 신규 영업장 기본값 — 정책 미사용. 제기역점 값은 시드로 저장돼 있음.
export const SHORT_STAY_DEFAULTS: ShortStayPolicy = {
  enabled: false, unitDays: 7, minUnits: 1, thresholdDays: 30, multiplier: 1.5, cleaningFee: 20000, roundTo: 1000, deposit: 0,
  reservationMode: null,
}

// DB Json 값 → 정책 (필드 누락·이상값은 기본값으로 방어)
export function parseShortStayPolicy(raw: unknown): ShortStayPolicy {
  const d = SHORT_STAY_DEFAULTS
  if (!raw || typeof raw !== 'object') return d
  const o = raw as Record<string, unknown>
  const num = (v: unknown, def: number, min: number, max: number) => {
    const n = typeof v === 'number' ? v : NaN
    return Number.isFinite(n) && n >= min && n <= max ? n : def
  }
  // 예약금 처리는 허용 두 값만 통과 — 그 밖의 값(옛 저장분·오타)은 미설정으로 떨어져 현행 해석을 쓴다.
  const resvMode = o.reservationMode
  return {
    enabled: o.enabled === true,
    unitDays: Math.round(num(o.unitDays, d.unitDays, 1, 31)),
    minUnits: Math.round(num(o.minUnits, d.minUnits, 1, 10)),
    thresholdDays: Math.round(num(o.thresholdDays, d.thresholdDays, 1, 90)),
    multiplier: num(o.multiplier, d.multiplier, 1, 5),
    cleaningFee: Math.round(num(o.cleaningFee, d.cleaningFee, 0, 10_000_000)),
    roundTo: Math.round(num(o.roundTo, d.roundTo, 1, 100_000)),
    deposit: Math.round(num(o.deposit, d.deposit, 0, 100_000_000)),
    reservationMode: resvMode === 'applyToRent' || resvMode === 'refundableDeposit' ? resvMode : d.reservationMode,
  }
}

export type ShortStayQuote = {
  stayDays: number       // 요청 거주일수 (입실~퇴실, 양끝 포함)
  units: number          // 계약 단위 수 (올림, 최소 minUnits)
  contractDays: number   // 계약일수 = units × unitDays
  billedDays: number     // 청구 일수 = floor(계약일수 × 배율), 1개월(30일) 상한
  baseAmount: number     // 월세 × 청구일수 / 30 을 roundTo 단위로 반올림 (운영자 기준: 천원 단위)
  cleaningFee: number
  total: number          // baseAmount + cleaningFee (보증금 미포함 — 환불성이라 요금이 아님)
  deposit: number        // 별도 보증금 (퇴실 시 환불)
  cappedAtMonth: boolean // 배율 적용 결과가 1개월을 넘어 상한에 걸림 (3주부터)
  roundedUp: boolean     // 요청 기간이 계약 단위·최소 계약으로 올림됨 (예: 10일 요청 → 2주 계약)
}

const dayOf = (ymd: string): number | null => {
  const p = ymd.split('-').map(Number)
  if (p.length !== 3 || p.some(isNaN)) return null
  return Date.UTC(p[0], p[1] - 1, p[2]) / 86400000
}

/** 거주일수(양끝 포함). 날짜가 유효하지 않거나 역순이면 null. */
export function stayDaysOf(moveInYmd: string, moveOutYmd: string): number | null {
  const a = dayOf(moveInYmd), b = dayOf(moveOutYmd)
  if (a == null || b == null || b < a) return null
  return b - a + 1
}

/**
 * 달력 기준 1개월 이내 판정 — 퇴실일이 (입주일 + 1개월[말일 클램프] − 1일) 이내면 참.
 * 31일 달을 걸친 정확히 1달력월(예: 8/21~9/20, 7/1~7/31)은 일수가 31이어도 "한 달"이다
 * (신고 f9803357, 운영자 정의 2026-07-30). 회차식(lib/prorate addMonthsClamped)과 동일 규칙 —
 * 1/31 입주는 다음 회차가 2/28(클램프)이라 한 달 상한이 2/27이 된다.
 */
export function isWithinOneCalendarMonth(moveInYmd: string, moveOutYmd: string): boolean {
  const a = dayOf(moveInYmd), b = dayOf(moveOutYmd)
  if (a == null || b == null || b < a) return false
  const [y, m, d] = moveInYmd.split('-').map(Number)
  const lastOfNextMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()   // 다음 달 말일
  const nextCycleStart = Date.UTC(y, m, Math.min(d, lastOfNextMonth)) / 86400000
  return b <= nextCycleStart - 1
}

/**
 * 단기 정책 요금. 정책 비활성이거나 거주일수가 적용 상한을 넘으면 null —
 * 그 경우 호출부는 기존 월 단위 견적(calcStayQuote)을 쓴다.
 */
export function calcShortStay(
  policy: ShortStayPolicy, monthlyRent: number, stayDays: number,
  // 날짜쌍이 있으면 달력 기준 1개월 이내를 일수 상한과 함께 인정 — 31일 달 걸침이 "한 달 초과"로 거부되지 않게(신고 f9803357).
  dates?: { moveInYmd: string; moveOutYmd: string },
): ShortStayQuote | null {
  if (!policy.enabled) return null
  if (!monthlyRent || monthlyRent <= 0) return null
  if (!Number.isFinite(stayDays) || stayDays < 1) return null
  const withinCalendarMonth = dates ? isWithinOneCalendarMonth(dates.moveInYmd, dates.moveOutYmd) : false
  if (stayDays > policy.thresholdDays && !withinCalendarMonth) return null

  const rawUnits = Math.ceil(stayDays / policy.unitDays)
  const units = Math.max(policy.minUnits, rawUnits)
  const contractDays = units * policy.unitDays
  // 청구일수 내림 제거(2026-07-26 운영자 결정) — floor 를 계약일수에 한 번만 적용하면 첫 주(10.5→10)만 깎여
  // 둘째 주 추가금이 첫 주보다 비싸지는 역전이 생겼다. 소수 청구일(10.5·21·31.5)을 그대로 두면 주당 균등해 역전이 없다.
  const rawBilled = contractDays * policy.multiplier
  const billedDays = Math.min(rawBilled, PRORATE_BASE_DAYS)
  // 원단위 절삭 — 일할 원값을 roundTo(기본 1,000원) 단위로 반올림 (운영자 기준 2026-07-06)
  const roundTo = Math.max(1, policy.roundTo)
  const baseAmount = Math.round(Math.floor((monthlyRent * billedDays) / PRORATE_BASE_DAYS) / roundTo) * roundTo
  return {
    stayDays, units, contractDays, billedDays, baseAmount,
    cleaningFee: policy.cleaningFee,
    total: baseAmount + policy.cleaningFee,
    deposit: policy.deposit,
    cappedAtMonth: rawBilled > PRORATE_BASE_DAYS,
    roundedUp: stayDays < contractDays,
  }
}

/**
 * 계약서에 찍는 단기 요금표 한 줄 — 그 방 월세로 계산한 실제 금액이다.
 *
 * 왜 문장이 아니라 숫자인가. 조항이 "단기 입실 요금표를 적용합니다"라고만 하면 그 표가 어디
 * 있는지 종이에 없다. 받는 사람이 얼마인지 모르는 조항은 설명한 것이 아니고, 나중에 그 금액을
 * 들이댈 때 근거가 서지 않는다. 방마다 월세가 다르므로 계약서를 뽑는 순간 그 계약의 방으로 찍는다.
 *
 * 상한에 걸리는 주에서 멈추고 '이상'으로 묶는다. 3주(31.5일)부터는 1개월 요금과 같아서
 * 4주·5주를 따로 적으면 같은 금액이 줄만 늘어난다.
 */
export function shortStayRateTable(policy: ShortStayPolicy, monthlyRent: number): string | null {
  if (!policy.enabled || !monthlyRent || monthlyRent <= 0) return null
  const won = (n: number) => `${n.toLocaleString('ko-KR')}원`
  const rows: string[] = []
  // 6주면 42일이라 어떤 정책에서도 한 달을 넘는다 — 무한 루프 방지용 상한이지 뜻이 있는 수가 아니다.
  for (let u = Math.max(1, policy.minUnits); u <= 6; u++) {
    const q = calcShortStay(policy, monthlyRent, u * policy.unitDays)
    if (!q) break
    if (q.cappedAtMonth) { rows.push(`${u}주 이상 ${won(q.baseAmount)}`); break }
    rows.push(`${u}주 ${won(q.baseAmount)}`)
  }
  return rows.length > 0 ? rows.join(' · ') : null
}
