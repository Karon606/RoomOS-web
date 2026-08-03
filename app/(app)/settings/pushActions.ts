'use server'

import prisma from '@/lib/prisma'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
// 발송은 반드시 lib/pushSend 를 거친다. 이 파일이 web-push 를 직접 들고 있던 탓에
// 테스트 사이트 차단이 테스트 푸시 버튼만 비껴갔다(2026-08-03).
import { ensureWebPushConfigured, sendToSubscriptions } from '@/lib/pushSend'

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
    if (!ensureWebPushConfigured()) return { ok: false, error: 'VAPID 키가 설정되지 않았습니다.' }
    const userId = await getUserId()
    const subs = await prisma.pushSubscription.findMany({ where: { userId } })
    if (subs.length === 0) return { ok: false, error: '구독된 기기가 없습니다. 먼저 알림을 켜주세요.' }
    const payload = JSON.stringify({
      title: '스테이음 알림 테스트',
      body: '푸시 알림이 정상 동작합니다',
      url: '/dashboard',
      badge: 1,
      tag: 'stayeum-test',
    })
    // 종전에는 여기서 webpush.sendNotification 을 직접 불러 만료 구독 정리까지 복제하고 있었다.
    // 발송 문이 둘이면 테스트 사이트 차단이 이쪽만 비껴간다 — 정본으로 접는다(2026-08-03).
    const sent = await sendToSubscriptions(subs, payload)
    // 발송 내역 기록 — 시도/성공 카운트
    try {
      await prisma.pushHistory.create({
        data: {
          userId,
          source: 'test',
          title: '스테이음 알림 테스트',
          body: '푸시 알림이 정상 동작합니다',
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
