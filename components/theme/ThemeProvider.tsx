'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system' | 'time'

const STORAGE_KEY = 'roomos-theme'
const DEFAULT_MODE: ThemeMode = 'system'

// 시간 기반: KST 기준 06:00 ~ 18:00 light, 그 외 dark.
// 추후 위치별 일출/일몰 API로 정교화 가능.
function isLightByTime(): boolean {
  const h = new Date().getHours()
  return h >= 6 && h < 18
}

function applyTheme(mode: ThemeMode) {
  if (typeof document === 'undefined') return
  let isDark: boolean
  if (mode === 'dark') isDark = true
  else if (mode === 'light') isDark = false
  else if (mode === 'time') isDark = !isLightByTime()
  else /* system */ isDark = window.matchMedia('(prefers-color-scheme: dark)').matches
  document.documentElement.classList.toggle('dark', isDark)
}

export function getStoredTheme(): ThemeMode {
  if (typeof window === 'undefined') return DEFAULT_MODE
  const v = window.localStorage.getItem(STORAGE_KEY)
  if (v === 'light' || v === 'dark' || v === 'system' || v === 'time') return v
  return DEFAULT_MODE
}

/** 클라이언트 훅 — 현재 모드 + 변경 함수 + 실제 isDark 결과 */
export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(DEFAULT_MODE)
  const [isDark, setIsDark] = useState(false)

  // 초기화 + 시스템·시간 변경 listen
  useEffect(() => {
    const stored = getStoredTheme()
    setModeState(stored)
    applyTheme(stored)
    setIsDark(document.documentElement.classList.contains('dark'))

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onSysChange = () => {
      if (getStoredTheme() === 'system') {
        applyTheme('system')
        setIsDark(document.documentElement.classList.contains('dark'))
      }
    }
    mq.addEventListener('change', onSysChange)

    // 시간 모드 — 30분마다 체크 (06:00 / 18:00 경계 자동 전환)
    const timeInterval = setInterval(() => {
      if (getStoredTheme() === 'time') {
        applyTheme('time')
        setIsDark(document.documentElement.classList.contains('dark'))
      }
    }, 30 * 60 * 1000)

    return () => {
      mq.removeEventListener('change', onSysChange)
      clearInterval(timeInterval)
    }
  }, [])

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next)
    applyTheme(next)
    if (typeof document !== 'undefined') {
      setIsDark(document.documentElement.classList.contains('dark'))
    }
  }, [])

  return useMemo(() => ({ mode, setMode, isDark }), [mode, setMode, isDark])
}

/** ThemeProvider — 자식을 그대로 렌더. useTheme 훅이 마운트 시 적용을 수행. */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // 마운트 시 한번 동기화 (useEffect 내부에서 적용)
  useTheme()
  return <>{children}</>
}

/** FOUC 방지용 인라인 스크립트 — layout <head>에 dangerouslySetInnerHTML로 주입.
   서버 렌더 직후 클라이언트 hydration 전 .dark 클래스를 미리 토글. */
export const themeBootstrapScript = `
(function() {
  try {
    var k = '${STORAGE_KEY}';
    var m = localStorage.getItem(k);
    if (m !== 'light' && m !== 'dark' && m !== 'system' && m !== 'time') m = '${DEFAULT_MODE}';
    var dark;
    if (m === 'dark') dark = true;
    else if (m === 'light') dark = false;
    else if (m === 'time') { var h = new Date().getHours(); dark = !(h >= 6 && h < 18); }
    else { dark = window.matchMedia('(prefers-color-scheme: dark)').matches; }
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* localStorage 비활성·SSR 등 무시 */ }
})();
`
