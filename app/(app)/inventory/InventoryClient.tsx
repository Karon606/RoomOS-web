'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import {
  type InventoryRow,
  type TimelineEntry,
  TRACKED_CATEGORIES,
  getInventoryDetail,
  createTrackedItem,
  archiveTrackedItem,
  createStockCheck,
  createStockAddition,
  deleteStockCheck,
  deleteStockAddition,
  seedTrackedItemsFromExpenses,
} from './actions'

const CATEGORY_TINT: Record<string, { bg: string; fg: string }> = {
  '부식비':       { bg: 'rgba(232,137,58,0.10)',  fg: '#e8893a' },
  '소모품비':     { bg: 'rgba(244,98,58,0.10)',   fg: '#f4623a' },
  '폐기물 처리비':{ bg: 'rgba(91,164,184,0.10)',  fg: '#5aa4b8' },
}

const fmtQty = (val: number | null, unit: string | null) => {
  if (val == null) return '—'
  const rounded = Math.round(val * 100) / 100
  return `${rounded}${unit ?? ''}`
}

const fmtDate = (d: Date | string | null) => {
  if (!d) return '—'
  const dt = new Date(d)
  return `${dt.getFullYear()}.${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`
}

export default function InventoryClient({ initialRows }: { initialRows: InventoryRow[] }) {
  const router = useRouter()
  const [rows] = useState(initialRows)
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd]         = useState(false)
  const [detailId, setDetailId]       = useState<string | null>(null)
  const [error, setError]             = useState('')

  const handleSeed = () => {
    startTransition(async () => {
      const res = await seedTrackedItemsFromExpenses()
      if (res.ok) {
        alert(res.created > 0 ? `${res.created}개 품목을 추가했습니다.` : '추가할 품목이 없습니다 (이미 등록됨).')
        router.refresh()
      } else {
        alert(res.error)
      }
    })
  }

  // 카테고리별 그룹
  const grouped = TRACKED_CATEGORIES.map(cat => ({
    cat,
    rows: rows.filter(r => r.category === cat),
  }))

  return (
    <div className="space-y-4 px-4 sm:px-6 py-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-base sm:text-lg font-bold text-[var(--warm-dark)]">재고 관리</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">부식·소모품·폐기물 사용량을 점검 기록 기반으로 추적합니다.</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleSeed}
            disabled={isPending}
            className="px-3 py-2 text-xs rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] text-[var(--warm-dark)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors disabled:opacity-50">
            지출에서 자동 등록
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="px-3 py-2 text-xs rounded-xl bg-[var(--coral)] text-white hover:opacity-90 transition-opacity">
            + 품목 추가
          </button>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

      {rows.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-8 text-center space-y-2">
          <p className="text-sm text-[var(--warm-dark)] font-medium">추적할 품목이 아직 없습니다</p>
          <p className="text-xs text-[var(--warm-muted)]">'지출에서 자동 등록' 버튼을 누르면 부식·소모품·폐기물 카테고리에서 입력된 품목이 자동 등록됩니다.</p>
        </div>
      ) : (
        grouped.map(g => g.rows.length > 0 && (
          <section key={g.cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_TINT[g.cat]?.fg ?? '#999' }} />
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">{g.cat}</h2>
              <span className="text-[11px] text-[var(--warm-muted)]">{g.rows.length}품목</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.rows.map(r => <InventoryCard key={r.id} row={r} onOpen={() => setDetailId(r.id)} />)}
            </div>
          </section>
        ))
      )}

      {showAdd && <AddItemModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); router.refresh() }} />}
      {detailId && <DetailModal trackedItemId={detailId} onClose={() => setDetailId(null)} onChange={() => router.refresh()} />}
    </div>
  )
}

function InventoryCard({ row, onOpen }: { row: InventoryRow; onOpen: () => void }) {
  const tint = CATEGORY_TINT[row.category]
  const lowStock = row.daysUntilEmpty != null && row.daysUntilEmpty <= 3
  return (
    <button
      type="button"
      onClick={onOpen}
      className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 space-y-3 text-left hover:border-[var(--coral)] transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--warm-dark)] truncate">{row.label}</p>
          <p className="text-[10px] mt-0.5" style={{ color: tint?.fg }}>{row.category}</p>
        </div>
        {lowStock && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-500/10 text-red-500">
            소진 임박
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">현재 잔량</p>
          <p className="text-sm font-semibold text-[var(--warm-dark)]">{fmtQty(row.currentStock, row.qtyUnit)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">평균 소모/일</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgDaily != null ? fmtQty(row.avgDaily, row.qtyUnit) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">소진 예상</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.daysUntilEmpty != null ? `${row.daysUntilEmpty}일` : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">최근 점검</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">{fmtDate(row.lastCheckDate)}</p>
        </div>
      </div>
      {row.lastPeriodConsumption != null && row.lastPeriodDays != null && (
        <p className="text-[10px] text-[var(--warm-muted)] pt-1.5 border-t border-[var(--warm-border)]/60">
          최근 {row.lastPeriodDays}일 동안 {fmtQty(row.lastPeriodConsumption, row.qtyUnit)} 소모
        </p>
      )}
    </button>
  )
}

function AddItemModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<string>(TRACKED_CATEGORIES[0])
  const [label, setLabel]       = useState('')
  const [specUnit, setSpecUnit] = useState('')
  const [qtyUnit, setQtyUnit]   = useState('')
  const [memo, setMemo]         = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    startTransition(async () => {
      const res = await createTrackedItem({
        category, label,
        specUnit: specUnit || null,
        qtyUnit:  qtyUnit  || null,
        memo:     memo     || null,
      })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-md flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
          <h2 className="text-base font-bold text-[var(--warm-dark)]">추적 품목 추가</h2>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
        </div>
        <form onSubmit={handleSubmit} className="overflow-y-auto px-5 py-4 space-y-3 flex-1">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
            <select value={category} onChange={e => setCategory(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none">
              {TRACKED_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">품목명 *</label>
            <input type="text" value={label} onChange={e => setLabel(e.target.value)}
              placeholder="예: 화장실 휴지"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">용량 단위</label>
              <input type="text" value={specUnit} onChange={e => setSpecUnit(e.target.value)} placeholder="m, L, kg"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">수량 단위</label>
              <input type="text" value={qtyUnit} onChange={e => setQtyUnit(e.target.value)} placeholder="롤, 매, 포대"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
          </div>
          {error && <p className="text-xs text-red-500">{error}</p>}
          <div className="pt-2 flex gap-2">
            <button type="button" onClick={onClose}
              className="flex-1 py-2.5 bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl">취소</button>
            <button type="submit" disabled={pending}
              className="flex-1 py-2.5 bg-[var(--coral)] text-white text-sm font-medium rounded-xl disabled:opacity-60">
              {pending ? '저장 중...' : '저장'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

function DetailModal({ trackedItemId, onClose, onChange }: {
  trackedItemId: string; onClose: () => void; onChange: () => void
}) {
  const [data, setData] = useState<Awaited<ReturnType<typeof getInventoryDetail>>>(null)
  const [mode, setMode] = useState<'view' | 'check' | 'addition'>('view')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const reload = () => getInventoryDetail(trackedItemId).then(setData)
  useEffect(() => { reload() }, [trackedItemId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleArchive = () => {
    if (!confirm('이 품목을 추적 목록에서 제외하시겠습니까? (지출 기록은 그대로 유지됩니다)')) return
    startTransition(async () => {
      const res = await archiveTrackedItem(trackedItemId)
      if (res.ok) { onChange(); onClose() }
      else setError(res.error)
    })
  }

  const handleDeleteCheck = (id: string) => {
    if (!confirm('이 점검 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      const res = await deleteStockCheck(id)
      if (res.ok) { reload(); onChange() }
      else setError(res.error)
    })
  }

  const handleDeleteAddition = (id: string) => {
    if (!confirm('이 입수 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      const res = await deleteStockAddition(id)
      if (res.ok) { reload(); onChange() }
      else setError(res.error)
    })
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-lg flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div className="min-w-0">
            <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">{data?.item.label ?? '...'}</h2>
            <p className="text-[10px] text-[var(--warm-muted)] mt-0.5">{data?.item.category}</p>
          </div>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
        </div>

        {!data ? (
          <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
        ) : mode === 'check' ? (
          <CheckForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
        ) : mode === 'addition' ? (
          <AdditionForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
        ) : (
          <>
            <div className="overflow-y-auto flex-1 px-5 py-4 space-y-3">
              {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
              {data.timeline.length === 0 ? (
                <p className="text-sm text-[var(--warm-muted)] text-center py-6">기록이 없습니다.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.timeline.map(e => <TimelineRow key={`${e.type}-${e.id}`} entry={e} qtyUnit={data.item.qtyUnit} onDeleteCheck={handleDeleteCheck} onDeleteAddition={handleDeleteAddition} pending={pending} />)}
                </ul>
              )}
            </div>
            <div className="border-t border-[var(--warm-border)] px-5 py-3 flex gap-2 shrink-0 flex-wrap">
              <button
                onClick={handleArchive}
                disabled={pending}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg disabled:opacity-40">
                추적 제외
              </button>
              <div className="flex-1" />
              <button onClick={() => setMode('addition')}
                className="px-3 py-2 bg-[var(--canvas)] border border-[var(--warm-border)] text-xs font-medium rounded-lg text-[var(--warm-dark)] hover:bg-[var(--warm-border)]">
                + 무상 입수
              </button>
              <button onClick={() => setMode('check')}
                className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl">
                재고 점검
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function TimelineRow({ entry, qtyUnit, onDeleteCheck, onDeleteAddition, pending }: {
  entry: TimelineEntry; qtyUnit: string | null
  onDeleteCheck: (id: string) => void
  onDeleteAddition: (id: string) => void
  pending: boolean
}) {
  if (entry.type === 'check') {
    return (
      <li className="flex items-center justify-between gap-2 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--coral)] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 점검</p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">잔량 {fmtQty(entry.remainingQty, qtyUnit)}</p>
            {entry.memo && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
          </div>
        </div>
        <button disabled={pending} onClick={() => onDeleteCheck(entry.id)}
          className="text-[10px] text-red-400 hover:text-red-600 disabled:opacity-40 shrink-0">삭제</button>
      </li>
    )
  }
  if (entry.type === 'purchase') {
    return (
      <li className="flex items-center justify-between gap-2 border border-[var(--warm-border)]/60 rounded-xl px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 구매 (지출)</p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(entry.qtyValue, entry.qtyUnit)}{entry.amount > 0 ? ` (${entry.amount.toLocaleString()}원)` : ''}</p>
            {(entry.vendor || entry.memo) && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.vendor ?? ''}{entry.vendor && entry.memo ? ' · ' : ''}{entry.memo ?? ''}</p>}
          </div>
        </div>
      </li>
    )
  }
  return (
    <li className="flex items-center justify-between gap-2 border border-[var(--warm-border)]/60 rounded-xl px-3 py-2">
      <div className="min-w-0 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 무상 입수{entry.source ? ` (${entry.source})` : ''}</p>
          <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(entry.addedQty, qtyUnit)}</p>
          {entry.memo && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
        </div>
      </div>
      <button disabled={pending} onClick={() => onDeleteAddition(entry.id)}
        className="text-[10px] text-red-400 hover:text-red-600 disabled:opacity-40 shrink-0">삭제</button>
    </li>
  )
}

function CheckForm({ item, onCancel, onDone }: {
  item: { id: string; qtyUnit: string | null }
  onCancel: () => void; onDone: () => void
}) {
  const [date, setDate] = useState(kstYmdStr())
  const [qty, setQty]   = useState('')
  const [memo, setMemo] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const n = Number(qty)
    if (isNaN(n) || n < 0) { setError('잔량은 0 이상이어야 합니다.'); return }
    startTransition(async () => {
      const res = await createStockCheck({ trackedItemId: item.id, date, remainingQty: n, memo: memo || undefined })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">점검한 시점에 남아있는 양을 기록합니다. 직전 점검과의 차이로 그 기간의 소모량이 계산됩니다.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">점검일 *</label>
          <DatePicker value={date} onChange={setDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">잔량 *{item.qtyUnit ? ` (${item.qtyUnit})` : ''}</label>
          <input type="text" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="pt-2 flex gap-2">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2.5 bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl">취소</button>
        <button type="submit" disabled={pending}
          className="flex-1 py-2.5 bg-[var(--coral)] text-white text-sm font-medium rounded-xl disabled:opacity-60">
          {pending ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  )
}

function AdditionForm({ item, onCancel, onDone }: {
  item: { id: string; qtyUnit: string | null }
  onCancel: () => void; onDone: () => void
}) {
  const [date, setDate]   = useState(kstYmdStr())
  const [qty, setQty]     = useState('')
  const [source, setSource] = useState('무상')
  const [memo, setMemo]   = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const n = Number(qty)
    if (isNaN(n) || n <= 0) { setError('수량은 0보다 커야 합니다.'); return }
    startTransition(async () => {
      const res = await createStockAddition({ trackedItemId: item.id, date, addedQty: n, source, memo: memo || undefined })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">지출 외에 들어온 양 (무상 수령, 기증, 이월 등)을 기록합니다. 소모량 계산에 합산됩니다.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">입수일 *</label>
          <DatePicker value={date} onChange={setDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">수량 *{item.qtyUnit ? ` (${item.qtyUnit})` : ''}</label>
          <input type="text" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">출처</label>
        <select value={source} onChange={e => setSource(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]">
          <option value="무상">무상 수령</option>
          <option value="기증">기증</option>
          <option value="이월">이월 (인수 전 보유)</option>
          <option value="기타">기타</option>
        </select>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="pt-2 flex gap-2">
        <button type="button" onClick={onCancel}
          className="flex-1 py-2.5 bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl">취소</button>
        <button type="submit" disabled={pending}
          className="flex-1 py-2.5 bg-[var(--coral)] text-white text-sm font-medium rounded-xl disabled:opacity-60">
          {pending ? '저장 중...' : '저장'}
        </button>
      </div>
    </form>
  )
}
