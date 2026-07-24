// 매일 스케줄(Vercel Cron) — 구독한 기기로 그날 챙길 알림을 web-push 발송 + 뱃지 갱신.
// 알림 정책 (2026-05-24 변경):
//   · 일정 기반(퇴실예정·투어예정·입주예정) → "당일에 있을 일"만. 경과(지난 날짜)는 알리지 않음.
//   · 진행 중 상태(미납·재고 소진 임박·수령 대기) → 해소될 때까지 매일.
//     - 미납: 도래·미회수(완납 시까지) — computeUnpaidStatus 재사용 (대시보드 '이달 미수납'과 동일 건수).
//     - 재고 소진 임박: computeInventoryOverview 의 lowStock 기준.
// 인증: Vercel Cron 은 Authorization: Bearer <CRON_SECRET> 헤더 전송. 수동 테스트는 ?secret= 도 허용.

import { NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { computeAlerts, summarizeAlerts, type AlertItem } from '@/app/(app)/dashboard/alerts'
import { kstYmd } from '@/lib/kstDate'
import { runIntegrityAudit } from '@/lib/integrityAudit'
import { ensureWebPushConfigured, sendToSubscriptions } from '@/lib/pushSend'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// 알림 목록은 computeAlerts(propertyId) 단일 소스를 쓴다 — 인앱 종과 같은 소스라
// 푸시 뱃지 숫자 = 종 뱃지 숫자가 자동으로 일치한다. (윈도우·당일/미납 정책은 alerts.ts 참조)

export async function GET(req: Request) {
  const auth = req.headers.get('authorization')
  const secret = new URL(req.url).searchParams.get('secret')
  const cronSecret = process.env.CRON_SECRET
  const authorized = !!cronSecret && (auth === `Bearer ${cronSecret}` || secret === cronSecret)
  if (!authorized) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })

  if (!ensureWebPushConfigured()) {
    return NextResponse.json({ ok: false, error: 'VAPID not configured' }, { status: 500 })
  }

  // 단기 자동 퇴실 예정 전환(운영자 승인 2026-07-11) — KST 기준 내일(놓친 경우 당일 포함)이
  // 퇴실일인 단기 거주중 계약을 '퇴실 예정'으로. autoCheckoutAt 기록으로 재전환 방지
  // (수동 복귀 존중), 퇴실일 변경 시 updateTenant 가 null 리셋해 재무장.
  const k = kstYmd()
  const kstToday = new Date(k.year, k.month - 1, k.day)
  const kstDayAfterTomorrow = new Date(kstToday.getTime() + 2 * 86400000)
  const autoFlipped = await prisma.leaseTerm.updateMany({
    where: {
      status: 'ACTIVE', isShortTerm: true, autoCheckoutAt: null,
      expectedMoveOut: { gte: kstToday, lt: kstDayAfterTomorrow },
    },
    data: { status: 'CHECKOUT_PENDING', autoCheckoutAt: new Date() },
  })

  // 데이터 정합 감사(운영자 오더 2026-07-20, 땜빵 금지) — 위반을 오류신고로 자동 적재.
  // 실패해도 푸시 발송은 계속(감사는 부가 기능).
  const audit = await runIntegrityAudit(prisma).catch(() => null)

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

    // 사용자가 접근 가능한 모든 영업장의 알림을 합산 (종과 같은 computeAlerts 소스)
    const allItems: AlertItem[] = []
    for (const pid of propIds) allItems.push(...await computeAlerts(pid))
    const { total, parts } = summarizeAlerts(allItems)
    if (total === 0) continue

    const payload = JSON.stringify({
      title: `스테이음 · 오늘 챙길 일 ${total}건`,
      body: parts.join(' · '),
      url: '/dashboard',
      badge: total,
      tag: 'stayeum-daily',
    })

    const userSuccess = await sendToSubscriptions(userSubs, payload)
    sent += userSuccess
    if (userSuccess > 0) usersNotified++

    // 발송 내역 기록 — 시도/성공 카운트와 함께
    try {
      await prisma.pushHistory.create({
        data: {
          userId,
          source: 'cron-daily',
          title: `스테이음 · 오늘 챙길 일 ${total}건`,
          body: parts.join(' · '),
          url: '/dashboard',
          badge: total,
          tag: 'stayeum-daily',
          endpointCount: userSubs.length,
          successCount: userSuccess,
        },
      })
    } catch { /* 히스토리 실패해도 푸시 자체 영향 X */ }
  }

  // 방문 기록 IP 보관 기간 정리 — 90일 지난 행은 ip 만 비운다(운영자 결정 2026-07-24).
  // 방문 기록·통계는 그대로 남고 개인 식별 정보만 사라진다. 실패해도 크론 본래 일(알림)에는 영향 없음.
  let ipPurged = 0
  try {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const purged = await prisma.pageView.updateMany({
      where: { occurredAt: { lt: cutoff }, ip: { not: null } },
      data: { ip: null },
    })
    ipPurged = purged.count
  } catch { /* IP 정리 실패는 알림 발송과 무관 */ }

  return NextResponse.json({ ok: true, autoCheckout: autoFlipped.count, usersNotified, sent, integrity: audit, ipPurged })
}
