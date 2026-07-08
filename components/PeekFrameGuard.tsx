'use client'

// 살짝 보기 프레임 감지 — PeekSheet iframe 안에서 열리면 html 에 표식을 달아
// 앱 크롬([data-peek-hide])을 숨긴다. 최상위 창에서는 아무 일도 안 함.
import { useEffect } from 'react'

export default function PeekFrameGuard() {
  useEffect(() => {
    let framed = false
    try { framed = window.self !== window.top } catch { framed = true }
    if (framed) document.documentElement.setAttribute('data-peek-frame', '1')
  }, [])
  return null
}
