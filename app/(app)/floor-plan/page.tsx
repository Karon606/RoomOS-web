import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getFloorPlan } from './actions'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import FloorPlanEditor from './FloorPlanEditor'

async function getPropertyId() {
  const { propertyId } = await requirePropertyAccess()
  return propertyId
}

export default async function FloorPlanPage() {
  const [floorPlanData, propertyId] = await Promise.all([
    getFloorPlan(),
    getPropertyId(),
  ])

  const rooms = await prisma.room.findMany({
    where: { propertyId },
    select: { id: true, roomNo: true, isVacant: true },
    orderBy: { roomNo: 'asc' },
  })

  const leases = await prisma.leaseTerm.findMany({
    where: {
      room: { propertyId },
      status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] },
    },
    select: {
      room: { select: { roomNo: true } },
      tenant: { select: { name: true } },
    },
  })

  const roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }> = {}
  rooms.forEach((r: { id: string; roomNo: string; isVacant: boolean }) => {
    roomStatuses[r.roomNo] = { isVacant: r.isVacant }
  })
  leases.forEach((l: { room: { roomNo: string } | null; tenant: { name: string } | null }) => {
    if (l.room?.roomNo) {
      roomStatuses[l.room.roomNo] = { isVacant: false, tenantName: l.tenant?.name ?? undefined }
    }
  })

  return (
    <div className="h-screen flex flex-col">
      <FloorPlanEditor
        initialData={floorPlanData}
        rooms={rooms}
        roomStatuses={roomStatuses}
      />
    </div>
  )
}
