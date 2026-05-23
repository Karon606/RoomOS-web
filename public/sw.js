// 스테이음 서비스워커 — 웹 푸시 알림 + 홈화면 아이콘 뱃지
// 등록: 클라이언트가 navigator.serviceWorker.register('/sw.js')

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))

// 푸시 수신 → 알림 표시 + 뱃지 숫자
self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} }
  catch { data = { body: event.data ? event.data.text() : '' } }

  const title = data.title || '스테이음'
  const options = {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || undefined,
    data: { url: data.url || '/dashboard' },
  }

  const tasks = [self.registration.showNotification(title, options)]
  // 홈화면 아이콘 뱃지 숫자 (설치형 PWA, iOS 16.4+/Android)
  if (typeof data.badge === 'number' && self.navigator && self.navigator.setAppBadge) {
    tasks.push(
      data.badge > 0
        ? self.navigator.setAppBadge(data.badge).catch(() => {})
        : self.navigator.clearAppBadge().catch(() => {}),
    )
  }
  event.waitUntil(Promise.all(tasks))
})

// 알림 클릭 → 앱 열기/포커스 + 해당 페이지로 이동
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const url = (event.notification.data && event.notification.data.url) || '/dashboard'
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of all) {
      if ('focus' in client) {
        if (client.navigate) { try { await client.navigate(url) } catch { /* noop */ } }
        return client.focus()
      }
    }
    if (self.clients.openWindow) return self.clients.openWindow(url)
  })())
})
