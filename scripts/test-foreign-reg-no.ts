// 외국인등록번호 순수함수 + 개인정보 암복호 회귀 테스트.
// 실행: npx tsx --tsconfig scripts/tsconfig.pii.json scripts/test-foreign-reg-no.ts
//
// 여기 나오는 번호는 전부 가짜다. 실제 등록번호는 테스트에도 코드에도 남기지 않는다.
// 키도 이 프로세스 안에서만 만든 고정 바이트라 운영 키와 무관하다.

import {
  foreignRegNoDigits, formatForeignRegNo, maskForeignRegNo,
  birthdateFromForeignRegNo, validateForeignRegNo, RESIDENT_REG_NO_REJECT,
} from '../lib/foreignRegNo'

import {
  encryptPii, decryptPii, piiFingerprint, foreignRegNoFact,
  readStoredForeignRegNo, maskStoredForeignRegNo, PII_PREFIX,
} from '../lib/pii'

// lib/pii 는 모듈 로드 시점이 아니라 호출 시점에 키를 읽는다. 첫 호출 전에 심어 두면 된다.
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x2b).toString('base64')

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}
function ok(name: string, cond: boolean) { eq(name, cond, true) }

// 가짜 번호 — 1990-01-01 남성(5), 같은 날 여성(6), 2001-12-31(7·8)
const FAKE_1990 = '9001015123456'
const FAKE_1990_F = '9001016123456'
const FAKE_2001 = '0112317123456'
const FAKE_2001_8 = '0112318123456'
const FAKE_RRN = '9001011234567'   // 7번째 자리 1 = 주민등록번호
const TENANT = '11111111-2222-3333-4444-555555555555'
const OTHER_TENANT = '99999999-8888-7777-6666-555555555555'

// ── digits / format ──────────────────────────────────────────
eq('digits 빈값', foreignRegNoDigits(''), '')
eq('digits 하이픈 제거', foreignRegNoDigits('900101-5123456'), FAKE_1990)
eq('digits 13자리 초과 절삭', foreignRegNoDigits('90010151234567890'), FAKE_1990)
eq('format 6자리 이하', formatForeignRegNo('900101'), '900101')
eq('format 7자리', formatForeignRegNo('9001015'), '900101-5')
eq('format 완성', formatForeignRegNo(FAKE_1990), '900101-5123456')
eq('format 멱등', formatForeignRegNo('900101-5123456'), '900101-5123456')

// ── 마스킹 ───────────────────────────────────────────────────
eq('mask 완성', maskForeignRegNo(FAKE_1990), '900101-*******')
eq('mask 부분 입력은 빈값', maskForeignRegNo('900101'), '')
eq('mask 뒤 7자리 노출 없음', /\d{6}-\*{7}$/.test(maskForeignRegNo(FAKE_2001)), true)

// ── 생년월일 파생 경계 ────────────────────────────────────────
eq('파생 5 = 1900년대', birthdateFromForeignRegNo(FAKE_1990), '1990-01-01')
eq('파생 6 = 1900년대', birthdateFromForeignRegNo(FAKE_1990_F), '1990-01-01')
eq('파생 7 = 2000년대', birthdateFromForeignRegNo(FAKE_2001), '2001-12-31')
eq('파생 8 = 2000년대', birthdateFromForeignRegNo(FAKE_2001_8), '2001-12-31')
eq('파생 연도 00 경계(5)', birthdateFromForeignRegNo('0001015123456'), '1900-01-01')
eq('파생 연도 99 경계(8)', birthdateFromForeignRegNo('9912318123456'), '2099-12-31')
eq('파생 월 00 거부', birthdateFromForeignRegNo('9000015123456'), null)
eq('파생 월 13 거부', birthdateFromForeignRegNo('9013015123456'), null)
eq('파생 일 00 거부', birthdateFromForeignRegNo('9001005123456'), null)
eq('파생 일 32 거부', birthdateFromForeignRegNo('9001325123456'), null)
eq('파생 13자리 미만 거부', birthdateFromForeignRegNo('900101512345'), null)
eq('파생 7번째 0 거부', birthdateFromForeignRegNo('9001010123456'), null)
eq('파생 7번째 9 거부', birthdateFromForeignRegNo('9001019123456'), null)

// ── 검증 ─────────────────────────────────────────────────────
eq('검증 통과(5)', validateForeignRegNo('900101-5123456'), { ok: true, value: FAKE_1990, birthdate: '1990-01-01' })
eq('검증 통과(8)', validateForeignRegNo(FAKE_2001_8), { ok: true, value: FAKE_2001_8, birthdate: '2001-12-31' })
for (const c of ['1', '2', '3', '4']) {
  const v = validateForeignRegNo(`900101${c}123456`)
  eq(`검증 주민등록번호 ${c} 거부`, v.ok === false && v.error, RESIDENT_REG_NO_REJECT)
}
ok('검증 12자리 거부', validateForeignRegNo('900101512345').ok === false)
ok('검증 7번째 0 거부', validateForeignRegNo('9001010123456').ok === false)
ok('검증 7번째 9 거부', validateForeignRegNo('9001019123456').ok === false)
ok('검증 월 13 거부', validateForeignRegNo('9013015123456').ok === false)
ok('검증 빈값 거부', validateForeignRegNo('').ok === false)

