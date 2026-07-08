'use client'

import { useEffect, useState, useTransition, useRef } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Loading } from '@/components/ui/Loading'
import { Modal, ModalFooterActions } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader, DotMarker } from '@/components/ui/inventory/SectionHeader'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { InventoryCard as InvCard } from '@/components/ui/inventory/InventoryCard'
import { MergeSheet, type MergeTarget } from '@/components/ui/inventory/MergeSheet'
import MonthSelector from '@/components/layout/MonthSelector'
import { kstYmdStr, kstMonthStr } from '@/lib/kstDate'
import { convertSpecValue, listCompatibleUnits, unitFactor } from '@/lib/units'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SpecWizard, type SpecWizardResult } from '@/components/ui/SpecWizard'
import { InfoHint } from '@/components/ui/InfoHint'
import { SearchBar } from '@/components/ui/SearchBar'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { type InventoryRow, type TimelineEntry, type PricePoint, type MonthlyInflowRow, type InventoryCategory, suggestInventoryAlias } from './constants'
import {
  getInventoryDetail,
  getPriceHistory,
  getMonthlyInflow,
  getSameCategoryItems,
  createTrackedItem,
  updateTrackedItem,
  changeTrackedItemUnit,
  archiveTrackedItem,
  getArchivedTrackedItems,
  unarchiveTrackedItem,
  mergeTrackedItems,
  createStockCheck,
  createStockAddition,
  updateStockCheck,
  saveFullReconcile,
  getStockAsOf,
  deleteStockCheck,
  deleteStockAddition,
  updateStockAddition,
  updateExpenseFromInventory,
  excludeExpenseFromInventory,
  includeExpenseInInventory,
  seedTrackedItemsFromExpenses,
  confirmReceipt,
  confirmAllPending,
  getStorageLocations,
  createStorageLocation,
  updateStorageLocation,
  deleteStorageLocation,
  toggleStorageLocationHub,
  setItemHub,
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
  getMergeUndos,
  unmergeTrackedItem,
  setInventoryCategories,
  getItemLocationStock, transferLocationStock, type ItemLocationStock,
} from './actions'
import { type StorageLocationItem, type LocationQtyEntry, type MergeDecision, type MergeRuleRow, type MergeUndoRow } from './constants'

// §14.1 — 카테고리 마커 색은 viz 팔레트 토큰만(새 hue 금지·§14.4). 틴트 bg는 color-mix 10%.
const vizTint = (v: string): { bg: string; fg: string } =>
  ({ bg: `color-mix(in srgb, var(${v}) 10%, transparent)`, fg: `var(${v})` })
