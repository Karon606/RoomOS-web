// 현금영수증 발행일 정본 — 스탬프 값 결정(쓰기)과 월 수납 집계의 축·버킷 판정(읽기).
//
// 왜 한 파일인가. 두 판정은 같은 사실의 앞뒤다. 쓰기가 '언제 발행했나'를 정하고 읽기가 그것으로
// 달을 가른다. 자리가 갈리면 쓰기는 클릭 시각을 박는데 읽기는 발행일이라 부르는, 이번에 실제로
// 난 어긋남이 다시 생긴다.
//
// ── 축이 왜 발행일인가 (2026-08-24 정정) ────────────────────────────
// 종전 정본은 payDate(입금일) 축이었다. 홈택스가 승인일자로 집계한다는 일반론에서 출발해
// "입금일에 발행하니 두 축이 같다"고 단정했고, **운영자의 실제 발행 관행을 확인하지 않았다.**
// 실측은 반대였다 — 발행 기록 32건 중 29건이 발행일 != 입금일이고, 2026-08-22 하루에 18건
// 7,640,000원이 몰려 있다. 운영자 원문 "항상 모아서 하는거는 사실 잘못된거지만 이번은 미뤄져서
// 그랬어". 즉 일괄 발행이 정상 관행은 아니지만 실제로 일어나고, 그때 payDate 축 숫자는
// 홈택스와 맞을 수가 없다.
//
// 같은 날 발행하면 두 축이 같은 답을 낸다. 그래서 평소에는 숫자가 안 바뀌고 지연됐을 때만
// 바로잡힌다. 카드는 매출전표가 결제 시점에 성립하므로 payDate 축 그대로다.
import { CARD_LIKE_METHODS } from './paymentMethods'
import { fmtWon } from './fmtMoney'
import { dbDateMonthKey, kstMonthKey, kstYmdStr, kstDateTimeToUtc } from './kstDate'

// ── 쓰기 ────────────────────────────────────────────────────────

export type CashReceiptStampInput = {
  /** 폼의 '현금영수증 발행함' 체크. false 면 표시를 끈다(null). */
  issued: boolean
  /** 운영자가 고른 발행일 'YYYY-MM-DD'(KST). 비었으면 아래 폴백. */
  issuedDate?: string | null
  /** 이미 박혀 있는 값. 재저장 경로에서 날짜를 안 넘기면 이것을 지킨다. */
  existing?: Date | null
  /** KST 오늘 'YYYY-MM-DD'. 테스트 주입용 — 안 주면 실제 오늘. */
  today?: string
  /** '지금'. 테스트 주입용 — 안 주면 실제 지금. */
  now?: Date
  /** 이 결제의 수단. 카드 계열이면 무조건 null 이다(규칙 5). */
  payMethod?: string | null
}

/**
 * 현금영수증 발행 시각을 정한다. 다섯 저장 경로가 전부 이 함수를 지난다.
 *
 * 규칙.
 *   1. 발행 표시가 꺼져 있으면 null. 홈택스 취소를 앱이 대신 하지 않는다는 정본과 짝이다
 *      (knowledge/cash-receipt-refund).
 *   2. 운영자가 날짜를 고쳤으면 그 날짜다. **이것이 편집 경로다** — 안 덮으면 고칠 길이 없다.
 *      값은 그 날 KST 자정이다. 날짜만 뜻하는 값이라 시각에 의미를 주지 않는다.
 *   3. 날짜를 안 넘겼으면 기존 값을 지키고, 기존 값도 없으면 지금이다.
 *      기존 값 보존은 updatePayment 이 원래부터 하던 것이고(재저장이 발행일을 오늘로 밀면 안 된다)
 *      그 규칙을 전 경로로 넓힌다.
 *   4. **미래 날짜는 받지 않는다.** 아직 안 한 발행이라 국세청에 있을 수가 없다. 화면은
 *      DatePicker maxDate 로 애초에 못 고르게 막고, 여기서는 폴백으로 떨어뜨린다(마지막 방어선).
 *   5. **카드 계열이면 무조건 null.** 카드는 현금이 아니라 현금영수증 대상 자체가 아니고,
 *      국세청에는 카드 매출로 따로 보고된다(운영자 확정 2026-08-24). 그래서 수단을 카드로
 *      바꾸면 발행 표시는 자연히 취소되고 그 금액은 카드 합계로 넘어간다. 화면이 체크를
 *      안 보냈어도 여기서 지운다 — 수단이 바뀐 것이 곧 취소 사유다.
 *
 * 발행일이 입금일과 다른 것은 **정상이다.** 운영자 원문 — "원칙은 입금된 날짜에 발행하는게
 * 맞아. 근데 업무특성상(누락 매출분도 있기 때문에) 날짜가 다르게 할 필요가 있거든".
 * 그래서 경고도 차단도 두지 않는다. 막는 것은 미래 하나뿐이다.
 */
