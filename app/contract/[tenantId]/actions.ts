'use server'

import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { buildDriveThumbnailUrl } from '@/lib/google-drive'
import { requireEdit } from '@/lib/role'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE,
} from '@/lib/contract'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

export type ContractData = {
  template: ContractTemplate           // 입실자 오버라이드 우선, 없으면 영업장 공통
  hasOverride: boolean                 // 오버라이드 사용 여부 — '원본으로' 버튼 활성화 판단용
  businessInfo: BusinessInfo
  stampImageUrl: string | null         // 인쇄에 쓰일 큰 사이즈
  tenant: {
    id: string
    name: string
    birthdate: string | null   // YYYY-MM-DD
    gender: string             // '남' | '여' | ''
    job: string | null
    primaryPhone: string | null
    emergencyContacts: Array<{ name: string; phone: string; relation: string | null }>
  }
  lease: {
    id: string
    moveInDate: string | null
    expectedMoveOut: string | null
    rentAmount: number
    depositAmount: number
    cleaningFee: number
    roomNo: string | null
    registrationStatus: '신고' | '미신고' | '면제'
  } | null
}

async function requireAuthAndProperty() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { userId: user.id, propertyId }
}

const GENDER_LABEL: Record<string, string> = {
  MALE: '남', FEMALE: '여', UNKNOWN: '',
}
const REGISTRATION_LABEL: Record<string, '신고' | '미신고' | '면제'> = {
  REGISTERED: '신고', NOT_REPORTED: '미신고', EXEMPTED: '면제',
}

export async function getContractData(tenantId: string): Promise<ContractData | null> {
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
          include: { room: { select: { roomNo: true } } },
        },
      },
    }),
    prisma.property.findUnique({
      where: { id: propertyId },
      select: { contractTemplate: true, businessInfo: true, stampDriveFileId: true },
    }),
  ])

  if (!tenant) return null

  const lease = tenant.leaseTerms[0] ?? null
  const primaryContact = tenant.contacts.find(c => c.isPrimary && !c.isEmergency)
                       ?? tenant.contacts.find(c => !c.isEmergency)
  const emergencyContacts = tenant.contacts
    .filter(c => c.isEmergency)
    .map(c => ({
      name: '', // TenantContact에 별도 이름 없음 — 사용자가 출력 페이지에서 직접 보강
      phone: c.contactValue,
      relation: c.emergencyRelation ?? null,
    }))

  // 영업장 공통 템플릿
  const baseTemplate = (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE
  // 입실자별 오버라이드 (있으면 그것을 우선 사용)
  const override = lease?.contractOverride as ContractTemplate | null | undefined
  const template = override ?? baseTemplate

  return {
    template,
    hasOverride: !!override,
    businessInfo: (property?.businessInfo as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO,
    // 도장은 인쇄 품질 기준 큰 사이즈 (= width 800px) 썸네일을 받아 max 24mm 슬롯에 object-fit:contain
    stampImageUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 800) : null,
    tenant: {
      id: tenant.id,
      name: tenant.name,
      birthdate: tenant.birthdate ? new Date(tenant.birthdate).toISOString().slice(0, 10) : null,
      gender: GENDER_LABEL[tenant.gender] ?? '',
      job: tenant.job,
      primaryPhone: primaryContact?.contactValue ?? null,
      emergencyContacts,
    },
    lease: lease ? {
      id: lease.id,
      moveInDate: lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null,
      expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
      rentAmount: lease.rentAmount,
      depositAmount: lease.depositAmount,
      cleaningFee: lease.cleaningFee,
      roomNo: lease.room?.roomNo ?? null,
      registrationStatus: REGISTRATION_LABEL[lease.registrationStatus] ?? '미신고',
    } : null,
  }
}

// ── 입실자별 본문 오버라이드 저장/리셋 ─────────────────────────────

export async function saveContractOverride(
  leaseTermId: string,
  template: ContractTemplate,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    if (!template?.title?.trim()) return { ok: false, error: '계약서 제목이 비어 있습니다.' }
    // 본인 영업장 lease만 허용
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { contractOverride: template as unknown as object },
    })
    revalidatePath(`/contract`)
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '저장에 실패했습니다.' }
  }
}

export async function resetContractOverride(leaseTermId: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await requireEdit()
    const { propertyId } = await requireAuthAndProperty()
    const lease = await prisma.leaseTerm.findFirst({ where: { id: leaseTermId, propertyId }, select: { id: true } })
    if (!lease) return { ok: false, error: '대상 계약을 찾을 수 없습니다.' }
    await prisma.leaseTerm.update({
      where: { id: leaseTermId },
      data: { contractOverride: { set: null } },
    })
    revalidatePath(`/contract`)
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '초기화에 실패했습니다.' }
  }
}
