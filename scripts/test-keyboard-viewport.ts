// 키보드 판정·기하 회귀 — 실행: npx tsx scripts/test-keyboard-viewport.ts
//
// 8월의 키보드 회귀들을 헤드리스로 가둔다(키보드 패널 2026-09-02). 아이폰 16 Pro 실측 좌표계
// (402x874, 키보드 열림 띠 538)와 iPad 줌·외장 바 시나리오를 스냅샷으로 고정한다.
import {
  keyboardOpen, overlapInset, shouldRestore, revealDelta, zoomNeutral, visibleBand, windowResizeIsPan, resyncAfterPan,
  KBD_OPEN_PX, KBD_MAX_RATIO, TARGET_RATIO, REVEAL_GAP, ZOOM_NEUTRAL_SCALE, RESTORE_EPS,
  revealGate, restsNearTarget, SETTLE_MIN_MS, SETTLE_MIN_FRAMES, SETTLE_MAX_MS, SETTLE_STILL_FRAMES, SETTLE_EPS,
  type KbdSnapshot, type SettleSample,
} from '../lib/keyboardViewport'
import { readKbdSnapshot, frameBoxRect } from '../lib/viewportFrame'
import { phantomKeyboardGap } from '../lib/modalViewport'

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
  // 문서 scrollTop 이 바뀌면 vv 가 같아도 같은 프레임에 다시 잰다(2026-11-03, 정착 관문이 매 프레임 띠를 잰다).
  {
    const vv3 = { height: 416, offsetTop: 100, scale: 1, width: 402 } as unknown as VisualViewport
    const before = rectReads
    readKbdSnapshot(vv3)
    eq('정본 · 같은 vv·같은 문서 scrollTop 이면 다시 안 잰다', rectReads, before)
    ;(g.document as Record<string, unknown>).scrollingElement = { scrollTop: 50 }
    rect = { top: -150, height: 812, width: 402 }
    eq('정본 · 문서 scrollTop 이 바뀌면 같은 프레임에도 다시 잰다', [readKbdSnapshot(vv3).frameTop, rectReads], [-150, before + 1])
    delete (g.document as Record<string, unknown>).scrollingElement
  }
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

