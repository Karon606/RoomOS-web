// 퇴실의 부수 처리가 경로마다 갈리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 퇴실이 건드리는 축은 다섯이다. 상태·공실·예약가 적용·청소 예정·거주 구간 마감.
// 그런데 퇴실 경로가 셋으로 갈리면서(홈 알림·프리즘 위젯·입주자 관리 수정) **어느 경로도
// 다섯을 다 하지 않았다.** 홈과 프리즘은 이용료 환불을 못 했고, 수정 폼은 청소 예정과 예약가
// 적용을 빠뜨렸다. 8/4 이후 퇴실 9건 중 3건에 퇴실 청소가 아예 없었던 것이 그 자국이다
// (2026-08-30 실측, knowledge/open-checkout-paths-split.md).
//
// 그래서 부수 처리를 applyCheckoutSideEffects 한 자리로 모았다. 이 그물은 그것이 흩어지는 것을
// 막는다. 축은 셋이다.
//
//   ⓐ 부수 처리 정본이 존재하고 다섯 축 중 넷(공실·예약가·청소·구간)을 다 한다.
//   ⓑ 퇴실 상태를 쓰는 서버 경로가 그 정본을 부른다 — 새 경로가 생겨도 빠뜨릴 수 없게.
//   ⓒ 정본 밖에서 ensureCheckoutCleaning 을 직접 부르지 않는다. 두 벌이 되면 언젠가 갈린다.
//
// 실행: node scripts/check-checkout-side-effects.mjs
import { readFileSync } from 'node:fs'

const FILE = 'app/(app)/tenants/actions.ts'
const src = readFileSync(FILE, 'utf8')
const violations = []

// ⓐ 정본이 다섯 축 중 넷을 하는가.
const fn = src.match(/async function applyCheckoutSideEffects[\s\S]*?\n\}\n/)
if (!fn) {
  violations.push(`${FILE} — applyCheckoutSideEffects 를 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
} else {
  const body = fn[0]
  for (const [needle, what] of [
    ['isVacant: true', '공실 표시'],
    ['scheduledRent', '예약가 적용'],
    ['ensureCheckoutCleaning(', '청소 예정'],
    ['closeStay(', '거주 구간 마감'],
  ]) {
    if (!body.includes(needle)) violations.push(`${FILE} — 부수 처리 정본이 '${what}' 을 안 한다.`)
  }
}

// ⓑ 퇴실 상태를 쓰는 경로가 정본을 부르는가.
//    'CHECKED_OUT' 을 status 로 쓰는 서버 함수는 전부 대상이다.
const callers = [
  ['checkoutTenant', /export async function checkoutTenant[\s\S]*?\n\}\n/],
  ['updateTenant', /export async function updateTenant[\s\S]*?\n\}\n\n/],
]
for (const [name, re] of callers) {
  const m = src.match(re)
  if (!m) { violations.push(`${FILE} — ${name} 을 못 찾았다.`); continue }
  const writesCheckout = /status:\s*'CHECKED_OUT'|=== 'CHECKED_OUT'/.test(m[0])
  if (writesCheckout && !/applyCheckoutSideEffects\(/.test(m[0])) {
    violations.push(`${FILE} — ${name} 이 퇴실 상태를 쓰면서 부수 처리 정본을 안 부른다. 청소 예정·공실이 빠진다.`)
  }
}

// ⓒ 정본 밖에서 청소를 직접 만들지 않는가.
{
  const lines = src.split('\n')
  const fnStart = src.indexOf('async function applyCheckoutSideEffects')
  const fnEnd = fnStart >= 0 ? src.indexOf('\n}\n', fnStart) : -1
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line)) return
    // 선언 자체는 대상이 아니다 — 'async function ensureCheckoutCleaning(' 은 호출이 아니라 정의다.
    if (!/ensureCheckoutCleaning\(/.test(line) || /function\s+ensureCheckoutCleaning\(/.test(line)) return
    const at = lines.slice(0, i).join('\n').length
    const insideDef = at > src.indexOf('async function ensureCheckoutCleaning') && at < src.indexOf('async function ensureCheckoutCleaning') + 2000
    const insideCanon = fnStart >= 0 && at > fnStart && at < fnEnd
    if (!insideCanon && !insideDef) {
      violations.push(`${FILE}:${i + 1} — 정본 밖에서 청소를 직접 만든다. applyCheckoutSideEffects 를 쓴다.`)
    }
  })
}

console.log(`[퇴실 부수 처리] 축 ⓐ 정본 4축 · ⓑ 경로가 정본 호출 · ⓒ 정본 밖 직접 생성 금지 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  퇴실이 건드리는 축은 다섯이다(상태·공실·예약가·청소·구간). 상태는 경로가 쓰고')
  console.error('  나머지 넷은 applyCheckoutSideEffects 한 자리를 지난다.')
  process.exit(1)
}
