'use server'

import prisma from '@/lib/prisma'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { buildDriveThumbnailUrl } from '@/lib/google-drive'

// 월세 영수증 자동 채움 — 입실자/계약/영업장에서.
export type RentReceiptData = {
  tenantId: string
  leaseTermId: string | null
  nameRoom: string        // 이름 (호실)
  periodStart: string     // YYYY-MM-DD
  periodEnd: string       // YYYY-MM-DD
  amount: number          // 월세
  recipientName: string   // 거주제공자(임대인) 성명
  recipientPhone: string  // 거주제공자 연락처
  stampImageUrl: string | null
}

type BusinessInfo = { name?: string; registrationNo?: string; ceoName?: string; address?: string }

async function requireAuthAndProperty() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { userId: user.id, propertyId }
}

const ymd = (d: Date | null | undefined) => d ? new Date(d).toISOString().slice(0, 10) : ''
const fmtRoom = (v: string | null | undefined) => v ? (/^\d+$/.test(v.trim()) ? `${v.trim()}호` : v) : ''

export async function getRentReceiptData(tenantId: string): Promise<RentReceiptData | null> {
  const { propertyId } = await requireAuthAndProperty()

  const [tenant, property] = await Promise.all([
    prisma.tenant.findFirst({
      where: { id: tenantId, propertyId },
      include: {
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
      select: { phone: true, businessInfo: true, stampDriveFileId: true },
    }),
  ])

  if (!tenant) return null

  const lease = tenant.leaseTerms[0] ?? null
  const biz = (property?.businessInfo as BusinessInfo | null) ?? {}
  const roomLabel = fmtRoom(lease?.room?.roomNo)
  const nameRoom = roomLabel ? `${tenant.name} (${roomLabel})` : tenant.name

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    nameRoom,
    periodStart: ymd(lease?.moveInDate),
    periodEnd: ymd(lease?.expectedMoveOut),
    amount: lease?.rentAmount ?? 0,
    recipientName: biz.ceoName ?? '',
    recipientPhone: property?.phone ?? '',
    stampImageUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 800) : null,
  }
}
