'use client'

// 고객별 전체 수납 내역 — 접기/펼치기. 펼칠 때 모든 달 납부기록(언제·얼마·귀속월·방식·메모)을 최신순으로.
import { useState } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getAllPaymentsByLease } from '@/app/(app)/rooms/actions'

type Data = Awaited<ReturnType<typeof getAllPaymentsByLease>>

function fmtDate(d: Date | string): string {
  const x = new Date(d)
  return `${x.getFullYear()}.${String(x.getMonth() + 1).padStart(2, '0')}.${String(x.getDate()).padStart(2, '0')}`
}

export function PaymentHistoryAll({ leaseTermId, reloadSignal }: { leaseTermId: string; reloadSignal?: number }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Data | null>(null)
  const [loadedSignal, setLoadedSignal] = useState<number | undefined>(undefined)

  const load = async () => {
    setLoading(true)
    try {
      setData(await getAllPaymentsByLease(leaseTermId))
      setLoadedSignal(reloadSignal)
    } finally { setLoading(false) }
  }

  const toggle = async () => {
    const next = !open
    setOpen(next)
    // 처음 펼치거나, 펼친 사이에 수납이 바뀌었으면(reloadSignal 변경) 다시 조회
    if (next && (!data || loadedSignal !== reloadSignal)) await load()
  }

  return (
    <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)]">
      <button
        type="button"
        onClick={toggle}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-[var(--warm-dark)]"
      >
        <span>
          전체 수납 내역
          {data && <span className="ml-1 text-[0.6875rem] font-medium text-[var(--warm-muted)]">{data.count}건 · 합계 {fmtWon(data.total)}</span>}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-[var(--warm-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {loading ? (
            <SkeletonRows rows={3} className="py-1" />
          ) : !data || data.records.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] py-3 text-center">수납 내역이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]">
              {data.records.map(r => (
                <li key={r.id} className="py-1.5">
                  <div className="flex items-center gap-2 text-xs">
                    <span className="num text-[var(--warm-mid)] w-[82px] shrink-0">{fmtDate(r.payDate)}</span>
                    <span className="text-[var(--warm-muted)] shrink-0">
                      {Number(r.targetMonth.slice(5))}월분
                      {r.isDeposit && <span className="ml-1 text-[var(--warm-mid)] font-medium">보증금</span>}
                      {r.isPrevOwner && <span className="ml-1 text-[var(--warm-muted)]">양도인</span>}
                    </span>
                    <span className="num font-semibold text-[var(--warm-dark)] flex-1 text-right">{fmtWon(r.actualAmount)}</span>
                    <span className="text-[var(--warm-muted)] w-[60px] shrink-0 truncate text-right">{r.payMethod ?? ''}</span>
                  </div>
                  {r.memo && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 pl-[90px] break-keep">{r.memo}</p>}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
