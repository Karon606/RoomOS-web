// 현금영수증 발행일 회귀 테스트 — lib/cashReceipt. 실패 시 exit 1.
// 실행: npx tsx scripts/test-cash-receipt.ts
//
// 왜 고정하는가. 이 판정은 **세무에 직결되는 숫자의 축**이다. 2026-08-24 에 축을 payDate(입금일)
// 에서 cashReceiptIssuedAt(발행일)로 옮겼는데, 그 판정이 조용히 되돌아가면 홈택스와 안 맞는
// 숫자가 다시 화면에 뜨고 아무도 모른다. 발행 32건 중 29건이 발행일 != 입금일이었다.
//
// 특히 **KST 자정 경계**를 반드시 건다. cashReceiptIssuedAt 은 @db.Date 가 아니라 타임스탬프라
// UTC 달로 읽으면 KST 새벽 발행분이 전달로 떨어진다. 이 저장소가 2026-08-19 에 전역 정정한
// 바로 그 클래스이고, 프로덕션(UTC)에서만 맞는 코드라 사람 눈으로는 안 보인다.
import { cashReceiptAlertSlot, cashReceiptDaysLeft, cashReceiptDeadlineLabel, cashReceiptDefaultAmount, cashReceiptMonth, isCashReceiptEligible, paymentCardMonth, resolveCashReceiptIssuedAt, liveMutedReceiptKeys, isReceiptBeforeCutoff, CASH_RECEIPT_DEFAULT_INCL, cashReceiptIssuableAmount, isCashReceiptCandidate, cashReceiptExcludedShare, hasExcludedCashReceiptShare, cashReceiptShareWarning } from '../lib/cashReceipt'
import {
  summarizeCashReceiptKey, planCashReceiptOn, planCashReceiptEntry, planCashReceiptRemoval, planCashReceiptEdit,
  buildCashReceiptUndo, cashReceiptUndoConflict, parseCashReceiptUndo, sameCashReceiptLine, canonicalCashReceiptUndo, CASH_RECEIPT_UNDO_MAX_STAMPS,
  type CashReceiptLineState, type CashReceiptLineTarget, type CashReceiptLineSnap, type CashReceiptKeyRow,
} from '../lib/cashReceipt'
import { readAlertCutoffYmd } from '../lib/alertCutoff'
import {
  cashReceiptRowCaption, crCaptionText, cashReceiptTabGap, cashReceiptGapSentence, crAddPreviewChunks, crOnToast, crOffToastDetail,
  crOffUndoneMessage, CR_ON_UNDONE, CR_DELETE_UNDONE, crUndoMismatchDetail, crDeleteConfirmLine, crDeleteToastDetail, crRestoreDetail, crEditToastDetail,
} from '../lib/cashReceiptCopy'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

// @db.Date 저장 정본 — UTC 자정.
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
// KST 시각 — 발행 스탬프는 타임스탬프라 시분까지 뜻이 있다.
const kst = (s: string) => new Date(`${s}+09:00`)

// ── 읽기: 두 축 ─────────────────────────────────────────────
//
// 현금영수증은 CashReceipt.issuedAt 의 **KST 달**, 카드는 PaymentRecord.payDate 의 달이다.
// 표가 갈려 있어 한 건이 두 합계에 동시에 드는 일은 구조로 없다.

// 같은 날 발행 — 평소에는 이 모양이라 축을 바꿔도 숫자가 안 움직인다.
eq('같은 날 발행', cashReceiptMonth({ issuedAt: kst('2026-08-05T14:30:00'), amount: 350000 }), '2026-08')
// 지연 발행 — 이번 신고의 실제 모양이다. 7/31 에 받은 돈을 8/22 에 몰아서 발행했다.
eq('지연 발행(7/31 입금·8/22 발행)', cashReceiptMonth({ issuedAt: kst('2026-08-22T11:00:00'), amount: 470000 }), '2026-08')

// KST 자정 경계 — UTC 달로 읽으면 KST 새벽 발행분이 전달로 떨어진다.
// 프로덕션(UTC)에서만 틀리는 종류라 사람 눈에 안 보인다.
eq('KST 월 첫날 자정 발행', cashReceiptMonth({ issuedAt: kst('2026-09-01T00:00:00'), amount: 1 }), '2026-09')
eq('KST 월 첫날 00:30 발행', cashReceiptMonth({ issuedAt: kst('2026-09-01T00:30:00'), amount: 1 }), '2026-09')
eq('KST 전달 마지막날 23:59 발행', cashReceiptMonth({ issuedAt: kst('2026-08-31T23:59:00'), amount: 1 }), '2026-08')
eq('연 경계', cashReceiptMonth({ issuedAt: kst('2027-01-01T00:10:00'), amount: 1 }), '2027-01')

// 카드 축 — payDate 의 달. 조정 전표는 받은 돈이 아니라 빠지고,
// 보증금은 든다(카드로 냈으면 카드사 명세에 그대로 남는다).
eq('신용카드는 payDate 달로', paymentCardMonth({ payMethod: '신용카드', payDate: day('2026-08-10') }), '2026-08')
eq('결제선생도 카드 계열', paymentCardMonth({ payMethod: '결제선생', payDate: day('2026-04-02') }), '2026-04')
eq('계좌이체는 카드가 아니다', paymentCardMonth({ payMethod: '계좌이체', payDate: day('2026-08-10') }), null)
eq('수단이 없으면 카드가 아니다', paymentCardMonth({ payMethod: null, payDate: day('2026-08-10') }), null)
eq('조정 전표는 카드라도 빠진다', paymentCardMonth({ payMethod: '신용카드', payDate: day('2026-08-10'), isBillingAdjust: true }), null)

// ── 발행 금액 기본값 — 체크된 몫만 더한다 ──────────────────────
//
// 운영자 예시(514호) — 보증금 5만 + 이용료 35만 = 40만이 기본이고, 보증금 체크를 풀면 35만이 된다.
const PARTS = { deposit: 50000, cleaning: 0, rent: 350000 }
eq('전부 체크면 전액', cashReceiptDefaultAmount(PARTS, { deposit: true, cleaning: true, rent: true }), 400000)
eq('보증금 체크를 풀면 이용료만', cashReceiptDefaultAmount(PARTS, { deposit: false, cleaning: true, rent: true }), 350000)
eq('이용료를 풀면 보증금만', cashReceiptDefaultAmount(PARTS, { deposit: true, cleaning: true, rent: false }), 50000)
eq('전부 풀면 0', cashReceiptDefaultAmount(PARTS, { deposit: false, cleaning: false, rent: false }), 0)
// 단기 — 보증금 없이 청소비만 받는 경우(운영자 원문).
const SHORT = { deposit: 0, cleaning: 60000, rent: 300000 }
eq('단기는 청소비 몫이 선다', cashReceiptDefaultAmount(SHORT, { deposit: true, cleaning: true, rent: true }), 360000)
eq('단기에서 청소비만 발행', cashReceiptDefaultAmount(SHORT, { deposit: false, cleaning: true, rent: false }), 60000)
// 음수는 0으로 — 상류가 이상한 값을 줘도 합계가 줄어들면 안 된다.
eq('음수 몫은 0으로 본다', cashReceiptDefaultAmount({ deposit: -1000, cleaning: 0, rent: 100 }, { deposit: true, cleaning: true, rent: true }), 100)

// ── 받을 때 발행 대상은 이용료뿐 (운영자 확정 2026-09-21·결정 2026-09-22) ─────
//
// 운영자 원문 — "보증금은 돌려주는 금액, 청소비 또한 퇴실할 때 처리하는 금액이므로 받을 때는
// 현금영수증 처리하면 안되는 건들이야". 기본값이 되돌아가면 없는 매출이 국세청에 올라간다.

// 기본 상수를 **글자로** 고정한다. 이 셋이 곧 화면·서버가 참조하는 단 하나의 기본값이다.
eq('기본 몫 상수는 이용료만 참', CASH_RECEIPT_DEFAULT_INCL, { deposit: false, cleaning: false, rent: true })

// 413호 실측(2026-09-02 퇴실 건과 같은 계약, 보증금 50,000 + 이용료 350,000).
eq('413호 실측: 발행 대상은 이용료 몫', cashReceiptIssuableAmount({ deposit: 50000, cleaning: 0, rent: 350000 }), 350000)
eq('413호 실측: 후보다', isCashReceiptCandidate({ deposit: 50000, cleaning: 0, rent: 350000 }), true)
// 보증금만 받은 입금 — 실측 17건이 이 모양이다. 후보에서 뺀다(운영자 결정 1).
eq('보증금만 50,000: 발행 대상 없음', cashReceiptIssuableAmount({ deposit: 50000, cleaning: 0, rent: 0 }), 0)
eq('보증금만 50,000: 후보가 아니다', isCashReceiptCandidate({ deposit: 50000, cleaning: 0, rent: 0 }), false)
// '보유 보증금' 수단으로 퇴실 정산이 만든 청소비 — 실측 10건. 역시 후보가 아니다.
eq('청소비만 20,000: 발행 대상 없음', cashReceiptIssuableAmount({ deposit: 0, cleaning: 20000, rent: 0 }), 0)
eq('청소비만 20,000: 후보가 아니다', isCashReceiptCandidate({ deposit: 0, cleaning: 20000, rent: 0 }), false)
// 단기 입실 — 청소비를 실수단으로 따로 받아도 규칙은 하나다(운영자 결정 4).
eq('단기(청소비 60,000 + 이용료 300,000)도 이용료 몫만', cashReceiptIssuableAmount(SHORT), 300000)

