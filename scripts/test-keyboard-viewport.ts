// 키보드 판정·기하 회귀 — 실행: npx tsx scripts/test-keyboard-viewport.ts
//
// 8월의 키보드 회귀들을 헤드리스로 가둔다(키보드 패널 2026-09-02). 아이폰 16 Pro 실측 좌표계
// (402x874, 키보드 열림 띠 538)와 iPad 줌·외장 바 시나리오를 스냅샷으로 고정한다.
import {
  keyboardOpen, overlapInset, shouldRestore, revealDelta, zoomNeutral, visibleBand,
  KBD_OPEN_PX, KBD_MAX_RATIO, TARGET_RATIO, REVEAL_GAP, ZOOM_NEUTRAL_SCALE, RESTORE_EPS,
  type KbdSnapshot,
} from '../lib/keyboardViewport'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

const H = 874
const snap = (vvHeight: number, offsetTop = 0, scale = 1) => ({ frameH: H, frameTop: 0, vvHeight, offsetTop, scale })

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

// ── 기준틀 교체(2026-10-20, 신고 be5316e8) · iPhone 실기 세 상태 ──────────
// 키보드가 선 iOS Safari 에서 vv.height 는 늘 416 인데 innerHeight 가 세 상태를 오간다(신고 22건 계측).
// 화면 고정 상자는 높이 812 를 지키고, (b) 에서는 위 끝이 client −offsetTop 에 선다. inner 는 종전 식에
// 넣던 값이고 새 식은 안 쓴다(종전 식이 어디서 틀렸는지 함께 고정한다).
type State = { name: string; inner: number; s: KbdSnapshot }
const IPH = 812, KB_VV = 416
const STATES: State[] = [
  { name: '(a) inner 812 · top 0', inner: 812, s: { frameH: IPH, frameTop: 0, vvHeight: KB_VV, offsetTop: 0, scale: 1 } },
  { name: '(b) inner 622 · top 189.66', inner: 622, s: { frameH: IPH, frameTop: -189.66, vvHeight: KB_VV, offsetTop: 189.66, scale: 1 } },
  { name: '(c) inner = vv 416 · top 0', inner: 416, s: { frameH: IPH, frameTop: 0, vvHeight: KB_VV, offsetTop: 0, scale: 1 } },
]
// 종전 식 사본(2026-10-19 판 그대로). innerHeight 를 고정 상자 높이로, 띠 위 끝을 offsetTop 으로 봤다.
const old = {
  open: (inner: number, vvh: number, scale: number) => scale > ZOOM_NEUTRAL_SCALE ? false : inner - vvh > KBD_OPEN_PX,
  inset: (inner: number, vvh: number, top: number) =>
    Math.min(Math.max(0, Math.round(inner - (vvh + top))), Math.round(inner * KBD_MAX_RATIO)),
  restore: (inner: number, vvh: number, scale: number, scrolled: boolean) =>
    scale > ZOOM_NEUTRAL_SCALE ? false : inner - vvh > RESTORE_EPS ? false : scrolled,
  band: (vvh: number, top: number) => ({ top, bottom: top + vvh }),
}
const KBD_TRUE_INSET = [396, 206, 396]   // 실제 키보드 겹침(H − offsetTop − vv.h)
STATES.forEach(({ name, inner, s }, i) => {
  eq(`${name} · 열림 판정`, keyboardOpen(s), true)
  eq(`${name} · 셸 겹침 인셋 = 실제 겹침`, overlapInset(s), KBD_TRUE_INSET[i])
  eq(`${name} · 복원(되감기) 금지`, shouldRestore(s, true), false)
  const b = visibleBand(s)
  eq(`${name} · 띠는 client 0 ~ 416`, [Math.round(b.top), Math.round(b.bottom)], [0, KB_VV])
  // 재노출. 키보드 선 근처·아래 칸을 띠 안으로 데려온다(위 여백 16, 아래 끝은 띠 안).
  for (const [ft, fb] of [[380, 420], [500, 540], [330, 394]]) {
    const d = revealDelta({ bandTop: b.top, bandBottom: b.bottom, fieldTop: ft, fieldBottom: fb, aligned: false })
    eq(`${name} · 칸 ${ft}~${fb} 은 재노출 뒤 띠 안`, ft - d >= b.top + REVEAL_GAP - 0.01 && fb - d <= b.bottom, true)
  }
  void inner
})
// 종전 식이 틀린 자리. 이 셋이 신고의 지문이다.
eq('종전 (b) · 셸 겹침이 16 으로 모자랐다(실제 206)', old.inset(622, KB_VV, 189.66), 16)
eq('종전 (c) · 키보드가 선 채 닫힘으로 오판했다', old.open(416, KB_VV, 1), false)
eq('종전 (c) · 그 오판이 팬을 되감았다(scrollTo 0,0)', old.restore(416, KB_VV, 1, true), true)
eq('종전 (b) · 띠를 offsetTop 만큼 아래로 봤다(키보드 밑 190 까지 띠로 셈)', Math.round(old.band(KB_VV, 189.66).bottom), 606)
// 중간 팬도 같은 모형. inner = 812 − top 이면 겹침은 812 − top − 416, 띠는 늘 client 0 부터.
for (const top of [17, 60, 120, 250, 336, 396]) {
  const s: KbdSnapshot = { frameH: IPH, frameTop: -top, vvHeight: KB_VV, offsetTop: top, scale: 1 }
  eq(`(b) 팬 ${top} · 열림`, keyboardOpen(s), true)
  eq(`(b) 팬 ${top} · 겹침 = 812 − top − 416`, overlapInset(s), Math.max(0, IPH - top - KB_VV))
  eq(`(b) 팬 ${top} · 띠 위 끝 client 0`, Math.round(visibleBand(s).top), 0)
}
// 키보드가 내려가면 기준틀로도 닫힘이고, 복원은 진짜 닫힘에서만 돈다.
eq('닫힘 · H = vv', keyboardOpen({ frameH: IPH, frameTop: 0, vvHeight: IPH, offsetTop: 0, scale: 1 }), false)
eq('닫힘 · 흔적 있으면 복원', shouldRestore({ frameH: IPH, frameTop: 0, vvHeight: IPH, offsetTop: 0, scale: 1 }, true), true)

