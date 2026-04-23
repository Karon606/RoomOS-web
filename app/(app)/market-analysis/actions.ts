'use server'

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return { user, propertyId }
}

// ── 조사 세션 ────────────────────────────────────────────────

export async function createSurvey(
  propertyId: string,
): Promise<{ ok: boolean; survey?: { id: string; surveyedAt: Date; strategy: string | null; aiResult: string | null; notes: string | null; createdAt: Date; updatedAt: Date; propertyId: string } }> {
  try {
    await requireEdit()
    const { propertyId: pid } = await getPropertyId()
    if (pid !== propertyId) return { ok: false }

    const survey = await prisma.marketSurvey.create({
      data: { propertyId },
    })
    revalidatePath('/market-analysis')
    return { ok: true, survey }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}

export async function updateSurveyStrategy(
  surveyId: string,
  strategy: string,
  aiResult?: string,
): Promise<{ ok: boolean }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.marketSurvey.update({
      where: { id: surveyId },
      data: {
        strategy,
        ...(aiResult !== undefined ? { aiResult } : {}),
      },
    })
    revalidatePath('/market-analysis')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}

export async function deleteSurvey(surveyId: string): Promise<{ ok: boolean }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.marketSurvey.delete({ where: { id: surveyId } })
    revalidatePath('/market-analysis')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}

// ── 경쟁업체 ─────────────────────────────────────────────────

export type RoomPrice = { type: string; price: number; memo?: string }

export async function addCompetitor(
  surveyId: string,
  data: {
    name: string
    address: string
    naverPlaceUrl?: string
    roomPrices: RoomPrice[]
    notes?: string
  },
): Promise<{ ok: boolean }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.marketCompetitor.create({
      data: {
        marketSurveyId: surveyId,
        name: data.name.trim(),
        address: data.address.trim(),
        naverPlaceUrl: data.naverPlaceUrl?.trim() || null,
        roomPrices: data.roomPrices,
        notes: data.notes?.trim() || null,
      },
    })
    revalidatePath('/market-analysis')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}

export async function updateCompetitor(
  id: string,
  data: {
    name: string
    address: string
    naverPlaceUrl?: string
    roomPrices: RoomPrice[]
    notes?: string
  },
): Promise<{ ok: boolean }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.marketCompetitor.update({
      where: { id },
      data: {
        name: data.name.trim(),
        address: data.address.trim(),
        naverPlaceUrl: data.naverPlaceUrl?.trim() || null,
        roomPrices: data.roomPrices,
        notes: data.notes?.trim() || null,
      },
    })
    revalidatePath('/market-analysis')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}

export async function deleteCompetitor(id: string): Promise<{ ok: boolean }> {
  try {
    await requireEdit()
    await getPropertyId()
    await prisma.marketCompetitor.delete({ where: { id } })
    revalidatePath('/market-analysis')
    return { ok: true }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}
