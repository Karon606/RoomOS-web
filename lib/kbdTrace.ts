// 키보드 세션의 visualViewport·포커스·가드 판정을 최근 몇백 건만 메모리에 두는 링버퍼 — 오류신고 계측용, 값만 담는다.
//
// 왜 필요한가(키보드 가림 패널 2026-10-13, 0단계 계측). 모바일 판정은 "iOS 홈화면 앱이 칸을
// 드러내려고 팬하면 innerHeight 를 팬만큼 줄여 보고한다"이고, 그러면 정본의 열림 판정
// (lib/keyboardViewport keyboardOpen)이 팬 도중 거짓으로 뒤집혀 가드가 닫힘 분기로 간다는 것이다.
// 그 가설은 계측 한 장으로 세운 것이라, 제출 시점 스냅샷 하나로는 "언제 뒤집혔나"가 안 남는다.
// 키보드를 내린 뒤에 신고를 보내도 직전 세션의 흐름(포커스, resize, 팬, 판정, 복원)이 실려야 한다.
//
// **읽기 전용이다.** 이 파일은 DOM 에 아무것도 쓰지 않고 이벤트를 구독하지도 않는다. 기록은
// 가드(components/layout/ViewportOffsetGuard)가 판정을 마친 자리에서 kbdTrace() 를 불러 넣는다
// (§30: visualViewport 구독은 가드와 useVisibleBand 두 곳뿐이다). 가드의 판정·쓰기 문장은 그대로고,
// 호출만 지우면 종전 가드와 같은 일을 한다. 계측이 가드를 멈추게 하면 안 되므로 전부 try 안이다.
//
// **개인정보 경계.** 담는 것은 숫자(innerHeight·vv 높이·위치·배율, 화면 고정 상자의 높이·top,
// 문서 scrollTop)와 루트 표식 두 개(data-kbd-open, 인라인 --kbd-inset), 포커스 요소의 태그·type 뿐이다.
// 입력값·placeholder·본문 텍스트·속성값은 안 읽는다. scripts/check-kbd-canonical.mjs 가 이 경계와
// '쓰지 않는다'를 지킨다.
//
// 시각은 표의 t 열(꼬리표)로만 쓴다. 무엇을 언제 잴지를 정하는 데 쓰지 않는다 — 계측 시점을
// 벽시계로 정하지 않는다는 2026-09-08 결정(lib/viewportProbe)과 겹치지 않는다.

import { ZOOM_NEUTRAL_SCALE, type KbdSnapshot } from '@/lib/keyboardViewport'

/**
 * 링버퍼 크기. 포커스 한 번에 resize 두셋과 팬 프레임 수십 건이 온다. 60 이던 때는 큰 팬 한 번이
 * 세션 앞부분(첫 fi, vr open 의 inner 기준선)을 밀어냈다(독립 검수 2026-10-13). 표는 판정이 같은 팬
 * 묶음을 두 줄로 접어 싣으므로, 버퍼를 넉넉히 둬도 신고 메모 자리는 그만큼 안 먹는다.
 */
export const KBD_TRACE_CAP = 300

/**
 * 서버가 신고 메모를 자르는 길이 — app/(app)/errorReports.ts 의 userNote.slice(0, 4000).
 * 'use server' 파일은 상수를 내보낼 수 없어 여기 적는다. 표는 이 안에 남는 자리만큼만 싣는다.
 */
export const REPORT_NOTE_MAX = 4000

export type KbdTraceRow = {
  t: number            // performance.now() — 표에서는 신고창을 연 순간 기준 상대 ms 로만 쓴다
  ev: string           // 사건 — vr·vs·fi·fo·rs·rst·rep
  verdict: string      // 가드 판정 꼬리표 — open·shut·phantom·focus·clear·· (+zoom)
  inner: number
  vvh: number | null
  top: number | null
  H: number | null     // 화면 고정 상자(fixed inset-0)의 높이. 열린 모달 오버레이, rep 줄은 누른 순간의 센티널
  T0: number | null    // 같은 상자의 client top
  sy: number | null    // document.scrollingElement.scrollTop
  open: boolean        // html[data-kbd-open] — 기록 순간
  inset: string        // html 인라인 --kbd-inset — 기록 순간('' 이면 미기입)
  focus: string        // 포커스 요소 태그(+type)
}

