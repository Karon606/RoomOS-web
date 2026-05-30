'use server'

import webpush from 'web-push'
import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

function configureWebPush() {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:no-reply@stayeum.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  )
}

async function getUserId(): Promise<string> {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  if (!data?.claims) redirect('/login')
  return data.claims.sub as string
}

// 사용자의 최근 푸시 발송 내역 — 설정 페이지 표시용. 최신 N건.
export type PushHistoryRow = {
  id: string
  source: string
  title: string
  body: string
  endpointCount: number
  successCount: number
  sentAt: Date
}
export async function getMyPushHistory(limit = 20): Promise<PushHistoryRow[]> {
  try {
    const userId = await getUserId()
    const rows = await prisma.pushHistory.findMany({
      where: { userId },
      orderBy: { sentAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
      select: { id: true, source: true, title: true, body: true, endpointCount: true, successCount: true, sentAt: true },
    })
    return rows
  } catch {
    return []
  }
}

// 기기 구독 저장 (endpoint 당 1행 upsert)
export async function savePushSubscription(sub: {
  endpoint: string; keys: { p256dh: string; auth: string }; userAgent?: string
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const userId = await getUserId()
    await prisma.pushSubscription.upsert({
      where: { endpoint: sub.endpoint },
      update: { userId, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? null },
      create: { userId, endpoint: sub.endpoint, p256dh: sub.keys.p256dh, auth: sub.keys.auth, userAgent: sub.userAgent ?? null },
    })
    return { ok: true }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}

export async function deletePushSubscription(endpoint: string): Promise<{ ok: true }> {
  try {
    const userId = await getUserId()
    await prisma.pushSubscription.deleteMany({ where: { endpoint, userId } })
  } catch { /* 무시 */ }
  return { ok: true }
}

// 현재 사용자의 모든 기기로 테스트 푸시 발송 (만료 구독은 정리)
export async function sendTestPush(): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  try {
    if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) {
      return { ok: false, error: 'VAPID 키가 설정되지 않았습니다.' }
    }
    configureWebPush()
    const userId = await getUserId()
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    if (subs.length === 0) return { ok: false, error: '구독된 기기가 없습니다. 먼저 알림을 켜주세요.' }
    const payload = JSON.stringify({
      title: '스테이음 알림 테스트',
      body: '푸시 알림이 정상 동작합니다 🎉',
      url: '/dashboard',
      badge: 1,
      tag: 'stayeum-test',
    })
    let sent = 0
    await Promise.all(subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
        sent++
      } catch (e: any) {
        if (e?.statusCode === 410 || e?.statusCode === 404) {
          await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } })
        }
      }
    }))
    // 발송 내역 기록 — 시도/성공 카운트
    try {
      await prisma.pushHistory.create({
        data: {
          userId,
          source: 'test',
          title: '스테이음 알림 테스트',
          body: '푸시 알림이 정상 동작합니다 🎉',
          url: '/dashboard',
          badge: 1,
          tag: 'stayeum-test',
          endpointCount: subs.length,
          successCount: sent,
        },
      })
    } catch { /* 히스토리 실패해도 푸시 자체 영향 X */ }
    return { ok: true, sent }
  } catch (err) {
    if ((err as any)?.digest?.startsWith('NEXT_REDIRECT')) throw err
    return { ok: false, error: (err as Error).message ?? '오류가 발생했습니다.' }
  }
}
