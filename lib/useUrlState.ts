'use client'

import { useEffect, useState, useRef } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'

/**
 * 컴포넌트 상태를 URL 쿼리스트링에 동기화하는 hook.
 * - 빈 값이면 키 제거, 그 외에는 키=값 유지
 * - debounce(default 300ms)로 router.replace 호출 (history 누적 방지)
 * - 초기값은 URL의 해당 key에서 읽음. 없으면 fallback
 */
export function useUrlState(
  key: string,
  fallback = '',
  debounceMs = 300,
): [string, (v: string) => void] {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const initial = params.get(key) ?? fallback
  const [value, setValue] = useState(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => {
      const sp = new URLSearchParams(params.toString())
      if (value) sp.set(key, value)
      else sp.delete(key)
      const qs = sp.toString()
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false })
    }, debounceMs)
    return () => { if (timer.current) clearTimeout(timer.current) }
    // params 의존성에 의해 무한 루프 발생 가능 — value만 추적
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return [value, setValue]
}
