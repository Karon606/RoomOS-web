// 희망 매칭 회귀 테스트 — 실행: npx tsx scripts/test-wish-match.ts
// 방 축(어느 방에 누가)과 사람 축(누구에게 어느 방)은 같은 한 판정의 두 얼굴이다.
// 둘이 갈라지면 홈 알림과 고객 상세가 서로 다른 말을 한다 — 그 전치 항등식을 여기서 고정한다.
// 함께 고정하는 것: 날짜 게이트 4종, 사람 축 방 정렬, 미루기 권고 7일 등급, 줄 캡션 문자열.

import {
  buildWishMatch,
  wishDateGate,
  wishRoomFromLabel,
  wishLeaseRoomCaption,
  wishDelayHint,
  DELAY_HINT_DAYS,
  GAP_CAP_DAYS,
} from '../lib/wishMatch'
import type { RoomAvailability } from '../lib/leaseStatus'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const TODAY = '2026-08-11'

const soon = (availableFrom: string): RoomAvailability => ({ kind: 'soon', availableFrom })
const now = (): RoomAvailability => ({ kind: 'now' })

type Rooms = Parameters<typeof buildWishMatch>[0]
type Leases = Parameters<typeof buildWishMatch>[1]

const room = (roomNo: string, availability: RoomAvailability, extra: Partial<Rooms[number]> = {}): Rooms[number] => ({
  roomNo, roomId: `r-${roomNo}`, type: '1인실', floor: roomNo.slice(0, 1), windowType: '외창',
  direction: '남향', baseRent: 500000, availability, ...extra,
})

const lease = (
  id: string, tenantName: string,
  o: { wishRooms?: string; wishConditions?: string; moveInDate?: string | null; moveInFlexible?: boolean | null; status?: string },
): Leases[number] => ({
  id, status: o.status ?? 'TOUR_DONE',
  wishRooms: o.wishRooms ?? null, wishConditions: o.wishConditions ?? null,
  moveInDate: o.moveInDate ?? null, moveInFlexible: o.moveInFlexible ?? null,
  keepAlertAfterInquiry: false, reservationConfirmedAt: null,
  inquiryAt: `2026-08-0${id.length}T00:00:00.000Z`, createdAt: '2026-08-01T00:00:00.000Z',
  tenant: { id: `t-${id}`, name: tenantName }, room: null,
})

// ── 날짜 게이트 4종 ── 후보에서 빠지는 것은 excluded 하나뿐이다.
{
  eq('게이트: 지금 빈 방은 언제 들어오든 ok', wishDateGate(now(), '2026-08-25', false), { gate: 'ok', waitDays: 0 })
  eq('게이트: 희망일이 입주 가능일 이후면 ok', wishDateGate(soon('2026-08-18'), '2026-08-25', null), { gate: 'ok', waitDays: 0 })
  eq('게이트: 늦게 비고 조절 가능하면 flexible', wishDateGate(soon('2026-08-30'), '2026-08-25', true), { gate: 'flexible', waitDays: 5 })
  eq('게이트: 늦게 비고 안 물어봤으면 unconfirmed', wishDateGate(soon('2026-08-30'), '2026-08-25', null), { gate: 'unconfirmed', waitDays: 5 })
  eq('게이트: 늦게 비고 그 날짜여야 하면 excluded', wishDateGate(soon('2026-08-30'), '2026-08-25', false), { gate: 'excluded', waitDays: 5 })
  eq('게이트: 희망일 없으면 unconfirmed(대기 0)', wishDateGate(soon('2026-08-30'), null, false), { gate: 'unconfirmed', waitDays: 0 })
  // 30일 상한은 조절 가능 여부보다 앞선다 — 한 달 넘게 기다리라는 연락은 매칭이 아니다.
  eq('게이트: 30일 경계는 남는다', wishDateGate(soon('2026-09-24'), '2026-08-25', true).gate, 'flexible')
  eq('게이트: 31일부터 excluded', wishDateGate(soon('2026-09-25'), '2026-08-25', true).gate, 'excluded')
  eq('게이트: 상한 상수', GAP_CAP_DAYS, 30)
}

