'use client'

import { useEffect, useState, useTransition, useRef } from 'react'
import { fmtDateDot as fmtDate, fmtDateKor, fmtMonthDayKor } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { ErrorBoundary } from '@/components/ui/ErrorBoundary'
import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'
import { askShiftRows, askShiftRowsRequired, type ShiftAskResult } from '@/lib/stockShiftAsk'
import { Loading } from '@/components/ui/Loading'
import { Modal, ModalFooterActions } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader, DotMarker } from '@/components/ui/inventory/SectionHeader'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { InventoryCard as InvCard } from '@/components/ui/inventory/InventoryCard'
import { MergeSheet, type MergeTarget } from '@/components/ui/inventory/MergeSheet'
import { mergeItemNames } from '@/app/(app)/finance/actions'   // 수령 대기 품명 합치기(OCR 풀네임 → 기존 품목, v2.0 §16 별칭 학습 포함)
import MonthSelector from '@/components/layout/MonthSelector'
import { kstYmdStr, kstDateTimeToUtc, splitKstDateTime } from '@/lib/kstDate'
import { specMultiplier, isSpecDimensionMismatch, listCompatibleUnits, unitFactor, splitSizeLabel } from '@/lib/units'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useCanEditScope } from '@/components/RoleContext'
import { SpecWizard, type SpecWizardResult } from '@/components/ui/SpecWizard'
import { InfoHint } from '@/components/ui/InfoHint'
import { SearchBar } from '@/components/ui/SearchBar'
import { useFocusSection } from '@/lib/useFocusSection'
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
  deleteTrackedItemIfEmpty,
  getArchivedTrackedItems,
  unarchiveTrackedItem,
  mergeTrackedItems,
  reorderTrackedItems,
  createStockCheck,
  createStockAddition,
  updateStockCheck,
  saveFullReconcile,
  getStockAsOf,
  deleteStockCheck,
  deleteStockAddition,
  createStockDisposal, deleteStockDisposal, undoDeleteStockDisposal,
  updateStockAddition,
  updateExpenseFromInventory,
  excludeExpenseFromInventory,
  includeExpenseInInventory,
  seedTrackedItemsFromExpenses,
  confirmReceipt,
  confirmAllPending,
  getStorageLocations, reorderStorageLocations,
  createStorageLocation,
  updateStorageLocation,
  deleteStorageLocation,
  toggleStorageLocationHub,
  setItemHub,
  setItemLocations,
  reopenItemLocation,
  batchSetItemLocations,
  saveStockCheckDraft,
  deleteStockCheckDraft,
  deleteItemDrafts,
  getItemDrafts,
  getLocationDrafts,
  getDraftLocationSummary,
  getDraftItemIds,
  applyMergeDecision,
  getPendingMergeDecisions,
  getMergeRules,
  deleteMergeRule,
  getMergeUndos,
  unmergeTrackedItem,
  setInventoryCategories,
  getItemLocationStock, transferLocationStock,
  previewStockAdditionShift, undoUpdateStockAddition,
  previewExpenseStockShift, undoCancelReceipt,
  undoConfirmReceipt, undoPartialReceipt, undoDeleteStockCheck, undoDeleteStockAddition, type ItemLocationStock, type HubShortResponse,
} from './actions'
import { type StorageLocationItem, type LocationQtyEntry, type MergeDecision, type MergeRuleRow, type MergeUndoRow, type DiffAttribution } from './constants'

// 드래그 순서 override 정렬용 rank — 배열에 없는 id는 뒤로(안정 정렬로 서버 상대순서 보존).
const rankInOrder = (ord: string[], id: string) => { const i = ord.indexOf(id); return i < 0 ? Number.MAX_SAFE_INTEGER : i }

// v2.0 §04 — 카테고리 마커 색은 viz 팔레트 토큰만(새 hue 금지·v2.0 §04). 틴트 bg는 color-mix 10%.
const vizTint = (v: string): { bg: string; fg: string } =>
  ({ bg: `color-mix(in srgb, var(${v}) 10%, transparent)`, fg: `var(${v})` })
