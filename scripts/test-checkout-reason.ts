// 퇴실 사유 승계 회귀 테스트 — 실행: npx tsx scripts/test-checkout-reason.ts
//
// 여기서 고정하는 것: 퇴실 예정 때 고른 사유가 퇴실 처리로 이어지고(506호 신고 2026-09-02),
// 시스템 라벨·무효 행·끝난 예정 구간의 옛 사유는 이어지지 않는다. 판정이 순수 함수라
// 세 화면(홈 알림·프리즘·수정 폼)이 같은 답을 쓴다.
import { inheritableCheckoutReason } from '../lib/checkoutReason'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}
const row = (fromStatus: string, toStatus: string, reason: string | null, deletedAt: Date | null = null) => ({ fromStatus, toStatus, reason, deletedAt })

// 506호 패턴 — 퇴실 예정에 적은 사유를 퇴실 처리가 이어받는다.
eq('퇴실 예정 사유 승계', inheritableCheckoutReason([
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
  row('RESERVED', 'ACTIVE', null),
]), '개인 사정')
eq("'기타 · 내용' 도 그대로", inheritableCheckoutReason([row('ACTIVE', 'CHECKOUT_PENDING', '기타 · 고향으로')]), '기타 · 고향으로')
eq('사유 없이 예정만 잡았으면 null', inheritableCheckoutReason([row('ACTIVE', 'CHECKOUT_PENDING', null)]), null)
eq('빈 이력', inheritableCheckoutReason([]), null)

// 413호 패턴 — 예정일만 다시 저장한 from === to 행이 최신이어도 사유를 찾는다.
eq('재저장 행이 최신', inheritableCheckoutReason([
  row('CHECKOUT_PENDING', 'CHECKOUT_PENDING', '계약 위반'),
  row('ACTIVE', 'CHECKOUT_PENDING', '계약 위반'),
]), '계약 위반')
eq('재저장 행은 사유 없고 원 전이에 있음', inheritableCheckoutReason([
  row('CHECKOUT_PENDING', 'CHECKOUT_PENDING', null),
  row('ACTIVE', 'CHECKOUT_PENDING', '요금 미납'),
]), '요금 미납')

// 시스템 라벨은 사유가 아니다.
eq('자동 전환 라벨은 건너뜀', inheritableCheckoutReason([row('ACTIVE', 'CHECKOUT_PENDING', '퇴실 한 달 전 자동 전환')]), null)
eq('단기 자동 전환 라벨도', inheritableCheckoutReason([row('ACTIVE', 'CHECKOUT_PENDING', '단기 자동 전환')]), null)
eq('자동 전환 뒤 운영자가 적은 사유', inheritableCheckoutReason([
  row('CHECKOUT_PENDING', 'CHECKOUT_PENDING', 'LH선정'),
  row('ACTIVE', 'CHECKOUT_PENDING', '퇴실 한 달 전 자동 전환'),
]), 'LH선정')

// 끝난 예정 구간의 옛 사유는 안 이어진다.
eq('연장으로 거주중 복귀 뒤', inheritableCheckoutReason([
  row('CHECKOUT_PENDING', 'ACTIVE', '단기 연장'),
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
]), null)
eq('이미 퇴실한 계약', inheritableCheckoutReason([
  row('CHECKOUT_PENDING', 'CHECKED_OUT', null),
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
]), null)
eq('등록 행(from === to, 예정 아님)은 지나감', inheritableCheckoutReason([
  row('WAITING_TOUR', 'WAITING_TOUR', null),
  row('ACTIVE', 'CHECKOUT_PENDING', '직장·학교 이동'),
]), '직장·학교 이동')

// 무효 처리된 행은 없던 일이다.
eq('무효 행 건너뜀', inheritableCheckoutReason([
  row('ACTIVE', 'CHECKOUT_PENDING', '가격 부담', new Date('2026-09-01')),
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
]), '개인 사정')
eq('무효 행이 다른 전이여도 멈추지 않음', inheritableCheckoutReason([
  row('CHECKOUT_PENDING', 'CHECKED_OUT', null, new Date('2026-09-01')),
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
]), '개인 사정')

console.log(`\n퇴실 사유 승계 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
