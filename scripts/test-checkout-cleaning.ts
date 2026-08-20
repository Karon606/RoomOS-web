// 퇴실 자동 청소 예정일 회귀 테스트 — 실행: npx tsx scripts/test-checkout-cleaning.ts
//
// 여기서 고정하는 것: **앱이 예정일을 지어내지 않는다**(운영자 확정 2026-08-21). 운영자가 적은
// 날이 곧 예정일이고 안 적으면 예정일이 없다. 퇴실일보다 이른 날도 그대로 쓴다 — 퇴실 전 청소가
// 정당한 일정이기 때문이다.
//
// 이 규칙이 순수 함수인 이유. 결함의 성질이 '두 퇴실 경로가 같은 답을 쓰는가'라서, 답을 내는
// 자리가 하나여야 케이스를 고정하는 것이 곧 두 경로를 고정하는 것이 된다.
//
// 뒤쪽 소스 가드(ⓑ)가 그 '같은 답'을 모양으로 확인한다. 호출부가 둘이라 한 곳만 고치면 다른
// 경로로 퇴실한 건이 여전히 저장한 날로 박히는데, 값 검사로는 그 갈림이 안 잡힌다.
// 부분 문자열 검사가 아니라 **괄호 깊이로 블록을 잘라 그 안만** 본다(주석은 먼저 걷는다) —
// 파일 어딘가에 그 낱말이 있다는 것과 그 함수가 그것을 쓴다는 것은 다른 말이기 때문이다.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveCheckoutCleaningYmd } from '../lib/checkoutCleaning'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const TODAY = '2026-08-20'

// ── ⓐ 입력을 예정일로 읽는 규칙 ─────────────────────────────────
// 앱은 날짜를 제안하지 않는다. 적은 날이 그대로 예정일이고, 안 적으면 없다.

eq('운영자가 적은 날은 그대로', resolveCheckoutCleaningYmd('2026-09-03'), '2026-09-03')
eq('퇴실일보다 이른 날도 그대로 — 퇴실 전 청소는 정당하다', resolveCheckoutCleaningYmd('2026-08-01'), '2026-08-01')
eq('퇴실 당일도 그대로', resolveCheckoutCleaningYmd(TODAY), TODAY)
eq('한참 과거도 그대로 — 뒤늦게 적는 경우가 있다', resolveCheckoutCleaningYmd('2026-07-02'), '2026-07-02')
eq('먼 미래도 그대로', resolveCheckoutCleaningYmd('2027-03-15'), '2027-03-15')

// 안 적은 갈래는 전부 미정이다 — 어느 갈래에서도 오늘·퇴실일 같은 날이 튀어나오면 안 된다.
eq('안 적었으면(빈 문자열) 미정', resolveCheckoutCleaningYmd(''), null)
eq('안 적었으면(공백만) 미정', resolveCheckoutCleaningYmd('   '), null)
eq('안 적었으면(null) 미정', resolveCheckoutCleaningYmd(null), null)
eq('호출부가 안 넘겼으면(undefined) 미정', resolveCheckoutCleaningYmd(undefined), null)

// 깨진 값은 지어낸 날을 적느니 미정으로. 사람이 나중에 적으면 된다.
eq('형식이 깨졌으면 미정', resolveCheckoutCleaningYmd('오늘'), null)
eq('구분자가 다르면 미정', resolveCheckoutCleaningYmd('2026/08/25'), null)
eq('영벌림이 없으면 미정', resolveCheckoutCleaningYmd('2026-8-5'), null)
eq('자리가 바뀌었으면 미정', resolveCheckoutCleaningYmd('25-08-2026'), null)

// 실재하지 않는 날 — 정규식도 Date.parse 도 통과하지만 굴러가는 값들.
eq('없는 날(2월 31일)은 미정', resolveCheckoutCleaningYmd('2026-02-31'), null)
eq('평년의 2월 29일은 미정', resolveCheckoutCleaningYmd('2026-02-29'), null)
eq('13월은 미정', resolveCheckoutCleaningYmd('2026-13-01'), null)
eq('윤년의 2월 29일은 있는 날이라 그대로', resolveCheckoutCleaningYmd('2028-02-29'), '2028-02-29')

eq('시각이 붙은 입력은 날짜부만', resolveCheckoutCleaningYmd('2026-09-03T14:00'), '2026-09-03')

// 어떤 입력에도 '오늘'이 답으로 튀어나오지 않는다 — 종전 결함의 모양 자체를 막는다.
eq('오늘이 저절로 답이 되는 입력은 없다',
  ['', '   ', '오늘', '2026/08/25', '2026-02-31'].filter(v => resolveCheckoutCleaningYmd(v) === TODAY).length, 0)

// ── ⓑ 소스 가드 ─────────────────────────────────────────────────

const ROOT = process.cwd()
const ACTIONS = join(ROOT, 'app', '(app)', 'tenants', 'actions.ts')
const src = readFileSync(ACTIONS, 'utf8')

/** 주석을 걷는다 — 주석에 적힌 낱말이 코드가 그것을 쓴다는 증거가 되면 안 된다. */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ').replace(/([^:])\/\/.*$/gm, '$1 ')
}

