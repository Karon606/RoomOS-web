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

/** 취소할 발행 한 건 — 발행일과 발행액. */
export type CashReceiptIssueLine = { ymd: string; amount: number }

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

  const counted = new Set<string>()
  const bucket = new Map<string, number>()
  const add = (ymd: string, amount: number) => bucket.set(ymd, (bucket.get(ymd) ?? 0) + amount)

  for (const p of stamped) {
    if (!p.cashReceiptIssuedAt) continue
    const k = key(p.payDate, p.payMethod)
    const row = byKey.get(k)
    if (!row) { add(kstYmdStr(p.cashReceiptIssuedAt), p.actualAmount); continue }
    if (counted.has(k)) continue   // 같은 발행 줄을 덮는 형제 수납 — 한 번만 센다
    counted.add(k)
    add(kstYmdStr(row.issuedAt), row.amount)
  }
  return [...bucket]
    .map(([ymd, amount]) => ({ ymd, amount }))
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

