// 홈·수납 관리의 그 달 모집단이 '오늘의 status' 로 되돌아가지 않는지 지키는 소스 그물 — 읽기 전용, 위반 시 exit 1
//
// 신고 70addd65(2026-10-01, 513호). 9/30 퇴실·10/1 처리된 계약이 9월 홈·수납 관리에서 사라졌다.
// 재무 모집단 조회가 status in ['ACTIVE','CHECKOUT_PENDING','NON_RESIDENT'] 같은 '지금' 목록으로 사람을
// 골라, 그 달에 살다 나간 사람이 과거 달 화면에서 통째로 빠졌다. 처방은 그 달 거주 정본(residedInMonth)과
// 퇴실 계약 앞단 거름망(checkedOutInMonthWhere)이다.
//
// 규칙(대상: 홈 getDashboardData 전체, 수납 관리 getRoomPaymentStatus 본문)
//   ⓐ 진행 중 계약 status 목록(ACTIVE 와 NON_RESIDENT 를 함께 든 리터럴, 또는 BILLABLE_STATUSES)은
//      같은 OR 배열(위아래 3줄) 안에 checkedOutInMonthWhere( 가 짝으로 서거나, 바로 위 6줄 안에 '모집단 예외:' 표지가 있어야 한다.
//      표지는 '지금' 축(입주자 탭·입주 가능)이나 '이 달 청구 항'(퇴실 귀속 항이 따로 받는 몫)처럼 사유를 적는다.
//   ⓑ 두 파일 모두 residedInMonth( 와 checkedOutInMonthWhere( 를 실제로 부른다(그물이 대상을 놓쳤으면 위반).
//
// 실행: node scripts/check-month-population-axis.mjs
import fs from 'node:fs'

const TARGETS = [
  { file: 'app/(app)/dashboard/getDashboardData.ts', fn: null, minResided: 3, minWhere: 2 },
  { file: 'app/(app)/rooms/actions.ts', fn: 'getRoomPaymentStatus', minResided: 1, minWhere: 1 },
]

/** 함수 본문만 잘라 낸다 — 같은 파일의 다른 액션(퇴실 처리 등)은 이 그물의 대상이 아니다. */
function functionBody(text, name) {
  const start = text.indexOf(`export async function ${name}(`)
  if (start < 0) return null
  const open = text.indexOf('{', text.indexOf(')', start))
  let d = 0
  for (let j = open; j < text.length; j++) {
    if (text[j] === '{') d++
    else if (text[j] === '}') { d--; if (d === 0) return { body: text.slice(start, j + 1), offset: start } }
  }
  return null
}

const fails = []
for (const t of TARGETS) {
  const raw = fs.readFileSync(new URL(`../${t.file}`, import.meta.url), 'utf8')
  let scope = raw
  let lineBase = 0
  if (t.fn) {
    const fb = functionBody(raw, t.fn)
    if (!fb) { fails.push(`${t.file}: ${t.fn} 본문을 못 찾았다 — 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지)`); continue }
    scope = fb.body
    lineBase = raw.slice(0, fb.offset).split('\n').length - 1
  }
  const lines = scope.split('\n')
  const code = l => l.replace(/\/\/.*$/, '')
  lines.forEach((line, i) => {
    const c = code(line)
    const literal = c.match(/status:\s*\{\s*in:\s*\[([^\]]*)\]/)
    const liveList = (literal && /'ACTIVE'/.test(literal[1]) && /'NON_RESIDENT'/.test(literal[1]))
      || /status:\s*\{\s*in:\s*BILLABLE_STATUSES\s*\}/.test(c)
    if (!liveList) return
    // 짝은 같은 OR 배열 안 — 한 줄로 쓰든 줄을 나누든 위아래 3줄 안에 선다.
    if (/checkedOutInMonthWhere\(/.test(lines.slice(Math.max(0, i - 3), i + 4).map(code).join('\n'))) return
    const above = lines.slice(Math.max(0, i - 6), i + 1).join('\n')
    if (/모집단 예외:/.test(above)) return
    fails.push(`ⓐ ${t.file}:${lineBase + i + 1} 진행 중 status 목록으로 사람을 고른다 — 그 달에 살다 나간 퇴실 계약이 빠진다.\n     ${line.trim()}\n     checkedOutInMonthWhere 와 짝을 짓거나(그 달 모집단), '지금' 축이면 '모집단 예외:' 표지로 사유를 적는다.`)
  })
  const resided = (code(scope).match(/residedInMonth\(/g) ?? []).length
  const where = (scope.match(/checkedOutInMonthWhere\(/g) ?? []).length
  if (resided < t.minResided) fails.push(`ⓑ ${t.file}: residedInMonth( 호출이 ${resided}건(기대 ${t.minResided}건 이상) — 그 달 거주 정본을 거치지 않는 모집단이 생겼다`)
  if (where < t.minWhere) fails.push(`ⓑ ${t.file}: checkedOutInMonthWhere( 가 ${where}건(기대 ${t.minWhere}건 이상) — 퇴실 계약이 그 달 모집단에서 빠졌다`)
}

if (fails.length > 0) {
  console.error('check-month-population-axis: 위반')
  for (const f of fails) console.error('  ' + f)
  process.exit(1)
}
console.log('check-month-population-axis: ok')
