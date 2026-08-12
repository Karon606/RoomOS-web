// §4 금전 로직 회귀 테스트 — 실행: npx tsx scripts/test-money.ts
// 일할·환불·단기 견적·할인 순수함수의 계산 결과를 고정한다.
// 이 파일의 기대값은 "현재 검증된 동작"의 스냅샷: 수정 후 여기가 깨지면
// ① 의도한 규칙 변경인지 운영자 확인 → 기대값 갱신, ② 아니면 회귀이므로 코드 수정.
// 근거 케이스: 신고 6334bac4(입주 달 퇴실 일할), 공정위 환불 규칙, calcStayQuote 도입(2026-07-05).

import { unpaidForLease, billedForLease, type UnpaidRecord } from '@/lib/billing'
import { fmtManShort, fmtOfferRentAhead, fmtRentApplyFrom } from '../lib/fmtMoney'
import {
  PRORATE_BASE_DAYS,
  calcProRata,
  calcCheckoutProration,
  shouldOfferCheckoutProration,
  calcCheckoutRefund,
  calcStayQuote,
} from '../lib/prorate'
import { discountForMonth, discountedRent } from '../lib/rentDiscount'
import { calcShortStay, parseShortStayPolicy, stayDaysOf, isWithinOneCalendarMonth, SHORT_STAY_DEFAULTS } from '../lib/shortStay'
import { billForLeaseMonth, offerRentChangeAfterMonth, offerRentForMonth } from '../lib/billing'
import { availableFromLabel, availableFromText } from '../lib/leaseStatus'
import { wishRoomFromLabel } from '../lib/wishMatch'
import { lockOf, shortStayLockTarget, lockAdjustKind, lockRewritesFor, shortStayBasisChanged, negotiatedRecalcNotice } from '../lib/shortStayLock'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const RENT = 300000

// ── calcCheckoutProration ── 선납 모델: dueDay~퇴실일 양끝 포함, 30일 기준 floor
{
  // 신고 6334bac4: 납부일 1일 계약이 6/20 입주 → 6/27 퇴실. 입주 달 퇴실은 시작일을 입주일로 올림 → 8일치.
  const r = calcCheckoutProration(RENT, '1', '2026-06-27', '2026-06-20')
  eq('일할: 입주 달 퇴실(신고 6334bac4)', r, {
    daysUsed: 8, amount: 80000, fullAmount: RENT, reduction: 220000, moveOutMonth: '2026-06',
    startYmd: '2026-06-20', mustLeaveYmd: '2026-06-30',
  })
  // 입주 달이 아니면 보정 없음 — 납부일부터
  eq('일할: 입주가 전 달이면 기존 동작(27일)', calcCheckoutProration(RENT, '1', '2026-06-27', '2026-05-20')?.daysUsed, 27)
  // 입주일이 납부일보다 앞이면 보정 없음
  eq('일할: 입주일<납부일이면 납부일 시작(19일)', calcCheckoutProration(RENT, '8', '2026-06-26', '2026-06-05')?.daysUsed, 19)
  // 문서화된 기본 예: 납부일 8일, 6/26 퇴실 → 8~26 = 19일
  eq('일할: 기본(8일 납부, 6/26 퇴실)', calcCheckoutProration(RENT, '8', '2026-06-26'), {
    daysUsed: 19, amount: 190000, fullAmount: RENT, reduction: 110000, moveOutMonth: '2026-06',
    startYmd: '2026-06-08', mustLeaveYmd: '2026-07-07',
  })
  // 퇴실일 < 납부일 → 그 달 기간 미사용 = 청구 없음
  // 2026-08-02 의미 변경. 종전에는 '퇴실일 < 그 달 납부일'이면 null 이었으나, 그건 기간을 퇴실월
  // 안에서만 봤기 때문이다. 납부일 15일에 6/10 퇴실이면 실제로는 5월 기간(5/15~6/14) 안이고
  // 26일을 쓴 것이다. 정산 귀속월은 2026-05.
  {
    const r = calcCheckoutProration(RENT, '15', '2026-06-10')
    eq('일할: 퇴실일이 그 달 납부일 이전이면 전월 기간', r?.moveOutMonth, '2026-05')
    eq('일할: 그 경우 기간 시작은 전월 납부일', r?.startYmd, '2026-05-15')
    eq('일할: 그 경우 사용 일수', r?.daysUsed, 27)   // 5/15~6/10
  }
  // null 은 이제 '정산할 기간이 없다' — 퇴실일이 기간 시작보다 앞선 잘못된 입력일 때만
  eq('일할: 퇴실일 < 입주일이면 null', calcCheckoutProration(RENT, '1', '2026-05-10', '2026-05-20'), null)
  eq('일할: 납부일 없으면 null', calcCheckoutProration(RENT, null, '2026-06-10'), null)
  // '말' 납부 + 말일 퇴실 = 1일치
  eq("일할: '말' 납부, 6/30 퇴실 = 1일", calcCheckoutProration(RENT, '말', '2026-06-30')?.daysUsed, 1)
  // 31일 달의 1일 납부 → 31일 사용이라도 30일 클램프 = 전액
  const clamp = calcCheckoutProration(RENT, '1', '2026-01-31')
  eq('일할: 31일 사용은 30일 클램프(전액)', [clamp?.daysUsed, clamp?.amount, clamp?.reduction], [30, RENT, 0])
  // 유효하지 않은 입력
  eq('일할: 월세 0 → null', calcCheckoutProration(0, '1', '2026-06-27'), null)
  eq('일할: 날짜 파싱 실패 → null', calcCheckoutProration(RENT, '1', '2026-06'), null)
}

// ── calcProRata ── 납입일 변경: |새-옛| 일수 × 월세/30, floor
{
  eq('납입일변경: 10→20 = 10일 추가청구', calcProRata(RENT, '10', '20', '2026-06'), { days: 10, amount: 100000, type: 'extra' })
  eq('납입일변경: 15→5 = 10일 환급', calcProRata(RENT, '15', '5', '2026-06'), { days: 10, amount: 100000, type: 'refund' })
  eq("납입일변경: 30→'말'(6월) = 변동 없음", calcProRata(RENT, '30', '말', '2026-06'), { days: 0, amount: 0, type: 'none' })
  eq('납입일변경: 6월의 31 은 30 으로 클램프', calcProRata(RENT, '30', '31', '2026-06'), { days: 0, amount: 0, type: 'none' })
  eq('납입일변경: 빈 입력 → null', calcProRata(RENT, '10', ' ', '2026-06'), null)
}

