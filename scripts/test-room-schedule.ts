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
  scheduledSegmentOn, nextRoomMove, scheduleOpenFrom, roomScheduleText, freeFromAfter,
  effectiveMoveDate, scheduleMode, planUndoDenial,
} from '../lib/roomSchedule'
import { moveInSubText } from '../lib/leaseStatus'
import { readFileSync } from 'node:fs'

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
// 끝날은 이사하는 그날을 그대로 적는다(2026-08-31 운영자 요구). 종전에는 하루를 빼서
// '마지막으로 잔 날'을 보였는데, 오전까지 있다가 오후에 옮기는 실무에서 그날이 통째로 사라졌다.
// 두 줄에 같은 날이 나오는 것은 겹침이 아니라 그날 옮긴다는 뜻이다.
eq('하루 일정 문구', roomScheduleText(ONE_HOP, noOf),
  '2026.08.31 ~ 2026.09.01 402호 · 2026.09.01부터 404호')
eq('두 번 옮기기 문구', roomScheduleText(TWO_HOP, noOf),
  '2026.08.31 ~ 2026.09.01 402호 · 2026.09.01 ~ 2026.09.03 409호 · 2026.09.03부터 404호')
eq('일정이 없으면 문구도 없다', roomScheduleText([], noOf), null)

// ── 언제부터 비나 ──────────────────────────────────────────────────
// 이 판정만 당일 회전을 안 쓴다 — 묻는 것이 "배정할 수 있나"가 아니라 "그날 밤 잘 곳이 있나"다.
eq('퇴실 다음 날부터 빈다', freeFromAfter('2026-08-31'), '2026-09-01')
eq('월 경계를 넘어도 하루', freeFromAfter('2026-08-29'), '2026-08-30')
eq('연 경계를 넘어도 하루', freeFromAfter('2026-12-31'), '2027-01-01')

// ── 이사일을 뒤로 미룬 일정 (2026-08-31 운영자 요구) ──────────────────
//
// 종전에는 계약 호실이 비는 날이 곧 이사일이라 사람이 못 고쳤다. 404호처럼 앞사람이 8/31 퇴실이라
// 9/1부터 비지만 청소가 9/2로 잡힌 방을 표현할 길이 없었다. 모델은 처음부터 담을 수 있었고
// 없던 것은 입력 칸이었다 — 그 사실을 여기서 못박는다. (성립하면 null, 아니면 사유 문자열)
{
  const c = { moveInYmd: '2026-08-31', mainRoomId: 'r404' }

  // 8/31 입주, 402호에 이틀 머물고 9/2에 404호로.
  eq('이사일 미룸: 가능일보다 뒤여도 성립', validateRoomSchedule(
    [{ roomId: 'r402', from: '2026-08-31', to: '2026-09-02' },
     { roomId: 'r404', from: '2026-09-02', to: null }], c), null)

  // 하루만 머무는 종전 형태도 그대로 선다.
  eq('이사일 미룸: 종전 형태도 성립', validateRoomSchedule(
    [{ roomId: 'r402', from: '2026-08-31', to: '2026-09-01' },
     { roomId: 'r404', from: '2026-09-01', to: null }], c), null)

  // 빈틈이 생기면 거절 — 9/1 하루를 아무도 안 맡는다.
  const gap = validateRoomSchedule(
    [{ roomId: 'r402', from: '2026-08-31', to: '2026-09-01' },
     { roomId: 'r404', from: '2026-09-02', to: null }], c)
  eq('이사일 미룸: 빈틈이 있으면 거절', gap !== null, true)
}


