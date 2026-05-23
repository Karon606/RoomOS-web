// 매일 스케줄(Vercel Cron) — 구독한 기기로 그날 챙길 알림을 web-push 발송 + 뱃지 갱신.
// 알림: 퇴실예정·투어예정·입주예정·수령대기(일정 기반) + 재고 소진 임박(소비율 — computeInventoryOverview 재사용).
// 납부예정(발생주의)은 엔진 파라미터화 필요 → v2b 남음.
// 인증: Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 헤더 전송. 수동 테스트는 ?secret= 도 허용.

import { NextResponse } from 'next/server'
import webpush from 'web-push'
import prisma from '@/lib/prisma'
import { kstYmd } from '@/lib/kstDate'
import { ALERT_WINDOW_BEFORE_DAYS, ALERT_WINDOW_AFTER_DAYS } from '@/lib/appConfig'
import { TRACKED_CATEGORIES } from '@/app/(app)/inventory/constants'
import { computeInventoryOverview } from '@/app/(app)/inventory/overview'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

async function countAlerts(propertyId: string, alertFrom: Date, alertTo: Date) {
  const [checkout, tour, moveIn, receipts, inventory] = await Promise.all([
    prisma.leaseTerm.count({ where: { propertyId, status: 'CHECKOUT_PENDING', expectedMoveOut: { gte: alertFrom, lte: alertTo } } }),
    prisma.leaseTerm.count({ where: { propertyId, status: 'WAITING_TOUR', tourDate: { gte: alertFrom, lte: alertTo } } }),
    prisma.leaseTerm.count({ where: { propertyId, status: 'RESERVED', moveInDate: { gte: alertFrom, lte: alertTo } } }),
    prisma.expense.count({ where: { propertyId, category: { in: TRACKED_CATEGORIES as unknown as string[] }, itemLabel: { not: null }, receivedAt: null, excludeFromInventory: false } }),
    computeInventoryOverview(propertyId),
  ])
  // 재고 소진 임박 — 인벤토리 카드의 lowStock 과 동일 기준
  const lowStock = inventory.filter(r => r.daysUntilEmpty != null && r.daysUntilEmpty <= r.alertThresholdDays).length
  return { checkout, tour, moveIn, receipts, lowStock }
}

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const secret = new URL(req.url).searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  const authorized = !!cronSecret && (auth === `Bearer ${cronSecret}` || secret === cronSecret)
  if (!authorized) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
    return NextResponse.json({ ok: false, error: 'VAPID not configured' }, { status: 500 })
  }
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:no-reply@stayeum.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )

  // KST 오늘 기준 알림 윈도우 (대시보드와 동일한 상수)
  const k = kstYmd()
  const today = new Date(k.year, k.month - 1, k.day)
  const alertFrom = new Date(today.getTime() - ALERT_WINDOW_BEFORE_DAYS * 86400000)
  const alertTo = new Date(today.getTime() + ALERT_WINDOW_AFTER_DAYS * 86400000)

  const subs = await prisma.pushSubscription.findMany()
  const byUser = new Map<string, typeof subs>()
  for (const s of subs) {
    const arr = byUser.get(s.userId)
    if (arr) arr.push(s)
    else byUser.set(s.userId, [s])
  }

  let usersNotified = 0
  let sent = 0
  for (const [userId, userSubs] of byUser) {
    const [owned, roles] = await Promise.all([
      prisma.property.findMany({ where: { ownerId: userId }, select: { id: true } }),
      prisma.userPropertyRole.findMany({ where: { userId }, select: { propertyId: true } }),
    ])
    const propIds = Array.from(new Set([...owned.map(o => o.id), ...roles.map(r => r.propertyId)]))
    if (propIds.length === 0) continue

    let checkout = 0, tour = 0, moveIn = 0, receipts = 0, lowStock = 0
    for (const pid of propIds) {
      const a = await countAlerts(pid, alertFrom, alertTo)
      checkout += a.checkout; tour += a.tour; moveIn += a.moveIn; receipts += a.receipts; lowStock += a.lowStock
    }
    const total = checkout + tour + moveIn + receipts + lowStock
    if (total === 0) continue

    const parts: string[] = []
    if (checkout) parts.push(`퇴실 예정 ${checkout}`)
    if (tour)     parts.push(`투어 예정 ${tour}`)
    if (moveIn)   parts.push(`입주 예정 ${moveIn}`)
    if (lowStock) parts.push(`재고 소진 임박 ${lowStock}`)
    if (receipts) parts.push(`수령 대기 ${receipts}`)
    const payload = JSON.stringify({
      title: `스테이음 — 오늘 챙길 일 ${total}건`,
      body: parts.join(' · '),
      url: '/dashboard',
      badge: total,
      tag: 'stayeum-daily',
    })

    let userSent = false
    await Promise.all(userSubs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++; userSent = true
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode
        if (code === 410 || code === 404) await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } })
      }
    }))
    if (userSent) usersNotified++
  }

  return NextResponse.json({ ok: true, usersNotified, sent })
}
