// 수납 등록 폼이 이용료 귀속월을 조회 월로 못박지 않는지 지키는 소스 그물 — 읽기 전용, 위반 시 exit 1
//
// 신고 955f47b1(2026-10-01, 523호). 보증금 잔여가 있는 계약은 수납 폼이 분해 모드로 열리는데,
// 그 모드가 savePayment 에 forcedTargetMonth=targetMonth(모달 조회 월)를 넘겨 FIFO 를 껐다.
// 10월 1일에 9월 30일 입금을 넣자 10월분 선납이 되고 9월이 미수로 남았다. 귀속월 선택칸도
// `!splitMode` 조건으로 숨어 있어 고를 길도 볼 길도 없었다.
// 규칙: 이용료는 보증금 상태와 무관하게 고른 귀속월, 아니면 서버 FIFO. 조회 월 강제는 없다.
//   ⓐ 모든 savePayment( 호출의 forcedTargetMonth 는 forcedTm 파생이어야 한다(리터럴 targetMonth 금지)
//   ⓑ 귀속월 select 가 분해 모드에서 서야 한다(조상 조건 전부 + 조건 변수 선언까지 본다, 한 벌만)
//   ⓒ savePayment 호출이 0건이면 위반(그물이 대상을 놓쳤다)
//   ⓓ 분해 갈래의 보증금·청소비 저장은 자기 몫(dVal·cVal)만 넘긴다. 총액을 넘기면 서버가 넘친 몫을
//      조회 월 이용료로 직접 적는다(saveDepositPayment·saveCleaningFeePayment 초과분 경로).
//
// 실행: node scripts/check-rent-month-pin.mjs
import fs from 'node:fs'

const FILE = 'components/entity-modal/widgets/PaymentEntryForm.tsx'
const raw = fs.readFileSync(new URL(`../${FILE}`, import.meta.url), 'utf8')
// 주석은 지운다(줄 수는 유지). 주석 속 예시 문자열이 판정을 흔들면 안 된다.
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1')

/** 괄호 깊이로 호출 인자 블록을 잘라 낸다(거리 근사 금지). */
function callBlocks(text, fnName) {
  const out = []
  const re = new RegExp(`\\b${fnName}\\(`, 'g')
  let m
  while ((m = re.exec(text))) {
    let d = 0, j = m.index + fnName.length
    for (; j < text.length; j++) {
      if (text[j] === '(') d++
      else if (text[j] === ')') { d--; if (d === 0) { j++; break } }
    }
    out.push(text.slice(m.index, j))
    re.lastIndex = j
  }
  return out
}

const fails = []

// ⓐ·ⓒ — 호출 블록의 공백·줄바꿈을 접은 뒤 판정한다. 줄을 나눈 삼항(`forcedTm === 'auto'\n ? targetMonth : forcedTm`)도
//        같은 모양으로 읽혀야 한다. forcedTargetMonth 식 안 어디에든 targetMonth 가 끼면 위반이다.
const calls = callBlocks(src, 'savePayment').map(c => c.replace(/\s+/g, ' '))
if (calls.length === 0) fails.push('ⓒ savePayment( 호출을 하나도 못 찾았다 — 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지)')
calls.forEach((c, i) => {
  const fm = c.match(/forcedTargetMonth\s*:\s*([^,}]+)/)
  if (!fm) { fails.push(`ⓐ savePayment 호출 #${i + 1} 이 forcedTargetMonth 를 안 넘긴다 — 사람이 고른 귀속월이 무시된다`); return }
  const expr = fm[1].trim()
  if (/\btargetMonth\b/.test(expr)) {
    fails.push(`ⓐ savePayment 호출 #${i + 1} 의 forcedTargetMonth 식에 조회 월(targetMonth)이 낀다: ${expr} — FIFO 가 꺼져 밀린 달을 건너뛴다`)
  } else if (!/\bforcedTm\b/.test(expr)) {
    fails.push(`ⓐ savePayment 호출 #${i + 1} 의 forcedTargetMonth 가 forcedTm 파생이 아니다: ${expr}`)
  }
})

