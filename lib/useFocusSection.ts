'use client'

// 알림 딥링크 ?focus=<요소 id> 수신 — 그 섹션으로 스크롤하고 파라미터를 즉시 소진한다.
// 종 알림이 목적지 목록만 가진 페이지(/inventory·/contracts)로 보낼 때, 이미 그 페이지에 있으면
// URL 이 그대로라 아무 반응이 없었다. 파라미터를 실어 보내고 받는 쪽이 소진하는 방식으로 봉합한다.

import { useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * ?focus=<요소 id> 를 받아 그 요소로 스크롤한다.
 * 처리 즉시 focus 파라미터를 지운다 — 남겨 두면 같은 섹션의 다음 알림을 눌렀을 때 URL 이 같아
 * 내비게이션이 일어나지 않아 또 무반응이 된다. 지운 뒤 재실행되는 회차는 focus 가 없어 곧장 반환한다.
 */
export function useFocusSection() {
  const router = useRouter()
  const searchParams = useSearchParams()
  useEffect(() => {
    const id = searchParams.get('focus')
    if (!id) return
    const params = new URLSearchParams(searchParams.toString())
    params.delete('focus')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
    // 서버 렌더 직후엔 섹션이 아직 레이아웃 전일 수 있어 다음 프레임에 맞춘다(FinanceClient 와 같은 방식).
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [searchParams, router])
}
