// 퇴실 자동 청소 예정일 회귀 테스트 — 실행: npx tsx scripts/test-checkout-cleaning.ts
//
// 여기서 고정하는 것: 예정일 결정 규칙(lib/checkoutCleaning) — 퇴실일이 미래·오늘·과거·없음,
// 운영자 입력이 있음·비었음·깨졌음, 그리고 달·해·윤년 경계의 자리올림.
//
// 이 규칙이 순수 함수인 이유. 결함의 성질이 '두 퇴실 경로가 같은 답을 쓰는가'라서, 답을 내는
// 자리가 하나여야 케이스를 고정하는 것이 곧 두 경로를 고정하는 것이 된다.

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

console.log(`\n퇴실 자동 청소 예정일 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