const CATEGORY_TINT: Record<string, { bg: string; fg: string }> = {
  '소모품비':     vizTint('--viz-1'),   // terracotta (기존 persimmon 유지)
  '부식비':       vizTint('--viz-4'),   // amber
  '폐기물 처리비': vizTint('--viz-7'),  // sage (구 쿨블루 — v2.0 §04 신규 hue 폐기)
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

// 품목 행의 표시 단위 — 추적 단위(spec/qty)에 맞춰. TransferStockModal 과 동일 규칙.
// unitHint = 카드 단위가 비었을 때의 표시 폴백(구매 단위 전원일치일 때만 서버가 내림).
const rowUnit = (r: InventoryRow) => r.trackUnit === 'qty' ? (r.qtyUnit ?? r.unitHint ?? '개') : (r.specUnit ?? r.qtyUnit ?? r.unitHint ?? '개')

// ── 무상 입수 정정이 뒤 점검에 미치는 영향 묻기 (운영자 신고 2026-08-19, 쌀 40kg)
// 점검 잔량은 절대값이라 입수 날짜를 앞으로 옮기면 그 사이 점검이 입수를 삼켜 잔량이 증발한다.
// 서버가 만든 조정 계획(lib/stockLedger)을 실제 숫자로 보여주고 운영자가 고르게 한다.
// 조용한 덮어쓰기는 하지 않는다 — 실제로 센 값이면 '이 기록만' 을 고르면 된다.
type ShiftAsk = ShiftAskResult

async function askLedgerShift(input: {
  trackedItemId: string
  additionId?: string | null
  next?: { date: string; addedQty: number; storageLocationId: string | null } | null
  title: string
  keepLine: string                      // 이번 변경으로 바뀌지 않는 것 한 줄
  impactLine: (n: number) => string     // 무엇이 어긋났는지 한 줄
  unit: string | null
}): Promise<{ result: ShiftAsk; error?: string }> {
  const pre = await previewStockAdditionShift({
    trackedItemId: input.trackedItemId, additionId: input.additionId ?? null, next: input.next ?? null,
  })
  if (!pre.ok) return { result: null, error: pre.error }
  // 어긋나는 점검이 없으면 묻지 않는다 — 날짜 오타 정정이 대부분이라 매번 물으면 확인창이 소음이 된다.
  // 다이얼로그 문법은 공용 정본(lib/stockShiftAsk) — 지출 쪽 물음과 같은 모양이어야 한다.
  const result = await askShiftRows({
    rows: pre.rows, title: input.title, keepLine: input.keepLine, impactLine: input.impactLine, unit: input.unit,
  })
  return { result }
}

// 허브 부족 팝업이 다룰 한 품목 — 서버 감지 정보 + 이 품목 저장을 다시 실행하는 클로저.
type HubShortPending = {
  trackedItemId: string
  itemLabel: string       // 다품목 큐에서 어느 품목인지 표시(비면 숨김)
  unit: string | null
  info: HubShortResponse
  // allowHubClamp:true 면 강행 저장, 아니면 이동으로 허브를 채운 뒤 재저장. 성공 시 새 점검 id 반환.
  // excludeLocationIds — 경로 B 에서 이동 출처 위치를 절대 locationQtys 에서 제거해 유령 재고(총량 과다) 방지.
  retry: (opts: { allowHubClamp?: boolean; excludeLocationIds?: string[] }) => Promise<{ ok: true; id: string } | { ok: false; error: string } | HubShortResponse>
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

// 단가 표기 — ml·g 단위 품목은 1원 미만이라 정수 반올림하면 유효숫자가 통째로 사라진다.
// 주방세제 실제 2.1486원/ml 가 '2원/ml' 로 떠 재고 평가가 6.9% 왜곡됐다(C페이즈 조사 2026-08-03).
// 1원 미만은 소수 2자리까지 보여준다.
function fmtUnitPrice(v: number): string {
  if (v >= 100) return fmtWon(Math.round(v))
  if (v >= 10) return `${(Math.round(v * 10) / 10).toLocaleString()}원`
  return `${(Math.round(v * 100) / 100).toLocaleString()}원`
}

export default function InventoryClient({ initialRows, targetMonth, categories, allExpenseCategories }: { initialRows: InventoryRow[]; targetMonth: string; categories: InventoryCategory[]; allExpenseCategories: string[] }) {
  const canEditUi = useCanEditScope('inventory')   // 재고 편집 — OWNER·MANAGER + 제한 스태프(재고 쓰기). 서버가 최종 방어
  // 재고 카테고리(cat) → 표시 별칭(alias) 맵 + 카테고리 cat 목록(순서 보존)
  const aliasOf = (cat: string) => categories.find(c => c.cat === cat)?.alias ?? cat
  const trackedCats = categories.map(c => c.cat)
  const router = useRouter()
  const searchParams = useSearchParams()
  // 종 알림(재고 소진 임박·수령 대기)이 ?focus= 로 보내는 섹션으로 스크롤
  useFocusSection()
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
  const [openMenu, setOpenMenu]           = useState<'input' | 'manage' | 'sort' | null>(null)   // 헤더 그룹 버튼(입력·점검 / 관리·설정 / 정렬)
  const [showLocations, setShowLocations] = useState(false)
  const [detailId, setDetailId]           = useState<string | null>(null)
  // 상세 진입 시 시작 모드 — 기본은 보기, '다음 품목' 이어가기로 열면 점검 폼부터(아이템별 연속 점검)
  const [detailInitialMode, setDetailInitialMode] = useState<'view' | 'check'>('view')
  const openDetail = (id: string, m: 'view' | 'check' = 'view') => { setDetailInitialMode(m); setDetailId(id) }
  const [error, setError]                 = useState('')
  const [selectMode, setSelectMode]       = useState(false)
  const [selected, setSelected]           = useState<Set<string>>(new Set())
  const [showBatchLoc, setShowBatchLoc]     = useState(false)
  // 점검 진입 방식 — 'item'(품목별 목록) / 'location'(위치별 일괄). 마지막 선택 기억.
  // 초기값은 서버와 동일하게 'item' 고정, 저장된 선택은 마운트 후 복원 — useState에서 localStorage를
  // 읽으면 서버 HTML(item)과 클라 첫 렌더(location)가 어긋나 하이드레이션 #418(오류신고 5489fac1).
  const [viewMode, setViewMode] = useState<'item' | 'location'>('item')
  useEffect(() => {
    const v = localStorage.getItem('stayeum-inventory-view')
    // 마운트 후 1회 복원 — 하이드레이션 정합을 위한 의도된 setState(연쇄 렌더 아님)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (v === 'location') setViewMode('location')
  }, [])
  // v2.0 §23 메인 검색 — 품목명·카테고리·메모 대상. 품목별·위치별 두 보기와 수령 대기 목록에 동일 적용.
  // 초기값은 전역 통합 검색의 ?q= 딥링크 시딩(있을 때만).
  const [search, setSearch] = useState(() => searchParams.get('q') ?? '')
  const q = search.trim().toLowerCase()
  const visibleRows = q
    ? rows.filter(r => r.label.toLowerCase().includes(q) || r.category.toLowerCase().includes(q) || (r.memo ?? '').toLowerCase().includes(q))
    : rows
  const changeView = (m: 'item' | 'location') => {
    setViewMode(m)
    if (typeof window !== 'undefined') localStorage.setItem('stayeum-inventory-view', m)
    if (m === 'location') { exitSelectMode(); setOrderEditMode(false) }
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
  // 재고 카드에 못 붙은 채 대기 중인 구매. 저장 시 비슷한 이름이 있으면 확인 대기로 보류되는데,
  // 그 보류를 보여주는 화면이 2026-07-09 이후로 없었다 — 구매가 조용히 사라져 되살릴 길이 없었다.
  const [pendingMerges, setPendingMerges] = useState<MergeDecision[]>([])
  const refreshPendingMerges = () => { void getPendingMergeDecisions().then(setPendingMerges).catch(() => {}) }
  useEffect(() => { refreshPendingMerges() }, [])
  const [showMergeRules, setShowMergeRules] = useState(false)
  const [showReconcile, setShowReconcile]   = useState(false)
  const [showCatSettings, setShowCatSettings] = useState(false)

  // 수령 대기 — 비품·자재와 동일하게 상단 섹션에서 인라인 '수령 완료'로 통일 (#2)
  // 같은 품목 다건은 비품의 '합산 N건'처럼 묶어 한 번에 수령(키 = label|category).
  const [receivingKey, setReceivingKey] = useState<string | null>(null)
  // 수령 완료 즉시 카드 숨김(낙관적) — refresh 지연 시 카드가 남아 중복 클릭되던 신고(2026-07-10)
  const [receivedIds, setReceivedIds] = useState<Set<string>>(new Set())
  const [pendExpanded, setPendExpanded] = useState<Set<string>>(new Set())
  const togglePendExpand = (key: string) => setPendExpanded(prev => {
    const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n
  })
  // 용량을 모르는 채로 수령하면 재고에 총량이 아니라 **개수**가 들어간다(주방세제 8,400ml 대신 4).
  // 잔량과 평균 단가가 한꺼번에 틀어지고 소진 예측이 무너진다. 차단이 아니라 되묻는다 —
  // 장부와 실물이 어긋나는 상황은 상시 조건이라 막으면 운영이 멈춘다(HubShortDialog 와 같은 문법).
  const confirmQuickReceive = async (key: string, expenseIds: string[], label: string, qtyText: string) => {
    const ok = await confirmDialog({
      title: '낱개 용량이 비어 있습니다. 그대로 수령할까요?',
      message: `${label}의 낱개 용량을 몰라 재고에는 ${qtyText}로 들어갑니다.\n지출에서 용량을 넣으면 총량이 다시 계산됩니다.`,
      level: 'caution', confirmLabel: '그대로 수령',
    })
    if (ok) handleQuickReceive(key, expenseIds)
  }

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
      else {
        setReceivedIds(prev => new Set([...prev, ...expenseIds]))   // 즉시 숨김 — refresh 대기 없이
        router.refresh()
        pushToast('success', '수령 확인 완료', {
          action: { label: '수령 취소', run: () => { void (async () => {
            for (const id of [...expenseIds].reverse()) { const r = await undoConfirmReceipt(id); if (!r.ok) { pushToast('error', r.error); return } }
            setReceivedIds(prev => { const n = new Set(prev); for (const id of expenseIds) n.delete(id); return n })
            pushToast('info', '수령을 취소하고 수령 대기로 되돌렸습니다')
            router.refresh()
          })().catch(() => pushToast('error', '수령 취소 중 통신 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.')) } },
        })
      }
    })()
      // 통신 실패(배포 교체·오프라인)가 unhandledrejection으로만 남고 화면엔 아무 표시가 없어
      // 재클릭을 유도하던 문제 — 서버는 멱등 가드가 있지만 사용자에겐 실패를 알려야 한다.
      .catch(() => pushToast('error', '수령 확인 중 통신 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.'))
      .finally(() => { setReceivingKey(null); release() })
  }

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  // 합치기 — v2.0 §22 MergeSheet 단일. 선택한 품목들을 대표(남는 카드)로 합침(mergeTrackedItems).
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

  // 품목 순서 편집(운영자 확정 UX (가)안) — '순서 편집' 모드에서 카테고리 그룹별 컴팩트 1열 행을 통째로
  // 잡아 끈다(아이폰 설정·알람 방식). 그룹(카테고리) 안에서만 이동, 놓는 순간 그 카테고리 전체 순서를
  // 서버 저장(reorderTrackedItems). itemOrder = 카테고리별 낙관적 id 순서(드래그 중·저장 성공 후 유지,
  // 실패 시 원복). 부분 목록 저장 방지를 위해 모드 진입 시 검색을 초기화하고 검색바를 감춘다.
  const [orderEditMode, setOrderEditMode] = useState(false)
  const [itemOrder, setItemOrder] = useState<Record<string, string[]>>({})
  const [dragCat, setDragCat] = useState<string | null>(null)
  const [dragItemIdx, setDragItemIdx] = useState<number | null>(null)
  const itemOrderRef = useRef(itemOrder)
  useEffect(() => { itemOrderRef.current = itemOrder }, [itemOrder])   // 렌더 중 ref 접근 금지(react-compiler)
  const itemOrderChanged = useRef(false)
  const dragListElRef = useRef<HTMLElement | null>(null)
  // 정렬 프리셋(표시 전용, 운영자 메모 2026-07-18 → 승인 2026-07-22) — 수동 순서가 기본,
  // 가나다·최근 추가는 화면 정렬만 바꾸고 수동 sortOrder 는 보존. 순서 편집 모드는 항상 수동 기준.
  const [sortPreset, setSortPreset] = useState<'manual' | 'name' | 'newest'>('manual')
  useEffect(() => {
    try {
      const v = localStorage.getItem('stayeum-inventory-sort')
      // 마운트 후 1회 복원 — 하이드레이션 정합을 위한 의도된 setState(연쇄 렌더 아님)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v === 'name' || v === 'newest') setSortPreset(v)
    } catch { /* 무시 */ }
  }, [])
  const pickSortPreset = (v: 'manual' | 'name' | 'newest') => {
    setSortPreset(v)
    try { localStorage.setItem('stayeum-inventory-sort', v) } catch { /* 무시 */ }
  }
  // 카테고리별 그룹 — 설정된 카테고리 순서 + 표시 별칭. 설정 밖 카테고리(과거 등록분)는 뒤에 자체 표시.
  const extraCats = Array.from(new Set(rows.map(r => r.category))).filter(c => !trackedCats.includes(c))
  const groupedAll = [...trackedCats, ...extraCats].map(cat => {
    const catRows = visibleRows.filter(r => r.category === cat)
    const ord = itemOrder[cat]
    // 낙관적 순서 override 적용 — override에 없는 id(다른 새로고침으로 새로 들어온 품목)는 뒤로.
    // 정렬 프리셋은 표시 전용 — 순서 편집 모드에선 무시하고 항상 수동 순서를 보여준다(편집 대상과 화면 일치).
    const sorted = !orderEditMode && sortPreset === 'name'
      ? [...catRows].sort((a, b) => a.label.localeCompare(b.label, 'ko'))
      : !orderEditMode && sortPreset === 'newest'
      ? [...catRows].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : ord
      ? [...catRows].sort((a, b) => rankInOrder(ord, a.id) - rankInOrder(ord, b.id))
      : catRows
    return { cat, alias: aliasOf(cat), rows: sorted }
  })
  // 카테고리 상단 탭 — 비품·자재 대분류와 같은 문법(운영자 요청 2026-07-10). 마지막 선택 기억, 검색 중엔 전체.
  // 초기값 '__all__' 고정 + 마운트 후 복원 — viewMode와 동일한 하이드레이션 #418 방지 패턴.
  const [catTab, setCatTab] = useState<string>('__all__')
  useEffect(() => {
    try {
      const v = localStorage.getItem('stayeum-inventory-cat')
      // 마운트 후 1회 복원 — 하이드레이션 정합을 위한 의도된 setState(연쇄 렌더 아님)
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (v) setCatTab(v)
    } catch { /* 무시 */ }
  }, [])
  const pickCatTab = (v: string) => {
    setCatTab(v)
    try { localStorage.setItem('stayeum-inventory-cat', v) } catch { /* 무시 */ }
  }
  const searching = search.trim().length > 0
  // v2.0 §27 — 검색은 현재 탭 스코프 안에서. 스코프 밖 일치는 아래 힌트 한 줄로 안내(자동 해제 금지).
  const grouped = groupedAll.filter(g => catTab === '__all__' || g.cat === catTab)
  const outOfScopeCount = searching && catTab !== '__all__'
    ? visibleRows.filter(r => r.category !== catTab).length
    : 0

  // 행 드래그 핸들러 — 위치 관리 모달과 동일 구조(pointer capture → 이동 중 자리 교체 → 놓을 때 저장).
  // 컴팩트 1열 행이라 y 로 대상 행을 판정, 목록 위/아래는 양 끝으로 클램프.
  const onItemHandleDown = (cat: string, idx: number, baseIds: string[]) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragListElRef.current = (e.currentTarget as HTMLElement).closest('[data-item-drag-list]') as HTMLElement | null
    itemOrderChanged.current = false
    setItemOrder(prev => prev[cat] ? prev : { ...prev, [cat]: baseIds })
    setDragCat(cat)
    setDragItemIdx(idx)
  }
  const onItemHandleMove = (e: React.PointerEvent) => {
    if (dragCat == null || dragItemIdx == null || !dragListElRef.current) return
    const items = Array.from(dragListElRef.current.children) as HTMLElement[]
    if (items.length === 0) return
    let over = -1
    if (e.clientY < items[0].getBoundingClientRect().top) over = 0
    else if (e.clientY > items[items.length - 1].getBoundingClientRect().bottom) over = items.length - 1
    else {
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect()
        if (e.clientY >= r.top && e.clientY <= r.bottom) { over = i; break }
      }
    }
    if (over < 0 || over === dragItemIdx) return
    const cat = dragCat
    setItemOrder(prev => {
      const cur = prev[cat]
      if (!cur) return prev
      const next = [...cur]
      const [moved] = next.splice(dragItemIdx, 1)
      next.splice(over, 0, moved)
      return { ...prev, [cat]: next }
    })
    setDragItemIdx(over)
    itemOrderChanged.current = true
  }
  const onItemHandleUp = async () => {
    if (dragCat == null) return
    const cat = dragCat
    setDragCat(null)
    setDragItemIdx(null)
    if (!itemOrderChanged.current) return
    itemOrderChanged.current = false
    const ids = itemOrderRef.current[cat]
    if (!ids) return
    const res = await reorderTrackedItems(cat, ids)
    if (!res.ok) {
      pushToast('error', res.error)
      setItemOrder(prev => { const n = { ...prev }; delete n[cat]; return n })
      router.refresh()
      return
    }
    pushToast('success', '품목 순서 저장됨')
  }

  // 수령 대기 합치기 — OCR 풀네임 품목을 기존 품목으로(별칭 학습 → 다음 영수증부터 자동 치환)
  const [pendMerge, setPendMerge] = useState<{ label: string; category: string } | null>(null)
  const runPendMerge = (destId: string) => {
    if (!pendMerge) return
    const target = rows.find(r => r.id === destId)
    if (!target) return
    const src = pendMerge
    startTransition(async () => {
      const res = await mergeItemNames(target.label, [src.label])
      if (!res.ok) { pushToast('error', res.error); return }
      const orphan = rows.find(r => r.label === src.label && r.category === src.category)
      if (orphan) await deleteTrackedItemIfEmpty(orphan.id).catch(() => {})
      setPendMerge(null)
      pushToast('success', `'${target.label}'(으)로 합쳤습니다`, { detail: '이 구매가 그 품목 재고로 잡히고, 다음 영수증부터 자동 치환됩니다. 적용취소는 환경설정 품명 병합.' })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      {/* 동일 레벨 탭 — 소모품·부식(기본) / 비품·자재 + 월 전환(재고는 월별 이월·소비 데이터)
          v2.0 §25: 모바일=탭 윗줄·MonthSelector 아랫줄 고정(2줄), md=한 줄 justify-between.
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
              <InfoHint title="소모품·부식 재고란?">쓰면 줄어드는 물건(쌀·세제·봉투 등)의 잔량과 사용량을 위치(창고·주방)별로 추적합니다. 오래 쓰는 물건은 비품·자재 탭에서 방별로 배정합니다. 용어는 두 가지만 기억하세요. 점검: 실제 수량을 세서 기록(두 점검 사이 차이가 소모량이 됨) · 보정: 장부가 실제와 어긋났을 때 차이를 소모로 잡지 않고 기준만 실측값으로 리셋. 구매는 수령 확인 시 자동으로 더해집니다.</InfoHint>
            </h1>
          </div>
          {/* 점검 진입 방식 토글 — v2.0 §23 트랙형(보기 방식). 지출 '아이템별/주문별'과 동일 컴포넌트 */}
          <SegmentedControl size="sm" ariaLabel="점검 보기" className="shrink-0"
            value={viewMode} onChange={changeView}
            options={[{ value: 'item', label: '아이템별' }, { value: 'location', label: '위치별' }]} />
        </div>
        {/* 툴바는 보기 전환과 무관하게 항상 노출 — 형제(지출 아이템별·주문별)와 동일 문법.
            종전엔 viewMode==='item' 이 툴바 행 전체를 감싸 위치별에서 통째로 사라졌고(오류신고 2e82ab7b),
            viewMode 가 localStorage 로 복원되므로 위치별로 마지막에 본 사용자는 액션이 0개인 페이지로 진입했다.
            오클릭(97839062)은 여기 해당 없음 — 그 처방은 '제거'가 아니라 '점검 zone 밖으로 분리'였고,
            이 툴바는 sticky 검색창 위 페이지 크롬이라 카운팅 중엔 스크롤 아웃된다. */}
        <div className="flex gap-2 flex-wrap items-center">
            {orderEditMode ? (
            <Btn variant="primary" size="md" onClick={() => setOrderEditMode(false)}>완료</Btn>
            ) : (
            <>
            {/* '선택'만 아이템별 전용 — 위치별엔 선택할 카드가 없고 changeView 가 exitSelectMode 를 호출해 무반응이 된다 */}
            {viewMode === 'item' && canEditUi && (
            <Btn variant="secondary" size="md" onClick={() => { selectMode ? exitSelectMode() : setSelectMode(true) }}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
            )}
            {/* 순서 편집 — 진입 시 검색 초기화(부분 목록 저장 방지). 아이템별 + 편집권한 + 품목 있을 때만 */}
            {viewMode === 'item' && canEditUi && rows.length > 0 && (
            <Btn variant="secondary" size="md" onClick={() => { setSearch(''); exitSelectMode(); setOrderEditMode(true) }}>순서 편집</Btn>
            )}
            {/* 정렬 프리셋 — 표시 순서만 전환(수동 순서 보존). 기능군 버튼+하위 메뉴 문법 */}
            <div className="relative">
              <Btn variant="secondary" size="md" onClick={() => setOpenMenu(v => v === 'sort' ? null : 'sort')}>정렬{sortPreset === 'name' ? ': 가나다' : sortPreset === 'newest' ? ': 최근 추가' : ''}</Btn>
              {openMenu === 'sort' && (
                <>
                  <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setOpenMenu(null)} />
                  <div className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-1.5 shadow-lift">
                    {([
                      { v: 'manual' as const, label: '수동 순서 (기본)', desc: '순서 편집에서 정한 순서' },
                      { v: 'name' as const, label: '가나다순', desc: '품목 이름순 표시' },
                      { v: 'newest' as const, label: '최근 추가순', desc: '새로 만든 품목이 위로' },
                    ]).map(o => (
                      <button key={o.v} type="button" onClick={() => { setOpenMenu(null); pickSortPreset(o.v) }}
                        className={`block w-full rounded-lg px-2 py-1.5 text-left text-sm transition-colors hover:bg-[var(--canvas)] ${sortPreset === o.v ? 'text-[var(--coral)] font-semibold' : 'text-[var(--warm-dark)]'}`}>
                        {o.label}<span className="block text-[0.65625rem] font-normal text-[var(--warm-muted)]">{o.desc}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {/* 성격별 그룹 버튼 — 잡동사니 더보기 대신 기능군마다 버튼 + 하위 메뉴(운영자 지시 2026-07-06) */}
            <div className="relative">
              <Btn variant="secondary" size="md" onClick={() => setOpenMenu(v => v === 'input' ? null : 'input')}>입력·점검</Btn>
              {openMenu === 'input' && (
                <>
                  <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setOpenMenu(null)} />
                  <div className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 w-56 max-w-[calc(100vw-2rem)] rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] p-1.5 shadow-lift">
                    <button type="button" onClick={() => { setOpenMenu(null); setShowReconcile(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">전체 재고 보정<span className="block text-[0.65625rem] text-[var(--warm-muted)]">실제와 다를 때 실측값으로 리셋</span></button>
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
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">위치 관리<span className="block text-[0.65625rem] text-[var(--warm-muted)]">창고·주방 등 보관 위치 추가·수정</span></button>
                    <button type="button" onClick={() => { setOpenMenu(null); setShowCatSettings(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">카테고리 설정<span className="block text-[0.65625rem] text-[var(--warm-muted)]">표시 이름·순서·소속 지출 카테고리</span></button>
                    <div className="my-1 border-t border-[var(--warm-border)]" />
                    <button type="button" onClick={() => { setOpenMenu(null); setShowExcluded(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">숨김 품목{archivedCount > 0 ? ` (${archivedCount})` : ''}<span className="block text-[0.65625rem] text-[var(--warm-muted)]">당분간 안 쓰는 품목 보관·복구</span></button>
                    <button type="button" onClick={() => { setOpenMenu(null); setShowMergeRules(true) }}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--warm-dark)] transition-colors hover:bg-[var(--canvas)]">병합 적용취소·규칙<span className="block text-[0.65625rem] text-[var(--warm-muted)]">갈라진 품목명 통일 관리</span></button>
                  </div>
                </>
              )}
            </div>
            <Btn variant="primary" size="md" onClick={() => setShowAdd(true)}>+ 품목 추가</Btn>
            </>
            )}
        </div>
      </div>

      {/* v2.0 §23 메인 검색 — 헤더 아래 풀폭. 모달 안이 아니라 목록 상단에서 바로 좁힌다.
          순서 편집 중엔 감춘다 — 부분 목록을 저장하는 실수를 애초에 막는다(서버도 거부). */}
      {!orderEditMode && (
      <div className="sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
      <SearchBar value={search} onChange={setSearch} placeholder="품목명, 카테고리, 메모 검색" />
      </div>
      )}

      {/* 검색 무결과 — v2.0 §23 분기 (현재 탭 스코프 기준) */}
      {q && rows.length > 0 && grouped.every(g => g.rows.length === 0) && outOfScopeCount === 0 && (
        <EmptyState title="검색 결과가 없습니다" description="다른 검색어로 시도해 보세요." />
      )}
      {outOfScopeCount > 0 && (
        <button type="button" onClick={() => pickCatTab('__all__')}
          className="text-xs text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">
          다른 카테고리에 <span className="font-semibold text-[var(--warm-dark)]">{outOfScopeCount}건</span> 더 있음 · 전체에서 보기 ›
        </button>
      )}

      {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}

      {/* 재고에 못 붙은 구매 — 비슷한 이름의 카드가 있어 확인 대기로 보류된 것들이다.
          알리지 않으면 구매가 저장은 됐는데 재고 축에는 없는 상태로 남아 아무도 모른다. */}
      {pendingMerges.length > 0 && (
        <button type="button" onClick={() => setMergeDecisions(pendingMerges)}
          className="w-full text-left text-xs px-3 py-2.5 rounded-lg transition-colors"
          style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-ring)', color: 'var(--warning-fg)', minHeight: 44 }}>
          재고에 못 붙은 구매 <span className="font-semibold num">{pendingMerges.length}</span>건 · 어느 품목에 넣을지 정해 주세요 ›
        </button>
      )}

      {viewMode === 'location' ? (
        <LocationBatchCheckModal inline rows={visibleRows} onClose={() => changeView('item')} onDone={() => { router.refresh(); refreshDrafts() }} onDraftChange={refreshDrafts} />
      ) : rows.length === 0 ? (
        <EmptyState
          title="추적할 품목이 아직 없습니다"
          description="지출 관리에서 부식·소모품·폐기물 카테고리로 구매를 등록하면 품목이 여기에 자동으로 잡힙니다. 별도 등록이 필요하면 위의 '+ 품목 추가'를 누르세요."
        />
      ) : orderEditMode ? (
        // 순서 편집 모드 — 카테고리 그룹별 컴팩트 1열 행. 행 전체를 잡아 끌어 그룹 안에서 순서 변경.
        // 탭·검색 없이 전 그룹을 그대로 펼쳐 각 그룹이 항상 전체 품목이라 부분 저장이 원천 불가.
        <>
        <p className="text-xs text-[var(--warm-muted)]">오른쪽 손잡이를 잡아 끌어 순서를 바꿉니다. 완료를 누르면 편집이 끝납니다.</p>
        {groupedAll.map(g => g.rows.length > 0 && (
          <section key={g.cat} className="space-y-2">
            <SectionHeader marker={<DotMarker color={tintOf(g.cat).fg} />} name={g.alias} count={`${g.rows.length}품목`} />
            <div data-item-drag-list className="space-y-1.5">
              {g.rows.map((r, idx) => {
                const unit = r.trackUnit === 'qty' ? (r.qtyUnit ?? r.unitHint) : (r.specUnit ?? r.qtyUnit ?? r.unitHint)
                // 드래그는 오른쪽 핸들 버튼에서만 — 행 몸통에 걸면 스크롤하려는 터치가 순서를 바꿔버린다(운영자 실사용 지적 2026-07-18).
                // 핸들 히트 영역은 44pt(가이드 §09) — 이전 라운드의 '작아서 겨냥해야 하는 핸들' 문제는 크기로 해소.
                return (
                  <div key={r.id}
                    className={`flex items-center gap-1.5 min-h-[44px] rounded-xl border bg-[var(--cream)] pl-3.5 pr-1 py-1 ${dragCat === g.cat && dragItemIdx === idx ? 'border-[var(--coral)] shadow-lift select-none' : 'border-[var(--warm-border)]'}`}>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--warm-dark)]">{r.label}</span>
                    <span className="shrink-0 mono tnum text-[0.71875rem] text-[var(--warm-muted)]">{fmtQty(r.currentStock, unit)}</span>
                    <button type="button" aria-label={`${r.label} 순서 이동`}
                      onPointerDown={onItemHandleDown(g.cat, idx, g.rows.map(x => x.id))}
                      onPointerMove={onItemHandleMove}
                      onPointerUp={onItemHandleUp}
                      onPointerCancel={onItemHandleUp}
                      style={{ touchAction: 'none' }}
                      className="shrink-0 flex items-center justify-center w-11 h-11 rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] cursor-grab active:cursor-grabbing">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                        <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
                      </svg>
                    </button>
                  </div>
                )
              })}
            </div>
          </section>
        ))}
        </>
      ) : (
        <>
        {(() => {
          const flat = visibleRows.flatMap(r => r.pendingPurchases.map(p => ({ p, label: r.label, category: r.category, qtyUnit: r.qtyUnit, trackUnit: r.trackUnit, specUnit: r.specUnit }))).filter(f => !receivedIds.has(f.p.id))
          if (flat.length === 0) return null
          // 수령 대기 수량도 재고 계산(overview sumPurchases)과 동일 기준으로 규격 환산:
          // spec 추적 품목은 qtyValue × specValue (예: 40개입 3박스 → 120개). 단위는 specUnit.
          // 구매 규격단위(L 등)를 품목 단위(ml 등)로 환산 — 서버 잔량 수학(overview sumPurchases)과 동일.
          // 환산 누락 시 2.1L×2가 '4.2ml'로 표기되던 버그(오류신고 75dd05f7). 차원 불일치면 null(specMultiplier 정본).
          const specOf = (trackUnit: string, specValue: number | null, fromUnit: string | null, toUnit: string | null) =>
            trackUnit !== 'qty' ? specMultiplier(specValue, fromUnit, toUnit) : null
          const specQtyOf = (qtyValue: number, specValue: number | null, fromUnit: string | null, toUnit: string | null, trackUnit: string) => {
            const spec = specOf(trackUnit, specValue, fromUnit, toUnit)
            return Math.round((spec != null ? qtyValue * spec : qtyValue) * 1000) / 1000   // 2.7×6=16.200000003 방지
          }
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
            <section id="inventory-pending" className="space-y-2">
              {/* 헤더 스타일 — 비품·자재 '수령 대기'와 동일 (#2 통일) */}
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">
                수령 대기 <span className="text-[0.65625rem] text-[var(--coral)] font-normal">도착 전</span> <span className="text-[var(--warm-muted)] font-normal">{flat.length}건{totalAmt > 0 ? ` · ${fmtWon(totalAmt)}` : ''}</span>
              </h2>
              <ul className="space-y-1.5">
                {groups.map(g => {
                  // 규격 환산 합계(재고 단위) + 원래 박스 수 — 예: "120개 (3박스)"
                  const totalQty = Math.round(g.items.reduce((s, f) => s + specQtyOf(f.p.qtyValue || 0, f.p.specValue, f.p.specUnit, g.specUnit, g.trackUnit), 0) * 1000) / 1000
                  const rawBoxSum = g.items.reduce((s, f) => s + (f.p.qtyValue || 0), 0)
                  const boxUnit = g.items[0].p.qtyUnit
                  const specApplied = g.items.some(f => specOf(g.trackUnit, f.p.specValue, f.p.specUnit, g.specUnit) != null)
                  // 규격 환산이 안 되면 totalQty 는 **개수**다. 거기에 품목 규격 단위를 붙이면 '4ml' 같은
                  // 거짓 숫자가 나온다(신고 1fd2e22b). 같은 상황에서 타임라인은 이미 구매 단위로 폴백한다.
                  //
                  // 단 **차원 불일치는 부재가 아니다**(신고 27f91356, 라면). 120g 은 개당 중량 속성이고
                  // 100개가 이미 완전한 개수라 집계에 부족한 것이 없다. 그런데 종전 판정이 둘을 뭉개서
                  // "용량을 몰라 집계했다"는 거짓 경고 3중(배지·캡션·수령 확인창)이 떴고, 그 말대로
                  // 뭔가 넣으면 오히려 곱셈 오염 위험이 생겼다. 진짜 부재(specValue 없음)만 잡는다.
                  const specMissing = g.trackUnit !== 'qty' && !specApplied
                    && g.items.some(f => !isSpecDimensionMismatch(f.p.specUnit, g.specUnit))
                  const unit = (g.trackUnit === 'qty' || specMissing) ? (g.qtyUnit ?? boxUnit ?? '개') : (g.specUnit ?? g.qtyUnit ?? '개')
                  const qtyLabel = specApplied && boxUnit ? `${totalQty}${unit} (${rawBoxSum}${boxUnit})` : `${totalQty}${unit}`
                  const latest = g.items.reduce((dt, f) => (f.p.date > dt ? f.p.date : dt), g.items[0].p.date)
                  const ld = new Date(latest)
                  const ids = g.items.map(f => f.p.id)
                  const expanded = pendExpanded.has(g.key)
                  return (
                    <li key={g.key} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3.5 py-2.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-[var(--warm-dark)] truncate">
                            {g.label}{totalQty ? ` · ${qtyLabel}` : ''}

                          </p>
                          <p className="text-[0.65625rem] text-[var(--warm-muted)] truncate">{ld.getMonth() + 1}/{ld.getDate()} · {g.category}</p>
                          {/* 경고색을 안 쓴다 — 경고색은 행동 필요 신호인데 여기서의 용량 입력은 선택이다.
                              사실만 뉴트럴로 말한다(웹디자이너 판정, 신고 27f91356). */}
                          {specMissing && (
                            <p className="text-[0.65625rem] text-[var(--warm-muted)]">낱개 용량 없이 개수로 집계했습니다. 지출에서 용량을 넣으면 총량으로 계산됩니다.</p>
                          )}
                          {g.trackUnit !== 'qty' && g.items.some(f => isSpecDimensionMismatch(f.p.specUnit, g.specUnit)) && (
                            <p className="text-[0.65625rem] text-[var(--warm-muted)]">용량 단위({g.items.find(f => isSpecDimensionMismatch(f.p.specUnit, g.specUnit))?.p.specUnit})는 개당 속성이라 개수 기준으로 집계합니다</p>
                          )}
                          {g.items.length > 1 && (
                            <button type="button" onClick={() => togglePendExpand(g.key)} className="mt-0.5 min-h-[34px] inline-flex items-center -my-1.5 text-[0.65625rem] text-[var(--coral)] hover:underline">
                              구매 {g.items.length}건 합산 {expanded ? <><svg className="inline-block align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg> 접기</> : <><svg className="inline-block align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg> 펼치기</>}
                            </button>
                          )}
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <button type="button" onClick={() => setPendMerge({ label: g.label, category: g.category })}
                            className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                            합치기
                          </button>
                          <button type="button" onClick={() => { if (specMissing) { void confirmQuickReceive(g.key, ids, g.label, qtyLabel) } else handleQuickReceive(g.key, ids) }} disabled={receivingKey === g.key}
                            className="min-h-[34px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-[var(--on-solid)] hover:opacity-90 transition-opacity disabled:opacity-40">
                            {receivingKey === g.key ? '처리 중' : '수령 확인'}
                          </button>
                        </div>
                      </div>
                      {g.items.length > 1 && expanded && (
                        <ul className="mt-1.5 pl-2.5 border-l-2 border-[var(--warm-border)] space-y-0.5">
                          {g.items.map(f => {
                            const fd = new Date(f.p.date)
                            const sq = specQtyOf(f.p.qtyValue || 0, f.p.specValue, f.p.specUnit, g.specUnit, g.trackUnit)
                            const conv = specOf(g.trackUnit, f.p.specValue, f.p.specUnit, g.specUnit) != null
                            const su = (g.trackUnit === 'qty' || !conv) ? (g.qtyUnit ?? f.p.qtyUnit ?? '개') : (g.specUnit ?? '개')
                            const qstr = f.p.qtyValue
                              ? (conv && f.p.qtyUnit ? ` · ${sq}${su} (${f.p.qtyValue}${f.p.qtyUnit})` : ` · ${sq}${su}`)
                              : ''
                            return (
                              <li key={f.p.id} className="flex items-baseline justify-between gap-2 text-[0.6875rem] text-[var(--warm-muted)]">
                                <span className="tabular-nums">{fd.getMonth() + 1}/{fd.getDate()}{qstr}{f.p.vendor ? ` · ${f.p.vendor}` : ''}</span>
                                {/* 금액 읽기 차단 역할에게는 서버가 null 로 지운다 — 0원으로 그리면 거짓이다 */}
                                <span className="tabular-nums">{f.p.amount == null ? '' : fmtWon(f.p.amount)}</span>
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
        {/* 소진 임박 요약 — §18 Status Row 정본(좌 3px 팁 + danger-bg), 0건이면 미표시(신고 edffb4a7).
            임박 카드의 자동 재정렬 대신 요약 행으로 부상 — 사용자 지정 순서 보존 */}
        {(() => {
          const lowCount = visibleRows.filter(r => r.daysUntilEmpty != null && r.daysUntilEmpty <= r.effectiveAlertDays).length
          return lowCount > 0 ? (
            <div id="inventory-lowstock" className="rounded-lg border-l-[3px] px-3.5 py-2.5 text-xs font-medium"
              style={{ borderLeftColor: 'var(--danger-fg)', background: 'var(--danger-bg)', color: 'var(--danger-fg)' }}>
              소진 임박 {lowCount}건
            </div>
          ) : null
        })()}
        {!searching && (
          <SegmentedControl ariaLabel="소모품 카테고리" size="md" scroll value={groupedAll.some(g => g.cat === catTab) ? catTab : '__all__'} onChange={pickCatTab}
            options={[
              { value: '__all__', label: <>전체 <span className="mono text-[0.6875rem] text-[var(--warm-muted)]">{groupedAll.reduce((s, g) => s + g.rows.length, 0)}</span></> },
              ...groupedAll.map(g => ({ value: g.cat, label: <>{g.alias} <span className="mono text-[0.6875rem] text-[var(--warm-muted)]">{g.rows.length}</span></> })),
            ]} />
        )}
        {grouped.map(g => g.rows.length > 0 && (
          <section key={g.cat} className="space-y-2">
            <SectionHeader marker={<DotMarker color={tintOf(g.cat).fg} />} name={g.alias} count={`${g.rows.length}품목`} />
            {/* 설정 밖 카테고리 경고 — 조용히 일반 그룹처럼 그리면 오분류 원인을 알 수 없다(서빙집게 사건 2026-07-22).
                정상 상태에선 이 그룹 자체가 없어야 하며, 지출 카테고리 정정 시 카드가 자동 정리된다. */}
            {!trackedCats.includes(g.cat) && (
              <p className="text-[0.65625rem] text-[var(--warning-fg)]">이 카테고리는 재고 추적 대상이 아닙니다. 지출 카테고리를 확인하거나 카드에서 숨김 처리하세요.</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.rows.map(r => (
                <InventoryCard
                  key={r.id}
                  row={r}
                  selectMode={selectMode}
                  isSelected={selected.has(r.id)}
                  hasDraft={draftIds.has(r.id)}
                  onOpen={() => selectMode ? toggleSelect(r.id) : openDetail(r.id)}
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
          onDone={() => { setMergeDecisions([]); refreshPendingMerges(); router.refresh() }}
        />
      )}
      {showMergeRules && <MergeRulesModal onClose={() => { setShowMergeRules(false); router.refresh() }} />}
      {/* 완료 토스트는 모달이 직접 띄운다(적용취소 버튼 동봉). 여기서 또 띄우면 저장 때 두 개가 겹치고,
          적용취소로 되돌린 뒤에도 '보정 완료'가 떠서 되돌린 사실을 덮었다. */}
      {showReconcile && <FullReconcileModal rows={rows} categories={categories} onClose={() => setShowReconcile(false)} onDone={() => { setShowReconcile(false); router.refresh() }} />}
      {showAdd && <AddItemModal categories={categories} onClose={() => setShowAdd(false)} onDone={() => { setShowAdd(false); router.refresh() }} />}
      {showCatSettings && <InventoryCategorySettingsModal categories={categories} allExpenseCategories={allExpenseCategories} onClose={() => setShowCatSettings(false)} onDone={() => { setShowCatSettings(false); router.refresh() }} />}
      {showBatchLoc && (
        <BatchLocationModal
          selectedIds={Array.from(selected)}
          onClose={() => setShowBatchLoc(false)}
          onDone={() => { setShowBatchLoc(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 선택 모드 하단 알약 — v2.0 §22 SelectionPillBar (탭 공용) */}
      {selectMode && selected.size > 0 && (
        <SelectionPillBar count={selected.size} onClose={exitSelectMode}>
          <PillButton primary onClick={() => setShowBatchLoc(true)}>위치 일괄 할당</PillButton>
          {selected.size >= 2 && <PillButton onClick={openSelectionMerge}>합치기</PillButton>}
        </SelectionPillBar>
      )}

      {/* 수령 대기 품명 합치기 — 대표(기존 품목)를 고르면 이 구매의 품명이 그쪽으로 통일 */}
      {pendMerge && (
        <MergeSheet open onClose={() => setPendMerge(null)}
          sourceLabel={pendMerge.label}
          targets={[...rows].filter(r => !(r.label === pendMerge.label && r.category === pendMerge.category))
            .sort((a, b) => (a.category === pendMerge.category ? 0 : 1) - (b.category === pendMerge.category ? 0 : 1))
            .map(r => ({ id: r.id, label: `${r.label} · ${r.category}` })) as MergeTarget[]}
          description="고른 품목의 이름으로 이 구매(및 같은 이름의 지출)가 통일되고, 그 품목 재고로 잡힙니다. 다음 영수증부터는 자동 치환됩니다. 적용취소는 환경설정 '품명 병합'."
          onConfirm={runPendMerge} pending={isPending} />
      )}
      {/* 합치기 — v2.0 §22 MergeSheet 단일(선택 알약·상세 공용). 방향 고지 + v2.0 §16 적용취소 */}
      {sheet && (
        <MergeSheet open onClose={() => setSheet(null)}
          sourceLabel={sheet.sourceLabel} targets={sheet.targets}
          description="대표(남을 카드) 기준으로 합쳐집니다. 지출·점검·무상입수 기록이 대표로 이동하고 나머지 카드는 사라집니다. 적용취소는 ‘병합 적용취소·규칙’."
          onConfirm={sheet.onConfirm} pending={isPending} />
      )}

      {detailId && (() => {
        // 아이템별 연속 점검 — 현재 보이는(검색·탭 스코프) 목록 순서에서 다음 품목 id
        const navRows = grouped.flatMap(g => g.rows)
        const curIdx = navRows.findIndex(r => r.id === detailId)
        const nextId = curIdx >= 0 && curIdx < navRows.length - 1 ? navRows[curIdx + 1].id : null
        return (
          <DetailModal
            key={detailId}
            row={rows.find(r => r.id === detailId) ?? null}
            initialMode={detailInitialMode}
            nextId={nextId}
            onGoToItem={id => openDetail(id, 'check')}
            onClose={() => setDetailId(null)}
            onChange={() => { router.refresh(); refreshDrafts() }}
            onDraftChange={refreshDrafts}
            targetMonth={targetMonth}
            onChangeMonth={changeMonth}
          />
        )
      })()}
    </div>
  )
}

function InventoryCard({ row, onOpen, onArchive, selectMode, isSelected, hasDraft, onLongPress }: { row: InventoryRow; onOpen: () => void; onArchive?: () => void; selectMode?: boolean; isSelected?: boolean; hasDraft?: boolean; onLongPress?: () => void }) {
  const [open, setOpen] = useState(false)   // 지표·추이 펼치기
  const tint = tintOf(row.category)
  const lowStock = row.daysUntilEmpty != null && row.daysUntilEmpty <= row.effectiveAlertDays
  // 당분간 사용 안 함 후보: 현재 잔량 0 + 수령 대기 0 + 점검 기록 있음(신규는 제외)
  const suggestHide = !selectMode && row.currentStock === 0 && row.pendingPurchases.length === 0 && row.lastCheckDate != null
  // trackUnit='qty' (폐기물 봉투 등): 매 단위 그대로. 'spec': specUnit 우선
  const stockUnit = row.trackUnit === 'qty' ? (row.qtyUnit ?? row.unitHint) : (row.specUnit ?? row.qtyUnit ?? row.unitHint)
  const priceUnit = row.trackUnit === 'qty' ? (row.qtyUnit ?? row.unitHint) : (row.specUnit ?? row.qtyUnit ?? row.unitHint)
  // 숨긴(비어 있는) 위치는 화면에서 가린다 — 서버가 계산한 hiddenLocationIds 멤버십으로만 거른다(2단계).
  const hidden = new Set(row.hiddenLocationIds)
  // 보충 재원(창고) 잔량 — 접힌 카드에서도 "채울 게 남았나"를 보이게. 서버·산식 무변경, 이미 내려온 값만 읽는다.
  // 생략 조건: 허브 미지정 / 허브 잔량 모름 / 열린 비허브 위치 없음(창고 하나뿐이면 총량과 같아 군더더기).
  const hubLoc = row.locations.find(l => l.isHub) ?? null
  const hubQty = hubLoc ? row.currentLocationBreakdown.find(lb => lb.locationId === hubLoc.id)?.qty ?? null : null
  const showHub = hubLoc != null && hubQty != null && row.currentLocationBreakdown.some(lb => lb.locationId !== hubLoc.id && !hidden.has(lb.locationId))
  // 제목 캡션 두 경로는 구조적 배타 — specHint 는 라벨에 숫자가 있으면 서버가 null 로 준다(overview.resolveSpecHint).
  // 그래서 이름에 크기가 박힌 카드는 여기서, 이름에 없고 구매 규격이 전원일치인 카드는 specHint 로 캡션이 생긴다.
  const sizeSplit = row.specHint ? null : splitSizeLabel(row.label)
  const titleCaption = row.specHint ?? sizeSplit?.size ?? null
  return (
    <InvCard
      selectable={selectMode} selected={isSelected}
      onToggleSelect={onOpen} onClick={onOpen} onLongPress={onLongPress} attn={lowStock}
      // 제목 뒤 규격 병기 — 비품 카드(AssetsClient)와 같은 캡션 문법. 표시 전용이고 편집 값 자리엔 안 쓴다.
      // 구매 규격이 전원일치인 수량 카드에만 뜬다(서버 resolveSpecHint) — 특수마대 '10L' 처럼.
      // 이름 꼬리에 크기가 박힌 카드(봉투 20L)는 splitSizeLabel 로 같은 캡션 자리에 붙인다.
      title={titleCaption ? <>{sizeSplit?.base ?? row.label} <span className="font-normal text-[var(--warm-muted)]">{titleCaption}</span></> : row.label}
      badges={(() => {
        // §11 병렬 최대 2개 — 3개 조건이 겹치면 2개 + "+N" 뉴트럴(운영자 승인 2026-07-22)
        const list = [
          hasDraft && <Badge key="draft" tone="inspect">점검 중</Badge>,
          lowStock && <Badge key="low" tone="danger" mono>소진 임박</Badge>,
          row.pendingPurchases.length > 0 && <Badge key="pend" tone="warn" mono>{row.pendingPurchases.length}건 수령 대기</Badge>,
        ].filter(Boolean)
        return <>{list.slice(0, 2)}{list.length > 2 && <Badge tone="neutral">+{list.length - 2}</Badge>}</>
      })()}
      meta={<span style={{ color: tint?.fg }}>{row.category}</span>}
      value={fmtQty(row.currentStock, stockUnit)}
      valueDanger={lowStock}
      // 예측 불가를 침묵시키지 않는다(신고 edffb4a7) — 왜 알림이 없는지 접힌 카드에서도 보이게
      //
      // 잔량이 null 이면 값 자리에 '—' 가 뜬다. 그런데 이 앱에서 대시는 §06 상 **대상 없음**(공실)으로
      // 학습된 기호라, 운영자가 배운 대로 읽으면 '재고 없음' 이 된다. 여기 뜻은 정반대다 —
      // 대상은 있는데 **아직 세어보지 않아 모른다.** 0 과 모름을 뭉개지 말라는 것은 이 앱이 소모율과
      // 월별 사용량에서 이미 정한 원칙인데(knowledge/domain-inventory.md) 잔량에만 적용된 적이 없었다.
      // 값 자리에는 문자를 넣지 않는다 — §22 가 그 슬롯을 tnum 수치로 못 박아 카드 정렬이 흔들린다.
      valueSub={(() => {
        const text = row.currentStock == null ? '잔량 미확인 · 재고 점검을 한 번 하면 잡힙니다.'
          : `${showHub ? `창고 ${fmtQty(hubQty, stockUnit)} · ` : ''}${
              row.daysUntilEmpty != null ? `소진 D-${row.daysUntilEmpty}`
              : row.avgDaily === 0 ? '최근 사용 없음'
              : '소진 예측 준비 중 · 점검 데이터 부족'}`
        // 임박은 값(valueDanger)만 붉었고 보조줄은 회색이라 D-숫자가 눈에 안 걸렸다. 판정은 위 lowStock 재사용(새 임계 없음).
        return lowStock ? <span className="text-[var(--coral)]">{text}</span> : text
      })()}
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
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">평균 소모/일</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgDaily != null ? fmtQty(row.avgDaily, stockUnit) : '—'}
          </p>
          {/* 기준 일수 부기 — 아래 '최근 N일 동안 X 소모'(마지막 점검 구간)와 범위가 달라, 없으면 서로 어긋나 보임 */}
          {row.avgDailyBasisDays != null && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">최근 {row.avgDailyBasisDays}일 기준</p>
          )}
        </div>
        <div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">소진 예상</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.daysUntilEmpty != null ? `${row.daysUntilEmpty}일` : row.avgDaily === 0 ? '최근 사용 없음' : '추정 불가 · 점검 부족'}
            <span className="text-[0.65625rem] text-[var(--warm-muted)] ml-1">/ 알림 D-{row.effectiveAlertDays}</span>
          </p>
          {/* 리드타임 반영으로 설정값과 다를 수 있음 + 설정 발견 가능성(3뎁스 보완) */}
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">
            {row.effectiveAlertDays !== row.alertThresholdDays ? `설정 D-${row.alertThresholdDays} + 배송 기간 반영 · ` : ''}설정에서 변경
          </p>
        </div>
        <div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">평균 단가</p>
          <p className="text-sm font-medium text-[var(--warm-mid)]">
            {row.avgUnitPrice != null
              ? `${fmtUnitPrice(row.avgUnitPrice)}${priceUnit ? `/${priceUnit}` : ''}`
              : '—'}
          </p>
          {row.lastUnitPrice != null && row.lastUnitPrice !== row.avgUnitPrice && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">
              최근 {fmtUnitPrice(row.lastUnitPrice)}{priceUnit ? `/${priceUnit}` : ''}
            </p>
          )}
        </div>
      </div>
      {row.memo && (
        <p className="text-[0.65625rem] text-[var(--warm-mid)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-2 py-1.5 leading-relaxed whitespace-pre-wrap">
          메모 · {row.memo}
        </p>
      )}
      {row.reorderMemo && (
        <p className="text-[0.65625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2 py-1.5 leading-relaxed">
          발주 · {row.reorderMemo}
        </p>
      )}
      {row.purchaseUrl && (
        <a href={row.purchaseUrl} target="_blank" rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="inline-flex items-center gap-1 self-start text-[0.65625rem] text-[var(--coral)] bg-[var(--coral)]/5 hover:bg-[var(--coral)]/10 border border-[var(--coral)]/30 rounded-lg px-2 py-1 leading-none transition-colors">
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
          {row.currentLocationBreakdown.length > 0
            ? row.currentLocationBreakdown.filter(lb => !hidden.has(lb.locationId)).map(lb => {
                // 어느 칩이 보충 재원(창고)인지 표식 — 잔량 자체는 이미 보이고 있었고 이름만 없었다.
                // 품목마다 창고가 다르므로(hubLocationId) row.locations 의 isHub 로 판정한다.
                const isHubChip = row.locations.find(l => l.id === lb.locationId)?.isHub ?? false
                return (
                <span key={lb.locationId} className="text-[0.65625rem] bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">
                  {lb.locationName}{isHubChip ? ' (창고)' : ''} {fmtQty(lb.qty, stockUnit)}
                </span>
                )
              })
            : row.locations.filter(loc => !hidden.has(loc.id)).map(loc => (
                <span key={loc.id} className="text-[0.65625rem] bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">{loc.name}</span>
              ))
          }
        </div>
      )}
      {row.lastPeriodConsumption != null && row.lastPeriodDays != null && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)] pt-1.5 border-t border-[var(--warm-border)]/60">
          최근 {row.lastPeriodDays}일 동안 {fmtQty(row.lastPeriodConsumption, stockUnit)} 소모 · 최근 점검 {fmtDate(row.lastCheckDate)}
        </p>
      )}
      {/* 월별 사용량 — 최근 6개월 막대. 세 상태를 구분한다:
          미관측(null, 그 달엔 점검 없음) = 막대 없음 / 실사용 0 = 시리즈색 2px 실선 / 진행 중(이번 달) = --inspect 틴트(가이드 §04).
          종전엔 셋이 전부 회색 12% 막대라 '조금 썼다'로 읽혀 편차 오해의 근원이었음(2026-07-17 운영자 의문). */}
      {row.monthlyConsumption && row.monthlyConsumption.some(m => (m.qty ?? 0) > 0) && (
        <div className="pt-1.5 border-t border-[var(--warm-border)]/60">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[0.65625rem] text-[var(--warm-muted)]">월별 사용량 (최근 6개월)</span>
            <span className="text-[0.65625rem] text-[var(--warm-muted)]">
              합계 {fmtQty(row.monthlyConsumption.reduce((s, m) => s + (m.qty ?? 0), 0), stockUnit)}
            </span>
          </div>
          {(() => {
            const max = Math.max(...row.monthlyConsumption.map(m => m.qty ?? 0), 1)
            // 사용자 피드백 2026-06-01: '월별' 인데 합계만 보이면 의미 없음 → 각 월 숫자 노출.
            const fmtBarQty = (q: number): string => {
              // 1000 이상이면 'k' 축약 (예: 6270 → 6.3k)
              if (q >= 1000) return (q / 1000).toFixed(q >= 10000 ? 0 : 1) + 'k'
              if (q >= 100) return Math.round(q).toString()
              return q % 1 === 0 ? q.toString() : q.toFixed(1)
            }
            const lastIdx = row.monthlyConsumption.length - 1
            return (
              <div className="flex items-end gap-1">
                {row.monthlyConsumption.map((m, i) => {
                  // 이번 달 판정은 시계가 아니라 '마지막 슬롯'(구조적) — 클라 new Date()로 월을 비교하면
                  // 브라우저 TZ 에 따라 월 경계에서 어긋난다(서버가 kstDay 를 쓰는 이유와 동일).
                  const isCurrent = i === lastIdx
                  const monthNum = Number(m.month.slice(5))
                  const tip = m.qty == null
                    ? `${monthNum}월 · 점검 기록 없음`
                    : `${monthNum}월 · ${m.qty > 0 ? fmtQty(m.qty, stockUnit) : '사용 없음'}${isCurrent ? ' (진행 중)' : ''}`
                  return (
                    <div key={m.month} className="flex-1 flex flex-col items-center gap-0.5 min-w-0">
                      <span className="text-[0.65625rem] font-medium leading-none tabular-nums"
                        style={{ color: m.qty == null ? 'var(--warm-muted)' : 'var(--coral)' }}>
                        {m.qty == null ? '·' : fmtBarQty(m.qty)}
                      </span>
                      {/* 진행 중인 달은 트랙 전체에 --inspect-bg — 만월과 나란히 놓여 급감으로 오독되는 것 방지 */}
                      <div className="w-full flex items-end rounded-sm" title={tip}
                        style={{ height: '24px', background: isCurrent ? 'var(--inspect-bg)' : undefined }}>
                        {m.qty != null && (
                          // 실사용 0 은 2px 실선 — 시리즈색을 유지해야 '0 도 데이터' 로 읽힌다.
                          // 미관측은 막대를 아예 그리지 않는다(회색 막대는 소량 사용으로 오독됨).
                          <div className="w-full rounded-sm"
                            style={{
                              height: m.qty > 0 ? `${Math.max(12, Math.round((m.qty / max) * 100))}%` : '2px',
                              background: 'var(--coral)',
                              opacity: 0.75,
                            }} />
                        )}
                      </div>
                      <span className="text-[0.65625rem] leading-none"
                        style={{
                          color: isCurrent ? 'var(--inspect-fg)' : 'var(--warm-muted)',
                          fontWeight: isCurrent ? 500 : undefined,
                          opacity: m.qty == null ? 0.6 : undefined,
                        }}>{monthNum}</span>
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
    <Modal open onClose={onClose} title="추적 품목 추가" width="md"
      // 풀블리드 — 폼 본문과 폭 전체 구분선 액션 바를 children 이 직접 구성한다.
      bodyClassName="">
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
                className="ml-1.5 text-[0.65625rem] font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-2">단계별 선택</button>
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
            {pending ? '저장 중…' : '저장'}
          </Btn>
        </ModalFooterActions>
      </div>
    </Modal>
  )
}

function DetailModal({ row, onClose, onChange, onDraftChange, targetMonth, onChangeMonth, initialMode = 'view', nextId = null, onGoToItem }: {
  row: InventoryRow | null; onClose: () => void; onChange: () => void; onDraftChange?: () => void
  targetMonth: string; onChangeMonth: (delta: number) => void
  initialMode?: 'view' | 'check'; nextId?: string | null; onGoToItem?: (id: string) => void
}) {
  if (!row) return null
  const trackedItemId = row.id
  const [data, setData] = useState<Awaited<ReturnType<typeof getInventoryDetail>>>(null)
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([])
  const [monthlyInflow, setMonthlyInflow] = useState<MonthlyInflowRow[]>([])
  const [mode, setMode] = useState<'view' | 'check' | 'addition' | 'disposal' | 'settings' | 'reconcile'>(initialMode)
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
        else { pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const reload = () => Promise.all([
    getInventoryDetail(trackedItemId).then(setData),
    getPriceHistory(trackedItemId).then(setPriceHistory),
    getMonthlyInflow(trackedItemId).then(setMonthlyInflow),
  ])
  useEffect(() => { reload() }, [trackedItemId]) // eslint-disable-line react-hooks/exhaustive-deps

  const [transferOpen, setTransferOpen] = useState(false)   // 품목별 위치 이동(신고 0d911b19, 명칭 97839062)

  const handleDeleteItem = async () => {
    if (!(await confirmDialog({ title: '이 품목을 삭제할까요?', message: '지출·점검·입수 기록이 하나도 없는 품목만 삭제됩니다(잘못 생성된 품목 정리용). 기록이 있으면 숨김을 사용하세요.', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteTrackedItemIfEmpty(trackedItemId)
        if (res.ok) { onChange(); onClose(); pushToast('success', '품목을 삭제했습니다') }
        else { pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const handleArchive = async () => {
    if (!(await confirmDialog({ title: '이 품목을 숨길까요?', message: '재고 카드 목록에서 사라집니다 (당분간 사용하지 않을 품목용). 점검·무상입수·지출 기록은 모두 보존되며, 헤더의 "숨김 품목" 메뉴에서 언제든 복구할 수 있습니다.', confirmLabel: '숨김' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await archiveTrackedItem(trackedItemId)
        if (res.ok) { onChange(); onClose(); pushToast('success', '품목 숨김 처리됨') }
        else { pushToast('error', res.error) }
      } finally { release() }
    })
  }

  const handleDeleteCheck = async (id: string) => {
    if (!(await confirmDialog({ title: '이 점검 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    setLoadingId(id)
    const release = trackSave()
    deleteStockCheck(id).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '점검 기록 삭제됨', {
        action: { label: '적용취소', run: () => { void undoDeleteStockCheck(res.undo).then(r => {
          if (r.ok) { pushToast('info', '점검 기록을 복원했습니다'); reload().then(onChange).catch(() => { /* 표시 갱신 실패는 새로고침으로 */ }) }
          else pushToast('error', r.error)
        }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) } },
      }) }).finally(release) }
      else { setLoadingId(null); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); pushToast('error', '통신 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.'); release() })
  }

  const handleDeleteAddition = async (id: string) => {
    // 이 입수가 뒤 점검 잔량에 이미 얹혀 있으면 함께 뺄지 먼저 묻는다(빼지 않으면 유령 재고로 남는다).
    const ask = await askLedgerShift({
      trackedItemId, additionId: id, next: null,
      title: '이 입수 기록을 삭제할까요?',
      keepLine: '입수 기록은 삭제됩니다.',
      impactLine: n => `이 입수를 담고 있는 점검 ${n}건이 있습니다. 함께 조정하면 이렇게 바뀝니다.`,
      unit: detailStockUnit,
    })
    if (ask.error) { pushToast('error', ask.error); return }
    if (!ask.result) return
    // 어긋나는 점검이 없으면 위에서 묻지 않았으므로 기존 삭제 확인을 그대로 띄운다(§14 다이얼로그 중첩 금지).
    if (!ask.result.asked && !(await confirmDialog({ title: '이 입수 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    setLoadingId(id)
    const release = trackSave()
    deleteStockAddition(id, { adjustFollowing: ask.result.adjust }).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '입수 기록 삭제됨', {
        action: { label: '적용취소', run: () => { void undoDeleteStockAddition(res.undo).then(r => {
          if (r.ok) { pushToast('info', '입수 기록을 복원했습니다'); reload().then(onChange).catch(() => { /* 표시 갱신 실패는 새로고침으로 */ }) }
          else pushToast('error', r.error)
        }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) } },
      }) }).finally(release) }
      else { setLoadingId(null); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); pushToast('error', '통신 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.'); release() })
  }

  const handleDeleteDisposal = async (id: string) => {
    if (!(await confirmDialog({ title: '이 폐기 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    setLoadingId(id)
    const release = trackSave()
    deleteStockDisposal(id).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '폐기 기록 삭제됨', {
        action: { label: '적용취소', run: () => { void undoDeleteStockDisposal(res.undo).then(r => {
          if (r.ok) { pushToast('info', '폐기 기록을 복원했습니다'); reload().then(onChange).catch(() => { /* 표시 갱신 실패는 새로고침으로 */ }) }
          else pushToast('error', r.error)
        }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) } },
      }) }).finally(release) }
      else { setLoadingId(null); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); pushToast('error', '통신 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.'); release() })
  }

  const handleConfirmReceipt = (expenseId: string, locationId?: string, qty?: number) => {
    setLoadingId(expenseId)
    const release = trackSave()
    confirmReceipt(expenseId, locationId, qty).then(res => {
      if (res.ok) { reload().then(() => { setLoadingId(null); onChange(); pushToast('success', '수령 확인 완료', {
        // 부분 수령이면 분할 원복(undoPartialReceipt), 전량이면 기존 수령 취소 — 상세 모달 경로 undo 공백 해소(§4 2026-07-14)
        action: { label: '수령 취소', run: () => { void (res.undo ? undoPartialReceipt(res.undo) : undoConfirmReceipt(expenseId)).then(r => {
          if (r.ok) { pushToast('info', '수령을 취소하고 수령 대기로 되돌렸습니다'); reload().then(onChange).catch(() => { /* 표시 갱신 실패는 새로고침으로 */ }) }
          else pushToast('error', r.error)
        }).catch(() => pushToast('error', '수령 취소 중 통신 오류가 발생했습니다')) } },
      }) }).finally(release) }
      else { setLoadingId(null); pushToast('error', res.error); release() }
    }).catch(() => { setLoadingId(null); pushToast('error', '통신 오류가 발생했습니다. 새로고침 후 다시 시도해 주세요.'); release() })
  }

  const detailStockUnit = data ? (data.item.trackUnit === 'qty' ? (data.item.qtyUnit ?? data.item.unitHint) : (data.item.specUnit ?? data.item.qtyUnit ?? data.item.unitHint)) : null
  const isViewMode = mode === 'view' && !!data
  // 카드 제목과 같은 분리 — 카드에서 캡션으로 떨어져 있던 크기가 모달을 열면 되돌아오면 안 된다.
  const detailLabel = data?.item.label ?? row.label
  const detailSplit = row.specHint ? null : splitSizeLabel(detailLabel)
  const detailCaption = row.specHint ?? detailSplit?.size ?? null

  return (
    <Modal
      open
      onClose={onClose}
      width="lg"
      // Modal 은 title 이 문자열일 때만 h2 를 씌운다 — JSX 로 넘기므로 같은 클래스의 h2 로 직접 감싼다.
      title={detailCaption
        ? <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">{detailSplit?.base ?? detailLabel} <span className="font-normal text-[var(--warm-muted)]">{detailCaption}</span></h2>
        : detailLabel}
      subtitle={data?.item.category ?? row.category}
      // 풀블리드 — 모드(점검·보정·설정 등)마다 다른 하위 폼이 자기 여백과 폭 전체 구분선을 직접 갖는다.
      bodyClassName=""
      footer={isViewMode ? (
        <div className="flex items-center gap-2 flex-wrap">
          <Btn variant="secondary" size="sm" onClick={handleArchive} disabled={pending}>숨김</Btn>
          <Btn variant="secondary" size="sm" onClick={handleDeleteItem} disabled={pending}>삭제</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setMode('settings')}>설정</Btn>
          {/* 위치 이동은 관리 그룹으로 — 점검 무리 옆에 두면 품목 점검 중 오클릭(오류신고 97839062) */}
          <Btn variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>위치 이동</Btn>
          <div className="flex-1" />
          <Btn variant="secondary" size="sm" onClick={() => setMode('reconcile')}>보정 (차이 소모 제외)</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setMode('addition')}>+ 무상 입수</Btn>
          <Btn variant="secondary" size="sm" onClick={() => setMode('disposal')}>폐기</Btn>
          <Btn variant="primary" size="sm" onClick={() => setMode('check')}>재고 점검</Btn>
        </div>
      ) : undefined}
    >
      {/* 렌더 오류가 모달을 조용히 닫던 문제 방지 — 안내+자취 기록(오류신고 0861b35f). resetKey=mode로 모드 전환 시 재시도 */}
      <ErrorBoundary label="재고 상세" resetKey={mode}>
      {!data ? (
        <Loading />
      ) : mode === 'check' ? (
        <CheckForm item={data.item} lastCheckBreakdown={row.currentLocationBreakdown} hiddenLocationIds={row.hiddenLocationIds} onGoDisposal={() => setMode('disposal')} onCancel={() => setMode('view')} onDone={() => {
          setMode('view'); reload(); onChange()
          pushToast('success', '점검을 저장했습니다', nextId && onGoToItem
            ? { action: { label: '다음 품목', run: () => onGoToItem(nextId) } }
            : undefined)
        }} onDraftChange={onDraftChange} />
      ) : mode === 'reconcile' ? (
        <TimelineReconcileForm
          item={data.item}
          hiddenLocationIds={row.hiddenLocationIds}
          existingCheckDays={Array.from(new Set(data.timeline.filter(e => e.type === 'check').map(e => new Date(new Date(e.date).getTime() + 9 * 3600000).toISOString().slice(0, 10))))}
          onCancel={() => setMode('view')}
          onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : mode === 'addition' ? (
        <AdditionForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : mode === 'disposal' ? (
        <DisposalForm item={data.item} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }} />
      ) : mode === 'settings' ? (
        <SettingsForm row={row} onCancel={() => setMode('view')} onDone={() => { setMode('view'); reload(); onChange() }}
          onGone={() => { onChange(); onClose() }} />
      ) : (
        <>
          <div className="px-5 sm:px-6 pt-3">
            {/* view 모드 본문 최상단 — 마지막 점검 기록 시각(점검일과 다른 날이면 병기) */}
            {row.lastCheckCreatedAt && (() => {
              const created = new Date(row.lastCheckCreatedAt)
              const sameDay = row.lastCheckDate ? isSameKstDay(new Date(row.lastCheckDate), created) : true
              return (
                <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-2">
                  {sameDay
                    ? <>마지막 점검 {fmtDate(row.lastCheckDate)} <span className="tabular-nums">{fmtTime(created)}</span></>
                    : <>마지막 점검 {fmtDate(row.lastCheckDate)} · {fmtDate(created)} <span className="tabular-nums">{fmtTime(created)}</span> 기록</>}
                </p>
              )
            })()}
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
              // 창고 잔량 부기 — 모르면(허브 미지정·breakdown 없음) 숫자를 지어내지 않고 생략한다.
              const itemHubQty = itemHub ? row.currentLocationBreakdown.find(lb => lb.locationId === itemHub.id)?.qty ?? null : null
              return (
                <div className="relative inline-block mt-2">
                  <button type="button" onClick={() => setHubOpen(o => !o)} disabled={pending}
                    className="inline-flex items-center gap-1 text-[0.6875rem] rounded-lg border border-[var(--honey)]/40 bg-[var(--honey)]/10 px-2 py-1 text-[var(--warm-mid)] hover:border-[var(--honey)] transition-colors disabled:opacity-50">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>
                    이 품목 창고(허브): <strong className="text-[var(--warm-dark)]">{itemHub?.name ?? '미지정'}</strong>{itemHubQty != null && <span className="tnum"> · {fmtQty(itemHubQty, detailStockUnit)}</span>}
                    <span className="text-[var(--warm-muted)]"><svg className="inline-block align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg></span>
                  </button>
                  {hubOpen && (
                    <>
                      <div className="fixed inset-0 z-[var(--z-dropdown)]" onClick={() => setHubOpen(false)} />
                      <div className="absolute left-0 top-full mt-1 z-[var(--z-dropdown)] min-w-[200px] rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] shadow-lift py-1">
                        <p className="px-3 py-1 text-[0.65625rem] text-[var(--warm-muted)]">채울 때 차감할 창고(허브) 위치</p>
                        {/* 숨긴 위치는 허브 후보에서 제외 — 서버(setItemHub)도 거부하지만 애초에 안 보여준다 */}
                        {row.locations.filter(l => l.closedAt == null).map(l => (
                          <button key={l.id} type="button" disabled={pending} onClick={() => changeItemHub(l.id)}
                            className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[var(--cream-soft)] flex items-center justify-between gap-2 ${l.isHub ? 'text-[var(--warm-dark)] font-medium' : 'text-[var(--warm-mid)]'}`}>
                            {l.name}{l.isHub && <span className="text-[var(--honey)]"><svg className="inline-block align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> 현재</span>}
                          </button>
                        ))}
                        <button type="button" disabled={pending} onClick={() => changeItemHub(null)}
                          className="w-full text-left px-3 py-1.5 text-[0.65625rem] text-[var(--warm-muted)] hover:bg-[var(--cream-soft)] border-t border-[var(--warm-border)]/60 mt-1">
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
            {tab === 'timeline' && (
              // 이력은 자르지 않는다. 재고의 축은 '지금 잔량'과 '점검 사이 구간'이지 달력 월이 아니다 —
              // 소모율은 최근 30일, 사용량은 오늘 기준 6개월이고 어느 것도 조회 월을 안 받는다.
              // 종전에는 조회 월로 잘라 놓고, 그 앞의 마지막 점검을 '이월분'으로 합성해 메웠다.
              // 그런데 그 보철은 **직전 점검이 있을 때만** 성립해서 점검이 0건인 품목에서는 무력했다.
              // 그래서 목록은 "이 품목 있다"고 하는데 눌러 들어가면 "이 달 기록이 없습니다"가 떴다 —
              // 데이터는 손에 다 있는데 화면이 감춘 것이다(운영자 지적 2026-08-05, 27개 중 12개가 그 상태).
              // 전 이력이 이미 클라이언트에 있고 정렬도 끝나 있어 자르는 코드를 지우면 그만이다.
              <div className="space-y-2">
                {data.timeline.length === 0 ? (
                  <p className="text-sm text-[var(--warm-muted)] text-center py-6">아직 기록이 없습니다.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {data.timeline.map(e => <TimelineRow key={`${e.type}-${e.id}`} entry={e} trackedItemId={trackedItemId} stockUnit={detailStockUnit} trackUnit={data.item.trackUnit} itemLocations={data.item.locations} onDeleteCheck={handleDeleteCheck} onDeleteAddition={handleDeleteAddition} onDeleteDisposal={handleDeleteDisposal} onConfirmReceipt={handleConfirmReceipt} onChanged={() => { reload(); onChange() }} loadingId={loadingId} />)}
                  </ul>
                )}
              </div>
            )}
            {tab === 'monthly' && (
              <MonthlyInflowList rows={monthlyInflow} stockUnit={detailStockUnit} />
            )}
            {tab === 'price' && (
              <PriceChart points={priceHistory} unitLabel={detailStockUnit} qtyUnit={data.item.qtyUnit ?? data.item.unitHint} />
            )}
          </div>
        </>
      )}
      {/* 품목별 위치 이동 — 이 품목 프리셀렉트(신고 0d911b19). 점검 모달의 이동과 동일 컴포넌트 */}
      {transferOpen && (
        <TransferStockModal rows={[row]} initialItemId={row.id}
          onClose={() => setTransferOpen(false)}
          onDone={() => { setTransferOpen(false); reload(); onChange() }} />
      )}
      </ErrorBoundary>
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
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">전체 입수량</p>
          <p className="text-sm font-bold text-[var(--warm-dark)] mt-0.5">{Math.round(totalAll * 100) / 100}{u}</p>
        </div>
        <div className="bg-[var(--canvas)] rounded-xl p-3">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">전체 구매 비용</p>
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
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] w-8 shrink-0">구매</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, purchasePct)}%`, background: 'var(--success-fg)' }} />
                    </div>
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] w-32 text-right shrink-0 tabular-nums">
                      {Math.round(r.purchaseQty * 100) / 100}{u} · {fmtWon(r.purchaseAmount)}
                    </span>
                  </div>
                )}
                {r.additionQty > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] w-8 shrink-0">무상</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, additionPct)}%`, background: 'var(--inspect-fg)' }} />
                    </div>
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] w-32 text-right shrink-0 tabular-nums">
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
        <div className="flex items-center justify-between text-[0.65625rem] text-[var(--warm-muted)]">
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
            <span className="text-[0.65625rem] text-[var(--warm-muted)]">
              {p.qty}{qtyUnit ?? ''} · {fmtWon(p.amount)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function SettingsForm({ row, onCancel, onDone, onGone }: {
  row: InventoryRow; onCancel: () => void; onDone: () => void
  /** 이 카드 자체가 합쳐져 사라진 경우 — 삭제된 id 를 다시 조회하지 않도록 상세를 닫는다 */
  onGone?: () => void
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
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
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
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">예: 7이면 소진 예상 7일 이하일 때 알림</p>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">재고 추적 단위</label>
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={() => setTrackUnit('spec')}
            className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${trackUnit === 'spec' ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
            규격 단위{row.specUnit ? ` (${row.specUnit})` : ''}
          </button>
          <button type="button" onClick={() => setTrackUnit('qty')}
            className={`px-3 py-2 text-xs font-medium rounded-xl border transition-colors ${trackUnit === 'qty' ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
            수량 단위{row.qtyUnit ? ` (${row.qtyUnit})` : ''}
          </button>
        </div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
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
              className="bg-[var(--cream-2)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">단위 선택…</option>
              {compatUnits.map(u => <option key={u} value={u}>{u}</option>)}
            </select>
            <button type="button" onClick={handleChangeUnit} disabled={!newUnit || unitPending}
              className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--pill-bg)] text-[var(--on-solid)] disabled:opacity-40 active:scale-95 transition">
              {unitPending ? '변환 중…' : '변환'}
            </button>
          </div>
          {newUnit && unitFactor(row.specUnit, newUnit) != null && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              {(() => { const f = unitFactor(row.specUnit, newUnit)!; return f >= 1 ? `1${row.specUnit} = ${f}${newUnit}` : `${Math.round((1 / f) * 1e6) / 1e6}${row.specUnit} = 1${newUnit}` })()}
              {' '}· 저장된 점검·입수 기록이 함께 환산됩니다. 영수증은 그대로 두어도 자동 환산됩니다.
            </p>
          )}
          {unitMsg && <p className="text-[0.65625rem] text-[var(--danger-fg)]">{unitMsg}</p>}
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">재고 파악 기준 메모</label>
        <textarea value={memo} onChange={e => setMemo(e.target.value)}
          rows={3}
          placeholder="예: 창고에 온전히 남아있는 양만 잔량으로 카운트. 주방 쌀통은 제외"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] resize-none" />
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">잔량 점검 시 무엇을 세는지·어디 보관분만 카운트하는지 등 기준을 적어두면 일관성 유지에 도움됩니다.</p>
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
          placeholder="https://www.coupang.com/…"
          autoComplete="off"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
          입력해두면 재고 카드에서 한 번에 구매 페이지로 이동할 수 있어요.
        </p>
      </div>
      {/* 위치 할당 섹션 */}
      <LocationAssignSection trackedItemId={row.id} initialLocations={row.locations} />
      {/* 병합 섹션 — 같은 카테고리 다른 카드로 통합 */}
      <MergeSection currentId={row.id} currentLabel={row.label} category={row.category} onDone={onDone} onGone={onGone} />
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </form>
  )
}

function MergeSection({ currentId, currentLabel, onDone, onGone }: {
  currentId: string; currentLabel: string; category: string; onDone: () => void
  onGone?: () => void
}) {
  const [siblings, setSiblings] = useState<{ id: string; label: string }[]>([])
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState(false)
  useEffect(() => { getSameCategoryItems(currentId).then(setSiblings) }, [currentId])
  if (siblings.length === 0) return null

  // 이 카드를 대상(남을 카드)으로 합침 — 기록 이전 후 사라지는 카드 삭제. (v2.0 §22 MergeSheet 단일)
  // srcId 가 오면 시트에서 방향을 뒤집은 것 — 고른 상대가 사라지고 이 카드가 남는다.
  const handleMerge = async (destId: string, srcId?: string) => {
    setPending(true)
    const res = await mergeTrackedItems(srcId ?? currentId, destId, true)
    setPending(false)
    if (!res.ok) { pushToast('error', res.error); return }
    setOpen(false)
    pushToast('success', `병합 완료 · 지출 ${res.movedExpenses}건, 점검 ${res.movedChecks}건, 무상입수 ${res.movedAdditions}건`)
    // 이 카드가 흡수돼 사라졌으면 상세를 닫는다 — 삭제된 id 를 다시 조회하면 빈 상세가 남는다
    if (!srcId && onGone) onGone(); else onDone()
  }

  return (
    <div className="space-y-1.5 pt-2 border-t border-[var(--warm-border)]/60">
      <label className="text-xs font-medium text-[var(--warm-mid)]">다른 카드와 합치기</label>
      <Btn type="button" variant="secondary" size="md" fullWidth onClick={() => setOpen(true)}>다른 카드와 합치기…</Btn>
      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
        예: 라면처럼 봉지·박스가 섞여도 한 카드로 합쳐 추적하고 싶을 때. 사이즈가 의미 있는 폐기물 봉투는 분리 유지 권장.
      </p>
      {open && (
        <MergeSheet open onClose={() => setOpen(false)}
          sourceLabel={currentLabel} sourceId={currentId} targets={siblings}
          description="대표(남을 카드)로 지출·점검·무상입수 기록이 이동하고 이 카드는 사라집니다. 적용취소는 ‘병합 적용취소·규칙’."
          confirmLabel="합치기" onConfirm={handleMerge} pending={pending} />
      )}
    </div>
  )
}

function TimelineRow({ entry, trackedItemId, stockUnit, trackUnit, itemLocations, onDeleteCheck, onDeleteAddition, onDeleteDisposal, onConfirmReceipt, onChanged, loadingId }: {
  entry: TimelineEntry; trackedItemId: string; stockUnit: string | null; trackUnit: 'spec' | 'qty'
  itemLocations: StorageLocationItem[]
  onDeleteCheck: (id: string) => void
  onDeleteAddition: (id: string) => void
  onDeleteDisposal: (id: string) => void
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
              {entry.isReconcile && <span className="ml-1 text-[0.65625rem] bg-[var(--honey)]/15 text-[var(--honey)] border border-[var(--honey)]/40 rounded-full px-1.5 py-0.5">보정</span>}
            </p>
            <p className="text-sm font-medium text-[var(--warm-dark)]">잔량 {fmtQty(entry.remainingQty, stockUnit)}</p>
            {entry.locationBreakdown.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-1">
                {entry.locationBreakdown.map(lb => {
                  const restocked = lb.restockedQty ?? 0
                  return (
                    <span key={lb.locationId} className="text-[0.65625rem] bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)]/60 rounded-full px-2 py-0.5">
                      {lb.locationName} {fmtQty(lb.qty, stockUnit)}
                      {restocked > 0 && <span className="ml-1 text-[var(--coral)]">+{Math.round(restocked * 100) / 100}{stockUnit ?? ''}</span>}
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
                <p className="text-[0.65625rem] text-[var(--coral)] mt-0.5">
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
                  <p key={`mv-${lb.locationId}`} className="text-[0.65625rem] text-[var(--honey)] mt-0.5">
                    ↳ {src?.locationName ?? '창고'} → {lb.locationName} · {fmtQty(lb.fromHubQty!, stockUnit)} 이동
                  </p>
                )
              })}
            {entry.memo && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
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
    // 영수증 규격단위(entry.specUnit)가 품목 단위(stockUnit)와 다르면 품목 단위로 환산해 입고량 표시(L→ml 등).
    // 차원 불일치(120g vs 개)면 곱하지 않고 수량 그대로(specMultiplier 정본, 오류신고 0d6242f0).
    const convSpec = useSpec ? specMultiplier(entry.specValue, entry.specUnit, stockUnit) : null
    const baseQty = convSpec != null ? entry.qtyValue * convSpec : entry.qtyValue
    const baseUnit = convSpec != null ? stockUnit : entry.qtyUnit
    const packLabel = hasSpec ? `${entry.specValue}${entry.specUnit} × ${fmtQty(entry.qtyValue, entry.qtyUnit)}` : null

    if (editing) {
      return <PurchaseEditForm
        entry={entry} stockUnit={stockUnit}
        onCancel={() => { setEditing(false); setEditError('') }}
        onSave={async (data) => {
          setEditError('')
          // 수령 대기로 되돌리기 — 이 수령분을 이미 삼킨 점검이 있으면 함께 조정해서만 취소한다.
          // 조정 없는 취소는 재수령 때 같은 수량이 이중 가산되는 바로 그 구멍이라 두 갈래(진행/취소)만 묻는다.
          let adjustFollowing = false
          if (data.receivedAt === null && entry.receivedAt) {
            const pre = await previewExpenseStockShift({ expenseId: entry.id, next: null, forReceiptCancel: true })
            if (!pre.ok) { setEditError(pre.error); return }
            if (pre.rows.length > 0) {
              const go = await askShiftRowsRequired({
                rows: pre.rows,
                title: '수령을 취소할까요?',
                keepLine: '이 구매는 수령 대기로 돌아갑니다.',
                impactLine: n => `이 수령분을 이미 반영한 재고 점검 ${n}건에서 그만큼을 함께 뺍니다.`,
                tailLine: '다시 수령 확인하면 그 시점 잔량 기준으로 다시 들어옵니다. 직후 적용취소로 되돌릴 수 있습니다.',
                unit: stockUnit,
                confirmLabel: '함께 조정 후 취소',
              })
              if (!go) return
              adjustFollowing = true
            }
          }
          setSavePending(true)
          const res = await updateExpenseFromInventory(entry.id, adjustFollowing ? { ...data, adjustFollowing } : data)
          setSavePending(false)
          if (!res.ok) { setEditError(res.error); return }
          setEditing(false)
          const cancelUndo = res.cancelUndo
          if (cancelUndo) {
            pushToast('success', '수령을 취소했습니다', {
              ...(cancelUndo.shift ? { detail: `점검 ${cancelUndo.shift.checks.length}건의 잔량도 함께 뺐습니다.` } : {}),
              action: { label: '적용취소', run: () => { void undoCancelReceipt(cancelUndo).then(r => {
                if (r.ok) { pushToast('info', '수령 상태를 복원했습니다'); onChanged() }
                else pushToast('error', r.error)
              }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) } },
            })
          }
          onChanged()
        }}
        onDelete={async () => {
          // 수령완료 구매의 제외는 원장에서 델타 제거와 같다 — 삼킨 점검이 있으면 함께 옮길지 묻는다.
          let adjustFollowing = false
          if (entry.receivedAt) {
            const pre = await previewExpenseStockShift({ expenseId: entry.id, next: null })
            if (!pre.ok) { setEditError(pre.error); return }
            if (pre.rows.length > 0) {
              const ask = await askShiftRows({
                rows: pre.rows,
                title: '이 구매를 재고에서 제외할까요?',
                keepLine: '지출 페이지에는 그대로 남습니다.',
                impactLine: n => `이 구매 수량을 이미 반영한 재고 점검 ${n}건이 있습니다. 함께 조정하면 이렇게 바뀝니다.`,
                unit: stockUnit,
                confirmLabel: '함께 조정 후 제외',
                altLabel: '이 기록만 제외',
              })
              if (ask === null) return
              adjustFollowing = ask.adjust
            } else if (!(await confirmDialog({ title: '이 구매를 재고에서 제외할까요?', message: '지출 페이지에는 그대로 남습니다.', level: 'caution', confirmLabel: '제외' }))) return
          } else if (!(await confirmDialog({ title: '이 구매를 재고에서 제외할까요?', message: '지출 페이지에는 그대로 남습니다.', level: 'caution', confirmLabel: '제외' }))) return
          setSavePending(true)
          const res = await excludeExpenseFromInventory(entry.id, adjustFollowing ? { adjustFollowing } : undefined)
          setSavePending(false)
          if (!res.ok) { setEditError(res.error); return }
          // v2.0 §16-1 — 적용 직후 토스트 액션으로 즉시 회수 가능. 함께 조정했다면 포함도 같은 대칭 조정으로.
          const undoAdjust = adjustFollowing
          pushToast('success', '구매를 재고에서 제외했습니다', {
            ...(undoAdjust ? { detail: '반영돼 있던 점검 잔량도 함께 뺐습니다.' } : {}),
            action: { label: '적용취소', run: () => { void includeExpenseInInventory(entry.id, undoAdjust ? { adjustFollowing: true } : undefined).then(r => {
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
                <p className="text-[0.65625rem] text-[var(--honey)] mt-0.5">수령 대기 중</p>
              ) : entry.receivedAt ? (
                <p className="text-[0.65625rem] text-[var(--status-paid-fg)] mt-0.5">
                  수령 확정 {fmtDate(entry.receivedAt)} <span className="tabular-nums">{fmtTime(entry.receivedAt)}</span>
                  {entry.receivedLocationName && <span className="ml-1">· {entry.receivedLocationName}</span>}
                </p>
              ) : null}
              {(entry.vendor || entry.memo) && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.vendor ?? ''}{entry.vendor && entry.memo ? ' · ' : ''}{entry.memo ?? ''}</p>}
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
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1.5">어느 위치로 입고됩니까?</p>
            {entry.qtyValue != null && entry.qtyValue > 1 && (
              <div className="flex items-center gap-1.5 mb-1.5">
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">도착 수량 (전체 {entry.qtyValue}{entry.qtyUnit ?? '개'} · 일부만 오면 잔여는 수령 대기 유지)</span>
                <input type="text" inputMode="decimal" autoComplete="off" value={rcvQtyStr} disabled={pending}
                  onChange={e => setRcvQtyStr(e.target.value.replace(/[^0-9.]/g, ''))}
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

  // ── 폐기 (StockDisposal) — 표시 + 삭제(undo는 부모 핸들러)
  if (entry.type === 'disposal') {
    return (
      <li className="flex items-center justify-between gap-2 border border-[var(--danger-ring)]/40 rounded-xl px-3 py-2" style={{ background: 'var(--danger-bg)' }}>
        <div className="min-w-0 flex items-center gap-2">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--danger-fg)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" /></svg>
          <div className="min-w-0">
            <p className="text-xs" style={{ color: 'var(--danger-fg)' }}>
              {fmtDate(entry.date)} · 폐기{entry.reason ? ` (${entry.reason})` : ''}
              {entry.storageLocationName && <span className="ml-1">· {entry.storageLocationName}</span>}
            </p>
            <p className="text-sm font-medium" style={{ color: 'var(--danger-fg)' }}>− {fmtQty(entry.disposedQty, stockUnit)}</p>
            {entry.memo && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button type="button" disabled={pending} onClick={() => onDeleteDisposal(entry.id)}
            className="text-xs text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 min-h-[32px] rounded-lg hover:bg-[var(--danger-bg)]">삭제</button>
        </div>
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
        // 날짜·수량·위치를 고치면 그 뒤 점검의 저장 잔량이 어긋난다 — 함께 옮길지 먼저 묻는다.
        const wasDate = entry.date instanceof Date ? entry.date.toISOString().slice(0, 10) : String(entry.date).slice(0, 10)
        const movedDate = !!data.date && data.date !== wasDate
        const ask = await askLedgerShift({
          trackedItemId, additionId: entry.id,
          next: { date: data.date ?? wasDate, addedQty: data.addedQty ?? entry.addedQty, storageLocationId: data.storageLocationId ?? null },
          title: movedDate ? `무상 입수 날짜를 ${fmtDateKor(data.date)}로 옮길까요?` : '무상 입수 기록을 바꿀까요?',
          keepLine: '수량과 출처, 메모는 입력한 대로 저장됩니다.',
          impactLine: n => `이 날짜 뒤의 점검 ${n}건은 저장된 잔량이 이 입수를 담고 있지 않습니다. 함께 조정하면 이렇게 바뀝니다.`,
          unit: stockUnit,
        })
        if (ask.error) { setSavePending(false); setEditError(ask.error); return }
        if (!ask.result) { setSavePending(false); return }
        const res = await updateStockAddition(entry.id, { ...data, adjustFollowing: ask.result.adjust })
        setSavePending(false)
        if (!res.ok) { setEditError(res.error); return }
        setEditing(false)
        pushToast('success', '입수 기록 수정됨', {
          ...(ask.result.adjust && ask.result.count > 0 ? { detail: `점검 ${ask.result.count}건의 잔량도 함께 옮겼습니다.` } : {}),
          action: { label: '적용취소', run: () => { void undoUpdateStockAddition(res.undo).then(r => {
            if (r.ok) { pushToast('info', '입수 기록을 되돌렸습니다'); onChanged() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
        })
        onChanged()
      }}
      onDelete={async () => {
        // 삭제도 같은 물음을 거친다 — 뒤 점검에 얹힌 만큼 빼지 않으면 유령 재고가 남는다.
        const ask = await askLedgerShift({
          trackedItemId, additionId: entry.id, next: null,
          title: '이 입수 기록을 삭제할까요?',
          keepLine: '입수 기록은 삭제됩니다.',
          impactLine: n => `이 입수를 담고 있는 점검 ${n}건이 있습니다. 함께 조정하면 이렇게 바뀝니다.`,
          unit: stockUnit,
        })
        if (ask.error) { setEditError(ask.error); return }
        if (!ask.result) return
        setSavePending(true)
        const res = await deleteStockAddition(entry.id, { adjustFollowing: ask.result.adjust })
        setSavePending(false)
        if (!res.ok) { setEditError(res.error); return }
        pushToast('success', '입수 기록 삭제됨', {
          action: { label: '적용취소', run: () => { void undoDeleteStockAddition(res.undo).then(r => {
            if (r.ok) { pushToast('info', '입수 기록을 복원했습니다'); onChanged() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) } },
        })
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
          {entry.memo && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">{entry.memo}</p>}
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

// ── 줄어든 차이의 귀속 2지선다 (보정 표면 공용, 운영자 승인 2026-08-19) ──────────
// 차이가 음수(예상보다 줄어듦)일 때만 띄운다 — 늘어난 차이는 소비일 수 없어 선택지가 없다.
// 시각 문법은 CheckForm 의 보정 라벨 박스 정본(테두리 박스·honey 강조)을 그대로 따른다.
// 기본값은 '제외'(현행) — 아무것도 안 고르고 저장하면 지금까지와 똑같이 저장된다.
function DiffAttributionChoice({ value, onChange, name, sinceLabel }: {
  value: DiffAttribution
  onChange: (v: DiffAttribution) => void
  name: string          // 라디오 그룹 이름 — 한 화면에 두 그룹이 뜨지 않게 호출부가 정한다
  sinceLabel: string    // '직전 점검(8월 12일) 이후' 처럼 어느 구간의 소비인지
}) {
  const box = (on: boolean) =>
    `flex items-start gap-2 cursor-pointer select-none rounded-lg border px-2.5 py-2 transition-colors ${
      on ? 'bg-[var(--honey)]/10 border-[var(--honey)]/40' : 'bg-[var(--canvas)] border-[var(--warm-border)]'}`
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-medium text-[var(--warm-mid)]">줄어든 차이 처리</p>
      <label className={box(value === 'usage')}>
        <input type="radio" name={name} checked={value === 'usage'} onChange={() => onChange('usage')} className="mt-0.5 accent-[var(--coral)]" />
        <span className="text-[0.65625rem] text-[var(--warm-mid)] leading-snug">
          <strong className="text-[var(--warm-dark)]">지난 기간 사용으로 기록</strong><br />
          {sinceLabel} 소비로 계산되어 소진 예상과 월별 사용량에 반영됩니다.
        </span>
      </label>
      <label className={box(value === 'exclude')}>
        <input type="radio" name={name} checked={value === 'exclude'} onChange={() => onChange('exclude')} className="mt-0.5 accent-[var(--coral)]" />
        <span className="text-[0.65625rem] text-[var(--warm-mid)] leading-snug">
          <strong className="text-[var(--warm-dark)]">소비 통계에서 제외</strong><br />
          분실, 파손, 계산 오차 등 실제 사용이 아닐 때 고릅니다.
        </span>
      </label>
    </div>
  )
}

// ── 재고 점검 인라인 편집 폼
// ── 전체 재고 보정(총점검) — 보충 완료 후, 전 품목 실측을 한 번에 기준선으로 박는다.
//    차이는 사용량으로 잡지 않음(isReconcile). 위치별 예상치 프리필 → 사용자가 실제 센 값만 고침.
// ── 타임라인 보정 끼워넣기 (v2) — 품목 상세에서 특정 과거/현재 시점에 보정 점검 삽입.
//    날짜를 고르면 그 시점 '예상 재고'(직전 점검+그 사이 입고)를 위치별로 보여주고, 실측 입력 → 차이 표시.
//    isReconcile 점검으로 저장(saveFullReconcile 단일 품목) → 그 구간 차이는 사용량에 안 잡힘.
function TimelineReconcileForm({ item, existingCheckDays = [], hiddenLocationIds, onCancel, onDone }: {
  item: { id: string; label: string; specUnit: string | null; qtyUnit: string | null; unitHint: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  existingCheckDays?: string[]   // 이미 점검이 있는 날짜(KST, YYYY-MM-DD) — 같은 날 중복 보정 가드용
  hiddenLocationIds?: string[]   // 숨긴(비어 있는) 위치 — 입력·합계에서 제외(카드 칩과 동일 기준)
  onCancel: () => void
  onDone: () => void
}) {
  const NO_LOC = '__total__'
  // 숨긴 위치 제외 — 잔량 ≈0 이라 합계는 ε 안에서 동일. 보정 저장의 breakdown 에서도 빠지지만
  // 0 행이 빠지는 것뿐이라 총량·hidden 판정 모두 불변(빠진 위치는 0 으로 읽힘).
  const tlHidden = new Set(hiddenLocationIds ?? [])
  const tlLocations = item.locations.filter(l => !tlHidden.has(l.id))
  const r2 = (x: number) => Math.round(x * 100) / 100
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const hasLoc = tlLocations.length > 0
  const unit = item.trackUnit === 'qty' ? (item.qtyUnit ?? item.unitHint) : (item.specUnit ?? item.qtyUnit ?? item.unitHint)
  const [date, setDate] = useState(todayKst)
  const [memo, setMemo] = useState('')
  // 줄어든 차이의 귀속 — 기본은 현행(제외). 차이가 음수일 때만 화면에 뜬다.
  const [attribution, setAttribution] = useState<DiffAttribution>('exclude')
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
        setActuals(Object.fromEntries(tlLocations.map(l => [l.id, String(byLoc[l.id] ?? 0)])))
      } else {
        setExpected({ total: res.total, byLoc: {} })
        setActuals({ [NO_LOC]: String(res.total) })
      }
      setLoading(false)
    }).catch(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [date, item.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const actualTotal = hasLoc
    ? tlLocations.reduce((s, l) => s + Number(actuals[l.id] || '0'), 0)
    : Number(actuals[NO_LOC] || '0')
  const expectedTotal = expected?.total ?? 0
  const diff = r2(actualTotal - expectedTotal)
  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  const dateHasCheck = existingCheckDays.includes(date)
  // 실제로 사용으로 기록될 때만 true — 차이가 없거나 늘었으면 선택과 무관하게 보정이다(서버 판정과 동일).
  const asUsage = diff < -0.001 && attribution === 'usage'
  // 부연에 쓸 기준 구간 — getStockAsOf 가 잡는 기준선과 같은 규칙(고른 날짜 이하 마지막 점검).
  const baselineDay = existingCheckDays.filter(d => d <= date).sort().pop() ?? null
  const sinceLabel = baselineDay ? `직전 점검(${fmtMonthDayKor(baselineDay)}) 이후` : '직전 점검 이후'

  const handleSave = async () => {
    // 같은 날 이미 점검이 있으면 — 새 보정을 또 만들면 타임라인이 중복돼 헷갈림.
    // 그 점검을 수정하는 게 정확. 한 번 더 확인받고 진행.
    if (dateHasCheck && !(await confirmDialog({ title: `${date}에 이미 점검 기록이 있어요`, message: "새 보정을 또 추가하면 같은 날 항목이 둘이 돼 헷갈릴 수 있어요. 보통은 '취소'를 누르고 그 점검의 [수정]에서 고치는 게 정확합니다.", level: 'caution', confirmLabel: '그래도 추가' }))) {
      return
    }
    setPending(true); setError('')
    // expectedQty — 서버가 차이의 부호를 판정하는 근거. 화면이 보여준 예상 재고 그대로 보낸다.
    const items = hasLoc
      ? [{ trackedItemId: item.id, locationQtys: tlLocations.map(l => ({ storageLocationId: l.id, qty: Number(actuals[l.id] || '0') })), memo: memo || undefined, expectedQty: expectedTotal }]
      : [{ trackedItemId: item.id, remainingQty: Number(actuals[NO_LOC] || '0'), memo: memo || undefined, expectedQty: expectedTotal }]
    const res = await saveFullReconcile({ date, attribution, items })
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    // 전체 보정은 여러 품목의 기준선을 한 번에 박는 가장 위험한 액션인데 되돌리기가 없었다.
    pushToast('success', asUsage ? '지난 기간 사용으로 기록됨' : `재고 보정 ${res.count}건 저장됨`, {
      action: { label: '적용취소', run: () => { void (async () => {
        for (const cid of res.createdIds) { const r = await deleteStockCheck(cid); if (!r.ok) { pushToast('error', r.error); return } }
        pushToast('info', asUsage ? '기록을 되돌렸습니다' : '보정을 되돌렸습니다')
        onDone()
      })().catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
    })
    onDone()
  }

  return (
    <div className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <div>
        <p className="text-xs font-medium text-[var(--warm-mid)]">보정 끼워넣기</p>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">
          고른 날짜 시점의 실제 수량으로 기준선을 보정합니다.{' '}
          {asUsage ? '줄어든 차이는 지난 기간 사용으로 기록됩니다.' : '차이는 사용량으로 잡히지 않습니다.'}
        </p>
      </div>
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">보정 시점(날짜)</label>
        <DatePicker value={date} onChange={setDate} />
        {dateHasCheck && (
          <p className="text-[0.6875rem] text-[var(--honey)] bg-[var(--honey)]/10 border border-[var(--honey)]/30 rounded-lg px-2.5 py-1.5">
            이 날짜엔 이미 점검 기록이 있어요. 보통은 새 보정을 만들기보다 <strong>그 점검의 [수정]</strong>에서 고치는 게 정확합니다 (같은 날 중복 방지).
            {/* 같은 날에 보정이 하나라도 있으면 살아남는 점검도 보정으로 승격된다(overview dedupSameDay).
                고른 선택이 조용히 무효가 되므로 이 동선에서만 한 줄 더 알린다. */}
            {asUsage && <><br />같은 날 보정 기록이 있으면 이 저장도 보정으로 묶여 사용량에 반영되지 않습니다. 그 점검을 먼저 지우고 저장하세요.</>}
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
              {tlLocations.map(l => (
                <div key={l.id}>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5 truncate">
                    {l.name}{l.isHub ? ' (창고)' : ''} <span className="text-[var(--warm-border)]">· 예상 {r2(expected?.byLoc[l.id] ?? 0)}</span>
                  </p>
                  <input type="text" inputMode="decimal" autoComplete="off" value={actuals[l.id] ?? ''}
                    onChange={e => setActuals(p => ({ ...p, [l.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                    className={`w-full ${inputCls}`} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--warm-mid)]">실측 잔량</span>
              <input type="text" inputMode="decimal" autoComplete="off" value={actuals[NO_LOC] ?? ''}
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
          {diff < -0.001 && (
            <DiffAttributionChoice name="tl-diff-attr" value={attribution} onChange={setAttribution} sinceLabel={sinceLabel} />
          )}
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
          {pending ? '저장 중…' : asUsage ? '이 시점에 사용으로 기록' : '이 시점에 보정 저장'}
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
  const [dirty, setDirty] = useState(false)   // v2.0 §12 — 입력 시작 후 닫기 보호
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
    // 카테고리를 빼면 그 품목들이 목록·수령 대기에서 사라진다. 데이터는 남지만 화면에서 증발하므로
    // 무슨 일이 일어났는지 알린다(되돌리기는 같은 화면에서 다시 추가하면 된다).
    pushToast('success', '재고 카테고리 저장됨', { detail: '뺀 카테고리의 품목은 목록에서 숨겨집니다. 데이터는 지워지지 않습니다.' })
    onDone()
  }

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <Modal open onClose={onClose} title="재고 카테고리 설정"
      subtitle="재고관리에 표시할 카테고리와 이름을 정합니다. (지출 카테고리는 그대로 유지)"
      width="lg" dirty={dirty}
      footer={<div className="flex items-center justify-end gap-2">
          <Btn variant="ghost" size="sm" onClick={onClose}>취소</Btn>
          <Btn variant="primary" size="sm" onClick={handleSave} disabled={pending || !entries.length}>
            {pending ? '저장 중…' : '저장'}
          </Btn>
      </div>}
      bodyClassName="px-5 sm:px-6 py-4">
      {/* v2.0 §12 dirty — 입력 시작 후 배경클릭 무시(Modal 내장) */}
      <div className="space-y-3" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
          <div className="space-y-2">
            <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)]">표시 중인 카테고리 (위에서부터 표시 순서)</p>
            <div className="space-y-2">
            {entries.map((e, i) => (
              <div key={e.cat} className="flex items-center gap-2 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] px-2.5 py-2">
                <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: tintOf(e.cat).fg }} />
                <div className="flex flex-col shrink-0 w-20">
                  <span className="text-[0.65625rem] text-[var(--warm-muted)]">지출명</span>
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
                    className="p-1 text-[var(--danger-fg)] hover:text-[var(--danger-fg)] text-xs" aria-label="제거"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </div>
              </div>
            ))}
            </div>
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
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">예: 수선유지비를 추가하면 수리부품 재고도 추적할 수 있습니다.</p>
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
  const [dirty, setDirty] = useState(false)   // v2.0 §12 — 입력 시작 후 닫기 보호
  const NO_LOC = '__total__'
  const r2 = (x: number) => Math.round(x * 100) / 100
  // 숨긴 위치 제외한 표시 위치 — 렌더·합계·저장에만 쓰고, '위치 안 쓰는 품목' 분기(r.locations.length===0)는 원본 유지
  const vLocs = (r: InventoryRow) => { const h = new Set(r.hiddenLocationIds); return r.locations.filter(l => !h.has(l.id)) }
  const todayKst = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10)
  const [date, setDate] = useState(todayKst)
  const [restockDone, setRestockDone] = useState(false)
  // 줄어든 차이의 귀속 — 모달 단위 선택 1개(행별 아님). 기본은 현행(제외).
  const [attribution, setAttribution] = useState<DiffAttribution>('exclude')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')

  const unitOf = (r: InventoryRow) => (r.trackUnit === 'qty' ? (r.qtyUnit ?? r.unitHint) : (r.specUnit ?? r.qtyUnit ?? r.unitHint))

  // 예상 재고 — 위치별 프리필: 직전 점검 위치별 + (현재고 − 직전총합)을 허브에 가산해 합계가 현재고와 일치.
  const expectedFor = (r: InventoryRow): { byLoc: Record<string, number>; total: number } => {
    const total = r.currentStock ?? r.lastRemainingQty ?? 0
    if (r.locations.length === 0) return { byLoc: {}, total }
    const byLoc: Record<string, number> = {}
    for (const l of vLocs(r)) byLoc[l.id] = r.currentLocationBreakdown.find(b => b.locationId === l.id)?.qty ?? 0
    const lastSum = Object.values(byLoc).reduce((s, v) => s + v, 0)
    const sinceDelta = total - lastSum
    if (Math.abs(sinceDelta) > 0.001) {
      const hub = vLocs(r).find(l => l.isHub) ?? vLocs(r)[0]
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
        : Object.fromEntries(vLocs(r).map(l => [l.id, String(r2(exp.byLoc[l.id] ?? 0))]))
    }
    return init
  })

  const setVal = (itemId: string, locKey: string, v: string) =>
    setActuals(prev => ({ ...prev, [itemId]: { ...prev[itemId], [locKey]: v.replace(/[^0-9.]/g, '') } }))

  const actualTotalOf = (r: InventoryRow) =>
    r.locations.length === 0
      ? Number(actuals[r.id]?.[NO_LOC] || '0')
      : vLocs(r).reduce((s, l) => s + Number(actuals[r.id]?.[l.id] || '0'), 0)

  const expectedOf = (r: InventoryRow) => r.currentStock ?? r.lastRemainingQty ?? 0
  // 차이 있는 품목만 저장 대상
  const changed = rows.filter(r => Math.abs(actualTotalOf(r) - expectedOf(r)) > 0.001)
  // 줄어든 품목이 하나라도 있을 때만 2지선다를 띄운다. 늘어난 품목은 선택과 무관하게 보정으로 저장된다.
  const shortCount = changed.filter(r => actualTotalOf(r) - expectedOf(r) < -0.001).length
  const asUsage = shortCount > 0 && attribution === 'usage'

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] disabled:opacity-40'

  const handleSave = async () => {
    if (!changed.length) { setError('변경된(차이 있는) 품목이 없습니다.'); return }
    setPending(true); setError('')
    // expectedQty — 서버가 품목별 차이의 부호를 판정하는 근거(화면이 보여준 예상 재고 그대로).
    const items = changed.map(r => r.locations.length === 0
      ? { trackedItemId: r.id, remainingQty: Number(actuals[r.id]?.[NO_LOC] || '0'), expectedQty: expectedOf(r) }
      : { trackedItemId: r.id, locationQtys: vLocs(r).map(l => ({ storageLocationId: l.id, qty: Number(actuals[r.id]?.[l.id] || '0') })), expectedQty: expectedOf(r) })
    const res = await saveFullReconcile({ date, attribution, items })
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    // 전체 보정은 여러 품목의 기준선을 한 번에 박는 가장 위험한 액션인데 되돌리기가 없었다.
    pushToast('success', asUsage ? `${res.count}품목 저장됨 (줄어든 ${shortCount}품목은 사용으로 기록)` : `재고 보정 ${res.count}건 저장됨`, {
      action: { label: '적용취소', run: () => { void (async () => {
        for (const cid of res.createdIds) { const r = await deleteStockCheck(cid); if (!r.ok) { pushToast('error', r.error); return } }
        pushToast('info', asUsage ? '기록을 되돌렸습니다' : '보정을 되돌렸습니다')
        onDone()
      })().catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
    })
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="전체 재고 보정"
      subtitle={`실제 남은 수량을 세어 기준선을 다시 맞춥니다. ${asUsage ? '줄어든 차이는 지난 기간 사용으로 기록됩니다.' : '차이는 사용량으로 잡히지 않습니다.'}`}
      width="2xl" dirty={dirty}
      footer={<div className="flex items-center justify-between gap-2">
          <span className="text-[0.6875rem] text-[var(--warm-muted)]">차이 있는 {changed.length}품목 저장</span>
          <div className="flex items-center gap-2">
            <Btn variant="ghost" size="sm" onClick={onClose}>취소</Btn>
            <Btn variant="primary" size="sm" onClick={handleSave} disabled={pending || !restockDone || !changed.length}>
              {pending ? '저장 중…' : asUsage ? `저장 (${changed.length})` : `보정 저장 (${changed.length})`}
            </Btn>
          </div>
      </div>}
      bodyClassName="px-5 sm:px-6 py-4">
      {/* v2.0 §12 dirty — 입력 시작 후 배경클릭 무시(Modal 내장) */}
      <div className="space-y-3" onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
          {/* 보정 날짜 + 보충 완료 게이트 — 공용 Modal 전환(e24c4e03)에서 머리 블록째 사라졌는데
              disabled={!restockDone} 만 남아 실측 칸과 저장 버튼이 영구히 잠겨 있었다. 원본 그대로 복구. */}
          <div className="flex items-center gap-2">
            <span className="text-[0.6875rem] text-[var(--warm-muted)] shrink-0">보정 날짜</span>
            <div className="w-44"><DatePicker value={date} onChange={setDate} /></div>
          </div>
          <label className="flex items-start gap-2 cursor-pointer select-none rounded-lg bg-[var(--honey)]/5 border border-[var(--honey)]/30 px-2.5 py-2">
            <input type="checkbox" checked={restockDone} onChange={e => setRestockDone(e.target.checked)} className="mt-0.5 accent-[var(--coral)]" />
            <span className="text-[0.65625rem] text-[var(--warm-mid)] leading-snug">
              <strong className="text-[var(--warm-dark)]">창고 → 방 보충을 모두 마쳤습니다.</strong><br />
              보충이 끝나기 전(입주자가 아직 쓰는 중)에 점검하면 사용분이 분실로 잡힐 수 있어, 보충 완료 후 점검을 권장합니다.
            </span>
          </label>
          {/* 모달 단위 선택 1개(행별 아님) — 줄어든 품목이 하나라도 생기면 뜬다. 날짜·보충 완료와 같은
              '이 저장 전체에 걸리는 결정' 무리라 여기 둔다. */}
          {shortCount > 0 && (
            <DiffAttributionChoice name="full-diff-attr" value={attribution} onChange={setAttribution}
              sinceLabel="각 품목의 직전 점검 이후" />
          )}
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
                        <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">예상 {r2(expected)}{unit ?? ''}</span>
                      </div>
                      {r.locations.length === 0 ? (
                        <div className="flex items-center gap-2 mt-1.5">
                          <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">실측</span>
                          <input type="text" inputMode="decimal" autoComplete="off" disabled={!restockDone}
                            value={actuals[r.id]?.[NO_LOC] ?? ''} onChange={e => setVal(r.id, NO_LOC, e.target.value)}
                            className={`w-24 ${inputCls}`} />
                          <span className="text-[0.65625rem] text-[var(--warm-muted)]">{unit ?? ''}</span>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5 mt-1.5">
                          {vLocs(r).map(l => (
                            <div key={l.id}>
                              <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5 truncate">{l.name}{l.isHub ? ' (창고)' : ''}</p>
                              <input type="text" inputMode="decimal" autoComplete="off" disabled={!restockDone}
                                value={actuals[r.id]?.[l.id] ?? ''} onChange={e => setVal(r.id, l.id, e.target.value)}
                                className={`w-full ${inputCls}`} />
                            </div>
                          ))}
                        </div>
                      )}
                      <div className="flex justify-end mt-1.5">
                        {Math.abs(diff) > 0.001 ? (
                          <span className="text-[0.65625rem] font-medium" style={{ color: diff < 0 ? 'var(--coral)' : 'var(--honey)' }}>
                            실측 {r2(actual)}{unit ?? ''} · 차이 {diff > 0 ? '+' : ''}{diff}{unit ?? ''}
                          </span>
                        ) : (
                          <span className="text-[0.65625rem] text-[var(--warm-muted)]">차이 없음</span>
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
  onSave: (data: { date?: string; memo?: string | null; remainingQty?: number; locationQtys?: { storageLocationId: string; qty: number; restockedQty?: number }[]; restockHubLocationId?: string }) => Promise<void>
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

  // calcLocMove 단일 규칙(생성 폼과 동일). 단 기준선은 '그 점검의 원래 채우기 전'(역산값) —
  // 현재 잔량을 기준으로 쓰면 과거 점검 수정이 오늘 값으로 오염된다(전문가 오더 2026-07-28).
  const origBefore = (id: string) => initial[id] ? Number(initial[id].before) : null
  const restockSum = locationSources.filter(l => !l.isHub).reduce((s, l) =>
    s + calcLocMove(beforeQtys[l.id] ?? '', afterQtys[l.id] ?? '', origBefore(l.id)).restocked, 0)

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
        // 클라가 차감한 허브를 서버 검출과 일치시켜 조용한 클램프를 정확히 감지(권장 수정).
        restockHubLocationId: hubLoc?.id,
        locationQtys: locationSources
          // 허브 + 원래 점검에 있던 위치 + 사용자가 값을 입력한 위치만 저장.
          // (새로 표시된 위치를 안 건드렸으면 0으로 끼워넣지 않음 — breakdown 오염 방지)
          .filter(l => l.isHub
            || entry.locationBreakdown.some(lb => lb.locationId === l.id)
            || (afterQtys[l.id] ?? '') !== '' || (beforeQtys[l.id] ?? '') !== '')
          .map(l => {
            if (l.isHub) return { storageLocationId: l.id, qty: hubFinal }
            // calcLocMove 단일 규칙 — 화면 restockSum 과 같은 계산이라야 저장 후 숫자가 안 튄다
            const { restocked } = calcLocMove(beforeQtys[l.id] ?? '', afterQtys[l.id] ?? '', origBefore(l.id))
            return {
              storageLocationId: l.id, qty: Number(afterQtys[l.id] || '0'),
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
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        {!hasLocations && (
          <div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">잔량{stockUnit ? ` (${stockUnit})` : ''}</p>
            <input type="text" inputMode="decimal" autoComplete="off" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className={`w-full ${inputCls}`} />
          </div>
        )}
      </div>
      {hasLocations && (
        <div className="space-y-2">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">위치별 채우기 전 → 채운 후{stockUnit ? ` (${stockUnit})` : ''}</p>
          {locationSources.map(l => {
            // 창고(허브) 행 — 보충 입력 없이 '이전 → 자동 차감 후' 자동계산
            if (l.isHub) {
              const userVal = afterQtys[l.id]
              const displayAfter = hubTouched && userVal !== undefined ? userVal : String(Math.round(hubAutoAfter * 100) / 100)
              return (
                <div key={l.id} className="bg-[var(--honey)]/5 border border-[var(--honey)]/30 rounded-lg px-2 py-1.5 space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--warm-dark)] truncate">{l.name} <span className="text-[var(--warm-muted)]">(허브)</span></span>
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">이전 {Math.round(hubBefore * 100) / 100}{stockUnit ?? ''}</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--warm-muted)] shrink-0">자동 차감 후</span>
                    <input type="text" inputMode="decimal" autoComplete="off"
                      value={displayAfter}
                      onChange={e => { setAfterQtys(prev => ({ ...prev, [l.id]: e.target.value.replace(/[^0-9.]/g, '') })); setHubTouched(true) }}
                      className={`w-20 ${inputCls}`} />
                    <span className="text-[var(--warm-muted)] shrink-0">{stockUnit ?? ''}</span>
                    {restockSum > 0 && (
                      <span className="ml-auto text-[0.65625rem] text-[var(--persimmon-d)] shrink-0">−{Math.round(restockSum * 100) / 100} 차감</span>
                    )}
                  </div>
                </div>
              )
            }
            // 비허브 위치 행 — 채우기 전 → 채운 후 (차이만큼 창고에서 이동). 배지도 calcLocMove 단일 규칙.
            const beforeStr = beforeQtys[l.id] ?? ''
            const afterStr  = afterQtys[l.id] ?? ''
            const { restocked } = calcLocMove(beforeStr, afterStr, origBefore(l.id))
            return (
              <div key={l.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] truncate">{l.name}</span>
                  <div className="flex items-baseline gap-1.5 shrink-0">
                    <button type="button"
                      onClick={() => setAfterQtys(p => ({ ...p, [l.id]: beforeQtys[l.id] ?? '' }))}
                      className="text-[0.65625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                      옮김 없음
                    </button>
                    {restocked > 0 && (
                      <span className="text-[0.65625rem] text-[var(--coral)]">창고에서 +{Math.round(restocked * 100) / 100}{stockUnit ?? ''}</span>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">채우기 전</p>
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                      value={beforeStr}
                      onChange={e => setBeforeQtys(prev => ({ ...prev, [l.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                  <div>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">채운 후</p>
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                      value={afterStr}
                      onChange={e => setAfterQtys(prev => ({ ...prev, [l.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                </div>
              </div>
            )
          })}
          <div className="flex justify-between text-[0.65625rem] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1">
            {restockSum > 0
              ? <span className="text-[var(--warm-mid)]">창고 → 이동 합계 <strong className="text-[var(--coral)]">+{Math.round(restockSum * 100) / 100}{stockUnit ?? ''}</strong></span>
              : <span className="text-[var(--warm-muted)]">옮김 없음</span>}
            <span className="text-[var(--warm-mid)]">잔량 <strong className="text-[var(--coral)]">{Math.round(locationTotal * 100) / 100}{stockUnit ?? ''}</strong></span>
          </div>
        </div>
      )}
      <div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={`w-full ${inputCls} text-left`} />
      </div>
      <div className="flex gap-2 pt-1 justify-end">
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={pending}>취소</Btn>
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
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">날짜</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">수량{stockUnit ? ` (${stockUnit})` : ''}</p>
          <input type="text" inputMode="decimal" autoComplete="off" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))} className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">출처</p>
        <input type="text" value={source} onChange={e => setSource(e.target.value)} placeholder="예: 샘플, 증정" className={inputCls} />
      </div>
      {itemLocations.length > 0 && (
        <div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">입고 위치</p>
          <select value={storageLocationId} onChange={e => setStorageLocationId(e.target.value)} className={inputCls}>
            <option value="">위치 없이 기록</option>
            {itemLocations.map(loc => (
              <option key={loc.id} value={loc.id}>{loc.name}{loc.isHub ? ' (허브)' : ''}</option>
            ))}
          </select>
        </div>
      )}
      <div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onDelete} disabled={pending}
          className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-2 py-1.5 rounded-lg hover:bg-[var(--danger-bg)]">삭제</button>
        <div className="flex-1" />
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={pending}>취소</Btn>
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

  // 수령 확정일시 — 읽기·쓰기 모두 lib/kstDate 정본(인라인 KST 계산 복제 금지)
  const initReceived = splitKstDateTime(entry.receivedAt)
  const initReceivedDate = initReceived.ymd
  const initReceivedTime = initReceived.hm
  const [receivedDate, setReceivedDate] = useState(initReceivedDate)
  const [receivedTime, setReceivedTime] = useState(initReceivedTime)
  // 명시적 미수령 토글 — 'clear' sentinel 대신 별도 플래그로 DatePicker가
  // 'clear' 문자열을 날짜로 파싱하려다 Invalid Date 표시되던 문제 해결
  const [unreceived, setUnreceived] = useState(false)

  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  const buildReceivedAt = () => {
    if (unreceived) return null  // 수령 대기로 되돌리기
    if (!receivedDate) return undefined  // 변경 없음
    // KST → UTC 변환
    return kstDateTimeToUtc(receivedDate, receivedTime || '00:00')?.toISOString()
  }

  return (
    <li className="border border-[var(--warm-border)] rounded-xl px-3 py-3 space-y-2 bg-[var(--canvas)]">
      <p className="text-xs font-medium text-[var(--warm-mid)]">구매 수정 <span className="text-[0.65625rem] font-normal text-[var(--warm-muted)]">수정 내용은 지출 페이지에도 반영됩니다</span></p>
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">구매일</p>
          <DatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">금액 (원)</p>
          <input type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" className={inputCls} />
        </div>
      </div>
      <div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">구매처</p>
        <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="예: 고구마켓" className={inputCls} />
      </div>
      <div>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">메모</p>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} className={inputCls} />
      </div>
      {/* 수령 확정일시 */}
      <div className="space-y-1">
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">수령 확정일시</p>
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
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={pending}>취소</Btn>
        <Btn variant="primary" size="sm" disabled={pending}
          onClick={() => onSave({ date, amount: amount ? Number(amount) : undefined, vendor: vendor || null, memo: memo || null, receivedAt: buildReceivedAt() })}>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </li>
  )
}

// 창고에서 옮김(구 '보충') 계산 단일 규칙 — 화면 합계·배지·저장·수정 폼이 전부 이 함수를 쓴다(운영자 승인 2026-07-28).
// '채운 후'만 입력해도 기준선(채우기 전 입력 ?? 직전 잔량)에서 늘어난 만큼 창고에서 옮긴 것으로 계산해 허브를 차감한다.
// 종전엔 화면(전·후 모두 입력 요구)과 저장(직전 잔량 폴백)의 규칙이 갈라져, 후만 입력하면 허브 미차감으로
// 총량이 부푸는 유령 재고 위험이 있었다(김치 20kg 후속 신고). 음수(후 < 기준)는 0 클램프 — 허브 환입 금지.
function calcLocMove(beforeStr: string, afterStr: string, baseline: number | null): {
  beforeN: number | null; afterN: number | null; restocked: number
} {
  const beforeN = beforeStr === '' ? null : Number(beforeStr)
  const afterN  = afterStr === '' ? null : Number(afterStr)
  const base = beforeN ?? baseline
  const restocked = (base !== null && afterN !== null && afterN > base) ? afterN - base : 0
  return { beforeN, afterN, restocked }
}

function CheckForm({ item, lastCheckBreakdown, hiddenLocationIds, onCancel, onDone, onDraftChange, onGoDisposal }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; unitHint: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  lastCheckBreakdown: LocationQtyEntry[]
  hiddenLocationIds?: string[]   // 숨긴(비어 있는) 위치 — 입력 행에서 제외. 카드 칩과 동일 기준(운영자 지적 2026-07-18)
  onCancel: () => void; onDone: () => void; onDraftChange?: () => void
  onGoDisposal?: () => void   // 폐기 기록 바로가기 — 점검 저장 전에 폐기를 먼저 기록(이중 차감 방지, 오류신고 a1e048e8)
}) {
  const stockUnit = item.trackUnit === 'qty' ? (item.qtyUnit ?? item.unitHint) : (item.specUnit ?? item.qtyUnit ?? item.unitHint)
  // 숨긴 위치는 점검 입력에서도 가린다 — 서버 carryOver 가 미입력 위치의 직전값(0)을 이월하므로 데이터 무손실.
  // 숨겼지만 재고가 든 위치는 hiddenLocationIds 에 없어(자동 치유) 계속 입력 행에 남는다.
  const hiddenLoc = new Set(hiddenLocationIds ?? [])
  const chkLocations = item.locations.filter(l => !hiddenLoc.has(l.id))
  const hasLocations = chkLocations.length > 0
  const [date, setDate] = useState(kstYmdStr())

  // 이전 점검의 위치별 수량 맵 + 그때 보충한 양(restockedQty) 맵 — 참고줄에 계속 표시
  const prevMap = Object.fromEntries(lastCheckBreakdown.map(lb => [lb.locationId, lb.qty]))
  const prevRestockedMap = Object.fromEntries(lastCheckBreakdown.map(lb => [lb.locationId, lb.restockedQty]))
  const hasPrev = lastCheckBreakdown.length > 0

  // 첫 허브 위치 (다중 허브면 첫 번째 — 보충량 자동 차감 대상)
  const hubLoc = chkLocations.find(l => l.isHub)
  const hubPrev = hubLoc ? (prevMap[hubLoc.id] ?? 0) : 0

  // 보충 모드: 이전 점검이 있을 때만. 첫 점검은 단순 잔량 입력.
  const restockMode = hasPrev && hasLocations

  // 단순 모드 — 위치별 잔량 1칸 (첫 점검 또는 위치 없음)
  const [locationQtys, setLocationQtys] = useState<Record<string, string>>(
    () => Object.fromEntries(chkLocations.map(l => [l.id, prevMap[l.id] != null ? String(prevMap[l.id]) : '']))
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
  // 허브 부족 감지 시 이동 유도 팝업(단일 품목)
  const [hubShort, setHubShort] = useState<HubShortPending | null>(null)

  // 임시저장(드래프트) — 아이템별 점검은 locationId null. 폼을 열면 직전 임시저장값을 복원.
  const [draftSavedAt, setDraftSavedAt] = useState<number | null>(null)
  const [draftPending, setDraftPending] = useState(false)
  // 임시저장 상태 칩(§12 정본) — 저장 시점 스냅샷과 현재 입력을 비교해 '저장 후 수정됨'을 표시(불안 해소).
  const draftSavedSnapRef = useRef<string | null>(null)
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
      const hubIds = new Set(chkLocations.filter(l => l.isHub).map(l => l.id))
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
    const snapAtSave = JSON.stringify({ date, qty, memo, locationQtys, beforeQtys, afterQtys, hubTouched })
    saveStockCheckDraft({
      trackedItemId: item.id, locationId: null,
      data: { date, qty, memo, locationQtys, beforeQtys, afterQtys, hubTouched, savedAt },
    }).then(res => {
      setDraftPending(false)
      if (!res.ok) { pushToast('error', res.error); return }
      setDraftSavedAt(savedAt)
      draftSavedSnapRef.current = snapAtSave
      pushToast('success', '임시저장됨')
      onDraftChange?.()
    })
  }

  const handleClearDraft = () => {
    // cross-mode 공유 — 이 품목의 모든 드래프트(아이템별+위치별) 정리
    deleteItemDrafts(item.id).then(() => {
      setDraftSavedAt(null)
      draftSavedSnapRef.current = null
      pushToast('success', '임시저장 비움')
      onDraftChange?.()
    })
  }

  const handleLocChange = (id: string, val: string) => {
    setLocationQtys(prev => ({ ...prev, [id]: val.replace(/[^0-9.]/g, '') }))
    setTouched(prev => new Set([...prev, id]))
  }
  const confirmAll = () => setTouched(new Set(chkLocations.map(l => l.id)))

  // 비허브 위치들의 옮김량 합계 — calcLocMove 단일 규칙(저장 buildLocationData 와 동일).
  // 기준선(직전 잔량 = 현재 잔량 기준선)이 신뢰 가능해져 후만 입력해도 화면·허브 차감이 즉시 반영된다.
  const restockSum = restockMode
    ? chkLocations
        .filter(l => !l.isHub)
        .reduce((s, l) => s + calcLocMove(beforeQtys[l.id] ?? '', afterQtys[l.id] ?? '', prevMap[l.id] ?? null).restocked, 0)
    : 0

  // 허브의 "보충 후" 자동 계산값 — 사용자가 직접 보정 안 했으면 사용
  const hubAutoAfter = Math.max(0, hubPrev - restockSum)

  // 저장용 위치별 데이터 계산.
  // entered = 사용자가 실제로 값을 입력한 행 — 0 을 명시 입력해도 저장되게 구분.
  // (이전엔 qty>0 필터만 있어 명시적 0 이 걸러지고 carryOver 가 이전 잔량으로 되살렸음)
  const buildLocationData = (): { storageLocationId: string; qty: number; restockedQty?: number; entered: boolean }[] => {
    if (!hasLocations) return []
    if (restockMode) {
      return chkLocations.map(l => {
        if (l.isHub) {
          const userVal = afterQtys[l.id]
          const finalQty = (hubTouched && userVal !== undefined && userVal !== '') ? Number(userVal) : hubAutoAfter
          // 허브는 자동 차감(restockSum>0)이 일어났으면 0 이어도 반드시 저장 — 안 하면 carryOver 가 차감 전 값으로 복원
          return { storageLocationId: l.id, qty: finalQty, entered: (hubTouched && userVal !== undefined && userVal !== '') || restockSum > 0 }
        }
        const beforeStr = beforeQtys[l.id] ?? ''
        const afterStr  = afterQtys[l.id] ?? ''
        // 전·후 모두 입력 → 옮김량 = max(0, 후-전) / 전만 입력 → 옮김 없이 잔량 = 전
        // 후만 입력 → 직전 잔량 기준으로 옮김량 산출 / 모두 비움 → entered=false(저장 제외, carryOver 보존)
        const { beforeN, afterN, restocked } = calcLocMove(beforeStr, afterStr, prevMap[l.id] ?? null)
        const finalQty = afterN ?? beforeN ?? 0
        return { storageLocationId: l.id, qty: finalQty, restockedQty: restocked > 0 ? restocked : undefined, entered: beforeStr !== '' || afterStr !== '' }
      })
    }
    // 단순 모드 — 첫 점검
    return chkLocations.map(l => ({
      storageLocationId: l.id,
      qty: Number(locationQtys[l.id]) || 0,
      entered: String(locationQtys[l.id] ?? '').trim() !== '',
    }))
  }

  // 미입력 위치는 저장 시 carryOver 로 직전 값이 보존되므로, 화면 합계도 직전 잔량으로 세어야
  // '점검 후 잔량'이 저장 결과와 일치한다(예: 안 건드린 5층 상단 1kg 이 0 으로 빠지면 합계가 준다).
  const computed = restockMode
    ? buildLocationData().reduce((s, lq) => s + (lq.entered ? lq.qty : (prevMap[lq.storageLocationId] ?? 0)), 0)
    : (hasLocations
        ? chkLocations.reduce((s, l) => s + (Number(locationQtys[l.id]) || 0), 0)
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
    // 위치 일부만 입력해도 나머지 위치는 직전 점검에서 자동 보존(2026-06-01 사용량 왜곡 버그 fix).
    // restockHubLocationId — 클라가 실제 차감한 허브를 서버 검출과 일치시켜 오탐/미탐 방지.
    const saveArgs = {
      trackedItemId: item.id, date, remainingQty: total, memo: memo || undefined,
      locationQtys: locationData, carryOverFromLastCheck: true, isReconcile: reconcileMode,
      restockHubLocationId: hubLoc?.id,
    }
    startTransition(async () => {
      try {
        const res = await createStockCheck(saveArgs)
        if (!res.ok) {
          if ('code' in res && res.code === 'HUB_SHORT') {
            // 허브 부족 — 이동 유도 팝업으로 넘긴다. 재저장 시 이동 출처 위치는 locationQtys 에서 제거(유령 재고 방지).
            setHubShort({
              trackedItemId: item.id, itemLabel: '', unit: stockUnit, info: res,
              retry: (o) => {
                const exclude = new Set(o.excludeLocationIds ?? [])
                const locationQtys = saveArgs.locationQtys.filter(lq => !exclude.has(lq.storageLocationId))
                return createStockCheck({ ...saveArgs, locationQtys, allowHubClamp: o.allowHubClamp })
              },
            })
            return
          }
          setError(res.error); return
        }
        await deleteItemDrafts(item.id)
        onDraftChange?.()
        // 점검 저장에 적용취소가 없었다 — 삭제·입수·폐기·수령에는 다 있는데 **제일 자주 쓰는 저장**에만
        // 없었다(C페이즈 조사 2026-08-03). 잘못 센 값이 기준선으로 박히면 되돌릴 방법이 없었다.
        pushToast('success', '재고 점검 저장됨', {
          action: { label: '적용취소', run: () => { void deleteStockCheck(res.id).then(r => {
            if (r.ok) { onDraftChange?.(); onDone() } else pushToast('error', r.error)
          }) } },
        })
        onDone()
      } finally { submittingRef.current = false }
    })
  }

  const inputCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">
        {restockMode
          ? '각 위치의 채우기 전·후 수량을 입력하면, 늘어난 만큼 창고(허브)에서 옮겨진 것으로 자동 차감됩니다. (새 입수 기록이 아니라 창고→위치 이동)'
          : `점검한 시점에 남아있는 양을 ${stockUnit ?? '단위'} 기준으로 기록합니다. 직전 점검과의 차이로 소모량이 계산됩니다.`}
      </p>
      {/* 폐기 바로가기 — 점검을 먼저 저장하면 폐기분이 소모로 잡히므로 순서를 안내(오류신고 a1e048e8) */}
      {onGoDisposal && !restockMode && (
        <div className="flex items-center justify-between gap-2 rounded-lg px-3 py-2" style={{ background: 'var(--warning-bg)', border: '1px solid var(--warning-ring)' }}>
          <p className="text-[0.65625rem]" style={{ color: 'var(--warning-fg)' }}>버리거나 상해서 줄어든 양이 있나요? 점검 저장 전에 폐기를 먼저 기록해야 소모량이 정확합니다.</p>
          <button type="button" onClick={onGoDisposal}
            className="shrink-0 text-[0.65625rem] font-semibold px-2 py-1 rounded-md border transition-colors"
            style={{ borderColor: 'var(--warning-ring)', color: 'var(--warning-fg)' }}>폐기 기록</button>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">점검일 *</label>
        <DatePicker value={date} onChange={setDate}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
      </div>

      {hasLocations && restockMode ? (
        <div className="space-y-2.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">위치별 잔량{stockUnit ? ` (${stockUnit})` : ''}</label>
          {chkLocations.map(loc => {
            const prevQty = prevMap[loc.id]
            if (loc.isHub) {
              // 허브 행 — 후 자동 prefill
              const userVal = afterQtys[loc.id]
              const displayAfter = hubTouched && userVal !== undefined ? userVal : String(hubAutoAfter)
              return (
                <div key={loc.id} className="space-y-1 bg-[var(--honey)]/5 border border-[var(--honey)]/30 rounded-xl px-3 py-2">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-xs font-medium text-[var(--warm-dark)] truncate">{loc.name} <span className="text-[var(--warm-muted)]">(허브)</span></span>
                    {prevQty !== undefined && <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">이전 {prevQty}{stockUnit ?? ''}</span>}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--warm-muted)] shrink-0">자동 차감 후</span>
                    <input type="text" inputMode="decimal" autoComplete="off"
                      value={displayAfter}
                      onChange={e => { setAfterQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') })); setHubTouched(true) }}
                      className={`w-20 ${inputCls}`} />
                    <span className="text-[var(--warm-muted)] shrink-0">{stockUnit ?? ''}</span>
                    {restockSum > 0 && (
                      <span className="ml-auto text-[0.65625rem] text-[var(--persimmon-d)] shrink-0">-{Math.round(restockSum * 100) / 100}{stockUnit ?? ''} 차감</span>
                    )}
                  </div>
                </div>
              )
            }
            // 비허브 위치 행 — 전 → 후 (grid 2cols, 라벨은 input 위). 배지도 calcLocMove 단일 규칙.
            const beforeStr = beforeQtys[loc.id] ?? ''
            const afterStr  = afterQtys[loc.id] ?? ''
            const { restocked } = calcLocMove(beforeStr, afterStr, prevMap[loc.id] ?? null)
            const lastRestocked = prevRestockedMap[loc.id]
            return (
              <div key={loc.id} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-xs font-medium text-[var(--warm-mid)] truncate">{loc.name}</span>
                </div>
                {/* 참고줄 — 입력 중에도 직전 잔량·지난 보충량이 계속 보이게 */}
                {(prevQty !== undefined || lastRestocked != null || restocked > 0) && (
                  <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[0.65625rem] bg-[var(--canvas)] rounded-md px-2 py-1">
                    {prevQty !== undefined && <span className="text-[var(--warm-mid)]">직전 잔량 <strong className="text-[var(--warm-dark)] tabular-nums">{prevQty}{stockUnit ?? ''}</strong></span>}
                    {lastRestocked != null && lastRestocked > 0 && <span className="text-[var(--warm-muted)]">· 지난 옮김 <strong className="text-[var(--coral)] tabular-nums">+{Math.round(lastRestocked * 100) / 100}{stockUnit ?? ''}</strong></span>}
                    {restocked > 0 && <span className="text-[var(--coral)] ml-auto">창고에서 <strong className="tabular-nums">+{Math.round(restocked * 100) / 100}{stockUnit ?? ''}</strong></span>}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-1.5">
                  <div>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">현재 잔량 (채우기 전)</p>
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                      value={beforeStr}
                      onChange={e => setBeforeQtys(prev => ({ ...prev, [loc.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                      className={`w-full min-w-0 ${inputCls}`} />
                  </div>
                  <div>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">채운 후 <span className="text-[var(--warm-muted)]/70">(창고에서 옮긴 경우)</span></p>
                    <input type="text" inputMode="decimal" autoComplete="off" placeholder="—"
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
                    className="text-[0.65625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                    옮김 없음
                  </button>
                </div>
              </div>
            )
          })}
          <div className="flex justify-between text-[0.65625rem] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
            <span className="text-[var(--warm-mid)]">창고 → 이동 합계 <strong className="text-[var(--coral)]">+{Math.round(restockSum * 100) / 100}{stockUnit ?? ''}</strong></span>
            <span className="text-[var(--warm-mid)]">점검 후 잔량 <strong className="text-[var(--coral)]">{Math.round(computed * 100) / 100}{stockUnit ?? ''}</strong></span>
          </div>
        </div>
      ) : hasLocations ? (
        // 단순 모드 — 첫 점검 (이전 데이터 없음)
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium text-[var(--warm-mid)]">위치별 잔량{stockUnit ? ` (${stockUnit})` : ''}</label>
            {hasPrev && touched.size < chkLocations.length && (
              <button type="button" onClick={confirmAll}
                className="text-[0.65625rem] text-[var(--coral)] hover:underline">
                모두 이전 수량으로 확인
              </button>
            )}
          </div>
          {chkLocations.map(loc => {
            const isTouched = touched.has(loc.id)
            const isPrefilled = !isTouched && prevMap[loc.id] != null
            return (
              <div key={loc.id} className="flex items-center gap-2">
                <span className="text-xs text-[var(--warm-mid)] w-24 shrink-0 truncate">{loc.name}</span>
                <div className="flex-1 relative">
                  <input
                    type="text" inputMode="decimal" autoComplete="off"
                    value={locationQtys[loc.id] ?? ''}
                    onChange={e => handleLocChange(loc.id, e.target.value)}
                    placeholder="0"
                    className={`w-full bg-[var(--canvas)] border rounded-sm px-3 py-2 text-sm outline-none focus:border-[var(--coral)] transition-colors ${
                      isPrefilled
                        ? 'border-[var(--warm-border)]/50 text-[var(--ink-mute)]'
                        : 'border-[var(--warm-border)] text-[var(--warm-dark)]'
                    }`} />
                  {isPrefilled && (
                    <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[0.65625rem] text-[var(--ink-mute)] bg-[var(--canvas)] pl-1">이전</span>
                  )}
                </div>
              </div>
            )
          })}
          <p className="text-[0.65625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
            → 합계 <strong>{Math.round(computed * 100) / 100}{stockUnit ?? ''}</strong>
          </p>
        </div>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">잔량 *{stockUnit ? ` (${stockUnit})` : ''}</label>
          <input type="text" inputMode="decimal" autoComplete="off" value={qty} onChange={e => setQty(e.target.value.replace(/[^0-9.]/g, ''))}
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
        <span className="text-[0.65625rem] text-[var(--warm-mid)] leading-snug">
          <strong className="text-[var(--warm-dark)]">전체 보정으로 기록</strong>. 실제 수량과 차이를 사용량으로 잡지 않습니다.<br />
          계산 오차·분실 등으로 어긋난 재고를 실측값으로 다시 맞출 때 사용. (채움 완료 후 점검 권장)<br />
          체크하지 않으면 차이가 직전 점검 이후 기간의 소비로 계산됩니다.
        </span>
      </label>
      {(draftPending || draftSavedAt) && (() => {
        // §12 임시저장 칩 정본 — 저장 중(카멜) / 임시저장됨 시각(성공 점) / 저장 후 수정됨(뮤트)
        const curSnap = JSON.stringify({ date, qty, memo, locationQtys, beforeQtys, afterQtys, hubTouched })
        const dirtySinceSave = !draftPending && draftSavedAt != null && draftSavedSnapRef.current != null && draftSavedSnapRef.current !== curSnap
        const restoredOnly = draftSavedAt != null && draftSavedSnapRef.current == null
        if (restoredOnly && draftSavedAt) draftSavedSnapRef.current = curSnap   // 폼 열며 복원된 드래프트를 기준 스냅샷으로
        const dotColor = draftPending ? 'var(--camel)' : dirtySinceSave ? 'var(--warm-muted)' : 'var(--success)'
        const textColor = draftPending ? 'var(--camel)' : dirtySinceSave ? 'var(--warm-muted)' : 'var(--success-fg)'
        const label = draftPending ? '저장 중…'
          : dirtySinceSave ? `임시저장 후 수정됨 (저장본 ${fmtTime(new Date(draftSavedAt!))})`
          : `임시저장됨 ${fmtTime(new Date(draftSavedAt!))}`
        return (
          <div className="flex items-center justify-between gap-2 text-[0.65625rem] rounded-lg px-2.5 py-1.5" style={{ background: 'var(--cream-2)' }}>
            <span className="flex items-center gap-1.5 min-w-0">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
              <span className="truncate" style={{ color: textColor }}>{label}</span>
            </span>
            {!draftPending && draftSavedAt && (
              <button type="button" onClick={handleClearDraft}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] underline shrink-0">비우기</button>
            )}
          </div>
        )
      })()}
      {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
      <div className="pt-2 flex gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel}>취소</Btn>
        <Btn type="button" variant="secondary" onClick={handleSaveDraft} disabled={draftPending || pending} fullWidth>
          {draftPending ? '저장 중…' : '임시저장'}
        </Btn>
        <Btn type="submit" variant="primary" disabled={pending} fullWidth>
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
      {hubShort && (
        <HubShortDialog key={hubShort.trackedItemId} pending={hubShort}
          onResolved={() => { setHubShort(null); void deleteItemDrafts(item.id).then(() => { onDraftChange?.(); onDone() }) }}
          onExit={(reason) => { setHubShort(null); if (reason === 'reconcile') pushToast('info', '창고(허브)의 실제 재고를 세어 창고 위치부터 맞춰 주세요.') }} />
      )}
    </form>
  )
}

// ── 위치별 일괄 점검 — 모달(inline=false) / 인라인 패널(inline=true) 양용
// 위치 간 재고 이동·맞바꿈 (운영자 요청 2026-07-08) — "무엇을 → 어디서 → 어디로 → 얼마나" 한 화면.
// 총량 불변 점검으로 기록되어 소모 통계에 영향 없음. 점검 폼의 허브 자동 차감 UX 는 그대로.
function TransferStockModal({ rows, onClose, onDone, initialItemId }: {
  rows: InventoryRow[]
  onClose: () => void
  onDone: () => void
  initialItemId?: string   // 품목 상세에서 진입 시 그 품목 프리셀렉트(신고 0d911b19)
}) {
  const [itemId, setItemId] = useState('')
  useEffect(() => { if (initialItemId) void pickItem(initialItemId) }, [])   // eslint-disable-line react-hooks/exhaustive-deps
  const [locStock, setLocStock] = useState<ItemLocationStock[] | null>(null)
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [qtyStr, setQtyStr] = useState('')
  const [swapMode, setSwapMode] = useState(false)
  const [busy, setBusy] = useState(false)

  const item = rows.find(r => r.id === itemId) ?? null
  const unit = item ? (item.trackUnit === 'qty' ? (item.qtyUnit ?? item.unitHint ?? '개') : (item.specUnit ?? item.qtyUnit ?? item.unitHint ?? '개')) : '개'
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
      on ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]'
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
      {
        const checkId = res.checkId
        pushToast('success', swapMode
          ? `${fromLoc!.name} ↔ ${toLoc!.name} 맞바꿈 완료`
          : `${fromLoc!.name} → ${toLoc!.name} ${moveQty}${unit} 이동 완료`, {
          // 이동은 '총량 불변 점검'으로 기록되므로, 그 점검을 지우면 직전 배치로 복원(v2.0 §16)
          action: { label: '적용취소', run: () => { void deleteStockCheck(checkId).then(r => { if (r.ok) pushToast('info', '이동을 적용취소했습니다 (이전 배치로 복원)'); else pushToast('error', r.error) }) } },
        })
      }
      onDone()
    } finally { release(); setBusy(false) }
  }

  return (
    <Modal open onClose={onClose} title="위치 이동" width="sm"
      subtitle="위치에서 위치로 옮기거나 두 위치를 통째로 맞바꿉니다. 총 재고는 변하지 않아요.">
      <div className="space-y-4">
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
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">재고가 있는 위치가 없습니다.</p>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">3. 어디로 옮길까요?</label>
              <div className="flex flex-wrap gap-1.5">
                {/* 숨긴 위치는 목적지에서 제외 — 숨긴 곳으로 재고를 넣게 두면 안 된다(2단계). 출발지는 재고 있으면 보여야 함(무필터). */}
                {locStock.filter(l => l.id !== fromId && !l.closed).map(l => (
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
                  <input value={qtyStr} inputMode="decimal" autoComplete="off"
                    onChange={e => setQtyStr(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={fmtQty(fromLoc.qty, null)}
                    className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                  <span className="text-xs text-[var(--warm-muted)]">{unit}</span>
                  <Btn type="button" variant="secondary" size="sm" onClick={() => setQtyStr(String(fromLoc.qty))}>전부</Btn>
                </div>
                {moveQty > (fromLoc.qty ?? 0) && (
                  <p className="text-[0.65625rem] text-[var(--danger-fg)]">{fromLoc.name}에 있는 {fmtQty(fromLoc.qty, unit)}보다 많이 옮길 수 없어요.</p>
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

// 허브(창고) 부족 유도 팝업 — 보충량이 창고 잔량을 넘을 때 (1)다른 위치에서 창고로 이동 (2)창고 실측 (3)그냥 저장 중 고르게 한다.
// 부모 점검 모달 트리 안에 중첩(고정 오버레이 z-confirm). 이동/재저장/적용취소를 스스로 오케스트레이션한다.
function HubShortDialog({ pending, onResolved, onExit }: {
  pending: HubShortPending
  onResolved: () => void                          // 이 품목 저장 완료 — 다음(큐)로
  onExit: (reason: 'back' | 'reconcile') => void  // 보충으로 돌아가기 / 창고 재고 확인 (무저장)
}) {
  const { info, unit, trackedItemId, itemLabel } = pending
  const hubId = info.hubLocationId
  const [hubQty, setHubQty] = useState(info.hubQty)
  const [shortfall, setShortfall] = useState(info.shortfall)
  const [othersInfo, setOthersInfo] = useState(info.others)  // 서버가 준 유효 출처(허브·보충대상 제외). 부분이동 후 갱신.
  const [locs, setLocs] = useState<ItemLocationStock[] | null>(null)
  const [fromId, setFromId] = useState('')
  const [busy, setBusy] = useState(false)
  const actingRef = useRef(false)                 // 연타 이중 이동 차단(transfer 는 멱등 가드 없음)
  const transferChecksRef = useRef<string[]>([])  // 부분 이동 누적 checkId(적용취소 LIFO 용)
  const movedFromIdsRef = useRef<string[]>([])    // 이동 출처 위치 id — 재저장 시 locationQtys 에서 제거(유령 재고 방지)

  const loadLocs = async () => { const r = await getItemLocationStock(trackedItemId); if (r.ok) setLocs(r.locations) }
  useEffect(() => { void loadLocs() }, [])  // eslint-disable-line react-hooks/exhaustive-deps

  // 출처 후보 — 서버가 허브·보충대상을 뺀 목록(othersInfo)에 있는 것만, 숨김·잔량0 제외, 라이브 수량으로.
  const allowedIds = new Set(othersInfo.map(o => o.locationId))
  const donors = (locs ?? []).filter(l => l.id !== hubId && l.qty > 0 && !l.closed && allowedIds.has(l.id))
  const fromLoc = donors.find(l => l.id === fromId) ?? null
  const moveQty = fromLoc ? Math.min(shortfall, fromLoc.qty) : 0

  const undoTransfersOnly = async () => {
    for (const id of [...transferChecksRef.current].reverse()) { await deleteStockCheck(id) }
    transferChecksRef.current = []; movedFromIdsRef.current = []
  }

  const onMoveFill = async () => {
    if (actingRef.current || !fromLoc || moveQty <= 0) return
    actingRef.current = true; setBusy(true)
    try {
      const tr = await transferLocationStock({ trackedItemId, fromLocationId: fromLoc.id, toLocationId: hubId, qty: moveQty })
      if (!tr.ok) { pushToast('error', tr.error); return }
      transferChecksRef.current.push(tr.checkId)
      if (!movedFromIdsRef.current.includes(fromLoc.id)) movedFromIdsRef.current.push(fromLoc.id)
      // 이동 출처를 재전송 locationQtys 에서 제거 — 서버 carryOver 가 이동 후 baseline 으로 이월(유령 재고 방지).
      const res = await pending.retry({ excludeLocationIds: movedFromIdsRef.current })
      if ('code' in res && res.code === 'HUB_SHORT') {
        // 아직 부족 — 표시·유효 출처·목록 갱신 후 다이얼로그 유지
        setHubQty(res.hubQty); setShortfall(res.shortfall); setOthersInfo(res.others); setFromId('')
        await loadLocs()
        pushToast('info', `아직 ${fmtQty(res.shortfall, unit)} 부족합니다`)
        return
      }
      if (!res.ok) {
        // 이동은 됐는데 보충 저장 실패 — 이동만 즉시 적용취소 노출
        pushToast('error', res.error ?? '저장 중 오류가 발생했습니다', {
          action: { label: '이동 적용취소', run: () => { void undoTransfersOnly() } },
        })
        return
      }
      // 성공 — 이동 + 보충 통합 적용취소(LIFO: 보충 먼저, 이동 나중)
      const restockId = res.id
      const moves = [...transferChecksRef.current]
      pushToast('success', '옮기고 채움 완료', {
        action: {
          label: '적용취소', run: () => { void (async () => {
            for (const id of [restockId, ...[...moves].reverse()]) {
              const d = await deleteStockCheck(id)
              if (!d.ok) { pushToast('error', d.error); return }
            }
            pushToast('info', '옮기고 채움을 적용취소했습니다')
          })() },
        },
      })
      onResolved()
    } finally { actingRef.current = false; setBusy(false) }
  }

  const onClampSave = async () => {
    if (actingRef.current) return
    actingRef.current = true; setBusy(true)
    try {
      // 부분이동 후 강행 저장에서도 이동 출처는 제외해야 유령 재고가 안 생긴다(onMoveFill 과 대칭 — 재검증 지적).
      const res = await pending.retry({ allowHubClamp: true, excludeLocationIds: movedFromIdsRef.current })
      if (!res.ok) { pushToast('error', res.error ?? '저장 중 오류가 발생했습니다'); return }
      const restockId = res.id
      pushToast('success', '부족한 채로 저장했습니다', {
        action: { label: '적용취소', run: () => { void deleteStockCheck(restockId).then(d => { if (d.ok) pushToast('info', '저장을 적용취소했습니다'); else pushToast('error', d.error) }) } },
      })
      onResolved()
    } finally { actingRef.current = false; setBusy(false) }
  }

  // 나가기(무저장) — 부분 이동이 이미 커밋돼 있으면(보충 미완) 그 이동을 적용취소할 토스트를 노출한다.
  // 총량은 보존되지만 사용자가 인지 못한 채 이동만 남는 것을 막는다(사용자 원칙: 모든 적용엔 취소).
  const handleExit = (reason: 'back' | 'reconcile') => {
    if (busy) return
    const moves = [...transferChecksRef.current]
    if (moves.length > 0) {
      pushToast('info', '옮긴 재고는 창고에 남아 있습니다', {
        action: { label: '이동 적용취소', run: () => { void (async () => {
          for (const id of [...moves].reverse()) { const d = await deleteStockCheck(id); if (!d.ok) { pushToast('error', d.error); return } }
          pushToast('info', '위치 이동을 적용취소했습니다')
        })() } },
      })
    }
    onExit(reason)
  }

  const chip = (on: boolean) =>
    `min-h-[40px] px-3 rounded-lg border text-sm font-medium transition-colors ${
      on ? 'bg-[var(--persimmon)] border-[var(--persimmon)] text-[var(--on-solid)]'
         : 'bg-[var(--canvas)] border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--persimmon)]'}`

  return (
    // 하단 패딩에 키보드 겹침을 더한다(신고 e8a2c73e, 정본은 Modal). 모바일은 하단 시트라 시트를
    // 키보드 위로 밀고, sm 이상은 중앙 정렬의 기준을 보이는 띠로 옮긴다. 인라인 style 로 넣으면
    // sm:p-4 의 1rem 을 덮어써 데스크탑이 달라지므로 분기별 유틸리티로 쓴다.
    <div className="fixed inset-0 z-[var(--z-confirm)] bg-black/70 flex items-end sm:items-center justify-center p-0 sm:p-4 pb-[var(--kbd-inset,0px)] sm:pb-[calc(1rem+var(--kbd-inset,0px))]"
      onClick={() => handleExit('back')}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-t-2xl sm:rounded-2xl w-full max-w-md flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[var(--warm-border)] shrink-0 flex items-start gap-2.5">
          <svg className="shrink-0 mt-0.5" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--warning-fg)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>
          </svg>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[var(--warm-dark)]">창고(허브) 재고가 옮김량보다 {fmtQty(shortfall, unit)} 부족합니다</h2>
            {itemLabel && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{itemLabel}</p>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 space-y-3">
          <p className="text-xs text-[var(--warm-mid)]">
            창고(허브) 현재 {fmtQty(hubQty, unit)} · 이번 옮김 {fmtQty(hubQty + shortfall, unit)}
          </p>
          <p className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
            창고 장부가 실물과 다를 수 있어요. 실제 재고가 더 많다면 먼저 확인해 맞춰주세요.
          </p>

          <div className="space-y-1.5">
            <p className="text-[0.65625rem] font-medium text-[var(--warm-mid)]">재고가 있는 다른 위치</p>
            {locs == null ? (
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">불러오는 중…</p>
            ) : donors.length === 0 ? (
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">옮겨올 재고가 있는 위치가 없습니다.</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {donors.map(l => (
                  <button key={l.id} type="button" className={chip(fromId === l.id)} onClick={() => setFromId(l.id)} disabled={busy}>
                    {l.name} · {fmtQty(l.qty, unit)}
                  </button>
                ))}
              </div>
            )}
            {fromLoc && moveQty > 0 && (
              <p className="text-[0.65625rem] text-[var(--warm-mid)]">
                {fromLoc.name}에서 창고로 {fmtQty(moveQty, unit)}를 옮기고 채움을 마칩니다
              </p>
            )}
          </div>
        </div>

        <div className="px-5 py-4 border-t border-[var(--warm-border)] shrink-0 space-y-2">
          <div className="flex gap-2">
            <Btn type="button" variant="ghost" size="md" className="flex-1" autoFocus onClick={() => handleExit('back')} disabled={busy}>입력으로 돌아가기</Btn>
            <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => handleExit('reconcile')} disabled={busy}>창고 재고 확인</Btn>
          </div>
          <Btn type="button" variant="primary" size="md" fullWidth onClick={() => void onMoveFill()} disabled={busy || !fromLoc || moveQty <= 0}>
            {busy ? '처리 중…' : '옮겨서 채우기'}
          </Btn>
          <div className="flex justify-center">
            <button type="button" onClick={() => void onClampSave()} disabled={busy}
              className="text-[0.6875rem] text-[var(--warm-muted)] underline underline-offset-2 hover:text-[var(--warm-mid)] disabled:opacity-50 py-1">
              부족한 채로 저장
            </button>
          </div>
        </div>
      </div>
    </div>
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
  const [locDraftSavedAt, setLocDraftSavedAt] = useState<number | null>(null)   // 임시저장 상태 칩(§12)
  const locDraftSnapRef = useRef<string | null>(null)
  const [error, setError] = useState('')
  const [mergeChoice, setMergeChoice] = useState<'merge' | 'new' | null>(null)
  const [confirmItems, setConfirmItems] = useState<InventoryRow[]>([])
  // 위치 선택 전 임시저장 안내 — 어느 위치에 임시저장이 있는지 표시(오류신고 93f5d103)
  const [draftLocs, setDraftLocs] = useState<{ locationId: string; itemCount: number; latestSavedAt: number | null }[]>([])
  // 더블클릭/중복 제출 동기 차단 — setPending 은 리렌더 후에야 버튼을 disabled 하므로,
  // 그 사이 두 번째 클릭이 doSave 에 재진입해 보충(허브 차감)이 2번 적용되던 심각한 버그 방지.
  const savingRef = useRef(false)
  // 허브 부족 감지 시 처리 대기 품목 큐(품목별). 큐가 비면 저장을 최종 마감한다.
  const [hubShortQueue, setHubShortQueue] = useState<HubShortPending[]>([])

  useEffect(() => { getStorageLocations().then(setLocs) }, [])
  // 위치 미선택 상태로 돌아올 때마다 갱신 — 임시저장 직후 재진입도 최신으로
  useEffect(() => { if (!locId) getDraftLocationSummary().then(setDraftLocs).catch(() => {}) }, [locId])

  const selectedLoc = locs.find(l => l.id === locId) ?? null

  const locItems = locId
    ? rows.filter(r => !r.isArchived && r.locations.some(l => l.id === locId) && !r.hiddenLocationIds.includes(locId))
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
    // calcLocMove 단일 규칙 — 채운 후만 입력하면 직전 잔량 기준으로 옮김량 산출(허브 미차감 방지)
    const { beforeN, afterN, restocked } = calcLocMove(beforeStr, afterStr, r.currentLocationBreakdown.find(lb => lb.locationId === locId)?.qty ?? null)
    // 최종 잔량 = 채운 후(입력 시) 아니면 현재 잔량. 현재 잔량만 입력해도 점검으로 저장된다.
    const finalN = afterN ?? beforeN
    return { beforeStr, afterStr, beforeN, afterN, finalN, restocked }
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

    // 한 품목의 이 위치 점검을 서버에 저장하는 클로저 — 허브 부족 재시도(이동 후/강행)에서도 재사용.
    // forceNew: 팝업 경유 재저장은 항상 새 점검으로 만든다(이동 점검과 함께 적용취소 LIFO 가 깔끔해짐).
    const saveItem = (r: InventoryRow, opts?: { allowHubClamp?: boolean; forceNew?: boolean }) => {
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
      // 6h 이내 같은 날 기존 점검 존재 → 자동 머지. 과거 날짜 백필은 머지 안 함(고른 날짜 무시 방지).
      const dateIsToday = date === kstYmdStr()
      const sameDay = r.lastCheckId && r.lastCheckCreatedAt && isSameKstDay(new Date(r.lastCheckCreatedAt), new Date())
      const within6h = r.lastCheckCreatedAt && (now - new Date(r.lastCheckCreatedAt).getTime()) < 6 * 3600_000
      const shouldMerge = !opts?.forceNew && dateIsToday && (forceMerge || (sameDay && within6h))
      if (shouldMerge && r.lastCheckId) {
        return updateStockCheck(r.lastCheckId, { locationPatch, allowHubClamp: opts?.allowHubClamp })
      }
      return createStockCheck({
        trackedItemId: r.id, date, remainingQty: 0, locationPatch,
        memo: `위치별 점검 (${locName})`, allowHubClamp: opts?.allowHubClamp,
      })
    }

    try {
      const results = await Promise.all(toSave.map(async r => ({ r, res: await saveItem(r) })))
      const savedOk: InventoryRow[] = []
      const shorts: HubShortPending[] = []
      for (const { r, res } of results) {
        if (res.ok) { savedOk.push(r); continue }
        if ('code' in res && res.code === 'HUB_SHORT') {
          shorts.push({
            trackedItemId: r.id, itemLabel: r.label, unit: rowUnit(r), info: res,
            // forceNew 라 항상 createStockCheck 경로(새 점검, id 반환) — 적용취소가 깔끔.
            retry: async (o) => {
              const rr = await saveItem(r, { forceNew: true, allowHubClamp: o.allowHubClamp })
              return rr as { ok: true; id: string } | { ok: false; error: string } | HubShortResponse
            },
          })
        } else {
          setError(res.error ?? '저장 중 오류가 발생했습니다.')
        }
      }
      // 정상 저장된 품목의 이 위치 드래프트만 정리(부족 품목은 처리 후 정리)
      await Promise.all(savedOk.map(r => deleteStockCheckDraft(r.id, locId)))
      if (shorts.length > 0) { setHubShortQueue(shorts); return }  // 팝업이 이어받음(모달 유지)
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

  // 팝업이 한 품목을 처리(저장)했을 때 — 드래프트 정리 후 큐를 한 칸 당기고, 비면 최종 마감.
  const onHubShortResolved = async () => {
    const cur = hubShortQueue[0]
    if (cur) await deleteStockCheckDraft(cur.trackedItemId, locId)
    const rest = hubShortQueue.slice(1)
    setHubShortQueue(rest)
    if (rest.length === 0) { onDraftChange?.(); onDone(); onClose() }
  }
  // 보충으로 돌아가기 / 창고 재고 확인 — 남은 큐 전체 중단(무저장), 폼으로 복귀(모달 유지).
  const onHubShortExit = (reason: 'back' | 'reconcile') => {
    setHubShortQueue([])
    onDone()   // 이미 저장된 정상 품목 반영
    if (reason === 'reconcile') pushToast('info', '창고(허브)의 실제 재고를 세어 창고 위치부터 맞춰 주세요.')
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
      setLocDraftSavedAt(Date.now())
      locDraftSnapRef.current = JSON.stringify({ locId, date, rows: locItems.map(r => computeRow(r)) })
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
      // 하단 패딩에 키보드 겹침을 더한다(신고 e8a2c73e, 정본은 Modal). 인라인 모드는 오버레이가
      // 없으므로 붙이지 않는다. 그쪽 여유는 .app-main 의 --kbd-inset 패딩이 이미 맡는다.
      style={inline ? undefined : { paddingBottom: 'var(--kbd-inset, 0px)' }}
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
              채우기 전·후를 입력하면 늘어난 만큼 그 품목의 창고(허브)에서 자동 차감됩니다. (이 위치가 허브인 품목은 현재 잔량만 입력)
            </p>
          </div>
          {!inline && (
            <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl w-11 h-11 flex items-center justify-center"><svg className="inline-block align-middle" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          )}
        </div>

        <div className="px-5 py-3 border-b border-[var(--warm-border)] shrink-0 space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">점검 위치</p>
              <select value={locId} onChange={e => setLocId(e.target.value)} className={selectCls}>
                <option value="">위치 선택…</option>
                {locs.map(l => <option key={l.id} value={l.id}>{l.name}{l.isHub ? ' (허브)' : ''}</option>)}
              </select>
            </div>
            <div>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-1">점검일</p>
              <DatePicker value={date} onChange={setDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
          </div>
          {/* 위치 간 이동 — 점검(허브 자동 차감)과 별개의 명시적 이동·맞바꿈 */}
          <div className="flex justify-end">
            <Btn type="button" variant="secondary" size="sm" onClick={() => setTransferOpen(true)}>위치 이동</Btn>
          </div>
        </div>
        {transferOpen && (
          <TransferStockModal rows={rows} onClose={() => setTransferOpen(false)}
            onDone={() => { setTransferOpen(false); onDone() }} />
        )}
        {hubShortQueue.length > 0 && (
          <HubShortDialog key={hubShortQueue[0].trackedItemId} pending={hubShortQueue[0]}
            onResolved={() => { void onHubShortResolved() }} onExit={onHubShortExit} />
        )}

        <div className={inline ? 'px-5 py-3 space-y-3' : 'flex-1 overflow-y-auto overscroll-contain px-5 py-3 space-y-3'}>
          {!locId ? (
            <>
              {draftLocs.length > 0 && (
                // 임시저장 위치 안내 — §12 칩 문법(성공 점 + 시각), 누르면 그 위치로 이동해 이어서 입력
                <div className="space-y-1.5">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">임시저장된 점검이 있습니다. 선택하면 이어서 입력합니다.</p>
                  {draftLocs.map(d => {
                    const loc = locs.find(l => l.id === d.locationId)
                    if (!loc) return null
                    return (
                      <button key={d.locationId} type="button" onClick={() => setLocId(d.locationId)}
                        className="w-full flex items-center justify-between gap-2 text-[0.65625rem] rounded-lg px-2.5 py-2 border border-[var(--warm-border)] hover:border-[var(--coral)] transition-colors"
                        style={{ background: 'var(--cream-2)' }}>
                        <span className="flex items-center gap-1.5 min-w-0">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--success)' }} />
                          <span className="truncate text-xs font-medium text-[var(--warm-dark)]">{loc.name}</span>
                          <span className="text-[var(--warm-muted)] shrink-0">{d.itemCount}품목</span>
                        </span>
                        <span className="shrink-0" style={{ color: 'var(--success-fg)' }}>
                          {d.latestSavedAt ? `임시저장 ${fmtTime(new Date(d.latestSavedAt))}` : '임시저장됨'}
                        </span>
                      </button>
                    )
                  })}
                </div>
              )}
              <p className="text-xs text-[var(--warm-muted)] text-center py-6">위치를 선택하면 해당 위치에 보관된 품목이 표시됩니다.</p>
            </>
          ) : locItems.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">이 위치에 배정된 품목이 없습니다.</p>
          ) : (
            <>
              {/* 이 위치 품목들의 마지막 점검 기록 시각 중 최댓값 */}
              {(() => {
                const times = locItems
                  .map(r => r.lastCheckCreatedAt ? new Date(r.lastCheckCreatedAt).getTime() : null)
                  .filter((t): t is number => t != null)
                if (times.length === 0) return null
                const latest = new Date(Math.max(...times))
                return <p className="text-[0.65625rem] text-[var(--warm-muted)] pb-1">이 위치 최근 점검 {fmtDate(latest)} <span className="tabular-nums">{fmtTime(latest)}</span></p>
              })()}
              {locItems.map(r => {
              const stockUnit = r.trackUnit === 'qty' ? (r.qtyUnit ?? r.unitHint) : (r.specUnit ?? r.qtyUnit ?? r.unitHint)
              const prev = r.currentLocationBreakdown.find(lb => lb.locationId === locId)
              const { beforeStr, afterStr, restocked } = computeRow(r)
              // 선택한 위치가 '이 품목'의 허브인지 — 품목마다 허브가 다르므로 행별로 판정.
              const rowIsHub = r.locations.find(l => l.id === locId)?.isHub ?? false
              // 이 품목의 창고와 그 잔량. isHub 위치가 없으면 추측하지 않고 표시를 생략한다(정본 규칙).
              const hubLoc = r.locations.find(l => l.isHub)
              const hubStock = hubLoc
                ? { name: hubLoc.name, qty: r.currentLocationBreakdown.find(lb => lb.locationId === hubLoc.id)?.qty ?? null }
                : null
              return (
                <div key={r.id} className="space-y-1 border-b border-[var(--warm-border)]/40 pb-2 last:border-0">
                  <div className="flex items-baseline justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--warm-dark)] truncate">{r.label}</p>
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">{r.category}</p>
                    </div>
                  </div>
                  {/* 참고줄 — 직전 잔량·지난 보충량·창고 잔량. 창고 잔량만 있어도 띄운다(보충 판단의 전제). */}
                  {(prev != null || (restocked > 0 && !rowIsHub) || (!rowIsHub && !!hubStock)) && (
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-[0.65625rem] bg-[var(--canvas)] rounded-md px-2 py-1">
                      {prev != null && <span className="text-[var(--warm-mid)]">직전 잔량 <strong className="text-[var(--warm-dark)] tabular-nums">{prev.qty}{stockUnit ?? ''}</strong></span>}
                      {prev?.restockedQty != null && prev.restockedQty > 0 && <span className="text-[var(--warm-muted)]">· 지난 옮김 <strong className="text-[var(--coral)] tabular-nums">+{Math.round(prev.restockedQty * 100) / 100}{stockUnit ?? ''}</strong></span>}
                      {/* 창고 잔량 — 지금까지는 저장을 눌러 부족 경고가 떠야 알 수 있었다(사후 차단).
                          기록이 없으면 0이 아니라 '모름'이므로 숫자를 만들어내지 않는다. 품목마다 창고가 다르다. */}
                      {!rowIsHub && hubStock && (
                        <span className={hubStock.qty != null && restocked > hubStock.qty ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'}>
                          · {hubStock.name} 남음{' '}
                          {hubStock.qty == null
                            ? <strong className="text-[var(--warm-muted)]">점검 기록 없음</strong>
                            : <strong className="tabular-nums">{Math.round(hubStock.qty * 100) / 100}{stockUnit ?? ''}</strong>}
                        </span>
                      )}
                      {restocked > 0 && !rowIsHub && <span className="text-[var(--coral)] ml-auto">창고에서 <strong className="tabular-nums">+{Math.round(restocked * 100) / 100}{stockUnit ?? ''}</strong></span>}
                    </div>
                  )}
                  {rowIsHub ? (
                    // 허브 위치 점검 — 잔량 1칸
                    <div className="flex items-center gap-1.5">
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0 w-16">잔량</p>
                      <input type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                        value={afterStr}
                        onChange={e => setAfterQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                        className={qtyInputCls} />
                      <span className="text-[0.65625rem] text-[var(--warm-muted)] w-6 shrink-0 text-right">{stockUnit ?? ''}</span>
                      {prev != null && (
                        <button type="button"
                          onClick={() => setAfterQtys(p => ({ ...p, [r.id]: String(prev.qty) }))}
                          className="shrink-0 text-[0.65625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                          직전값
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* 비허브 위치 점검 — 현재 잔량 / 보충 후(선택) */}
                      <div className="grid grid-cols-2 gap-1.5">
                        <div>
                          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">현재 잔량 (채우기 전)</p>
                          <input type="text" inputMode="decimal" autoComplete="off" placeholder="0"
                            value={beforeStr}
                            onChange={e => setBeforeQtys(p => ({ ...p, [r.id]: e.target.value.replace(/[^0-9.]/g, '') }))}
                            className={qtyInputCls} />
                        </div>
                        <div>
                          <p className="text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">채운 후 <span className="text-[var(--warm-muted)]/70">(창고에서 옮긴 경우)</span></p>
                          <input type="text" inputMode="decimal" autoComplete="off" placeholder="—"
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
                          className="text-[0.65625rem] px-1.5 py-0.5 rounded-md border border-[var(--tc-text)]/45 text-[var(--tc-text)] hover:bg-[var(--tc-text)]/10">
                          옮김 없음
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )
            })}
            </>
          )}
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
        </div>

        {locId && locItems.length > 0 && totalRestock > 0 && (
          <div className="border-t border-[var(--coral)]/20 bg-[var(--coral)]/5 px-5 py-2 shrink-0">
            <p className="text-[0.6875rem] text-[var(--warm-mid)]">
              채운 만큼 각 품목의 창고(허브) 잔량에서 자동 차감됩니다.
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
        {(draftPending || locDraftSavedAt) && (() => {
          // §12 임시저장 칩 정본 — 아이템별 점검 폼과 동일 3상태
          const curSnap = JSON.stringify({ locId, date, rows: locItems.map(r => computeRow(r)) })
          const dirtySinceSave = !draftPending && locDraftSavedAt != null && locDraftSnapRef.current != null && locDraftSnapRef.current !== curSnap
          const dotColor = draftPending ? 'var(--camel)' : dirtySinceSave ? 'var(--warm-muted)' : 'var(--success)'
          const textColor = draftPending ? 'var(--camel)' : dirtySinceSave ? 'var(--warm-muted)' : 'var(--success-fg)'
          const label = draftPending ? '저장 중…'
            : dirtySinceSave ? `임시저장 후 수정됨 (저장본 ${fmtTime(new Date(locDraftSavedAt!))})`
            : `임시저장됨 ${fmtTime(new Date(locDraftSavedAt!))}`
          return (
            <div className="px-5 pb-1 shrink-0">
              <div className="flex items-center gap-1.5 text-[0.65625rem] rounded-lg px-2.5 py-1.5" style={{ background: 'var(--cream-2)' }}>
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: dotColor }} />
                <span style={{ color: textColor }}>{label}</span>
              </div>
            </div>
          )
        })()}
        <div className="border-t border-[var(--warm-border)] px-5 py-3 flex gap-2 shrink-0">
          {!inline && <Btn variant="secondary" fullWidth onClick={onClose}>취소</Btn>}
          <Btn variant="secondary" fullWidth onClick={handleSaveDraft} disabled={draftPending || pending || !locId || locItems.length === 0}>
            {draftPending ? '저장 중…' : '임시저장'}
          </Btn>
          <Btn variant="primary" fullWidth onClick={handleSave} disabled={pending || !locId || locItems.length === 0}>
            {pending ? '저장 중…' : `${locItems.filter(isItemDirty).length}품목 저장`}
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
        if (!res.ok) { pushToast('error', res.error); setPending(false); release(); return }
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
      <div className="space-y-4">
        {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}
        {decisions.map((d, i) => (
          <div key={i} className="space-y-2 border-b border-[var(--warm-border)]/50 pb-3 last:border-0">
            <p className="text-sm font-medium text-[var(--warm-dark)]">
              <span className="text-[var(--coral)]">{d.newLabel}</span>
              <span className="text-[0.65625rem] text-[var(--warm-muted)] ml-1.5">{d.category} · 지출 {d.expenseIds.length}건</span>
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
                <span>새 품목으로 등록 <span className="text-[0.65625rem] text-[var(--warm-muted)]">(다음부턴 안 물어봄)</span></span>
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
      <div className="space-y-4">
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
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">{r.category}</span>
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
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">{r.category}</span>
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
        <div className="space-y-2 max-h-96 overflow-y-auto overscroll-contain">
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

  // 순서 이동(▲▼) — 이웃과 자리 교체 후 전체 id 순서를 서버 저장. 낙관적 반영, 실패 시 원복.
  const move = async (idx: number, dir: -1 | 1) => {
    const target = idx + dir
    if (target < 0 || target >= locs.length) return
    const next = [...locs]
    ;[next[idx], next[target]] = [next[target], next[idx]]
    setLocs(next)
    setPending(true)
    const res = await reorderStorageLocations(next.map(l => l.id))
    setPending(false)
    if (!res.ok) { pushToast('error', res.error); reload(); return }
    pushToast('success', '위치 순서 저장됨')
  }

  // 손잡이 드래그 — 설정 옵션 리스트·순서 편집 모드와 동일 문법(오른쪽 44pt 핸들, 놓을 때 1회 저장).
  // ▲▼만 있어 다른 순서 편집 표면과 어긋나던 것 통일(운영자 지적 2026-07-22). ▲▼는 보조로 유지(설정 리스트와 동일).
  const [dragIdx, setDragIdx] = useState<number | null>(null)
  const locListRef = useRef<HTMLUListElement | null>(null)
  const locsRef = useRef(locs)
  useEffect(() => { locsRef.current = locs }, [locs])
  const dragChanged = useRef(false)
  const onLocHandleDown = (idx: number) => (e: React.PointerEvent) => {
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    dragChanged.current = false
    setDragIdx(idx)
  }
  const onLocHandleMove = (e: React.PointerEvent) => {
    if (dragIdx == null || !locListRef.current) return
    const rows = Array.from(locListRef.current.children) as HTMLElement[]
    if (rows.length === 0) return
    let over = -1
    if (e.clientY < rows[0].getBoundingClientRect().top) over = 0
    else if (e.clientY > rows[rows.length - 1].getBoundingClientRect().bottom) over = rows.length - 1
    else for (let i = 0; i < rows.length; i++) { const r = rows[i].getBoundingClientRect(); if (e.clientY >= r.top && e.clientY <= r.bottom) { over = i; break } }
    if (over < 0 || over === dragIdx) return
    setLocs(prev => {
      const next = [...prev]
      const [m] = next.splice(dragIdx, 1)
      next.splice(over, 0, m)
      return next
    })
    setDragIdx(over)
    dragChanged.current = true
  }
  const onLocHandleUp = async () => {
    if (dragIdx == null) return
    setDragIdx(null)
    if (!dragChanged.current) return
    dragChanged.current = false
    setPending(true)
    const res = await reorderStorageLocations(locsRef.current.map(l => l.id))
    setPending(false)
    if (!res.ok) { pushToast('error', res.error); reload(); return }
    pushToast('success', '위치 순서 저장됨')
  }

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

  // 삭제 정책(운영자 확정 2026-07-18): 기록 없는 위치(실수 생성)는 확인 1회로 삭제.
  // 기록이 있으면 서버가 impact 를 돌려주고, 실제 결과(이력 삭제·추후 총량 감소)를 명시한
  // 두 번째 확인을 통과해야 강제 삭제. 일상적 정리는 품목별 '숨김' 안내.
  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `'${name}' 위치를 삭제할까요?`, message: '기록이 있는 위치면 삭제 전에 한 번 더 확인합니다.', level: 'caution', confirmLabel: '삭제' }))) return
    setPending(true)
    const res = await deleteStorageLocation(id)
    setPending(false)
    if (res.ok) { reload(); return }
    if (!res.impact) { setError(res.error); return }
    const { checkRows, linkedItems, addRows, dispRows } = res.impact
    const parts = [
      checkRows > 0 ? `위치별 점검 기록 ${checkRows}건이 함께 삭제됩니다` : null,
      linkedItems > 0 ? `${linkedItems}개 품목의 위치 연결이 풀립니다` : null,
      addRows + dispRows > 0 ? `입수·폐기 기록 ${addRows + dispRows}건에서 위치 표시가 사라집니다` : null,
    ].filter(Boolean).join('. ')
    const go = await confirmDialog({
      title: `'${name}' 위치에 기록이 있습니다`,
      message: `${parts}. 지워진 점검 내역만큼 다음 위치별 점검에서 총량이 줄어들 수 있습니다. 지난 기록을 남기려면 삭제 대신 품목별 '숨김'을 쓰세요. 그래도 삭제할까요?`,
      level: 'danger', confirmLabel: '그래도 삭제',
    })
    if (!go) return
    setPending(true)
    const res2 = await deleteStorageLocation(id, true)
    setPending(false)
    if (!res2.ok) { setError(res2.error); return }
    reload()
  }

  return (
    <Modal open onClose={onClose} title="보관 위치 관리" subtitle="창고 / 4층 주방 / 손님실 등 보관 장소를 등록하세요" width="sm"
      // 풀블리드 — 본문과 폭 전체 구분선 액션 바를 children 이 직접 구성한다.
      bodyClassName="">
      <div className="px-5 sm:px-6 py-4 space-y-4">
        {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
        {locs.length === 0 && !pending && (
          <p className="text-sm text-[var(--warm-muted)] text-center py-4">등록된 위치가 없습니다.</p>
        )}
        <ul ref={locListRef} className="space-y-1.5">
          {locs.map((loc, idx) => (
            <li key={loc.id} className={`flex items-center gap-2 bg-[var(--canvas)] border rounded-xl px-3 py-2 ${dragIdx === idx ? 'border-[var(--coral)] shadow-lift select-none' : 'border-[var(--warm-border)]/60'}`}>
              {editId !== loc.id && (
                <div className="flex flex-col gap-0.5 shrink-0">
                  <button type="button" onClick={() => move(idx, -1)} disabled={idx === 0 || pending} aria-label="위로 이동"
                    className="w-6 h-5 flex items-center justify-center rounded text-[var(--warm-mid)] hover:text-[var(--warm-dark)] disabled:opacity-20 transition-colors leading-none">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6" /></svg>
                  </button>
                  <button type="button" onClick={() => move(idx, 1)} disabled={idx === locs.length - 1 || pending} aria-label="아래로 이동"
                    className="w-6 h-5 flex items-center justify-center rounded text-[var(--warm-mid)] hover:text-[var(--warm-dark)] disabled:opacity-20 transition-colors leading-none">
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                  </button>
                </div>
              )}
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
                  {/* 오른쪽 44pt 드래그 손잡이 — 설정 옵션 리스트와 동일 문법 */}
                  <button type="button" aria-label={`${loc.name} 순서 이동`}
                    onPointerDown={onLocHandleDown(idx)} onPointerMove={onLocHandleMove} onPointerUp={onLocHandleUp} onPointerCancel={onLocHandleUp}
                    style={{ touchAction: 'none' }}
                    className="shrink-0 flex items-center justify-center w-11 h-11 -my-1 rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] cursor-grab active:cursor-grabbing">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                      <line x1="4" y1="9" x2="20" y2="9" /><line x1="4" y1="15" x2="20" y2="15" />
                    </svg>
                  </button>
                  <button
                    type="button"
                    title={loc.isHub ? '기본 창고 해제' : '기본 창고로 지정 (품목별로 지정 안 한 경우의 기본값)'}
                    onClick={async () => {
                      // 기본 창고를 바꾸면 품목별 창고를 지정 안 한 품목 전부의 미지정 입수 귀속처와
                      // 보충 차감 대상이 한 번에 바뀐다. 확인도 되돌리기도 없었다(C페이즈 2026-08-03).
                      if (!loc.isHub && !(await confirmDialog({
                        title: `${loc.name}을(를) 기본 창고로 지정할까요?`,
                        message: '품목별 창고를 지정하지 않은 품목은 앞으로 이 위치로 입수되고, 보충도 여기서 차감됩니다.\n같은 버튼을 다시 눌러 해제할 수 있습니다.',
                        level: 'caution', confirmLabel: '기본 창고로',
                      }))) return
                      setPending(true)
                      await toggleStorageLocationHub(loc.id, !loc.isHub)
                      pushToast('success', loc.isHub ? '기본 창고 해제됨' : `${loc.name}이(가) 기본 창고가 되었습니다`, {
                        action: { label: '적용취소', run: () => { void toggleStorageLocationHub(loc.id, loc.isHub).then(() => reload()) } },
                      })
                      reload()
                      setPending(false)
                    }}
                    className={`text-[0.65625rem] px-2 py-1 rounded-lg border transition-colors ${loc.isHub ? 'bg-[var(--warning-bg)] border-[var(--warning-ring)] text-[var(--warning-fg)]' : 'border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-[var(--warning-ring)] hover:text-[var(--warning-fg)]'}`}>
                    {loc.isHub ? <>기본 창고 <svg className="inline-block align-middle" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg></> : '기본 창고'}
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
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
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
    pushToast('success', `${res.count}개 품목에 위치 추가 완료`)
    onDone()
  }

  return (
    <Modal open onClose={onClose} title="위치 일괄 추가" subtitle={`${selectedIds.length}개 품목에 동일 위치를 추가합니다`} width="sm"
      // 풀블리드 — 본문과 폭 전체 구분선 액션 바를 children 이 직접 구성한다.
      bodyClassName="">
      <div className="px-5 sm:px-6 py-4 space-y-3">
        {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}
        {allLocs.length === 0 ? (
          <p className="text-sm text-[var(--warm-muted)] text-center py-4">등록된 위치가 없습니다. 먼저 "위치 관리"에서 추가하세요.</p>
        ) : (
          <>
            <p className="text-xs text-[var(--warm-muted)]">선택한 위치를 추가합니다. 기존 위치는 유지됩니다.</p>
            <div className="flex flex-wrap gap-2">
              {allLocs.map(loc => (
                <button key={loc.id} type="button" onClick={() => toggle(loc.id)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${chosen.has(loc.id)
                    ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]'
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
            {pending ? '적용 중…' : '적용'}
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
  const router = useRouter()
  // 3-상태: 열린 링크(선택 토글) / 숨긴 링크(다시 표시) / 미연결(선택 토글). closedAt 으로 구분.
  const openIds = initialLocations.filter(l => l.closedAt == null).map(l => l.id)
  const closedLocs = initialLocations.filter(l => l.closedAt != null)
  const [allLocs, setAllLocs]     = useState<StorageLocationItem[]>([])
  const [selected, setSelected]   = useState<Set<string>>(new Set(openIds))   // 열린 것만
  const [pending, setPending]     = useState(false)
  const [saved, setSaved]         = useState(false)
  const [error, setError]         = useState('')

  useEffect(() => { getStorageLocations().then(setAllLocs) }, [])

  if (allLocs.length === 0) return null
  const closedIds = new Set(closedLocs.map(l => l.id))

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
    router.refresh()   // 빈 위치 숨김(3-way diff)이 반영되도록
  }

  const reopen = async (id: string) => {
    setPending(true); setError('')
    const res = await reopenItemLocation(trackedItemId, id)
    setPending(false)
    if (!res.ok) { pushToast('error', res.error); return }
    // selected 에도 즉시 반영 — state 는 최초 1회만 초기화되고 refresh 로 재초기화되지 않으므로,
    // 안 넣으면 되살린 위치가 다음 '위치 저장' 때 missing 으로 분류돼 조용히 재숨김된다(적대검증 지적).
    setSelected(prev => new Set(prev).add(id))
    pushToast('success', '위치를 다시 표시했습니다')
    router.refresh()
  }

  // 열린 초기 상태와 달라졌는지 — 숨긴 위치는 비교에서 제외(다시 표시는 별도 버튼)
  const dirty =
    openIds.length !== selected.size ||
    openIds.some(id => !selected.has(id))

  return (
    <div className="space-y-2 pt-2 border-t border-[var(--warm-border)]/60">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-[var(--warm-mid)]">보관 위치</label>
        {saved && <span className="text-[0.65625rem] text-[var(--success-fg)]">저장됨</span>}
      </div>
      <div className="flex flex-wrap gap-2">
        {allLocs.filter(loc => !closedIds.has(loc.id)).map(loc => (
          <button
            key={loc.id}
            type="button"
            onClick={() => toggle(loc.id)}
            className={`text-xs px-2.5 py-1 rounded-full border transition-colors ${selected.has(loc.id)
              ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]'
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
        {pending ? '저장 중…' : '위치 저장'}
      </Btn>
      {dirty && !saved && (
        <p className="text-[0.65625rem] text-[var(--coral)]">
          변경한 보관 위치는 위치 저장 버튼을 눌러야 반영됩니다.
        </p>
      )}
      {closedLocs.length > 0 && (
        <div className="pt-1.5 border-t border-[var(--warm-border)]/40 space-y-1">
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">숨긴 위치</p>
          {closedLocs.map(loc => (
            <div key={loc.id} className="flex items-center justify-between gap-2">
              <span className="text-xs text-[var(--warm-muted)]">{loc.name}</span>
              <button type="button" onClick={() => reopen(loc.id)} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded-md border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors disabled:opacity-40">다시 표시</button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[0.65625rem] text-[var(--warm-muted)]">재고 점검 시 선택된 위치별로 잔량을 나눠서 입력할 수 있습니다. 비어 있는 위치는 선택을 해제하면 화면에서 숨겨지고, 지난 기록은 그대로 남습니다.</p>
    </div>
  )
}

// ── 폐기 기록 폼 — 무상 입수의 거울(유출). 서버가 잔량 초과·이후 점검 존재를 거부(이중 차감 방지).
function DisposalForm({ item, onCancel, onDone }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; unitHint: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  onCancel: () => void; onDone: () => void
}) {
  const stockUnit = item.trackUnit === 'qty' ? (item.qtyUnit ?? item.unitHint) : (item.specUnit ?? item.qtyUnit ?? item.unitHint)
  const [date, setDate] = useState(kstYmdStr())
  const [qtyStr, setQtyStr] = useState('')
  const [reason, setReason] = useState('상함·부패')
  const [memo, setMemo] = useState('')
  const defaultLocId = item.locations.length === 1 ? item.locations[0].id : ''
  const [storageLocationId, setStorageLocationId] = useState<string>(defaultLocId)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const qty = Number(qtyStr) || 0
    if (qty <= 0) { setError('폐기 수량은 0보다 커야 합니다.'); return }
    startTransition(async () => {
      const res = await createStockDisposal({
        trackedItemId: item.id, date, disposedQty: qty, reason, memo: memo || undefined,
        storageLocationId: storageLocationId || null,
      })
      if (!res.ok) { setError(res.error); return }
      pushToast('success', '폐기를 기록했습니다')
      onDone()
    })
  }

  return (
    <form onSubmit={handleSubmit} className="px-5 py-4 space-y-3 flex-1 overflow-y-auto">
      <p className="text-xs text-[var(--warm-muted)]">상하거나 버려서 줄어든 양을 기록합니다. 소모량 계산에서 분리되어 소진 예측이 왜곡되지 않습니다. 점검 저장 전에 먼저 기록하세요.</p>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">폐기일 *</label>
        <DatePicker value={date} onChange={setDate}
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">폐기 수량 *</label>
        <div className="flex gap-1.5 items-center">
          <input type="text" inputMode="decimal" autoComplete="off" value={qtyStr}
            onChange={e => setQtyStr(e.target.value.replace(/[^0-9.]/g, ''))}
            placeholder="0"
            className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          <span className="text-xs text-[var(--warm-muted)] shrink-0">{stockUnit ?? ''}</span>
        </div>
      </div>
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">사유</label>
        <select value={reason} onChange={e => setReason(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
          <option value="상함·부패">상함·부패</option>
          <option value="유통기한">유통기한 경과</option>
          <option value="파손">파손</option>
          <option value="기타">기타</option>
        </select>
      </div>
      {item.locations.length > 0 && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">위치 <span className="text-[var(--warm-muted)] font-normal">(선택)</span></label>
          <select value={storageLocationId} onChange={e => setStorageLocationId(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
            <option value="">위치 없음 (전체에서 차감)</option>
            {item.locations.map(l => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
      )}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택)"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
      </div>
      {error && <p className="text-sm text-[var(--danger-fg)]">{error}</p>}
      <div className="flex gap-2 pt-1">
        <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={onCancel} disabled={pending}>취소</Btn>
        <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={pending}>{pending ? '저장 중…' : '폐기 기록'}</Btn>
      </div>
    </form>
  )
}

function AdditionForm({ item, onCancel, onDone }: {
  item: { id: string; specUnit: string | null; qtyUnit: string | null; unitHint: string | null; trackUnit: 'spec' | 'qty'; locations: StorageLocationItem[] }
  onCancel: () => void; onDone: () => void
}) {
  // trackUnit='qty': specUnit 있어도 매(qtyUnit) 단위로 단일 입력
  // trackUnit='spec' & specUnit 있음: 규격 × 수량 두 입력
  const useSpec = item.trackUnit !== 'qty' && !!(item.specUnit && item.specUnit.trim())
  const qtyUnitLabel = item.qtyUnit ?? item.unitHint   // 카드 단위가 비면 표시 폴백(unitHint)으로
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
      // 소급 등록(이미 점검이 지나간 날짜)이면 그 뒤 점검의 저장 잔량도 함께 옮길지 묻는다.
      // 안 물으면 그 입수가 점검에 삼켜져 잔량에서 통째로 증발한다(운영자 신고 2026-08-19).
      const unit = item.trackUnit === 'qty' ? (item.qtyUnit ?? item.unitHint) : (item.specUnit ?? item.qtyUnit ?? item.unitHint)
      const ask = await askLedgerShift({
        trackedItemId: item.id,
        next: { date, addedQty: computed, storageLocationId: storageLocationId || null },
        title: `${fmtDateKor(date)} 입수로 기록할까요?`,
        keepLine: '입수 기록은 입력한 대로 저장됩니다.',
        impactLine: n => `이 날짜 뒤의 점검 ${n}건은 저장된 잔량이 이 입수를 담고 있지 않습니다. 함께 조정하면 이렇게 바뀝니다.`,
        unit,
      })
      if (ask.error) { setError(ask.error); return }
      if (!ask.result) return
      const res = await createStockAddition({
        trackedItemId: item.id, date, addedQty: computed, source, memo: memo || undefined,
        storageLocationId: storageLocationId || null,
        adjustFollowing: ask.result.adjust,
      })
      if (!res.ok) { setError(res.error); return }
      if (ask.result.adjust && ask.result.count > 0) {
        // 조정까지 적용했으면 §16 진입점 1(토스트) 로 회수 경로를 준다 — 삭제가 정확히 역조정이다.
        const newId = res.id
        pushToast('success', '입수 기록 저장됨', {
          detail: `점검 ${ask.result.count}건의 잔량도 함께 옮겼습니다.`,
          action: { label: '적용취소', run: () => { void deleteStockAddition(newId, { adjustFollowing: true }).then(r => {
            if (r.ok) { pushToast('info', '입수 기록을 되돌렸습니다'); onDone() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
        })
      }
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
              <label className="text-[0.65625rem] text-[var(--warm-muted)]">규격</label>
              <div className="flex gap-1.5 items-center">
                <input type="text" inputMode="decimal" autoComplete="off" value={specQty}
                  onChange={e => setSpecQty(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="0"
                  className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)] shrink-0">{item.specUnit}</span>
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-[0.65625rem] text-[var(--warm-muted)]">수량</label>
              <div className="flex gap-1.5 items-center">
                <input type="text" inputMode="decimal" autoComplete="off" value={packQty}
                  onChange={e => setPackQty(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="1"
                  className="w-24 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-right text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-xs text-[var(--warm-muted)] shrink-0">{qtyUnitLabel ?? '개'}</span>
              </div>
            </div>
          </div>
          {computed > 0 && (
            <p className="text-[0.65625rem] text-[var(--coral)] bg-[var(--coral)]/5 rounded-lg px-2.5 py-1.5">
              → 입수량 합계 <strong>{Math.round(computed * 100) / 100}{item.specUnit}</strong>
            </p>
          )}
        </>
      ) : (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">수량 *{qtyUnitLabel ? ` (${qtyUnitLabel})` : ''}</label>
          <input type="text" inputMode="decimal" autoComplete="off" value={qtyOnly}
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
          {pending ? '저장 중…' : '저장'}
        </Btn>
      </div>
    </form>
  )
}
