import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { rateLimited, clientIp } from '@/lib/tracking/guard'

// 프로모션 팝업 열람 수집 — 얼마나 자세히 봤나(체류·닫기 방식·CTA). 팝업 인라인 스크립트가
// 닫힘·이탈·카카오 클릭 시 pv_id 로 sendBeacon(덮어쓰기). PageView.popupView 에 저장(갤러리 트래킹과 동일 패턴).

const DAY_MS = 24 * 60 * 60 * 1000
const CLOSES = ['x', 'scrim', 'esc', 'today', 'cta_kakao', 'cta_rooms', 'leave'] as const
const CTA_KINDS = ['kakao', 'rooms'] as const

function safeInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.floor(n)
}

function safeView(v: unknown): Record<string, unknown> | null {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null
  const o = v as Record<string, unknown>
  // 당일 억제로 미노출된 방문 — 노출률 분모 보정용 최소 기록
  if (o.suppressed === true) return { suppressed: true }
  const shownAtMs = safeInt(o.shownAtMs, DAY_MS)
  const dwellMs = safeInt(o.dwellMs, DAY_MS)
  if (shownAtMs === null || dwellMs === null) return null
  const close = typeof o.close === 'string' && (CLOSES as readonly string[]).includes(o.close) ? o.close : 'leave'
  const ctas = Array.isArray(o.ctas)
    ? o.ctas.slice(0, 10).map(c => {
        if (!c || typeof c !== 'object') return null
        const cc = c as Record<string, unknown>
        const kind = typeof cc.kind === 'string' && (CTA_KINDS as readonly string[]).includes(cc.kind) ? cc.kind : null
        const tMs = safeInt(cc.tMs, DAY_MS)
        return kind && tMs !== null ? { kind, tMs } : null
      }).filter((x): x is { kind: string; tMs: number } => x !== null)
    : []
  return { shownAtMs, dwellMs, close, ctas }
}

export async function POST(req: NextRequest) {
  try {
    // 레이트리밋 — pageview 와 같은 창을 쓴다. 여기는 기존 행 갱신이라 slug 를 안 받지만,
    // 무제한 호출 자체가 DB 왕복과 유료 자원을 태운다(D페이즈 잔여 2026-08-03).
    if (rateLimited(clientIp(req))) return NextResponse.json({ ok: false }, { status: 429 })
    const body = await req.json().catch(() => null) as { id?: string; view?: unknown } | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const view = safeView(body.view)
    if (view === null) return NextResponse.json({ ok: true })   // 유효 데이터 없으면 무시

    await prisma.pageView.update({
      where: { id: body.id },
      data: { popupView: view },
    }).catch(() => null)   // 행 없음 무시(pageview 미도착·운영자 제외 등)

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
