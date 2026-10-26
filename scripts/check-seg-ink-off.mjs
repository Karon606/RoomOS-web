// 탭·세그먼트의 고르지 않은 칸 글자가 AA 미달 색으로 되돌아가는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. SegmentedControl 비활성 칸과 단일 선택 칩은 늘 --canvas(--cream-2) 위에 서는데, 종전 글자색
// --warm-mid(#7A6553)는 거기서 4.11:1 로 AA(4.5:1) 미달이었다(2026-10-23 운영자 결정 '진하게'). 정본은
// --seg-ink-off(다크 --d-ink-s 10.56:1)다. --warm-dark 로 올리면 고른 칸과 글자가 같아져 위계가 무너지므로 그 사이
// 한 단을 둔다(가이드 §23). 2026-10-26 부터 보조 잉크 --ink-3 자체를 #6A5644(--canvas 위 5.18:1)로 내려 --seg-ink-off 는
// 그 별칭이다(종전 따로 #6B5745). ⓖ 가 보조 잉크 한 값의 대비와 위계를 지킨다.
//
//   ⓐ globals.css 의 --seg-ink-off 가 라이트(:root, 인쇄)에서 --cream-2 위, 다크(html.dark)에서 --d-page 위
//      4.5:1 이상이다. 값을 바꾸면 여기서 대비를 다시 계산한다.
//   ⓑ SegmentedControl 비활성 칸 글자가 text-[var(--seg-ink-off)] 이고, --warm-mid·--ink-s·--ink-3·--warm-muted·
//      --ink-m 글자색이 그 파일에 없다.
//   ⓒ role="radio" 칩을 가진 파일에서 --canvas 바탕 비선택 style 의 color 가 위 보조 잉크 토큰이 아니다.
//   ⓓ ViewTabs 비활성(segInactive)은 --warm-dark 다(§25, 고른 칸이 --tc-text 라 색으로 위계가 선다).
//   ⓕ role 과 상관없이 선택형 칩·세그먼트 버튼의 삼항 패턴(선택됨이면 채움, 아니면 --canvas·--cream-2 바탕)에서
//      고르지 않은 쪽 글자가 위 보조 잉크 토큰이 아니다. 클래스 문자열 삼항과 style 객체 삼항 둘 다 본다
//      (2026-10-23 독립 검수, ⓒ 가 role="radio" 파일만 봐서 지출 유형 세그먼트·추이 기간 칩 등을 놓쳤다).
//      비선택 쪽이 상수 이름이면 같은 파일의 정의를 따라가고, style 객체의 키 순서는 따지지 않으며, && 조건식도 본다(재검수).
//   ⓔ 토글 칩(aria-pressed)을 가진 파일에서 --canvas 바탕 줄의 글자색 클래스가 위 보조 잉크 토큰이 아니다
//      (요청 '긴급만', 재고 위치 칩 2곳. 2026-10-23 같은 실패라 함께 묶음).
//   ⓗ pale-neutral 틴트 배지(Badge tone="pale-neutral")가 --canvas·--cream-2·--page 불투명 면에 바로 서지 않는다. 그 면에서는
//      --neutral-bg(.08) 위 보조 잉크가 4.49:1 로 한 끗 미달이라 solid neutral(--cream-3 바탕, 4.52:1)을 쓴다(2026-10-26, 고정지출 행
//      '묶음'·'비활성' 두 화면과 분류 관리 '사용 안 함'). 배지를 감싼 요소를 거슬러 올라가 처음 바탕을 가진 요소로 판정한다.
//      tone 을 변수로 넘기는 자리(정산 패널 등)는 정적으로 못 보므로 이 축 밖이다.
//   ⓑ~ⓕ 는 2026-10-26 전에는 대비(--canvas 위 4.11:1)를 지켰다. 지금은 라이트에서 보조 잉크와 --seg-ink-off 가 같은 값이라
//      대비가 아니라 칸 글자의 정본 이름을 지킨다. '이 칸 글자를 --warm-dark 로 올리지 않는다'(§23)는 규칙이 그 이름에 걸려 있다.
//   ⓖ 보조 잉크(--ink-3 · --warm-mid · --warm-muted · --ink-mute · --ink-s · --ink-m · --seg-ink-off · --neutral-fg)가 라이트(:root, 인쇄)에서
//      한 값으로 풀리고(같은 갈색 두 벌 금지), 라이트 불투명 면 넷(--canvas · --cream · --cream-soft · --cream-3) 위 4.5:1
//      이상이며, 본문 --ink-2 와 2.0:1 이상 떨어져 위계가 남는다. 다크(html.dark)는 --ink-3 · --ink-mute 가 --d-page ·
//      --d-card · --d-card-2 위 4.5:1 이상이다(--d-ink-m 이 --d-card-2 위 4.46 이라 2026-10-26 #948270 으로 밝혔다). 배지·캡션 17곳·배치도 회색 버튼·월 선택 '이번달'이 --canvas 위 4.11:1 이던 것을
//      자리마다가 아니라 값 한 곳에서 고친 결과를 지킨다(2026-10-23 운영자 승인, 2026-10-26 시공, 가이드 §03).
//
// 실행: node scripts/check-seg-ink-off.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const strip = s => s
  // 블록 주석은 줄 머리·공백·{ ( , ; 뒤에서만 연다. accept="image/*" 같은 문자열 속 '/*' 를 주석 시작으로 읽으면
  // 다음 '*/' 까지 수백 줄이 지워져 그 안의 칩을 못 본다(배치도 편집기 툴바가 그렇게 빠져 있었다).
  .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//gm, (m, pre) => pre + m.slice(pre.length).replace(/[^\n]/g, ''))
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

