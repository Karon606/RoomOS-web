// 홈 화면의 미납 독촉 문자 진입점이 정본 대상 판정을 거치는지 지키는 소스 그물 — 읽기 전용, 위반 시 exit 1
//
// 신고 8737b4d5(2026-10-01). 홈 미납 알림 상세에 '독촉 문자 보내기'를 세우면서, 같은 파일의 미수납 위젯
// '안내문자'가 판정 없이 유예 중·납부일 전 행에도 서 있던 것을 함께 봉합했다(2026-08-02 405호 사건,
// 유예해 준 사람에게 독촉 문구). 판정 정본은 lib/unpaidSmsTarget 의 isUnpaidSmsTarget 하나다.
//   ⓐ DashboardClient 의 모든 <UnpaidSmsModal 은 상태 변수를 target 으로 받는다. 그 상태의 setter 를
//      null 아닌 값으로 부르는 모든 자리는 조상(괄호 짝으로 거슬러 오름) 또는 같은 줄에
//      isUnpaidSmsTarget( 이나 getTenantUnpaidTarget( 를 거쳐야 한다
//   ⓑ 알림 상세의 '독촉 문자 보내기' 는 조상 조건에 alert.category === 'unpaid' 가 있어야 한다
//   ⓒ 서버 getTenantUnpaidTarget 은 isUnpaidSmsTarget 으로 판정한다(사본 규칙 금지)
//   ⓓ 대상을 하나도 못 찾으면 위반(그물이 모양 변화로 대상을 놓쳤다, 침묵 통과 금지)
//
// 실행: node scripts/check-unpaid-sms-gate.mjs
import fs from 'node:fs'

const read = f => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8')
// 주석은 지운다(줄 수는 유지). 주석 속 예시 문자열이 판정을 흔들면 안 된다.
const strip = raw => raw
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
  .replace(/([^:'"`])\/\/[^\n'"`]*$/gm, '$1')

const DASH = 'app/(app)/dashboard/DashboardClient.tsx'
const ACTIONS = 'app/(app)/dashboard/actions.ts'
const src = strip(read(DASH))
const fails = []

const lineStart = pos => src.lastIndexOf('\n', pos - 1) + 1
const lineAt = pos => { const s = lineStart(pos); const e = src.indexOf('\n', pos); return src.slice(s, e < 0 ? src.length : e) }

/** 줄이 `.then(` 처럼 점으로 시작하는 체인 줄이면, 체인 머리 줄까지 거슬러 올라 함께 돌려준다. */
function withChainHead(pos) {
  const out = [lineAt(pos)]
  let s = lineStart(pos)
  while (/^\s*\./.test(lineAt(s)) && s > 0) {
    s = lineStart(s - 1)
    out.push(lineAt(s))
  }
  return out
}

/** pos 에서 뒤로 걸으며 짝 없는 여는 괄호({ ( [)마다 그 줄을 모은다. 같은 줄도 포함.
 *  체인 줄(`.then(t => setX(t))`)이면 체인 머리(`getTenantUnpaidTarget(...)`)까지 함께 본다. */
function ancestorLines(pos) {
  const out = withChainHead(pos)
  let depth = 0
  for (let i = pos - 1; i >= 0; i--) {
    const c = src[i]
    if (c === ')' || c === '}' || c === ']') depth++
    else if (c === '(' || c === '{' || c === '[') {
      if (depth > 0) depth--
      else out.push(...withChainHead(i))
    }
  }
  return out
}

// ⓐ
const modalRe = /<UnpaidSmsModal\b[^>]*?\btarget=\{([^}]*)\}/g
const targets = new Set()
let m, modalCount = 0
while ((m = modalRe.exec(src))) {
  modalCount++
  const expr = m[1].trim()
  if (!/^[A-Za-z_]\w*$/.test(expr)) {
    fails.push(`ⓐ ${DASH}:${src.slice(0, m.index).split('\n').length} <UnpaidSmsModal target 이 상태 변수가 아니다(${expr}) — 판정을 거쳤는지 추적할 수 없다`)
    continue
  }
  targets.add(expr)
}
if (modalCount === 0) fails.push(`ⓓ ${DASH} 에서 <UnpaidSmsModal 을 하나도 못 찾았다 — 모양이 바뀌었으면 이 그물부터 고친다`)

const GATE = /\bisUnpaidSmsTarget\(|\bgetTenantUnpaidTarget\(/
for (const t of targets) {
  const setter = `set${t[0].toUpperCase()}${t.slice(1)}`
  const re = new RegExp(`\\b${setter}\\b(\\s*\\()?`, 'g')
  let s, sites = 0
  while ((s = re.exec(src))) {
    const before = src.slice(Math.max(0, s.index - 30), s.index)
    if (/const\s*\[[^\]]*$/.test(before)) continue                  // useState 선언
    if (s[1]) {
      const arg = src.slice(s.index + s[0].length).trimStart()
      if (/^(null|undefined)\s*\)/.test(arg)) continue              // 닫기
    }
    sites++
    if (!ancestorLines(s.index).some(l => GATE.test(l))) {
      const ln = src.slice(0, s.index).split('\n').length
      fails.push(`ⓐ ${DASH}:${ln} ${setter} 가 정본 판정(isUnpaidSmsTarget / getTenantUnpaidTarget)을 거치지 않고 문자 대상을 세운다 — 유예 중·납부일 전 사람에게 독촉 문구가 나갈 수 있다`)
    }
  }
  if (sites === 0) fails.push(`ⓓ ${setter} 로 대상을 세우는 자리를 못 찾았다 — 모양이 바뀌었으면 이 그물부터 고친다`)
}

// ⓑ
const btnIdx = []
for (let i = src.indexOf('독촉 문자 보내기'); i >= 0; i = src.indexOf('독촉 문자 보내기', i + 1)) btnIdx.push(i)
if (btnIdx.length === 0) fails.push('ⓓ 알림 상세의 \'독촉 문자 보내기\' 버튼을 못 찾았다')
for (const i of btnIdx) {
  if (!ancestorLines(i).some(l => /alert\.category\s*===\s*'unpaid'/.test(l))) {
    const ln = src.slice(0, i).split('\n').length
    fails.push(`ⓑ ${DASH}:${ln} '독촉 문자 보내기' 가 alert.category === 'unpaid' 조건 밖에 있다 — 미납이 아닌 알림에도 선다`)
  }
}

// ⓒ
const act = strip(read(ACTIONS))
const fnAt = act.indexOf('export async function getTenantUnpaidTarget(')
if (fnAt < 0) fails.push(`ⓓ ${ACTIONS} 에서 getTenantUnpaidTarget 을 못 찾았다`)
else {
  const next = act.indexOf('\nexport ', fnAt + 10)
  const body = act.slice(fnAt, next < 0 ? act.length : next)
  if (!/\bisUnpaidSmsTarget\(/.test(body)) fails.push(`ⓒ ${ACTIONS} getTenantUnpaidTarget 이 정본 isUnpaidSmsTarget 으로 판정하지 않는다 — 위젯과 판정이 갈린다`)
}

if (fails.length) {
  console.error(`check-unpaid-sms-gate: 위반 ${fails.length}건`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`check-unpaid-sms-gate: OK (UnpaidSmsModal ${modalCount}곳 · 대상 상태 ${targets.size}개 · 알림 독촉 버튼 ${btnIdx.length}곳)`)
