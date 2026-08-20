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

import { RANGE_JUMP_MONTHS, beyondWindow, buildMoveCalendar, buildMoveRange, daysInMonth, monthLastDay, moveRangeWindow, shiftMonth, type MoveCalendarLease, type MoveStaySpan, type MoveWorkInput } from '../lib/moveCalendar'

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
}) => buildMoveRange({
  from: p.from,
  to: p.to,
  today: p.today ?? TODAY,
  focusMonth: p.focusMonth ?? p.from.slice(0, 7),
  changed: p.changed,
  context: p.context ?? p.changed,
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
    context: [], beyond: { count: 3, firstDate: '2026-11-02' }, canExtendPast: true,
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

console.log(`\n입퇴실 캘린더 조립 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
