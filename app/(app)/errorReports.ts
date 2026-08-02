'use server'

import { getPropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { cookies } from 'next/headers'
import { createDriveResumableSession } from '@/lib/google-drive'

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

    // 첨부에 공개 읽기 권한을 붙이지 않는다(D페이즈 2026-08-03).
    // 신고 첨부는 대부분 앱 화면 스크린샷이라 다른 입주자의 성명·연락처·이용료·미납이 찍혀 있다.
    // 그런데 공개가 필요한 소비처가 하나도 없었다 — 앱은 이 사진을 띄우지 않고,
    // 유일한 열람 경로인 scripts/check-error-reports.mjs 는 서비스 계정으로 직접 내려받으면 된다.
    // 서류 PDF 56건 사고(8918669)와 같은 클래스다. 권한만 남아 무만료로 열려 있었다.
    const imageFileIds = (input.imageFileIds ?? []).filter(id => typeof id === 'string' && id).slice(0, MAX_REPORT_IMAGES)

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
