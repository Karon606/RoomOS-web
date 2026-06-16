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
  name: string            // 성명
  room: string            // 호실
  periodStart: string     // YYYY-MM-DD (이번 1달 선납 주기 시작)
  periodEnd: string       // YYYY-MM-DD (주기 끝)
  amount: number          // 월세
  recipientName: string   // 거주제공자(임대인) 성명
  recipientPhone: string  // 거주제공자 연락처
  stampImageUrl: string | null
}

// 월세 1달 선납 주기 — 납부일(dueDay) 기준(없으면 입주일의 일). 예) dueDay 5 → 6/5~7/4.
function rentCyclePeriod(dueDay: string | null, moveIn: Date | null): { start: string; end: string } {
  let day = parseInt((dueDay ?? '').replace(/[^0-9]/g, ''), 10)
  if (!Number.isFinite(day) || day < 1 || day > 31) day = moveIn ? new Date(moveIn).getUTCDate() : 1
  const now = new Date(Date.now() + 9 * 3600 * 1000) // KST
  const y = now.getUTCFullYear(), m = now.getUTCMonth(), d = now.getUTCDate()
  const daysIn = (yy: number, mm: number) => new Date(Date.UTC(yy, mm + 1, 0)).getUTCDate()
  let sy = y, sm = m
  if (d < Math.min(day, daysIn(y, m))) { sm = m - 1; if (sm < 0) { sm = 11; sy = y - 1 } }
  const start = new Date(Date.UTC(sy, sm, Math.min(day, daysIn(sy, sm))))
  let ny = sy, nm = sm + 1; if (nm > 11) { nm = 0; ny = sy + 1 }
  const nextStart = new Date(Date.UTC(ny, nm, Math.min(day, daysIn(ny, nm))))
  const end = new Date(nextStart.getTime() - 86400000)
  const fmt = (dt: Date) => dt.toISOString().slice(0, 10)
  return { start: fmt(start), end: fmt(end) }
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
  const cycle = rentCyclePeriod(lease?.dueDay ?? null, lease?.moveInDate ?? null)

  return {
    tenantId: tenant.id,
    leaseTermId: lease?.id ?? null,
    name: tenant.name,
    room: fmtRoom(lease?.room?.roomNo),
    periodStart: cycle.start,
    periodEnd: cycle.end,
    amount: lease?.rentAmount ?? 0,
    recipientName: biz.ceoName ?? '',
    recipientPhone: property?.phone ?? '',
    stampImageUrl: property?.stampDriveFileId ? buildDriveThumbnailUrl(property.stampDriveFileId, 800) : null,
  }
}
