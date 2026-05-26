'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { Loading } from '@/components/ui/Loading'
import { Modal, ModalFooterActions } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { kstYmdStr, kstMonthStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, TRACKED_CATEGORIES } from './constants'
import {
  getInventoryDetail,
  getPriceHistory,
  getMonthlyInflow,
  getSameCategoryItems,
  createTrackedItem,
  updateTrackedItem,
  archiveTrackedItem,
  getArchivedTrackedItems,
  unarchiveTrackedItem,
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
  toggleStorageLocationHub,
  setItemLocations,
  batchSetItemLocations,
  saveStockCheckDraft,
  deleteStockCheckDraft,
  deleteItemDrafts,
  getItemDrafts,
  getLocationDrafts,
  getDraftItemIds,
  applyMergeDecision,
  getMergeRules,
  deleteMergeRule,
} from './actions'
import { type StorageLocationItem, type LocationQtyEntry, type MergeDecision, type MergeRuleRow } from './constants'

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

const fmtTime = (d: Date | string) => {
  const dt = new Date(d)
  // KST = UTC+9
  const kst = new Date(dt.getTime() + 9 * 3600000)
  return `${String(kst.getUTCHours()).padStart(2, '0')}:${String(kst.getUTCMinutes()).padStart(2, '0')}`
}

// KST 기준 날짜가 같은지 비교 (두 Date 모두)
const isSameKstDay = (a: Date, b: Date) => {
  const toKst = (d: Date) => {
    const k = new Date(d.getTime() + 9 * 3600000)
    return `${k.getUTCFullYear()}-${k.getUTCMonth()}-${k.getUTCDate()}`
  }
  return toKst(a) === toKst(b)
}

