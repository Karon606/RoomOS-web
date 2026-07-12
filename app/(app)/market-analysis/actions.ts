'use server'

import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireEdit } from '@/lib/role'

async function getPropertyId() {
  const { userId, propertyId } = await requirePropertyAccess()
  return { user: { sub: userId }, propertyId }
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

export type RoomPrice = { type: string; price: number; memo?: string; windowType?: string; direction?: string; sizeCategory?: string; areaPyeong?: number; areaM2?: number; hasDeposit?: boolean; deposit?: number }

export type CompetitorRow = {
  id: string; name: string; address: string; naverPlaceUrl: string | null
  roomPrices: unknown; notes: string | null; createdAt: Date; updatedAt: Date; marketSurveyId: string
}

export async function addCompetitor(
  surveyId: string,
  data: {
    name: string
    address: string
    naverPlaceUrl?: string
    roomPrices: RoomPrice[]
    notes?: string
  },
): Promise<{ ok: boolean; competitor?: CompetitorRow; error?: string }> {
  try {
    await requireEdit()
    await getPropertyId()
    const competitor = await prisma.marketCompetitor.create({
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
    return { ok: true, competitor }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message }
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
): Promise<{ ok: boolean; error?: string }> {
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
    return { ok: false, error: (err as Error).message }
  }
}

export async function deleteCompetitor(id: string): Promise<{ ok: boolean; snapshot?: {
  marketSurveyId: string; name: string; address: string
  naverPlaceUrl?: string; roomPrices: RoomPrice[]; notes?: string
} }> {
  try {
    await requireEdit()
    await getPropertyId()
    // 적용취소(undo)용 스냅샷 — 취소는 기존 addCompetitor 재사용(새 id로 복원).
    const c = await prisma.marketCompetitor.findUnique({ where: { id } })
    await prisma.marketCompetitor.delete({ where: { id } })
    revalidatePath('/market-analysis')
    return { ok: true, snapshot: c ? {
      marketSurveyId: c.marketSurveyId, name: c.name, address: c.address,
      naverPlaceUrl: c.naverPlaceUrl ?? undefined,
      roomPrices: c.roomPrices as RoomPrice[],
      notes: c.notes ?? undefined,
    } : undefined }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}
