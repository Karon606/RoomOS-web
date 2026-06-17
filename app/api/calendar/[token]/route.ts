// 캘린더 구독(.ics) 피드 — 구글/애플/아웃룩에서 webcal 로 구독하면 납부예정·퇴실예정 자동 동기화(읽기전용).
// 토큰만으로 접근(공개) — 캘린더 앱은 쿠키 없이 가져가므로 비밀 토큰이 보안.
import prisma from '@/lib/prisma'
import { discountedRent } from '@/lib/rentDiscount'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n')
const ymd = (y: number, m: number, d: number) => `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`
const fmtRoom = (no?: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params
  const cleanToken = (token || '').replace(/\.ics$/i, '')
  const property = await prisma.property.findUnique({
    where: { calendarToken: cleanToken },
    select: { id: true, name: true },
  })
  if (!property) return new Response('Not found', { status: 404 })

  const leases = await prisma.leaseTerm.findMany({
    where: { propertyId: property.id, status: { in: ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: {
      id: true, dueDay: true, rentAmount: true, expectedMoveOut: true, status: true,
      room: { select: { roomNo: true } },
      tenant: { select: { name: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })

  const now = new Date(Date.now() + 9 * 3600000) // KST
  const ty = now.getUTCFullYear(), tm = now.getUTCMonth() + 1
  const dtstamp = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}T000000Z`

  const lines: string[] = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//stayeum//calendar//KO', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc('스테이음 · ' + (property.name || '영업장'))}`, 'X-WR-TIMEZONE:Asia/Seoul',
  ]
  const ev = (uid: string, y: number, m: number, d: number, summary: string, desc: string) => {
    const start = ymd(y, m, d)
    const end = new Date(y, m - 1, d + 1)
    lines.push(
      'BEGIN:VEVENT', `UID:${uid}@stayeum`, `DTSTAMP:${dtstamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${ymd(end.getFullYear(), end.getMonth() + 1, end.getDate())}`,
      `SUMMARY:${esc(summary)}`, ...(desc ? [`DESCRIPTION:${esc(desc)}`] : []), 'END:VEVENT',
    )
  }

  for (const l of leases) {
    const room = fmtRoom(l.room?.roomNo)
    const who = [room, l.tenant.name].filter(Boolean).join(' ')
    // 퇴실 예정일
    if (l.status === 'CHECKOUT_PENDING' && l.expectedMoveOut) {
      const mo = new Date(l.expectedMoveOut)
      ev(`checkout-${l.id}`, mo.getFullYear(), mo.getMonth() + 1, mo.getDate(), `${who} 퇴실 예정`, '')
    }
    // 납부 예정일 — 이번 달부터 6개월. 퇴실 달 이후는 제외.
    if (l.rentAmount > 0 && l.dueDay) {
      const moMonth = l.expectedMoveOut ? (() => { const d = new Date(l.expectedMoveOut); return d.getFullYear() * 100 + d.getMonth() + 1 })() : null
      for (let i = 0; i < 6; i++) {
        let y = ty, m = tm + i
        while (m > 12) { m -= 12; y += 1 }
        if (moMonth && y * 100 + m > moMonth) break
        const monthStr = `${y}-${String(m).padStart(2, '0')}`
        const lastDay = new Date(y, m, 0).getDate()
        const day = l.dueDay.includes('말') ? lastDay : Math.min(Math.max(parseInt(l.dueDay, 10) || 1, 1), lastDay)
        const amount = discountedRent(l.discounts, monthStr, l.rentAmount)
        ev(`rent-${l.id}-${monthStr}`, y, m, day, `${who} 월세 ${amount.toLocaleString()}원`, '납부 예정일')
      }
    }
  }

  lines.push('END:VCALENDAR')
  // ICS 는 CRLF 권장
  const body = lines.join('\r\n')
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="stayeum.ics"',
      // 캘린더 앱이 다시 가져갈 때 항상 최신본을 받도록(CDN 캐시 방지)
      'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0',
    },
  })
}
