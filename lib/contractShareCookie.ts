// 원격 서명 링크 생년월일 통과 쿠키 — HMAC 기반 쿠키 이름 계산 (서버 전용).
// 쿠키 이름 = sign_<HMAC-SHA256(SECRET, linkId)>. 올바른 이름의 쿠키 존재 자체가 통과 증명이라 값은 '1' 고정.
// SECRET 은 신규 env 도입 없이 기존 서버 비밀 재사용(SUPABASE_SERVICE_ROLE_KEY, 없으면 DATABASE_URL).
import 'server-only'
import { createHmac } from 'crypto'

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.DATABASE_URL ?? ''

export const SHARE_COOKIE_MAX_AGE_SEC = 2 * 60 * 60   // 생년월일 통과 후 2시간 유지

export function shareCookieName(linkId: string): string {
  if (!SECRET) throw new Error('서버 비밀 키가 설정되지 않았습니다.')
  return `sign_${createHmac('sha256', SECRET).update(linkId).digest('hex')}`
}