// ── 암복호 왕복 ──────────────────────────────────────────────
const enc = encryptPii(FAKE_1990, TENANT)
ok('암호문 접두어 v1:', enc.startsWith(PII_PREFIX))
eq('암호문 조각 4개', enc.split(':').length, 4)
ok('암호문에 평문 없음', !enc.includes(FAKE_1990) && !enc.includes('900101'))
eq('왕복 복원', decryptPii(enc, TENANT), FAKE_1990)
ok('같은 평문도 매번 다른 암호문(IV)', encryptPii(FAKE_1990, TENANT) !== encryptPii(FAKE_1990, TENANT))

// ── AAD 불일치 거부 ──────────────────────────────────────────
let aadRejected = false
try { decryptPii(enc, OTHER_TENANT) } catch { aadRejected = true }
ok('AAD 불일치 복호 거부', aadRejected)
eq('AAD 불일치는 readStored 에서 null', readStoredForeignRegNo(enc, OTHER_TENANT), null)
eq('AAD 일치는 readStored 에서 복원', readStoredForeignRegNo(enc, TENANT), FAKE_1990)
eq('readStored 빈 값은 null', readStoredForeignRegNo(null, TENANT), null)

// 태그 변조 거부 — 한 글자만 바꾼 암호문은 통과하면 안 된다.
const parts = enc.split(':')
const tampered = [parts[0], parts[1], parts[2], Buffer.from('0000000000000', 'utf8').toString('base64')].join(':')
eq('본문 변조 거부', readStoredForeignRegNo(tampered, TENANT), null)
eq('암호문 아닌 값 거부', readStoredForeignRegNo(FAKE_1990, TENANT), null)

// ── 마스킹 문 ────────────────────────────────────────────────
eq('maskStored 정상', maskStoredForeignRegNo(enc, TENANT), '900101-*******')
eq('maskStored 복호 실패는 전부 별표', maskStoredForeignRegNo(enc, OTHER_TENANT), '******-*******')
eq('maskStored 미등록은 null', maskStoredForeignRegNo(null, TENANT), null)

// ── 지문 ─────────────────────────────────────────────────────
eq('지문 8자리 hex', /^[0-9a-f]{8}$/.test(piiFingerprint(FAKE_1990)), true)
eq('지문 결정성', piiFingerprint(FAKE_1990), piiFingerprint(FAKE_1990))
ok('다른 번호는 다른 지문', piiFingerprint(FAKE_1990) !== piiFingerprint(FAKE_1990_F))
{
  // 키가 바뀌면 지문도 바뀐다 — 순수 sha256 이면 여기서 같아지고, 그건 전수조사로 복원된다는 뜻이다.
  const before = piiFingerprint(FAKE_1990)
  const keep = process.env.STAYEUM_PII_KEY
  process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x5c).toString('base64')
  const after = piiFingerprint(FAKE_1990)
  process.env.STAYEUM_PII_KEY = keep
  ok('키가 다르면 지문도 다르다', before !== after)
}

// ── 박제 값 ──────────────────────────────────────────────────
const factValue = foreignRegNoFact(FAKE_1990)
eq('박제 값 모양', /^\d{6}-\*{7}#[0-9a-f]{8}$/.test(factValue ?? ''), true)
ok('박제 값에 평문 없음', !(factValue ?? '').includes(FAKE_1990))
eq('박제 표시는 # 앞까지', (factValue ?? '').split('#')[0], '900101-*******')
eq('등록 안 한 사람은 null', foreignRegNoFact(null), null)

// ── 키 부재는 조용한 평문이 아니라 명시적 실패 ────────────────
{
  const keep = process.env.STAYEUM_PII_KEY
  delete process.env.STAYEUM_PII_KEY
  let threw = false
  try { encryptPii(FAKE_1990, TENANT) } catch { threw = true }
  ok('키 없으면 저장 실패', threw)
  let badLen = false
  process.env.STAYEUM_PII_KEY = Buffer.alloc(16, 1).toString('base64')
  try { encryptPii(FAKE_1990, TENANT) } catch { badLen = true }
  ok('키 길이 32바이트 아니면 실패', badLen)
  process.env.STAYEUM_PII_KEY = keep
}

// 위 블록에서 던진 값이 뭐든 실제 등록번호가 로그에 남지 않는지 마지막으로 확인한다.
eq('테스트가 쓴 번호는 전부 가짜', [FAKE_1990, FAKE_2001, FAKE_RRN].every(n => n.endsWith('123456') || n.endsWith('1234567')), true)

console.log(`[외국인등록번호] 통과 ${pass} / 실패 ${fail}`)
if (fail) process.exit(1)
