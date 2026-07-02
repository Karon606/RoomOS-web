'use server'

// 인앱 종 전용 서버액션 — 현재 영업장(쿠키)+인증을 해소해 computeAlerts 호출.
// propertyId 를 클라이언트 인자로 받지 않아 타 영업장 조회를 원천 차단.

import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { computeAlerts, type AlertItem } from './alerts'

export async function getMyAlerts(): Promise<AlertItem[]> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) return []
  const cookieStore = await cookies()
  const propertyId = cookieStore.get('selected_property_id')?.value
  if (!propertyId) return []
  return computeAlerts(propertyId)
}
