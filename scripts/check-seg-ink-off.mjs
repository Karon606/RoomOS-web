// 탭·세그먼트의 고르지 않은 칸 글자가 AA 미달 색으로 되돌아가는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. SegmentedControl 비활성 칸과 단일 선택 칩은 늘 --canvas(--cream-2) 위에 서는데, 종전 글자색
// --warm-mid(#7A6553)는 거기서 4.11:1 로 AA(4.5:1) 미달이었다(2026-10-23 운영자 결정 '진하게'). 정본은
// --seg-ink-off(라이트 #6B5745 5.10:1, 다크 --d-ink-s 10.56:1)다. --warm-dark 로 올리면 고른 칸과 글자가 같아져
// 위계가 무너지므로 그 사이 한 단을 둔다(가이드 §23).
//
//   ⓐ globals.css 의 --seg-ink-off 가 라이트(:root, 인쇄)에서 --cream-2 위, 다크(html.dark)에서 --d-page 위
//      4.5:1 이상이다. 값을 바꾸면 여기서 대비를 다시 계산한다.
//   ⓑ SegmentedControl 비활성 칸 글자가 text-[var(--seg-ink-off)] 이고, --warm-mid·--ink-s·--ink-3·--warm-muted·
//      --ink-m 글자색이 그 파일에 없다.
//   ⓒ role="radio" 칩을 가진 파일에서 --canvas 바탕 비선택 style 의 color 가 위 미달 토큰이 아니다.
//   ⓓ ViewTabs 비활성(segInactive)은 --warm-dark 다(§25, 고른 칸이 --tc-text 라 색으로 위계가 선다).
//   ⓔ 토글 칩(aria-pressed)을 가진 파일에서 --canvas 바탕 줄의 글자색 클래스가 위 미달 토큰이 아니다
//      (요청 '긴급만', 재고 위치 칩 2곳. 2026-10-23 같은 실패라 함께 묶음).
//
// 실행: node scripts/check-seg-ink-off.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

// ⓐ 토큰 값과 대비
const lin = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
const lum = hex => { const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b) }
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05) }
const css = strip(readFileSync('app/globals.css', 'utf8'))
const block = re => { const m = css.match(re); return m ? m[1] : null }
const rootBlock = block(/:root\s*\{([\s\S]*?)\n\}/)
const darkBlock = block(/\nhtml\.dark\s*\{([\s\S]*?)\n\}/)
const printBlock = block(/html,\s*html\.dark\s*\{([\s\S]*?)\n\s*\}/)
const valueIn = (b, name) => { const m = b?.match(new RegExp(`--${name}:\\s*([^;]+);`)); return m ? m[1].trim() : null }
const resolve = (b, v, fallback) => {
  for (let i = 0; v && i < 5; i++) {
    const ref = v.match(/^var\(--([\w-]+)\)$/)
    if (!ref) break
    v = valueIn(b, ref[1]) ?? valueIn(fallback, ref[1])
  }
  return v && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null
}
const checkPair = (label, b, fb, bgName) => {
  const fg = resolve(b, valueIn(b, 'seg-ink-off'), fb)
  const bg = resolve(b, valueIn(b, bgName), fb)
  if (!fg || !bg) { violations.push(`app/globals.css ${label}: --seg-ink-off 또는 --${bgName} 를 6자리 hex 로 풀지 못했다. 토큰 이름·자리를 바꿨다면 이 그물(ⓐ)도 옮긴다.`); return }
  const r = ratio(fg, bg)
  if (r < 4.5) violations.push(`app/globals.css ${label}: --seg-ink-off ${fg} 가 --${bgName} ${bg} 위 ${r.toFixed(2)}:1 로 AA 4.5:1 미달이다(가이드 §23).`)
}
checkPair(':root(라이트)', rootBlock, null, 'cream-2')
checkPair('html.dark', darkBlock, rootBlock, 'd-page')
checkPair('@media print', printBlock, rootBlock, 'cream-2')

