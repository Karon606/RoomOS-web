'use client'

// 이 방에 접수된 요청 — 등록 시점 호실번호(roomNoSnapshot) 기준이라 입주자가 바뀌어도 방에 남는다.
// 방 상세에서 "이 방에 뭐가 자주 고장나나" 를 한 줄씩 훑어보는 용도. 등록·완료 처리는 요청 화면에서.

import { useEffect, useState } from 'react'
import { getRoomRequests } from '@/app/(app)/rooms/actions'
import { Badge } from '@/components/ui/Badge'

import { fmtMD } from '@/lib/fmtDate'   // 날짜 표기 정본

const RECENT = 5   // 최근 N건만 펼침, 초과분은 '이전 이력' 뒤로

type RequestItem = Awaited<ReturnType<typeof getRoomRequests>>['items'][number]

export function RoomRequests({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomRequests>> | null>(null)
  const [open, setOpen] = useState(false)
  const [showOlder, setShowOlder] = useState(false)
  useEffect(() => {
    let active = true
    getRoomRequests(roomId).then(d => { if (active) setData(d) })
    return () => { active = false }
  }, [roomId])

  if (!data || data.items.length === 0) return null

  const unresolved = data.items.filter(it => !it.resolvedAt).length
  const recent = data.items.slice(0, RECENT)
  const older  = data.items.slice(RECENT)

  return (
    <section className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--warm-dark)]">요청 내역</span>
        <span className="text-xs">
          {unresolved > 0 && <strong className="text-[var(--coral)]">미처리 {unresolved}</strong>}
          <span className="text-[var(--warm-muted)] inline-flex items-center gap-1">{unresolved > 0 ? ' · ' : ''}{data.items.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg></span>
        </span>
      </button>
      {open && (
        <div className="mt-2 border-t border-[var(--warm-border)]/60 pt-2">
          <ul className="space-y-1.5">
            {recent.map(it => <RequestRow key={it.id} item={it} />)}
          </ul>
          {older.length > 0 && (
            <div className="mt-2">
              <button type="button" onClick={() => setShowOlder(v => !v)}
                className="text-xs font-medium text-[var(--warm-muted)] flex items-center gap-1">
                이전 이력 {older.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showOlder ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
              </button>
              {showOlder && (
                <ul className="mt-2 space-y-1.5">
                  {older.map(it => <RequestRow key={it.id} item={it} />)}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function RequestRow({ item }: { item: RequestItem }) {
  const resolved = !!item.resolvedAt
  return (
    <li className={`flex items-baseline justify-between gap-2 text-[0.6875rem] ${resolved ? 'opacity-60' : ''}`}>
      <span className="shrink-0 tabular-nums text-[var(--warm-muted)]">{fmtMD(item.requestDate)}</span>
      <span className="flex-1 min-w-0 truncate">
        {item.tenantName && <span className="text-[var(--warm-dark)]">{item.tenantName} · </span>}
        <span className="text-[var(--warm-mid)]">{item.content}</span>
      </span>
      {resolved
        ? <span className="shrink-0 font-medium text-[var(--success-fg)]">완료</span>
        : item.isUrgent && <Badge tone="pale-red">긴급</Badge>}
    </li>
  )
}
