'use server'

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { createDriveResumableSession, setDrivePublicReadable } from '@/lib/google-drive'

const MAX_REPORT_IMAGES = 3
const MAX_REPORT_IMAGE_BYTES = 10 * 1024 * 1024 // 10MB

// 신고 첨부 이미지 업로드 세션 — 클라이언트가 Drive 로 직접 PUT (Vercel 페이로드 한도 우회).
// 신고 흐름 전용이라 신고 저장과 같은 수준의 인증(로그인)만 요구한다.
export async function createErrorReportImageSession(input: {
  fileName: string
  mimeType: string
  fileSize: number
  origin: string
}): Promise<{ ok: true; uploadUrl: string } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    if (!data?.claims) return { ok: false, error: '로그인이 필요합니다.' }
    if (!input.mimeType.startsWith('image/')) return { ok: false, error: '이미지 파일만 첨부할 수 있습니다.' }
    if (input.fileSize <= 0) return { ok: false, error: '파일이 비어 있습니다.' }
    if (input.fileSize > MAX_REPORT_IMAGE_BYTES) return { ok: false, error: `사진은 ${MAX_REPORT_IMAGE_BYTES / 1024 / 1024}MB 이하여야 합니다.` }
    if (!input.origin) return { ok: false, error: 'Origin 정보가 누락되었습니다.' }

    const ext = input.fileName.split('.').pop() ?? 'jpg'
    const uniqueName = `report_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.${ext}`

    const uploadUrl = await createDriveResumableSession({
      fileName: uniqueName,
      mimeType: input.mimeType,
      fileSize: input.fileSize,
      origin: input.origin,
    })
    return { ok: true, uploadUrl }
  } catch (e) {
    console.error('[createErrorReportImageSession] failed:', e)
    return { ok: false, error: `사진 업로드 준비 실패: ${(e as Error).message ?? '알 수 없는 오류'}` }
  }
}

// 오류·개선 신고 저장 — 로그인 사용자 누구나. propertyId·email 은 서버에서 주입.
export async function submitErrorReport(input: {
  url?: string
  userAgent?: string
  breadcrumbs?: unknown
  errorText?: string
  userNote?: string
  imageFileIds?: string[]
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    if (!data?.claims) return { ok: false, error: '로그인이 필요합니다.' }
    const email = (data.claims.email as string | undefined) ?? null
    // 신고 메타 propertyId 는 멤버십 검증된 값만 (무단 쿠키로 남의 영업장에 신고가 붙는 것 방지)
    const propertyId = (await getPropertyAccess())?.propertyId ?? null

    // 업로드된 첨부는 열람 가능하도록 공개 읽기 권한 부여 — 일부 실패해도 신고 저장은 막지 않는다.
    const imageFileIds = (input.imageFileIds ?? []).filter(id => typeof id === 'string' && id).slice(0, MAX_REPORT_IMAGES)
    if (imageFileIds.length > 0) {
      await Promise.allSettled(imageFileIds.map(id => setDrivePublicReadable(id)))
    }

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
        imageFileIds: imageFileIds.length > 0 ? imageFileIds : undefined,
      },
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message ?? '신고 저장 실패' }
  }
}
