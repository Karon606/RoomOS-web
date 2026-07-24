import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// 페이지 닫힐 때 호출 — 체류 시간 + 최대 스크롤 깊이를 기존 PageView 행에 업데이트.
// sendBeacon 으로 호출되므로 가벼운 응답.

function safeInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.floor(n)
}

const DAY_MS = 24 * 60 * 60 * 1000
// 섹션별 체류시간 { sectionId: ms } — 키 [a-zA-Z0-9_-] 1~32자·최대 20개, 값 0~24h 정수.
function safeSectionDwell(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, number> = {}
  let n = 0
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= 20) break
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(k)) continue
    const ms = safeInt(val, DAY_MS)
    if (ms === null || ms === 0) continue
    out[k] = ms; n++
  }
  return n > 0 ? out : null
}

// 스크롤 마일스톤 { "25"|"50"|"75"|"100": 입장 후 ms }. 허용 키만, 값 0~24h.
function safeMilestones(v: unknown): Record<string, number> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const out: Record<string, number> = {}
  for (const key of ['25', '50', '75', '100']) {
    const ms = safeInt((v as Record<string, unknown>)[key], DAY_MS)
    if (ms !== null) out[key] = ms
  }
  return Object.keys(out).length > 0 ? out : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | { id?: string; durationMs?: number; activeMs?: number; scrollDepthPct?: number; sectionDwellMs?: unknown; scrollMilestones?: unknown }
      | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const durationMs    = safeInt(body.durationMs,    DAY_MS)  // 최대 24시간(벽시계)
    const activeMs      = safeInt(body.activeMs,      DAY_MS)  // 활성 체류(백그라운드 제외)
    const scrollDepthPct = safeInt(body.scrollDepthPct, 100)
    const sectionDwellMs = safeSectionDwell(body.sectionDwellMs)
    const scrollMilestones = safeMilestones(body.scrollMilestones)

    await prisma.pageView.update({
      where: { id: body.id },
      data: {
        ...(durationMs    !== null && { durationMs }),
        ...(activeMs      !== null && { activeMs }),
        ...(scrollDepthPct !== null && { scrollDepthPct }),
        ...(sectionDwellMs !== null && { sectionDwellMs }),
        ...(scrollMilestones !== null && { scrollMilestones }),
      },
    }).catch(() => null)  // 행 없음 등 무시

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
