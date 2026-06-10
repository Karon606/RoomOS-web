'use client'

// 사진 가로 스트립 + 클릭 시 풀스크린 라이트박스(키보드/스와이프/Drive 원본).
// 어떤 entity (호실·고객 등) 의 사진이든 동일 동작.

import { useEffect, useRef, useState } from 'react'
import { Panorama360 } from '@/components/Panorama360'
import { driveImageUrl, looksLike360 } from '@/lib/driveImage'

export type Photo = { id: string; storageUrl: string; fileName: string | null; driveFileId: string | null }

export function PhotoStrip({ photos }: { photos: Photo[] }) {
  const [idx, setIdx] = useState<number | null>(null)
  if (photos.length === 0) return null
  return (
    <>
      <div className="flex gap-2 overflow-x-auto pb-3 mb-3 border-b border-[var(--warm-border)]" style={{ scrollbarWidth: 'none' }}>
        {photos.map((p, i) => (
          <div key={p.id} className="relative shrink-0">
            <img src={p.storageUrl} alt=""
              onClick={() => setIdx(i)}
              className="h-44 w-44 object-cover rounded-xl cursor-zoom-in" />
            {looksLike360(p.fileName) && (
              <span className="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/65 text-white text-[0.625rem] font-bold pointer-events-none">360°</span>
            )}
          </div>
        ))}
      </div>
      {idx != null && (
        <Lightbox photos={photos} index={idx} onIndexChange={setIdx} onClose={() => setIdx(null)} />
      )}
    </>
  )
}

// 풀스크린 라이트박스 — 키보드 ←/→/ESC + 가로 스와이프 + Drive 원본 보기.
function Lightbox({ photos, index, onIndexChange, onClose }: {
  photos: Photo[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const total = photos.length
  const [mounted, setMounted]     = useState(false)
  const [drag, setDrag]           = useState(0)
  const [animating, setAnimating] = useState(false)
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // 360 보기 — 현재 사진이 360(파일명 단서)이고 driveFileId 있으면 기본 ON. 사진 바뀌면 재설정.
  const cur = photos[index]
  const can360 = !!cur?.driveFileId
  const [view360, setView360] = useState(false)
  useEffect(() => {
    setView360(can360 && looksLike360(cur?.fileName))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index])

  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const go = (delta: number) => {
    const next = (index + delta + total) % total
    setAnimating(true)
    onIndexChange(next)
    setTimeout(() => setAnimating(false), 320)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return }
      if (view360) return  // 360 보기 중엔 화살표를 pannellum 시점 이동에 양보
      if (e.key === 'ArrowLeft')  go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total, view360])

  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    setAnimating(false)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dx = e.touches[0].clientX - touchStart.current.x
    const dy = e.touches[0].clientY - touchStart.current.y
    if (Math.abs(dx) > Math.abs(dy)) setDrag(dx)
  }
  const onTouchEnd = () => {
    if (!touchStart.current) { setDrag(0); return }
    const w = containerRef.current?.offsetWidth ?? window.innerWidth
    const threshold = Math.max(50, w * 0.15)
    setAnimating(true)
    if (Math.abs(drag) > threshold) go(drag > 0 ? -1 : 1)
    setDrag(0)
    touchStart.current = null
  }

  const handleClose = () => {
    setMounted(false)
    setTimeout(onClose, 200)
  }

  const trackTransform = `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)`

  return (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center select-none transition-[opacity,backdrop-filter] duration-200 ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0,0,0,0.95)' }}
      onClick={handleClose}
    >
      <button
        onClick={e => { e.stopPropagation(); handleClose() }}
        className="absolute top-4 right-4 z-10 text-white/80 hover:text-white text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full bg-black/40"
        aria-label="닫기"
      >✕</button>

      {photos[index]?.driveFileId && (
        <a
          href={`https://drive.google.com/file/d/${photos[index].driveFileId}/view`}
          target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="absolute top-4 right-16 z-10 text-white/80 hover:text-white text-xs px-3 h-10 flex items-center rounded-full bg-black/40"
        >원본 보기 ↗</a>
      )}

      <div className="absolute top-4 left-4 z-10 text-white/80 text-sm font-medium px-3 py-1 rounded-full bg-black/40">
        {index + 1} / {total}
      </div>

      {/* 360 / 일반 토글 — driveFileId 있을 때만 */}
      {can360 && (
        <button
          onClick={e => { e.stopPropagation(); setView360(v => !v) }}
          className="absolute top-4 left-1/2 -translate-x-1/2 z-10 text-white text-xs font-semibold px-3 h-10 flex items-center rounded-full bg-black/40 hover:bg-black/60 transition-colors"
        >
          {view360 ? '일반 사진으로 보기' : '360°로 보기'}
        </button>
      )}

      {total > 1 && (
        <button onClick={e => { e.stopPropagation(); go(-1) }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hidden sm:flex"
          aria-label="이전">‹</button>
      )}
      {total > 1 && (
        <button onClick={e => { e.stopPropagation(); go(1) }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hidden sm:flex"
          aria-label="다음">›</button>
      )}

      <div
        ref={containerRef}
        className={`w-full h-full overflow-hidden ${mounted ? 'scale-100' : 'scale-95'} transition-transform duration-200`}
        onClick={e => e.stopPropagation()}
        {...(view360 ? {} : { onTouchStart, onTouchMove, onTouchEnd })}
      >
        {view360 && cur?.driveFileId ? (
          // 360 뷰어 — 현재 사진만. 드래그/휠은 pannellum 이 처리(스와이프 비활성).
          <Panorama360 key={cur.id} url={driveImageUrl(cur.driveFileId, 2048)} className="w-full h-full" />
        ) : (
          <div className="flex h-full"
            style={{
              transform: trackTransform,
              transition: animating ? 'transform 320ms cubic-bezier(0.22,1,0.36,1)' : 'none',
            }}>
            {photos.map(p => (
              <div key={p.id} className="w-full h-full shrink-0 flex items-center justify-center px-2">
                <img
                  src={p.driveFileId ? driveImageUrl(p.driveFileId, 2000) : p.storageUrl}
                  alt={p.fileName ?? ''}
                  className="max-w-[95vw] max-h-[90vh] object-contain pointer-events-none"
                  draggable={false}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
