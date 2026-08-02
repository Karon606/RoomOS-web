import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// 공개 랜딩 페이지 CTA 클릭 수집 — 전화·문자 링크를 눌렀을 때 sendBeacon 으로 즉시 기록.
// 전환의 유일한 직접 신호(기존엔 tel/sms 클릭이 전혀 측정되지 않아 '연락처 도달'을 전환으로 오독했다).
// 다이얼러 전환으로 페이지가 hidden 되기 전에 나가야 하므로 클릭 즉시 별도 전송한다.

// kakao 추가 (D페이즈 2026-08-03) — 본문 '카톡 상담' 버튼과 우하단 플로터가 open.kakao.com 링크라
// tel/sms 셀렉터에 안 걸려 **주력 전환 동선이 통째로 암흑이었다.** 팝업 안 클릭만 별도로 세고 있었다.
// blog 는 네이버 블로그 유출 링크. sms 는 페이지에 링크가 하나도 없지만 스키마 호환을 위해 남긴다.
const CTA_KINDS = new Set(['tel', 'sms', 'kakao', 'blog'])

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
    // pageview 행이 아직 없으면 버린다. 전에는 "closeup 이 이중으로 실어보내니 유실 아님" 이라고
    // 적어뒀지만 sendCloseup 페이로드에 ctaLog 가 실려 있지 않아 **사실이 아니었다**(D페이즈 조사).
    // 지금은 pageview INSERT 가 geo 조회 앞으로 당겨져 이 창이 사실상 닫혔다.
    if (!row) return NextResponse.json({ ok: true })
    const prev = Array.isArray(row.ctaClicks) ? row.ctaClicks as unknown[] : []
    if (prev.length >= 10) return NextResponse.json({ ok: true })
    const next = [...prev, { kind, section, tMs }]

    await prisma.pageView.update({ where: { id: body.id }, data: { ctaClicks: next } }).catch(() => null)
    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
