// 예약 확정 문이 월 이용료를 다시 묻지 않는지 감지 — 실행: node scripts/check-reservation-confirm-gate.mjs
//
// 운영자 결정(2026-10-10): 예약 단계 어디에서도 월 이용료를 요구하지 않는다. 확정 조건은 입주 희망일과
// 본인 연락처뿐이다. 이용료는 입실 처리 때 정해지고, 0 이용료 예약금 수납·재앵커가 그것을 견딘다.
//
// 확정 문은 네 자리에 따로 서 있다 — 확인창(상태 전환 버튼), 등록 저장(leaseSaveDenial), 수정 저장
// (updateTenant), 상태 전환 서버(applyStatusTransition). 종전에도 넷이 같은 조건을 각자 적어 두었고,
// 하나만 남아도 운영자에게는 "확정이 안 된다"로 똑같이 보인다. 그래서 넷 다 본다.
//
// 보는 것은 각 자리의 **확정 가지 몸통**이다. 함수 전체를 보면 청구 상태 백스톱
// (rentAmount > 0 && !moveInDate — 입주일 필수)까지 걸려 오탐이 난다. 가지를 못 찾으면 위반이다
// (조용히 통과하면 그물이 아니라 장식이다).
//
// 그물은 주석을 안 본다 — 설명 글자가 걸리거나 통과시키지 않게 주석을 먼저 걷는다.
import { readFileSync } from 'node:fs'

const CLIENT = 'components/entity-modal/widgets/TenantStatusTransitions.tsx'
const SERVER = 'app/(app)/tenants/actions.ts'

const strip = src => src
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

/** `anchor` 뒤 첫 '{' 부터 짝 맞는 '}' 까지. 못 찾으면 null. */
function blockAfter(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const open = src.indexOf('{', at + anchor.length - 1)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null
}

const client = strip(readFileSync(CLIENT, 'utf8'))
const server = strip(readFileSync(SERVER, 'utf8'))

// 서버 함수 몸통 안의 확정 가지 — 함수를 먼저 자르고 그 안에서 가지를 찾는다(같은 글자가 다른 함수에 있어도 안 섞인다).
const fnOf = name => {
  const at = server.search(new RegExp(`(export )?async function ${name}\\(`))
  return at < 0 ? null : server.slice(at)
}
const SITES = [
  { name: `${CLIENT} 확인창 confirm 가지`, body: blockAfter(client, "if (def.kind === 'confirm') {") },
  { name: `${SERVER} leaseSaveDenial 확정 가지`, body: (() => { const f = fnOf('leaseSaveDenial'); return f && blockAfter(f, 'if (f.isReservedConfirmed) {') })() },
  { name: `${SERVER} updateTenant 확정 가지`, body: (() => { const f = fnOf('updateTenant'); return f && blockAfter(f, 'if (isReservedConfirmed) {') })() },
  { name: `${SERVER} applyStatusTransition 확정 가지`, body: (() => { const f = fnOf('applyStatusTransition'); return f && blockAfter(f, 'if (input.reservationConfirmedAt) {') })() },
]

const violations = []
for (const s of SITES) {
  if (!s.body) { violations.push(`${s.name} — 가지를 못 찾았다(침묵 통과 금지).`); continue }
  if (/rentAmount/.test(s.body)) violations.push(`${s.name} — 월 이용료(rentAmount)를 확정 조건으로 본다.`)
  if (/['"`][^'"`\n]*월 이용료/.test(s.body)) violations.push(`${s.name} — '월 이용료'를 확정 조건 문장에 넣는다.`)
}

console.log(`\n[예약 확정 문] 네 자리 점검 · 위반 ${violations.length}건`)
for (const v of violations) console.log(`  ${v}`)
if (violations.length > 0) {
  console.log(`\n  예약 확정 조건은 입주 희망일과 본인 연락처뿐이다(운영자 결정 2026-10-10). 월 이용료는 입실 처리 때 정한다.`)
  process.exit(1)
}
