import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// 공개 랜딩 페이지 CTA 클릭 수집 — 전화·문자 링크를 눌렀을 때 sendBeacon 으로 즉시 기록.
// 전환의 유일한 직접 신호(기존엔 tel/sms 클릭이 전혀 측정되지 않아 '연락처 도달'을 전환으로 오독했다).
// 다이얼러 전환으로 페이지가 hidden 되기 전에 나가야 하므로 클릭 즉시 별도 전송한다.

const CTA_KINDS = new Set(['tel', 'sms'])

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as
      | { id?: string; kind?: string; section?: string; tMs?: number }
      | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const kind = typeof body.kind === 'string' && CTA_KINDS.has(body.kind) ? body.kind : 'unknown'
    const section = typeof body.section === 'string' && /^[a-zA-Z0-9_-]{1,32}$/.test(body.section) ? body.section : null
    const tMsNum = typeof body.tMs === 'number' ? body.tMs : Number(body.tMs)
    const tMs = Number.isFinite(tMsNum) && tMsNum >= 0 && tMsNum < 24 * 60 * 60 * 1000 ? Math.floor(tMsNum) : null

    // 기존 ctaClicks 배열에 append(최대 10개 — 연타·오작동 방어). 행 없으면 무시.
    const row = await prisma.pageView.findUnique({ where: { id: body.id }, select: { ctaClicks: true } })
    if (!row) return NextResponse.json({ ok: true })   // pageview 아직 미도착 — closeup 이 이중으로 실어보내니 유실 아님
    const prev = Array.isArray(row.ctaClicks) ? row.ctaClicks as unknown[] : []
    if (prev.length >= 10) return NextResponse.json({ ok: true })
    const next = [...prev, { kind, section, tMs }]

    await prisma.pageView.update({ where: { id: body.id }, data: { ctaClicks: next } }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