// ── shouldOfferCheckoutProration ── 팝업 판정: 감액 있음 + 오늘+1달(달력) 이내
{
  eq('팝업: 근접 부분 기간 → true', shouldOfferCheckoutProration(RENT, '1', '2026-06-20', '2026-06-10'), true)
  eq('팝업: 3달 뒤 퇴실 → false', shouldOfferCheckoutProration(RENT, '1', '2026-09-20', '2026-06-10'), false)
  eq('팝업: 전액 회차(감액 0) → false', shouldOfferCheckoutProration(RENT, '1', '2026-01-31', '2026-01-10'), false)
  // 달력 한 달 경계: 6/2 기준 상한 7/2 (6월=30일이어도 고정 31일이 아니라 달력 기준)
  eq('팝업: 경계 7/2 → true', shouldOfferCheckoutProration(RENT, '1', '2026-07-02', '2026-06-02'), true)
  eq('팝업: 경계 밖 7/3 → false', shouldOfferCheckoutProration(RENT, '1', '2026-07-03', '2026-06-02'), false)
  // 입주 달 보정이 판정에도 전파(신고 케이스에서 팝업이 떠야 함)
  eq('팝업: 입주 달 퇴실 보정 전파 → true', shouldOfferCheckoutProration(RENT, '1', '2026-06-27', '2026-06-20', '2026-06-20'), true)
}

// ── calcCheckoutRefund ── 환불 = 선납 − 사용분 − 위약금(법정 0~10% 조정, 상한 캡 | 선의 0)
// 위약금율 조정 가능(공정위 10% 캡)은 운영자 결정 2026-07-20 — 기대값 변경 승인분.
{
  eq('환불(법정): 30만 선납, 10일 사용', calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'legal' }), {
    mode: 'legal', penaltyPct: 10, daysUsed: 10, dailyRate: 10000, usedAmount: 100000, penalty: 30000, companyKeeps: 130000, refund: 170000,
  })
  eq('환불(선의): 위약금 0', calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'goodwill' }).refund, 200000)
  eq('환불: 음수 방지(선납 < 사용분)', calcCheckoutRefund({ prepaidAmount: 50000, monthlyRent: RENT, daysUsed: 10, mode: 'goodwill' }).refund, 0)
  // 사용분 계산이 일할 청구(calcCheckoutProration.amount)와 항상 일치 — 매출-환불 정합
  const pro = calcCheckoutProration(RENT, '1', '2026-06-10')
  const ref = calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: pro!.daysUsed, mode: 'legal' })
  eq('환불: 사용분 = 일할 청구액 (정합)', ref.usedAmount, pro!.amount)
  // 위약금율 조정 — 5%면 절반, 0%면 선의와 동일, 10 초과·음수·비수치는 캡으로 클램프
  eq('환불: 위약금 5%', calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'legal', penaltyPct: 5 }).penalty, 15000)
  eq('환불: 위약금 0% = 선의와 동일', calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'legal', penaltyPct: 0 }).refund, 200000)
  eq('환불: 15%는 10%로 캡', calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'legal', penaltyPct: 15 }).penalty, 30000)
  eq('환불: 음수·비수치는 상한값', [
    calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'legal', penaltyPct: -3 }).penalty,
    calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'legal', penaltyPct: NaN }).penalty,
  ], [0, 30000])
  // 선의 모드는 penaltyPct를 무시(항상 0)
  eq('환불: 선의는 위약금율 무시', calcCheckoutRefund({ prepaidAmount: RENT, monthlyRent: RENT, daysUsed: 10, mode: 'goodwill', penaltyPct: 10 }).penalty, 0)
}

// ── calcStayQuote ── 회차(입주일 기준 월 단위, 말일 클램프) + 마지막 부분 일할
{
  // 정확히 1달: 6/20 ~ 7/19
  eq('견적: 정확히 1달', calcStayQuote(RENT, '2026-06-20', '2026-07-19'), {
    items: [{ start: '2026-06-20', end: '2026-07-19', days: null, amount: RENT, full: true }],
    total: RENT, fullMonths: 1, partialDays: 0,
  })
  // 1달 + 6일: 6/20 ~ 7/25
  eq('견적: 1달 + 부분 6일', calcStayQuote(RENT, '2026-06-20', '2026-07-25'), {
    items: [
      { start: '2026-06-20', end: '2026-07-19', days: null, amount: RENT, full: true },
      { start: '2026-07-20', end: '2026-07-25', days: 6, amount: 60000, full: false },
    ],
    total: 360000, fullMonths: 1, partialDays: 6,
  })
  // 순수 단기 8일 — 일할(입주 달 퇴실)과 금액 일치해야 견적=정산
  const q = calcStayQuote(RENT, '2026-06-20', '2026-06-27')
  const p = calcCheckoutProration(RENT, '1', '2026-06-27', '2026-06-20')
  eq('견적: 단기 8일 금액 = 일할 금액 (정합)', [q?.total, q?.partialDays], [p!.amount, p!.daysUsed])
  // 당일 퇴실 = 1일
  eq('견적: 당일 1일', calcStayQuote(RENT, '2026-06-20', '2026-06-20')?.total, Math.floor(RENT / PRORATE_BASE_DAYS))
  // 말일 클램프: 1/31 시작 → 다음 회차 시작 2/28(2026 비윤년), 첫 회차는 1/31~2/27
  eq('견적: 1/31 시작 말일 클램프(1달)', calcStayQuote(RENT, '2026-01-31', '2026-02-27'), {
    items: [{ start: '2026-01-31', end: '2026-02-27', days: null, amount: RENT, full: true }],
    total: RENT, fullMonths: 1, partialDays: 0,
  })
  // 2달 정확: 6/20 ~ 8/19
  eq('견적: 2달 전액', calcStayQuote(RENT, '2026-06-20', '2026-08-19')?.fullMonths, 2)
  // 역순 입력 → null
  eq('견적: 퇴실<입실 → null', calcStayQuote(RENT, '2026-06-20', '2026-06-19'), null)
}

