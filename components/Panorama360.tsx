'use client'

// 360° 파노라마(equirectangular) 뷰어 — pannellum(CDN) 위에 얇은 래퍼.
// 이미지 URL 은 CORS 허용(WebGL 텍스처) 이어야 함 — Drive 사진은 lh3.googleusercontent.com 직접 URL
// (buildDriveImageUrl) 사용. drive.google.com/thumbnail 은 302 리디렉트라 crossOrigin 로드 실패할 수 있음.

import { useEffect, useRef } from 'react'

const PANNELLUM_CSS = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.css'
const PANNELLUM_JS = 'https://cdn.jsdelivr.net/npm/pannellum@2.5.6/build/pannellum.js'

let loaderPromise: Promise<void> | null = null
function loadPannellum(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve()
  if ((window as { pannellum?: unknown }).pannellum) return Promise.resolve()
  if (loaderPromise) return loaderPromise
  loaderPromise = new Promise<void>((resolve, reject) => {
    if (!document.querySelector(`link[href="${PANNELLUM_CSS}"]`)) {
      const link = document.createElement('link')
      link.rel = 'stylesheet'
      link.href = PANNELLUM_CSS
      document.head.appendChild(link)
    }
    const existing = document.querySelector(`script[src="${PANNELLUM_JS}"]`) as HTMLScriptElement | null
    if (existing) {
      if ((window as { pannellum?: unknown }).pannellum) resolve()
      else existing.addEventListener('load', () => resolve())
      return
    }
    const script = document.createElement('script')
    script.src = PANNELLUM_JS
    script.onload = () => resolve()
    script.onerror = () => reject(new Error('pannellum 로드 실패'))
    document.body.appendChild(script)
  })
  return loaderPromise
}

export function Panorama360({ url, className }: { url: string; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const viewerRef = useRef<{ destroy: () => void } | null>(null)

  useEffect(() => {
    let cancelled = false
    loadPannellum().then(() => {
      if (cancelled || !ref.current) return
      const pannellum = (window as unknown as { pannellum?: { viewer: (el: HTMLElement, cfg: object) => { destroy: () => void } } }).pannellum
      if (!pannellum) return
      viewerRef.current = pannellum.viewer(ref.current, {
        type: 'equirectangular',
        panorama: url,
        autoLoad: true,
        autoRotate: -2,
        showZoomCtrl: true,
        showFullscreenCtrl: true,
        hfov: 100,
        minHfov: 50,
        maxHfov: 120,
        friction: 0.15,
        crossOrigin: 'anonymous',
      })
    }).catch(() => {})
    return () => {
      cancelled = true
      try { viewerRef.current?.destroy() } catch { /* noop */ }
      viewerRef.current = null
    }
  }, [url])

  return <div ref={ref} className={className} />
}