export function resolveCashReceiptIssuedAt(input: CashReceiptStampInput): Date | null {
  if (!isCashReceiptEligible(input.payMethod)) return null
  if (!input.issued) return null
  const today = input.today ?? kstYmdStr()
  const raw = (input.issuedDate ?? '').slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && raw <= today) {
    const at = kstDateTimeToUtc(raw)
    if (at) return at
  }
  return input.existing ?? input.now ?? new Date()
}

/**
 * 이 수단이 현금영수증 대상인가. **카드 계열은 아니다.**
 *
 * 운영자 원문(2026-08-24) — "카드 결제는 국세청에 바로 보고가 되기도 하고 카드 결제 자체가
 * 이미 현금이 아니니까 현금영수증이 아니지. 그래서 카드 결제 건에 대한 합계 금액이 얼마인지
 * 따로 표시되게 한거잖아".
 *
 * 화면 넷과 저장 다섯 경로가 같은 판정을 써야 한다. 종전에는 수납 등록 폼과 원터치 토글만
 * 카드를 막고 예약금 폼·입주자 상세 수납·수납 내역 수정 셋은 켤 수 있어, 같은 사실을 두고
 * 화면마다 다른 말을 했다.
 */
export function isCashReceiptEligible(payMethod: string | null | undefined): boolean {
  return !payMethod || !CARD_LIKE_METHODS.includes(payMethod)
}

/**
 * 카드를 골랐을 때 발행 체크 자리에 서는 문구. 네 화면이 같은 문장을 쓴다.
 * 사본이 늘면 그 자리들이 갈린다 — 실제로 갈려 있던 것을 하나로 모은다.
 */
export const CARD_NOT_CASH_RECEIPT_NOTE = '카드 결제는 매출전표가 증빙을 대신해 현금영수증 집계에 넣지 않습니다.'

// ── 읽기 ────────────────────────────────────────────────────────

// ── 카드 수납 합계 ────────────────────────────────────────────

/** 카드 합계가 보는 record 의 최소 형태. Prisma select 와 그대로 맞물린다. */
export type PaymentAggregateRow = {
  payMethod: string | null
  payDate: Date                    // @db.Date — UTC 자정 저장
  isBillingAdjust?: boolean         // 청구 조정 전표 — 받은 돈이 아니다
}

/**
 * 이 record 가 카드 수납 합계의 어느 달로 가는지. 카드가 아니면 null.
 *
 * 축은 payDate 다 — 매출전표가 결제 시점에 성립한다. 현금영수증은 축도 표도 다르다
 * (CashReceipt.issuedAt). **두 합계가 겹칠 일은 구조로 없다** — 카드는 현금영수증 대상이
 * 아니고(isCashReceiptEligible), 발행 기록은 별도 표에 산다.
 *
 * 조정 전표(단기 연장·감액 마커)는 **받은 돈이 아니다** — 오늘은 9건 전부 금액 0에 수단이
 * 없어 숫자에 안 나타나지만, 전표에 수단이 붙는 날 카드 건수만 조용히 부푼다.
 *
 * 보증금은 **뺐다가 되돌렸다**(2026-08-24 같은 날). 처음엔 "나중에 돌려줄 돈이라 매출이 아니다"
 * 로 뺐는데, 카드로 낸 보증금은 카드사·홈택스에 **카드 매출로 그대로 남는다**. 그것을 앱에서만
 * 빼면 카드사 명세와 대사가 안 된다(운영자 확인 — "맞아 네 말대로 카드 매출로 남아").
 * 실제로 2026-04 50,000원 1건, 2026-05 100,000원 2건이 그렇게 빠졌다가 돌아왔다.
 */
export function paymentCardMonth(r: PaymentAggregateRow): string | null {
  if (r.isBillingAdjust) return null
  if (!r.payMethod || !CARD_LIKE_METHODS.includes(r.payMethod)) return null
  return dbDateMonthKey(r.payDate)
}