// ── discountForMonth / discountedRent ── 계약서=정가 유지, 수납에서만 할인
{
  const base = RENT
  eq('할인: 상시 5만', discountedRent([{ discountType: 'amount', value: 50000, scope: 'permanent' }], '2026-06', base), 250000)
  eq('할인: 10% 반올림', discountForMonth([{ discountType: 'percent', value: 10, scope: 'permanent' }], '2026-06', base), 30000)
  eq('할인: 기간 내 적용', discountedRent([{ discountType: 'amount', value: 50000, scope: 'temporary', startMonth: '2026-06', endMonth: '2026-08' }], '2026-07', base), 250000)
  eq('할인: 기간 밖 미적용', discountedRent([{ discountType: 'amount', value: 50000, scope: 'temporary', startMonth: '2026-06', endMonth: '2026-08' }], '2026-09', base), base)
  eq('할인: 시작만 있으면 무기한', discountedRent([{ discountType: 'amount', value: 50000, scope: 'temporary', startMonth: '2026-06', endMonth: null }], '2027-01', base), 250000)
  // 크리티컬 신고 50a2a69b 불변식 — 예약 표시액은 입주월 기준 할인 반영(Jihan 케이스: 44만·2만 할인·입주 8월)
  const jihanDc = [{ discountType: 'amount', value: 20000, scope: 'temporary', startMonth: '2026-08', endMonth: '2026-10' }]
  eq('예약 표시: 입주월(8월) 할인 반영 42만', discountedRent(jihanDc, '2026-08', 440000), 420000)
  eq('예약 표시: 할인 종료 후(11월) 정상가 복귀', discountedRent(jihanDc, '2026-11', 440000), 440000)
  // 락 우선순위 문서화 — 락인된 달은 할인 fallback 을 이긴다(그래서 할인 변경 시 락 되쓰기가 필요)
  eq('청구: 락인은 할인 fallback 보다 우선', billForLeaseMonth({ rentAmount: 440000, status: 'ACTIVE', isShortTerm: false, discounts: jihanDc }, '2026-08', 440000), 440000)
  eq('청구: 락 되쓰기 후 할인가 반영', billForLeaseMonth({ rentAmount: 440000, status: 'ACTIVE', isShortTerm: false, discounts: jihanDc }, '2026-08', 420000), 420000)
  eq('청구: 락 없으면 할인 fallback', billForLeaseMonth({ rentAmount: 440000, status: 'ACTIVE', isShortTerm: false, discounts: jihanDc }, '2026-08', null), 420000)
  eq('할인: 합산 캡(음수 청구 방지)', discountedRent([
    { discountType: 'amount', value: 200000, scope: 'permanent' },
    { discountType: 'amount', value: 200000, scope: 'permanent' },
  ], '2026-06', base), 0)
  eq('할인: percent 반올림 경계(33% of 335,000)', discountForMonth([{ discountType: 'percent', value: 33, scope: 'permanent' }], '2026-06', 335000), 110550)
}

// ── calcShortStay ── 단기 입실 정책(제기역점 기준: 주 단위 × 1.5, 1개월 상한, 청소비 2만)
{
  const P = { ...SHORT_STAY_DEFAULTS, enabled: true }   // 기본값 = 제기역점 수치
  // 1주 = 계약 7일 × 1.5 = 10.5일치(내림 제거 2026-07-26 — 첫 주만 깎여 역전되던 문제 해소) + 청소비
  eq('단기: 1주', calcShortStay(P, RENT, 7), {
    stayDays: 7, units: 1, contractDays: 7, billedDays: 10.5, baseAmount: 105000,
    cleaningFee: 20000, total: 125000, deposit: 0, cappedAtMonth: false, roundedUp: false,   // deposit: 단기 보증금(환불성) 추가 2026-07-09
  })
  // 2주 = 21일치 ("3주 비용")
  eq('단기: 2주 = 3주분', [calcShortStay(P, RENT, 14)?.billedDays, calcShortStay(P, RENT, 14)?.total], [21, 230000])
  // 3주 = 31.5일 → 1개월 상한 ("이미 1개월 비용 초과라 의미 없음")
  const w3 = calcShortStay(P, RENT, 21)
  eq('단기: 3주 = 1개월 상한', [w3?.billedDays, w3?.total, w3?.cappedAtMonth], [30, 320000, true])
  // 10일 요청 → 주 단위 계약이므로 2주로 올림 (일할 아님)
  const d10 = calcShortStay(P, RENT, 10)
  eq('단기: 10일 → 2주 계약 올림', [d10?.units, d10?.contractDays, d10?.billedDays, d10?.roundedUp], [2, 14, 21, true])
  // 3일 요청 → 최소 1주
  const d3 = calcShortStay(P, RENT, 3)
  eq('단기: 3일 → 최소 1주', [d3?.contractDays, d3?.billedDays, d3?.roundedUp], [7, 10.5, true])
  // 달력 기준 개정(운영자 승인 2026-07-30, 신고 f9803357) — 31일 달을 걸친 정확히 1달력월은 "한 달"로 인정.
  // 날짜쌍 없이 일수만 넘기는 호출은 종전대로 30일 상한(합성 일수 프리뷰 등).
  eq('단기: 31일 + 날짜 없음 → null (일수 상한 유지)', calcShortStay(P, RENT, 31), null)
  const m0701 = calcShortStay(P, RENT, 31, { moveInYmd: '2026-07-01', moveOutYmd: '2026-07-31' })
  eq('단기: 7/1~7/31(31일, 달력 1개월) → 인정·월세 상한', [m0701 != null, m0701?.billedDays, m0701?.total], [true, 30, 320000])
  const m0821 = calcShortStay(P, RENT, stayDaysOf('2026-08-21', '2026-09-20') ?? 0, { moveInYmd: '2026-08-21', moveOutYmd: '2026-09-20' })
  eq('단기: 8/21~9/20(31일 걸침, 랑스에듀 케이스) → 인정', m0821 != null, true)
  eq('단기: 8/21~9/21(1개월+1일) → null', calcShortStay(P, RENT, 32, { moveInYmd: '2026-08-21', moveOutYmd: '2026-09-21' }), null)
  // 달력 1개월 판정 경계 — 30일 달·2월·말일 클램프(1/31 입주는 다음 회차 2/28이라 상한 2/27)
  eq('달력월: 2/1~2/28 인정', isWithinOneCalendarMonth('2026-02-01', '2026-02-28'), true)
  eq('달력월: 4/1~4/30 인정', isWithinOneCalendarMonth('2026-04-01', '2026-04-30'), true)
  eq('달력월: 4/1~5/1 초과', isWithinOneCalendarMonth('2026-04-01', '2026-05-01'), false)
  eq('달력월: 1/31~2/27 인정(클램프)', isWithinOneCalendarMonth('2026-01-31', '2026-02-27'), true)
  eq('달력월: 1/31~2/28 초과', isWithinOneCalendarMonth('2026-01-31', '2026-02-28'), false)
  eq('달력월: 7/29~8/28 인정', isWithinOneCalendarMonth('2026-07-29', '2026-08-28'), true)
  eq('달력월: 7/29~8/29 초과', isWithinOneCalendarMonth('2026-07-29', '2026-08-29'), false)
  // 비활성 → null
  eq('단기: 비활성 → null', calcShortStay(SHORT_STAY_DEFAULTS, RENT, 7), null)
  // 날짜 → 일수 (양끝 포함)
  eq('단기: 6/20~6/26 = 7일', stayDaysOf('2026-06-20', '2026-06-26'), 7)
  eq('단기: 역순 → null', stayDaysOf('2026-06-20', '2026-06-19'), null)
  // 원단위 절삭 — 천원 기준 반올림 (월세 55만 1주 = 183,333 → 183,000 / 32.5만 2주 = 227,500 → 228,000)
  eq('단기: 천원 반올림(내림 방향)', calcShortStay(P, 550000, 7)?.baseAmount, 193000)
  eq('단기: 천원 반올림(올림 방향)', calcShortStay(P, 325000, 14)?.baseAmount, 228000)
  eq('단기: 절삭 없음(roundTo 1)', calcShortStay({ ...P, roundTo: 1 }, 550000, 7)?.baseAmount, 192500)
  // JSON 방어 파싱 — 이상값은 기본값으로
  eq('단기: 정책 파싱 방어', parseShortStayPolicy({ enabled: true, multiplier: 99, cleaningFee: -5 }),
    { ...SHORT_STAY_DEFAULTS, enabled: true })
}

