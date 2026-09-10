// 퇴실 적용취소 진리표 — 실행: npx tsx scripts/test-checkout-revert.ts
//
// 여기서 고정하는 것 넷.
//   ① 목적지. 퇴실 예정일이 없거나 지났으면 거주중, 아직 남았으면 퇴실 예정. 경계(오늘)는 거주중이다.
//   ② 차단. 보증금 반환 기록 · 이용료 환불 스냅샷이 있으면 상태만 무를 수 없고, 문장은 각자의 것이다.
//   ③ 전이 허용. 투어 완료·입실 처리·퇴실의 되돌림을 서버 전이표가 이미 허용한다(화면에만 문이 없었다).
//   ④ 사유 승계. 되돌림 행이 퇴실 사유를 들고 있어야 다음 퇴실이 이어받는다 —
//      inheritableCheckoutReason 은 CHECKED_OUT 행을 만나면 거기서 null 로 멈춘다.
import {
  checkoutRevertTarget, checkoutRevertBlock, checkoutRevertBlockMessage,
  CHECKOUT_REVERT_LABEL, CHECKOUT_REVERT_REASON, DEPOSIT_REFUND_LOCKED,
  CHECKOUT_REVERT_ROOM_OCCUPIED,
} from '../lib/checkoutRevert'
import { RENT_REFUND_LOCKED } from '../lib/rentRefundRecord'
import { canTransition } from '../lib/leaseTransitions'
import { inheritableCheckoutReason } from '../lib/checkoutReason'
import { roomNoWithI } from '../lib/roomNo'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const TODAY = '2026-09-10'

// ── ① 목적지 ── 예정일 세 갈래 × 경계
eq('예정일 없음 → 거주중', checkoutRevertTarget({ expectedMoveOut: null }, TODAY), 'ACTIVE')
eq('예정일 지남 → 거주중', checkoutRevertTarget({ expectedMoveOut: '2026-08-31' }, TODAY), 'ACTIVE')
eq('예정일 어제 → 거주중', checkoutRevertTarget({ expectedMoveOut: '2026-09-09' }, TODAY), 'ACTIVE')
eq('예정일 오늘 → 거주중(경계)', checkoutRevertTarget({ expectedMoveOut: TODAY }, TODAY), 'ACTIVE')
eq('예정일 내일 → 퇴실 예정', checkoutRevertTarget({ expectedMoveOut: '2026-09-11' }, TODAY), 'CHECKOUT_PENDING')
eq('예정일 남음 → 퇴실 예정', checkoutRevertTarget({ expectedMoveOut: '2026-10-19' }, TODAY), 'CHECKOUT_PENDING')
// 달·해가 바뀌어도 문자열 비교가 날짜 순서와 같다(YYYY-MM-DD 고정폭).
eq('해 넘김도 사전순으로 맞는다', checkoutRevertTarget({ expectedMoveOut: '2027-01-02' }, '2026-12-31'), 'CHECKOUT_PENDING')
eq('라벨 — 거주중', CHECKOUT_REVERT_LABEL.ACTIVE, '거주중')
eq('라벨 — 퇴실 예정', CHECKOUT_REVERT_LABEL.CHECKOUT_PENDING, '퇴실 예정')

// ── ② 차단 ── 반환 기록 유무 × 환불 스냅샷 유무 × 호실 점유
const noSnap = null
const snap = { refund: { refunded: 0, prepaid: 300000, month: '2026-09' } }
const SELF = 'lease-self'
// 되돌리는 그 계약 자신은 늘 호실 목록에 들어 있다(퇴실 완료 상태로). 점유로 세면 전건이 막힌다.
const self = { id: SELF, status: 'CHECKED_OUT', moveInDate: null }
const block = (o: { depo?: boolean; snapshot?: unknown; rooms?: { id: string; status: string; moveInDate?: Date | string | null }[] } = {}) =>
  checkoutRevertBlock({
    leaseTermId: SELF,
    hasDepositRefund: o.depo ?? false,
    checkoutProrationUndo: o.snapshot ?? noSnap,
    roomLeases: o.rooms ?? [self],
  })

eq('셋 다 없음 → 통과', block(), null)
eq('보증금 반환만 → 차단', block({ depo: true }), 'depositRefund')
eq('환불 스냅샷만 → 차단', block({ snapshot: snap }), 'rentRefund')
eq('돈 둘 다 → 보증금이 먼저(다음 손이 짧다)', block({ depo: true, snapshot: snap }), 'depositRefund')
// 스냅샷이 아닌 일할 되돌림 값만 있는 계약은 막지 않는다(hasRentRefundSnapshot 는 refund 키만 본다).
eq('일할 undo 만 있으면 통과', block({ snapshot: { amount: 12000 } }), null)

