'use client'

// 알림 딥링크 ?focus=<요소 id> 수신 — 그 섹션으로 스크롤하고 파라미터를 즉시 소진한다.
// 종 알림이 목적지 목록만 가진 페이지(/inventory·/contracts)로 보낼 때, 이미 그 페이지에 있으면
// URL 이 그대로라 아무 반응이 없었다. 파라미터를 실어 보내고 받는 쪽이 소진하는 방식으로 봉합한다.

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

/**
 * ?focus=<요소 id> 를 받아 그 요소로 스크롤한다.
 * 처리 즉시 focus 파라미터를 지운다 — 남겨 두면 같은 섹션의 다음 알림을 눌렀을 때 URL 이 같아
 * 내비게이션이 일어나지 않아 또 무반응이 된다. 지운 뒤 재실행되는 회차는 focus 가 없어 곧장 반환한다.
 *
 * prepare 는 섹션이 다른 보기·그룹 안에만 서는 화면이 그 보기를 먼저 여는 자리다(비품 화면의 수령 대기는
 * 미배정 그룹에만 선다). 연 보기는 다음 렌더에 그려지므로 스크롤은 요소가 나타날 때까지 몇 프레임 기다린다.
 * prepare 를 안 넘기는 화면은 종전과 같다.
 *
 * prepare 는 ref 에 담아 효과의 의존에서 뺀다(3차 검수 참고, 2026-10-15). 종전에는 의존에 넣어 두어 부르는 쪽이
 * 인라인 함수를 넘기면 렌더마다 효과가 다시 돌았다. prepare 가 상태를 바꿔 다시 그리는 사이 아직 focus 가 남은
 * searchParams 로 한 번 더 돌아 replace·스크롤이 두 번 났다. 지금은 URL(searchParams)이 바뀔 때만 돈다.
 * 기다리던 스크롤 프레임은 새 딥링크가 오거나 화면을 떠날 때 거둔다(낡은 요청이 늦게 스크롤하지 않게). 파라미터를
 * 소진해 효과가 다시 도는 회차(focus 없음)에는 거두지 않는다. 거두면 방금 연 보기로 가는 스크롤이 사라진다.
 * 효과 본문은 runFocusSection 하나다. 행동 그물(scripts/test-focus-section)이 같은 함수와 이 훅을 부른다.
 */
export function useFocusSection(opts?: { prepare?: (id: string) => void }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const prepareRef = useRef(opts?.prepare)
  const stopRef = useRef<(() => void) | null>(null)
  // 최신 prepare 를 늘 쥔다. 렌더 중 ref 쓰기를 피하려고 효과에서 옮긴다(효과 순서상 아래 효과보다 먼저 돈다).
  useEffect(() => { prepareRef.current = opts?.prepare })
  useEffect(() => {
    const stop = runFocusSection({
      id: searchParams.get('focus'),
      search: searchParams.toString(),
      prepare: id => prepareRef.current?.(id),
      replace: url => router.replace(url, { scroll: false }),
      find: id => document.getElementById(id),
      raf: cb => requestAnimationFrame(cb),
      cancelRaf: h => cancelAnimationFrame(h),
    })
    if (stop) { stopRef.current?.(); stopRef.current = stop }
  }, [searchParams, router])
  // 화면을 떠나면 기다리던 스크롤을 거둔다.
  useEffect(() => () => { stopRef.current?.(); stopRef.current = null }, [])
}

/** 효과 한 회차. 정리 함수를 돌려준다(기다리던 프레임을 거둔다). DOM·라우터는 인자로 받는다(행동 그물이 대역을 넘긴다). */
export function runFocusSection(io: {
  id: string | null
  search: string
  prepare: (id: string) => void
  replace: (url: string) => void
  find: (id: string) => { scrollIntoView: (o: ScrollIntoViewOptions) => void } | null
  raf: (cb: () => void) => number
  cancelRaf: (handle: number) => void
}): (() => void) | undefined {
  const id = io.id
  if (!id) return undefined
  io.prepare(id)
  const params = new URLSearchParams(io.search)
  params.delete('focus')
  const qs = params.toString()
  io.replace(qs ? `?${qs}` : '?')
  // 서버 렌더 직후엔 섹션이 아직 레이아웃 전일 수 있어 다음 프레임에 맞춘다(FinanceClient 와 같은 방식).
  // 요소가 아직 없으면(prepare 가 연 보기가 그려지기 전) 몇 프레임 더 본다. 끝내 없으면 조용히 그친다.
  let left = 10
  let handle = 0
  let live = true
  const tryScroll = () => {
    if (!live) return
    const el = io.find(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    else if (left-- > 0) handle = io.raf(tryScroll)
  }
  handle = io.raf(tryScroll)
  return () => { live = false; io.cancelRaf(handle) }
}
