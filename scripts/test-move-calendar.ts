// 입퇴실 캘린더 조립 회귀 테스트 — 실행: npx tsx scripts/test-move-calendar.ts
//
// 여기서 고정하는 것: 월 창 클리핑(월 밖으로 이어지는 쪽), 퇴실일 선택(퇴실 완료는 실제일),
// 행 정렬(첫 변동일 · 동률은 호실번호), 층 배치(같은 날 인수인계는 층이 갈린다),
// 충돌 3종의 대상 집합(퇴실 완료 계약은 방을 잡지 않는다), 다음 달 예약 꼬리, 빈 달.
// 2026-08-19 겹침 판정 개정으로 두 축이 붙었다 — 당일 회전은 충돌이 아니고(기대값 갱신, 운영자
// 승인), 하루 이상 겹침은 확인(LeaseOverlapAck)으로 중립이 되되 구간을 벗어나면 실효된다.
//
// 케이스는 2026-08 실데이터에서 가져왔다 — 409호(8/17 퇴실 + 9/8 후지이 미나미), 404호(예약 이어 붙임),
// 413호(같은 날 퇴실·입주), 509호(퇴실 예정일과 실제 퇴실일이 하루 다름), 503호(월 경계 관통).
//
// 파일 뒤쪽에 연속 범위(횡스크롤 트랙, 2026-08-17) 축이 붙어 있다. 앞의 월 창 케이스는 그 개편
// 전후로 한 글자도 바뀌지 않았다 — 좌표가 '범위 첫날부터 며칠'로 일반화됐지만 한 달 창에서는
// 그 값이 곧 '그 달 며칠'이라 같은 수가 나와야 하고, 이 무회귀가 개편의 성립 조건이다.

import { RANGE_JUMP_MONTHS, beyondWindow, buildMoveCalendar, buildMoveRange, daysInMonth, excludedRoomsNote, filterMoveRows, monthLastDay, moveRangeWindow, moveRowSurvives, moveWorkRailLabel, roomLabelChunks, shiftMonth, steadyHeading, type MoveCalendarLease, type MoveRangeRoom, type MoveStaySpan, type MoveWorkInput } from '../lib/moveCalendar'
import { pickContext } from '../lib/moveCalendarData'

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
/**
 * 계약 한 줄. `stays` 를 안 주면 **그 계약의 방·입주일로 구간 하나를 세운다** — 방을 옮긴 적이
 * 없는 계약의 실제 모양이 그것이고(실데이터 75건 중 74건), 그래야 아래 케이스 전부가 폴백이
 * 아니라 구간 경로를 지난다. 예약(RESERVED)만 구간이 없다(점유가 아니라 구간을 안 만든다).
 */
function lease(p: Partial<MoveCalendarLease> & { roomNo: string; status: string }): MoveCalendarLease {
  seq++
  const id = p.id ?? `l${seq}`
  const roomId = p.roomId ?? `room-${p.roomNo}`
  const moveInDate = p.moveInDate ?? null
  const moveOutDate = p.moveOutDate ?? null
  return {
    id,
    status: p.status,
    isShortTerm: p.isShortTerm ?? false,
    moveInDate,
    moveOutDate,
    expectedMoveOut: p.expectedMoveOut ?? null,
    roomId,
    roomNo: p.roomNo,
    tenantId: p.tenantId ?? `t${seq}`,
    tenantName: p.tenantName ?? `사람${seq}`,
    stays: p.stays ?? (p.status === 'RESERVED'
      ? []
      // 열린 구간의 끝은 조립이 계약에서 읽는다 — 퇴실 완료가 아니면 endDate 는 비어 있다.
      : [{ id: `${id}-s1`, roomId, roomNo: p.roomNo, startDate: moveInDate, endDate: moveOutDate }]),
  }
}