/**
 * mode 는 얼린 순간의 화면 방식 한 줄이다(2026-10-20, 신고 be5316e8). 같은 iPhone 이라도 홈화면 앱과
 * 사파리 탭의 뷰포트 동작이 달라, 그 둘을 가르지 못하면 키보드 신고를 읽을 때 또 추측이 된다.
 * 손으로 만든 표(테스트)처럼 없으면 그 줄을 안 적는다.
 */
export type KbdTraceFrozen = { at: number; rows: KbdTraceRow[]; mode?: string }

/** 화면 고정 상자의 자리 중 표에 싣는 두 값. DOMRect 를 그대로 받는다. */
type FrameBox = Pick<DOMRectReadOnly, 'height' | 'top'>

const rows: KbdTraceRow[] = []

/** 포커스 요소의 **종류만** — 'INPUT:text', 'TEXTAREA', 'BODY'. 값은 안 읽는다. */
function focusKind(): string {
  const a = document.activeElement as (Element & { type?: unknown }) | null
  if (!a) return '-'
  const tag = a.tagName
  return typeof a.type === 'string' && a.type && a.type !== tag.toLowerCase() ? `${tag}:${a.type}` : tag
}

/**
 * 팬하는 동안의 H·T0(독립 검수 2026-10-13). 센티널은 신고창을 열 때·제출할 때만 재는데, 신고창 메모
 * 칸이 autoFocus 라 두 순간 모두 신고창 자기 세션이다. 원래 칸이 팬하던 동안의 값은 이미 화면에 선
 * 상자를 읽어 남긴다. 모달 오버레이는 fixed inset-0(components/ui/Modal)이고 등장 모션은 opacity 만
 * 써서(globals.css overlay-in) 그 자리가 곧 화면 고정 상자의 자리다. 붙이지도 떼지도 않고 읽기만 한다.
 * Modal 은 포털이 아니어서 transform 조상 아래 서면 그 조상 기준으로 틀어진다. 그래서 폭이 innerWidth 와
 * 같을 때만 믿고, 아니면 null 이다. 모달이 없으면(셸 폼) null 이고, 그 몫은 누른 순간의 rep 줄이 진다.
 */
function overlayBox(): FrameBox | null {
  const ov = document.querySelector('[data-modal-overlay]')
  const fr = ov ? ov.getBoundingClientRect() : null
  return fr && Math.abs(fr.width - window.innerWidth) < 1 ? fr : null
}

/**
 * 한 줄 기록. 가드가 판정을 마친 자리에서 부른다 — 반환값이 없고, 실패해도 조용히 지나간다.
 * s 를 주면 가드가 판정에 쓴 바로 그 스냅샷을 적고, 안 주면 지금 값을 읽는다(같은 순간이다).
 * box 는 rep 줄에만 넘어온다(누른 순간의 센티널). 없으면 열린 모달 오버레이를 읽는다.
 */
export function kbdTrace(ev: string, verdict: string, s?: KbdSnapshot, box?: FrameBox | null): void {
  if (typeof window === 'undefined' || typeof document === 'undefined') return
  try {
    const vv = window.visualViewport
    const snap: KbdSnapshot = s ?? {
      innerHeight: window.innerHeight,
      vvHeight: vv ? vv.height : NaN,
      offsetTop: vv ? vv.offsetTop : NaN,
      scale: vv ? vv.scale : 1,
    }
    const root = document.documentElement
    const fr = box ?? overlayBox()
    const se = document.scrollingElement
    rows.push({
      t: performance.now(),
      ev,
      verdict: snap.scale > ZOOM_NEUTRAL_SCALE ? `${verdict}+zoom` : verdict,
      inner: snap.innerHeight,
      vvh: Number.isFinite(snap.vvHeight) ? snap.vvHeight : null,
      top: Number.isFinite(snap.offsetTop) ? snap.offsetTop : null,
      H: fr ? fr.height : null,
      T0: fr ? fr.top : null,
      sy: se ? se.scrollTop : null,
      open: root.hasAttribute('data-kbd-open'),
      inset: root.style.getPropertyValue('--kbd-inset').trim(),
      focus: focusKind(),
    })
    if (rows.length > KBD_TRACE_CAP) rows.splice(0, rows.length - KBD_TRACE_CAP)
  } catch { /* 계측 실패는 가드 동작과 무관하다 */ }
}

