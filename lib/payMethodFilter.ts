// 수납 관리 '수납 방법' 필터의 판정·월 집계·행 보조줄 문장 정본(입금일 축, 이용료만)
//
// 왜 한 파일인가(신고 390345ad, 2026-11-02). 같은 물음 "이 달에 현금으로 얼마 받았나"를 세 자리가 묻는다.
// 서버의 월 집계(요약 줄), 서버가 행마다 내려 주는 그 달 입금 목록(행 거름·보조줄), 그리고 그물이다.
// 판정이 갈리면 요약 줄은 6건인데 목록은 5행인 날이 온다. 그래서 드는 행·축·달 판정을 여기 하나로 둔다.
//
// 판정의 뜻(운영자 승인 2026-11-02).
//   · 축은 입금일(payDate)이다. 위 '입금일 기준 카드 수납' 줄과 같은 축이라 두 줄이 나란히 읽힌다.
//   · 이용료만 센다. 보증금(isDeposit)은 돌려줄 돈이라 뺀다. 청소비(부가수익)는 이번 범위가 아니다.
//   · 양도인 몫(isPrevOwner)·청구 조정 전표·납입일 변경 조정 행은 받은 돈이 아니라 뺀다.
//   · 금액이 0 이하인 행은 뺀다(환불로 0 이 된 행 포함). 환불은 수납 금액을 줄이므로 합계도 그만큼 준다.
//   · 수단이 비어 있으면 '수단 미기록'이다. '보유 보증금'·'양도인 정산'처럼 사람이 고를 수 없는 표식은 어느 칸에도 안 든다.
//
// 카드 줄과의 관계. 카드 줄(paymentCardMonth)은 보증금을 **넣는다**(카드사 명세와 대사, 2026-08-24 운영자 확인).
// 이 칸들은 보증금을 뺀다. 그래서 카드 줄 = 신용카드 칸 + 결제선생 칸 + 카드로 받은 보증금이다.
// 한 정본 함수(aggregateMonthPayments)가 두 숫자를 한 번에 내므로 항등식이 구조로 선다(그물 test-pay-method-filter).
import { MANUAL_PAY_METHODS, CARD_LIKE_METHODS } from './paymentMethods'
import { paymentCardMonth, type PaymentAggregateRow } from './cashReceipt'
import { dbDateMonthKey } from './kstDate'
import { isDueDayAdjust } from './dueDayAdjust'
import { fmtWon } from './fmtMoney'
import { fmtMD } from './fmtDate'

/** 수단이 비어 있는 행의 칸 이름. select·행 보조줄·요약 줄이 같은 말을 쓴다(독립 디자이너 패스, 맨 '미기록'은 요약 줄에서 무엇이 미기록인지 안 읽힌다). */
export const PAY_METHOD_UNRECORDED = '수단 미기록'

/** 필터 select 의 선택지(전체 제외). 사람이 고르는 수단 + 수단 미기록. */
export const PAY_METHOD_FILTER_OPTIONS: readonly string[] = [...MANUAL_PAY_METHODS, PAY_METHOD_UNRECORDED]

/** 수단 칸 키. 비어 있으면 '수단 미기록'. */
export function payMethodKey(payMethod: string | null | undefined): string {
  const t = (payMethod ?? '').trim()
  return t || PAY_METHOD_UNRECORDED
}

/** 수납 방법 칸이 보는 record 의 최소 형태. Prisma select 와 그대로 맞물린다. */
export type MethodPaymentRow = PaymentAggregateRow & {
  actualAmount: number
  isDeposit: boolean
  isPrevOwner?: boolean
  memo?: string | null
}

/** 이 record 가 수납 방법 칸에 드는가. 들면 그 칸 키, 아니면 null. */
export function methodPaymentKey(r: MethodPaymentRow): string | null {
  if (r.isDeposit || r.isPrevOwner || r.isBillingAdjust) return null
  if (isDueDayAdjust(r.memo)) return null
  if (r.actualAmount <= 0) return null
  const k = payMethodKey(r.payMethod)
  return PAY_METHOD_FILTER_OPTIONS.includes(k) ? k : null
}