/** 이사한 계약의 구간 — 방을 옮긴 순서대로. `[호실, 시작, 끝]`, 끝이 없으면 열린 구간이다. */
function stays(id: string, rows: [string, string, string | null][]): MoveStaySpan[] {
  return rows.map(([roomNo, startDate, endDate], i) => ({
    id: `${id}-s${i + 1}`, roomId: `room-${roomNo}`, roomNo, startDate, endDate,
  }))
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
  eq('겹침 · 구간', row.overlaps, [{ startDay: 18, endDay: 20, acked: false }])
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

// ── 당일 회전 ── 앞이 나가는 그날 뒤가 들어온다. 둘 다 방을 잡고 있어도 사고가 아니다.
//
// 종전에는 이 하루가 'overlap' 충돌이었다(요약 줄 + 빨간 밴드). 고시원의 일상이라 운영자가
// 정상으로 확정했다(2026-08-19 겹침 판정 개정). 층 분리는 그대로다 — 같은 칸에 선 두 막대가
// 회전 자체를 말하므로, 기하를 지우면 그 하루에 무슨 일이 있었는지가 사라진다.
{
  const outgo = lease({ id: 'c1', roomNo: '414', status: 'CHECKOUT_PENDING', moveInDate: '2026-07-01', expectedMoveOut: '2026-08-15', tenantName: '수정' })
  const incom = lease({ id: 'c2', roomNo: '414', status: 'RESERVED', moveInDate: '2026-08-15', expectedMoveOut: '2026-08-30', tenantName: '영호' })
  const row = build([outgo, incom], [outgo, incom]).rows[0]
  eq('당일 회전 · 충돌 아님', row.conflicts.length, 0)
  eq('당일 회전 · 밴드 없음', row.overlaps, [])
  eq('당일 회전 · 층은 갈린다', row.laneCount, 2)
  eq('당일 회전 · 막대 표시도 없다', row.bars.some(b => b.conflicted), false)
  // 하루라도 더 포개지면 그대로 충돌이다 — 회전 예외가 겹침 전체를 열어 주는 것이 아니다.
  const longer = lease({ id: 'c3', roomNo: '414', status: 'RESERVED', moveInDate: '2026-08-14', expectedMoveOut: '2026-08-30', tenantName: '영호' })
  eq('당일 회전 · 이틀이면 충돌', build([outgo, longer], [outgo, longer]).rows[0].conflicts.map(c => c.kind), ['overlap'])
}

// ── 확인된 겹침 ── 하루 이상 겹침을 운영자가 '의도된 것'으로 확인하면 중립으로 내려간다.
// 줄은 남는다(해제 진입점이자 사실 표시). 구간을 벗어나면 확인이 실효돼 다시 빨강이다.
{
  const front = lease({ id: 'k1', roomNo: '422', status: 'CHECKOUT_PENDING', moveInDate: '2026-06-01', expectedMoveOut: '2026-08-19', tenantName: '박호정' })
  const back = lease({ id: 'k2', roomNo: '422', status: 'RESERVED', moveInDate: '2026-08-18', expectedMoveOut: '2026-09-30', tenantName: '한희규' })
  const withAck = (acks: { id: string; frontLeaseTermId: string; backLeaseTermId: string; overlapFrom: string; overlapTo: string }[]) =>
    buildMoveCalendar({ month: MONTH, today: TODAY, changed: [front, back], context: [front, back], acks }).rows[0]

  const bare = withAck([])
  eq('확인 전 · 충돌', bare.conflicts.map(c => [c.kind, c.acked]), [['overlap', false]])
  eq('확인 전 · 빨간 밴드', bare.overlaps, [{ startDay: 18, endDay: 19, acked: false }])
  eq('확인 전 · 확인 대상 두 계약(앞=입주일이 이른 쪽)', bare.conflicts[0].pair, { frontLeaseTermId: 'k1', backLeaseTermId: 'k2' })

  const ack = { id: 'ack-1', frontLeaseTermId: 'k1', backLeaseTermId: 'k2', overlapFrom: '2026-08-18', overlapTo: '2026-08-19' }
  const done = withAck([ack])
  eq('확인 후 · 줄은 남는다', done.conflicts.length, 1)
  eq('확인 후 · 중립 문구', done.conflicts[0].text, '422호 박호정·한희규 8/18~8/19 겹침 확인됨')
  eq('확인 후 · 해제 진입점', [done.conflicts[0].acked, done.conflicts[0].ackId], [true, 'ack-1'])
  eq('확인 후 · 밴드도 중립', done.overlaps, [{ startDay: 18, endDay: 19, acked: true }])
  eq('확인 후 · 막대는 충돌 표시를 벗는다', done.bars.some(b => b.conflicted), false)

  // 구간 초과 — 퇴실일이 하루 더 밀리면 그 확인은 같은 사실이 아니다(재발화).
  const pushed = lease({ id: 'k1', roomNo: '422', status: 'CHECKOUT_PENDING', moveInDate: '2026-06-01', expectedMoveOut: '2026-08-20', tenantName: '박호정' })
  const refired = buildMoveCalendar({ month: MONTH, today: TODAY, changed: [pushed, back], context: [pushed, back], acks: [ack] }).rows[0]
  eq('구간 초과 · 확인 실효', refired.conflicts.map(c => c.acked), [false])
  eq('구간 초과 · 다시 빨강', refired.overlaps, [{ startDay: 18, endDay: 20, acked: false }])
}

// ── 확인 대상이 아닌 충돌 ── 무기한·역전은 확인으로 덮을 것이 아니다(다른 처방).
{
  const live = lease({ id: 'n1', roomNo: '507', status: 'ACTIVE', moveInDate: '2026-08-04', tenantName: '한결' })
  const resv = lease({ id: 'n2', roomNo: '507', status: 'RESERVED', moveInDate: '2026-08-20', tenantName: '두리' })
  const c = build([live, resv], [live, resv]).rows[0].conflicts[0]
  eq('무기한 · 확인 대상 아님', [c.kind, c.acked, c.pair], ['indefinite', false, null])
  const bad = lease({ id: 'n3', roomNo: '508', status: 'ACTIVE', moveInDate: '2026-08-20', expectedMoveOut: '2026-08-10', tenantName: '거꾸로' })
  const r = build([bad], [bad]).rows[0].conflicts[0]
  eq('역전 · 확인 대상 아님', [r.kind, r.acked, r.pair], ['reversed', false, null])
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
// 조회 과대근사 걸러내기 — 퇴실 예정일은 8/31 인데 실제로는 9/2 에 나갔다. 조회에는 걸리지만
// 이 달의 변동은 아니다(퇴실 완료는 실제일이 이긴다).
eq('빈 달 · 실제 퇴실이 다음 달이면 행이 아니다',
  build([lease({ roomNo: '602', status: 'CHECKED_OUT', moveInDate: '2026-03-01', expectedMoveOut: '2026-08-31', moveOutDate: '2026-09-02' })]).rows.length, 0)

// ── 리스트 편성 ── 같은 날은 퇴실 먼저.
{
  const outgo = lease({ id: 'e1', roomNo: '410', status: 'CHECKED_OUT', moveInDate: '2026-02-01', moveOutDate: '2026-08-09', tenantName: '나감' })
  const incom = lease({ id: 'e2', roomNo: '411', status: 'ACTIVE', moveInDate: '2026-08-09', tenantName: '들어옴' })
  const ev = build([incom, outgo]).events
  eq('리스트 · 같은 날 퇴실 먼저', ev.map(e => [e.day, e.type, e.roomNo]), [[9, 'out', '410'], [9, 'in', '411']])
  eq('리스트 · 예약은 예약 톤을 들고 간다', build([lease({ roomNo: '412', status: 'RESERVED', moveInDate: '2026-08-25' })]).events[0].kind, 'reserved')
  eq('리스트 · 이사가 아니면 상대 방이 없다', ev.every(e => e.moved || e.otherRoomNo === null), true)
}

// ══ 연속 범위(횡스크롤 트랙) ══════════════════════════════════════
//
// 위 70케이스는 한 달 창을 고정한다. 아래는 그 창을 여러 달로 늘렸을 때 같은 기하가 무너지지
// 않는지를 본다 — 좌표가 '범위 첫날부터 며칠'로 바뀌므로 달 경계를 넘는 자리가 전부 후보다.

const range = (p: {
  from: string
  to: string
  changed: MoveCalendarLease[]
  context?: MoveCalendarLease[]
  today?: string
  focusMonth?: string
  works?: MoveWorkInput[]
  rooms?: MoveRangeRoom[]
  cover?: MoveCalendarLease[]
}) => buildMoveRange({
  from: p.from,
  to: p.to,
  today: p.today ?? TODAY,
  focusMonth: p.focusMonth ?? p.from.slice(0, 7),
  changed: p.changed,
  context: p.context ?? p.changed,
  // 방 목록을 안 주면 무변동 행이 없다. 이 절 위쪽 케이스는 전부 종전 규칙(변동 행만)을 고정한다.
  rooms: p.rooms ?? [],
  cover: p.cover ?? [],
  beyond: null,
  canExtendPast: false,
  works: p.works,
})

// ── 월 산술 정본 ──
eq('shiftMonth · 연 경계 넘김', [shiftMonth('2026-12', 1), shiftMonth('2026-01', -1)], ['2027-01', '2025-12'])
eq('shiftMonth · 0 은 제자리', shiftMonth('2026-08', 0), '2026-08')
eq('shiftMonth · 여러 해', shiftMonth('2026-08', 18), '2028-02')
eq('monthLastDay · 윤년 2월', monthLastDay('2028-02'), '2028-02-29')

// ── 409호 ── 이 기능의 채택 근거. 8월 퇴실과 9월 예약이 **한 행의 두 막대**로 이어진다.
// 월 페이지에서는 9/8 예약이 트랙 밖이라 꼬리 문구로만 있었다(위 70케이스가 그 상태를 고정한다).
{
  const exit = lease({ id: '409-exit', roomNo: '409', status: 'CHECKOUT_PENDING', moveInDate: '2026-08-11', expectedMoveOut: '2026-08-17', tenantName: '서종희' })
  const next = lease({ id: '409-next', roomNo: '409', status: 'RESERVED', moveInDate: '2026-09-08', tenantName: '후지이 미나미' })
  const out = range({ from: '2026-08-01', to: '2026-10-31', changed: [exit, next], context: [exit, next] })
  eq('범위 409 · 총 일수(8+9+10월)', out.days, 92)
  eq('범위 409 · 행 하나', out.rows.length, 1)
  const row = out.rows[0]
  eq('범위 409 · 막대 둘이 한 행에', row.bars.map(b => b.leaseId), ['409-exit', '409-next'])
  eq('범위 409 · 퇴실 막대 구간', [row.bars[0].startDay, row.bars[0].endDay], [11, 17])
  eq('범위 409 · 예약 막대는 9/8(=39일째)부터 트랙 끝까지', [row.bars[1].startDay, row.bars[1].endDay], [39, 92])
  eq('범위 409 · 예약 막대는 오른쪽만 잘림', [row.bars[1].clippedStart, row.bars[1].clippedEnd], [false, true])
  eq('범위 409 · 꼬리는 사라진다(막대가 말한다)', row.tail, null)
  eq('범위 409 · 충돌 아님', row.conflicts.length, 0)
  eq('범위 409 · 한 층', row.laneCount, 1)
  eq('범위 409 · 라벨은 각자의 변동', row.bars.map(b => b.label), ['8/11 입실 · 8/17 퇴실', '9/8 입실'])
  eq('범위 409 · 월 밴드', out.months.map(m => [m.month, m.startDay, m.days]),
    [['2026-08', 1, 31], ['2026-09', 32, 30], ['2026-10', 62, 31]])
  eq('범위 409 · 달별 건수(10월은 빈 달)', out.months.map(m => m.eventCount), [2, 1, 0])
  eq('범위 409 · 보고 있는 달의 건수', out.focusEventCount, 2)
  eq('범위 409 · 오늘 표시는 범위 좌표', out.todayDay, 18)
  // 8/18 기준 +14 일은 9/1 까지 — 8/11·8/17 은 지났고 9/8 은 아직 멀다.
  eq('범위 409 · 다가오는 14일에는 없다', out.upcoming.map(e => e.date), [])
}

// ── 꼬리는 범위 밖에만 남는다 ── 같은 방·같은 예약이라도 트랙이 거기까지 안 닿으면 한 줄로 말한다.
{
  const exit = lease({ id: 't-exit', roomNo: '410', status: 'CHECKOUT_PENDING', moveInDate: '2026-08-01', expectedMoveOut: '2026-08-20', tenantName: '나감' })
  const next = lease({ id: 't-next', roomNo: '410', status: 'RESERVED', moveInDate: '2026-12-01', tenantName: '먼사람' })
  const row = range({ from: '2026-08-01', to: '2026-09-30', changed: [exit], context: [exit, next] }).rows[0]
  eq('꼬리 · 범위 밖 예약은 한 줄로 남는다', row.tail, '12/1 입주 예정 · 먼사람')
  eq('꼬리 · 진입 대상', row.tailLeaseId, 't-next')
}

// ── 행 정렬 ── 연속 뷰는 호실번호다. 첫 변동일은 여러 달에 걸쳐 여러 번 바뀌면 의미가 깨진다.
{
  const out = range({ from: '2026-08-01', to: '2026-09-30', changed: [
    lease({ roomNo: '512', status: 'ACTIVE', moveInDate: '2026-08-02' }),
    lease({ roomNo: '403', status: 'ACTIVE', moveInDate: '2026-09-20' }),
    lease({ roomNo: '409', status: 'ACTIVE', moveInDate: '2026-08-25' }),
  ] })
  eq('범위 정렬 · 호실번호 오름차순', out.rows.map(r => r.roomNo), ['403', '409', '512'])
  eq('월 창 정렬 · 첫 변동일은 그대로', build([
    lease({ roomNo: '512', status: 'ACTIVE', moveInDate: '2026-08-02' }),
    lease({ roomNo: '403', status: 'ACTIVE', moveInDate: '2026-08-25' }),
  ]).rows.map(r => r.roomNo), ['512', '403'])
}

// ── 달 경계를 넘는 체류 ── 한 막대가 두 달을 관통해도 끊기지 않는다(월 페이지에서는 둘로 잘렸다).
{
  const live = lease({ id: 'x', roomNo: '503', status: 'ACTIVE', moveInDate: '2026-08-20', expectedMoveOut: '2026-09-10', tenantName: '송호준' })
  const row = range({ from: '2026-08-01', to: '2026-09-30', changed: [live] }).rows[0]
  eq('경계 · 한 막대로 이어진다', [row.bars[0].startDay, row.bars[0].endDay], [20, 41])
  eq('경계 · 양끝 다 범위 안이라 안 잘린다', [row.bars[0].clippedStart, row.bars[0].clippedEnd], [false, false])
  eq('경계 · 라벨은 두 변동 모두', row.bars[0].label, '8/20 입실 · 9/10 퇴실')
  eq('경계 · 공백은 앞뒤 두 구간', row.gaps, [{ startDay: 1, endDay: 19, days: 19 }, { startDay: 42, endDay: 61, days: 20 }])
}

// ── 관통 점유 ── 범위 전체를 가로지르는 거주는 행을 안 만들지만, 행이 선 방에서는 띠로 그려진다.
{
  const live = lease({ id: 'thru', roomNo: '601', status: 'ACTIVE', moveInDate: '2026-01-01', tenantName: '오래' })
  eq('관통 · 그것만으로는 행이 서지 않는다',
    range({ from: '2026-08-01', to: '2026-09-30', changed: [], context: [live] }).rows.length, 0)
  const resv = lease({ id: 'thru-r', roomNo: '601', status: 'RESERVED', moveInDate: '2026-09-05', tenantName: '겹침' })
  const row = range({ from: '2026-08-01', to: '2026-09-30', changed: [resv], context: [live, resv] }).rows[0]
  const bar = row.bars.find(b => b.leaseId === 'thru')!
  eq('관통 · 띠는 범위 전체', [bar.startDay, bar.endDay, bar.clippedStart, bar.clippedEnd], [1, 61, true, true])
  eq('관통 · 무기한 위 예약은 여전히 충돌', row.conflicts.map(c => c.kind), ['indefinite'])
}

// ── 충돌 문구의 날짜 ── 연말을 넘겨도 맞는 달을 적는다(월 이름을 범위 좌표에서 만든다).
{
  const a = lease({ id: 'y1', roomNo: '404', status: 'RESERVED', moveInDate: '2026-12-28', expectedMoveOut: '2027-01-05', tenantName: '가나' })
  const b = lease({ id: 'y2', roomNo: '404', status: 'RESERVED', moveInDate: '2027-01-03', expectedMoveOut: '2027-01-20', tenantName: '다라' })
  const row = range({ from: '2026-12-01', to: '2027-01-31', changed: [a, b], today: '2026-12-15' }).rows[0]
  eq('연말 · 겹친 구간 좌표', row.overlaps, [{ startDay: 34, endDay: 36, acked: false }])
  eq('연말 · 문구의 날짜는 1월', row.conflicts[0].text, '404호 가나·다라 체류가 1/3~1/5 겹칩니다.')
  eq('연말 · 두 층', row.laneCount, 2)
}

// ── 다가오는 입퇴실 ── 오늘부터 14일. 트랙 밖 질문에 스크롤 0 으로 답하는 줄의 재료다.
{
  const out = range({ from: '2026-08-01', to: '2026-09-30', changed: [
    lease({ roomNo: '401', status: 'CHECKED_OUT', moveInDate: '2026-05-01', moveOutDate: '2026-08-10' }),   // 지난 변동
    lease({ roomNo: '402', status: 'RESERVED', moveInDate: '2026-08-25' }),                                   // 안쪽
    lease({ roomNo: '403', status: 'RESERVED', moveInDate: '2026-09-01' }),                                   // 경계(+14)
    lease({ roomNo: '404', status: 'RESERVED', moveInDate: '2026-09-02' }),                                   // 밖
  ] })
  eq('요약 · 오늘~+14 만', out.upcoming.map(e => [e.date, e.roomNo]), [['2026-08-25', '402'], ['2026-09-01', '403']])
  eq('요약 · 날짜는 실제 날짜다(범위 번호가 아니다)', out.upcoming[0].day, 25)
}

// ── 범위 밖 사실은 조회가 넘긴 대로 실린다 ──
{
  const out = buildMoveRange({
    from: '2026-08-01', to: '2026-09-30', today: TODAY, focusMonth: '2026-09',
    changed: [lease({ roomNo: '405', status: 'ACTIVE', moveInDate: '2026-09-03' })],
    context: [], rooms: [], cover: [], beyond: { count: 3, firstDate: '2026-11-02' }, canExtendPast: true,
  })
  eq('범위 밖 · 천장 너머', out.beyond, { count: 3, firstDate: '2026-11-02' })
  eq('범위 밖 · 과거 확장 가능', out.canExtendPast, true)
  eq('범위 밖 · 보고 있는 달이 9월이면 접미도 9월 건수', out.focusEventCount, 1)
}

// ══ 이사(한 계약이 두 방에 걸친다) ═══════════════════════════════
//
// 이 축이 비어 있어서 사고가 났다. 캘린더가 계약의 roomId 한 칸만 읽던 시절, 방을 옮긴 계약은
// 옛 방에 0칸이고 새 방에 최초 입주일부터 통째로 그려졌다(신고 2026-08-20, 김태란 506→508).
// 아래는 그 상태로 되돌아가면 반드시 깨지는 것들만 고정한다.

// ── 기본형 ── 8/10 에 506호에서 508호로. 두 방에 각각 막대가 서고 이사일 하루는 양쪽에 있다.
{
  const mv = lease({
    id: 'mv', roomNo: '508', status: 'ACTIVE', moveInDate: '2026-01-05', tenantName: '김이사',
    stays: stays('mv', [['506', '2026-01-05', '2026-08-10'], ['508', '2026-08-10', null]]),
  })
  const out = build([mv], [mv])
  eq('이사 · 행 둘(옛 방·새 방)', out.rows.map(r => r.roomNo), ['506', '508'])
  const old = out.rows[0], now = out.rows[1]
  eq('이사 · 옛 방 막대는 월 이전부터 10일까지', [old.bars[0].startDay, old.bars[0].endDay, old.bars[0].clippedStart], [1, 10, true])
  eq('이사 · 새 방 막대는 10일부터 말일까지(퇴실일 없어 오른쪽 잘림)', [now.bars[0].startDay, now.bars[0].endDay, now.bars[0].clippedEnd], [10, 31, true])
  eq('이사 · 옛 방 라벨은 어디로 갔는지 말한다', old.bars[0].label, '8/10 508호로 이사')
  eq('이사 · 새 방 라벨은 어디서 왔는지 말한다', now.bars[0].label, '8/10 506호에서 이사')
  eq("이사 · '퇴실'도 '입실'도 아니다", [old.bars[0].label.includes('퇴실'), now.bars[0].label.includes('입실')], [false, false])
  eq("이사 · 혼자 '퇴실일 미정'으로 서지 않는다", now.bars[0].label.includes('퇴실일 미정'), false)
  eq('이사 · 이사일 하루는 두 방 모두에 칠해진다(그날 두 방을 다 쓴다)', [old.bars[0].endDay, now.bars[0].startDay], [10, 10])
  eq('이사 · 옛 방 공백은 이사 다음 날부터', old.gaps, [{ startDay: 11, endDay: 31, days: 21 }])
  eq('이사 · 새 방은 이사 전날까지 비어 있었다', now.gaps, [{ startDay: 1, endDay: 9, days: 9 }])
  eq('이사 · 같은 사람이 두 행에 선 것은 충돌이 아니다', out.conflicts.length, 0)
  eq('이사 · 건수는 둘(옛 방이 비고 새 방이 찬다)', out.eventCount, 2)
  eq('이사 · 두 변동 모두 이사로 표시된다', out.events.map(e => [e.roomNo, e.type, e.moved]), [['506', 'out', true], ['508', 'in', true]])
  // 상대 방이 없으면 요약 줄에서 두 건이 호실 빼고 같은 글자가 된다 — 어느 쪽이 떠난 방인지 못 가린다.
  eq('이사 · 두 변동이 서로를 가리킨다',
    out.events.map(e => [e.roomNo, e.type, e.otherRoomNo]), [['506', 'out', '508'], ['508', 'in', '506']])
  eq('이사 · 막대 키는 구간 id 라 계약 id 로 겹치지 않는다', [old.bars[0].id, now.bars[0].id], ['mv-s1', 'mv-s2'])
}

// ── 옛 방의 다음 사람 ── 이사로 빈 방에 다른 사람이 들어온다. 겹치지 않으면 충돌이 아니다.
{
  const mv = lease({
    id: 'mv2', roomNo: '508', status: 'ACTIVE', moveInDate: '2026-01-05', tenantName: '김이사',
    stays: stays('mv2', [['506', '2026-01-05', '2026-08-10'], ['508', '2026-08-10', null]]),
  })
  const next = lease({ id: 'nx', roomNo: '506', status: 'ACTIVE', moveInDate: '2026-08-20', tenantName: '다음' })
  const out = build([mv, next], [mv, next])
  const old = out.rows.find(r => r.roomNo === '506')!
  eq('이사 다음 사람 · 옛 방에 막대 둘', old.bars.map(b => b.tenantName), ['김이사', '다음'])
  eq('이사 다음 사람 · 한 층(겹치지 않는다)', old.laneCount, 1)
  eq('이사 다음 사람 · 공백은 그 사이만', old.gaps, [{ startDay: 11, endDay: 19, days: 9 }])
  eq('이사 다음 사람 · 충돌 없음', out.conflicts.length, 0)
}

// ── 이사가 범위 밖 ── 창이 이사 뒤부터면 옛 방 행은 서지 않고 새 방 막대만 관통한다.
{
  const mv = lease({
    id: 'mv3', roomNo: '508', status: 'ACTIVE', moveInDate: '2026-01-05', tenantName: '김이사',
    stays: stays('mv3', [['506', '2026-01-05', '2026-07-10'], ['508', '2026-07-10', null]]),
  })
  const out = build([mv], [mv])
  eq('범위 밖 이사 · 그 달에 변동이 없으니 행이 없다', out.rows.length, 0)
  const wide = range({ from: '2026-07-01', to: '2026-08-31', changed: [mv], context: [mv] })
  eq('범위 안 이사 · 행 둘', wide.rows.map(r => r.roomNo), ['506', '508'])
  eq('범위 안 이사 · 새 방 막대는 10일째부터', wide.rows[1].bars[0].startDay, 10)
}

// ── 나갔다 같은 방으로 돌아옴 ── 한 계약이 한 행에 막대 둘. 계약 id 로는 키가 겹친다.
{
  const back = lease({
    id: 'bk', roomNo: '506', status: 'ACTIVE', moveInDate: '2026-08-01', tenantName: '되돌이',
    stays: stays('bk', [['506', '2026-08-01', '2026-08-10'], ['507', '2026-08-10', '2026-08-20'], ['506', '2026-08-20', null]]),
  })
  const out = build([back], [back])
  const r506 = out.rows.find(r => r.roomNo === '506')!
  eq('복귀 · 506 에 막대 둘', r506.bars.length, 2)
  eq('복귀 · 막대 키가 서로 다르다', r506.bars[0].id !== r506.bars[1].id, true)
  eq('복귀 · 같은 계약끼리는 겹침 판정을 하지 않는다', out.conflicts.length, 0)
  eq('복귀 · 한 층', r506.laneCount, 1)
  eq('복귀 · 라벨', r506.bars.map(b => b.label), ['8/1 입실 · 8/10 507호로 이사', '8/20 507호에서 이사'])
}

// ── 이사 문구의 조사 ── 호실번호가 늘 숫자라는 보장이 없다(등록 폼이 'A동-3'·'옥탑방'을 권한다).
// '로'를 그냥 이어 붙이면 '옥탑방로'가 된다. 판정 정본은 lib/roomNo roomNoWithRo 다.
{
  const cases: [string, string][] = [
    ['508', '8/10 508호로 이사'],     // 숫자에는 '호'가 붙고 호는 받침이 없다
    ['사무실', '8/10 사무실로 이사'],   // 종성 ㄹ
    ['옥탑방', '8/10 옥탑방으로 이사'], // 종성 ㅇ
    ['A동-3', '8/10 A동-3으로 이사'],  // 숫자 3 = 삼, 종성 ㅁ
    ['별관2', '8/10 별관2로 이사'],    // 숫자 2 = 이, 받침 없음
  ]
  for (const [roomNo, want] of cases) {
    const l = lease({
      id: `jo-${roomNo}`, roomNo, status: 'ACTIVE', moveInDate: '2026-01-05', tenantName: '조사',
      stays: stays(`jo-${roomNo}`, [['506', '2026-01-05', '2026-08-10'], [roomNo, '2026-08-10', null]]),
    })
    const old = build([l], [l]).rows.find(r => r.roomNo === '506')!
    eq(`이사 조사 · ${roomNo}`, old.bars[0].label, want)
  }
  // 들어오는 쪽 조사('에서')는 받침을 안 탄다.
  const back = lease({
    id: 'jo-in', roomNo: '507', status: 'ACTIVE', moveInDate: '2026-01-05', tenantName: '조사',
    stays: stays('jo-in', [['옥탑방', '2026-01-05', '2026-08-10'], ['507', '2026-08-10', null]]),
  })
  eq('이사 조사 · 들어오는 쪽', build([back], [back]).rows.find(r => r.roomNo === '507')!.bars[0].label, '8/10 옥탑방에서 이사')
}

// ── 예약은 구간이 없다 ── 구간을 안 만드는 것이 설계라 계약이 그대로 한 구간이 된다.
{
  const rsv = lease({ id: 'rv', roomNo: '410', status: 'RESERVED', moveInDate: '2026-08-20', tenantName: '예약' })
  eq('예약 · 구간 없음', rsv.stays.length, 0)
  const row = build([rsv], [rsv]).rows[0]
  eq('예약 · 계약이 한 구간을 대신한다', [row.bars.length, row.bars[0].startDay], [1, 20])
  eq('예약 · 이사가 아니다', [row.bars[0].movedFromRoomNo, row.bars[0].movedToRoomNo], [null, null])
}

// ── 열린 구간의 끝은 계약이 말한다 ── 구간에서 읽으면 퇴실 예정일이 통째로 사라진다.
{
  const l = lease({ id: 'op', roomNo: '411', status: 'ACTIVE', moveInDate: '2026-08-05', expectedMoveOut: '2026-08-25', tenantName: '예정' })
  const row = build([l], [l]).rows[0]
  eq('열린 구간 · 끝은 퇴실 예정일', [row.bars[0].endDay, row.bars[0].openEnded], [25, false])
  eq('열린 구간 · 라벨에 퇴실일이 선다', row.bars[0].label, '8/5 입실 · 8/25 퇴실')
}

// ══ 창 경계(넓히기 아니라 옮기기) ══════════════════════════════════
//
// 종전 산식은 focusMonth 가 범위 밖이면 그쪽으로 창을 **넓히기만** 해서, 2028년을 고르면
// 19개월 트랙(약 13,900px)이 되고 상한이 없었다. 여기서 못 박는 것은 넷이다 —
// 상한 · 기본 창 무회귀 · focus 가 늘 창 안 · '이전 달 더 보기' 의 한 달씩 단조 후퇴.

/** 두 달 사이의 개월 수(양 끝 포함). */
const monthSpan = (a: string, b: string): number => {
  const [ay, am] = a.split('-').map(Number)
  const [by, bm] = b.split('-').map(Number)
  return (by * 12 + bm) - (ay * 12 + am) + 1
}
/** 종전 산식(넓히기) — 무회귀 앵커의 비교군이다. 오늘 근처에서는 새 산식과 같아야 한다. */
const legacyWindow = (todayMonth: string, focusMonth: string, lastMonth: string) => {
  const minEnd = shiftMonth(todayMonth, 2)
  const maxEnd = shiftMonth(todayMonth, 6)
  let endMonth = lastMonth < minEnd ? minEnd : lastMonth > maxEnd ? maxEnd : lastMonth
  let startMonth = shiftMonth(todayMonth, -1)
  if (focusMonth < startMonth) startMonth = focusMonth
  if (focusMonth > endMonth) endMonth = focusMonth
  return { startMonth, endMonth }
}

const WT = '2026-08'   // 창 회귀의 '오늘 달'

// ── 축 1 ── 먼 달로 점프해도 창이 RANGE_JUMP_MONTHS 를 안 넘는다.
{
  for (const focus of ['2028-01', '2036-01', '2030-07', '2020-01', '2019-05']) {
    const w = moveRangeWindow({ todayMonth: WT, focusMonth: focus, lastChangeMonth: '2026-09' })
    eq(`창 상한 · focus ${focus} 는 ${RANGE_JUMP_MONTHS}개월`, monthSpan(w.startMonth, w.endMonth), RANGE_JUMP_MONTHS)
  }
  // 트랙 일수 상한 — 4개월이 가장 긴 조합(31+31+30+31)이라도 123일을 안 넘는다.
  const w = moveRangeWindow({ todayMonth: WT, focusMonth: '2028-01', lastChangeMonth: '2026-09' })
  const built = range({ from: `${w.startMonth}-01`, to: monthLastDay(w.endMonth), changed: [], focusMonth: '2028-01' })
  eq('창 상한 · 트랙 일수', built.days <= 123, true)
  const was = legacyWindow(WT, '2028-01', '2026-09')
  eq('창 상한 · 종전 산식이었다면 19개월', monthSpan(was.startMonth, was.endMonth), 19)
}

// ── 축 2 ── 무회귀 앵커. focus 가 오늘 달이면 종전 산식과 완전히 같다.
{
  for (const last of ['2026-08', '2026-10', '2026-12', '2027-02', '2027-05']) {
    const now = moveRangeWindow({ todayMonth: WT, focusMonth: WT, lastChangeMonth: last })
    const was = legacyWindow(WT, WT, last)
    eq(`창 무회귀 · 마지막 변동 ${last}`, [now.startMonth, now.endMonth], [was.startMonth, was.endMonth])
  }
  // 창 **안**의 달을 고른 경우도 기본 창 그대로다(스크롤로 닿는 달은 전부 여기).
  for (const focus of ['2026-07', '2026-09', '2026-10']) {
    const now = moveRangeWindow({ todayMonth: WT, focusMonth: focus, lastChangeMonth: '2026-10' })
    eq(`창 무회귀 · 창 안 focus ${focus}`, [now.startMonth, now.endMonth], ['2026-07', '2026-10'])
  }
}

// ── 축 3 ── focus 는 언제나 창 안이다. 밖이면 그 달의 건수를 아무도 모르는데
//            focusEventCount 의 `?? 0` 이 "0건"으로 출력해 탭 접미가 통째로 사라진다.
{
  let outside = 0
  let tooWide = 0
  for (let d = -24; d <= 24; d++) {
    const focus = shiftMonth(WT, d)
    for (const last of ['2026-08', '2026-11', '2027-03']) {
      const w = moveRangeWindow({ todayMonth: WT, focusMonth: focus, lastChangeMonth: last })
      if (focus < w.startMonth || focus > w.endMonth) outside++
      if (monthSpan(w.startMonth, w.endMonth) > 8) tooWide++
    }
  }
  eq('창 · focus 가 창 밖인 조합', outside, 0)
  eq('창 · 8개월을 넘는 조합', tooWide, 0)
}

// ── 축 4 ── '이전 달 더 보기' 를 반복하면 창의 첫 달이 정확히 한 달씩 물러난다.
//            focus 를 창 가운데 두면 한 번에 두 달씩 튀어 낱말('한 달 더')이 거짓이 된다.
{
  let start = moveRangeWindow({ todayMonth: WT, focusMonth: WT, lastChangeMonth: '2026-10' }).startMonth
  const steps: string[] = [start]
  for (let i = 0; i < 5; i++) {
    const focus = shiftMonth(start, -1)
    start = moveRangeWindow({ todayMonth: WT, focusMonth: focus, lastChangeMonth: '2026-10' }).startMonth
    steps.push(start)
  }
  eq('창 · 이전 달 더 보기 다섯 번', steps, ['2026-07', '2026-06', '2026-05', '2026-04', '2026-03', '2026-02'])
}

// ── 축 5 ── beyond 는 창 밖이되 **앞으로의** 예정만 센다.
//            창이 과거로 미끄러지면 창의 끝이 오늘보다 이전이라, 가드가 없으면 이미 지난 변동이
//            "이후 예정 N건 · 최초 7/2" 로 적힌다.
{
  const dates = ['2026-05-10', '2026-07-02', '2026-08-25', '2026-09-30', '2026-12-01']
  const past = moveRangeWindow({ todayMonth: WT, focusMonth: '2026-03', lastChangeMonth: '2026-09' })
  const pastTo = monthLastDay(past.endMonth)
  eq('beyond · 과거로 미끄러진 창의 끝', pastTo, '2026-06-30')
  eq('beyond · 지난 변동을 예정으로 안 센다', beyondWindow(dates, pastTo, '2026-08-20'),
    { count: 3, firstDate: '2026-08-25' })
  // 가드가 없었다면 7/2 가 '최초 예정' 으로 섰다.
  eq('beyond · 가드가 없을 때의 값(대조)', dates.filter(d => d > pastTo).sort()[0], '2026-07-02')
  // 오늘을 무는 기본 창에서는 종전과 같은 답이다.
  const base = moveRangeWindow({ todayMonth: WT, focusMonth: WT, lastChangeMonth: '2026-09' })
  eq('beyond · 기본 창', beyondWindow(dates, monthLastDay(base.endMonth), '2026-08-20'),
    { count: 1, firstDate: '2026-12-01' })
  eq('beyond · 남은 게 없으면 null', beyondWindow(['2026-05-10'], '2026-09-30', '2026-08-20'), null)
}

// ── 축 6 ── 오늘이 창 밖이면 todayDay 가 없고 upcoming 도 비어 있다.
//            이 조합이 참일 때 화면은 '예정 없음'이 아니라 '여기서는 셀 수 없음'을 말해야 한다
//            (MoveCalendar UpcomingRow 의 todayInRange 분기와 짝이다).
{
  const soon = lease({ id: 'sn', roomNo: '601', status: 'RESERVED', moveInDate: '2026-08-21', tenantName: '내일' })
  const away = moveRangeWindow({ todayMonth: WT, focusMonth: '2028-01', lastChangeMonth: '2026-09' })
  const out = range({ from: `${away.startMonth}-01`, to: monthLastDay(away.endMonth), changed: [soon], today: '2026-08-20', focusMonth: '2028-01' })
  eq('창 밖 오늘 · todayDay 없음', out.todayDay, null)
  eq('창 밖 오늘 · upcoming 이 비는 것은 사실이 아니라 창의 한계다', out.upcoming.length, 0)
  // 오늘을 무는 창에서는 같은 예약이 잡힌다 — 위 0 이 데이터 탓이 아님을 대조로 못 박는다.
  const near = range({ from: '2026-07-01', to: '2026-10-31', changed: [soon], today: '2026-08-20', focusMonth: WT })
  eq('창 안 오늘 · 같은 예약이 다가오는 14일에 잡힌다', near.upcoming.map(e => e.date), ['2026-08-21'])
}

// ══ 작업 레인(청소) ═══════════════════════════════════════════════
//
// 이 절이 못 박는 것은 하나다 — **작업은 거주의 어느 배열에도 안 들어간다.** 공실 캡션·충돌
// 판정·홈 '이달 입퇴실 N건'이 전부 bars·events 를 딛으므로, 섞이는 순간 도배 중인 빈 방이
// 공실이 아니게 되고 충돌 판정이 거주와 청소가 겹쳤다고 빨간 밴드를 세운다.

let wseq = 0
function work(p: Partial<MoveWorkInput> & { roomNo: string; date: string }): MoveWorkInput {
  wseq++
  return {
    id: p.id ?? `w${wseq}`,
    roomId: p.roomId ?? `room-${p.roomNo}`,
    roomNo: p.roomNo,
    date: p.date,
    done: p.done ?? false,
    kindLabel: p.kindLabel ?? '퇴실 청소',
    performerLabel: p.performerLabel ?? null,
    vacancyExcluded: p.vacancyExcluded ?? false,
  }
}

// ── 무회귀 ── 청소를 얹어도 거주 쪽 수가 한 톨도 안 바뀐다.
{
  const gone = lease({ id: 'w-gone', roomNo: '404', status: 'CHECKED_OUT', moveInDate: '2026-08-01', expectedMoveOut: '2026-08-06', moveOutDate: '2026-08-06', tenantName: '이성준' })
  const now = lease({ id: 'w-now', roomNo: '404', status: 'ACTIVE', moveInDate: '2026-08-15', expectedMoveOut: '2026-08-31', tenantName: '조성훈' })
  const bare = build([gone, now], [gone, now])
  // 공백 한복판(8/10)에 하루짜리 청소를 놓는다 — 섞이면 8/7~8/14 한 구간이 둘로 쪼개진다.
  const withWork = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [gone, now], context: [gone, now],
    works: [work({ roomNo: '404', date: '2026-08-10', done: true })],
  })
  eq('작업 · 공실 캡션 불변', withWork.rows[0].gaps, bare.rows[0].gaps)
  eq('작업 · 공실 캡션은 여전히 한 구간', withWork.rows[0].gaps, [{ startDay: 7, endDay: 14, days: 8 }])
  eq('작업 · 막대 수 불변', withWork.rows[0].bars.length, bare.rows[0].bars.length)
  eq('작업 · 막대 id 에 청소가 안 섞인다', withWork.rows[0].bars.map(b => b.id), bare.rows[0].bars.map(b => b.id))
  eq('작업 · events 불변', withWork.events.map(e => [e.day, e.type]), bare.events.map(e => [e.day, e.type]))
  eq('작업 · 홈 이달 입퇴실 건수 불변', withWork.eventCount, bare.eventCount)
  eq('작업 · 첫 변동일 불변(청소는 입퇴실 변동이 아니다)', withWork.rows[0].firstChangeDay, bare.rows[0].firstChangeDay)
  eq('작업 · 거주 레인 수 불변', withWork.rows[0].laneCount, bare.rows[0].laneCount)
  eq('작업 · 작업 레인은 따로 센다', withWork.rows[0].workLaneCount, 1)
  eq('작업 · 그 자리에 청소 한 건', withWork.rows[0].works.map(w => [w.day, w.status]), [[10, 'done']])
  eq('작업 · 청소 없는 행은 레인 0(종전과 한 픽셀도 다르지 않다)', bare.rows[0].workLaneCount, 0)
  eq('작업 · 청소 없는 행의 works 는 빈 배열', bare.rows[0].works, [])
}

