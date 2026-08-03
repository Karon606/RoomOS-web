'use client'

// 이 입주자가 거쳐간 방 — RoomStay 구간을 최신순으로 나열. 방을 옮긴 적이 있어야 의미가 있어
// 구간이 1개 이하면 섹션 자체를 그리지 않는다. 현재 구간은 종료일 자리에 '현재'.

import { useEffect, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getTenantMoveHistory } from '@/app/(app)/rooms/actions'
import { Section } from './Section'

import { fmtDateDot } from '@/lib/fmtDate'   // 날짜 표기 정본

const RECENT = 5   // 최근 N건만 펼침, 초과분은 '이전 이력' 뒤로

type MoveItem = Awaited<ReturnType<typeof getTenantMoveHistory>>['items'][number]

export function TenantMoveHistory({ tenantId }: { tenantId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getTenantMoveHistory>> | null>(null)
  const [showOlder, setShowOlder] = useState(false)
  useEffect(() => {
    let active = true
    // 실패해도 스켈레톤이 영구 잔존하지 않게 빈 목록으로 떨어뜨린다(§27.2).
    // 상태 이력 위젯을 만들면서 형제 둘도 같은 결함인 것이 드러나 함께 봉합했다(2026-08-03).
    getTenantMoveHistory(tenantId)
      .then(d => { if (active) setData(d) })
      .catch(() => { if (active) setData({ items: [] }) })
    return () => { active = false }
  }, [tenantId])

  if (data === null) {
    return <Section title="이사 이력"><SkeletonRows rows={2} className="py-1" /></Section>
  }
  if (data.items.length <= 1) return null

  const recent = data.items.slice(0, RECENT)
  const older  = data.items.slice(RECENT)

  return (
    <Section title="이사 이력">
      <ul className="space-y-1.5">
        {recent.map(it => <MoveRow key={it.id} item={it} />)}
      </ul>
      {older.length > 0 && (
        <div className="mt-2">
          <button type="button" onClick={() => setShowOlder(v => !v)}
            className="text-xs font-medium text-[var(--warm-muted)] flex items-center gap-1">
            이전 이력 {older.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showOlder ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showOlder && (
            <ul className="mt-2 space-y-1.5">
              {older.map(it => <MoveRow key={it.id} item={it} />)}
            </ul>
          )}
        </div>
      )}
    </Section>
  )
}

function MoveRow({ item }: { item: MoveItem }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-xs">
      <span className="min-w-0 truncate font-medium text-[var(--warm-dark)]">{item.roomNo}호</span>
      <span className="shrink-0 tabular-nums text-[var(--warm-muted)]">
        {fmtDateDot(item.startDate)} ~ {item.endDate
          ? fmtDateDot(item.endDate)
          : <span className="font-medium text-[var(--coral)]">현재</span>}
      </span>
    </li>
  )
}
