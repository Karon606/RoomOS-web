'use client'

// 이 방의 **지금 상황** — 상태·입주 가능일·입주자. 그것뿐이다.
//
// **속성(타입·등급·이용료)은 여기 없다**(운영자 지적 2026-08-27 — "거주 및 이력이 중간에
// 껴있고, 그 뒤에 층이나 창문타입이 있으니까 정돈된 느낌이 아니야"). 종전에는 상황과 속성이
// 한 덩어리라, 그 아래 거주 이력을 사이에 두고 속성이 둘로 갈렸다. 축으로 다시 갈라
// 상황 -> 거주 이력 -> 속성 순서가 되게 했다. 속성은 RoomSpatialInfo('방 정보')가 받는다.
//
// **줄 수가 최대 셋으로 고정된 것이 이 분리의 또 다른 이득이다.** 종전에는 조건부 줄이 넷이라
// 방마다 3~9줄로 흔들렸고, 그 아래 거주 이력 카드가 매번 다른 높이에 떨어졌다.
//
// 예약자는 여기 없다. 바로 아래 '거주 이력 및 예정' 위젯의 미래 행이 같은 사실을 말한다
// (운영자 지시 2026-08-11).

import { StatusBadge } from '@/components/ui/StatusBadge'
import { availableFromText, type RoomAvailability, type RoomStatusView } from '@/lib/leaseStatus'
import { InfoRow } from './InfoRow'
import { Section } from './Section'

type Room = {
  leaseTerms: { status: string; tenant: { name: string } | null }[]
  // 호실 카드와 같은 판정(lib/leaseStatus.roomStatusView)에서 온 값.
  status: RoomStatusView
  // 이 방을 언제부터 줄 수 있나 — lib/leaseStatus.roomAvailability 판정(호실 카드 '입주 가능' 필터와 같은 축).
  availability?: RoomAvailability | null
}

export function RoomBasicInfo({ room }: { room: Room }) {
  const tenantName = room.leaseTerms[0]?.tenant?.name ?? null
  // 명의는 있지만 그 방에 살지는 않는 계약(창고·사무실) — 이름 줄의 라벨을 '입주자'로 두면 거짓말이 된다.
  // 용어는 lib/statusColors STATUS_LABEL.NON_RESIDENT 와 같은 '비거주자'.
  const isNonResident = room.leaseTerms[0]?.status === 'NON_RESIDENT'
  // 날짜가 잡힌 방(soon)에만 값이 있다 — 지금 빈 방은 상태 줄이 이미 '공실'이라 같은 말을 두 번 하지 않는다.
  const availableFrom = availableFromText(room.availability)
  return (
    <Section title="현재 상태">
      <InfoRow label="상태" value={
        room.status.badge
          ? <StatusBadge tone={room.status.badge.tone}>{room.status.badge.label}</StatusBadge>
          : <span className="text-sm">{room.status.label}</span>
      } />
      {/* 방을 언제부터 줄 수 있나 — 상태 바로 아래다. 퇴실일이 잡힌 방에서 운영자가 상태 다음으로
          묻는 것이 이것이고, 호실 관리 '입주 가능' 필터가 같은 판정으로 같은 방을 세운다. */}
      {availableFrom && <InfoRow label="입주 가능" value={availableFrom} />}
      <InfoRow label={isNonResident ? '비거주자' : '입주자'} value={tenantName ?? '공실'} />
    </Section>
  )
}
