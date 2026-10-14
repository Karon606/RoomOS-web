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
 *
 * prepare 는 섹션이 다른 보기·그룹 안에만 서는 화면이 그 보기를 먼저 여는 자리다(비품 화면의 수령 대기는
 * 미배정 그룹에만 선다). 연 보기는 다음 렌더에 그려지므로 스크롤은 요소가 나타날 때까지 몇 프레임 기다린다.
 * 넘기는 함수는 렌더마다 바뀌지 않게(useCallback) 한다. prepare 를 안 넘기는 화면은 종전과 같다.
 */
export function useFocusSection(opts?: { prepare?: (id: string) => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prepare = opts?.prepare
  useEffect(() => {
    const id = searchParams.get('focus')
    if (!id) return
    prepare?.(id)
    const params = new URLSearchParams(searchParams.toString())
    params.delete('focus')
    const qs = params.toString()
    router.replace(qs ? `?${qs}` : '?', { scroll: false })
    // 서버 렌더 직후엔 섹션이 아직 레이아웃 전일 수 있어 다음 프레임에 맞춘다(FinanceClient 와 같은 방식).
    // 요소가 아직 없으면(prepare 가 연 보기가 그려지기 전) 몇 프레임 더 본다. 끝내 없으면 조용히 그친다.
    let left = 10
    const tryScroll = () => {
      const el = document.getElementById(id)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      else if (left-- > 0) requestAnimationFrame(tryScroll)
    }
    requestAnimationFrame(tryScroll)
  }, [searchParams, router, prepare])
}
