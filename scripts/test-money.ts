// §4 금전 로직 회귀 테스트 — 실행: npx tsx scripts/test-money.ts
// 일할·환불·단기 견적·할인 순수함수의 계산 결과를 고정한다.
// 이 파일의 기대값은 "현재 검증된 동작"의 스냅샷: 수정 후 여기가 깨지면
// ① 의도한 규칙 변경인지 운영자 확인 → 기대값 갱신, ② 아니면 회귀이므로 코드 수정.
// 근거 케이스: 신고 6334bac4(입주 달 퇴실 일할), 공정위 환불 규칙, calcStayQuote 도입(2026-07-05).

import {
  PRORATE_BASE_DAYS,
  calcProRata,
  calcCheckoutProration,
  shouldOfferCheckoutProration,
  calcCheckoutRefund,
  calcStayQuote,
} from '../lib/prorate'
import { discountForMonth, discountedRent } from '../lib/rentDiscount'
import { calcShortStay, parseShortStayPolicy, stayDaysOf, SHORT_STAY_DEFAULTS } from '../lib/shortStay'
import { billForLeaseMonth } from '../lib/billing'
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
  })
  // 입주 달이 아니면 보정 없음 — 납부일부터
  eq('일할: 입주가 전 달이면 기존 동작(27일)', calcCheckoutProration(RENT, '1', '2026-06-27', '2026-05-20')?.daysUsed, 27)
  // 입주일이 납부일보다 앞이면 보정 없음
  eq('일할: 입주일<납부일이면 납부일 시작(19일)', calcCheckoutProration(RENT, '8', '2026-06-26', '2026-06-05')?.daysUsed, 19)
  // 문서화된 기본 예: 납부일 8일, 6/26 퇴실 → 8~26 = 19일
  eq('일할: 기본(8일 납부, 6/26 퇴실)', calcCheckoutProration(RENT, '8', '2026-06-26'), {
    daysUsed: 19, amount: 190000, fullAmount: RENT, reduction: 110000, moveOutMonth: '2026-06',
  })
  // 퇴실일 < 납부일 → 그 달 기간 미사용 = 청구 없음
  eq('일할: 퇴실일이 납부일 이전이면 null', calcCheckoutProration(RENT, '15', '2026-06-10'), null)
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
  // 상한 초과(31일) → null = 기존 월 견적으로
  eq('단기: 31일은 정책 밖 → null', calcShortStay(P, RENT, 31), null)
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
  const shortLease = { rentAmount: 329000, isShortTerm: true, moveInDate: '2026-07-20' }
  eq('청구: 단기 입주월 = 전액', billForLeaseMonth(shortLease, '2026-07', null), 329000)
  eq('청구: 단기 비입주월 record 없음 = 0', billForLeaseMonth(shortLease, '2026-08', null), 0)
  eq('청구: 단기 비입주월 락인은 유지(결산 불변)', billForLeaseMonth(shortLease, '2026-08', 157000), 157000)
  eq('청구: 단기 일할 정산은 규칙보다 우선', billForLeaseMonth(
    { ...shortLease, checkoutProratedAmount: 50000, checkoutProratedMonth: '2026-08' }, '2026-08', null), 50000)
  eq('청구: 단기인데 입주일 없으면 기존 동작(방어)', billForLeaseMonth(
    { rentAmount: 329000, isShortTerm: true, moveInDate: null }, '2026-08', null), 329000)
  eq('청구: 장기는 규칙 미적용(회귀 0)', billForLeaseMonth(
    { rentAmount: 470000, moveInDate: '2026-07-20' }, '2026-08', null), 470000)
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

console.log(`\n금전 로직 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