// ── 충돌 ── 거주 막대와 같은 날 청소가 서도 충돌이 아니다.
{
  const stay = lease({ id: 'w-stay', roomNo: '413', status: 'ACTIVE', moveInDate: '2026-08-01', expectedMoveOut: '2026-08-31', tenantName: '거주자' })
  const out = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [stay], context: [stay],
    works: [work({ roomNo: '413', date: '2026-08-14' })],
  })
  eq('작업 · 거주와 겹쳐도 충돌 0', out.rows[0].conflicts.length, 0)
  eq('작업 · 겹침 구간도 안 선다', out.rows[0].overlaps, [])
  eq('작업 · 그날 사람이 있었다는 사실은 남는다(소리로 읽을 자리)', out.rows[0].works[0].occupied, true)
}

// ── 행 생성 ── 공실 작업은 행을 만들고, 거주 중 작업은 안 만든다.
{
  const empty = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [], context: [],
    works: [work({ roomNo: '415', date: '2026-08-12' })],
  })
  eq('행 생성 · 공실 작업은 행을 만든다', empty.rows.map(r => r.roomNo), ['415'])
  eq('행 생성 · 그 행은 막대가 없다', empty.rows[0].bars.length, 0)
  eq('행 생성 · 그래도 입퇴실 건수는 0 이다', empty.eventCount, 0)

  const held = lease({ id: 'w-held', roomNo: '520', status: 'ACTIVE', moveInDate: '2026-01-01', expectedMoveOut: null, tenantName: '관통' })
  const during = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [], context: [held],
    works: [work({ roomNo: '520', date: '2026-08-12' })],
  })
  eq('행 생성 · 거주 중 작업은 행을 안 만든다', during.rows.length, 0)

  const excluded = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [], context: [],
    works: [work({ roomNo: '601', date: '2026-08-13', done: true, vacancyExcluded: true })],
  })
  eq('행 생성 · 창고·사무실은 비어 있어도 행을 안 만든다', excluded.rows.length, 0)
}

