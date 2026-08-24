// 작업 일정 트랙의 호실 열·스침 가드 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가 (오류신고 16f691e1, 2026-08-24)
//   "사람을 누르면 해당 입주자로 이동되는데 가장 왼쪽 호실을 누르면 해당 호실로 이동되지는 않네."
//   호실 열이 `<div>` 라 onClick 도 role 도 tabIndex 도 없었다. 형제 셋(요약 줄 칩 · 호실 카드 ·
//   청소 뷰)은 전부 방 모달을 여는데 이 칸만 아무 일도 안 했다.
//
//   케이스가 아니라 **클래스**다. 이 트랙은 손대는 사람마다 sticky·z-index·배경을 조심하느라
//   태그를 그대로 두기 쉽고, 한 번 div 로 되돌아가면 화면상 표시가 한 픽셀도 안 바뀌어서
//   눈으로는 회귀를 못 잡는다. 그래서 태그와 접근명 자체를 위반으로 잡는다.
//
// 무엇을 보나 (축 다섯)
//   ① 호실 칸이 button 이고 onClick·aria-label 을 들고 있는가.
//   ② 접근명에 **호실번호가 들어 있는가.** aria-label 은 접근명을 더하는 게 아니라 대체하므로
//      번호를 빼면 음성 제어 사용자가 부를 이름이 사라진다(WCAG 2.5.3 Label in Name).
//   ③ 스페이서 두 칸(행 아래 줄·꼬리)은 여전히 비인터랙티브인가. 그 자리에는 방이 없다 —
//      버튼이 되면 누를 것 없는 칸이 탭 순서에 서고 hover 링이 켜진다.
//   ④ 호실 버튼과 .mc-bar 에 Tailwind outline 유틸이 붙지 않았는가. globals.css 의 규칙은 언레이어드라
//      utilities 를 이겨서, 둘을 섞으면 포커스 링이 **조용히** 사라진다(.mc-bar 전례).
//   ⑤ 트랙 스크롤러가 스침 가드를 들고 있는가. 가드가 빠지면 신고 두 번째 증상이 그대로 돌아온다.
//
// 실행: node scripts/check-calendar-room-open.mjs
import { readFileSync } from 'node:fs'

const SRC = 'components/room-manage/MoveCalendar.tsx'
const CSS = 'app/globals.css'
const violations = []

/** 주석을 걷는다 — 설명하려고 적은 낱말이 위반으로 잡히면 그물이 주석을 못 쓰게 만든다. */
const strip = s => s
  .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^[ \t]*\/\/.*$/gm, '')

const src = strip(readFileSync(SRC, 'utf8'))
const css = strip(readFileSync(CSS, 'utf8'))

/**
 * 여는 태그 하나를 통째로 잘라 낸다.
 *
 * `[^>]*` 로 못 자른다 — 이 파일의 속성값에는 화살표 함수가 들어 있어 `>` 가 속성 안에 산다
 * (`onClick={() => onOpenRoom(...)}`). 중괄호 깊이와 따옴표를 세면서 진짜 닫는 `>` 를 찾는다.
 * 이 그물을 세우며 실제로 이 실수를 한 번 했고, 그때 **위반이 아닌 것이 위반으로** 잡혔다.
 */
function tagAt(text, start) {
  let depth = 0, q = null
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (q) { if (c === q && text[i - 1] !== '\\') q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return text.slice(start, i + 1)
  }
  return null
}

