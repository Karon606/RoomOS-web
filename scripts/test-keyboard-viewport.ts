// 키보드 판정·기하 회귀 — 실행: npx tsx scripts/test-keyboard-viewport.ts
//
// 8월의 키보드 회귀들을 헤드리스로 가둔다(키보드 패널 2026-09-02). 아이폰 16 Pro 실측 좌표계
// (402x874, 키보드 열림 띠 538)와 iPad 줌·외장 바 시나리오를 스냅샷으로 고정한다.
import {
  keyboardOpen, overlapInset, shouldRestore, revealDelta, zoomNeutral,
  KBD_OPEN_PX, KBD_MAX_RATIO, TARGET_RATIO, REVEAL_GAP,
} from '../lib/keyboardViewport'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const H = 874
const snap = (vvHeight: number, offsetTop = 0, scale = 1) => ({ innerHeight: H, vvHeight, offsetTop, scale })

// ── 열림 판정 — 문턱 경계와 팬 불변 ─────────────────────────────
eq('문턱 미만(55 가림)은 닫힘 — 외장 키보드 단축바', keyboardOpen(snap(H - 55)), false)
eq('문턱 초과(61 가림)는 열림', keyboardOpen(snap(H - 61)), true)
eq('키보드 열림(띠 538)', keyboardOpen(snap(538)), true)
eq('판정은 팬 불변 — 336 팬해도 열림', keyboardOpen(snap(538, 336)), true)

// ── 줌 게이트 — 핀치 줌을 키보드로 오판하지 않는다 ───────────────
eq('1.075배 줌이면 띠가 줄어도 닫힘', keyboardOpen(snap(813, 0, 1.075)), false)
eq('줌 중립 판정', zoomNeutral(snap(813, 0, 1.075)), true)
eq('배율 1 은 중립 아님', zoomNeutral(snap(538)), false)

// ── 겹침 인셋 — 팬 차감·상한 클램프 ─────────────────────────────
eq('팬 0 이면 겹침 전체', overlapInset(snap(538)), H - 538)
eq('팬한 만큼 덜 가린다', overlapInset(snap(538, 150)), H - 538 - 150)
eq('음수는 0', overlapInset(snap(H, 100)), 0)
// 상한은 기각이 아니라 클램프 — 가로·소형 창의 정당한 큰 겹침도 상한만큼은 받는다(패널 안 2).
eq('상한 클램프(70%)', overlapInset(snap(100)), Math.round(H * KBD_MAX_RATIO))

// ── 복원 발동 — 진짜 닫힘(엡실론)일 때만 ────────────────────────
eq('완전 닫힘 + 흔적 있음이면 복원', shouldRestore(snap(H), true), true)
eq('흔적 없으면 무동작', shouldRestore(snap(H), false), false)
eq('외장 바(55 가림)면 복원 금지 — OS 팬 존중', shouldRestore(snap(H - 55), true), false)
eq('줌 중이면 복원 금지 — 줌 팬을 되감으면 이동 불능', shouldRestore(snap(813, 40, 1.075), true), false)

// ── 재노출 기하 — 35% 목표선·여백·상단 보호·음수 래치 ────────────
// 띠: 위 0, 아래 538 (키보드 열림, 팬 0). 목표선 = 538 * 0.35 = 188.3.
const band = { bandTop: 0, bandBottom: 538 }
eq('아래쪽 칸은 목표선까지 올린다',
  Math.round(revealDelta({ ...band, fieldTop: 500, fieldBottom: 540, aligned: false })),
  Math.round(500 - 538 * TARGET_RATIO))
// 키 큰 칸(textarea)은 아래 여백 확보가 이긴다? — 아니, 올림은 두 요구의 **큰 쪽**이되
// 상단 보호(fieldTop 이 띠 위 REVEAL_GAP 아래로 내려가지 않게)가 상한이다.
eq('상단 보호 클램프 — 목표선을 좇다 라벨을 날리지 않는다',
  revealDelta({ ...band, fieldTop: 40, fieldBottom: 700, aligned: false }),
  40 - REVEAL_GAP)
// 목표선(188.3) 아래면 이미 보여도 목표선까지 올린다 — 그것이 c12af2ba 정책이다(고정 목표선).
eq('목표선 바로 아래 칸도 목표선까지 올린다',
  Math.round(revealDelta({ ...band, fieldTop: 200, fieldBottom: 240, aligned: false }) * 10) / 10,
  Math.round((200 - 538 * TARGET_RATIO) * 10) / 10)
eq('목표선 위에 있는 칸은 무동작 — 공짜 모션 없음',
  revealDelta({ ...band, fieldTop: 100, fieldBottom: 140, aligned: false }), 0)
// 띠 위로 잘린 칸 — 음수 정렬은 포커스당 1회만.
eq('위로 잘린 칸은 한 번 내린다', revealDelta({ ...band, fieldTop: -30, fieldBottom: 10, aligned: false }), -30 - REVEAL_GAP)
eq('래치 후에는 안 내린다', revealDelta({ ...band, fieldTop: -30, fieldBottom: 10, aligned: true }), 0)

// 상수 자체도 고정 — 수치 합의(35%·60px)가 말없이 바뀌면 잡는다(운영자 승인 2026-09-02).
eq('문턱 60px', KBD_OPEN_PX, 60)
eq('목표선 35%', TARGET_RATIO, 0.35)

console.log(`\n키보드 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