// ── 상태 ── 예정일 당일은 아직 지연이 아니다.
{
  const out = buildMoveCalendar({
    month: MONTH, today: '2026-08-18', changed: [], context: [],
    works: [
      work({ id: 'w-y', roomId: 'room-A', roomNo: '401', date: '2026-08-17' }),
      work({ id: 'w-t', roomId: 'room-A', roomNo: '401', date: '2026-08-18' }),
      work({ id: 'w-m', roomId: 'room-A', roomNo: '401', date: '2026-08-19' }),
      work({ id: 'w-d', roomId: 'room-A', roomNo: '401', date: '2026-08-19', done: true }),
    ],
  })
  eq('상태 · 어제는 예정일 경과, 오늘·내일은 예정, 완료는 완료',
    out.rows[0].works.map(w => [w.date, w.status]),
    [['2026-08-17', 'overdue'], ['2026-08-18', 'planned'], ['2026-08-19', 'planned'], ['2026-08-19', 'done']])
  eq('상태 · 같은 날 두 건은 층이 갈린다(하나가 하나를 덮지 않는다)',
    out.rows[0].works.filter(w => w.date === '2026-08-19').map(w => w.lane), [0, 1])
  eq('상태 · 작업 레인 둘', out.rows[0].workLaneCount, 2)
}

