'use client'

import { useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { kstMonthStr } from '@/lib/kstDate'

// 다음 KST 자정 +5초까지 남은 ms. 기기 로컬 자정으로 재면 KST 아닌 환경에서 최대 9시간 어긋나
// 달이 바뀐 뒤에도 한참 stale 한 화면을 들고 있게 된다(KST 는 서머타임이 없어 고정 +9로 충분).
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
function msUntilNextKstMidnight(): number {
  const kstNow = Date.now() + KST_OFFSET_MS
  return 86400000 - (kstNow % 86400000)
}

/**
 * 보이지 않는 월 동기화기 — 셸(AppShell)에 항상 마운트된다.
 *
 * URL 에 ?month= 가 없으면 서버 컴포넌트는 "오늘 달" 기준으로 렌더되는데,
 * 탭을 오래 켜두거나 앱을 재진입해 자정이 지나면 그 결과가 stale 해진다.
 * 그래서 ?month= 가 없을 때만 자정 롤오버·재진입 시 router.refresh() 로 재요청한다.
 *
 * (보이는 월 컨트롤 ◀ 5월 ▶ 는 MonthSelector 로 분리되어 각 월-페이지 콘텐츠 상단에 있다.
 *  컨트롤은 페이지마다 마운트/언마운트되지만, 이 동기화기는 항상 살아있어야 하므로 셸에 남긴다.)
 */
export default function MonthSync() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const todayMonth = kstMonthStr()
  const prevTodayMonthRef = useRef(todayMonth)

  // 렌더 사이에 todayMonth 가 바뀌었으면(자정 경과) 즉시 갱신
  useEffect(() => {
    if (prevTodayMonthRef.current === todayMonth) return
    prevTodayMonthRef.current = todayMonth
    if (!searchParams.has('month')) router.refresh()
  }, [todayMonth, searchParams, router])

  // 다음 자정 +5초에 한 번 깨어나 달이 바뀌었으면 갱신
  useEffect(() => {
    const ms = msUntilNextKstMidnight() + 5000
    const t = setTimeout(() => {
      const next = kstMonthStr()
      if (prevTodayMonthRef.current !== next) {
        prevTodayMonthRef.current = next
        if (!searchParams.has('month')) router.refresh()
      }
    }, ms)
    return () => clearTimeout(t)
  }, [searchParams, router])

  // 새 탭·앱 재진입 시: 마지막으로 본 달과 오늘 달이 다르면 즉시 갱신
  useEffect(() => {
    const SEEN_KEY = 'stayeum_seen_month'
    const seen = sessionStorage.getItem(SEEN_KEY)
    if (seen !== todayMonth) {
      sessionStorage.setItem(SEEN_KEY, todayMonth)
      if (!searchParams.has('month')) router.refresh()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return null
}
