// 키보드 판정·기하 회귀 — 실행: npx tsx scripts/test-keyboard-viewport.ts
//
// 8월의 키보드 회귀들을 헤드리스로 가둔다(키보드 패널 2026-09-02). 아이폰 16 Pro 실측 좌표계
// (402x874, 키보드 열림 띠 538)와 iPad 줌·외장 바 시나리오를 스냅샷으로 고정한다.
import {
  keyboardOpen, overlapInset, shouldRestore, revealDelta, zoomNeutral, visibleBand, windowResizeIsPan, resyncAfterPan,
  KBD_OPEN_PX, KBD_MAX_RATIO, TARGET_RATIO, REVEAL_GAP, ZOOM_NEUTRAL_SCALE, RESTORE_EPS,
  type KbdSnapshot,
} from '../lib/keyboardViewport'
import { readKbdSnapshot, frameBoxRect } from '../lib/viewportFrame'

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

// ── 키보드가 선 동안의 window resize 는 팬(2026-10-20, 신고 be5316e8 '화면이 톡톡튀고') ─────
// iOS 는 팬할 때마다 innerHeight 를 고쳐 보고하며 window resize 를 낸다. 참이면 받는 쪽은 판정만
// 갱신하고 인셋 재기록·재노출·복원을 안 한다. 키보드가 내려가는 resize 는 거짓이라 종전 재동기로 간다.
{
  const open = (top: number): KbdSnapshot => ({ frameH: IPH, frameTop: -top, vvHeight: KB_VV, offsetTop: top, scale: 1 })
  const shut: KbdSnapshot = { frameH: IPH, frameTop: 0, vvHeight: IPH, offsetTop: 0, scale: 1 }
  const zoom: KbdSnapshot = { frameH: IPH, frameTop: 0, vvHeight: 700, offsetTop: 40, scale: 1.3 }
  const rows: [string, boolean, boolean, KbdSnapshot, boolean][] = [
    ['표식·포커스·열림 · 팬 0', true, true, open(0), true],
    ['표식·포커스·열림 · 팬 190((b) 상태)', true, true, open(189.66), true],
    ['표식·포커스·열림 · (c) 상태', true, true, STATES[2].s, true],
    ['키보드가 내려감(열림 거짓)이면 재동기', true, true, shut, false],
    ['표식 없음(키보드가 선 적 없음)이면 재동기', false, true, open(0), false],
    ['포커스 없음(칸을 떠남)이면 재동기', true, false, open(0), false],
    ['핀치 줌이면 재동기(줌 게이트)', true, true, zoom, false],
  ]
  for (const [name, stamped, editing, s, want] of rows) eq(`window resize · ${name}`, windowResizeIsPan(stamped, editing, s), want)
  // 늦은 재확인(검수 2026-10-20). 두 프레임 뒤 스냅샷이 닫힘일 때만 재동기한다.
  eq('늦은 재확인 · 여전히 열림((b) 팬 190)이면 아무것도 안 한다', resyncAfterPan(open(189.66)), false)
  eq('늦은 재확인 · (c) 상태도 열림이라 아무것도 안 한다', resyncAfterPan(STATES[2].s), false)
  eq('늦은 재확인 · 키보드가 내려갔으면(옛 vv 로 팬 판정된 뒤) 재동기', resyncAfterPan(shut), true)
  eq('늦은 재확인 · 외장 단축바만 남았으면(55 가림) 닫힘이라 재동기', resyncAfterPan({ frameH: IPH, frameTop: 0, vvHeight: IPH - 55, offsetTop: 0, scale: 1 }), true)
  eq('늦은 재확인 · 핀치 줌이면 열림 판정이 거짓이라 재동기(종전 경로)', resyncAfterPan(zoom), true)
  // 종전 틀(innerHeight 를 상자 높이로)이었다면 (c) 에서 열림이 거짓이라 팬이 재동기로 새어 되감겼다.
  eq('종전 틀이면 (c) 의 window resize 가 재동기로 샜다', old.open(416, KB_VV, 1), false)
}

