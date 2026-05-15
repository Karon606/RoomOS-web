'use client'

import { useEffect, useState, useCallback, useMemo } from 'react'

export type FontSizeLevel = 'compact' | 'default' | 'large' | 'xlarge'

const STORAGE_KEY = 'stayeum-font-size'
const DEFAULT_LEVEL: FontSizeLevel = 'default'

// html font-size in px per level — Tailwind rem units scale accordingly
const FONT_SIZE_PX: Record<FontSizeLevel, number> = {
  compact: 14,
  default: 16,
  large:   18,
  xlarge:  20,
}

function applyFontSize(level: FontSizeLevel) {
  if (typeof document === 'undefined') return
  document.documentElement.setAttribute('data-font-size', level)
  document.documentElement.style.fontSize = `${FONT_SIZE_PX[level]}px`
}

export function getStoredFontSize(): FontSizeLevel {
  if (typeof window === 'undefined') return DEFAULT_LEVEL
  const v = window.localStorage.getItem(STORAGE_KEY)
  if (v === 'compact' || v === 'default' || v === 'large' || v === 'xlarge') return v
  return DEFAULT_LEVEL
}

export function useFontSize() {
  const [level, setLevelState] = useState<FontSizeLevel>(DEFAULT_LEVEL)

  useEffect(() => {
    const stored = getStoredFontSize()
    setLevelState(stored)
    applyFontSize(stored)
  }, [])

  const setLevel = useCallback((next: FontSizeLevel) => {
    setLevelState(next)
    if (typeof window !== 'undefined') window.localStorage.setItem(STORAGE_KEY, next)
    applyFontSize(next)
  }, [])

  return useMemo(() => ({ level, setLevel }), [level, setLevel])
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  useFontSize()
  return <>{children}</>
}

/** FOUC 방지용 인라인 스크립트 */
export const fontSizeBootstrapScript = `
(function() {
  try {
    var k = '${STORAGE_KEY}';
    var v = localStorage.getItem(k);
    var valid = ['compact','default','large','xlarge'];
    if (!valid.includes(v)) v = '${DEFAULT_LEVEL}';
    var px = {compact:14,default:16,large:18,xlarge:20};
    document.documentElement.setAttribute('data-font-size', v);
    document.documentElement.style.fontSize = px[v] + 'px';
  } catch(e) {}
})();
`