// ── billForLeaseMonth 단기 입주월 단일 청구 ── (운영자 승인 2026-07-20)
// 단기 rentAmount = 체류 전체 사용료. 월 루프가 입주월 밖에서 fallback을 물면 이중 청구.
// 락인·일할은 규칙보다 우선(기존 record 있는 달의 과거 결산 불변).
{
  const shortLease = { rentAmount: 329000, status: 'ACTIVE', isShortTerm: true, moveInDate: '2026-07-20' }
  eq('청구: 단기 입주월 = 전액', billForLeaseMonth(shortLease, '2026-07', null), 329000)
  eq('청구: 단기 비입주월 record 없음 = 0', billForLeaseMonth(shortLease, '2026-08', null), 0)
  eq('청구: 단기 비입주월 락인은 유지(결산 불변)', billForLeaseMonth(shortLease, '2026-08', 157000), 157000)
  eq('청구: 단기 일할 정산은 규칙보다 우선', billForLeaseMonth(
    { ...shortLease, checkoutProratedAmount: 50000, checkoutProratedMonth: '2026-08' }, '2026-08', null), 50000)
  eq('청구: 단기인데 입주일 없으면 기존 동작(방어)', billForLeaseMonth(
    { rentAmount: 329000, status: 'ACTIVE', isShortTerm: true, moveInDate: null }, '2026-08', null), 329000)
  eq('청구: 장기는 규칙 미적용(회귀 0)', billForLeaseMonth(
    { rentAmount: 470000, status: 'ACTIVE', moveInDate: '2026-07-20' }, '2026-08', null), 470000)
}

// ── 단기 연장 누적 재계산 — 경로 독립 (운영자 승인 2026-07-20)
// 추가 납부 = calcShortStay(전체 기간).baseAmount - 기존 rentAmount. 텔레스코핑이라
// 1주씩 여러 번 연장해도, 한 번에 연장해도 같은 퇴실일이면 총액이 같아야 한다.
// I8'(회계 확정 2026-07-26): 경로 독립은 정책가 경로에서만 성립한다. 마지막 저장이 manual(협의가)이면
// 그 금액이 새 기준선이 되고, 원인 사실이 바뀔 때까지 재계산하지 않는다(아래 게이트 케이스).
{
  const P = { ...SHORT_STAY_DEFAULTS, enabled: true }
  const R = 470000   // 김민정 520호 실측 기준
  const w1 = calcShortStay(P, R, 7)!.baseAmount    // 1주
  const w2 = calcShortStay(P, R, 14)!.baseAmount   // 2주
  const w3 = calcShortStay(P, R, 21)!.baseAmount   // 3주(1개월 상한)
  // 내림 제거(2026-07-26): 1주 = 10.5일치 = 164,500 → 천원 반올림 165,000. 2주·3주는 정수 일수라 불변.
  eq('연장: 김민정 1주/2주/3주 사용료', [w1, w2, w3], [165000, 329000, 470000])
  eq('연장: 1주→2주 차액', w2 - w1, 164000)
  eq('연장: 2주→3주 차액', w3 - w2, 141000)
  eq('연장: 경로 독립(1주씩 두 번 = 한 번에 3주)', (w2 - w1) + (w3 - w2), w3 - w1)
  eq('연장: 30일 초과는 정책 밖(월 전환)', calcShortStay(P, R, 31), null)
}

