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

// 화면에서 온 id 가 이 영업장 것이 아닐 때의 말. 있는지 없는지 가리지 않는다(2026-10-23 운영자 승인).
const SURVEY_GONE = '조사 기록을 찾을 수 없습니다.'
const COMPETITOR_GONE = '경쟁업체를 찾을 수 없습니다.'

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
    const { propertyId } = await getPropertyId()
    // 영업장 범위로만 고친다. 남의 영업장 조사 id 면 한 줄도 안 바꾼다.
    const r = await prisma.marketSurvey.updateMany({
      where: { id: surveyId, propertyId },
      data: {
        strategy,
        ...(aiResult !== undefined ? { aiResult } : {}),
      },
    })
    if (r.count === 0) return { ok: false }
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
    const { propertyId } = await getPropertyId()
    const r = await prisma.marketSurvey.deleteMany({ where: { id: surveyId, propertyId } })
    if (r.count === 0) return { ok: false }
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
    const { propertyId } = await getPropertyId()
    // 붙일 조사 id 는 화면에서 온 값이다(적용취소 복원도 이 길). 이 영업장 조사에만 붙인다.
    if (!(await prisma.marketSurvey.findFirst({ where: { id: surveyId, propertyId }, select: { id: true } }))) {
      return { ok: false, error: SURVEY_GONE }
    }
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
    const { propertyId } = await getPropertyId()
    // 경쟁업체 행은 영업장 칸이 없다. 부모 조사의 영업장으로 건다.
    const r = await prisma.marketCompetitor.updateMany({
      where: { id, marketSurvey: { propertyId } },
      data: {
        name: data.name.trim(),
        address: data.address.trim(),
        naverPlaceUrl: data.naverPlaceUrl?.trim() || null,
        roomPrices: data.roomPrices,
        notes: data.notes?.trim() || null,
      },
    })
    if (r.count === 0) return { ok: false, error: COMPETITOR_GONE }
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
    const { propertyId } = await getPropertyId()
    // 적용취소(undo)용 스냅샷 — 취소는 기존 addCompetitor 재사용(새 id로 복원).
    // 부모 조사의 영업장으로 읽고 지운다. 남의 영업장 행이면 지우지도, 스냅샷으로 내용을 내보내지도 않는다.
    const c = await prisma.marketCompetitor.findFirst({ where: { id, marketSurvey: { propertyId } } })
    if (!c) return { ok: false }
    const r = await prisma.marketCompetitor.deleteMany({ where: { id, marketSurvey: { propertyId } } })
    if (r.count === 0) return { ok: false }
    revalidatePath('/market-analysis')
    return { ok: true, snapshot: {
      marketSurveyId: c.marketSurveyId, name: c.name, address: c.address,
      naverPlaceUrl: c.naverPlaceUrl ?? undefined,
      roomPrices: c.roomPrices as RoomPrice[],
      notes: c.notes ?? undefined,
    } }
  } catch (err) {
    if ((err as { digest?: string })?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false }
  }
}
