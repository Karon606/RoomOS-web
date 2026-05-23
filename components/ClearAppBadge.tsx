'use client'

import { useEffect } from 'react'

// 앱이 열리거나 다시 포커스되면 홈화면 아이콘 뱃지 숫자를 지운다.
// (푸시 수신 시 sw.js 가 setAppBadge 로 숫자를 올림 → 사용자가 앱을 보면 클리어)
type BadgeNav = Navigator & { clearAppBadge?: () => Promise<void> }

export default function ClearAppBadge() {
  useEffect(() => {
    const clear = () => {
      const nav = navigator as BadgeNav
      nav.clearAppBadge?.().catch(() => {})
    }
    clear()
    const onVisible = () => { if (document.visibilityState === 'visible') clear() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', clear)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', clear)
    }
  }, [])
  return null
}