// ── 단기 청구 락 조정(연장·감액) — 운영자 확정 2026-07-26
// 락은 '그 달 최대 expectedAmount'라 마커를 얹기만 해서는 내려가지 않는다.
// 감액은 되쓰기(lockRewrites)까지 해야 내려가고, 적용취소는 그 원값으로 정확히 복원된다.
// 아래 시뮬레이터는 서버 syncShortStayCharge / undoShortStayExtension 과 같은 순서·같은 순수함수를 쓴다.
{
  const P = { ...SHORT_STAY_DEFAULTS, enabled: true }
  const R = 470000   // 김민정 520호 실측 기준(방 표준가)

  type Rec = { id: string; expectedAmount: number; actualAmount: number; deleted?: boolean }
  type Snap = { markerId: string; lockRewrites: { recordId: string; prevExpectedAmount: number }[] } | null
  const active = (recs: Rec[]) => recs.filter(r => !r.deleted)
  const paidSumOf = (recs: Rec[]) => active(recs).reduce((s, r) => s + r.actualAmount, 0)
  const lockNow = (recs: Rec[]) => lockOf(active(recs))

  // 서버 syncShortStayCharge 순서: 목표 산출 → 마커 생성 → (감액이면) 큰 락 되쓰기 + 원값 스냅샷
  const applyAdjust = (recs: Rec[], targetRent: number): { kind: 'increase' | 'decrease' | null; newTarget: number; snap: Snap } => {
    const newTarget = shortStayLockTarget(targetRent, paidSumOf(recs))
    const kind = lockAdjustKind(newTarget, lockNow(recs))
    if (!kind) return { kind, newTarget, snap: null }
    const marker: Rec = { id: `m${recs.length + 1}`, expectedAmount: newTarget, actualAmount: 0 }
    recs.push(marker)
    const lockRewrites = kind === 'decrease' ? lockRewritesFor(active(recs), newTarget) : []
    for (const w of lockRewrites) recs.find(r => r.id === w.recordId)!.expectedAmount = newTarget
    return { kind, newTarget, snap: { markerId: marker.id, lockRewrites } }
  }
  // 서버 undoShortStayExtension: 마커 소프트삭제 + lockRewrites 원값 복원
  const undoAdjust = (recs: Rec[], snap: Snap) => {
    if (!snap) return
    recs.find(r => r.id === snap.markerId)!.deleted = true
    for (const w of snap.lockRewrites) recs.find(r => r.id === w.recordId)!.expectedAmount = w.prevExpectedAmount
  }

  const w1 = calcShortStay(P, R, 7)!.baseAmount    // 1주 165,000 (입주 7/26 ~ 8/1)
  const w2 = calcShortStay(P, R, 8)!.baseAmount    // 8일 → 2주 계약 329,000 (~ 8/2)
  const w3 = calcShortStay(P, R, 15)!.baseAmount   // 15일 → 3주 계약, 1개월 상한 470,000 (~ 8/9)
  eq('락: 기준 견적(1주/8일/15일)', [w1, w2, w3], [165000, 329000, 470000])

  // ① 1주 → 8/9 연장 → 8/2 단축: 최종 락 329,000 (감액 자동 처리 — 잔액 -313,000 재발 방지)
  {
    const recs: Rec[] = [{ id: 'r1', expectedAmount: w1, actualAmount: 0 }]
    const up = applyAdjust(recs, w3)
    eq('락①: 연장은 increase', [up.kind, lockNow(recs)], ['increase', 470000])
    const down = applyAdjust(recs, w2)
    eq('락①: 단축은 decrease, 최종 락 329,000', [down.kind, lockNow(recs)], ['decrease', 329000])

    // ③ ①의 단축 적용취소 → 락 470,000 복원
    undoAdjust(recs, down.snap)
    eq('락③: 감액 적용취소 후 락 470,000', lockNow(recs), 470000)
  }

  // ② 납부 400,000이 있으면 단축해도 받은 금액에서 멈춘다(잔액 0·완납). 차액은 환불 영역.
  {
    const recs: Rec[] = [{ id: 'r1', expectedAmount: w1, actualAmount: 400000 }]
    applyAdjust(recs, w3)
    const down = applyAdjust(recs, w2)
    eq('락②: 납부 400,000이면 락도 400,000', [down.kind, down.newTarget, lockNow(recs)], ['decrease', 400000, 400000])
    eq('락②: 환불 안내 차액', 400000 - w2, 71000)
  }

  // ④ 경로 독립 — 1주씩 세 번 연장이나 한 번에 3주나 최종 락이 같다
  {
    const stepwise: Rec[] = [{ id: 'r1', expectedAmount: w1, actualAmount: 0 }]
    for (const t of [calcShortStay(P, R, 7)!.baseAmount, calcShortStay(P, R, 14)!.baseAmount, calcShortStay(P, R, 21)!.baseAmount]) applyAdjust(stepwise, t)
    const oneShot: Rec[] = [{ id: 'r1', expectedAmount: w1, actualAmount: 0 }]
    applyAdjust(oneShot, calcShortStay(P, R, 21)!.baseAmount)
    eq('락④: 경로 독립(1주씩 3회 = 3주 1회)', lockNow(stepwise), lockNow(oneShot))
    eq('락④: 최종 락 = 3주 누적가', lockNow(oneShot), 470000)
  }

  // 목표와 현 락이 같으면 조정하지 않는다(마커 남발 방지 — 이중 제출 가드와 별개의 1차 방어)
  eq('락: 변동 없으면 kind null', lockAdjustKind(shortStayLockTarget(329000, 0), 329000), null)

  // ⑤ 원인 게이트 — 협의가 350,000 계약(회계 확정 2026-07-26, I8')
  // 정책가는 1주 165,000 인데 운영자가 협의로 350,000 을 잡아 둔 계약. 연락처만 고친 저장에서
  // 정책가로 되돌아가면 근거 없는 매출 정정이다 — 원인 사실 넷이 그대로면 동기화 자체를 하지 않는다.
  {
    const NEGOTIATED = 350000
    const basis = { moveOutIso: '2026-08-01', rentAmount: NEGOTIATED, roomId: 'r520', moveInYmd: '2026-07-26' }
    const prevPolicy = calcShortStay(P, R, stayDaysOf(basis.moveInYmd, basis.moveOutIso)!)!.baseAmount   // 7일 = 1주
    eq('게이트: 협의가는 정책가(165,000)와 다르다', [prevPolicy, NEGOTIATED !== prevPolicy], [165000, true])

    // 1) 원인 무변경 저장(연락처만 수정) — 마커 0건, 락 350,000 유지
    {
      const recs: Rec[] = [{ id: 'r1', expectedAmount: NEGOTIATED, actualAmount: 0 }]
      const before = recs.length
      const changed = shortStayBasisChanged(basis, { ...basis })
      if (changed) applyAdjust(recs, prevPolicy)
      eq('게이트①: 원인 무변경이면 동기화 미실행', changed, false)
      eq('게이트①: 마커 record 0건', recs.length - before, 0)
      eq('게이트①: 락 350,000 유지', lockNow(recs), NEGOTIATED)
    }

    // 2) 퇴실일 1주 연장(8/1 → 8/8) — 원인 변경이라 정책 누적가로 재계산 + 협의가 재계산 고지
    {
      const next = { ...basis, moveOutIso: '2026-08-08' }
      const newPolicy = calcShortStay(P, R, stayDaysOf(next.moveInYmd, next.moveOutIso)!)!.baseAmount   // 14일 = 2주
      const recs: Rec[] = [{ id: 'r1', expectedAmount: NEGOTIATED, actualAmount: 0 }]
      const changed = shortStayBasisChanged(basis, next)
      const adj = changed ? applyAdjust(recs, newPolicy) : null
      eq('게이트②: 퇴실일 연장은 원인 변경', changed, true)
      eq('게이트②: 정책 누적가 329,000 으로 재계산', [adj?.newTarget, lockNow(recs)], [329000, 329000])
      const notice = negotiatedRecalcNotice(NEGOTIATED, prevPolicy, newPolicy)
      eq('게이트②: 협의가 재계산 고지 존재', [
        notice !== null,
        notice?.includes('기존 협의 이용료 350,000원') ?? false,
        notice?.includes('정책 누적가 329,000원') ?? false,
        notice?.includes('협의가를 유지하려면') ?? false,
      ], [true, true, true, true])
      // 협의가가 아니었으면(직전 이용료 = 직전 정책가) 고지 없음 — 오탐 방지
      eq('게이트②: 정책가 계약은 고지 없음', negotiatedRecalcNotice(prevPolicy, prevPolicy, newPolicy), null)
    }
  }
}

