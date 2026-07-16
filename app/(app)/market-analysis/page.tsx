import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import MarketClient from './MarketClient'
import { getRoomTypeOptions, getWindowTypeOptions, getRoomDirectionOptions } from '@/app/(app)/settings/actions'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function MarketAnalysisPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { propertyId } = await requirePropertyAccess()

  const [property, surveys, roomTypes, windowTypes, directions] = await Promise.all([
    prisma.property.findUnique({
      where: { id: propertyId },
      select: {
        id: true,
        name: true,
        address: true,
        rooms: {
          select: {
            id: true,
            roomNo: true,
            type: true,
            baseRent: true,
            isVacant: true,
          },
          orderBy: { roomNo: 'asc' },
        },
      },
    }),
    prisma.marketSurvey.findMany({
      where: { propertyId },
      orderBy: { surveyedAt: 'desc' },
      take: 10,
      include: {
        competitors: {
          orderBy: { createdAt: 'asc' },
        },
      },
    }),
    getRoomTypeOptions(),
    getWindowTypeOptions(),
    getRoomDirectionOptions(),
  ])

  if (!property) redirect('/property-select')

  return (
    <MarketClient
      property={property}
      initialSurveys={surveys}
      roomTypes={roomTypes}
      windowTypes={windowTypes}
      directions={directions}
    />
  )
}
