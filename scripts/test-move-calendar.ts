// 입퇴실 캘린더 조립 회귀 테스트 — 실행: npx tsx scripts/test-move-calendar.ts
//
// 여기서 고정하는 것: 월 창 클리핑(월 밖으로 이어지는 쪽), 퇴실일 선택(퇴실 완료는 실제일),
// 행 정렬(첫 변동일 · 동률은 호실번호), 층 배치(같은 날 인수인계는 층이 갈린다),
// 충돌 3종의 대상 집합(퇴실 완료 계약은 방을 잡지 않는다), 다음 달 예약 꼬리, 빈 달.
//
// 케이스는 2026-08 실데이터에서 가져왔다 — 409호(8/17 퇴실 + 9/8 후지이 미나미), 404호(예약 이어 붙임),
// 413호(같은 날 퇴실·입주), 509호(퇴실 예정일과 실제 퇴실일이 하루 다름), 503호(월 경계 관통).

import { buildMoveCalendar, daysInMonth, type MoveCalendarLease } from '../lib/moveCalendar'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const MONTH = '2026-08'
const TODAY = '2026-08-18'

let seq = 0
function lease(p: Partial<MoveCalendarLease> & { roomNo: string; status: string }): MoveCalendarLease {
  seq++
  return {
    id: p.id ?? `l${seq}`,
    status: p.status,
    isShortTerm: p.isShortTerm ?? false,
    moveInDate: p.moveInDate ?? null,
    moveOutDate: p.moveOutDate ?? null,
    expectedMoveOut: p.expectedMoveOut ?? null,
    roomId: p.roomId ?? `room-${p.roomNo}`,
    roomNo: p.roomNo,
    tenantId: p.tenantId ?? `t${seq}`,
    tenantName: p.tenantName ?? `사람${seq}`,
  }
}

const build = (changed: MoveCalendarLease[], context: MoveCalendarLease[] = [], month = MONTH, today = TODAY) =>
  buildMoveCalendar({ month, today, changed, context })

// ── 달의 일수 ──
eq('8월은 31일', daysInMonth('2026-08'), 31)
eq('2월 평년은 28일', daysInMonth('2026-02'), 28)
eq('2월 윤년은 29일', daysInMonth('2028-02'), 29)

// ── 409호 ── 8/11 입주·8/17 퇴실, 다음 예약은 9/8 이라 트랙 밖 꼬리로 선다.
{
  const exit = lease({ id: '409-exit', roomNo: '409', status: 'CHECKOUT_PENDING', moveInDate: '2026-08-11', expectedMoveOut: '2026-08-17', tenantName: '서종희' })
  const next = lease({ id: '409-next', roomNo: '409', status: 'RESERVED', moveInDate: '2026-09-08', tenantName: '후지이 미나미' })
  const out = build([exit], [exit, next])
  eq('409 · 행 하나', out.rows.length, 1)
  const row = out.rows[0]
  eq('409 · 막대 하나(9월 예약은 이 달 막대가 아니다)', row.bars.length, 1)
  eq('409 · 구간', [row.bars[0].startDay, row.bars[0].endDay], [11, 17])
  eq('409 · 양끝 모두 이 달 안', [row.bars[0].clippedStart, row.bars[0].clippedEnd], [false, false])
  eq('409 · 라벨', row.bars[0].label, '8/11 입실 · 8/17 퇴실')
  eq('409 · 첫 변동일', row.firstChangeDay, 11)
  eq('409 · 꼬리', row.tail, '9/8 입주 예정 · 후지이 미나미')
  eq('409 · 꼬리 계약', row.tailLeaseId, '409-next')
  eq('409 · 공백 두 구간', row.gaps, [{ startDay: 1, endDay: 10, days: 10 }, { startDay: 18, endDay: 31, days: 14 }])
  eq('409 · 충돌 없음', row.conflicts.length, 0)
  eq('409 · 건수는 입실·퇴실 둘', out.eventCount, 2)
  eq('409 · 리스트 순서는 입실·퇴실', out.events.map(e => [e.day, e.type]), [[11, 'in'], [17, 'out']])
}