// ── 동치 전수 · H = innerHeight, T0 = 0 이면 종전 값과 같다(안드로이드·데스크톱·구형 iOS) ──
{
  const inners = [416, 622, 667, 740, 812, 874, 1024]
  const vvhs = [100, 119, 300, 416, 466, 538, 600, 752, 811, 812, 813, 874]
  const tops = [-50, 0, 0.5, 150, 189.66, 336, 500]
  const scales = [1, 1.02, 1.021, 1.5]
  let n = 0
  const diffs: string[] = []
  for (const inner of inners) for (const vvh of vvhs) for (const top of tops) for (const sc of scales) {
    n++
    const s: KbdSnapshot = { frameH: inner, frameTop: 0, vvHeight: vvh, offsetTop: top, scale: sc }
    const b = visibleBand(s), ob = old.band(vvh, top)
    const same = keyboardOpen(s) === old.open(inner, vvh, sc)
      && overlapInset(s) === old.inset(inner, vvh, top)
      && shouldRestore(s, true) === old.restore(inner, vvh, sc, true)
      && shouldRestore(s, false) === old.restore(inner, vvh, sc, false)
      && b.top === ob.top && b.bottom === ob.bottom
    if (!same) diffs.push(`[inner ${inner} vvh ${vvh} top ${top} scale ${sc}]`)
  }
  eq(`동치 전수 ${n} 조합 · 판정·겹침·복원·띠가 종전과 전부 같다`, diffs.slice(0, 3), [])
  console.log(`  동치 전수: ${n} 조합 · 다른 조합 ${diffs.length}`)
}

// 상수 자체도 고정 — 수치 합의(35%·60px)가 말없이 바뀌면 잡는다(운영자 승인 2026-09-02).
eq('문턱 60px', KBD_OPEN_PX, 60)
eq('목표선 35%', TARGET_RATIO, 0.35)

console.log(`\n키보드 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
