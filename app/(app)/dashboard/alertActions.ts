'use server'

// 인앱 종 전용 서버액션 — 현재 영업장(쿠키)+인증을 해소해 computeAlerts 호출.
// propertyId 를 클라이언트 인자로 받지 않아 타 영업장 조회를 원천 차단.

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { computeAlerts, type AlertItem } from './alerts'

export async function getMyAlerts(): Promise<AlertItem[]> {
  const access = await getPropertyAccess()
  if (!access) return []
  // 역할을 넘겨 그 역할이 못 여는 목적지·못 보는 금액을 거른다(검수 N-5, 크론 푸시와 같은 값).
  return computeAlerts(access.propertyId, access.role)
}
