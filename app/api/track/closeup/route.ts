import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { rateLimited, clientIp } from '@/lib/tracking/guard'
import { safeViewedLanguage, safeLanguageTrail } from '@/lib/tracking/lang'

// 페이지 닫힐 때 호출 — 체류 시간 + 최대 스크롤 깊이를 기존 PageView 행에 업데이트.
// sendBeacon 으로 호출되므로 가벼운 응답.
// 언어 전환도 이 채널을 쓴다(전환 즉시 1건 + 종료 시 최종본). '기존 행 갱신'이 같은 성격이라
// 엔드포인트를 새로 늘리지 않았다. 없는 필드는 건드리지 않으므로 부분 전송이 서로를 지우지 않는다.

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
    // 레이트리밋 — pageview 와 같은 창을 쓴다. 여기는 기존 행 갱신이라 slug 를 안 받지만,
    // 무제한 호출 자체가 DB 왕복과 유료 자원을 태운다(D페이즈 잔여 2026-08-03).
    if (rateLimited(clientIp(req))) return NextResponse.json({ ok: false }, { status: 429 })
    const body = await req.json().catch(() => null) as
      | {
          id?: string; durationMs?: number; activeMs?: number; scrollDepthPct?: number
          sectionDwellMs?: unknown; scrollMilestones?: unknown
          viewedLanguage?: unknown; languageTrail?: unknown
        }
      | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const durationMs    = safeInt(body.durationMs,    DAY_MS)  // 최대 24시간(벽시계)
    const activeMs      = safeInt(body.activeMs,      DAY_MS)  // 활성 체류(백그라운드 제외)
    const scrollDepthPct = safeInt(body.scrollDepthPct, 100)
    const sectionDwellMs = safeSectionDwell(body.sectionDwellMs)
    const scrollMilestones = safeMilestones(body.scrollMilestones)
    // 열람 언어 — 클라가 늘 전체 이력을 보내므로 덮어쓴다(galleryViews 와 같은 규칙)
    const viewedLanguage = safeViewedLanguage(body.viewedLanguage)
    const languageTrail  = safeLanguageTrail(body.languageTrail)

    await prisma.pageView.update({
      where: { id: body.id },
      data: {
        ...(durationMs    !== null && { durationMs }),
        ...(activeMs      !== null && { activeMs }),
        ...(scrollDepthPct !== null && { scrollDepthPct }),
        ...(sectionDwellMs !== null && { sectionDwellMs }),
        ...(scrollMilestones !== null && { scrollMilestones }),
        ...(viewedLanguage !== null && { viewedLanguage }),
        ...(languageTrail  !== null && { languageTrail }),
      },
    }).catch(() => null)  // 행 없음 등 무시

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
