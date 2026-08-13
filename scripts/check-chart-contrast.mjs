// 차트 시리즈 색 대비·분리도 감지망 (읽기 전용, 위반 시 exit 1).
//
// 왜 필요한가 (2026-08-13, 추이 게이지 적층).
//   추이 막대가 게이지가 되면서 시리즈마다 층이 둘이 됐다 — 진한 실적 위에 같은 hue 70% 의 옅은
//   예정층. 색을 눈으로 고르면 라이트에서는 멀쩡한데 다크에서 무너지는 조합이 그대로 배포된다.
//   실제로 그 상태였다: 추이 범례 스와치가 --ink-m(다크 #93816F)인데 막대 채움은 --neutral-fg
//   (다크 #C7B5A2)라 같은 시리즈가 두 색이었고, 수입 --coral 은 다크에서 안 밝아져 크림 카드 위
//   2.78:1 이었다(그 70% 층은 1.97:1).
//
// 값을 여기 박지 않는다. app/globals.css 에서 토큰을 직접 읽어 별칭까지 따라간다 —
//   박아 두면 토큰이 움직일 때 이 그물이 조용히 거짓말을 한다(check-naive-datetime 이 schema 에서
//   칸 이름을 직접 읽는 그 방식).
//
// 판정 기준(가이드 §03 대비 규정 + 이 저장소가 이미 통과시킨 실측):
//   ① 실적(원색) 채움 대 카드 표면 대비 >= 3.0        — WCAG 1.4.11 비텍스트 대비
//   ② 실적 대 예정 틴트 ΔE76 >= 11.3                  — 지출 도넛 예정 틴트가 이미 통과한 최솟값
//   ③ 예정 틴트 대 카드 표면 ΔE76 >= 12               — §03 밴드 판정 바닥값
//   ④ 인접 시리즈(수입·지출) 사이 ΔE76 >= 12          — 같은 그림 안에서 두 계열이 갈려야 한다
//
// 예정 틴트 층에는 **대비비 게이트를 걸지 않는다.** 걸면 이미 배포 중인 지출 도넛 예정 틴트가
//   즉시 빨간불이 된다(라이트 1.71 · 다크 1.55). 그 층의 판독은 아래 원색 층과의 ΔE 가 지므로
//   대비비는 기록만 한다.
//
// 실행: node scripts/check-chart-contrast.mjs

import { readFileSync } from 'node:fs'

const css = readFileSync('app/globals.css', 'utf8')