/** `open` 위치의 여는 괄호와 짝이 되는 자리. 못 찾으면 -1. */
function matchAt(code: string, open: number, o: string, c: string): number {
  let depth = 0
  for (let i = open; i < code.length; i++) {
    if (code[i] === o) depth++
    else if (code[i] === c) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}

/**
 * `head` 로 시작하는 선언의 **본문**을 잘라 낸다. 못 찾으면 null.
 *
 * 인자 목록을 먼저 통째로 건너뛴다 — 인자에 객체 타입(`opts: { ... }`)이 들어오면 첫 `{` 가
 * 본문이 아니라 그 타입이라, 순진하게 첫 중괄호를 잡으면 엉뚱한 블록을 보고 통과시킨다.
 */
function blockOf(code: string, head: string): string | null {
  const at = code.indexOf(head)
  if (at < 0) return null
  const paren = code.indexOf('(', at)
  const parenEnd = paren < 0 ? -1 : matchAt(code, paren, '(', ')')
  if (parenEnd < 0) return null
  const open = code.indexOf('{', parenEnd)
  if (open < 0) return null
  const end = matchAt(code, open, '{', '}')
  return end < 0 ? null : code.slice(open, end + 1)
}

/** `name(` 호출의 인자 텍스트 전부. 선언(`function name(`)은 뺀다. 여러 줄 인자도 짝으로 센다. */
function callArgsOf(code: string, name: string): string[] {
  const out: string[] = []
  const needle = `${name}(`
  for (let i = code.indexOf(needle); i >= 0; i = code.indexOf(needle, i + 1)) {
    if (/function\s+$/.test(code.slice(Math.max(0, i - 20), i))) continue
    const end = matchAt(code, i + name.length, '(', ')')
    if (end < 0) continue
    out.push(code.slice(i + needle.length, end))
  }
  return out
}

const clean = stripComments(src)

// 축 1 — 규칙 정본이 실제로 불린다. 블록을 못 찾으면 그 자체가 위반이다(이름이 바뀌었다는 뜻).
{
  const b = blockOf(clean, 'async function ensureCheckoutCleaning(')
  eq('축1 · ensureCheckoutCleaning 블록을 찾는다', b != null, true)
  eq('축1 · 규칙 정본(resolveCheckoutCleaningYmd)을 부른다', !!b && b.includes('resolveCheckoutCleaningYmd'), true)
  // 저장한 날을 예정일로 박던 그 자리가 사라졌는지. kstYmdStr 자체는 '오늘'을 규칙에 넘기는
  // 인자로 여전히 쓰이므로, 금지하는 것은 그것이 scheduledDate 에 **직접** 닿는 모양이다.
  eq('축1 · scheduledDate 에 오늘을 직접 박지 않는다',
    !!b && !/scheduledDate:\s*ymdToDbDate\(\s*kstYmdStr\(\)\s*\)/.test(b), true)
  // 미정이면 날짜 없이 만든다 — 청소가 필요하다는 사실 자체는 남아야 한다.
  eq('축1 · 미정이면 scheduledDate 가 null 이다', !!b && /scheduledDate:[^,\n]*null/.test(b), true)
}

// 축 2 — 호출부 **둘 다** 예정일을 넘긴다. 이 결함의 클래스가 바로 여기다.
{
  const invocations = callArgsOf(clean, 'ensureCheckoutCleaning')
  eq('축2 · 호출부가 둘이다', invocations.length, 2)
  eq('축2 · 두 호출부 모두 청소 예정일을 넘긴다',
    invocations.map(c => c.includes('cleaningYmd')), [true, true])
  // 퇴실일은 더 이상 규칙의 입력이 아니다 — 앱이 날짜를 파생하지 않으므로 넘길 이유가 없다.
  // 대신 그 자리에 '오늘'이 다시 기어들지 않는지를 본다. 규칙이 아무리 옳아도 호출부가
  // kstYmdStr() 을 예정일로 먹이면 종전 결함이 그대로 돌아온다.
  eq('축2 · 어느 호출부도 오늘을 예정일로 먹이지 않는다',
    invocations.map(c => /cleaningYmd\s*:\s*kstYmdStr\(\)/.test(c)), [false, false])
}

// 축 3 — 되돌리기 대칭. 자동 생성분만 걷는 네 조건이 그대로 서 있어야 한다.
// 운영자가 손으로 등록한 예정은 leaseTermId 가 없어 이 조건에 애초에 안 걸린다.
{
  const b = blockOf(clean, 'async function clearAutoCheckoutCleaning(')
  eq('축3 · clearAutoCheckoutCleaning 블록을 찾는다', b != null, true)
  for (const cond of ['leaseTermId', "reason: 'CHECKOUT'", "status: 'PLANNED'", 'deletedAt: null']) {
    eq(`축3 · 걷는 조건에 ${cond} 가 남아 있다`, !!b && b.includes(cond), true)
  }
  // 소프트삭제다 — 진짜 delete 로 바뀌면 되살릴 길이 사라진다.
  eq('축3 · 지우는 것이 아니라 소프트삭제다', !!b && b.includes('deletedAt: new Date()') && !b.includes('deleteMany'), true)
}

console.log(`\n퇴실 자동 청소 예정일 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
