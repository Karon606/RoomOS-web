// 지출·작업 연결 판정 회귀 — 실행: npx tsx scripts/test-room-work-match.ts
//
// 실측 413·514호(2026-08-27)를 그대로 고정한다. 07:30 에 지출 화면에서 두 방 시공비를
// 한 번에 넣었는데 작업은 그 사실을 몰라, 완료 처리로 같은 돈이 한 번 더 생겼다.
//
// 여기서 고정하는 것 넷.
//   · **금액을 판정에 안 넣는다** — 넣으면 413호 장판(실제 50,000, 작업 쪽에 140,000으로
//     잘못 적힘)을 놓친다. 금액이 갈린 쪽이 오히려 틀린 값이라 가장 나쁜 경우만 빠진다.
//   · **업체명을 안 넣는다** — 예정 작업에는 아직 없는 칸이다.
//   · **자재는 후보가 아니다** — 자재는 살 때 이미 지출로 잡혔다. 연결 누락이지 중복이 아니다.
//   · **이미 걸린 것은 안 묻는다** — 이어진 것에는 물을 것이 없다.
import { matchesWork } from '../lib/roomWorkMatch'

let pass = 0
const fails: string[] = []
function eq(name: string, got: boolean, want: boolean) {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${want} / 실제 ${got}`)
}

const R413 = 'room-413', R514 = 'room-514'
const DAY = '2026-08-27'
const work = (roomId: string, kind: string, done: string | null = DAY, sched: string | null = null) =>
  ({ roomId, kind, doneDate: done, scheduledDate: sched })
const exp = (o: Partial<{ roomId: string | null; date: string; itemLabel: string | null; detail: string | null; roomWorkId: string | null }> = {}) =>
  ({ roomId: R413, date: DAY, itemLabel: null, detail: null, roomWorkId: null, ...o })

// ── 실측이 걸려야 하는 것 ───────────────────────────────────────────
eq('벽지도배가 도배 작업에 걸린다',
  matchesWork(exp({ itemLabel: '벽지도배', detail: '[벽지도배] x 1회' }), work(R413, '도배')), true)
eq('장판 시공이 장판 작업에 걸린다',
  matchesWork(exp({ itemLabel: '장판 시공', detail: '[장판 시공] x 1회' }), work(R413, '장판')), true)
eq('예정 작업(예정일만 있음)도 걸린다',
  matchesWork(exp({ itemLabel: '벽지도배' }), work(R514, '도배', null, DAY)), false)   // 방이 다르다
eq('514호 예정 작업에 514호 지출이 걸린다',
  matchesWork(exp({ roomId: R514, itemLabel: '벽지도배' }), work(R514, '도배', null, DAY)), true)

// ── 금액은 판정에 없다 ──────────────────────────────────────────────
// 판정 인자에 금액이 아예 없다는 것이 곧 이 축의 고정이다. 금액이 얼마든 결과가 같다.
eq('금액이 달라도 걸린다(50,000 vs 140,000 사건)',
  matchesWork(exp({ itemLabel: '장판 시공' }), work(R413, '장판')), true)

// ── 안 걸려야 하는 것 ───────────────────────────────────────────────
eq('이미 걸린 지출은 후보가 아니다',
  matchesWork(exp({ itemLabel: '벽지도배', roomWorkId: 'w1' }), work(R413, '도배')), false)
eq('방이 없으면 안 걸린다',
  matchesWork(exp({ roomId: null, itemLabel: '벽지도배' }), work(R413, '도배')), false)
eq('다른 방이면 안 걸린다',
  matchesWork(exp({ roomId: R514, itemLabel: '벽지도배' }), work(R413, '도배')), false)
eq('날이 다르면 안 걸린다',
  matchesWork(exp({ itemLabel: '벽지도배', date: '2026-08-26' }), work(R413, '도배')), false)
eq('종류 이름이 없으면 안 걸린다',
  matchesWork(exp({ itemLabel: '에어컨 수리' }), work(R413, '도배')), false)
// 자재는 살 때 이미 지출로 잡혔다 — 여기서 또 세면 안 된다.
eq('자재는 후보가 아니다(원목무늬 장판)',
  matchesWork(exp({ itemLabel: '원목무늬 장판', detail: '[원목무늬 장판] 폭 183cm x 2m' }), work(R413, '장판')), false)
eq('장판몰딩도 자재라 안 걸린다',
  matchesWork(exp({ itemLabel: '장판몰딩 12m x 7.4cm' }), work(R413, '장판')), false)
eq('날짜가 없는 작업은 안 걸린다',
  matchesWork(exp({ itemLabel: '벽지도배' }), work(R413, '도배', null, null)), false)

// ── 자동생성분 ──────────────────────────────────────────────────────
// 작업 완료가 만드는 지출은 품목명을 '도배 시공' 으로 적는다. 종전에는 detail 만 있어
// 공임 판정이 그 줄을 자재로 셌다(그 방 투자금 구성이 틀어진다).
eq('자동생성 시공비는 공임으로 읽힌다',
  matchesWork(exp({ itemLabel: '도배 시공', detail: '413호 도배 · 대방도배사' }), work(R413, '도배')), true)
// 옛 자동생성분(품목명 없음)은 공임으로 안 읽힌다 — 아는 사실을 적어 둔다.
eq('품목명 없는 옛 자동생성분은 안 걸린다',
  matchesWork(exp({ itemLabel: null, detail: '413호 도배 · 대방도배사' }), work(R413, '도배')), false)

console.log(`\n지출·작업 연결 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
