// 호실 일정 회귀 — 실행: npx tsx scripts/test-room-schedule.ts
//
// 여기서 고정하는 것 넷(2026-08-26 운영자 확정).
//   · **일정이 진실이고 구간은 파생이다** — 자가 치유가 '오늘의 방'을 알면 게이트가 필요 없다.
//   · **빈틈도 겹침도 막는다** — 빈틈이면 그 며칠 사람이 어디 있는지 모르고, 겹치면 한 사람이
//     두 방에 있게 된다.
//   · **마지막은 계약 호실이고 무기한이다** — 임시로 끝나는 일정은 갈 곳 없는 사람을 만든다.
//   · **깨진 값은 빈 배열이다** — 일정을 못 읽는다고 보통 계약까지 막으면 안 된다.
import {
  parseRoomSchedule, hasRoomSchedule, validateRoomSchedule,
  scheduledSegmentOn, nextRoomMove, scheduleOpenFrom, roomScheduleText,
} from '../lib/roomSchedule'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}

const R402 = 'room-402', R409 = 'room-409', R404 = 'room-404'
// 박정후 님 건 — 8/31 하루 402호, 9/1부터 404호.
const ONE_HOP = [
  { roomId: R402, from: '2026-08-31', to: '2026-09-01' },
  { roomId: R404, from: '2026-09-01', to: null },
]
// 여러 번 옮기기 — 하루 402호, 이틀 409호, 그 뒤 404호.
const TWO_HOP = [
  { roomId: R402, from: '2026-08-31', to: '2026-09-01' },
  { roomId: R409, from: '2026-09-01', to: '2026-09-03' },
  { roomId: R404, from: '2026-09-03', to: null },
]

// ── 읽기 ────────────────────────────────────────────────────────────
eq('일정 없음은 빈 배열', parseRoomSchedule(null), [])
eq('배열이 아니면 빈 배열', parseRoomSchedule({ roomId: R402 }), [])
eq('정상 일정은 그대로', parseRoomSchedule(ONE_HOP), ONE_HOP)
// 한 줄이라도 깨지면 통째로 버린다 — 반쪽 일정으로 사람을 어느 방에 두는 것이 더 나쁘다.
eq('날짜 형식이 깨지면 통째로 버린다',
  parseRoomSchedule([{ roomId: R402, from: '2026-8-31', to: null }]), [])
eq('방이 없으면 통째로 버린다',
  parseRoomSchedule([{ from: '2026-08-31', to: null }]), [])
eq('한 줄짜리는 일정이 아니다', hasRoomSchedule([{ roomId: R404, from: '2026-09-01', to: null }]), false)
eq('두 줄부터 일정이다', hasRoomSchedule(ONE_HOP), true)

// ── 성립 판정 ───────────────────────────────────────────────────────
const ctx = { moveInYmd: '2026-08-31', mainRoomId: R404 }
eq('하루 일정은 성립한다', validateRoomSchedule(ONE_HOP, ctx), null)
eq('두 번 옮겨도 성립한다', validateRoomSchedule(TWO_HOP, ctx), null)
eq('일정 없음은 성립한다(보통 계약)', validateRoomSchedule([], ctx), null)
eq('입주일과 시작이 다르면 거부',
  validateRoomSchedule([{ ...ONE_HOP[0], from: '2026-08-30' }, ONE_HOP[1]], ctx),
  '일정은 입주일부터 시작해야 합니다.')
// 빈틈 — 9/1 하루 동안 이 사람이 어디 있는지 앱이 모른다.
eq('빈틈이 있으면 거부',
  validateRoomSchedule([ONE_HOP[0], { roomId: R404, from: '2026-09-02', to: null }], ctx),
  '방과 방 사이에 빈 날이 없어야 합니다.')
// 겹침 — 8/31 하루 동안 두 방에 있게 된다.
eq('겹치면 거부',
  validateRoomSchedule([{ roomId: R402, from: '2026-08-31', to: '2026-09-02' }, ONE_HOP[1]], ctx),
  '방과 방 사이에 빈 날이 없어야 합니다.')
eq('마지막이 계약 호실이 아니면 거부',
  validateRoomSchedule([ONE_HOP[0], { roomId: R409, from: '2026-09-01', to: null }], ctx),
  '마지막 방은 계약 호실이어야 합니다.')