export default function InventoryClient({ initialRows, targetMonth }: { initialRows: InventoryRow[]; targetMonth: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const rows = initialRows
  // 전역 월(?month=) 이동 — Header 와 동일하게 URL + localStorage 동기화
  const changeMonth = (delta: number) => {
    const [y, m] = targetMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const next = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (typeof window !== 'undefined') localStorage.setItem('stayeum_selected_month', next)
    const params = new URLSearchParams(searchParams.toString())
    params.set('month', next)
    router.replace(`?${params.toString()}`, { scroll: false })
  }
  const [isPending, startTransition] = useTransition()
  const [showAdd, setShowAdd]             = useState(false)
  const [showLocations, setShowLocations] = useState(false)
  const [detailId, setDetailId]           = useState<string | null>(null)
  const [error, setError]                 = useState('')
  const [selectMode, setSelectMode]       = useState(false)
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [showBatchLoc, setShowBatchLoc]     = useState(false)
  // 점검 진입 방식 — 'item'(품목별 목록) / 'location'(위치별 일괄). 마지막 선택 기억.
  const [viewMode, setViewMode] = useState<'item' | 'location'>(() =>
    typeof window !== 'undefined' && localStorage.getItem('stayeum-inventory-view') === 'location' ? 'location' : 'item'
  )
  const changeView = (m: 'item' | 'location') => {
    setViewMode(m)
    if (typeof window !== 'undefined') localStorage.setItem('stayeum-inventory-view', m)
    if (m === 'location') exitSelectMode()
  }
  const [showExcluded, setShowExcluded]     = useState(false)

  // 점검 임시저장(드래프트)이 걸린 품목 id — 카드 '점검 중' 배지용
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set())
  const refreshDrafts = () => getDraftItemIds().then(ids => setDraftIds(new Set(ids)))
  useEffect(() => { refreshDrafts() }, [])

  // 병합 확인 — 자동등록 후 후보가 있는 항목들 / 병합 규칙 관리 모달
  const [mergeDecisions, setMergeDecisions] = useState<MergeDecision[]>([])
  const [showMergeRules, setShowMergeRules] = useState(false)

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
      if (!res.ok) { pushToast('error', res.error); return }
      router.refresh()
      const parts: string[] = []
      if (res.created > 0) parts.push(`${res.created}개 품목 추가`)
      if (res.migrated > 0) parts.push(`${res.migrated}개 지출 라벨 정리 (사이즈/포장 변형 분리)`)
      if (res.skippedArchived > 0) parts.push(`삭제된 품목과 매칭되는 지출 ${res.skippedArchived}건은 건너뜀`)
      if (res.decisions.length > 0) parts.push(`${res.decisions.length}건 병합 확인 필요`)
      const summary = parts.length > 0 ? parts.join(' · ') : '추가할 품목이 없습니다 (이미 등록됨).'
      pushToast('success', summary)
      // 후보가 있으면 병합 확인 모달 — 사용자가 어느 카드로 넣을지/새로 만들지 선택
      if (res.decisions.length > 0) setMergeDecisions(res.decisions)
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
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-base sm:text-lg font-bold text-[var(--warm-dark)]">재고 관리</h1>
            <p className="text-xs text-[var(--warm-muted)] mt-0.5">부식·소모품·폐기물 사용량을 점검 기록 기반으로 추적합니다.</p>
          </div>
          {/* 점검 진입 방식 토글 — 모드 전환과 무관하게 항상 우측 상단 고정 (위치 점프 방지) */}
          <div className="inline-flex rounded-lg border border-[var(--warm-border)] overflow-hidden text-xs font-medium shrink-0">
            <button type="button" onClick={() => changeView('item')}
              className={`px-3 py-1.5 transition-colors ${viewMode === 'item' ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>
              아이템별
            </button>
            <button type="button" onClick={() => changeView('location')}
              className={`px-3 py-1.5 transition-colors ${viewMode === 'location' ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>
              위치별
            </button>
          </div>
        </div>
        {viewMode === 'item' && (
          <div className="flex gap-2 flex-wrap items-center">
            <Btn variant="secondary" size="sm" onClick={() => { selectMode ? exitSelectMode() : setSelectMode(true) }}>
              {selectMode ? `선택 취소${selected.size > 0 ? ` (${selected.size})` : ''}` : '선택'}
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => setShowLocations(true)}>위치 관리</Btn>
            <Btn variant="secondary" size="sm" onClick={() => setShowExcluded(true)}>제외 항목 복구</Btn>
            <Btn variant="secondary" size="sm" onClick={() => setShowMergeRules(true)}>병합 규칙</Btn>
            <Btn variant="secondary" size="sm" onClick={handleSeed} disabled={seedPending || isPending}>{seedPending ? '처리 중...' : '지출에서 자동 등록'}</Btn>
            <Btn variant="primary" size="sm" onClick={() => setShowAdd(true)}>+ 품목 추가</Btn>
          </div>
        )}
      </div>

      {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

      {viewMode === 'location' ? (
        <LocationBatchCheckModal inline rows={rows} onClose={() => changeView('item')} onDone={() => { router.refresh(); refreshDrafts() }} onDraftChange={refreshDrafts} />
      ) : rows.length === 0 ? (
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
              <span className="text-[0.6875rem] text-[var(--warm-muted)]">{g.rows.length}품목</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.rows.map(r => (
                <InventoryCard
                  key={r.id}
                  row={r}
                  selectMode={selectMode}
                  isSelected={selected.has(r.id)}
                  hasDraft={draftIds.has(r.id)}
                  onOpen={() => selectMode ? toggleSelect(r.id) : setDetailId(r.id)}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {showExcluded  && <ExcludedItemsModal onClose={() => { setShowExcluded(false); router.refresh() }} />}
      {showLocations && <LocationSettingsModal onClose={() => { setShowLocations(false); router.refresh() }} />}
      {mergeDecisions.length > 0 && (
        <MergeDecisionModal
          decisions={mergeDecisions}
          onClose={() => setMergeDecisions([])}
          onDone={() => { setMergeDecisions([]); router.refresh() }}
        />
      )}
      {showMergeRules && <MergeRulesModal onClose={() => { setShowMergeRules(false); router.refresh() }} />}
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
          <div className="flex items-center gap-3 bg-[var(--ink)] text-[var(--canvas)] rounded-xl px-4 py-3 shadow-lift pointer-events-auto mx-4">
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
          onChange={() => { router.refresh(); refreshDrafts() }}
          onDraftChange={refreshDrafts}
          targetMonth={targetMonth}
          onChangeMonth={changeMonth}
        />
      )}
    </div>
  )
}

function InventoryCard({ row, onOpen, selectMode, isSelected, hasDraft }: { row: InventoryRow; onOpen: () => void; selectMode?: boolean; isSelected?: boolean; hasDraft?: boolean }) {
  const tint = CATEGORY_TINT[row.category]
  const lowStock = row.daysUntilEmpty != null && row.daysUntilEmpty <= row.alertThresholdDays
  // trackUnit='qty' (폐기물 봉투 등): 매 단위 그대로. 'spec': specUnit 우선
  const stockUnit = row.trackUnit === 'qty' ? row.qtyUnit : (row.specUnit ?? row.qtyUnit)
  const priceUnit = row.trackUnit === 'qty' ? row.qtyUnit : (row.specUnit ?? row.qtyUnit)
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full bg-[var(--cream)] rounded-xl p-4 space-y-3 text-left transition-colors ${isSelected ? 'border-2 border-[var(--coral)] ring-2 ring-[var(--coral)]/20' : 'border border-[var(--warm-border)] hover:border-[var(--coral)]'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold text-[var(--warm-dark)] truncate">{row.label}</p>
          <p className="text-[0.625rem] mt-0.5" style={{ color: tint?.fg }}>{row.category}</p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          {hasDraft && (
            <span className="text-[0.5625rem] font-medium text-[var(--coral)] bg-[var(--coral)]/10 rounded-full px-2 py-0.5 whitespace-nowrap">점검 중</span>
          )}
          {lowStock && <Badge tone="danger" mono>소진 임박</Badge>}
          {row.pendingPurchases.length > 0 && (
            <Badge tone="warn" mono>{row.pendingPurchases.length}건 수령대기</Badge>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)]">현재 잔량</p>
          <p className="text-sm font-semibold text-[var(--warm-dark)]">{fmtQty(row.currentStock, stockUnit)}</p>
        </div>
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)]">평균 소모/일</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgDaily != null ? fmtQty(row.avgDaily, stockUnit) : '—'}
          </p>
        </div>
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)]">소진 예상</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.daysUntilEmpty != null ? `${row.daysUntilEmpty}일` : '—'}
            <span className="text-[0.625rem] text-[var(--warm-muted)] ml-1">/ 알림 D-{row.alertThresholdDays}</span>
          </p>
        </div>
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)]">평균 단가</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgUnitPrice != null
              ? `${Math.round(row.avgUnitPrice).toLocaleString()}원${priceUnit ? `/${priceUnit}` : ''}`
              : '—'}
          </p>
          {row.lastUnitPrice != null && row.lastUnitPrice !== row.avgUnitPrice && (
            <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">
              최근 {Math.round(row.lastUnitPrice).toLocaleString()}원{priceUnit ? `/${priceUnit}` : ''}
            </p>
          )}
        </div>
      </div>
      {row.memo && (
        <p className="text-[0.625rem] text-[var(--warm-mid)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-2 py-1.5 leading-relaxed whitespace-pre-wrap">
          메모 · {row.memo}
        </p>
      )}
      {row.reorderMemo && (
        <p className="text-[0.625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2 py-1.5 leading-relaxed">
          발주 · {row.reorderMemo}
        </p>
      )}
      {row.locations.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {row.lastCheckLocationBreakdown.length > 0
            ? row.lastCheckLocationBreakdown.map(lb => (
                <span key={lb.locationId} className="text-[0.625rem] bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">
                  {lb.locationName} {fmtQty(lb.qty, stockUnit)}
                </span>
              ))
            : row.locations.map(loc => (
                <span key={loc.id} className="text-[0.625rem] bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">{loc.name}</span>
              ))
          }
        </div>
      )}
      {row.lastPeriodConsumption != null && row.lastPeriodDays != null && (
        <p className="text-[0.625rem] text-[var(--warm-muted)] pt-1.5 border-t border-[var(--warm-border)]/60">
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
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
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

function DetailModal({ row, onClose, onChange, onDraftChange, targetMonth, onChangeMonth }: {
  row: InventoryRow | null; onClose: () => void; onChange: () => void; onDraftChange?: () => void
  targetMonth: string; onChangeMonth: (delta: number) => void
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
  const [loadingId, setLoadingId] = useState<string | null>(null)

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
    setLoadingId(id)
    const release = trackSave()
    deleteStockCheck(id).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '점검 기록 삭제됨') }).finally(release) }
      else { setLoadingId(null); setError(res.error); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); release() })
  }

  const handleDeleteAddition = (id: string) => {
    if (!confirm('이 입수 기록을 삭제하시겠습니까?')) return
    setLoadingId(id)
    const release = trackSave()
    deleteStockAddition(id).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '입수 기록 삭제됨') }).finally(release) }
      else { setLoadingId(null); setError(res.error); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); release() })
  }

  const handleConfirmReceipt = (expenseId: string, locationId?: string) => {
    setLoadingId(expenseId)
    const release = trackSave()
    confirmReceipt(expenseId, locationId).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '수령 확인 완료') }).finally(release) }
      else { setLoadingId(null); setError(res.error); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); release() })
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
        <Loading />
      ) : mode === 'check' ? (
        <CheckForm item={data.item} lastCheckBreakdown={row.lastCheckLocationBreakdown} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} onDraftChange={onDraftChange} />
      ) : mode === 'addition' ? (
        <AdditionForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : mode === 'settings' ? (
        <SettingsForm row={row} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : (
        <>
          <div className="px-5 sm:px-6 pt-3">
            <SegmentedControl
              size="sm"
              ariaLabel="품목 상세 탭"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'timeline', label: '타임라인' },
                { value: 'monthly',  label: '월별 입수' },
                { value: 'price',    label: '단가 추이' },
              ]}
            />
          </div>
          <div className="px-5 sm:px-6 py-3 space-y-3">
            {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
            {tab === 'timeline' && (() => {
              const nowMonth = kstMonthStr()
              // 엔트리 월 — 점검·무상입수는 날짜, 구매는 수령확정(receivedAt) 기준. 미수령 구매는 현재 월로 이월.
              const entryMonth = (e: TimelineEntry): string =>
                e.type === 'purchase'
                  ? (e.receivedAt ? kstMonthStr(new Date(e.receivedAt)) : nowMonth)
                  : kstMonthStr(new Date(e.date))
              const monthEntries = data.timeline.filter(e => entryMonth(e) === targetMonth)
              // 이월분 — targetMonth 시작 이전 마지막 점검의 잔량(전월말 최종 내역)
              const priorChecks = data.timeline.filter(
                (e): e is Extract<TimelineEntry, { type: 'check' }> =>
                  e.type === 'check' && kstMonthStr(new Date(e.date)) < targetMonth,
              )
              const carry = priorChecks.length > 0
                ? priorChecks.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a))
                : null
              const [yy, mm] = targetMonth.split('-')
              return (
                <div className="space-y-2">
                  {/* 월 네비 — 전역 월(?month=)과 연동 */}
                  <div className="flex items-center justify-between">
                    <button type="button" onClick={() => onChangeMonth(-1)}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] transition-colors">‹</button>
                    <span className="text-sm font-bold text-[var(--warm-dark)]">{yy}년 {Number(mm)}월</span>
                    <button type="button" onClick={() => onChangeMonth(1)} disabled={targetMonth >= nowMonth}
                      className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] transition-colors disabled:opacity-30 disabled:hover:bg-transparent">›</button>
                  </div>
                  {monthEntries.length === 0 && !carry ? (
                    <p className="text-sm text-[var(--warm-muted)] text-center py-6">이 달 기록이 없습니다.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {monthEntries.map(e => <TimelineRow key={`${e.type}-${e.id}`} entry={e} stockUnit={detailStockUnit} trackUnit={data.item.trackUnit} itemLocations={data.item.locations} onDeleteCheck={handleDeleteCheck} onDeleteAddition={handleDeleteAddition} onConfirmReceipt={handleConfirmReceipt} onChanged={() => { reload(); onChange() }} loadingId={loadingId} />)}
                      {carry && (
                        <li className="flex items-center justify-between bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-xl px-3 py-2">
                          <span className="text-[0.6875rem] font-medium text-[var(--warm-muted)]">이월분 · {yy}.{mm}.01</span>
                          <span className="text-xs font-semibold text-[var(--warm-mid)]">잔량 {fmtQty(carry.remainingQty, detailStockUnit)}</span>
                        </li>
                      )}
                    </ul>
                  )}
                </div>
              )
            })()}
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
          <p className="text-[0.625rem] text-[var(--warm-muted)]">전체 입수량</p>
          <p className="text-sm font-bold text-[var(--warm-dark)] mt-0.5">{Math.round(totalAll * 100) / 100}{u}</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3">
          <p className="text-[0.625rem] text-[var(--warm-muted)]">전체 구매 비용</p>
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
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-8 shrink-0">구매</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, purchasePct)}%`, background: '#6aab7e' }} />
                    </div>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-24 text-right shrink-0 tabular-nums">
                      {Math.round(r.purchaseQty * 100) / 100}{u} · {r.purchaseAmount.toLocaleString()}원
                    </span>
                  </div>
                )}
                {r.additionQty > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-8 shrink-0">무상</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, additionPct)}%`, background: '#d4a847' }} />
                    </div>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-24 text-right shrink-0 tabular-nums">
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
        <div className="flex items-center justify-between text-[0.625rem] text-[var(--warm-muted)]">
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
            <span className="text-[0.625rem] text-[var(--warm-muted)]">
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
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
          이 라벨을 바꾸면 같은 (카테고리·기존 라벨·{row.qtyUnit ?? '단위'}) 매칭되는 지출 내역의 품목명도 자동 갱신됩니다.
          예) '키친타월' → '키친타월 (롤타입)' / '음식물쓰레기봉투' → '음식물쓰레기봉투 5L'
        </p>
      </div>
      <p className="text-xs text-[var(--warm-muted)]">소진 예상일이 알림 기준 이하가 되면 대시보드에 '재고 부족' 알림이 표시됩니다.</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">알림 기준 (D-N)</label>
        <input type="text" inputMode="numeric" value={thresholdDays}
          onChange={e => setThresholdDays(e.target.value.replace(/[^0-9]/g, ''))}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[0.625rem] text-[var(--warm-muted)]">예: 3 → 소진 예상이 3일 이하면 알림</p>
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
        <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
          규격 단위: 쌀 1포대(20kg) 같이 규격으로 환산해서 추적 (kg, 매, ml).<br/>
          수량 단위: 종량제봉투 50L짜리 30매처럼 매(개) 단위로만 추적 (사이즈는 라벨에 적기).
        </p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">재고 파악 기준 메모</label>
        <textarea value={memo} onChange={e => setMemo(e.target.value)}
          rows={3}
          placeholder="예: 창고에 온전히 남아있는 양만 잔량으로 카운트. 주방 쌀통은 제외"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
        <p className="text-[0.625rem] text-[var(--warm-muted)]">잔량 점검 시 무엇을 세는지·어디 보관분만 카운트하는지 등 기준을 적어두면 일관성 유지에 도움됩니다.</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">발주 메모</label>
        <textarea value={reorderMemo} onChange={e => setReorderMemo(e.target.value)}
          rows={3}
          placeholder="예: 쿠팡 / 100매 박스 단위 / 영업장 카드 결제"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
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
      <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
        예: 라면처럼 봉지·박스가 섞여도 한 카드로 합쳐 추적하고 싶을 때. 사이즈가 의미 있는 폐기물 봉투는 분리 유지 권장.
      </p>

      {/* 병합 방향 확인 모달 */}
      {showConfirm && target && (
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4" onClick={() => setShowConfirm(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm p-5 space-y-4 shadow-lift" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-bold text-[var(--warm-dark)]">병합 방향 확인</h3>

            {/* 방향 표시 + 스왑 버튼 */}
            <div className="flex items-center gap-2">
              <div className="flex-1 text-center">
                <p className="text-[0.625rem] text-[var(--warm-muted)] mb-0.5">삭제될 카드</p>
                <p className="text-sm font-semibold text-[var(--warm-dark)] truncate">{srcLabel}</p>
              </div>
              <button type="button" onClick={() => setReversed(r => !r)}
                className="shrink-0 w-8 h-8 rounded-full border border-[var(--warm-border)] flex items-center justify-center text-[var(--warm-mid)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors text-base">
                ⇄
              </button>
              <div className="flex-1 text-center">
                <p className="text-[0.625rem] text-[var(--warm-muted)] mb-0.5">기록이 합쳐질 카드</p>
                <p className="text-sm font-semibold text-[var(--coral)] truncate">{destLabel}</p>
              </div>
            </div>

            <ul className="text-[0.6875rem] text-[var(--warm-muted)] space-y-1 leading-relaxed">
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

function TimelineRow({ entry, stockUnit, trackUnit, itemLocations, onDeleteCheck, onDeleteAddition, onConfirmReceipt, onChanged, loadingId }: {
  entry: TimelineEntry; stockUnit: string | null; trackUnit: 'spec' | 'qty'
  itemLocations: StorageLocationItem[]
  onDeleteCheck: (id: string) => void
  onDeleteAddition: (id: string) => void
  onConfirmReceipt?: (id: string, locationId?: string) => void
  onChanged: () => void
  loadingId: string | null
}) {
  const pending = loadingId === entry.id
  const [editing, setEditing] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [editError, setEditError] = useState('')
  const [showLocationPicker, setShowLocationPicker] = useState(false)

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
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><path d="M20 6 9 17l-5-5" /></svg>
          <div className="min-w-0">
            <p className="text-xs text-[var(--warm-muted)]">{fmtDate(entry.date)} · 점검 · <span className="tabular-nums">{fmtTime(entry.createdAt)}</span></p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">잔량 {fmtQty(entry.remainingQty, stockUnit)}</p>
            {entry.locationBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {entry.locationBreakdown.map(lb => {
                  const restocked = lb.restockedQty ?? 0
                  return (
                    <span key={lb.locationId} className="text-[0.625rem] bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">
                      {lb.locationName} {fmtQty(lb.qty, stockUnit)}
                      {restocked > 0 && <span className="ml-1 text-[var(--coral)]">+{Math.round(restocked * 100) / 100}</span>}
                    </span>
                  )
                })}
              </div>
            )}
            {/* 보충 합계 — restockedQty 가 있으면 합계와 허브 차감 안내 */}
            {(() => {
              const restockTotal = entry.locationBreakdown.reduce((s, lb) => s + (lb.restockedQty ?? 0), 0)
              if (restockTotal <= 0) return null
              return (
                <p className="text-[0.625rem] text-[var(--coral)] mt-0.5">
                  ↳ 창고 → 각 위치 +{Math.round(restockTotal * 100) / 100}{stockUnit ?? ''} (창고에서 자동 차감)
                </p>
              )
            })()}
            {/* (레거시) 명시적 이동 유입 — fromHubQty 가 있는 점검만 */}
            {entry.locationBreakdown
              .filter(lb => lb.fromHubQty != null && lb.fromHubQty > 0)
              .map(lb => {
                const src = entry.locationBreakdown.find(x => x.locationId === lb.fromLocationId)
                return (
                  <p key={`mv-${lb.locationId}`} className="text-[0.625rem] text-[var(--honey)] mt-0.5">
                    ↳ {src?.locationName ?? '창고'} → {lb.locationName} · {fmtQty(lb.fromHubQty!, stockUnit)} 이동
                  </p>
                )
              })}
            {entry.memo && <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
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
      <li className={`rounded-xl px-3 py-2 ${isPendingReceipt ? 'border border-[var(--honey)]/40 bg-[var(--honey)]/10' : 'border border-[var(--warm-border)]/60'}`}>
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex items-center gap-2">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><path d="M12 5v13M6 12l6 6 6-6" /></svg>
            <div className="min-w-0">
              <p className="text-xs text-[var(--warm-muted)]">
                구매일 {fmtDate(entry.date)}{packLabel ? ` · ${packLabel}` : ''}
              </p>
              <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(baseQty, baseUnit)}{entry.amount > 0 ? ` (${entry.amount.toLocaleString()}원)` : ''}</p>
              {isPendingReceipt ? (
                <p className="text-[0.625rem] text-[var(--honey)] mt-0.5">수령 대기 중</p>
              ) : entry.receivedAt ? (
                <p className="text-[0.625rem] text-[var(--status-paid-fg)] mt-0.5">
                  수령 확정 {fmtDate(entry.receivedAt)} <span className="tabular-nums">{fmtTime(entry.receivedAt)}</span>
                  {entry.receivedLocationName && <span className="ml-1">· {entry.receivedLocationName}</span>}
                </p>
              ) : null}
              {(entry.vendor || entry.memo) && <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.vendor ?? ''}{entry.vendor && entry.memo ? ' · ' : ''}{entry.memo ?? ''}</p>}
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {isPendingReceipt && onConfirmReceipt && !showLocationPicker && (
              <button type="button" disabled={pending}
                onClick={() => setShowLocationPicker(true)}
                className="text-xs font-semibold text-[var(--status-paid-fg)] hover:text-[var(--status-paid-strong)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--status-paid-bg)] whitespace-nowrap">
                수령 확인
              </button>
            )}
            <button type="button" disabled={pending} onClick={() => setEditing(true)}
              className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--cream)]">수정</button>
          </div>
        </div>
        {isPendingReceipt && showLocationPicker && onConfirmReceipt && (
          <div className="mt-2 pt-2 border-t border-[var(--honey)]/30">
            <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1.5">어느 위치로 입고됩니까?</p>
            <div className="flex flex-wrap gap-1.5">
              {itemLocations.map(loc => (
                <button key={loc.id} type="button" disabled={pending}
                  onClick={() => { setShowLocationPicker(false); onConfirmReceipt(entry.id, loc.id) }}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${loc.isHub ? 'border-[var(--honey)] bg-[var(--honey)]/10 text-[var(--ink)] font-medium' : 'border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)] hover:text-[var(--coral)]'}`}>
                  {loc.name}
                </button>
              ))}
              <button type="button" disabled={pending}
                onClick={() => { setShowLocationPicker(false); onConfirmReceipt(entry.id) }}
                className="text-xs px-2.5 py-1 rounded-lg border border-dashed border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-40">
                위치 없이 확정
              </button>
              <button type="button"
                onClick={() => setShowLocationPicker(false)}
                className="text-xs px-2.5 py-1 rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">
                취소
              </button>
            </div>
          </div>
        )}
      </li>
    )
  }

  // ── 무상 입수 (StockAddition)
  if (editing) {
    return <AdditionEditForm
      entry={entry} stockUnit={stockUnit} itemLocations={itemLocations}
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
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><path d="M12 5v13M6 12l6 6 6-6" /></svg>
        <div className="min-w-0">
          <p className="text-xs text-[var(--warm-muted)]">
            {fmtDate(entry.date)} · 무상 입수{entry.source ? ` (${entry.source})` : ''}
            {entry.storageLocationName && <span className="ml-1">· {entry.storageLocationName}</span>}
          </p>
          <p className="text-sm font-medium text-[var(--warm-dark)]">+ {fmtQty(entry.addedQty, stockUnit)}</p>
          {entry.memo && <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
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
  onSave: (data: { date?: string; memo?: string | null; remainingQty?: number; locationQtys?: { storageLocationId: string; qty: number; restockedQty?: number }[] }) => Promise<void>
  pending: boolean
  error: string
}) {
  const [date, setDate] = useState(entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10))
  const [memo, setMemo] = useState(entry.memo ?? '')

  // 위치 source — 기존 breakdown이 있으면 우선, 없으면 아이템 locations 목록
  const locationSources: { id: string; name: string; isHub: boolean }[] =
    entry.locationBreakdown.length > 0
      ? entry.locationBreakdown.map(lb => ({
          id: lb.locationId, name: lb.locationName,
          isHub: itemLocations.find(l => l.id === lb.locationId)?.isHub ?? false,
        }))
      : itemLocations.map(l => ({ id: l.id, name: l.name, isHub: l.isHub }))

  const hasLocations = locationSources.length > 0

  // 기존 데이터에서 전/후 역산: 전 = qty - restockedQty (restocked > 0일 때만)
  const initial = Object.fromEntries(
    entry.locationBreakdown.map(lb => {
      const restocked = lb.restockedQty ?? 0
      const before = restocked > 0 ? Math.max(0, lb.qty - restocked) : 0
      return [lb.locationId, { before: restocked > 0 ? String(before) : '', after: String(lb.qty) }]
    })
  )

  const [beforeQtys, setBeforeQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(locationSources.map(l => [l.id, initial[l.id]?.before ?? '']))
  )
  const [afterQtys, setAfterQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(locationSources.map(l => [l.id, initial[l.id]?.after ?? '']))
  )

  const [qty, setQty] = useState(hasLocations ? '' : String(entry.remainingQty))
  // 창고(허브)는 보충받는 게 아니라 차감되는 쪽 — '자동 차감 후'를 자동계산. 사용자가 직접 고치면 그 값 사용.
  const [hubTouched, setHubTouched] = useState(false)

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  const restockSum = locationSources.filter(l => !l.isHub).reduce((s, l) => {
    const b = Number(beforeQtys[l.id] || '0')
    const a = Number(afterQtys[l.id] || '0')
    return s + Math.max(0, a - b)
  }, 0)

  // 창고(허브) 행 — '이전 잔량'은 저장된 창고 잔량 + 이 점검의 원래 보충합계로 역산(편집 무관 상수).
  // '자동 차감 후' = 이전 잔량 − (현재 편집 중인) 보충합계. 사용자가 직접 보정 안 했으면 이 값으로 저장.
  const hubLoc = locationSources.find(l => l.isHub)
  const originalRestockSum = entry.locationBreakdown.reduce((s, lb) => s + (lb.restockedQty ?? 0), 0)
  const hubStoredQty = hubLoc ? (entry.locationBreakdown.find(lb => lb.locationId === hubLoc.id)?.qty ?? 0) : 0
  const hubBefore = hubStoredQty + originalRestockSum
  const hubAutoAfter = Math.max(0, hubBefore - restockSum)
  const hubFinal = hubLoc
    ? ((hubTouched && afterQtys[hubLoc.id] !== undefined && afterQtys[hubLoc.id] !== '') ? Number(afterQtys[hubLoc.id]) : hubAutoAfter)
    : 0

  const locationTotal = hasLocations
    ? locationSources.reduce((s, l) => s + (l.isHub ? hubFinal : (Number(afterQtys[l.id]) || 0)), 0)
    : 0

  const handleSave = () => {
    if (hasLocations) {
      onSave({
        date, memo: memo || null,
        locationQtys: locationSources.map(l => {
          if (l.isHub) return { storageLocationId: l.id, qty: hubFinal }
          const before = Number(beforeQtys[l.id] || '0')
          const after = Number(afterQtys[l.id] || '0')
          const restocked = after > before ? after - before : 0
          return {
            storageLocationId: l.id, qty: after,
            ...(restocked > 0 ? { restockedQty: restocked } : {}),
          }
        }),
      })
    } else {
      onSave({ date, memo: memo || null, remainingQty: Number(qty) })
    }
  }

  return (
    <li className="border border-[var(--coral)]/30 rounded-xl px-3 py-3 space-y-2.5 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">재고 점검 수정</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        {!hasLocations && (
          <div>
            <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">잔량{stockUnit ? ` (${stockUnit})` : ''}</p>
            <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} className={`w-full ${inputCls}`} />
          </div>
        )}
      </div>
      {hasLocations && (
        <div className="space-y-2">
          <p className="text-[0.625rem] text-[var(--warm-muted)]">위치별 보충 전 → 보충 후{stockUnit ? ` (${stockUnit})` : ''}</p>
          {locationSources.map(l => {
            // 창고(허브) 행 — 보충 입력 없이 '이전 → 자동 차감 후' 자동계산
            if (l.isHub) {
              const userVal = afterQtys[l.id]
              const displayAfter = hubTouched && userVal !== undefined ? userVal : String(Math.round(hubAutoAfter * 100) / 100)
              return (
                <div key={l.id} className="bg-[var(--honey)]/5 border border-[var(--honey)]/30 rounded-lg px-2 py-1.5 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--warm-dark)] truncate">{l.name} <span className="text-[var(--warm-muted)]">(허브)</span></span>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">이전 {Math.round(hubBefore * 100) / 100}{stockUnit ?? ''}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--warm-muted)] shrink-0">자동 차감 후</span>
                    <input type="text" inputMode="decimal"
                      value={displayAfter}
                      onChange={e => { setAfterQtys(prev => ({ ...prev, [l.id]: e.target.value.replace(/[^0-9.]/g, '') })); setHubTouched(true) }}
                      className={`w-20 ${inputCls}`} />
                    <span className="text-[var(--warm-muted)] shrink-0">{stockUnit ?? ''}</span>
                    {restockSum > 0 && (
                      <span className="ml-auto text-[0.625rem] text-[var(--persimmon-d)] shrink-0">−{Math.round(restockSum * 100) / 100} 차감</span>
                    )}
                  </div>
                </div>
              )
            }
            // 비허브 위치 행 — 보충 전 → 보충 후 (차이만큼 창고에서 이동)
            const beforeStr = beforeQtys[l.id] ?? ''
            const afterStr  = afterQtys[l.id] ?? ''
            const b = beforeStr === '' ? null : Number(beforeStr)
            const a = afterStr === '' ? null : Number(afterStr)
            const restocked = (b !== null && a !== null && a > b) ? a - b : 0
            return (
              <div key={l.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] truncate">{l.name}</span>
                  {restocked > 0 && (
                    <span className="text-[0.625rem] text-[var(--coral)] shrink-0">창고 → +{Math.round(restocked * 100) / 100}</span>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 전</p>
                    <input type="text" inputMode="decimal" placeholder="0"
                      value={beforeStr}
                      onChange={e => setBeforeQtys(prev => ({ ...prev, [l.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                  <div>
                    <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 후</p>
                    <input type="text" inputMode="decimal" placeholder="0"
                      value={afterStr}
                      onChange={e => setAfterQtys(prev => ({ ...prev, [l.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                </div>
              </div>
            )
          })}
          <div className="flex justify-between text-[0.625rem] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1">
            {restockSum > 0
              ? <span className="text-[var(--warm-mid)]">창고 → 이동 합계 <strong className="text-[var(--coral)]">+{Math.round(restockSum * 100) / 100}{stockUnit ?? ''}</strong></span>
              : <span className="text-[var(--warm-muted)]">보충 없음</span>}
            <span className="text-[var(--warm-mid)]">잔량 <strong className="text-[var(--coral)]">{Math.round(locationTotal * 100) / 100}{stockUnit ?? ''}</strong></span>
          </div>
        </div>
      )}
      <div>
        <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={`w-full ${inputCls} text-left`} />
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
function AdditionEditForm({ entry, stockUnit, itemLocations, onCancel, onSave, onDelete, pending, error }: {
  entry: TimelineEntry & { type: 'addition' }
  stockUnit: string | null
  itemLocations: StorageLocationItem[]
  onCancel: () => void
  onSave: (data: { date?: string; addedQty?: number; source?: string | null; memo?: string | null; storageLocationId?: string | null }) => Promise<void>
  onDelete: () => Promise<void>
  pending: boolean
  error: string
}) {
  const [date, setDate] = useState(entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10))
  const [qty, setQty]   = useState(String(entry.addedQty))
  const [source, setSource] = useState(entry.source ?? '')
  const [memo, setMemo]     = useState(entry.memo ?? '')
  const [storageLocationId, setStorageLocationId] = useState<string>(entry.storageLocationId ?? '')

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <li className="border border-[var(--warm-border)] rounded-xl px-3 py-3 space-y-2 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">무상 입수 수정</p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">수량{stockUnit ? ` (${stockUnit})` : ''}</p>
          <input type="number" min="0" step="any" value={qty} onChange={e => setQty(e.target.value)} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">출처</p>
        <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="예: 샘플, 증정" className={inputCls} />
      </div>
      {itemLocations.length > 0 && (
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">입고 위치</p>
          <select value={storageLocationId} onChange={e => setStorageLocationId(e.target.value)} className={inputCls}>
            <option value="">위치 없이 기록</option>
            {itemLocations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}{loc.isHub ? ' (허브)' : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDelete} disabled={pending}
          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-red-50">삭제</button>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} disabled={pending}
          className="text-xs text-[var(--warm-muted)] px-3 py-1.5 rounded-lg hover:bg-[var(--cream)]">취소</button>
        <Btn variant="primary" size="sm" disabled={pending || !qty || Number(qty) <= 0}
          onClick={() => onSave({ date, addedQty: Number(qty), source: source || null, memo: memo || null, storageLocationId: storageLocationId || null })}>
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
  onSave: (data: { date?: string; amount?: number; vendor?: string | null; memo?: string | null; receivedAt?: string | null }) => Promise<void>
  onDelete: () => Promise<void>
  pending: boolean
  error: string
}) {
  const [date, setDate]     = useState(entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10))
  const [amount, setAmount] = useState(entry.amount > 0 ? String(entry.amount) : '')
  const [vendor, setVendor] = useState(entry.vendor ?? '')
  const [memo, setMemo]     = useState(entry.memo ?? '')

  // 수령 확정일시
  const initReceivedDate = entry.receivedAt
    ? (() => { const d = new Date(entry.receivedAt); const k = new Date(d.getTime() + 9*3600000); return `${k.getUTCFullYear()}-${String(k.getUTCMonth()+1).padStart(2,'0')}-${String(k.getUTCDate()).padStart(2,'0')}` })()
    : ''
  const initReceivedTime = entry.receivedAt
    ? (() => { const d = new Date(entry.receivedAt); const k = new Date(d.getTime() + 9*3600000); return `${String(k.getUTCHours()).padStart(2,'0')}:${String(k.getUTCMinutes()).padStart(2,'0')}` })()
    : ''
  const [receivedDate, setReceivedDate] = useState(initReceivedDate)
  const [receivedTime, setReceivedTime] = useState(initReceivedTime)
  // 명시적 미수령 토글 — 'clear' sentinel 대신 별도 플래그로 DatePicker가
  // 'clear' 문자열을 날짜로 파싱하려다 Invalid Date 표시되던 문제 해결
  const [unreceived, setUnreceived] = useState(false)

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  const buildReceivedAt = () => {
    if (unreceived) return null  // 수령 대기로 되돌리기
    if (!receivedDate) return undefined  // 변경 없음
    const time = receivedTime || '00:00'
    // KST → UTC 변환
    return new Date(`${receivedDate}T${time}:00+09:00`).toISOString()
  }

  return (
    <li className="border border-[var(--warm-border)] rounded-xl px-3 py-3 space-y-2 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">구매 수정 <span className="text-[0.625rem] font-normal text-[var(--warm-muted)]">— 수정 내용은 지출 페이지에도 반영됩니다</span></p>
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">구매일</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">금액 (원)</p>
          <input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">구매처</p>
        <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="예: 고구마켓" className={inputCls} />
      </div>
      <div>
        <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      {/* 수령 확정일시 */}
      <div className="space-y-1">
        <p className="text-[0.625rem] text-[var(--warm-muted)]">수령 확정일시</p>
        {unreceived ? (
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]">
            <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded bg-[var(--honey)]/15 text-[var(--honey-d,#8B5E0A)] tracking-wider">미수령</span>
            <span className="text-[0.6875rem] text-[var(--warm-muted)]">저장 시 수령 대기로 되돌립니다</span>
            <div className="flex-1" />
            <Btn variant="ghost" size="sm" onClick={() => { setUnreceived(false); setReceivedDate(initReceivedDate || ''); setReceivedTime(initReceivedTime || '') }}>되돌리기</Btn>
          </div>
        ) : (
          <div className="flex gap-2 items-center">
            <DatePicker value={receivedDate} onChange={setReceivedDate} className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
            <input type="time" value={receivedTime} onChange={e => setReceivedTime(e.target.value)}
              className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
            {entry.receivedAt && (
              <Btn variant="danger" size="sm" onClick={() => { setUnreceived(true); setReceivedDate(''); setReceivedTime('') }}>미수령으로</Btn>
            )}
          </div>
        )}
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDelete} disabled={pending}
          className="text-xs text-red-400 hover:text-red-600 disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-red-50">재고에서 제외</button>
        <div className="flex-1" />
        <button type="button" onClick={onCancel} disabled={pending}
          className="text-xs text-[var(--warm-muted)] px-3 py-1.5 rounded-lg hover:bg-[var(--cream)]">취소</button>
        <Btn variant="primary" size="sm" disabled={pending}
          onClick={() => onSave({ date, amount: amount ? Number(amount) : undefined, vendor: vendor || null, memo: memo || null, receivedAt: buildReceivedAt() })}>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </li>
  )
}

function CheckForm({ item, lastCheckBreakdown, onCancel, onDone, onDraftChange }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  lastCheckBreakdown: LocationQtyEntry[]
  onCancel: () => void; onDone: () => void; onDraftChange?: () => void
}) {
  const stockUnit = item.trackUnit === 'qty' ? item.qtyUnit : (item.specUnit ?? item.qtyUnit)
  const hasLocations = item.locations.length > 0
  const [date, setDate] = useState(kstYmdStr())

  // 이전 점검의 위치별 수량 맵
  const prevMap = Object.fromEntries(lastCheckBreakdown.map(lb => [lb.locationId, lb.qty]))
  const hasPrev = lastCheckBreakdown.length > 0

  // 첫 허브 위치 (다중 허브면 첫 번째 — 보충량 자동 차감 대상)
  const hubLoc = item.locations.find(l => l.isHub)
  const hubPrev = hubLoc ? (prevMap[hubLoc.id] ?? 0) : 0

  // 보충 모드: 이전 점검이 있을 때만. 첫 점검은 단순 잔량 입력.
  const restockMode = hasPrev && hasLocations

  // 단순 모드 — 위치별 잔량 1칸 (첫 점검 또는 위치 없음)
  const [locationQtys, setLocationQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(item.locations.map(l => [l.id, prevMap[l.id] != null ? String(prevMap[l.id]) : '']))
  )
  const [touched, setTouched] = useState<Set<string>>(new Set())

  // 보충 모드 — 위치별 "보충 전" + "보충 후"
  // "보충 전"을 직전 점검 잔량으로 prefill — 위치별 점검(LocationBatchCheckModal)과
  // 동일하게, "보충 후"만 입력해도 보충량(후-전)이 정확히 계산돼 허브에서 자동 차감됨.
  // (빈칸이면 보충 0으로 처리돼 허브 미차감 → 총량 변동하던 버그 방지.)
  const [beforeQtys, setBeforeQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(
      item.locations
        .filter(l => !l.isHub)
        .map(l => [l.id, prevMap[l.id] != null ? String(prevMap[l.id]) : '']),
    ),
  )
  const [afterQtys, setAfterQtys]   = useState<Record<string, string>>({})
  // 허브 사용자 보정 여부 — true 면 자동 차감값을 덮어쓰지 않음
  const [hubTouched, setHubTouched] = useState(false)

  const [qty, setQty]   = useState('')
  const [memo, setMemo] = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  // 임시저장(드래프트) — 아이템별 점검은 locationId null. 폼을 열면 직전 임시저장값을 복원.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftPending, setDraftPending] = useState(false)
  useEffect(() => {
    let active = true
    getItemDrafts(item.id).then(drafts => {
      if (!active) return
      // 아이템별(null) 드래프트 = 폼 기본 상태(스칼라 + 위치별 보충 전/후 맵)
      const main = drafts.find(x => x.locationId == null)?.data as {
        date?: string; qty?: string; memo?: string
        locationQtys?: Record<string, string>
        beforeQtys?: Record<string, string>
        afterQtys?: Record<string, string>
        hubTouched?: boolean; savedAt?: number
      } | undefined
      const mainSavedAt = typeof main?.savedAt === 'number' ? main.savedAt : 0
      if (main) {
        if (typeof main.date === 'string') setDate(main.date)
        if (typeof main.qty === 'string') setQty(main.qty)
        if (typeof main.memo === 'string') setMemo(main.memo)
        if (main.locationQtys) setLocationQtys(prev => ({ ...prev, ...main.locationQtys }))
      }
      // 보충 전/후 — main 값 + 위치별 드래프트 cross-merge (위치별 savedAt 더 최신이면 우선).
      // 두 모드(아이템별/위치별)에서 임시저장한 값이 폼에 함께 반영되도록.
      const beforeOv: Record<string, string> = { ...(main?.beforeQtys ?? {}) }
      const afterOv:  Record<string, string> = { ...(main?.afterQtys ?? {}) }
      const hubIds = new Set(item.locations.filter(l => l.isHub).map(l => l.id))
      let hubTouched = !!main?.hubTouched
      let latestSavedAt = mainSavedAt
      for (const dr of drafts) {
        if (dr.locationId == null) continue
        const dd = dr.data as { before?: string; after?: string; savedAt?: number } | undefined
        if (!dd) continue
        const sv = typeof dd.savedAt === 'number' ? dd.savedAt : 0
        const newer = sv >= mainSavedAt
        if (dd.before != null && (newer || beforeOv[dr.locationId] == null)) beforeOv[dr.locationId] = String(dd.before)
        if (dd.after != null && (newer || afterOv[dr.locationId] == null)) {
          afterOv[dr.locationId] = String(dd.after)
          if (hubIds.has(dr.locationId)) hubTouched = true
        }
        if (sv > latestSavedAt) latestSavedAt = sv
      }
      // 초기 prefill 위에 병합 (드래프트 없는 위치는 prefill 유지)
      if (Object.keys(beforeOv).length) setBeforeQtys(prev => ({ ...prev, ...beforeOv }))
      if (Object.keys(afterOv).length)  setAfterQtys(prev => ({ ...prev, ...afterOv }))
      setHubTouched(hubTouched)
      if (latestSavedAt > 0) setDraftSavedAt(latestSavedAt)
    })
    return () => { active = false }
  }, [item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveDraft = () => {
    setError('')
    const savedAt = Date.now()
    setDraftPending(true)
    saveStockCheckDraft({
      trackedItemId: item.id, locationId: null,
      data: { date, qty, memo, locationQtys, beforeQtys, afterQtys, hubTouched, savedAt },
    }).then(res => {
      setDraftPending(false)
      if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
      setDraftSavedAt(savedAt)
      pushToast('success', '임시저장됨')
      onDraftChange?.()
    })
  }

  const handleClearDraft = () => {
    // cross-mode 공유 — 이 품목의 모든 드래프트(아이템별+위치별) 정리
    deleteItemDrafts(item.id).then(() => {
      setDraftSavedAt(null)
      pushToast('success', '임시저장 비움')
      onDraftChange?.()
    })
  }

  const handleLocChange = (id: string, val: string) => {
    setLocationQtys(prev => ({ ...prev, [id]: val.replace(/[^0-9.]/g, '') }))
    setTouched(prev => new Set([...prev, id]))
  }
  const confirmAll = () => setTouched(new Set(item.locations.map(l => l.id)))

  // 비허브 위치들의 보충량 합계 — 행별 restocked 와 동일한 null-처리.
  // (빈칸은 0이 아니라 null 로 봐서, 전·후 모두 입력됐을 때만 보충으로 계산.
  //  이렇게 해야 사용자가 "보충 전"을 비웠을 때 허브가 과차감되지 않음.)
  const restockSum = restockMode
    ? item.locations
        .filter(l => !l.isHub)
        .reduce((s, l) => {
          const beforeStr = beforeQtys[l.id] ?? ''
          const afterStr  = afterQtys[l.id] ?? ''
          const beforeN = beforeStr === '' ? null : Number(beforeStr)
          const afterN  = afterStr === '' ? null : Number(afterStr)
          return s + ((beforeN !== null && afterN !== null && afterN > beforeN) ? afterN - beforeN : 0)
        }, 0)
    : 0

  // 허브의 "보충 후" 자동 계산값 — 사용자가 직접 보정 안 했으면 사용
  const hubAutoAfter = Math.max(0, hubPrev - restockSum)

  // 저장용 위치별 데이터 계산
  const buildLocationData = (): { storageLocationId: string; qty: number; restockedQty?: number }[] => {
    if (!hasLocations) return []
    if (restockMode) {
      return item.locations.map(l => {
        if (l.isHub) {
          const userVal = afterQtys[l.id]
          const finalQty = (hubTouched && userVal !== undefined && userVal !== '') ? Number(userVal) : hubAutoAfter
          return { storageLocationId: l.id, qty: finalQty }
        }
        const beforeStr = beforeQtys[l.id] ?? ''
        const afterStr  = afterQtys[l.id] ?? ''
        const beforeN = beforeStr === '' ? null : Number(beforeStr)
        const afterN  = afterStr  === '' ? null : Number(afterStr)
        // 후만 입력 → 단순 잔량, 보충 없음
        // 전·후 모두 입력 → 보충량 = max(0, 후-전)
        // 전만 입력 → 보충 없이 잔량 = 전
        // 모두 비움 → qty=0
        const finalQty = afterN ?? beforeN ?? 0
        const restocked = (beforeN !== null && afterN !== null && afterN > beforeN) ? afterN - beforeN : undefined
        return { storageLocationId: l.id, qty: finalQty, restockedQty: restocked }
      })
    }
    // 단순 모드 — 첫 점검
    return item.locations.map(l => ({
      storageLocationId: l.id,
      qty: Number(locationQtys[l.id]) || 0,
    }))
  }

  const computed = restockMode
    ? buildLocationData().reduce((s, lq) => s + lq.qty, 0)
    : (hasLocations
        ? item.locations.reduce((s, l) => s + (Number(locationQtys[l.id]) || 0), 0)
        : 0)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (!hasLocations) {
      const n = Number(qty)
      if (isNaN(n) || n < 0) { setError('잔량은 0 이상이어야 합니다.'); return }
      startTransition(async () => {
        const res = await createStockCheck({
          trackedItemId: item.id, date, remainingQty: n, memo: memo || undefined,
        })
        if (!res.ok) { setError(res.error); return }
        await deleteItemDrafts(item.id)
        onDraftChange?.()
        onDone()
      })
      return
    }

    const locationData = buildLocationData().filter(lq => lq.qty > 0 || lq.restockedQty != null)
    const total = locationData.reduce((s, lq) => s + lq.qty, 0)
    if (total < 0) { setError('잔량은 0 이상이어야 합니다.'); return }

    startTransition(async () => {
      const res = await createStockCheck({
        trackedItemId: item.id, date, remainingQty: total, memo: memo || undefined,
        locationQtys: locationData,
      })
      if (!res.ok) { setError(res.error); return }
      await deleteItemDrafts(item.id)
      onDraftChange?.()
      onDone()
    })
  }

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">
        {restockMode
          ? '각 위치의 보충 전·후 수량을 입력하면, 늘어난 만큼 창고(허브)에서 자동으로 옮겨진 것으로 차감됩니다. (새로 산 게 아니라 창고→위치 이동)'
          : `점검한 시점에 남아있는 양을 ${stockUnit ?? '단위'} 기준으로 기록합니다. 직전 점검과의 차이로 소모량이 계산됩니다.`}
      </p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">점검일 *</label>
        <DatePicker value={date} onChange={setDate}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
      </div>

      {hasLocations && restockMode ? (
        <div className="space-y-2.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">위치별 잔량{stockUnit ? ` (${stockUnit})` : ''}</label>
          {item.locations.map(loc => {
            const prevQty = prevMap[loc.id]
            if (loc.isHub) {
              // 허브 행 — 후 자동 prefill
              const userVal = afterQtys[loc.id]
              const displayAfter = hubTouched && userVal !== undefined ? userVal : String(hubAutoAfter)
              return (
                <div key={loc.id} className="space-y-1 bg-[var(--honey)]/5 border border-[var(--honey)]/30 rounded-xl px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--warm-dark)] truncate">{loc.name} <span className="text-[var(--warm-muted)]">(허브)</span></span>
                    {prevQty !== undefined && <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">이전 {prevQty}{stockUnit ?? ''}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--warm-muted)] shrink-0">자동 차감 후</span>
                    <input type="text" inputMode="decimal"
                      value={displayAfter}
                      onChange={e => { setAfterQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') })); setHubTouched(true) }}
                      className={`w-20 ${inputCls}`} />
                    <span className="text-[var(--warm-muted)] shrink-0">{stockUnit ?? ''}</span>
                    {restockSum > 0 && (
                      <span className="ml-auto text-[0.625rem] text-[var(--persimmon-d)] shrink-0">-{Math.round(restockSum * 100) / 100} 차감</span>
                    )}
                  </div>
                </div>
              )
            }
            // 비허브 위치 행 — 전 → 후 (grid 2cols, 라벨은 input 위)
            const beforeStr = beforeQtys[loc.id] ?? ''
            const afterStr  = afterQtys[loc.id] ?? ''
            const beforeN = beforeStr === '' ? null : Number(beforeStr)
            const afterN  = afterStr === '' ? null : Number(afterStr)
            const restocked = (beforeN !== null && afterN !== null && afterN > beforeN) ? afterN - beforeN : 0
            return (
              <div key={loc.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] truncate">{loc.name}</span>
                  <div className="flex items-baseline gap-1.5 shrink-0">
                    {restocked > 0 && (
                      <span className="text-[0.625rem] text-[var(--coral)]">창고 → +{Math.round(restocked * 100) / 100}</span>
                    )}
                    {prevQty !== undefined && <span className="text-[0.625rem] text-[var(--warm-muted)]">이전 {prevQty}{stockUnit ?? ''}</span>}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 전</p>
                    <input type="text" inputMode="decimal" placeholder="0"
                      value={beforeStr}
                      onChange={e => setBeforeQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                  <div>
                    <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 후</p>
                    <input type="text" inputMode="decimal" placeholder="0"
                      value={afterStr}
                      onChange={e => setAfterQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                </div>
              </div>
            )
          })}
          <div className="flex justify-between text-[0.625rem] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
            <span className="text-[var(--warm-mid)]">창고 → 이동 합계 <strong className="text-[var(--coral)]">+{Math.round(restockSum * 100) / 100}{stockUnit ?? ''}</strong></span>
            <span className="text-[var(--warm-mid)]">점검 후 잔량 <strong className="text-[var(--coral)]">{Math.round(computed * 100) / 100}{stockUnit ?? ''}</strong></span>
          </div>
        </div>
      ) : hasLocations ? (
        // 단순 모드 — 첫 점검 (이전 데이터 없음)
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--warm-mid)]">위치별 잔량{stockUnit ? ` (${stockUnit})` : ''}</label>
            {hasPrev && touched.size < item.locations.length && (
              <button type="button" onClick={confirmAll}
                className="text-[0.625rem] text-[var(--coral)] hover:underline">
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
                    className={`w-full bg-[var(--canvas)] border rounded-sm px-3 py-2 text-sm outline-none focus:border-[var(--coral)] transition-colors ${
                      isPrefilled
                        ? 'border-[var(--warm-border)]/50 text-[var(--ink-mute)]'
                        : 'border-[var(--warm-border)] text-[var(--warm-dark)]'
                    }`} />
                  {isPrefilled && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.5625rem] text-[var(--ink-mute)] bg-[var(--canvas)] pl-1">이전</span>
                  )}
                </div>
              </div>
            )
          })}
          <p className="text-[0.625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
            → 합계 <strong>{Math.round(computed * 100) / 100}{stockUnit ?? ''}</strong>
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">잔량 *{stockUnit ? ` (${stockUnit})` : ''}</label>
          <input type="text" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        </div>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>
      {draftSavedAt && (
        <div className="flex items-center justify-between gap-2 text-[0.625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
          <span>이어서 점검 중 · 임시저장 {fmtTime(new Date(draftSavedAt))}</span>
          <button type="button" onClick={handleClearDraft}
            className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline shrink-0">비우기</button>
        </div>
      )}
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel}>취소</Btn>
        <Btn type="button" variant="secondary" onClick={handleSaveDraft} disabled={draftPending || pending} fullWidth>
          {draftPending ? '저장 중…' : '임시저장'}
        </Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}

// ── 위치별 일괄 점검 — 모달(inline=false) / 인라인 패널(inline=true) 양용
function LocationBatchCheckModal({ rows, onClose, onDone, inline = false, onDraftChange }: {
  rows: InventoryRow[]; onClose: () => void; onDone: () => void; inline?: boolean; onDraftChange?: () => void
}) {
  const [locs, setLocs] = useState<StorageLocationItem[]>([])
  const [locId, setLocId] = useState('')
  const [date, setDate] = useState(kstYmdStr())
  const [pending, setPending] = useState(false)
  const [draftPending, setDraftPending] = useState(false)
  const [error, setError] = useState('')
  const [mergeChoice, setMergeChoice] = useState<'merge' | 'new' | null>(null)
  const [confirmItems, setConfirmItems] = useState<InventoryRow[]>([])

  useEffect(() => { getStorageLocations().then(setLocs) }, [])

  const selectedLoc = locs.find(l => l.id === locId) ?? null
  const isHubLocation = selectedLoc?.isHub ?? false

  const locItems = locId
    ? rows.filter(r => !r.isArchived && r.locations.some(l => l.id === locId))
    : []

  // 위치별 "보충 전" + "보충 후" — 비허브 위치는 두 칸, 허브 위치는 후만 의미 있음
  const [beforeQtys, setBeforeQtys] = useState<Record<string, string>>({})
  const [afterQtys, setAfterQtys]   = useState<Record<string, string>>({})

  useEffect(() => {
    if (!locId) return
    // "보충 전"을 직전 점검 잔량으로 prefill — 보충 후만 입력해도 보충량(후-전)이
    // 정확히 계산되어 허브에서 자동 차감됨. (빈칸이면 보충 0으로 처리돼 허브 차감 없이
    // 순증가하던 버그 수정. 아이템별 점검 CheckForm 과 prefill 동작 통일.)
    const initBefore: Record<string, string> = {}
    rows
      .filter(r => !r.isArchived && r.locations.some(l => l.id === locId))
      .forEach(r => {
        const prev = r.lastCheckLocationBreakdown.find(lb => lb.locationId === locId)
        initBefore[r.id] = prev != null ? String(prev.qty) : ''
      })
    setBeforeQtys(initBefore)
    setAfterQtys({})
    setMergeChoice(null)
    setConfirmItems([])
    // 임시저장(드래프트) 복원 — 이 위치에 저장된 품목별 보충 전/후가 있으면 덮어씀
    getLocationDrafts(locId).then(drafts => {
      if (drafts.length === 0) return
      setBeforeQtys(prev => {
        const next = { ...prev }
        drafts.forEach(d => { if (d.data?.before != null) next[d.trackedItemId] = String(d.data.before) })
        return next
      })
      setAfterQtys(prev => {
        const next = { ...prev }
        drafts.forEach(d => { if (d.data?.after != null) next[d.trackedItemId] = String(d.data.after) })
        return next
      })
    })
  }, [locId]) // eslint-disable-line react-hooks/exhaustive-deps

  // 점검 위치가 비허브일 때, 각 품목당 보충량은 후-전, 합계만큼 그 품목의 허브 위치 잔량 자동 차감
  const computeRow = (r: InventoryRow) => {
    const beforeStr = beforeQtys[r.id] ?? ''
    const afterStr  = afterQtys[r.id] ?? ''
    const b = beforeStr === '' ? null : Number(beforeStr)
    const a = afterStr  === '' ? null : Number(afterStr)
    const restocked = (b !== null && a !== null && a > b) ? a - b : 0
    return { beforeStr, afterStr, beforeN: b, afterN: a, restocked }
  }

  const isItemDirty = (r: InventoryRow) => {
    const { afterStr } = computeRow(r)
    return afterStr !== ''
  }

  const totalRestock = locItems.reduce((s, r) => s + computeRow(r).restocked, 0)

  const doSave = async (forceMerge?: boolean) => {
    const toSave = locItems.filter(isItemDirty)
    if (toSave.length === 0) { setError('저장할 수량이 없습니다.'); return }
    setPending(true); setError('')
    const locName = selectedLoc?.name ?? ''
    const now = Date.now()
    try {
      await Promise.all(toSave.map(r => {
        const { afterN, restocked } = computeRow(r)
        // #3 서버가 DB의 현재(머지대상)·직전(신규) 위치별 잔량을 base로 허브 차감·이월을 계산한다.
        //    (클라가 props의 stale한 직전값으로 계산하던 과다 차감·덮어쓰기 버그 제거)
        const hubLoc = r.locations.find(l => l.isHub)
        const locationPatch = {
          checkedLocationId: locId!,
          afterQty: afterN ?? 0,
          restockedQty: restocked,
          hubLocationId: hubLoc?.id ?? null,
        }

        // 6h 이내 같은 날 기존 점검 존재 → 자동 머지
        const sameDay = r.lastCheckId && r.lastCheckCreatedAt && isSameKstDay(new Date(r.lastCheckCreatedAt), new Date())
        const within6h = r.lastCheckCreatedAt && (now - new Date(r.lastCheckCreatedAt).getTime()) < 6 * 3600_000
        const shouldMerge = forceMerge || (sameDay && within6h)

        if (shouldMerge && r.lastCheckId) {
          return updateStockCheck(r.lastCheckId, { locationPatch })
        }
        return createStockCheck({
          trackedItemId: r.id, date, remainingQty: 0, locationPatch,
          memo: `위치별 점검 (${locName})`,
        })
      }))
      // 점검 확정된 품목의 이 위치 드래프트 정리
      await Promise.all(toSave.map(r => deleteStockCheckDraft(r.id, locId)))
      onDraftChange?.()
      onDone()
      onClose()   // #4: 위치별 최종 저장 후 점검 창(위치 패널) 닫기
    } catch {
      setError('저장 중 오류가 발생했습니다.')
    } finally {
      setPending(false)
    }
  }

  const handleSave = async () => {
    const toSave = locItems.filter(isItemDirty)
    if (toSave.length === 0) { setError('저장할 수량이 없습니다.'); return }

    // 같은 날, 6h 초과 → 사용자 확인 필요
    const now = Date.now()
    const needsConfirm = toSave.filter(r =>
      r.lastCheckId && r.lastCheckCreatedAt &&
      isSameKstDay(new Date(r.lastCheckCreatedAt), new Date()) &&
      (now - new Date(r.lastCheckCreatedAt).getTime()) >= 6 * 3600_000
    )
    if (needsConfirm.length > 0 && mergeChoice === null) {
      setConfirmItems(needsConfirm)
      return
    }
    await doSave(mergeChoice === 'merge')
  }

  // 위치별 임시저장 — 입력값이 있는 품목별로 (품목, 이 위치) 드래프트 저장
  const handleSaveDraft = async () => {
    if (!locId) return
    const dirty = locItems.filter(r => {
      const { beforeStr, afterStr } = computeRow(r)
      return beforeStr !== '' || afterStr !== ''
    })
    if (dirty.length === 0) { setError('임시저장할 수량이 없습니다.'); return }
    setDraftPending(true); setError('')
    try {
      await Promise.all(dirty.map(r => {
        const { beforeStr, afterStr } = computeRow(r)
        return saveStockCheckDraft({
          trackedItemId: r.id, locationId: locId,
          data: { before: beforeStr, after: afterStr, date, savedAt: Date.now() },
        })
      }))
      pushToast('success', `${dirty.length}품목 임시저장됨`)
      onDraftChange?.()
    } catch {
      setError('임시저장 중 오류가 발생했습니다.')
    } finally {
      setDraftPending(false)
    }
  }

  const selectCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'
  const qtyInputCls = 'w-full min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <div
      className={inline ? undefined : 'fixed inset-0 bg-black/70 z-[230] flex items-end sm:items-center justify-center'}
      onClick={inline ? undefined : onClose}
    >
      <div
        className={inline
          ? 'bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl w-full flex flex-col'
          : 'bg-[var(--cream)] border border-[var(--warm-border)] rounded-t-2xl sm:rounded-2xl w-full max-w-md flex flex-col max-h-[85vh]'}
        onClick={inline ? undefined : (e => e.stopPropagation())}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div>
            <h2 className="text-sm font-bold text-[var(--warm-dark)]">위치별 점검</h2>
            <p className="text-[0.6875rem] text-[var(--warm-muted)] mt-0.5">
              {isHubLocation
                ? '창고(허브) 점검 — 현재 잔량만 입력합니다.'
                : '각 품목의 보충 전·후를 입력하면 늘어난 만큼 창고(허브)에서 옮겨진 것으로 자동 차감됩니다.'}
            </p>
          </div>
          {!inline && (
            <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl w-11 h-11 flex items-center justify-center">✕</button>
          )}
        </div>

        <div className="px-5 py-3 border-b border-[var(--warm-border)] shrink-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">점검 위치</p>
              <select value={locId} onChange={e => setLocId(e.target.value)} className={selectCls}>
                <option value="">위치 선택…</option>
                {locs.map(l => <option key={l.id} value={l.id}>{l.name}{l.isHub ? ' (허브)' : ''}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">점검일</p>
              <DatePicker value={date} onChange={setDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
          </div>
        </div>

        <div className={inline ? 'px-5 py-3 space-y-3' : 'flex-1 overflow-y-auto px-5 py-3 space-y-3'}>
          {!locId ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">위치를 선택하면 해당 위치에 보관된 품목이 표시됩니다.</p>
          ) : locItems.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">이 위치에 배정된 품목이 없습니다.</p>
          ) : (
            locItems.map(r => {
              const stockUnit = r.trackUnit === 'qty' ? r.qtyUnit : (r.specUnit ?? r.qtyUnit)
              const prev = r.lastCheckLocationBreakdown.find(lb => lb.locationId === locId)
              const { beforeStr, afterStr, restocked } = computeRow(r)
              return (
                <div key={r.id} className="space-y-1 border-b border-[var(--warm-border)]/40 pb-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--warm-dark)] truncate">{r.label}</p>
                      <p className="text-[0.625rem] text-[var(--warm-muted)]">{r.category}</p>
                    </div>
                    <div className="flex items-baseline gap-1.5 shrink-0">
                      {restocked > 0 && !isHubLocation && (
                        <span className="text-[0.625rem] text-[var(--coral)]">창고 → +{Math.round(restocked * 100) / 100}</span>
                      )}
                      {prev != null && (
                        <span className="text-[0.625rem] text-[var(--warm-muted)]">이전 {prev.qty}{stockUnit ?? ''}</span>
                      )}
                    </div>
                  </div>
                  {isHubLocation ? (
                    // 허브 위치 점검 — 잔량 1칸
                    <div className="flex items-center gap-1.5">
                      <p className="text-[0.5625rem] text-[var(--warm-muted)] shrink-0 w-16">잔량</p>
                      <input type="text" inputMode="decimal" placeholder="0"
                        value={afterStr}
                        onChange={e => setAfterQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className={qtyInputCls} />
                      <span className="text-[0.625rem] text-[var(--warm-muted)] w-6 shrink-0 text-right">{stockUnit ?? ''}</span>
                    </div>
                  ) : (
                    // 비허브 위치 점검 — 보충 전 / 보충 후
                    <div className="grid grid-cols-2 gap-1.5">
                      <div>
                        <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 전</p>
                        <input type="text" inputMode="decimal" placeholder="0"
                          value={beforeStr}
                          onChange={e => setBeforeQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                          className={qtyInputCls} />
                      </div>
                      <div>
                        <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 후</p>
                        <input type="text" inputMode="decimal" placeholder="0"
                          value={afterStr}
                          onChange={e => setAfterQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                          className={qtyInputCls} />
                      </div>
                    </div>
                  )}
                </div>
              )
            })
          )}
          {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {locId && locItems.length > 0 && !isHubLocation && totalRestock > 0 && (
          <div className="border-t border-[var(--coral)]/20 bg-[var(--coral)]/5 px-5 py-2 shrink-0">
            <p className="text-[0.6875rem] text-[var(--warm-mid)]">
              창고 → 이동 합계 <strong className="text-[var(--coral)]">+{Math.round(totalRestock * 100) / 100}</strong> · 각 품목의 창고(허브) 잔량에서 자동 차감됩니다.
            </p>
          </div>
        )}

        {confirmItems.length > 0 && mergeChoice === null && (
          <div className="border-t border-[var(--honey)]/40 bg-[var(--honey)]/10 px-5 py-3 shrink-0 space-y-2">
            <p className="text-xs font-medium text-[var(--ink)]">
              {confirmItems.length}개 품목에 오늘 이미 점검 기록이 있습니다. 기존 기록에 합칠까요?
            </p>
            <div className="flex gap-2">
              <Btn variant="secondary" size="sm" fullWidth onClick={() => { setMergeChoice('new'); doSave(false) }}>새 기록으로</Btn>
              <Btn variant="primary" size="sm" fullWidth onClick={() => { setMergeChoice('merge'); doSave(true) }}>기존에 합치기</Btn>
            </div>
          </div>
        )}
        <div className="border-t border-[var(--warm-border)] px-5 py-3 flex gap-2 shrink-0">
          {!inline && <Btn variant="secondary" fullWidth onClick={onClose}>취소</Btn>}
          <Btn variant="secondary" fullWidth onClick={handleSaveDraft} disabled={draftPending || pending || !locId || locItems.length === 0}>
            {draftPending ? '저장 중…' : '임시저장'}
          </Btn>
          <Btn variant="primary" fullWidth onClick={handleSave} disabled={pending || !locId || locItems.length === 0}>
            {pending ? '저장 중...' : `${locItems.filter(isItemDirty).length}품목 저장`}
          </Btn>
        </div>
      </div>
    </div>
  )
}

// ── 병합 확인 모달 ──────────────────────────────────────────
// 자동등록에서 후보가 있는 새 라벨들 — 기존 카드에 합칠지 / 새로 등록할지 선택.
function MergeDecisionModal({ decisions, onClose, onDone }: {
  decisions: MergeDecision[]; onClose: () => void; onDone: () => void
}) {
  // 결정별 선택값: 대상 itemId 또는 '__new__'. 기본은 첫 후보(합치기)에 둠 — 사용자가 확인.
  const [choices, setChoices] = useState<Record<number, string>>(
    () => Object.fromEntries(decisions.map((d, i) => [i, d.candidates[0]?.itemId ?? '__new__'])),
  )
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const apply = async () => {
    setPending(true); setError('')
    const release = trackSave()
    try {
      for (let i = 0; i < decisions.length; i++) {
        const d = decisions[i]
        const choice = choices[i] ?? '__new__'
        const res = choice === '__new__'
          ? await applyMergeDecision({
              category: d.category, newLabel: d.newLabel, expenseIds: d.expenseIds,
              specUnit: d.specUnit, qtyUnit: d.qtyUnit,
              choice: { kind: 'new', declinedItemIds: d.candidates.map(c => c.itemId) },
            })
          : await applyMergeDecision({
              category: d.category, newLabel: d.newLabel, expenseIds: d.expenseIds,
              choice: { kind: 'merge', targetItemId: choice },
            })
        if (!res.ok) { setError(res.error); pushToast('error', res.error); setPending(false); release(); return }
      }
      pushToast('success', '병합 처리 완료')
      onDone()
    } catch {
      setError('처리 중 오류가 발생했습니다.'); setPending(false)
    } finally {
      release()
    }
  }

  return (
    <Modal open onClose={onClose} width="md" title="병합 확인"
      subtitle="새로 들어온 품목을 기존 카드에 합칠지 선택하세요"
      footer={
        <div className="flex gap-2">
          <Btn variant="secondary" onClick={onClose} disabled={pending} fullWidth>취소</Btn>
          <Btn variant="primary" onClick={apply} disabled={pending} fullWidth>{pending ? '처리 중…' : '적용'}</Btn>
        </div>
      }>
      <div className="px-5 sm:px-6 py-4 space-y-4">
        {error && <p className="text-xs text-red-500">{error}</p>}
        {decisions.map((d, i) => (
          <div key={i} className="space-y-2 border-b border-[var(--warm-border)]/50 pb-3 last:border-0">
            <p className="text-sm font-medium text-[var(--warm-dark)]">
              <span className="text-[var(--coral)]">{d.newLabel}</span>
              <span className="text-[0.625rem] text-[var(--warm-muted)] ml-1.5">{d.category} · 지출 {d.expenseIds.length}건</span>
            </p>
            <div className="space-y-1.5">
              {d.candidates.map(c => (
                <label key={c.itemId} className="flex items-center gap-2 text-sm text-[var(--warm-dark)] cursor-pointer">
                  <input type="radio" name={`merge-${i}`} checked={choices[i] === c.itemId}
                    onChange={() => setChoices(p => ({ ...p, [i]: c.itemId }))} />
                  <span>기존 <strong>{c.label}</strong>에 합치기</span>
                </label>
              ))}
              <label className="flex items-center gap-2 text-sm text-[var(--warm-mid)] cursor-pointer">
                <input type="radio" name={`merge-${i}`} checked={choices[i] === '__new__'}
                  onChange={() => setChoices(p => ({ ...p, [i]: '__new__' }))} />
                <span>새 품목으로 등록 <span className="text-[0.625rem] text-[var(--warm-muted)]">(다음부턴 안 물어봄)</span></span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

// ── 병합 규칙 관리 모달 ─────────────────────────────────────
// 자동등록 추천(LINK) / 거절(MUTE) 기록 관리. 거절은 '다시 추천 받기'로 되돌릴 수 있음.
function MergeRulesModal({ onClose }: { onClose: () => void }) {
  const [rules, setRules] = useState<MergeRuleRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const load = () => getMergeRules().then(r => { setRules(r); setLoading(false) })
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const remove = (id: string) => {
    setPendingId(id)
    deleteMergeRule(id).then(res => {
      setPendingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '규칙 삭제됨')
      load()
    })
  }

  const links = rules.filter(r => r.kind === 'LINK')
  const mutes = rules.filter(r => r.kind === 'MUTE')

  return (
    <Modal open onClose={onClose} width="md" title="병합 규칙"
      subtitle="자동등록 시 추천(연결)·거절(다시 안 물어봄) 기록">
      <div className="px-5 sm:px-6 py-4 space-y-4">
        {loading ? <Loading /> : rules.length === 0 ? (
          <EmptyState title="병합 규칙이 없습니다"
            description="품목을 병합하거나, 자동등록 확인에서 '새 품목으로'를 고르면 여기에 규칙이 쌓입니다." />
        ) : (
          <>
            {links.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--warm-mid)]">연결 — 이 라벨은 해당 카드로 추천</p>
                {links.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-sm bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[var(--warm-dark)]">
                      <strong>{r.sourceLabel}</strong> → {r.targetLabel ?? <span className="text-[var(--warm-muted)]">(삭제된 카드)</span>}
                    </span>
                    <span className="text-[0.5625rem] text-[var(--warm-muted)] shrink-0">{r.category}</span>
                    <button type="button" onClick={() => remove(r.id)} disabled={pendingId === r.id}
                      className="text-[0.6875rem] text-red-400 hover:text-red-600 disabled:opacity-40 shrink-0 px-2 py-1 rounded-lg hover:bg-red-50">연결 해제</button>
                  </div>
                ))}
              </div>
            )}
            {mutes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--warm-mid)]">거절 — 다시 추천 안 함</p>
                {mutes.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-sm bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[var(--warm-dark)]">
                      <strong>{r.sourceLabel}</strong> ✕ {r.targetLabel ?? <span className="text-[var(--warm-muted)]">(삭제된 카드)</span>}
                    </span>
                    <span className="text-[0.5625rem] text-[var(--warm-muted)] shrink-0">{r.category}</span>
                    <button type="button" onClick={() => remove(r.id)} disabled={pendingId === r.id}
                      className="text-[0.6875rem] text-[var(--coral)] hover:underline disabled:opacity-40 shrink-0 px-2 py-1 rounded-lg">다시 추천 받기</button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

// ── 제외 항목 복구 모달 ─────────────────────────────────────
// 병합·삭제로 재고 추적에서 빠진 품목을 다시 활성화합니다.
function ExcludedItemsModal({ onClose }: { onClose: () => void }) {
  type ArchivedItem = { id: string; category: string; label: string; specUnit: string | null; qtyUnit: string | null; expenseCount: number }
  const [items, setItems]   = useState<ArchivedItem[]>([])
  const [loading, setLoading] = useState(true)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    getArchivedTrackedItems().then(data => { setItems(data); setLoading(false) })
  }, [])

  const handleRestore = (id: string) => {
    startTransition(async () => {
      const res = await unarchiveTrackedItem(id)
      if (!res.ok) { pushToast('error', res.error); return }
      setItems(prev => prev.filter(i => i.id !== id))
      pushToast('success', '품목이 복구되었습니다.')
    })
  }

  return (
    <Modal open onClose={onClose} title="제외 항목 복구" subtitle="삭제·병합으로 재고 추적에서 제외된 품목을 다시 활성화합니다." width="sm">
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--warm-muted)] text-center py-8">제외된 품목이 없습니다.</p>
      ) : (
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {items.map(it => (
            <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2.5 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]">
              <div className="min-w-0">
                <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{it.label}</p>
                <p className="text-[0.6875rem] text-[var(--warm-muted)]">
                  {it.category}{it.specUnit ? ` · ${it.specUnit}` : ''}{it.qtyUnit ? ` · ${it.qtyUnit}` : ''}
                  {it.expenseCount > 0 && <span className="ml-1">· 관련 지출 {it.expenseCount}건</span>}
                </p>
              </div>
              <Btn variant="secondary" size="sm" onClick={() => handleRestore(it.id)} disabled={pending}>복구</Btn>
            </div>
          ))}
        </div>
      )}
      <ModalFooterActions>
        <Btn variant="secondary" onClick={onClose}>닫기</Btn>
      </ModalFooterActions>
    </Modal>
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
                  <button
                    type="button"
                    title={loc.isHub ? '허브(창고) 해제' : '허브(창고)로 지정'}
                    onClick={async () => {
                      setPending(true)
                      await toggleStorageLocationHub(loc.id, !loc.isHub)
                      reload()
                      setPending(false)
                    }}
                    className={`text-[0.625rem] px-2 py-1 rounded-lg border transition-colors ${loc.isHub ? 'bg-amber-50 border-amber-200 text-amber-700' : 'border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-amber-300 hover:text-amber-600'}`}>
                    {loc.isHub ? '허브 ✓' : '허브'}
                  </button>
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
            className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          <Btn type="submit" variant="primary" size="sm" disabled={pending || !newName.trim()}>추가</Btn>
        </form>
      </div>
      <div className="border-t border-[var(--warm-border)] px-5 sm:px-6 py-3 space-y-2">
        <p className="text-[0.625rem] text-[var(--warm-muted)]">
          <strong className="text-amber-600">허브</strong>로 지정한 위치(예: 창고)는 위치별 점검 시 "이동 수량" 입력란이 표시됩니다.
        </p>
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

  // 선택한 보관 위치가 처음 상태와 달라졌는지 — 달라졌으면 '위치 저장'을 강조
  const initialIds = initialLocations.map(l => l.id)
  const dirty =
    initialIds.length !== selected.size ||
    initialIds.some(id => !selected.has(id))

  return (
    <div className="space-y-2 pt-2 border-t border-[var(--warm-border)]/60">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--warm-mid)]">보관 위치</label>
        {saved && <span className="text-[0.625rem] text-emerald-600">저장됨</span>}
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
      <Btn
        type="button"
        variant={dirty && !saved ? 'primary' : 'secondary'}
        size="sm"
        onClick={handleSave}
        disabled={pending}
      >
        {pending ? '저장 중...' : '위치 저장'}
      </Btn>
      {dirty && !saved && (
        <p className="text-[0.625rem] text-[var(--coral)]">
          변경한 보관 위치는 위치 저장 버튼을 눌러야 반영됩니다.
        </p>
      )}
      <p className="text-[0.625rem] text-[var(--warm-muted)]">재고 점검 시 선택된 위치별로 잔량을 나눠서 입력할 수 있습니다.</p>
    </div>
  )
}

function AdditionForm({ item, onCancel, onDone }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
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
  // 입고 위치 — 위치가 1개뿐이면(허브든 일반이든) 기본 선택, 아니면 허브 우선 기본
  const defaultLocId = item.locations.length === 1
    ? item.locations[0].id
    : item.locations.find(l => l.isHub)?.id ?? ''
  const [storageLocationId, setStorageLocationId] = useState<string>(defaultLocId)
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
      const res = await createStockAddition({
        trackedItemId: item.id, date, addedQty: computed, source, memo: memo || undefined,
        storageLocationId: storageLocationId || null,
      })
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
              <label className="text-[0.625rem] text-[var(--warm-muted)]">규격</label>
              <div className="flex gap-1.5 items-center">
                <input type="text" inputMode="decimal" value={specQty}
                  onChange={e => setSpecQty(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)] shrink-0">{item.specUnit}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[0.625rem] text-[var(--warm-muted)]">수량</label>
              <div className="flex gap-1.5 items-center">
                <input type="text" inputMode="decimal" value={packQty}
                  onChange={e => setPackQty(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="1"
                  className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)] shrink-0">{item.qtyUnit ?? '개'}</span>
              </div>
            </div>
          </div>
          {computed > 0 && (
            <p className="text-[0.625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
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
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
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
      {item.locations.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">입고 위치</label>
          <select value={storageLocationId} onChange={e => setStorageLocationId(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]">
            <option value="">위치 없이 기록</option>
            {item.locations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}{loc.isHub ? ' (허브)' : ''}</option>
            ))}
          </select>
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
