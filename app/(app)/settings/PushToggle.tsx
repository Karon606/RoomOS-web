'use client'

import { useEffect, useState } from 'react'
import { Btn } from '@/components/ui/Btn'
import { pushToast } from '@/lib/saveStatus'
import { savePushSubscription, deletePushSubscription, sendTestPush } from './pushActions'
import { PushHistoryList } from './PushHistoryList'

function urlB64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  const arr = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i)
  return arr
}

export function PushToggle() {
  const [supported, setSupported] = useState<boolean | null>(null)
  const [enabled, setEnabled] = useState(false)
  const [busy, setBusy] = useState(false)
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY

  useEffect(() => {
    const ok = typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
    setSupported(ok)
    if (!ok) return
    navigator.serviceWorker.register('/sw.js')
      .then(reg => reg.pushManager.getSubscription())
      .then(sub => setEnabled(!!sub))
      .catch(() => {})
  }, [])

  const enable = async () => {
    if (!vapid) { pushToast('error', '알림 설정 키가 없습니다(VAPID).'); return }
    setBusy(true)
    try {
      const perm = await Notification.requestPermission()
      if (perm !== 'granted') { pushToast('error', '알림 권한이 거부되었습니다.'); return }
      const reg = await navigator.serviceWorker.register('/sw.js')
      await navigator.serviceWorker.ready
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapid),
      })
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } }
      if (!json.endpoint || !json.keys) throw new Error('구독 정보 생성 실패')
      const res = await savePushSubscription({
        endpoint: json.endpoint,
        keys: { p256dh: json.keys.p256dh, auth: json.keys.auth },
        userAgent: navigator.userAgent,
      })
      if (!res.ok) { pushToast('error', res.error); return }
      setEnabled(true)
      pushToast('success', '알림이 켜졌습니다.')
    } catch (e) {
      pushToast('error', (e as Error).message || '알림 켜기 실패')
    } finally { setBusy(false) }
  }

  const disable = async () => {
    setBusy(true)
    try {
      const reg = await navigator.serviceWorker.getRegistration()
      const sub = await reg?.pushManager.getSubscription()
      if (sub) { await deletePushSubscription(sub.endpoint); await sub.unsubscribe() }
      setEnabled(false)
      pushToast('success', '알림이 꺼졌습니다.')
    } catch { /* 무시 */ } finally { setBusy(false) }
  }

  const test = async () => {
    setBusy(true)
    try {
      const res = await sendTestPush()
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `테스트 푸시 발송됨 (기기 ${res.sent}대)`)
    } finally { setBusy(false) }
  }

  if (supported === false) {
    return (
      <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
        이 브라우저는 푸시 알림을 지원하지 않습니다. iPhone은 <strong>홈 화면에 추가(설치)</strong> 후 이용하세요 (iOS 16.4+).
      </p>
    )
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {!enabled ? (
          <Btn variant="primary" size="sm" onClick={enable} disabled={busy || supported === null}>알림 받기</Btn>
        ) : (
          <>
            <Btn variant="secondary" size="sm" onClick={disable} disabled={busy}>알림 끄기</Btn>
            <Btn variant="primary" size="sm" onClick={test} disabled={busy}>테스트 푸시 보내기</Btn>
          </>
        )}
        {enabled && <span className="text-[0.6875rem] text-[var(--success-fg)] font-medium">● 이 기기 알림 켜짐</span>}
      </div>
      <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
        납부 예정·퇴실 예정·재고 소진 등 대시보드 알림을 이 기기로 받습니다.
        iPhone은 <strong>홈 화면에 추가</strong>한 상태에서만 동작합니다 (iOS 16.4+).
      </p>
      <PushHistoryList />
    </div>
  )
}