// ── 칸에서 칸으로 옮길 때의 정착 관문(2026-11-03, 키보드 칸 이동 튐 패널 1단계 A안 · 독립 검수 반영) ─────────────
// 가드는 키보드가 선 채 들어온 focusin 에서 매 rAF 표본 하나를 재 revealGate 에 넘기고, 그 답대로만 한다.
// 기다림은 rAF 타임스탬프로 잰다(첫 표본 0ms). 아래 run 은 hz 로 표본 사이 간격을 정한다.
{
  const S = (fieldTop: number, o: Partial<SettleSample> = {}): SettleSample =>
    ({ fieldTop, fieldBottom: fieldTop + 40, bandTop: 0, bandBottom: 416, scrollTop: 120, maxScrollTop: 2000, ...o })
  // 표본 줄을 차례로 넘겨 처음으로 wait 가 아닌 답과 그 표본 번호(1부터)를 돌려준다. 끝까지 wait 면 'wait'.
  const run = (samples: SettleSample[], hz = 60) => {
    let prev: SettleSample | null = null, still = 0, base = NaN
    for (let i = 0; i < samples.length; i++) {
      const g = revealGate({ prev, cur: samples[i], still, elapsedMs: i * 1000 / hz, frame: i + 1, base })
      if (g.verdict !== 'wait') return { verdict: g.verdict, frame: i + 1, at: samples[i] }
      prev = samples[i]; still = g.still; base = g.base
    }
    return { verdict: 'wait' as const, frame: samples.length, at: samples[samples.length - 1] }
  }
  const rep = (f: number, n: number, o: Partial<SettleSample> = {}) => Array.from({ length: n }, () => S(f, o))
  // 최소 대기 130ms 와 8프레임 중 늦은 쪽. 60Hz 에서는 둘 다 아홉째 표본(133.3ms)에서 선다.
  const minSample = (hz: number) => Math.max(Math.ceil(SETTLE_MIN_MS / (1000 / hz)) + 1, SETTLE_MIN_FRAMES + 1)
  const MIN_FRAME_60 = minSample(60)
  eq('관문 · 최소 대기 안에서는 멈춰 있어도 기다린다', run(rep(205, MIN_FRAME_60 - 1)).verdict, 'wait')
  eq('관문 · 멈춘 채 최소 대기가 지나면 진행', [run(rep(205, 12)).verdict, run(rep(205, 12)).frame].join(' '), `go ${MIN_FRAME_60}`)
  eq('관문 · 팬이 진행 중이면 기다린다', run([205, 180, 150, 120].map(f => S(f))).verdict, 'wait')
  eq('관문 · 1px 미만 흔들림은 멈춘 것으로 본다', run(Array.from({ length: 12 }, (_, i) => S(205 + (i % 2) * 0.6))).verdict, 'go')
  eq('관문 · 정확히 1px 씩 움직이면 상한까지 기다린다', run(Array.from({ length: 30 }, (_, i) => S(205 + i))).frame, Math.ceil(SETTLE_MAX_MS / (1000 / 60)) + 1)
  eq('관문 · 키보드 resize 로 띠 아래가 움직이는 중이면 기다린다',
    run([...rep(205, 3), S(205, { bandBottom: 466 }), S(205, { bandBottom: 416 })]).verdict, 'wait')
  eq('관문 · 띠 위가 움직이는 중이면 기다린다', run([...rep(205, 3), S(205, { bandTop: 30 }), S(205, { bandTop: 0 })]).verdict, 'wait')
  eq('관문 · 최소 대기 끝 무렵 resize 로 띠가 움직이면 다시 두 프레임을 기다린다',
    run([...rep(205, 8), S(205, { bandBottom: 466 }), S(205, { bandBottom: 466 }), S(205, { bandBottom: 466 })]).frame, 11)
  const endless = Array.from({ length: 60 }, (_, i) => S(400 - i * 3))
  eq('관문 · 안 멈춰도 60Hz 상한(350ms)에서 진행', [run(endless).verdict, run(endless).frame].join(' '), `go ${Math.ceil(SETTLE_MAX_MS / (1000 / 60)) + 1}`)
  // 저전력 30Hz. 상한이 프레임 수였다면 20프레임 = 0.67초였다. 시간으로 재므로 30Hz 에서도 350ms 안팎이다.
  const r30 = run(endless, 30)
  eq('관문 · 30Hz 에서도 상한은 시간(350ms)이라 0.67초까지 늘지 않는다', [r30.verdict, (r30.frame - 1) * 1000 / 30 < 400], ['go', true])
  eq('관문 · 30Hz 최소 대기는 8프레임 쪽이 늦어 아홉째 표본(약 267ms)', run(rep(205, 12), 30).frame, minSample(30))
  // 손 스크롤. 기준은 첫 표본의 scrollTop 이다.
  eq('관문 · 기다리는 동안 스크롤러가 가드 밖에서 움직이면 취소(손 스크롤)', run([S(205), S(205, { scrollTop: 160 })]).verdict, 'abort')
  eq('관문 · 손으로 위로 올려도 최대값에 안 붙었으면 취소', run([S(205), S(205, { scrollTop: 80 })]).verdict, 'abort')
  eq('관문 · 1px 미만 scrollTop 차는 손 스크롤이 아니다', run([...rep(205, 3), ...rep(205, 9, { scrollTop: 120.4 })]).verdict, 'go')
  // 권고 1-a. focusin 순간 120 이던 scrollTop 을 브라우저가 focus 직후 150 으로 밀었다. 첫 표본(150)이 기준이라 취소가 아니다.
  eq('관문 · focus 직후 브라우저가 민 scrollTop 은 손 스크롤이 아니다(첫 표본이 기준)', run(rep(205, 12, { scrollTop: 150 })).verdict, 'go')
  // 권고 1-b. 관문 도중 vv resize 로 --kbd-inset 이 줄어 최대 scrollTop 이 400 에서 300 으로 내려가 scrollTop 이 그 끝에 잘렸다.
  const clampSeq = [...rep(205, 3, { scrollTop: 400, maxScrollTop: 400 }), ...rep(205, 10, { scrollTop: 300, maxScrollTop: 300 })]
  eq('관문 · 여백이 줄어 최대값에 잘린 scrollTop 은 손 스크롤이 아니다', run(clampSeq).verdict, 'go')
  eq('관문 · 잘린 뒤에는 그 값이 새 기준이라 이어서 손으로 밀면 취소',
    run([...clampSeq.slice(0, 5), S(205, { scrollTop: 340, maxScrollTop: 300 })]).verdict, 'abort')
  eq('관문 · 줄었지만 최대값보다 아래면(손으로 올림) 취소', run([...rep(205, 3, { scrollTop: 400, maxScrollTop: 400 }), S(205, { scrollTop: 250, maxScrollTop: 300 })]).verdict, 'abort')
  // 허용 구간. 띠 0~416 의 목표선은 145.6. 띠 위 여백(16) 아래부터 목표선 +16 까지, 아래 끝은 띠 아래 여백 위.
  eq('관문 · 멈춘 자리가 목표선 근처면 움직이지 않는다(stay)', run(rep(150, 12)).verdict, 'stay')
  eq('관문 · 목표선보다 위(띠 위 여백 아래)도 stay(공짜 모션 없음)', run(rep(60, 12)).verdict, 'stay')
  eq('관문 · 목표선 아래 16 을 넘으면 go', run(rep(170, 12)).verdict, 'go')
  eq('관문 · 띠 위로 잘린 칸은 go(음수 1회는 revealDelta 가 정한다)', run(rep(5, 12)).verdict, 'go')
  eq('관문 · 상한 진행은 허용 구간이어도 go(멈춘 적이 없어 확정하지 않는다)', run(Array.from({ length: 30 }, (_, i) => S(150 + (i % 2) * 3))).verdict, 'go')
  eq('허용 구간 · 아래 여백이 모자라면 아니다', restsNearTarget({ fieldTop: 140, fieldBottom: 405, bandTop: 0, bandBottom: 416 }), false)
  eq('허용 구간 · 위 여백 안쪽이면 아니다', restsNearTarget({ fieldTop: 10, fieldBottom: 50, bandTop: 0, bandBottom: 416 }), false)
  eq('정착 상수 · 1px · 두 프레임 · 최소 130ms·8프레임 · 상한 350ms', [SETTLE_EPS, SETTLE_STILL_FRAMES, SETTLE_MIN_MS, SETTLE_MIN_FRAMES, SETTLE_MAX_MS], [1, 2, 130, 8, 350])

  // 신고 재현표. 띠 0~416, 아래 B 칸 205. B 를 누르면 iOS 자체 팬이 6프레임에 걸쳐 칸을 130 올린다(scrollTop 은 안 건드린다).
  // 종전 가드는 첫 프레임 기하(205)로 59.4 를 올렸고, 팬이 그 위에 130 을 더해 띠 위 +16 에 붙었다.
  const B0 = 205, IOS_PAN = 130
  const target = 0 + TARGET_RATIO * 416
  const oldDelta = revealDelta({ bandTop: 0, bandBottom: 416, fieldTop: B0, fieldBottom: B0 + 40, aligned: false })
  eq('신고 재현 · 종전은 첫 프레임 기하로 목표선까지 올렸다', Math.round(oldDelta * 10) / 10, Math.round((B0 - target) * 10) / 10)
  eq('신고 재현 · 종전 착지 = 띠 위 +16 (이중 이동의 지문)', Math.round(B0 - oldDelta - IOS_PAN), REVEAL_GAP)
  const landing = (seq: SettleSample[], hz = 60) => {
    const g = run(seq, hz)
    const d = g.verdict === 'go' ? revealDelta({ bandTop: 0, bandBottom: 416, fieldTop: g.at.fieldTop, fieldBottom: g.at.fieldBottom, aligned: false }) : 0
    // 관문이 팬 도중(마지막 표본 전)에 답했다면 남은 팬이 그 위에 더해진다.
    const rest = g.at.fieldTop - seq[seq.length - 1].fieldTop
    return { ...g, landed: g.at.fieldTop - d - rest }
  }
  const PAN = [185, 155, 120, 95, 80, 75]
  // 늦게 시작하는 팬(검수 차단 1). 정지 k 프레임 뒤 205 에서 75 로. 뒤에 정지 표본을 넉넉히 붙인다.
  for (const hz of [60, 30]) for (const k of [0, 1, 2, 3, 4]) {
    const seq = [...rep(B0, k + 1), ...PAN.map(f => S(f)), ...rep(75, 20)]
    const L = landing(seq, hz)
    eq(`늦은 팬 ${hz}Hz · 정지 ${k}프레임 뒤 시작 · 팬 도중에 답하지 않는다`, L.at.fieldTop, 75)
    eq(`늦은 팬 ${hz}Hz · 정지 ${k}프레임 뒤 시작 · 띠 위 +16 에 착지하지 않는다`, Math.abs(L.landed - REVEAL_GAP) > 2, true)
    // 30Hz 정지 4프레임이면 팬이 끝나는 순간 상한(350ms)에 닿아 go 가 나지만, 그때 칸(75)은 목표선 위라 델타 0 이다.
    eq(`늦은 팬 ${hz}Hz · 정지 ${k}프레임 뒤 시작 · 가드가 더 밀지 않는다(iOS 팬 한 번만)`, [L.landed, L.verdict === 'stay' || L.verdict === 'go'], [75, true])
  }
  // 최소 대기가 없던 판(두 프레임 정지만 보던 관문)이면 정지 2프레임 뒤 시작하는 팬에서 종전 결함이 그대로였다.
  {
    const seq = [...rep(B0, 3), ...PAN.map(f => S(f))]
    let prev: SettleSample | null = null, still = 0, answeredAt = -1
    for (let i = 0; i < seq.length; i++) {
      const moved = !prev || Math.abs(seq[i].fieldTop - prev.fieldTop) >= SETTLE_EPS
      still = moved ? 0 : still + 1
      if (still >= SETTLE_STILL_FRAMES) { answeredAt = i; break }
      prev = seq[i]
    }
    const d = revealDelta({ bandTop: 0, bandBottom: 416, fieldTop: seq[answeredAt].fieldTop, fieldBottom: seq[answeredAt].fieldBottom, aligned: false })
    eq('늦은 팬 · 최소 대기 없는 관문은 팬 전 기하(205)로 답해 +16 에 붙었다', [seq[answeredAt].fieldTop, Math.round(B0 - d - IOS_PAN)], [205, REVEAL_GAP])
  }
  const g = run([...[0, 20, 50, 85, 110, 125, 130].map(d => S(B0 - d)), ...rep(75, 12)])
  eq('신고 재현 · 바로 시작하는 팬도 멈춘 뒤 한 번(stay at 75)', [g.verdict, g.at.fieldTop], ['stay', 75])
  // iOS 팬이 없으면(B 가 그 자리) 관문은 최소 대기 뒤 한 번, 목표선까지 올린다. 종전과 같은 자리다.
  const still = run(rep(B0, 12))
  const d2 = revealDelta({ bandTop: 0, bandBottom: 416, fieldTop: still.at.fieldTop, fieldBottom: still.at.fieldBottom, aligned: false })
  eq('팬 없는 칸 이동 · 최소 대기 뒤 목표선까지 한 번', [still.verdict, Math.round(B0 - d2)], ['go', Math.round(target)])
}