/**
 * 화면 방식. 홈화면 앱(standalone)인가 브라우저 탭인가. 매체 질의 결과와 iOS 의 navigator.standalone
 * 두 값만 읽는다(둘 다 참·거짓뿐이라 개인정보가 없다). 못 읽으면 '-'.
 */
function displayMode(): string {
  try {
    const nav = navigator as Navigator & { standalone?: boolean }
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(display-mode: standalone)').matches : null
    const ns = typeof nav.standalone === 'boolean' ? (nav.standalone ? 'y' : 'n') : '-'
    return `display-mode=${mq == null ? '-' : mq ? 'standalone' : 'browser'} navigator.standalone=${ns}`
  } catch { return 'display-mode=- navigator.standalone=-' }
}

/**
 * 신고창을 여는 순간 링버퍼를 얼린다. 그 순간을 'rep' 한 줄로 남기고 사본을 돌려준다 —
 * 신고창 자신의 메모 칸이 키보드를 다시 띄워도 그 세션이 직전 세션을 밀어내지 못한다.
 * box 는 누른 순간 잰 센티널(lib/viewportProbe sentinelRect)이다. 그때는 원래 칸이 아직 포커스를
 * 쥐고 있어 팬 상태가 남아 있다. 모달 없는 셸 폼의 H·T0 는 이 한 줄뿐이다.
 */
export function kbdTraceFreeze(box?: FrameBox | null): KbdTraceFrozen {
  kbdTrace('rep', '·', undefined, box)
  const at = typeof performance === 'undefined' ? 0 : performance.now()
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return { at, rows: rows.slice() }
  return { at, rows: rows.slice(), mode: displayMode() }
}

/** 소수 둘째 자리까지 — viewportProbe 의 num 과 같은 자릿수. */
function num(v: number | null): string {
  return v == null ? '-' : String(Math.round(v * 100) / 100)
}

const COLS = ['t', 'ev', 'verdict', 'inner', 'vvh', 'top', 'H', 'T0', 'sy', 'kbd', 'inset', 'focus'] as const
const LEGEND = [
  'ev vr=vv resize · vs=vv scroll · fi/fo=focus in/out · rs=복귀 재동기 · rst=복원(맨 위로 되감기) · rep=신고창 열림 · verdict=가드 판정',
  'vs×n=판정·표식이 같은 팬 n건을 첫 줄과 끝 줄로 접음 · rs 바로 뒤 같은 t 의 vr 은 재동기가 부른 판정'
    + ' · H·T0=fixed 상자 높이·client top(모달 오버레이, rep 줄은 누른 순간의 센티널) · sy=문서 scrollTop',
].join('\n')

// 덜기 차례. 큰 수부터 덜고, 같은 수 안에서는 오래된 줄부터 덜어낸다. 범례는 RESTORE 와 FLIP 사이에서
// 덜어낸다(읽는 법은 이 파일에 남지만 판정이 바뀐 줄은 다시 못 얻는다).
const PLAIN = 4     // 판정·표식이 앞 줄 그대로인 vs·vr
const CONTEXT = 3   // 포커스 드나듦(fi·fo)·재동기(rs)·앞서 연 rep·접힌 묶음의 끝 줄
const RESTORE = 2   // 복원 발동(rst)
const FLIP = 1      // 판정 꼬리표나 표식(kbd·inset)이 앞과 달라진 줄. 첫 줄도 여기다
const LAST = 0      // 마지막 줄(신고창을 연 순간). 덜지 않는다
/** 판정이 바뀐 줄 중 맨 나중까지 남기는 세션 첫 줄 수. */
const FIRST_FLIPS_KEPT = 3

