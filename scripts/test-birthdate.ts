// 생년월일 순수함수 회귀 테스트 — 실행: npx tsx scripts/test-birthdate.ts
// 부분 입력·잘못된 월일·경계·정규화(점/ISO)를 고정한다.

import { formatBirthdateDigits, isValidBirthdate, digitsToIso } from '../lib/birthdate'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

// ── formatBirthdateDigits — 부분 입력 진행 ──
eq('format 빈값', formatBirthdateDigits(''), '')
eq('format 2자리', formatBirthdateDigits('19'), '19')
eq('format 4자리(연도)', formatBirthdateDigits('1970'), '1970')
eq('format 5자리', formatBirthdateDigits('19700'), '1970.0')
eq('format 6자리(연월)', formatBirthdateDigits('197009'), '1970.09')
eq('format 7자리', formatBirthdateDigits('1970092'), '1970.09.2')
eq('format 8자리(완성)', formatBirthdateDigits('19700928'), '1970.09.28')
eq('format 8자리 초과 절삭', formatBirthdateDigits('197009281'), '1970.09.28')
eq('format 비숫자 제거', formatBirthdateDigits('19a70-09.28'), '1970.09.28')
// 자기 출력 재입력(백스페이스 자연동작 보장 — 멱등)
eq('format 멱등(점 포함)', formatBirthdateDigits('1970.09.28'), '1970.09.28')
eq('format 멱등(부분 점)', formatBirthdateDigits('1970.09'), '1970.09')

// ── isValidBirthdate — 월일 경계 ──
eq('valid 정상', isValidBirthdate('19700928'), true)
eq('valid 점 포맷 허용', isValidBirthdate('1970.09.28'), true)
eq('valid 7자리 부족', isValidBirthdate('1970092'), false)
eq('valid 월 00', isValidBirthdate('19700028'), false)
eq('valid 월 13', isValidBirthdate('19701328'), false)
eq('valid 일 00', isValidBirthdate('19700900'), false)
eq('valid 일 32', isValidBirthdate('19700932'), false)
eq('valid 월 01 경계', isValidBirthdate('19700101'), true)
eq('valid 월 12 경계', isValidBirthdate('19701231'), true)
eq('valid 일 31 경계', isValidBirthdate('19700131'), true)

// ── digitsToIso — 정규화 ──
eq('iso 정상', digitsToIso('19700928'), '1970-09-28')
eq('iso 점 포맷', digitsToIso('1970.09.28'), '1970-09-28')
eq('iso ISO 재입력', digitsToIso('1970-09-28'), '1970-09-28')
eq('iso 부분 입력 null', digitsToIso('197009'), null)
eq('iso 잘못된 월 null', digitsToIso('19701328'), null)
eq('iso 빈값 null', digitsToIso(''), null)

console.log(`\n생년월일 테스트: ${pass} pass / ${fail} fail`)
if (fail > 0) process.exit(1)
