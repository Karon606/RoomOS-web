// 도어락 마스터키 암복호 회귀 테스트 — lib/pii 의 storeRoomMasterKey / readStoredRoomMasterKey (2026-10-08).
// 실행: npx tsx --tsconfig scripts/tsconfig.pii.json scripts/test-room-master-key.ts
//
// test-foreign-reg-no.ts 와 같은 하네스다. 여기 나오는 코드는 전부 가짜이고, 키도 이 프로세스 안에서만
// 만든 고정 바이트라 운영 키와 무관하다. 실패 출력에도 코드 원문을 싣지 않는다(감지망 출력이 곧 유출이면 안 된다).

import {
  storeRoomMasterKey, readStoredRoomMasterKey, readStoredForeignRegNo, storeForeignRegNo, PII_PREFIX,
} from '../lib/pii'

// lib/pii 는 모듈 로드 시점이 아니라 호출 시점에 키를 읽는다. 첫 호출 전에 심어 두면 된다.
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x3d).toString('base64')

let pass = 0
let fail = 0
function ok(name: string, cond: boolean) {
  if (cond) { pass++; return }
  fail++
  console.error(`FAIL ${name}`)
}

const FAKE_KEY = '*1234#'
const FAKE_LONG = 'a1B2-c3D4 e5'
const ROOM = '11111111-2222-3333-4444-555555555555'
const OTHER_ROOM = '99999999-8888-7777-6666-555555555555'

// ── 왕복 ─────────────────────────────────────────────────────
const enc = storeRoomMasterKey(FAKE_KEY, ROOM)
ok('암호문 접두어 v1:', enc.startsWith(PII_PREFIX))
ok('암호문 조각 4개', enc.split(':').length === 4)
ok('암호문에 평문 없음', !enc.includes(FAKE_KEY) && !enc.includes('1234'))
ok('AAD 일치는 복원', readStoredRoomMasterKey(enc, ROOM) === FAKE_KEY)
ok('같은 평문도 매번 다른 암호문(IV)', storeRoomMasterKey(FAKE_KEY, ROOM) !== storeRoomMasterKey(FAKE_KEY, ROOM))
ok('공백·영문 섞인 코드도 그대로 복원', readStoredRoomMasterKey(storeRoomMasterKey(FAKE_LONG, ROOM), ROOM) === FAKE_LONG)

// ── AAD 불일치 — 다른 방 행에 옮겨 붙인 암호문은 평문이 안 나온다 ──────
ok('다른 방 id 로는 null', readStoredRoomMasterKey(enc, OTHER_ROOM) === null)

// 외국인등록번호 문과 AAD 공간이 갈려 있는가. 같은 id 라도 문이 다르면 서로 못 연다.
// 마스터키 AAD 가 맨 id 로 퇴행하면 여기서 붉어진다.
ok('마스터키 암호문을 신원번호 문으로 못 연다', readStoredForeignRegNo(enc, ROOM) === null)
ok('신원번호 암호문을 마스터키 문으로 못 연다', readStoredRoomMasterKey(storeForeignRegNo('9001015123456', ROOM), ROOM) === null)

// ── 변조 거부 ────────────────────────────────────────────────
const parts = enc.split(':')
const tamperedBody = [parts[0], parts[1], parts[2], Buffer.from('000000', 'utf8').toString('base64')].join(':')
ok('본문 변조 거부', readStoredRoomMasterKey(tamperedBody, ROOM) === null)
const tagBytes = Buffer.from(parts[2], 'base64')
tagBytes[0] ^= 0xff
const tamperedTag = [parts[0], parts[1], tagBytes.toString('base64'), parts[3]].join(':')
ok('태그 변조 거부', readStoredRoomMasterKey(tamperedTag, ROOM) === null)
ok('조각 모자란 값 거부', readStoredRoomMasterKey(`${PII_PREFIX}abc:def`, ROOM) === null)

// ── 빈 값·형식 ───────────────────────────────────────────────
ok('null 은 null', readStoredRoomMasterKey(null, ROOM) === null)
ok('undefined 는 null', readStoredRoomMasterKey(undefined, ROOM) === null)
ok('빈 문자열은 null', readStoredRoomMasterKey('', ROOM) === null)
ok('v1: 접두어 없는 평문은 거부', readStoredRoomMasterKey(FAKE_KEY, ROOM) === null)
ok('접두어만 다른 값(v2:)은 거부', readStoredRoomMasterKey(enc.replace(/^v1:/, 'v2:'), ROOM) === null)

// ── 키가 바뀌면 옛 암호문은 null(조용한 오복호 없음) ─────────────
{
  const keep = process.env.STAYEUM_PII_KEY
  process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x5c).toString('base64')
  ok('키 교체 뒤 옛 암호문은 null', readStoredRoomMasterKey(enc, ROOM) === null)
  process.env.STAYEUM_PII_KEY = keep
}

// ── 키 부재는 조용한 평문이 아니라 명시적 실패 ────────────────
{
  const keep = process.env.STAYEUM_PII_KEY
  delete process.env.STAYEUM_PII_KEY
  let threw = false
  try { storeRoomMasterKey(FAKE_KEY, ROOM) } catch { threw = true }
  ok('키 없으면 저장 실패', threw)
  process.env.STAYEUM_PII_KEY = keep
}

console.log(`[도어락 마스터키] 통과 ${pass} / 실패 ${fail}`)
if (fail) process.exit(1)
