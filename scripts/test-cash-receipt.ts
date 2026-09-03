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
import { cashReceiptAlertSlot, cashReceiptDaysLeft, cashReceiptDeadlineLabel, cashReceiptDefaultAmount, cashReceiptMonth, isCashReceiptEligible, paymentCardMonth, resolveCashReceiptIssuedAt, liveMutedReceiptKeys } from '../lib/cashReceipt'

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

// 막는 것은 미래 하나뿐 — 아직 안 한 발행이라 국세청에 있을 수가 없다. 폴백으로 떨어진다.
eq('미래 날짜는 폴백',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-25', today: TODAY, now: NOW })), NOW.toISOString())
eq('미래 날짜 + 기존 값이면 기존 값 보존',
  iso(resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-12-31', existing: EXISTING, today: TODAY, now: NOW })),
  EXISTING.toISOString())
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
{
  const g = (amount: number) => ({ amount })
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
}

console.log(`[현금영수증 발행일] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
