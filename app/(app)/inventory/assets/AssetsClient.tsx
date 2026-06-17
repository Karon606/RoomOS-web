'use client'

// 비품·자재 — 소모품 재고와 별개로, 품목으로 산 내구재(의자·거치대·수선유지 자재 등)를
// 방별 / 공용부(위치)별 / 미배정(여분)으로 보여주고, 미배정 아이템을 방·공용부에 배정한다.
// 수량 2개 이상이면 몇 개 배정할지 물어 분할(나머지 여분 유지). 배정해제 시 같은 묶음 재병합.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { pushToast } from '@/lib/saveStatus'
import { assignAggregateToTarget, type AssetsData, type AssetItem } from './actions'

const won = (n: number) => n.toLocaleString('ko-KR') + '원'
const fmtRoomNo = (no: string) => (/^\d+$/.test(no) ? `${no}호` : no)
const fmtQty = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))

type Target = { kind: 'room' | 'location'; id: string }

export default function AssetsClient({ data, rooms, locations }: {
  data: AssetsData
  rooms: { id: string; roomNo: string }[]
  locations: { id: string; name: string }[]
}) {
  const router = useRouter()
  const [picking, setPicking] = useState<string | null>(null)   // 배정 picker 가 열린 항목 id
  const [qtyAsk, setQtyAsk] = useState<{ it: AssetItem; target: Target; label: string } | null>(null)
  const [qtyVal, setQtyVal] = useState('1')
  const [pending, startTransition] = useTransition()

  // 배정 해제(미배정으로) — 묶음(ids) 전체
  const unassign = (it: AssetItem) => {
    startTransition(async () => {
      const res = await assignAggregateToTarget(it.ids, { kind: 'none' }, null)
      setPicking(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '배정 해제됨')
      router.refresh()
    })
  }

  // 통째 배정 — 묶음 전체
  const assignWhole = (it: AssetItem, target: Target, label: string) => {
    startTransition(async () => {
      const res = await assignAggregateToTarget(it.ids, target, null)
      setPicking(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `${label}에 배정됨`)
      router.refresh()
    })
  }

  // 대상 선택 — 수량 2개 이상이면 몇 개 배정할지 물어봄(기본 1), 아니면 통째
  const onPickTarget = (it: AssetItem, value: string) => {
    setPicking(null)
    if (!value) { unassign(it); return }
    const [kind, id] = value.split(':')
    const target: Target = { kind: kind === 'room' ? 'room' : 'location', id }
    const label = kind === 'room'
      ? fmtRoomNo(rooms.find(r => r.id === id)?.roomNo ?? '')
      : (locations.find(l => l.id === id)?.name ?? '공용부')
    const qty = it.qtyValue ?? 0
    if (qty >= 2) { setQtyVal('1'); setQtyAsk({ it, target, label }) }
    else assignWhole(it, target, label)
  }

  const confirmPartial = () => {
    if (!qtyAsk) return
    const max = qtyAsk.it.qtyValue ?? 1
    let q = Number(qtyVal)
    if (!(q > 0)) q = 1
    if (q > max) q = max
    const { it, target, label } = qtyAsk
    startTransition(async () => {
      const res = await assignAggregateToTarget(it.ids, target, q)
      setQtyAsk(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', q >= (it.qtyValue ?? 0) ? `${label}에 전체 배정됨` : `${label}에 ${fmtQty(q)}${it.qtyUnit ?? '개'} 배정됨`)
      router.refresh()
    })
  }

  const currentValue = (it: AssetItem) =>
    it.roomId ? `room:${it.roomId}` : it.locationId ? `loc:${it.locationId}` : ''

  const ItemRow = ({ it, placed }: { it: AssetItem; placed: boolean }) => (
    <li className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3.5 py-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm text-[var(--warm-dark)] truncate">{it.detail || it.itemLabel}</p>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">
            {it.date.slice(2)} · {it.category}{it.vendor ? ` · ${it.vendor}` : ''}{it.count > 1 ? ` · 구매 ${it.count}건 합산` : ''}
          </p>
        </div>
        <span className="shrink-0 text-sm font-semibold text-[var(--danger-fg)] tabular-nums">{won(it.amount)}</span>
      </div>
      <div className="mt-1.5 flex items-center justify-end gap-1.5 flex-wrap">
        {qtyAsk?.it.id === it.id ? (
          <>
            <span className="text-[0.6875rem] text-[var(--warm-muted)]">
              {qtyAsk.label}에 (전체 {fmtQty(it.qtyValue ?? 0)}{it.qtyUnit ?? '개'} 중)
            </span>
            <input autoFocus type="number" min={1} max={it.qtyValue ?? undefined} step="any"
              value={qtyVal} disabled={pending}
              onChange={e => setQtyVal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') confirmPartial() }}
              className="w-16 text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-[var(--warm-dark)] outline-none tabular-nums" />
            <span className="text-[0.6875rem] text-[var(--warm-muted)]">{it.qtyUnit ?? '개'}</span>
            <button type="button" onClick={confirmPartial} disabled={pending}
              className="text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">배정</button>
            <button type="button" onClick={() => setQtyAsk(null)} disabled={pending} className="text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
          </>
        ) : picking === it.id ? (
          <>
            <select autoFocus disabled={pending} defaultValue={currentValue(it)}
              onChange={e => onPickTarget(it, e.target.value)}
              className="text-xs bg-[var(--canvas)] border border-[var(--coral)] rounded-lg px-2 py-1 text-[var(--warm-dark)] outline-none max-w-[60vw]">
              <option value="">미배정(여분)</option>
              <optgroup label="방">
                {rooms.map(r => <option key={r.id} value={`room:${r.id}`}>{fmtRoomNo(r.roomNo)}</option>)}
              </optgroup>
              {locations.length > 0 && (
                <optgroup label="공용부">
                  {locations.map(l => <option key={l.id} value={`loc:${l.id}`}>{l.name}</option>)}
                </optgroup>
              )}
            </select>
            <button type="button" onClick={() => setPicking(null)} className="text-[0.6875rem] px-2 py-1 text-[var(--warm-muted)]">취소</button>
          </>
        ) : (
          <button type="button" onClick={() => setPicking(it.id)} disabled={pending}
            className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-40">
            {placed ? '배정 변경' : '배정'}
          </button>
        )}
      </div>
    </li>
  )

  const isEmpty = data.rooms.length === 0 && data.locations.length === 0 && data.unassigned.length === 0

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
          품목으로 산 내구재(의자·거치대·수선유지 자재 등)를 방·공용부별로 모아 봅니다. 여분(미배정)은 방이나 공용부(주방·화장실·복도 등)에 배정할 수 있습니다. <span className="text-[var(--warm-mid)]">공용부는 ‘위치 관리’에서 추가합니다.</span>
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
                {data.unassigned.map(it => <ItemRow key={it.id} it={it} placed={false} />)}
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
                {g.items.map(it => <ItemRow key={it.id} it={it} placed />)}
              </ul>
            </section>
          ))}

          {/* 공용부별 */}
          {data.locations.map(g => (
            <section key={g.locationId} className="space-y-2">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                {g.name} <span className="text-[0.625rem] text-[var(--coral)] font-normal">공용부</span> <span className="text-[var(--warm-muted)] font-normal">{g.items.length}건 · {won(g.total)}</span>
              </h2>
              <ul className="space-y-1.5">
                {g.items.map(it => <ItemRow key={it.id} it={it} placed />)}
              </ul>
            </section>
          ))}
        </>
      )}
    </div>
  )
}
