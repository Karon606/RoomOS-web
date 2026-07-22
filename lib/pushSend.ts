// web-push 발송 공용 헬퍼 — 일일 크론(push-alerts)과 이벤트성 알림(계약 서명 제출)이 공유한다.
// VAPID 설정·구독 발송·만료 구독 정리·발송 내역 기록을 한 곳에 모아 문법을 통일한다.

import webpush from 'web-push'
import prisma from './prisma'

// VAPID 키가 있으면 설정하고 true, 없으면 false. (호출부가 false 면 발송을 건너뛴다)
export function ensureWebPushConfigured(): boolean {
  if (!process.env.VAPID_PRIVATE_KEY || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return false
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:no-reply@stayeum.com',
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY,
  )
  return true
}

type SubLike = { endpoint: string; p256dh: string; auth: string }

// 구독 목록으로 payload(JSON 문자열) 발송. 만료(410/404) 구독은 정리하고, 성공한 기기 수를 반환.
export async function sendToSubscriptions(subs: SubLike[], payload: string): Promise<number> {
  let success = 0
  await Promise.all(subs.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload)
      success++
    } catch (e: unknown) {
      const code = (e as { statusCode?: number })?.statusCode
      if (code === 410 || code === 404) await prisma.pushSubscription.deleteMany({ where: { endpoint: s.endpoint } })
    }
  }))
  return success
}

export type OperatorPushPayload = {
  title: string
  body: string
  url: string
  tag?: string
  badge?: number
  source?: string   // pushHistory.source (기본 'event')
}

// 특정 영업장의 운영자(소유자 + 역할 보유자) 전원의 구독 기기로 발송. best-effort — 실패해도 던지지 않는다.
// 크론과 동일하게 사용자별로 발송·내역 기록한다.
export async function notifyPropertyOperators(propertyId: string, payload: OperatorPushPayload): Promise<void> {
  try {
    if (!ensureWebPushConfigured()) return
    const [prop, roles] = await Promise.all([
      prisma.property.findUnique({ where: { id: propertyId }, select: { ownerId: true } }),
      prisma.userPropertyRole.findMany({ where: { propertyId }, select: { userId: true } }),
    ])
    const userIds = Array.from(new Set([...(prop?.ownerId ? [prop.ownerId] : []), ...roles.map(r => r.userId)]))
    if (userIds.length === 0) return

    const json = JSON.stringify({
      title: payload.title,
      body: payload.body,
      url: payload.url,
      badge: payload.badge,
      tag: payload.tag,
    })
    for (const userId of userIds) {
      const subs = await prisma.pushSubscription.findMany({ where: { userId } })
      if (subs.length === 0) continue
      const success = await sendToSubscriptions(subs, json)
      try {
        await prisma.pushHistory.create({
          data: {
            userId,
            source: payload.source ?? 'event',
            title: payload.title,
            body: payload.body,
            url: payload.url,
            badge: payload.badge ?? null,
            tag: payload.tag ?? null,
            endpointCount: subs.length,
            successCount: success,
          },
        })
      } catch { /* 히스토리 실패해도 푸시 자체 영향 X */ }
    }
  } catch { /* best-effort — 알림 실패는 호출부 흐름을 막지 않는다 */ }
}
