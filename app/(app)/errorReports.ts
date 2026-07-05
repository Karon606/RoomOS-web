'use server'

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'

// 오류 신고 저장 — 로그인 사용자 누구나. propertyId·email 은 서버에서 주입.
export async function submitErrorReport(input: {
  url?: string
  userAgent?: string
  breadcrumbs?: unknown
  errorText?: string
  userNote?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    if (!data?.claims) return { ok: false, error: '로그인이 필요합니다.' }
    const email = (data.claims.email as string | undefined) ?? null
    // 신고 메타 propertyId 는 멤버십 검증된 값만 (무단 쿠키로 남의 영업장에 신고가 붙는 것 방지)
    const propertyId = (await getPropertyAccess())?.propertyId ?? null

    await prisma.errorReport.create({
      data: {
        propertyId,
        userEmail: email,
        url: input.url?.slice(0, 1000) ?? null,
        userAgent: input.userAgent?.slice(0, 500) ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        breadcrumbs: (input.breadcrumbs ?? undefined) as any,
        errorText: input.errorText?.slice(0, 2000) ?? null,
        userNote: input.userNote?.slice(0, 4000) ?? null,
      },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? '신고 저장 실패' }
  }
}