// ── 발행 기록(CashReceipt) ────────────────────────────────────
//
// 2026-08-24 부터 발행은 **금액을 든 한 줄**이다(운영자 확정). 종전에는 PaymentRecord 의
// 스탬프 하나로 "이 수납은 발행함"만 저장해서, 합계가 발행 금액이 아니라 발행 표시가 붙은
// **수납 금액**이었다. 45만 받고 30만만 끊으면 앱은 45만이라 말했다.

/** 발행 한 줄의 최소 형태. Prisma select 와 그대로 맞물린다. */
export type CashReceiptRow = {
  issuedAt: Date   // 타임스탬프 — KST 달로 읽는다
  amount: number
}

/** 이 발행이 잡히는 달 'YYYY-MM'(KST). 축이 발행일인 이유는 위 파일 머리말 참조. */
export function cashReceiptMonth(r: CashReceiptRow): string {
  return kstMonthKey(r.issuedAt)
}

// ── 취소 안내가 적을 발행 건 ──────────────────────────────────

/**
 * 취소할 발행 한 건 — 발행일과 발행액, 그리고 그 중 **이번 환불과 무관한 몫**.
 *
 * outside 가 왜 필요한가. 발행은 (계약·수납일·수단) 하나에 한 줄인데 수납은 여럿일 수 있다.
 * 한 입금을 보증금 몫과 이용료 몫으로 쪼개거나 두 달치를 한 번에 받으면 그렇다. 이용료만
 * 환불해도 홈택스는 부분 취소가 안 되니 **줄 전체를 취소**하는 것이 맞다. 그런데 재발행액은
 * 환불이 계산한 확정액만으로는 모자란다 — 딸려 취소된 몫을 도로 얹어야 한다.
 * 그 몫을 앱이 대신 계산해 단정하지 않고 얼마가 딸려 있는지만 알린다.
 */
export type CashReceiptIssueLine = { ymd: string; amount: number; outside?: number }

/** 발행 줄에서 이 판정이 보는 몫. Prisma select 와 그대로 맞물린다. */
export type CashReceiptCancelRow = { issuedAt: Date; amount: number; payDate: Date; payMethod: string | null }
/** 발행 표시가 켜진 수납. 줄을 못 찾았을 때의 폴백 재료다. */
export type StampedPaymentRow = { cashReceiptIssuedAt: Date | null; actualAmount: number; payDate: Date; payMethod: string | null }

/**
 * 환불 안내가 "홈택스에서 취소하라"고 지목할 발행 건들을 만든다.
 *
 * 종전에는 안내가 **입금일과 수납액**을 적었다. 둘 다 발행 사실이 아니다.
 *   날짜 — 운영자는 받은 날 바로 안 끊고 모아서 끊는다. 실측 33건 중 29건이 발행일 != 입금일이고
 *          2026-08-22 하루에 18건이 몰려 있다. 홈택스는 발행일로 찾으므로 입금일을 적어 주면
 *          없는 날짜를 뒤지게 된다. 두 날짜는 같을 필요가 없다는 것이 운영자 확정이다(2026-09-01).
 *   금액 — 45만 받고 30만만 끊을 수 있다. 그것이 CashReceipt 표가 따로 생긴 이유인데(2026-08-24)
 *          이 안내만 옛 방식으로 수납액을 세고 있었다. 오늘은 33건 전부 두 값이 같아 안 드러난다.
 *
 * 한 발행 줄이 여러 수납을 덮는다. 한 입금을 보증금·청소비·이용료 몫으로 쪼개 저장해도
 * 발행은 (계약·수납일·수단) 하나에 한 줄이다. 그래서 수납마다 세면 금액이 부푼다.
 *
 * 발행 줄이 없는 옛 건은 **도장 날짜로라도 말한다.** 침묵이 가장 나쁘다 — 앱 매출만 조용히 줄고
 * 홈택스에는 원 금액이 살아 있는 것이 이 안내가 생긴 이유다(519호 클래스). 도장 값 자체가
 * 발행 시각이므로 폴백도 입금일이 아니다. 이 어긋남은 verify:db 의 발행 줄 감사가 따로 잡는다.
 */