// 이중 점유 — OCCUPYING_STATUSES 정본(거주중·퇴실 예정·입실 예약)이 판정한다.
eq('본인 계약만 있으면 통과', block({ rooms: [self] }), null)
eq('호실 없음(빈 목록)도 통과', block({ rooms: [] }), null)
eq('다른 거주 계약 → 차단', block({ rooms: [self, { id: 'x', status: 'ACTIVE', moveInDate: null }] }), 'roomOccupied')
eq('다른 예약 계약 → 차단', block({ rooms: [self, { id: 'x', status: 'RESERVED', moveInDate: null }] }), 'roomOccupied')
eq('다른 퇴실 예정 계약 → 차단', block({ rooms: [self, { id: 'x', status: 'CHECKOUT_PENDING', moveInDate: null }] }), 'roomOccupied')
// 방을 안 잡는 상태는 막지 않는다 — 비거주는 명의만 있고 그 방에 살지 않는다(roomVacantForStatus 와 같은 편).
eq('다른 비거주 계약은 통과', block({ rooms: [self, { id: 'x', status: 'NON_RESIDENT', moveInDate: null }] }), null)
eq('다른 퇴실 완료 계약은 통과', block({ rooms: [self, { id: 'x', status: 'CHECKED_OUT', moveInDate: null }] }), null)
eq('다른 입실 취소 계약은 통과', block({ rooms: [self, { id: 'x', status: 'CANCELLED', moveInDate: null }] }), null)
eq('같은 id 가 둘이어도 자기 자신은 빠진다', block({ rooms: [self, { id: SELF, status: 'ACTIVE', moveInDate: null }] }), null)
// 돈이 먼저다 — 셋 다 걸려도 첫 문장은 보증금이다.
eq('셋 다 → 보증금이 먼저', block({ depo: true, snapshot: snap, rooms: [self, { id: 'x', status: 'ACTIVE', moveInDate: null }] }), 'depositRefund')
eq('환불 + 점유 → 환불이 먼저', block({ snapshot: snap, rooms: [self, { id: 'x', status: 'ACTIVE', moveInDate: null }] }), 'rentRefund')

// 문장은 두 길(전환 액션·수정 폼)이 같은 것을 쓴다. 이용료 쪽은 기존 잠금 상수 그대로다.
eq('보증금 차단 문장', checkoutRevertBlockMessage('depositRefund'), DEPOSIT_REFUND_LOCKED)
eq('이용료 차단 문장은 기존 잠금 상수', checkoutRevertBlockMessage('rentRefund'), RENT_REFUND_LOCKED)
eq('이중 점유 차단 문장', checkoutRevertBlockMessage('roomOccupied'), CHECKOUT_REVERT_ROOM_OCCUPIED)
eq('보증금 문장이 다음 손을 말한다', DEPOSIT_REFUND_LOCKED.includes('보증금 카드'), true)
eq('점유 문장이 다음 손을 말한다', CHECKOUT_REVERT_ROOM_OCCUPIED.includes('먼저 정리한 뒤'), true)

// ── ③ 전이 허용 ── 서버 전이표가 세 되돌림을 이미 허용한다
eq('투어 완료 → 투어 대기', canTransition('TOUR_DONE', 'WAITING_TOUR'), true)
eq('거주중 → 입실 예약', canTransition('ACTIVE', 'RESERVED'), true)
eq('퇴실 완료 → 거주중', canTransition('CHECKED_OUT', 'ACTIVE'), true)
eq('퇴실 완료 → 퇴실 예정', canTransition('CHECKED_OUT', 'CHECKOUT_PENDING'), true)
// 뜻이 안 서는 되돌림은 그대로 막힌다 — 되돌림을 연다고 전이표가 열리는 것이 아니다.
eq('퇴실 완료 → 투어 대기는 여전히 막힘', canTransition('CHECKED_OUT', 'WAITING_TOUR'), false)
eq('퇴실 완료 → 입실 예약도 막힘', canTransition('CHECKED_OUT', 'RESERVED'), false)

// ── ④ 사유 승계 ── 되돌림 행이 사유를 들고 있어야 다음 퇴실이 이어받는다
const row = (fromStatus: string, toStatus: string, reason: string | null) => ({ fromStatus, toStatus, reason, deletedAt: null })
// 되돌림 행이 퇴실 완료 행의 사유를 실은 경우(구현이 하는 일).
eq('되돌림 행이 사유를 실으면 이어받는다', inheritableCheckoutReason([
  row('CHECKED_OUT', 'CHECKOUT_PENDING', '개인 사정'),
  row('CHECKOUT_PENDING', 'CHECKED_OUT', '개인 사정'),
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
]), '개인 사정')
// 안 실었으면 CHECKED_OUT 행에서 멈춘다 — 이 진리표가 지키는 바로 그 함정이다.
eq('되돌림 행이 표식만 들면 사유가 끊긴다', inheritableCheckoutReason([
  row('CHECKED_OUT', 'CHECKOUT_PENDING', CHECKOUT_REVERT_REASON),
  row('CHECKOUT_PENDING', 'CHECKED_OUT', '개인 사정'),
  row('ACTIVE', 'CHECKOUT_PENDING', '개인 사정'),
]), null)
// 거주중으로 되돌린 경우는 예정 자체가 접힌 것이라 이어받을 사유가 없는 것이 옳다.
eq('거주중 복귀는 사유를 안 잇는다', inheritableCheckoutReason([
  row('CHECKED_OUT', 'ACTIVE', CHECKOUT_REVERT_REASON),
  row('CHECKOUT_PENDING', 'CHECKED_OUT', '개인 사정'),
]), null)
// 퇴실 완료 행에 사유가 없던 계약은 표식만 남고, 이어받을 것도 없다.
eq('사유 없던 퇴실은 표식만', inheritableCheckoutReason([
  row('CHECKED_OUT', 'CHECKOUT_PENDING', CHECKOUT_REVERT_REASON),
  row('CHECKOUT_PENDING', 'CHECKED_OUT', null),
]), null)
eq('표식 문구', CHECKOUT_REVERT_REASON, '퇴실 적용취소')

// ── ⑤ 확인창 주어 ── 호실번호가 숫자만이 아니다(제기역점 '사무실')
eq('숫자 호실', roomNoWithI('413'), '413호가')
eq('숫자 호실 — 종성 있는 소리', roomNoWithI('406'), '406호가')
eq("'사무실'", roomNoWithI('사무실'), '사무실이')
eq("'옥탑방'", roomNoWithI('옥탑방'), '옥탑방이')
eq("'A동-3'", roomNoWithI('A동-3'), 'A동-3이')
eq("'A동-2'", roomNoWithI('A동-2'), 'A동-2가')

console.log(`\n퇴실 적용취소 진리표: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
