// 단기 입실 정책 (2026-07-06, 운영자 기준) — 영업장별 템플릿.
// 제기역점 기준(기본 시드): 최소 1주 · 주 단위 계약(일할 아님) · 1달 이내는 계약일수 × 1.5 청구
// (1주 = 10일치, 2주 = 21일치, 3주부터는 1개월 요금 상한) + 청소비 2만원.
// 다른 영업장은 설정에서 수치만 바꾸면 시뮬레이션·정산 안내가 그대로 따라간다(§4 — 기준 변경은 운영자 승인).
// 순수함수 — scripts/test-money.ts 가 케이스를 고정한다.

import { PRORATE_BASE_DAYS } from './prorate'

export type ShortStayPolicy = {
  enabled: boolean
  unitDays: number        // 계약 단위 일수 (7 = 주 단위 계약)
  minUnits: number        // 최소 계약 단위 수 (1 = 최소 1주)
  thresholdDays: number   // 이 거주일수 이하일 때 정책 적용 (30 = 1달 이내)
  multiplier: number      // 청구 배율 (1.5 = 계약일수의 1.5배 일수만큼 청구)
  cleaningFee: number     // 단기 청소비 (원)
  roundTo: number         // 기본요금 절삭 단위 (1000 = 천원 단위 반올림, 1 = 절삭 없음)
  deposit: number         // 단기 보증금 (원) — 요금 아님, 퇴실 시 환불 (운영자 요청 2026-07-09)
}

// 신규 영업장 기본값 — 정책 미사용. 제기역점 값은 시드로 저장돼 있음.
export const SHORT_STAY_DEFAULTS: ShortStayPolicy = {
  enabled: false, unitDays: 7, minUnits: 1, thresholdDays: 30, multiplier: 1.5, cleaningFee: 20000, roundTo: 1000, deposit: 0,
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
  return {
    enabled: o.enabled === true,
    unitDays: Math.round(num(o.unitDays, d.unitDays, 1, 31)),
    minUnits: Math.round(num(o.minUnits, d.minUnits, 1, 10)),
    thresholdDays: Math.round(num(o.thresholdDays, d.thresholdDays, 1, 90)),
    multiplier: num(o.multiplier, d.multiplier, 1, 5),
    cleaningFee: Math.round(num(o.cleaningFee, d.cleaningFee, 0, 10_000_000)),
    roundTo: Math.round(num(o.roundTo, d.roundTo, 1, 100_000)),
    deposit: Math.round(num(o.deposit, d.deposit, 0, 100_000_000)),
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
 * 단기 정책 요금. 정책 비활성이거나 거주일수가 적용 상한을 넘으면 null —
 * 그 경우 호출부는 기존 월 단위 견적(calcStayQuote)을 쓴다.
 */
export function calcShortStay(policy: ShortStayPolicy, monthlyRent: number, stayDays: number): ShortStayQuote | null {
  if (!policy.enabled) return null
  if (!monthlyRent || monthlyRent <= 0) return null
  if (!Number.isFinite(stayDays) || stayDays < 1) return null
  if (stayDays > policy.thresholdDays) return null

  const rawUnits = Math.ceil(stayDays / policy.unitDays)
  const units = Math.max(policy.minUnits, rawUnits)
  const contractDays = units * policy.unitDays
  const rawBilled = Math.floor(contractDays * policy.multiplier)
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
