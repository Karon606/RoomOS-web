// 현재 서빙 중인 빌드 식별자 — 클라이언트가 새 배포를 감지해 부드럽게 갱신(스플래시 폴백 방지)
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export function GET() {
  const id = process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'dev'
  return NextResponse.json({ id }, { headers: { 'cache-control': 'no-store' } })
}
