'use server'

import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { buildDriveThumbnailUrl } from '@/lib/google-drive'
import {
  type ContractTemplate, type BusinessInfo, DEFAULT_CONTRACT_TEMPLATE,
} from '@/lib/contract'

const EMPTY_BUSINESS_INFO: BusinessInfo = { name: '', registrationNo: '', ceoName: '', address: '' }

export type ContractData = {
  template: ContractTemplate
  businessInfo: BusinessInfo
  stampThumbnailUrl: string | null
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
      name: '', // TenantContact에는 별도 이름 필드 없음 — 관계만 보유. 사용자가 본문에서 직접 채울 수 있도록 빈 값 둠.
      phone: c.contactValue,
      relation: c.emergencyRelation ?? null,
    }))

  return {
    template: (property?.contractTemplate as ContractTemplate | null) ?? DEFAULT_CONTRACT_TEMPLATE,
    businessInfo: (property?.businessInfo as BusinessInfo | null) ?? EMPTY_BUSINESS_INFO,
    stampThumbnailUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 400) : null,
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
    } : null,
  }
}
