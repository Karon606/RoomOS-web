import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// 페이지 닫힐 때 호출 — 체류 시간 + 최대 스크롤 깊이를 기존 PageView 행에 업데이트.
// sendBeacon 으로 호출되므로 가벼운 응답.

function safeInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.floor(n)
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | { id?: string; durationMs?: number; scrollDepthPct?: number }
      | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const durationMs    = safeInt(body.durationMs,    24 * 60 * 60 * 1000)  // 최대 24시간
    const scrollDepthPct = safeInt(body.scrollDepthPct, 100)

    await prisma.pageView.update({
      where: { id: body.id },
      data: {
        ...(durationMs    !== null && { durationMs }),
        ...(scrollDepthPct !== null && { scrollDepthPct }),
      },
    }).catch(() => null)  // 행 없음 등 무시

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
