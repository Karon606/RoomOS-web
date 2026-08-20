// 본국 연락처 국가 자동 선택 회귀 테스트 — 실행: npx tsx scripts/test-home-country-sync.ts
//
// 여기서 고정하는 것 셋(2026-08-20, 신고 aed91367).
//   · **손으로 고른 국가는 덮이지 않는다.** 이 축이 깨지는 방식은 조용하다 — 국적 미국·거주 일본을
//     넣어 둔 칸이 국적을 다시 만지는 순간 미국으로 되돌아가고, 화면은 아무 말도 하지 않는다.
//     나머지 둘보다 먼저다.
//   · 국적을 고르면 빈 칸의 국가가 따라온다(운영자가 요청한 그것).
//   · 매핑에 없는 국적은 아무것도 자동 선택하지 않는다. 틀린 나라를 심는 것보다 종전 값이 낫다.
//
// 국적(이름)과 전화 국가(ISO 코드)를 잇는 다리 codeByName 도 함께 잠근다 — 그 다리가 끊기면
// 위 규칙이 전부 '매핑 없음'으로 떨어져 자동 선택이 통째로 조용히 사라진다.

import { shouldSyncPhoneCountry } from '../lib/homeCountrySync'
import { codeByName } from '../components/ui/CountrySelect'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

// ── 다리(국적 이름 → ISO 코드) ────────────────────────────────
eq('다리 · 대한민국', codeByName('대한민국'), 'KR')
eq('다리 · 베트남', codeByName('베트남'), 'VN')
eq('다리 · 미국', codeByName('미국'), 'US')
eq('다리 · 일본', codeByName('일본'), 'JP')
eq('다리 · 목록 밖 이름은 undefined', codeByName('VIETNAM'), undefined)
eq('다리 · 빈 값은 undefined', codeByName(''), undefined)
eq('다리 · null 은 undefined', codeByName(null), undefined)

// ── 자동 선택이 일어나는 자리 ─────────────────────────────────
eq('국적을 처음 고르면 빈 칸이 따라온다',
  shouldSyncPhoneCountry({ next: 'VN', prev: undefined, hasNumber: false, userPicked: false }), true)
eq('국적을 다른 나라로 바꾸면 따라온다',
  shouldSyncPhoneCountry({ next: 'JP', prev: 'VN', hasNumber: false, userPicked: false }), true)

// ── 자동 선택이 일어나면 안 되는 자리 ─────────────────────────
eq('손으로 고른 뒤에는 덮지 않는다',
  shouldSyncPhoneCountry({ next: 'US', prev: 'VN', hasNumber: false, userPicked: true }), false)
eq('손으로 고른 뒤에는 번호가 비어 있어도 덮지 않는다',
  shouldSyncPhoneCountry({ next: 'CN', prev: undefined, hasNumber: false, userPicked: true }), false)
eq('번호가 적혀 있으면 옮기지 않는다',
  shouldSyncPhoneCountry({ next: 'JP', prev: 'VN', hasNumber: true, userPicked: false }), false)
eq('매핑에 없는 국적은 아무것도 안 한다',
  shouldSyncPhoneCountry({ next: undefined, prev: 'VN', hasNumber: false, userPicked: false }), false)
eq('국적을 해제해도 종전 국가를 그대로 둔다',
  shouldSyncPhoneCountry({ next: undefined, prev: undefined, hasNumber: false, userPicked: false }), false)
eq('같은 국적을 다시 고르면 아무 일도 없다',
  shouldSyncPhoneCountry({ next: 'VN', prev: 'VN', hasNumber: false, userPicked: false }), false)

// ── 운영자가 말한 그 경우 — 국적 미국, 거주 일본 ──────────────
// 1) 국적 미국을 고른다. 빈 칸이라 미국이 따라온다.
eq('미국·일본 · 국적을 고르면 미국이 선다',
  shouldSyncPhoneCountry({ next: codeByName('미국'), prev: undefined, hasNumber: false, userPicked: false }), true)
// 2) 국가를 손으로 일본으로 바꾼다(번호는 아직 안 적었다).
// 3) 국적을 캐나다로 정정한다 — 여기서 일본이 살아남아야 한다.
eq('미국·일본 · 국적을 다시 만져도 일본이 살아남는다',
  shouldSyncPhoneCountry({ next: codeByName('캐나다'), prev: 'US', hasNumber: false, userPicked: true }), false)

console.log(`\n본국 연락처 국가 자동 선택 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
