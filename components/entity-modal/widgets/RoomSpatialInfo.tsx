'use client'

// 이 방이 **어떤 방이고 얼마인가** — 타입·등급·층·창문·방향·면적·이용료.
//
// 종전에는 층·창문·방향·면적만 있었고 타입·등급·이용료는 RoomBasicInfo 에 섞여 있었다.
// 그 사이에 거주 이력이 끼어 방 속성이 둘로 갈렸다(운영자 지적 2026-08-27). 속성을 한
// 덩어리로 모으고 상황(RoomBasicInfo)과 축을 나눈다.
//
// 이용료가 여기 있는 이유. "이 방을 어떤 조건으로 얼마에 내주는가"는 층·창문과 한 물음이다.
// 형제인 고객 면도 같은 문법이다 — 기본 정보(신원·상태)와 계약 정보(보증금·이용료)를 가른다.
//
// **null 가드를 두지 않는다.** 이용료는 언제나 있어 이 위젯은 절대 비지 않는다. 종전 hasAny
// 가드를 남겨 두면 층·창문이 다 빈 방(멀티테넌트라 실재한다)에서 이용료가 통째로 사라진다.
//
// onApplyScheduledNow: 호실 관리 페이지에서만 활성. 다른 진입(EntityModal/Prism)에선 버튼 숨김.

import { useTransition } from 'react'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { fmtRentApplyFrom } from '@/lib/fmtMoney'
import { kstMonthOf } from '@/lib/fmtDate'
import { InfoRow } from './InfoRow'
import { Section } from './Section'

// DB 실제 값은 대문자 enum (settings 폼 기준 OUTER/INNER, NORTH/EAST/SOUTH/WEST 및 대각선).
// 일부 마이그레이션 전 데이터가 소문자/한글일 수 있어 둘 다 매핑한다.
const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
  exterior: '외창', interior: '내창',
}
const DIRECTION_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
  // 소문자 호환
  north: '북향', northeast: '북동향', east: '동향', southeast: '남동향',
  south: '남향', southwest: '남서향', west: '서향', northwest: '북서향',
}

export function RoomSpatialInfo({ room, onApplyScheduledNow }: {
  room: {
    floor: string | null
    windowType: string | null
    direction: string | null
    areaPyeong: number | null
    areaM2: number | null
    type: string | null
    tier: string | null
    baseRent: number
    scheduledRent: number | null
    rentUpdateDate: Date | string | null
    nonResidentRent: number | null
    nonResidentScheduled: number | null
    nonResidentRentDate: Date | string | null
    leaseTerms: { status: string }[]
  }
  onApplyScheduledNow?: () => void
}) {
  const [isPending] = useTransition()
  // '예정 가격 즉시 적용'의 조건은 '지금 이 방에 거주·예약 계약이 걸려 있지 않은가'다.
  const isVacant = !room.leaseTerms.some(l => l.status !== 'NON_RESIDENT')
  return (
    <Section title="방 정보">
      {room.type && <InfoRow label="방 타입" value={room.type} />}
      {room.tier && <InfoRow label="등급" value={room.tier} />}
      {room.floor      && <InfoRow label="층"        value={`${room.floor}층`} />}
      {room.windowType && <InfoRow label="창문 타입" value={WINDOW_TYPE_LABEL[room.windowType] ?? room.windowType} />}
      {room.direction  && <InfoRow label="방향"      value={DIRECTION_LABEL[room.direction] ?? room.direction} />}
      {(room.areaPyeong || room.areaM2) && (
        <InfoRow label="면적" value={[
          room.areaPyeong ? `${room.areaPyeong}평` : '',
          room.areaM2     ? `${room.areaM2}㎡`    : '',
        ].filter(Boolean).join(' / ')} />
      )}
      <InfoRow label="기본 이용료" value={<MoneyDisplay amount={room.baseRent} />} />
      {room.scheduledRent != null && (
        <>
          <InfoRow label="예약 이용료" value={
            <span className="text-[var(--warning-fg)]">
              <MoneyDisplay amount={room.scheduledRent} />
              {/* 인상은 그 달 전체에 걸린다 — 적용일이 9/20 이어도 9월분 청구는 전부 인상가다(lib/billing). */}
              {room.rentUpdateDate && (
                <span className="text-[var(--warm-muted)] ml-1 text-xs whitespace-nowrap">({fmtRentApplyFrom(kstMonthOf(room.rentUpdateDate))})</span>
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
                  <span className="text-[var(--warm-muted)] ml-1 text-xs whitespace-nowrap">({fmtRentApplyFrom(kstMonthOf(room.nonResidentRentDate))})</span>
                )}
              </span>
            } />
          )}
        </>
      )}
    </Section>
  )
}
