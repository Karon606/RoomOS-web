// 퇴실 공실 전환·예약 인상가 조기 적용 진리표 — 실행: npx tsx scripts/test-checkout-vacancy.ts
//
// 2026-10-01 513호. 퇴실 처리가 10/5 입주 예약이 걸린 방을 공실로 덮었다. 여기서 고정하는 것 셋.
//   ① 점유 정의. 거주중·퇴실 예정·입실 예약이 방을 잡는다. 비거주·퇴실·취소·리드는 안 잡는다.
//      자기 계약은 뺀다(roomStillOccupied 의 exceptLeaseId).
//   ② 조기 적용. 방이 실제로 빌 때만, 운영자 답이 '적용 안 함'이 아닐 때만 앞당긴다.
//   ③ 세 경로 동일. 홈 알림(checkoutTenant)·프리즘(applyStatusTransition)·수정 폼(updateTenant)이
//      다음 예약 있음 / 없음 / 비거주 공존에서 같은 공실 답을 낸다. 세 경로가 모두 같은 정본
//      (applyCheckoutSideEffects)을 부르는 것은 소스 그물(check-checkout-side-effects ⓑ·ⓑ')이 지킨다.
import { shouldApplyScheduledRentOnCheckout } from '../lib/roomOccupancy'
import { OCCUPYING_STATUSES } from '../lib/leaseStatus'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

type L = { id: string; status: string }
// roomStillOccupied 의 where 를 메모리로 옮긴 것 — 같은 상태 집합(OCCUPYING_STATUSES)을 읽는다.
const occupiedExcept = (leases: L[], exceptId: string) =>
  leases.some(l => l.id !== exceptId && (OCCUPYING_STATUSES as string[]).includes(l.status))

// ① 점유 정의
eq('점유 상태 집합', [...OCCUPYING_STATUSES].sort(), ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED'])
for (const st of ['NON_RESIDENT', 'CHECKED_OUT', 'CANCELLED', 'WAITING_TOUR', 'TOUR_DONE']) {
  eq(`${st} 는 방을 안 잡는다`, occupiedExcept([{ id: 'x', status: st }], 'me'), false)
}
eq('자기 계약은 빼고 본다', occupiedExcept([{ id: 'me', status: 'ACTIVE' }], 'me'), false)

// ② 조기 적용 진리표
const R = 400000
const table: [boolean, number | null, boolean | undefined, boolean][] = [
  // occupied, scheduledRent, 운영자 답, 앞당기는가
  [false, R, undefined, true],
  [false, R, true, true],
  [false, R, false, false],
  [false, null, undefined, false],
  [false, null, true, false],
  [true, R, undefined, false],
  [true, R, true, false],   // 답이 '적용'이어도 다음 예약자가 있으면 정본 날짜 적용에 맡긴다
  [true, R, false, false],
  [true, null, undefined, false],
]
for (const [occupied, scheduledRent, operatorAnswer, want] of table) {
  eq(`조기 적용 occupied=${occupied} rent=${scheduledRent} 답=${operatorAnswer}`,
    shouldApplyScheduledRentOnCheckout({ occupied, scheduledRent, operatorAnswer }), want)
}

// ③ 세 경로 × 세 시나리오 — 퇴실하는 계약 me 가 이미 CHECKED_OUT 으로 쓰인 뒤의 방.
const scenarios: { name: string; leases: L[]; vacant: boolean }[] = [
  { name: '다음 예약 있음', leases: [{ id: 'me', status: 'CHECKED_OUT' }, { id: 'next', status: 'RESERVED' }], vacant: false },
  { name: '다음 예약 없음', leases: [{ id: 'me', status: 'CHECKED_OUT' }], vacant: true },
  { name: '비거주 공존', leases: [{ id: 'me', status: 'CHECKED_OUT' }, { id: 'nr', status: 'NON_RESIDENT' }], vacant: true },
  { name: '룸메이트 거주', leases: [{ id: 'me', status: 'CHECKED_OUT' }, { id: 'mate', status: 'ACTIVE' }], vacant: false },
]
// 경로별 운영자 답. 수정 폼은 방을 잡은 다른 계약이 있으면 확인창을 안 띄워(답 없음) 서버 기본에 맡긴다.
const paths: { name: string; answer: (held: boolean) => boolean | undefined }[] = [
  { name: '홈 알림(checkoutTenant)', answer: () => undefined },
  { name: '프리즘(applyStatusTransition)', answer: () => undefined },
  { name: '수정 폼(updateTenant) 답 없음', answer: () => undefined },
  { name: '수정 폼(updateTenant) 네', answer: held => held ? undefined : true },
]
for (const sc of scenarios) {
  const results = paths.map(p => {
    const occupied = occupiedExcept(sc.leases, 'me')
    return {
      isVacant: !occupied,
      early: shouldApplyScheduledRentOnCheckout({ occupied, scheduledRent: R, operatorAnswer: p.answer(occupied) }),
    }
  })
  for (const [i, r] of results.entries()) {
    eq(`${sc.name} · ${paths[i].name} 공실`, r.isVacant, sc.vacant)
    eq(`${sc.name} · ${paths[i].name} 조기 적용`, r.early, sc.vacant)
  }
}
// 수정 폼에서 '아니오'(변경 예정일에 자동 적용)를 고르면 빈 방이어도 앞당기지 않는다.
eq('수정 폼 아니오 · 빈 방', shouldApplyScheduledRentOnCheckout({ occupied: false, scheduledRent: R, operatorAnswer: false }), false)

console.log(`[퇴실 공실 전환] ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
