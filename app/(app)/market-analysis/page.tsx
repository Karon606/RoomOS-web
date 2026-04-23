import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import prisma from '@/lib/prisma'
import MarketClient from './MarketClient'

export default async function MarketAnalysisPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')

  const [property, surveys] = await Promise.all([
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
  ])

  if (!property) redirect('/property-select')

  return (
    <MarketClient
      property={property}
      initialSurveys={surveys}
    />
  )
}
