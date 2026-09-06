'use server'

// 원격 서명 링크 공개 액션 — 생년월일 검증(HMAC 쿠키 발급)·원격 서명 제출. 운영자 인증 없음(토큰+쿠키가 자격).

import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { shareCookieName, SHARE_COOKIE_MAX_AGE_SEC } from '@/lib/contractShareCookie'
import { sanitizeNativeName } from '@/lib/documentName'
import { notifyPropertyOperators } from '@/lib/pushSend'
import { missingSlots } from '@/lib/disposalSignGate'
import { paperDocsOf, linkSignSlots, parseSignDocuments, parseDocumentSignatures, parseDocSignedAt, isValidDocKey } from '@/lib/signDocuments'
import { asSignLang, bi, type SignLang } from '@/lib/signGuideText'
import { asDocNameStyle } from '@/lib/documentName'

// 비활성 사유(없음·만료·닫힘·잠김)는 열거 정보 노출 방지를 위해 동일한 일반 안내로 답한다.
// 링크가 없거나 죽어 스냅샷을 못 읽는 자리라 언어를 모른다 — 한국어 + 영어 고정 병기다.
const INACTIVE_MSG = bi('ko', 'inactive.body')

/** 이 링크의 안내 언어 — 발급 때 스냅샷에 박제된 값. 옛 링크(키 없음)는 ko 다. */
function langOf(link: { templateSnapshot: unknown }): SignLang {
  return asSignLang((link.templateSnapshot as { signLang?: unknown } | null)?.signLang) ?? 'ko'
}

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
      const lockedMsg = bi(langOf(link), 'err.locked', { n: maxAttempts })
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
      return { ok: false, error: bi(langOf(link), 'err.birthMismatch', { n: maxAttempts - used }) }
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
    return { ok: false, error: bi('ko', 'gate.netFail') }
  }
}