export function cashReceiptIssueLines(
  receipts: CashReceiptCancelRow[],
  stamped: StampedPaymentRow[],
): CashReceiptIssueLine[] {
  // @db.Date 는 UTC 자정 저장이라 UTC 날짜부가 곧 달력 날짜다. 발행 시각은 타임스탬프라 KST 로 읽는다.
  const key = (payDate: Date, payMethod: string | null) => `${payDate.toISOString().slice(0, 10)}|${payMethod ?? ''}`
  const byKey = new Map<string, CashReceiptCancelRow>()
  for (const r of receipts) byKey.set(key(r.payDate, r.payMethod), r)

  // 이번 환불이 건드리는 수납이 그 발행 줄에서 차지하는 몫 — 나머지가 곧 딸려 취소되는 금액이다.
  const inScope = new Map<string, number>()
  for (const p of stamped) {
    if (!p.cashReceiptIssuedAt) continue
    const k = key(p.payDate, p.payMethod)
    inScope.set(k, (inScope.get(k) ?? 0) + p.actualAmount)
  }

  const counted = new Set<string>()
  const bucket = new Map<string, { amount: number; outside: number }>()
  const add = (ymd: string, amount: number, outside: number) => {
    const cur = bucket.get(ymd) ?? { amount: 0, outside: 0 }
    bucket.set(ymd, { amount: cur.amount + amount, outside: cur.outside + outside })
  }

  for (const p of stamped) {
    if (!p.cashReceiptIssuedAt) continue
    const k = key(p.payDate, p.payMethod)
    const row = byKey.get(k)
    if (!row) { add(kstYmdStr(p.cashReceiptIssuedAt), p.actualAmount, 0); continue }
    if (counted.has(k)) continue   // 같은 발행 줄을 덮는 형제 수납 — 한 번만 센다
    counted.add(k)
    // 발행액이 환불 대상 수납보다 작을 수도 있다(45만 받고 30만만 끊은 경우). 그때 딸린 몫은 없다.
    add(kstYmdStr(row.issuedAt), row.amount, Math.max(0, row.amount - (inScope.get(k) ?? 0)))
  }
  return [...bucket]
    .map(([ymd, v]) => (v.outside > 0 ? { ymd, amount: v.amount, outside: v.outside } : { ymd, amount: v.amount }))
    .sort((a, b) => a.ymd.localeCompare(b.ymd))
}

/**
 * 한 입금에 붙일 발행 금액의 기본값. 체크된 몫만 더한다(운영자 확정 2026-08-24).
 *
 * "총금액 40만원이 미리 입력되어 있고 보증금 v, 월이용료 v… 이렇게 디폴트값이 들어갈거야.
 * 근데 난 보증금은 발행 안하고 싶어서 체크를 해제하면 금액은 35만원으로 바뀌고".
 *
 * 앱이 입금을 쪼개는 순서와 같은 세 몫이다(lib/depositComposition 의 보증금·청소비·이용료).
 * 운영자가 금액을 직접 고치면 이 값은 더 이상 쓰이지 않는다 — 어디까지나 **기본값**이다.
 */
export function cashReceiptDefaultAmount(
  parts: { deposit: number; cleaning: number; rent: number },
  incl: { deposit: boolean; cleaning: boolean; rent: boolean },
): number {
  return (incl.deposit ? Math.max(0, parts.deposit) : 0)
    + (incl.cleaning ? Math.max(0, parts.cleaning) : 0)
    + (incl.rent ? Math.max(0, parts.rent) : 0)
}


// ── 발급 기한 ────────────────────────────────────────────────
//
// 고시원 운영업은 현금영수증 의무발행업종이다(소득세법 시행령 별표 3의3, 2021-01-01 편입 —
// 세무 패널 조사 2026-09-01). 건당 10만원 이상을 현금(계좌이체 포함)으로 받으면 요청이 없어도
// **받은 날부터 5일 안에** 발급해야 하고, 미발급 가산세가 20%다(소득세법 §81의9).
// 실측 발행 33건 중 23건이 이 기한을 넘겨 있었다(합계 952만원) — 모아서 일괄 발행하는 관행
// 자체가 기한 초과를 만든다. 앱이 할 일은 기한이 다가올 때 미리 말하는 것이다.

export const CASH_RECEIPT_DEADLINE_DAYS = 5
/** 의무발행 하한(원). 이 미만은 상대가 요청할 때만 발급한다. */
export const CASH_RECEIPT_OBLIGATION_MIN = 100000

