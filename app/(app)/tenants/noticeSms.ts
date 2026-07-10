'use server'

// 단체 공지 문자 서버 액션 — 조건(층·창) 대상 조회·공지 템플릿·발송 이력·AI 문구 다듬기 (R4, 신고 4fad73fa)

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { requireEdit } from '@/lib/role'

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

// 층 유추 — room-manage와 동일 규칙(끝 두 자리 앞이 층)
function deriveFloor(roomNo: string): string {
  const digits = roomNo.replace(/\D/g, '')
  if (digits.length >= 3) return digits.slice(0, digits.length - 2)
  return ''
}

export type NoticeSmsTarget = {
  tenantId: string
  leaseTermId: string
  name: string
  roomNo: string
  floor: string          // '' = 유추 불가
  windowType: string | null
  phone: string | null   // null = 연락처 미등록(발송 불가, 목록에 회색 표시)
}

// 입주 중(ACTIVE·퇴실 예정 포함) 전체 — 필터 칩(층·창)은 클라이언트가 이 데이터에서 도출한다.
export async function getNoticeSmsTargets(): Promise<{ ok: true; targets: NoticeSmsTarget[] } | { ok: false; error: string }> {
  try {
    const propertyId = await getPropertyId()
    const leases = await prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] }, roomId: { not: null } },
      select: {
        id: true,
        tenantId: true,
        room: { select: { roomNo: true, floor: true, windowType: true } },
        tenant: {
          select: {
            name: true,
            contacts: { where: { contactType: 'PHONE' }, orderBy: { createdAt: 'asc' }, select: { contactValue: true }, take: 1 },
          },
        },
      },
    })
    const targets: NoticeSmsTarget[] = leases
      .filter(l => l.room && l.tenant)
      .map(l => ({
        tenantId: l.tenantId,
        leaseTermId: l.id,
        name: l.tenant.name,
        roomNo: l.room!.roomNo,
        floor: (l.room!.floor ?? '').trim() || deriveFloor(l.room!.roomNo),
        windowType: l.room!.windowType,
        phone: l.tenant.contacts[0]?.contactValue?.trim() || null,
      }))
      .sort((a, b) => a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true }))
    return { ok: true, targets }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '대상을 불러오지 못했습니다.' }
  }
}

// 발송 시도 기록 — 수신자별 1행(kind: 'notice'). 실제 발송은 폰 문자앱에서 완료된다.
export async function logNoticeSmsAttempt(input: {
  tenantIds: string[]
  body: string
  filterLabel: string   // '전체' | '4층' | '외창' 등 — 본문 앞에 조건 메모로 남긴다
}): Promise<{ ok: true; count: number } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const propertyId = await getPropertyId()
    const body = input.body.trim()
    if (!body) return { ok: false, error: '본문이 비어 있습니다.' }
    if (input.tenantIds.length === 0) return { ok: false, error: '수신자가 없습니다.' }
    // 영업장 소속 검증 — 다른 영업장 tenantId 혼입 방지
    const owned = await prisma.tenant.findMany({ where: { id: { in: input.tenantIds }, propertyId }, select: { id: true } })
    const ownedIds = owned.map(t => t.id)
    if (ownedIds.length === 0) return { ok: false, error: '수신자를 찾을 수 없습니다.' }
    await prisma.smsLog.createMany({
      data: ownedIds.map(tenantId => ({
        propertyId,
        tenantId,
        renderedBody: `[단체 공지 · ${input.filterLabel}] ${body}`,
        sentVia: 'manual_sms',
        kind: 'notice',
      })),
    })
    return { ok: true, count: ownedIds.length }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '이력 기록에 실패했습니다.' }
  }
}

// AI 문구 다듬기 — 운영자 초안을 공지 톤(정중·간결)으로. 채택은 운영자가 결정.
export async function polishNoticeText(draft: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    const src = draft.trim()
    if (!src) return { ok: false, error: '다듬을 초안을 먼저 입력하세요.' }
    const apiKey = process.env.GEMINI_API_KEY
    if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY가 설정되지 않았습니다.' }

    const prompt = `아래는 고시원(원룸텔) 운영자가 입주자 전체 또는 일부에게 보낼 공지 문자 초안이다.
정중하고 간결한 공지 톤으로 다듬어라. 규칙:
- 핵심 내용(날짜·시간·장소·요청 사항)은 빠뜨리지 말 것
- 이모지·느낌표·과장 표현 금지, 존댓말 사용
- 문자 1~2통 분량(한글 180자 이내 권장)으로 압축
- 다듬어진 본문만 출력(설명·머리말 금지)

초안:
${src}`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 500 },
        }),
      }
    )
    if (!res.ok) return { ok: false, error: `AI 응답 실패 (${res.status})` }
    const json = await res.json()
    const text: string = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? ''
    if (!text) return { ok: false, error: 'AI가 문구를 만들지 못했습니다. 다시 시도해 주세요.' }
    return { ok: true, text }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? 'AI 다듬기에 실패했습니다.' }
  }
}