// 빠지는 몫 — 화면이 '보증금 N원 제외'라 적는 근거이자 몫 체크 줄을 세우는 판정이다.
eq('제외 몫은 보증금·청소비 합', cashReceiptExcludedShare({ deposit: 50000, cleaning: 20000, rent: 350000 }),
  { deposit: 50000, cleaning: 20000, total: 70000 })
eq('제외 몫도 음수는 0', cashReceiptExcludedShare({ deposit: -5000, cleaning: 0, rent: 100 }), { deposit: 0, cleaning: 0, total: 0 })
eq('이용료만 받은 입금은 빠지는 몫이 없다', hasExcludedCashReceiptShare({ deposit: 0, cleaning: 0, rent: 350000 }), false)
eq('보증금만 받아도 몫 체크 줄은 선다', hasExcludedCashReceiptShare({ deposit: 50000, cleaning: 0, rent: 0 }), true)

// 경고 두 종 — 보증금 문장은 2026-09-01 패널 문구 그대로다(test-money 가 같은 글자를 고정한다).
eq('보증금 경고(금액 있음)', cashReceiptShareWarning('deposit', 50000),
  '보증금 몫 50,000원은 돌려줄 돈이라 매출이 아니고, 일반적으로 현금영수증 발급 대상이 아닙니다. 포함해 발행하려면 세무 담당자에게 먼저 확인해 주세요.')
eq('보증금 경고(금액 없음)', cashReceiptShareWarning('deposit'),
  '보증금은 돌려줄 돈이라 매출이 아니고, 일반적으로 현금영수증 발급 대상이 아닙니다. 포함해 발행하려면 세무 담당자에게 먼저 확인해 주세요.')
eq('청소비 경고(금액 있음)', cashReceiptShareWarning('cleaning', 20000),
  '청소비 몫 20,000원은 퇴실 정산 때 보증금에서 처리하는 돈이라 받는 시점에는 현금영수증 발급 대상이 아닙니다. 포함해 발행하려면 세무 담당자에게 먼저 확인해 주세요.')
eq('청소비 경고(금액 없음)', cashReceiptShareWarning('cleaning'),
  '청소비는 퇴실 정산 때 보증금에서 처리하는 돈이라 받는 시점에는 현금영수증 발급 대상이 아닙니다. 포함해 발행하려면 세무 담당자에게 먼저 확인해 주세요.')

// ── 쓰기: 스탬프 값 결정 ──────────────────────────────────────────

const NOW = kst('2026-08-24T15:00:00')
const TODAY = '2026-08-24'
const iso = (d: Date | null) => d ? d.toISOString() : null

eq('발행 안 함이면 null',
  iso(resolveCashReceiptIssuedAt({ issued: false, issuedDate: '2026-08-20', today: TODAY, now: NOW })), null)

// 기본값은 오늘 — 날짜를 안 넘기고 기존 값도 없으면 지금이다.
eq('기본값은 지금',
  iso(resolveCashReceiptIssuedAt({ issued: true, today: TODAY, now: NOW })), NOW.toISOString())

// 운영자가 고른 날짜가 이긴다. 그 날 KST 자정으로 박는다(날짜만 뜻하는 값).
eq('고른 날짜가 이긴다',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-22', today: TODAY, now: NOW })),
  kst('2026-08-22T00:00:00').toISOString())
// 그 값이 다시 달 판정을 지나면 고른 날의 달이어야 한다(쓰기와 읽기가 짝인지 확인).
eq('고른 날짜가 그 달로 간다', cashReceiptMonth({
  issuedAt: resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-22', today: TODAY, now: NOW })!,
  amount: 470000,
}), '2026-08')
// 월 첫날을 고르면 그 달이다 — KST 자정으로 박으므로 UTC 로는 전달 15:00Z 다. 되읽기가 짝이어야 한다.
eq('월 첫날을 고르면 그 달', cashReceiptMonth({
  issuedAt: resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-09-01', today: '2026-09-05', now: NOW })!,
  amount: 1,
}), '2026-09')

// 기존 값 보존 — 재저장이 발행일을 오늘로 밀면 안 된다(updatePayment 이 원래 하던 규칙).
const EXISTING = kst('2026-07-14T10:00:00')
eq('날짜 미지정이면 기존 값 보존',
  iso(resolveCashReceiptIssuedAt({ issued: true, existing: EXISTING, today: TODAY, now: NOW })),
  EXISTING.toISOString())
// 명시하면 덮는다 — 안 그러면 고칠 길이 없다. 이것이 편집 경로다.
eq('명시한 날짜는 기존 값을 덮는다',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-01', existing: EXISTING, today: TODAY, now: NOW })),
  kst('2026-08-01T00:00:00').toISOString())
// 끄면 기존 값이 있어도 null — 홈택스 취소를 앱이 대신하진 않지만 표시는 지운다.
eq('끄면 기존 값이 있어도 null',
  iso(resolveCashReceiptIssuedAt({ issued: false, existing: EXISTING, today: TODAY, now: NOW })), null)

// 먼 과거는 정상이다. 운영자 원문 — 업무 특성상 누락 매출분이 있어 날짜가 다를 필요가 있다.
// 경고도 차단도 두지 않는다(운영자 확정 2026-08-24).
eq('먼 과거도 그대로 받는다',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-04-03', today: TODAY, now: NOW })),
  kst('2026-04-03T00:00:00').toISOString())

// 막는 것은 미래 하나뿐 — 아직 안 한 발행이라 국세청에 있을 수가 없다.
// **2026-09-17 부터 폴백이 아니라 거부다**(운영자 승인). 조용히 오늘로 바꾸면 운영자가 고른 날과
// 저장된 날이 갈리는데 화면은 아무 말도 안 한다. 종전 기대값은 '폴백'이었고 그것을 뒤집었다.
const throws = (name: string, fn: () => unknown) => {
  try { fn(); fail++; console.log(`  실패 ${name}\n    기대 던짐\n    실제 안 던짐`) }
  catch { pass++ }
}
throws('미래 날짜는 거부한다',
  () => resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-25', today: TODAY, now: NOW }))
throws('미래 날짜는 기존 값이 있어도 거부한다',
  () => resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-12-31', existing: EXISTING, today: TODAY, now: NOW }))
// 끈 상태·카드는 미래여도 안 던진다 — 날짜를 쓰지 않는 경로라 거부할 것이 없다.
eq('꺼져 있으면 미래여도 null',
  iso(resolveCashReceiptIssuedAt({ issued: false, issuedDate: '2026-12-31', today: TODAY, now: NOW })), null)
eq('카드는 미래여도 null',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-12-31', payMethod: '신용카드', today: TODAY, now: NOW })), null)
// 오늘은 미래가 아니다(경계).
eq('오늘은 받는다',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: TODAY, today: TODAY, now: NOW })),
  kst('2026-08-24T00:00:00').toISOString())
// 형식이 깨진 값은 없는 것과 같이 다룬다 — 여기서 Invalid Date 를 만들면 DB 로 새어 나간다.
eq('형식 깨진 값은 폴백',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-8-2', today: TODAY, now: NOW })), NOW.toISOString())
eq('빈 문자열은 폴백',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '', existing: EXISTING, today: TODAY, now: NOW })),
  EXISTING.toISOString())

// ── 카드는 현금영수증 대상이 아니다 (운영자 확정 2026-08-24) ──
//
// 운영자 원문 — "카드 결제는 국세청에 바로 보고가 되기도 하고 카드 결제 자체가 이미 현금이
// 아니니까 현금영수증이 아니지. 그래서 카드 결제 건에 대한 합계 금액이 얼마인지 따로 표시되게
// 한거잖아". 그리고 — "결제 수단을 바꿨기 때문에 현금영수증은 자연히 취소가 되어야 하고
// 카드결제로 했으니 카드결제 금액으로 합산되어야 하는거야".
//
// 그래서 봉인은 **화면이 아니라 정본**에 있다. 종전에는 수납 등록 폼과 원터치 토글만 카드를
// 막고 나머지 세 화면은 켤 수 있었다 — 한 화면만 새면 그 record 에 표시가 남는다.
eq('신용카드는 대상이 아니다', isCashReceiptEligible('신용카드'), false)
eq('결제선생도 대상이 아니다', isCashReceiptEligible('결제선생'), false)
eq('계좌이체는 대상이다', isCashReceiptEligible('계좌이체'), true)
eq('현금은 대상이다', isCashReceiptEligible('현금'), true)
eq('기타는 대상이다', isCashReceiptEligible('기타'), true)
eq('수단을 모르면 막지 않는다', isCashReceiptEligible(null), true)