/** 판정 꼬리표가 open·shut·phantom 인 사건. 이 셋의 꼬리표가 바뀌면 판정이 뒤집힌 것이다. */
const JUDGED = new Set(['vr', 'vs', 'fi'])

/** 표 한 줄. 링버퍼 한 건이거나, 접힌 팬 묶음의 끝 줄(fold=묶음 건수)이다. */
type Line = { r: KbdTraceRow; fold: number; rank: number }

/**
 * 접어도 되는 이웃인가 — 판정·표식·포커스가 같은 vs 끼리, 그리고 화면 고정 상자가 모형대로 움직일 때만.
 * 이 계측이 가르려는 것이 "H 는 그대로인가, T0 는 팬(top)을 그대로 따라가는가"라서, 묶음 안에서 H 가
 * 바뀌거나 T0+top 이 흔들리면 그 줄을 접지 않고 드러낸다(재검수 2026-10-13. 양 끝만 남기면 모형이
 * 성립한 것처럼 읽혔다). 포커스 조건은 대개 겹친다 — 포커스가 바뀌면 fo·fi 줄이 먼저 묶음을 끊는다.
 */
function sameFold(a: KbdTraceRow, b: KbdTraceRow): boolean {
  return a.ev === 'vs' && b.ev === 'vs' && a.verdict === b.verdict && a.open === b.open
    && a.inset === b.inset && a.focus === b.focus && a.H === b.H
    // 상자를 못 잰 줄(모달 없는 셸 폼, H·T0 null)은 견줄 값이 없어 판정·표식만으로 접는다.
    && (a.T0 == null || b.T0 == null || Math.abs((a.T0 + (a.top ?? 0)) - (b.T0 + (b.top ?? 0))) < 1)
}

/**
 * 링버퍼를 표 줄로. 같은 vs 가 셋 이상 이어지면 첫 줄과 끝 줄만 남기고 끝 줄에 건수를 단다
 * (큰 팬 한 번이 수십 줄을 먹던 것). 줄마다 덜기 차례(rank)를 매긴다.
 */
function toLines(all: KbdTraceRow[]): Line[] {
  const out: Line[] = []
  let judged = ''
  let prev: KbdTraceRow | null = null
  for (let i = 0; i < all.length; i++) {
    const r = all[i]
    const flip = !prev || prev.open !== r.open || prev.inset !== r.inset || (JUDGED.has(r.ev) && r.verdict !== judged)
    const rank = flip ? FLIP : r.ev === 'rst' ? RESTORE : r.ev === 'vs' || r.ev === 'vr' ? PLAIN : CONTEXT
    if (JUDGED.has(r.ev)) judged = r.verdict
    prev = r
    out.push({ r, fold: 0, rank })
    let j = i + 1
    while (j < all.length && sameFold(r, all[j])) j++
    if (j - i >= 3) {
      prev = all[j - 1]
      out.push({ r: prev, fold: j - i, rank: CONTEXT })
      i = j - 1
    }
  }
  if (out.length > 0) out[out.length - 1].rank = LAST
  return out
}

function render(frozen: KbdTraceFrozen, shown: Line[], title: string, legend: boolean): string {
  let prevFocus = ''
  const cells = shown.map(({ r, fold }) => {
    // 포커스는 바뀔 때만 적는다 — 대부분의 줄이 같은 칸이라 매번 적으면 자리만 먹는다.
    const focus = r.focus === prevFocus ? '' : r.focus
    prevFocus = r.focus
    return [
      String(Math.round(r.t - frozen.at)), fold > 0 ? `${r.ev}×${fold}` : r.ev, r.verdict, String(r.inner),
      num(r.vvh), num(r.top), num(r.H), num(r.T0), num(r.sy),
      r.open ? 'y' : 'n', r.inset ? r.inset.replace(/px$/, '') : '-', focus,
    ]
  })
  const table = [[...COLS] as string[], ...cells]
  const widths = COLS.map((_, i) => Math.max(...table.map(c => c[i].length)))
  const lines = table.map(c => c.map((v, i) => (i === c.length - 1 ? v : v.padEnd(widths[i]))).join(' ').trimEnd())
  // 화면 방식 줄은 제목 바로 아래 둔다. 덜기 대상이 아니다(짧고, 이 줄이 없으면 표를 읽는 틀이 갈린다).
  return [title, ...(frozen.mode ? [frozen.mode] : []), ...(legend ? [LEGEND] : []), ...lines].join('\n')
}

