// 입주자 전화번호를 고르는 규칙이 사본으로 갈라지는 것을 잡는 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. "이 사람의 전화번호"에 답하는 자리가 화면·서류·문자·내보내기에 흩어져 있고,
// 규칙이 자리마다 달랐다. 종이에 본국 번호(+998)가 찍히거나, 문자가 비상 연락처(본인이 아닌
// 사람)로 가거나, 서류 시트의 문자 탭과 입주자 문자가 같은 사람에게 다른 번호를 답한다.
// 정본은 lib/tenantContact 의 pickTenantPhone 하나다.
//
//   ⓐ 정본이 살아 있는가(pickTenantPhone · TenantPhoneContact · 대체 갈래).
//   ⓑ 옮긴 호출부가 정본을 부르고 **그 결과를 쓰는가.** import 만 남기는 역주입이 2026-09-04 에
//      실제로 뚫렸고, 검수가 더 얄궂은 우회를 설계했다 — 호출은 남기고 결과를 안 읽는 판.
//      그래서 'import 가 있다'도 '호출이 있다'도 통과 조건이 못 된다.
//   ⓓ **종이 축이 대체로 오염되지 않았는가**(2026-09-17 신설). 문자는 본인 번호가 없으면 비상
//      연락처로 대체하지만, 계약서와 실거주 확인서는 대체하지 않는다 — 관청에 내는 종이에 남의
//      번호를 임차인 연락처로 적을 수는 없다. 두 문이 갈리는 자리라 한쪽이 다른 쪽으로 새는
//      것을 이름으로 막는다. 종이 넷에 pickTenantPhoneWithFallback 이 나타나면 그 자체가 위반이다.
//   ⓔ **예약 확정 세 자리가 정본 문을 부르고 답을 읽는가**(2026-09-17 신설). 등록·수정 폼·상태
//      전환 셋이 각자 판정을 적으면 한 길만 막히고 나머지로 들어온다(roomRequiredDenial 전례).
//      수정 폼·상태 전환은 **이미 확정된 계약을 소급으로 막지 않아야** 하므로 그 인자가
//      reservationConfirmedAt 을 읽는지도 함께 본다 — 빼면 옛 데이터의 이름 수정이 막힌다.
//   ⓒ 정본 밖에서 옛 손규칙이 새로 생기지 않는가. 이름과 괄호 모양은 손으로 바꿀 수 있으니
//      **꼴**을 본다(아래 OLD_PATTERNS·PICK_WHERE 여섯 + 둘).
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
// 정본에 붙인 넷 — 실거주 확인서 발급 · 서류 시트 문자 탭 · 입주자 문자 · 공지 문자.
const CANON_CALLERS = [
  'app/residence-cert/[tenantId]/actions.ts',
  'app/(app)/tenants/docBundle.ts',
  'app/(app)/dashboard/actions.ts',
  'app/(app)/tenants/noticeSms.ts',
]

