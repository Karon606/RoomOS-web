'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { buildDriveThumbnailUrl } from '@/lib/google-drive'

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
}

type BusinessInfo = { name?: string; registrationNo?: string; ceoName?: string; address?: string }

async function requireAuthAndProperty() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { userId, propertyId }
}

const ymd = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString().slice(0, 10) : ''

export async function getResidenceCertData(tenantId: string): Promise<ResidenceCertData | null> {
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
        contacts: { orderBy: [{ isPrimary: 'desc' }, { createdAt: 'asc' }] },
        leaseTerms: {
          where: { status: { in: ['ACTIVE', 'RESERVED'] } },
          orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
          take: 1,
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

  const lease = tenant.leaseTerms[0] ?? null
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
    stampImageUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 800) : null,
    // 제출처 — 영업장 주소의 시·도에서 유추(상용화 감사 A1: 서울 고정이던 것). 편집 화면에서 수정 가능.
    submitTo: inferSubmitTo(property?.address ?? biz.address ?? ''),
  }
}


// 주소 → 제출처 유추: '서울…' → 서울특별시장, '부산/대구/인천/광주/대전/울산' → ○○광역시장,
// '세종' → 세종특별자치시장, '제주' → 제주특별자치도지사, '경기/강원/충북…' 등 도 → ○○도지사. 못 찾으면 시장·군수·구청장 일반형.
function inferSubmitTo(address: string): string {
  const a = address.trim()
  if (a.startsWith('서울')) return '서울특별시장 귀하'
  const metro = ['부산', '대구', '인천', '광주', '대전', '울산'].find(c => a.startsWith(c))
  if (metro) return `${metro}광역시장 귀하`
  if (a.startsWith('세종')) return '세종특별자치시장 귀하'
  if (a.startsWith('제주')) return '제주특별자치도지사 귀하'
  const doMap: Record<string, string> = { '경기': '경기도지사', '강원': '강원특별자치도지사', '충청북': '충청북도지사', '충북': '충청북도지사', '충청남': '충청남도지사', '충남': '충청남도지사', '전라북': '전북특별자치도지사', '전북': '전북특별자치도지사', '전라남': '전라남도지사', '전남': '전라남도지사', '경상북': '경상북도지사', '경북': '경상북도지사', '경상남': '경상남도지사', '경남': '경상남도지사' }
  for (const [k, v] of Object.entries(doMap)) if (a.startsWith(k)) return `${v} 귀하`
  return '시장·군수·구청장 귀하'
}
