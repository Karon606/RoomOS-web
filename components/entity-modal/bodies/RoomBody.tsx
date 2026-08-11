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
      {/* 기본정보 바로 다음이 거주 이력 — 없어진 '예약자' 줄의 자리를 이 위젯이 받았다
          (운영자 지시 2026-08-11). 방을 열고 가장 먼저 묻는 것이 "지금 누가 살고 다음은 누구인가" 다. */}
      <RoomStayHistory roomId={roomId} />
      <div className="mt-2.5" />
      <RoomSpatialInfo room={room} />
      <div className="mt-2.5" />
      <MemoSection memo={room.memo} />
      <div className="mt-2.5" />
      <RoomExpenses roomId={roomId} />
      <div className="mt-2.5" />
      {/* 청소 이력은 지출 다음에 둔다 — 청소는 곧 돈이 나가는 일이라 지출과 붙는 편이 읽힌다.
          거주 이력과 붙어 있던 종전 순서(신고 b21e4e98)는 그 위젯이 상단으로 올라가며 풀렸다. */}
      <RoomCleaningPanel roomId={roomId} />
      <div className="mt-2.5" />
      <RoomRequests roomId={roomId} />
    </>
  )
}