// ── 실물 형태 픽스처 ── 문의 고객 한 명이 일곱 방을 희망한 모양(티니 유형).
const ROOMS: Rooms = [
  room('402', soon('2026-08-30')),
  room('404', soon('2026-09-30')),
  room('409', soon('2026-08-18')),
  room('413', soon('2026-08-16')),
  room('513', soon('2026-10-01')),
  room('514', soon('2026-09-10')),
  room('522', soon('2026-09-21')),
  room('101', now()),
]
const LEASES: Leases = [
  lease('L1', '일곱방', { wishRooms: '409,413,402,514,522,513,404', moveInDate: '2026-08-25' }),
  lease('L2', '조절가능', { wishRooms: '402', moveInDate: '2026-08-25', moveInFlexible: true }),
  lease('L3', '그날짜만', { wishRooms: '402,404', moveInDate: '2026-08-25', moveInFlexible: false }),
  lease('L4', '날짜없음', { wishRooms: '402', moveInDate: null }),
  lease('L5', '지금가능', { wishRooms: '101,402', moveInDate: '2026-08-25' }),
]
const M = buildWishMatch(ROOMS, LEASES, TODAY)

// ── 전치 항등식 ── 방 축을 펼친 (leaseId, roomNo, gate) 집합 == 사람 축을 펼친 집합.
{
  const flat = (xs: string[]) => [...xs].sort()
  const fromRooms = flat(M.rooms.flatMap(r => r.candidates.map(c => `${c.leaseId}|${r.roomNo}|${c.gate}`)))
  const fromLeases = flat(M.leases.flatMap(l => l.rooms.map(r => `${l.leaseId}|${r.roomNo}|${r.gate}`)))
  eq('전치: 두 축의 (계약·호실·게이트) 집합이 같다', fromLeases, fromRooms)
  eq('전치: 통과 칸 수가 같다', fromLeases.length, fromRooms.length)
  // 제외도 두 축이 같은 수를 센다 — 한쪽만 세면 "제외 N명"과 "제외 N실"이 갈린다.
  eq('전치: 제외 합계가 같다',
    M.leases.reduce((s, l) => s + l.excludedCount, 0),
    M.rooms.reduce((s, r) => s + r.excludedCount, 0))
  // 사람 축은 방 축에 있는 계약을 하나도 흘리지 않는다. 다만 방 축 후보 목록에는 통과자만 남으므로,
  // 통과 방이 하나도 없는 사람(전부 날짜 제외)은 사람 축에만 있다 — 그 차집합이 곧 noDateFitLeaseIds 다.
  eq('전치: 통과 방이 있는 계약 집합이 같다',
    M.leases.filter(l => l.rooms.length > 0).map(l => l.leaseId).sort(),
    [...new Set(M.rooms.flatMap(r => r.candidates.map(c => c.leaseId)))].sort())
  eq('전치: 사람 축에만 있는 계약 = 전부 제외된 사람',
    M.leases.filter(l => l.rooms.length === 0).map(l => l.leaseId).sort(),
    [...M.noDateFitLeaseIds].sort())
  // noDateFitLeaseIds 는 새 구조에서 파생된 값이다 — 종전 정의(전부 제외)와 같아야 한다.
  eq('전치: 전부 날짜 제외인 사람', M.noDateFitLeaseIds, ['L3'])
  eq('전치: 방 축 결과 불변(방 수)', M.rooms.map(r => r.roomNo), ['101', '402', '404', '409', '413', '513', '514', '522'])
}