// ⓖ 보조 잉크 한 값 · 라이트 면 넷 AA · 본문과 위계 · 다크
const SECONDARY = ['ink-3', 'warm-mid', 'warm-muted', 'ink-mute', 'ink-s', 'ink-m', 'seg-ink-off', 'neutral-fg']
const LIGHT_SURFACES = ['canvas', 'cream', 'cream-soft', 'cream-3']
const HIERARCHY_MIN = 2.0
const checkSecondary = (label, b, fb) => {
  const ink = resolve(b, valueIn(b, 'ink-3') ?? valueIn(fb, 'ink-3'), fb)
  if (!ink) { violations.push(`app/globals.css ${label}: --ink-3 를 6자리 hex 로 풀지 못했다. 토큰 이름·자리를 바꿨다면 이 그물(ⓖ)도 옮긴다.`); return }
  for (const name of SECONDARY) {
    const v = resolve(b, valueIn(b, name) ?? valueIn(fb, name), fb)
    if (!v) violations.push(`app/globals.css ${label}: --${name} 를 6자리 hex 로 풀지 못했다(ⓖ).`)
    else if (v.toLowerCase() !== ink.toLowerCase()) violations.push(`app/globals.css ${label}: --${name} ${v} 가 --ink-3 ${ink} 와 다르다. 라이트 보조 잉크는 한 값이다(같은 갈색 두 벌 금지, 가이드 §03).`)
  }
  for (const s of LIGHT_SURFACES) {
    const bg = resolve(b, valueIn(b, s) ?? valueIn(fb, s), fb)
    if (!bg) { violations.push(`app/globals.css ${label}: --${s} 를 6자리 hex 로 풀지 못했다(ⓖ).`); continue }
    const r = ratio(ink, bg)
    if (r < 4.5) violations.push(`app/globals.css ${label}: 보조 잉크 --ink-3 ${ink} 가 --${s} ${bg} 위 ${r.toFixed(2)}:1 로 AA 4.5:1 미달이다(가이드 §03).`)
  }
  const body = resolve(b, valueIn(b, 'ink-2') ?? valueIn(fb, 'ink-2'), fb)
  if (!body) violations.push(`app/globals.css ${label}: --ink-2 를 6자리 hex 로 풀지 못했다(ⓖ).`)
  else if (ratio(ink, body) < HIERARCHY_MIN) violations.push(`app/globals.css ${label}: 보조 잉크 ${ink} 와 본문 --ink-2 ${body} 의 차이가 ${ratio(ink, body).toFixed(2)}:1 로 ${HIERARCHY_MIN}:1 미만이다. 보조가 본문과 붙어 위계가 무너진다(가이드 §03).`)
}
checkSecondary(':root(라이트)', rootBlock, null)
checkSecondary('@media print', printBlock, rootBlock)
for (const name of ['ink-3', 'ink-mute']) {
  const fg = resolve(darkBlock, valueIn(darkBlock, name), rootBlock)
  for (const s of ['d-page', 'd-card', 'd-card-2']) {
    const bg = resolve(darkBlock, valueIn(darkBlock, s), rootBlock)
    if (!fg || !bg) { violations.push(`app/globals.css html.dark: --${name} 또는 --${s} 를 6자리 hex 로 풀지 못했다(ⓖ).`); continue }
    const r = ratio(fg, bg)
    if (r < 4.5) violations.push(`app/globals.css html.dark: --${name} ${fg} 가 --${s} ${bg} 위 ${r.toFixed(2)}:1 로 AA 4.5:1 미달이다(가이드 §28).`)
  }
}

