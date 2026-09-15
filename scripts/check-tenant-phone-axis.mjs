// 입주자 전화번호를 고르는 규칙이 사본으로 갈라지는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. "이 사람의 전화번호"에 답하는 자리가 화면·서류·문자·내보내기에 흩어져 있고,
// 규칙이 자리마다 달랐다. 종이에 본국 번호(+998)가 찍히거나, 문자가 비상 연락처(본인이 아닌
// 사람)로 가거나, 서류 시트의 문자 탭과 입주자 문자가 같은 사람에게 다른 번호를 답한다.
// 정본은 lib/tenantContact 의 pickTenantPhone 하나다.
//
//   ⓐ 정본이 살아 있는가(pickTenantPhone · TenantPhoneContact).
//   ⓑ 옮긴 호출부 셋이 정본을 **부르는가.** import 만 남기고 호출을 지우는 역주입이
//      2026-09-04 에 실제로 뚫린 수법이라 import 존재만으로는 통과시키지 않는다.
//   ⓒ 정본 밖에서 옛 손규칙이 새로 생기지 않는가. 두 꼴을 본다.
//        · `contacts.find(c => c.isPrimary` — 계약서 계열이 쓰던 꼴
//        · `contactType: 'PHONE'` + `take: 1` — 문자 계열이 쓰던 꼴
//      **아직 안 옮긴 자리는 ALLOW 에 근거와 수를 적는다.** 수까지 적는 이유는 하나다 —
//      파일 단위로만 눈감으면 그 파일 안에서 손규칙이 하나 더 늘어도 조용히 지나간다.
//      수가 줄었을 때도 붉게 세운다. 2차로 옮기고 이 목록을 안 고치면 명단이 썩는다.
//
// 실행: node scripts/check-tenant-phone-axis.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const violations = []
const read = f => readFileSync(f, 'utf8')
// 줄 수를 보존한다(`\s*` 는 m 플래그에서 줄바꿈을 먹는다).
const strip = s => s
  .replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')

const LIB = 'lib/tenantContact.ts'
// 1차로 정본에 붙인 셋 — 실거주 확인서 발급 · 서류 시트 문자 탭 · 입주자 문자.
const CANON_CALLERS = [
  'app/residence-cert/[tenantId]/actions.ts',
  'app/(app)/tenants/docBundle.ts',
  'app/(app)/dashboard/actions.ts',
]

// 아직 정본으로 안 옮긴 자리. 수는 그 파일에 남아 있어야 할 손규칙 개수다.
const ALLOW = new Map([
  // 계약서 경로 셋 — 종이에 찍히는 값이라 바꾸면 printedFacts 통비교가 기존 서명 링크 전건을
  // 드리프트로 세운다(운영자 결정 B, 2026-09-16: 1차에서는 손대지 않고 드라이런으로 영향만 센다).
  ['lib/contractData.ts', { count: 1, why: '계약서 본문 인쇄 축 — 2차(운영자 결정 B)' }],
  ['app/(app)/tenants/contractShare.ts', { count: 2, why: '서명 링크 스냅샷 축 — 2차(운영자 결정 B)' }],
  ['app/api/contract/generate/route.ts', { count: 1, why: '발급 API 인쇄 축 — 2차(운영자 결정 B)' }],
  // 표시 전용 — 종이에도 문자에도 안 실린다. 프리즘 위젯은 연락처를 **전부** 그리고 그중
  // 주 연락처만 위로 올리는 자리라 '고르기' 와 축이 다르다.
  ['components/entity-modal/widgets/TenantContactInfo.tsx', { count: 1, why: '프리즘 표시 위젯 — 2차' }],
  ['app/(app)/tenants/TenantClient.tsx', { count: 3, why: '목록 표시·폼 프리필 — 2차' }],
  // 내보내기 — CSV 열이라 종이·문자와 축이 다르고, 열 값이 바뀌면 옛 내보내기와 대조가 깨진다.
  ['app/api/export/route.ts', { count: 2, why: '내보내기 열 — 2차(운영자 결정 B)' }],
  // 문자 둘 — 이번 판에서 옮긴 셋과 같은 클래스라 2차 1순위다.
  ['app/(app)/tenants/noticeSms.ts', { count: 1, why: '공지 문자 수신자 — 2차 1순위' }],
  ['app/(app)/dashboard/actions.ts', { count: 1, why: '미납 안내 문자 수신자(getUnpaidSmsContext) — 2차 1순위' }],
])