/**
 * 발급 기한까지 남은 일수. 0 이면 오늘이 마감, 음수면 그만큼 지났다.
 * 두 인자 모두 'YYYY-MM-DD'(KST 달력 날짜) — Date 로 받으면 타임존이 하루를 밀 수 있다.
 */
export function cashReceiptDaysLeft(payYmd: string, todayYmd: string): number {
  return CASH_RECEIPT_DEADLINE_DAYS
    - Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${payYmd}T00:00:00Z`)) / 86400000)
}

/**
 * 자진발급 감경 창(일). 받은 날부터 이 날수 안에 스스로 발급하면 가산세가 20%에서 10%로 준다
 * (소득세법 §81의9, 세무 패널 조사 2026-09-01). 기한(5일)을 넘겨도 아직 절반인 구간이 있다는 뜻이다.
 */
export const CASH_RECEIPT_SELF_ISSUE_DAYS = 10

/**
 * 홈 알림에서 이 건이 설 자리.
 *
 *   due     — 기한 임박·오늘 마감. 건별로 나열한다.
 *   grace   — 기한은 지났지만 자진발급 감경 창 안이다. **지금 하면 가산세가 절반**이라 아직
 *             움직일 값어치가 있어 건별로 남긴다(운영자 결정 2026-09-03).
 *   overdue — 감경 창도 지났다. 요약 한 줄로 접는다. 발급 의무가 사라지는 것은 아니다.
 *   none    — 아직 여유가 있어 알림에 안 뜬다.
 *
 * 왜 순수 함수인가. 종전에는 대시보드 생성부가 `left <= 2` 인라인 하나로 전부를 갈랐다.
 * 자리가 넷으로 늘면 그 인라인이 화면마다 갈리고, 갈려도 아무도 못 잡는다.
 *
 * `dueWithin` 기본값 2 는 ALERT_URGENT_CATEGORY_DAYS.receipt 과 같은 값이다. 두 곳이 갈리면
 * 알림에 뜨는 날과 긴급 존에 오르는 날이 어긋난다.
 */
export type CashReceiptAlertSlot = 'due' | 'grace' | 'overdue' | 'none'

export function cashReceiptAlertSlot(daysLeft: number, dueWithin = 2): CashReceiptAlertSlot {
  if (daysLeft > dueWithin) return 'none'
  if (daysLeft >= 0) return 'due'
  // 기한(5일)에서 감경 창(10일)까지 남은 날수. 0 이면 오늘이 감경 창 마지막 날이다.
  const graceLeft = daysLeft + (CASH_RECEIPT_SELF_ISSUE_DAYS - CASH_RECEIPT_DEADLINE_DAYS)
  return graceLeft >= 0 ? 'grace' : 'overdue'
}

/**
 * 이 건의 기한 상태를 사람 말로. 목록 둘째 줄과 알림 상세가 같은 말을 쓴다.
 *
 * 지난 것을 '경과'라 부르는 것은 이 앱의 알림 어휘 정본이다(미납·퇴실·보증금 반환 대기가 전부
 * 그 말을 쓰고, 홈의 긴급도 판정 urgencyDaysOf 가 그 낱말을 보고 긴급 존을 가른다). '지남'으로
 * 쓰면 같은 사실이 화면마다 다른 말이 되고 긴급 판정에서도 빠진다.
 *
 * **문자열이 '기한'으로 시작하는 것은 의도다.** urgencyDaysOf 의 parseInt 가 선두에서 숫자를 못
 * 찾아 긴급도가 −1 로 접히고, 그래서 이 줄은 긴급 존 안에서 미납(−N일)보다 아래에 선다.
 * '퇴실 N일 경과'와 같은 클래스다. 숫자를 앞으로 옮기면 148일 경과 줄이 미납 위로 뛰어오른다.
 */
export function cashReceiptDeadlineLabel(daysLeft: number): string {
  if (daysLeft > 0) return `기한 ${daysLeft}일 남음`
  if (daysLeft === 0) return '오늘 마감'
  return `기한 ${-daysLeft}일 경과`
}

// ── 보증금 포함 발행 경고 ─────────────────────────────────────
//
// 보증금은 반환을 전제로 받는 예수금이라 공급 대가가 아니고, 일반적으로 현금영수증 발급
// 대상이 아니다(부가46015-1586·서삼46015-10652, 세무 패널 조사 2026-09-01). 앱이 세무 판단을
// 단정하지는 않는다 — 켜는 것을 막지 않고, 켜기 전에 알린다. 문구가 두 화면(수납 등록 폼·
// 발행 탭 일괄 모달)에 서므로 정본 한 벌이다.
export function depositCashReceiptWarning(amount?: number): string {
  const head = amount && amount > 0 ? `보증금 몫 ${fmtWon(amount)}은` : '보증금은'
  return `${head} 돌려줄 돈이라 매출이 아니고, 일반적으로 현금영수증 발급 대상이 아닙니다. 포함해 발행하려면 세무 담당자에게 먼저 확인해 주세요.`
}

// ── 발행 줄이 살아 있는 수납을 가리키는가 ────────────────────────

/** 발행 줄과 수납을 맞물리는 키 — 발행은 (계약·수납일·수단) 하나에 한 줄이다. */
export function cashReceiptKey(r: { leaseTermId: string; payDate: Date; payMethod: string | null }): string {
  return `${r.leaseTermId}|${r.payDate.toISOString().slice(0, 10)}|${r.payMethod ?? ''}`
}

/**
 * 이 발행 줄의 상태.
 *   ok            — 살아 있는 발행 표시 수납이 받치고 있다.
 *   refundPending — 이용료 환불이 표시를 껐다. **정상 중간 상태다.**
 *   ghost         — 아무도 안 가리키는데 합계에는 든다. 이 감지망의 표적이다(408호).
 *
 * 왜 가르는가. 환불은 원 수납을 소프트삭제하고 새 record 에는 발행 도장을 **일부러** 안 찍는다.
 * 승계하면 앱 합계만 확정액으로 조용히 줄고 홈택스에는 원 금액이 살아 있어 아무도 취소를 안 한다
 * (회계 패널 2026-08-01). 그래서 환불 직후에는 줄을 받치는 살아 있는 도장이 없다.
 *
 * 그 상태에서 합계가 원 금액을 드는 것은 **맞다** — 홈택스가 아직 그 금액이다. 운영자가 취소하고
 * 재발행해 표시를 다시 켤 때까지의 정상 상태다. 이것을 유령으로 울면 첫 환불부터 매번 울고,
 * 그러면 408호 같은 진짜 유령도 같이 안 읽힌다.
 *
 * 판별은 계약의 환불 스냅샷이다(checkoutProrationUndo.refund.deletedRecordIds). "이 수납은 환불이
 * 지웠고 적용취소하면 되살아난다"는 뜻이라, 운영자가 그냥 지운 수납은 여기 없다 — 그것이 진짜
 * 유령이다. 적용취소하면 스냅샷이 지워지고 도장이 돌아오므로 대기는 저절로 풀린다.
 */
export function receiptRowVerdict(
  key: string,
  liveStampedKeys: ReadonlySet<string>,
  refundPendingKeys: ReadonlySet<string>,
): 'ok' | 'refundPending' | 'ghost' {
  if (liveStampedKeys.has(key)) return 'ok'
  return refundPendingKeys.has(key) ? 'refundPending' : 'ghost'
}

/**
 * 끈 키 중 **되살리면 실제로 알림줄로 돌아올** 키만 남긴다.
 *
 * 왜 필요한가(신고 C-1, 2026-09-03). 홈의 "현금영수증 발급 기한 · N건 끔"이 저장된 끈 키를 그냥
 * 세고 있었다. 그런데 끈 뒤에 발행했거나 의무 기준액 미만인 건은 되살려도 알림줄로 안 돌아온다.
 * 그래서 라벨의 숫자가 '다시 켜기'의 효과보다 부풀었다. 세는 규칙을 알림줄을 만드는 규칙(crAll
 * 필터)과 같은 것으로 맞춘다 — 두 자리가 다른 셈을 하면 그 차이는 언젠가 사람이 발견한다.
 */
export function liveMutedReceiptKeys(
  muted: Iterable<string>,
  groups: ReadonlyMap<string, { amount: number }>,
  issued: ReadonlySet<string>,
  min: number = CASH_RECEIPT_OBLIGATION_MIN,
): string[] {
  return [...muted].filter(k => {
    const g = groups.get(k)
    return !!g && !issued.has(k) && g.amount >= min
  })
}
