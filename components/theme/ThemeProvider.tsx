'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system' | 'time'

const STORAGE_KEY = 'stayeum-theme'
const DEFAULT_MODE: ThemeMode = 'system'
// 빠른 전환(사이드바)의 임시 오버라이드 — '시스템 따라'·'시간 기반'일 때만 쓴다.
// base = 오버라이드 당시의 기저 테마. 기저가 바뀌는 순간(예: 시스템이 18시에 다크로) 오버라이드는 만료되고
// 다시 시스템/시간을 따른다(운영자 확정 2026-07-18 — 빠른 전환이 설정을 영구히 덮어쓰지 않는다).
const OVERRIDE_KEY = 'stayeum-theme-override'
type ThemeOverride = { v: 'light' | 'dark'; base: 'light' | 'dark' }
function readOverride(): ThemeOverride | null {
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY)
    if (!raw) return null
    const o = JSON.parse(raw) as ThemeOverride
    if ((o.v === 'light' || o.v === 'dark') && (o.base === 'light' || o.base === 'dark')) return o
  } catch { /* 무시 */ }
  return null
}
function clearOverride() {
  try { window.localStorage.removeItem(OVERRIDE_KEY) } catch { /* 무시 */ }
}

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
  else {
    // 기저(시스템/시간) 계산 후 임시 오버라이드 적용 — 기저가 오버라이드 시점과 달라졌으면 만료
    const underlying = mode === 'time' ? !isLightByTime() : window.matchMedia('(prefers-color-scheme: dark)').matches
    const ov = readOverride()
    if (ov && (ov.base === 'dark') === underlying) {
      isDark = ov.v === 'dark'
    } else {
      if (ov) clearOverride()
      isDark = underlying
    }
  }
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
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(STORAGE_KEY, next)
      clearOverride()   // 환경설정에서 명시적으로 고르면 임시 전환은 종료
    }
    applyTheme(next)
    if (typeof document !== 'undefined') {
      setIsDark(document.documentElement.classList.contains('dark'))
    }
  }, [])

  // 빠른 전환(사이드바) — '시스템 따라'·'시간 기반'이면 설정을 바꾸지 않고 임시 오버라이드만 건다.
  // 기저가 다음에 바뀌는 시점(시스템 전환·06/18시 경계)에 자동 만료되어 다시 따라간다.
  // 고정 모드(light/dark)면 종전처럼 반대 고정 모드로 전환.
  const toggleQuick = useCallback(() => {
    if (typeof window === 'undefined') return
    const cur = getStoredTheme()
    const isDarkNow = document.documentElement.classList.contains('dark')
    if (cur === 'system' || cur === 'time') {
      const underlying = cur === 'time' ? !isLightByTime() : window.matchMedia('(prefers-color-scheme: dark)').matches
      const ov: ThemeOverride = { v: isDarkNow ? 'light' : 'dark', base: underlying ? 'dark' : 'light' }
      try { window.localStorage.setItem(OVERRIDE_KEY, JSON.stringify(ov)) } catch { /* 무시 */ }
      applyTheme(cur)
    } else {
      setMode(isDarkNow ? 'light' : 'dark')
    }
    setIsDark(document.documentElement.classList.contains('dark'))
  }, [setMode])

  return useMemo(() => ({ mode, setMode, isDark, toggleQuick }), [mode, setMode, isDark, toggleQuick])
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
    else {
      var und;
      if (m === 'time') { var h = new Date().getHours(); und = !(h >= 6 && h < 18); }
      else { und = window.matchMedia('(prefers-color-scheme: dark)').matches; }
      dark = und;
      try {
        var ovRaw = localStorage.getItem('${OVERRIDE_KEY}');
        if (ovRaw) {
          var ov = JSON.parse(ovRaw);
          if (ov && (ov.v === 'light' || ov.v === 'dark') && ((ov.base === 'dark') === und)) dark = ov.v === 'dark';
          else localStorage.removeItem('${OVERRIDE_KEY}');
        }
      } catch (e) { /* 무시 */ }
    }
    if (dark) document.documentElement.classList.add('dark');
  } catch (e) { /* localStorage 비활성·SSR 등 무시 */ }
})();
`