/**
 * 얼린 링버퍼를 사람이 읽는 표 한 덩이로. 판정이 같은 팬 묶음을 먼저 접고, 그래도 maxChars 를
 * 넘으면 **덜기 차례대로** 덜어낸다(독립 검수 2026-10-13). 오래된 줄부터 무작정 버리면 판정이
 * 뒤집힌 줄(vs shut·vr shut)이 앞쪽에 있을 때 그 줄부터 사라졌다. 이제는 앞 줄과 같은 vs·vr,
 * 포커스·재동기 같은 맥락, 복원, 범례 순으로 덜고, 판정이나 표식이 바뀐 줄은 끝까지 남긴다.
 * 마지막 줄(신고창을 연 순간)은 덜지 않는다.
 *
 * 가드가 적은 줄이 하나도 없으면(가드가 없는 화면이거나 키보드를 한 번도 안 띄웠다) '기록 없음'이라고
 * 적어 기능이 없던 때의 신고와 가른다. 그래도 누른 순간의 rep 줄(센티널 H·T0)은 싣는다.
 */
export function kbdTraceTable(frozen: KbdTraceFrozen | null, maxChars: number = REPORT_NOTE_MAX): string {
  if (!frozen) return ''
  const all = frozen.rows
  const none = '키보드 세션 기록 없음'
  if (all.every(r => r.ev === 'rep')) {
    const last = all[all.length - 1]
    const out = last
      ? render(frozen, [{ r: last, fold: 0, rank: LAST }], `${none} (신고창을 연 순간 한 줄 · t=그 순간 기준 ms)`, true)
      : ''
    if (out && out.length <= maxChars) return out
    return none.length <= maxChars ? none : ''
  }
  const lines = toLines(all)
  const folded = all.length - lines.length
  const order = lines.map((_, i) => i).filter(i => lines[i].rank !== LAST)
    .sort((a, b) => lines[b].rank - lines[a].rank || a - b)
  // 판정이 바뀐 줄끼리는 가운데부터 덜어 세션 첫 세 줄(처음 뒤집힌 순간)과 최근 줄을 남긴다. 복원과
  // 재팬이 번갈아 판정이 자주 뒤집히면 그 줄만으로 자리를 넘는데, 오래된 것부터 덜면 첫 뒤집힘이 먼저 사라졌다.
  const flips = order.filter(i => lines[i].rank === FLIP)
  const steps: (number | 'legend')[] = [
    ...order.filter(i => lines[i].rank > FLIP), 'legend', ...flips.slice(FIRST_FLIPS_KEPT), ...flips.slice(0, FIRST_FLIPS_KEPT),
  ]
  for (let k = 0; k <= steps.length; k++) {
    const gone = new Set(steps.slice(0, k))
    const shown = lines.filter((_, i) => !gone.has(i))
    const cut = lines.length - shown.length
    const title = `키보드 세션 (신고창을 연 순간까지 ${all.length}건`
      + `${folded > 0 ? `, 팬 ${folded}건 접음` : ''}${cut > 0 ? `, ${cut}줄 덜어냄(판정이 그대로인 줄부터)` : ''}`
      + ' · t=그 순간 기준 ms)'
    const out = render(frozen, shown, title, !gone.has('legend'))
    if (out.length <= maxChars) return out
  }
  const skipped = `키보드 세션 ${all.length}건 생략 (메모 길이 한도)`
  return skipped.length <= maxChars ? skipped : ''
}
