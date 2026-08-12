'use client'

// 이 고객이 들어갈 수 있는 방 — 홈 매칭 알림의 사람 축(lib/wishMatch)을 그대로 그린다.
// 홈은 방을 세로 보고("409호에 맞는 사람 3명"), 여기는 사람을 세로 본다. 같은 판정의 뒷면이라
// 이 위젯은 아무것도 다시 판정하지 않는다 — 서버가 준 순서와 문구를 그대로 옮긴다.
// 아직 방이 정해지지 않은 리드(문의·투어·예약 미확정)에게만 의미가 있어 그 외에는 그리지 않는다.

import { useEffect, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getWishRoomsForLease } from '@/app/(app)/tenants/actions'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import {
  WISH_LEAD_STATUSES, wishLeaseRoomCaption, wishDelayHint,
  type WishLeaseMatch, type WishLeaseRoom,
} from '@/lib/wishMatch'
import { Section } from './Section'
import { fmtRoomNo } from '@/lib/roomNo'

const RECENT = 5   // 최근 N실만 펼침, 초과분은 접기 뒤로(형제 이력 위젯과 같은 수)

export function TenantWishRooms({ lease }: {
  lease: { id: string; status: string; reservationConfirmedAt: Date | string | null }
}) {
  const [data, setData] = useState<WishLeaseMatch | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  // 대상 판정을 화면에서 한 번 더 한다 — 거주자·예약 확정자 상세에서는 액션조차 부르지 않는다.
  // 서버(getWishRoomsForLease)가 같은 조건으로 또 거르므로 이 줄은 호출을 아끼는 문지기일 뿐이다.
  const leadStatuses: string[] = [...WISH_LEAD_STATUSES]
  const isTarget = leadStatuses.includes(lease.status) && !lease.reservationConfirmedAt

  useEffect(() => {
    // 대상이 아니면 아무것도 묻지 않는다. 이때 data 를 비울 필요도 없다 — 아래에서 위젯째 안 그린다.
    if (!isTarget) return
    let active = true
    // 실패해도 스켈레톤이 영구 잔존하지 않게 없음으로 떨어뜨린다(§27.2, 형제 이력 위젯과 같은 처리).
    getWishRoomsForLease(lease.id)
      .then(d => { if (active) setData(d) })
      .catch(() => { if (active) setData(null) })
    return () => { active = false }
  }, [lease.id, isTarget])

  if (!isTarget) return null
  if (data === null) {
    return <Section title="입주 가능한 방"><SkeletonRows rows={2} className="py-1" /></Section>
  }
  // 희망을 적어 둔 적이 없어 맞춰 볼 방 자체가 없는 사람 — 빈 박스를 남기지 않는다.
  if (data.rooms.length === 0 && data.excludedCount === 0) return null

  const recent = data.rooms.slice(0, RECENT)
  const older  = data.rooms.slice(RECENT)
  // 지금 바로 갈 방이 없고 가장 빠른 방이 며칠 안이면 "일정을 미룰 수 있는지" 물을 값어치가 있다.
  // 판정도 문장도 서버 정본(lib/wishMatch)이 만든다.
  const hint = wishDelayHint(data.rooms)

  return (
    <Section title="입주 가능한 방">
      <ul className="space-y-1.5">
        {recent.map(r => <WishRoomRow key={r.roomId} room={r} />)}
      </ul>
      {older.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowOlder(v => !v)}
            className="text-xs font-medium text-[var(--warm-muted)] flex items-center gap-1">
            {older.length}실 더 보기 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showOlder ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showOlder && (
            <ul className="mt-2 space-y-1.5">
              {older.map(r => <WishRoomRow key={r.roomId} room={r} />)}
            </ul>
          )}
        </div>
      )}
      {hint && (
        <p className="mt-2 text-xs leading-relaxed text-[var(--warm-dark)]">{hint}</p>
      )}
      {data.excludedCount > 0 && (
        <p className="mt-2 text-[0.65625rem] text-[var(--warm-muted)]">
          입주 희망일이 맞지 않아 제외 {data.excludedCount}실.
        </p>
      )}
    </Section>
  )
}

function WishRoomRow({ room }: { room: WishLeaseRoom }) {
  const entityModal = useEntityModal()
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      {/* 호실번호를 누르면 같은 모달 안에서 그 방의 면으로 바뀐다 — 거주 이력의 이름 클릭과 같은 문법
          (평시 행 색, hover 코랄, 밑줄·화살표 없음). py-1 -my-1 은 히트 영역만 세로로 넓힌다.
          방 타입은 호실번호의 수식어라 같은 버튼 안에 공백으로 잇는다 — 가운뎃점은 동격 항목을 잇는
          자리이고(§11) 우측 캡션이 이미 하나 쓴다. 재고 카드의 '제품명 + 규격' 병기와 같은 문법이다.
          자기 색을 선언해 hover 코랄을 물려받지 않는다(코랄은 식별자에만). 폭이 모자라면 truncate 가
          뒤부터 먹으므로 호실번호는 끝까지 남는다. 타입이 비어 있으면 아무것도 그리지 않는다. */}
      <button type="button" onClick={() => entityModal.open({ kind: 'room', roomId: room.roomId })}
        className="min-w-0 truncate text-left py-1 -my-1 font-medium text-[var(--warm-dark)] transition-colors hover:text-[var(--coral)]">
        {fmtRoomNo(room.roomNo)}
        {room.roomType && <span className="font-normal text-[var(--warm-muted)]"> {room.roomType}</span>}
      </button>
      <span className="shrink-0 tabular-nums text-[var(--warm-muted)]">{wishLeaseRoomCaption(room)}</span>
    </li>
  )
}
