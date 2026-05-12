'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { Modal, ModalFooterActions } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, TRACKED_CATEGORIES } from './constants'
import {
  getInventoryDetail,
  getPriceHistory,
  getMonthlyInflow,
  getSameCategoryItems,
  createTrackedItem,
  updateTrackedItem,
  archiveTrackedItem,
  mergeTrackedItems,
  createStockCheck,
  createStockAddition,
  updateStockCheck,
  deleteStockCheck,
  deleteStockAddition,
  updateStockAddition,
  updateExpenseFromInventory,
  excludeExpenseFromInventory,
  seedTrackedItemsFromExpenses,
  confirmReceipt,
  confirmAllPending,
  getStorageLocations,
  createStorageLocation,
  updateStorageLocation,
  deleteStorageLocation,
  setItemLocations,
  batchSetItemLocations,
} from './actions'
import { type StorageLocationItem, type LocationQtyEntry } from './constants'

const CATEGORY_TINT: Record<string, { bg: string; fg: string }> = {
  '부식비':       { bg: 'rgba(232,137,58,0.10)',  fg: '#e8893a' },
  '소모품비':     { bg: 'rgba(244,98,58,0.10)',   fg: 'var(--persimmon)' },
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
  const [showAdd, setShowAdd]             = useState(false)
  const [showLocations, setShowLocations] = useState(false)
  const [detailId, setDetailId]           = useState<string | null>(null)
  const [error, setError]                 = useState('')
  const [selectMode, setSelectMode]       = useState(false)
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [showBatchLoc, setShowBatchLoc]   = useState(false)
  const [showBatchCheck, setShowBatchCheck] = useState(false)

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  const [seedPending, setSeedPending] = useState(false)
  const handleSeed = async () => {
    setSeedPending(true)
    const release = trackSave()
    try {
      const res = await seedTrackedItemsFromExpenses()
      if (!res.ok) { pushToast('error', res.error); alert(res.error); return }
      // refresh 먼저 트리거 (alert가 동기 블로킹이라 그 뒤에 두면 모달 닫을 때까지 페이지가 안 갱신됨)
      router.refresh()
      const parts: string[] = []
      if (res.created > 0) parts.push(`${res.created}개 품목 추가`)
      if (res.migrated > 0) parts.push(`${res.migrated}개 지출 라벨 정리 (사이즈/포장 변형 분리)`)
      if (res.skippedArchived > 0) parts.push(`삭제된 품목과 매칭되는 지출 ${res.skippedArchived}건은 건너뜀`)
      const summary = parts.length > 0 ? parts.join(' · ') : '추가할 품목이 없습니다 (이미 등록됨).'
      pushToast('success', summary)
      // alert는 다음 tick에 — refresh가 먼저 적용되도록
      setTimeout(() => { alert(summary) }, 0)
    } finally {
      setSeedPending(false)
      release()
    }
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
        <div className="flex gap-2 flex-wrap">
          <Btn variant="secondary" size="sm" onClick={() => { selectMode ? exitSelectMode() : setSelectMode(true) }}>
            {selectMode ? `선택 취소${selected.size > 0 ? ` (${selected.size})` : ''}` : '선택'}
          </Btn>
          <Btn variant="secondary" size="sm" onClick={() => setShowBatchCheck(true)}>위치별 점검</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setShowLocations(true)}>위치 관리</Btn>
          <Btn variant="secondary" size="sm" onClick={handleSeed} disabled={seedPending || isPending}>{seedPending ? '처리 중...' : '지출에서 자동 등록'}</Btn>
          <Btn variant="primary" size="sm" onClick={() => setShowAdd(true)}>+ 품목 추가</Btn>
        </div>
      </div>

      {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

      {rows.length === 0 ? (
        <EmptyState
          title="추적할 품목이 아직 없습니다"
          description="'지출에서 자동 등록' 버튼을 누르면 부식·소모품·폐기물 카테고리에서 입력된 품목이 자동 등록됩니다."
        />
      ) : (
        grouped.map(g => g.rows.length > 0 && (
          <section key={g.cat} className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: CATEGORY_TINT[g.cat]?.fg ?? '#999' }} />
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">{g.cat}</h2>
              <span className="text-[11px] text-[var(--warm-muted)]">{g.rows.length}품목</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.rows.map(r => (
                <InventoryCard
                  key={r.id}
                  row={r}
                  selectMode={selectMode}
                  isSelected={selected.has(r.id)}
                  onOpen={() => selectMode ? toggleSelect(r.id) : setDetailId(r.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {showLocations && <LocationSettingsModal onClose={() => { setShowLocations(false); router.refresh() }} />}
      {showBatchCheck && <LocationBatchCheckModal rows={rows} onClose={() => setShowBatchCheck(false)} onDone={() => { setShowBatchCheck(false); router.refresh() }} />}
      {showAdd && <AddItemModal onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); router.refresh() }} />}
      {showBatchLoc && (
        <BatchLocationModal
          selectedIds={Array.from(selected)}
          onClose={() => setShowBatchLoc(false)}
          onDone={() => { setShowBatchLoc(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 배치 액션 바 */}
      {selectMode && selected.size > 0 && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+56px)] md:bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="flex items-center gap-3 bg-[var(--ink)] text-[var(--canvas)] rounded-2xl px-4 py-3 shadow-xl pointer-events-auto mx-4">
            <span className="text-sm font-medium">{selected.size}개 선택됨</span>
            <div className="w-px h-4 bg-[var(--canvas)]/20" />
            <button type="button" onClick={() => setShowBatchLoc(true)}
              className="text-sm font-semibold text-[var(--coral)] hover:text-[var(--coral-dark)] transition-colors">
              위치 일괄 할당
            </button>
          </div>
        </div>
      )}

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

function InventoryCard({ row, onOpen, selectMode, isSelected }: { row: InventoryRow; onOpen: () => void; selectMode?: boolean; isSelected?: boolean }) {
  const tint = CATEGORY_TINT[row.category]
  const lowStock = row.daysUntilEmpty != null && row.daysUntilEmpty <= row.alertThresholdDays
  // trackUnit='qty' (폐기물 봉투 등): 매 단위 그대로. 'spec': specUnit 우선
  const stockUnit = row.trackUnit === 'qty' ? row.qtyUnit : (row.specUnit ?? row.qtyUnit)
  const priceUnit = row.trackUnit === 'qty' ? row.qtyUnit : (row.specUnit ?? row.qtyUnit)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full bg-[var(--cream)] rounded-2xl p-4 space-y-3 text-left transition-colors ${isSelected ? 'border-2 border-[var(--coral)] ring-2 ring-[var(--coral)]/20' : 'border border-[var(--warm-border)] hover:border-[var(--coral)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--warm-dark)] truncate">{row.label}</p>
          <p className="text-[10px] mt-0.5" style={{ color: tint?.fg }}>{row.category}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {lowStock && <Badge tone="danger" mono>소진 임박</Badge>}
          {row.pendingPurchases.length > 0 && (
            <Badge tone="warn" mono>{row.pendingPurchases.length}건 수령대기</Badge>
          )}
        </div>
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
              ? `${Math.round(row.avgUnitPrice).toLocaleString()}원${priceUnit ? `/${priceUnit}` : ''}`
              : '—'}
          </p>
        </div>
      </div>
      {row.memo && (
        <p className="text-[10px] text-[var(--warm-mid)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-2 py-1.5 leading-relaxed whitespace-pre-wrap">
          메모 · {row.memo}
        </p>
      )}
      {row.reorderMemo && (
        <p className="text-[10px] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2 py-1.5 leading-relaxed">
          발주 · {row.reorderMemo}
        </p>
      )}
      {row.locations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.lastCheckLocationBreakdown.length > 0
            ? row.lastCheckLocationBreakdown.map(lb => (
                <span key={lb.locationId} className="text-[10px] bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">
                  {lb.locationName} {fmtQty(lb.qty, stockUnit)}
                </span>
              ))
            : row.locations.map(loc => (
                <span key={loc.id} className="text-[10px] bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">{loc.name}</span>
              ))
          }
        </div>
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
      const release = trackSave()
      try {
        const res = await createTrackedItem({
          category, label,
          specUnit: specUnit || null,
          qtyUnit:  qtyUnit  || null,
          memo:     memo     || null,
        })
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        onDone()
        pushToast('success', '품목 추가됨')
      } finally { release() }
    })
  }

  return (
    <Modal open onClose={onClose} title="추적 품목 추가" width="md">
      <form onSubmit={handleSubmit} id="add-tracked-item-form" className="px-5 sm:px-6 py-4 space-y-3">
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
      </form>
      <div className="border-t border-[var(--warm-border)] px-5 sm:px-6 py-3">
        <ModalFooterActions onCancel={onClose}>
          <Btn type="submit" form="add-tracked-item-form" variant="primary" disabled={pending}>
            {pending ? '저장 중...' : '저장'}
          </Btn>
        </ModalFooterActions>
      </div>
    </Modal>
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
    if (!confirm('이 품목을 삭제하시겠습니까?\n\n· 재고 추적 카드와 점검·무상입수 기록이 사라집니다.\n· 지출 내역(영수증·금액)은 그대로 유지됩니다.')) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await archiveTrackedItem(trackedItemId)
        if (res.ok) { onChange(); onClose(); pushToast('success', '품목 삭제됨') }
        else { setError(res.error); pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const handleDeleteCheck = (id: string) => {
    if (!confirm('이 점검 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteStockCheck(id)
        if (res.ok) { reload(); onChange(); pushToast('success', '점검 기록 삭제됨') }
        else { setError(res.error); pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const handleDeleteAddition = (id: string) => {
    if (!confirm('이 입수 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteStockAddition(id)
        if (res.ok) { reload(); onChange(); pushToast('success', '입수 기록 삭제됨') }
        else { setError(res.error); pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const handleConfirmReceipt = (expenseId: string) => {
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await confirmReceipt(expenseId)
        if (res.ok) { reload(); onChange(); pushToast('success', '수령 확인 완료') }
        else { setError(res.error); pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const detailStockUnit = data ? (data.item.trackUnit === 'qty' ? data.item.qtyUnit : (data.item.specUnit ?? data.item.qtyUnit)) : null
  const isViewMode = mode === 'view' && !!data

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      title={data?.item.label ?? row.label}
      subtitle={data?.item.category ?? row.category}
      footer={isViewMode ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Btn variant="danger" size="sm" onClick={handleArchive} disabled={pending}>삭제</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setMode('settings')}>설정</Btn>
          <div className="flex-1" />
          <Btn variant="secondary" size="sm" onClick={() => setMode('addition')}>+ 무상 입수</Btn>
          <Btn variant="primary" size="sm" onClick={() => setMode('check')}>재고 점검</Btn>
        </div>
      ) : undefined}
    >
      {!data ? (
        <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
      ) : mode === 'check' ? (
        <CheckForm item={data.item} lastCheckBreakdown={row.lastCheckLocationBreakdown} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : mode === 'addition' ? (
        <AdditionForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : mode === 'settings' ? (
        <SettingsForm row={row} onCancel={() => setMode('view')} onDone={() => { setMode('view'); onChange() }} />
      ) : (
        <>
          <div className="flex gap-1 px-5 sm:px-6 pt-3 flex-wrap">
            <TabBtn active={tab === 'timeline'} onClick={() => setTab('timeline')}>타임라인</TabBtn>
            <TabBtn active={tab === 'monthly'}  onClick={() => setTab('monthly')}>월별 입수</TabBtn>
            <TabBtn active={tab === 'price'}    onClick={() => setTab('price')}>단가 추이</TabBtn>
          </div>
          <div className="px-5 sm:px-6 py-3 space-y-3">
            {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
            {tab === 'timeline' && (
              data.timeline.length === 0 ? (
                <p className="text-sm text-[var(--warm-muted)] text-center py-6">기록이 없습니다.</p>
              ) : (
                <ul className="space-y-1.5">
                  {data.timeline.map(e => <TimelineRow key={`${e.type}-${e.id}`} entry={e} stockUnit={detailStockUnit} trackUnit={data.item.trackUnit} itemLocations={data.item.locations} onDeleteCheck={handleDeleteCheck} onDeleteAddition={handleDeleteAddition} onConfirmReceipt={handleConfirmReceipt} onChanged={() => { reload(); onChange() }} pending={pending} />)}
                </ul>
              )
            )}
            {tab === 'monthly' && (
              <MonthlyInflowList rows={monthlyInflow} stockUnit={detailStockUnit} />
            )}
            {tab === 'price' && (
              <PriceChart points={priceHistory} unitLabel={detailStockUnit} qtyUnit={data.item.qtyUnit} />
            )}
          </div>
        </>
      )}
    </Modal>
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
  const [labelEdit, setLabelEdit]         = useState(row.label)
  const [thresholdDays, setThresholdDays] = useState(String(row.alertThresholdDays))
  const [reorderMemo, setReorderMemo]     = useState(row.reorderMemo ?? '')
  const [memo, setMemo]                   = useState(row.memo ?? '')
  const [trackUnit, setTrackUnit]         = useState<'spec' | 'qty'>(row.trackUnit)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const n = parseInt(thresholdDays, 10)
    if (isNaN(n) || n < 0) { setError('알림 기준은 0 이상이어야 합니다.'); return }
    if (!labelEdit.trim()) { setError('품목명은 필수입니다.'); return }
    startTransition(async () => {
      const res = await updateTrackedItem(row.id, {
        label: labelEdit.trim(),
        alertThresholdDays: n,
        reorderMemo: reorderMemo.trim() || null,
        memo: memo.trim() || null,
        trackUnit,
      })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">품목명 *</label>
        <input type="text" value={labelEdit} onChange={e => setLabelEdit(e.target.value)}
          placeholder="예: 키친타월 (롤타입)"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[10px] text-[var(--warm-muted)] leading-relaxed">
          이 라벨을 바꾸면 같은 (카테고리·기존 라벨·{row.qtyUnit ?? '단위'}) 매칭되는 지출 내역의 품목명도 자동 갱신됩니다.
          예) '키친타월' → '키친타월 (롤타입)' / '음식물쓰레기봉투' → '음식물쓰레기봉투 5L'
        </p>
      </div>
      <p className="text-xs text-[var(--warm-muted)]">소진 예상일이 알림 기준 이하가 되면 대시보드에 '재고 부족' 알림이 표시됩니다.</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">알림 기준 (D-N)</label>
        <input type="text" inputMode="numeric" value={thresholdDays}
          onChange={e => setThresholdDays(e.target.value.replace(/[^0-9]/g, ''))}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[10px] text-[var(--warm-muted)]">예: 3 → 소진 예상이 3일 이하면 알림</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">재고 추적 단위</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTrackUnit('spec')}
            className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${trackUnit === 'spec' ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
            규격 단위{row.specUnit ? ` (${row.specUnit})` : ''}
          </button>
          <button type="button" onClick={() => setTrackUnit('qty')}
            className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${trackUnit === 'qty' ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
            수량 단위{row.qtyUnit ? ` (${row.qtyUnit})` : ''}
          </button>
        </div>
        <p className="text-[10px] text-[var(--warm-muted)] leading-relaxed">
          규격 단위: 쌀 1포대(20kg) 같이 규격으로 환산해서 추적 (kg, 매, ml).<br/>
          수량 단위: 종량제봉투 50L짜리 30매처럼 매(개) 단위로만 추적 (사이즈는 라벨에 적기).
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">재고 파악 기준 메모</label>
        <textarea value={memo} onChange={e => setMemo(e.target.value)}
          rows={3}
          placeholder="예: 창고에 온전히 남아있는 양만 잔량으로 카운트. 주방 쌀통은 제외"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
        <p className="text-[10px] text-[var(--warm-muted)]">잔량 점검 시 무엇을 세는지·어디 보관분만 카운트하는지 등 기준을 적어두면 일관성 유지에 도움됩니다.</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">발주 메모</label>
        <textarea value={reorderMemo} onChange={e => setReorderMemo(e.target.value)}
          rows={3}
          placeholder="예: 쿠팡 / 100매 박스 단위 / 영업장 카드 결제"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
      </div>
      {/* 위치 할당 섹션 */}
      <LocationAssignSection trackedItemId={row.id} initialLocations={row.locations} />
      {/* 병합 섹션 — 같은 카테고리 다른 카드로 통합 */}
      <MergeSection currentId={row.id} currentLabel={row.label} category={row.category} onDone={onDone} />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}

function MergeSection({ currentId, currentLabel, category, onDone }: {
  currentId: string; currentLabel: string; category: string; onDone: () => void
}) {
  const [siblings, setSiblings] = useState<{ id: string; label: string }[]>([])
  const [targetId, setTargetId] = useState('')
  const [reversed, setReversed] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => { getSameCategoryItems(currentId).then(setSiblings) }, [currentId])
  if (siblings.length === 0) return null

  const target = siblings.find(s => s.id === targetId)
  const srcLabel  = reversed ? target?.label : currentLabel
  const destLabel = reversed ? currentLabel   : target?.label
  const srcId     = reversed ? targetId       : currentId
  const destId    = reversed ? currentId      : targetId

  const handleMerge = async () => {
    setPending(true)
    const res = await mergeTrackedItems(srcId, destId, true)
    setPending(false)
    if (!res.ok) { alert(res.error); return }
    setShowConfirm(false)
    pushToast('success', `병합 완료 — 지출 ${res.movedExpenses}건, 점검 ${res.movedChecks}건, 무상입수 ${res.movedAdditions}건`)
    onDone()
  }

  return (
    <div className="space-y-1.5 pt-2 border-t border-[var(--warm-border)]/60">
      <label className="text-xs font-medium text-[var(--warm-mid)]">다른 카드와 병합</label>
      <div className="flex gap-2">
        <select value={targetId} onChange={e => { setTargetId(e.target.value); setReversed(false) }}
          className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none">
          <option value="">병합 대상 선택…</option>
          {siblings.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
        </select>
        <Btn type="button" variant="danger" size="md" onClick={() => setShowConfirm(true)} disabled={!target || pending}>
          병합
        </Btn>
      </div>
      <p className="text-[10px] text-[var(--warm-muted)] leading-relaxed">
        예: 라면처럼 봉지·박스가 섞여도 한 카드로 합쳐 추적하고 싶을 때. 사이즈가 의미 있는 폐기물 봉투는 분리 유지 권장.
      </p>

      {/* 병합 방향 확인 모달 */}
      {showConfirm && target && (
        <div className="fixed inset-0 bg-black/60 z-[200] flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-lift" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-[var(--warm-dark)]">병합 방향 확인</h3>

            {/* 방향 표시 + 스왑 버튼 */}
            <div className="flex items-center gap-2">
              <div className="flex-1 text-center">
                <p className="text-[10px] text-[var(--warm-muted)] mb-0.5">삭제될 카드</p>
                <p className="text-sm font-semibold text-[var(--warm-dark)] truncate">{srcLabel}</p>
              </div>
              <button type="button" onClick={() => setReversed(r => !r)}
                className="shrink-0 w-8 h-8 rounded-full border border-[var(--warm-border)] flex items-center justify-center text-[var(--warm-mid)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors text-base">
                ⇄
              </button>
              <div className="flex-1 text-center">
                <p className="text-[10px] text-[var(--warm-muted)] mb-0.5">기록이 합쳐질 카드</p>
                <p className="text-sm font-semibold text-[var(--coral)] truncate">{destLabel}</p>
              </div>
            </div>

            <ul className="text-[11px] text-[var(--warm-muted)] space-y-1 leading-relaxed">
              <li>· <strong className="text-[var(--warm-dark)]">{srcLabel}</strong>의 지출·점검·무상입수 기록이 모두 <strong className="text-[var(--warm-dark)]">{destLabel}</strong>로 이전됩니다.</li>
              <li>· <strong className="text-[var(--warm-dark)]">{srcLabel}</strong> 카드는 삭제됩니다.</li>
              <li>· 대상 카드의 수량 단위 필터는 해제(다양한 포장 합산)됩니다.</li>
            </ul>

            <div className="flex gap-2 pt-1">
              <Btn type="button" variant="secondary" fullWidth onClick={() => setShowConfirm(false)}>취소</Btn>
              <Btn type="button" variant="danger" fullWidth onClick={handleMerge} disabled={pending}>
                {pending ? '병합 중...' : '확인'}
              </Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TimelineRow({ entry, stockUnit, trackUnit, itemLocations, onDeleteCheck, onDeleteAddition, onConfirmReceipt, onChanged, pending }: {
  entry: TimelineEntry; stockUnit: string | null; trackUnit: 'spec' | 'qty'
  itemLocations: StorageLocationItem[]
  onDeleteCheck: (id: string) => void
  onDeleteAddition: (id: string) => void
  onConfirmReceipt?: (id: string) => void
  onChanged: () => void
  pending: boolean
}) {
  const [editing, setEditing] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [editError, setEditError] = useState('')

  // ── 점검
  if (entry.type === 'check') {
    if (editing) {
      return <CheckEditForm
        entry={entry} stockUnit={stockUnit} itemLocations={itemLocations}
        onCancel={() => { setEditing(false); setEditError('') }}
        onSave={async (data) => {
          setSavePending(true); setEditError('')
          const res = await updateStockCheck(entry.id, data)
          setSavePending(false)
          if (!res.ok) { setEditError(res.error); return }
          setEditing(false); onChanged()
        }}
        pending={savePending}
        error={editError}
      />
    }
    return (
      <li className="flex items-center justify-between gap-2 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--coral)] shrink-0" />
          <div className="min-w-0">
            <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 점검</p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">잔량 {fmtQty(entry.remainingQty, stockUnit)}</p>
            {entry.locationBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {entry.locationBreakdown.map(lb => (
                  <span key={lb.locationId} className="text-[10px] bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">
                    {lb.locationName} {fmtQty(lb.qty, stockUnit)}
                  </span>
                ))}
              </div>
            )}
            {entry.memo && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" disabled={pending} onClick={() => setEditing(true)}
            className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--cream)]">수정</button>
          <button type="button" disabled={pending} onClick={() => onDeleteCheck(entry.id)}
            className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-red-50">삭제</button>
        </div>
      </li>
    )
  }

  // ── 구매 (Expense)
  if (entry.type === 'purchase') {
    const isPendingReceipt = entry.receivedAt === null
    const hasSpec = entry.specValue != null && entry.specValue > 0 && entry.specUnit
    const useSpec = trackUnit !== 'qty' && hasSpec
    const baseQty = useSpec ? entry.qtyValue * (entry.specValue ?? 0) : entry.qtyValue
    const baseUnit = useSpec ? entry.specUnit : entry.qtyUnit
    const packLabel = hasSpec ? `${entry.specValue}${entry.specUnit} × ${fmtQty(entry.qtyValue, entry.qtyUnit)}` : null

    if (editing) {
      return <PurchaseEditForm
        entry={entry} stockUnit={stockUnit}
        onCancel={() => { setEditing(false); setEditError('') }}
        onSave={async (data) => {
          setSavePending(true); setEditError('')
          const res = await updateExpenseFromInventory(entry.id, data)
          setSavePending(false)
          if (!res.ok) { setEditError(res.error); return }
          setEditing(false); onChanged()
        }}
        onDelete={async () => {
          if (!confirm('이 구매를 재고에서 제외하시겠습니까?\n지출 페이지에는 그대로 남습니다.')) return
          setSavePending(true)
          const res = await excludeExpenseFromInventory(entry.id)
          setSavePending(false)
          if (!res.ok) { setEditError(res.error); return }
          onChanged()
        }}
        pending={savePending}
        error={editError}
      />
    }

    return (
      <li className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 ${isPendingReceipt ? 'border border-[var(--honey)]/40 bg-[var(--honey)]/10' : 'border border-[var(--warm-border)]/60'}`}>
        <div className="min-w-0 flex items-center gap-2">
          <span className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 ${isPendingReceipt ? 'bg-[var(--honey)]' : 'bg-[var(--status-paid-strong)]'}`} />
          <div className="min-w-0">
            <p className="text-xs text-[var(--warm-muted)]">
              {fmtDate(entry.date)} · {isPendingReceipt ? '구매 (수령 대기)' : '구매 (지출)'}{packLabel ? ` · ${packLabel}` : ''}
            </p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(baseQty, baseUnit)}{entry.amount > 0 ? ` (${entry.amount.toLocaleString()}원)` : ''}</p>
            {(entry.vendor || entry.memo) && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.vendor ?? ''}{entry.vendor && entry.memo ? ' · ' : ''}{entry.memo ?? ''}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {isPendingReceipt && onConfirmReceipt && (
            <button type="button" disabled={pending}
              onClick={() => onConfirmReceipt(entry.id)}
              className="text-xs font-semibold text-[var(--status-paid-fg)] hover:text-[var(--status-paid-strong)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--status-paid-bg)] whitespace-nowrap">
              수령 확인
            </button>
          )}
          <button type="button" disabled={pending} onClick={() => setEditing(true)}
            className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--cream)]">수정</button>
        </div>
      </li>
    )
  }

  // ── 무상 입수 (StockAddition)
  if (editing) {
    return <AdditionEditForm
      entry={entry} stockUnit={stockUnit}
      onCancel={() => { setEditing(false); setEditError('') }}
      onSave={async (data) => {
        setSavePending(true); setEditError('')
        const res = await updateStockAddition(entry.id, data)
        setSavePending(false)
        if (!res.ok) { setEditError(res.error); return }
        setEditing(false); onChanged()
      }}
      onDelete={async () => {
        setSavePending(true)
        const res = await deleteStockAddition(entry.id)
        setSavePending(false)
        if (!res.ok) { setEditError(res.error); return }
        onChanged()
      }}
      pending={savePending}
      error={editError}
    />
  }

  return (
    <li className="flex items-center justify-between gap-2 border border-[var(--warm-border)]/60 rounded-xl px-3 py-2">
      <div className="min-w-0 flex items-center gap-2">
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--honey)] shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 무상 입수{entry.source ? ` (${entry.source})` : ''}</p>
          <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(entry.addedQty, stockUnit)}</p>
          {entry.memo && <p className="text-[10px] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
        </div>
      </div>
      <div className="flex items-center gap-1 shrink-0">
        <button type="button" disabled={pending} onClick={() => setEditing(true)}
          className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--cream)]">수정</button>
        <button type="button" disabled={pending} onClick={() => onDeleteAddition(entry.id)}
          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-red-50">삭제</button>
      </div>
    </li>
  )
}

// ── 재고 점검 인라인 편집 폼
function CheckEditForm({ entry, stockUnit, itemLocations, onCancel, onSave, pending, error }: {
  entry: TimelineEntry & { type: 'check' }
  stockUnit: string | null
  itemLocations: StorageLocationItem[]
  onCancel: () => void
  onSave: (data: { date?: string; memo?: string | null; remainingQty?: number; locationQtys?: { storageLocationId: string; qty: number }[] }) => Promise<void>
  pending: boolean
  error: string
}) {
  const [date, setDate] = useState(entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10))
  const [memo, setMemo] = useState(entry.memo ?? '')

  // 기존 점검에 위치별 기록이 있으면 그걸 사용, 없으면 아이템의 locations 목록으로 대체
  const locationSources: { id: string; name: string }[] =
    entry.locationBreakdown.length > 0
      ? entry.locationBreakdown.map(lb => ({ id: lb.locationId, name: lb.locationName }))
      : itemLocations.map(l => ({ id: l.id, name: l.name }))

  const hasLocations = locationSources.length > 0

  const [qty, setQty] = useState(hasLocations ? '' : String(entry.remainingQty))
  const [locationQtys, setLocationQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(
      entry.locationBreakdown.length > 0
        ? entry.locationBreakdown.map(lb => [lb.locationId, String(lb.qty)])
        : itemLocations.map(l => [l.id, ''])
    )
  )

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  const locationTotal = hasLocations
    ? locationSources.reduce((s, l) => s + (Number(locationQtys[l.id]) || 0), 0)
    : null

  const handleSave = () => {
    if (hasLocations) {
      onSave({
        date,
        memo: memo || null,
        locationQtys: locationSources.map(l => ({
          storageLocationId: l.id,
          qty: Number(locationQtys[l.id]) || 0,
        })),
      })
    } else {
      onSave({ date, memo: memo || null, remainingQty: Number(qty) })
    }
  }

  return (
    <li className="border border-[var(--coral)]/30 rounded-xl px-3 py-3 space-y-2 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">재고 점검 수정</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        {!hasLocations && (
          <div>
            <p className="text-[10px] text-[var(--warm-muted)] mb-1">잔량{stockUnit ? ` (${stockUnit})` : ''}</p>
            <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} />
          </div>
        )}
      </div>
      {hasLocations && (
        <div className="space-y-1.5">
          <p className="text-[10px] text-[var(--warm-muted)]">위치별 잔량{stockUnit ? ` (${stockUnit})` : ''} · 합계 {locationTotal ?? 0}{stockUnit ?? ''}</p>
          {locationSources.map(l => (
            <div key={l.id} className="flex items-center gap-2">
              <span className="text-xs text-[var(--warm-mid)] w-20 shrink-0 truncate">{l.name}</span>
              <input type="number" min="0" step="any"
                value={locationQtys[l.id] ?? ''}
                onChange={e => setLocationQtys(prev => ({ ...prev, [l.id]: e.target.value }))}
                className={inputCls} />
            </div>
          ))}
        </div>
      )}
      <div>
        <p className="text-[10px] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1 justify-end">
        <button type="button" onClick={onCancel} disabled={pending}
          className="text-xs text-[var(--warm-muted)] px-3 py-1.5 rounded-lg hover:bg-[var(--cream)]">취소</button>
        <Btn variant="primary" size="sm" disabled={pending || (!hasLocations && (!qty || Number(qty) < 0))}
          onClick={handleSave}>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </li>
  )
}

// ── 무상 입수 인라인 편집 폼
function AdditionEditForm({ entry, stockUnit, onCancel, onSave, onDelete, pending, error }: {
  entry: TimelineEntry & { type: 'addition' }
  stockUnit: string | null
  onCancel: () => void
  onSave: (data: { date?: string; addedQty?: number; source?: string | null; memo?: string | null }) => Promise<void>
  onDelete: () => Promise<void>
  pending: boolean
  error: string
}) {
  const [date, setDate] = useState(entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10))
  const [qty, setQty]   = useState(String(entry.addedQty))
  const [source, setSource] = useState(entry.source ?? '')
  const [memo, setMemo]     = useState(entry.memo ?? '')

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <li className="border border-[var(--warm-border)] rounded-xl px-3 py-3 space-y-2 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">무상 입수 수정</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)] mb-1">수량{stockUnit ? ` (${stockUnit})` : ''}</p>
          <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-[10px] text-[var(--warm-muted)] mb-1">출처</p>
        <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="예: 샘플, 증정" className={inputCls} />
      </div>
      <div>
        <p className="text-[10px] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDelete} disabled={pending}
          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-red-50">삭제</button>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} disabled={pending}
          className="text-xs text-[var(--warm-muted)] px-3 py-1.5 rounded-lg hover:bg-[var(--cream)]">취소</button>
        <Btn variant="primary" size="sm" disabled={pending || !qty || Number(qty) <= 0}
          onClick={() => onSave({ date, addedQty: Number(qty), source: source || null, memo: memo || null })}>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </li>
  )
}

// ── 구매 인라인 편집 폼
function PurchaseEditForm({ entry, stockUnit, onCancel, onSave, onDelete, pending, error }: {
  entry: TimelineEntry & { type: 'purchase' }
  stockUnit: string | null
  onCancel: () => void
  onSave: (data: { date?: string; amount?: number; vendor?: string | null; memo?: string | null }) => Promise<void>
  onDelete: () => Promise<void>
  pending: boolean
  error: string
}) {
  const [date, setDate]     = useState(entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10))
  const [amount, setAmount] = useState(entry.amount > 0 ? String(entry.amount) : '')
  const [vendor, setVendor] = useState(entry.vendor ?? '')
  const [memo, setMemo]     = useState(entry.memo ?? '')

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <li className="border border-[var(--warm-border)] rounded-xl px-3 py-3 space-y-2 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">구매 수정 <span className="text-[10px] font-normal text-[var(--warm-muted)]">— 수정 내용은 지출 페이지에도 반영됩니다</span></p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[10px] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <p className="text-[10px] text-[var(--warm-muted)] mb-1">금액 (원)</p>
          <input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-[10px] text-[var(--warm-muted)] mb-1">구매처</p>
        <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="예: 고구마켓" className={inputCls} />
      </div>
      <div>
        <p className="text-[10px] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDelete} disabled={pending}
          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-red-50">재고에서 제외</button>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} disabled={pending}
          className="text-xs text-[var(--warm-muted)] px-3 py-1.5 rounded-lg hover:bg-[var(--cream)]">취소</button>
        <Btn variant="primary" size="sm" disabled={pending}
          onClick={() => onSave({ date, amount: amount ? Number(amount) : undefined, vendor: vendor || null, memo: memo || null })}>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </li>
  )
}

function CheckForm({ item, lastCheckBreakdown, onCancel, onDone }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  lastCheckBreakdown: LocationQtyEntry[]
  onCancel: () => void; onDone: () => void
}) {
  const stockUnit = item.trackUnit === 'qty' ? item.qtyUnit : (item.specUnit ?? item.qtyUnit)
  const hasLocations = item.locations.length > 0
  const [date, setDate] = useState(kstYmdStr())

  // 이전 점검의 위치별 수량 맵
  const prevMap = Object.fromEntries(lastCheckBreakdown.map(lb => [lb.locationId, lb.qty]))
  const hasPrev = lastCheckBreakdown.length > 0

  // 위치별 잔량: 이전 수량으로 미리 채움
  const [locationQtys, setLocationQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(item.locations.map(l => [l.id, prevMap[l.id] != null ? String(prevMap[l.id]) : '']))
  )
  // 사용자가 직접 수정한 위치 추적
  const [touched, setTouched] = useState<Set<string>>(new Set())

  const [qty, setQty]   = useState('')
  const [memo, setMemo] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleLocChange = (id: string, val: string) => {
    setLocationQtys(prev => ({ ...prev, [id]: val.replace(/[^0-9.]/g, '') }))
    setTouched(prev => new Set([...prev, id]))
  }
  const confirmAll = () => setTouched(new Set(item.locations.map(l => l.id)))

  const locationTotal = hasLocations
    ? item.locations.reduce((s, l) => s + (Number(locationQtys[l.id]) || 0), 0)
    : null

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    let remainingQty: number
    let locationData: { storageLocationId: string; qty: number }[] | undefined

    if (hasLocations) {
      remainingQty = locationTotal ?? 0
      if (remainingQty < 0) { setError('잔량은 0 이상이어야 합니다.'); return }
      locationData = item.locations
        .map(l => ({ storageLocationId: l.id, qty: Number(locationQtys[l.id]) || 0 }))
        .filter(lq => lq.qty > 0)
    } else {
      const n = Number(qty)
      if (isNaN(n) || n < 0) { setError('잔량은 0 이상이어야 합니다.'); return }
      remainingQty = n
    }

    startTransition(async () => {
      const res = await createStockCheck({
        trackedItemId: item.id, date, remainingQty, memo: memo || undefined,
        locationQtys: locationData,
      })
      if (!res.ok) { setError(res.error); return }
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">점검한 시점에 남아있는 양을 {stockUnit ?? '단위'} 기준으로 기록합니다. 직전 점검과의 차이로 그 기간의 소모량이 계산됩니다.</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">점검일 *</label>
        <DatePicker value={date} onChange={setDate}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
      </div>

      {hasLocations ? (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--warm-mid)]">위치별 잔량{stockUnit ? ` (${stockUnit})` : ''}</label>
            {hasPrev && touched.size < item.locations.length && (
              <button type="button" onClick={confirmAll}
                className="text-[10px] text-[var(--coral)] hover:underline">
                모두 이전 수량으로 확인
              </button>
            )}
          </div>
          {item.locations.map(loc => {
            const isTouched = touched.has(loc.id)
            const isPrefilled = !isTouched && prevMap[loc.id] != null
            return (
              <div key={loc.id} className="flex items-center gap-2">
                <span className="text-xs text-[var(--warm-mid)] w-24 shrink-0 truncate">{loc.name}</span>
                <div className="flex-1 relative">
                  <input
                    type="text" inputMode="decimal"
                    value={locationQtys[loc.id] ?? ''}
                    onChange={e => handleLocChange(loc.id, e.target.value)}
                    placeholder="0"
                    className={`w-full bg-[var(--canvas)] border rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--coral)] transition-colors ${
                      isPrefilled
                        ? 'border-[var(--warm-border)]/50 text-[var(--ink-mute)]'
                        : 'border-[var(--warm-border)] text-[var(--warm-dark)]'
                    }`} />
                  {isPrefilled && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[9px] text-[var(--ink-mute)] bg-[var(--canvas)] pl-1">이전</span>
                  )}
                </div>
              </div>
            )
          })}
          {locationTotal !== null && (
            <p className="text-[10px] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
              → 합계 <strong>{Math.round(locationTotal * 100) / 100}{stockUnit ?? ''}</strong>
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">잔량 *{stockUnit ? ` (${stockUnit})` : ''}</label>
          <input type="text" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}

// ── 위치별 일괄 점검 모달
function LocationBatchCheckModal({ rows, onClose, onDone }: {
  rows: InventoryRow[]; onClose: () => void; onDone: () => void
}) {
  const [locs, setLocs] = useState<StorageLocationItem[]>([])
  const [locId, setLocId] = useState('')
  const [date, setDate] = useState(kstYmdStr())
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => { getStorageLocations().then(setLocs) }, [])

  // 선택 위치에 보관되는 품목 필터
  const locItems = locId
    ? rows.filter(r => !r.isArchived && r.locations.some(l => l.id === locId))
    : []

  // 위치별 잔량 입력 상태: itemId → qty string
  const [qtys, setQtys] = useState<Record<string, string>>({})
  const [touched, setTouched] = useState<Set<string>>(new Set())

  // 위치 변경 시 이전 수량 pre-fill
  useEffect(() => {
    if (!locId) return
    const init: Record<string, string> = {}
    rows.filter(r => !r.isArchived && r.locations.some(l => l.id === locId)).forEach(r => {
      const prev = r.lastCheckLocationBreakdown.find(lb => lb.locationId === locId)
      init[r.id] = prev != null ? String(prev.qty) : ''
    })
    setQtys(init)
    setTouched(new Set())
  }, [locId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleChange = (itemId: string, val: string) => {
    setQtys(prev => ({ ...prev, [itemId]: val.replace(/[^0-9.]/g, '') }))
    setTouched(prev => new Set([...prev, itemId]))
  }
  const confirmAll = () => setTouched(new Set(locItems.map(r => r.id)))

  const handleSave = async () => {
    // 입력값이 있는 품목만 저장
    const toSave = locItems.filter(r => qtys[r.id] !== '' && qtys[r.id] != null)
    if (toSave.length === 0) { setError('저장할 수량이 없습니다.'); return }
    setPending(true); setError('')
    try {
      await Promise.all(toSave.map(r => {
        const thisLocQty = Number(qtys[r.id]) || 0
        // 다른 위치는 이전 점검 수량 carry-over
        const otherLocs = r.lastCheckLocationBreakdown
          .filter(lb => lb.locationId !== locId)
          .map(lb => ({ storageLocationId: lb.locationId, qty: lb.qty }))
        const locationQtys = [{ storageLocationId: locId, qty: thisLocQty }, ...otherLocs]
        const remainingQty = locationQtys.reduce((s, l) => s + l.qty, 0)
        const stockUnit = r.trackUnit === 'qty' ? r.qtyUnit : (r.specUnit ?? r.qtyUnit)
        return createStockCheck({
          trackedItemId: r.id, date, remainingQty,
          locationQtys: locationQtys.filter(l => l.qty > 0),
          memo: `위치별 점검 (${locs.find(l => l.id === locId)?.name ?? ''})${stockUnit ? '' : ''}`,
        })
      }))
      onDone()
    } catch {
      setError('저장 중 오류가 발생했습니다.')
    } finally {
      setPending(false)
    }
  }

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <div className="fixed inset-0 bg-black/60 z-[100] flex items-end sm:items-center justify-center" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-t-2xl sm:rounded-2xl w-full max-w-md flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[var(--warm-dark)]">위치별 점검</h2>
            <p className="text-[11px] text-[var(--warm-muted)] mt-0.5">한 위치에서 여러 품목을 한 번에 기록합니다</p>
          </div>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl w-8 h-8 flex items-center justify-center">✕</button>
        </div>

        <div className="px-5 py-3 border-b border-[var(--warm-border)] shrink-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[10px] text-[var(--warm-muted)] mb-1">점검 위치</p>
              <select value={locId} onChange={e => setLocId(e.target.value)}
                className={inputCls}>
                <option value="">위치 선택…</option>
                {locs.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[10px] text-[var(--warm-muted)] mb-1">점검일</p>
              <DatePicker value={date} onChange={setDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-2">
          {!locId ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">위치를 선택하면 해당 위치에 보관된 품목이 표시됩니다.</p>
          ) : locItems.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">이 위치에 배정된 품목이 없습니다.</p>
          ) : (
            <>
              {locItems.some(r => r.lastCheckLocationBreakdown.some(lb => lb.locationId === locId)) && touched.size < locItems.length && (
                <div className="flex justify-end">
                  <button type="button" onClick={confirmAll}
                    className="text-[10px] text-[var(--coral)] hover:underline">모두 이전 수량으로 확인</button>
                </div>
              )}
              {locItems.map(r => {
                const stockUnit = r.trackUnit === 'qty' ? r.qtyUnit : (r.specUnit ?? r.qtyUnit)
                const prev = r.lastCheckLocationBreakdown.find(lb => lb.locationId === locId)
                const isTouched = touched.has(r.id)
                const isPrefilled = !isTouched && prev != null
                return (
                  <div key={r.id} className="flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-[var(--warm-dark)] truncate">{r.label}</p>
                      <p className="text-[10px] text-[var(--warm-muted)]">{r.category}</p>
                    </div>
                    <div className="relative w-28 shrink-0">
                      <input
                        type="text" inputMode="decimal"
                        value={qtys[r.id] ?? ''}
                        onChange={e => handleChange(r.id, e.target.value)}
                        placeholder="0"
                        className={`w-full bg-[var(--canvas)] border rounded-xl px-3 py-2 text-sm outline-none focus:border-[var(--coral)] transition-colors ${
                          isPrefilled ? 'border-[var(--warm-border)]/50 text-[var(--ink-mute)]' : 'border-[var(--warm-border)] text-[var(--warm-dark)]'
                        }`} />
                      {isPrefilled && (
                        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] text-[var(--ink-mute)] bg-[var(--canvas)] pl-0.5">이전</span>
                      )}
                    </div>
                    <span className="text-[10px] text-[var(--warm-muted)] w-8 shrink-0">{stockUnit ?? ''}</span>
                  </div>
                )
              })}
            </>
          )}
          {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        <div className="border-t border-[var(--warm-border)] px-5 py-3 flex gap-2 shrink-0">
          <Btn variant="secondary" fullWidth onClick={onClose}>취소</Btn>
          <Btn variant="primary" fullWidth onClick={handleSave} disabled={pending || !locId || locItems.length === 0}>
            {pending ? '저장 중...' : `${locItems.filter(r => (qtys[r.id] ?? '') !== '').length}품목 저장`}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── 위치 관리 모달 — property-level CRUD
function LocationSettingsModal({ onClose }: { onClose: () => void }) {
  const [locs, setLocs]     = useState<StorageLocationItem[]>([])
  const [newName, setNewName] = useState('')
  const [editId, setEditId]   = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [pending, setPending]   = useState(false)
  const [error, setError]       = useState('')

  const reload = () => getStorageLocations().then(setLocs)
  useEffect(() => { reload() }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newName.trim()) return
    setPending(true); setError('')
    const res = await createStorageLocation(newName)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    setNewName(''); reload()
  }

  const handleUpdate = async (id: string) => {
    if (!editName.trim()) return
    setPending(true); setError('')
    const res = await updateStorageLocation(id, editName)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    setEditId(null); reload()
  }

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`'${name}' 위치를 삭제하시겠습니까?\n이 위치가 할당된 품목에서도 자동으로 제거됩니다.`)) return
    setPending(true)
    const res = await deleteStorageLocation(id)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    reload()
  }

  return (
    <Modal open onClose={onClose} title="보관 위치 관리" subtitle="창고 / 4층 주방 / 손님실 등 보관 장소를 등록하세요" width="sm">
      <div className="px-5 sm:px-6 py-4 space-y-4">
        {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
        {locs.length === 0 && !pending && (
          <p className="text-sm text-[var(--warm-muted)] text-center py-4">등록된 위치가 없습니다.</p>
        )}
        <ul className="space-y-1.5">
          {locs.map(loc => (
            <li key={loc.id} className="flex items-center gap-2 bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-xl px-3 py-2">
              {editId === loc.id ? (
                <>
                  <input
                    autoFocus
                    type="text" value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleUpdate(loc.id); if (e.key === 'Escape') setEditId(null) }}
                    className="flex-1 bg-transparent text-sm text-[var(--warm-dark)] outline-none border-b border-[var(--coral)]" />
                  <button type="button" onClick={() => handleUpdate(loc.id)} disabled={pending}
                    className="text-xs font-semibold text-[var(--coral)] disabled:opacity-40 px-2 py-1">저장</button>
                  <button type="button" onClick={() => setEditId(null)}
                    className="text-xs text-[var(--warm-muted)] px-2 py-1">취소</button>
                </>
              ) : (
                <>
                  <span className="flex-1 text-sm text-[var(--warm-dark)]">{loc.name}</span>
                  <button type="button" onClick={() => { setEditId(loc.id); setEditName(loc.name) }}
                    className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--cream)]">수정</button>
                  <button type="button" onClick={() => handleDelete(loc.id, loc.name)} disabled={pending}
                    className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-red-50">삭제</button>
                </>
              )}
            </li>
          ))}
        </ul>
        <form onSubmit={handleAdd} className="flex gap-2">
          <input
            type="text" value={newName} onChange={e => setNewName(e.target.value)}
            placeholder="새 위치 이름 (예: 창고)"
            className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          <Btn type="submit" variant="primary" size="sm" disabled={pending || !newName.trim()}>추가</Btn>
        </form>
      </div>
      <div className="border-t border-[var(--warm-border)] px-5 sm:px-6 py-3">
        <ModalFooterActions onCancel={onClose}>
          <Btn variant="primary" onClick={onClose}>완료</Btn>
        </ModalFooterActions>
      </div>
    </Modal>
  )
}

// ── 위치 일괄 할당 모달
function BatchLocationModal({ selectedIds, onClose, onDone }: {
  selectedIds: string[]; onClose: () => void; onDone: () => void
}) {
  const [allLocs, setAllLocs]   = useState<StorageLocationItem[]>([])
  const [chosen, setChosen]     = useState<Set<string>>(new Set())
  const [pending, setPending]   = useState(false)
  const [error, setError]       = useState('')

  useEffect(() => { getStorageLocations().then(setAllLocs) }, [])

  const toggle = (id: string) => setChosen(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })

  const handleApply = async () => {
    setPending(true); setError('')
    const res = await batchSetItemLocations(selectedIds, Array.from(chosen))
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    pushToast('success', `${res.count}개 품목에 위치 할당 완료`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="위치 일괄 할당" subtitle={`${selectedIds.length}개 품목에 동일 위치를 적용합니다`} width="sm">
      <div className="px-5 sm:px-6 py-4 space-y-3">
        {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
        {allLocs.length === 0 ? (
          <p className="text-sm text-[var(--warm-muted)] text-center py-4">등록된 위치가 없습니다. 먼저 "위치 관리"에서 추가하세요.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--warm-muted)]">선택된 위치로 교체합니다. 기존 위치는 모두 제거됩니다.</p>
            <div className="flex flex-wrap gap-2">
              {allLocs.map(loc => (
                <button key={loc.id} type="button" onClick={() => toggle(loc.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${chosen.has(loc.id)
                    ? 'bg-[var(--coral)] text-white border-[var(--coral)]'
                    : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)] hover:border-[var(--coral)]'}`}>
                  {loc.name}
                </button>
              ))}
            </div>
          </>
        )}
      </div>
      <div className="border-t border-[var(--warm-border)] px-5 sm:px-6 py-3">
        <ModalFooterActions onCancel={onClose}>
          <Btn variant="primary" onClick={handleApply} disabled={pending || allLocs.length === 0}>
            {pending ? '적용 중...' : '적용'}
          </Btn>
        </ModalFooterActions>
      </div>
    </Modal>
  )
}

// ── 품목별 위치 할당 (SettingsForm 내 서브 섹션)
function LocationAssignSection({ trackedItemId, initialLocations }: {
  trackedItemId: string; initialLocations: StorageLocationItem[]
}) {
  const [allLocs, setAllLocs]     = useState<StorageLocationItem[]>([])
  const [selected, setSelected]   = useState<Set<string>>(new Set(initialLocations.map(l => l.id)))
  const [pending, setPending]     = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => { getStorageLocations().then(setAllLocs) }, [])

  if (allLocs.length === 0) return null

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    setSaved(false)
  }

  const handleSave = async () => {
    setPending(true); setError(''); setSaved(false)
    const res = await setItemLocations(trackedItemId, Array.from(selected))
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    setSaved(true)
  }

  return (
    <div className="space-y-2 pt-2 border-t border-[var(--warm-border)]/60">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--warm-mid)]">보관 위치</label>
        {saved && <span className="text-[10px] text-emerald-600">저장됨</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {allLocs.map(loc => (
          <button
            key={loc.id}
            type="button"
            onClick={() => toggle(loc.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selected.has(loc.id)
              ? 'bg-[var(--coral)] text-white border-[var(--coral)]'
              : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)] hover:border-[var(--coral)]'}`}>
            {loc.name}
          </button>
        ))}
      </div>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <Btn type="button" variant="secondary" size="sm" onClick={handleSave} disabled={pending}>
        {pending ? '저장 중...' : '위치 저장'}
      </Btn>
      <p className="text-[10px] text-[var(--warm-muted)]">재고 점검 시 선택된 위치별로 잔량을 나눠서 입력할 수 있습니다.</p>
    </div>
  )
}

function AdditionForm({ item, onCancel, onDone }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; trackUnit: 'spec' | 'qty' }
  onCancel: () => void; onDone: () => void
}) {
  // trackUnit='qty': specUnit 있어도 매(qtyUnit) 단위로 단일 입력
  // trackUnit='spec' & specUnit 있음: 규격 × 수량 두 입력
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
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
        <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}
