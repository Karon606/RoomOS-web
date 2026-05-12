'use server'

import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'

async function getPropertyId() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) redirect('/property-select')
  return propertyId
}

export type ElementType =
  | 'room' | 'corridor' | 'kitchen' | 'bathroom' | 'stairs'
  | 'entrance' | 'emergency_exit' | 'window' | 'label'

export type FloorPlanElement = {
  id: string
  type: ElementType
  x: number
  y: number
  width: number
  height: number
  rotation: number
  label: string
  roomNo?: string
  fill?: string
}

export type FloorPlanData = {
  elements: FloorPlanElement[]
  canvasWidth: number
  canvasHeight: number
}

export async function getFloorPlan(): Promise<FloorPlanData | null> {
  const propertyId = await getPropertyId()
  const prop = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { floorPlanData: true },
  })
  if (!prop?.floorPlanData) return null
  return prop.floorPlanData as FloorPlanData
}

export async function saveFloorPlan(data: FloorPlanData): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const propertyId = await getPropertyId()
    await prisma.property.update({
      where: { id: propertyId },
      data: { floorPlanData: data as object },
    })
    revalidatePath('/dashboard')
    revalidatePath('/floor-plan')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}
