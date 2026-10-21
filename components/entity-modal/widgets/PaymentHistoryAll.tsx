'use client'

// 고객별 전체 수납 내역 — 접기/펼치기. 펼칠 때 모든 달 납부기록(언제·얼마·귀속월·방식·메모)을 최신순으로.
import { useState } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { getAllPaymentsByLease } from '@/app/(app)/rooms/actions'
import { dueDayAdjustDisplayMemo, dueDayAdjustKindOf, DUE_DAY_ADJUST_KIND_TEXT } from '@/lib/dueDayAdjust'

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
        aria-expanded={open}
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
          ) : !data || (data.records.length === 0 && data.adjusts.length === 0) ? (
            <p className="text-xs text-[var(--warm-muted)] py-3 text-center">수납 내역이 없습니다.</p>
          ) : (
            <>
            {data.records.length === 0 && <p className="text-xs text-[var(--warm-muted)] py-3 text-center">수납 내역이 없습니다.</p>}
            <ul className="divide-y divide-[var(--warm-border)]">
              {data.records.map(r => (
                <li key={r.id} className="py-1.5">
                  {/* 좁은 폭(320·125%)에서는 날짜·월분·금액이 한 줄에 다 안 들어간다. 금액은 한 줄(nowrap)이고 겹치거나 행 밖으로
                      나가지 않게 줄을 넘겨 오른쪽에 선다(flex-wrap, 금액 flex-1 text-right). 수단 칸은 줄어든다(검수 2026-10-21). */}
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    <span className="num text-[var(--warm-mid)] w-[82px] shrink-0">{fmtDate(r.payDate)}</span>
                    <span className="text-[var(--warm-muted)] shrink-0">
                      {Number(r.targetMonth.slice(5))}월분
                      {r.isDeposit && <span className="ml-1 text-[var(--warm-mid)] font-medium">보증금</span>}
                      {r.isPrevOwner && <span className="ml-1 text-[var(--warm-muted)]">양도인</span>}
                    </span>
                    <span className="num font-semibold text-[var(--warm-dark)] flex-1 text-right whitespace-nowrap">{fmtWon(r.actualAmount)}</span>
                    <span className="text-[var(--warm-muted)] w-[60px] min-w-0 shrink truncate text-right">{r.payMethod ?? ''}</span>
                  </div>
                  {r.memo && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 pl-[90px] break-keep">{r.memo}</p>}
                </li>
              ))}
            </ul>
            {/* 납입일 변경 조정은 들어온 돈이 아니다. 위 수납 목록·건수·합계에 넣지 않고 아래에 따로 묶는다(2026-10-21).
                형제 수납 내역(PaymentRecordList)이 같은 자리에 '납입일 변경 조정' 묶음을 두는 것과 같은 문법이고, 표시 규칙도 같다
                (방향 제목·부호 없는 금액·표시 메모). 행 모양은 이 목록의 행 그대로이고 수단 칸은 비운다(조정 행에는 수단이 없다).
                빈 수단 칸은 금액 열을 위 행과 맞추는 자리라 좁은 폭에서는 줄어든다(행 밖으로 안 나간다).
                금액은 두 목록 모두 한 줄(whitespace-nowrap)이고, 좁은 폭에서 줄어드는 쪽은 수단 칸이다(검수 2026-10-21, 320·125% 보증금 행 넘침).
                제목은 둘째 줄 앞에 둔다. 첫 줄에 넣으면 320px 에서 날짜·월분·금액·수단 칸과 함께 행 밖으로 넘친다. */}
            {data.adjusts.length > 0 && (
              <div className="mt-2 pt-2 border-t border-[var(--warm-border)]">
                <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)] py-1">납입일 변경 조정</p>
                <ul className="divide-y divide-[var(--warm-border)]">
                  {data.adjusts.map(r => {
                    const kind = dueDayAdjustKindOf(r.actualAmount)
                    const memo = dueDayAdjustDisplayMemo(r.memo)
                    return (
                      <li key={r.id} className="py-1.5">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                          <span className="num text-[var(--warm-mid)] w-[82px] shrink-0">{fmtDate(r.payDate)}</span>
                          <span className="text-[var(--warm-muted)] shrink-0">{Number(r.targetMonth.slice(5))}월분</span>
                          <span className="num font-semibold text-[var(--warm-dark)] flex-1 text-right whitespace-nowrap">{fmtWon(Math.abs(r.actualAmount))}</span>
                          <span className="w-[60px] min-w-0 shrink" aria-hidden="true" />
                        </div>
                        <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 pl-[90px] break-keep">
                          {kind ? DUE_DAY_ADJUST_KIND_TEXT[kind] : '조정'}{memo ? ` · ${memo}` : ''}
                        </p>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