// ── 계약 누적 미납액 (신고 2026-08-02) ─────────────────────────────
// 520호 김민정 미납액이 2,128,000 으로 떴다(실제 91,000). 청구액을 그 달 record 의 합으로 잡은 탓이다.
// 이 계산이 화면 컴포넌트 안에 인라인으로 박혀 있어 테스트가 붙을 자리가 없었던 것이 뿌리다.
{
  const R = (targetMonth: string, expectedAmount: number, actualAmount: number, f: Partial<UnpaidRecord> = {}): UnpaidRecord =>
    ({ targetMonth, expectedAmount, actualAmount, ...f })

  // 한 달에 나눠 낸 경우 — 청구는 곱해지지 않는다. 실사례 516호 이동찬.
  eq('미납: 분할 수납 2건은 완납', unpaidForLease([
    R('2026-07', 350_000, 100_000),
    R('2026-07', 350_000, 250_000),
  ]), 0)
  eq('미납: 분할 수납 청구 합계', billedForLease([
    R('2026-07', 350_000, 100_000),
    R('2026-07', 350_000, 250_000),
  ]), 350_000)

  // 청구 조정 전표 — 청구 최댓값에는 포함, 수납 합에서는 제외. 실사례 520호 김민정.
  eq('미납: 전표 3장 + 분할 수납', unpaidForLease([
    R('2026-07', 157_000, 157_000),
    R('2026-07', 470_000, 0, { isBillingAdjust: true }),
    R('2026-07', 470_000, 0, { isBillingAdjust: true }),
    R('2026-07', 470_000, 0, { isBillingAdjust: true }),
    R('2026-07', 470_000, 172_000),
    R('2026-07', 470_000, 50_000),
    R('2026-07', 50_000, 50_000, { isDeposit: true }),
  ]), 91_000)

  // 보증금은 월 청구와 축이 달라 따로 더한다
  eq('미납: 보증금 미수', unpaidForLease([
    R('2026-07', 470_000, 470_000),
    R('2026-07', 50_000, 0, { isDeposit: true }),
  ]), 50_000)

  // 양도인 귀속분은 현 소유주 장부가 아니다
  eq('미납: 양도인 record 제외', unpaidForLease([
    R('2026-04', 470_000, 0, { isPrevOwner: true }),
    R('2026-05', 470_000, 470_000),
  ]), 0)

  // 여러 달 누적
  eq('미납: 두 달 누적', unpaidForLease([
    R('2026-06', 470_000, 470_000),
    R('2026-07', 470_000, 300_000),
    R('2026-08', 470_000, 0),
  ]), 640_000)

  // 선납은 음수로 나온다 — 표시 규칙은 호출부가 정한다
  eq('미납: 선납은 음수', unpaidForLease([R('2026-07', 470_000, 500_000)]), -30_000)
}

// ── fmtManShort ── 격자 타일 만 축약(§06). 표시 규칙이지만 여기 고정한다 —
// 반올림 방향이 흔들리면 타일이 실제보다 적은 돈을 말하게 된다.
{
  eq('만 축약: 정수 만',        fmtManShort(550_000),   '55만')
  eq('만 축약: 소수 한 자리',    fmtManShort(329_000),   '32.9만')
  eq('만 축약: 7.1만',          fmtManShort(71_000),    '7.1만')
  eq('만 축약: 트레일링 .0 제거', fmtManShort(1_570_000), '157만')
  eq('만 축약: 둘째 자리 반올림', fmtManShort(1_234_500), '123.5만')
  eq('만 축약: 만 단위 콤마',    fmtManShort(12_340_000), '1,234만')
  eq('만 축약: 1만 경계',        fmtManShort(10_000),    '1만')
  eq('만 축약: 1만 미만은 원',   fmtManShort(9_999),     '9,999원')
  eq('만 축약: 7천원',          fmtManShort(7_000),     '7,000원')
  eq('만 축약: 0원',            fmtManShort(0),         '0원')
  eq('만 축약: 음수는 U+2212',   fmtManShort(-329_000),  '−32.9만')
}

