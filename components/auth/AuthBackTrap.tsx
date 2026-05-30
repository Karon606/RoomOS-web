'use client'

// 로그인 직후 랜딩 페이지에서 **첫 뒤로가기 1회 만** 소비해 google.com/accounts 노출을 차단.
// /callback 이 redirect 시 ?_fa=1 을 붙여 신호. 본 컴포넌트가 그 플래그를 보고 1회 트랩.
// - replaceState 로 _fa=1 제거 + pushState 로 더미 항목 추가
// - popstate 1회 발생 시 같은 URL 로 다시 pushState → 사용자 위치 유지
// - 1회 소비 후 리스너 제거 → 이후 정상 뒤로가기

import { useEffect } from 'react'

export function AuthBackTrap() {
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('_fa') !== '1') return

    // 1) _fa 플래그 제거 (현재 entry 를 깨끗한 URL 로 교체)
    url.searchParams.delete('_fa')
    const cleanHref = url.pathname + (url.search || '') + url.hash
    window.history.replaceState(null, '', cleanHref)

    // 2) 같은 URL 로 더미 push — back 이 이 더미를 소비한 뒤 멈추도록
    window.history.pushState(null, '', cleanHref)

    let consumed = false
    const onPop = () => {
      if (consumed) return
      consumed = true
      // 다시 같은 URL 로 push → 사용자 위치 유지
      window.history.pushState(null, '', cleanHref)
      // 1회 소비했으니 리스너 제거
      window.removeEventListener('popstate', onPop)
    }
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  return null
}