// ── 토큰 읽기 ────────────────────────────────────────────────────
// 최상위 블록만 본다(@media prefers-reduced-motion·print 안의 재정의는 화면 색이 아니다).
function tokensOf(selector) {
  const out = new Map()
  const re = new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{`, 'g')
  while (re.exec(css) !== null) {
    let depth = 1
    let i = re.lastIndex
    const start = i
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth++
      else if (css[i] === '}') depth--
      i++
    }
    const body = css.slice(start, i - 1)
    for (const d of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out.set(d[1], d[2].trim())
  }
  return out
}
const LIGHT = tokensOf(':root')
const DARK = tokensOf('html.dark')

function resolve(name, mode, seen = new Set()) {
  if (seen.has(name)) return null
  seen.add(name)
  const raw = (mode === 'dark' ? DARK.get(name) : undefined) ?? LIGHT.get(name)
  if (!raw) return null
  const v = raw.trim()
  if (v.startsWith('#')) return v
  const ref = v.match(/^var\((--[\w-]+)\)$/)
  if (ref) return resolve(ref[1], mode, seen)
  return null   // rgba·color-mix 등 — 이 그물이 재는 대상이 아니다
}

// ── 색 계산 ──────────────────────────────────────────────────────
const hex2rgb = (h) => {
  const s = h.replace('#', '')
  const f = s.length === 3 ? s.split('').map(c => c + c).join('') : s
  return [0, 2, 4].map(i => parseInt(f.slice(i, i + 2), 16))
}
const srgb = (c) => { const x = c / 255; return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4 }
const lum = (rgb) => 0.2126 * srgb(rgb[0]) + 0.7152 * srgb(rgb[1]) + 0.0722 * srgb(rgb[2])
const contrast = (a, b) => {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
// color-mix(in srgb, C 70%, transparent) 를 불투명 배경 위에 합성한 실제 픽셀.
const mixOver = (fg, bg, alpha) => fg.map((c, i) => Math.round(c * alpha + bg[i] * (1 - alpha)))
const rgb2lab = (rgb) => {
  const [r, g, b] = rgb.map(srgb)
  let x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047
  let y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.00000
  let z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883
  const f = (t) => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116)
  ;[x, y, z] = [f(x), f(y), f(z)]
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)]
}
const deltaE = (a, b) => {
  const [l1, a1, b1] = rgb2lab(a); const [l2, a2, b2] = rgb2lab(b)
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2)
}

// ── 검사 대상 ────────────────────────────────────────────────────
// 층이 둘인 차트 — 진한 실적 위에 같은 hue 70% 예정층. 소비처는 추이 막대와 지출 카테고리 도넛이다.
// 도넛 조각은 카테고리마다 색이 달라 팔레트 8색 전부를 시리즈로 넣는다.
const SURFACE = '--cream'   // 두 차트가 서 있는 카드 표면
const TINT_ALPHA = 0.7      // pendingTint 의 70% — 두 소비처가 같은 문법을 쓴다
//
// 채움 대비(①)는 **이번에 고른 두 시리즈에만** 건다. viz 팔레트 8색은 §04 정본이고 그중 넷이
// 라이트에서, 둘이 다크에서 3.0 미만이다 — 이미 배포 중인 지출 도넛 색이라 여기서 빨간불을
// 켜면 그물이 첫날부터 무시된다. 팔레트 자체는 §04 개정 사안으로 운영자 판단 대기 중이고
// (8색 대 카테고리 13종), 그 결정이 내려지면 이 목록의 gateCR 을 켜면 된다.
// 분리도(②③)는 팔레트에도 건다 — 그건 팔레트 값과 무관하게 '층을 옅게 잇는다'는 문법의 조건이다.
const SERIES = [
  { name: '추이 수입',   token: '--tc-text', gateCR: true },
  { name: '추이 지출',   token: '--ink-s',   gateCR: true },
  ...Array.from({ length: 8 }, (_, i) => ({ name: `지출 도넛 viz-${i + 1}`, token: `--viz-${i + 1}`, gateCR: false })),
]
const PAIRS = [['추이 수입', '추이 지출']]   // 한 그림 안에 나란히 서는 계열

const violations = []
const rows = []
for (const mode of ['light', 'dark']) {
  const bgHex = resolve(SURFACE, mode)
  if (!bgHex) { violations.push(`[토큰] ${SURFACE} 를 ${mode} 에서 hex 로 풀 수 없다 — 그물이 무력해졌다`); continue }
  const bg = hex2rgb(bgHex)
  const solid = new Map()
  for (const s of SERIES) {
    const hex = resolve(s.token, mode)
    if (!hex) { violations.push(`[토큰] ${s.token} 를 ${mode} 에서 hex 로 풀 수 없다 — 그물이 무력해졌다`); continue }
    const c = hex2rgb(hex)
    solid.set(s.name, c)
    const tint = mixOver(c, bg, TINT_ALPHA)
    const cr = contrast(c, bg)
    const dSolidTint = deltaE(c, tint)
    const dTintBg = deltaE(tint, bg)
    rows.push(`  ${mode.padEnd(5)} ${s.name.padEnd(18)} ${hex} 대 카드 ${cr.toFixed(2)}:1 · 실적대예정 ΔE ${dSolidTint.toFixed(2)} · 예정대카드 ΔE ${dTintBg.toFixed(2)} (예정 대비 ${contrast(tint, bg).toFixed(2)}:1)`)
    if (s.gateCR && cr < 3.0) violations.push(`[대비] ${mode} ${s.name}(${s.token}) 채움이 카드 위 ${cr.toFixed(2)}:1 — 비텍스트 대비 3.0 미달`)
    if (dSolidTint < 11.3) violations.push(`[분리] ${mode} ${s.name} 실적과 예정층 ΔE76 ${dSolidTint.toFixed(2)} — 두 층이 안 갈린다(기준 11.3)`)
    if (dTintBg < 12) violations.push(`[분리] ${mode} ${s.name} 예정층과 카드 표면 ΔE76 ${dTintBg.toFixed(2)} — 층이 배경에 묻힌다(기준 12)`)
  }
  for (const [a, b] of PAIRS) {
    const ca = solid.get(a); const cb = solid.get(b)
    if (!ca || !cb) continue
    const d = deltaE(ca, cb)
    rows.push(`  ${mode.padEnd(5)} ${a} 대 ${b} ΔE ${d.toFixed(2)}`)
    if (d < 12) violations.push(`[분리] ${mode} ${a} 와 ${b} ΔE76 ${d.toFixed(2)} — 한 그림 안 두 계열이 안 갈린다(기준 12)`)
  }
}

console.log('[차트 대비] 실측')
for (const r of rows) console.log(r)
console.log(`\n[차트 대비] 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exit(1)