// ── 정본 readKbdSnapshot 을 가짜 DOM 으로 직접 부른다(검수 2026-10-20) ─────────────
// 순수 함수 진리표만으로는 '잰 상자를 기준틀로 넘기는가'가 안 잡힌다(frameTop = r.top * 0 이 초록이었다).
// 상자 자리는 getBoundingClientRect 가짜로 정하고, vv·innerHeight 도 가짜다.
{
  const g = globalThis as unknown as Record<string, unknown>
  let rect = { top: -190, height: 812, width: 402 }
  let rectReads = 0
  let created = 0
  let docW = 402
  const box = {
    isConnected: true,
    style: { cssText: '' },
    setAttribute: () => {},
    getBoundingClientRect: () => { rectReads++; return { ...rect, bottom: rect.top + rect.height } },
  }
  const rafs: (() => void)[] = []
  const flush = () => { const q = rafs.splice(0); for (const f of q) f() }
  g.window = { innerHeight: 622 }
  g.document = {
    body: { appendChild: () => {} },
    createElement: () => { created++; return box },
    documentElement: { get clientWidth() { return docW } },
  }
  g.requestAnimationFrame = (f: () => void) => { rafs.push(f); return rafs.length }
  const vv = { height: 416, offsetTop: 190, scale: 1, width: 402 } as unknown as VisualViewport
  const s1 = readKbdSnapshot(vv)
  eq('정본 · (b) 상자 위 끝 T0 = −190 을 기준틀로 넘긴다', s1.frameTop, -190)
  eq('정본 · (b) 상자 높이 H = 812 (innerHeight 622 가 아니다)', s1.frameH, 812)
  eq('정본 · vv 세 값은 그대로', [s1.vvHeight, s1.offsetTop, s1.scale], [416, 190, 1])
  eq('정본 · 잰 값으로 띠가 client 0 ~ 416', [visibleBand(s1).top, visibleBand(s1).bottom], [0, 416])
  eq('정본 · 잰 값으로 셸 겹침 206', overlapInset(s1), 206)
  // 같은 프레임·같은 vv 면 다시 안 잰다(강제 레이아웃 한 번).
  const reads = rectReads
  readKbdSnapshot(vv)
  eq('정본 · 같은 프레임 같은 vv 면 다시 안 잰다', rectReads, reads)
  eq('정본 · 상자는 한 번만 만든다', created, 1)
  // 다음 프레임에는 기억을 지우고 다시 잰다.
  flush()
  rect = { top: 0, height: 622, width: 402 }
  const s2 = readKbdSnapshot(vv)
  eq('정본 · 다음 프레임엔 다시 잰다', rectReads, reads + 1)
  eq('정본 · H = inner, T0 = 0 이면 종전 틀과 같다', [s2.frameH, s2.frameTop], [622, 0])
  eq('정본 · 그때 겹침은 종전 식 그대로', overlapInset(s2), old.inset(622, 416, 190))
  // vv 값이 바뀌면 같은 프레임이라도 다시 잰다.
  rect = { top: -100, height: 812, width: 402 }
  const s3 = readKbdSnapshot({ height: 416, offsetTop: 100, scale: 1, width: 402 } as unknown as VisualViewport)
  eq('정본 · vv 가 바뀌면 같은 프레임에도 다시 잰다', [s3.frameH, s3.frameTop], [812, -100])
  // 상자가 이상하면(폭이 문서 폭과 다름 = transform 조상) 종전 틀로 답한다.
  flush()
  docW = 360
  const s4 = readKbdSnapshot(vv)
  eq('정본 · 폭이 어긋난 상자는 버리고 종전 틀(H = innerHeight, T0 = 0)', [s4.frameH, s4.frameTop], [622, 0])
  docW = 402
  flush()
  rect = { top: -190, height: 0, width: 402 }
  eq('정본 · 높이 0 인 상자도 종전 틀', readKbdSnapshot(vv).frameH, 622)
  flush()
  rect = { top: -190, height: 812, width: 402 }
  eq('계측 · frameBoxRect 는 같은 상자를 잰다', frameBoxRect()?.top, -190)
  box.getBoundingClientRect = () => { throw new Error('boom') }
  eq('계측 · 재다 터지면 null(신고창이 열려야 한다)', frameBoxRect(), null)
  flush()
  eq('정본 · 재다 터지면 종전 틀', readKbdSnapshot(vv).frameH, 622)
  delete g.window
  delete g.document
  delete g.requestAnimationFrame
}

// 상수 자체도 고정 — 수치 합의(35%·60px)가 말없이 바뀌면 잡는다(운영자 승인 2026-09-02).
eq('문턱 60px', KBD_OPEN_PX, 60)
eq('목표선 35%', TARGET_RATIO, 0.35)

console.log(`\n키보드 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