// ⓐ 정본이 살아 있다.
{
  const lib = strip(read(LIB))
  if (!/export function pickTenantPhone\b/.test(lib)) {
    violations.push(`${LIB} — pickTenantPhone 이 사라졌다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
  }
  if (!/export type TenantPhoneContact\b/.test(lib)) {
    violations.push(`${LIB} — TenantPhoneContact 이 사라졌다.`)
  }
  // 본국 번호를 마지막 폴백으로 미는 가지가 급소다 — 지우면 외국인의 +998 번호가 다시 종이에 찍힌다.
  if (!/!c\.isHomeCountry/.test(lib)) {
    violations.push(`${LIB} — 본국 번호 폴백 가지(!isHomeCountry)가 사라졌다. 해외 번호가 서류·문자로 되돌아간다.`)
  }
  // 비상 연락처는 어떤 갈래로도 안 잡는다.
  if (!/!c\.isEmergency/.test(lib)) {
    violations.push(`${LIB} — 비상 제외가 사라졌다. 본인이 아닌 사람에게 문자가 간다.`)
  }
}

// ⓑ 옮긴 호출부는 정본을 **부른다**(import 만으로는 통과 못 한다).
for (const f of CANON_CALLERS) {
  const src = strip(read(f))
  if (!/from '@\/lib\/tenantContact'/.test(src)) {
    violations.push(`${f} — 번호 고르기를 lib/tenantContact 에서 안 가져온다. 사본이 검증하는 것은 사본 자신이다.`)
    continue
  }
  if (!/pickTenantPhone\s*\(/.test(src)) {
    violations.push(`${f} — 정본을 import 만 하고 부르지 않는다. 옛 손규칙이 그대로 살아 있는 판이다.`)
  }
}

// ⓒ 정본 밖의 손규칙 — 전수 훑고 ALLOW 의 수와 대조한다.
const OLD_FIND = /contacts\s*\?\.\s*find\(\s*c\s*=>\s*c\.isPrimary|contacts\.find\(\s*c\s*=>\s*c\.isPrimary/
const PHONE_WHERE = /contactType:\s*'PHONE'/
const TAKE_ONE = /take:\s*1\b/

const roots = ['app', 'components', 'lib']
const files = []
const walk = dir => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) { walk(full); continue }
    if (/\.tsx?$/.test(name)) files.push(full)
  }
}
for (const r of roots) walk(r)

const hits = new Map()
for (const f of files) {
  if (f === LIB) continue
  const lines = strip(read(f)).split('\n')
  lines.forEach((line, i) => {
    // 조회 한 덩이가 여러 줄로 쪼개져 있을 수 있어 뒤 네 줄까지 함께 본다.
    const window = lines.slice(i, i + 5).join('\n')
    const isOld = OLD_FIND.test(line) || (PHONE_WHERE.test(line) && TAKE_ONE.test(window))
    if (!isOld) return
    if (!hits.has(f)) hits.set(f, [])
    hits.get(f).push(i + 1)
  })
}

for (const [f, at] of hits) {
  const allow = ALLOW.get(f)
  if (!allow) {
    violations.push(`${f}:${at.join(',')} — 번호 고르기를 손으로 다시 적었다. pickTenantPhone(contacts, kinds) 을 쓴다.`)
    continue
  }
  if (at.length > allow.count) {
    violations.push(`${f}:${at.join(',')} — 손규칙이 ${allow.count}곳에서 ${at.length}곳으로 늘었다(${allow.why}). 새 자리는 정본을 쓴다.`)
  }
}
for (const [f, allow] of ALLOW) {
  const at = hits.get(f) ?? []
  if (at.length < allow.count) {
    violations.push(`${f} — 손규칙이 ${allow.count}곳에서 ${at.length}곳으로 줄었다. 옮겼으면 이 그물의 ALLOW 도 같이 줄여라(명단이 썩는다).`)
  }
}

console.log(`[입주자 전화번호 축] 정본 호출부 ${CANON_CALLERS.length}곳 · 미이전 예외 ${ALLOW.size}파일 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
