'use client'

import Link from 'next/link'
import { type FloorPlanData } from './actions'
import FloorPlanEditor from './FloorPlanEditor'

export default function FloorPlanWidget({
  floorPlanData,
  rooms,
  roomStatuses,
}: {
  floorPlanData: FloorPlanData | null
  rooms: { id: string; roomNo: string }[]
  roomStatuses: Record<string, { isVacant: boolean; tenantName?: string }>
}) {
  if (!floorPlanData) return null

  return (
    <div className="rounded-2xl border border-[var(--warm-border)] overflow-hidden"
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
          편집 →
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
