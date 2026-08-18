'use server'

// 원격 서명 링크 공개 액션 — 생년월일 검증(HMAC 쿠키 발급)·원격 서명 제출. 운영자 인증 없음(토큰+쿠키가 자격).

import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { shareCookieName, SHARE_COOKIE_MAX_AGE_SEC } from '@/lib/contractShareCookie'
import { sanitizeNativeName } from '@/lib/documentName'
import { notifyPropertyOperators } from '@/lib/pushSend'

// 비활성 사유(없음·만료·닫힘·잠김)는 열거 정보 노출 방지를 위해 동일한 일반 안내로 답한다.
const INACTIVE_MSG = '링크가 만료되었거나 사용할 수 없습니다. 관리자에게 다시 요청해 주세요.'

// 생년월일 확인 시도 한도. 기본은 5회지만, 외국인등록번호가 실린 계약서는 3회로 줄인다.
// 게이트를 뚫었을 때 새는 것의 크기가 다르기 때문이다. 생년월일은 8자리이고 그중 앞자리는
// 대개 짐작 가능해 실제 탐색 공간이 작다. 그 문 뒤에 신원번호가 있으면 시도 예산도 줄여야 한다.
const MAX_ATTEMPTS_DEFAULT = 5
const MAX_ATTEMPTS_WITH_ID = 3

// 판정 근거는 링크 스냅샷이다. 스냅샷에는 평문이 없고 등록 여부 플래그만 남아 있다(contractShare).
// 지금 입주자 행을 다시 읽지 않는 이유는, 링크가 나간 뒤에 번호를 지워도 **그 링크가 나를 때 실린
// 계약서에는 번호가 있었기** 때문이다. 한도는 그 종이를 기준으로 정해져야 한다.
function maxAttemptsFor(templateSnapshot: unknown): number {
  const snap = templateSnapshot as { tenant?: { hasForeignRegNo?: boolean } } | null
  return snap?.tenant?.hasForeignRegNo ? MAX_ATTEMPTS_WITH_ID : MAX_ATTEMPTS_DEFAULT
}

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
      const maxAttempts = maxAttemptsFor(link.templateSnapshot)
      const lockedMsg = `입력 오류가 ${maxAttempts}회가 되어 링크가 잠겼습니다. 관리자에게 다시 요청해 주세요.`
      // 원자적 조건부 증가 — birthdateAttempts < MAX 인 행만 갱신(적대검증 P1: read-then-increment 경합으로
      // 동시 요청이 잠금 전에 한도를 넘겨 전수 대입하던 창을 없앤다). 갱신행 0 = 이미 한도 도달 = 잠금.
      const bumped = await prisma.contractShareLink.updateMany({
        where: { id: link.id, birthdateAttempts: { lt: maxAttempts } },
        data: { birthdateAttempts: { increment: 1 } },
      })
      if (bumped.count === 0) {
        // 이 시도로 한도에 처음 닿았거나 이미 초과 — lockedAt 을 멱등 세팅(아직 null 인 것만)
        await prisma.contractShareLink.updateMany({ where: { id: link.id, lockedAt: null }, data: { lockedAt: new Date() } })
        return { ok: false, error: lockedMsg }
      }
      const cur = await prisma.contractShareLink.findUnique({ where: { id: link.id }, select: { birthdateAttempts: true } })
      const used = cur?.birthdateAttempts ?? maxAttempts
      if (used >= maxAttempts) {
        await prisma.contractShareLink.updateMany({ where: { id: link.id, lockedAt: null }, data: { lockedAt: new Date() } })
        return { ok: false, error: lockedMsg }
      }
      return { ok: false, error: `생년월일이 일치하지 않습니다. 남은 시도 ${maxAttempts - used}회.` }
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
    // 서명 시점 본문을 lease 에 박제한다. 근거는 링크의 스냅샷이다 — 입주자가 눈으로 읽고 손으로
    // 서명한 것이 바로 그 JSON 이고(원격 화면은 DB 를 다시 안 읽는다), 다른 것을 담으면 근거가 약해진다.
    // 첫 서명에서만 만든다. 계약서·동의서 중 어느 쪽이 먼저 와도 값은 같다.
    const already = await prisma.leaseTerm.findUnique({
      where: { id: link.leaseTermId }, select: { signedContractSnapshot: true },
    })
    const snap = link.templateSnapshot as { template?: unknown; refundClauseInContract?: boolean; disposalConsent?: unknown; businessInfo?: unknown; subLeaseAddendum?: unknown } | null
    const newSnapshot = already?.signedContractSnapshot || !snap?.template ? null : {
      origin: 'REMOTE_LINK', capturedAt: now.toISOString(),
      template: snap.template as object,
      refundClauseInContract: snap.refundClauseInContract ?? true,
      disposalConsent: (snap.disposalConsent ?? null) as object,
      businessInfo: (snap.businessInfo ?? null) as object,
      // 추가 호실 특약도 함께 동결한다. 입주자가 읽고 서명한 화면에 그 절이 있었으면
      // 재발급된 종이에도 있어야 하고, 없었으면 나중에 생겨서도 안 된다.
      // 이 칸이 생기기 전 링크에는 없다(undefined) — 그때는 null 로 굳어 절이 안 붙는다.
      subLeaseAddendum: (snap.subLeaseAddendum ?? null) as object,
    }
    await prisma.$transaction([
      prisma.leaseTerm.update({
        where: { id: link.leaseTermId },
        // 시각도 함께 남긴다. 링크에만 있으면 대면 서명과 읽는 자리가 갈리고,
        // 무엇보다 계약일을 정할 때 링크를 따로 찾아가야 한다. now 는 아래 링크 갱신과 같은 값이다.
        data: {
          ...(target === 'contract'
            ? { signatureImageUrl: dataUrl, signatureSignedAt: now }
            : { disposalSignatureImageUrl: dataUrl, disposalSignatureSignedAt: now }),
          ...(newSnapshot ? { signedContractSnapshot: newSnapshot } : {}),
        },
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
// nativeName: 입주자가 서명 화면에서 직접 적은 본국 표기 이름(선택 입력).
export async function finalizeRemoteSubmission(
  token: string,
  nativeName?: string,
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

    // 본국 표기 이름 — **비어 있을 때만** 채운다.
    //
    // 이 경로는 로그인이 없다. 자격은 문자로 나간 토큰과 생년월일뿐이고, 링크는 전달될 수 있다.
    // 그런 문에서 고객 정보를 덮어쓰게 두면 링크를 가진 누구든 운영자가 적어 둔 표기를 갈아치울 수
    // 있다. 그래서 조건부 updateMany 로 **아직 비어 있는 행만** 갱신한다 — 읽고 나서 쓰는 방식은
    // 그 사이에 값이 생기면 덮어쓰므로 쓰지 않는다. 갱신행 0 은 이미 값이 있다는 뜻이고 조용히 지난다
    // (있다/없다를 답으로 돌려주면 링크 소지자가 고객 정보의 상태를 캐낼 수 있다).
    // 화면도 스냅샷에 표기가 없을 때만 칸을 그리므로 정상 흐름에서는 이 경합 자체가 드물다.
    // 값을 지우거나 고치는 것은 이 문으로 못 한다 — 운영자만 고객 정보에서 한다.
    const native = sanitizeNativeName(nativeName)
    if (native) {
      await prisma.tenant.updateMany({
        where: { id: link.tenantId, OR: [{ nativeName: null }, { nativeName: '' }] },
        data: { nativeName: native },
      })
    }

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
