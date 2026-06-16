'use client'

// 비품·자재 — 소모품 재고와 별개로, 품목으로 산 내구재(의자·거치대·수선유지 자재 등)를
// 방별/미배정(여분)으로 보여주고, 미배정 아이템을 방에 배정하면 그 호실 지출로 넘어간다.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { pushToast } from '@/lib/saveStatus'
import { assignExpenseToRoom, type AssetsData, type AssetItem } from './actions'

const won = (n: number) => n.toLocaleString('ko-KR') + '원'
const fmtRoomNo = (no: string) => (/^\d+$/.test(no) ? `${no}호` : no)

export default function AssetsClient({ data, rooms }: { data: AssetsData; rooms: { id: string; roomNo: string }[] }) {
  const router = useRouter()
  const [picking, setPicking] = useState<string | null>(null)   // 배정 picker 가 열린 항목 id
  const [pending, startTransition] = useTransition()

  const assign = (expenseId: string, roomId: string | null) => {
    startTransition(async () => {
      const res = await assignExpenseToRoom(expenseId, roomId)
      setPicking(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', roomId ? '호실에 배정됨' : '배정 해제됨')
      router.refresh()
    })
  }

  const ItemRow = ({ it, assigned }: { it: AssetItem; assigned: boolean }) => (
    <li className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--warm-dark)] truncate">{it.detail || it.itemLabel}</p>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">
            {it.date.slice(2)} · {it.category}{it.vendor ? ` · ${it.vendor}` : ''}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-[var(--danger-fg)] tabular-nums">{won(it.amount)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1.5">
        {picking === it.id ? (
          <select autoFocus disabled={pending} defaultValue={it.roomId ?? ''}
            onChange={e => assign(it.id, e.target.value || null)}
            className="text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-[var(--warm-dark)] outline-none">
            <option value="">미배정(여분)</option>
            {rooms.map(r => <option key={r.id} value={r.id}>{fmtRoomNo(r.roomNo)}</option>)}
          </select>
        ) : (
          <button type="button" onClick={() => setPicking(it.id)} disabled={pending}
            className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-40">
            {assigned ? '방 변경' : '방 배정'}
          </button>
        )}
        {picking === it.id && (
          <button type="button" onClick={() => setPicking(null)} className="text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
        )}
      </div>
    </li>
  )

  const isEmpty = data.rooms.length === 0 && data.unassigned.length === 0

  return (
    <div className="space-y-5 px-4 sm:px-6 py-5">
      {/* 동일 레벨 탭 — 소모품·부식 / 비품·자재(현재) */}
      <div className="inline-flex rounded-xl border border-[var(--warm-border)] overflow-hidden text-sm font-medium">
        <button type="button" onClick={() => router.push('/inventory')}
          className="px-4 py-2 bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">소모품·부식</button>
        <button type="button" className="px-4 py-2 bg-[var(--coral)] text-white">비품·자재</button>
      </div>
      <div>
        <h1 className="text-base sm:text-lg font-bold text-[var(--warm-dark)]">재고 관리 · 비품·자재</h1>
        <p className="text-xs text-[var(--warm-muted)] mt-0.5">
          품목으로 산 내구재(의자·거치대·수선유지 자재 등)를 방별로 모아 봅니다. 여분으로 둔 미배정 항목은 나중에 방에 배정하면 그 호실 지출로 넘어갑니다.
        </p>
      </div>

      {isEmpty ? (
        <EmptyState
          title="비품·자재 내역이 아직 없습니다"
          description="지출 등록에서 품목으로 입력한 내구재(소모품 외 카테고리)가 여기에 모입니다."
        />
      ) : (
        <>
          {/* 미배정(여분) — 먼저 */}
          <section className="space-y-2">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
              미배정 (여분) <span className="text-[var(--warm-muted)] font-normal">{data.unassigned.length}건 · {won(data.unassignedTotal)}</span>
            </h2>
            {data.unassigned.length === 0 ? (
              <p className="text-xs text-[var(--warm-muted)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-3 text-center">미배정 비품이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.unassigned.map(it => <ItemRow key={it.id} it={it} assigned={false} />)}
              </ul>
            )}
          </section>

          {/* 방별 */}
          {data.rooms.map(g => (
            <section key={g.roomId} className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                {fmtRoomNo(g.roomNo)} <span className="text-[var(--warm-muted)] font-normal">{g.items.length}건 · {won(g.total)}</span>
              </h2>
              <ul className="space-y-1.5">
                {g.items.map(it => <ItemRow key={it.id} it={it} assigned />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
