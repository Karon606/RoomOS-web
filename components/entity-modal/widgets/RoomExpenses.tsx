'use client'

// 이 방에 배정된 지출(누적) — 방 상세에서 "어떤 방에 얼마 들어갔는지" 확인용.
// 지출 등록 시 '대상 호실'로 배정된 Expense 를 방별로 모아 보여준다.

import { useEffect, useState } from 'react'
import { getRoomExpenses } from '@/app/(app)/rooms/actions'

const won = (n: number) => n.toLocaleString('ko-KR') + '원'

export function RoomExpenses({ roomId }: { roomId: string }) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getRoomExpenses>> | null>(null)
  const [open, setOpen] = useState(false)
  useEffect(() => {
    let active = true
    getRoomExpenses(roomId).then(d => { if (active) setData(d) })
    return () => { active = false }
  }, [roomId])

  if (!data || data.items.length === 0) return null

  return (
    <section className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
      <button type="button" onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-[var(--warm-dark)]">이 방에 든 지출</span>
        <span className="text-xs">
          <strong className="text-[var(--coral)]">{won(data.total)}</strong>
          <span className="text-[var(--warm-muted)]"> · {data.items.length}건 {open ? '▴' : '▾'}</span>
        </span>
      </button>
      {open && (
        <ul className="mt-2 space-y-1.5 border-t border-[var(--warm-border)]/60 pt-2">
          {data.items.map(it => {
            // 품목명 우선 표시 — detail('[슬라이드바 거치대] x 1개') 또는 itemLabel, 없으면 카테고리.
            const name = it.detail || it.itemLabel || it.category
            const sub = [(it.detail || it.itemLabel) ? it.category : null, it.vendor, it.memo].filter(Boolean).join(' · ')
            return (
              <li key={it.id} className="flex items-baseline justify-between gap-2 text-[0.6875rem]">
                <span className="text-[var(--warm-muted)] shrink-0 tabular-nums">{it.date.slice(5)}</span>
                <span className="flex-1 min-w-0 truncate">
                  <span className="text-[var(--warm-dark)]">{name}</span>
                  {sub && <span className="text-[var(--warm-muted)]"> · {sub}</span>}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--warm-dark)]">{won(it.amount)}</span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