// ── 하단 내비 접힘 표식(2026-11-03, 키보드 칸 이동 튐 패널 결정 2) ─────────────────────────
// BottomNav 는 html[data-kbd-open] 으로 접힌다. 표식은 가드가 vv resize(와 복귀 재동기)에서만 쓰고, 그 값은
// keyboardOpen(s) && !phantomKeyboardGap(...) 이다(가드의 `if (!keyboardOpen(s) || phantom)` 의 부정). vv scroll·
// window resize 팬은 표식을 안 쓴다(check-kbd-canonical 11). 여기서는 그 식이 팬·칸 이동 동안 한 번도 안 뒤집히고
// 열림·닫힘 순간에만 바뀌는지 본다. 깜빡임이 곧 '내비가 보였다 사라졌다'다.
{
  const stampOf = (s: KbdSnapshot, editing: boolean) =>
    keyboardOpen(s) && !phantomKeyboardGap({ height: s.vvHeight, frameH: s.frameH, scale: s.scale, editing })
  const openAt = (top: number): KbdSnapshot => ({ frameH: IPH, frameTop: -top, vvHeight: KB_VV, offsetTop: top, scale: 1 })
  const shut: KbdSnapshot = { frameH: IPH, frameTop: 0, vvHeight: IPH, offsetTop: 0, scale: 1 }
  // 한 세션. 닫힘, 키보드 섬, 팬(b) 여러 프레임, (c) 상태, 위아래 화살표로 칸 이동 넷(포커스는 늘 칸), 내려감 차례다.
  const seq: [string, KbdSnapshot, boolean][] = [
    ['닫힘', shut, false],
    ['키보드 섬', openAt(0), true],
    ...[17, 60, 120, 190, 250, 336].map(t => [`팬 ${t}`, openAt(t), true] as [string, KbdSnapshot, boolean]),
    ['(c) 상태', STATES[2].s, true],
    ...[0, 1, 2, 3].map(i => [`화살표 칸 이동 ${i + 1}`, openAt(40 * i), true] as [string, KbdSnapshot, boolean]),
    ['내려감', shut, false],
  ]
  const stamps = seq.map(([, s, e]) => stampOf(s, e))
  const flips = stamps.filter((v, i) => i > 0 && v !== stamps[i - 1]).length
  eq('내비 표식 · 서는 순간과 내리는 순간 두 번만 바뀐다(팬·칸 이동 중 깜빡임 없음)', flips, 2)
  eq('내비 표식 · 키보드가 선 동안 내내 접힘', stamps.slice(1, -1).every(Boolean), true)
  eq('내비 표식 · 닫힘이면 펼침', [stamps[0], stamps[stamps.length - 1]], [false, false])
  eq('내비 표식 · 칸 없는 키보드 높이(유령)면 접지 않는다', stampOf(openAt(0), false), false)
  eq('내비 표식 · 핀치 줌이면 접지 않는다', stampOf({ frameH: IPH, frameTop: 0, vvHeight: 600, offsetTop: 40, scale: 1.4 }, true), false)
  eq('내비 표식 · 외장 키보드 단축바(55 가림)면 접지 않는다', stampOf({ frameH: IPH, frameTop: 0, vvHeight: IPH - 55, offsetTop: 0, scale: 1 }, true), false)
}