// ── 바로 입주 (2026-10-02 운영자 신고, 513호) ───────────────────────
//
// 513호는 앞사람이 9/30에 나가 10/1부터 비고(10/2 청소), 입주는 10/6이다. 서버 제안(10/2)이
// 입주일보다 앞서는데 시트가 그 값을 이사일로 써서 없는 기간의 임시 호실을 찾았고, 후보가 없으면
// '그날 지낼 수 있는 호실이 없습니다', 저장은 방을 하나 이상 골라야만 됐다.
{
  eq('이사일이 입주일보다 앞서면 입주일로 올린다', effectiveMoveDate('2026-10-02', '2026-10-06'), '2026-10-06')
  eq('이사일이 입주일보다 뒤면 그대로', effectiveMoveDate('2026-10-08', '2026-10-06'), '2026-10-08')
  eq('이사일을 모르면 null', effectiveMoveDate(null, '2026-10-06'), null)

  eq('513 · 10/6 입주(제안 10/2)는 바로 입주', scheduleMode('2026-10-02', '2026-10-06'), 'direct')
  eq('513 · 10/5 입주(제안 10/2)는 바로 입주', scheduleMode('2026-10-02', '2026-10-05'), 'direct')
  eq('같은 날이면 바로 입주', scheduleMode('2026-10-06', '2026-10-06'), 'direct')
  eq('513 · 이사일을 10/8로 미루면 임시 호실', scheduleMode('2026-10-08', '2026-10-06'), 'temp')
  eq('박정후 건(9/1 빔, 8/31 입주)은 임시 호실', scheduleMode('2026-09-01', '2026-08-31'), 'temp')
  eq('비는 날을 모르면 모른다', scheduleMode(null, '2026-10-06'), 'unknown')
  // 서버 하한(moveEarliest = 앞사람이 나가는 날)도 같은 함수로 가른다 — 9/30 퇴실이면 10/1 입주부터 바로.
  eq('서버 하한 · 9/30 퇴실 · 10/1 입주는 바로', scheduleMode('2026-09-30', '2026-10-01'), 'direct')
  eq('서버 하한 · 10/7 퇴실 · 10/6 입주는 거절 갈래', scheduleMode('2026-10-07', '2026-10-06'), 'temp')
}

// ── 서버 빈 일정 저장 가드 (소스 그물) ────────────────────────────────
//
// DB 없이 돌리므로 소스로 묶는다. 빈 일정(바로 입주)이 hasRoomSchedule 2줄 검사보다 먼저 갈라지고,
// 그 갈래가 화면과 같은 scheduleMode 로 하한을 보고, 두 갈래 모두 딸린 계약 입주일 전파를 탄다.
{
  const src = readFileSync('app/(app)/tenants/actions.ts', 'utf8')
  const start = src.indexOf('export async function saveRoomSchedulePlan(')
  const end = src.indexOf('\nexport async function', start + 10)
  const body = start >= 0 ? src.slice(start, end) : ''
  eq('saveRoomSchedulePlan 이 있다', start >= 0, true)
  const iDirect = body.indexOf('schedule.length === 0')
  const iTwoLines = body.indexOf('hasRoomSchedule(schedule)')
  eq('빈 일정 갈래가 2줄 검사보다 먼저', iDirect >= 0 && iTwoLines > iDirect, true)
  eq('빈 일정 갈래가 scheduleMode 로 하한을 본다', /scheduleMode\(earliest, input\.moveInDate\) !== 'direct'/.test(body), true)
  eq('빈 일정이면 일정을 걷는다', body.includes('const savedSchedule = direct ? null : schedule') && body.includes('savedSchedule === null ? Prisma.DbNull'), true)
  eq('저장이 적용취소 재료를 돌려준다', (body.match(/\bundo,\n/g) ?? []).length, 2)
  eq('딸린 계약 입주일 전파(정본)', body.includes('propagateMoveInDateToSubLeases(tx, lease.id, lease.moveInDate, moveInAt)'), true)
  eq('앞당김은 수정 폼과 같은 계획 구간 가드', body.includes('plannedStayDenial('), true)

  // 시트도 같은 함수로 가르고, 바로 입주면 고를 것 없이 저장할 수 있다.
  const sheet = readFileSync('components/tenant/RoomScheduleSheet.tsx', 'utf8')
  eq('시트가 scheduleMode 로 바로 입주를 가른다', sheet.includes("scheduleMode(rawEnd, moveIn) === 'direct'"), true)
  eq('시트 · 바로 입주면 다 채운 것', /const done = direct \|\|/.test(sheet), true)
  eq('시트 · 이사일 값은 입주일보다 앞서지 않는다', sheet.includes('effectiveMoveDate(rawEnd, moveIn)'), true)
}

