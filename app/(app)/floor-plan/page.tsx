import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { getFloorPlan } from './actions'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import FloorPlanEditor from './FloorPlanEditor'
import { displayName } from '@/lib/displayName'

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
      // 별칭·영어이름·표시 선택 — 배치도 칸에 부를 이름은 lib/displayName 이 고른다(홈 타일과 같은 규칙).
      tenant: { select: { name: true, englishName: true, nickname: true, displayNameStyle: true } },
    },
  })

  const roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }> = {}
  rooms.forEach((r: { id: string; roomNo: string; isVacant: boolean }) => {
    roomStatuses[r.roomNo] = { isVacant: r.isVacant }
  })
  leases.forEach(l => {
    if (l.room?.roomNo) {
      roomStatuses[l.room.roomNo] = {
        isVacant: false,
        tenantName: l.tenant ? displayName(l.tenant, l.tenant.displayNameStyle) : undefined,
      }
    }
  })

  return (
    // h-screen(100vh)은 셸 크롬을 모르기 때문에 하단이 잘렸다 — 셸 본문 실효 높이로 교체(F페이즈)
    <div className="flex flex-col" style={{ height: 'var(--shell-content-h)' }}>
      <FloorPlanEditor
        initialData={floorPlanData}
        rooms={rooms}
        roomStatuses={roomStatuses}
      />
    </div>
  )
}