// ── 404호 ── 퇴실 완료 + 이어 붙은 거주 + 다음 달 예약. 이어 붙은 구간은 겹치지 않는다.
{
  const gone = lease({ id: '404-gone', roomNo: '404', status: 'CHECKED_OUT', moveInDate: '2026-04-07', expectedMoveOut: '2026-08-06', moveOutDate: '2026-08-06', tenantName: '이성준' })
  const now = lease({ id: '404-now', roomNo: '404', status: 'ACTIVE', moveInDate: '2026-08-15', expectedMoveOut: '2026-08-31', tenantName: '조성훈' })
  const next = lease({ id: '404-next', roomNo: '404', status: 'RESERVED', moveInDate: '2026-09-01', tenantName: '박정후' })
  const out = build([gone, now], [now, next])
  const row = out.rows[0]
  eq('404 · 막대 둘', row.bars.map(b => [b.startDay, b.endDay]), [[1, 6], [15, 31]])
  eq('404 · 앞 막대는 월 이전부터', [row.bars[0].clippedStart, row.bars[0].clippedEnd], [true, false])
  eq('404 · 뒤 막대는 말일에 끝난다(잘림 아님)', [row.bars[1].clippedStart, row.bars[1].clippedEnd], [false, false])
  eq('404 · 한 층', row.laneCount, 1)
  eq('404 · 라벨', row.bars.map(b => b.label), ['8/6 퇴실', '8/15 입실 · 8/31 퇴실'])
  eq('404 · 공백', row.gaps, [{ startDay: 7, endDay: 14, days: 8 }])
  eq('404 · 9/1 예약은 겹치지 않는다', row.conflicts.length, 0)
  eq('404 · 꼬리', row.tail, '9/1 입주 예정 · 박정후')
  eq('404 · 건수 셋', out.eventCount, 3)
}

// ── 예약 두 건이 실제로 겹칠 때 ── 판정은 occupancyOverlaps, 표시는 겹친 구간.
{
  const a = lease({ id: 'r1', roomNo: '404', status: 'RESERVED', moveInDate: '2026-08-10', expectedMoveOut: '2026-08-20', tenantName: '가나' })
  const b = lease({ id: 'r2', roomNo: '404', status: 'RESERVED', moveInDate: '2026-08-18', expectedMoveOut: '2026-08-28', tenantName: '다라' })
  const out = build([a, b], [a, b])
  const row = out.rows[0]
  eq('겹침 · 두 층으로 갈린다', row.laneCount, 2)
  eq('겹침 · 구간', row.overlaps, [{ startDay: 18, endDay: 20 }])
  eq('겹침 · 충돌 하나', row.conflicts.map(c => c.kind), ['overlap'])
  eq('겹침 · 문구', row.conflicts[0].text, '404호 가나·다라 체류가 8/18~8/20 겹칩니다.')
  eq('겹침 · 진입 대상은 나중 계약', row.conflicts[0].leaseId, 'r2')
  eq('겹침 · 두 막대 모두 표시', row.bars.every(x => x.conflicted), true)
}

// ── 무기한 점유 위 예약 ── 손봐야 할 곳은 예약이 아니라 거주의 빈 퇴실일이다.
{
  const live = lease({ id: 'a1', roomNo: '505', status: 'ACTIVE', moveInDate: '2026-08-04', tenantName: '한결' })
  const resv = lease({ id: 'r9', roomNo: '505', status: 'RESERVED', moveInDate: '2026-08-20', tenantName: '두리' })
  const out = build([live, resv], [live, resv])
  const row = out.rows[0]
  eq('무기한 · 거주 막대는 트랙 끝까지', [row.bars.find(b => b.leaseId === 'a1')!.endDay, row.bars.find(b => b.leaseId === 'a1')!.clippedEnd], [31, true])
  eq('무기한 · 충돌 종류', row.conflicts.map(c => c.kind), ['indefinite'])
  eq('무기한 · 진입 대상은 거주 계약', row.conflicts[0].leaseId, 'a1')
  eq('무기한 · 문구', row.conflicts[0].text, '505호 한결님 퇴실일이 미정인데 두리님 입실 예약이 잡혀 있습니다.')
}

