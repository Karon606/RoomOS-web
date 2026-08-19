'use client'

// 사진 뷰어·업로드 공용 정본 — 방 사진과 공용·외관 사진이 같은 조작감을 쓰도록 한 자리에 모았다.
// 종전에는 RoomManageClient 가 이 셋을 내보내고 PropertyPhotosManager 가 되받는 순환 참조였고,
// 그 회피용 dynamic() 때문에 공용 사진 모달을 다른 화면에서 열면 호실 관리 클라이언트가 통째로 딸려 왔다.
import { useState, useEffect, useRef } from 'react'
import { Panorama360 } from '@/components/Panorama360'
import { driveImageUrl, looksLike360 } from '@/lib/driveImage'

export type Photo = {
  id: string
  driveFileId: string | null
  storageUrl: string
  fileName: string | null
  showOnSite?: boolean   // 사진 단위 공개 여부(방 공개가 켜졌을 때 노출 대상). 기본 공개
  is360?: boolean        // 360 파노라마 — 대표(카드 썸네일) 후보에서 제외
}

// 사진 lightbox — 큰 사진 + 360 뷰어. 360 판정: 파일명 단서(기본) + 2:1 종횡비 자동 감지 + 수동 토글.
// onSetMain: 편집 모달에서 열렸고 대표(첫 장)가 아닐 때만 전달됨 — '대표로 설정' 버튼 노출.
export function PhotoLightbox({ photo, onClose, onSetMain, onToggle360 }: { photo: Photo; onClose: () => void; onSetMain?: () => void; onToggle360?: (next: boolean) => Promise<boolean> }) {
  const hiRes = photo.driveFileId ? driveImageUrl(photo.driveFileId, 2048) : photo.storageUrl
  // 저장된 지정(is360) 우선, 없으면 파일명 추정. 뷰·저장 공통 상태 — 토글이 곧 DB 저장이다.
  const [is360, setIs360] = useState(photo.is360 ?? looksLike360(photo.fileName))
  const [ratioIs360, setRatioIs360] = useState(false)   // 2:1 감지 — '360일 수 있음' 힌트로만(자동 저장 안 함)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const ratio = img.naturalWidth / img.naturalHeight
    setRatioIs360(ratio >= 1.9 && ratio <= 2.1)   // 힌트만 — 저장은 사용자 토글로
  }

  // 360 지정 토글 — 뷰 전환 + DB 저장(공개 웹·그리드·대표 계산 반영). 저장 실패 시 뷰 원복.
  const toggle360 = async () => {
    const next = !is360
    setIs360(next)
    if (onToggle360) {
      setSaving(true)
      const ok = await onToggle360(next)
      setSaving(false)
      if (!ok) setIs360(!next)
    }
  }

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0" onClick={e => e.stopPropagation()}>
        <span className="text-white/80 text-sm font-medium truncate">{photo.fileName ?? '사진'}{is360 ? ' · 360°' : (ratioIs360 ? ' · 360일 수 있어요' : '')}</span>
        <div className="flex items-center gap-2 shrink-0">
          {onSetMain && !is360 && (
            <button type="button" onClick={onSetMain}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white hover:bg-white/25 transition-colors">
              대표로 설정
            </button>
          )}
          <button type="button" onClick={toggle360} disabled={saving}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors disabled:opacity-50 ${is360 ? 'bg-[var(--coral)] text-[var(--on-solid)] hover:opacity-90' : 'bg-white/15 text-white hover:bg-white/25'}`}>
            {saving ? '저장 중…' : (is360 ? '360 지정 해제' : '360으로 지정')}
          </button>
          <button type="button" onClick={onClose} aria-label="닫기"
            className="w-8 h-8 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-2" onClick={e => e.stopPropagation()}>
        {is360 ? (
          <Panorama360 url={hiRes} className="w-full h-full rounded-xl overflow-hidden" />
        ) : (
          <ZoomableImage src={hiRes} alt={photo.fileName ?? ''} onImgLoad={handleImgLoad} />
        )}
      </div>
      <p className="text-center text-white/40 text-[0.65625rem] pb-3 shrink-0" onClick={e => e.stopPropagation()}>
        {is360 ? '드래그해서 둘러보기 · 휠로 확대/축소' : '두 손가락으로 확대/축소 · 두 번 탭하면 확대 · 배경을 누르면 닫힘'}
      </p>
    </div>
  )
}

// 일반 사진 줌 뷰어 — 핀치(두 손가락)·휠 확대축소 + 더블탭/더블클릭 확대 + 확대 시 드래그 팬.
function ZoomableImage({ src, alt, onImgLoad }: {
  src: string; alt: string; onImgLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void
}) {
  const MAX = 4
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const tap = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null)
  const lastTap = useRef(0)

  // 확대 상태에서 이미지가 화면 밖으로 과하게 빠지지 않게 오프셋 제한
  const clamp = (o: { x: number; y: number }, s: number) => {
    const img = imgRef.current, wrap = wrapRef.current
    if (!img || !wrap) return o
    const maxX = Math.max(0, (img.offsetWidth * s - wrap.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * s - wrap.clientHeight) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
  }
  const applyScale = (next: number) => {
    const s = Math.max(1, Math.min(MAX, next))
    setScale(s)
    setOffset(o => clamp(s === 1 ? { x: 0, y: 0 } : o, s))
  }
  const toggleZoom = () => applyScale(scale > 1 ? 1 : 2)

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale }
      drag.current = null; tap.current = null
    } else {
      drag.current = scale > 1 ? { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y } : null
      tap.current = { t: Date.now(), x: e.clientX, y: e.clientY, moved: false }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      applyScale(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist))
      return
    }
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 16) tap.current.moved = true
    if (drag.current) setOffset(clamp({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }, scale))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) drag.current = null
    const t = tap.current
    if (t && !t.moved && Date.now() - t.t < 400) {
      const now = Date.now()
      if (now - lastTap.current < 400) { toggleZoom(); lastTap.current = 0 }
      else lastTap.current = now
    }
    tap.current = null
  }

  return (
    <div ref={wrapRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onWheel={e => applyScale(scale - e.deltaY * 0.003)}
      onDoubleClick={toggleZoom}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={src} alt={alt} onLoad={onImgLoad} draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'center', cursor: scale > 1 ? 'grab' : 'auto',
        }}
        className="max-w-full max-h-full object-contain rounded-xl select-none" />
    </div>
  )
}

// Drive resumable upload — XHR로 진행률 추적 + Drive에 직접 PUT
export function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    xhr.open('PUT', uploadUrl, true)
    xhr.responseType = 'text'
    // Content-Type은 세션 생성 시 X-Upload-Content-Type과 일치해야 함
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    const dump = () => `status=${xhr.status} statusText=${xhr.statusText || '(빈)'} readyState=${xhr.readyState} body=${(xhr.responseText || '').slice(0, 400) || '(빈)'}`

    xhr.onload = () => settle(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { id?: string }
          if (!body.id) return reject(new Error(`Drive 응답에 파일 ID 없음 · ${dump()}`))
          resolve(body.id)
        } catch (err) {
          reject(new Error(`Drive 응답 파싱 실패 · ${(err as Error).message} | ${dump()}`))
        }
      } else if (xhr.status === 0) {
        // CORS 차단 또는 네트워크 단절 시 일반적으로 status=0
        reject(new Error(`Drive 응답 차단 (CORS 의심) · ${dump()}`))
      } else {
        reject(new Error(`Drive 업로드 거절 · ${dump()}`))
      }
    })

    xhr.onerror = () => settle(() => {
      // 가장 흔한 케이스: status=0 — CORS 또는 네트워크
      reject(new Error(`네트워크/CORS 오류 · ${dump()}`))
    })
    xhr.upload.onerror = () => settle(() => {
      reject(new Error(`업로드 전송 중 오류 · ${dump()}`))
    })
    xhr.onabort = () => settle(() => reject(new Error(`업로드 중단 · ${dump()}`)))
    xhr.ontimeout = () => settle(() => reject(new Error(`업로드 타임아웃 · ${dump()}`)))

    xhr.send(file)
  })
}
