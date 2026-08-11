'use client'

// 호실의 핵심 정보 — 상태·입주자·타입·등급·기본/예약/비거주 이용료.
// 예약자는 여기 없다. 바로 아래 '거주 이력 및 예정' 위젯의 미래 행이 같은 사실을 말하고 있어
// 두 줄이 겹쳤다(운영자 지시 2026-08-11). 확정 여부도 그 행이 어휘로 가른다.
// onApplyScheduledNow: 호실 관리 페이지에서만 활성. 다른 진입(EntityModal/Prism)에선 미제공 → 버튼 숨김.

import { useTransition } from 'react'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { availableFromText, type RoomAvailability, type RoomStatusView } from '@/lib/leaseStatus'
import { InfoRow } from './InfoRow'

type Room = {
  baseRent: number
  scheduledRent: number | null
  rentUpdateDate: Date | string | null
  nonResidentRent: number | null
  nonResidentScheduled: number | null
  nonResidentRentDate: Date | string | null
  type: string | null
  tier: string | null
  leaseTerms: { status: string; tenant: { name: string } | null }[]
  // 호실 카드와 같은 판정(lib/leaseStatus.roomStatusView)에서 온 값.
  status: RoomStatusView
  // 이 방을 언제부터 줄 수 있나 — lib/leaseStatus.roomAvailability 판정(호실 카드 '입주 가능' 필터와 같은 축).
  availability?: RoomAvailability | null
}

const fmtDate = (d: Date | string | null | undefined) => {
  if (!d) return ''
  const t = new Date(d)
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function RoomBasicInfo({ room, onApplyScheduledNow }: {
  room: Room
  onApplyScheduledNow?: () => void
}) {
  const [isPending] = useTransition()
  const tenantName = room.leaseTerms[0]?.tenant?.name ?? null
  // 명의는 있지만 그 방에 살지는 않는 계약(창고·사무실) — 이름 줄의 라벨을 '입주자'로 두면 거짓말이 된다.
  // 용어는 lib/statusColors STATUS_LABEL.NON_RESIDENT 와 같은 '비거주자'.
  const isNonResident = room.leaseTerms[0]?.status === 'NON_RESIDENT'
  // '예정 가격 즉시 적용'의 조건은 '지금 이 방에 거주·예약 계약이 걸려 있지 않은가'다. 비거주를
  // 조회에 넣기 전에는 배열이 비었는지로 물었는데, 이제 비거주가 들어오므로 뜻을 그대로 적는다.
  const isVacant = !room.leaseTerms.some(l => l.status !== 'NON_RESIDENT')
  // 날짜가 잡힌 방(soon)에만 값이 있다 — 지금 빈 방은 상태 줄이 이미 '공실'이라 같은 말을 두 번 하지 않는다.
  const availableFrom = availableFromText(room.availability)
  return (
    <div className="space-y-2.5">
      <InfoRow label="상태" value={
        room.status.badge
          ? <StatusBadge tone={room.status.badge.tone}>{room.status.badge.label}</StatusBadge>
          : <span className="text-sm">{room.status.label}</span>
      } />
      {/* 방을 언제부터 줄 수 있나 — 상태 바로 아래다. 퇴실일이 잡힌 방에서 운영자가 상태 다음으로
          묻는 것이 이것이고, 호실 관리 '입주 가능' 필터가 같은 판정으로 같은 방을 세운다. */}
      {availableFrom && <InfoRow label="입주 가능" value={availableFrom} />}
      <InfoRow label={isNonResident ? '비거주자' : '입주자'} value={tenantName ?? '공실'} />
      {room.type && <InfoRow label="방 타입" value={room.type} />}
      {room.tier && <InfoRow label="등급" value={room.tier} />}
      <InfoRow label="기본 이용료" value={<MoneyDisplay amount={room.baseRent} />} />
      {room.scheduledRent != null && (
        <>
          <InfoRow label="예약 이용료" value={
            <span className="text-[var(--warning-fg)]">
              <MoneyDisplay amount={room.scheduledRent} />
              {room.rentUpdateDate && (
                <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(room.rentUpdateDate)} 적용)</span>
              )}
            </span>
          } />
          {onApplyScheduledNow && isVacant && (
            <div className="flex justify-end">
              <button type="button" onClick={onApplyScheduledNow} disabled={isPending}
                className="text-xs px-3 py-1.5 rounded-lg bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)] hover:bg-[var(--warning-bg)] transition-colors disabled:opacity-60">
                {isPending ? '적용 중…' : '예정 가격 즉시 적용'}
              </button>
            </div>
          )}
        </>
      )}
      {room.nonResidentRent != null && (
        <>
          <div className="border-t border-[var(--warm-border)] my-1" />
          <InfoRow label="비거주 이용료" value={
            <span className="text-[var(--info-fg)] font-medium">
              <MoneyDisplay amount={room.nonResidentRent} />
            </span>
          } />
          {room.nonResidentScheduled != null && (
            <InfoRow label="비거주 예약료" value={
              <span className="text-[var(--warning-fg)]">
                <MoneyDisplay amount={room.nonResidentScheduled} />
                {room.nonResidentRentDate && (
                  <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(room.nonResidentRentDate)} 적용)</span>
                )}
              </span>
            } />
          )}
        </>
      )}
    </div>
  )
}
