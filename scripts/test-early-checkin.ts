// 조기 입실 판정 회귀 — 실행: npx tsx scripts/test-early-checkin.ts
//
// 여기서 고정하는 것 넷(2026-08-26 운영자 실무).
//   · **진행 판정은 값끼리 견주기다** — 플래그를 따로 두면 그것과 실제 점유가 갈리는 날이 온다.
//   · **이동이 끝나면 자연히 꺼진다** — 열린 구간이 본 방으로 옮겨가면 판정이 false 가 되고,
//     두 칸은 사실 기록이라 지우지 않아도 된다.
//   · **하루치는 30분할이다** — 퇴실 일할과 같은 분모를 쓴다(산식이 둘이면 갈린다).
//   · **구간 겹침은 반개구간이다** — 앞사람이 나가는 날 들어오는 당일 회전을 막으면 안 된다.
import {
  isEarlyCheckInActive, earlyChargeSuggest, earlyStayDays, spanOverlaps,
  EARLY_CHARGE_BASE_DAYS,
} from '../lib/earlyCheckIn'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const R404 = 'room-404', R402 = 'room-402'

// ── 진행 판정 ───────────────────────────────────────────────────────
eq('임시 방에 있으면 진행 중',
  isEarlyCheckInActive({ roomId: R404, earlyCheckInRoomId: R402 }, R402), true)
// 이동 완료 — 열린 구간이 본 방으로 옮겨가면 두 칸이 남아 있어도 꺼진다.
eq('본 방으로 옮기면 끝',
  isEarlyCheckInActive({ roomId: R404, earlyCheckInRoomId: R402 }, R404), false)
eq('조기 입실을 안 썼으면 false',
  isEarlyCheckInActive({ roomId: R404, earlyCheckInRoomId: null }, R404), false)
eq('열린 구간이 없으면 false',
  isEarlyCheckInActive({ roomId: R404, earlyCheckInRoomId: R402 }, null), false)
eq('본 방 없는 계약은 false',
  isEarlyCheckInActive({ roomId: null, earlyCheckInRoomId: R402 }, R402), false)
// 임시 방과 본 방이 같으면 조기 입실이라 부를 것이 없다.
eq('두 방이 같으면 false',
  isEarlyCheckInActive({ roomId: R404, earlyCheckInRoomId: R404 }, R404), false)
// 엉뚱한 방에 있으면(데이터 이상) 진행 중이라 하지 않는다 — 그 상태로 게이트를 열면 안 된다.
eq('제3의 방이면 false',
  isEarlyCheckInActive({ roomId: R404, earlyCheckInRoomId: R402 }, 'room-409'), false)

// ── 일수·하루치 ─────────────────────────────────────────────────────
eq('하루 일찍', earlyStayDays('2026-08-31', '2026-09-01'), 1)
eq('사흘 일찍', earlyStayDays('2026-08-29', '2026-09-01'), 3)
eq('같은 날이면 0', earlyStayDays('2026-09-01', '2026-09-01'), 0)
eq('본계약이 더 이르면 0(있을 수 없는 값)', earlyStayDays('2026-09-02', '2026-09-01'), 0)
eq('월 경계를 넘어도 일수로 센다', earlyStayDays('2026-07-30', '2026-08-02'), 3)

eq('47만원 하루치', earlyChargeSuggest(470000, 1), 15667)
eq('47만원 사흘치', earlyChargeSuggest(470000, 3), 47001)
eq('분모는 30', earlyChargeSuggest(300000, 1), 300000 / EARLY_CHARGE_BASE_DAYS)
eq('일수 0 이면 0', earlyChargeSuggest(470000, 0), 0)
eq('이용료 0 이면 0', earlyChargeSuggest(0, 1), 0)

// ── 구간 겹침 ───────────────────────────────────────────────────────
// 반개구간 [start, end) — 앞사람이 나가는 날 새 사람이 들어오는 당일 회전은 겹침이 아니다.
eq('당일 회전은 안 겹친다',
  spanOverlaps({ start: '2026-08-31', end: '2026-09-01' }, { start: '2026-09-01', end: null }), false)
eq('하루라도 물리면 겹친다',
  spanOverlaps({ start: '2026-08-31', end: '2026-09-02' }, { start: '2026-09-01', end: null }), true)
eq('앞사람이 그날 나가면 안 겹친다',
  spanOverlaps({ start: '2026-08-01', end: '2026-08-31' }, { start: '2026-08-31', end: '2026-09-01' }), false)
eq('앞사람이 하루 더 있으면 겹친다',
  spanOverlaps({ start: '2026-08-01', end: '2026-09-01' }, { start: '2026-08-31', end: '2026-09-01' }), true)
// 무기한(end null) 예약이 뒤에 있어도 그 시작 전이면 임시로 쓸 수 있다 — 실측에서 402·409가
// 9/8 예약 때문에 기존 '입주 가능' 판정에서 통째로 빠졌던 자리다.
eq('뒤의 무기한 예약과는 안 겹친다',
  spanOverlaps({ start: '2026-08-31', end: '2026-09-01' }, { start: '2026-09-08', end: null }), false)
eq('무기한끼리는 겹친다',
  spanOverlaps({ start: '2026-08-31', end: null }, { start: '2026-09-08', end: null }), true)

console.log(`\n조기 입실 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
