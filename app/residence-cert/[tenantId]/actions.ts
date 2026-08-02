'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getMyRole } from '@/lib/role'
import { canReadScope } from '@/lib/auth/routeScope'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { driveImageDataUrl } from '@/lib/google-drive'

// 실거주 확인서 자동 채움 데이터.
// 소재지·임차인 주소 = 영업장 주소 하나로 통일(호수 미부착 — 필요시 화면에서 수동 수정).
// 면적 = 영업장 전용면적(환경설정 defaultAreaM2). 호실별 측정 면적이 아님.
// 임대료 줄의 보증금은 보증금 금액만 (청소비 합성 없음).

export type ResidenceCertData = {
  tenantId: string
  leaseTermId: string | null
  // 소재지·임차인
  siteAddress: string        // 소재지 = 영업장 주소 + 방번호
  areaM2: string             // 면적(㎡) — 문자열(편집 가능)
  tenantName: string
  tenantAddress: string      // 고시원: 소재지와 동일
  tenantBirth: string        // YYYY-MM-DD (없으면 '')
  tenantPhone: string
  // 거주기간 (YYYY-MM-DD, 없으면 '')
  periodStart: string
  periodEnd: string
  // 금액
  rentAmount: number
  depositAmount: number
  // 임대인(영업장)
  landlordBusinessName: string   // 상호
  landlordName: string           // 성명(대표)
  landlordAddress: string        // 사업장 주소
  landlordIdNo: string           // '생년월일' 칸 값 = 사업자등록번호(사업자) 또는 생년월일(개인)
  landlordPhone: string          // 연락처
  // 도장
  stampImageUrl: string | null
  // 제출처 (지역별 — v1 서울 고정)
  submitTo: string
  regionSupported: boolean   // 현재 서식(서울형)이 유효한 지역인지 — false면 발급 차단 안내
  regionLabel: string        // 영업장 주소의 시·도(안내 문구용)
}

type BusinessInfo = { name?: string; registrationNo?: string; ceoName?: string; address?: string }

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

const ymd = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

export async function getResidenceCertData(tenantId: string): Promise<ResidenceCertData | null> {
  // 이 라우트는 (app) 셸 밖이라 canAccessRoute 가 안 걸린다. 목록은 막혀 있는데
  // 상세 URL 로 직접 들어가면 금액·생년월일·전화가 그대로 보였다(E페이즈 조사 2026-08-03).
  if (!canReadScope(await getMyRole(), 'money')) throw new Error('권한이 없습니다.')
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        // 비거주 등록자·퇴실 예정자도 발급 대상(신고 ace54135). 같은 입주자가 거주·비거주 계약을
        // 같은 방에 동시 보유할 수 있어 단순 take 1 이 아니라 조회 후 JS 에서 우선순위로 고른다.
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'RESERVED', 'NON_RESIDENT'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 10,
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        address: true, phone: true, businessInfo: true,
        stampDriveFileId: true, defaultAreaM2: true,
      },
    }),
  ])

  if (!tenant) return null

  // 우선순위 ACTIVE > CHECKOUT_PENDING > RESERVED > NON_RESIDENT (실제 거주 계약을 우선 채움).
  // 우선순위가 같으면 moveInDate 최신(위 orderBy 로 이미 desc 정렬됨).
  const LEASE_PRIORITY: Record<string, number> = { ACTIVE: 0, CHECKOUT_PENDING: 1, RESERVED: 2, NON_RESIDENT: 3 }
  const lease = [...tenant.leaseTerms]
    .sort((a, b) => (LEASE_PRIORITY[a.status] ?? 99) - (LEASE_PRIORITY[b.status] ?? 99))[0] ?? null
  const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                       ?? tenant.contacts.find(c => !c.isEmergency)
  const biz = (property?.businessInfo as BusinessInfo | null) ?? {}

  // 소재지·임차인 주소 = 영업장 주소 하나로 통일 (호수 미부착)
  const siteAddress = property?.address ?? ''

  // 면적: 영업장 전용면적(환경설정). 호실별 측정 면적 아님.
  const area = property?.defaultAreaM2 ?? null

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    siteAddress,
    areaM2: area != null ? String(area) : '',
    tenantName: tenant.name,
    tenantAddress: siteAddress,
    tenantBirth: ymd(tenant.birthdate),
    tenantPhone: primaryContact?.contactValue ?? '',
    periodStart: ymd(lease?.moveInDate),
    periodEnd: ymd(lease?.expectedMoveOut),
    rentAmount: lease?.rentAmount ?? 0,
    depositAmount: lease?.depositAmount ?? 0,
    landlordBusinessName: biz.name ?? '',
    landlordName: biz.ceoName ?? '',
    landlordAddress: biz.address ?? '',
    landlordIdNo: biz.registrationNo ?? '',
    landlordPhone: property?.phone ?? '',
    stampImageUrl: property?.stampDriveFileId ? await driveImageDataUrl(property.stampDriveFileId) : null,
    submitTo: '서울특별시장 귀하',   // 현재 서식은 서울형 — 지자체별 양식이 달라 비서울은 발급 차단(운영자 정정 2026-07-10, 유추 금지)
    regionSupported: ((property?.address ?? '').trim() || (biz.address ?? '').trim()).startsWith('서울'),
    regionLabel: (((property?.address ?? '').trim() || (biz.address ?? '').trim()).split(' ')[0]) || '미상',
  }
}
