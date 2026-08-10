import 'server-only'

// 개인정보 암복호 정본. AES-256-GCM, 키는 환경변수 STAYEUM_PII_KEY(base64 32바이트) 하나다.
//
// 저장 형식은 `v1:<iv>:<tag>:<ct>` 이고 AAD 로 입주자 id 를 묶는다. AAD 를 묶는 이유는
// 암호문 한 덩어리를 다른 입주자 행에 옮겨 붙이는 것을 복호 단계에서 실패로 만들기 위해서다.
//
// 키가 없으면 저장을 명시적으로 실패시킨다. 평문으로 조용히 떨어지는 경로는 두지 않는다.
// 그 한 줄이 있으면 키를 등록하지 않은 환경에서 평문이 DB 에 그대로 쌓이고, 아무도 모른다.
//
// 평문을 꺼내는 문은 readStoredForeignRegNo 하나다. decryptPii 는 이 파일 밖에서 부르지 않는다.
// scripts/check-pii-plaintext.ts 축 D 가 그 명단을 지킨다.

import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto'
import { maskForeignRegNo } from '@/lib/foreignRegNo'

const ENV_KEY = 'STAYEUM_PII_KEY'
const KEY_BYTES = 32
const IV_BYTES = 12
const FINGERPRINT_LABEL = 'stayeum-pii-fingerprint-v1'

/** 저장 형식 버전 접두어. 감지망이 전 행에 대해 이 접두어를 확인한다. */
export const PII_PREFIX = 'v1:'

export const PII_KEY_MISSING =
  '개인정보 암호화 키(STAYEUM_PII_KEY)가 없어 저장할 수 없습니다. 서버 환경변수를 먼저 등록해 주세요.'

function masterKey(): Buffer {
  const raw = process.env[ENV_KEY]
  if (!raw) throw new Error(PII_KEY_MISSING)
  const key = Buffer.from(raw, 'base64')
  if (key.length !== KEY_BYTES) {
    throw new Error('개인정보 암호화 키 길이가 올바르지 않습니다. base64 로 인코딩한 32바이트여야 합니다.')
  }
  return key
}

/** 키가 등록돼 있는가. 화면이 저장 버튼을 열기 전에 물어볼 때 쓴다. */
export function hasPiiKey(): boolean {
  try { masterKey(); return true } catch { return false }
}

export function encryptPii(plain: string, aad: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', masterKey(), iv)
  cipher.setAAD(Buffer.from(aad, 'utf8'))
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return `${PII_PREFIX}${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${ct.toString('base64')}`
}

export function decryptPii(stored: string, aad: string): string {
  if (!stored.startsWith(PII_PREFIX)) throw new Error('저장된 값이 암호문 형식이 아닙니다.')
  const parts = stored.split(':')
  if (parts.length !== 4 || !parts[1] || !parts[2] || !parts[3]) {
    throw new Error('저장된 값이 암호문 형식이 아닙니다.')
  }
  const decipher = createDecipheriv('aes-256-gcm', masterKey(), Buffer.from(parts[1], 'base64'))
  decipher.setAAD(Buffer.from(aad, 'utf8'))
  decipher.setAuthTag(Buffer.from(parts[2], 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(parts[3], 'base64')), decipher.final()]).toString('utf8')
}

/**
 * 박제용 지문 8자리. 순수 sha256 을 쓰면 안 된다. 후보가 13자리 숫자뿐이라 전수조사로
 * 원본이 그대로 복원된다. 마스터 키에서 파생한 HMAC 이라 키를 모르면 대조표를 못 만든다.
 */
export function piiFingerprint(plain: string): string {
  const derived = createHmac('sha256', masterKey()).update(FINGERPRINT_LABEL).digest()
  return createHmac('sha256', derived).update(plain, 'utf8').digest('hex').slice(0, 8)
}

// ── 외국인등록번호 전용 문 ──────────────────────────────────────

/** 저장할 암호문. 검증은 부르는 쪽(lib/foreignRegNo validate)이 이미 끝냈다는 전제다. */
export function storeForeignRegNo(digits: string, tenantId: string): string {
  return encryptPii(digits, tenantId)
}

/**
 * 평문을 꺼내는 유일한 문. 복호에 실패하면 null 이다(키 교체·행 이동·손상).
 * 이 함수를 부르는 곳은 감지망 축 D 의 명단에 올라 있어야 한다.
 */
export function readStoredForeignRegNo(enc: string | null | undefined, tenantId: string): string | null {
  if (!enc) return null
  try { return decryptPii(enc, tenantId) } catch { return null }
}

/**
 * 화면에 내려보낼 마스킹 값. 복호가 안 되면 앞자리도 모르므로 전부 별표다.
 * 등록 여부 자체는 숨기지 않는다. 운영자가 다시 입력해야 하는지 알아야 하기 때문이다.
 */
export function maskStoredForeignRegNo(enc: string | null | undefined, tenantId: string): string | null {
  if (!enc) return null
  const plain = readStoredForeignRegNo(enc, tenantId)
  return plain ? maskForeignRegNo(plain) : '******-*******'
}

/**
 * 발급본 박제에 남길 값. 마스킹 + 지문이고 평문은 어디에도 없다.
 * 발급 상세 시트는 `#` 앞까지만 보여준다.
 */
export function foreignRegNoFact(plain: string | null | undefined): string | null {
  if (!plain) return null
  return `${maskForeignRegNo(plain)}#${piiFingerprint(plain)}`
}