// ── 관통 점유 ── 그 달에 아무 변동이 없는 무기한 거주만 상태를 말한다.
{
  const live = lease({ id: 'a2', roomNo: '506', status: 'ACTIVE', moveInDate: '2026-05-01', tenantName: '지현' })
  const resv = lease({ id: 'r8', roomNo: '506', status: 'RESERVED', moveInDate: '2026-08-22', tenantName: '민석' })
  const out = build([resv], [live, resv])
  const bar = out.rows[0].bars.find(b => b.leaseId === 'a2')!
  eq('관통 · 라벨은 퇴실일 미정', bar.label, '퇴실일 미정')
  eq('관통 · 양끝 모두 잘림', [bar.clippedStart, bar.clippedEnd], [true, true])
  eq('관통 · 첫 변동일은 예약 입주일', out.rows[0].firstChangeDay, 22)
  eq('관통 · 관통 점유는 건수가 아니다', out.eventCount, 1)
}

// ── 413호 ── 같은 날 퇴실·입주. 퇴실 완료 계약은 방을 잡지 않으므로 사고가 아니다.
{
  const gone = lease({ id: '413-gone', roomNo: '413', status: 'CHECKED_OUT', moveInDate: '2024-02-08', expectedMoveOut: '2026-08-14', moveOutDate: '2026-08-15', tenantName: '박순자' })
  const now = lease({ id: '413-now', roomNo: '413', status: 'ACTIVE', moveInDate: '2026-08-15', tenantName: '정은숙' })
  const out = build([gone, now], [now])
  const row = out.rows[0]
  eq('413 · 퇴실은 실제 퇴실일(8/15)로 그린다', row.bars.find(b => b.leaseId === '413-gone')!.endDay, 15)
  eq('413 · 같은 칸을 나눠 쓰니 층이 갈린다', row.laneCount, 2)
  eq('413 · 충돌 아님', row.conflicts.length, 0)
  eq('413 · 겹침 표시 없음', row.overlaps.length, 0)
  eq('413 · 공백 없음', row.gaps.length, 0)
}

// ── 같은 날 인수인계라도 둘 다 방을 잡고 있으면 충돌이다 ──
{
  const outgo = lease({ id: 'c1', roomNo: '414', status: 'CHECKOUT_PENDING', moveInDate: '2026-07-01', expectedMoveOut: '2026-08-15', tenantName: '수정' })
  const incom = lease({ id: 'c2', roomNo: '414', status: 'RESERVED', moveInDate: '2026-08-15', expectedMoveOut: '2026-08-30', tenantName: '영호' })
  const row = build([outgo, incom], [outgo, incom]).rows[0]
  eq('같은 날 · 충돌', row.conflicts.map(c => c.kind), ['overlap'])
  eq('같은 날 · 겹친 하루', row.overlaps, [{ startDay: 15, endDay: 15 }])
}

// ── 509호 ── 퇴실 예정일(8/2)과 실제 퇴실일(8/3)이 다르면 실제일이 이긴다.
{
  const gone = lease({ id: '509-gone', roomNo: '509', status: 'CHECKED_OUT', moveInDate: '2026-06-05', expectedMoveOut: '2026-08-02', moveOutDate: '2026-08-03', tenantName: '탄 타르 누 아예' })
  const now = lease({ id: '509-now', roomNo: '509', status: 'ACTIVE', moveInDate: '2026-08-14', tenantName: '김상혁' })
  const row = build([gone, now], [now]).rows[0]
  eq('509 · 실제 퇴실일', row.bars.find(b => b.leaseId === '509-gone')!.endDay, 3)
  eq('509 · 퇴실 라벨도 실제일', row.bars.find(b => b.leaseId === '509-gone')!.label, '8/3 퇴실')
  eq('509 · 새 거주는 입실만 말한다', row.bars.find(b => b.leaseId === '509-now')!.label, '8/14 입실')
  eq('509 · 한 층', row.laneCount, 1)
}

// ── 과거 달 ── 오늘이 그 달이 아니면 오늘 표시가 없다.
{
  const gone = lease({ id: 'p1', roomNo: '520', status: 'CHECKED_OUT', moveInDate: '2026-06-01', expectedMoveOut: '2026-06-20', moveOutDate: '2026-06-21', tenantName: '지난' })
  const out = build([gone], [], '2026-06', TODAY)
  eq('과거달 · 오늘 표시 없음', out.todayDay, null)
  eq('과거달 · 퇴실 완료도 막대가 된다', out.rows[0].bars.map(b => [b.startDay, b.endDay]), [[1, 21]])
  eq('과거달 · 6월은 30일', out.daysInMonth, 30)
}
eq('이번 달 · 오늘 표시', build([lease({ roomNo: '401', status: 'ACTIVE', moveInDate: '2026-08-05' })]).todayDay, 18)

