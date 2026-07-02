'use client'

// kind='room' 의 body 조합 — 위젯들의 배치.
// 어디서 띄우든(PrismShell·room-manage 모달) 같은 데이터 → 같은 위젯 → 같은 모양.
// "데이터 조합으로 발현되는 뷰" 의 첫 사례.

import { useEffect, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getRoomDetail } from '@/app/(app)/rooms/actions'
import { PhotoStrip } from '../widgets/PhotoStrip'
import { RoomBasicInfo } from '../widgets/RoomBasicInfo'
import { RoomSpatialInfo } from '../widgets/RoomSpatialInfo'
import { MemoSection } from '../widgets/MemoSection'
import { RoomExpenses } from '../widgets/RoomExpenses'

type RoomDetail = NonNullable<Awaited<ReturnType<typeof getRoomDetail>>>

export function RoomBody({ roomId, onApplyScheduledNow }: {
  roomId: string
  /** room-manage 페이지에서만 전달. 다른 진입(EntityModal/Prism)에선 미제공 → 버튼 숨김. */
  onApplyScheduledNow?: () => void
}) {
  const [room, setRoom] = useState<RoomDetail | null>(null)
  useEffect(() => {
    let active = true
    getRoomDetail(roomId).then(d => { if (active && d) setRoom(d as RoomDetail) })
    return () => { active = false }
  }, [roomId])

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
    </>
  )
}
