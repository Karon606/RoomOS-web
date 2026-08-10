'use client'

// kind='room' 의 body 조합 — 위젯들의 배치.
// 어디서 띄우든(PrismShell·room-manage 모달) 같은 데이터 → 같은 위젯 → 같은 모양.
// "데이터 조합으로 발현되는 뷰" 의 첫 사례.

import { useEffect, useState } from 'react'
import { RoomCleaningPanel } from '@/components/entity-modal/widgets/RoomCleaningPanel'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getRoomDetail } from '@/app/(app)/rooms/actions'
import { PhotoStrip } from '../widgets/PhotoStrip'
import { RoomBasicInfo } from '../widgets/RoomBasicInfo'
import { RoomSpatialInfo } from '../widgets/RoomSpatialInfo'
import { MemoSection } from '../widgets/MemoSection'
import { RoomExpenses } from '../widgets/RoomExpenses'
import { RoomStayHistory } from '../widgets/RoomStayHistory'
import { RoomRequests } from '../widgets/RoomRequests'

type RoomDetail = NonNullable<Awaited<ReturnType<typeof getRoomDetail>>>

export function RoomBody({ roomId, month, onApplyScheduledNow }: {
  roomId: string
  /** 상태 판정 기준월 'YYYY-MM' — 단기 퇴실 도래를 호실 카드와 같은 달로 물어야 라벨이 같다. */
  month: string
  /** room-manage 페이지에서만 전달. 다른 진입(EntityModal/Prism)에선 미제공 → 버튼 숨김. */
  onApplyScheduledNow?: () => void
}) {
  const [room, setRoom] = useState<RoomDetail | null>(null)
  useEffect(() => {
    let active = true
    getRoomDetail(roomId, month).then(d => { if (active && d) setRoom(d as RoomDetail) })
    return () => { active = false }
  }, [roomId, month])

  if (!room) return <SkeletonRows rows={5} className="py-4" />

  return (
    <>
      <PhotoStrip photos={room.photos} />
      <RoomBasicInfo room={room} onApplyScheduledNow={onApplyScheduledNow} />
      <div className="mt-2.5" />
      <RoomSpatialInfo room={room} />
      <div className="mt-2.5" />
      <MemoSection memo={room.memo} />
      <div className="mt-2.5" />
      <RoomExpenses roomId={roomId} />
      <div className="mt-2.5" />
      <RoomStayHistory roomId={roomId} />
      <div className="mt-2.5" />
      {/* 거주 이력 다음에 청소 이력 — 퇴실하면 청소한다는 순서 그대로다(신고 b21e4e98) */}
      <RoomCleaningPanel roomId={roomId} />
      <div className="mt-2.5" />
      <RoomRequests roomId={roomId} />
    </>
  )
}
