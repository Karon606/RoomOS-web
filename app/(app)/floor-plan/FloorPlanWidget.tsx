'use client'

import Link from 'next/link'
import { type FloorPlanData } from './actions'
import FloorPlanEditor from './FloorPlanEditor'
import { EmptyState } from '@/components/ui/EmptyState'

export default function FloorPlanWidget({
  floorPlanData,
  rooms,
  roomStatuses,
}: {
  floorPlanData: FloorPlanData | null
  rooms: { id: string; roomNo: string }[]
  roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }>
}) {
  // 미생성 계정 — 위젯을 통째로 숨기지 않고 진입점(빈 상태 CTA)을 유지 (ID-27)
  if (!floorPlanData) {
    return (
      <div className="rounded-xl border border-[var(--warm-border)] overflow-hidden"
        style={{ background: 'var(--cream)' }}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--warm-border)]">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>평면 배치도</h2>
        </div>
        <div className="p-4">
          <EmptyState
            title="아직 평면 배치도가 없어요"
            description="방 배치를 그려두면 대시보드에서 공실·입실 현황을 한눈에 볼 수 있어요."
            action={
              <Link href="/floor-plan"
                className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
                style={{ background: 'var(--coral)', color: 'var(--on-solid)' }}>
                평면도 만들기
              </Link>
            }
          />
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-[var(--warm-border)] overflow-hidden"
      style={{ background: 'var(--cream)' }}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--warm-border)] shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>평면 배치도</h2>
          <span className="text-[0.6875rem] px-1.5 py-0.5 rounded"
            style={{ background: 'var(--canvas)', color: 'var(--warm-muted)', border: '1px solid var(--warm-border)' }}>
            읽기 전용
          </span>
        </div>
        <Link href="/floor-plan"
          className="text-xs font-medium hover:underline"
          style={{ color: 'var(--coral)' }}>
          편집 ›
        </Link>
      </div>
      <div style={{ height: 340, display: 'flex', flexDirection: 'column' }}>
        <FloorPlanEditor
          initialData={floorPlanData}
          rooms={rooms}
          roomStatuses={roomStatuses}
          viewOnly
        />
      </div>
    </div>
  )
}