// 체크가 켜져 있어도 카드면 null 이다 — 화면이 값을 남겨 보내도 저장이 막는다(잠복 봉합).
eq('카드 + 체크 켜짐이어도 null',
  resolveCashReceiptIssuedAt({ issued: true, payMethod: '신용카드', today: TODAY, now: NOW }), null)
eq('카드 + 날짜를 고른 경우에도 null',
  resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-20', payMethod: '결제선생', today: TODAY, now: NOW }), null)
// 수단을 카드로 바꾸는 수정 경로 — 기존 발행 시각이 있어도 취소된다.
eq('카드로 바꾸면 기존 발행 시각도 지워진다',
  resolveCashReceiptIssuedAt({ issued: true, existing: EXISTING, payMethod: '신용카드', today: TODAY, now: NOW }), null)
// 카드가 아니면 종전 규칙 그대로다.
eq('계좌이체는 고른 날짜가 그대로',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-20', payMethod: '계좌이체', today: TODAY, now: NOW })),
  kst('2026-08-20T00:00:00').toISOString())
eq('계좌이체 폴백은 지금(밀리초 보존 — 적용취소가 되돌릴 값)',
  iso(resolveCashReceiptIssuedAt({ issued: true, payMethod: '계좌이체', today: TODAY, now: NOW })), NOW.toISOString())
eq('수단을 안 넘기면 종전대로 동작한다(옛 호출부 보호)',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-20', today: TODAY, now: NOW })),
  kst('2026-08-20T00:00:00').toISOString())

// 금액은 카드 합계로 넘어간다 — 카드 축은 payDate 다.
eq('카드 건은 카드 합계로',
  paymentCardMonth({ payMethod: '신용카드', payDate: day('2026-08-10') }), '2026-08')

// ── 발급 기한과 알림 자리 (2026-09-03) ──────────────────────────
//
// 기한은 받은 날부터 5일, 자진발급 감경 창은 10일이다. 알림은 그 둘로 세 자리를 만든다.
// 종전에는 대시보드가 `left <= 2` 인라인 하나로 갈랐고 이 파일은 기한을 한 건도 안 걸었다.

// 날수 셈 — 인자 둘 다 KST 달력 문자열이다.
eq('입금 당일이면 5일 남음', cashReceiptDaysLeft('2026-09-03', '2026-09-03'), 5)
eq('닷새 뒤면 오늘 마감', cashReceiptDaysLeft('2026-08-29', '2026-09-03'), 0)
eq('엿새 뒤면 하루 지남', cashReceiptDaysLeft('2026-08-28', '2026-09-03'), -1)
eq('열흘 뒤면 닷새 지남(감경 창 마지막)', cashReceiptDaysLeft('2026-08-24', '2026-09-03'), -5)
eq('열하루 뒤면 엿새 지남', cashReceiptDaysLeft('2026-08-23', '2026-09-03'), -6)

// 자리 판정 — 경계 넷을 못 박는다.
eq('3일 남으면 아직 안 뜬다', cashReceiptAlertSlot(3), 'none')
eq('2일 남으면 건별로 뜬다', cashReceiptAlertSlot(2), 'due')
eq('오늘 마감도 건별', cashReceiptAlertSlot(0), 'due')
eq('하루 지나면 감경 창', cashReceiptAlertSlot(-1), 'grace')
eq('닷새 지나도 아직 감경 창(받은 날부터 10일째)', cashReceiptAlertSlot(-5), 'grace')
eq('엿새 지나면 요약으로 접힌다', cashReceiptAlertSlot(-6), 'overdue')
eq('한참 지난 것도 요약', cashReceiptAlertSlot(-34), 'overdue')
// 임박 폭은 부르는 쪽이 정할 수 있다(ALERT_URGENT_CATEGORY_DAYS 와 맞추는 자리).
eq('임박 폭을 0 으로 주면 오늘 마감만 건별', cashReceiptAlertSlot(1, 0), 'none')
eq('임박 폭 0 에서 오늘 마감은 건별', cashReceiptAlertSlot(0, 0), 'due')

// 라벨 — 목록 둘째 줄과 알림 상세가 같은 말을 쓴다.
eq('남은 날 라벨', cashReceiptDeadlineLabel(2), '기한 2일 남음')
eq('오늘 마감 라벨', cashReceiptDeadlineLabel(0), '오늘 마감')
// '경과'는 이 앱의 알림 어휘 정본이다 — urgencyDaysOf 가 이 낱말로 긴급 존을 가른다.
eq('지난 날 라벨', cashReceiptDeadlineLabel(-3), '기한 3일 경과')

// ── 끈 건 중 살아 있는 키 ───────────────────────────────────────
// 홈의 "N건 끔"이 저장된 끈 키를 그냥 셌다. 발행했거나 기준액 미만인 건은 되살려도 알림줄로
// 안 돌아오는데도 숫자에 들어 라벨이 '다시 켜기'의 효과보다 부풀었다(신고 C-1).
// **기준은 전액이 아니라 이용료 몫(issuable)이다**(2026-09-22). 보증금·청소비는 받을 때 발행
// 대상이 아니라 알림줄에 서지 않으므로, 끈 키를 셀 때도 같은 자로 재야 라벨과 효과가 맞는다.
{
  const g = (issuable: number) => ({ issuable })
  const groups = new Map([
    ['a|2026-08-01|현금', g(500000)],
    ['b|2026-08-02|현금', g(500000)],
    ['c|2026-08-03|현금', g(1000)],
  ])
  const issued = new Set(['b|2026-08-02|현금'])
  const muted = ['a|2026-08-01|현금', 'b|2026-08-02|현금', 'c|2026-08-03|현금', 'z|2026-07-01|현금']
  eq('살아 있는 키만 남는다', liveMutedReceiptKeys(muted, groups, issued).join(','), 'a|2026-08-01|현금')
  eq('발행된 키는 죽었다', liveMutedReceiptKeys(['b|2026-08-02|현금'], groups, issued).length, 0)
  eq('기준액 미만은 죽었다', liveMutedReceiptKeys(['c|2026-08-03|현금'], groups, issued).length, 0)
  // 조회창 밖이라 그룹에 없는 키 — 되살려도 그릴 줄이 없으니 세면 안 된다.
  eq('조회창 밖 키는 죽었다', liveMutedReceiptKeys(['z|2026-07-01|현금'], groups, issued).length, 0)
  // 전액은 기준액을 넘는데 이용료 몫이 모자란 키 — 되살려도 알림줄에 안 선다.
  // 보증금 420,000 + 이용료 80,000 처럼 섞여 들어온 입금이 이 모양이다.
  const mixed = new Map([['d|2026-08-04|현금', g(80000)]])
  eq('전액 500,000 이어도 이용료 80,000 이면 죽은 키',
    liveMutedReceiptKeys(['d|2026-08-04|현금'], mixed, new Set<string>()).length, 0)
}

// ── 알림 컷오프 (운영자 오더 2026-09-06) ─────────────────────────
// "그 시점 기준으로 과거 알림을 삭제하고 더 안뜨게" — 끄기와 다른 축이다.
{
  const K = (ymd: string) => `lease1|${ymd}|현금`
  eq('컷오프가 없으면 아무것도 안 가린다', isReceiptBeforeCutoff(K('2026-08-01'), null), false)
  eq('컷오프 이전은 가린다', isReceiptBeforeCutoff(K('2026-08-31'), '2026-09-06'), true)
  // **당일은 남긴다.** 새로 생긴 의무를 소리 없이 숨기는 쪽이, 이미 본 알림이 하루 더
  // 보이는 쪽보다 나쁘다.
  eq('컷오프 당일은 남긴다', isReceiptBeforeCutoff(K('2026-09-06'), '2026-09-06'), false)
  eq('컷오프 이후는 남긴다', isReceiptBeforeCutoff(K('2026-09-07'), '2026-09-06'), false)
  // 키가 깨졌으면 안 가린다(fail-open) — 알림이 조용히 죽는 것보다 낫다.
  eq('입금일 조각이 없으면 안 가린다', isReceiptBeforeCutoff('lease1', '2026-09-06'), false)
  eq('입금일이 형식 밖이면 안 가린다', isReceiptBeforeCutoff('lease1|8월1일|현금', '2026-09-06'), false)

  // 끈 건 세기와 컷오프가 함께 걸린다 — 컷오프 이전이면서 끈 건은 되살려도 안 돌아오는 죽은 키다.
  const groups = new Map([[K('2026-08-31'), { issuable: 500000 }], [K('2026-09-07'), { issuable: 500000 }]])
  const issued = new Set<string>()
  eq('컷오프 이전 끈 건은 안 센다',
    liveMutedReceiptKeys([K('2026-08-31')], groups, issued, '2026-09-06').length, 0)
  eq('컷오프 이후 끈 건은 센다',
    liveMutedReceiptKeys([K('2026-09-07')], groups, issued, '2026-09-06').length, 1)
  eq('컷오프가 없으면 둘 다 센다',
    liveMutedReceiptKeys([K('2026-08-31'), K('2026-09-07')], groups, issued, null).length, 2)
}

// 컷오프 저장 리더 — 깨진 값은 fail-open 이다.
{
  const rows = (at: unknown) => [{ k: 'receipt:a|2026-08-01|현금', at: '2026-09-01' }, { k: 'cutoff:receipt', at }]
  eq('정상 일자를 읽는다', readAlertCutoffYmd(rows('2026-09-06'), 'receipt'), '2026-09-06')
  eq('형식 밖이면 null', readAlertCutoffYmd(rows('9월6일'), 'receipt'), null)
  eq('값이 없으면 null', readAlertCutoffYmd(rows(null), 'receipt'), null)
  eq('행이 없으면 null', readAlertCutoffYmd([{ k: 'receipt:a|2026-08-01|현금', at: '2026-09-01' }], 'receipt'), null)
  eq('배열이 아니면 null', readAlertCutoffYmd(null, 'receipt'), null)
  // 끄기 키와 컷오프 키는 문법이 달라 서로를 못 읽는다.
  eq('끄기 행을 컷오프로 오독하지 않는다', readAlertCutoffYmd([{ k: 'receipt:x', at: '2026-09-06' }], 'receipt'), null)
}

// ── 발행 줄의 생애주기 (2026-10-13 운영자 승인, 422호 신고) ─────────────────────
//
// 상태 전이 표(패널 원문 T1~T31) 중 이번에 바뀐 칸을 고정한다. 번호는 패널 원문과 같다.
// 이 판정이 조용히 되돌아가면 화면은 410,000 발행을 말하는데 합계는 420,000 을 드는 422호가 다시 선다.
{
  const D = (ymd: string) => kst(`${ymd}T00:00:00`)
  const R = (amount: number, stamp: string | null = null, isDeposit = false): CashReceiptKeyRow =>
    ({ isDeposit, actualAmount: amount, cashReceiptIssuedAt: stamp ? D(stamp) : null })
  const L = (amount: number, issued: string, deleted = false, incl = { deposit: false, cleaning: false, rent: true }): CashReceiptLineState =>
    ({ amount, issuedAt: D(issued), incl, deleted })
  const amt = (p: { kind: string; next?: CashReceiptLineTarget }) => (p.next ? p.next.amount : null)

  // 정본 식. 점검 (바)와 같은 몫. 0원 흔적·음수 조정은 '발행할 돈이 든 행'으로 안 센다.
  eq('키 몫: 이용료·보증금을 가른다', summarizeCashReceiptKey([R(410000), R(10000), R(50000, null, true)]),
    { deposit: 50000, cleaning: 0, rent: 420000, rentRows: 2, stampedRentRows: 0, unstampedRent: 420000 })
  eq('키 몫: 0원 흔적은 행으로 안 센다', summarizeCashReceiptKey([R(350000, '2026-10-06'), R(0)]).rentRows, 1)
  eq('키 몫: 음수 조정은 합에는 들고 행으로는 안 센다', summarizeCashReceiptKey([R(100000), R(-80000)]), { deposit: 0, cleaning: 0, rent: 20000, rentRows: 1, stampedRentRows: 0, unstampedRent: 100000 })
  eq('키 몫: 도장 수', summarizeCashReceiptKey([R(410000, '2026-10-06'), R(10000)]).stampedRentRows, 1)
  eq('키 몫: 아직 안 덮인 돈은 도장 없는 이용료 행의 합', summarizeCashReceiptKey([R(410000, '2026-10-06'), R(10000), R(0), R(50000, null, true)]).unstampedRent, 10000)

  // T5 켜기, 줄 없음. 키의 이용료 몫으로 새로 선다(같은 키의 다른 입금까지 한 장).
  const t5 = planCashReceiptOn(null, summarizeCashReceiptKey([R(410000), R(10000)]), D('2026-10-06'))
  eq('T5 줄 없는 켜기는 create', t5.kind, 'create')
  eq('T5 금액은 키의 이용료 몫 420,000', amt(t5), 420000)
  eq('T5 구성은 기본(이용료만)', t5.kind === 'create' ? t5.next.incl : null, { deposit: false, cleaning: false, rent: true })

  // T6 / D1 끈 뒤 다시 켜기. **옛 금액을 쓰지 않는다.** 422호: 지운 줄 420,000, 남은 이용료 410,000.
  const t6 = planCashReceiptOn(L(420000, '2026-10-06', true), summarizeCashReceiptKey([R(410000)]), D('2026-10-12'))
  eq('T6 지운 줄 다시 켜기는 rebuild', t6.kind, 'rebuild')
  eq('T6 금액은 지금 몫 410,000(옛 420,000 아님)', amt(t6), 410000)
  eq('T6 직전 줄은 지워 둔 줄', t6.kind === 'rebuild' ? t6.over : null, 'deleted')
  // 손으로 넣은 비기본 금액도 끈 뒤 켜면 기본값으로 다시 선다. 규칙 2(같은 조작의 적용취소만 복원).
  const t6m = planCashReceiptOn(L(300000, '2026-09-01', true, { deposit: true, cleaning: false, rent: true }), summarizeCashReceiptKey([R(450000)]), D('2026-10-12'))
  eq('T6 옛 구성(보증금 포함)도 안 되살린다', t6m.kind === 'rebuild' ? t6m.next.incl : null, { deposit: false, cleaning: false, rent: true })
  eq('T6 옛 금액 300,000 대신 지금 몫 450,000', amt(t6m), 450000)

  // T7 살아 있는 줄이 있는 키에서 켜기. 새 돈(도장 없는 이용료 행)만 **더한다**(독립 검수 F4, 2026-10-14).
  // 운영자 원칙 2026-08-25 '국세청에 올라간 금액은 자동으로 덮지 않는다'. 앞 발행일도 지킨다. 한 키에
  // 날짜가 하나라 새 날짜로 덮으면 앞 발행이 다른 달 합계로 옮겨 간다(검수 R3: 9월 350,000 이 10월로 갔다).
  const t7 = planCashReceiptOn(L(410000, '2026-10-06'), summarizeCashReceiptKey([R(410000, '2026-10-06'), R(10000)]), D('2026-10-12'))
  eq('T7 새 돈이 든 키는 add', t7.kind, 'add')
  eq('T7 금액은 줄 금액 + 새 돈 = 420,000', amt(t7), 420000)
  eq('T7 발행일은 앞 발행의 10/6(고른 10/12 아님)', t7.kind === 'add' ? t7.next.issuedAt.toISOString() : null, D('2026-10-06').toISOString())
  eq('T7 더한 새 돈 10,000 · 직전 410,000', t7.kind === 'add' ? [t7.added, t7.prev.amount] : null, [10000, 410000])
  // 손으로 고친 앞 금액(350,000)도 지키고 그 위에 더한다. 키 몫 전체(420,000)로 다시 세우지 않는다.
  const t7h = planCashReceiptOn(L(350000, '2026-09-30'), summarizeCashReceiptKey([R(400000, '2026-09-30'), R(20000)]), D('2026-10-02'))
  eq('T7 손 금액 350,000 + 새 돈 20,000 = 370,000 @9/30', t7h.kind === 'add' ? [amt(t7h), t7h.next.issuedAt.toISOString()] : t7h.kind, [370000, D('2026-09-30').toISOString()])
  // 키의 돈이 이미 다 덮였으면 아무것도 안 바꾼다. 발행일도 안 옮긴다(검수 R11).
  const keep = planCashReceiptOn(L(300000, '2026-10-06'), summarizeCashReceiptKey([R(450000, '2026-10-06')]), D('2026-10-08'))
  eq('T7 다 덮인 키는 keep', keep.kind, 'keep')
  eq('T7 keep 은 손으로 넣은 300,000 을 지킨다', amt(keep), 300000)
  eq('T7 keep 은 발행일도 안 옮긴다(앞 10/6 유지)', keep.kind === 'keep' ? keep.next.issuedAt.toISOString() : null, D('2026-10-06').toISOString())

  // D4 환불 확정 record 를 켤 때(재발행). 원 수납은 지워지고 도장 없는 확정액 record 만 남는다. 확정액으로 선다.
  // 재발행 표식은 서버가 그 record 의 환불 확정 메모로 준다(lib/rentRefundRecord). 새 돈을 더하는 T7 과 갈린다.
  const d4 = planCashReceiptOn(L(470000, '2026-07-18'), summarizeCashReceiptKey([R(200000)]), D('2026-10-13'), { reissue: true })
  eq('D4 환불 대기 줄에서 재발행으로 켜면 rebuild', d4.kind, 'rebuild')
  eq('D4 금액은 확정액 200,000(원 금액 470,000 아님)', amt(d4), 200000)
  eq('D4 재발행 발행일은 고른 날짜', d4.kind === 'rebuild' ? d4.next.issuedAt.toISOString() : null, D('2026-10-13').toISOString())
  // 같은 키에 환불 밖 몫(지난달분 선납)이 남아 있으면 그것까지. 재발행액은 확정액 + 딸린 몫이다.
  eq('D4 딸린 몫이 있으면 확정액 + 딸린 몫', amt(planCashReceiptOn(L(470000, '2026-07-18'), summarizeCashReceiptKey([R(200000), R(100000, '2026-07-18')]), D('2026-10-13'), { reissue: true })), 300000)

  // 0 원. 보증금만 받은 입금. 켤 수 없다(none). 종전 토글은 이때 도리어 있던 줄을 지웠다.
  eq('보증금만이면 none', planCashReceiptOn(null, summarizeCashReceiptKey([R(50000, null, true)]), D('2026-10-06')).kind, 'none')

  // D8 등록 폼 세 벌의 같은 규칙(독립 검수 F4). 이번 입금의 발행 금액(폼 값, 없으면 이번 입금의 이용료 몫)을
  // 살아 있는 줄이 있으면 **더하고**(수정 폼 합치기 T14 와 같은 덧셈) 앞 발행일을 지킨다. 없으면 이번 몫만 세운다.
  eq('D8 홀로 선 입금: 폼 금액이 이긴다', amt(planCashReceiptEntry(null, 450000, D('2026-10-06'), { amount: 300000 })), 300000)
  eq('D8 홀로 선 입금: 금액 없으면 이번 입금의 이용료 몫(입주자 상세 경로)', amt(planCashReceiptEntry(null, 450000, D('2026-10-06'), {})), 450000)
  const merge1 = planCashReceiptEntry(L(410000, '2026-10-06'), 10000, D('2026-10-07'), { amount: 10000 })
  eq('D8 살아 있는 줄이 있는 키에 두 번째 발행: merge', merge1.kind, 'merge')
  eq('D8 merge 금액은 줄 금액 + 이번 금액 = 420,000', amt(merge1), 420000)
  eq('D8 merge 발행일은 앞 발행의 10/6', merge1.kind === 'merge' ? merge1.next.issuedAt.toISOString() : null, D('2026-10-06').toISOString())
  eq('D8 merge 는 직전 줄과 더한 금액을 돌려준다', merge1.kind === 'merge' ? [merge1.prev.amount, merge1.added] : null, [410000, 10000])
  // 손으로 고친 앞 금액(350,000) 위에 이번 20,000. 국세청 350,000 + 20,000. 키 몫 420,000 으로 다시 세우지 않는다(검수 R4).
  eq('D8 손 금액 위 merge 는 덧셈 370,000', amt(planCashReceiptEntry(L(350000, '2026-09-29'), 20000, D('2026-09-29'), { amount: 20000 })), 370000)
  eq('D8 금액 없는 merge 는 이번 입금의 이용료 몫을 더한다', amt(planCashReceiptEntry(L(350000, '2026-09-29'), 20000, D('2026-09-29'), {})), 370000)
  // 발행 없이 받은 앞 입금(도장 없는 행)이 있어도 이번 몫만 세운다. 앞 돈은 '아직 안 덮인 돈'으로 남는다(검수 R4b).
  const r4b = planCashReceiptEntry(null, 100000, D('2026-09-28'), { amount: 100000 })
  eq('D8 줄 없는 키: 이번 몫 100,000 만 create(앞 300,000 안 덮음)', [r4b.kind, amt(r4b)], ['create', 100000])
  eq('D8 지워 둔 줄만 있으면 rebuild(옛 금액 안 씀)', amt(planCashReceiptEntry(L(999000, '2026-09-01', true), 410000, D('2026-10-07'), {})), 410000)
  eq('D8 0원이면 none', planCashReceiptEntry(null, 0, D('2026-10-07'), {}).kind, 'none')
  eq('D8 살아 있는 줄이 있어도 이번 금액이 0 이면 none', planCashReceiptEntry(L(410000, '2026-10-06'), 0, D('2026-10-07'), {}).kind, 'none')

  // D2 삭제. 형제가 남으면 금액을 자동으로 안 덮고 남은 몫을 돌려준다. 마지막 이용료면 줄을 내린다.
  const d2 = planCashReceiptRemoval(L(420000, '2026-10-06'), summarizeCashReceiptKey([R(410000, '2026-10-06')]))
  eq('D2 형제가 남는 삭제는 keep', d2.kind, 'keep')
  eq('D2 금액은 그대로 420,000, 남은 몫 410,000', d2.kind === 'keep' ? [d2.amount, d2.basis] : null, [420000, 410000])
  eq('T16 마지막 이용료 삭제는 drop', planCashReceiptRemoval(L(410000, '2026-10-12'), summarizeCashReceiptKey([])).kind, 'drop')
  // 보증금만 남은 키. 종전에는 보증금까지 형제로 세어 줄이 살아 남았다.
  eq('T17 보증금만 남으면 drop', planCashReceiptRemoval(L(440000, '2026-08-22'), summarizeCashReceiptKey([R(50000, null, true)])).kind, 'drop')
  eq('T17 줄이 보증금을 든 예외 발행이면 keep', planCashReceiptRemoval(L(490000, '2026-08-22', false, { deposit: true, cleaning: false, rent: true }), summarizeCashReceiptKey([R(50000, '2026-08-22', true)])).kind, 'keep')
  eq('줄이 없으면 none', planCashReceiptRemoval(null, summarizeCashReceiptKey([])).kind, 'none')
  eq('지워 둔 줄도 none', planCashReceiptRemoval(L(1, '2026-01-01', true), summarizeCashReceiptKey([])).kind, 'none')
  // D10 예약 선납 취소·분해 수납 적용취소도 같은 판정이다. 그 키의 이용료가 다 사라지면 drop.
  eq('D10 선납 취소로 키가 비면 drop(유령 줄 금지)', planCashReceiptRemoval(L(350000, '2026-09-30'), summarizeCashReceiptKey([])).kind, 'drop')

  // 수납 수정(updatePayment). 같은 키.
  const P = (rows: CashReceiptKeyRow[]) => summarizeCashReceiptKey(rows)
  const edit = (a: Partial<Parameters<typeof planCashReceiptEdit>[0]>) => planCashReceiptEdit({
    moved: false, stampBefore: null, stampAfter: null,
    oldKey: { line: null, partsAfter: P([]) }, newKey: { line: null, parts: P([]) }, ...a,
  })
  eq('T12 수정 폼에서 끄면 키 전체 off', edit({ stampBefore: D('2026-10-06'), newKey: { line: L(420000, '2026-10-06'), parts: P([R(410000, '2026-10-06'), R(10000, '2026-10-06')]) } }).next.kind, 'off')
  eq('T11 금액만 고친 재저장은 redate(금액 보호)', edit({ stampBefore: D('2026-10-06'), stampAfter: D('2026-10-06'), newKey: { line: L(300000, '2026-10-06'), parts: P([R(450000, '2026-10-06')]) } }).next.kind, 'redate')
  const t13 = edit({ stampAfter: D('2026-10-12'), newKey: { line: L(420000, '2026-10-06', true), parts: P([R(410000), R(10000)]) } })
  eq('T13 지운 줄에 수정 폼으로 켜면 새 발행', t13.next.kind === 'on' ? t13.next.plan.kind : t13.next.kind, 'rebuild')
  eq('T13 금액은 키 몫(행 몫이 아니다)', t13.next.kind === 'on' ? amt(t13.next.plan) : null, 420000)
  eq('둘 다 꺼짐이면 none', edit({}).next.kind, 'none')

  // D13 입금일·수단 이동. 옛 키에 다른 이용료가 남으면 옛 줄을 지키고 이 돈은 옛 영수증 안에 둔다.
  const d13keep = edit({
    moved: true, stampBefore: D('2026-10-06'), stampAfter: D('2026-10-06'),
    oldKey: { line: L(420000, '2026-10-06'), partsAfter: P([R(410000, '2026-10-06')]) },
    newKey: { line: null, parts: P([R(10000, '2026-10-06')]) },
  })
  eq('D13 형제가 남은 옛 키는 keep(종전에는 지웠다)', d13keep.old.kind, 'keep')
  eq('D13 옮긴 수납은 도장만 지운다(두 번 세지 않는다)', d13keep.next.kind, 'unstamp')
  // 옛 줄이 이 수납만 덮고 있었으면 발행이 함께 옮겨 간다. 금액·구성 유지.
  const d13move = edit({
    moved: true, stampBefore: D('2026-10-06'), stampAfter: D('2026-10-07'),
    oldKey: { line: L(300000, '2026-10-06'), partsAfter: P([]) },
    newKey: { line: null, parts: P([R(450000, '2026-10-06')]) },
  })
  eq('D13 홀로 선 수납을 옮기면 transfer', d13move.next.kind, 'transfer')
  eq('D13 transfer 는 손으로 넣은 300,000 을 지킨다', d13move.next.kind === 'transfer' ? d13move.next.next.amount : null, 300000)
  // 옮긴 자리에 이미 살아 있는 줄이 있으면 두 금액을 합친다(한 장 규칙, 발행 금액이 사라지지 않게).
  const d13merge = edit({
    moved: true, stampBefore: D('2026-10-06'), stampAfter: D('2026-10-06'),
    oldKey: { line: L(10000, '2026-10-06'), partsAfter: P([]) },
    newKey: { line: L(410000, '2026-10-05'), parts: P([R(410000, '2026-10-05'), R(10000, '2026-10-06')]) },
  })
  eq('D13 발행 있는 키로 옮기면 merge', d13merge.next.kind, 'merge')
  eq('D13 merge 금액 420,000 · 발행일은 그 키의 것', d13merge.next.kind === 'merge' ? [d13merge.next.next.amount, d13merge.next.next.issuedAt.toISOString()] : null, [420000, D('2026-10-05').toISOString()])
  eq('D13 옮기며 끄면 옛 키만 정리하고 새 키는 none', edit({ moved: true, stampBefore: D('2026-10-06'), oldKey: { line: L(10000, '2026-10-06'), partsAfter: P([]) } }).next.kind, 'none')
  eq('D13 옮기며 처음 켜면 새 키에 새 발행', edit({ moved: true, stampAfter: D('2026-10-07'), newKey: { line: null, parts: P([R(10000)]) } }).next.kind, 'on')

  // ── 적용취소 스냅샷 ─────────────────────────────────────────
  const S = (amount: number, issued: string, deleted = false, id = 'L1'): CashReceiptLineSnap =>
    ({ id, amount, issuedAt: D(issued).toISOString(), inclDeposit: false, inclCleaning: false, inclRent: true, deleted })
  const line = (before: CashReceiptLineSnap | null, after: CashReceiptLineSnap | null) =>
    ({ leaseTermId: 'lt', payYmd: '2026-10-06', payMethod: '계좌이체', before, after })
  const iso = (ymd: string) => D(ymd).toISOString()
  const undoOff = buildCashReceiptUndo(
    [line(S(420000, '2026-10-06'), S(420000, '2026-10-06', true))],
    new Map([['a', iso('2026-10-06')], ['b', iso('2026-10-06')]]),
    new Map([['a', null], ['b', null]]),
  )
  eq('끄기 스냅샷은 줄과 도장 둘을 싣는다', [undoOff.lines.length, undoOff.stamps.length], [1, 2])
  eq('바뀌지 않은 키·도장은 안 싣는다(뜬 키 범위만 남는다)', buildCashReceiptUndo([line(S(1, '2026-10-06'), S(1, '2026-10-06'))], new Map([['a', null]]), new Map([['a', null]])),
    { v: 1, keys: [{ leaseTermId: 'lt', payYmd: '2026-10-06', payMethod: '계좌이체' }], lines: [], stamps: [] })
  // 그 사이 아무 일 없으면 되돌린다.
  eq('지금이 쓴 직후와 같으면 충돌 없음', cashReceiptUndoConflict(undoOff, { lines: [S(420000, '2026-10-06', true)], stamps: new Map([['a', null], ['b', null]]) }), null)
  // 그 사이 다시 켰으면(다른 금액으로 살아 있음) 덮지 않는다. 옛 토스트의 적용취소가 새 발행을 지우면 안 된다.
  eq('그 사이 줄이 되살아났으면 충돌', cashReceiptUndoConflict(undoOff, { lines: [S(410000, '2026-10-12')], stamps: new Map([['a', null], ['b', null]]) }), 'line')
  eq('그 사이 도장이 바뀌었으면 충돌', cashReceiptUndoConflict(undoOff, { lines: [S(420000, '2026-10-06', true)], stamps: new Map([['a', iso('2026-10-12')], ['b', null]]) }), 'stamp')
  eq('도장 대상 record 가 없으면 충돌', cashReceiptUndoConflict(undoOff, { lines: [S(420000, '2026-10-06', true)], stamps: new Map([['a', null]]) }), 'stamp')
  // 켜기 스냅샷. 쓴 직후가 살아 있는 줄이면 지금도 같은 내용이어야 한다(금액을 수정 폼에서 바꿨으면 충돌).
  const undoOn = buildCashReceiptUndo([line(null, S(410000, '2026-10-12'))], new Map([['a', null]]), new Map([['a', iso('2026-10-12')]]))
  eq('켜기 뒤 금액이 바뀌었으면 충돌', cashReceiptUndoConflict(undoOn, { lines: [S(400000, '2026-10-12')], stamps: new Map([['a', iso('2026-10-12')]]) }), 'line')
  eq('켜기 뒤 그대로면 충돌 없음', cashReceiptUndoConflict(undoOn, { lines: [S(410000, '2026-10-12')], stamps: new Map([['a', iso('2026-10-12')]]) }), null)
  // 화면을 거쳐 돌아온 값의 모양 검사. 모양이 틀리면 아무것도 안 쓴다.
  eq('정상 스냅샷은 통과', parseCashReceiptUndo(JSON.parse(JSON.stringify(undoOff))) != null, true)
  eq('버전이 다르면 거부', parseCashReceiptUndo({ ...undoOff, v: 2 }), null)
  eq('금액이 음수면 거부', parseCashReceiptUndo({ v: 1, lines: [line(S(-1, '2026-10-06'), null)], stamps: [] }), null)
  eq('입금일 형식이 틀리면 거부', parseCashReceiptUndo({ v: 1, lines: [{ ...line(null, null), payYmd: '10/6' }], stamps: [] }), null)
  eq('같은 줄 비교는 시각을 밀리초로 본다', sameCashReceiptLine(S(1, '2026-10-06'), { ...S(1, '2026-10-06'), issuedAt: '2026-10-05T15:00:00Z' }), true)
  // 위조 토큰의 구조 검사(독립 검수 W4). 서명과 상관없이 늘 지킨다.
  eq('키 범위가 없으면 거부', parseCashReceiptUndo({ v: 1, lines: [], stamps: [] }), null)
  eq('줄이 키 범위 밖이면 거부', parseCashReceiptUndo({ ...undoOff, keys: [{ leaseTermId: 'other', payYmd: '2026-10-06', payMethod: '계좌이체' }] }), null)
  eq('한 줄의 쓰기 전·쓴 직후 id 가 다르면 거부', parseCashReceiptUndo({ ...undoOff, lines: [line(S(420000, '2026-10-06', false, 'L1'), S(420000, '2026-10-06', true, 'L2'))] }), null)
  const many = Array.from({ length: CASH_RECEIPT_UNDO_MAX_STAMPS + 1 }, (_, i) => ({ id: `r${i}`, before: null, after: null }))
  eq('도장 개수 상한을 넘으면 거부', parseCashReceiptUndo({ ...undoOff, stamps: many }), null)
  eq('서명이 문자열이 아니면 거부', parseCashReceiptUndo({ ...undoOff, sig: 1 }), null)
  // 서명 정본 문자열은 화면을 오가며 바뀌는 표기(객체 키 순서·날짜 표기)에 흔들리지 않는다.
  const reordered = JSON.parse(JSON.stringify({ stamps: undoOff.stamps, lines: undoOff.lines, keys: undoOff.keys, v: 1 }))
  reordered.lines[0].before.issuedAt = '2026-10-06T00:00:00+09:00'
  eq('정본 문자열은 키 순서·날짜 표기와 무관', canonicalCashReceiptUndo(reordered), canonicalCashReceiptUndo(undoOff))
  eq('정본 문자열은 금액이 바뀌면 달라진다', canonicalCashReceiptUndo({ ...undoOff, lines: [line(S(9990000, '2026-10-06'), S(420000, '2026-10-06', true))] }) === canonicalCashReceiptUndo(undoOff), false)
}

// ── 422호 시퀀스 회귀 (운영자 신고 2026-10-13) ────────────────────────────
//
// 한 키에 줄 하나·record 여럿을 들고 서버 엔진(writeCrKey)과 같은 도장 규칙으로 판정을 차례로 적용한다.
// 420,000 한 결제가 410,000(10월분)과 10,000(11월분 선납)으로 쪼개졌다. 원터치로 켬(10/6),
// 10,000 삭제, 끔, 10/12 로 다시 켬. 종전 결과는 420,000(옛 줄 부활), 정답은 410,000 이다.
{
  type Rec = { id: string; isDeposit: boolean; actualAmount: number; cashReceiptIssuedAt: Date | null; deleted: boolean }
  const D = (ymd: string) => kst(`${ymd}T00:00:00`)
  const st = { line: null as CashReceiptLineState | null, recs: [] as Rec[] }
  const live = () => st.recs.filter(r => !r.deleted)
  const parts = () => summarizeCashReceiptKey(live())
  // writeCrKey 의 'key' 도장 규칙과 같다. 켜면 금액이 든 이용료 행 전부가 줄 발행일, 내리면 null.
  const write = (next: CashReceiptLineTarget | null) => {
    st.line = next ? { ...next, deleted: false } : (st.line ? { ...st.line, deleted: true } : null)
    for (const r of live()) {
      if (r.isDeposit) r.cashReceiptIssuedAt = next && next.incl.deposit ? next.issuedAt : null
      else r.cashReceiptIssuedAt = next && r.actualAmount > 0 ? next.issuedAt : null
    }
  }
  const on = (ymd: string) => { const p = planCashReceiptOn(st.line, parts(), D(ymd)); if (p.kind !== 'none') write(p.next); return p }
  const off = () => write(null)
  const del = (id: string) => {
    st.recs.find(r => r.id === id)!.deleted = true
    const p = planCashReceiptRemoval(st.line, parts())
    if (p.kind === 'drop') write(null)
    return p
  }
  st.recs.push({ id: 'oct', isDeposit: false, actualAmount: 410000, cashReceiptIssuedAt: null, deleted: false })
  st.recs.push({ id: 'nov', isDeposit: false, actualAmount: 10000, cashReceiptIssuedAt: null, deleted: false })

  on('2026-10-06')
  eq('422 ① 분할 결제 켜기: 한 줄 420,000', st.line?.amount, 420000)
  eq('422 ① 두 행 모두 10/6 도장', st.recs.map(r => r.cashReceiptIssuedAt?.toISOString()), [D('2026-10-06').toISOString(), D('2026-10-06').toISOString()])
  const r2 = del('nov')
  eq('422 ② 형제 삭제: 줄은 그대로 420,000(자동으로 안 덮음)', st.line?.amount, 420000)
  eq('422 ② 그 대신 남은 몫 410,000 과 다르다고 말한다', r2.kind === 'keep' ? [r2.amount, r2.basis] : null, [420000, 410000])
  off()
  eq('422 ③ 끄기: 줄 내림', st.line?.deleted, true)
  eq('422 ③ 도장도 지움', live().map(r => r.cashReceiptIssuedAt), [null])
  const r4 = on('2026-10-12')
  eq('422 ④ 다시 켜기는 새 발행(rebuild over deleted)', r4.kind === 'rebuild' ? r4.over : r4.kind, 'deleted')
  eq('422 ④ 결과 410,000', st.line?.amount, 410000)
  eq('422 ④ 발행일 10/12', st.line?.issuedAt.toISOString(), D('2026-10-12').toISOString())
  eq('422 ④ 남은 행 도장 10/12(행과 줄이 같은 말을 한다)', live().map(r => r.cashReceiptIssuedAt?.toISOString()), [D('2026-10-12').toISOString()])
}

// ── 화면 문장 정본 (2026-10-13 422호 2단계, lib/cashReceiptCopy) ─────────────────────
//
// 수납 행은 받은 금액과 '발행'만 말해 420,000 발행이 410,000 발행으로 읽혔다. 행·탭·폼·토스트가 같은 사실을
// 같은 글자로 말하는지 글자 단위로 고정한다. **기준은 행 금액이 아니라 키의 이용료 합이다.** 기준을 행 금액으로
// 되돌리면 아래 분할 결제 두 줄(410,000 행 · 10,000 행)이 거짓 경보를 내며 붉게 선다.
{
  const LV = (amount: number, issuedYmd = '2026-10-06', incl: Partial<{ inclDeposit: boolean; inclCleaning: boolean }> = {}) =>
    ({ amount, issuedYmd, inclDeposit: false, inclCleaning: false, inclRent: true, ...incl })
  const K = (line: ReturnType<typeof LV> | null, rent: number, rentRows: number, stampedRentRows = rentRows) => ({ line, rent, rentRows, stampedRentRows })
  const cap = (stamped: boolean, key: ReturnType<typeof K> | null) => {
    const c = cashReceiptRowCaption({ stamped, key })
    return c ? [c.tone, crCaptionText(c)] : null
  }
  eq('캡션: 같으면 침묵', cap(true, K(LV(410000), 410000, 1)), null)
  eq('캡션: 발행 표시 없는 행은 침묵', cap(false, K(LV(420000), 410000, 1)), null)
  eq('캡션: 422 삭제 뒤 받은 금액보다 많음', cap(true, K(LV(420000), 410000, 1)), ['warning', '발행 금액 420,000원 · 받은 금액보다 10,000원 많음'])
  eq('캡션: 적음', cap(true, K(LV(400000), 410000, 1)), ['warning', '발행 금액 400,000원 · 받은 금액보다 10,000원 적음'])
  eq('캡션: 분할 결제 키는 합계와 비교(행 금액 아님)', cap(true, K(LV(430000), 420000, 2)), ['warning', '발행 금액 430,000원 · 같은 날 입금 2건 합계보다 10,000원 많음'])
  eq('캡션: 같고 합산이면 보조색으로 합산을 말함', cap(true, K(LV(420000), 420000, 2)), ['muted', '발행 금액 420,000원 · 같은 날 입금 2건 합산'])
  eq('캡션: 보증금 포함은 숫자 없이', cap(true, K(LV(1410000, '2026-10-06', { inclDeposit: true }), 410000, 1)), ['warning', '발행 금액 1,410,000원 · 보증금 포함'])
  eq('캡션: 청소비 포함', cap(true, K(LV(430000, '2026-10-06', { inclCleaning: true }), 410000, 1)), ['warning', '발행 금액 430,000원 · 청소비 포함'])
  eq('캡션: 보증금·청소비 포함', cap(true, K(LV(480000, '2026-10-06', { inclDeposit: true, inclCleaning: true }), 410000, 1)), ['warning', '발행 금액 480,000원 · 보증금·청소비 포함'])
  eq('캡션: 도장만 있고 줄 없음(방어)', cap(true, K(null, 410000, 1)), ['danger', '발행 표시만 있고 발행 기록이 없음 · 합계에 안 듦'])
  eq('캡션: 키 정보 자체가 없어도 방어', cap(true, null), ['danger', '발행 표시만 있고 발행 기록이 없음 · 합계에 안 듦'])
  const parts = cashReceiptRowCaption({ stamped: true, key: K(LV(420000), 410000, 1) })!
  eq('캡션: 덩이 둘, 숫자만 강조', parts.chunks.map(ch => ch.map(p => (p.strong ? `[${p.text}]` : p.text)).join('')), ['발행 금액 [420,000원]', '· 받은 금액보다 [10,000원] 많음'])
  // 긴 문장은 주어와 비교를 갈라 셋째 덩이를 둔다(320px·아주 크게에서 한 덩이가 행보다 넓었다). 비교어·금액은 한 덩이다.
  const split = cashReceiptRowCaption({ stamped: true, key: K(LV(1230000), 1350000, 2) })!
  eq('캡션: 합계 비교는 덩이 셋', split.chunks.map(ch => ch.map(p => (p.strong ? `[${p.text}]` : p.text)).join('')), ['발행 금액 [1,230,000원]', '· 같은 날 입금 2건', '합계보다 [120,000원] 적음'])
  eq('캡션: 위험 문장도 덩이 셋', cashReceiptRowCaption({ stamped: true, key: K(null, 1, 1) })!.chunks.map(ch => ch.map(p => p.text).join('')), ['발행 표시만 있고', '발행 기록이 없음', '· 합계에 안 듦'])

  eq('탭: 다르면 받은 금액을 숫자로', cashReceiptTabGap({ amount: 420000, received: 410000, rentRows: 1, inclDeposit: false, inclCleaning: false }),
    { tone: 'warning', units: ['받은 금액', '410,000원보다', '10,000원 많음'], text: '받은 금액 410,000원보다 10,000원 많음' })
  eq('탭: 적음', cashReceiptTabGap({ amount: 400000, received: 410000, rentRows: 1, inclDeposit: false, inclCleaning: false })?.text, '받은 금액 410,000원보다 10,000원 적음')
  eq('탭: 같고 합산', cashReceiptTabGap({ amount: 420000, received: 420000, rentRows: 2, inclDeposit: false, inclCleaning: false }), { tone: 'muted', units: ['같은 날 2건 합산'], text: '같은 날 2건 합산' })
  eq('탭: 같고 한 건이면 침묵', cashReceiptTabGap({ amount: 420000, received: 420000, rentRows: 1, inclDeposit: false, inclCleaning: false }), null)
  eq('탭: 예외 몫이면 행이 이미 말하므로 침묵', cashReceiptTabGap({ amount: 470000, received: 420000, rentRows: 1, inclDeposit: true, inclCleaning: false }), null)

  // 두 폼(등록·수정)이 글자까지 같은 문장(PaymentEntryForm 의 '받은 금액 …보다 … 많습니다.').
  eq('폼 문장: 많습니다', cashReceiptGapSentence(420000, 410000), '받은 금액 410,000원보다 10,000원 많습니다.')
  eq('폼 문장: 적습니다', cashReceiptGapSentence(400000, 410000), '받은 금액 410,000원보다 10,000원 적습니다.')
  eq('폼 문장: 같으면 null', cashReceiptGapSentence(410000, 410000), null)

  eq('켜기 확인 줄 add 캡션', crAddPreviewChunks({ amount: 350000, issuedYmd: '2026-09-30' }, 20000), ['기존 발행 350,000원(9/30)에 20,000원 더함', '· 발행일 9/30 유지'])

  const onT = (change: 'create' | 'rebuild' | 'add' | 'keep', line: ReturnType<typeof LV> | null, added?: { added: number; issuedYmd: string }) =>
    crOnToast({ change, line, ...(added ? { added } : {}) }, '2026-10-12')
  eq('켜기 토스트: 발행일·금액', onT('rebuild', LV(410000, '2026-10-12')), { kind: 'success', message: '현금영수증 발행으로 표시했습니다 · 발행일 10/12 · 410,000원', undoable: true })
  eq('켜기 토스트: add 는 지킨 앞 발행일과 더한 돈', onT('add', LV(370000, '2026-09-30'), { added: 20000, issuedYmd: '2026-09-30' }),
    { kind: 'success', message: '현금영수증 발행으로 표시했습니다 · 발행일 9/30 · 370,000원', undoable: true, detail: '기존 발행에 20,000원을 더했습니다. 발행일은 9/30 그대로입니다.' })
  const keepT = onT('keep', LV(420000))
  eq('켜기 토스트: keep 은 성공이 아니고 적용취소도 없다', [keepT.kind, keepT.undoable, keepT.message], ['info', false, '이미 같은 날 발행에 들어 있습니다'])

  eq('끄기 토스트: 발행월 합계에서 빠지는 금액', crOffToastDetail(LV(420000, '2026-10-06'), 1), '10월 발행 합계에서 420,000원이 빠집니다. 홈택스에 발행한 영수증은 그대로입니다.')
  eq('끄기 토스트: 합산 키', crOffToastDetail(LV(420000, '2026-09-30'), 2), '9월 발행 합계에서 같은 날 2건 합산 420,000원이 빠집니다. 홈택스 영수증은 그대로입니다.')
  eq('끄기 토스트: 줄 없던 도장', crOffToastDetail(null, 1), '발행 기록이 없던 표시라 발행 합계는 그대로입니다.')
  // §16 형식 "{목적어}를 적용취소했습니다 · {복귀}"(감지망 check-undo-verb).
  eq('적용취소 결과: 켜기', CR_ON_UNDONE, '현금영수증 발행 표시를 적용취소했습니다 · 미발행으로 복귀')
  eq('적용취소 결과: 끄기', crOffUndoneMessage({ amount: 420000 }), '발행 표시 해제를 적용취소했습니다 · 발행 420,000원으로 복귀')
  eq('적용취소 결과: 삭제', CR_DELETE_UNDONE, '수납 기록 삭제를 적용취소했습니다 · 원래 자리로 복귀')
  eq('적용취소 결과: 차이 알림', crUndoMismatchDetail([{ lineAmount: 420000, basis: 410000 }]), '발행 금액 420,000원이 받은 금액 410,000원과 다릅니다.')

  eq('삭제 확인창: drop', crDeleteConfirmLine({ effect: 'drop', line: { amount: 350000 }, basisAfter: 0 }),
    '이 입금의 현금영수증 발행 기록 350,000원도 함께 지웁니다. 홈택스에 발행한 영수증은 그대로라 필요하면 홈택스에서 취소합니다.')
  eq('삭제 확인창: keep 이고 달라짐', crDeleteConfirmLine({ effect: 'keep', line: { amount: 420000 }, basisAfter: 410000 }),
    '같은 날 받은 수납과 묶인 현금영수증 발행 420,000원은 그대로 남습니다. 삭제 뒤 발행 금액을 확인해 주세요.')
  eq('삭제 확인창: keep 이어도 금액이 그대로 맞으면 침묵', crDeleteConfirmLine({ effect: 'keep', line: { amount: 410000 }, basisAfter: 410000 }), null)
  eq('삭제 확인창: none 은 침묵', crDeleteConfirmLine({ effect: 'none', line: null, basisAfter: 0 }), null)
  eq('삭제 토스트: drop', crDeleteToastDetail({ dropped: [{ amount: 350000 }], mismatch: [] }), '현금영수증 발행 기록 350,000원도 함께 지웠습니다.')
  eq('삭제 토스트: keep', crDeleteToastDetail({ dropped: [], mismatch: [{ lineAmount: 420000 }] }), '남은 수납의 현금영수증 발행 420,000원은 그대로입니다.')
  eq('삭제 토스트: 아무 일 없음', crDeleteToastDetail({ dropped: [], mismatch: [] }), undefined)
  eq('삭제 적용취소: 되살림 + 차이', crRestoreDetail({ revived: [{ amount: 350000 }], mismatch: [{ lineAmount: 420000, basis: 410000 }] }),
    '현금영수증 발행 기록 350,000원도 되살렸습니다. 발행 금액 420,000원이 받은 금액 410,000원과 다릅니다.')

  const E = (x: Partial<Parameters<typeof crEditToastDetail>[0] & object>) => ({ line: null, mismatch: [], ...x })
  const O = (x: Partial<Parameters<typeof crEditToastDetail>[1]> = {}) => ({ moved: false, wasStamped: true, nowStamped: true, amountEdited: false, beforeAmount: 420000, ...x })
  eq('수정 토스트: 발행 금액 전환(값 전환 화살표)', crEditToastDetail(E({ line: { amount: 410000, issuedYmd: '2026-10-12' } }), O()), '현금영수증 발행 금액 420,000원 → 410,000원')
  eq('수정 토스트: 금액 그대로면 침묵', crEditToastDetail(E({ line: { amount: 420000, issuedYmd: '2026-10-12' } }), O()), undefined)
  eq('수정 토스트: 옮겨 합쳐지면 고친 금액은 안 썼다고 먼저 말함', crEditToastDetail(E({ merged: { prevAmount: 300000, amount: 700000 }, line: { amount: 700000, issuedYmd: '2026-10-06' } }), O({ moved: true, amountEdited: true })),
    '입금일·수단을 옮겨 고친 발행 금액은 쓰지 않았습니다.')
  eq('수정 토스트: merge', crEditToastDetail(E({ merged: { prevAmount: 300000, amount: 700000 }, line: { amount: 700000, issuedYmd: '2026-10-06' } }), O({ moved: true })),
    '옮긴 날의 발행과 합침 · 발행 금액 300,000원 → 700,000원')
  eq('수정 토스트: transfer', crEditToastDetail(E({ transferred: { amount: 250000 } }), O({ moved: true })), '현금영수증 발행 250,000원도 함께 옮겼습니다.')
  eq('수정 토스트: unstamp 는 한 문장(차이는 남은 행 캡션이 말한다)', crEditToastDetail(E({ unstamped: true, mismatch: [{ lineAmount: 420000, basis: 410000 }] }), O({ moved: true })),
    '이 입금은 원래 날의 발행에 들어 있어 발행 표시만 뺐습니다.')
  eq('수정 토스트: add', crEditToastDetail(E({ added: { prevAmount: 300000, added: 50000, amount: 350000, issuedYmd: '2026-10-03' } }), O({ wasStamped: false, beforeAmount: 300000 })),
    '기존 발행에 50,000원을 더했습니다. 발행일은 10/3 그대로입니다.')
  eq('수정 토스트: 새로 켬', crEditToastDetail(E({ line: { amount: 410000, issuedYmd: '2026-10-12' } }), O({ wasStamped: false, beforeAmount: null })), '현금영수증 발행 410,000원을 기록했습니다 · 발행일 10/12')
  eq('수정 토스트: 발행 없이 받은 행을 그대로 두면 형제의 발행을 제 것처럼 말하지 않는다', crEditToastDetail(E({ line: { amount: 410000, issuedYmd: '2026-10-06' } }), O({ wasStamped: false, nowStamped: false, beforeAmount: 410000 })), undefined)
  eq('수정 토스트: 끔', crEditToastDetail(E({}), O({ nowStamped: false })), '현금영수증 발행 기록 420,000원을 내렸습니다.')
  eq('수정 토스트: 금액만 고친 재저장의 차이', crEditToastDetail(E({ line: { amount: 420000, issuedYmd: '2026-10-06' }, mismatch: [{ lineAmount: 420000, basis: 400000 }] }), O()), '발행 금액 420,000원이 받은 금액 400,000원과 다릅니다.')
  eq('수정 토스트: 이용료 몫 없음은 서버 문장의 첫 문장', crEditToastDetail(E({ notIssued: '이용료 몫이 없어 발행할 금액이 0원입니다. 보증금·청소비는 받을 때 현금영수증 대상이 아닙니다.' }), O()), '이용료 몫이 없어 발행할 금액이 0원입니다.')
}

console.log(`[현금영수증 발행일] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