// ── 행 머리 보존(2026-11-03, 키보드 칸 이동 튐 패널 결정 3, 가이드 §30) ─────────────────────
// 반복 행 폼은 칸 위 라벨만 남으면 어느 행의 칸인지 모른다. 행 머리(data-reveal-anchor) 위 끝을 띠 위 여백 아래에 지킨다.
{
  const B = { bandTop: 0, bandBottom: 416, aligned: false }
  const target = 416 * TARGET_RATIO
  // 칸 360~400, 행 머리는 칸보다 300 위(60). 목표선까지 올리면(214) 머리가 −154 로 나간다. 머리가 이겨 44 만 올린다.
  eq('앵커 · 머리가 띠 위 여백 아래에 남을 만큼만 올린다',
    revealDelta({ ...B, fieldTop: 360, fieldBottom: 400, anchorTop: 60 }), 60 - REVEAL_GAP)
  eq('앵커 · 그 뒤 머리 위 끝은 띠 위 +16', 60 - revealDelta({ ...B, fieldTop: 360, fieldBottom: 400, anchorTop: 60 }), REVEAL_GAP)
  // 머리가 칸 가까이(90 위)면 목표선까지 그대로 올라간다(클램프가 안 걸린다).
  eq('앵커 · 머리가 가까우면 종전처럼 목표선까지',
    Math.round(revealDelta({ ...B, fieldTop: 360, fieldBottom: 400, anchorTop: 270 })), Math.round(360 - target))
  // 띠가 좁아 머리와 칸을 함께 못 담으면 칸이 이긴다(종전 클램프).
  eq('앵커 · 함께 못 담으면 칸이 이긴다',
    revealDelta({ ...B, fieldTop: 500, fieldBottom: 540, anchorTop: 60 }),
    revealDelta({ ...B, fieldTop: 500, fieldBottom: 540 }))
  eq('앵커 · 함께 못 담는 경우 칸은 띠 안에 든다', 540 - revealDelta({ ...B, fieldTop: 500, fieldBottom: 540, anchorTop: 60 }) <= 416, true)
  eq('앵커 · 칸보다 아래 있는 앵커는 무시', revealDelta({ ...B, fieldTop: 360, fieldBottom: 400, anchorTop: 380 }), revealDelta({ ...B, fieldTop: 360, fieldBottom: 400 }))
  eq('앵커 · NaN 앵커는 무시', revealDelta({ ...B, fieldTop: 360, fieldBottom: 400, anchorTop: NaN }), revealDelta({ ...B, fieldTop: 360, fieldBottom: 400 }))
  // 머리가 이미 띠 위로 나가 있어도 앵커가 칸을 아래로 끌어내리지는 않는다(공짜 모션 없음, 음수는 칸 기준 1회뿐).
  eq('앵커 · 머리가 이미 잘렸어도 아래로 끌어내리지 않는다', revealDelta({ ...B, fieldTop: 100, fieldBottom: 140, anchorTop: -40 }), 0)
  // 앵커가 없으면 종전과 한 조합도 안 다르다(동치 전수).
  let diff = 0, n = 0
  for (const ft of [-30, 0, 10, 40, 100, 145, 188, 200, 300, 380, 500]) for (const h of [20, 40, 300, 660]) for (const al of [false, true]) {
    for (const bb of [300, 416, 538]) {
      n++
      const base = { bandTop: 0, bandBottom: bb, fieldTop: ft, fieldBottom: ft + h, aligned: al }
      if (revealDelta(base) !== revealDelta({ ...base, anchorTop: undefined })) diff++
    }
  }
  eq(`앵커 없음 동치 ${n} 조합 · 종전 revealDelta 와 같다`, diff, 0)
}

// 상수 자체도 고정 — 수치 합의(35%·60px)가 말없이 바뀌면 잡는다(운영자 승인 2026-09-02).
eq('문턱 60px', KBD_OPEN_PX, 60)
eq('목표선 35%', TARGET_RATIO, 0.35)

console.log(`\n키보드 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