export async function submitRemoteSignature(
  token: string,
  // 'contract' | 'disposal' | 추가 서류 key. 문자열로 넓혔지만 **화이트리스트는 서버가 쥔다** —
  // 아래에서 링크 스냅샷에 실제로 실린 서류 key 만 통과한다.
  target: string,
  dataUrl: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const link = await getActiveLink(token)
    if (!link) return { ok: false, error: INACTIVE_MSG }

    const cookieStore = await cookies()
    if (!cookieStore.get(shareCookieName(link.id))) {
      return { ok: false, error: bi(langOf(link), 'err.cookieExpired') }
    }
    // 추가 서류 key 는 **이 링크의 스냅샷에 실린 것**만 받는다. 그 종이에 없는 서류의 서명을
    // 받으면 어디에도 그릴 수 없는 고아 데이터가 쌓인다. 라이브 설정을 안 보는 이유 — 링크가
    // 나간 뒤 영업장이 서류를 중지해도, 살아 있는 링크의 입주자는 자기가 보고 있는 장에 마저
    // 서명할 수 있어야 한다(동의서의 라이브 검사와 일부러 다르다. 아래 주석 참조).
    const snapDocKeys = new Set(
      parseSignDocuments((link.templateSnapshot as { signDocuments?: unknown } | null)?.signDocuments).map(d => d.key))
    const isCustomTarget = target !== 'contract' && target !== 'disposal'
    if (isCustomTarget && !(isValidDocKey(target) && snapDocKeys.has(target))) {
      return { ok: false, error: bi(langOf(link), 'err.badRequest') }
    }
    // 'data:image/' 접두만 보면 data:image/svg+xml 이 통과해 서명란에 임의 벡터(위조 도장 등)를
    // 심을 수 있다. 손글씨 서명 캔버스가 만드는 래스터 두 종만 허용한다(E페이즈 2026-08-03).
    if (typeof dataUrl !== 'string' || !/^data:image\/(png|jpeg);base64,/.test(dataUrl)) {
      return { ok: false, error: bi(langOf(link), 'err.badImage') }
    }
    // 서명 이미지 크기 상한(적대검증 P2) — 세션 보유자가 임의 대형 문자열을 저장·PDF 에 투입하는 것 차단.
    // React 서버 액션 인자 디코더가 문자열 1,000,000 자에서 먼저 던지므로 그 아래에 사람 말 문을 둔다.
    // 종전 1_400_000 은 그 문보다 높아 1.0M~1.4M 구간에서 사람 말 대신 프레임워크 영어 오류가 났다.
    // 손글씨 서명은 수백 KB 이내라 여유가 크다(2026-09-03).
    if (dataUrl.length > 900_000) return { ok: false, error: bi(langOf(link), 'err.imageTooLarge') }

    // 잔여 소지품 동의서 서명은 그 영업장이 동의서를 켠 경우에만(적대검증 P2 — 서버 검사).
    // UI 는 이미 enabled 일 때만 패드를 그리지만, 액션 직접 호출로 비활성 영업장에 데이터가 쌓이는 것 차단.
    if (target === 'disposal') {
      const prop = await prisma.property.findUnique({ where: { id: link.propertyId }, select: { disposalConsentTemplate: true } })
      const dc = prop?.disposalConsentTemplate as { enabled?: boolean } | null
      if (!dc?.enabled) return { ok: false, error: bi(langOf(link), 'err.disposalOff') }
    }

    const now = new Date()
    // 서명 시점 본문을 lease 에 박제한다. 근거는 링크의 스냅샷이다 — 입주자가 눈으로 읽고 손으로
    // 서명한 것이 바로 그 JSON 이고(원격 화면은 DB 를 다시 안 읽는다), 다른 것을 담으면 근거가 약해진다.
    // 첫 서명에서만 만든다. 계약서·동의서 중 어느 쪽이 먼저 와도 값은 같다.
    const already = await prisma.leaseTerm.findUnique({
      where: { id: link.leaseTermId }, select: { signedContractSnapshot: true },
    })
    const snap = link.templateSnapshot as { template?: unknown; refundClauseInContract?: boolean; disposalConsent?: unknown; businessInfo?: unknown; subLeaseAddendum?: unknown; rateAddendum?: unknown; signDocuments?: unknown } | null
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
      // 요금 절도 같은 이유로 동결한다. 서명한 화면에 있었으면 재발급본에도 있어야 하고,
      // 없었으면 나중에 생겨서도 안 된다 — 요금 조항이 소급되면 서명 격리를 스스로 깨는 것이다.
      rateAddendum: (snap.rateAddendum ?? null) as object,
      // 추가 서류 목록도 동결한다. 서명한 화면에 있던 장은 재발급본에도 있어야 하고, 없던 장이
      // 나중에 생겨서도 안 된다(특약 두 칸과 같은 규칙). 이 칸이 생기기 전 링크에는 없다 —
      // 그때는 빈 배열로 굳는다.
      signDocuments: (snap.signDocuments ?? []) as object,
      // 이 사람이 눈으로 읽고 손으로 서명한 성명 표기. 근거는 링크 스냅샷이다 — 원격 화면은
      // DB 를 다시 안 읽으므로 그 JSON 이 곧 그 사람이 본 종이다.
      // 이 칸이 생기기 전 박제에는 없다(undefined). 그때는 오버라이드 또는 한글로 읽는다.
      nameStyle: asDocNameStyle((snap as { lease?: { nameStyle?: unknown } }).lease?.nameStyle) ?? null,
      printedName: typeof (snap as { tenant?: { name?: unknown } }).tenant?.name === 'string'
        ? (snap as { tenant: { name: string } }).tenant.name : null,
    }
    if (isCustomTarget) {
      // 추가 서류는 Json 맵이라 읽고-병합-쓰기다. 인터랙티브 트랜잭션이 아니면 두 서명이
      // 동시에 들어올 때 나중 쓰기가 먼저 것을 통째로 덮는다(Json 병합 유실 클래스).
      await prisma.$transaction(async tx => {
        const cur = await tx.leaseTerm.findUnique({
          where: { id: link.leaseTermId }, select: { documentSignatures: true },
        })
        const sigs = parseDocumentSignatures(cur?.documentSignatures)
        sigs[target] = { image: dataUrl, signedAt: now.toISOString() }
        await tx.leaseTerm.update({
          where: { id: link.leaseTermId },
          data: { documentSignatures: sigs, ...(newSnapshot ? { signedContractSnapshot: newSnapshot } : {}) },
        })
        const curLink = await tx.contractShareLink.findUnique({
          where: { id: link.id }, select: { docSignedAt: true },
        })
        const marks = parseDocSignedAt(curLink?.docSignedAt)
        marks[target] = now.toISOString()
        await tx.contractShareLink.update({ where: { id: link.id }, data: { docSignedAt: marks } })
      }, { isolationLevel: 'Serializable' })
      return { ok: true }
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
    return { ok: false, error: bi('ko', 'err.saveFail') }
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
      return { ok: false, error: bi(langOf(link), 'err.cookieExpired') }
    }
    // 계약서 서명이 이미 저장돼 있어야 제출 가능.
    if (!link.signedAt) return { ok: false, error: bi(langOf(link), 'err.signFirst') }
    // 동의서도 서버가 본다. 종전에는 이 검사가 클라이언트 canSubmit 에만 있어서, 액션을 직접 부르면
    // 반쪽 서명으로 제출이 통과했다. 판정 축은 canSubmit 과 같은 것(발급 시점 스냅샷)을 쓴다 —
    // 라이브 설정을 보면 링크가 나간 뒤 영업장이 동의서를 끄고 켤 때 두 자리가 서로 물린다.
    // 이 링크의 종이에 실린 서류 전부가 이 링크에서 서명됐는가 — **링크 축**이다. 입주자 앞의
    // 종이는 이 링크의 스냅샷이고 그 위의 서명은 이 링크의 자국이다(이어받기가 자국을 승계한다).
    const left = missingSlots({ slots: linkSignSlots(paperDocsOf(link.templateSnapshot), link) })
      .filter(x => x.key !== 'contract')   // 계약서는 위에서 이미 제 문구로 걸렀다
    if (left.some(x => x.key === 'disposal')) {
      return { ok: false, error: bi(langOf(link), 'err.disposalLeft') }
    }
    if (left.length > 0) {
      return { ok: false, error: bi(langOf(link), 'err.docLeft', { title: left[0].title }) }
    }

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
    return { ok: false, error: bi('ko', 'err.submitFail') }
  }
}