// ── 범위 밖 ── 창 밖 작업은 행도 띠도 안 만든다.
{
  const out = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [], context: [],
    works: [work({ roomNo: '409', date: '2026-09-02' })],
  })
  eq('범위 밖 작업은 행을 안 만든다', out.rows.length, 0)
}

// ── 요약 줄 ── 아직 안 끝난 청소만, 지난 예정도 함께.
{
  const stay = lease({ id: 'w-up', roomNo: '514', status: 'CHECKED_OUT', moveInDate: '2026-07-01', expectedMoveOut: '2026-08-16', moveOutDate: '2026-08-16', tenantName: '조선영' })
  const out = range({
    from: '2026-07-01', to: '2026-10-31', changed: [stay], today: '2026-08-20',
    works: [
      work({ id: 'u-late', roomNo: '514', date: '2026-08-19' }),
      work({ id: 'u-soon', roomNo: '514', date: '2026-08-21' }),
      work({ id: 'u-done', roomNo: '514', date: '2026-08-05', done: true }),
      work({ id: 'u-far',  roomNo: '514', date: '2026-10-01' }),
    ],
  })
  eq('요약 줄 · 지난 예정과 다가오는 예정만, 완료·먼 예정은 뺀다',
    out.upcomingWorks.map(w => [w.id, w.status]), [['u-late', 'overdue'], ['u-soon', 'planned']])
  eq('요약 줄 · 어느 방인지가 함께 실린다', out.upcomingWorks[0].roomNo, '514')
  eq('요약 줄 · 입퇴실 요약은 청소에 안 오염된다', out.upcoming.map(e => e.date), [])
  eq('행 · 완료·먼 예정은 트랙에 그대로 있다', out.rows[0].works.length, 4)
}

// ══ 라벨 일반화(2026-08-21 운영자 확정 — 청소는 작업의 한 종목) ═══════
//
// 이 절이 못 박는 것은 둘이다. ① 트랙 레일 문구는 kindLabel 을 그대로 쓴다 — '청소'를
// 화면이나 조립이 지어내 붙이면 종목이 늘 때 도배가 '도배 청소'로 읽힌다. ② 조립은
// kindLabel 을 한 글자도 안 바꾼다 — 종류 문구의 주인은 종목의 공급자다.
{
  eq('라벨 · 레일 문구는 kindLabel 그대로(청소)', moveWorkRailLabel({ kindLabel: '퇴실 청소', status: 'planned' }), '퇴실 청소 예정')
  eq('라벨 · 지연 낱말은 정본(예정일 경과)', moveWorkRailLabel({ kindLabel: '퇴실 청소', status: 'overdue' }), '퇴실 청소 예정일 경과')
  eq('라벨 · 완료', moveWorkRailLabel({ kindLabel: '공사·도배 후 청소', status: 'done' }), '공사·도배 후 청소 완료')
  eq('라벨 · 청소 아닌 종목에 청소를 붙이지 않는다', moveWorkRailLabel({ kindLabel: '도배', status: 'planned' }), '도배 예정')
  eq('라벨 · 장판도 제 이름 그대로', moveWorkRailLabel({ kindLabel: '장판', status: 'done' }), '장판 완료')

  const out = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [], context: [],
    works: [work({ roomNo: '417', date: '2026-08-12', kindLabel: '도배' })],
  })
  eq('라벨 · 조립은 kindLabel 을 한 글자도 안 바꾼다', out.rows[0].works[0].kindLabel, '도배')
  eq("라벨 · '도배 청소'는 어디에도 없다", JSON.stringify(out.rows).includes('도배 청소'), false)
}