// ── offerRentForMonth ── 계약 없는 방의 제시가(홈 타일 입주 가능 블락·빈 타일 금액).
// 비교가 달 단위라는 것이 이 함수의 전부다. 날짜 비교로 흔들리면 화면이 말한 값과
// 그 사람이 실제로 내는 첫 달 청구가 갈린다(적용일 8/20 인 방이 8/16 에 비는 경우).
{
  const plain = { baseRent: 350_000, scheduledRent: null, rentUpdateDate: null }
  const raise = { baseRent: 350_000, scheduledRent: 380_000, rentUpdateDate: '2026-09-01' }
  eq('제시가: 예약 인상 없음',            offerRentForMonth(plain, '2026-08'), 350_000)
  eq('제시가: 적용월 전이면 현재가',       offerRentForMonth(raise, '2026-08'), 350_000)
  eq('제시가: 적용월이면 인상가',          offerRentForMonth(raise, '2026-09'), 380_000)
  eq('제시가: 적용월 이후도 인상가',       offerRentForMonth(raise, '2026-10'), 380_000)
  // 적용일이 달 중간이어도 그 달 이용료는 전부 인상가다 — 8/20 적용이면 8/16 에 비는 방도 인상가.
  eq('제시가: 달 중간 적용일도 그 달부터', offerRentForMonth({ ...raise, rentUpdateDate: '2026-08-20' }, '2026-08'), 380_000)
  // 적용일 없는 예약값(고아)은 청구 엔진과 같이 침묵한다 — 화면만 인상가를 말하면 청구와 갈린다.
  eq('제시가: 적용일 없는 예약값은 무시',  offerRentForMonth({ ...raise, rentUpdateDate: null }, '2026-09'), 350_000)
  eq('제시가: 예약값 0 은 무시',           offerRentForMonth({ ...raise, scheduledRent: 0 }, '2026-09'), 350_000)
}

// ── offerRentChangeAfterMonth ── 아직 제시가에 안 실린 예약 가격변경(홈 타일 꼬리 '9월 36만').
// 두 끝점을 모두 offerRentForMonth 로 구하므로 위 블록의 가드(0·음수·고아 적용일·파싱 실패)를
// 그대로 물려받는다. 여기서 잠그는 것은 '언제 발화하는가' 하나다.
// 오늘 실데이터에 예약 인상이 걸린 방은 0실이라, 이 블록이 유일한 감지망이다.
{
  const raise = { baseRent: 350_000, scheduledRent: 380_000, rentUpdateDate: '2026-09-01' }
  eq('예고: 예약 없으면 없음',        offerRentChangeAfterMonth({ baseRent: 350_000, scheduledRent: null, rentUpdateDate: null }, '2026-08'), null)
  eq('예고: 다음 달 인상',            offerRentChangeAfterMonth(raise, '2026-08'), { month: '2026-09', rent: 380_000 })
  eq('예고: 인하도 같은 규칙',        offerRentChangeAfterMonth({ ...raise, scheduledRent: 320_000 }, '2026-08'), { month: '2026-09', rent: 320_000 })
  // 이미 제시가에 실린 달에는 예고가 없다 — 타일이 세운 숫자가 곧 그 인상가다.
  eq('예고: 적용월 당월은 없음',       offerRentChangeAfterMonth(raise, '2026-09'), null)
  eq('예고: 적용월 이후도 없음',       offerRentChangeAfterMonth(raise, '2026-10'), null)
  // 적용 스케줄러가 아직 안 돌아 예약값이 남아 있어도, 지난 적용일은 예고가 아니다(제시가가 이미 인상가).
  eq('예고: 적용일 과거는 없음',       offerRentChangeAfterMonth({ ...raise, rentUpdateDate: '2026-07-01' }, '2026-08'), null)
  // 달 중간 적용일 — 8/20 적용은 8월분부터라 8월 화면엔 없고 7월 화면엔 있다. 위 제시가 블록의 짝이다.
  eq('예고: 달 중간 적용일 당월은 없음', offerRentChangeAfterMonth({ ...raise, rentUpdateDate: '2026-08-20' }, '2026-08'), null)
  eq('예고: 달 중간 적용일 전월은 예고', offerRentChangeAfterMonth({ ...raise, rentUpdateDate: '2026-08-20' }, '2026-07'), { month: '2026-08', rent: 380_000 })
  // 제시가가 안 움직이면 예고도 없다 — 손사본 예고가 가장 먼저 틀리는 네 자리.
  eq('예고: 적용일 없는 예약값은 없음', offerRentChangeAfterMonth({ ...raise, rentUpdateDate: null }, '2026-08'), null)
  eq('예고: 예약값 0 은 없음',         offerRentChangeAfterMonth({ ...raise, scheduledRent: 0 }, '2026-08'), null)
  eq('예고: 예약값 음수는 없음',       offerRentChangeAfterMonth({ ...raise, scheduledRent: -1 }, '2026-08'), null)
  eq('예고: 같은 값 예약은 없음',       offerRentChangeAfterMonth({ ...raise, scheduledRent: 350_000 }, '2026-08'), null)
  eq('예고: 잘못된 적용일은 없음',      offerRentChangeAfterMonth({ ...raise, rentUpdateDate: '2026-13-99' }, '2026-08'), null)
  // 먼 미래도 규칙은 같다 — 표기가 달을 인쇄하므로 '가까운 미래'로 좁힐 이유가 없다.
  // 좁히면 8월에 건 10월 인상이 9월 내내 침묵하고, 줄이 없는 것이 '변경 없음'이라는 거짓이 된다.
  eq('예고: 6개월 뒤도 예고',          offerRentChangeAfterMonth({ ...raise, rentUpdateDate: '2027-02-01' }, '2026-08'), { month: '2027-02', rent: 380_000 })
  // 8/31 경계(Work_log 2026-08-12(7) 범위 밖 항목) — 입주 가능일이 8/31 이면 기준월은 8월이라
  // 제시가는 8월가로 남고(선납 모델), 9/1 인상은 예고로 붙는다. 숫자를 옮기지 않고 예고만 더한다.
  eq('예고: 8/31 입주 가능 + 9/1 인상', offerRentChangeAfterMonth(raise, '2026-08-31'.slice(0, 7)), { month: '2026-09', rent: 380_000 })
  eq('예고: 그 자리 제시가는 8월가',    offerRentForMonth(raise, '2026-08-31'.slice(0, 7)), 350_000)
}

