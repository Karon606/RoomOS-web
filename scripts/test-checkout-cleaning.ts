// 퇴실 자동 청소 예정일 회귀 테스트 — 실행: npx tsx scripts/test-checkout-cleaning.ts
//
// 여기서 고정하는 것: 예정일 결정 규칙(lib/checkoutCleaning) — 퇴실일이 미래·오늘·과거·없음,
// 운영자 입력이 있음·비었음·깨졌음, 그리고 달·해·윤년 경계의 자리올림.
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
import { defaultCheckoutCleaningYmd, resolveCheckoutCleaningYmd } from '../lib/checkoutCleaning'

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

// ── ⓐ 기본값 규칙 ────────────────────────────────────────────────
// 기본은 퇴실 다음 날, 그날이 지났으면 오늘. 어느 갈래에서도 '저장한 날'이 규칙의 출발점이 아니다.

eq('퇴실일이 미래면 그 다음 날', defaultCheckoutCleaningYmd('2026-08-25', TODAY), '2026-08-26')
eq('퇴실일이 오늘이면 내일', defaultCheckoutCleaningYmd(TODAY, TODAY), '2026-08-21')
eq('퇴실일이 어제면 오늘', defaultCheckoutCleaningYmd('2026-08-19', TODAY), TODAY)
eq('퇴실일이 한참 과거면 오늘', defaultCheckoutCleaningYmd('2026-07-02', TODAY), TODAY)
eq('퇴실일이 없으면 오늘', defaultCheckoutCleaningYmd(null, TODAY), TODAY)
eq('퇴실일이 빈 문자열이면 오늘', defaultCheckoutCleaningYmd('', TODAY), TODAY)
eq('퇴실일 형식이 깨졌으면 오늘', defaultCheckoutCleaningYmd('2026/08/25', TODAY), TODAY)
eq('퇴실일 0벌림이 없으면 오늘 — 사전순 비교가 뒤집히는 모양이라 통과시키면 안 된다',
  defaultCheckoutCleaningYmd('2026-8-5', TODAY), TODAY)
eq('퇴실일 자리가 바뀌었으면 오늘', defaultCheckoutCleaningYmd('25-08-2026', TODAY), TODAY)
// 모양만 보면 통과하는데 실제로는 없는 날 — 그대로 두면 2/31 이 3/3 으로 굴러 예정일이 된다.
eq('없는 날(2월 31일)은 오늘', defaultCheckoutCleaningYmd('2026-02-31', TODAY), TODAY)
eq('평년의 2월 29일은 오늘', defaultCheckoutCleaningYmd('2026-02-29', TODAY), TODAY)
eq('윤년의 2월 29일은 있는 날이라 그 다음 날', defaultCheckoutCleaningYmd('2028-02-29', '2028-01-01'), '2028-03-01')
eq('13월은 오늘', defaultCheckoutCleaningYmd('2026-13-01', TODAY), TODAY)
// 달·해 경계에서도 자리올림이 맞아야 한다. 로컬 자정 Date 를 쓰면 여기서 하루가 밀린다.
eq('달 경계 · 말일 퇴실은 다음 달 1일', defaultCheckoutCleaningYmd('2026-08-31', TODAY), '2026-09-01')
eq('해 경계 · 12월 31일 퇴실은 다음 해 1월 1일', defaultCheckoutCleaningYmd('2026-12-31', TODAY), '2027-01-01')
eq('윤년 · 2월 28일 퇴실은 2월 29일', defaultCheckoutCleaningYmd('2028-02-28', '2028-01-01'), '2028-02-29')
// 기본값은 결코 '저장한 날'이 아니다 — 퇴실일이 오늘이거나 미래인 한 오늘보다 뒤다.
eq('기본값은 퇴실일이 오늘·미래인 동안 오늘이 아니다',
  ['2026-08-20', '2026-08-21', '2026-09-30'].map(d => defaultCheckoutCleaningYmd(d, TODAY) === TODAY),
  [false, false, false])

// ── ⓐ 운영자 입력 ────────────────────────────────────────────────
// 세 갈래가 서로 다른 값으로 갈린다 — 안 보냄·미정·고른 날.

eq('입력이 없으면(undefined) 기본값 규칙', resolveCheckoutCleaningYmd(undefined, '2026-08-25', TODAY), '2026-08-26')
eq('운영자가 고른 날은 그대로', resolveCheckoutCleaningYmd('2026-09-03', '2026-08-25', TODAY), '2026-09-03')
eq('고른 날이 과거여도 그대로 — 뒤늦게 적는 예정도 운영자의 뜻이다',
  resolveCheckoutCleaningYmd('2026-08-01', '2026-08-25', TODAY), '2026-08-01')
eq('미정(null)이면 날짜 없음', resolveCheckoutCleaningYmd(null, '2026-08-25', TODAY), null)
eq('미정(빈 문자열)이면 날짜 없음', resolveCheckoutCleaningYmd('', '2026-08-25', TODAY), null)
eq('미정(공백만)이면 날짜 없음', resolveCheckoutCleaningYmd('   ', '2026-08-25', TODAY), null)
// 빈칸은 뜻이고 깨진 값은 사고다. 사고를 뜻으로 읽으면 고른 날짜가 조용히 사라진다.
eq('형식이 깨진 입력은 미정이 아니라 기본값', resolveCheckoutCleaningYmd('오늘', '2026-08-25', TODAY), '2026-08-26')
eq('형식이 깨진 입력 · 퇴실일도 없으면 오늘', resolveCheckoutCleaningYmd('x', null, TODAY), TODAY)
// 시각이 붙어 와도 날짜부만 읽는다(폼 hidden 이 합쳐 보내는 형태를 흘리지 않는다).
eq('시각이 붙은 입력은 날짜부만', resolveCheckoutCleaningYmd('2026-09-03T14:00', null, TODAY), '2026-09-03')

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
  eq('축2 · 두 호출부 모두 퇴실일을 넘긴다',
    invocations.map(c => c.includes('moveOutYmd')), [true, true])
  // 그 퇴실일이 '오늘'로 굳어 있지 않은지. 규칙이 아무리 옳아도 늘 오늘을 먹이면 종전과 같다.
  eq('축2 · 두 호출부 모두 계약의 퇴실일을 먹인다',
    invocations.map(c => /moveOutDate\s*\|\|/.test(c)), [true, true])
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