// ══ 축 필터(전체 / 입퇴실 / 작업, 2026-08-21 운영자 확정) ═══════════
//
// 이 절이 못 박는 것은 셋이다. ① '전체'는 원본 그대로다(참조까지 — memo 아래에서 헛
// 재렌더를 안 만든다). ② '입퇴실'의 행 생존 판정은 조립과 **같은 술어**(moveRowSurvives)를
// 지난다 — 화면이 규칙을 다시 적으면 두 번째 진실이 된다. ③ '작업'은 거주 막대를 지우지
// 않는다(운영자 확정 — 막대가 남아야 공실 캡션·겹침 밴드가 근거를 잃지 않는다).
{
  const moved = lease({ id: 'x-mv', roomNo: '404', status: 'CHECKED_OUT', moveInDate: '2026-08-01', expectedMoveOut: '2026-08-06', moveOutDate: '2026-08-06', tenantName: '막대만' })
  const both = lease({ id: 'x-bt', roomNo: '413', status: 'ACTIVE', moveInDate: '2026-08-10', expectedMoveOut: '2026-08-31', tenantName: '막대와작업' })
  const out = buildMoveCalendar({
    month: MONTH, today: TODAY, changed: [moved, both], context: [moved, both],
    works: [
      work({ id: 'x-w1', roomNo: '413', date: '2026-08-12', done: true }),
      work({ id: 'x-w2', roomNo: '415', date: '2026-08-14' }),
    ],
  })
  eq('축 · 전제(행 셋: 막대만·막대와작업·작업만)', out.rows.map(r => [r.roomNo, r.bars.length > 0, r.works.length > 0]),
    [['404', true, false], ['413', true, true], ['415', false, true]])

  eq('축 · 전체는 원본 배열 참조 그대로', filterMoveRows(out.rows, 'all') === out.rows, true)

  const moves = filterMoveRows(out.rows, 'moves')
  eq('축 · 입퇴실은 작업만 있는 행이 사라진다', moves.map(r => r.roomNo), ['404', '413'])
  eq('축 · 입퇴실에서 작업이 걷힌다', moves.map(r => r.works.length), [0, 0])
  eq('축 · 걷힌 행의 작업 레인도 0(팩을 다시 돈다)', moves.map(r => r.workLaneCount), [0, 0])
  eq('축 · 작업이 없던 행은 행 객체 참조 그대로', moves[0] === out.rows[0], true)
  eq('축 · 걷어도 막대는 같은 배열이다(재조립 없음)', moves[1].bars === out.rows[1].bars, true)
  eq('축 · 공백·겹침·꼬리도 같은 값이다', [moves[1].gaps, moves[1].overlaps, moves[1].tail],
    [out.rows[1].gaps, out.rows[1].overlaps, out.rows[1].tail])
  eq('축 · 원본은 어느 축에서도 무변조', out.rows[1].works.length, 1)

  const works = filterMoveRows(out.rows, 'works')
  eq('축 · 작업은 작업 있는 행만', works.map(r => r.roomNo), ['413', '415'])
  eq('축 · 거주 막대는 그대로 둔다(운영자 확정)', works[0].bars.length, out.rows[1].bars.length)
  eq('축 · 작업 축의 행은 참조 그대로', works[0] === out.rows[1] && works[1] === out.rows[2], true)

  eq('술어 · 막대도 작업도 없으면 행이 아니다', moveRowSurvives({ bars: [], works: [] }), false)
  eq('술어 · 작업만 있어도 행이다', moveRowSurvives({ bars: [], works: [1] }), true)
  eq('술어 · 막대만 있어도 행이다', moveRowSurvives({ bars: [1], works: [] }), true)
}

// ══ '전체' 축 = 모든 호실(2026-10-19 운영자 승인 "추천대로") ══════════════
//
// 이 절이 못 박는 것은 넷이다. ① 무변동 행(steady)은 사건을 안 낸다. 방 목록을 주든 안 주든
// events·달별 건수·접미 N·다가오는 입퇴실·beyond·변동 행이 바이트 단위로 같다. ② '전체' 행은
// 집계 제외 방을 뺀 방 집합과 같고 방마다 한 번이다. ③ 무변동 행에는 창 안 경계 막대가 없다.
// ④ 정렬은 변동 덩어리 다음 무변동, 각자 호실번호 자연 정렬이다.
// 위쪽 월 창 회귀(관통 거주 행 0 · 거주 중 작업 행 0 · 창고 행 0)는 그대로 참이다. 월 창은 방 목록을 모른다.

const SF = '2026-09-01', ST = '2026-12-31', SD = '2026-10-19'
const roomOf = (roomNo: string, vacancyExcluded = false): MoveRangeRoom => ({ id: `room-${roomNo}`, roomNo, vacancyExcluded })
type SteadyIn = { changed?: MoveCalendarLease[]; context?: MoveCalendarLease[]; cover?: MoveCalendarLease[]; rooms: MoveRangeRoom[]; works?: MoveWorkInput[]; from?: string; to?: string; today?: string }
const withRooms = (p: SteadyIn) => buildMoveRange({
  from: p.from ?? SF, to: p.to ?? ST, today: p.today ?? SD, focusMonth: (p.from ?? SF).slice(0, 7),
  changed: p.changed ?? [], context: p.context ?? p.changed ?? [], rooms: p.rooms, cover: p.cover ?? [],
  works: p.works, beyond: null, canExtendPast: false,
})
const withoutRooms = (p: SteadyIn) => withRooms({ ...p, rooms: [], cover: [] })
const axisIds = (rows: { roomNo: string; steady?: true }[]) => rows.map(r => `${r.roomNo}${r.steady ? '*' : ''}`)
const J = (x: unknown) => JSON.stringify(x)

/** 불변 단언. 방 목록 유무와 무관해야 하는 것 전부. */
function invariants(name: string, p: SteadyIn) {
  const a = withRooms(p), b = withoutRooms(p)
  eq(`${name} · 불변 · 달별 건수`, a.months, b.months)
  eq(`${name} · 불변 · 접미 N`, a.focusEventCount, b.focusEventCount)
  eq(`${name} · 불변 · 다가오는 입퇴실`, a.upcoming, b.upcoming)
  eq(`${name} · 불변 · beyond`, a.beyond, b.beyond)
  eq(`${name} · 불변 · 변동 행 바이트 동일`, J(a.rows.filter(r => !r.steady)), J(b.rows))
  eq(`${name} · 불변 · 입퇴실 축 바이트 동일`, J(filterMoveRows(a.rows, 'moves')), J(filterMoveRows(b.rows, 'moves')))
  // 충돌은 무변동 행에도 선다(사고 알림, 독립 검수 2026-10-19 확정). 변동 행 몫은 방 목록 유무와 같아야 한다.
  const changeIds = new Set(b.rows.map(r => r.roomId))
  eq(`${name} · 불변 · 변동 행 충돌`, J(a.conflicts.filter(c => changeIds.has(c.roomId))), J(b.conflicts))
  const ids = a.rows.map(r => r.roomId)
  eq(`${name} · 방마다 한 번`, new Set(ids).size, ids.length)
  const want = new Set([...p.rooms.filter(r => !r.vacancyExcluded).map(r => r.id), ...b.rows.map(r => r.roomId)])
  eq(`${name} · '전체' 행 = 방 집합(제외 방 빼고, 변동으로 선 제외 방은 남는다)`, [...ids].sort(), [...want].sort())
  eq(`${name} · 무변동 행에 창 안 경계 막대 없음`, a.rows.filter(r => r.steady).flatMap(r => r.bars.filter(x => x.startsInRange || x.endsInRange)).length, 0)
  const firstSteady = a.rows.findIndex(r => r.steady)
  eq(`${name} · 변동 덩어리 다음 무변동`, firstSteady < 0 || a.rows.slice(firstSteady).every(r => r.steady), true)
  return a
}