// ── 사람 축 정렬 ── ok 먼저, 그 안에서 대기 짧은 순, 동률은 호실번호 순.
{
  const l1 = M.leases.find(l => l.leaseId === 'L1')!
  eq('정렬: ok 먼저 · 대기 오름차순 · 동률 호실번호',
    l1.rooms.map(r => `${r.roomNo}/${r.gate}/${r.waitDays}`),
    ['409/ok/0', '413/ok/0', '402/unconfirmed/5', '514/unconfirmed/16', '522/unconfirmed/27'])
  eq('정렬: 30일 넘는 방은 제외 수로만', l1.excludedCount, 2)
  eq('정렬: 사람 축도 희망일을 들고 있다', l1.wishMoveIn, '2026-08-25')

  const l5 = M.leases.find(l => l.leaseId === 'L5')!
  eq('정렬: 지금 빈 방이 늦게 비는 방보다 앞', l5.rooms.map(r => r.roomNo), ['101', '402'])
  eq('정렬: 지금 빈 방은 ok', l5.rooms[0].gate, 'ok')

  const l4 = M.leases.find(l => l.leaseId === 'L4')!
  eq('정렬: 희망일 없는 사람은 대기 0 unconfirmed', l4.rooms.map(r => `${r.roomNo}/${r.gate}/${r.waitDays}`), ['402/unconfirmed/0'])

  const l3 = M.leases.find(l => l.leaseId === 'L3')!
  eq('정렬: 전부 빠진 사람은 통과 방 0실', l3.rooms.length, 0)
  eq('정렬: 전부 빠진 사람의 제외 수', l3.excludedCount, 2)

  eq('정렬: 방 id 를 함께 들고 온다', l1.rooms[0].roomId, 'r-409')
}

// ── 줄 캡션 문자열 ──
{
  eq('캡션: 지금 빈 방', wishRoomFromLabel(now()), '공실')
  eq('캡션: 날짜 잡힌 방', wishRoomFromLabel(soon('2026-08-18')), '8/18부터')
  eq('캡션: 한 자리 달', wishRoomFromLabel(soon('2026-09-01')), '9/1부터')
  eq('캡션: 대기 없으면 날짜만', wishLeaseRoomCaption({ availability: soon('2026-08-18'), waitDays: 0 }), '8/18부터')
  eq('캡션: 대기 있으면 며칠 늦음', wishLeaseRoomCaption({ availability: soon('2026-08-30'), waitDays: 5 }), '8/30부터 · 5일 늦음')
}

// ── 미루기 권고 7일 등급 ── 지금 바로 갈 방 0실 + 최단 대기 7일 이하일 때만.
{
  eq('권고: 상수', DELAY_HINT_DAYS, 7)
  const l2 = M.leases.find(l => l.leaseId === 'L2')!
  eq('권고: 조절 가능한 사람 문구',
    wishDelayHint(l2.rooms),
    '402호는 희망일보다 5일 늦게 비지만 일정 조절이 가능한 분입니다.')
  const l4 = M.leases.find(l => l.leaseId === 'L4')!
  eq('권고: 대기 0(희망일 없음)이면 없음', wishDelayHint(l4.rooms), '')
  const l1 = M.leases.find(l => l.leaseId === 'L1')!
  eq('권고: 바로 가능한 방이 있으면 없음', wishDelayHint(l1.rooms), '')
  eq('권고: 방이 없으면 없음', wishDelayHint([]), '')

  // 경계 — 7일은 권고, 8일은 침묵. 후보 집합은 그대로 남는다(권고는 문구 등급일 뿐이다).
  const bound = (availableFrom: string) => buildWishMatch(
    [room('402', soon(availableFrom))],
    [lease('B1', '경계', { wishRooms: '402', moveInDate: '2026-08-25' })],
    TODAY,
  ).leases[0]
  const at7 = bound('2026-09-01')
  eq('권고: 7일 경계는 문구가 나온다',
    wishDelayHint(at7.rooms),
    '402호는 희망일보다 7일 늦게 빕니다. 일정을 조절할 수 있는지 확인해 주세요.')
  const at8 = bound('2026-09-02')
  eq('권고: 8일부터 침묵', wishDelayHint(at8.rooms), '')
  eq('권고: 8일이어도 후보에는 남는다', at8.rooms.map(r => `${r.roomNo}/${r.waitDays}`), ['402/8'])
}

console.log(`\n희망 매칭 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
