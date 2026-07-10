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
  phone: string | null   // null = 연락처 미등록(발송 불가, 목록에 회색 표시)
  // 조건 축 원값 — 방 정보
  floor: string          // '' = 유추 불가
  windowType: string | null
  direction: string | null
  tier: string | null
  roomType: string | null
  // 조건 축 원값 — 고객 정보
  gender: string         // MALE/FEMALE/OTHER/UNKNOWN
  nationality: string | null
  smoking: boolean
  job: string | null
  isBasicRecipient: boolean
  stayBucket: string | null   // 거주기간 구간(입주일 기준)
  // 조건 축 원값 — 수납 정보
  payMethod: string | null    // 최근 결제수단(보증금 제외)
}

// 거주기간 구간 — 초심자도 읽히는 3구간(입주일 없으면 null)
function stayBucketOf(moveInDate: Date | null): string | null {
  if (!moveInDate) return null
  const months = (Date.now() - moveInDate.getTime()) / (1000 * 3600 * 24 * 30.44)
  if (months < 6) return '6개월 미만'
  if (months < 12) return '6개월~1년'
  return '1년 이상'
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
        moveInDate: true,
        room: { select: { roomNo: true, floor: true, windowType: true, direction: true, tier: true, type: true } },
        tenant: {
          select: {
            name: true, gender: true, nationality: true, smoking: true, job: true, isBasicRecipient: true,
            contacts: { where: { contactType: 'PHONE' }, orderBy: { createdAt: 'asc' }, select: { contactValue: true }, take: 1 },
          },
        },
      },
    })
    // 최근 결제수단(보증금 제외) — 고객별 1건. 수납 폼 프리필과 같은 정의.
    const payRows = await prisma.paymentRecord.findMany({
      where: { tenantId: { in: leases.map(l => l.tenantId) }, payMethod: { not: null }, isDeposit: false, propertyId },
      orderBy: [{ payDate: 'desc' }, { createdAt: 'desc' }],
      select: { tenantId: true, payMethod: true },
    })
    const payByTenant = new Map<string, string>()
    for (const r of payRows) if (!payByTenant.has(r.tenantId)) payByTenant.set(r.tenantId, r.payMethod!)

    const targets: NoticeSmsTarget[] = leases
      .filter(l => l.room && l.tenant)
      .map(l => ({
        tenantId: l.tenantId,
        leaseTermId: l.id,
        name: l.tenant.name,
        roomNo: l.room!.roomNo,
        phone: l.tenant.contacts[0]?.contactValue?.trim() || null,
        floor: (l.room!.floor ?? '').trim() || deriveFloor(l.room!.roomNo),
        windowType: l.room!.windowType,
        direction: l.room!.direction?.trim() || null,
        tier: l.room!.tier?.trim() || null,
        roomType: l.room!.type?.trim() || null,
        gender: l.tenant.gender,
        nationality: l.tenant.nationality?.trim() || null,
        smoking: l.tenant.smoking,
        job: l.tenant.job?.trim() || null,
        isBasicRecipient: l.tenant.isBasicRecipient,
        stayBucket: stayBucketOf(l.moveInDate),
        payMethod: payByTenant.get(l.tenantId) ?? null,
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
    const propertyId = await getPropertyId()
    const src = draft.trim()
    if (!src) return { ok: false, error: '다듬을 초안을 먼저 입력하세요.' }
    // BYOK — AI 다듬기는 영업장 본인 키 등록 시 사용(운영자 결정 2026-07-10). 앱 공용 키 폴백 없음.
    const prop = await prisma.property.findUnique({ where: { id: propertyId }, select: { name: true, geminiApiKey: true, geminiModel: true } })
    const apiKey = prop?.geminiApiKey?.trim()
    if (!apiKey) return { ok: false, error: '환경설정의 AI 설정에서 본인 제미나이 API 키를 등록하면 사용할 수 있습니다. 발급 방법은 그 옆 안내를 참고하세요.' }
    const model = prop?.geminiModel?.trim() || 'gemini-2.5-flash'
    const propName = prop?.name?.trim() || '관리실'

    const prompt = `너는 고시원(원룸텔) 운영자를 돕는 공지 문자 작성자다. 발신 주체는 '${propName}'이다.
아래 초안을 입주자에게 바로 보낼 수 있는 완성된 공지 문자로 만들어라.

규칙:
- 초안이 "~공지 써줘" 같은 요청문이면, 요청 내용을 실제 공지 본문으로 작성한다(요청 문구를 그대로 남기지 않는다).
- 첫 문장은 "[${propName}]"으로 시작한다.
- 초안에 있는 정보(날짜·시간·장소·요청 사항)만 사용한다. 초안에 없는 정보는 지어내지 말고 그 항목은
  아예 언급하지 않는다. 예를 들어 초안에 날짜가 없으면 날짜를 쓰지 않는다(임의의 날짜 생성 금지).
  [날짜]·[이름] 같은 대괄호 빈칸도 절대 만들지 않는다.
- 이모지·느낌표·과장 표현 금지, 정중한 존댓말.
- 한글 180자 이내로 완결된 문장으로 끝낸다.
- 다듬어진 본문만 출력한다(설명·머리말·따옴표 금지).

초안:
${src}`

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          // thinkingBudget 0 — 2.5-flash는 기본으로 사고 토큰이 maxOutputTokens를 잠식해
          // 본문이 중간에 잘려 나오던 문제(운영자 신고 2026-07-10). 짧은 문구 다듬기라 사고 불필요.
          generationConfig: { temperature: 0.2, maxOutputTokens: 1024, thinkingConfig: { thinkingBudget: 0 } },
        }),
      }
    )
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { ok: false, error: '등록된 API 키가 유효하지 않습니다. 환경설정의 AI 설정에서 키를 확인해 주세요.' }
    }
    if (res.status === 429) return { ok: false, error: 'API 사용 한도에 도달했습니다. 잠시 후 다시 시도해 주세요.' }
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