export type MethodTotal = { sum: number; count: number }

export type MonthPaymentTotals = {
  cardSum: number
  cardCount: number
  /** 카드로 받은 보증금 몫. 카드 줄에는 들고 신용카드·결제선생 칸에는 안 든다. */
  cardDepositSum: number
  /** 수단 칸별 이용료 합. 받은 적 없는 칸은 키가 없다. */
  byMethod: Record<string, MethodTotal>
}

/**
 * 그 달 수납 집계. 카드 줄과 수단 칸을 한 번에 낸다(입금일 축).
 * 서버가 영업장·컷오프·양도인·납입일 변경 조정 행으로 이미 좁힌 행을 넘긴다. 달 판정은 여기서 한다.
 */
export function aggregateMonthPayments(rows: readonly MethodPaymentRow[], targetMonth: string): MonthPaymentTotals {
  let cardSum = 0, cardCount = 0, cardDepositSum = 0
  const byMethod: Record<string, MethodTotal> = {}
  for (const r of rows) {
    if (paymentCardMonth(r) === targetMonth) {
      cardSum += r.actualAmount; cardCount += 1
      if (r.isDeposit) cardDepositSum += r.actualAmount
    }
    const k = methodPaymentKey(r)
    if (!k || dbDateMonthKey(r.payDate) !== targetMonth) continue
    const t = byMethod[k] ?? (byMethod[k] = { sum: 0, count: 0 })
    t.sum += r.actualAmount; t.count += 1
  }
  return { cardSum, cardCount, cardDepositSum, byMethod }
}

/** 카드 계열 칸 합(신용카드 + 결제선생). 항등식 그물과 화면 설명이 같은 식을 본다. */
export function cardLikeMethodSum(byMethod: Record<string, MethodTotal>): number {
  return CARD_LIKE_METHODS.reduce((s, m) => s + (byMethod[m]?.sum ?? 0), 0)
}

/** 서버가 행에 실어 내리는 그 달 입금 한 건. payDate·targetMonth 는 문자열이다. */
export type MethodPay = { method: string; payDate: string; amount: number; targetMonth: string }

/** 이미 거른 record 를 행에 실을 꼴로. 그 달(입금일)에 든 것만 남긴다. */
export function methodPaysOf(rows: readonly (MethodPaymentRow & { targetMonth: string })[], viewMonth: string): MethodPay[] {
  const out: MethodPay[] = []
  for (const r of rows) {
    const k = methodPaymentKey(r)
    if (!k || dbDateMonthKey(r.payDate) !== viewMonth) continue
    out.push({ method: k, payDate: r.payDate.toISOString().slice(0, 10), amount: r.actualAmount, targetMonth: r.targetMonth })
  }
  return out.sort((a, b) => a.payDate.localeCompare(b.payDate))
}

/** 행이 그 수단으로 이 달에 받은 돈이 있는가(필터 판정). */
export function rowHasMethodPay(pays: readonly MethodPay[] | undefined, method: string): boolean {
  return (pays ?? []).some(p => p.method === method)
}

/** 귀속월 꼬리. 보는 달과 같으면 없음, 같은 해면 '(9월분)', 다른 해면 '(2025년 12월분)'. */
function monthTail(targetMonth: string, viewMonth: string): string {
  if (targetMonth === viewMonth) return ''
  const [ty, tm] = targetMonth.split('-').map(Number)
  const vy = Number(viewMonth.slice(0, 4))
  return ty === vy ? ` (${tm}월분)` : ` (${ty}년 ${tm}월분)`
}

/** 행 보조줄 '현금 · 10/3 130,000원 · 10/20 50,000원 (9월분)'. 그 수단 건이 없으면 null. */
export function methodPayLine(pays: readonly MethodPay[] | undefined, method: string, viewMonth: string): string | null {
  const mine = (pays ?? []).filter(p => p.method === method)
  if (mine.length === 0) return null
  return [method, ...mine.map(p => `${fmtMD(p.payDate)} ${fmtWon(p.amount)}${monthTail(p.targetMonth, viewMonth)}`)].join(' · ')
}