/** `mc-room` 을 className 에 든 여는 태그를 전부. */
function roomCells(text) {
  const out = []
  const re = /<(\w+)\b/g
  let m
  while ((m = re.exec(text))) {
    const tag = tagAt(text, m.index)
    if (!tag) continue
    const attrs = tag.slice(m[0].length)
    if (!/className=(["'`])[^"'`]*\bmc-room\b/.test(attrs)) continue
    out.push({ tag: m[1], attrs })
  }
  return out
}

const cells = roomCells(src)
if (cells.length === 0) {
  violations.push(`${SRC} — mc-room 칸을 하나도 못 찾았다. 클래스명이 바뀌었으면 이 그물부터 고칠 것.`)
}

const buttons = cells.filter(c => c.tag === 'button')
const others = cells.filter(c => c.tag !== 'button')

// ── ① 호실 칸은 button 이고 열기 핸들러가 있다 ──
if (buttons.length !== 1) {
  violations.push(`${SRC} — mc-room 버튼이 ${buttons.length}개다(1개여야 한다). `
    + `호실 열이 다시 <div> 가 되면 트랙에서 방으로 들어가는 길이 사라진다(신고 16f691e1).`)
}
for (const b of buttons) {
  if (!/onClick=/.test(b.attrs)) {
    violations.push(`${SRC} — mc-room 버튼에 onClick 이 없다. 눌러도 아무 일도 안 한다.`)
  }
  if (!/type="button"/.test(b.attrs)) {
    violations.push(`${SRC} — mc-room 버튼에 type="button" 이 없다(폼 안에 들어가면 제출이 된다).`)
  }
  // ── ② 접근명에 호실번호 ──
  const label = b.attrs.match(/aria-label=\{`([^`]*)`\}/)
  if (!label) {
    violations.push(`${SRC} — mc-room 버튼에 템플릿 aria-label 이 없다. `
      + `보이는 글자가 번호뿐이라 무엇을 여는 버튼인지 소리로 안 들린다.`)
  } else if (!/\$\{fmtRoomNo\(/.test(label[1])) {
    violations.push(`${SRC} — mc-room 버튼의 aria-label 에 fmtRoomNo(호실번호)가 없다. `
      + `aria-label 은 접근명을 대체하므로 번호를 빼면 음성 제어로 부를 이름이 사라진다(WCAG 2.5.3).`)
  }
  // ── ④ 언레이어드 함정 ──
  if (/focus-visible:outline/.test(b.attrs)) {
    violations.push(`${SRC} — mc-room 버튼에 Tailwind outline 유틸이 붙었다. `
      + `globals.css 의 button.mc-room 규칙은 언레이어드라 utilities 를 이겨서 이 유틸을 통째로 지운다 `
      + `(.mc-bar 가 이미 겪은 함정). 링은 globals.css 한 곳에서만 세운다.`)
  }
}

// ── ④-2 같은 함정, .mc-bar ──
// 규칙을 만든 당사자가 그 규칙의 유일한 위반자였다. 축 ④ 가 호실 버튼만 봐서 못 잡았다
// (2026-08-24 디자이너 패스). 링을 globals.css 에서 세우는 자리는 전부 이 축을 지나야 한다.
{
  const barAt = src.indexOf('"mc-bar ')
  if (barAt < 0) {
    violations.push(`${SRC} — .mc-bar 엘리먼트를 못 찾았다. 검사가 건너뛰어졌으니 감지망을 고칠 것`)
  } else {
    const el = src.slice(barAt, src.indexOf('>', barAt) + 1)
    if (/focus-visible:outline/.test(el)) {
      violations.push(`${SRC} — .mc-bar 에 Tailwind outline 유틸이 붙었다. `
        + `globals.css 의 .mc-bar:focus-visible 는 언레이어드라 utilities 를 이겨 이 유틸을 통째로 지운다. `
        + `죽은 코드로 끝나지 않고, 엘리먼트가 말하는 색과 실제 렌더가 갈려 다음 사람이 색을 되돌리는 길이 된다.`)
    }
  }
}

// ── ③ 스페이서는 비인터랙티브 ──
for (const o of others) {
  if (/onClick=|tabIndex=|role="button"/.test(o.attrs)) {
    violations.push(`${SRC} — 스페이서 mc-room 칸(<${o.tag}>)이 인터랙티브가 됐다. `
      + `행 아래 줄·꼬리 자리에는 방이 없다 — 누를 것 없는 칸이 탭 순서에 서고 링이 켜진다.`)
  }
}

// ── ⑤ 스크롤러의 스침 가드 ──
const scrollerAt = src.indexOf('<div ref={scrollRef}')
const scroller = scrollerAt < 0 ? null : tagAt(src, scrollerAt)
if (!scroller) {
  violations.push(`${SRC} — 트랙 스크롤러(<div ref={scrollRef}>)를 못 찾았다. 이 그물부터 고칠 것.`)
} else {
  for (const [attr, why] of [
    ['onPointerDownCapture', '누른 자리를 기록하지 않으면 이동 축이 죽는다'],
    ['onClickCapture', '삼킬 자리가 없으면 스친 손짓이 그대로 계약을 연다'],
  ]) {
    // `=` 까지 요구한다 — 이름만 보면 `onClickCaptureXX=` 처럼 **비슷한 이름으로 바뀐** 자리가
    // 통과한다(이 그물의 역주입 4에서 실제로 통과했다).
    if (!new RegExp(`\\b${attr}=`).test(scroller)) {
      violations.push(`${SRC} — 트랙 스크롤러에 ${attr} 가 없다 — ${why}(신고 16f691e1).`)
    }
  }
}
if (!/suppressesTap\(/.test(src)) {
  violations.push(`${SRC} — suppressesTap 판정을 안 부른다. 가드가 lib/tapGuard 정본을 안 거치면 `
    + `회귀(scripts/test-tap-guard)가 화면과 다른 규칙을 지키게 된다.`)
}
// 시간 임계 금지(운영자 지시 2026-08-24 — 저속 탭 오탐).
if (scroller && /setTimeout|Date\.now\(\)/.test(scroller)) {
  violations.push(`${SRC} — 스침 가드에 시간 임계가 들어왔다. 천천히 누르는 손이 오탐으로 걸린다.`)
}

// ── globals.css 쪽 ──
if (!/button\.mc-room\s*\{/.test(css)) {
  violations.push(`${CSS} — button.mc-room base 규칙이 없다. hover·focus 링이 사라진다(§09).`)
}
if (!/button\.mc-room:focus-visible/.test(css)) {
  violations.push(`${CSS} — button.mc-room:focus-visible 이 없다. §09 는 전 컴포넌트 focus 링 필수다.`)
}
// 선택자를 .mc-room 으로 넓히면 스페이서까지 켜진다.
if (/(^|[^.\w])\.mc-room:hover/m.test(css)) {
  violations.push(`${CSS} — .mc-room:hover 로 넓혔다. 스페이서(행 아래 줄·꼬리)도 mc-room 이라 `
    + `못 누르는 칸이 켜진다. button.mc-room 으로 좁힐 것.`)
}
if (!/@media \(pointer: coarse\) \{ \.mc-row \{ --mc-work:/.test(css)) {
  violations.push(`${CSS} — 작업만 있는 행의 coarse 최소 높이 규칙이 없다. `
    + `거주 레인이 없는 행에서 호실 버튼이 20px 터치 타겟이 된다(§09 44px).`)
}

if (violations.length) {
  console.error(`\n[캘린더 호실 열·스침 가드] 위반 ${violations.length}건`)
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  process.exit(1)
}
console.log('[캘린더 호실 열·스침 가드] 위반 0건')