// ── 날짜 역전 ── 입주일이 퇴실일보다 뒤인 계약.
{
  const bad = lease({ id: 'x1', roomNo: '415', status: 'ACTIVE', moveInDate: '2026-08-20', expectedMoveOut: '2026-08-10', tenantName: '거꾸로' })
  const row = build([bad], [bad]).rows[0]
  eq('역전 · 두 날 사이를 칠한다', [row.bars[0].startDay, row.bars[0].endDay], [10, 20])
  eq('역전 · 충돌 종류', row.conflicts.map(c => c.kind), ['reversed'])
  eq('역전 · 문구', row.conflicts[0].text, '415호 거꾸로님 계약의 입주일이 퇴실일보다 뒤입니다.')
  eq('역전 · 막대 표시', row.bars[0].conflicted, true)
}

// ── 월 경계 ── 지난달부터 이어져 이 달에 끝나는 체류(503호 송호준 7/29~8/29).
{
  const live = lease({ id: '503', roomNo: '503', status: 'ACTIVE', moveInDate: '2026-07-29', expectedMoveOut: '2026-08-29', tenantName: '송호준' })
  const next = lease({ id: '503-n', roomNo: '503', status: 'RESERVED', moveInDate: '2026-09-02', tenantName: '아라파트 에야신' })
  const row = build([live], [live, next]).rows[0]
  eq('503 · 왼쪽만 잘림', [row.bars[0].clippedStart, row.bars[0].clippedEnd], [true, false])
  eq('503 · 구간', [row.bars[0].startDay, row.bars[0].endDay], [1, 29])
  eq('503 · 라벨은 퇴실만', row.bars[0].label, '8/29 퇴실')
  eq('503 · 말일 공백', row.gaps, [{ startDay: 30, endDay: 31, days: 2 }])
  eq('503 · 꼬리', row.tail, '9/2 입주 예정 · 아라파트 에야신')
}

// ── 행 정렬 ── 첫 변동일 오름차순, 동률은 호실번호.
{
  const rows = build([
    lease({ roomNo: '512', status: 'ACTIVE', moveInDate: '2026-08-20' }),
    lease({ roomNo: '403', status: 'ACTIVE', moveInDate: '2026-08-05' }),
    lease({ roomNo: '401', status: 'ACTIVE', moveInDate: '2026-08-20' }),
    lease({ roomNo: '407', status: 'CHECKED_OUT', moveInDate: '2026-01-02', moveOutDate: '2026-08-05' }),
  ]).rows
  eq('정렬 · 첫 변동일 · 호실번호', rows.map(r => r.roomNo), ['403', '407', '401', '512'])
}

// ── 빈 달 ──
{
  const out = build([])
  eq('빈 달 · 행 없음', out.rows.length, 0)
  eq('빈 달 · 건수 0', out.eventCount, 0)
  eq('빈 달 · 충돌 없음', out.conflicts.length, 0)
}
// 변동 없는 방의 관통 점유만 넘겨도 행이 되지 않는다(행은 변동이 만든다).
eq('빈 달 · 관통 점유만으로는 행이 서지 않는다',
  build([], [lease({ roomNo: '601', status: 'ACTIVE', moveInDate: '2026-01-01' })]).rows.length, 0)

// ── 리스트 편성 ── 같은 날은 퇴실 먼저.
{
  const outgo = lease({ id: 'e1', roomNo: '410', status: 'CHECKED_OUT', moveInDate: '2026-02-01', moveOutDate: '2026-08-09', tenantName: '나감' })
  const incom = lease({ id: 'e2', roomNo: '411', status: 'ACTIVE', moveInDate: '2026-08-09', tenantName: '들어옴' })
  const ev = build([incom, outgo]).events
  eq('리스트 · 같은 날 퇴실 먼저', ev.map(e => [e.day, e.type, e.roomNo]), [[9, 'out', '410'], [9, 'in', '411']])
  eq('리스트 · 예약은 예약 톤을 들고 간다', build([lease({ roomNo: '412', status: 'RESERVED', moveInDate: '2026-08-25' })]).events[0].kind, 'reserved')
}

console.log(`\n입퇴실 캘린더 조립 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