// ⓑ SegmentedControl
const BAD_TEXT = /text-\[var\(--(?:warm-mid|ink-s|ink-3|warm-muted|ink-m|ink-mute)\)\]/
{
  const f = 'components/ui/SegmentedControl.tsx'
  const src = strip(readFileSync(f, 'utf8'))
  if (!src.includes('text-[var(--seg-ink-off)]')) violations.push(`${f} 비활성 칸 글자가 text-[var(--seg-ink-off)] 가 아니다(--canvas 위 AA, 가이드 §23).`)
  src.split('\n').forEach((line, i) => {
    if (BAD_TEXT.test(line)) violations.push(`${f}:${i + 1} 칸 글자에 보조 잉크 토큰(${line.match(BAD_TEXT)[0]})이 있다. 칸 글자 정본은 text-[var(--seg-ink-off)] 다(가이드 §23).`)
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
    if (BAD_CHIP.test(line)) violations.push(`${f}:${i + 1} 단일 선택 칩 비선택 글자가 보조 잉크 토큰이다. 칸 글자 정본 color: 'var(--seg-ink-off)' 를 쓴다(가이드 §23).`)
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
        if (BAD_TEXT.test(l)) violations.push(`${f}:${j + 1} 토글 칩 끈 상태 글자가 보조 잉크 토큰(${l.match(BAD_TEXT)[0]})이다. 칸 글자 정본 text-[var(--seg-ink-off)] 를 쓴다(가이드 §23).`)
      }
      if (j > i && /[}'"]\)?}?>\s*$|^\s*>\s*$/.test(l)) break
    }
  })
}
if (toggleChips < 3) violations.push(`토글 칩 정본 3곳(요청 '긴급만', 재고 위치 칩 2곳) 중 --seg-ink-off 를 쓰는 자리가 ${toggleChips}곳뿐이다. 자리를 옮겼다면 확인한다.`)