// ⓑ SegmentedControl
const BAD_TEXT = /text-\[var\(--(?:warm-mid|ink-s|ink-3|warm-muted|ink-m|ink-mute)\)\]/
{
  const f = 'components/ui/SegmentedControl.tsx'
  const src = strip(readFileSync(f, 'utf8'))
  if (!src.includes('text-[var(--seg-ink-off)]')) violations.push(`${f} 비활성 칸 글자가 text-[var(--seg-ink-off)] 가 아니다(--canvas 위 AA, 가이드 §23).`)
  src.split('\n').forEach((line, i) => {
    if (BAD_TEXT.test(line)) violations.push(`${f}:${i + 1} 칸 글자에 AA 미달 토큰(${line.match(BAD_TEXT)[0]})이 있다. --canvas 위 4.11:1 이다. text-[var(--seg-ink-off)] 를 쓴다.`)
  })
}

// ⓒ 단일 선택 칩(role="radio") 비선택 글자
const walk = (dir, out) => {
  let names
  try { names = readdirSync(dir) } catch { return out }
  for (const name of names) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full, out); continue }
    if (/\.tsx$/.test(name)) out.push(full)
  }
  return out
}
const BAD_CHIP = /background:\s*'var\(--canvas\)',\s*color:\s*'var\(--(?:warm-mid|ink-s|ink-3|warm-muted|ink-m|ink-mute)\)'/
let chipFiles = 0
for (const f of walk('app', walk('components', []))) {
  const src = strip(readFileSync(f, 'utf8'))
  if (!src.includes('role="radio"')) continue
  if (src.includes("color: 'var(--seg-ink-off)'")) chipFiles++
  src.split('\n').forEach((line, i) => {
    if (BAD_CHIP.test(line)) violations.push(`${f}:${i + 1} 단일 선택 칩 비선택 글자가 --canvas 위 AA 미달 토큰이다. color: 'var(--seg-ink-off)' 를 쓴다(가이드 §23).`)
  })
}
if (chipFiles < 4) violations.push(`단일 선택 칩 정본 4곳(청소·작업 담당/수행자) 중 --seg-ink-off 를 쓰는 파일이 ${chipFiles}곳뿐이다. 파일을 옮겼다면 확인한다.`)

// ⓔ 토글 칩(aria-pressed) 끈 상태 글자
let toggleChips = 0
for (const f of walk('app', walk('components', []))) {
  const src = strip(readFileSync(f, 'utf8'))
  if (!src.includes('aria-pressed')) continue
  // aria-pressed 를 단 요소의 여는 태그 안(그 줄부터 '>' 로 끝나는 줄까지, 최대 8줄)만 본다.
  // 같은 파일의 다른 --canvas 바탕 글자(배지·캡션)는 이 그물의 대상이 아니다.
  const lines = src.split('\n')
  lines.forEach((line, i) => {
    if (!line.includes('aria-pressed')) return
    for (let j = i; j < Math.min(lines.length, i + 8); j++) {
      const l = lines[j]
      if (l.includes('bg-[var(--canvas)]')) {
        if (l.includes('text-[var(--seg-ink-off)]')) toggleChips++
        if (BAD_TEXT.test(l)) violations.push(`${f}:${j + 1} 토글 칩 끈 상태 글자가 --canvas 위 AA 미달 토큰(${l.match(BAD_TEXT)[0]})이다. text-[var(--seg-ink-off)] 를 쓴다(가이드 §23).`)
      }
      if (j > i && /[}'"]\)?}?>\s*$|^\s*>\s*$/.test(l)) break
    }
  })
}
if (toggleChips < 3) violations.push(`토글 칩 정본 3곳(요청 '긴급만', 재고 위치 칩 2곳) 중 --seg-ink-off 를 쓰는 자리가 ${toggleChips}곳뿐이다. 자리를 옮겼다면 확인한다.`)

// ⓓ ViewTabs 비활성
{
  const f = 'components/ui/ViewTabs.tsx'
  const m = strip(readFileSync(f, 'utf8')).match(/const segInactive\s*=\s*'([^']*)'/)
  if (!m) violations.push(`${f} segInactive 를 찾지 못했다. 이름을 바꿨다면 이 그물(ⓓ)도 옮긴다.`)
  else if (!m[1].includes('text-[var(--warm-dark)]')) violations.push(`${f} segInactive 글자가 --warm-dark 가 아니다. 페이지 배경 위라 --warm-mid 는 4.11:1 미달이다(가이드 §25).`)
}

if (violations.length) {
  console.error(`check-seg-ink-off: ${violations.length}건 위반`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('check-seg-ink-off: OK (--seg-ink-off 라이트·다크·인쇄 AA, SegmentedControl·단일 선택 칩·토글 칩·ViewTabs 비활성 글자)')