// ── fmtOfferRentAhead ── 예고 꼬리 문자열. 타일 날짜 문법(M/D)과 갈라지는 지점이라 문자열째 잠근다.
{
  eq('예고 라벨: 앞 0 제거',      fmtOfferRentAhead('2026-09', 360_000),  '9월 36만')
  eq('예고 라벨: 두 자리 달',     fmtOfferRentAhead('2026-12', 360_000),  '12월 36만')
  eq('예고 라벨: 소수 만',        fmtOfferRentAhead('2026-09', 329_000),  '9월 32.9만')
  eq('예고 라벨: 인하도 같은 꼴',  fmtOfferRentAhead('2026-09', 320_000),  '9월 32만')
  // '부터'를 쓰지 않는다 — 그 조사는 입주 가능일(availableFromLabel)이 이미 상태 축에서 쓰고 있다.
  eq('예고 라벨: 부터 미사용',    fmtOfferRentAhead('2026-09', 360_000).includes('부터'), false)
  // 슬래시가 없어야 타일의 날짜 문법("8/30부터")과 읽기 전에 갈린다.
  eq('예고 라벨: 슬래시 없음',    fmtOfferRentAhead('2026-09', 360_000).includes('/'), false)
}

// ── fmtRentApplyFrom ── 호실 상세·호실 카드의 인상 표기. 엔진이 달 단위라 화면도 달로 말해야 한다.
// 종전 "(2026-09-20 적용)" 은 적용일이 9/20 이어도 9월분 전액이 인상가인 엔진과 어긋났다(2026-08-12).
{
  eq('인상 표기: 같은 해',        fmtRentApplyFrom('2026-09', '2026-08'), '9월분부터')
  eq('인상 표기: 두 자리 달',      fmtRentApplyFrom('2026-12', '2026-08'), '12월분부터')
  // 해가 넘어가면 4자리 연도를 붙인다 — 안 붙이면 지나간 1월로 읽힌다.
  eq('인상 표기: 해 넘김',        fmtRentApplyFrom('2027-01', '2026-12'), '2027년 1월분부터')
  eq('인상 표기: 같은 해면 무접두', fmtRentApplyFrom('2027-03', '2027-01'), '3월분부터')
  // 날짜 문법(슬래시·일)과 섞이지 않아야 상태 날짜로 오독되지 않는다.
  eq('인상 표기: 슬래시 없음',     fmtRentApplyFrom('2026-09', '2026-08').includes('/'), false)
  // 그 달 하나가 아니라 그 달 이후 전부다 — '부터'를 떼면 과소 진술이 된다.
  eq('인상 표기: 부터 유지',       fmtRentApplyFrom('2026-09', '2026-08').endsWith('부터'), true)
  // 홈 타일은 폭 때문에 '분'·'부터'를 못 쓴다(lib/fmtMoney 주석의 실측). 두 문장이 섞이지 않게 잠근다.
  eq('인상 표기: 타일과 다른 문장', fmtRentApplyFrom('2026-09', '2026-08') === fmtOfferRentAhead('2026-09', 360_000), false)
}

// ── availableFromLabel ── 입주 가능 짧은 라벨. 홈 타일·호실 카드 칩·고객 상세가 같은 문자열을 쓴다.
{
  eq('입주 가능 라벨: 앞 0 제거',  availableFromLabel('2026-08-16'), '8/16부터')
  eq('입주 가능 라벨: 10월 1일',   availableFromLabel('2026-10-01'), '10/1부터')
  eq('입주 가능 라벨: 매칭과 동일', wishRoomFromLabel({ kind: 'soon', availableFrom: '2026-08-18' }), '8/18부터')
}

// ── availableFromText ── 폭이 넉넉한 자리(호실 상세 기본정보)의 긴 형태. 2026-08-12 에 '부터'를
// 붙여쓰기로 고쳤는데(§29) 잠금이 안 걸려 있어 여기 건다 — 띄어쓰기 하나가 형제 라벨과 갈리면
// 같은 사실이 화면마다 다르게 적힌다. 짧은 형제(availableFromLabel)와 같은 규칙임을 함께 고정한다.
{
  eq('입주 가능 문장: fmtDateDot + 부터', availableFromText({ kind: 'soon', availableFrom: '2026-08-30' }), '2026.08.30부터')
  eq('입주 가능 문장: 공백 없음',         availableFromText({ kind: 'soon', availableFrom: '2026-08-30' })!.includes(' '), false)
  eq('입주 가능 문장: 앞 0 유지',         availableFromText({ kind: 'soon', availableFrom: '2026-10-01' }), '2026.10.01부터')
  // 'now'(지금 공실)는 상태 줄이 이미 '공실'로 말하므로 문구를 안 준다. null 은 무기한 계약이라 모르는 값이다.
  eq('입주 가능 문장: 지금 공실은 null',  availableFromText({ kind: 'now' }), null)
  eq('입주 가능 문장: 판정 없음은 null',  availableFromText(null), null)
  // 두 형태가 같은 조사 규칙을 쓴다 — 한쪽만 고치면 여기서 걸린다.
  eq('입주 가능 문장: 짧은 형제와 같은 조사',
    availableFromText({ kind: 'soon', availableFrom: '2026-08-30' })!.endsWith('부터')
      && availableFromLabel('2026-08-30').endsWith('부터'), true)
}

console.log(`\n금전 로직 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