// ── 입실 일정 저장 적용취소 (운영자 원칙: 적용하는 모든 기능엔 적용취소) ──
//
// 지금 값이 저장한 값과 같을 때만 되돌린다. 그 사이 다른 저장이 끼었으면 덮지 않는다.
{
  const saved = { moveInYmd: '2026-10-06', schedule: null }
  eq('저장 그대로면 되돌린다', planUndoDenial({ status: 'RESERVED', moveInYmd: '2026-10-06', schedule: null }, saved), null)
  eq('빈 일정과 null 은 같은 것(둘 다 일정 없음)',
    planUndoDenial({ status: 'RESERVED', moveInYmd: '2026-10-06', schedule: [] }, saved), null)
  eq('그 사이 입주일이 바뀌면 거절',
    planUndoDenial({ status: 'RESERVED', moveInYmd: '2026-10-07', schedule: null }, saved),
    '그 사이 입주일이나 거주 호실 일정이 바뀌어 되돌릴 수 없습니다.')
  eq('그 사이 일정이 생기면 거절',
    planUndoDenial({ status: 'RESERVED', moveInYmd: '2026-10-06', schedule: ONE_HOP }, saved) !== null, true)
  eq('그 사이 입실 처리되면 거절',
    planUndoDenial({ status: 'ACTIVE', moveInYmd: '2026-10-06', schedule: null }, saved),
    '그 사이 계약 상태가 바뀌어 되돌릴 수 없습니다.')
  const savedPlan = { moveInYmd: '2026-08-31', schedule: ONE_HOP }
  eq('일정 갈래 · 같은 일정이면 되돌린다',
    planUndoDenial({ status: 'RESERVED', moveInYmd: '2026-08-31', schedule: JSON.parse(JSON.stringify(ONE_HOP)) }, savedPlan), null)
  eq('일정 갈래 · 일정이 바뀌면 거절',
    planUndoDenial({ status: 'RESERVED', moveInYmd: '2026-08-31', schedule: TWO_HOP }, savedPlan) !== null, true)

  const src = readFileSync('app/(app)/tenants/actions.ts', 'utf8')
  const u0 = src.indexOf('export async function undoSaveRoomSchedulePlan(')
  const ubody = u0 >= 0 ? src.slice(u0, src.indexOf('\nexport async function', u0 + 10)) : ''
  eq('되돌림 액션이 있다', u0 >= 0, true)
  eq('되돌림 · 권한·소속', ubody.includes('requireEdit()') && ubody.includes('propertyId }'), true)
  eq('되돌림 · 저장값 일치 판정(정본)', ubody.includes('planUndoDenial('), true)
  eq('되돌림 · 딸린 계약도 되돌린다', ubody.includes('restoreSubLeaseMoveInDates('), true)
  eq('되돌림 · 되살리는 일정 겹침 재검사', ubody.includes('roomScheduleClash('), true)
  const sheet = readFileSync('components/tenant/RoomScheduleSheet.tsx', 'utf8')
  eq('시트 토스트에 적용취소', sheet.includes("label: '적용취소'") && sheet.includes('undoSaveRoomSchedulePlan(r.undo)'), true)
  // 금지 어휘 '잡다' + 사람이 바꿔도 같은 문장이던 청소 경고.
  eq('청소 경고에 금지 어휘 없음', sheet.includes('그날로 잡았습니다'), false)
}

// ── 입주 예정 보조줄 (2026-10-02 운영자 신고 — 확정한 입주일이 눈에 안 띔) ──
//
// checkoutSubText 와 대칭인 D-day 문법. 기본(옵션 없음)은 종전 문장 그대로라 호실 카드·이사 달력 불변.
{
  const today = '2026-10-02'
  eq('기본은 날짜만(종전 문장)', moveInSubText('2026-10-05'), '10/5 입주 예정')
  eq('D-3', moveInSubText('2026-10-05', { dday: true, today }), '10/5 입주 예정 D-3')
  eq('오늘', moveInSubText('2026-10-02', { dday: true, today }), '오늘 입주')
  eq('지남', moveInSubText('2026-09-29', { dday: true, today }), '입주 예정일 3일 경과')
  eq('날짜 없음', moveInSubText(null, { dday: true, today }), null)
  // 예약 확정 전이면 '희망'(계약 정보 라벨 '입주 희망일'과 같은 말).
  eq('미확정 D-3', moveInSubText('2026-10-05', { dday: true, today, wish: true }), '10/5 입주 희망 D-3')
  eq('미확정 지남', moveInSubText('2026-09-29', { dday: true, today, wish: true }), '입주 희망일 3일 경과')
}

console.log(`\n호실 일정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