// ⓕ 선택형 칩·세그먼트 삼항(role 무관)
const BAD_TOKEN = '(?:warm-mid|ink-s|ink-3|warm-muted|ink-m|ink-mute)'
const SOFT_BG = '(?:canvas|cream-2|page)'
const BG_CLASS = new RegExp(`(?:^|\\s)bg-\\[var\\(--${SOFT_BG}\\)\\]`)
const BAD_TXT_CLASS = new RegExp(`(?:^|\\s)text-\\[var\\(--${BAD_TOKEN}\\)\\]`)
const BG_STYLE = new RegExp(`background:\\s*'var\\(--${SOFT_BG}\\)'`)
const BAD_STYLE = new RegExp(`(?:^|[\\s,{])color:\\s*'var\\(--${BAD_TOKEN}\\)'`)
// ① 클래스 삼항: ? 선택 : 비선택. 양쪽 다 문자열이거나 상수 이름일 수 있다(상수는 같은 파일의 정의를 따라가 판정).
const ARM = `((['"\`])[^'"\`]*\\2|[A-Za-z_$][\\w$]*)`
const TERN_CLASS = new RegExp(`\\?\\s*${ARM}\\s*:\\s*${ARM.replace('\\2', '\\4')}`, 'g')
// ② style 삼항: ? { ... } : { ... }. 비선택 객체 안에서 background·color 순서는 따지지 않는다.
const TERN_STYLE = /\?\s*\{[^{}]*\}\s*:\s*\{([^{}]*)\}/g
// ③ && 조건식: cond && '비선택 클래스'
const AND_CLASS = /&&\s*(['"`])([^'"`]*)\1/g
const lineOf = (src, idx) => src.slice(0, idx).split('\n').length
// 삼항이 걸린 요소가 누를 수 있는 것(button·Link·a)일 때만 본다. span 배지의 상태색 삼항은 선택형 컨트롤이 아니다.
const PRESSABLE = new Set(['button', 'Link', 'a'])
const tagAt = (src, idx) => { const m = src.slice(Math.max(0, idx - 2000), idx).match(/<([A-Za-z][\w.]*)[^<]*$/); return m ? m[1] : null }
// 예외: 월 선택의 '이번달'은 고르는 칸이 아니라 바로가기 액션이다. 바로 위 월 그리드(--warm-mid)와 같은 축에 두어야
// 바로가기 글자가 고를 수 있는 달보다 진해지는 역전이 없다(2026-10-23 재검수). 그래서 이 한 자리는 이 그물이 보지 않는다.
const isShortcut = (src, idx) => /이번달/.test(src.slice(idx, idx + 300))
const armText = (consts, arm) => {
  if (!arm) return ''
  if (/^['"`]/.test(arm)) return arm.slice(1, -1)
  return consts.get(arm) ?? ''
}
for (const f of walk('app', walk('components', []))) {
  const src = strip(readFileSync(f, 'utf8'))
  const consts = new Map([...src.matchAll(/const\s+([A-Za-z_$][\w$]*)\s*=\s*(['"`])([^'"`]*)\2/g)].map(m => [m[1], m[3]]))
  const flag = (idx, what) => violations.push(`${f}:${lineOf(src, idx)} 선택형 칩·세그먼트의 고르지 않은 칸 ${what}. 보조 잉크 토큰 대신 칸 글자 정본 --seg-ink-off 를 쓴다(가이드 §23).`)
  for (const m of src.matchAll(TERN_CLASS)) {
    const on = armText(consts, m[1]), off = armText(consts, m[3])
    if (!BG_CLASS.test(off) || !BAD_TXT_CLASS.test(off)) continue
    if (BG_CLASS.test(on)) continue // 양쪽 다 옅은 바탕이면 선택형 채움 패턴이 아니다
    if (!PRESSABLE.has(tagAt(src, m.index)) || isShortcut(src, m.index)) continue
    flag(m.index, `글자(${/^['"`]/.test(m[3]) ? '' : `상수 ${m[3]} → `}${off.match(BAD_TXT_CLASS)[0].trim()})`)
  }
  for (const m of src.matchAll(TERN_STYLE)) {
    if (!BG_STYLE.test(m[1]) || !BAD_STYLE.test(m[1])) continue
    if (!PRESSABLE.has(tagAt(src, m.index)) || isShortcut(src, m.index)) continue
    flag(m.index, 'style 글자')
  }
  for (const m of src.matchAll(AND_CLASS)) {
    if (!BG_CLASS.test(m[2]) || !BAD_TXT_CLASS.test(m[2])) continue
    if (!PRESSABLE.has(tagAt(src, m.index)) || isShortcut(src, m.index)) continue
    flag(m.index, `&& 조건식 글자(${m[2].match(BAD_TXT_CLASS)[0].trim()})`)
  }
}

// ⓗ --canvas 면 위 pale-neutral 금지
{
  const tagEnd = (src, from) => { let d = 0; for (let k = from; k < src.length; k++) { const c = src[k]; if (c === '{') d++; else if (c === '}') d--; else if (c === '>' && d === 0) return k } return -1 }
  const ANY_BG = /(?:^|[\s"'`])bg-\[[^\]]+\]|background:\s*'/
  const PAGE_BG = /(?:^|[\s"'`])bg-\[var\(--(?:canvas|cream-2|page)\)\](?!\/)|background:\s*'var\(--(?:canvas|cream-2|page)\)'/
  let paleSeen = 0
  for (const f of walk('app', walk('components', []))) {
    const src = strip(readFileSync(f, 'utf8'))
    for (const m of src.matchAll(/<Badge\b[^>]*\btone="pale-neutral"/g)) {
      paleSeen++
      const tags = [...src.slice(0, m.index).matchAll(/<(\/?)([A-Za-z][\w.]*)/g)].map(t => {
        const end = tagEnd(src, t.index)
        return { close: t[1] === '/', self: end > 0 && src[end - 1] === '/', text: end > 0 ? src.slice(t.index, end + 1) : '' }
      })
      let depth = 0, found = 0
      for (let k = tags.length - 1; k >= 0 && found < 8; k--) {
        const t = tags[k]
        if (t.close) { depth++; continue }
        if (t.self) continue
        if (depth > 0) { depth--; continue }
        found++
        const own = t.text.replace(/(?:hover|focus|active|disabled|focus-visible|group-hover|sm|md|lg|dark):[^\s"'`]+/g, '')
        if (!ANY_BG.test(own)) continue
        if (PAGE_BG.test(own)) violations.push(`${f}:${lineOf(src, m.index)} pale-neutral 배지가 --canvas 면에 바로 선다. --neutral-bg 위 보조 잉크가 4.49:1 로 미달이라 tone="neutral"(solid, 4.52:1)을 쓴다(가이드 §11).`)
        break
      }
    }
  }
  if (paleSeen < 3) violations.push(`pale-neutral 배지 자리가 ${paleSeen}곳뿐이다. Badge 이름이나 tone 문법을 바꿨다면 ⓗ 를 옮긴다.`)
}

// ⓓ ViewTabs 비활성
{
  const f = 'components/ui/ViewTabs.tsx'
  const m = strip(readFileSync(f, 'utf8')).match(/const segInactive\s*=\s*'([^']*)'/)
  if (!m) violations.push(`${f} segInactive 를 찾지 못했다. 이름을 바꿨다면 이 그물(ⓓ)도 옮긴다.`)
  else if (!m[1].includes('text-[var(--warm-dark)]')) violations.push(`${f} segInactive 글자가 --warm-dark 가 아니다. 고른 칸이 --tc-text 라 고르지 않은 칸은 --warm-dark 로 색 위계를 세운다(가이드 §25).`)
}

if (violations.length) {
  console.error(`check-seg-ink-off: ${violations.length}건 위반`)
  for (const v of violations) console.error('  ' + v)
  process.exit(1)
}
console.log('check-seg-ink-off: OK (--seg-ink-off 라이트·다크·인쇄 AA, 보조 잉크 한 값·라이트 면 넷 AA·본문 위계·canvas 면 pale-neutral 금지, SegmentedControl·선택형 칩·세그먼트 삼항·토글 칩·ViewTabs 비활성 글자)')
