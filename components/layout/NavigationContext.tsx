'use client'

import { createContext, useContext } from 'react'

type StartNavigation = (fn: () => void) => void

const NavigationContext = createContext<StartNavigation | null>(null)

/**
 * AppShell 의 useTransition(startNavigation)을 페이지 트리 깊은 곳까지 공급한다.
 * 월 셀렉터가 헤더 → 페이지 콘텐츠 상단으로 내려가면서 prop 전달이 끊겼기 때문에,
 * 페이지 안의 컨트롤도 이 컨텍스트로 전환 로딩 오버레이(BrandLoader)를 띄울 수 있게 한다.
 */
export function NavigationProvider({
  startNavigation,
  children,
}: {
  startNavigation: StartNavigation
  children: React.ReactNode
}) {
  return (
    <NavigationContext.Provider value={startNavigation}>
      {children}
    </NavigationContext.Provider>
  )
}

// Provider 밖에서 쓰면 undefined → 호출부는 직접 navigate()로 폴백한다.
export function useStartNavigation(): StartNavigation | undefined {
  return useContext(NavigationContext) ?? undefined
}
