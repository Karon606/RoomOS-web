'use client'

// 원형 로고 크롭 도구 — 인스타/페북 프로필 사진식. 큰 화면에서 드래그로 위치,
// 슬라이더·휠·핀치로 확대/축소, 원형 마스크로 잘릴 범위 미리보기. 확정 시 정사각 PNG 출력
// (헤더·사이드바가 rounded-full 로 원형 클립하므로 정사각 저장이면 충분).

import { useEffect, useRef, useState } from 'react'
import { Modal } from './Modal'
import { Btn } from './Btn'

const VIEW = 288   // 표시 크롭 영역(정사각, px)
const OUT = 512    // 출력 해상도(px)
const MAX_ZOOM = 4

export function ImageCropModal({ src, title = '로고 위치 조정', onCancel, onConfirm }: {
  src: string
  title?: string
  onCancel: () => void
  onConfirm: (blob: Blob) => void | Promise<void>
}) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [busy, setBusy] = useState(false)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const pinch = useRef<{ dist: number; zoom: number } | null>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())

  useEffect(() => {
    const im = new Image()
    im.onload = () => { setImg(im); setZoom(1); setOffset({ x: 0, y: 0 }) }
    im.src = src
  }, [src])

  // zoom=1 에서 정사각 뷰포트를 꽉 채우는 배율(cover)
  const cover = img ? Math.max(VIEW / img.naturalWidth, VIEW / img.naturalHeight) : 1
  const imgW = img ? img.naturalWidth * cover * zoom : 0
  const imgH = img ? img.naturalHeight * cover * zoom : 0
  const maxOX = Math.max(0, (imgW - VIEW) / 2)
  const maxOY = Math.max(0, (imgH - VIEW) / 2)
  const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v))
  const ox = clamp(offset.x, maxOX)
  const oy = clamp(offset.y, maxOY)

  // 줌이 바뀌면 오프셋이 범위를 벗어나지 않게 재클램프
  useEffect(() => {
    setOffset(o => ({ x: clamp(o.x, maxOX), y: clamp(o.y, maxOY) }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), zoom }
      drag.current = null
    } else {
      drag.current = { x: e.clientX, y: e.clientY, ox, oy }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      setZoom(Math.max(1, Math.min(MAX_ZOOM, pinch.current.zoom * (dist / pinch.current.dist))))
      return
    }
    if (!drag.current) return
    setOffset({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) })
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) drag.current = null
  }
  const onWheel = (e: React.WheelEvent) => {
    setZoom(z => Math.max(1, Math.min(MAX_ZOOM, z - e.deltaY * 0.0025)))
  }

  const handleConfirm = async () => {
    if (!img || busy) return
    setBusy(true)
    try {
      const canvas = document.createElement('canvas')
      canvas.width = OUT; canvas.height = OUT
      const ctx = canvas.getContext('2d')
      if (!ctx) { setBusy(false); return }
      const s = cover * zoom
      const sW = VIEW / s                        // 뷰포트에 해당하는 소스 폭(=높이)
      const imgLeft = (VIEW - imgW) / 2 + ox      // 뷰포트 좌표상 이미지 좌상단
      const imgTop = (VIEW - imgH) / 2 + oy
      const sx = -imgLeft / s
      const sy = -imgTop / s
      ctx.drawImage(img, sx, sy, sW, sW, 0, 0, OUT, OUT)
      const blob = await new Promise<Blob | null>(res => canvas.toBlob(res, 'image/png', 0.92))
      if (blob) await onConfirm(blob)
    } finally { setBusy(false) }
  }

  return (
    <Modal open onClose={onCancel} width="sm" z={260} title={title}
      footer={
        <div className="flex justify-end gap-2">
          <Btn variant="secondary" size="md" onClick={onCancel} disabled={busy}>취소</Btn>
          <Btn variant="primary" size="md" onClick={handleConfirm} disabled={busy || !img}>{busy ? '적용 중…' : '적용'}</Btn>
        </div>
      }>
      <div className="p-5 flex flex-col items-center gap-4">
        <div
          className="relative select-none"
          style={{ width: VIEW, height: VIEW, overflow: 'hidden', touchAction: 'none', background: 'var(--canvas)', borderRadius: 12, cursor: drag.current ? 'grabbing' : 'grab' }}
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}
        >
          {img && (
            <img src={src} alt="" draggable={false}
              style={{
                position: 'absolute', left: '50%', top: '50%',
                width: imgW, height: imgH, maxWidth: 'none',
                transform: `translate(${-imgW / 2 + ox}px, ${-imgH / 2 + oy}px)`,
                userSelect: 'none', pointerEvents: 'none',
              }} />
          )}
          {/* 원형 마스크 — 원 밖을 어둡게 + 테두리 (잘릴 범위 미리보기) */}
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)', pointerEvents: 'none' }} />
          <div style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.9)', pointerEvents: 'none' }} />
        </div>
        <div className="w-full flex items-center gap-2">
          <span className="text-[var(--warm-muted)] text-xs shrink-0">축소</span>
          <input type="range" min={1} max={MAX_ZOOM} step={0.01} value={zoom}
            onChange={e => setZoom(Number(e.target.value))}
            className="flex-1" style={{ accentColor: 'var(--coral)' }} aria-label="확대/축소" />
          <span className="text-[var(--warm-muted)] text-xs shrink-0">확대</span>
        </div>
        <p className="text-[0.6875rem] text-[var(--warm-muted)] text-center">
          드래그로 위치 이동 · 슬라이더(또는 휠·두 손가락)로 확대/축소<br />원 안에 들어오는 부분이 로고로 저장됩니다
        </p>
      </div>
    </Modal>
  )
}
