// 날짜 칸이 '맨글자'로 태어나는 것을 막는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가
//   정본 `components/ui/DatePicker` 의 트리거 기본 클래스는 `w-full text-left truncate` 뿐이다.
//   배경도 보더도 글자 크기도 없다. 그래서 호출부가 입력칸 껍데기를 안 넘기면 날짜가 **테두리 없는
//   맨글자**로 그려지고, 형제 입력칸들 사이에서 혼자 눌러야 할 것처럼 안 보인다.
//   운영자 신고 c2ab5b83 원문 — "날짜 변경을 입력된 날짜를 터치하면 되기는 한데 다른 것과는
//   다르게 버튼이 없어서 사용성이 직관적이지 않아".
//
//   2026-08-24 전수에서 호출부 71곳 중 9곳이 그 상태였다(청소 3 · 재고 5 · 수납 1). 케이스가
//   아니라 클래스다 — 9곳을 손으로 고쳐도 72번째 호출부가 또 맨글자로 태어난다. 그래서 껍데기를
//   안 넘기는 호출부 자체를 위반으로 잡는다.
//
//   정본을 고쳐 기본 껍데기를 주는 안은 택하지 않았다. 소비처 71곳의 폭·높이가 자리마다 다르고
//   (dense 26px ~ 모달 42px), 한 벌을 강제하면 §12 '한 폼 안 입력 높이 혼용 금지' 를 이쪽에서
//   깬다. 각 자리가 **자기 폼 형제와 같은 껍데기**를 넘기는 것이 정본이고, 이 그물은 그 약속만 본다.
//
// 무엇을 보나
//   className 과 style 을 합쳐 배경과 보더가 둘 다 있는지. 상수·객체로 뺀 자리는 같은 파일에서
//   그 선언을 찾아 이어 붙여 본다 — 이름만 보고 통과시키면 상수가 빈 문자열이 돼도 초록불이 뜨는
//   반쪽 그물이 된다(verify-money-consistency 주석의 그 전례).
//
// 예외 하나 — 인라인 텍스트 편집
//   껍데기 없이 정당한 자리는 '값을 그 자리에서 고치는 링크형' 하나다(입주자 상세의 연락 알림일).
//   거기서는 밑줄과 강조색이 어포던스를 대신한다. 그래서 배경·보더 대신 `underline` 을 인정한다.
//   밑줄도 배경도 보더도 없으면 그것은 어떤 문법도 아닌 맨글자다.
//
// 실행: node scripts/check-datepicker-shell.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOTS = ['app', 'components', 'lib']
const violations = []

/**
 * 삼항의 가지를 갈라 낸다. 합쳐서 보면 **한쪽만 껍데기가 있어도 통과**하는 반쪽 그물이 된다 —
 * `dense ? inputCls : dateFieldCls` 에서 dateFieldCls 를 빈 문자열로 만들어도 inputCls 의
 * bg·border 가 검사를 통과시켰다(이 그물을 세우며 역주입으로 실제로 겪었다). 가지마다 따로 본다.
 */
function branches(expr) {
  let depth = 0, q = null, qi = -1, ci = -1
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i]
    if (q) { if (c === q && expr[i - 1] !== '\\') q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if ('([{'.includes(c)) depth++
    else if (')]}'.includes(c)) depth--
    else if (depth === 0 && c === '?' && qi < 0 && expr[i + 1] !== '.' && expr[i + 1] !== '?') qi = i
    else if (depth === 0 && c === ':' && qi >= 0 && ci < 0) ci = i
  }
  if (qi < 0 || ci < 0) return [expr]
  return [...branches(expr.slice(qi + 1, ci)), ...branches(expr.slice(ci + 1))]
}

function walk(dir, out = []) {
  let entries
  try { entries = readdirSync(dir) } catch { return out }
  for (const e of entries) {
    if (e === 'node_modules' || e.startsWith('.')) continue
    const p = join(dir, e)
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx$/.test(p)) out.push(p)
  }
  return out
}

/** `<DatePicker ... />` 한 벌을 통째로 떼어 온다. 중괄호 깊이를 세어 JSX 표현식 안의 '>' 에 안 속는다. */
function elementAt(src, start) {
  let depth = 0
  for (let i = start; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') depth--
    else if (c === '>' && depth === 0) return src.slice(start, i + 1)
  }
  return null
}

/**
 * `prop=` 뒤의 값을 **중괄호 균형**을 세어 떼어 온다.
 *
 * 정규식 비탐욕 매칭으로는 안 된다. `` className={dense ? `${inputCls} …` : other} `` 에서
 * 첫 `}` 는 템플릿 보간의 닫는 괄호라, 거기서 끊으면 값의 절반만 읽고 검사가 통과한다
 * (이 그물을 세우며 역주입으로 실제로 겪었다).
 */
