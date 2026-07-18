'use server'

// 원격 서명 링크 공개 액션 — 생년월일 검증(HMAC 쿠키 발급)·원격 서명 제출. 운영자 인증 없음(토큰+쿠키가 자격).

import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { shareCookieName, SHARE_COOKIE_MAX_AGE_SEC } from '@/lib/contractShareCookie'

// 비활성 사유(없음·만료·닫힘·잠김)는 열거 정보 노출 방지를 위해 동일한 일반 안내로 답한다.
const INACTIVE_MSG = '링크가 만료되었거나 사용할 수 없습니다. 관리자에게 다시 요청해 주세요.'
const MAX_ATTEMPTS = 5

async function getActiveLink(token: string) {
  if (typeof token !== 'string' || !token) return null
  const link = await prisma.contractShareLink.findUnique({ where: { token } })
  if (!link || link.closedAt || link.lockedAt || link.expiresAt <= new Date()) return null
  return link
}

export async function verifyShareBirthdate(
  token: string,
  ymd: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const link = await getActiveLink(token)
    if (!link) return { ok: false, error: INACTIVE_MSG }

    const tenant = await prisma.tenant.findUnique({ where: { id: link.tenantId }, select: { birthdate: true } })
    // TZ off-by-one 방지 — DB Date 를 ISO YYYY-MM-DD 로 정규화해 문자열 비교
    const expected = tenant?.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null
    const input = typeof ymd === 'string' ? ymd.trim() : ''

    if (!expected || expected !== input) {
      const updated = await prisma.contractShareLink.update({
        where: { id: link.id },
        data: { birthdateAttempts: { increment: 1 } },
        select: { birthdateAttempts: true },
      })
      if (updated.birthdateAttempts >= MAX_ATTEMPTS) {
        await prisma.contractShareLink.update({ where: { id: link.id }, data: { lockedAt: new Date() } })
        return { ok: false, error: '입력 오류가 5회가 되어 링크가 잠겼습니다. 관리자에게 다시 요청해 주세요.' }
      }
      return { ok: false, error: `생년월일이 일치하지 않습니다. 남은 시도 ${MAX_ATTEMPTS - updated.birthdateAttempts}회.` }
    }

    // 통과 — httpOnly HMAC 쿠키 발급. 유지시간 = min(2시간, 링크 남은 TTL)
    const remainingSec = Math.max(1, Math.floor((link.expiresAt.getTime() - Date.now()) / 1000))
    const cookieStore = await cookies()
    cookieStore.set(shareCookieName(link.id), '1', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/sign',
      maxAge: Math.min(SHARE_COOKIE_MAX_AGE_SEC, remainingSec),
    })
    return { ok: true }
  } catch {
    return { ok: false, error: '확인에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}

export async function submitRemoteSignature(
  token: string,
  target: 'contract' | 'disposal',
  dataUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const link = await getActiveLink(token)
    if (!link) return { ok: false, error: INACTIVE_MSG }

    const cookieStore = await cookies()
    if (!cookieStore.get(shareCookieName(link.id))) {
      return { ok: false, error: '본인 확인이 만료되었습니다. 페이지를 새로고침해 생년월일을 다시 입력해 주세요.' }
    }
    if (target !== 'contract' && target !== 'disposal') return { ok: false, error: '잘못된 요청입니다.' }
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) {
      return { ok: false, error: '서명 이미지가 올바르지 않습니다.' }
    }

    const now = new Date()
    await prisma.$transaction([
      prisma.leaseTerm.update({
        where: { id: link.leaseTermId },
        data: target === 'contract' ? { signatureImageUrl: dataUrl } : { disposalSignatureImageUrl: dataUrl },
      }),
      prisma.contractShareLink.update({
        where: { id: link.id },
        data: target === 'contract' ? { signedAt: now } : { disposalSignedAt: now },
      }),
    ])
    return { ok: true }
  } catch {
    return { ok: false, error: '서명 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