eq('마지막에 기한이 있으면 거부',
  validateRoomSchedule([ONE_HOP[0], { roomId: R404, from: '2026-09-01', to: '2026-09-05' }], ctx),
  '마지막 방은 기한 없이 머뭅니다.')
eq('중간에 기한이 없으면 거부',
  validateRoomSchedule([{ roomId: R402, from: '2026-08-31', to: null }, ONE_HOP[1]], ctx),
  '중간 방에는 비우는 날이 있어야 합니다.')
eq('드는 날과 비우는 날이 같으면 거부',
  validateRoomSchedule([{ roomId: R402, from: '2026-08-31', to: '2026-08-31' }, { roomId: R404, from: '2026-08-31', to: null }], ctx),
  '비우는 날이 드는 날보다 뒤여야 합니다.')
eq('같은 방이 이어지면 거부',
  validateRoomSchedule([{ roomId: R404, from: '2026-08-31', to: '2026-09-01' }, ONE_HOP[1]], ctx),
  '같은 방이 이어서 오면 나눌 이유가 없습니다.')

// ── 그날의 방 ───────────────────────────────────────────────────────
eq('입주일에는 임시 방', scheduledSegmentOn(ONE_HOP, '2026-08-31')?.roomId, R402)
// 반개구간 — 비우는 날 당일에는 이미 다음 방이다.
eq('옮기는 날에는 본 방', scheduledSegmentOn(ONE_HOP, '2026-09-01')?.roomId, R404)
eq('한참 뒤에도 본 방', scheduledSegmentOn(ONE_HOP, '2027-03-05')?.roomId, R404)
eq('입주 전이면 일정 밖', scheduledSegmentOn(ONE_HOP, '2026-08-30'), null)
eq('일정이 없으면 null', scheduledSegmentOn([], '2026-08-31'), null)
eq('두 번 옮기기 · 첫날', scheduledSegmentOn(TWO_HOP, '2026-08-31')?.roomId, R402)
eq('두 번 옮기기 · 둘째 방 첫날', scheduledSegmentOn(TWO_HOP, '2026-09-01')?.roomId, R409)
eq('두 번 옮기기 · 둘째 방 마지막날', scheduledSegmentOn(TWO_HOP, '2026-09-02')?.roomId, R409)
eq('두 번 옮기기 · 본 방', scheduledSegmentOn(TWO_HOP, '2026-09-03')?.roomId, R404)
// 이동일은 그 구간의 시작일이다 — 자가 치유가 '오늘'이 아니라 이 날짜로 구간을 나눈다.
eq('구간 시작일이 곧 이동일', scheduledSegmentOn(ONE_HOP, '2026-09-05')?.from, '2026-09-01')

// ── 다음 이동 ───────────────────────────────────────────────────────
eq('입주일에 보면 다음은 9/1 본 방', nextRoomMove(ONE_HOP, '2026-08-31'), { at: '2026-09-01', roomId: R404 })
eq('옮긴 뒤에는 다음이 없다', nextRoomMove(ONE_HOP, '2026-09-01'), null)
eq('두 번 옮기기 · 첫날에 보면 9/1', nextRoomMove(TWO_HOP, '2026-08-31'), { at: '2026-09-01', roomId: R409 })
eq('두 번 옮기기 · 9/1에 보면 9/3', nextRoomMove(TWO_HOP, '2026-09-01'), { at: '2026-09-03', roomId: R404 })

// ── 아직 안 채운 자리 ───────────────────────────────────────────────
eq('다 채웠으면 null', scheduleOpenFrom(ONE_HOP), null)
eq('임시 방만 정했으면 그 다음날부터', scheduleOpenFrom([ONE_HOP[0]]), '2026-09-01')
eq('빈 일정은 null', scheduleOpenFrom([]), null)

// ── 계약서 문구 ─────────────────────────────────────────────────────
const noOf = (id: string) => ({ [R402]: '402', [R409]: '409', [R404]: '404' }[id] ?? null)
eq('하루 일정 문구', roomScheduleText(ONE_HOP, noOf),
  '2026.08.31 ~ 2026.08.31 402호 · 2026.09.01부터 404호')
eq('두 번 옮기기 문구', roomScheduleText(TWO_HOP, noOf),
  '2026.08.31 ~ 2026.08.31 402호 · 2026.09.01 ~ 2026.09.02 409호 · 2026.09.03부터 404호')
eq('일정이 없으면 문구도 없다', roomScheduleText([], noOf), null)

console.log(`\n호실 일정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