// 아직 정본으로 안 옮긴 자리. 수는 그 파일에 남아 있어야 할 손규칙 **줄** 개수다(실측 2026-09-16).
// 한 규칙이 두 줄(조회 orderBy + JS find)이면 둘 다 센다 — 규칙의 어느 반쪽이 사라져도 알아야 한다.
const ALLOW = new Map([
  // 계약서 경로 셋 — 종이에 찍히는 값이라 바꾸면 printedFacts 통비교가 기존 서명 링크 전건을
  // 드리프트로 세운다(운영자 결정 B, 2026-09-16: 1차에서는 손대지 않고 드라이런으로 영향만 센다).
  ['lib/contractData.ts', { count: 3, why: '계약서 본문 인쇄 축 — 2차(운영자 결정 B)' }],
  ['app/(app)/tenants/contractShare.ts', { count: 5, why: '서명 링크 스냅샷 축 — 2차(운영자 결정 B)' }],
  ['app/api/contract/generate/route.ts', { count: 3, why: '발급 API 인쇄 축 — 2차(운영자 결정 B)' }],
  // 표시 전용 — 종이에도 문자에도 안 실린다. 프리즘 위젯은 연락처를 **전부** 그리고 그중
  // 주 연락처만 위로 올리는 자리라 '고르기' 와 축이 다르다.
  ['components/entity-modal/widgets/TenantContactInfo.tsx', { count: 1, why: '프리즘 표시 위젯 — 2차' }],
  // 셋은 목록 표시·폼 프리필이고, 하나(5272)는 연락 수단에 따라 하이픈을 넣을지 가르는 입력 분기라
  // 애초에 '번호 고르기'가 아니다. 꼴이 같아 그물에 걸리므로 근거를 적어 둔다.
  ['app/(app)/tenants/TenantClient.tsx', { count: 4, why: '목록 표시·폼 프리필 3 + 입력 포맷 분기 1 — 2차' }],
  // 내보내기 — CSV 열이라 종이·문자와 축이 다르고, 열 값이 바뀌면 옛 내보내기와 대조가 깨진다.
  ['app/api/export/route.ts', { count: 4, why: '내보내기 열 — 2차(운영자 결정 B)' }],
  // 호실 면 — 방 카드·배치 로그의 '연락처' 표시 값이다. 화면 표시라 문자·종이 축과 다르고,
  // 한 파일에 조회 3 + 표시 6 으로 흩어져 있어 옮기려면 그 면 전체를 한 번에 봐야 한다.
  ['app/(app)/rooms/actions.ts', { count: 9, why: '호실 면 표시 연락처(조회 3 · 표시 6) — 2차' }],
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
  // 대체 갈래(2026-09-17) — 본인 번호가 없을 때만 열리는 두 번째 문.
  if (!/export function pickTenantPhoneWithFallback\b/.test(lib)) {
    violations.push(`${LIB} — pickTenantPhoneWithFallback 이 사라졌다. 문자 갈래 넷이 이 함수를 부른다.`)
  }
  if (!/export function reservationConfirmPhoneDenial\b/.test(lib)) {
    violations.push(`${LIB} — reservationConfirmPhoneDenial 이 사라졌다. 예약 확정 문 세 자리가 이 함수를 부른다.`)
  }
  // 대체 함수 **안**에서 비상 갈래를 고르는 줄이 급소다. 이 조건이 빠지면 '본인 번호 없음'과
  // '비상 연락처' 사이의 구분이 무너지고, 화면이 다는 꼬리표(· 비상)가 거짓이 된다.
  {
    const at = lib.indexOf('export function pickTenantPhoneWithFallback')
    const body = at >= 0 ? lib.slice(at, at + 1200) : ''
    if (at >= 0 && !/c\.isEmergency/.test(body)) {
      violations.push(`${LIB} — 대체 갈래에서 isEmergency 판정이 사라졌다. 본인 번호와 비상 번호가 한 통이 된다.`)
    }
    if (at >= 0 && !/kinds\.includes/.test(body)) {
      violations.push(`${LIB} — 대체 갈래가 kinds 를 안 본다. 문자가 안 가는 유선·메신저가 수신자로 선다.`)
    }
  }
}

// ⓓ 종이 축은 대체를 안 쓴다 — 관청 종이·계약서에 남의 번호를 임차인 연락처로 적을 수 없다.
const PAPER_FILES = [
  'app/residence-cert/[tenantId]/actions.ts',
  'lib/contractData.ts',
  'app/(app)/tenants/contractShare.ts',
  'app/api/contract/generate/route.ts',
]
for (const f of PAPER_FILES) {
  const lines = strip(read(f)).split('\n')
  lines.forEach((l, i) => {
    if (/pickTenantPhoneWithFallback/.test(l)) {
      violations.push(`${f}:${i + 1} — 종이에 비상 연락처 대체가 흘렀다. 이 축은 pickTenantPhone(대체 없음)만 쓴다.`)
    }
  })
}

// ⓑ 옮긴 호출부는 정본을 부르고 **그 결과를 쓴다.**
//    검수가 설계한 우회가 이것이다 — 호출은 남기고 결과를 안 읽는 판
//    (`const tenantPhone = pickTenantPhone(...)` 는 그대로 두고 `tenantPhone: 손규칙` 으로 채우기).
//    그래서 'import 가 있다'도 '호출이 있다'도 통과 조건이 못 된다.
/**
 * 이 줄 묶음 안에서 `fn(...)` 이 **불리고 그 결과가 읽히는가.**
 * ⓑ·ⓔ 가 같은 문법을 쓴다 — 두 벌로 적으면 한쪽 우회만 막힌다.
 * where 는 위반 문구에 찍을 자리 이름(파일 또는 파일#함수).
 */
function assertConsumedCall(lines, fn, where, offset = 0, label = fn) {
  const callRe = new RegExp(`${fn}\\s*\\(`)
  const bindRe = new RegExp(`^\\s*(?:const|let|var)\\s+(\\w+)\\s*=\\s*${fn}\\s*\\(`)
  const bareRe = new RegExp(`^\\s*(?:void\\s+)?${fn}\\s*\\(`)
  const calls = lines.map((l, i) => ({ l, at: i + 1 })).filter(x => callRe.test(x.l))
  if (calls.length === 0) {
    violations.push(`${where} — ${label} 을 부르지 않는다. 옛 손규칙이 그대로 살아 있는 판이다.`)
    return false
  }
  let consumed = false
  for (const { l, at } of calls) {
    const bound = l.match(bindRe)
    if (!bound) {
      // 결과를 버리는 맨 호출문이면 소비가 아니다. 그 밖은 인자·속성값 자리라 구조적으로 소비된다.
      if (bareRe.test(l)) {
        violations.push(`${where}:${offset + at} — ${label} 결과를 버린다. 고른 답이 어디에도 안 실린다.`)
        continue
      }
      consumed = true
      continue
    }
    // 묶은 이름이 **값 자리**에 다시 나와야 한다. `이름:` 은 속성 키라 소비가 아니다 —
    // 우회판의 `tenantPhone: tenant.contacts.find(...)` 가 정확히 그 꼴이다.
    const name = bound[1]
    const used = new RegExp(`\\b${name}\\b(?!\\s*:)`)
    if (lines.some((x, i) => i + 1 !== at && used.test(x))) consumed = true
    else violations.push(`${where}:${offset + at} — ${label} 결과(${name})를 아무도 안 읽는다. 값 자리에 닿는지 확인하라.`)
  }
  if (!consumed) violations.push(`${where} — ${label} 을 불렀지만 결과가 소비되는 자리가 없다.`)
  return consumed
}

// 문자 갈래 셋은 대체 문(pickTenantPhoneWithFallback)을, 종이 하나는 대체 없는 문을 부른다.
// 어느 쪽이든 **정본 함수**여야 하므로 이름 하나로 묶어 본다(어느 쪽인지는 ⓓ 가 가른다).
const CANON_FN = 'pickTenantPhone(?:WithFallback)?'
for (const f of CANON_CALLERS) {
  const src = strip(read(f))
  if (!/from '@\/lib\/tenantContact'/.test(src)) {
    violations.push(`${f} — 번호 고르기를 lib/tenantContact 에서 안 가져온다. 사본이 검증하는 것은 사본 자신이다.`)
    continue
  }
  assertConsumedCall(src.split('\n'), CANON_FN, f, 0, 'pickTenantPhone / pickTenantPhoneWithFallback')
}

// ⓔ 예약 확정 문 세 자리 — 한 함수를 부르고 답을 읽는다. 소급 차단은 reservationConfirmedAt 이 가른다.
{
  const f = 'app/(app)/tenants/actions.ts'
  const src = strip(read(f))
  const lines = src.split('\n')
  // 최상위 함수 경계 — 다음 최상위 선언 전까지가 그 함수의 몸이다.
  const topDecl = /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/
  const regionOf = name => {
    const start = lines.findIndex(l => (l.match(topDecl) ?? [])[1] === name)
    if (start < 0) return null
    let end = lines.length
    for (let i = start + 1; i < lines.length; i++) {
      if (topDecl.test(lines[i])) { end = i; break }
    }
    return { start, lines: lines.slice(start, end) }
  }
  // 등록(생성 경로)은 확정된 과거가 없어 소급 인자가 상수다. 나머지 둘은 저장값을 읽어야 한다.
  for (const [name, needsPast] of [['leaseSaveDenial', false], ['updateTenant', true], ['applyStatusTransition', true]]) {
    const region = regionOf(name)
    if (!region) {
      violations.push(`${f} — ${name} 을 못 찾았다. 이름이 바뀌었으면 이 그물도 같이 고쳐야 한다.`)
      continue
    }
    assertConsumedCall(region.lines, 'reservationConfirmPhoneDenial', `${f}#${name}`, region.start)
    if (!needsPast) continue
    // 호출 인자에 저장값이 들어가는가 — 호출 줄부터 다섯 줄 안을 본다(인자가 여러 줄로 선다).
    const callAt = region.lines.findIndex(l => /reservationConfirmPhoneDenial\s*\(/.test(l))
    const window = callAt >= 0 ? region.lines.slice(callAt, callAt + 5).join('\n') : ''
    if (!/alreadyConfirmed:\s*!!\w+(?:\.\w+)*\.reservationConfirmedAt/.test(window)) {
      violations.push(`${f}#${name} — 확정 문이 reservationConfirmedAt 을 안 읽는다. 이미 확정된 계약의 이름 수정까지 막힌다.`)
    }
  }
}

// ⓒ 정본 밖의 손규칙 — 전수 훑고 ALLOW 의 수와 대조한다.
//
// 변수 이름과 괄호 모양은 손으로 얼마든지 바꿀 수 있다(`c` 를 `x` 로, `(c)` 로 감싸기).
// 그래서 이름을 박지 않고 **꼴**을 본다. 잡는 것은 "번호 하나를 고르는 손규칙" 여섯 가지다.
const OLD_PATTERNS = [
  // contacts.find(x => x.isPrimary ...) — 계약서 계열이 쓰던 꼴(옵셔널 체이닝·괄호 인자 포함)
  /contacts\s*(?:\?\.|\.)\s*find\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*\1\s*\.isPrimary/,
  // find(x => !x.isEmergency) — 위 꼴의 두 번째 줄(폴백)
  /find\(\s*\(?\s*(\w+)\s*\)?\s*=>\s*!\s*\1\s*\.isEmergency/,
  // orderBy 로 주 연락처를 맨 앞에 세우고 첫 건을 집는 꼴
  /orderBy:\s*\[?\s*\{\s*isPrimary/,
  // contacts[0] — 정렬에 답을 맡기는 꼴
  /contacts\s*(?:\?\.)?\s*\[\s*0\s*\]/,
  // contactType 비교로 전화만 거르는 꼴(따옴표 두 종류 · enum 참조 포함)
  /contactType\s*===\s*['"]PHONE['"]/,
  /ContactType\.PHONE/,
]
// 조회 자체가 '하나만 집어 오는' 꼴 — 아래 TAKE_ONE 과 짝일 때만 위반이다.
const PICK_WHERE = [
  /contactType:\s*['"]PHONE['"]/,
  /where:\s*\{\s*isPrimary:\s*true\s*\}/,
]
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
    const isOld = OLD_PATTERNS.some(re => re.test(line))
      || (PICK_WHERE.some(re => re.test(line)) && TAKE_ONE.test(window))
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

console.log(`[입주자 전화번호 축] 정본 호출부 ${CANON_CALLERS.length}곳 · 대체 금지 종이 ${PAPER_FILES.length}곳 · 확정 문 3곳 · 미이전 예외 ${ALLOW.size}파일 / 위반 ${violations.length}건`)
for (const v of violations.slice(0, 15)) console.error(`  - ${v}`)
process.exit(violations.length > 0 ? 1 : 0)