// ⓑ 귀속월 select 가 분해 모드에서 실제로 서는가.
//    가장 가까운 한 줄만 보면 바깥 조건(fragment·컨테이너 경계까지)이나 변수로 뺀 조건을 놓친다.
//    그래서 select(또는 select 를 담은 조각 변수)의 **모든 사용처**마다 들여쓰기로 조상 줄을 거슬러
//    올라가 조건 줄을 전부 모으고, 조건 안 식별자의 const 선언까지 펼쳐 splitMode 부정이 있는지 본다.
//    분해 모드에서 부정 없이 닿는 사용처가 하나라도 있어야 통과다.
const lines = src.split('\n')
const declOf = name => (src.match(new RegExp(`const ${name}\\s*=\\s*([^\\n]+)`)) ?? [])[1] ?? null
const negatesSplit = cond => {
  if (/!\s*\(?\s*splitMode\b/.test(cond)) return true
  for (const id of new Set(cond.match(/\b[A-Za-z_]\w*\b/g) ?? [])) {
    if (id === 'splitMode') continue
    const d = declOf(id)
    if (d && /!\s*\(?\s*splitMode\b/.test(d)) return true
  }
  return false
}
// 조상 조건 — 들여쓰기가 아니라 괄호 짝으로 거슬러 오른다(서식이 흐트러져도 같은 답).
// 사용처에서 뒤로 걸으며 짝이 없는 여는 괄호({ 또는 ()를 만날 때마다 그 앞 같은 줄의 글을 본다.
// 그 글이 && 나 ? 로 끝나면 조건 줄이다. return ( 또는 const X = ( 에 닿으면 멈춘다.
const posOfLine = i => lines.slice(0, i).reduce((n, l) => n + l.length + 1, 0)
const ancestorsOf = lineIdx => {
  const conds = []
  let depth = 0
  for (let k = posOfLine(lineIdx) - 1; k >= 0; k--) {
    const ch = src[k]
    if (ch === ')' || ch === '}') depth++
    else if (ch === '(' || ch === '{') {
      if (depth > 0) { depth--; continue }
      const lineStart = src.lastIndexOf('\n', k - 1) + 1
      const head = src.slice(lineStart, k + 1)
      if (/^\s*return \($/.test(head) || /^\s*const \w+ = \($/.test(head) || /=>\s*\{$/.test(head)) break
      const before = src.slice(Math.max(0, k - 400), k)
      if (/(&&|\?)\s*$/.test(before)) {
        // 조건 식 — 그 줄 머리부터 여는 괄호까지(줄을 넘긴 조건은 앞줄까지 붙인다)
        const condStart = src.lastIndexOf('{', k - 1)
        conds.push(src.slice(Math.max(lineStart - 200, condStart), k + 1).replace(/\s+/g, ' ').trim())
      }
    }
  }
  return conds
}
const selLines = lines.map((l, i) => (l.includes('<select value={forcedTm}') ? i : -1)).filter(i => i >= 0)
if (selLines.length === 0) {
  fails.push('ⓑ 귀속월 select(<select value={forcedTm}) 를 못 찾았다 — 모양이 바뀌었으면 이 그물부터 고친다')
} else if (selLines.length > 1) {
  fails.push(`ⓑ 귀속월 select 가 ${selLines.length}벌이다 — 한 조각을 두 자리에서 재사용해야 둘이 안 갈린다`)
} else {
  // select 를 담은 조각 변수(const X = ( … ))가 있으면 그 변수의 사용처를 본다.
  let host = null
  for (let i = selLines[0] - 1; i >= 0; i--) {
    const m = lines[i].match(/^\s*const (\w+) = \(\s*$/)
    if (m) { host = { name: m[1], line: i }; break }
    if (/^\s*return \(/.test(lines[i])) break
  }
  const usages = host
    ? lines.map((l, i) => (new RegExp(`\\{${host.name}\\}`).test(l) ? i : -1)).filter(i => i >= 0)
    : selLines
  if (host && usages.length === 0) fails.push(`ⓑ 귀속월 조각(${host.name})을 렌더하는 자리가 없다`)
  const chains = usages.map(i => ({ i, conds: [...ancestorsOf(i), ...(host ? ancestorsOf(selLines[0]) : [])] }))
  const reachable = chains.filter(c => !c.conds.some(negatesSplit))
  if (usages.length > 0 && reachable.length === 0) {
    fails.push(`ⓑ 귀속월 select 가 분해 모드에서 숨는다 — 모든 사용처가 splitMode 부정 조건 아래다: ${chains.map(c => `${c.i + 1}행 [${c.conds.join(' / ')}]`).join(' ; ')}`)
  }
}

// ⓓ 분해 갈래의 몫별 저장
const sAt = src.indexOf('if (splitMode) {')
const eAt = src.indexOf('} else if (isCleaningFeeMode)', sAt)
if (sAt < 0 || eAt < 0) {
  fails.push('ⓓ 분해 저장 갈래(if (splitMode) { … } else if (isCleaningFeeMode))를 못 찾았다')
} else {
  const region = src.slice(sAt, eAt)
  const dep = callBlocks(region, 'saveDepositPayment')
  const cln = callBlocks(region, 'saveCleaningFeePayment')
  const rent = callBlocks(region, 'savePayment')
  if (rent.length === 0) fails.push('ⓓ 분해 갈래가 이용료 몫을 savePayment 로 보내지 않는다 — 이용료가 보증금 저장부의 초과분 경로로 조회 월에 박힌다')
  for (const c of dep) if (!/totalPaid\s*:\s*dVal\b/.test(c)) fails.push(`ⓓ 분해 갈래의 saveDepositPayment 가 보증금 몫(dVal)이 아닌 값을 넘긴다: ${(c.match(/totalPaid\s*:\s*([^,\n]+)/) ?? [, '?'])[1].trim()}`)
  for (const c of cln) if (!/totalPaid\s*:\s*cVal\b/.test(c)) fails.push(`ⓓ 분해 갈래의 saveCleaningFeePayment 가 청소비 몫(cVal)이 아닌 값을 넘긴다: ${(c.match(/totalPaid\s*:\s*([^,\n]+)/) ?? [, '?'])[1].trim()}`)
  if (dep.length === 0) fails.push('ⓓ 분해 갈래에서 saveDepositPayment 호출을 못 찾았다')
}

if (fails.length) {
  console.log(`[이용료 귀속월 못박기] 위반 ${fails.length}건 (${FILE})`)
  for (const f of fails) console.log('  - ' + f)
  process.exit(1)
}
console.log(`[이용료 귀속월 못박기] 위반 0건 (savePayment ${calls.length}곳 forcedTm 파생 · 분해 모드 귀속월 노출 · 몫별 저장)`)