// ── 상황 열하나 × 축 셋 ── 표의 각 칸은 '전체' / '입퇴실' / '작업' 의 행(별표는 무변동 행).
{
  // S1 변동만. 10/5 입실.
  const s1 = lease({ id: 's1', roomNo: '401', status: 'ACTIVE', moveInDate: '2026-10-05', tenantName: '변동' })
  // S2 변동+작업. 10/10 퇴실, 10/12 퇴실 청소(공실 작업).
  const s2 = lease({ id: 's2', roomNo: '402', status: 'CHECKED_OUT', moveInDate: '2026-03-01', moveOutDate: '2026-10-10', tenantName: '나감' })
  // S4 관통 거주. 1월부터 퇴실일 없음. 조회는 cover(점유 계약 전부)로만 싣는다.
  const s4 = lease({ id: 's4', roomNo: '404', status: 'ACTIVE', moveInDate: '2026-01-01', tenantName: '관통' })
  // S5 관통 + 거주 중 작업. 작업이 있는 방이라 조회가 context 에도 싣는다(fetchMoveLeases workRoomIds).
  const s5 = lease({ id: 's5', roomNo: '405', status: 'ACTIVE', moveInDate: '2025-11-01', tenantName: '사는중' })
  // S10 이사일이 창 밖. 7/10 에 506호에서 508호로. 창(9~12월)에는 변동이 없다.
  const s10 = lease({ id: 's10', roomNo: '508', status: 'ACTIVE', moveInDate: '2026-01-05', tenantName: '이사함', stays: stays('s10', [['506', '2026-01-05', '2026-07-10'], ['508', '2026-07-10', null]]) })
  // S11 날짜 없는 거주. 입주일·구간 날짜가 모두 없다(운영 407·412·512·518호 모양). 작업도 하나.
  const s11 = lease({ id: 's11', roomNo: '412', status: 'ACTIVE', tenantName: '미상', stays: [{ id: 's11-s1', roomId: 'room-412', roomNo: '412', startDate: null, endDate: null }] })
  const works = [
    work({ id: 'w2', roomNo: '402', date: '2026-10-12', done: true }),
    work({ id: 'w3', roomNo: '403', date: '2026-10-15' }),
    work({ id: 'w5', roomNo: '405', date: '2026-10-20', kindLabel: '방충망 교체' }),
    work({ id: 'w8', roomNo: '601', date: '2026-10-21', vacancyExcluded: true }),
    work({ id: 'w11', roomNo: '412', date: '2026-10-22', kindLabel: '도배' }),
  ]
  const rooms = ['401', '402', '403', '404', '405', '406', '506', '508', '412'].map(n => roomOf(n))
    .concat([roomOf('415', true), roomOf('601', true)])
  const p: SteadyIn = {
    changed: [s1, s2],
    context: [s1, s2, s5, s11],          // 작업이 있는 방(405·412)의 점유 계약. 종전 조회 규칙 그대로
    cover: [s1, s4, s5, s10, s11],       // 점유 계약 전부(퇴실 완료 S2 는 창 안 경계라 changed 가 진다)
    rooms, works,
  }
  const a = invariants('표', p)
  const all = filterMoveRows(a.rows, 'all'), mv = filterMoveRows(a.rows, 'moves'), wk = filterMoveRows(a.rows, 'works')
  eq('표 · 전체', axisIds(all), ['401', '402', '403', '404*', '405*', '406*', '412*', '506*', '508*'])
  eq('표 · 입퇴실', axisIds(mv), ['401', '402'])
  eq('표 · 작업(무변동 행이 섞이면 호실번호 하나로)', axisIds(wk), ['402', '403', '405*', '412*'])

  const row = (no: string) => a.rows.find(r => r.roomNo === no)!
  // S1·S2·S3 는 종전 규칙 그대로 변동 행이다.
  eq('S1 변동만 · 변동 행', [row('401').steady ?? false, row('401').bars.length], [false, 1])
  eq('S2 변동+작업 · 작업이 얹힌다', row('402').works.map(w => w.id), ['w2'])
  eq('S3 공실 작업만 · 변동 행(막대 없음)', [row('403').steady ?? false, row('403').bars.length, row('403').works.length], [false, 0, 1])
  // S4 관통 거주. 창 전체 막대, 양 끝 직각, 사건 0.
  const b4 = row('404').bars[0]
  eq('S4 관통 · 무변동 행', row('404').steady, true)
  eq('S4 관통 · 창 전체 막대·양 끝 잘림', [b4.startDay, b4.endDay, b4.clippedStart, b4.clippedEnd], [1, a.days, true, true])
  eq('S4 관통 · lib 라벨은 그대로(화면이 이름만 세운다)', b4.label, '퇴실일 미정')
  eq('S4 관통 · 공백 없음', row('404').gaps, [])
  // S5 거주 중 작업. 무변동 행에 얹히고, 그날 사람이 있었다는 관찰이 선다. 요약에도 든다.
  eq('S5 거주 중 작업 · 무변동 행에 얹힌다', [row('405').steady, row('405').works.map(w => [w.id, w.occupied])], [true, [['w5', true]]])
  eq('S5 거주 중 작업 · 요약(다가오는 작업)에 든다', a.upcomingWorks.map(w => w.id).includes('w5'), true)
  eq('S5 거주 중 작업 · 방 목록이 없으면 종전대로 행이 없다', withoutRooms(p).rows.some(r => r.roomNo === '405'), false)
  // S6 완전 공실. 막대도 작업도 없지만 '전체'에는 선다. 공백은 창 전체(화면은 날수 없이 '공실'만).
  eq('S6 완전 공실 · 무변동 빈 행', [row('406').steady, row('406').bars.length, row('406').works.length], [true, 0, 0])
  eq('S6 완전 공실 · 공백은 창 전체', row('406').gaps, [{ startDay: 1, endDay: a.days, days: a.days }])
  // S7·S8 집계 제외. 행이 없고 카드 끝 한 줄이 수를 말한다. 작업이 있어도 행을 안 만든다(기존 규칙).
  eq('S7 집계 제외 · 행 없음', a.rows.some(r => r.roomNo === '415'), false)
  eq('S8 집계 제외+작업 · 행 없음', a.rows.some(r => r.roomNo === '601'), false)
  eq('S8 집계 제외+작업 · 요약에도 없다', a.upcomingWorks.some(w => w.id === 'w8'), false)
  eq('S7·S8 · 제외 수', a.excludedRoomCount, 2)
  eq('S7·S8 · 안내 문구', excludedRoomsNote(a.excludedRoomCount), '창고·사무실 2실은 일정에 넣지 않습니다.')
  // S10 이사일이 창 밖. 옛 방은 빈 무변동 행, 새 방은 관통 막대. 이사 문구는 창 안에 안 선다.
  eq('S10 이사 창 밖 · 옛 방은 빈 무변동 행', [row('506').steady, row('506').bars.length], [true, 0])
  eq('S10 이사 창 밖 · 새 방은 관통 막대(시작 조각 없음)', [row('508').steady, row('508').bars[0].startLabel, row('508').bars[0].clippedStart], [true, null, true])
  // S11 날짜 없는 거주('시작일 미상 거주'). 창 처음부터 막대이고, 그 방 작업은 거주 중 작업이다.
  const b11 = row('412').bars[0]
  eq('S11 날짜 없는 거주 · 창 전체 거주 막대', [b11.kind, b11.startDay, b11.endDay, b11.clippedStart, b11.clippedEnd], ['resident', 1, a.days, true, true])
  eq('S11 날짜 없는 거주 · 작업은 거주 중(행을 새로 세우지 않는다)', [row('412').steady, row('412').works.map(w => w.occupied)], [true, [true]])
  eq('S11 날짜 없는 거주 · 방 목록 없이는 행이 없다(공실 작업으로 안 읽는다)', withoutRooms(p).rows.some(r => r.roomNo === '412'), false)
  // 소제목. '전체'에서만, 첫 무변동 행 앞에.
  eq('소제목 · 전체', steadyHeading(all, 'all'), { index: 3, label: '변동 없음 6실' })
  eq('소제목 · 입퇴실 축에는 없다', steadyHeading(mv, 'moves'), null)
  eq('소제목 · 작업 축에는 없다', steadyHeading(wk, 'works'), null)
  // 사건. 무변동 행은 한 건도 안 낸다(S1 입실 1 + S2 퇴실 1).
  eq('사건 · 변동분만', a.months.reduce((n, m) => n + m.eventCount, 0), 2)
}

// ── S9 과거 창 퇴실 완료 관통 ── 그때 살던 방을 빈 방으로 칠하지 않는다(cover 가 지는 몫).
{
  const gone = lease({ id: 's9', roomNo: '519', status: 'CHECKED_OUT', moveInDate: '2024-12-20', moveOutDate: '2026-07-20', tenantName: '그때살던' })
  const p: SteadyIn = { from: '2026-03-01', to: '2026-06-30', today: SD, rooms: [roomOf('519')], cover: [gone] }
  const a = invariants('S9', p)
  const r = a.rows[0]
  eq('S9 과거 창 퇴실 완료 관통 · 무변동 거주 막대', [r.steady, r.bars.length, r.bars[0].kind, r.gaps], [true, 1, 'resident', []])
  eq('S9 · cover 를 안 실으면 빈 방으로 칠해진다(대조)', withRooms({ ...p, cover: [] }).rows[0].bars.length, 0)
}

// ── S12 계획만 창 안 ── 변동 계약 조회에 안 걸리는 계약의 '아직 안 옮긴 이사'(임시 호실에 들어간 지
// 한 달 넘은 뒤의 이사 예정). 종전에도 사건이 아니었고 행도 없었다. 무변동 행에는 막대가 서되 사건은
// 여전히 0 이다(표지가 사건을 막는다). 이 모양이 운영 데이터에 나타나면 감지망 축 D2 가 운다.
{
  const mv = lease({
    id: 'p12', roomNo: '404', status: 'ACTIVE', moveInDate: '2026-07-20', tenantName: '임시호실',
    stays: [
      { id: 'p12-s1', roomId: 'room-402', roomNo: '402', startDate: '2026-07-20', endDate: '2026-09-10' },
      { id: 'plan-p12-1', roomId: 'room-404', roomNo: '404', startDate: '2026-09-10', endDate: null },
    ],
  })
  const p: SteadyIn = { rooms: [roomOf('402'), roomOf('404')], cover: [mv] }
  const a = withRooms(p), b = withoutRooms(p)
  eq('S12 계획만 창 안 · 두 방 다 무변동 행', axisIds(a.rows), ['402*', '404*'])
  eq('S12 계획만 창 안 · 막대는 그대로 선다(이사 문구)', a.rows.map(r => r.bars[0].endLabel ?? r.bars[0].startLabel), ['9/10 404호로 이사', '9/10 402호에서 이사 예정'])
  eq('S12 계획만 창 안 · 사건은 0(방 목록 유무 같음)', [a.months, a.upcoming], [b.months, b.upcoming])
  eq('S12 계획만 창 안 · 사건 0', a.months.reduce((n, m) => n + m.eventCount, 0), 0)
}

// ── 날짜 없는 조각의 점유 판정 ── 거주 중만 덮고, 예약은 여전히 아무 날도 안 덮는다(월 창도 같은 판정).
{
  const dateless = lease({ id: 'dl', roomNo: '518', status: 'ACTIVE', tenantName: '미상', stays: [{ id: 'dl-s1', roomId: 'room-518', roomNo: '518', startDate: null, endDate: null }] })
  const occ = buildMoveCalendar({ month: MONTH, today: TODAY, changed: [], context: [dateless], works: [work({ roomNo: '518', date: '2026-08-12' })] })
  eq('날짜 없는 거주 · 그 방 작업은 거주 중이라 행을 안 만든다(월 창)', occ.rows.length, 0)
  const rsv = lease({ id: 'dr', roomNo: '517', status: 'RESERVED', tenantName: '날짜없는예약' })
  const vac = buildMoveCalendar({ month: MONTH, today: TODAY, changed: [], context: [rsv], works: [work({ roomNo: '517', date: '2026-08-12' })] })
  eq('날짜 없는 예약 · 그 방 작업은 여전히 공실 작업(월 창)', vac.rows.map(r => r.roomNo), ['517'])
  const gone = lease({ id: 'dg', roomNo: '516', status: 'CHECKED_OUT', tenantName: '끝없는퇴실', stays: [{ id: 'dg-s1', roomId: 'room-516', roomNo: '516', startDate: null, endDate: null }] })
  const vac2 = buildMoveCalendar({ month: MONTH, today: TODAY, changed: [], context: [gone], works: [work({ roomNo: '516', date: '2026-08-12' })] })
  eq('끝 없는 퇴실 기록 · 아무 날도 안 덮는다(month-population)', vac2.rows.map(r => r.roomNo), ['516'])
}