function propValue(el, prop) {
  const at = el.indexOf(`${prop}=`)
  if (at < 0) return null
  let i = at + prop.length + 1
  if (el[i] === '"' || el[i] === "'") {
    const end = el.indexOf(el[i], i + 1)
    return end < 0 ? null : el.slice(i + 1, end)
  }
  if (el[i] !== '{') return null
  let depth = 0, q = null
  for (let j = i; j < el.length; j++) {
    const c = el[j]
    if (q) { if (c === q && el[j - 1] !== '\\') q = null; continue }
    if (c === '"' || c === "'" || c === '`') { q = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) return el.slice(i + 1, j) }
  }
  return null
}

/**
 * 상수 이름이 나오면 같은 파일에서 그 선언 **전체**를 찾아 이어 붙인다.
 *
 * 줄 단위로 잘라선 안 된다. 이 저장소의 껍데기 상수는 삼항(`dense ? '…' : '…'`)이나 여러 줄
 * 객체가 흔해서, 첫 줄만 집으면 `dense` 만 읽고 껍데기를 못 본 채 위반으로 신고한다(실제로 겪었다).
 * 선언 들여쓰기보다 깊거나 이어짐 기호로 시작하는 줄까지를 한 선언으로 본다.
 */
function resolve(expr, src) {
  const lines = src.split('\n')
  let out = expr
  for (const name of new Set(expr.match(/\b[A-Za-z_$][\w$]*\b/g) ?? [])) {
    const head = new RegExp(`^(\\s*)(?:const|let)\\s+${name}\\b[^=]*=`)
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(head)
      if (!m) continue
      const indent = m[1].length
      out += ' ' + lines[i]
      for (let j = i + 1; j < lines.length && j < i + 40; j++) {
        const l = lines[j]
        if (l.trim() === '') break
        const ind = l.length - l.trimStart().length
        // 더 깊게 들여쓴 줄, 또는 같은 깊이여도 이어짐 기호로 시작하는 줄은 같은 선언이다.
        if (ind > indent || /^[?:+`'")\].]/.test(l.trim())) out += ' ' + l
        else break
      }
      break
    }
  }
  return out
}

const files = ROOTS.flatMap(r => walk(r))
let checked = 0
for (const file of files) {
  const src = readFileSync(file, 'utf8')
  if (!src.includes('<DatePicker')) continue
  for (const m of src.matchAll(/<DatePicker\b/g)) {
    const el = elementAt(src, m.index)
    if (el === null) {
      violations.push(`${file} 의 <DatePicker 를 끝까지 못 읽었다 — 검사가 건너뛰어졌다. 감지망을 고칠 것`)
      continue
    }
    checked++
    const line = src.slice(0, m.index).split('\n').length
    const cls = propValue(el, 'className')
    const sty = propValue(el, 'style')
    if (cls === null && sty === null) {
      violations.push(`${file}:${line} DatePicker 에 껍데기가 전혀 없다 — 배경·보더 없는 맨글자로 그려진다(신고 c2ab5b83)`)
      continue
    }
    const styleSrc = sty === null ? '' : resolve(sty, src)
    for (const branch of branches(cls ?? '')) {
      const resolved = resolve(branch, src) + ' ' + styleSrc
      const hasBg = /\bbg-/.test(resolved) || /background\s*:/.test(resolved)
      const hasBorder = /\bborder(?:-|\b)/.test(resolved)
      const hasUnderline = /\bunderline\b|text-decoration/.test(resolved)   // 인라인 편집형 예외
      if (hasUnderline || (hasBg && hasBorder)) continue
      const missing = [!hasBg && '배경(bg-)', !hasBorder && '보더(border)'].filter(Boolean).join('·')
      const which = branch.trim() ? ` (가지: ${branch.trim().slice(0, 40)})` : ''
      violations.push(`${file}:${line} DatePicker 껍데기에 ${missing} 이 없다${which} — 형제 입력칸과 달리 눌러야 할 칸으로 안 보인다(신고 c2ab5b83)`)
    }
  }
}

console.log(`[날짜 칸 껍데기] 호출부 ${checked}곳 검사 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) {
  console.log('\n  각 자리는 **자기 폼 형제 입력칸과 같은** 껍데기를 넘긴다(§12 한 폼 안 입력 높이 혼용 금지).')
  console.log('  정본 예시: components/cleaning/CheckoutCleaningDateField.tsx 의 FIELD_CLS')
  process.exit(1)
}
