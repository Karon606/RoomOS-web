'use client'

// Prism 호실 면의 공통 본문 — 어디서 띄우든 (EntityModal·room-manage 인라인) 동일한 콘텐츠.
// 자체적으로 getRoomDetail 로 최신 상태를 가져오며, Lightbox 도 내부에서 운용한다.
// 헤더(닫기·제목)와 푸터(액션·PrismNavBar) 는 호출자가 감싼다.

import { useEffect, useRef, useState } from 'react'
import { getRoomDetail } from '@/app/(app)/rooms/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'

type Photo = { id: string; storageUrl: string; fileName: string | null; driveFileId: string | null }
type RoomDetail = NonNullable<Awaited<ReturnType<typeof getRoomDetail>>>

const WINDOW_TYPE_LABEL: Record<string, string> = { interior: '내창', exterior: '외창' }
const DIRECTION_LABEL: Record<string, string> = {
  east: '동향', west: '서향', south: '남향', north: '북향',
  southeast: '남동향', southwest: '남서향', northeast: '북동향', northwest: '북서향',
}
const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return ''
  const t = new Date(d)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function RoomDetailBody({ roomId, onApplyScheduledNow }: {
  roomId: string
  /** room-manage 페이지에서만 전달. 다른 페이지(Prism)에서는 미제공 → 버튼 숨김. */
  onApplyScheduledNow?: () => void
}) {
  const [room, setRoom] = useState<RoomDetail | null>(null)
  const [lightboxIdx, setLightboxIdx] = useState<number | null>(null)

  useEffect(() => {
    let active = true
    getRoomDetail(roomId).then(d => { if (active && d) setRoom(d as RoomDetail) })
    return () => { active = false }
  }, [roomId])

  if (!room) {
    return <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
  }

  const tenantName = room.leaseTerms[0]?.tenant?.name ?? null

  return (
    <>
      {/* 사진 슬라이더 — 클릭하면 라이트박스 */}
      {room.photos.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-3 mb-3 border-b border-[var(--warm-border)]" style={{ scrollbarWidth: 'none' }}>
          {room.photos.map((p, idx) => (
            <img key={p.id} src={p.storageUrl} alt=""
              onClick={() => setLightboxIdx(idx)}
              className="h-44 w-44 object-cover rounded-xl shrink-0 cursor-zoom-in" />
          ))}
        </div>
      )}

      {/* 정보 */}
      <div className="space-y-2.5">
        <DetailRow label="상태" value={
          room.status.badge
            ? <StatusBadge tone={room.status.badge.tone}>{room.status.badge.label}</StatusBadge>
            : <span className="text-sm">{room.status.label}</span>
        } />
        <DetailRow label="입주자" value={tenantName ?? '공실'} />
        {room.type && <DetailRow label="방 타입" value={room.type} />}
        {room.tier && <DetailRow label="등급" value={room.tier} />}
        <DetailRow label="기본 이용료" value={<MoneyDisplay amount={room.baseRent} />} />
        {room.scheduledRent != null && (
          <>
            <DetailRow label="예약 이용료" value={
              <span className="text-amber-400">
                <MoneyDisplay amount={room.scheduledRent} />
                {room.rentUpdateDate && <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(room.rentUpdateDate)} 적용)</span>}
              </span>
            } />
            {onApplyScheduledNow && room.leaseTerms.length === 0 && (
              <div className="flex justify-end">
                <button type="button" onClick={onApplyScheduledNow}
                  className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 transition-colors">
                  예정 가격 즉시 적용
                </button>
              </div>
            )}
          </>
        )}
        {room.nonResidentRent != null && (
          <>
            <div className="border-t border-[var(--warm-border)] my-1" />
            <DetailRow label="비거주 이용료" value={
              <span className="text-indigo-600 font-medium">
                <MoneyDisplay amount={room.nonResidentRent} />
              </span>
            } />
            {room.nonResidentScheduled != null && (
              <DetailRow label="비거주 예약료" value={
                <span className="text-amber-400">
                  <MoneyDisplay amount={room.nonResidentScheduled} />
                  {room.nonResidentRentDate && (
                    <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(room.nonResidentRentDate)} 적용)</span>
                  )}
                </span>
              } />
            )}
          </>
        )}
        {room.floor      && <DetailRow label="층"        value={`${room.floor}층`} />}
        {room.windowType && <DetailRow label="창문 타입" value={WINDOW_TYPE_LABEL[room.windowType] ?? room.windowType} />}
        {room.direction  && <DetailRow label="방향"      value={DIRECTION_LABEL[room.direction] ?? room.direction} />}
        {(room.areaPyeong || room.areaM2) && (
          <DetailRow label="면적" value={[
            room.areaPyeong ? `${room.areaPyeong}평` : '',
            room.areaM2     ? `${room.areaM2}㎡`    : '',
          ].filter(Boolean).join(' / ')} />
        )}
        {room.memo && <DetailRow label="메모" value={room.memo} />}
      </div>

      {/* 라이트박스 */}
      {lightboxIdx != null && (
        <Lightbox
          photos={room.photos}
          index={lightboxIdx}
          onIndexChange={setLightboxIdx}
          onClose={() => setLightboxIdx(null)}
        />
      )}
    </>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0 gap-4">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}

// 호실 사진용 풀스크린 라이트박스 — RoomManageClient 의 동일 구현을 이리로 이주.
// 키보드 ←/→/ESC + 모바일 가로 스와이프 + Drive 원본 보기.
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
      if (e.key === 'ArrowLeft')  go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'Escape')     onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total])

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
      >
        ✕
      </button>

      {photos[index]?.driveFileId && (
        <a
          href={`https://drive.google.com/file/d/${photos[index].driveFileId}/view`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="absolute top-4 right-16 z-10 text-white/80 hover:text-white text-xs px-3 h-10 flex items-center rounded-full bg-black/40"
        >
          원본 보기 ↗
        </a>
      )}

      <div className="absolute top-4 left-4 z-10 text-white/80 text-sm font-medium px-3 py-1 rounded-full bg-black/40">
        {index + 1} / {total}
      </div>

      {total > 1 && (
        <button
          onClick={e => { e.stopPropagation(); go(-1) }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hidden sm:flex"
          aria-label="이전"
        >
          ‹
        </button>
      )}

      {total > 1 && (
        <button
          onClick={e => { e.stopPropagation(); go(1) }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hidden sm:flex"
          aria-label="다음"
        >
          ›
        </button>
      )}

      <div
        ref={containerRef}
        className={`w-full h-full overflow-hidden ${mounted ? 'scale-100' : 'scale-95'} transition-transform duration-200`}
        onClick={e => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex h-full"
          style={{
            transform: trackTransform,
            transition: animating ? 'transform 320ms cubic-bezier(0.22,1,0.36,1)' : 'none',
          }}
        >
          {photos.map(p => (
            <div key={p.id} className="w-full h-full shrink-0 flex items-center justify-center px-2">
              <img
                src={p.driveFileId
                  ? `https://drive.google.com/thumbnail?id=${p.driveFileId}&sz=w2000`
                  : p.storageUrl}
                alt={p.fileName ?? ''}
                className="max-w-[95vw] max-h-[90vh] object-contain pointer-events-none"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
