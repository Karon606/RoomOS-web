'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import { type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, TRACKED_CATEGORIES } from './constants'
import {
  getInventoryDetail,
  getPriceHistory,
  getMonthlyInflow,
  createTrackedItem,
  updateTrackedItem,
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
  const rows = initialRows
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
      {detailId && (
        <DetailModal
          row={rows.find(r => r.id === detailId) ?? null}
          onClose={() => setDetailId(null)}
          onChange={() => router.refresh()}
        />
      )}
    </div>
  )
}

function InventoryCard({ row, onOpen }: { row: InventoryRow; onOpen: () => void }) {
  const tint = CATEGORY_TINT[row.category]
  const lowStock = row.daysUntilEmpty != null && row.daysUntilEmpty <= row.alertThresholdDays
  const stockUnit = row.specUnit ?? row.qtyUnit  // 잔량/소모 단위는 규격 우선
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
          <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-500/10 text-red-500 shrink-0">
            소진 임박
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">현재 잔량</p>
          <p className="text-sm font-semibold text-[var(--warm-dark)]">{fmtQty(row.currentStock, stockUnit)}</p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">평균 소모/일</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgDaily != null ? fmtQty(row.avgDaily, stockUnit) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">소진 예상</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.daysUntilEmpty != null ? `${row.daysUntilEmpty}일` : '—'}
            <span className="text-[10px] text-[var(--warm-muted)] ml-1">/ 알림 D-{row.alertThresholdDays}</span>
          </p>
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)]">평균 단가</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgUnitPrice != null
              ? `${Math.round(row.avgUnitPrice).toLocaleString()}원${row.specUnit ? `/${row.specUnit}` : row.qtyUnit ? `/${row.qtyUnit}` : ''}`
              : '—'}
          </p>
        </div>
      </div>
      {row.reorderMemo && (
        <p className="text-[10px] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2 py-1.5 leading-relaxed">
          📦 {row.reorderMemo}
        </p>
      )}
      {row.lastPeriodConsumption != null && row.lastPeriodDays != null && (
        <p className="text-[10px] text-[var(--warm-muted)] pt-1.5 border-t border-[var(--warm-border)]/60">
          최근 {row.lastPeriodDays}일 동안 {fmtQty(row.lastPeriodConsumption, stockUnit)} 소모 · 최근 점검 {fmtDate(row.lastCheckDate)}
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

function DetailModal({ row, onClose, onChange }: {
  row: InventoryRow | null; onClose: () => void; onChange: () => void
}) {
  if (!row) return null
  const trackedItemId = row.id
  const [data, setData] = useState<Awaited<ReturnType<typeof getInventoryDetail>>>(null)
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [monthlyInflow, setMonthlyInflow] = useState<MonthlyInflowRow[]>([])
  const [mode, setMode] = useState<'view' | 'check' | 'addition' | 'settings'>('view')
  const [tab, setTab]   = useState<'timeline' | 'monthly' | 'price'>('timeline')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  const reload = () => Promise.all([
    getInventoryDetail(trackedItemId).then(setData),
    getPriceHistory(trackedItemId).then(setPriceHistory),
    getMonthlyInflow(trackedItemId).then(setMonthlyInflow),
  ])
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
            <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">{data?.item.label ?? row.label}</h2>
            <p className="text-[10px] text-[var(--warm-muted)] mt-0.5">{data?.item.category ?? row.category}</p>
          </div>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
        </div>

        {!data ? (
          <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
        ) : mode === 'check' ? (
          <CheckForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
        ) : mode === 'addition' ? (
          <AdditionForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
        ) : mode === 'settings' ? (
          <SettingsForm row={row} onCancel={() => setMode('view')} onDone={() => { setMode('view'); onChange() }} />
        ) : (
          <>
            {/* 탭: 타임라인 / 월별 입수 / 단가 추이 */}
            <div className="flex gap-1 px-5 pt-3 shrink-0 flex-wrap">
              <TabBtn active={tab === 'timeline'} onClick={() => setTab('timeline')}>타임라인</TabBtn>
              <TabBtn active={tab === 'monthly'}  onClick={() => setTab('monthly')}>월별 입수</TabBtn>
              <TabBtn active={tab === 'price'}    onClick={() => setTab('price')}>단가 추이</TabBtn>
            </div>

            <div className="overflow-y-auto flex-1 px-5 py-3 space-y-3">
              {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

              {tab === 'timeline' && (
                data.timeline.length === 0 ? (
                  <p className="text-sm text-[var(--warm-muted)] text-center py-6">기록이 없습니다.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.timeline.map(e => <TimelineRow key={`${e.type}-${e.id}`} entry={e} stockUnit={data.item.specUnit ?? data.item.qtyUnit} onDeleteCheck={handleDeleteCheck} onDeleteAddition={handleDeleteAddition} pending={pending} />)}
                  </ul>
                )
              )}
              {tab === 'monthly' && (
                <MonthlyInflowList rows={monthlyInflow} stockUnit={data.item.specUnit ?? data.item.qtyUnit} />
              )}
              {tab === 'price' && (
                <PriceChart points={priceHistory} unitLabel={data.item.specUnit ?? data.item.qtyUnit} qtyUnit={data.item.qtyUnit} />
              )}
            </div>
            <div className="border-t border-[var(--warm-border)] px-5 py-3 flex gap-2 shrink-0 flex-wrap">
              <button
                onClick={handleArchive}
                disabled={pending}
                className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg disabled:opacity-40">
                추적 제외
              </button>
              <button onClick={() => setMode('settings')}
                className="px-3 py-2 bg-[var(--canvas)] border border-[var(--warm-border)] text-xs font-medium rounded-lg text-[var(--warm-dark)] hover:bg-[var(--warm-border)]">
                설정
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

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${active
        ? 'bg-[var(--coral)] text-white'
        : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>
      {children}
    </button>
  )
}

function MonthlyInflowList({ rows, stockUnit }: { rows: MonthlyInflowRow[]; stockUnit: string | null }) {
  if (rows.length === 0) {
    return <p className="text-sm text-[var(--warm-muted)] text-center py-8">아직 입수 기록이 없습니다. 지출 등록 또는 무상 입수 추가 시 자동으로 집계됩니다.</p>
  }
  const u = stockUnit ?? ''
  const maxQty = Math.max(...rows.map(r => r.totalQty), 1)
  const totalAll  = rows.reduce((s, r) => s + r.totalQty, 0)
  const totalAmt  = rows.reduce((s, r) => s + r.purchaseAmount, 0)
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-[var(--canvas)] rounded-xl p-3">
          <p className="text-[10px] text-[var(--warm-muted)]">전체 입수량</p>
          <p className="text-sm font-bold text-[var(--warm-dark)] mt-0.5">{Math.round(totalAll * 100) / 100}{u}</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3">
          <p className="text-[10px] text-[var(--warm-muted)]">전체 구매 비용</p>
          <p className="text-sm font-bold text-[var(--warm-dark)] mt-0.5">{totalAmt.toLocaleString()}원</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {rows.map(r => {
          const purchasePct = (r.purchaseQty / maxQty) * 100
          const additionPct = (r.additionQty / maxQty) * 100
          return (
            <li key={r.month} className="bg-[var(--cream)] border border-[var(--warm-border)]/60 rounded-xl px-3 py-2.5 space-y-1.5">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-[var(--warm-dark)]">{r.month.slice(0, 4)}년 {Number(r.month.slice(5))}월</span>
                <span className="text-[var(--warm-dark)]">
                  {Math.round(r.totalQty * 100) / 100}{u}
                </span>
              </div>
              <div className="space-y-1">
                {r.purchaseQty > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--warm-muted)] w-8 shrink-0">구매</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, purchasePct)}%`, background: '#6aab7e' }} />
                    </div>
                    <span className="text-[10px] text-[var(--warm-muted)] w-24 text-right shrink-0 tabular-nums">
                      {Math.round(r.purchaseQty * 100) / 100}{u} · {r.purchaseAmount.toLocaleString()}원
                    </span>
                  </div>
                )}
                {r.additionQty > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-[var(--warm-muted)] w-8 shrink-0">무상</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, additionPct)}%`, background: '#d4a847' }} />
                    </div>
                    <span className="text-[10px] text-[var(--warm-muted)] w-24 text-right shrink-0 tabular-nums">
                      {Math.round(r.additionQty * 100) / 100}{u}
                    </span>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function PriceChart({ points, unitLabel, qtyUnit }: { points: PricePoint[]; unitLabel: string | null; qtyUnit: string | null }) {
  if (points.length === 0) {
    return <p className="text-sm text-[var(--warm-muted)] text-center py-8">단가 데이터가 없습니다. 지출 등록 시 금액과 수량이 함께 입력되면 단가가 자동 계산됩니다.</p>
  }
  const prices = points.map(p => p.unitPrice)
  const minP = Math.min(...prices)
  const maxP = Math.max(...prices)
  const range = Math.max(1, maxP - minP)
  const W = 100
  const H = 40
  const xs = points.map((_, i) => points.length === 1 ? W / 2 : (i / (points.length - 1)) * W)
  const ys = points.map(p => H - ((p.unitPrice - minP) / range) * H)
  const path = points.length === 1
    ? `M ${xs[0]} ${ys[0]} L ${xs[0]} ${ys[0]}`
    : xs.map((x, i) => `${i === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${ys[i].toFixed(2)}`).join(' ')

  const unitSuffix = unitLabel ? `/${unitLabel}` : ''
  return (
    <div className="space-y-3">
      <div className="bg-[var(--canvas)] rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between text-[10px] text-[var(--warm-muted)]">
          <span>최저 {Math.round(minP).toLocaleString()}원{unitSuffix}</span>
          <span>최고 {Math.round(maxP).toLocaleString()}원{unitSuffix}</span>
        </div>
        <svg viewBox={`0 0 ${W} ${H + 4}`} preserveAspectRatio="none" className="w-full h-32">
          <path d={path} fill="none" stroke="var(--coral)" strokeWidth="0.8" strokeLinejoin="round" strokeLinecap="round" />
          {xs.map((x, i) => <circle key={i} cx={x} cy={ys[i]} r="0.9" fill="var(--coral)" />)}
        </svg>
      </div>
      <ul className="space-y-1.5">
        {[...points].reverse().map((p, i) => (
          <li key={i} className="flex items-center justify-between text-xs px-3 py-2 bg-[var(--cream)] border border-[var(--warm-border)]/60 rounded-xl">
            <span className="text-[var(--warm-muted)]">{fmtDate(p.date)}</span>
            <span className="text-[var(--warm-dark)] font-medium">
              {Math.round(p.unitPrice).toLocaleString()}원{unitSuffix}
            </span>
            <span className="text-[10px] text-[var(--warm-muted)]">
              {p.qty}{qtyUnit ?? ''} · {p.amount.toLocaleString()}원
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SettingsForm({ row, onCancel, onDone }: {
  row: InventoryRow; onCancel: () => void; onDone: () => void
}) {
  const [thresholdDays, setThresholdDays] = useState(String(row.alertThresholdDays))
  const [reorderMemo, setReorderMemo]     = useState(row.reorderMemo ?? '')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const n = parseInt(thresholdDays, 10)
    if (isNaN(n) || n < 0) { setError('알림 기준은 0 이상이어야 합니다.'); return }
    startTransition(async () => {
      const res = await updateTrackedItem(row.id, {
        alertThresholdDays: n,
        reorderMemo: reorderMemo.trim() || null,
      })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">소진 예상일이 알림 기준 이하가 되면 대시보드에 '재고 부족' 알림이 표시됩니다.</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">알림 기준 (D-N)</label>
        <input type="text" inputMode="numeric" value={thresholdDays}
          onChange={e => setThresholdDays(e.target.value.replace(/[^0-9]/g, ''))}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[10px] text-[var(--warm-muted)]">예: 3 → 소진 예상이 3일 이하면 알림</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">발주 메모</label>
        <textarea value={reorderMemo} onChange={e => setReorderMemo(e.target.value)}
          rows={3}
          placeholder="예: 쿠팡 / 100매 박스 단위 / 영업장 카드 결제"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
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

function TimelineRow({ entry, stockUnit, onDeleteCheck, onDeleteAddition, pending }: {
  entry: TimelineEntry; stockUnit: string | null
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
            <p className="text-sm font-medium text-[var(--warm-dark)]">잔량 {fmtQty(entry.remainingQty, stockUnit)}</p>
            {entry.memo && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
          </div>
        </div>
        <button disabled={pending} onClick={() => onDeleteCheck(entry.id)}
          className="text-[10px] text-red-400 hover:text-red-600 disabled:opacity-40 shrink-0">삭제</button>
      </li>
    )
  }
  if (entry.type === 'purchase') {
    // 규격 정보가 있으면 stockUnit 기준 환산량을 우선 표시. 원 포장 단위(qtyValue × qtyUnit)는 보조로 노출
    const hasSpec = entry.specValue != null && entry.specValue > 0 && entry.specUnit
    const baseQty = hasSpec ? entry.qtyValue * (entry.specValue ?? 0) : entry.qtyValue
    const baseUnit = hasSpec ? entry.specUnit : entry.qtyUnit
    const packLabel = hasSpec
      ? `${fmtQty(entry.qtyValue, entry.qtyUnit)} × ${entry.specValue}${entry.specUnit}`
      : null
    return (
      <li className="flex items-center justify-between gap-2 border border-[var(--warm-border)]/60 rounded-xl px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 구매 (지출){packLabel ? ` · ${packLabel}` : ''}</p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(baseQty, baseUnit)}{entry.amount > 0 ? ` (${entry.amount.toLocaleString()}원)` : ''}</p>
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
          <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(entry.addedQty, stockUnit)}</p>
          {entry.memo && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
        </div>
      </div>
      <button disabled={pending} onClick={() => onDeleteAddition(entry.id)}
        className="text-[10px] text-red-400 hover:text-red-600 disabled:opacity-40 shrink-0">삭제</button>
    </li>
  )
}

function CheckForm({ item, onCancel, onDone }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null }
  onCancel: () => void; onDone: () => void
}) {
  const stockUnit = item.specUnit ?? item.qtyUnit
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
      <p className="text-xs text-[var(--warm-muted)]">점검한 시점에 남아있는 양을 {stockUnit ?? '단위'} 기준으로 기록합니다. 직전 점검과의 차이로 그 기간의 소모량이 계산됩니다.</p>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">점검일 *</label>
          <DatePicker value={date} onChange={setDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">잔량 *{stockUnit ? ` (${stockUnit})` : ''}</label>
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
  item: { id: string; specUnit: string | null; qtyUnit: string | null }
  onCancel: () => void; onDone: () => void
}) {
  const useSpec = !!(item.specUnit && item.specUnit.trim())
  const [date, setDate]     = useState(kstYmdStr())
  const [specQty, setSpecQty] = useState('')   // 규격 (예: 20)
  const [packQty, setPackQty] = useState('1')  // 수량 (예: 1 포대)
  const [qtyOnly, setQtyOnly] = useState('')   // 규격 없는 품목용 단일 입력
  const [source, setSource] = useState('무상')
  const [memo, setMemo]     = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError]   = useState('')

  // 저장 단위 = specUnit (있으면) else qtyUnit. 환산: spec × pack
  const computed = useSpec
    ? (Number(specQty) || 0) * (Number(packQty) || 0)
    : (Number(qtyOnly) || 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (computed <= 0) { setError('수량은 0보다 커야 합니다.'); return }
    startTransition(async () => {
      const res = await createStockAddition({ trackedItemId: item.id, date, addedQty: computed, source, memo: memo || undefined })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">지출 외에 들어온 양 (무상 수령, 기증, 이월 등)을 기록합니다. 소모량 계산에 합산됩니다.</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">입수일 *</label>
        <DatePicker value={date} onChange={setDate}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
      </div>
      {useSpec ? (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-[10px] text-[var(--warm-muted)]">규격</label>
              <div className="flex gap-1 items-center">
                <input type="text" inputMode="decimal" value={specQty}
                  onChange={e => setSpecQty(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)] shrink-0 w-10 text-left">{item.specUnit}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[10px] text-[var(--warm-muted)]">수량</label>
              <div className="flex gap-1 items-center">
                <input type="text" inputMode="decimal" value={packQty}
                  onChange={e => setPackQty(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="1"
                  className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)] shrink-0 w-10 text-left">{item.qtyUnit ?? '개'}</span>
              </div>
            </div>
          </div>
          {computed > 0 && (
            <p className="text-[10px] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
              → 입수량 합계 <strong>{Math.round(computed * 100) / 100}{item.specUnit}</strong>
            </p>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">수량 *{item.qtyUnit ? ` (${item.qtyUnit})` : ''}</label>
          <input type="text" inputMode="decimal" value={qtyOnly}
            onChange={e => setQtyOnly(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        </div>
      )}
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