const CATEGORY_TINT: Record<string, { bg: string; fg: string }> = {
  '소모품비':     vizTint('--viz-1'),   // terracotta (기존 persimmon 유지)
  '부식비':       vizTint('--viz-4'),   // amber
  '폐기물 처리비': vizTint('--viz-7'),  // sage (구 쿨블루 — §14.4 신규 hue 폐기)
}
// 사용자가 추가한 카테고리(수선유지비 등)용 폴백 팔레트 — cat 문자열 해시로 안정 배정.
const FALLBACK_TINTS: { bg: string; fg: string }[] = [
  vizTint('--viz-3'),   // warm olive
  vizTint('--viz-2'),   // camel
  vizTint('--viz-5'),   // deep wine
  vizTint('--viz-6'),   // dusty rose
]
const tintOf = (cat: string): { bg: string; fg: string } => {
  if (CATEGORY_TINT[cat]) return CATEGORY_TINT[cat]
  let h = 0
  for (let i = 0; i < cat.length; i++) h = (h * 31 + cat.charCodeAt(i)) >>> 0
  return FALLBACK_TINTS[h % FALLBACK_TINTS.length]
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

export default function InventoryClient({ initialRows, targetMonth, categories, allExpenseCategories }: { initialRows: InventoryRow[]; targetMonth: string; categories: InventoryCategory[]; allExpenseCategories: string[] }) {
  // 재고 카테고리(cat) → 표시 별칭(alias) 맵 + 카테고리 cat 목록(순서 보존)
  const aliasOf = (cat: string) => categories.find(c => c.cat === cat)?.alias ?? cat
  const trackedCats = categories.map(c => c.cat)
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
  const [openMenu, setOpenMenu]           = useState<'input' | 'manage' | null>(null)   // 헤더 그룹 버튼(입력·점검 / 관리·설정)
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
  // §22.1 메인 검색 — 품목명·카테고리·메모 대상. 품목별·위치별 두 보기와 수령 대기 목록에 동일 적용.
  const [search, setSearch] = useState('')
  const q = search.trim().toLowerCase()
  const visibleRows = q
    ? rows.filter(r => r.label.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || (r.memo ?? '').toLowerCase().includes(q))
    : rows
  const changeView = (m: 'item' | 'location') => {
    setViewMode(m)
    if (typeof window !== 'undefined') localStorage.setItem('stayeum-inventory-view', m)
    if (m === 'location') exitSelectMode()
  }
  const [showExcluded, setShowExcluded]     = useState(false)
  const [archivedCount, setArchivedCount]   = useState<number>(0)
  const refreshArchivedCount = () => getArchivedTrackedItems().then(d => setArchivedCount(d.length)).catch(() => {})
  useEffect(() => { refreshArchivedCount() }, [])


  // 점검 임시저장(드래프트)이 걸린 품목 id — 카드 '점검 중' 배지용
  const [draftIds, setDraftIds] = useState<Set<string>>(new Set())
  const refreshDrafts = () => getDraftItemIds().then(ids => setDraftIds(new Set(ids)))
  useEffect(() => { refreshDrafts() }, [])

  // 병합 확인 — 자동등록 후 후보가 있는 항목들 / 병합 규칙 관리 모달
  const [mergeDecisions, setMergeDecisions] = useState<MergeDecision[]>([])
  const [showMergeRules, setShowMergeRules] = useState(false)
  const [showReconcile, setShowReconcile]   = useState(false)
  const [showCatSettings, setShowCatSettings] = useState(false)

  // 수령 대기 — 비품·자재와 동일하게 상단 섹션에서 인라인 '수령 완료'로 통일 (#2)
  // 같은 품목 다건은 비품의 '합산 N건'처럼 묶어 한 번에 수령(키 = label|category).
  const [receivingKey, setReceivingKey] = useState<string | null>(null)
  const [pendExpanded, setPendExpanded] = useState<Set<string>>(new Set())
  const togglePendExpand = (key: string) => setPendExpanded(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
  })
  const handleQuickReceive = (key: string, expenseIds: string[]) => {
    setReceivingKey(key)
    const release = trackSave()
    // 같은 품목 다건은 순차 처리 — 각 수령이 허브에 자동 배치(점검 생성)되므로 동시 실행하면
    // 직전 점검을 같은 baseline 으로 읽어 입고분이 덮어써져(경합) 누락된다. 하나씩 쌓아 올린다.
    ;(async () => {
      let bad: { ok: false; error: string } | undefined
      for (const id of expenseIds) {
        const r = await confirmReceipt(id)
        if (!r.ok) { bad = r as { ok: false; error: string }; break }
      }
      if (bad) pushToast('error', bad.error)
      else { router.refresh(); pushToast('success', '수령 확인 완료') }
    })().finally(() => { setReceivingKey(null); release() })
  }

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  // 합치기 — §21.4 MergeSheet 단일. 선택한 품목들을 대표(남는 카드)로 합침(mergeTrackedItems).
  const [sheet, setSheet] = useState<{ sourceLabel: string; targets: MergeTarget[]; onConfirm: (destId: string) => void } | null>(null)
  const runMergeTracked = (destId: string, srcIds: string[], destLabel: string) => {
    if (srcIds.length === 0) { pushToast('error', '대표 외 합칠 품목을 더 선택하세요.'); return }
    startTransition(async () => {
      let ok = 0
      for (const srcId of srcIds) { const res = await mergeTrackedItems(srcId, destId, true); if (res.ok) ok++ }
      setSheet(null); exitSelectMode()
      pushToast(ok === srcIds.length ? 'success' : 'error', `'${destLabel}'(으)로 ${ok}개 합쳐짐`)
      router.refresh()
    })
  }
  const openSelectionMerge = () => {
    const sel = rows.filter(r => selected.has(r.id))
    setSheet({
      sourceLabel: `선택 ${sel.length}개`,
      targets: sel.map(r => ({ id: r.id, label: r.label })),
      onConfirm: destId => runMergeTracked(destId, sel.filter(r => r.id !== destId).map(r => r.id), sel.find(r => r.id === destId)?.label ?? ''),
    })
  }

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

  // 카테고리별 그룹 — 설정된 카테고리 순서 + 표시 별칭. 설정 밖 카테고리(과거 등록분)는 뒤에 자체 표시.
  const extraCats = Array.from(new Set(rows.map(r => r.category))).filter(c => !trackedCats.includes(c))
  const grouped = [...trackedCats, ...extraCats].map(cat => ({
    cat,
    alias: aliasOf(cat),
    rows: visibleRows.filter(r => r.category === cat),
  }))

  return (
    <div className="space-y-4">
      {/* 동일 레벨 탭 — 소모품·부식(기본) / 비품·자재 + 월 전환(재고는 월별 이월·소비 데이터)
          §24.6: 모바일=탭 윗줄·MonthSelector 아랫줄 고정(2줄), md=한 줄 justify-between.
          flex-wrap 임계에 맡기면 과거월 배지 유무로 줄바꿈이 출렁여 탭바 높이가 페이지·상태마다 달라짐. */}
      {/* items-start: flex-col 자식 stretch로 탭바가 풀폭으로 늘어나는 것 방지(자재 탭과 내용폭 동일하게) */}
      <div className="flex flex-col items-start gap-2 md:flex-row md:justify-between">
        <ViewTabs ariaLabel="재고 탭" activeId="consumables" tabs={[
          { id: 'consumables', label: '소모품·부식', href: '/inventory' },
          { id: 'assets',      label: '비품·자재',   href: '/inventory/assets' },
        ]} />
        {/* 월 셀렉터는 전 페이지 우측 통일 — 모바일 아랫줄에서도 우측 정렬(운영자 지적) */}
        <div className="self-end md:self-auto"><MonthSelector /></div>
      </div>
      <div className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="text-xl font-bold text-[var(--warm-dark)]">재고 관리 · 소모품·부식
              <InfoHint title="소모품·부식 재고란?">부식·소모품·폐기물 사용량을 점검(실사) 기록 기반으로 추적합니다. 구매는 수령 확인 시 더해지고, 소모량은 두 점검 사이의 차이로 계산되므로 주기적으로 점검을 기록해 주세요.</InfoHint>
            </h1>
          </div>
          {/* 점검 진입 방식 토글 — §22.2 트랙형(보기 방식). 지출 '아이템별/주문별'과 동일 컴포넌트 */}
          <SegmentedControl size="sm" ariaLabel="점검 보기" className="shrink-0"
            value={viewMode} onChange={changeView}
            options={[{ value: 'item', label: '아이템별' }, { value: 'location', label: '위치별' }]} />
        </div>
        {viewMode === 'item' && (
          <div className="flex gap-2 flex-wrap items-center">
            <Btn variant="secondary" size="md" onClick={() => { selectMode ? exitSelectMode() : setSelectMode(true) }}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
            {/* 성격별 그룹 버튼 — 잡동사니 더보기 대신 기능군마다 버튼 + 하위 메뉴(운영자 지시 2026-07-06) */}
            <div className="relative">
              <Btn variant="secondary" size="md" onClick={() => setOpenMenu(v => v === 'input' ? null : 'input')}>입력·점검</Btn>
              {openMenu === 'input' && (
                <>
                  <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setOpenMenu(null)} />
                  <div className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-1.5 shadow-lift">
                    <button type="button" disabled={seedPending || isPending} onClick={() => { setOpenMenu(null); handleSeed() }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)] disabled:opacity-50">{seedPending ? '처리 중…' : '과거 지출 일괄 불러오기'}<span className="block text-[0.625rem] text-[var(--warm-muted)]">새 지출은 저장 시 자동 등록됩니다</span></button>
                    <button type="button" onClick={() => { setOpenMenu(null); setShowReconcile(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">전체 재고 보정<span className="block text-[0.625rem] text-[var(--warm-muted)]">실제와 다를 때 실측값으로 리셋</span></button>
                  </div>
                </>
              )}
            </div>
            <div className="relative">
              <Btn variant="secondary" size="md" onClick={() => setOpenMenu(v => v === 'manage' ? null : 'manage')}>관리·설정</Btn>
              {openMenu === 'manage' && (
                <>
                  <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setOpenMenu(null)} />
                  <div className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-1.5 shadow-lift">
                    <button type="button" onClick={() => { setOpenMenu(null); setShowLocations(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">위치 관리</button>
                    <button type="button" onClick={() => { setOpenMenu(null); setShowCatSettings(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">카테고리 설정</button>
                    <button type="button" onClick={() => { setOpenMenu(null); setShowExcluded(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">숨김 품목{archivedCount > 0 ? ` (${archivedCount})` : ''}</button>
                    <button type="button" onClick={() => { setOpenMenu(null); setShowMergeRules(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">병합 적용취소·규칙<span className="block text-[0.625rem] text-[var(--warm-muted)]">갈라진 품목명 통일 관리</span></button>
                  </div>
                </>
              )}
            </div>
            <Btn variant="primary" size="md" onClick={() => setShowAdd(true)}>+ 품목 추가</Btn>
          </div>
        )}
      </div>

      {/* §22.1 메인 검색 — 헤더 아래 풀폭. 모달 안이 아니라 목록 상단에서 바로 좁힌다. */}
      <SearchBar value={search} onChange={setSearch} placeholder="품목명, 카테고리, 메모 검색" />

      {/* 검색 무결과 — §22.2 분기 */}
      {q && visibleRows.length === 0 && rows.length > 0 && (
        <EmptyState title="검색 결과가 없습니다" description="다른 검색어로 시도해 보세요." />
      )}

      {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}

      {viewMode === 'location' ? (
        <LocationBatchCheckModal inline rows={visibleRows} onClose={() => changeView('item')} onDone={() => { router.refresh(); refreshDrafts() }} onDraftChange={refreshDrafts} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="추적할 품목이 아직 없습니다"
          description="'지출에서 자동 등록' 버튼을 누르면 부식·소모품·폐기물 카테고리에서 입력된 품목이 자동 등록됩니다."
        />
      ) : (
        <>
        {(() => {
          const flat = visibleRows.flatMap(r => r.pendingPurchases.map(p => ({ p, label: r.label, category: r.category, qtyUnit: r.qtyUnit, trackUnit: r.trackUnit, specUnit: r.specUnit })))
          if (flat.length === 0) return null
          // 수령 대기 수량도 재고 계산(overview sumPurchases)과 동일 기준으로 규격 환산:
          // spec 추적 품목은 qtyValue × specValue (예: 40개입 3박스 → 120개). 단위는 specUnit.
          const usesSpec = (trackUnit: string, specValue: number | null) => trackUnit !== 'qty' && !!specValue && specValue > 0
          const specQtyOf = (qtyValue: number, specValue: number | null, trackUnit: string) =>
            usesSpec(trackUnit, specValue) ? qtyValue * (specValue as number) : qtyValue
          // 같은 품목(label|category)끼리 묶기 — 비품의 '합산 N건'과 동일 패턴
          const groupMap = new Map<string, { key: string; label: string; category: string; qtyUnit: string | null; trackUnit: 'spec' | 'qty'; specUnit: string | null; items: typeof flat }>()
          for (const f of flat) {
            const key = `${f.label}␟${f.category}`
            const g = groupMap.get(key) ?? { key, label: f.label, category: f.category, qtyUnit: f.qtyUnit, trackUnit: f.trackUnit, specUnit: f.specUnit, items: [] as typeof flat }
            g.items.push(f); groupMap.set(key, g)
          }
          const groups = [...groupMap.values()]
          const totalAmt = flat.reduce((s, f) => s + (f.p.amount || 0), 0)
          return (
            <section className="space-y-2">
              {/* 헤더 스타일 — 비품·자재 '수령 대기'와 동일 (#2 통일) */}
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                수령 대기 <span className="text-[0.625rem] text-[var(--coral)] font-normal">도착 전</span> <span className="text-[var(--warm-muted)] font-normal">{flat.length}건{totalAmt > 0 ? ` · ${fmtWon(totalAmt)}` : ''}</span>
              </h2>
              <ul className="space-y-1.5">
                {groups.map(g => {
                  // 규격 환산 합계(재고 단위) + 원래 박스 수 — 예: "120개 (3박스)"
                  const totalQty = g.items.reduce((s, f) => s + specQtyOf(f.p.qtyValue || 0, f.p.specValue, g.trackUnit), 0)
                  const unit = g.trackUnit === 'qty' ? (g.qtyUnit ?? '개') : (g.specUnit ?? g.qtyUnit ?? '개')
                  const rawBoxSum = g.items.reduce((s, f) => s + (f.p.qtyValue || 0), 0)
                  const boxUnit = g.items[0].p.qtyUnit
                  const specApplied = g.items.some(f => usesSpec(g.trackUnit, f.p.specValue))
                  const qtyLabel = specApplied && boxUnit ? `${totalQty}${unit} (${rawBoxSum}${boxUnit})` : `${totalQty}${unit}`
                  const latest = g.items.reduce((dt, f) => (f.p.date > dt ? f.p.date : dt), g.items[0].p.date)
                  const ld = new Date(latest)
                  const ids = g.items.map(f => f.p.id)
                  const expanded = pendExpanded.has(g.key)
                  return (
                    <li key={g.key} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[var(--warm-dark)] truncate">{g.label}{totalQty ? ` · ${qtyLabel}` : ''}</p>
                          <p className="text-[0.625rem] text-[var(--warm-muted)] truncate">{ld.getMonth() + 1}/{ld.getDate()} · {g.category}</p>
                          {g.items.length > 1 && (
                            <button type="button" onClick={() => togglePendExpand(g.key)} className="mt-0.5 min-h-[34px] inline-flex items-center -my-1.5 text-[0.625rem] text-[var(--coral)] hover:underline">
                              구매 {g.items.length}건 합산 {expanded ? '▾ 접기' : '▸ 펼치기'}
                            </button>
                          )}
                        </div>
                        <button type="button" onClick={() => handleQuickReceive(g.key, ids)} disabled={receivingKey === g.key}
                          className="shrink-0 text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-white hover:opacity-90 transition-opacity disabled:opacity-40">
                          {receivingKey === g.key ? '처리 중' : '수령 완료'}
                        </button>
                      </div>
                      {g.items.length > 1 && expanded && (
                        <ul className="mt-1.5 pl-2.5 border-l-2 border-[var(--warm-border)] space-y-0.5">
                          {g.items.map(f => {
                            const fd = new Date(f.p.date)
                            const sq = specQtyOf(f.p.qtyValue || 0, f.p.specValue, g.trackUnit)
                            const su = g.trackUnit === 'qty' ? (g.qtyUnit ?? f.p.qtyUnit ?? '개') : (g.specUnit ?? '개')
                            const qstr = f.p.qtyValue
                              ? (usesSpec(g.trackUnit, f.p.specValue) && f.p.qtyUnit ? ` · ${sq}${su} (${f.p.qtyValue}${f.p.qtyUnit})` : ` · ${sq}${su}`)
                              : ''
                            return (
                              <li key={f.p.id} className="flex items-baseline justify-between gap-2 text-[0.6875rem] text-[var(--warm-muted)]">
                                <span className="tabular-nums">{fd.getMonth() + 1}/{fd.getDate()}{qstr}{f.p.vendor ? ` · ${f.p.vendor}` : ''}</span>
                                <span className="tabular-nums">{fmtWon((f.p.amount ?? 0))}</span>
                              </li>
                            )
                          })}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })()}
        {grouped.map(g => g.rows.length > 0 && (
          <section key={g.cat} className="space-y-2">
            <SectionHeader marker={<DotMarker color={tintOf(g.cat).fg} />} name={g.alias} count={`${g.rows.length}품목`} />
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.rows.map(r => (
                <InventoryCard
                  key={r.id}
                  row={r}
                  selectMode={selectMode}
                  isSelected={selected.has(r.id)}
                  hasDraft={draftIds.has(r.id)}
                  onOpen={() => selectMode ? toggleSelect(r.id) : setDetailId(r.id)}
                  onLongPress={!selectMode ? () => { setSelectMode(true); toggleSelect(r.id) } : undefined}
                  onArchive={async () => {
                    if (!(await confirmDialog({ title: `'${r.label}' 품목을 숨길까요?`, message: '카드 목록에서 사라집니다. 점검·구매·지출 기록은 모두 보존되며, 헤더의 "숨김 품목"에서 언제든 복구할 수 있습니다.', confirmLabel: '숨김' }))) return
                    const res = await archiveTrackedItem(r.id)
                    if (res.ok) { refreshArchivedCount(); router.refresh(); pushToast('success', '품목 숨김 처리됨') }
                    else { pushToast('error', res.error) }
                  }}
                />
              ))}
            </div>
          </section>
        ))}
        </>
      )}

      {showExcluded  && <ExcludedItemsModal onClose={() => { setShowExcluded(false); refreshArchivedCount(); router.refresh() }} />}
      {showLocations && <LocationSettingsModal onClose={() => { setShowLocations(false); router.refresh() }} />}
      {mergeDecisions.length > 0 && (
        <MergeDecisionModal
          decisions={mergeDecisions}
          onClose={() => setMergeDecisions([])}
          onDone={() => { setMergeDecisions([]); router.refresh() }}
        />
      )}
      {showMergeRules && <MergeRulesModal onClose={() => { setShowMergeRules(false); router.refresh() }} />}
      {showReconcile && <FullReconcileModal rows={rows} categories={categories} onClose={() => setShowReconcile(false)} onDone={() => { setShowReconcile(false); pushToast('success', '전체 재고 보정 완료'); router.refresh() }} />}
      {showAdd && <AddItemModal categories={categories} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); router.refresh() }} />}
      {showCatSettings && <InventoryCategorySettingsModal categories={categories} allExpenseCategories={allExpenseCategories} onClose={() => setShowCatSettings(false)} onDone={() => { setShowCatSettings(false); router.refresh() }} />}
      {showBatchLoc && (
        <BatchLocationModal
          selectedIds={Array.from(selected)}
          onClose={() => setShowBatchLoc(false)}
          onDone={() => { setShowBatchLoc(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 선택 모드 하단 알약 — §21.3 SelectionPillBar (탭 공용) */}
      {selectMode && selected.size > 0 && (
        <SelectionPillBar count={selected.size} onClose={exitSelectMode}>
          <PillButton primary onClick={() => setShowBatchLoc(true)}>위치 일괄 할당</PillButton>
          {selected.size >= 2 && <PillButton onClick={openSelectionMerge}>합치기</PillButton>}
        </SelectionPillBar>
      )}

      {/* 합치기 — §21.4 MergeSheet 단일(선택 알약·상세 공용). 방향 고지 + §10 적용취소 */}
      {sheet && (
        <MergeSheet open onClose={() => setSheet(null)}
          sourceLabel={sheet.sourceLabel} targets={sheet.targets}
          description="대표(남을 카드) 기준으로 합쳐집니다. 지출·점검·무상입수 기록이 대표로 이동하고 나머지 카드는 사라집니다. 적용취소는 ‘병합 적용취소·규칙’."
          onConfirm={sheet.onConfirm} pending={isPending} />
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

function InventoryCard({ row, onOpen, onArchive, selectMode, isSelected, hasDraft, onLongPress }: { row: InventoryRow; onOpen: () => void; onArchive?: () => void; selectMode?: boolean; isSelected?: boolean; hasDraft?: boolean; onLongPress?: () => void }) {
  const [open, setOpen] = useState(false)   // 지표·추이 펼치기
  const tint = tintOf(row.category)
  const lowStock = row.daysUntilEmpty != null && row.daysUntilEmpty <= row.alertThresholdDays
  // 당분간 사용 안 함 후보: 현재 잔량 0 + 수령 대기 0 + 점검 기록 있음(신규는 제외)
  const suggestHide = !selectMode && row.currentStock === 0 && row.pendingPurchases.length === 0 && row.lastCheckDate != null
  // trackUnit='qty' (폐기물 봉투 등): 매 단위 그대로. 'spec': specUnit 우선
  const stockUnit = row.trackUnit === 'qty' ? row.qtyUnit : (row.specUnit ?? row.qtyUnit)
  const priceUnit = row.trackUnit === 'qty' ? row.qtyUnit : (row.specUnit ?? row.qtyUnit)
  return (
    <InvCard
      selectable={selectMode} selected={isSelected}
      onToggleSelect={onOpen} onClick={onOpen} onLongPress={onLongPress} attn={lowStock}
      title={row.label}
      badges={<>
        {hasDraft && <Badge tone="inspect">점검 중</Badge>}
        {lowStock && <Badge tone="danger" mono>소진 임박</Badge>}
        {row.pendingPurchases.length > 0 && <Badge tone="warn" mono>{row.pendingPurchases.length}건 수령대기</Badge>}
      </>}
      meta={<span style={{ color: tint?.fg }}>{row.category}</span>}
      value={fmtQty(row.currentStock, stockUnit)}
      valueDanger={lowStock}
      valueSub={row.daysUntilEmpty != null ? `소진 D-${row.daysUntilEmpty}` : undefined}
      expanded={open}
      actions={<>
        <button type="button" onClick={() => setOpen(v => !v)}
          className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
          {open ? '지표 접기' : '지표·추이'}
        </button>
        {suggestHide && onArchive && (
          <button type="button" onClick={onArchive}
            className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--coral)]/40 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors">
            숨기기
          </button>
        )}
      </>}
      expand={<div className="space-y-3">
      <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
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
              ? `${fmtWon(Math.round(row.avgUnitPrice))}${priceUnit ? `/${priceUnit}` : ''}`
              : '—'}
          </p>
          {row.lastUnitPrice != null && row.lastUnitPrice !== row.avgUnitPrice && (
            <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">
              최근 {fmtWon(Math.round(row.lastUnitPrice))}{priceUnit ? `/${priceUnit}` : ''}
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
      {row.purchaseUrl && (
        <a href={row.purchaseUrl} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 self-start text-[0.625rem] text-[var(--coral)] bg-[var(--coral)]/5 hover:bg-[var(--coral)]/10 border border-[var(--coral)]/30 rounded-lg px-2 py-1 leading-none transition-colors">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/>
            <line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
          구매 페이지 열기
        </a>
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
      {/* 월별 사용량 — 최근 6개월 막대 (사용량 0인 달은 빈 막대로 표시) */}
      {row.monthlyConsumption && row.monthlyConsumption.some(m => m.qty > 0) && (
        <div className="pt-1.5 border-t border-[var(--warm-border)]/60">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[0.625rem] text-[var(--warm-muted)]">월별 사용량 (최근 6개월)</span>
            <span className="text-[0.5625rem] text-[var(--warm-muted)]">
              합계 {fmtQty(row.monthlyConsumption.reduce((s, m) => s + m.qty, 0), stockUnit)}
            </span>
          </div>
          {(() => {
            const max = Math.max(...row.monthlyConsumption.map(m => m.qty), 1)
            // 사용자 피드백 2026-06-01: '월별' 인데 합계만 보이면 의미 없음 → 각 월 숫자 노출.
            const fmtBarQty = (q: number): string => {
              if (q === 0) return ''
              // 1000 이상이면 'k' 축약 (예: 6270 → 6.3k)
              if (q >= 1000) return (q / 1000).toFixed(q >= 10000 ? 0 : 1) + 'k'
              if (q >= 100) return Math.round(q).toString()
              return q % 1 === 0 ? q.toString() : q.toFixed(1)
            }
            return (
              <div className="flex items-end gap-1">
                {row.monthlyConsumption.map(m => {
                  // 0 인 달도 시각적으로 자리를 차지하도록 최소 높이 12% placeholder.
                  const h = m.qty > 0 ? Math.max(12, Math.round((m.qty / max) * 100)) : 12
                  const monthNum = Number(m.month.slice(5))
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                      {/* 막대 위 숫자 — 0 이면 '·' 로 시각적 placeholder */}
                      <span className="text-[0.5625rem] font-medium leading-none tabular-nums"
                        style={{ color: m.qty > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>
                        {m.qty > 0 ? fmtBarQty(m.qty) : '·'}
                      </span>
                      <div className="w-full flex items-end" style={{ height: '24px' }}>
                        <div className="w-full rounded-sm transition-[width]"
                          title={`${monthNum}월: ${m.qty > 0 ? fmtQty(m.qty, stockUnit) : '기록 없음'}`}
                          style={{
                            height: `${h}%`,
                            background: m.qty > 0 ? 'var(--coral)' : 'var(--warm-border)',
                            opacity: m.qty > 0 ? 0.75 : 0.4,
                          }} />
                      </div>
                      <span className="text-[0.5rem] text-[var(--warm-muted)] leading-none">{monthNum}</span>
                    </div>
                  )
                })}
              </div>
            )
          })()}
        </div>
      )}
      </div>}
    />
  )
}

function AddItemModal({ categories, onClose, onDone }: { categories: InventoryCategory[]; onClose: () => void; onDone: () => void }) {
  const [category, setCategory] = useState<string>(categories[0]?.cat ?? '부식비')
  const [label, setLabel]       = useState('')
  const [specUnit, setSpecUnit] = useState('')
  const [qtyUnit, setQtyUnit]   = useState('')
  const [unitWizOpen, setUnitWizOpen] = useState(false)   // 단위 단계별 선택(포장형태→규격 단위)
  const applyUnitWizard = (r: SpecWizardResult) => { setQtyUnit(r.qtyUnit); setSpecUnit(r.specUnit) }
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
      <SpecWizard open={unitWizOpen} onClose={() => setUnitWizOpen(false)} onComplete={applyUnitWizard}
        itemLabel={label || undefined} unitsOnly z={260} />
      <form onSubmit={handleSubmit} id="add-tracked-item-form" className="px-5 sm:px-6 py-4 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
          <select value={category} onChange={e => setCategory(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none">
            {categories.map(c => <option key={c.cat} value={c.cat}>{c.alias}</option>)}
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
            <label className="text-xs font-medium text-[var(--warm-mid)]">용량 단위
              <button type="button" onClick={() => setUnitWizOpen(true)}
                className="ml-1.5 text-[0.625rem] font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-2">단계별 선택</button>
            </label>
            <input type="text" value={specUnit} onChange={e => setSpecUnit(e.target.value)} placeholder="m, L, kg"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">수량 단위</label>
            <input type="text" value={qtyUnit} onChange={e => setQtyUnit(e.target.value)} placeholder="롤, 매, 포대"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
          </div>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
          <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="선택"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
        </div>
        {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
  const [mode, setMode] = useState<'view' | 'check' | 'addition' | 'settings' | 'reconcile'>('view')
  const [tab, setTab]   = useState<'timeline' | 'monthly' | 'price'>('timeline')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [loadingId, setLoadingId] = useState<string | null>(null)
  const [hubOpen, setHubOpen] = useState(false)
  const changeItemHub = (locId: string | null) => {
    setHubOpen(false)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await setItemHub(trackedItemId, locId)
        if (res.ok) { reload(); onChange(); pushToast('success', '창고(허브) 변경됨') }
        else { setError(res.error); pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const reload = () => Promise.all([
    getInventoryDetail(trackedItemId).then(setData),
    getPriceHistory(trackedItemId).then(setPriceHistory),
    getMonthlyInflow(trackedItemId).then(setMonthlyInflow),
  ])
  useEffect(() => { reload() }, [trackedItemId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleArchive = async () => {
    if (!(await confirmDialog({ title: '이 품목을 숨길까요?', message: '재고 카드 목록에서 사라집니다 (당분간 사용하지 않을 품목용). 점검·무상입수·지출 기록은 모두 보존되며, 헤더의 "숨김 품목" 메뉴에서 언제든 복구할 수 있습니다.', confirmLabel: '숨김' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await archiveTrackedItem(trackedItemId)
        if (res.ok) { onChange(); onClose(); pushToast('success', '품목 숨김 처리됨') }
        else { setError(res.error); pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const handleDeleteCheck = async (id: string) => {
    if (!(await confirmDialog({ title: '이 점검 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    setLoadingId(id)
    const release = trackSave()
    deleteStockCheck(id).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '점검 기록 삭제됨') }).finally(release) }
      else { setLoadingId(null); setError(res.error); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); release() })
  }

  const handleDeleteAddition = async (id: string) => {
    if (!(await confirmDialog({ title: '이 입수 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    setLoadingId(id)
    const release = trackSave()
    deleteStockAddition(id).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '입수 기록 삭제됨') }).finally(release) }
      else { setLoadingId(null); setError(res.error); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); release() })
  }

  const handleConfirmReceipt = (expenseId: string, locationId?: string, qty?: number) => {
    setLoadingId(expenseId)
    const release = trackSave()
    confirmReceipt(expenseId, locationId, qty).then(res => {
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
          <Btn variant="secondary" size="sm" onClick={handleArchive} disabled={pending}>숨김</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setMode('settings')}>설정</Btn>
          <div className="flex-1" />
          <Btn variant="secondary" size="sm" onClick={() => setMode('reconcile')}>보정 끼워넣기</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setMode('addition')}>+ 무상 입수</Btn>
          <Btn variant="primary" size="sm" onClick={() => setMode('check')}>재고 점검</Btn>
        </div>
      ) : undefined}
    >
      {!data ? (
        <Loading />
      ) : mode === 'check' ? (
        <CheckForm item={data.item} lastCheckBreakdown={row.lastCheckLocationBreakdown} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} onDraftChange={onDraftChange} />
      ) : mode === 'reconcile' ? (
        <TimelineReconcileForm
          item={data.item}
          existingCheckDays={Array.from(new Set(data.timeline.filter(e => e.type === 'check').map(e => new Date(new Date(e.date).getTime() + 9 * 3600000).toISOString().slice(0, 10))))}
          onCancel={() => setMode('view')}
          onDone={() => { setMode('view'); reload(); onChange() }} />
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
            {row.locations.length > 0 && (() => {
              const itemHub = row.locations.find(l => l.isHub) ?? null
              return (
                <div className="relative inline-block mt-2">
                  <button type="button" onClick={() => setHubOpen(o => !o)} disabled={pending}
                    className="inline-flex items-center gap-1 text-[0.6875rem] rounded-lg border border-[var(--honey)]/40 bg-[var(--honey)]/10 px-2 py-1 text-[var(--warm-mid)] hover:border-[var(--honey)] transition-colors disabled:opacity-50">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
                    이 품목 창고(허브): <strong className="text-[var(--warm-dark)]">{itemHub?.name ?? '미지정'}</strong>
                    <span className="text-[var(--warm-muted)]">▾</span>
                  </button>
                  {hubOpen && (
                    <>
                      <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setHubOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-[var(--z-dropdown)] min-w-[200px] rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] shadow-lift py-1">
                        <p className="px-3 py-1 text-[0.5625rem] text-[var(--warm-muted)]">보충 시 차감할 창고(허브) 위치</p>
                        {row.locations.map(l => (
                          <button key={l.id} type="button" disabled={pending} onClick={() => changeItemHub(l.id)}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--cream-soft)] flex items-center justify-between gap-2 ${l.isHub ? 'text-[var(--warm-dark)] font-medium' : 'text-[var(--warm-mid)]'}`}>
                            {l.name}{l.isHub && <span className="text-[var(--honey)]">✓ 현재</span>}
                          </button>
                        ))}
                        <button type="button" disabled={pending} onClick={() => changeItemHub(null)}
                          className="w-full text-left px-3 py-1.5 text-[0.625rem] text-[var(--warm-muted)] hover:bg-[var(--cream-soft)] border-t border-[var(--warm-border)]/60 mt-1">
                          영업장 기본 창고 사용
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })()}
          </div>
          <div className="px-5 sm:px-6 py-3 space-y-3">
            {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
            {tab === 'timeline' && (() => {
              const nowMonth = kstMonthStr()
              // 엔트리 월 — 점검·무상입수는 날짜, 구매는 수령확정(receivedAt) 기준. 미수령 구매는 현재 월로 이월.
              const entryMonth = (e: TimelineEntry): string =>
                e.type === 'purchase'
                  ? (e.receivedAt ? kstMonthStr(new Date(e.receivedAt)) : nowMonth)
                  : kstMonthStr(new Date(e.date))
              const monthEntries = data.timeline.filter(e => entryMonth(e) === targetMonth)
              // 이월분 — targetMonth 시작 이전 마지막 점검 잔량 + 그 점검 이후~월초 사이 입수(구매수령·무상).
              // 점검은 실측 카운트라 그 시점까지의 입수·소모가 이미 반영됨 → 점검 이후 입수만 더함.
              // (점검↔월초 사이 소모는 데이터로 알 수 없어 미반영 — 본질적 추정치.)
              const priorChecks = data.timeline.filter(
                (e): e is Extract<TimelineEntry, { type: 'check' }> =>
                  e.type === 'check' && kstMonthStr(new Date(e.date)) < targetMonth,
              )
              const carry = priorChecks.length > 0
                ? priorChecks.reduce((a, b) => (new Date(b.date) > new Date(a.date) ? b : a))
                : null
              // 점검 이후~월초 사이 입수 합(재고단위) — 점검의 '실제 시각'(effTime) 기준으로 '그 이후 수령'만 더한다.
              // ⚠️ date(자정) 기준이면 같은 날 점검보다 '먼저' 수령한 구매도 자정보다 늦어 '점검 이후'로 잡혀 이중 계산됨
              //   (예: 6/16 13:53 수령 → 14:08 점검=20 인데 이월분이 20+20=40). 서버 overview·타임라인 정렬과 동일한 effTime 사용.
              const carryUseSpec = data.item.trackUnit !== 'qty' && !!(data.item.specUnit && data.item.specUnit.trim())
              const KST = 9 * 3600000
              const kstDayStr = (d: Date) => new Date(d.getTime() + KST).toISOString().slice(0, 10)
              const kstMidnightMs = (d: Date) => Math.floor((d.getTime() + KST) / 86400000) * 86400000 - KST
              const kstTodMs = (d: Date) => (d.getTime() + KST) % 86400000
              const effMs = (e: TimelineEntry): number => {
                if (e.type === 'purchase') return new Date(e.receivedAt ?? e.date).getTime()
                const cr = new Date(e.createdAt), dt = new Date(e.date)
                return kstDayStr(cr) === kstDayStr(dt) ? cr.getTime() : kstMidnightMs(dt) + kstTodMs(cr)
              }
              const carryBoundary = carry ? effMs(carry) : 0
              const carryInflow = carry
                ? data.timeline.reduce((s, e) => {
                    if (entryMonth(e) >= targetMonth) return s
                    if (e.type === 'addition')
                      return effMs(e) > carryBoundary ? s + e.addedQty : s
                    if (e.type === 'purchase' && e.receivedAt && effMs(e) > carryBoundary) {
                      const spec = (carryUseSpec && e.specValue && e.specValue > 0)
                        ? (convertSpecValue(e.specValue, e.specUnit, data.item.specUnit) ?? e.specValue) : null
                      return s + (spec != null ? e.qtyValue * spec : e.qtyValue)
                    }
                    return s
                  }, 0)
                : 0
              const carryBase  = carry ? carry.remainingQty : 0
              const carryTotal = carryBase + carryInflow
              const r2 = (n: number) => Math.round(n * 100) / 100
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
                        <li className="flex items-center justify-between gap-2 bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-xl px-3 py-2">
                          <div className="min-w-0">
                            <span className="text-[0.6875rem] font-medium text-[var(--warm-muted)]">이월분 · {yy}.{mm}.01</span>
                            {carryInflow > 0 && (
                              <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">점검 {r2(carryBase)} + 입수 {r2(carryInflow)}</p>
                            )}
                          </div>
                          <span className="text-xs font-semibold text-[var(--warm-mid)] shrink-0">잔량 {fmtQty(carryTotal, detailStockUnit)}</span>
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
          <p className="text-sm font-bold text-[var(--warm-dark)] mt-0.5">{fmtWon(totalAmt)}</p>
        </div>
      </div>
      <ul className="space-y-1.5">
        {rows.map(r => {
          const purchasePct = (r.purchaseQty / maxQty) * 100
          const additionPct = (r.additionQty / maxQty) * 100
          return (
            <li key={r.month} className="bg-[var(--cream)] border border-[var(--warm-border)]/60 rounded-sm px-3 py-2.5 space-y-1.5">
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
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, purchasePct)}%`, background: 'var(--success-fg)' }} />
                    </div>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-24 text-right shrink-0 tabular-nums">
                      {Math.round(r.purchaseQty * 100) / 100}{u} · {fmtWon(r.purchaseAmount)}
                    </span>
                  </div>
                )}
                {r.additionQty > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-8 shrink-0">무상</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, additionPct)}%`, background: 'var(--inspect-fg)' }} />
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
          <span>최저 {fmtWon(Math.round(minP))}{unitSuffix}</span>
          <span>최고 {fmtWon(Math.round(maxP))}{unitSuffix}</span>
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
              {fmtWon(Math.round(p.unitPrice))}{unitSuffix}
            </span>
            <span className="text-[0.625rem] text-[var(--warm-muted)]">
              {p.qty}{qtyUnit ?? ''} · {fmtWon(p.amount)}
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
  const [purchaseUrl, setPurchaseUrl]     = useState(row.purchaseUrl ?? '')
  const [memo, setMemo]                   = useState(row.memo ?? '')
  const [trackUnit, setTrackUnit]         = useState<'spec' | 'qty'>(row.trackUnit)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  // 단위 변환(L→ml 등) — 규격 추적 + 환산 가능한 단위일 때만 노출
  const compatUnits = trackUnit === 'spec' && row.specUnit ? listCompatibleUnits(row.specUnit) : []
  const [newUnit, setNewUnit] = useState('')
  const [unitPending, setUnitPending] = useState(false)
  const [unitMsg, setUnitMsg] = useState('')
  const handleChangeUnit = async () => {
    const target = newUnit.trim()
    if (!target) return
    const f = unitFactor(row.specUnit, target)
    if (f == null) { setUnitMsg(`${row.specUnit} → ${target} 는 변환할 수 없는 단위입니다.`); return }
    const ex = f >= 1 ? `1${row.specUnit} = ${f}${target}` : `${1 / f}${row.specUnit} = 1${target}`
    if (!(await confirmDialog({ title: `단위를 ${row.specUnit} → ${target} 로 바꿀까요?`, message: `저장된 모든 점검·입수 기록이 환산됩니다 (${ex}).`, level: 'caution', confirmLabel: '변경' }))) return
    setUnitPending(true); setUnitMsg('')
    const res = await changeTrackedItemUnit(row.id, target)
    setUnitPending(false)
    if (!res.ok) { setUnitMsg(res.error); return }
    pushToast('success', `단위를 ${target}로 변경했습니다 (점검 ${res.convertedChecks}건 환산).`)
    if (res.unitlessReceipts > 0) {
      pushToast('info', `단위가 비어 있는 과거 영수증 ${res.unitlessReceipts}건은 자동 환산되지 않습니다. 타임라인에서 해당 구매의 규격 단위를 채워주세요.`)
    }
    onDone()
  }

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
        purchaseUrl: purchaseUrl.trim() || null,
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
        <p className="text-[0.625rem] text-[var(--warm-muted)]">예: 3이면 소진 예상 3일 이하일 때 알림</p>
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
      {compatUnits.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-[var(--warm-border)]/60 bg-[var(--canvas)] px-3 py-2.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">표시 단위 변환</label>
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm text-[var(--warm-dark)] font-medium shrink-0">{row.specUnit}</span>
            <span className="text-[var(--warm-muted)]">→</span>
            <select value={newUnit} onChange={e => { setNewUnit(e.target.value); setUnitMsg('') }}
              className="bg-white border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">단위 선택…</option>
              {compatUnits.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <button type="button" onClick={handleChangeUnit} disabled={!newUnit || unitPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--warm-dark)] text-white disabled:opacity-40 active:scale-95 transition">
              {unitPending ? '변환 중…' : '변환'}
            </button>
          </div>
          {newUnit && unitFactor(row.specUnit, newUnit) != null && (
            <p className="text-[0.625rem] text-[var(--warm-muted)]">
              {(() => { const f = unitFactor(row.specUnit, newUnit)!; return f >= 1 ? `1${row.specUnit} = ${f}${newUnit}` : `${Math.round((1 / f) * 1e6) / 1e6}${row.specUnit} = 1${newUnit}` })()}
              {' '}· 저장된 점검·입수 기록이 함께 환산됩니다. 영수증은 그대로 두어도 자동 환산됩니다.
            </p>
          )}
          {unitMsg && <p className="text-[0.625rem] text-[var(--danger-fg)]">{unitMsg}</p>}
        </div>
      )}
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
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">구매 링크</label>
        <input type="url" value={purchaseUrl} onChange={e => setPurchaseUrl(e.target.value)}
          placeholder="https://www.coupang.com/..."
          autoComplete="off"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
          입력해두면 재고 카드에서 한 번에 구매 페이지로 이동할 수 있어요.
        </p>
      </div>
      {/* 위치 할당 섹션 */}
      <LocationAssignSection trackedItemId={row.id} initialLocations={row.locations} />
      {/* 병합 섹션 — 같은 카테고리 다른 카드로 통합 */}
      <MergeSection currentId={row.id} currentLabel={row.label} category={row.category} onDone={onDone} />
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}

function MergeSection({ currentId, currentLabel, onDone }: {
  currentId: string; currentLabel: string; category: string; onDone: () => void
}) {
  const [siblings, setSiblings] = useState<{ id: string; label: string }[]>([])
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => { getSameCategoryItems(currentId).then(setSiblings) }, [currentId])
  if (siblings.length === 0) return null

  // 이 카드를 대상(남을 카드)으로 합침 — 기록 이전 후 이 카드 삭제. (§21.4 MergeSheet 단일)
  const handleMerge = async (destId: string) => {
    setPending(true)
    const res = await mergeTrackedItems(currentId, destId, true)
    setPending(false)
    if (!res.ok) { pushToast('error', res.error); return }
    setOpen(false)
    pushToast('success', `병합 완료 · 지출 ${res.movedExpenses}건, 점검 ${res.movedChecks}건, 무상입수 ${res.movedAdditions}건`)
    onDone()
  }

  return (
    <div className="space-y-1.5 pt-2 border-t border-[var(--warm-border)]/60">
      <label className="text-xs font-medium text-[var(--warm-mid)]">다른 카드와 합치기</label>
      <Btn type="button" variant="secondary" size="md" fullWidth onClick={() => setOpen(true)}>다른 카드와 합치기…</Btn>
      <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
        예: 라면처럼 봉지·박스가 섞여도 한 카드로 합쳐 추적하고 싶을 때. 사이즈가 의미 있는 폐기물 봉투는 분리 유지 권장.
      </p>
      {open && (
        <MergeSheet open onClose={() => setOpen(false)}
          sourceLabel={currentLabel} targets={siblings}
          description="대표(남을 카드)로 지출·점검·무상입수 기록이 이동하고 이 카드는 사라집니다. 적용취소는 ‘병합 적용취소·규칙’."
          confirmLabel="합치기" onConfirm={handleMerge} pending={pending} />
      )}
    </div>
  )
}

function TimelineRow({ entry, stockUnit, trackUnit, itemLocations, onDeleteCheck, onDeleteAddition, onConfirmReceipt, onChanged, loadingId }: {
  entry: TimelineEntry; stockUnit: string | null; trackUnit: 'spec' | 'qty'
  itemLocations: StorageLocationItem[]
  onDeleteCheck: (id: string) => void
  onDeleteAddition: (id: string) => void
  onConfirmReceipt?: (id: string, locationId?: string, qty?: number) => void
  onChanged: () => void
  loadingId: string | null
}) {
  const pending = loadingId === entry.id
  const [editing, setEditing] = useState(false)
  const [savePending, setSavePending] = useState(false)
  const [editError, setEditError] = useState('')
  const [showLocationPicker, setShowLocationPicker] = useState(false)
  // 부분 수령 — 몇 개 도착했는지(기본 전체). 전체 미만이면 서버가 행 분할(잔여=수령 대기).
  const [rcvQtyStr, setRcvQtyStr] = useState('')

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
            <p className="text-xs text-[var(--warm-muted)]">
              {fmtDate(entry.date)} · {entry.isReconcile ? '전체 보정' : '점검'} · <span className="tabular-nums">{fmtTime(entry.createdAt)}</span>
              {entry.isReconcile && <span className="ml-1 text-[0.5625rem] bg-[var(--honey)]/15 text-[var(--honey)] border border-[var(--honey)]/40 rounded-full px-1.5 py-0.5">보정</span>}
            </p>
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
            className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--danger-bg)]">삭제</button>
        </div>
      </li>
    )
  }

  // ── 구매 (Expense)
  if (entry.type === 'purchase') {
    const isPendingReceipt = entry.receivedAt === null
    const hasSpec = entry.specValue != null && entry.specValue > 0 && entry.specUnit
    const useSpec = trackUnit !== 'qty' && hasSpec
    // 영수증 규격단위(entry.specUnit)가 품목 단위(stockUnit)와 다르면 품목 단위로 환산해 입고량 표시(L→ml 등)
    const convSpec = useSpec ? (convertSpecValue(entry.specValue ?? 0, entry.specUnit, stockUnit) ?? (entry.specValue ?? 0)) : 0
    const baseQty = useSpec ? entry.qtyValue * convSpec : entry.qtyValue
    const baseUnit = useSpec ? stockUnit : entry.qtyUnit
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
          if (!(await confirmDialog({ title: '이 구매를 재고에서 제외할까요?', message: '지출 페이지에는 그대로 남습니다.', level: 'caution', confirmLabel: '제외' }))) return
          setSavePending(true)
          const res = await excludeExpenseFromInventory(entry.id)
          setSavePending(false)
          if (!res.ok) { setEditError(res.error); return }
          // §10-1 — 적용 직후 토스트 액션으로 즉시 회수 가능
          pushToast('success', '구매를 재고에서 제외했습니다', {
            action: { label: '적용취소', run: () => { void includeExpenseInInventory(entry.id).then(r => {
              if (r.ok) { pushToast('success', '제외를 적용취소했습니다'); onChanged() }
              else pushToast('error', r.error)
            }) } },
          })
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
              <p className="text-sm font-medium text-[var(--warm-dark)]">{baseQty > 0 ? `+ ${fmtQty(baseQty, baseUnit)}` : '수량 미기록'}{entry.amount > 0 ? ` (${fmtWon(entry.amount)})` : ''}</p>
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
                onClick={() => { setShowLocationPicker(true); setRcvQtyStr(entry.qtyValue != null ? String(entry.qtyValue) : '') }}
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
            {entry.qtyValue != null && entry.qtyValue > 1 && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[0.625rem] text-[var(--warm-muted)]">도착 수량 (전체 {entry.qtyValue}{entry.qtyUnit ?? '개'} — 일부만 오면 잔여는 수령 대기 유지)</span>
                <input type="number" min={1} max={entry.qtyValue} step="any" value={rcvQtyStr} disabled={pending}
                  onChange={e => setRcvQtyStr(e.target.value)}
                  className="w-16 text-xs bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-[var(--warm-dark)] outline-none tabular-nums focus:border-[var(--coral)]" />
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {itemLocations.map(loc => (
                <button key={loc.id} type="button" disabled={pending}
                  onClick={() => { setShowLocationPicker(false); onConfirmReceipt(entry.id, loc.id, (entry.qtyValue != null && Number(rcvQtyStr) > 0 && Number(rcvQtyStr) < entry.qtyValue) ? Number(rcvQtyStr) : undefined) }}
                  className={`text-xs px-2.5 py-1 rounded-lg border transition-colors disabled:opacity-40 ${loc.isHub ? 'border-[var(--honey)] bg-[var(--honey)]/10 text-[var(--ink)] font-medium' : 'border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)] hover:text-[var(--coral)]'}`}>
                  {loc.name}
                </button>
              ))}
              <button type="button" disabled={pending}
                onClick={() => { setShowLocationPicker(false); onConfirmReceipt(entry.id, undefined, (entry.qtyValue != null && Number(rcvQtyStr) > 0 && Number(rcvQtyStr) < entry.qtyValue) ? Number(rcvQtyStr) : undefined) }}
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
          className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--danger-bg)]">삭제</button>
      </div>
    </li>
  )
}

// ── 재고 점검 인라인 편집 폼
// ── 전체 재고 보정(총점검) — 보충 완료 후, 전 품목 실측을 한 번에 기준선으로 박는다.
//    차이는 사용량으로 잡지 않음(isReconcile). 위치별 예상치 프리필 → 사용자가 실제 센 값만 고침.
// ── 타임라인 보정 끼워넣기 (v2) — 품목 상세에서 특정 과거/현재 시점에 보정 점검 삽입.
//    날짜를 고르면 그 시점 '예상 재고'(직전 점검+그 사이 입고)를 위치별로 보여주고, 실측 입력 → 차이 표시.
//    isReconcile 점검으로 저장(saveFullReconcile 단일 품목) → 그 구간 차이는 사용량에 안 잡힘.
function TimelineReconcileForm({ item, existingCheckDays = [], onCancel, onDone }: {
  item: { id: string; label: string; specUnit: string | null; qtyUnit: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  existingCheckDays?: string[]   // 이미 점검이 있는 날짜(KST, YYYY-MM-DD) — 같은 날 중복 보정 가드용
  onCancel: () => void
  onDone: () => void
}) {
  const NO_LOC = '__total__'
  const r2 = (x: number) => Math.round(x * 100) / 100
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const hasLoc = item.locations.length > 0
  const unit = item.trackUnit === 'qty' ? item.qtyUnit : (item.specUnit ?? item.qtyUnit)
  const [date, setDate] = useState(todayKst)
  const [memo, setMemo] = useState('')
  const [expected, setExpected] = useState<{ total: number; byLoc: Record<string, number> } | null>(null)
  const [actuals, setActuals] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true
    setLoading(true)
    getStockAsOf(item.id, date).then(res => {
      if (!active || !res) { if (active) setLoading(false); return }
      if (hasLoc) {
        const byLoc: Record<string, number> = {}
        for (const l of res.byLoc) byLoc[l.locationId] = l.qty
        setExpected({ total: res.total, byLoc })
        setActuals(Object.fromEntries(item.locations.map(l => [l.id, String(byLoc[l.id] ?? 0)])))
      } else {
        setExpected({ total: res.total, byLoc: {} })
        setActuals({ [NO_LOC]: String(res.total) })
      }
      setLoading(false)
    }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const actualTotal = hasLoc
    ? item.locations.reduce((s, l) => s + Number(actuals[l.id] || '0'), 0)
    : Number(actuals[NO_LOC] || '0')
  const expectedTotal = expected?.total ?? 0
  const diff = r2(actualTotal - expectedTotal)
  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  const dateHasCheck = existingCheckDays.includes(date)

  const handleSave = async () => {
    // 같은 날 이미 점검이 있으면 — 새 보정을 또 만들면 타임라인이 중복돼 헷갈림.
    // 그 점검을 수정하는 게 정확. 한 번 더 확인받고 진행.
    if (dateHasCheck && !(await confirmDialog({ title: `${date}에 이미 점검 기록이 있어요`, message: "새 보정을 또 추가하면 같은 날 항목이 둘이 돼 헷갈릴 수 있어요. 보통은 '취소'를 누르고 그 점검의 [수정]에서 고치는 게 정확합니다.", level: 'caution', confirmLabel: '그래도 추가' }))) {
      return
    }
    setPending(true); setError('')
    const items = hasLoc
      ? [{ trackedItemId: item.id, locationQtys: item.locations.map(l => ({ storageLocationId: l.id, qty: Number(actuals[l.id] || '0') })), memo: memo || undefined }]
      : [{ trackedItemId: item.id, remainingQty: Number(actuals[NO_LOC] || '0'), memo: memo || undefined }]
    const res = await saveFullReconcile({ date, items })
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    onDone()
  }

  return (
    <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <div>
        <p className="text-xs font-medium text-[var(--warm-mid)]">보정 끼워넣기</p>
        <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">고른 날짜 시점의 실제 수량으로 기준선을 보정합니다. 차이는 사용량으로 잡히지 않습니다.</p>
      </div>
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">보정 시점(날짜)</label>
        <DatePicker value={date} onChange={setDate} />
        {dateHasCheck && (
          <p className="text-[0.6875rem] text-[var(--honey)] bg-[var(--honey)]/10 border border-[var(--honey)]/30 rounded-lg px-2.5 py-1.5">
            이 날짜엔 이미 점검 기록이 있어요. 보통은 새 보정을 만들기보다 <strong>그 점검의 [수정]</strong>에서 고치는 게 정확합니다 (같은 날 중복 방지).
          </p>
        )}
      </div>

      {loading ? (
        <SkeletonRows rows={3} className="py-1" />
      ) : (
        <>
          <div className="flex items-center justify-between text-[0.6875rem]">
            <span className="text-[var(--warm-muted)]">이 시점 예상 재고</span>
            <span className="text-[var(--warm-mid)]">{r2(expectedTotal)}{unit ?? ''}</span>
          </div>
          {hasLoc ? (
            <div className="grid grid-cols-2 gap-1.5">
              {item.locations.map(l => (
                <div key={l.id}>
                  <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5 truncate">
                    {l.name}{l.isHub ? ' (창고)' : ''} <span className="text-[var(--warm-border)]">· 예상 {r2(expected?.byLoc[l.id] ?? 0)}</span>
                  </p>
                  <input type="text" inputMode="decimal" value={actuals[l.id] ?? ''}
                    onChange={e => setActuals(p => ({ ...p, [l.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                    className={`w-full ${inputCls}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--warm-mid)]">실측 잔량</span>
              <input type="text" inputMode="decimal" value={actuals[NO_LOC] ?? ''}
                onChange={e => setActuals(p => ({ ...p, [NO_LOC]: e.target.value.replace(/[^0-9.]/g, '') }))}
                className={`flex-1 ${inputCls}`} />
              <span className="text-xs text-[var(--warm-muted)]">{unit ?? ''}</span>
            </div>
          )}
          <div className="flex justify-end">
            {Math.abs(diff) > 0.001 ? (
              <span className="text-[0.6875rem] font-medium" style={{ color: diff < 0 ? 'var(--coral)' : 'var(--honey)' }}>
                실측 {r2(actualTotal)}{unit ?? ''} · 차이 {diff > 0 ? '+' : ''}{diff}{unit ?? ''}
              </span>
            ) : (
              <span className="text-[0.6875rem] text-[var(--warm-muted)]">예상과 동일 (차이 없음)</span>
            )}
          </div>
        </>
      )}

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">사유 (선택)</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="예: 분실·파손·계산 오차"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>

      <div className="pt-1 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel}>취소</Btn>
        <Btn type="button" variant="primary" onClick={handleSave} disabled={pending || loading} fullWidth>
          {pending ? '저장 중...' : '이 시점에 보정 저장'}
        </Btn>
      </div>
    </div>
  )
}

// ── 재고관리 카테고리 설정 — 어떤 지출 카테고리를 재고로 추적할지 + 표시명(별칭) 편집·순서.
function InventoryCategorySettingsModal({ categories, allExpenseCategories, onClose, onDone }: {
  categories: InventoryCategory[]
  allExpenseCategories: string[]
  onClose: () => void
  onDone: () => void
}) {
  const [dirty, setDirty] = useState(false)   // §13.2 — 입력 시작 후 닫기 보호
  const [entries, setEntries] = useState<InventoryCategory[]>(categories.map(c => ({ ...c })))
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const available = allExpenseCategories.filter(c => !entries.some(e => e.cat === c))
  const move = (i: number, dir: -1 | 1) => setEntries(prev => {
    const j = i + dir
    if (j < 0 || j >= prev.length) return prev
    const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next
  })
  const add = (cat: string) => setEntries(prev => [...prev, { cat, alias: suggestInventoryAlias(cat) }])
  const remove = (cat: string) => setEntries(prev => prev.filter(e => e.cat !== cat))
  const setAlias = (cat: string, alias: string) => setEntries(prev => prev.map(e => e.cat === cat ? { ...e, alias } : e))

  const handleSave = async () => {
    if (!entries.length) { setError('최소 1개 카테고리가 필요합니다.'); return }
    setPending(true); setError('')
    const res = await setInventoryCategories(entries.map(e => ({ cat: e.cat, alias: e.alias.trim() })))
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    onDone()
  }

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <Modal open onClose={onClose} title="재고 카테고리 설정"
      subtitle="재고관리에 표시할 카테고리와 이름을 정합니다. (지출 카테고리는 그대로 유지)"
      width="lg" dirty={dirty}
      footer={<div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="text-sm text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-3 py-2">취소</button>
          <Btn variant="primary" size="sm" onClick={handleSave} disabled={pending || !entries.length}>
            {pending ? '저장 중...' : '저장'}
          </Btn>
      </div>}
      bodyClassName="px-4 py-3">
      {/* §13.2 dirty — 입력 시작 후 배경클릭 무시(Modal 내장) */}
      <div className="space-y-3" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
          <div className="space-y-2">
            <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)]">표시 중인 카테고리 (위에서부터 표시 순서)</p>
            {entries.map((e, i) => (
              <div key={e.cat} className="flex items-center gap-2 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-2.5 py-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tintOf(e.cat).fg }} />
                <div className="flex flex-col shrink-0 w-20">
                  <span className="text-[0.5625rem] text-[var(--warm-muted)]">지출명</span>
                  <span className="text-[0.6875rem] text-[var(--warm-mid)] truncate">{e.cat}</span>
                </div>
                <input value={e.alias} onChange={ev => setAlias(e.cat, ev.target.value)} placeholder={suggestInventoryAlias(e.cat)}
                  className={`flex-1 min-w-0 ${inputCls}`} aria-label={`${e.cat} 표시명`} />
                <div className="flex items-center gap-0.5 shrink-0">
                  <button type="button" onClick={() => move(i, -1)} disabled={i === 0}
                    className="p-1 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-30" aria-label="위로">▲</button>
                  <button type="button" onClick={() => move(i, 1)} disabled={i === entries.length - 1}
                    className="p-1 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-30" aria-label="아래로">▼</button>
                  <button type="button" onClick={() => remove(e.cat)}
                    className="p-1 text-[var(--danger-fg)] hover:text-[var(--danger-fg)] text-xs" aria-label="제거">✕</button>
                </div>
              </div>
            ))}
          </div>

          {available.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)]">추가할 카테고리</p>
              <div className="flex flex-wrap gap-1.5">
                {available.map(c => (
                  <button key={c} type="button" onClick={() => add(c)}
                    className="text-xs px-2.5 py-1 rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] text-[var(--warm-mid)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors">
                    + {c}
                  </button>
                ))}
              </div>
              <p className="text-[0.5625rem] text-[var(--warm-muted)]">예: 수선유지비를 추가하면 수리부품 재고도 추적할 수 있습니다.</p>
            </div>
          )}

      </div>
    </Modal>
  )
}

function FullReconcileModal({ rows, categories, onClose, onDone }: {
  rows: InventoryRow[]
  categories: InventoryCategory[]
  onClose: () => void
  onDone: () => void
}) {
  const [dirty, setDirty] = useState(false)   // §13.2 — 입력 시작 후 닫기 보호
  const NO_LOC = '__total__'
  const r2 = (x: number) => Math.round(x * 100) / 100
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const [date, setDate] = useState(todayKst)
  const [restockDone, setRestockDone] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const unitOf = (r: InventoryRow) => (r.trackUnit === 'qty' ? r.qtyUnit : (r.specUnit ?? r.qtyUnit))

  // 예상 재고 — 위치별 프리필: 직전 점검 위치별 + (현재고 − 직전총합)을 허브에 가산해 합계가 현재고와 일치.
  const expectedFor = (r: InventoryRow): { byLoc: Record<string, number>; total: number } => {
    const total = r.currentStock ?? r.lastRemainingQty ?? 0
    if (r.locations.length === 0) return { byLoc: {}, total }
    const byLoc: Record<string, number> = {}
    for (const l of r.locations) byLoc[l.id] = r.lastCheckLocationBreakdown.find(b => b.locationId === l.id)?.qty ?? 0
    const lastSum = Object.values(byLoc).reduce((s, v) => s + v, 0)
    const sinceDelta = total - lastSum
    if (Math.abs(sinceDelta) > 0.001) {
      const hub = r.locations.find(l => l.isHub) ?? r.locations[0]
      byLoc[hub.id] = Math.max(0, (byLoc[hub.id] ?? 0) + sinceDelta)
    }
    return { byLoc, total }
  }

  const [actuals, setActuals] = useState<Record<string, Record<string, string>>>(() => {
    const init: Record<string, Record<string, string>> = {}
    for (const r of rows) {
      const exp = expectedFor(r)
      init[r.id] = r.locations.length === 0
        ? { [NO_LOC]: String(r2(exp.total)) }
        : Object.fromEntries(r.locations.map(l => [l.id, String(r2(exp.byLoc[l.id] ?? 0))]))
    }
    return init
  })

  const setVal = (itemId: string, locKey: string, v: string) =>
    setActuals(prev => ({ ...prev, [itemId]: { ...prev[itemId], [locKey]: v.replace(/[^0-9.]/g, '') } }))

  const actualTotalOf = (r: InventoryRow) =>
    r.locations.length === 0
      ? Number(actuals[r.id]?.[NO_LOC] || '0')
      : r.locations.reduce((s, l) => s + Number(actuals[r.id]?.[l.id] || '0'), 0)

  // 차이 있는 품목만 저장 대상
  const changed = rows.filter(r => Math.abs(actualTotalOf(r) - (r.currentStock ?? r.lastRemainingQty ?? 0)) > 0.001)

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] disabled:opacity-40'

  const handleSave = async () => {
    if (!changed.length) { setError('변경된(차이 있는) 품목이 없습니다.'); return }
    setPending(true); setError('')
    const items = changed.map(r => r.locations.length === 0
      ? { trackedItemId: r.id, remainingQty: Number(actuals[r.id]?.[NO_LOC] || '0') }
      : { trackedItemId: r.id, locationQtys: r.locations.map(l => ({ storageLocationId: l.id, qty: Number(actuals[r.id]?.[l.id] || '0') })) })
    const res = await saveFullReconcile({ date, items })
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="전체 재고 보정"
      subtitle="실제 남은 수량을 세어 기준선을 다시 맞춥니다. 차이는 사용량으로 잡히지 않습니다."
      width="2xl" dirty={dirty}
      footer={<div className="flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] text-[var(--warm-muted)]">차이 있는 {changed.length}품목 보정</span>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="text-sm text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-3 py-2">취소</button>
            <Btn variant="primary" size="sm" onClick={handleSave} disabled={pending || !restockDone || !changed.length}>
              {pending ? '저장 중...' : `보정 저장 (${changed.length})`}
            </Btn>
          </div>
      </div>}
      bodyClassName="px-4 py-3">
      {/* §13.2 dirty — 입력 시작 후 배경클릭 무시(Modal 내장) */}
      <div className="space-y-3" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
          {categories.map(({ cat, alias }) => {
            const catRows = rows.filter(r => r.category === cat)
            if (!catRows.length) return null
            return (
              <section key={cat} className="space-y-2">
                <h3 className="text-xs font-semibold text-[var(--warm-dark)]">{alias}</h3>
                {catRows.map(r => {
                  const unit = unitOf(r)
                  const expected = r.currentStock ?? r.lastRemainingQty ?? 0
                  const actual = actualTotalOf(r)
                  const diff = r2(actual - expected)
                  return (
                    <div key={r.id} className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-sm font-medium text-[var(--warm-dark)] truncate">{r.label}</span>
                        <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">예상 {r2(expected)}{unit ?? ''}</span>
                      </div>
                      {r.locations.length === 0 ? (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">실측</span>
                          <input type="text" inputMode="decimal" disabled={!restockDone}
                            value={actuals[r.id]?.[NO_LOC] ?? ''} onChange={e => setVal(r.id, NO_LOC, e.target.value)}
                            className={`w-24 ${inputCls}`} />
                          <span className="text-[0.625rem] text-[var(--warm-muted)]">{unit ?? ''}</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-1.5">
                          {r.locations.map(l => (
                            <div key={l.id}>
                              <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5 truncate">{l.name}{l.isHub ? ' (창고)' : ''}</p>
                              <input type="text" inputMode="decimal" disabled={!restockDone}
                                value={actuals[r.id]?.[l.id] ?? ''} onChange={e => setVal(r.id, l.id, e.target.value)}
                                className={`w-full ${inputCls}`} />
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-end mt-1.5">
                        {Math.abs(diff) > 0.001 ? (
                          <span className="text-[0.625rem] font-medium" style={{ color: diff < 0 ? 'var(--coral)' : 'var(--honey)' }}>
                            실측 {r2(actual)}{unit ?? ''} · 차이 {diff > 0 ? '+' : ''}{diff}{unit ?? ''}
                          </span>
                        ) : (
                          <span className="text-[0.625rem] text-[var(--warm-muted)]">차이 없음</span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </section>
            )
          })}

      </div>
    </Modal>
  )
}

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

  // 위치 source — 항상 아이템의 현재 연결된 전체 위치를 표시(union).
  //   기존엔 그 점검의 breakdown 위치만 렌더해서, 나중에 추가된 위치(예: 5층/4층 화장실)를
  //   과거 점검 수정 시 입력할 수 없었음(2026-06-09 사용자 보고). 이제 전체 위치 + 점검에만
  //   있고 현재 미연결된 위치(orphan)까지 합쳐 보여준다. 값은 아래 initial 로 프리필.
  const locationSources: { id: string; name: string; isHub: boolean }[] = (() => {
    const base = itemLocations.map(l => ({ id: l.id, name: l.name, isHub: l.isHub }))
    const orphan = entry.locationBreakdown
      .filter(lb => !base.some(b => b.id === lb.locationId))
      .map(lb => ({ id: lb.locationId, name: lb.locationName, isHub: false }))
    return [...base, ...orphan]
  })()

  const hasLocations = locationSources.length > 0

  // 기존 데이터에서 전/후 역산: 보충 전 = 보충 후 − 창고이동(restockedQty).
  // ⚠️ restocked 가 0(보충 없이 그냥 센 위치)이면 '보충 전 = 보충 후' 여야 한다.
  //   이전엔 restocked>0 일 때만 보충 전을 채우고 아니면 빈칸(=0)으로 둬서, 수정 폼을 열면
  //   보충 안 한 위치의 보충 전이 0 으로 보이고(사라진 것처럼) → 그대로 저장하면
  //   restock = 보충후 − 0 = 보충후 전체로 계산돼 창고가 그만큼 또 차감되는 드리프트 발생
  //   (2026-06-01 사용자 보고: "보충 전 수량이 계속 사라진다"). 항상 (보충후 − restocked)로 역산.
  const initial = Object.fromEntries(
    entry.locationBreakdown.map(lb => {
      const restocked = lb.restockedQty ?? 0
      const before = Math.max(0, lb.qty - restocked)
      return [lb.locationId, { before: String(before), after: String(lb.qty) }]
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

  // 생성 폼(CheckForm)과 동일한 null-처리 — 빈칸은 0이 아니라 null.
  // 전·후 모두 입력된 위치만 보충으로 계산해야, '보충 전'을 비워둔 위치가
  // (후 − 0 = 후 전체)로 잡혀 창고가 전액 차감되는 사고가 없다.
  const restockSum = locationSources.filter(l => !l.isHub).reduce((s, l) => {
    const bStr = beforeQtys[l.id] ?? ''
    const aStr = afterQtys[l.id] ?? ''
    const b = bStr === '' ? null : Number(bStr)
    const a = aStr === '' ? null : Number(aStr)
    return s + ((b !== null && a !== null && a > b) ? a - b : 0)
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
        locationQtys: locationSources
          // 허브 + 원래 점검에 있던 위치 + 사용자가 값을 입력한 위치만 저장.
          // (새로 표시된 위치를 안 건드렸으면 0으로 끼워넣지 않음 — breakdown 오염 방지)
          .filter(l => l.isHub
            || entry.locationBreakdown.some(lb => lb.locationId === l.id)
            || (afterQtys[l.id] ?? '') !== '' || (beforeQtys[l.id] ?? '') !== '')
          .map(l => {
            if (l.isHub) return { storageLocationId: l.id, qty: hubFinal }
            const before = Number(beforeQtys[l.id] || '0')
            const after = Number(afterQtys[l.id] || '0')
            // 보충 전이 빈칸이면 보충 없음(잔량만 기록) — restockSum 과 동일한 null-규칙
            const restocked = (beforeQtys[l.id] ?? '') !== '' && after > before ? after - before : 0
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
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
                  <div className="flex items-baseline gap-1.5 shrink-0">
                    <button type="button"
                      onClick={() => setAfterQtys(p => ({ ...p, [l.id]: beforeQtys[l.id] ?? '' }))}
                      className="text-[0.625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                      보충 없음
                    </button>
                    {restocked > 0 && (
                      <span className="text-[0.625rem] text-[var(--coral)]">창고 → +{Math.round(restocked * 100) / 100}</span>
                    )}
                  </div>
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
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
          className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-[var(--danger-bg)]">삭제</button>
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
      <p className="text-xs font-medium text-[var(--warm-mid)]">구매 수정 <span className="text-[0.625rem] font-normal text-[var(--warm-muted)]">수정 내용은 지출 페이지에도 반영됩니다</span></p>
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
            <span className="text-[0.6875rem] font-bold px-2 py-0.5 rounded bg-[var(--honey)]/15 text-[var(--warning-fg)] tracking-wider">미수령</span>
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
          className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-[var(--danger-bg)]">재고에서 제외</button>
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

  // 이전 점검의 위치별 수량 맵 + 그때 보충한 양(restockedQty) 맵 — 참고줄에 계속 표시
  const prevMap = Object.fromEntries(lastCheckBreakdown.map(lb => [lb.locationId, lb.qty]))
  const prevRestockedMap = Object.fromEntries(lastCheckBreakdown.map(lb => [lb.locationId, lb.restockedQty]))
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
  // 현재 잔량은 빈칸으로 시작 — 직접 세어 입력(미리 채운 값 수정이 번거로움). 미변경 위치는 '직전값 유지'로 채움.
  // 보충 후만 입력하고 현재 잔량을 비운 경우는 buildLocationData 가 직전 잔량을 보충 기준으로 삼아 허브 미차감(총량 변동) 버그를 막는다.
  const [beforeQtys, setBeforeQtys] = useState<Record<string, string>>({})
  const [afterQtys, setAfterQtys]   = useState<Record<string, string>>({})
  // 허브 사용자 보정 여부 — true 면 자동 차감값을 덮어쓰지 않음
  const [hubTouched, setHubTouched] = useState(false)

  const [qty, setQty]   = useState('')
  const [memo, setMemo] = useState('')
  const [reconcileMode, setReconcileMode] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  // 더블클릭 중복 제출 동기 차단 — isPending(useTransition)은 리렌더 후 반영이라 그 전 재진입 방지.
  const submittingRef = useRef(false)

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

  // 저장용 위치별 데이터 계산.
  // entered = 사용자가 실제로 값을 입력한 행 — 0 을 명시 입력해도 저장되게 구분.
  // (이전엔 qty>0 필터만 있어 명시적 0 이 걸러지고 carryOver 가 이전 잔량으로 되살렸음)
  const buildLocationData = (): { storageLocationId: string; qty: number; restockedQty?: number; entered: boolean }[] => {
    if (!hasLocations) return []
    if (restockMode) {
      return item.locations.map(l => {
        if (l.isHub) {
          const userVal = afterQtys[l.id]
          const finalQty = (hubTouched && userVal !== undefined && userVal !== '') ? Number(userVal) : hubAutoAfter
          // 허브는 자동 차감(restockSum>0)이 일어났으면 0 이어도 반드시 저장 — 안 하면 carryOver 가 차감 전 값으로 복원
          return { storageLocationId: l.id, qty: finalQty, entered: (hubTouched && userVal !== undefined && userVal !== '') || restockSum > 0 }
        }
        const beforeStr = beforeQtys[l.id] ?? ''
        const afterStr  = afterQtys[l.id] ?? ''
        const beforeN = beforeStr === '' ? null : Number(beforeStr)
        const afterN  = afterStr  === '' ? null : Number(afterStr)
        // 전·후 모두 입력 → 보충량 = max(0, 후-전)
        // 전만 입력 → 보충 없이 잔량 = 전
        // 후만 입력(현재 잔량 비움) → 직전 잔량을 기준으로 보충량 산출(허브 미차감·총량 변동 방지)
        // 모두 비움 → qty=0 (entered=false → 저장 제외, carryOver 보존)
        const restockBase = beforeN ?? (prevMap[l.id] ?? null)
        const finalQty = afterN ?? beforeN ?? 0
        const restocked = (restockBase !== null && afterN !== null && afterN > restockBase) ? afterN - restockBase : undefined
        return { storageLocationId: l.id, qty: finalQty, restockedQty: restocked, entered: beforeStr !== '' || afterStr !== '' }
      })
    }
    // 단순 모드 — 첫 점검
    return item.locations.map(l => ({
      storageLocationId: l.id,
      qty: Number(locationQtys[l.id]) || 0,
      entered: String(locationQtys[l.id] ?? '').trim() !== '',
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
    if (submittingRef.current) return   // 중복 제출(더블클릭) 차단

    if (!hasLocations) {
      const n = Number(qty)
      if (isNaN(n) || n < 0) { setError('잔량은 0 이상이어야 합니다.'); return }
      submittingRef.current = true
      startTransition(async () => {
        try {
          const res = await createStockCheck({
            trackedItemId: item.id, date, remainingQty: n, memo: memo || undefined,
            isReconcile: reconcileMode,
          })
          if (!res.ok) { setError(res.error); return }
          await deleteItemDrafts(item.id)
          onDraftChange?.()
          onDone()
        } finally { submittingRef.current = false }
      })
      return
    }

    // 입력된 행(0 포함)·보충 행만 저장 — 빈칸 위치는 제외해 carryOver 가 직전 점검값을 보존
    const locationData = buildLocationData()
      .filter(lq => lq.entered || lq.qty > 0 || lq.restockedQty != null)
      .map(({ entered: _e, ...rest }) => rest)
    const total = locationData.reduce((s, lq) => s + lq.qty, 0)
    if (total < 0) { setError('잔량은 0 이상이어야 합니다.'); return }

    submittingRef.current = true
    startTransition(async () => {
      try {
        const res = await createStockCheck({
          trackedItemId: item.id, date, remainingQty: total, memo: memo || undefined,
          locationQtys: locationData,
          // 위치 일부만 입력해도 나머지 위치는 직전 점검에서 자동 보존
          // (2026-06-01 사용량 왜곡 버그 fix).
          carryOverFromLastCheck: true,
          isReconcile: reconcileMode,
        })
        if (!res.ok) { setError(res.error); return }
        await deleteItemDrafts(item.id)
        onDraftChange?.()
        onDone()
      } finally { submittingRef.current = false }
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
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
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
            const lastRestocked = prevRestockedMap[loc.id]
            return (
              <div key={loc.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] truncate">{loc.name}</span>
                </div>
                {/* 참고줄 — 입력 중에도 직전 잔량·지난 보충량이 계속 보이게 */}
                {(prevQty !== undefined || lastRestocked != null || restocked > 0) && (
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[0.625rem] bg-[var(--canvas)] rounded-md px-2 py-1">
                    {prevQty !== undefined && <span className="text-[var(--warm-mid)]">직전 잔량 <strong className="text-[var(--warm-dark)] tabular-nums">{prevQty}{stockUnit ?? ''}</strong></span>}
                    {lastRestocked != null && lastRestocked > 0 && <span className="text-[var(--warm-muted)]">· 지난 보충 <strong className="text-[var(--coral)] tabular-nums">+{Math.round(lastRestocked * 100) / 100}{stockUnit ?? ''}</strong></span>}
                    {restocked > 0 && <span className="text-[var(--coral)] ml-auto">이번 보충 <strong className="tabular-nums">+{Math.round(restocked * 100) / 100}{stockUnit ?? ''}</strong></span>}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">현재 잔량 (보충 전)</p>
                    <input type="text" inputMode="decimal" placeholder="0"
                      value={beforeStr}
                      onChange={e => setBeforeQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                  <div>
                    <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 후 <span className="text-[var(--warm-muted)]/70">(보충 시)</span></p>
                    <input type="text" inputMode="decimal" placeholder="—"
                      value={afterStr}
                      onChange={e => setAfterQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                </div>
                {/* 보충 없음 — 추가 보충 없이 센 값 그대로 확정(보충 후=현재 잔량). 안 셌으면 직전 잔량으로 채움 */}
                <div className="flex justify-end">
                  <button type="button"
                    onClick={() => {
                      if (beforeStr !== '') setAfterQtys(p => ({ ...p, [loc.id]: beforeStr }))
                      else if (prevQty !== undefined) {
                        const v = String(prevQty)
                        setBeforeQtys(p => ({ ...p, [loc.id]: v }))
                        setAfterQtys(p => ({ ...p, [loc.id]: v }))
                      }
                    }}
                    className="text-[0.625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                    보충 없음
                  </button>
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
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>
      <label className={`flex items-start gap-2 cursor-pointer select-none rounded-lg border px-2.5 py-2 transition-colors ${reconcileMode ? 'bg-[var(--honey)]/10 border-[var(--honey)]/40' : 'bg-[var(--canvas)] border-[var(--warm-border)]'}`}>
        <input type="checkbox" checked={reconcileMode} onChange={e => setReconcileMode(e.target.checked)} className="mt-0.5 accent-[var(--coral)]" />
        <span className="text-[0.625rem] text-[var(--warm-mid)] leading-snug">
          <strong className="text-[var(--warm-dark)]">전체 보정으로 기록</strong>. 실제 수량과 차이를 사용량으로 잡지 않습니다.<br />
          계산 오차·분실 등으로 어긋난 재고를 실측값으로 다시 맞출 때 사용. (보충 완료 후 점검 권장)
        </span>
      </label>
      {draftSavedAt && (
        <div className="flex items-center justify-between gap-2 text-[0.625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
          <span>이어서 점검 중 · 임시저장 {fmtTime(new Date(draftSavedAt))}</span>
          <button type="button" onClick={handleClearDraft}
            className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline shrink-0">비우기</button>
        </div>
      )}
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
// 위치 간 재고 이동·맞바꿈 (운영자 요청 2026-07-08) — "무엇을 → 어디서 → 어디로 → 얼마나" 한 화면.
// 총량 불변 점검으로 기록되어 소모 통계에 영향 없음. 점검 폼의 허브 자동 차감 UX 는 그대로.
function TransferStockModal({ rows, onClose, onDone }: {
  rows: InventoryRow[]
  onClose: () => void
  onDone: () => void
}) {
  const [itemId, setItemId] = useState('')
  const [locStock, setLocStock] = useState<ItemLocationStock[] | null>(null)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [qtyStr, setQtyStr] = useState('')
  const [swapMode, setSwapMode] = useState(false)
  const [busy, setBusy] = useState(false)

  const item = rows.find(r => r.id === itemId) ?? null
  const unit = item ? (item.trackUnit === 'qty' ? (item.qtyUnit ?? '개') : (item.specUnit ?? item.qtyUnit ?? '개')) : '개'
  const fromLoc = locStock?.find(l => l.id === fromId) ?? null
  const toLoc = locStock?.find(l => l.id === toId) ?? null
  const qty = Number(qtyStr) || 0
  const moveQty = swapMode ? 0 : (qtyStr === '' ? (fromLoc?.qty ?? 0) : qty)
  const canSubmit = !!item && !!fromLoc && !!toLoc && fromId !== toId
    && (swapMode ? ((fromLoc?.qty ?? 0) > 0 || (toLoc?.qty ?? 0) > 0) : (moveQty > 0 && moveQty <= (fromLoc?.qty ?? 0)))

  const pickItem = async (id: string) => {
    setItemId(id); setLocStock(null); setFromId(''); setToId(''); setQtyStr(''); setSwapMode(false)
    if (!id) return
    const res = await getItemLocationStock(id)
    if (res.ok) setLocStock(res.locations)
    else pushToast('error', res.error)
  }

  const chip = (on: boolean, disabled = false) =>
    `min-h-[40px] px-3 rounded-lg border text-sm font-medium transition-colors ${disabled ? 'opacity-40' : ''} ${
      on ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--cream)]'
         : 'bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)]'}`

  const submit = async () => {
    if (!canSubmit || !item) return
    setBusy(true)
    const release = trackSave()
    try {
      const res = await transferLocationStock({
        trackedItemId: item.id, fromLocationId: fromId, toLocationId: toId,
        ...(swapMode ? { swap: true } : { qty: moveQty }),
      })
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', swapMode
        ? `${fromLoc!.name} ↔ ${toLoc!.name} 맞바꿈 완료`
        : `${fromLoc!.name} → ${toLoc!.name} ${moveQty}${unit} 이동 완료`)
      onDone()
    } finally { release(); setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="재고 옮기기" width="sm"
      subtitle="위치에서 위치로 옮기거나 두 위치를 통째로 맞바꿉니다. 총 재고는 변하지 않아요.">
      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">1. 무엇을 옮길까요?</label>
          <select value={itemId} onChange={e => pickItem(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
            <option value="">품목 선택…</option>
            {rows.map(r => <option key={r.id} value={r.id}>{r.label} ({r.category})</option>)}
          </select>
        </div>

        {item && locStock && (
          <>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">2. 어디에서 꺼낼까요?</label>
              <div className="flex flex-wrap gap-1.5">
                {locStock.filter(l => l.qty > 0 || swapMode).map(l => (
                  <button key={l.id} type="button" className={chip(fromId === l.id)}
                    onClick={() => { setFromId(l.id); if (toId === l.id) setToId('') }}>
                    {l.name}{l.isHub ? ' (허브)' : ''} · {fmtQty(l.qty, unit)}
                  </button>
                ))}
              </div>
              {locStock.every(l => l.qty <= 0) && !swapMode && (
                <p className="text-[0.625rem] text-[var(--warm-muted)]">재고가 있는 위치가 없습니다.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">3. 어디로 옮길까요?</label>
              <div className="flex flex-wrap gap-1.5">
                {locStock.filter(l => l.id !== fromId).map(l => (
                  <button key={l.id} type="button" className={chip(toId === l.id)}
                    onClick={() => setToId(l.id)}>
                    {l.name}{l.isHub ? ' (허브)' : ''} · {fmtQty(l.qty, unit)}
                  </button>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
              <input type="checkbox" checked={swapMode}
                onChange={e => { setSwapMode(e.target.checked); setQtyStr('') }}
                className="w-3.5 h-3.5 accent-[var(--coral)]" />
              두 위치의 재고를 통째로 맞바꾸기
            </label>

            {!swapMode && fromLoc && (
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">4. 얼마나 옮길까요?</label>
                <div className="flex items-center gap-1.5">
                  <input value={qtyStr} inputMode="decimal"
                    onChange={e => setQtyStr(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={fmtQty(fromLoc.qty, null)}
                    className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                  <span className="text-xs text-[var(--warm-muted)]">{unit}</span>
                  <Btn type="button" variant="secondary" size="sm" onClick={() => setQtyStr(String(fromLoc.qty))}>전부</Btn>
                </div>
                {moveQty > (fromLoc.qty ?? 0) && (
                  <p className="text-[0.625rem] text-[var(--danger-fg)]">{fromLoc.name}에 있는 {fmtQty(fromLoc.qty, unit)}보다 많이 옮길 수 없어요.</p>
                )}
              </div>
            )}

            {fromLoc && toLoc && canSubmit && (
              <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-3.5 py-2.5 text-xs text-[var(--warm-dark)] space-y-0.5">
                <p className="font-semibold text-[var(--warm-mid)]">이렇게 바뀝니다</p>
                {swapMode ? (
                  <>
                    <p>{fromLoc.name}: {fmtQty(fromLoc.qty, unit)} → <strong>{fmtQty(toLoc.qty, unit)}</strong></p>
                    <p>{toLoc.name}: {fmtQty(toLoc.qty, unit)} → <strong>{fmtQty(fromLoc.qty, unit)}</strong></p>
                  </>
                ) : (
                  <>
                    <p>{fromLoc.name}: {fmtQty(fromLoc.qty, unit)} → <strong>{fmtQty(fromLoc.qty - moveQty, unit)}</strong></p>
                    <p>{toLoc.name}: {fmtQty(toLoc.qty, unit)} → <strong>{fmtQty(toLoc.qty + moveQty, unit)}</strong></p>
                  </>
                )}
              </div>
            )}
          </>
        )}

        <div className="flex gap-2 pt-1">
          <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={onClose}>취소</Btn>
          <Btn type="button" variant="primary" size="md" className="flex-1" onClick={submit} disabled={!canSubmit || busy}>
            {busy ? '처리 중…' : swapMode ? '맞바꾸기' : '옮기기'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

function LocationBatchCheckModal({ rows, onClose, onDone, inline = false, onDraftChange }: {
  rows: InventoryRow[]; onClose: () => void; onDone: () => void; inline?: boolean; onDraftChange?: () => void
}) {
  const [locs, setLocs] = useState<StorageLocationItem[]>([])
  const [locId, setLocId] = useState('')
  const [transferOpen, setTransferOpen] = useState(false)   // 위치 간 이동·맞바꿈(운영자 요청 2026-07-08)
  const [date, setDate] = useState(kstYmdStr())
  const [pending, setPending] = useState(false)
  const [draftPending, setDraftPending] = useState(false)
  const [error, setError] = useState('')
  const [mergeChoice, setMergeChoice] = useState<'merge' | 'new' | null>(null)
  const [confirmItems, setConfirmItems] = useState<InventoryRow[]>([])
  // 더블클릭/중복 제출 동기 차단 — setPending 은 리렌더 후에야 버튼을 disabled 하므로,
  // 그 사이 두 번째 클릭이 doSave 에 재진입해 보충(허브 차감)이 2번 적용되던 심각한 버그 방지.
  const savingRef = useRef(false)

  useEffect(() => { getStorageLocations().then(setLocs) }, [])

  const selectedLoc = locs.find(l => l.id === locId) ?? null

  const locItems = locId
    ? rows.filter(r => !r.isArchived && r.locations.some(l => l.id === locId))
    : []

  // 위치별 "보충 전" + "보충 후" — 비허브 위치는 두 칸, 허브 위치는 후만 의미 있음
  const [beforeQtys, setBeforeQtys] = useState<Record<string, string>>({})
  const [afterQtys, setAfterQtys]   = useState<Record<string, string>>({})

  useEffect(() => {
    if (!locId) return
    // 현재 잔량(보충 전)은 빈칸으로 시작 — 직접 세어 입력(미리 채운 값 수정 번거로움 해소).
    // 보충 후만 입력하고 현재 잔량을 비운 경우는 computeRow 가 직전 잔량을 보충 기준으로 삼아
    // 허브 미차감(총량 변동) 버그를 막는다. CheckForm 과 동작 통일.
    setBeforeQtys({})
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
    // 최종 잔량 = 보충 후(입력 시) 아니면 현재 잔량. 현재 잔량만 입력해도 점검으로 저장된다.
    const finalN = a ?? b
    // 보충량: 보충 후만 입력하고 현재 잔량을 비웠다면 직전 잔량을 기준으로 삼아 허브 미차감 방지
    const restockBase = b ?? (r.lastCheckLocationBreakdown.find(lb => lb.locationId === locId)?.qty ?? null)
    const restocked = (restockBase !== null && a !== null && a > restockBase) ? a - restockBase : 0
    return { beforeStr, afterStr, beforeN: b, afterN: a, finalN, restocked }
  }

  const isItemDirty = (r: InventoryRow) => {
    const { beforeStr, afterStr } = computeRow(r)
    return beforeStr !== '' || afterStr !== ''
  }

  const totalRestock = locItems.reduce((s, r) => s + computeRow(r).restocked, 0)

  const doSave = async (forceMerge?: boolean) => {
    if (savingRef.current) return   // 이미 저장 진행 중 — 중복 제출(더블클릭) 차단
    const toSave = locItems.filter(isItemDirty)
    if (toSave.length === 0) { setError('저장할 수량이 없습니다.'); return }
    savingRef.current = true
    setPending(true); setError('')
    const locName = selectedLoc?.name ?? ''
    const now = Date.now()
    try {
      await Promise.all(toSave.map(r => {
        const { finalN, restocked } = computeRow(r)
        // #3 서버가 DB의 현재(머지대상)·직전(신규) 위치별 잔량을 base로 허브 차감·이월을 계산한다.
        //    (클라가 props의 stale한 직전값으로 계산하던 과다 차감·덮어쓰기 버그 제거)
        const hubLoc = r.locations.find(l => l.isHub)
        const locationPatch = {
          checkedLocationId: locId!,
          afterQty: finalN ?? 0,
          restockedQty: restocked,
          hubLocationId: hubLoc?.id ?? null,
        }

        // 6h 이내 같은 날 기존 점검 존재 → 자동 머지.
        // 단, 사용자가 점검일을 과거 날짜로 고른 경우(백필)는 머지하지 않음 —
        // 오늘 점검에 합쳐지면 고른 날짜가 무시되던 문제.
        const dateIsToday = date === kstYmdStr()
        const sameDay = r.lastCheckId && r.lastCheckCreatedAt && isSameKstDay(new Date(r.lastCheckCreatedAt), new Date())
        const within6h = r.lastCheckCreatedAt && (now - new Date(r.lastCheckCreatedAt).getTime()) < 6 * 3600_000
        const shouldMerge = dateIsToday && (forceMerge || (sameDay && within6h))

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
      savingRef.current = false
    }
  }

  const handleSave = async () => {
    const toSave = locItems.filter(isItemDirty)
    if (toSave.length === 0) { setError('저장할 수량이 없습니다.'); return }

    // 같은 날, 6h 초과 → 사용자 확인 필요 (과거 날짜 백필이면 머지 자체가 없으므로 확인 불필요)
    const now = Date.now()
    const needsConfirm = date === kstYmdStr() ? toSave.filter(r =>
      r.lastCheckId && r.lastCheckCreatedAt &&
      isSameKstDay(new Date(r.lastCheckCreatedAt), new Date()) &&
      (now - new Date(r.lastCheckCreatedAt).getTime()) >= 6 * 3600_000
    ) : []
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
      className={inline ? undefined : 'fixed inset-0 bg-black/70 z-[var(--z-modal-3)] flex items-end sm:items-center justify-center'}
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
              보충 전·후를 입력하면 늘어난 만큼 그 품목의 창고(허브)에서 자동 차감됩니다. (이 위치가 허브인 품목은 현재 잔량만 입력)
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
          {/* 위치 간 이동 — 점검(허브 자동 차감)과 별개의 명시적 이동·맞바꿈 */}
          <div className="flex justify-end">
            <Btn type="button" variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>재고 옮기기</Btn>
          </div>
        </div>
        {transferOpen && (
          <TransferStockModal rows={rows} onClose={() => setTransferOpen(false)}
            onDone={() => { setTransferOpen(false); onDone() }} />
        )}

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
              // 선택한 위치가 '이 품목'의 허브인지 — 품목마다 허브가 다르므로 행별로 판정.
              const rowIsHub = r.locations.find(l => l.id === locId)?.isHub ?? false
              return (
                <div key={r.id} className="space-y-1 border-b border-[var(--warm-border)]/40 pb-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--warm-dark)] truncate">{r.label}</p>
                      <p className="text-[0.625rem] text-[var(--warm-muted)]">{r.category}</p>
                    </div>
                  </div>
                  {/* 참고줄 — 직전 잔량·지난 보충량 계속 표시 */}
                  {(prev != null || (restocked > 0 && !rowIsHub)) && (
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[0.625rem] bg-[var(--canvas)] rounded-md px-2 py-1">
                      {prev != null && <span className="text-[var(--warm-mid)]">직전 잔량 <strong className="text-[var(--warm-dark)] tabular-nums">{prev.qty}{stockUnit ?? ''}</strong></span>}
                      {prev?.restockedQty != null && prev.restockedQty > 0 && <span className="text-[var(--warm-muted)]">· 지난 보충 <strong className="text-[var(--coral)] tabular-nums">+{Math.round(prev.restockedQty * 100) / 100}{stockUnit ?? ''}</strong></span>}
                      {restocked > 0 && !rowIsHub && <span className="text-[var(--coral)] ml-auto">이번 보충 <strong className="tabular-nums">+{Math.round(restocked * 100) / 100}{stockUnit ?? ''}</strong></span>}
                    </div>
                  )}
                  {rowIsHub ? (
                    // 허브 위치 점검 — 잔량 1칸
                    <div className="flex items-center gap-1.5">
                      <p className="text-[0.5625rem] text-[var(--warm-muted)] shrink-0 w-16">잔량</p>
                      <input type="text" inputMode="decimal" placeholder="0"
                        value={afterStr}
                        onChange={e => setAfterQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className={qtyInputCls} />
                      <span className="text-[0.625rem] text-[var(--warm-muted)] w-6 shrink-0 text-right">{stockUnit ?? ''}</span>
                      {prev != null && (
                        <button type="button"
                          onClick={() => setAfterQtys(p => ({ ...p, [r.id]: String(prev.qty) }))}
                          className="shrink-0 text-[0.625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                          직전값
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* 비허브 위치 점검 — 현재 잔량 / 보충 후(선택) */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">현재 잔량 (보충 전)</p>
                          <input type="text" inputMode="decimal" placeholder="0"
                            value={beforeStr}
                            onChange={e => setBeforeQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                            className={qtyInputCls} />
                        </div>
                        <div>
                          <p className="text-[0.5625rem] text-[var(--warm-muted)] mb-0.5">보충 후 <span className="text-[var(--warm-muted)]/70">(보충 시)</span></p>
                          <input type="text" inputMode="decimal" placeholder="—"
                            value={afterStr}
                            onChange={e => setAfterQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                            className={qtyInputCls} />
                        </div>
                      </div>
                      {/* 보충 없음 — 추가 보충 없이 센 값 그대로 확정(보충 후=현재 잔량). 안 셌으면 직전 잔량으로 채움 */}
                      <div className="flex justify-end mt-1">
                        <button type="button"
                          onClick={() => {
                            if (beforeStr !== '') setAfterQtys(p => ({ ...p, [r.id]: beforeStr }))
                            else if (prev != null) {
                              const v = String(prev.qty)
                              setBeforeQtys(p => ({ ...p, [r.id]: v }))
                              setAfterQtys(p => ({ ...p, [r.id]: v }))
                            }
                          }}
                          className="text-[0.625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                          보충 없음
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })
          )}
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {locId && locItems.length > 0 && totalRestock > 0 && (
          <div className="border-t border-[var(--coral)]/20 bg-[var(--coral)]/5 px-5 py-2 shrink-0">
            <p className="text-[0.6875rem] text-[var(--warm-mid)]">
              보충한 만큼 각 품목의 창고(허브) 잔량에서 자동 차감됩니다.
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
        {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
  const [undos, setUndos] = useState<MergeUndoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [pendingId, setPendingId] = useState<string | null>(null)
  const load = () => Promise.all([getMergeRules(), getMergeUndos()]).then(([r, u]) => { setRules(r); setUndos(u); setLoading(false) })
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

  const undo = async (id: string) => {
    const ok = await confirmDialog({
      title: '이 병합을 적용취소할까요?',
      message: '합쳐졌던 지출·점검이 원래 품목으로 분리되고, 원래 품목 카드가 다시 생깁니다.\n카드 병합이었던 경우 위치별 재고 연결·허브(창고) 설정은 복원되지 않아 보관 위치를 다시 지정해야 할 수 있습니다.',
      level: 'caution', confirmLabel: '적용취소',
    })
    if (!ok) return
    setPendingId(id)
    unmergeTrackedItem(id).then(res => {
      setPendingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '병합을 적용취소했습니다')
      load()
    })
  }

  const links = rules.filter(r => r.kind === 'LINK')
  const mutes = rules.filter(r => r.kind === 'MUTE')
  const isEmpty = rules.length === 0 && undos.length === 0

  return (
    <Modal open onClose={onClose} width="md" title="병합 적용취소·규칙"
      subtitle="잘못 합친 품목 되돌리기 · 자동등록 추천(연결)·거절(다시 안 물어봄) 관리">
      <div className="px-5 sm:px-6 py-4 space-y-4">
        {loading ? <Loading /> : isEmpty ? (
          <EmptyState title="병합 기록이 없습니다"
            description="품목을 병합하거나, 자동등록 확인에서 '새 품목으로'를 고르면 여기에 기록이 쌓입니다." />
        ) : (
          <>
            {undos.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--warm-mid)]">되돌릴 수 있는 병합 · 합친 걸 원래대로 분리</p>
                {undos.map(u => (
                  <div key={u.id} className="flex items-center gap-2 text-sm bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[var(--warm-dark)]">{u.label}</span>
                    <button type="button" onClick={() => undo(u.id)} disabled={pendingId === u.id}
                      className="text-[0.6875rem] font-medium text-[var(--success-fg)] ring-1 ring-[var(--success-ring)] hover:bg-[var(--success-bg)] disabled:opacity-40 shrink-0 px-2 py-1 rounded-lg">적용취소</button>
                  </div>
                ))}
              </div>
            )}
            {links.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--warm-mid)]">연결 · 이 라벨은 해당 카드로 추천</p>
                {links.map(r => (
                  <div key={r.id} className="flex items-center gap-2 text-sm bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">
                    <span className="min-w-0 flex-1 truncate text-[var(--warm-dark)]">
                      <strong>{r.sourceLabel}</strong> → {r.targetLabel ?? <span className="text-[var(--warm-muted)]">(삭제된 카드)</span>}
                    </span>
                    <span className="text-[0.5625rem] text-[var(--warm-muted)] shrink-0">{r.category}</span>
                    <button type="button" onClick={() => remove(r.id)} disabled={pendingId === r.id}
                      className="text-[0.6875rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 shrink-0 px-2 py-1 rounded-lg hover:bg-[var(--danger-bg)]">연결 해제</button>
                  </div>
                ))}
              </div>
            )}
            {mutes.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-semibold text-[var(--warm-mid)]">거절 · 다시 추천 안 함</p>
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

// ── 숨김 품목 모달 ─────────────────────────────────────
// 당분간 사용하지 않거나 병합으로 빠진 품목을 다시 활성화합니다.
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
    <Modal open onClose={onClose} title="숨김 품목" subtitle="당분간 사용 안 함으로 숨긴 품목, 또는 병합으로 빠진 품목을 다시 활성화합니다." width="sm">
      {loading ? (
        <Loading />
      ) : items.length === 0 ? (
        <p className="text-sm text-[var(--warm-muted)] text-center py-8">숨겨진 품목이 없습니다.</p>
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
    if (!(await confirmDialog({ title: `'${name}' 위치를 삭제할까요?`, message: '이 위치가 할당된 품목에서도 자동으로 제거됩니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setPending(true)
    const res = await deleteStorageLocation(id)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    reload()
  }

  return (
    <Modal open onClose={onClose} title="보관 위치 관리" subtitle="창고 / 4층 주방 / 손님실 등 보관 장소를 등록하세요" width="sm">
      <div className="px-5 sm:px-6 py-4 space-y-4">
        {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
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
                    title={loc.isHub ? '기본 창고 해제' : '기본 창고로 지정 (품목별로 지정 안 한 경우의 기본값)'}
                    onClick={async () => {
                      setPending(true)
                      await toggleStorageLocationHub(loc.id, !loc.isHub)
                      reload()
                      setPending(false)
                    }}
                    className={`text-[0.625rem] px-2 py-1 rounded-lg border transition-colors ${loc.isHub ? 'bg-[var(--warning-bg)] border-[var(--warning-ring)] text-[var(--warning-fg)]' : 'border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-[var(--warning-ring)] hover:text-[var(--warning-fg)]'}`}>
                    {loc.isHub ? '기본 창고 ✓' : '기본 창고'}
                  </button>
                  <button type="button" onClick={() => { setEditId(loc.id); setEditName(loc.name) }}
                    className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--cream)]">수정</button>
                  <button type="button" onClick={() => handleDelete(loc.id, loc.name)} disabled={pending}
                    className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--danger-bg)]">삭제</button>
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
          <strong className="text-[var(--warning-fg)]">허브</strong>로 지정한 위치(예: 창고)는 위치별 점검 시 "이동 수량" 입력란이 표시됩니다.
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
        {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
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
        {saved && <span className="text-[0.625rem] text-[var(--success-fg)]">저장됨</span>}
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
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
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
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
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
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]">
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
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]">
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
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
      </div>
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}
