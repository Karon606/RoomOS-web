'use client'

// 이 방을 거쳐간 사람들 — RoomStay 구간 이력. 방 상세에서 "누가 언제부터 언제까지 살았나" 확인용.
// 현재 구간(endDate null)은 종료일 자리에 '현재'로 표시한다.

import { useEffect, useState } from 'react'
import { getRoomStayHistory } from '@/app/(app)/rooms/actions'

import { fmtDateDot } from '@/lib/fmtDate'   // 날짜 표기 정본

const RECENT = 5   // 최근 N건만 펼침, 초과분은 '이전 이력' 뒤로

export function RoomStayHistory({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomStayHistory>> | null>(null)
  const [open, setOpen] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  useEffect(() => {
    let active = true
    // 실패해도 스켈레톤이 영구 잔존하지 않게 빈 목록으로 떨어뜨린다(§27.2).
    // 상태 이력 위젯을 만들면서 형제 둘도 같은 결함인 것이 드러나 함께 봉합했다(2026-08-03).
    getRoomStayHistory(roomId)
      .then(d => { if (active) setData(d) })
      .catch(() => { if (active) setData({ items: [] }) })
    return () => { active = false }
  }, [roomId])

  if (!data || data.items.length === 0) return null

  const recent = data.items.slice(0, RECENT)
  const older  = data.items.slice(RECENT)

  return (
    <section className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--warm-dark)]">거주 이력</span>
        <span className="text-xs">
          <span className="text-[var(--warm-muted)] inline-flex items-center gap-1">{data.items.length}명 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>
        </span>
      </button>
      {open && (
        <div className="mt-2 border-t border-[var(--warm-border)]/60 pt-2">
          <ul className="space-y-1.5">
            {recent.map(it => <StayRow key={it.id} item={it} />)}
          </ul>
          {older.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowOlder(v => !v)}
                className="text-xs font-medium text-[var(--warm-muted)] flex items-center gap-1">
                이전 이력 {older.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showOlder ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {showOlder && (
                <ul className="mt-2 space-y-1.5">
                  {older.map(it => <StayRow key={it.id} item={it} />)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function StayRow({ item }: { item: { tenantName: string; startDate: string | null; endDate: string | null } }) {
  return (
    <li className="flex items-baseline justify-between gap-2 text-[0.6875rem]">
      <span className="min-w-0 truncate text-[var(--warm-dark)]">{item.tenantName}</span>
      <span className="shrink-0 tabular-nums text-[var(--warm-muted)]">
        {fmtDateDot(item.startDate)} ~ {item.endDate
          ? fmtDateDot(item.endDate)
          : <span className="font-medium text-[var(--coral)]">현재</span>}
      </span>
    </li>
  )
}
