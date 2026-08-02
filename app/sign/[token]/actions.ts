'use server'

// 원격 서명 링크 공개 액션 — 생년월일 검증(HMAC 쿠키 발급)·원격 서명 제출. 운영자 인증 없음(토큰+쿠키가 자격).

import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { shareCookieName, SHARE_COOKIE_MAX_AGE_SEC } from '@/lib/contractShareCookie'
import { notifyPropertyOperators } from '@/lib/pushSend'

// 비활성 사유(없음·만료·닫힘·잠김)는 열거 정보 노출 방지를 위해 동일한 일반 안내로 답한다.
const INACTIVE_MSG = '링크가 만료되었거나 사용할 수 없습니다. 관리자에게 다시 요청해 주세요.'
const MAX_ATTEMPTS = 5

async function getActiveLink(token: string) {
  if (typeof token !== 'string' || !token) return null
  const link = await prisma.contractShareLink.findUnique({ where: { token } })
  // submittedAt = 원격 제출 확정 — 재접속·재서명 차단(closedAt 무산 닫기와 구분, 운영자 승인 2026-07-23)
  if (!link || link.closedAt || link.submittedAt || link.lockedAt || link.expiresAt <= new Date()) return null
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
      // 원자적 조건부 증가 — birthdateAttempts < MAX 인 행만 갱신(적대검증 P1: read-then-increment 경합으로
      // 동시 요청이 잠금 전에 5회를 넘겨 전수 대입하던 창을 없앤다). 갱신행 0 = 이미 한도 도달 = 잠금.
      const bumped = await prisma.contractShareLink.updateMany({
        where: { id: link.id, birthdateAttempts: { lt: MAX_ATTEMPTS } },
        data: { birthdateAttempts: { increment: 1 } },
      })
      if (bumped.count === 0) {
        // 이 시도로 한도에 처음 닿았거나 이미 초과 — lockedAt 을 멱등 세팅(아직 null 인 것만)
        await prisma.contractShareLink.updateMany({ where: { id: link.id, lockedAt: null }, data: { lockedAt: new Date() } })
        return { ok: false, error: '입력 오류가 5회가 되어 링크가 잠겼습니다. 관리자에게 다시 요청해 주세요.' }
      }
      const cur = await prisma.contractShareLink.findUnique({ where: { id: link.id }, select: { birthdateAttempts: true } })
      const used = cur?.birthdateAttempts ?? MAX_ATTEMPTS
      if (used >= MAX_ATTEMPTS) {
        await prisma.contractShareLink.updateMany({ where: { id: link.id, lockedAt: null }, data: { lockedAt: new Date() } })
        return { ok: false, error: '입력 오류가 5회가 되어 링크가 잠겼습니다. 관리자에게 다시 요청해 주세요.' }
      }
      return { ok: false, error: `생년월일이 일치하지 않습니다. 남은 시도 ${MAX_ATTEMPTS - used}회.` }
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
    // 'data:image/' 접두만 보면 data:image/svg+xml 이 통과해 서명란에 임의 벡터(위조 도장 등)를
    // 심을 수 있다. 손글씨 서명 캔버스가 만드는 래스터 두 종만 허용한다(E페이즈 2026-08-03).
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(dataUrl)) {
      return { ok: false, error: '서명 이미지가 올바르지 않습니다.' }
    }
    // 서명 이미지 크기 상한(적대검증 P2) — 세션 보유자가 최대 10MB 임의 문자열을 저장·PDF 에 투입하는 것 차단.
    // 손글씨 서명은 수백 KB 이내라 1MB 여유 상한. base64 는 원본의 약 1.37배.
    if (dataUrl.length > 1_400_000) return { ok: false, error: '서명 이미지가 너무 큽니다. 다시 서명해 주세요.' }

    // 잔여 소지품 동의서 서명은 그 영업장이 동의서를 켠 경우에만(적대검증 P2 — 서버 검사).
    // UI 는 이미 enabled 일 때만 패드를 그리지만, 액션 직접 호출로 비활성 영업장에 데이터가 쌓이는 것 차단.
    if (target === 'disposal') {
      const prop = await prisma.property.findUnique({ where: { id: link.propertyId }, select: { disposalConsentTemplate: true } })
      const dc = prop?.disposalConsentTemplate as { enabled?: boolean } | null
      if (!dc?.enabled) return { ok: false, error: '이 영업장은 잔여 소지품 동의서를 사용하지 않습니다.' }
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

// 원격 서명 최종 제출 — 확인 팝업을 거친 뒤 호출된다. submittedAt 을 찍어 재접속 시 계약서가
// 다시 열리지 않게 하고(page.tsx 가 '제출 완료'로 안내), 운영자에게 웹푸시를 발송한다(best-effort).
// closedAt 이 아니라 submittedAt 을 쓰는 이유 — 종 알림의 '정식 계약서 발급' 리마인더는 closedAt: null
// 조건이라, 제출로 closedAt 을 찍으면 발급 전 리마인더가 사라진다(운영자 결정: 발급 전까지 유지, 2026-07-23).
export async function finalizeRemoteSubmission(
  token: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const link = await getActiveLink(token)
    if (!link) return { ok: false, error: INACTIVE_MSG }

    const cookieStore = await cookies()
    if (!cookieStore.get(shareCookieName(link.id))) {
      return { ok: false, error: '본인 확인이 만료되었습니다. 페이지를 새로고침해 생년월일을 다시 입력해 주세요.' }
    }
    // 계약서 서명이 이미 저장돼 있어야 제출 가능(동의서 유무는 클라이언트 canSubmit 가 게이트).
    if (!link.signedAt) return { ok: false, error: '먼저 서명을 완료해 주세요.' }

    // 제출 확정 — submittedAt 잠금(재접속 차단). 서명본은 LeaseTerm 에 이미 영속돼 운영자 화면에서 조회된다.
    await prisma.contractShareLink.update({ where: { id: link.id }, data: { submittedAt: new Date() } })

    // 운영자 웹푸시(best-effort) — 실패해도 제출은 성공 처리
    const tenant = await prisma.tenant.findUnique({ where: { id: link.tenantId }, select: { name: true } })
    const name = tenant?.name || '입주자'
    await notifyPropertyOperators(link.propertyId, {
      source: 'contract-signed',
      title: '계약서 서명 제출',
      body: `${name}님이 입실 계약서에 서명했습니다.`,
      url: '/contracts',
      tag: 'stayeum-contract-signed',
    })

    return { ok: true }
  } catch {
    return { ok: false, error: '제출에 실패했습니다. 잠시 후 다시 시도해 주세요.' }
  }
}
