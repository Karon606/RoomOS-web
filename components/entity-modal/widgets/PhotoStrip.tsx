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
  const containerRef = useRef<HTMLDivElement>(null)
  const curImgRef = useRef<HTMLImageElement>(null)

  // 확대(줌) 상태 — 현재 사진. 사진 바뀌면 초기화.
  const MAX_ZOOM = 4
  const [scale, setScale]   = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null)
  const panRef   = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const swipeRef = useRef<{ x: number; y: number } | null>(null)
  const tapRef   = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null)
  const multiRef = useRef(false)   // 핀치(2손가락) 발생 시 단일터치 팬/스와이프 무시
  const lastTap  = useRef(0)

  // 360 보기 — 360 가능(파일명 단서 또는 2:1 비율) + driveFileId 있을 때만 토글 노출.
  const cur = photos[index]
  const [ratio360, setRatio360] = useState<Set<string>>(new Set())
  const is360Capable = !!cur?.driveFileId && (looksLike360(cur?.fileName) || (cur ? ratio360.has(cur.id) : false))
  const [view360, setView360] = useState(false)
  useEffect(() => {
    setView360(!!cur?.driveFileId && looksLike360(cur?.fileName))
    setScale(1); setOffset({ x: 0, y: 0 })  // 사진 전환 시 줌 초기화
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

  const onImgLoad = (p: Photo, e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const r = img.naturalWidth / img.naturalHeight
    if (r >= 1.9 && r <= 2.1) setRatio360(prev => prev.has(p.id) ? prev : new Set(prev).add(p.id))
  }

  // 확대 상태에서 이미지가 화면 밖으로 과하게 빠지지 않게 오프셋 제한
  const clampOffset = (o: { x: number; y: number }, s: number) => {
    const img = curImgRef.current, wrap = containerRef.current
    if (!img || !wrap) return o
    const maxX = Math.max(0, (img.offsetWidth * s - wrap.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * s - wrap.clientHeight) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
  }
  const applyScale = (next: number) => {
    const s = Math.max(1, Math.min(MAX_ZOOM, next))
    setScale(s)
    setOffset(o => clampOffset(s === 1 ? { x: 0, y: 0 } : o, s))
  }
  const toggleZoom = () => applyScale(scale > 1 ? 1 : 2)

  const onPointerDown = (e: React.PointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setAnimating(false)
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinchRef.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale }
      multiRef.current = true
      panRef.current = null; swipeRef.current = null; tapRef.current = null; setDrag(0)
    } else if (!multiRef.current) {
      tapRef.current = { t: Date.now(), x: e.clientX, y: e.clientY, moved: false }
      if (scale > 1) { panRef.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }; swipeRef.current = null }
      else { swipeRef.current = { x: e.clientX, y: e.clientY }; panRef.current = null }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinchRef.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      applyScale(pinchRef.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinchRef.current.dist))
      return
    }
    if (multiRef.current) return
    if (tapRef.current && Math.hypot(e.clientX - tapRef.current.x, e.clientY - tapRef.current.y) > 16) tapRef.current.moved = true
    if (panRef.current) {
      setOffset(clampOffset({ x: panRef.current.ox + (e.clientX - panRef.current.x), y: panRef.current.oy + (e.clientY - panRef.current.y) }, scale))
    } else if (swipeRef.current) {
      const dx = e.clientX - swipeRef.current.x, dy = e.clientY - swipeRef.current.y
      if (Math.abs(dx) > Math.abs(dy)) setDrag(dx)
    }
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinchRef.current = null
    if (pointers.current.size === 0) {
      if (swipeRef.current) {
        const w = containerRef.current?.offsetWidth ?? window.innerWidth
        const threshold = Math.max(50, w * 0.15)
        setAnimating(true)
        if (Math.abs(drag) > threshold) go(drag > 0 ? -1 : 1)
        setDrag(0)
      }
      const t = tapRef.current
      if (t && !t.moved && Date.now() - t.t < 400) {
        if (Date.now() - lastTap.current < 400) { toggleZoom(); lastTap.current = 0 }
        else lastTap.current = Date.now()
      }
      panRef.current = null; swipeRef.current = null; tapRef.current = null; multiRef.current = false
    }
  }

  const handleClose = () => {
    setMounted(false)
    setTimeout(onClose, 200)
  }

  const trackTransform = `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)`

  return (
    <div
      className={`fixed inset-0 z-[var(--z-lightbox)] flex items-center justify-center select-none transition-[opacity,backdrop-filter] duration-200 ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0,0,0,0.95)' }}
      onClick={handleClose}
    >
      <button
        onClick={e => { e.stopPropagation(); handleClose() }}
        className="absolute top-4 right-4 z-10 text-white/80 hover:text-white w-10 h-10 flex items-center justify-center rounded-full bg-black/40"
        aria-label="닫기"
      ><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6L6 18M6 6l12 12" /></svg></button>

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

      {/* 360 / 일반 토글 — 360 가능 사진(파일명 단서 또는 2:1 비율)일 때만 */}
      {is360Capable && (
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
        style={view360 ? undefined : { touchAction: 'none' }}
        {...(view360 ? {} : {
          onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp,
          onWheel: (e: React.WheelEvent) => applyScale(scale - e.deltaY * 0.003),
          onDoubleClick: toggleZoom,
        })}
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
            {photos.map((p, i) => (
              <div key={p.id} className="w-full h-full shrink-0 flex items-center justify-center px-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  ref={i === index ? curImgRef : undefined}
                  src={p.driveFileId ? driveImageUrl(p.driveFileId, 2000) : p.storageUrl}
                  alt={p.fileName ?? ''}
                  onLoad={e => onImgLoad(p, e)}
                  className="max-w-[95vw] max-h-[90vh] object-contain select-none"
                  style={i === index
                    ? { transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`, transformOrigin: 'center', cursor: scale > 1 ? 'grab' : 'auto' }
                    : { pointerEvents: 'none' }}
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
