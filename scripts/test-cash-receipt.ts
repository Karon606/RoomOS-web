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
import { paymentAggregateBucket, resolveCashReceiptIssuedAt } from '../lib/cashReceipt'

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

// ── 읽기: 월 버킷 판정 ────────────────────────────────────────────

// 같은 날 발행 — 두 축이 같은 답을 낸다. 평소에는 이 케이스라 축을 바꿔도 숫자가 안 움직인다.
eq('같은 날 발행', paymentAggregateBucket({
  payMethod: '계좌이체', payDate: day('2026-08-05'), cashReceiptIssuedAt: kst('2026-08-05T14:30:00'),
}), { bucket: 'cashReceipt', month: '2026-08' })

// 지연 발행 — 이번 신고의 실제 모양이다. 7/31 에 받은 돈을 8/22 에 몰아서 발행했다.
// payDate 축이면 2026-07 로 가고 홈택스와 안 맞는다. 발행일 축이라 2026-08 이다.
eq('지연 발행(7/31 입금·8/22 발행)', paymentAggregateBucket({
  payMethod: '계좌이체', payDate: day('2026-07-31'), cashReceiptIssuedAt: kst('2026-08-22T11:00:00'),
}), { bucket: 'cashReceipt', month: '2026-08' })

// ── KST 자정 경계 — 이 판정의 급소 ──────────────────────────────
// KST 9/1 00:30 은 UTC 로 8/31 15:30 이다. UTC 달로 읽으면 8월로 떨어진다.
eq('KST 월 첫날 새벽 발행', paymentAggregateBucket({
  payMethod: '현금', payDate: day('2026-08-20'), cashReceiptIssuedAt: kst('2026-09-01T00:00:00'),
}), { bucket: 'cashReceipt', month: '2026-09' })
eq('KST 월 첫날 00:30 발행', paymentAggregateBucket({
  payMethod: '현금', payDate: day('2026-08-20'), cashReceiptIssuedAt: kst('2026-09-01T00:30:00'),
}), { bucket: 'cashReceipt', month: '2026-09' })
// KST 8/31 23:59 은 UTC 로 8/31 14:59 — 이쪽은 UTC 로 읽어도 8월이라 종전 코드도 맞았다.
// 한쪽만 걸면 반쪽 그물이 되므로 양끝을 함께 건다.
eq('KST 월 말일 23:59 발행', paymentAggregateBucket({
  payMethod: '현금', payDate: day('2026-08-20'), cashReceiptIssuedAt: kst('2026-08-31T23:59:59'),
}), { bucket: 'cashReceipt', month: '2026-08' })
// 연 경계도 같은 함정이다.
eq('KST 새해 첫날 새벽 발행', paymentAggregateBucket({
  payMethod: '현금', payDate: day('2026-12-20'), cashReceiptIssuedAt: kst('2027-01-01T00:10:00'),
}), { bucket: 'cashReceipt', month: '2027-01' })

// ── 발행 안 됨 · 카드 ─────────────────────────────────────────────

eq('발행 안 됨', paymentAggregateBucket({
  payMethod: '계좌이체', payDate: day('2026-08-05'), cashReceiptIssuedAt: null,
}), { bucket: null, month: null })

// 카드는 축이 다르다 — 매출전표가 결제 시점에 성립하므로 payDate 다.
eq('카드', paymentAggregateBucket({
  payMethod: '신용카드', payDate: day('2026-08-05'), cashReceiptIssuedAt: null,
}), { bucket: 'card', month: '2026-08' })
eq('결제선생도 카드 계열', paymentAggregateBucket({
  payMethod: '결제선생', payDate: day('2026-07-15'), cashReceiptIssuedAt: null,
}), { bucket: 'card', month: '2026-07' })
// 카드 우선 — 카드 건에 발행 표시가 켜져 있어도 양쪽에 계상하지 않는다(520호 172,000원 전례).
eq('카드 + 발행표시는 카드 하나로', paymentAggregateBucket({
  payMethod: '신용카드', payDate: day('2026-07-15'), cashReceiptIssuedAt: kst('2026-08-22T11:00:00'),
}), { bucket: 'card', month: '2026-07' })
// payDate 도 @db.Date(UTC 자정)라 UTC 로 읽는 것이 맞다. 말일 카드 건이 다음 달로 새면 안 된다.
eq('카드 말일 결제', paymentAggregateBucket({
  payMethod: '신용카드', payDate: day('2026-08-31'), cashReceiptIssuedAt: null,
}), { bucket: 'card', month: '2026-08' })
eq('수단 미기재 + 발행표시', paymentAggregateBucket({
  payMethod: null, payDate: day('2026-08-05'), cashReceiptIssuedAt: kst('2026-08-22T11:00:00'),
}), { bucket: 'cashReceipt', month: '2026-08' })

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
// 그 값이 다시 버킷 판정을 지나면 고른 날의 달이어야 한다(쓰기와 읽기가 짝인지 확인).
eq('고른 날짜가 그 달로 간다', paymentAggregateBucket({
  payMethod: '계좌이체', payDate: day('2026-07-31'),
  cashReceiptIssuedAt: resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-08-22', today: TODAY, now: NOW }),
}), { bucket: 'cashReceipt', month: '2026-08' })
// 월 첫날을 고르면 그 달이다 — KST 자정으로 박으므로 UTC 로는 전달 15:00Z 다. 되읽기가 짝이어야 한다.
eq('월 첫날을 고르면 그 달', paymentAggregateBucket({
  payMethod: '계좌이체', payDate: day('2026-08-15'),
  cashReceiptIssuedAt: resolveCashReceiptIssuedAt({ issued: true, issuedDate: '2026-09-01', today: '2026-09-05', now: NOW }),
}), { bucket: 'cashReceipt', month: '2026-09' })

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

console.log(`[현금영수증 발행일] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
