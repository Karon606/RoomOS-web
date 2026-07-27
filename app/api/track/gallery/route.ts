import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'

// 공개 랜딩 페이지 갤러리 시트 열람 수집 — 어떤 등급 시트의 몇 번째 사진을 봤나(도달률·스와이프 깊이·체류).
// _gallery.js 가 시트 닫힘/페이지 종료 시 pv_id 로 sendBeacon. PageView.galleryViews 에 저장(덮기).

const DAY_MS = 24 * 60 * 60 * 1000

function safeInt(v: unknown, max: number): number | null {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n) || n < 0 || n > max) return null
  return Math.floor(n)
}

// [{ rent, n, seen:[idx], maxDepth, dwell:{idx:ms}, zoomed:[idx] }] — 등급 최대 12개, 사진 인덱스 0~99.
// zoomed = 라이트박스로 전체화면 확대해 본 사진 인덱스(단순 스크롤 노출보다 강한 관심 신호).
function safeViews(v: unknown): unknown[] | null {
  if (!Array.isArray(v)) return null
  const out: unknown[] = []
  for (const item of v) {
    if (out.length >= 12) break
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    const rent = safeInt(o.rent, 100_000_000)
    const n = safeInt(o.n, 100)
    if (rent === null || n === null) continue
    const seen = Array.isArray(o.seen) ? o.seen.map(x => safeInt(x, 99)).filter((x): x is number => x !== null).slice(0, 100) : []
    const zoomed = Array.isArray(o.zoomed) ? o.zoomed.map(x => safeInt(x, 99)).filter((x): x is number => x !== null).slice(0, 100) : []
    // 방 경계 — [{roomNo, count}] 순서대로. 등급 연속 idx 를 '몇 호 몇 번째'로 풀기 위한 정보.
    const rooms = Array.isArray(o.rooms) ? o.rooms.slice(0, 30).map(r => {
      if (!r || typeof r !== 'object') return null
      const rr = r as Record<string, unknown>
      const roomNo = typeof rr.roomNo === 'string' && rr.roomNo ? rr.roomNo.slice(0, 20) : null
      const count = safeInt(rr.count, 100)
      return roomNo && count !== null ? { roomNo, count } : null
    }).filter((x): x is { roomNo: string; count: number } => x !== null) : []
    const maxDepth = safeInt(o.maxDepth, 99)
    const dwell: Record<string, number> = {}
    if (o.dwell && typeof o.dwell === 'object' && !Array.isArray(o.dwell)) {
      let c = 0
      for (const [k, val] of Object.entries(o.dwell as Record<string, unknown>)) {
        if (c >= 100) break
        if (!/^\d{1,3}$/.test(k)) continue
        const ms = safeInt(val, DAY_MS)
        if (ms === null || ms === 0) continue
        dwell[k] = ms; c++
      }
    }
    // rooms 를 저장 객체에 반드시 포함 — 검증만 하고 누락해 '몇 호 몇 번째' 환산이 안 되던 버그(신고 55861e63)
    out.push({ rent, n, seen, maxDepth: maxDepth ?? 0, dwell, zoomed, rooms })
  }
  return out.length > 0 ? out : null
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => null) as { id?: string; views?: unknown } | null
    if (!body || typeof body.id !== 'string' || !body.id) {
      return NextResponse.json({ ok: false }, { status: 400 })
    }
    const views = safeViews(body.views)
    if (views === null) return NextResponse.json({ ok: true })   // 볼 게 없으면 무시(pageview 미도착 등)

    await prisma.pageView.update({
      where: { id: body.id },
      data: { galleryViews: views },
    }).catch(() => null)   // 행 없음 무시

    return NextResponse.json({ ok: true })
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