// ── 집계 제외 방이 변동으로 선 경우 ── 변동 행은 그대로 남고, 안내 수에서는 빠진다.
{
  const rsv = lease({ id: 'xr', roomNo: '601', status: 'RESERVED', moveInDate: '2026-10-25', tenantName: '창고예약' })
  const a = invariants('제외+변동', { changed: [rsv], rooms: [roomOf('601', true), roomOf('602', true), roomOf('401')] })
  eq('제외+변동 · 변동 행은 남는다', axisIds(a.rows), ['601', '401*'])
  eq('제외+변동 · 안내 수는 행 없는 제외 방만', a.excludedRoomCount, 1)
}

// ── 정렬 ── 변동 덩어리 다음 무변동, 각자 호실번호 자연 정렬(형제 화면 정본 localeCompare numeric).
{
  const mk = (no: string, d: string) => lease({ roomNo: no, status: 'ACTIVE', moveInDate: d })
  const a = invariants('정렬', {
    changed: [mk('1001', '2026-10-02'), mk('999', '2026-10-03'), mk('A동-10', '2026-10-04'), mk('A동-9', '2026-10-05')],
    rooms: ['1001', '999', 'A동-10', 'A동-9', '10', '9', 'B동-2', 'B동-11'].map(n => roomOf(n)),
  })
  eq('정렬 · 자연 정렬', axisIds(a.rows), ['999', '1001', 'A동-9', 'A동-10', '9*', '10*', 'B동-2*', 'B동-11*'])
}

// ── '작업' 축 순서 ── 소제목이 없는 축이라 무변동 행이 섞이면 호실번호 하나로 다시 세운다.
// 변동 행(409, 공실 작업)보다 번호가 낮은 무변동 행(405, 거주 중 작업)이 앞에 선다.
{
  const live = lease({ id: 'wo-l', roomNo: '405', status: 'ACTIVE', moveInDate: '2026-01-01', tenantName: '사는중' })
  const a = withRooms({
    context: [live], cover: [live], rooms: [roomOf('405'), roomOf('409')],
    works: [work({ id: 'wo-1', roomNo: '409', date: '2026-10-21' }), work({ id: 'wo-2', roomNo: '405', date: '2026-10-22' })],
  })
  eq("'작업' 축 · 전체 순서는 변동 덩어리 먼저", axisIds(a.rows), ['409', '405*'])
  eq("'작업' 축 · 호실번호 하나로", axisIds(filterMoveRows(a.rows, 'works')), ['405*', '409'])
}

// ── 전부 무변동 ── 가를 덩어리가 없으면 소제목도 없다(먼 달 점프, 웹디자이너 패스).
{
  const live = lease({ id: 'all-s', roomNo: '401', status: 'ACTIVE', moveInDate: '2026-01-01' })
  const a = withRooms({ cover: [live], rooms: [roomOf('401'), roomOf('402')] })
  eq('전부 무변동 · 행은 다 무변동', axisIds(a.rows), ['401*', '402*'])
  eq('전부 무변동 · 소제목 없음', steadyHeading(a.rows, 'all'), null)
}

// ── 기간 계약 무변동 행 ── 퇴실일이 창 밖에 잡힌 거주는 열린 막대가 아니다. 화면은 '1/31 퇴실'을
// 남기고(이름만 세우는 것은 openEnded 막대뿐, 화면 그물 ②) lib 는 그 문구를 상태로 낸다.
{
  const term = lease({ id: 'term', roomNo: '410', status: 'ACTIVE', moveInDate: '2026-05-01', expectedMoveOut: '2027-01-31' })
  const r = withRooms({ cover: [term], rooms: [roomOf('410')] }).rows[0]
  eq('기간 계약 무변동 · 열린 막대 아님', [r.steady, r.bars[0].openEnded, r.bars[0].clippedEnd], [true, false, true])
  eq('기간 계약 무변동 · 상태 문구는 창 밖 퇴실일', r.bars[0].stateLabel, '1/31 퇴실')
}

// ── 무변동 행 충돌 ── 종전에는 행이 없어 안 보이던 사고가 무변동 행에서 선다(의도, 독립 검수 확정).
// (b) 입주일이 창 첫날 전인 연체 예약 + 퇴실일 미정 거주 · (c) 입주일 없는 예약 + 거주.
{
  const chg = lease({ id: 'cf-chg', roomNo: '401', status: 'ACTIVE', moveInDate: '2026-10-05', tenantName: '변동거주' })
  // 변동 행(401)에도 충돌 하나. 없으면 '불변 · 변동 행 충돌'이 [] 와 [] 를 맞대는 빈 비교가 된다(재확인 지적).
  const chgRsv = lease({ id: 'cf-chg-rsv', roomNo: '401', status: 'RESERVED', moveInDate: '2026-11-10', tenantName: '변동예약' })
  const res = lease({ id: 'cf-res', roomNo: '407', status: 'ACTIVE', moveInDate: '2026-01-10', tenantName: '거주' })
  const late = lease({ id: 'cf-late', roomNo: '407', status: 'RESERVED', moveInDate: '2026-08-20', expectedMoveOut: '2027-02-19', tenantName: '연체예약' })
  const res9 = lease({ id: 'cf-res9', roomNo: '409', status: 'ACTIVE', moveInDate: '2026-02-01', tenantName: '거주9' })
  const nodate = lease({ id: 'cf-nodate', roomNo: '409', status: 'RESERVED', tenantName: '날짜없음' })
  const p: SteadyIn = { changed: [chg, chgRsv], rooms: [roomOf('401'), roomOf('407'), roomOf('409')], cover: [chg, chgRsv, res, late, res9, nodate] }
  eq('무변동 충돌 · 비교 전제(변동 행 충돌이 실제로 있다)', withoutRooms(p).conflicts.map(c => [c.roomNo, c.kind]), [['401', 'indefinite']])
  const a = invariants('무변동 충돌', p)
  eq('무변동 충돌 · (b)(c) 무기한 거주 위 예약', a.conflicts.map(c => [c.roomNo, c.kind, c.text]), [
    ['401', 'indefinite', '401호 변동거주님 퇴실일이 미정인데 변동예약님 입실 예약이 잡혀 있습니다.'],
    ['407', 'indefinite', '407호 거주님 퇴실일이 미정인데 연체예약님 입실 예약이 잡혀 있습니다.'],
    ['409', 'indefinite', '409호 거주9님 퇴실일이 미정인데 날짜없음님 입실 예약이 잡혀 있습니다.'],
  ])
  eq('무변동 충돌 · 방 목록이 없으면 무변동 몫은 종전대로 안 보인다', withoutRooms(p).conflicts.some(c => c.roomNo !== '401'), false)
  eq('무변동 충돌 · 행 좌측 팁 근거(행 충돌)', a.rows.filter(r => r.steady).map(r => r.conflicts.length), [1, 1])
}

// ── 범위 경로 context(pickContext) ── 종전 SQL 과 같은 두 갈래(지금 방 · 같은 영업장 옛 방 구간).
// 구간 갈래는 운영 데이터에 그 모양이 없으면 감지망 D4 가 못 보므로 여기서 직접 고정한다.
{
  const occ = [
    { id: 'now-in', roomId: 'r1', roomStays: [] },
    { id: 'old-only', roomId: 'r9', roomStays: [{ roomId: 'r2', propertyId: 'p1' }] },
    { id: 'old-other-prop', roomId: 'r9', roomStays: [{ roomId: 'r2', propertyId: 'p2' }] },
    { id: 'out', roomId: 'r9', roomStays: [{ roomId: 'r8', propertyId: 'p1' }] },
    { id: 'no-room', roomId: null, roomStays: [{ roomId: 'r1', propertyId: 'p1' }] },
  ]
  eq('pickContext · 지금 방 · 옛 방 구간(같은 영업장) · 호실 해제 계약의 구간',
    pickContext(occ, 'p1', ['r1', 'r2']).map(x => x.id), ['now-in', 'old-only', 'no-room'])
  eq('pickContext · 방 목록이 비면 없다', pickContext(occ, 'p1', []).length, 0)
}

// ── 호실 열 글자 조각 ── 숫자 덩어리(앞뒤 영문 포함)는 한 조각이라 줄이 그 안에서 안 끊긴다('1000/1호' 방지).
{
  const c = (l: string) => roomLabelChunks(l).map(x => [x.text, x.keep])
  eq('호실 조각 · 숫자 호실', c('1001호'), [['1001', true], ['호', false]])
  eq('호실 조각 · 다섯 자리', c('10001호'), [['10001', true], ['호', false]])
  eq('호실 조각 · 동 번호 혼합', c('A동-1001호'), [['A동-', false], ['1001', true], ['호', false]])
  eq('호실 조각 · 영문 붙은 숫자', c('B1001호'), [['B1001', true], ['호', false]])
  eq('호실 조각 · 띄어 쓴 이름', c('423호 오피스'), [['423', true], ['호 오피스', false]])
  eq('호실 조각 · 숫자 없는 이름', c('옥탑방'), [['옥탑방', false]])
  eq('호실 조각 · 이어 붙이면 원래 글자', roomLabelChunks('A-101-2호').map(x => x.text).join(''), 'A-101-2호')
}

// ── 문구 정본 ──
eq('안내 · 0 이면 줄이 없다', excludedRoomsNote(0), null)
eq('안내 · 운영 수(6)', excludedRoomsNote(6), '창고·사무실 6실은 일정에 넣지 않습니다.')
eq('소제목 · 무변동 행이 없으면 없다', steadyHeading([], 'all'), null)

// ── 빈 방 목록 ── 회귀·감지망이 맞대려고 쓰는 '무변동 행 없음'. 종전 결과와 같다.
{
  const l = lease({ id: 'er', roomNo: '409', status: 'ACTIVE', moveInDate: '2026-10-05' })
  const a = withRooms({ changed: [l], rooms: [] })
  eq('빈 방 목록 · 무변동 행 없음', [a.rows.length, a.excludedRoomCount], [1, 0])
}

console.log(`\n입퇴실 캘린더 조립 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
