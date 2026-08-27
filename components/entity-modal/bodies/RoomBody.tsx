'use client'

// kind='room' 의 body 조합 — 위젯들의 배치.
// 어디서 띄우든(PrismShell·room-manage 모달) 같은 데이터 → 같은 위젯 → 같은 모양.
// "데이터 조합으로 발현되는 뷰" 의 첫 사례.

import { useEffect, useState } from 'react'
import { RoomCleaningPanel } from '@/components/entity-modal/widgets/RoomCleaningPanel'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { fmtRoomNo } from '@/lib/roomNo'
import { getRoomDetail } from '@/app/(app)/rooms/actions'
import { PhotoStrip } from '../widgets/PhotoStrip'
import { RoomBasicInfo } from '../widgets/RoomBasicInfo'
import { RoomSpatialInfo } from '../widgets/RoomSpatialInfo'
import { MemoSection } from '../widgets/MemoSection'
import { RoomExpenses } from '../widgets/RoomExpenses'
import { RoomStayHistory } from '../widgets/RoomStayHistory'
import { RoomRequests } from '../widgets/RoomRequests'

type RoomDetail = NonNullable<Awaited<ReturnType<typeof getRoomDetail>>>

export function RoomBody({ roomId, month, onApplyScheduledNow, rooms, onSelectRoom, subLeaseNote }: {
  roomId: string
  /** 상태 판정 기준월 'YYYY-MM' — 단기 퇴실 도래를 호실 카드와 같은 달로 물어야 라벨이 같다. */
  month: string
  /** room-manage 페이지에서만 전달. 다른 진입(EntityModal/Prism)에선 미제공 → 버튼 숨김. */
  onApplyScheduledNow?: () => void
  /**
   * 이 사람이 계약으로 쥐고 있는 방들 — 둘 이상일 때만 전환 세그먼트를 그린다.
   * 계약이 하나인 사람에게는 길이 1이라 아무것도 안 그린다(픽셀 무변동).
   */
  rooms?: { id: string; roomNo: string | null }[]
  onSelectRoom?: (roomId: string) => void
  /** 지금 보는 방이 그 사람의 추가 계약 방일 때의 한 줄. 메인 계약 방이면 undefined. */
  subLeaseNote?: string
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
      {/* 방 전환 — 한 사람이 방을 둘 쓸 때만(509호 거주 + 601호 창고). 문법은 수납 폼의 계약 세그먼트와
          같은 정본(SegmentedControl size="sm")이다. 고르는 것은 '보는 방'일 뿐 앵커는 안 바뀐다 —
          제목·고객 면·수납 면은 메인 계약 그대로다. 좁은 폭에서 넘치면 트랙이 가로로 스크롤한다. */}
      {rooms && rooms.length > 1 && onSelectRoom && (
        <div className="mb-2.5">
          <SegmentedControl
            ariaLabel="이 사람의 계약 방"
            size="sm"
            scroll
            value={roomId}
            options={rooms.map(r => ({ value: r.id, label: fmtRoomNo(r.roomNo, '호실 미지정') }))}
            onChange={onSelectRoom}
          />
        </div>
      )}
      {/* 종속 안내 — '딸림' 관계를 스키마가 아직 모르므로 아는 사실만 적는다: 같은 사람의 추가 계약이다. */}
      {subLeaseNote && <p className="mb-2.5 text-xs text-[var(--warm-muted)]">{subLeaseNote}</p>}
      {/* 방을 열고 묻는 순서대로 세운다(운영자 지적 2026-08-27 — "정돈된 느낌이 아니야").
          어떻게 생겼나(사진) -> 지금 쓸 수 있나(현재 상태) -> 다음은 누구인가(거주 이력)
          -> 어떤 방이고 얼마인가(방 정보) -> 무슨 일이 있었나(메모·지출·작업·요청).

          **2026-08-11 지시("기본정보 바로 다음이 거주 이력")는 그대로 지켜진다.** 그때의
          '기본정보'가 지금 '현재 상태'이고, 거주 이력은 그 바로 다음이다. 오히려 위로 올라갔다 —
          종전 상단 블록이 조건부 줄 넷 때문에 방마다 3~9줄로 흔들렸는데 이제 최대 셋이다.

          정돈이 안 돼 보이던 진짜 원인은 순서가 아니라 **제목이 없던 것**이다. Section 은
          저장소에서 13번 쓰이는데 전부 고객 면이고 호실 면은 0번이었다. 제목 없는 목록 사이에
          제목 달린 카드가 끼어 있어 층·창문이 어느 덩어리 소속인지 화면이 답을 못 했다.

          간격도 형제 면과 같은 space-y-5 로 맞춘다(수제 mt-2.5 스페이서 일곱을 걷었다). */}
      <div className="space-y-5">
        <PhotoStrip photos={room.photos} />
        <RoomBasicInfo room={room} />
        <RoomStayHistory roomId={roomId} />
        <RoomSpatialInfo room={room} onApplyScheduledNow={onApplyScheduledNow} />
        <MemoSection memo={room.memo} />
        <RoomExpenses roomId={roomId} />
        {/* 작업 이력은 지출 다음에 둔다 — 작업은 곧 돈이 나가는 일이라 지출과 붙는 편이 읽힌다. */}
        <RoomCleaningPanel roomId={roomId} />
        <RoomRequests roomId={roomId} />
      </div>
    </>
  )
}
