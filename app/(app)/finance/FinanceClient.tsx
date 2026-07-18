'use client'

import { useState, useTransition, useRef, useEffect, useCallback, useMemo, Fragment } from 'react'
import { AiQuotaHint } from '@/components/ui/AiQuotaHint'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  addExpense, updateExpense, deleteExpense, undoDeleteExpense, attachShippingToOrder, detachShippingFromOrder, mergeExpensesIntoOrder, findOrderByExternalNo,
  unsettleExpenses,
  saveFinancialAccount, deleteFinancialAccount, deactivateFinancialAccount,
  recordRecurringExpense, uploadExpenseReceipt, getLastItemUnits, getItemQuickPicks,
  analyzeReceiptWithGemini,
  addReserveDeposit, addReserveWithdrawDirect, settleReserveFromExpense, deleteReserveTransaction,
  setRecurringPendingAmount, clearRecurringPendingAmount,
  getVendorUsage, renameVendor,
  searchExpenses,
  type RecurringExpenseWithStatus,
  type ExpenseSearchResult,
} from './actions'
import type { ReceiptOcrResult } from '@/lib/receiptOcr'
import {
  getRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, groupRecurringExpenses,
  type RecurringExpenseRow,
} from '@/app/(app)/settings/actions'
import { includeExpenseInInventory, syncTrackedItemCategory } from '@/app/(app)/inventory/actions'
import { useRouter, useSearchParams } from 'next/navigation'
import { recordDepositReceived } from '@/app/(app)/rooms/actions'
import { getPendingReceiptImage, finalizePendingReceipt } from '@/app/(app)/dashboard/pendingReceipt'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { EmptyState } from '@/components/ui/EmptyState'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'
import { useCanEdit } from '@/components/RoleContext'
import { Loading } from '@/components/ui/Loading'
import MonthSelector from '@/components/layout/MonthSelector'
import { Modal } from '@/components/ui/Modal'
import { ReceiptScanModal, dataUrlToFile } from '@/components/ReceiptScanModal'
import { SpecWizard, type SpecWizardResult } from '@/components/ui/SpecWizard'
import type { SetHint } from '@/lib/setHint'
import { ITEM_PRESETS } from '@/lib/itemPresets'
import { SearchBar } from '@/components/ui/SearchBar'
import { chartColor } from '@/lib/chartColors'
import { fmtKorMoney, fmtWon } from '@/lib/fmtMoney'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { MergeSheet } from '@/components/ui/inventory/MergeSheet'
import { useLongPress } from '@/lib/useLongPress'
import { ViewTabs } from '@/components/ui/ViewTabs'
import {
  DEFAULT_RECURRING_DUE_DAY,
  DEFAULT_RECURRING_CATEGORY,
  DEFAULT_RECURRING_ALERT_DAYS_BEFORE,
} from '@/lib/appConfig'

// ── Types ───────────────────────────────────────────────────────

type FAcc = { brand: string; alias: string | null }

type Expense = {
  id: string; date: Date; amount: number; category: string
  detail: string | null; vendor: string | null; memo: string | null; payMethod: string | null
  settleStatus: string; financeName: string | null
  financialAccountId: string | null; financialAccount: FAcc | null
  roomId: string | null; room: { id: string; roomNo: string } | null
  recurringExpenseId: string | null; recurringExpense: { isVariable: boolean } | null
  receiptUrl: string | null
  breakdownJson: string | null   // #1 관리비 묶음 세부 내역
  itemLabel: string | null
  specValue: number | null; specUnit: string | null
  specText: string | null; unitBasis: string | null   // 서술형 규격·단가 기준 — 수정 프리필 보존용
  qtyValue: number | null; qtyUnit: string | null
  orderId: string | null; isShipping: boolean
  allocationGroupId: string | null   // 한 품목 방별 분배 묶음 — 목록에서 한 줄로 묶어 표시
  excludeFromInventory: boolean   // 재고 계산 제외 — 상세에서 '다시 포함' 제공
  order: { id: string; code: string; externalOrderNo?: string | null; shippingType: string | null; shippingMemo: string | null } | null
  createdAt: Date  // 같은 날짜 정렬 보조 (최근 입력 우선)
}

type Income = {
  id: string; date: Date; amount: number; category: string
  detail: string | null; memo: string | null; payMethod: string | null
  financialAccountId: string | null; financialAccount: FAcc | null
}

type FinancialAccount = {
  id: string; type: string; brand: string; alias: string | null
  identifier: string | null; owner: string | null
  payDay: number | null; cutOffDay: number | null
  linkedAccountId: string | null
  linkedAccount: { id: string; brand: string; alias: string | null } | null
}

// ── Constants ────────────────────────────────────────────────────

// 지출 카테고리는 설정(Property.expenseCategories) 기반 prop 사용 — 하드코딩 금지(상용화 감사 A4, 2026-07-10)

// #1·#3 세부항목 필수 면제 카테고리 — 임대료·세금 등 무형은 품목/세부가 부자연(강제 시 등록 막힘).
// 그 외 서비스·무형은 세부항목 필수(방별 투자금을 무엇에 썼는지 추적용). 물품 구매는 품목이 곧 세부항목.
const DETAIL_OPTIONAL_CATEGORIES = ['공과금', '관리비', '임대료', '세금/수수료', '보증금 반환']

// ── 품목 선택기 설정 ─────────────────────────────────────────────


const SPEC_UNITS = ['kg', 'g', 'ml', 'L', '매', 'm', 'cm', 'mm', '장', '개', '회', '인분', '봉지', '알', '권']
const QTY_UNITS  = ['개', '박스', '롤', '팩', '포대', '망', '단', '봉', '포기', '병', '통', '세트']

const ITEM_DEFAULTS: Record<string, { specUnit: string; qtyUnit: string }> = {
  '쌀':         { specUnit: 'kg',  qtyUnit: '포대' },
  '김치':       { specUnit: 'kg',  qtyUnit: '포기' },
  '라면':       { specUnit: '개',  qtyUnit: '박스' },
  '식빵':       { specUnit: 'g',   qtyUnit: '봉' },
  '계란':       { specUnit: '개',  qtyUnit: '판' },
  '물티슈':     { specUnit: '매',  qtyUnit: '팩' },
  '키친타월':       { specUnit: '매',  qtyUnit: '롤' },
  '키친타월 (롤)':  { specUnit: '매',  qtyUnit: '롤' },
  '키친타월 (팝업)':{ specUnit: '매',  qtyUnit: '팩' },
  '주방세제':   { specUnit: 'ml',  qtyUnit: '개' },
  '세탁세제':   { specUnit: 'ml',  qtyUnit: '개' },
  '화장실 휴지':{ specUnit: 'm',   qtyUnit: '롤' },
  '음식물쓰레기봉투 5L':  { specUnit: 'L', qtyUnit: '매' },
  '음식물쓰레기봉투 10L': { specUnit: 'L', qtyUnit: '매' },
  '음식물쓰레기봉투 20L': { specUnit: 'L', qtyUnit: '매' },
  '재활용품수거봉투 20L':  { specUnit: 'L', qtyUnit: '매' },
  '재활용품수거봉투 50L':  { specUnit: 'L', qtyUnit: '매' },
  '재활용품수거봉투 100L': { specUnit: 'L', qtyUnit: '매' },
  '종량제쓰레기봉투 10L':  { specUnit: 'L', qtyUnit: '매' },
  '종량제쓰레기봉투 20L':  { specUnit: 'L', qtyUnit: '매' },
  '종량제쓰레기봉투 50L':  { specUnit: 'L', qtyUnit: '매' },
  '종량제쓰레기봉투 100L': { specUnit: 'L', qtyUnit: '매' },
  '음식물쓰레기 배출 스티커': { specUnit: 'L', qtyUnit: '매' },
}

export type ItemPickState = {
  label: string
  ocrRaw?: string   // OCR 인식 원문 — 사용자가 이름을 바꿔 저장하면 별칭 학습(다음 영수증 자동 치환)
  setHint?: SetHint // 세트 상품 의심(주문 1=실물 N) — 행에 "1세트에 몇 개?" 확인 칩 표시, 저장 시 제거
  specValue: string; specUnit: string
  specText?: string   // 서술형 규격(1200x600mm 등) — 표시·자재 구분용, 계산 비관여
  qtyValue: string; qtyUnit: string
  amount?: number   // 이 품목에 할당된 총 금액
  unitPrice?: number  // 단가 — amount 와 수량으로 상호 자동계산(둘 중 하나 입력 시 다른 쪽 계산)
  // 단가 기준 — 'spec'(규격당: 40개입 3박스 → 120개당) / 'qty'(완제품 1개당: 장판 1롤당 등).
  // 규격이 치수(cm 등)면 규격당 단가가 무의미해 개당 기준 입력 지원(오류신고 4e2ffe04). 생략=spec(현행).
  unitBasis?: 'spec' | 'qty'
  // 방별 분배 (선택) — 사용자가 '방별로 나누기'를 켰을 때만. 비면 방 분할 없음(방은 선택사항).
  allocations?: { roomId: string; qty: string }[]
}

export function fmtItemDetail(d: ItemPickState): string {
  const spec = d.specText ? d.specText : d.specValue ? `${d.specValue}${d.specUnit}` : ''
  const qty  = d.qtyValue  ? `${d.qtyValue}${d.qtyUnit}`  : ''
  return [`[${d.label}]`, spec, qty && `x ${qty}`].filter(Boolean).join(' ')
}

export function fmtItemListDetail(items: ItemPickState[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return fmtItemDetail(items[0])
  return items.map(d => fmtItemDetail(d)).join(', ')
}

// 방별 분배 묶음의 '방' 개수 칩 — 실제 배정된 방만 셈(미배정 행은 방으로 세지 않음)
function roomChipText(rows: { room: { roomNo: string } | null }[]): string {
  const n = new Set(rows.filter(r => r.room).map(r => r.room!.roomNo)).size
  return n > 0 ? `방 ${n}개` : '미배정'
}

// 방별 분배 묶음의 방 목록 라벨 — '101·102·103호' / 많으면 '101호 외 N곳' / 미배정은 수량과 함께
function roomsLabel(rows: { room: { roomNo: string } | null; qtyValue?: number | null; qtyUnit?: string | null }[]): string {
  const fmt = (no: string) => /^\d+$/.test(no) ? `${no}호` : no
  const named = [...new Set(rows.filter(r => r.room).map(r => r.room!.roomNo))]
  const parts = named.length <= 3 ? named.map(fmt) : [fmt(named[0]), `외 ${named.length - 1}곳`]
  const unassigned = rows.filter(r => !r.room)
  if (unassigned.length > 0) {
    const qty = unassigned.reduce((s, r) => s + (r.qtyValue ?? 0), 0)
    const unit = unassigned.find(r => r.qtyUnit)?.qtyUnit ?? '개'
    parts.push(qty > 0 ? `미배정 ${qty}${unit}` : '미배정')
  }
  return parts.join('·')
}

function UnitCombobox({ value, onChange, options, placeholder }: {
  value: string; onChange: (v: string) => void
  options: string[]; placeholder?: string
}) {
  const [customMode, setCustomMode] = useState(false)
  const isInOptions = value === '' || options.includes(value)
  // 외부 value가 옵션에 없으면 자동으로 custom 모드 (수동 입력값)
  const showCustom = customMode || (!isInOptions && value !== '')

  if (showCustom) {
    return (
      <div className="flex flex-1 min-w-0 gap-1">
        <input
          type="text" value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder ?? '단위'}
          className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
          autoFocus
        />
        <button type="button" onClick={() => { setCustomMode(false); onChange('') }}
          className="px-1.5 text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)]"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
      </div>
    )
  }

  return (
    <select
      value={value}
      onChange={e => {
        const v = e.target.value
        if (v === '__custom__') { setCustomMode(true); onChange('') }
        else onChange(v)
      }}
      className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
    >
      <option value="">{placeholder ?? '단위'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__custom__">기타(직접 입력)</option>
    </select>
  )
}

// 품명 유사도 (B) — 신규 입력 시 비슷한 기존 품명이 있으면 확인받기. 문자열 기반(공백 제거·소문자).
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const dp = Array.from({ length: m + 1 }, (_, i) => i)
  for (let j = 1; j <= n; j++) {
    let prev = dp[0]; dp[0] = j
    for (let i = 1; i <= m; i++) {
      const tmp = dp[i]
      dp[i] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[i], dp[i - 1])
      prev = tmp
    }
  }
  return dp[m]
}
function findSimilarItemName(input: string, candidates: string[]): string | null {
  const norm = (s: string) => s.trim().replace(/\s+/g, '').toLowerCase()
  const a = norm(input)
  if (a.length < 2) return null
  let best: { name: string; score: number } | null = null
  for (const c of candidates) {
    const b = norm(c)
    if (!b) continue
    if (b === a) return null   // 정규화상 동일 → 이미 같은 이름, 확인 불필요
    const score = (a.includes(b) || b.includes(a))
      ? 0.85 + 0.15 * (Math.min(a.length, b.length) / Math.max(a.length, b.length))
      : 1 - levenshtein(a, b) / Math.max(a.length, b.length)
    if (score >= 0.6 && score < 1 && (!best || score > best.score)) best = { name: c, score }
  }
  return best?.name ?? null
}

function ItemSelector({ category, value, onChange, allowMulti = true, rooms = [], detailSuggestions = [], isService = false }: {
  category: string
  value: ItemPickState[]
  onChange: (data: ItemPickState[]) => void
  allowMulti?: boolean
  rooms?: { id: string; roomNo: string }[]   // 방별 분배용 (선택). 없으면 방 분배 UI 미표시.
  detailSuggestions?: string[]               // 과거 품목명 자동완성(구매처와 동일 방식)
  isService?: boolean                        // 서비스·무형 — 추천이 서비스 이력으로 분리(신고 99c30054)
}) {
  // 품목 빠른 선택 — 유형(물품/서비스)→카테고리 계층 추천, 부족분은 상위 단계로 보충해 항상 10개(신고 6b79c725).
  const [presets, setPresets] = useState<string[]>(isService ? [] : (ITEM_PRESETS[category] ?? []))
  useEffect(() => {
    let alive = true
    setPresets(isService ? [] : (ITEM_PRESETS[category] ?? []))
    getItemQuickPicks(category, { service: isService }).then(p => { if (alive && p.length) setPresets(p) }).catch(() => {})
    return () => { alive = false }
  }, [category, isService])
  const items = value
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [specValue, setSpecValue]     = useState('')
  const [specUnit, setSpecUnit]       = useState('')
  const [qtyValue, setQtyValue]       = useState('')
  const [qtyUnit, setQtyUnit]         = useState('')
  const [amountStr, setAmountStr]     = useState('')
  const [unitStr, setUnitStr]         = useState('')                        // 단가(기준단위 1개당) — 아는 값 입력 시 금액 자동
  const [priceMode, setPriceMode]     = useState<'amount' | 'unit'>('amount')  // 마지막으로 사용자가 직접 입력한 쪽(그쪽이 기준)
  const [unitBasis, setUnitBasis]     = useState<'spec' | 'qty'>('spec')    // 단가 기준: 규격당 / 완제품 1개당(장판 1롤당 등)
  const [basisTouched, setBasisTouched] = useState(false)
  const [customLabel, setCustomLabel] = useState('')
  const [fetching, setFetching]       = useState(false)
  const [prevUnits, setPrevUnits]     = useState<Awaited<ReturnType<typeof getLastItemUnits>>>(null)
  const [noSpec, setNoSpec]           = useState(false)   // 규격 없음(수량만) — 켜면 규격 입력 숨김
  const [specTextMode, setSpecTextMode] = useState(false)  // 서술형 규격(사이즈 등) — 계산 비관여, 개당 단가 강제
  const [specText, setSpecText]       = useState('')
  // 규격 단계별 입력(위저드) — 새 품목(과거 단위·프리셋 기본값 없음)이면 자동, 버튼으로 상시 호출
  const [wizardOpen, setWizardOpen]   = useState(false)
  const applyWizard = (r: SpecWizardResult) => {
    setQtyUnit(r.qtyUnit); if (r.qtyValue) setQtyValue(r.qtyValue)
    if (r.specText) { setSpecTextMode(true); setNoSpec(false); setSpecText(r.specText); setSpecValue(''); setSpecUnit('') }
    else if (r.specValue) { setSpecTextMode(false); setSpecText(''); setNoSpec(false); setSpecValue(r.specValue); setSpecUnit(r.specUnit) }
    else { setNoSpec(true); setSpecTextMode(false); setSpecText(''); setSpecValue(''); setSpecUnit('') }
    setUnitBasis(r.unitBasis); setBasisTouched(true)
  }

  // category 변경 시 active picker 입력만 초기화 (items는 부모가 관리)
  useEffect(() => {
    setActiveLabel(null)
    setSpecValue(''); setSpecUnit(''); setQtyValue(''); setQtyUnit('')
    setAmountStr(''); setUnitStr(''); setPriceMode('amount'); setUnitBasis('spec'); setBasisTouched(false); setCustomLabel(''); setPrevUnits(null); setNoSpec(false); setSpecTextMode(false); setSpecText('')
  }, [category])

  // 규격 단위가 치수(cm·mm·m·인치)면 규격당 단가가 무의미한 경우가 많아(장판 1cm당 가격 등)
  // 기본 기준을 '완제품 1개당'으로. 사용자가 직접 전환했으면(basisTouched) 존중. (오류신고 4e2ffe04)
  useEffect(() => {
    if (basisTouched) return
    const u = specUnit.trim().toLowerCase()
    if (['cm', 'mm', 'm', '인치'].includes(u)) { setUnitBasis('qty'); return }
    // 품목의 재고 추적 단위가 '수량'이면 개당 단가가 기본 — 봉투·장판 등(오류신고 c7cf6180)
    setUnitBasis(prevUnits?.trackUnit === 'qty' ? 'qty' : 'spec')
  }, [specUnit, basisTouched, prevUnits])

  // 단가·금액 양방향 자동계산 — 사용자가 마지막 입력한 쪽(priceMode)을 기준으로 나머지를 채운다.
  // 기준수량 = 수량 × (규격당 기준이면 규격). 단가만 알아도(금액만 알아도) 다른 쪽이 자동으로 채워진다. (오류신고 407567e6)
  useEffect(() => {
    const specFactor = specValue ? (Number(specValue) || 1) : 1
    const baseQ = (Number(qtyValue) || 1) * (unitBasis === 'spec' ? specFactor : 1)
    if (priceMode === 'unit') {
      const u = unitStr ? Number(unitStr) : undefined
      const next = u != null ? String(Math.round(u * baseQ)) : ''
      setAmountStr(prev => (prev === next ? prev : next))
    } else {
      const a = amountStr ? Number(amountStr) : undefined
      const next = a != null && baseQ > 0 ? String(Math.round(a / baseQ)) : ''
      setUnitStr(prev => (prev === next ? prev : next))
    }
  }, [qtyValue, specValue, unitStr, amountStr, priceMode, unitBasis])

  const numCls  = 'w-16 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const amtCls  = 'flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const textCls = 'w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  // 직전 구매 컨텍스트 프리필(운영자 요청 2026-07-06) — 규격·수량·단가 기준·단가까지, 전 품목 공통.
  // 규격이 품명에 섞여 '라면 20개 (박스)' 같은 별도 품목이 생기는 것을 없애는 장치:
  // 품목만 고르면 지난번 규격이 따라온다. 값은 전부 수정 가능.
  function applyLastContext(last: NonNullable<Awaited<ReturnType<typeof getLastItemUnits>>>) {
    setPrevUnits(last)
    if (last.specText) { setSpecTextMode(true); setSpecText(last.specText) }
    else if (last.specValue) setSpecValue(last.specValue)
    if (last.specUnit) setSpecUnit(last.specUnit)
    if (last.qtyUnit)  setQtyUnit(last.qtyUnit)
    if (last.qtyValue) setQtyValue(last.qtyValue)
    // 단가 기준은 직전 구매의 기준 그대로(장판을 10m당으로 계산했으면 계속 10m당) — 자동 추정이 덮지 않게 고정
    if (last.unitBasis) { setUnitBasis(last.unitBasis); setBasisTouched(true) }
    // 직전 단가 프리필 → 수량 입력만으로 금액 자동. 가격이 바뀌었으면 금액을 고치면 단가가 재역산된다.
    if (last.unitPrice != null) { setPriceMode('unit'); setUnitStr(String(last.unitPrice)) }
  }

  // '직접 입력'에서 기존 품목명을 타이핑/제안 선택한 경우에도 동일 프리필 — 칩 선택과 경로만 다를 뿐 같은 품목.
  const lastFetchedRef = useRef('')
  async function maybePrefillCustom(raw: string) {
    const label = raw.trim()
    if (!label || lastFetchedRef.current === label) return
    if (!detailSuggestions.includes(label)) return   // 기존 품목일 때만 (새 품명 타이핑 중 오발동 방지)
    lastFetchedRef.current = label
    const last = await getLastItemUnits(label)
    if (last) applyLastContext(last)
  }

  async function openPreset(label: string) {
    setActiveLabel(label)
    setSpecValue(''); setQtyValue(''); setAmountStr(''); setUnitStr(''); setPriceMode('amount'); setUnitBasis('spec'); setBasisTouched(false); setNoSpec(false); setSpecTextMode(false); setSpecText('')
    const def = ITEM_DEFAULTS[label]
    setSpecUnit(def?.specUnit ?? ''); setQtyUnit(def?.qtyUnit ?? '')
    setPrevUnits(null)
    setFetching(true)
    try {
      const last = await getLastItemUnits(label)
      if (last) applyLastContext(last)
      // 완전히 새로운 품목(과거 기록도 프리셋 기본값도 없음) → 단계별 입력 자동 안내
      if (!last && !def) setWizardOpen(true)
    } finally { setFetching(false) }
  }

  async function confirmAdd(label: string) {
    // 다른 카테고리의 재고 품목과 이름이 같으면 저장 전 확인 — 배너만으론 지나쳐 중복 품목이 생김(신규유저 감사 #12·종량제 사건)
    if (prevUnits && prevUnits.trackedCategories.length > 0 && !prevUnits.trackedCategories.includes(category)) {
      const ok = await confirmDialog({
        title: '카테고리가 다른 것 같아요',
        message: `'${label}'은(는) '${prevUnits.trackedCategories.join(', ')}' 카테고리의 재고 품목이에요. 지금 카테고리('${category}')로 저장하면 같은 이름의 품목이 하나 더 생깁니다. 그래도 진행할까요?`,
        confirmLabel: '이대로 저장', cancelLabel: '취소',
        level: 'caution',
      })
      if (!ok) return
    }
    // 유사한 기존 품명이 있으면 같은 품목인지 확인 (다른 제품일 수 있어 승인받기) (#B)
    let finalLabel = label
    const similar = findSimilarItemName(label, detailSuggestions)
    if (similar) {
      const useExisting = await confirmDialog({
        title: '비슷한 품목이 있어요',
        message: `이미 '${similar}'(으)로 쓰신 적이 있어요. 같은 품목인가요?\n(다른 제품이면 '새 품목으로' · 입력한 '${label}' 그대로 등록)`,
        confirmLabel: `'${similar}'로`,
        cancelLabel: '새 품목으로',
      })
      if (useExisting) finalLabel = similar
    }
    // 수량 미입력 → 자동 1개 (화면·detail·DB 표기 일관: "x 1개"). 단위도 비었으면 '개'.
    const noQty = qtyValue.trim() === ''
    const resolvedQty  = noQty ? '1' : qtyValue
    const resolvedUnit = noQty && qtyUnit.trim() === '' ? '개' : qtyUnit
    const q = Number(resolvedQty) || 1
    // 기준수량 = 수량 × (규격당 기준이면 규격). 개당 기준(장판 1롤당 등)이면 수량만.
    const baseQ = q * (unitBasis === 'spec' ? (specValue ? (Number(specValue) || 1) : 1) : 1)
    // 단가를 직접 입력했으면(priceMode='unit') 단가를 기준으로 금액 산출, 아니면 금액에서 단가 역산.
    let amount: number | undefined
    let unitPrice: number | undefined
    if (priceMode === 'unit' && unitStr) {
      unitPrice = Number(unitStr.replace(/[^0-9]/g, '')) || undefined
      amount = unitPrice != null ? Math.round(unitPrice * baseQ) : undefined
    } else {
      amount = amountStr ? Number(amountStr.replace(/[^0-9]/g, '')) : undefined
      unitPrice = amount != null && baseQ > 0 ? Math.round(amount / baseQ) : undefined
    }
    const data: ItemPickState = {
      label: finalLabel,
      specValue: specTextMode ? '' : specValue,
      specUnit:  specTextMode ? '' : specUnit,
      specText:  specTextMode && specText.trim() ? specText.trim() : undefined,
      qtyValue: resolvedQty, qtyUnit: resolvedUnit, amount, unitPrice,
      unitBasis: specTextMode ? 'qty' : unitBasis,   // 서술 규격은 계산 비관여 → 개당 단가
    }
    onChange([...items, data])
    setActiveLabel(null)
    setSpecValue(''); setQtyValue(''); setAmountStr(''); setUnitStr(''); setPriceMode('amount'); setUnitBasis('spec'); setBasisTouched(false); setCustomLabel('')
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  // 세트 의심 확인 — "1세트 = N개" 승인 시 규격으로 흡수(품명 분리 금지 원칙), 개당 단가로 전환
  function applySetHint(idx: number) {
    const it = items[idx]; const h = it.setHint
    if (!h) return
    const qty = Number(it.qtyValue) || 1
    patchItem(idx, {
      specValue: String(h.count), specUnit: '개',
      qtyUnit: !it.qtyUnit || it.qtyUnit === '개' ? '세트' : it.qtyUnit,
      unitBasis: 'spec',
      unitPrice: it.amount != null ? Math.round(it.amount / (qty * h.count)) : it.unitPrice,
      setHint: undefined,
    })
  }

  function patchItem(idx: number, patch: Partial<ItemPickState>) {
    onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  // 단가 기준 — 'spec'(규격당: 40개입 3박스 → 120개당) / 'qty'(완제품 1개당: 장판 1롤당).
  // 총 기준수량 = 수량 × (spec 기준이면 규격값). 단가 라벨을 눌러 기준 전환.
  const basisOf = (it: ItemPickState) => it.unitBasis ?? 'spec'
  const specMul = (it: { specValue?: string | number | null }) => it.specValue ? (Number(it.specValue) || 1) : 1
  const baseQtyOf = (it: ItemPickState) => (Number(it.qtyValue) || 1) * (basisOf(it) === 'spec' ? specMul(it) : 1)
  // 금액 입력 → 단가 자동(금액 ÷ 기준수량)
  function updateItemAmount(idx: number, raw: string) {
    const amount = raw ? Number(raw.replace(/[^0-9]/g, '')) : undefined
    const q = baseQtyOf(items[idx])
    patchItem(idx, { amount, unitPrice: amount != null && q > 0 ? Math.round(amount / q) : undefined })
  }
  // 단가 입력 → 금액 자동(단가 × 기준수량)
  function updateItemUnit(idx: number, raw: string) {
    const unitPrice = raw ? Number(raw.replace(/[^0-9]/g, '')) : undefined
    const q = baseQtyOf(items[idx])
    patchItem(idx, { unitPrice, amount: unitPrice != null ? Math.round(unitPrice * q) : items[idx].amount })
  }
  // 수량(박스 등) 변경 → 기준수량(수량×규격)으로 금액 재계산
  function updateItemQty(idx: number, raw: string) {
    const qtyValue = raw.replace(/[^0-9.]/g, '')
    const it = items[idx]
    // basis 인지 — 개당(qty) 기준이면 규격을 곱지 않음(baseQtyOf·updateItemSpec과 동일 규칙)
    const q = (Number(qtyValue) || 1) * (basisOf(it) === 'spec' ? specMul(it) : 1)
    if (it.unitPrice != null) patchItem(idx, { qtyValue, amount: Math.round(it.unitPrice * q) })
    else if (it.amount != null) patchItem(idx, { qtyValue, unitPrice: q > 0 ? Math.round(it.amount / q) : undefined })
    else patchItem(idx, { qtyValue })
  }
  // 규격(개입수 등) 변경 → 규격 오타 정정은 보통 결제 '금액'이 정답이므로 금액 고정·단가 재계산
  function updateItemSpec(idx: number, raw: string) {
    const specValue = raw.replace(/[^0-9.]/g, '')
    const it = items[idx]
    const q = (Number(it.qtyValue) || 1) * (basisOf(it) === 'spec' ? (specValue ? (Number(specValue) || 1) : 1) : 1)
    if (it.amount != null) patchItem(idx, { specValue, unitPrice: q > 0 ? Math.round(it.amount / q) : undefined })
    else if (it.unitPrice != null) patchItem(idx, { specValue, amount: Math.round(it.unitPrice * q) })
    else patchItem(idx, { specValue })
  }
  // 단가 기준 전환(규격당 ↔ 개당) — 금액은 그대로 두고 단가만 새 기준으로 재계산
  function toggleItemBasis(idx: number) {
    const it = items[idx]
    const next: 'spec' | 'qty' = basisOf(it) === 'spec' ? 'qty' : 'spec'
    const q = (Number(it.qtyValue) || 1) * (next === 'spec' ? specMul(it) : 1)
    patchItem(idx, { unitBasis: next, unitPrice: it.amount != null && q > 0 ? Math.round(it.amount / q) : it.unitPrice })
  }
  // 규격을 서술형(4x30mm 등)으로 능동 전환 — 이때만 숫자 규격을 비움(DB 공존 행은 자동삭제 금지, 영향검증 필수1).
  // 서술 규격은 계산 비관여 → 개당(qty) 기준 전환, 금액 유지·단가 재계산(피커 confirmAdd와 동일 규칙).
  function convertItemToTextSpec(idx: number) {
    const it = items[idx]
    const q = Number(it.qtyValue) || 1
    patchItem(idx, { specText: it.specText ?? '', specValue: '', specUnit: '', unitBasis: 'qty', unitPrice: it.amount != null && q > 0 ? Math.round(it.amount / q) : it.unitPrice })
  }
  // 방별 분배 — 켜면 한 줄(방 미지정+전체수량) 생성, 끄면 제거(방 분배 없음)
  function toggleAlloc(idx: number) {
    const it = items[idx]
    patchItem(idx, it.allocations ? { allocations: undefined } : { allocations: [{ roomId: '', qty: it.qtyValue || '1' }] })
  }
  function setAllocs(idx: number, allocs: { roomId: string; qty: string }[]) {
    patchItem(idx, { allocations: allocs })
  }

  const totalItemAmount = items.reduce((s, it) => s + (it.amount ?? 0), 0)

  const SpecQtyInputs = () => (
    <div className="space-y-2">
      {prevUnits && (prevUnits.specUnit || prevUnits.qtyUnit) && (
        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
          직전 사용:{' '}
          {prevUnits.specUnit && <span className="text-[var(--warm-mid)]">규격 {prevUnits.specUnit}</span>}
          {prevUnits.specUnit && prevUnits.qtyUnit && <span className="mx-1">·</span>}
          {prevUnits.qtyUnit && <span className="text-[var(--warm-mid)]">수량 {prevUnits.qtyUnit}</span>}
        </p>
      )}
      {/* 규격 없음(수량만) — 켜면 규격 입력을 숨겨 빈 칸 혼동을 없앤다 */}
      <div className="flex flex-wrap gap-x-4 gap-y-1">
        <label className="flex items-center gap-1.5 text-[0.65625rem] text-[var(--warm-muted)] cursor-pointer">
          <input type="checkbox" checked={noSpec}
            onChange={e => { setNoSpec(e.target.checked); if (e.target.checked) { setSpecTextMode(false); setSpecText(''); setSpecValue(''); setSpecUnit(''); if (!qtyUnit.trim()) setQtyUnit('개') } }}
            className="w-3 h-3 accent-[var(--coral)]" />
          규격 없음 (수량만 입력)
        </label>
        <label className="flex items-center gap-1.5 text-[0.65625rem] text-[var(--warm-muted)] cursor-pointer">
          <input type="checkbox" checked={specTextMode}
            onChange={e => { setSpecTextMode(e.target.checked); if (e.target.checked) { setNoSpec(false); setSpecValue(''); setSpecUnit(''); if (!qtyUnit.trim()) setQtyUnit('개') } else setSpecText('') }}
            className="w-3 h-3 accent-[var(--coral)]" />
          규격 직접 입력 (직경x길이·색상·사이즈 등)
        </label>
        <button type="button" onClick={() => setWizardOpen(true)}
          className="text-[0.65625rem] font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-2">
          단계별 입력
        </button>
      </div>
      <SpecWizard open={wizardOpen} onClose={() => setWizardOpen(false)} onComplete={applyWizard}
        itemLabel={activeLabel ?? customLabel ?? undefined} z={260} />
      <div className={`grid ${noSpec ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
        {specTextMode && (
        <div className="space-y-1">
          <label className="text-[0.65625rem] text-[var(--warm-muted)]">규격·세부스펙 <span className="font-normal">(직경x길이 등 치수 · 색상·사이즈, 단가 계산과 무관)</span></label>
          {(prevUnits?.specOptions?.length ?? 0) > 0 && (
            <div className="flex flex-wrap gap-1">
              {prevUnits!.specOptions.map(o => (
                <button key={o} type="button" onClick={() => setSpecText(specText === o ? '' : o)}
                  className={`px-2 py-1 text-[0.65625rem] rounded-md border transition-colors ${
                    specText === o
                      ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]'
                      : 'bg-[var(--cream)] border-[var(--warm-border)] text-[var(--warm-mid)] hover:border-[var(--coral)]'}`}>
                  {o}
                </button>
              ))}
            </div>
          )}
          <input type="text" placeholder="예: 4x30mm · 폭 183cm, 싱글/그레이" value={specText}
            onChange={e => setSpecText(e.target.value)} className={textCls} />
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">새로 입력한 세부스펙은 저장 시 자동으로 목록에 추가됩니다. 관리는 설정에서.</p>
        </div>
        )}
        {!noSpec && !specTextMode && (
        <div className="space-y-1">
          <label className="text-[0.65625rem] text-[var(--warm-muted)]">규격</label>
          <div className="flex gap-1">
            <input type="text" inputMode="decimal" placeholder="0" value={specValue}
              onChange={e => setSpecValue(e.target.value.replace(/[^0-9.]/g, ''))} className={numCls} />
            <UnitCombobox value={specUnit} onChange={setSpecUnit}
              options={SPEC_UNITS} placeholder="단위" />
          </div>
        </div>
        )}
        <div className="space-y-1">
          <label className="text-[0.65625rem] text-[var(--warm-muted)]">수량</label>
          <div className="flex gap-1">
            <input type="text" inputMode="decimal" placeholder="1" value={qtyValue}
              onChange={e => setQtyValue(e.target.value.replace(/[^0-9.]/g, ''))} className={numCls} />
            <UnitCombobox value={qtyUnit} onChange={setQtyUnit}
              options={QTY_UNITS} placeholder="단위" />
          </div>
        </div>
      </div>
      {allowMulti && (
        <div className="space-y-1">
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <button type="button" onClick={() => { setBasisTouched(true); setUnitBasis(b => b === 'spec' ? 'qty' : 'spec') }}
                title="단가 기준 전환 (규격당 ↔ 완제품 1개당)"
                className="block text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2">
                단가 (1{unitBasis === 'spec' && specValue ? (specUnit || '개') : (qtyUnit || '개')}당) · 탭하면 기준 전환<svg className="inline-block align-[-1px] ml-0.5" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 21l-4-4 4-4" /></svg>
              </button>
              <div className="flex gap-1 items-center">
                <input type="text" inputMode="numeric"
                  value={unitStr ? Number(unitStr).toLocaleString() : ''}
                  onChange={e => { setPriceMode('unit'); setUnitStr(e.target.value.replace(/[^0-9]/g, '')) }}
                  placeholder="0"
                  className={amtCls} />
                <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">원</span>
              </div>
            </div>
            <div className="space-y-1">
              <label className="text-[0.65625rem] text-[var(--warm-muted)]">금액 <span className="text-[var(--warm-muted)]">(이 품목 분)</span></label>
              <div className="flex gap-1 items-center">
                <input type="text" inputMode="numeric"
                  value={amountStr ? Number(amountStr.replace(/[^0-9]/g, '')).toLocaleString() : ''}
                  onChange={e => { setPriceMode('amount'); setAmountStr(e.target.value.replace(/[^0-9]/g, '')) }}
                  placeholder="0"
                  className={amtCls} />
                <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">원</span>
              </div>
            </div>
          </div>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">단가·금액 중 아는 값만 넣으면 나머지는 자동 계산돼요. 단가 라벨을 누르면 기준 전환(규격당 ↔ 완제품 1개당 · 장판 1롤당 등).</p>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-2">
      {/* 등록된 품목 — 수량·단가·금액(자동) + 선택적 방별 분배 */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((it, idx) => {
            const allocSum = (it.allocations ?? []).reduce((s, a) => s + (Number(a.qty) || 0), 0)
            const qtyN = Number(it.qtyValue) || 0
            const allocRemain = Math.round((qtyN - allocSum) * 100) / 100   // 미지정(예비) 나머지
            const allocOver = !!it.allocations && qtyN > 0 && allocSum - qtyN > 0.001   // 초과 배정만 오류
            const smallNum = 'bg-[var(--cream)] border border-[var(--coral)]/30 rounded-sm px-1.5 py-0.5 text-xs text-[var(--warm-dark)] text-right outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none'
            return (
              <div key={idx} className="px-2.5 py-2 bg-[var(--coral-pale)] rounded-xl ring-1 ring-[var(--coral)]/20 space-y-1.5">
                <div className="flex items-center gap-2">
                  {/* 품명 수정 가능 — 영수증 OCR이 뽑은 긴 쇼핑몰 품명을 등록 상태에서 바로 다듬게(운영자 지시 2026-07-13).
                      스타일은 이 카드의 조밀 입력 문법(smallNum: cream bg+coral/30 보더)과 동일 — 형제 입력(수량·규격·단가)과 한 문법. */}
                  <input type="text" value={it.label}
                    onChange={e => patchItem(idx, { label: e.target.value })}
                    aria-label="품명 수정" placeholder="품명"
                    className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--coral)]/30 rounded-sm px-1.5 py-0.5 text-xs font-medium text-[var(--coral)] outline-none focus:border-[var(--coral)] transition-colors" />
                  <button type="button" onClick={() => removeItem(idx)} className="text-[var(--coral)] hover:text-[var(--danger-fg)] leading-none text-sm shrink-0"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                </div>
                {it.setHint && !(Number(it.specValue) > 1) && (
                  <div className="flex items-center gap-1.5 flex-wrap rounded-lg bg-[var(--cream)] ring-1 ring-[var(--coral)]/30 px-2 py-1.5">
                    <span className="text-[0.65625rem] text-[var(--warm-dark)] flex-1 min-w-[8rem]">
                      {it.setHint.basis === 'price'
                        ? `단가가 평소(${fmtWon(it.setHint.histUnit ?? 0)}/개)의 ${it.setHint.count}배예요. 1세트에 ${it.setHint.count}개입인가요?`
                        : `표기상 ${it.setHint.count}개입 세트로 보여요. 실물 ${it.setHint.count}개 맞나요?`}
                    </span>
                    <button type="button" onClick={() => applySetHint(idx)}
                      className="px-2 py-1 text-[0.65625rem] font-medium rounded-md bg-[var(--coral)] text-[var(--on-solid)]">
                      네, {it.setHint.count}개입{it.setHint.perPiece > 0 ? ` (개당 ${fmtWon(it.setHint.perPiece)})` : ''}
                    </button>
                    <button type="button" onClick={() => patchItem(idx, { setHint: undefined })}
                      className="px-2 py-1 text-[0.65625rem] rounded-md border border-[var(--warm-border)] text-[var(--warm-muted)]">
                      아니요
                    </button>
                  </div>
                )}
                {allowMulti && (
                  <div className="flex items-end gap-1.5 flex-wrap">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[0.65625rem] text-[var(--warm-muted)]">수량</span>
                      <div className="flex items-center gap-0.5">
                        <input type="text" inputMode="decimal" value={it.qtyValue}
                          onChange={e => updateItemQty(idx, e.target.value)} placeholder="1"
                          className={`w-12 ${smallNum}`} />
                        {it.qtyUnit && <span className="text-[0.65625rem] text-[var(--warm-muted)]">{it.qtyUnit}</span>}
                      </div>
                    </label>
                    {/* 규격 — 수정 가능. 서술형(specText) 전용 행은 숫자 셀 숨김, DB 공존 행은 병기(숫자 자동삭제 금지).
                        라벨 탭 = 서술형 규격(4x30mm 등)으로 전환(단가 라벨의 점선 전환 문법과 동일). */}
                    {(it.specText == null || it.specValue) && (<>
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] pb-1.5">×</span>
                    <label className="flex flex-col gap-0.5">
                      {it.specText == null ? (
                        <button type="button" onClick={() => convertItemToTextSpec(idx)}
                          title="규격을 직접 입력(직경x길이 등 치수)으로 전환"
                          className="text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2 text-left">규격</button>
                      ) : (
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">규격</span>
                      )}
                      <div className="flex items-center gap-0.5">
                        <input type="text" inputMode="decimal" value={it.specValue}
                          onChange={e => updateItemSpec(idx, e.target.value)} placeholder="—"
                          className={`w-12 ${smallNum}`} />
                        {it.specUnit && <span className="text-[0.65625rem] text-[var(--warm-muted)]">{it.specUnit}</span>}
                      </div>
                    </label>
                    </>)}
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] pb-1.5">×</span>
                    <label className="flex flex-col gap-0.5">
                      <button type="button" onClick={() => toggleItemBasis(idx)} title="단가 기준 전환 (규격당 ↔ 완제품 1개당)"
                        className="text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2 text-left">
                        단가/1{basisOf(it) === 'spec' && it.specValue ? (it.specUnit || '개') : (it.qtyUnit || '개')}<svg className="inline-block align-[-1px] ml-0.5" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h13M13 3l4 4-4 4M20 17H7M11 21l-4-4 4-4" /></svg>
                      </button>
                      <div className="flex items-center gap-0.5">
                        <input type="text" inputMode="numeric" value={it.unitPrice ? it.unitPrice.toLocaleString() : ''}
                          onChange={e => updateItemUnit(idx, e.target.value)} placeholder="0"
                          className={`w-20 ${smallNum}`} />
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">원</span>
                      </div>
                    </label>
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] pb-1.5">=</span>
                    <label className="flex flex-col gap-0.5 flex-1 min-w-[5rem]">
                      <span className="text-[0.65625rem] text-[var(--warm-muted)]">금액</span>
                      <div className="flex items-center gap-0.5">
                        <input type="text" inputMode="numeric" value={it.amount ? it.amount.toLocaleString() : ''}
                          onChange={e => updateItemAmount(idx, e.target.value)} placeholder="0"
                          className={`flex-1 w-full ${smallNum}`} />
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">원</span>
                      </div>
                    </label>
                  </div>
                )}
                {allowMulti && it.specText != null && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">규격(직접)</span>
                    <input type="text" value={it.specText}
                      onChange={e => patchItem(idx, { specText: e.target.value })}
                      placeholder="예: 4x30mm"
                      className={`flex-1 min-w-0 ${smallNum} text-left`} />
                    <button type="button" onClick={() => patchItem(idx, { specText: undefined })}
                      className="text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2 shrink-0">숫자 규격으로</button>
                  </div>
                )}
                {allowMulti && rooms.length > 0 && (
                  <div>
                    <button type="button" onClick={() => toggleAlloc(idx)}
                      className={`text-[0.65625rem] px-1.5 py-0.5 rounded-md border transition-colors ${it.allocations ? 'border-[var(--coral)] text-[var(--coral)] bg-[var(--coral)]/5' : 'border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--coral)]'}`}>
                      {it.allocations ? '방별 분배 끄기' : '방별로 나누기 (선택)'}
                    </button>
                    {it.allocations && (
                      <div className="mt-1.5 space-y-1 border-t border-[var(--coral)]/20 pt-1.5">
                        {it.allocations.map((a, ai) => (
                          <div key={ai} className="flex items-center gap-1.5">
                            <select value={a.roomId}
                              onChange={e => setAllocs(idx, it.allocations!.map((x, i) => i === ai ? { ...x, roomId: e.target.value } : x))}
                              className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--coral)]/30 rounded-sm px-1.5 py-0.5 text-xs text-[var(--warm-dark)] outline-none">
                              <option value="">방 선택…</option>
                              {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                            </select>
                            <input type="text" inputMode="decimal" value={a.qty} placeholder="수량"
                              onChange={e => setAllocs(idx, it.allocations!.map((x, i) => i === ai ? { ...x, qty: e.target.value.replace(/[^0-9.]/g, '') } : x))}
                              className={`w-14 ${smallNum}`} />
                            <button type="button" onClick={() => setAllocs(idx, it.allocations!.filter((_, i) => i !== ai))}
                              className="text-[var(--warm-muted)] hover:text-[var(--danger-fg)] text-sm shrink-0"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                          </div>
                        ))}
                        <div className="flex items-center justify-between">
                          <button type="button" onClick={() => setAllocs(idx, [...it.allocations!, { roomId: '', qty: '' }])}
                            className="text-[0.65625rem] text-[var(--coral)] hover:underline">+ 방 추가</button>
                          <span className={`text-[0.65625rem] ${allocOver ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'}`}>
                            방 배정 {allocSum} / 전체 {it.qtyValue || 0}
                            {allocOver ? ' · 수량 초과' : allocRemain > 0.001 ? ` · 나머지 ${allocRemain}개 미배정` : ''}
                          </span>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
          {allowMulti && items.length > 1 && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] text-right">
              합계 {fmtWon(totalItemAmount)}
            </p>
          )}
        </div>
      )}

      {/* 품목 추가 버튼들 — 다중 모드면 항상, 단일 모드면 비어있을 때만 */}
      {!activeLabel && (allowMulti || items.length === 0) && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map(label => (
            <button key={label} type="button" onClick={() => openPreset(label)}
              className="px-3 py-1.5 text-xs rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors">
              + {label}
            </button>
          ))}
          <button type="button" onClick={() => { setActiveLabel('__custom__'); setSpecUnit(''); setQtyUnit('') }}
            className="px-3 py-1.5 text-xs rounded-lg bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors">
            + 직접 입력
          </button>
        </div>
      )}

      {activeLabel && activeLabel !== '__custom__' && (
        <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--warm-dark)]">
              {activeLabel}{fetching && <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">단위 불러오는 중…</span>}
            </span>
            <button type="button" onClick={() => setActiveLabel(null)}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-sm leading-none"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          {prevUnits && prevUnits.trackedCategories.length > 0 && !prevUnits.trackedCategories.includes(category) && (
            <p className="text-[0.6875rem] text-[var(--warning-fg)] bg-[var(--warning-bg)] rounded-lg px-2.5 py-1.5">
              이 품목은 &lsquo;{prevUnits.trackedCategories.join(', ')}&rsquo; 카테고리의 재고 품목이에요. 지금 카테고리(&lsquo;{category}&rsquo;)로 저장하면 같은 이름의 품목이 하나 더 생깁니다. 카테고리를 확인해 주세요.
            </p>
          )}
          {SpecQtyInputs()}
          <Btn variant="primary" size="sm" fullWidth onClick={() => confirmAdd(activeLabel)}>추가</Btn>
        </div>
      )}

      {activeLabel === '__custom__' && (
        <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--warm-dark)]">직접 입력</span>
            <button type="button" onClick={() => setActiveLabel(null)}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-sm leading-none"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
          </div>
          <div className="space-y-1">
            <label className="text-[0.65625rem] text-[var(--warm-muted)]">품목명</label>
            <input type="text" placeholder="예: 고추장" value={customLabel}
              onChange={e => { setCustomLabel(e.target.value); maybePrefillCustom(e.target.value) }}
              onBlur={e => maybePrefillCustom(e.target.value)} className={textCls}
              list="item-detail-suggestions" />
            {detailSuggestions.length > 0 && (
              <datalist id="item-detail-suggestions">{detailSuggestions.map(d => <option key={d} value={d} />)}</datalist>
            )}
          </div>
          {SpecQtyInputs()}
          <Btn variant="primary" size="sm" fullWidth onClick={() => { if (customLabel.trim()) confirmAdd(customLabel.trim()) }}>
            추가
          </Btn>
        </div>
      )}
    </div>
  )
}


// 구매처 정리 — 이력 기반 자동완성(B)에 쌓인 구매처의 오타·중복을 이름변경/합치기/비우기로 정돈.
function VendorManageModal({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const [dirty, setDirty] = useState(false)   // v2.0 §12 — 이름 수정 시작 후 닫기 보호
  const [rows, setRows] = useState<{ vendor: string; count: number }[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  // 합치기 — 전 앱 정본 문법(v2.0 §22·v2.0 §23): 행 꾹(또는 '선택') → 다중 선택 → 하단 알약 '합치기'
  // → MergeSheet에서 대표 선택. 행별 '합치기' 버튼도 병행(자재 카드별 합치기와 동일). 서버는 renameVendor 재사용.
  const [selMode, setSelMode] = useState(false)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const press = useLongPress()
  const exitSel = () => { setSelMode(false); setSel(new Set()) }
  const toggleSel = (v: string) => setSel(p => { const n = new Set(p); if (n.has(v)) n.delete(v); else n.add(v); return n })
  const [sheet, setSheet] = useState<{ sourceLabel: string; sources: string[]; targets: { id: string; label: string }[] } | null>(null)
  const [merging, setMerging] = useState(false)
  const runMerge = async (destVendor: string) => {
    if (!sheet) return
    const sources = sheet.sources.filter(v => v !== destVendor)
    setMerging(true)
    const release = trackSave()
    try {
      let total = 0
      for (const v of sources) {
        const res = await renameVendor(v, destVendor)
        if (!res.ok) { pushToast('error', res.error); return }
        total += res.updated
      }
      pushToast('success', `'${destVendor}'(으)로 합침 · 지출 ${total}건 반영`)
      setSheet(null); exitSel(); await load(); onChanged()
    } finally { release(); setMerging(false) }
  }
  const load = () => getVendorUsage().then(setRows)
  useEffect(() => { load() }, [])

  const apply = async (oldName: string, rawNew: string) => {
    const newName = rawNew.trim()
    if (newName === oldName) return
    if (newName === '' && !(await confirmDialog({ title: `'${oldName}' 구매처를 비울까요?`, message: '해당 지출들의 구매처 표시가 사라집니다. 지출 자체는 유지됩니다.', level: 'caution', confirmLabel: '비우기' }))) return
    setBusy(oldName)
    const release = trackSave()
    try {
      const res = await renameVendor(oldName, newName)
      if (res.ok) {
        pushToast('success', newName ? `'${oldName}' → '${newName}' (${res.updated}건 반영)` : `'${oldName}' 구매처 비움 (${res.updated}건)`)
        setEdits(p => { const n = { ...p }; delete n[oldName]; return n })
        await load(); onChanged()
      } else pushToast('error', res.error)
    } finally { release(); setBusy(null) }
  }

  return (
    <Modal open onClose={onClose} title="구매처 관리"
      subtitle="이름을 고치면 표기만 바뀝니다. 합치기는 합칠 구매처들을 선택한 뒤 남을 대표를 고르는 방식입니다. 비우면 그 지출들의 구매처 표시가 사라집니다."
      width="md" dirty={dirty}>
      <div className="px-5 py-3 space-y-1.5" onInput={() => requestAnimationFrame(() => setDirty(true))}>
          {rows === null ? (
            <SkeletonRows rows={4} className="py-2" />
          ) : rows.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">등록된 구매처가 없습니다.</p>
          ) : rows.map(r => {
            const val = edits[r.vendor] ?? r.vendor
            const changed = val.trim() !== r.vendor
            const checked = sel.has(r.vendor)
            return (
              <div key={r.vendor}
                className={`flex items-center gap-1.5 rounded-lg select-none ${selMode ? 'cursor-pointer -mx-1 px-1 py-0.5' : ''} ${checked ? 'bg-[var(--coral)]/5 ring-1 ring-inset ring-[var(--coral)]/30' : ''}`}
                onClick={selMode ? () => toggleSel(r.vendor) : undefined}
                {...press(!selMode ? () => { setSelMode(true); setSel(new Set([r.vendor])) } : undefined)}
              >
                {selMode && (
                  <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-sm border transition-colors ${checked ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)] bg-[var(--cream)]'}`}>
                    {checked && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>}
                  </span>
                )}
                {selMode ? (
                  <span className="flex-1 min-w-0 truncate py-1.5 text-sm text-[var(--warm-dark)]">{r.vendor}</span>
                ) : (
                  <input type="text" value={val} onChange={e => setEdits(p => ({ ...p, [r.vendor]: e.target.value }))}
                    className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                )}
                <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0 w-9 text-right">{r.count}건</span>
                {!selMode && (
                  <>
                    <button type="button" disabled={busy === r.vendor || !changed} onClick={() => apply(r.vendor, val)}
                      className="text-xs px-2 py-1 rounded-lg bg-[var(--coral)] text-[var(--on-solid)] disabled:opacity-30 shrink-0">저장</button>
                    <button type="button" disabled={busy === r.vendor}
                      onClick={() => { setSelMode(true); setSel(new Set([r.vendor])); pushToast('info', '합칠 구매처를 더 선택한 뒤 아래 합치기를 누르세요. 대표(남을 이름)는 다음 화면에서 고릅니다.') }}
                      className="text-xs px-1.5 py-1 shrink-0 text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">합치기</button>
                    <button type="button" disabled={busy === r.vendor} onClick={() => apply(r.vendor, '')}
                      className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-1.5 py-1 shrink-0" title="구매처 비우기">비움</button>
                  </>
                )}
              </div>
            )
          })}
      </div>
      {/* 선택 토글 — v2.0 §23 정본(버튼 + 행 꾹 누르기 병행) */}
      <div className="px-5 pb-3 -mt-1 flex justify-end">
        <Btn type="button" variant="secondary" size="sm" onClick={() => selMode ? exitSel() : setSelMode(true)}>
          {selMode ? '선택 취소' : '선택'}
        </Btn>
      </div>
      {selMode && sel.size > 0 && (
        <SelectionPillBar count={sel.size} unit="곳" onClose={exitSel} aboveModal>
          <PillButton primary disabled={sel.size < 2 || merging}
            onClick={() => setSheet({
              sourceLabel: `선택 ${sel.size}곳`,
              sources: [...sel],
              targets: (rows ?? []).filter(x => sel.has(x.vendor)).map(x => ({ id: x.vendor, label: `${x.vendor} (${x.count}건)` })),
            })}>
            합치기
          </PillButton>
        </SelectionPillBar>
      )}
      <MergeSheet open={!!sheet} z={260} onClose={() => setSheet(null)} pending={merging}
        sourceLabel={sheet?.sourceLabel ?? ''} targets={sheet?.targets ?? []}
        title="구매처 합치기" confirmLabel="합치기"
        description="대표로 남길 구매처를 고르면 나머지 지출의 구매처가 대표로 바뀝니다."
        onConfirm={runMerge} />
    </Modal>
  )
}

const PAY_METHODS_EXP    = ['계좌이체', '신용카드', '체크카드', '현금', '기타']
// 부가 수익 전용 입금수단 — '보유 보증금'은 보증금 카테고리에서 선택 가능 (다른 카테고리/모달엔 노출 X)
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  BANK_ACCOUNT: '은행계좌', CREDIT_CARD: '신용카드', DEBIT_CARD: '체크카드', PREPAID: '선불/상품권',
}

const PREPAID_BRANDS: { name: string; domain: string }[] = [
  { name: '네이버페이머니',   domain: 'pay.naver.com' },
  { name: '카카오페이머니',   domain: 'kakaopay.com' },
  { name: '토스머니',         domain: 'toss.im' },
  { name: '쿠팡캐시',         domain: 'coupang.com' },
  { name: '서울페이',         domain: 'seoulpay.kr' },
  { name: '제로페이',         domain: 'zeropay.or.kr' },
  { name: '페이코',           domain: 'payco.com' },
  { name: 'SSG머니',          domain: 'ssg.com' },
  { name: '삼성페이머니',     domain: 'samsung.com' },
  { name: '하나머니',         domain: 'hanabank.com' },
  { name: 'KB Pay',           domain: 'kbstar.com' },
  { name: 'NH페이',           domain: 'nonghyup.com' },
  { name: '우리페이',         domain: 'wooribank.com' },
  { name: 'BC페이북',         domain: 'bccard.com' },
  { name: '롯데캐시',         domain: 'lotteon.com' },
  { name: '11페이',           domain: '11st.co.kr' },
  { name: '스타벅스카드',     domain: 'starbucks.co.kr' },
  { name: 'GS&POINT',         domain: 'gsfresh.com' },
  { name: '티머니',           domain: 'tmoney.co.kr' },
  { name: '코레일페이',       domain: 'letskorail.com' },
]

const BANKS: { name: string; domain: string }[] = [
  { name: '신한은행',       domain: 'shinhan.com' },
  { name: 'KB국민은행',     domain: 'kbstar.com' },
  { name: '하나은행',       domain: 'hanabank.com' },
  { name: '우리은행',       domain: 'wooribank.com' },
  { name: 'NH농협은행',     domain: 'nonghyup.com' },
  { name: 'IBK기업은행',    domain: 'ibk.co.kr' },
  { name: 'SC제일은행',     domain: 'standardchartered.co.kr' },
  { name: '씨티은행',       domain: 'citibank.co.kr' },
  { name: '카카오뱅크',     domain: 'kakaobank.com' },
  { name: '케이뱅크',       domain: 'kbanknow.com' },
  { name: '토스뱅크',       domain: 'tossbank.com' },
  { name: '부산은행',       domain: 'busanbank.co.kr' },
  { name: '경남은행',       domain: 'knbank.co.kr' },
  { name: '광주은행',       domain: 'kjbank.com' },
  { name: '전북은행',       domain: 'jbbank.co.kr' },
  { name: '제주은행',       domain: 'jejubank.co.kr' },
  { name: '대구은행',       domain: 'dgb.co.kr' },
  { name: '수협은행',       domain: 'suhyup.co.kr' },
  { name: '우체국예금',     domain: 'epostbank.go.kr' },
  { name: '새마을금고',     domain: 'kfcc.co.kr' },
  { name: '신협',           domain: 'cu.co.kr' },
  { name: '삼성증권',       domain: 'samsungpop.com' },
  { name: '미래에셋증권',   domain: 'miraeasset.com' },
  { name: 'NH투자증권',     domain: 'nhqv.com' },
  { name: '한국투자증권',   domain: 'truefriend.com' },
  { name: '키움증권',       domain: 'kiwoom.com' },
  { name: 'KB증권',         domain: 'kbsec.com' },
  { name: '신한투자증권',   domain: 'shinhaninvest.com' },
  { name: '하나증권',       domain: 'hanaw.com' },
  { name: '메리츠증권',     domain: 'meritz.co.kr' },
  { name: '대신증권',       domain: 'daishin.co.kr' },
  { name: '유안타증권',     domain: 'yuanta.co.kr' },
  { name: 'LS증권',         domain: 'ls-sec.co.kr' },
  { name: '현대차증권',     domain: 'hmsec.com' },
  { name: '교보증권',       domain: 'iprovest.com' },
  { name: 'BNK투자증권',    domain: 'bnkfn.co.kr' },
]

const CREDIT_CARDS: { name: string; domain: string }[] = [
  { name: '신한카드',       domain: 'shinhancard.com' },
  { name: 'KB국민카드',     domain: 'kbcard.com' },
  { name: '삼성카드',       domain: 'samsungcard.com' },
  { name: '현대카드',       domain: 'hyundaicard.com' },
  { name: '롯데카드',       domain: 'lottecard.co.kr' },
  { name: '우리카드',       domain: 'wooricard.com' },
  { name: '하나카드',       domain: 'hanacard.co.kr' },
  { name: 'BC카드',         domain: 'bccard.com' },
  { name: 'NH농협카드',     domain: 'nhcard.co.kr' },
  { name: '카카오페이카드', domain: 'kakaopay.com' },
  { name: '토스카드',       domain: 'toss.im' },
  { name: '씨티카드',       domain: 'citibank.co.kr' },
]

const DEBIT_CARDS: { name: string; domain: string }[] = [
  { name: '신한카드',   domain: 'shinhancard.com' },
  { name: 'KB국민카드', domain: 'kbcard.com' },
  { name: '하나카드',   domain: 'hanacard.co.kr' },
  { name: '우리카드',   domain: 'wooricard.com' },
  { name: 'NH농협카드', domain: 'nhcard.co.kr' },
  { name: 'BC카드',     domain: 'bccard.com' },
  { name: '신한은행',   domain: 'shinhan.com' },
  { name: 'KB국민은행', domain: 'kbstar.com' },
  { name: '하나은행',   domain: 'hanabank.com' },
  { name: '우리은행',   domain: 'wooribank.com' },
  { name: 'NH농협은행', domain: 'nonghyup.com' },
  { name: 'IBK기업은행',domain: 'ibk.co.kr' },
  { name: '카카오뱅크', domain: 'kakaobank.com' },
  { name: '케이뱅크',   domain: 'kbanknow.com' },
  { name: '토스뱅크',   domain: 'tossbank.com' },
]

const ALL_BRANDS = [...BANKS, ...CREDIT_CARDS, ...DEBIT_CARDS]

const FIN_WIDTHS_KEY = 'stayeum_finance_col_widths'

const DEFAULT_FIN_WIDTHS: Record<string, number> = {
  expDate: 120, expMethod: 120, expCategory: 110, expDetail: 200, expAmount: 100, expSettle: 110,
  incDate: 120, incMethod: 120, incCategory: 110, incDetail: 200, incAmount: 100,
}

function loadFinWidths(): Record<string, number> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(FIN_WIDTHS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

function getBrandDomain(name: string): string | null {
  return ALL_BRANDS.find(b => b.name === name)?.domain ?? null
}

function BrandLogo({ name, size = 18 }: { name: string; size?: number }) {
  const domain = getBrandDomain(name)
  if (!domain) return null
  return (
    <img
      src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
      width={size} height={size}
      className="rounded-sm object-contain shrink-0"
      alt=""
    />
  )
}

// ── Chart Components ─────────────────────────────────────────────

function DonutChart({
  segments, centerLabel, centerSub, size = 130, strokeWidth = 20,
}: {
  segments: { value: number; color: string }[]
  centerLabel?: string; centerSub?: string; size?: number; strokeWidth?: number
}) {
  const r = (size - strokeWidth) / 2
  const cx = size / 2; const cy = size / 2
  const C = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  let cumulativeAngle = -90
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--cream-3)" strokeWidth={strokeWidth} />
      ) : (
        segments.filter(s => s.value > 0).map((seg, i) => {
          const pct = seg.value / total
          const dashLength = pct * C
          const angle = cumulativeAngle
          cumulativeAngle += pct * 360
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${C - dashLength}`}
              transform={`rotate(${angle}, ${cx}, ${cy})`} />
          )
        })
      )}
      {centerLabel && <text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="var(--ink-2)">{centerLabel}</text>}
      {centerSub && <text x={cx} y={cy + 19} textAnchor="middle" fontSize="10" fill="var(--neutral-fg)">{centerSub}</text>}
    </svg>
  )
}

function StackedBar({
  segments, total, maxTotal, label, sublabel, colorMap,
}: {
  segments: { category: string; amount: number }[]
  total: number; maxTotal: number; label: string; sublabel?: string
  colorMap: Record<string, string>
}) {
  const barPct = maxTotal > 0 ? (total / maxTotal) * 100 : 0
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 shrink-0">
        <span className="text-[0.6875rem] font-medium text-[var(--warm-dark)] leading-tight block">{label}</span>
        {sublabel && <span className="text-[0.65625rem] text-[var(--warm-muted)] leading-tight block">{sublabel}</span>}
      </div>
      <div className="flex-1 bg-[var(--canvas)] rounded-full h-4 overflow-hidden">
        {total > 0 ? (
          <div className="h-full flex rounded-full overflow-hidden" style={{ width: `${barPct}%` }}>
            {segments.filter(s => s.amount > 0).map((s, i) => (
              <div key={i}
                style={{ background: colorMap[s.category] ?? chartColor(i), width: `${(s.amount / total) * 100}%` }} />
            ))}
          </div>
        ) : (
          <div className="h-full w-0" />
        )}
      </div>
      <span className="text-[0.6875rem] font-medium text-[var(--warm-dark)] num w-16 text-right shrink-0">
        {total > 0 ? fmtKorMoney(total) : '—'}
      </span>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────

// 영수증 사진을 OCR 전송용으로 압축 — Server Action 페이로드 한도(10MB) 회피
// HEIC/HEIF는 createImageBitmap이 처리 가능 (iOS Safari 17+).
// EXIF orientation 적용 — Safari/Chrome 기본값 차이 회피 (모바일 카메라 사진 일관성).
async function compressImageForOcr(
  file: File, maxDim: number, quality: number,
): Promise<{ base64: string; dataUrl: string }> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
  const w = bitmap.width
  const h = bitmap.height
  const scale = Math.min(1, maxDim / Math.max(w, h))
  const targetW = Math.max(1, Math.round(w * scale))
  const targetH = Math.max(1, Math.round(h * scale))
  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas 2D 컨텍스트를 만들 수 없습니다.')
  ctx.drawImage(bitmap, 0, 0, targetW, targetH)
  bitmap.close?.()
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  const base64  = dataUrl.replace(/^data:image\/jpeg;base64,/, '')
  if (!base64) throw new Error('이미지 인코딩 결과가 비어 있습니다.')
  return { base64, dataUrl }
}

// 영수증 스캔(모서리 인식·원근 보정)은 공용 components/ReceiptScanModal 로 이동 — 홈 찍어올리기와 공유
function toDateInput(d: Date | string | null | undefined) {
  if (!d) return ''
  return kstYmdStr(new Date(d))
}


function accName(a: FAcc | { brand: string; alias: string | null } | null) {
  if (!a) return ''
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}

function displayDay(day: number | null) {
  if (!day || day >= 31) return '말일'
  return `${day}일`
}


// ── Main Component ────────────────────────────────────────────────

type Tab = 'expense' | 'assets' | 'deposit' | 'reserve'

// 예비비 거래 (server에서 props로 전달)
type ReserveTxn = {
  id: string
  type: 'DEPOSIT' | 'WITHDRAW_DIRECT' | 'WITHDRAW_FROM_EXPENSE'
  amount: number
  date: Date
  sourceMonth: string | null
  category: string | null
  memo: string | null
  expenseId: string | null
  expense: { id: string; date: Date; amount: number; category: string; detail: string | null } | null
  linkedAccountId: string | null
  linkedAccount: { id: string; type: string; brand: string; alias: string | null } | null
}
type SettleableExpense = {
  id: string; date: Date; amount: number; category: string; detail: string | null
  settledSum: number; remaining: number
}
type DepositPerTenant = {
  leaseTermId: string; tenantId: string; tenantName: string
  roomNo: string | null; status: string
  contractDeposit: number; totalIn: number; totalReturned: number; totalWithheld: number; balance: number
  hasNoInRecord: boolean
}
type DepositLedgerEntry = {
  type: 'IN' | 'REFUND'; date: Date; amount: number
  returnedAmount?: number; withheldAmount?: number; reason?: string | null
  memo: string | null; tenantId: string; tenantName: string
  roomNo: string | null; leaseTermId: string
}

type CategoryTotal = { category: string; total: number }

export default function FinanceClient({
  expenses, incomes, financialAccounts, incomeCategories, expenseCategories, paymentMethods, targetMonth, recurringExpensesWithStatus, rooms, prevMonth, prevMonthTotals, lastYearMonth, lastYearTotals, acquisitionDate, detailSuggestions, vendorSuggestions,
  reserveBalance, reserveMonthly, reserveTxns, settleableExpenses, lastPayDefaults,
  depositSummary, depositLedger, trackedCategories,
  initialTab,
}: {
  expenses: Expense[]
  incomes: Income[]
  financialAccounts: FinancialAccount[]
  incomeCategories: string[]
  expenseCategories: string[]
  paymentMethods: string[]
  targetMonth: string
  recurringExpensesWithStatus: RecurringExpenseWithStatus[]
  rooms: { id: string; roomNo: string }[]
  prevMonth: string
  prevMonthTotals: CategoryTotal[]
  lastYearMonth: string
  lastYearTotals: CategoryTotal[]
  acquisitionDate: string | null
  detailSuggestions: string[]
  vendorSuggestions: string[]
  reserveBalance: number
  reserveMonthly: { deposit: number; withdraw: number; depositFromThisMonthRevenue: number }
  reserveTxns: ReserveTxn[]
  settleableExpenses: SettleableExpense[]
  lastPayDefaults: { payMethod: string | null; financialAccountId: string | null; financeName: string | null } | null
  depositSummary: DepositPerTenant[]
  depositLedger: DepositLedgerEntry[]
  trackedCategories: string[]   // 재고 추적 카테고리(부식·소모품·폐기물 등). 그 외 물품은 비품·자재(수령 후 배정)
  initialTab?: Tab
}) {
  const canEditUi = useCanEdit()   // 뷰어(STAFF) 편집 버튼 숨김(감사 D3)
  const router = useRouter()
  const [tab, setTab] = useState<Tab>(initialTab ?? 'expense')

  // 대시보드에서 ?tab=…로 진입했을 때 탭 영역으로 스크롤
  useEffect(() => {
    if (!initialTab) return
    const el = document.getElementById('finance-tabs')
    if (el) {
      requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
    }
    // 최초 진입 시 1회만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [finColWidths, setFinColWidths] = useState<Record<string, number>>(DEFAULT_FIN_WIDTHS)
  const finColWidthsRef                 = useRef<Record<string, number>>(DEFAULT_FIN_WIDTHS)

  // ── 지출 탭 상태 ─────────────────────────────────────────────
  const [expFilter, setExpFilter] = useState({ method: 'all', category: 'all', finance: 'all', roomId: 'all', kind: 'all' })
  const [expAmountMin, setExpAmountMin] = useState<number | undefined>(undefined)
  const [expAmountMax, setExpAmountMax] = useState<number | undefined>(undefined)
  const [showExpFilters, setShowExpFilters] = useState(false)   // 검색창 옆 필터 토글(정본 §23 호실관리 패턴)
  const [expListSearch, setExpListSearch] = useState('')   // 이번 달 목록 인라인 검색(v2.0 §23) — '과거 내역 검색'(전 기간 서버)과 별개
  // 미확인 고정 지출 가시성: 'all' = 전체, 'soon' = 결제일 D-3 이내(과거 도래 포함)만
  // 하이드레이션 #418 방지(서버 기본값 + 마운트 후 복원, 오류신고 5489fac1).
  const [recVisibility, setRecVisibility] = useState<'all' | 'soon'>('soon')
  useEffect(() => {
    const v = localStorage.getItem('stayeum-rec-visibility')
    if (v === 'all' || v === 'soon') setRecVisibility(v)
  }, [])
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('stayeum-rec-visibility', recVisibility)
  }, [recVisibility])
  const [showAddExp, setShowAddExp]       = useState(false)
  const [addExpDirty, setAddExpDirty] = useState(false)   // v2.0 §12 — 지출 등록 폼 입력 보호
  const [addExpDate, setAddExpDate]       = useState(() => kstYmdStr())
  const [detailExp, setDetailExp]         = useState<Expense | null>(null)
  const [detailExpEdit, setDetailExpEdit] = useState(false)
  const [expEditDirty, setExpEditDirty] = useState(false)   // v2.0 §12 — 지출 수정 폼 입력 보호
  // 방별 분배 묶음 펼침 — 멤버 행 목록(각 방별 금액). null 이면 닫힘.
  const [groupDetail, setGroupDetail]     = useState<Expense[] | null>(null)
  // 지출내역 보기 — '아이템별'(기본) / '주문별'(같은 주문 묶음 + 배송비 포함, 쇼핑몰 주문내역처럼). 선택 기억.
  // 하이드레이션 #418 방지(서버 기본값 + 마운트 후 복원, 오류신고 5489fac1).
  const [expView, setExpView] = useState<'item' | 'order'>('item')
  useEffect(() => {
    if (localStorage.getItem('stayeum-finance-expview') === 'order') setExpView('order')
  }, [])
  const changeExpView = (v: 'item' | 'order') => { setExpView(v); if (typeof window !== 'undefined') localStorage.setItem('stayeum-finance-expview', v) }

  // 다중선택 묶기 — 카드 꾹 누르면 선택 모드 진입, 탭으로 추가 선택, 하단 바에서 '한 주문으로 묶기'
  const [mergeMode, setMergeMode] = useState(false)
  const [mergeSel, setMergeSel] = useState<Set<string>>(new Set())
  // 정본 useLongPress 로 통일(신고 2fdbffcb) — 수제 구현은 onPointerMove 에서 즉시 취소라
  // 터치의 미세 떨림에도 발화가 안 됐다(10px 슬롭 없음). 훅이 발화 후 click 도 캡처에서 삼킨다.
  const pressExp = useLongPress()
  // 그룹(주문/방 묶음)이면 멤버 id 전부, 아니면 단일 id
  const expIdsOf = (exp: Expense, groupRows?: Expense[]) => (groupRows && groupRows.length ? groupRows.filter(r => !r.isShipping).map(r => r.id) : [exp.id])
  const isExpSelected = (exp: Expense, groupRows?: Expense[]) => { const ids = expIdsOf(exp, groupRows); return ids.length > 0 && ids.every(id => mergeSel.has(id)) }
  const toggleExpSel = (exp: Expense, groupRows?: Expense[]) => {
    setMergeSel(prev => {
      const n = new Set(prev); const ids = expIdsOf(exp, groupRows); const all = ids.every(id => n.has(id))
      ids.forEach(id => all ? n.delete(id) : n.add(id)); return n
    })
  }
  const exitMergeMode = () => { setMergeMode(false); setMergeSel(new Set()) }
  const handleMergeSelected = () => {
    const ids = [...mergeSel]
    if (ids.length < 2) { pushToast('error', '2건 이상 선택해주세요.'); return }
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await mergeExpensesIntoOrder(ids)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', `${ids.length}건을 한 주문으로 묶었습니다`)
        exitMergeMode(); setExpView('order'); router.refresh()
      } finally { release() }
    })
  }
  // 합배송 배송비 — 수정 폼의 '별도 지출로 묶기' 입력값
  const [attachShipAmount, setAttachShipAmount] = useState<number | undefined>(undefined)
  const [attachShipType, setAttachShipType] = useState<'선불' | '착불' | '신용'>('선불')
  const [attachShipMemo, setAttachShipMemo] = useState('')
  const [attachShipSiblings, setAttachShipSiblings] = useState<string[]>([])  // 함께 묶을 다른 지출 id
  const [addExpMethod, setAddExpMethod]   = useState('계좌이체')
  const [addExpAccId, setAddExpAccId]     = useState('')
  const [addExpAccName, setAddExpAccName] = useState('')
  const [editExpMethod, setEditExpMethod]   = useState('계좌이체')
  const [editExpAccId, setEditExpAccId]     = useState('')
  const [editExpAccName, setEditExpAccName] = useState('')
  const [editExpDate, setEditExpDate]       = useState('')
  const [addExpRoomId, setAddExpRoomId]     = useState('')
  const [editExpRoomId, setEditExpRoomId]   = useState('')
  const [addReceiptUrl, setAddReceiptUrl]   = useState('')
  const [editReceiptUrl, setEditReceiptUrl] = useState('')
  const [receiptUploading, setReceiptUploading] = useState(false)
  const [addExpCategory, setAddExpCategory]   = useState(expenseCategories[0] ?? '소모품비')
  // 신고 6f264a8f: 사용자가 카테고리를 직접 고른 뒤에는 어떤 자동 채움(OCR 등)도 덮지 않는다
  const userPickedCategoryRef = useRef(false)
  // 영수증 스캔 (공통)
  const [addExpVendor, setAddExpVendor]       = useState('')
  const [addExpAmount, setAddExpAmount]       = useState<number | undefined>(undefined)
  const [addExpDetail, setAddExpDetail]       = useState('')
  const [addHasShipping, setAddHasShipping]   = useState(false)              // 배송비 포함 여부 (기본 무료, 총액 합산형)
  const [addShipping, setAddShipping]         = useState<number | undefined>(undefined)
  // 합배송 — 배송비를 별도 지출(주문 묶음)로. 위 '배송비 포함'(합산형)과 상호 배타.
  const [addOrderMode, setAddOrderMode]       = useState(false)
  const [addOrderShipping, setAddOrderShipping] = useState<number | undefined>(undefined)
  const [addOrderShipType, setAddOrderShipType] = useState<'선불' | '착불' | '신용'>('선불')
  const [addOrderShipMemo, setAddOrderShipMemo] = useState('')
  const [scanBitmap, setScanBitmap]           = useState<ImageBitmap | null>(null)
  const [scanCropped, setScanCropped]         = useState<{ dataUrl: string; base64: string } | null>(null)
  const [scanOcrPending, setScanOcrPending]   = useState(false)
  const [scanOcrError, setScanOcrError]       = useState('')
  const [addSeedNotice, setAddSeedNotice]     = useState('')   // 홈 딥링크에서 품목을 못 읽었을 때 폼에 보이는 안내(스캔 게이트 밖)
  const scanTargetRef                         = useRef<'add' | 'edit'>('add')
  const [editExpCategory, setEditExpCategory] = useState('')
  const [addItems, setAddItems]   = useState<ItemPickState[]>([])
  const [addIsService, setAddIsService] = useState(false)   // #2 서비스·무형(시공·인건비 등) — 품목 없이 금액만
  const [addExtOrderNo, setAddExtOrderNo] = useState('')    // #1 쇼핑몰 주문번호(쿠팡 등) — OCR 프리필/수동
  const [editItems, setEditItems] = useState<ItemPickState[]>([])
  const [editExpAmount, setEditExpAmount]     = useState<number | undefined>(undefined)  // 품목 없을 때 controlled 금액
  const [editExpDetail, setEditExpDetail]     = useState('')
  const [editHasShipping, setEditHasShipping] = useState(false)   // 배송비를 이 지출 금액에 합산
  const [editShipping, setEditShipping]       = useState<number | undefined>(undefined)
  const [editShipSeparate, setEditShipSeparate] = useState(false) // 배송비를 별도 지출(합배송)로 묶기

  // 비품·자재(내구재) 판정 — 재고 비추적 카테고리의 '물품'. 수령 후 비품 탭에서 방·공용부에 배정하므로
  // 지출 등록/수정 폼에서는 방 배정 UI를 숨긴다(구매 단계 선배정이 실제 배정 때 중복되는 것 방지).
  const isTrackedCat = (cat: string) => trackedCategories.includes(cat)
  const addIsDurable = !addIsService && !isTrackedCat(addExpCategory)
  const editIsDurable = editItems.length > 0 && !isTrackedCat(editExpCategory) && !detailExp?.excludeFromInventory

  // 파일 선택 → 이미지면 스캔 모달, PDF면 바로 업로드
  const handleOpenScan = async (file: File, target: 'add' | 'edit') => {
    if (!file.type.startsWith('image/')) {
      const setter = target === 'add' ? setAddReceiptUrl : setEditReceiptUrl
      await handleReceiptUpload(file, setter)
      return
    }
    // iOS/Android 카메라 사진은 EXIF orientation 으로 회전 정보를 가지는데, createImageBitmap
    // 기본값은 브라우저별로 다르다(Safari 적용 / Chrome 미적용). 'from-image' 로 명시적으로
    // EXIF 적용된 픽셀 데이터를 받아 화면 표시 ↔ bitmap 좌표 변환을 일관되게 한다.
    // 이 옵션이 없으면 핸들 좌표 → bitmap 좌표 매핑이 어긋나 확대경이 엉뚱한 영역을 보여줌.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    scanTargetRef.current = target
    setScanCropped(null)
    setScanOcrError('')
    setScanBitmap(bitmap)
  }

  // 크롭 결과를 스토리지에 업로드 (코어 — cropped 직접 받음)
  const uploadCropped = async (cropped: { dataUrl: string; base64: string }) => {
    const setter = scanTargetRef.current === 'add' ? setAddReceiptUrl : setEditReceiptUrl
    await handleReceiptUpload(dataUrlToFile(cropped.dataUrl, 'receipt.jpg'), setter)
    setScanCropped(null)
  }

  // OCR 채우기 + 첨부 (코어 — cropped 직접 받음, 지출 등록 폼 전용)
  // OCR 결과를 지출 폼에 적용 — 자동 입력(ocrCropped)과 홈 딥링크(저장된 결과)가 공유하는 단일 경로.
  const applyReceiptOcrToForm = async (d: ReceiptOcrResult) => {
    if (d.date) setAddExpDate(d.date)
    if (d.vendor) setAddExpVendor(d.vendor)
    if (d.orderNo) setAddExtOrderNo(d.orderNo)
    if (!userPickedCategoryRef.current && d.category && expenseCategories.includes(d.category)) setAddExpCategory(d.category)
    if (d.items.length > 0) {
      // 부가세 별도 영수증 보정(오류신고 ba364142) — 품목 합이 최종금액(totalAmount)보다
      // 딱 부가세만큼(약 10%) 작으면 과세금액으로 인식된 것 → 부가세를 품목별 비례 배분해 최종가로.
      // 그 외 차이(할인·배송비 등)는 건드리지 않음.
      let ocrItems = d.items
      const itemsSum = ocrItems.reduce((s, it) => s + it.amount, 0)
      if (d.totalAmount && itemsSum > 0 && itemsSum < d.totalAmount) {
        const ratio = d.totalAmount / itemsSum
        if (ratio > 1.07 && ratio < 1.13) {
          let acc = 0
          ocrItems = ocrItems.map((it, i) => {
            const amt = i === ocrItems.length - 1 ? d.totalAmount! - acc : Math.round(it.amount * ratio)
            acc += amt
            return { ...it, amount: amt }
          })
        }
      }
      // 인식 직후 유사 품목 확인(오류신고 a3a4bac7) — 과거에 쓰던 비슷한 품목명이 있으면
      // 그 이름으로 등록할지 물어봄(수동 추가의 confirmAdd와 동일 규칙). 승인 시 ocrRaw(원문)가
      // 남아 별칭 학습 → 다음 영수증부턴 자동 치환.
      const renamed: typeof ocrItems = []
      for (const it of ocrItems) {
        const similar = findSimilarItemName(it.label, detailSuggestions)
        if (similar && similar !== it.label) {
          const useExisting = await confirmDialog({
            title: '비슷한 품목이 있어요',
            message: `영수증의 '${it.label}'. 이미 '${similar}'(으)로 쓰신 적이 있어요. 같은 품목인가요?\n(다른 제품이면 '새 품목으로' · '${it.label}' 그대로 등록)`,
            confirmLabel: `'${similar}'로`,
            cancelLabel: '새 품목으로',
          })
          renamed.push(useExisting ? { ...it, rawLabel: it.rawLabel ?? it.label, label: similar } : it)
        } else renamed.push(it)
      }
      ocrItems = renamed
      // 인식된 품목은 항상 '품목 선택'(ItemSelector)으로 — 등록 폼은 모든 카테고리에서 품목 모듈을 쓰므로.
      // (이전엔 ITEM_PRESETS 있는 카테고리만 품목으로, 나머진 세부 항목 텍스트로 빠지던 문제)
      // specText(색상·사이즈 등 서술형 규격)가 있으면 처음부터 텍스트 규격 모드로 열림(숫자 규격 비움·개당 단가).
      setAddItems(ocrItems.map(it => {
        const hasTextSpec = !!(it.specText && it.specText.trim())
        return {
          label: it.label, ocrRaw: it.rawLabel ?? it.label, setHint: it.setHint,
          specValue: hasTextSpec ? '' : (it.specValue ?? ''),
          specUnit:  hasTextSpec ? '' : (it.specUnit ?? ''),
          specText:  hasTextSpec ? it.specText!.trim() : undefined,
          unitBasis: hasTextSpec ? 'qty' as const : undefined,
          qtyValue: it.qtyValue ?? '', qtyUnit: it.qtyUnit ?? '',
          amount: it.amount,
          unitPrice: it.amount != null ? Math.round(it.amount / ((Number(it.qtyValue) || 1) * (Number(it.specValue) || 1))) : undefined,
        }
      }))
      setAddExpAmount(ocrItems.reduce((s, it) => s + it.amount, 0))
    } else {
      setAddItems([])
      if (d.totalAmount) setAddExpAmount(d.totalAmount)
    }
  }

  const ocrCropped = async (cropped: { dataUrl: string; base64: string }, opts?: { skipUpload?: boolean }): Promise<{ itemCount: number; error: string | null }> => {
    setScanOcrPending(true)
    setScanOcrError('')
    let outcome: { itemCount: number; error: string | null } = { itemCount: 0, error: null }
    try {
      const res = await analyzeReceiptWithGemini(cropped.base64, 'image/jpeg')
      if (!res.ok) { setScanOcrError(res.error); outcome = { itemCount: 0, error: res.error } }
      else {
        void notifyAiQuota()
        await applyReceiptOcrToForm(res.data)
        outcome = { itemCount: res.data.items.length, error: null }
      }
      if (!opts?.skipUpload) await uploadCropped(cropped)   // 홈 큐 딥링크는 기존 이미지 재사용(재업로드 방지)
    } finally { setScanOcrPending(false) }
    return outcome
  }

  // 스캔(크롭) 완료 → 지출 등록 폼이면 '분석할까요?' 팝업으로 자동 분석/첨부 분기.
  // 편집 폼은 기존대로 미리보기 + 수동 버튼 유지.
  const handleScanConfirm = async (result: { dataUrl: string; base64: string }) => {
    setScanBitmap(prev => { prev?.close?.(); return null })
    setScanCropped(result)
    if (scanTargetRef.current === 'add') {
      // v2.0 §27 — 취소·Esc·배경 클릭은 아무것도 하지 않는다(첨부는 별도 버튼).
      const choice = await choiceDialog({ title: '영수증을 분석해서 자동 입력할까요?', message: '날짜·금액·품목을 자동으로 채웁니다. 첨부만 할 수도 있습니다.', confirmLabel: '자동 분석', altLabel: '영수증만 첨부', cancelLabel: '취소' })
      if (choice === 'confirm') void ocrCropped(result)
      else if (choice === 'alt') void uploadCropped(result)
    }
  }

  const handleScanCancel = () => {
    setScanBitmap(prev => { prev?.close?.(); return null })
  }

  // 버튼용 래퍼 (state 의 현재 cropped 사용) — 편집 폼 수동 버튼 등
  const handleScanUpload = async () => { if (scanCropped) await uploadCropped(scanCropped) }
  const handleScanAndOcr = async () => { if (scanCropped) await ocrCropped(scanCropped) }

  // ── 수익 탭 상태 ─────────────────────────────────────────────

  // ── 고정 지출 탭 상태 ────────────────────────────────────────
  const [recordingRec, setRecordingRec] = useState<RecurringExpenseWithStatus | null>(null)
  const [recRecDirty, setRecRecDirty] = useState(false)   // v2.0 §12 — 지출 기록 폼 입력 보호
  const [recRecAmount, setRecRecAmount] = useState(0)
  // #1 관리비 묶음: 기록 시 세부항목별 금액(변동은 편집). 비어있으면 단일 금액 모드.
  const [recRecItems, setRecRecItems]   = useState<{ name: string; amount: number; isVariable: boolean }[]>([])
  const [recRecDate, setRecRecDate]     = useState('')
  const [recRecMemo, setRecRecMemo]     = useState('')
  const [recRecPayMethod, setRecRecPayMethod] = useState('')
  const [recRecAccId, setRecRecAccId]   = useState('')
  const [recError, setRecError]         = useState('')

  const [showVendorMgmt, setShowVendorMgmt] = useState(false)
  // ── 과거 구매내역 검색 모달 (전 기간) ────────────────────────
  const [showExpSearch, setShowExpSearch] = useState(false)
  const [expSearchQ, setExpSearchQ] = useState('')
  const [expSearchResults, setExpSearchResults] = useState<ExpenseSearchResult[]>([])
  const [expSearching, setExpSearching] = useState(false)
  // 전역 통합 검색 ?q= 시딩 — month 동반(개별 히트)이면 이번 달 인라인 검색, q만(그룹 더 보기)이면 전 기간 검색 패널
  const globalSeedParams = useSearchParams()
  useEffect(() => {
    const gq = globalSeedParams.get('q')
    if (!gq) return
    if (globalSeedParams.get('month')) setExpListSearch(gq)
    else { setExpSearchQ(gq); setShowExpSearch(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // + 지출 등록 폼 초기화·열기 — 버튼과 홈 찍어올리기 딥링크(?pendingReceipt=)가 공유하는 단일 경로
  const openAddExpense = () => { userPickedCategoryRef.current = false; setAddExpDirty(false); setShowAddExp(true); setAddExpMethod(lastPayDefaults?.payMethod || '계좌이체'); setAddExpAccId(lastPayDefaults?.financialAccountId ?? ''); setAddExpAccName(lastPayDefaults?.financeName ?? ''); setAddExpCategory(expenseCategories[0] ?? '소모품비'); setAddItems([]); setAddIsService(false); setAddExpRoomId(''); setAddExtOrderNo(''); setAddExpVendor(''); setAddExpAmount(undefined); setAddExpDetail(''); setAddHasShipping(false); setAddShipping(undefined); setAddOrderMode(false); setAddOrderShipping(undefined); setAddOrderShipMemo(''); setScanCropped(null); setScanOcrError(''); setAddSeedNotice(''); setError('') }
  // 홈 '영수증 촬영' 딥링크(?scan=1) — 대시보드 찍어올리기 큐 휴면 후 단일 진입점(2026-07-19).
  // 지출 폼을 바로 열어 '영수증 첨부 · 자동 입력'으로 이어지게 한다.
  const scanSeedRef = useRef(false)
  useEffect(() => {
    if (globalSeedParams.get('scan') !== '1' || scanSeedRef.current) return
    scanSeedRef.current = true
    openAddExpense()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // 홈 찍어올리기 딥링크 — 정식 지출 폼 + 정밀 OCR로 일원화(오류신고 bb7b7cb4).
  // 기존 업로드 이미지 재사용(재업로드 방지), 저장 성공 시 대기 항목 자동 마감(finalize).
  const pendingSeedRef = useRef<string | null>(null)
  useEffect(() => {
    const pid = globalSeedParams.get('pendingReceipt')
    if (!pid || pendingSeedRef.current) return
    pendingSeedRef.current = pid
    ;(async () => {
      openAddExpense()
      const res = await getPendingReceiptImage(pid)
      if (!res.ok) { pushToast('error', res.error); return }
      setAddReceiptUrl(res.imageUrl)
      // 저장된 정밀 인식 결과가 있으면 재-OCR 없이 프리필(호출 1회 절약).
      if (res.ocr.items.length > 0) {
        await applyReceiptOcrToForm(res.ocr)
      } else {
        // 구 데이터·인식 실패 — 기존 재-OCR 폴백. 그래도 품목을 못 읽으면 폼에 안내 표시.
        const r = await ocrCropped({ dataUrl: `data:${res.mime};base64,${res.base64}`, base64: res.base64 }, { skipUpload: true })
        if (r.itemCount === 0) {
          const reason = r.error ?? res.ocrError
          setAddSeedNotice('영수증에서 품목을 읽지 못했습니다. 직접 입력해 주세요.' + (reason ? ` (${reason})` : ''))
        }
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  // ── 고정 지출 관리 모달 상태 ─────────────────────────────────
  const [showRecMgmt, setShowRecMgmt]   = useState(false)
  const [recMgmtDirty, setRecMgmtDirty] = useState(false)   // v2.0 §12 — 고정지출 폼 입력 보호
  const [recMgmtList, setRecMgmtList]   = useState<RecurringExpenseRow[]>([])
  const [recMgmtLoading, setRecMgmtLoading] = useState(false)
  const [editingRecMgmt, setEditingRecMgmt] = useState<RecurringExpenseRow | null>(null)
  const [showRecMgmtForm, setShowRecMgmtForm] = useState(false)
  // #1 묶기(여러 고정지출 → 관리비 부모로 전환) 모드
  const [recGroupMode, setRecGroupMode] = useState(false)
  const [recGroupSel, setRecGroupSel]   = useState<Set<string>>(new Set())
  const [recGroupTitle, setRecGroupTitle] = useState('임대관리비')
  const [recMgmtForm, setRecMgmtForm]   = useState({ title: '', amount: '', category: DEFAULT_RECURRING_CATEGORY, dueDay: DEFAULT_RECURRING_DUE_DAY, payMethod: '', financialAccountId: '', isAutoDebit: false, isVariable: false, alertDaysBefore: DEFAULT_RECURRING_ALERT_DAYS_BEFORE, activeSince: '', priorYearAmount: '', memo: '' })
  const [recMgmtPending, startRecMgmtTransition] = useTransition()
  const [recMgmtError, setRecMgmtError] = useState('')

  const openRecMgmt = async () => {
    setShowRecMgmt(true)
    setShowRecMgmtForm(false)
    setEditingRecMgmt(null)
    setRecMgmtError('')
    setRecMgmtLoading(true)
    const list = await getRecurringExpenses()
    setRecMgmtList(list)
    setRecMgmtLoading(false)
  }
  const openNewRecMgmt = () => {
    setEditingRecMgmt(null)
    const defaultActiveSince = acquisitionDate
      ? kstYmdStr(new Date(acquisitionDate))
      : ''
    setRecMgmtForm({ title: '', amount: '', category: expenseCategories[0] ?? DEFAULT_RECURRING_CATEGORY, dueDay: DEFAULT_RECURRING_DUE_DAY, payMethod: '', financialAccountId: '', isAutoDebit: false, isVariable: false, alertDaysBefore: DEFAULT_RECURRING_ALERT_DAYS_BEFORE, activeSince: defaultActiveSince, priorYearAmount: '', memo: '' })
    setRecMgmtDirty(false); setShowRecMgmtForm(true)
    setRecMgmtError('')
  }
  const openEditRecMgmt = (r: RecurringExpenseRow) => {
    setEditingRecMgmt(r)
    setRecMgmtForm({ title: r.title, amount: r.amount.toString(), category: r.category, dueDay: r.dueDay.toString(), payMethod: r.payMethod ?? '', financialAccountId: r.financialAccountId ?? '', isAutoDebit: r.isAutoDebit, isVariable: r.isVariable, alertDaysBefore: r.alertDaysBefore.toString(), activeSince: r.activeSince ?? '', priorYearAmount: r.priorYearAmount ? r.priorYearAmount.toString() : '', memo: r.memo ?? '' })
    setRecMgmtDirty(false); setShowRecMgmtForm(true)
    setRecMgmtError('')
  }
  const handleSaveRecMgmt = () => {
    const data = {
      title: recMgmtForm.title.trim(),
      amount: Number(recMgmtForm.amount.replace(/[^0-9]/g, '')),
      category: recMgmtForm.category,
      dueDay: parseInt(recMgmtForm.dueDay) || 25,
      payMethod: recMgmtForm.payMethod || undefined,
      financialAccountId: recMgmtForm.financialAccountId || null,
      isAutoDebit: recMgmtForm.isAutoDebit,
      isVariable: recMgmtForm.isVariable,
      alertDaysBefore: parseInt(recMgmtForm.alertDaysBefore) || 7,
      activeSince: recMgmtForm.activeSince || undefined,
      priorYearAmount: recMgmtForm.priorYearAmount ? Number(recMgmtForm.priorYearAmount.replace(/[^0-9]/g, '')) || undefined : undefined,
      memo: recMgmtForm.memo || undefined,
    }
    startRecMgmtTransition(async () => {
      let res: { ok: boolean; error?: string }
      if (editingRecMgmt) {
        res = await updateRecurringExpense(editingRecMgmt.id, data)
      } else {
        res = await addRecurringExpense(data)
      }
      if (!res.ok) { setRecMgmtError((res as any).error ?? '저장 실패'); return }
      const list = await getRecurringExpenses()
      setRecMgmtList(list)
      setShowRecMgmtForm(false)
      setEditingRecMgmt(null)
      router.refresh()
    })
  }
  const handleDeleteRecMgmt = async (id: string, title: string) => {
    if (!(await confirmDialog({ title: `'${title}' 고정 지출을 삭제할까요?`, message: '다음 달부터 자동 기장이 중단됩니다. 이미 기장된 지출은 남습니다.', level: 'caution', confirmLabel: '삭제' }))) return
    startRecMgmtTransition(async () => {
      await deleteRecurringExpense(id)
      const list = await getRecurringExpenses()
      setRecMgmtList(list)
      router.refresh()
    })
  }
  const handleToggleRecMgmt = (r: RecurringExpenseRow) => {
    startRecMgmtTransition(async () => {
      await updateRecurringExpense(r.id, { isActive: !r.isActive })
      const list = await getRecurringExpenses()
      setRecMgmtList(list)
      router.refresh()
    })
  }
  const toggleGroupSel = (id: string) => {
    setRecGroupSel(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }
  const handleGroupRec = () => {
    const ids = [...recGroupSel]
    if (ids.length < 2) { setRecMgmtError('묶을 항목을 2개 이상 선택하세요.'); return }
    if (!recGroupTitle.trim()) { setRecMgmtError('묶음 이름을 입력하세요.'); return }
    // 부모 카테고리·납부일·결제수단은 선택 항목 중 첫 항목 기준 (이후 수정 가능)
    const base = recMgmtList.find(r => r.id === ids[0])
    startRecMgmtTransition(async () => {
      const res = await groupRecurringExpenses({
        title: recGroupTitle.trim(),
        category: base?.category ?? DEFAULT_RECURRING_CATEGORY,
        dueDay: base?.dueDay ?? 25,
        payMethod: base?.payMethod ?? null,
        financialAccountId: base?.financialAccountId ?? null,
        sourceIds: ids,
      })
      if (!res.ok) { setRecMgmtError(res.error); return }
      const list = await getRecurringExpenses()
      setRecMgmtList(list)
      setRecGroupMode(false); setRecGroupSel(new Set()); setRecMgmtError('')
      router.refresh()
    })
  }

  // ── 자산 탭 상태 ─────────────────────────────────────────────
  const [editingAcc, setEditingAcc]     = useState<FinancialAccount | null>(null)
  const [assetType, setAssetType]       = useState('BANK_ACCOUNT')
  const [assetBrand, setAssetBrand]     = useState('')
  const [assetError, setAssetError]     = useState('')
  const [assetFormKey, setAssetFormKey] = useState(0)
  const [payDayInput, setPayDayInput]   = useState('')
  const [cutOffDayInput, setCutOffDayInput] = useState('')

  useEffect(() => {
    setPayDayInput(editingAcc?.payDay ? displayDay(editingAcc.payDay) : '')
    setCutOffDayInput(editingAcc?.cutOffDay ? displayDay(editingAcc.cutOffDay) : '')
  }, [assetFormKey, editingAcc])

  useEffect(() => {
    const savedW = loadFinWidths()
    if (savedW) {
      const merged = { ...DEFAULT_FIN_WIDTHS, ...savedW }
      setFinColWidths(merged)
      finColWidthsRef.current = merged
    }
  }, [])

  useEffect(() => { finColWidthsRef.current = finColWidths }, [finColWidths])

  const startResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = finColWidthsRef.current[col] ?? 100
    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(50, startW + ev.clientX - startX)
      setFinColWidths(prev => ({ ...prev, [col]: newW }))
    }
    const onUp = () => {
      localStorage.setItem(FIN_WIDTHS_KEY, JSON.stringify(finColWidthsRef.current))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  function ResizableTh({ label, colKey }: { label: string; colKey: string }) {
    const w = finColWidths[colKey] ?? 100
    return (
      <th
        className="relative text-left text-xs font-medium text-[var(--warm-muted)] px-4 py-3 select-none overflow-hidden"
        style={{ width: w, minWidth: w, maxWidth: w }}
      >
        <span className="truncate block">{label}</span>
        <div
          onMouseDown={e => startResize(colKey, e)}
          className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group"
          style={{ userSelect: 'none' }}
        >
          <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
        </div>
      </th>
    )
  }

  // ── 파생 데이터 ──────────────────────────────────────────────
  const cardAccounts    = financialAccounts.filter(a => a.type === 'CREDIT_CARD' || a.type === 'DEBIT_CARD')
  const bankAccounts    = financialAccounts.filter(a => a.type === 'BANK_ACCOUNT')
  const prepaidAccounts = financialAccounts.filter(a => a.type === 'PREPAID')

  // 등록된 선불 계정 브랜드를 결제수단 목록에 자동 병합
  const effectivePaymentMethods = (() => {
    const methods = [...paymentMethods]
    for (const acc of prepaidAccounts) {
      const name = acc.brand ?? accName(acc)
      if (name && !methods.includes(name)) methods.push(name)
    }
    return methods
  })()

  // 과거 구매내역 검색 — 입력 디바운스 300ms 후 전 기간 검색(서버). 모달 닫히면 검색 안 함.
  useEffect(() => {
    if (!showExpSearch) return
    const q = expSearchQ.trim()
    if (q.length < 1) { setExpSearchResults([]); setExpSearching(false); return }
    setExpSearching(true)
    let alive = true
    const t = setTimeout(async () => {
      try {
        const res = await searchExpenses(q)
        if (alive) setExpSearchResults(res)
      } catch {
        if (alive) setExpSearchResults([])
      } finally {
        if (alive) setExpSearching(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [expSearchQ, showExpSearch])

  const filteredExpenses = expenses.filter(e => {
    if (expFilter.method   !== 'all' && e.payMethod !== expFilter.method) return false
    if (expFilter.category !== 'all' && e.category  !== expFilter.category) return false
    if (expFilter.finance  !== 'all' && e.financialAccountId !== expFilter.finance) return false
    // 패널 확장 필터 — 호실('none'=미지정)·구분(고정/일반)·금액 범위
    if (expFilter.roomId !== 'all' && (expFilter.roomId === 'none' ? !!e.roomId : e.roomId !== expFilter.roomId)) return false
    if (expFilter.kind === 'recurring' && !e.recurringExpenseId) return false
    if (expFilter.kind === 'normal' && e.recurringExpenseId) return false
    if (expAmountMin != null && e.amount < expAmountMin) return false
    if (expAmountMax != null && e.amount > expAmountMax) return false
    if (expListSearch.trim()) {
      const q   = expListSearch.trim().toLowerCase()
      const hay = `${e.detail ?? ''} ${e.vendor ?? ''} ${e.memo ?? ''} ${e.category} ${e.payMethod ?? ''} ${e.room?.roomNo ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  // ── 합배송 주문 요약 — 주문별 대표라벨 "○○ 외 N건" + 배송 결제구분 (행에 칩으로 표시) ──
  //    이 달에 보이는 지출들로 계산(같은 주문이 여러 행으로 쪼개진 것 모음). 대표=비배송 최대금액 행.
  type OrderSummary = { code: string; label: string; count: number; shippingType: string | null; shippingMemo: string | null }
  const orderSummaries = (() => {
    const byOrder = new Map<string, Expense[]>()
    for (const e of expenses) {
      if (!e.orderId) continue
      if (!byOrder.has(e.orderId)) byOrder.set(e.orderId, [])
      byOrder.get(e.orderId)!.push(e)
    }
    const repLabelOf = (e: Expense) => e.itemLabel || (e.detail ?? '').replace(/^\[|\].*$/g, '').replace(/\s*x\s.*$/, '').trim() || '항목'
    const out = new Map<string, OrderSummary>()
    for (const [oid, rows] of byOrder) {
      const items = rows.filter(r => !r.isShipping)
      const rep = items.slice().sort((a, b) => b.amount - a.amount)[0] ?? rows[0]
      const count = items.length
      const baseLabel = repLabelOf(rep)
      const label = count > 1 ? `${baseLabel} 외 ${count - 1}건` : baseLabel
      const ord = rows.find(r => r.order)?.order ?? null
      out.set(oid, { code: ord?.code ?? '', label, count, shippingType: ord?.shippingType ?? null, shippingMemo: ord?.shippingMemo ?? null })
    }
    return out
  })()
  const orderChip = (e: Expense): { text: string; title: string } | null => {
    if (!e.orderId) return null
    const s = orderSummaries.get(e.orderId)
    if (!s) return null
    const text = e.isShipping
      ? `배송비${s.shippingType ? ` · ${s.shippingType}` : ''} · ${s.label}`
      : `주문 · ${s.label}`
    return { text, title: `주문 ${s.code}${s.shippingMemo ? ` · ${s.shippingMemo}` : ''}` }
  }

  const totalExp = filteredExpenses.reduce((s, e) => s + e.amount, 0)

  // ── 핸들러 ───────────────────────────────────────────────────

  const handleReceiptUpload = async (file: File, setter: (url: string) => void) => {
    setReceiptUploading(true)
    setError('')
    const fd = new FormData()
    fd.append('receipt', file)
    const res = await uploadExpenseReceipt(fd)
    if (res.ok) setter(res.url)
    else setError(res.error)
    setReceiptUploading(false)
  }

  const handleAddExp = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    // 물품 구매는 품목 필수. 서비스·무형도 세부 항목(품목 모듈)으로 내역을 쪼개야 방별 투자금이 추적됨.
    // 단 임대료·세금·공과금·관리비·보증금 반환 등 무형 카테고리는 면제(금액만).
    if (!addIsService && addItems.length === 0) {
      const msg = '품목을 1개 이상 추가하세요. (물품이 아닌 시공비·인건비 등이면 유형을 \'서비스·무형\'으로 바꾸세요)'
      setError(msg); pushToast('error', msg); return
    }
    if (addIsService && !DETAIL_OPTIONAL_CATEGORIES.includes(addExpCategory) && addItems.length === 0) {
      const msg = '세부 항목을 1개 이상 추가하세요. (예: 도배 14만 · 장판 시공 5만 · 임대료·세금·공과금·관리비·보증금 반환은 비워도 됩니다)'
      setError(msg); pushToast('error', msg); return
    }
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        // 같은 쇼핑몰 주문번호의 기존 주문이 있으면 묶을지 확인(오류신고 4f9fb398) —
        // 쿠팡처럼 한 주문을 판매점별로 나눠 결제해 영수증이 여러 장인 경우, 각 영수증을 같은 주문으로.
        const extNo = ((fd.get('externalOrderNo') as string) || '').trim()
        if (extNo) {
          const found = await findOrderByExternalNo(extNo).catch(() => null)
          if (found) {
            const attach = await confirmDialog({
              title: '같은 주문번호의 주문이 있어요',
              message: `주문 ${found.code} · 품목 ${found.count}건 · ${fmtWon(found.total)}.\n이 지출을 같은 주문으로 묶을까요? (한 주문에 판매점별 영수증이 여러 장인 경우)\n묶은 뒤에도 지출 상세에서 풀 수 있어요.`,
              confirmLabel: '같은 주문으로 묶기',
              cancelLabel: '따로 등록',
            })
            if (attach) fd.set('attachOrderId', found.id)
          }
        }
        const res = await addExpense(fd)
        if (!res.ok) { pushToast('error', res.error); return }
        setShowAddExp(false); setAddExpDirty(false); setAddExpDate(kstYmdStr()); setAddReceiptUrl(''); setAddIsService(false); setAddExpRoomId(''); setAddExtOrderNo(''); setAddHasShipping(false); setAddShipping(undefined); setAddOrderMode(false); setAddOrderShipping(undefined); setAddOrderShipMemo(''); router.refresh()
        if (pendingSeedRef.current) { void finalizePendingReceipt(pendingSeedRef.current); pendingSeedRef.current = null }
        pushToast('success', '지출 등록됨')
      } finally { release() }
    })
  }
  const handleUpdateExp = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    // #1·#3 세부항목 필수(품목 없는 서비스·무형 행). 임대료·세금 등 무형 카테고리는 면제.
    if (editItems.length === 0 && !DETAIL_OPTIONAL_CATEGORIES.includes(editExpCategory) && !editExpDetail.trim()) {
      const msg = '세부 항목을 입력하세요. (임대료·세금·공과금·관리비·보증금 반환은 비워도 됩니다)'
      setError(msg); pushToast('error', msg); return
    }
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await updateExpense(fd)
        if (!res.ok) { pushToast('error', res.error); return }
        // 카테고리 변경 + 품목 있음 → 재고 품목도 같이 옮길지 확인(종량제봉투 꼬임 재발 방지, 운영자 요청 2026-07-10)
        {
          const newCat = String(fd.get('category') ?? '')
          const label = detailExp?.itemLabel ?? ''
          if (label && newCat && detailExp && newCat !== detailExp.category) {
            if (await confirmDialog({
              title: '재고 품목 카테고리도 같이 바꿀까요?',
              message: `'${label}' 품목이 '${detailExp.category}' 재고에 등록돼 있다면 '${newCat}'(으)로 함께 이동합니다. 안 바꾸면 재고와 지출의 카테고리가 어긋날 수 있어요.`,
              confirmLabel: '같이 변경', cancelLabel: '지출만',
            })) {
              const sync = await syncTrackedItemCategory(label, detailExp.category, newCat)
              if (!sync.ok) pushToast('error', sync.error)
              else if (sync.moved) pushToast('success', `재고 품목을 '${newCat}'(으)로 옮겼습니다`)
            }
          }
        }
        // 배송비 '별도 지출로 묶기(합배송)' — 수정 저장 후 주문 묶기/해제 처리.
        // 배송비 라인 자체는 제외(자기 자신을 묶으려다 오류 + 반쪽 저장이 되던 문제).
        if (detailExp && !detailExp.isShipping) {
          if (editShipSeparate) {
            // 배송비 0이면 '주문으로만 묶기'(2건 이상 선택 필요), 0 초과면 배송비 라인도 생성.
            const sres = await attachShippingToOrder({ expenseIds: [detailExp.id, ...attachShipSiblings], amount: attachShipAmount ?? 0, shippingType: attachShipType, shippingMemo: attachShipMemo || null })
            if (!sres.ok) { setError(sres.error); pushToast('error', sres.error); return }
          } else if (!editShipSeparate && detailExp.orderId) {
            // 체크 해제 = 묶기 해제(적용취소) — 이전엔 조용한 무동작이라 풀린 줄 알게 만들던 문제
            const dres = await detachShippingFromOrder(detailExp.id)
            if (!dres.ok) { setError(dres.error); pushToast('error', dres.error); return }
            pushToast('info', dres.notice)
          }
        }
        setDetailExp(null); setDetailExpEdit(false); setEditShipSeparate(false); router.refresh()
        pushToast('success', '지출 수정됨')
      } finally { release() }
    })
  }
  const handleDeleteExp = async (exp: Expense) => {
    // #7: 고정지출에서 기록된 건은 '삭제'가 아니라 '이번 달 기록 취소'임을 명확히.
    //     (지출 record만 삭제 — 고정지출 항목/템플릿 자체는 그대로 유지)
    const isFixed = !!exp.recurringExpenseId
    const ok = isFixed
      ? await confirmDialog({
          title: '이번 달 고정지출 기록만 취소할까요?',
          message: '고정지출 항목 자체는 그대로 남고, 이번 달 기록(정산)만 취소됩니다.',
          confirmLabel: '기록 취소',
        })
      : await confirmDialog({
          title: '이 지출을 삭제할까요?',
          message: `${fmtDate(exp.date)} · ${fmtWon(exp.amount)} · ${exp.category}`,
          level: 'danger', confirmLabel: '삭제',
        })
    if (!ok) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteExpense(exp.id)
        if (!res.ok) { pushToast('error', res.error); return }
        setDetailExp(null); router.refresh()
        pushToast('success', isFixed ? '이번 달 기록이 취소되었습니다' : '삭제됨', {
          action: { label: '적용취소', run: () => { void undoDeleteExpense(res.undo).then(r => {
            if (r.ok) { pushToast('info', isFixed ? '이번 달 기록을 복원했습니다' : '지출을 복원했습니다'); router.refresh() }
            else pushToast('error', r.error)
          }).catch(() => pushToast('error', '복원 중 통신 오류가 발생했습니다')) } },
        })
      } finally { release() }
    })
  }




  const handleUnsettle = async (id: string) => {
    if (!(await confirmDialog({ title: '이 지출을 미정산 상태로 되돌릴까요?', confirmLabel: '되돌리기' }))) return
    startTransition(async () => {
      await unsettleExpenses([id]); setDetailExp(null); router.refresh()
    })
  }

  const handleSaveAsset = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setAssetError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await saveFinancialAccount(fd)
      if (!res.ok) { setAssetError(res.error); return }
      setEditingAcc(null); setAssetType('BANK_ACCOUNT'); setAssetBrand(''); setAssetFormKey(k => k + 1); router.refresh()
    })
  }
  const handleDeleteAsset = async (id: string) => {
    if (!(await confirmDialog({ title: '이 자산을 완전히 삭제할까요?', message: '기존 지출·수익 기록과의 연결도 끊어집니다.', level: 'danger', confirmLabel: '영구 삭제' }))) return
    startTransition(async () => {
      await deleteFinancialAccount(id)
      setEditingAcc(null); setAssetBrand(''); setAssetFormKey(k => k + 1); router.refresh()
    })
  }

  const handleDeactivateAsset = async (id: string) => {
    if (!(await confirmDialog({ title: '이 자산을 해지 처리할까요?', message: '기존 기록은 유지되며 신규 사용은 불가합니다.', level: 'caution', confirmLabel: '해지' }))) return
    startTransition(async () => {
      await deactivateFinancialAccount(id)
      setEditingAcc(null); setAssetBrand(''); setAssetFormKey(k => k + 1); router.refresh()
    })
  }

  // ── 공통 카드/계정 선택 핸들러 ───────────────────────────────
  const pickAccount = (id: string, setId: (v: string) => void, setName: (v: string) => void) => {
    setId(id)
    const found = financialAccounts.find(a => a.id === id)
    setName(found ? accName(found) : '')
  }

  // ── 서브탭 UI ────────────────────────────────────────────────
  const [yyyy, mm] = targetMonth.split('-')

  const activeRecs       = recurringExpensesWithStatus.filter(r => !r.isPending)
  const pendingRecs      = recurringExpensesWithStatus.filter(r => r.isPending)
  const recUnrecordedCount = activeRecs.filter(r => !r.recordedExpenseId).length

  // ── 상단 요약 위젯 계산 ──────────────────────────────────────
  const normalExpTotal   = expenses.filter(e => !e.recurringExpenseId).reduce((s, e) => s + e.amount, 0)
  const recRecordedTotal = activeRecs.filter(r => r.recordedExpenseId).reduce((s, r) => s + (r.recordedAmount ?? 0), 0)
  const recPendingTotal  = activeRecs.filter(r => !r.recordedExpenseId).reduce((s, r) => s + (r.pendingAmount ?? r.historicalAvg ?? r.amount), 0)
  const totalExpectedExp = normalExpTotal + recRecordedTotal + recPendingTotal
  const totalIncomeSum   = incomes.reduce((s, i) => s + i.amount, 0)

  // ── 카테고리별 차트 데이터 ─────────────────────────────────
  const currentCatMap: Record<string, number> = {}
  for (const e of expenses) currentCatMap[e.category] = (currentCatMap[e.category] ?? 0) + e.amount
  const prevCatMap: Record<string, number> = {}
  for (const t of prevMonthTotals) prevCatMap[t.category] = t.total
  const lastYearCatMap: Record<string, number> = {}
  for (const t of lastYearTotals) lastYearCatMap[t.category] = t.total

  // 이번 달 금액 내림차순 정렬 후 순서대로 색상 배정 (이름 매핑 아님)
  const allCats = Array.from(new Set([
    ...Object.keys(currentCatMap),
    ...Object.keys(prevCatMap),
    ...Object.keys(lastYearCatMap),
  ])).sort((a, b) => (currentCatMap[b] ?? 0) - (currentCatMap[a] ?? 0))

  const catColorMap: Record<string, string> = {}
  allCats.forEach((cat, i) => { catColorMap[cat] = chartColor(i) })

  const currentTotal = Object.values(currentCatMap).reduce((s, v) => s + v, 0)
  const prevTotal    = Object.values(prevCatMap).reduce((s, v) => s + v, 0)
  const lastYearTotal = Object.values(lastYearCatMap).reduce((s, v) => s + v, 0)
  const maxTotal = Math.max(currentTotal, prevTotal, lastYearTotal)

  const donutSegments = allCats.map(cat => ({
    value: currentCatMap[cat] ?? 0,
    color: catColorMap[cat],
  }))

  const fmtMonthLabel = (m: string) => {
    const [y, mo] = m.split('-')
    return `${y.slice(2)}년 ${parseInt(mo)}월`
  }
  // 대시보드 '보유 보증금'과 동일 기준(거주중: ACTIVE·CHECKOUT_PENDING)으로 합계 —
  // RESERVED(입실 전) 잔고까지 합산해 두 화면의 보유 보증금이 다르게 보이던 문제.
  // 목록에는 전 상태 노출 유지(원장 성격), 합계만 기준 통일.
  const totalDepositBalance = depositSummary
    .filter(d => d.status === 'ACTIVE' || d.status === 'CHECKOUT_PENDING')
    .reduce((s, d) => s + d.balance, 0)
  // v2.0 §25 — 합계 접미는 suffix로 분리(괄호·tnum은 ViewTabs가 처리)
  const TABS: { key: Tab; label: string; suffix?: string }[] = [
    { key: 'expense', label: '지출 내역', suffix: recUnrecordedCount > 0 ? `고정 ${recUnrecordedCount}건 미확인` : undefined },
    { key: 'assets',  label: '자산 관리', suffix: financialAccounts.length > 0 ? String(financialAccounts.length) : undefined },
    { key: 'deposit', label: '보증금',   suffix: fmtKorMoney(totalDepositBalance) },
    { key: 'reserve', label: '예비비',   suffix: fmtKorMoney(reserveBalance) },
  ]

  return (
    <>
    <div className="space-y-4">

      {/* 헤더 — 우측 월 셀렉터(기간) */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">지출 관리</h1>
        <MonthSelector />
      </div>

      {/* ── 월간 요약 위젯 ── */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
        {/* 상단: 지출 / 부가수익 */}
        <div className="grid grid-cols-2 divide-x divide-[var(--warm-border)]">

          {/* 전체 예상 지출 */}
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs font-medium text-[var(--warm-muted)]">전체 예상 지출</p>
            <p className="text-xl font-bold text-[var(--warm-dark)] num">
              <MoneyDisplay amount={totalExpectedExp} prefix="-" />
            </p>
            <div className="space-y-1 pt-1 border-t border-[var(--warm-border)]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--warm-muted)]">일반 지출</span>
                <span className="text-[var(--warm-dark)] font-medium num">
                  <MoneyDisplay amount={normalExpTotal} />
                </span>
              </div>
              {(recRecordedTotal > 0 || recPendingTotal > 0) && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--warm-muted)]">고정 지출 (기록됨)</span>
                    <span className="text-[var(--warm-dark)] font-medium num">
                      <MoneyDisplay amount={recRecordedTotal} />
                    </span>
                  </div>
                  {/* 예정 행: 반폭 열에서 라벨+뱃지가 금액과 겹쳐 줄바꿈되던 문제 — 뱃지를 라벨 아래 줄로 분리(윗줄은 라벨↔금액만) */}
                  <div className="text-xs space-y-0.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--warm-muted)]">고정 지출 (예정)</span>
                      <span className="text-[var(--warning-fg)] font-medium num">
                        <MoneyDisplay amount={recPendingTotal} />
                      </span>
                    </div>
                    {recPendingTotal > 0 && (
                      <div><Badge tone="pale-amber">{recUnrecordedCount}건 미기록</Badge></div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 부가수익 — 클릭 시 수납관리 부가수익 탭으로 (탭 자체는 2026-07-02 수납관리로 이동, 합계 위젯은 손익 요약이라 유지) */}
          <button type="button" onClick={() => router.push(`/rooms?month=${targetMonth}&tab=income`)}
            className="px-5 py-4 space-y-2 text-left transition-colors hover:bg-[var(--canvas)]/60 cursor-pointer">
            <p className="text-xs font-medium text-[var(--warm-muted)] flex items-center justify-between">
              부가 수익 합계
              <span className="text-[var(--coral)] font-medium">내역 보기 ›</span>
            </p>
            <p className="text-xl font-bold text-[var(--warm-dark)] num">
              <MoneyDisplay amount={totalIncomeSum} prefix="+" />
            </p>
            <div className="pt-1 border-t border-[var(--warm-border)]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--warm-muted)]">수익 건수</span>
                <span className="text-[var(--warm-dark)] font-medium">{incomes.length}건</span>
              </div>
            </div>
          </button>
        </div>

      </div>

      {/* ── 카테고리별 지출 분석 ── */}
      {currentTotal > 0 && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-4">
          <p className="text-sm font-semibold text-[var(--warm-dark)]">카테고리별 지출 분석</p>

          {/* 도넛 + 범례 */}
          <div className="flex items-start gap-4">
            <div className="shrink-0">
              <DonutChart
                segments={donutSegments}
                centerLabel={`${Math.round(currentTotal / 10000).toLocaleString()}만`}
                centerSub="총 지출"
                size={150}
                strokeWidth={22}
              />
            </div>
            <div className="flex-1 space-y-2 pt-1 min-w-0">
              {allCats.filter(cat => (currentCatMap[cat] ?? 0) > 0).map(cat => {
                const amt = currentCatMap[cat] ?? 0
                const pct = currentTotal > 0 ? Math.round((amt / currentTotal) * 100) : 0
                return (
                  <div key={cat} className="flex items-center gap-1.5">
                    <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: catColorMap[cat] }} />
                    <span className="text-xs text-[var(--warm-muted)] flex-1 truncate min-w-0">{cat}</span>
                    <span className="text-xs font-medium text-[var(--warm-dark)] num shrink-0">
                      {fmtWon(amt)}
                    </span>
                    <span className="text-[0.65625rem] text-[var(--warm-muted)] w-7 text-right shrink-0">{pct}%</span>
                  </div>
                )
              })}
            </div>
          </div>

          {/* 월별 비교 막대 */}
          <div className="pt-3 border-t border-[var(--warm-border)] space-y-2.5">
            <p className="text-xs font-medium text-[var(--warm-muted)]">월별 비교</p>
            <StackedBar
              segments={allCats.map(cat => ({ category: cat, amount: currentCatMap[cat] ?? 0 }))}
              total={currentTotal} maxTotal={maxTotal}
              label="이달" sublabel={fmtMonthLabel(targetMonth)} colorMap={catColorMap}
            />
            <StackedBar
              segments={allCats.map(cat => ({ category: cat, amount: prevCatMap[cat] ?? 0 }))}
              total={prevTotal} maxTotal={maxTotal}
              label="지난달" sublabel={fmtMonthLabel(prevMonth)} colorMap={catColorMap}
            />
            <StackedBar
              segments={allCats.map(cat => ({ category: cat, amount: lastYearCatMap[cat] ?? 0 }))}
              total={lastYearTotal} maxTotal={maxTotal}
              label="전년동월" sublabel={fmtMonthLabel(lastYearMonth)} colorMap={catColorMap}
            />
          </div>
        </div>
      )}

      {/* 서브탭 */}
      <div id="finance-tabs" className="scroll-mt-20">
        {/* v2.0 §25 뷰 전환 탭 — 트랙형(B)은 필터 전용, 뷰 전환은 코랄 채움 정본 */}
        <ViewTabs
          ariaLabel="재무 탭"
          activeId={tab}
          onChange={id => setTab(id as Tab)}
          tabs={TABS.map(t => ({ id: t.key, label: t.label, suffix: t.suffix }))}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════
          탭 1: 지출 내역
      ══════════════════════════════════════════════════════════ */}
      {tab === 'expense' && (
        <div className="space-y-4">
          {/* 검색바 + 필터 토글 — v2.0 §23 정본(호실관리) 패턴. 이번 달 목록 필터, 전 기간은 '과거 내역 검색' */}
          {(() => {
            const expFilterCount =
              [expFilter.method, expFilter.category, expFilter.finance, expFilter.roomId, expFilter.kind].filter(v => v !== 'all').length +
              (expAmountMin != null || expAmountMax != null ? 1 : 0)
            // 초기화는 패널 필터만 — 검색어는 유지(정본 호실관리와 동일 규칙)
            const resetExpFilters = () => {
              setExpFilter({ method: 'all', category: 'all', finance: 'all', roomId: 'all', kind: 'all' })
              setExpAmountMin(undefined); setExpAmountMax(undefined)
            }
            const selCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors'
            return (
              <>
                <div className="flex gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
                  <SearchBar value={expListSearch} onChange={setExpListSearch} placeholder="품목·구매처·내역·호실 검색" className="flex-1" />
                  <button type="button" onClick={() => setShowExpFilters(v => !v)}
                    className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
                      showExpFilters || expFilterCount > 0
                        ? 'bg-[var(--coral)] text-[var(--on-solid)]'
                        : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
                    }`}>
                    필터{expFilterCount > 0 ? ` ${expFilterCount}` : ''}
                  </button>
                </div>
                {/* 접이식 필터 패널 — §23 정본 문법(grid-cols-2·label 12px) */}
                {showExpFilters && (
                  <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
                        <select value={expFilter.method} onChange={e => setExpFilter(f => ({ ...f, method: e.target.value }))} className={selCls}>
                          <option value="all">전체</option>
                          {effectivePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리</label>
                        <select value={expFilter.category} onChange={e => setExpFilter(f => ({ ...f, category: e.target.value }))} className={selCls}>
                          <option value="all">전체</option>
                          {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                        </select>
                      </div>
                      {financialAccounts.length > 0 && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-[var(--warm-mid)]">금융사</label>
                          <select value={expFilter.finance} onChange={e => setExpFilter(f => ({ ...f, finance: e.target.value }))} className={selCls}>
                            <option value="all">전체</option>
                            {financialAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                          </select>
                        </div>
                      )}
                      {rooms.length > 0 && (
                        <div className="space-y-1">
                          <label className="text-xs font-medium text-[var(--warm-mid)]">호실</label>
                          <select value={expFilter.roomId} onChange={e => setExpFilter(f => ({ ...f, roomId: e.target.value }))} className={selCls}>
                            <option value="all">전체</option>
                            <option value="none">미지정</option>
                            {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                          </select>
                        </div>
                      )}
                      <div className="space-y-1">
                        <label className="text-xs font-medium text-[var(--warm-mid)]">구분</label>
                        <select value={expFilter.kind} onChange={e => setExpFilter(f => ({ ...f, kind: e.target.value }))} className={selCls}>
                          <option value="all">전체</option>
                          <option value="recurring">고정 지출</option>
                          <option value="normal">일반 지출</option>
                        </select>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">금액 범위 (원)</label>
                      <div className="flex items-center gap-2">
                        <MoneyInput value={expAmountMin} onChange={v => setExpAmountMin(v && v > 0 ? v : undefined)} placeholder="최소" />
                        <span className="text-[var(--warm-muted)] text-sm">~</span>
                        <MoneyInput value={expAmountMax} onChange={v => setExpAmountMax(v && v > 0 ? v : undefined)} placeholder="최대" />
                      </div>
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Btn type="button" variant="secondary" size="sm" className="flex-1" onClick={resetExpFilters}>초기화</Btn>
                      <Btn type="button" variant="primary" size="sm" className="flex-1" onClick={() => setShowExpFilters(false)}>닫기</Btn>
                    </div>
                  </div>
                )}
              </>
            )
          })()}
          {/* 합계 + 액션 버튼 — 별도 줄 */}
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex flex-col items-start">
              <span className="text-[0.6875rem] text-[var(--warm-muted)] leading-none">실제 지출 합계 <span className="text-[0.65625rem]">(예정 제외)</span></span>
              <span className="text-sm font-bold text-[var(--danger-fg)] num mt-0.5">
                <MoneyDisplay amount={totalExp} />
              </span>
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              <Btn variant="secondary" size="md" onClick={openRecMgmt}>
                고정 지출 관리
              </Btn>
              <Btn variant="secondary" size="md" onClick={() => setShowVendorMgmt(true)}>
                구매처 관리
              </Btn>
              <Btn variant="secondary" size="md" onClick={() => { setShowExpSearch(true); setExpSearchQ(''); setExpSearchResults([]) }}>
                과거 내역 검색
              </Btn>
              {canEditUi && (
              <Btn variant="primary" size="md" onClick={openAddExpense}>
                + 지출 등록
              </Btn>
              )}
            </div>
          </div>

          {/* 방별 지출 (이번 달) — '대상 호실' 배정된 지출을 방별로 합산 + 방별 항목 펼치기 */}
          {(() => {
            const byRoom = new Map<string, { roomNo: string; total: number; items: Expense[] }>()
            for (const e of expenses) {
              if (!e.room) continue
              const cur = byRoom.get(e.room.id) ?? { roomNo: e.room.roomNo, total: 0, items: [] }
              cur.total += e.amount; cur.items.push(e)
              byRoom.set(e.room.id, cur)
            }
            const groups = [...byRoom.values()].sort((a, b) => b.total - a.total)
            if (groups.length === 0) return null
            const roomTotal = groups.reduce((s, g) => s + g.total, 0)
            return (
              <details className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] px-3 py-2">
                <summary className="cursor-pointer text-xs font-semibold text-[var(--warm-dark)] flex items-center justify-between gap-2">
                  <span>방별 지출 (이번 달)</span>
                  <span className="text-[var(--warm-muted)] font-normal">{groups.length}개 방 · <MoneyDisplay amount={roomTotal} /></span>
                </summary>
                <div className="mt-2 space-y-1 border-t border-[var(--warm-border)]/60 pt-2">
                  {groups.map(g => (
                    <details key={g.roomNo} className="rounded-lg bg-[var(--canvas)] px-2 py-1">
                      <summary className="cursor-pointer flex items-center justify-between gap-2 text-[0.6875rem]">
                        <span className="text-[var(--warm-mid)]">{g.roomNo}호 <span className="text-[var(--warm-muted)]">· {g.items.length}건</span></span>
                        <span className="tabular-nums text-[var(--warm-dark)]"><MoneyDisplay amount={g.total} /></span>
                      </summary>
                      <ul className="mt-1.5 space-y-1 border-t border-[var(--warm-border)]/50 pt-1.5">
                        {g.items.map(it => (
                          <li key={it.id} className="flex items-baseline justify-between gap-2 text-[0.65625rem]">
                            <span className="text-[var(--warm-muted)] shrink-0 tabular-nums">{kstYmdStr(new Date(it.date)).slice(5)}</span>
                            <span className="flex-1 min-w-0 truncate text-[var(--warm-mid)]">{it.detail || it.category}</span>
                            <span className="shrink-0 tabular-nums text-[var(--warm-dark)]"><MoneyDisplay amount={it.amount} /></span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  ))}
                </div>
              </details>
            )
          })()}

          {(() => {
            // 미확인 고정 지출 — 필터 적용 후 납부일 기준 날짜 부여
            const unconfirmedRecsFiltered = activeRecs.filter(r =>
              !r.recordedExpenseId &&
              (expFilter.category === 'all' || r.category === expFilter.category) &&
              (expFilter.method === 'all' || r.payMethod === expFilter.method) &&
              // 패널 확장 필터도 일관 전파 — 목록과 예정 행이 어긋나지 않게.
              // 고정지출엔 방이 없어 특정 호실 선택 시 숨김('미지정'은 방 없음이므로 표시), '일반 지출'만 보기 시 숨김.
              (expFilter.roomId === 'all' || expFilter.roomId === 'none') &&
              expFilter.kind !== 'normal' &&
              (expAmountMin == null || (r.pendingAmount ?? r.historicalAvg ?? r.amount) >= expAmountMin) &&
              (expAmountMax == null || (r.pendingAmount ?? r.historicalAvg ?? r.amount) <= expAmountMax)
            )

            // D-3 이내(과거 도래 포함)만 보기 옵션 적용
            const todayStr = kstYmdStr()
            const todayDay = parseInt(todayStr.slice(8, 10), 10)
            const isThisMonth = targetMonth === todayStr.slice(0, 7)
            const isSoon = (dueDay: number) => {
              if (!isThisMonth) return true // 다른 달 보기 시 always show
              return dueDay - todayDay <= 3
            }
            const unconfirmedRecs = recVisibility === 'soon'
              ? unconfirmedRecsFiltered.filter(r => isSoon(r.dueDay))
              : unconfirmedRecsFiltered
            const hiddenRecs = recVisibility === 'soon'
              ? unconfirmedRecsFiltered.filter(r => !isSoon(r.dueDay))
              : []
            const hiddenRecsTotal = hiddenRecs.reduce((s, r) => s + (r.pendingAmount ?? r.amount), 0)

            type ListItem =
              | { kind: 'expense'; exp: Expense; dateStr: string; groupRows?: Expense[]; groupKind?: 'room' | 'order' }
              | { kind: 'recurring'; rec: RecurringExpenseWithStatus; dateStr: string }

            // 아이템별: 방별 분배 묶음(allocationGroupId)만 한 줄로 병합.
            // 주문별: 같은 주문(orderId) 전체를 한 줄로 병합(배송비 포함), 주문 없는 건은 allocationGroup 병합.
            const groupedExpenseRows: { exp: Expense; groupRows?: Expense[]; groupKind?: 'room' | 'order' }[] = (() => {
              const out: { exp: Expense; groupRows?: Expense[]; groupKind?: 'room' | 'order' }[] = []
              const seenOrder = new Set<string>()
              const seenAlloc = new Set<string>()
              for (const e of filteredExpenses) {
                if (expView === 'order' && e.orderId) {
                  if (seenOrder.has(e.orderId)) continue
                  seenOrder.add(e.orderId)
                  const rows = filteredExpenses.filter(x => x.orderId === e.orderId)
                  const nonShip = rows.filter(r => !r.isShipping)
                  // 대표 = 비배송 최대금액 행(없으면 첫 행)
                  const rep = [...nonShip].sort((a, b) => b.amount - a.amount)[0] ?? rows[0]
                  const total = rows.reduce((s, r) => s + r.amount, 0)
                  // 대표 라벨: 같은 품목 수량 합산 + 다른 품목 섞이면 '외'
                  const keyOf = (r: Expense) => `${r.itemLabel ?? ''}|${r.specValue ?? ''}|${r.specUnit ?? ''}|${r.qtyUnit ?? ''}`
                  const repKey = keyOf(rep)
                  const sameRows = nonShip.filter(r => keyOf(r) === repKey)
                  const hasOther = nonShip.some(r => keyOf(r) !== repKey)
                  const fmtQ = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))
                  let repDetail = rep.detail ?? ''
                  if (rep.itemLabel) {
                    const sumQty = sameRows.reduce((s, r) => s + (r.qtyValue ?? 0), 0)
                    const specPart = rep.specValue != null ? ` ${fmtQ(rep.specValue)}${rep.specUnit ?? ''}` : ''
                    const qtyPart = sumQty > 0 ? ` x ${fmtQ(sumQty)}${rep.qtyUnit ?? '개'}` : ''
                    repDetail = `[${rep.itemLabel}]${specPart}${qtyPart}`
                  }
                  if (hasOther) repDetail = `${repDetail} 외`
                  // 판매처 — 같은 주문번호여도 판매처는 다를 수 있음(쿠팡 직접판매/중개판매 등).
                  // 묶을 때 대표행 판매처로 통일하지 말고, 여러 곳이면 '외 N'으로 표기(펼치면 개별 판매처 그대로).
                  const vendors = [...new Set(nonShip.map(r => r.vendor).filter((v): v is string => !!v))]
                  const vendorLabel = vendors.length > 1 ? `${vendors[0]} 외 ${vendors.length - 1}` : (vendors[0] ?? rep.vendor ?? null)
                  out.push({ exp: { ...rep, amount: total, detail: repDetail, vendor: vendorLabel }, groupRows: rows, groupKind: 'order' })
                  continue
                }
                if (e.allocationGroupId) {
                  if (seenAlloc.has(e.allocationGroupId)) continue
                  seenAlloc.add(e.allocationGroupId)
                  const rows = filteredExpenses.filter(x => x.allocationGroupId === e.allocationGroupId)
                  const total = rows.reduce((s, r) => s + r.amount, 0)
                  // 같은 품목을 방별로 나눈 묶음 — 대표 라벨은 전체 수량 합산으로 표기(방배정분 + 미지정분 모두)
                  const fmtQ = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))
                  let repDetail = e.detail ?? ''
                  if (e.itemLabel) {
                    const sumQty = rows.reduce((s, r) => s + (r.qtyValue ?? 0), 0)
                    const specPart = e.specValue != null ? ` ${fmtQ(e.specValue)}${e.specUnit ?? ''}` : ''
                    const qtyPart = sumQty > 0 ? ` x ${fmtQ(sumQty)}${e.qtyUnit ?? '개'}` : ''
                    repDetail = `[${e.itemLabel}]${specPart}${qtyPart}`
                  }
                  out.push({ exp: { ...e, amount: total, detail: repDetail }, groupRows: rows, groupKind: 'room' })
                  continue
                }
                out.push({ exp: e })
              }
              return out
            })()

            const items: ListItem[] = [
              ...groupedExpenseRows.map(g => ({
                kind: 'expense' as const,
                exp: g.exp,
                dateStr: kstYmdStr(new Date(g.exp.date)),
                groupRows: g.groupRows,
                groupKind: g.groupKind,
              })),
              ...unconfirmedRecs.map(r => ({
                kind: 'recurring' as const,
                rec: r,
                // 납부일이 그 달 일수를 넘으면(예: 31일/말일 + 30일 달) 말일로 클램프 — 'YYYY-MM-31' invalid date 방지
                dateStr: (() => {
                  const [ty, tm] = targetMonth.split('-').map(Number)
                  const lastDay = new Date(ty, tm, 0).getDate()
                  return `${targetMonth}-${String(Math.min(r.dueDay, lastDay)).padStart(2, '0')}`
                })(),
              })),
            ].sort((a, b) => {
              // 1차: 날짜 내림차순 (최신 날짜 먼저)
              const dateCmp = b.dateStr.localeCompare(a.dateStr)
              if (dateCmp !== 0) return dateCmp
              // 2차: 같은 날짜면 최근 입력(createdAt) 먼저. recurring은 최후순.
              const aTime = a.kind === 'expense' ? new Date(a.exp.createdAt).getTime() : -Infinity
              const bTime = b.kind === 'expense' ? new Date(b.exp.createdAt).getTime() : -Infinity
              return bTime - aTime
            })

            // 날짜별 '해당일 지출 합계' — 실제 지출만(예정/고정 미확인 제외). 병합 행(주문·방분배)은 이미 합계 금액이라 그대로 합산. (오류신고 f7b0292a)
            const dayTotals = new Map<string, number>()
            for (const it of items) if (it.kind === 'expense') dayTotals.set(it.dateStr, (dayTotals.get(it.dateStr) ?? 0) + it.exp.amount)

            const isEmpty = items.length === 0

            return (
              <>
                {/* 보기 토글 — 아이템별 / 주문별(같은 주문 묶음 + 배송비) */}
                <div className="flex items-center justify-end gap-2">
                  {/* v2.0 §27 — 선택 모드 진입은 명시 버튼, 롱프레스는 보조 (감사 C3) */}
                  {canEditUi && !isEmpty && (
                    <Btn type="button" variant="secondary" size="sm"
                      onClick={() => { mergeMode ? exitMergeMode() : setMergeMode(true) }}>
                      {mergeMode ? '선택 취소' : '선택'}
                    </Btn>
                  )}
                  <SegmentedControl
                    size="sm"
                    ariaLabel="지출 보기"
                    value={expView}
                    onChange={changeExpView}
                    options={[
                      { value: 'item',  label: '아이템별' },
                      { value: 'order', label: '주문별' },
                    ]}
                  />
                </div>
                {/* 고정지출 가시성 토글 + 숨김 요약 */}
                {isThisMonth && unconfirmedRecsFiltered.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <SegmentedControl
                      size="sm"
                      ariaLabel="고정지출 표시"
                      value={recVisibility}
                      onChange={setRecVisibility}
                      options={[
                        { value: 'all',  label: '전체 보기' },
                        { value: 'soon', label: '결제일 D-3' },
                      ]}
                    />
                    {recVisibility === 'soon' && hiddenRecs.length > 0 && (
                      <button onClick={() => setRecVisibility('all')}
                        className="text-xs text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">
                        + 임박하지 않은 고정 <span className="text-[var(--warm-dark)] font-semibold">{hiddenRecs.length}건</span> · 합계 <span className="num text-[var(--warm-dark)] font-semibold">{fmtWon(hiddenRecsTotal)}</span> 숨김
                      </button>
                    )}
                  </div>
                )}
                {/* 모바일 카드 */}
                {isEmpty ? (
                  <div className="sm:hidden bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-10 text-center">
                    <EmptyState title="지출 내역이 없습니다" description="필터를 바꾸거나 지출을 등록해 보세요." className="border-0 bg-transparent" />
                  </div>
                ) : (
                  <div className="sm:hidden space-y-1.5">
                    {items.map((item, idx) => {
                      // 날짜 그룹 구분 — 정렬이 날짜 내림차순이라 날짜가 바뀌는 첫 항목 위에 헤더
                      const showDate = idx === 0 || items[idx - 1].dateStr !== item.dateStr
                      const dateHead = showDate ? (() => {
                        const [yy, mm, dd] = item.dateStr.split('-').map(Number)
                        const DAYS = ['일', '월', '화', '수', '목', '금', '토']
                        const wd = DAYS[new Date(yy, mm - 1, dd).getDay()]
                        return (
                          <div className="flex items-baseline justify-between px-1 pt-2 pb-0.5">
                            <span className="text-[0.6875rem] font-semibold text-[var(--warm-muted)]">{mm}월 {dd}일 ({wd})</span>
                            <span className="num text-[0.6875rem] font-semibold text-[var(--warm-mid)]">합계 {fmtWon((dayTotals.get(item.dateStr) ?? 0))}</span>
                          </div>
                        )
                      })() : null
                      if (item.kind === 'expense') {
                        const e = item.exp
                        const grp = item.groupRows
                        const isUnsettled = e.settleStatus === 'UNSETTLED'
                        const isFixed = !!e.recurringExpenseId
                        const meta = [e.payMethod, e.financialAccount ? accName(e.financialAccount) : null].filter(Boolean).join(' · ')
                        const sel = mergeMode && isExpSelected(e, grp)
                        return (
                          <Fragment key={e.id}>{dateHead}
                          <div key={e.id}
                            onClick={() => {
                              if (mergeMode) { toggleExpSel(e, grp); return }
                              if (grp) { setGroupDetail(grp) } else { setDetailExp(e); setDetailExpEdit(false); setAttachShipSiblings([]); setError('') }
                            }}
                            {...pressExp(mergeMode ? undefined : () => { setMergeMode(true); toggleExpSel(e, grp) })}
                            className={`bg-[var(--cream)] border rounded-xl px-4 py-3 cursor-pointer active:opacity-70 transition-opacity select-none ${sel ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/40 bg-[var(--coral-pale)]' : isUnsettled ? 'border-[var(--danger-ring)]' : 'border-[var(--warm-border)]'}`}>
                            <div className="flex items-start justify-between gap-2">
                              {mergeMode && (
                                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded-full border flex items-center justify-center text-[0.65625rem] ${sel ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)]'}`}>{sel ? <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg> : ''}</span>
                              )}
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  {isFixed && <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0 mt-0.5" />}
                                  <span className="text-[0.65625rem] text-[var(--coral)] font-medium">{e.category}</span>
                                  {grp && (item.groupKind === 'order'
                                    ? <span className="text-[0.65625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded">주문 {grp.filter(r => !r.isShipping).length}품목</span>
                                    : <span className="text-[0.65625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded">{roomChipText(grp)}</span>)}
                                  {isUnsettled && <span className="text-[0.65625rem] text-[var(--danger-fg)] font-medium">· 미정산</span>}
                                </div>
                                {/* 구매처는 리스트에서 숨김 — 상세에서만(운영자 지시 2026-07-06). 검색은 구매처로도 가능. */}
                                <p className="text-sm text-[var(--warm-dark)] truncate">{e.detail || e.vendor || '—'}</p>
                                {grp && (item.groupKind === 'order'
                                  ? <p className="text-[0.6875rem] text-[var(--coral)] truncate mt-0.5">{e.order?.code ? `주문 ${e.order.code}` : '주문 묶음'}{e.order?.externalOrderNo ? ` · 쇼핑몰 ${e.order.externalOrderNo}` : ''}{grp.some(r => r.isShipping) ? ' · 배송비 포함' : ''}</p>
                                  : <p className="text-[0.6875rem] text-[var(--coral)] truncate mt-0.5">{roomsLabel(grp)}</p>)}
                                {item.groupKind !== 'order' && (() => { const c = orderChip(e); return c ? (
                                  <span title={c.title} className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-md bg-[var(--honey)]/15 border border-[var(--honey)]/40 text-[0.65625rem] text-[var(--warm-dark)] font-medium max-w-full truncate">
                                    {c.text}
                                  </span>
                                ) : null })()}
                                <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">
                                  {fmtDate(e.date)}{meta ? ` · ${meta}` : ''}
                                  {e.memo ? ` · ${e.memo}` : ''}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-semibold text-[var(--danger-fg)]"><MoneyDisplay amount={e.amount} prefix="-" alwaysFull /></p>
                                {e.receiptUrl && <span className="text-[0.65625rem] text-[var(--coral)]">영수증</span>}
                              </div>
                            </div>
                          </div>
                          </Fragment>
                        )
                      }
                      // 미확인 고정 지출 카드
                      const r = item.rec
                      const expectedAmt = r.pendingAmount ?? r.historicalAvg ?? r.amount
                      return (
                        <Fragment key={`rec-${r.id}`}>{dateHead}
                        <div key={`rec-${r.id}`}
                          onClick={() => { setRecordingRec(r); setRecRecDirty(false); setRecRecItems(r.items.map(it => ({ name: it.name, amount: it.amount, isVariable: it.isVariable }))); setRecRecAmount(r.items.length > 0 ? r.items.reduce((s, it) => s + it.amount, 0) : expectedAmt); setRecRecDate(kstYmdStr()); setRecRecMemo(r.memo ?? ''); setRecRecPayMethod(r.lastPayMethod ?? r.payMethod ?? '계좌이체'); setRecRecAccId(r.lastFinancialAccountId ?? r.financialAccountId ?? ''); setRecError('') }}
                          className="border border-[var(--warning-ring)] rounded-xl px-4 py-3 cursor-pointer active:opacity-70 transition-opacity bg-[var(--warning-bg)]/30">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0 mt-0.5" />
                                <span className="text-[0.65625rem] text-[var(--warning-fg)] font-medium">{r.category}</span>
                                <span className="text-[0.65625rem] text-[var(--warm-muted)]">고정{r.isVariable ? ' · 변동' : ''}</span>
                              </div>
                              <p className="text-sm text-[var(--warm-dark)] font-medium truncate">{r.title}</p>
                              <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">
                                {item.dateStr.slice(5).replace('-', '/')} 납부{r.isAutoDebit ? ' · 자동이체' : ''}
                                {r.pendingAmount != null ? ` · 예약금액 있음` : ''}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold text-[var(--danger-fg)]"><MoneyDisplay amount={expectedAmt} prefix="-" /></p>
                              {r.isVariable && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">예상치</p>}
                            </div>
                          </div>
                        </div>
                        </Fragment>
                      )
                    })}
                  </div>
                )}

                {/* 데스크탑 테이블 */}
                <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100vh-340px)]">
                  {isEmpty ? (
                    <EmptyState title="지출 내역이 없습니다" description="필터를 바꾸거나 지출을 등록해 보세요." className="border-0 bg-transparent" />
                  ) : (
                    <table className="w-full" style={{
                      tableLayout: 'fixed',
                      minWidth: ['expDate','expMethod','expCategory','expDetail','expAmount','expSettle'].reduce((s, k) => s + (finColWidths[k] ?? 100), 0),
                    }}>
                      <thead className="sticky top-0 z-10 bg-[var(--cream)]">
                        <tr className="border-b border-[var(--warm-border)]">
                          <ResizableTh label="날짜"     colKey="expDate" />
                          <ResizableTh label="결제수단" colKey="expMethod" />
                          <ResizableTh label="카테고리" colKey="expCategory" />
                          <ResizableTh label="세부 항목" colKey="expDetail" />
                          <ResizableTh label="금액"     colKey="expAmount" />
                          <ResizableTh label="상태"     colKey="expSettle" />
                        </tr>
                      </thead>
                      <tbody>
                        {items.map((item, idx) => {
                          // 날짜 그룹 소계 행 — 날짜가 바뀌는 첫 행 위에 '해당일 합계'. (오류신고 f7b0292a)
                          const showDate = idx === 0 || items[idx - 1].dateStr !== item.dateStr
                          const dayHead = showDate ? (
                            <tr key={`dh-${item.dateStr}`} className="bg-[var(--canvas)]/50 border-b border-[var(--warm-border)]">
                              <td colSpan={6} className="px-4 py-1.5">
                                <div className="flex items-center justify-between">
                                  <span className="text-[0.6875rem] font-semibold text-[var(--warm-muted)]">{fmtDate(item.dateStr)}</span>
                                  <span className="num text-[0.6875rem] font-semibold text-[var(--warm-mid)]">해당일 합계 {fmtWon((dayTotals.get(item.dateStr) ?? 0))}</span>
                                </div>
                              </td>
                            </tr>
                          ) : null
                          if (item.kind === 'expense') {
                            const e = item.exp
                            const grp = item.groupRows
                            const selRow = mergeMode && isExpSelected(e, grp)
                            return (
                              <Fragment key={e.id}>{dayHead}
                              <tr
                                onClick={() => {
                                  if (mergeMode) { toggleExpSel(e, grp); return }
                                  if (grp) { setGroupDetail(grp) } else { setDetailExp(e); setDetailExpEdit(false); setAttachShipSiblings([]); setError('') }
                                }}
                                {...pressExp(mergeMode ? undefined : () => { setMergeMode(true); toggleExpSel(e, grp) })}
                                className={`border-b border-[var(--warm-border)]/50 transition-colors cursor-pointer select-none ${selRow ? 'bg-[var(--coral-pale)] ring-1 ring-inset ring-[var(--coral)]/40' : 'hover:bg-[var(--canvas)]/40'}`}>
                                <td className="px-4 py-3 text-xs text-[var(--warm-mid)] overflow-hidden"><span className="truncate block">{mergeMode ? (selRow ? '☑ ' : '☐ ') : ''}{fmtDate(e.date)}</span></td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <p className="text-xs text-[var(--warm-dark)] truncate">{e.payMethod ?? '—'}</p>
                                  {e.financialAccount && <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">{accName(e.financialAccount)}</p>}
                                </td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    {e.recurringExpenseId && <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0" title="고정지출" />}
                                    <span className="text-xs text-[var(--coral)] font-medium truncate">{e.category}</span>
                                    {e.recurringExpense?.isVariable && <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">변동</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate">{e.detail ?? '—'}</span>
                                    {grp && (item.groupKind === 'order'
                                      ? <span className="text-[0.65625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded shrink-0">주문 {grp.filter(r => !r.isShipping).length}품목</span>
                                      : <span className="text-[0.65625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded shrink-0">{roomChipText(grp)}</span>)}
                                    {e.receiptUrl && <span className="text-[0.65625rem] text-[var(--coral)] shrink-0">영수증</span>}
                                  </div>
                                  {grp && (item.groupKind === 'order'
                                    ? <p className="text-[0.65625rem] text-[var(--coral)] truncate mt-0.5">{e.order?.code ? `주문 ${e.order.code}` : '주문 묶음'}{e.order?.externalOrderNo ? ` · 쇼핑몰 ${e.order.externalOrderNo}` : ''}{grp.some(r => r.isShipping) ? ' · 배송비 포함' : ''}</p>
                                    : <p className="text-[0.65625rem] text-[var(--coral)] truncate mt-0.5">{roomsLabel(grp)}</p>)}
                                  {item.groupKind !== 'order' && (() => { const c = orderChip(e); return c ? (
                                    <span title={c.title} className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-md bg-[var(--honey)]/15 border border-[var(--honey)]/40 text-[0.65625rem] text-[var(--warm-dark)] font-medium max-w-full truncate">
                                      {c.text}
                                    </span>
                                  ) : null })()}
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-[var(--danger-fg)] overflow-hidden"><span className="truncate block"><MoneyDisplay amount={e.amount} prefix="-" /></span></td>
                                <td className="px-4 py-3 overflow-hidden">
                                  {e.settleStatus === 'UNSETTLED'
                                    ? <span className="text-xs text-[var(--danger-fg)] font-medium">미정산</span>
                                    : <span className="text-xs text-[var(--warm-muted)]">정산완료</span>}
                                </td>
                              </tr>
                              </Fragment>
                            )
                          }
                          // 미확인 고정 지출 행
                          const r = item.rec
                          // 예약 금액이 있으면 우선 prefill, 없으면 평균 또는 기본 금액
                      const expectedAmt = r.pendingAmount ?? r.historicalAvg ?? r.amount
                          return (
                            <Fragment key={`rec-${r.id}`}>{dayHead}
                            <tr
                              onClick={() => { setRecordingRec(r); setRecRecDirty(false); setRecRecItems(r.items.map(it => ({ name: it.name, amount: it.amount, isVariable: it.isVariable }))); setRecRecAmount(r.items.length > 0 ? r.items.reduce((s, it) => s + it.amount, 0) : expectedAmt); setRecRecDate(kstYmdStr()); setRecRecMemo(r.memo ?? ''); setRecRecPayMethod(r.lastPayMethod ?? r.payMethod ?? '계좌이체'); setRecRecAccId(r.lastFinancialAccountId ?? r.financialAccountId ?? ''); setRecError('') }}
                              className="border-b border-[var(--warm-border)] bg-[var(--canvas)]/40 hover:bg-[var(--canvas)] transition-colors cursor-pointer"
                              style={{ boxShadow: 'inset 3px 0 0 var(--warning-fg)' }}>
                              <td className="px-4 py-3 text-xs text-[var(--warm-muted)] overflow-hidden">
                                <span className="truncate block">{item.dateStr.slice(5).replace('-', '/')} 납부</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] whitespace-nowrap">{r.payMethod ?? '—'}</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0" />
                                    <span className="text-xs text-[var(--coral)] font-medium truncate">{r.category}</span>
                                    {r.isVariable && <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0">변동</span>}
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                                <span className="truncate block font-medium">{r.title}</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="text-sm font-semibold text-[var(--danger-fg)] truncate block">
                                  <MoneyDisplay amount={expectedAmt} prefix="-" />
                                </span>
                                {r.isVariable && <span className="text-[0.65625rem] text-[var(--warm-muted)]">예상치</span>}
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="text-xs text-[var(--warning-fg)] font-medium">
                                  {r.isAutoDebit ? '자동이체' : '확인 필요'}
                                </span>
                              </td>
                            </tr>
                            </Fragment>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 활성화 예정 항목 (하단) */}
                {pendingRecs.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-semibold text-[var(--warm-muted)] px-1">활성화 예정 · 아직 내 부담이 아닌 항목</p>
                    <div className="sm:hidden space-y-2">
                      {pendingRecs.map(rec => (
                        <div key={rec.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 opacity-50">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-[var(--warm-muted)]">매월 {rec.dueDay}일</span>
                            <Badge tone="pale-blue">{rec.activeSince?.slice(0, 7)} 활성화</Badge>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <Badge tone="pale-coral">{rec.category}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <p className="text-xs text-[var(--warm-dark)] font-medium">{rec.title}</p>
                            <span className="text-sm font-bold text-[var(--warm-muted)]"><MoneyDisplay amount={rec.amount} prefix="-" /></span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden opacity-60">
                      <table className="w-full">
                        <tbody className="divide-y divide-[var(--warm-border)]/50">
                          {pendingRecs.map(rec => (
                            <tr key={rec.id} className="bg-[var(--canvas)]/30">
                              <td className="px-4 py-3 text-xs text-[var(--warm-muted)] w-24">매월 {rec.dueDay}일</td>
                              <td className="px-4 py-3 text-xs text-[var(--warm-muted)] w-28">{rec.payMethod ?? '—'}</td>
                              <td className="px-4 py-3 text-xs text-[var(--warm-muted)]">{rec.category}</td>
                              <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{rec.title}</td>
                              <td className="px-4 py-3 text-sm text-[var(--warm-muted)] text-right"><MoneyDisplay amount={rec.amount} prefix="-" /></td>
                              <td className="px-4 py-3 text-right w-32">
                                <span className="text-[0.65625rem] font-semibold text-[var(--info-fg)] bg-[var(--info-bg)] px-2 py-1 rounded-lg">{rec.activeSince?.slice(0, 7)} 활성화</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </>
            )
          })()}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          탭 3: 카드 대금 정산
      ══════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════
          탭 4: 자산 관리
      ══════════════════════════════════════════════════════════ */}
      {tab === 'assets' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

          {/* 등록/수정 폼 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">
              {editingAcc ? '자산 수정' : '자산 등록'}
            </h2>
            <form key={assetFormKey} onSubmit={handleSaveAsset} className="space-y-3">
              {editingAcc && <input type="hidden" name="id" value={editingAcc.id} />}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">분류 *</label>
                <select name="type" value={assetType}
                  onChange={e => { setAssetType(e.target.value); setAssetBrand('') }}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="BANK_ACCOUNT">은행계좌</option>
                  <option value="CREDIT_CARD">신용카드</option>
                  <option value="DEBIT_CARD">체크카드</option>
                  <option value="PREPAID">선불/상품권</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">
                  {assetType === 'BANK_ACCOUNT' ? '은행' : assetType === 'PREPAID' ? '서비스' : '카드'} *
                </label>
                <div className="flex items-center gap-2">
                  <BrandLogo name={assetBrand} size={22} />
                  <select name="brand" value={assetBrand}
                    onChange={e => setAssetBrand(e.target.value)}
                    className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    <option value="">선택하세요</option>
                    {(assetType === 'BANK_ACCOUNT' ? BANKS
                      : assetType === 'CREDIT_CARD' ? CREDIT_CARDS
                      : assetType === 'PREPAID' ? PREPAID_BRANDS
                      : DEBIT_CARDS
                    ).map(b => (
                      <option key={b.name} value={b.name}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">별칭</label>
                  <input type="text" name="alias"
                    defaultValue={editingAcc?.alias ?? ''}
                    placeholder="예: 생활비 카드"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">
                    {assetType === 'BANK_ACCOUNT' ? '계좌번호' : '번호 (끝 4자리)'}
                  </label>
                  <input type="text" name="identifier"
                    defaultValue={editingAcc?.identifier ?? ''}
                    placeholder={assetType === 'BANK_ACCOUNT' ? '예: 110-123-456789' : '예: 1234'}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">소유주명</label>
                <input type="text" name="owner"
                  defaultValue={editingAcc?.owner ?? ''}
                  placeholder="예: 홍길동"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
              </div>

              {/* 카드 전용 필드 */}
              {(assetType === 'CREDIT_CARD' || assetType === 'DEBIT_CARD') && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제일</label>
                  <input type="text" name="payDay"
                    value={payDayInput}
                    onChange={e => setPayDayInput(e.target.value.replace(/일$/, ''))}
                    onBlur={e => {
                      const raw = e.target.value.replace(/일$/, '').trim()
                      if (/^\d+$/.test(raw)) setPayDayInput(raw + '일')
                    }}
                    placeholder="예: 15, 말일"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                </div>
              )}
              {assetType === 'CREDIT_CARD' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">이용종료일 (결제 기준일)</label>
                    <input type="text" name="cutOffDay"
                      value={cutOffDayInput}
                      onChange={e => setCutOffDayInput(e.target.value.replace(/일$/, ''))}
                      onBlur={e => {
                        const raw = e.target.value.replace(/일$/, '').trim()
                        if (/^\d+$/.test(raw)) setCutOffDayInput(raw + '일')
                      }}
                      placeholder="예: 25, 말일"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">결제 연결 계좌</label>
                    <select name="linkedAccountId"
                      defaultValue={editingAcc?.linkedAccountId ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>{accName(a)}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {assetError && <p className="text-[var(--danger-fg)] text-sm">{assetError}</p>}

              <div className="flex gap-2 pt-1">
                {editingAcc && (
                  <Btn type="button" variant="secondary" size="md" className="flex-1"
                    onClick={() => { setEditingAcc(null); setAssetType('BANK_ACCOUNT'); setAssetBrand(''); setAssetFormKey(k => k + 1) }}>
                    취소
                  </Btn>
                )}
                <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                  {isPending ? '저장 중…' : (editingAcc ? '수정 저장' : '등록')}
                </Btn>
              </div>
            </form>
          </div>

          {/* 자산 목록 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[var(--warm-border)]">
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">등록된 자산 목록</h2>
            </div>
            {financialAccounts.length === 0 ? (
              <EmptyState title="등록된 자산이 없습니다" />
            ) : (
              <div>
                {(
                  [
                    { type: 'BANK_ACCOUNT', label: '은행계좌' },
                    { type: 'CREDIT_CARD',  label: '신용카드' },
                    { type: 'DEBIT_CARD',   label: '체크카드' },
                    { type: 'PREPAID',      label: '선불/상품권' },
                  ] as const
                ).map(({ type, label }) => {
                  const group = financialAccounts.filter(a => a.type === type)
                  if (group.length === 0) return null
                  return (
                    <div key={type} className="border-b border-[var(--warm-border)] last:border-0">
                      <p className="px-5 pt-3 pb-1 text-[0.65625rem] font-semibold uppercase tracking-wide text-[var(--warm-muted)]">{label}</p>
                      <div className="divide-y divide-[var(--warm-border)]/50">
                        {group.map(a => (
                          <div key={a.id} className="px-5 py-3.5 flex items-center gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <BrandLogo name={a.brand} size={16} />
                                <span className="text-sm font-medium text-[var(--warm-dark)]">{accName(a)}</span>
                                {a.identifier && (
                                  <span className="text-xs text-[var(--warm-muted)]">
                                    {a.type === 'BANK_ACCOUNT' ? a.identifier : `···${a.identifier}`}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-[var(--warm-muted)] mt-0.5 space-x-2">
                                {a.owner && <span>{a.owner}</span>}
                                {a.payDay && <span>결제일: {displayDay(a.payDay)}</span>}
                                {a.cutOffDay && <span>기준일: {displayDay(a.cutOffDay)}</span>}
                                {a.linkedAccount && <span>출금: {accName(a.linkedAccount)}</span>}
                              </div>
                            </div>
                            <button
                              onClick={() => { setEditingAcc(a); setAssetType(a.type); setAssetBrand(a.brand ?? ''); setAssetFormKey(k => k + 1) }}
                              className="text-xs text-[var(--coral)] px-3 py-1.5 bg-[var(--coral)]/10 rounded-lg transition-colors shrink-0">
                              수정
                            </button>
                            <button
                              onClick={() => handleDeactivateAsset(a.id)}
                              className="text-xs text-[var(--warning-fg)] hover:text-[var(--warning-fg)] px-3 py-1.5 bg-[var(--warning-bg)] rounded-lg transition-colors shrink-0">
                              해지
                            </button>
                            <button
                              onClick={() => handleDeleteAsset(a.id)}
                              className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] px-3 py-1.5 bg-[var(--danger-bg)] rounded-lg transition-colors shrink-0">
                              삭제
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 방별 분배 묶음 — 방별 금액 펼침
      ══════════════════════════════════════════════════════════ */}
      {groupDetail && (
        <Modal open onClose={() => setGroupDetail(null)} width="sm"
          title={groupDetail[0]?.order?.code ? `주문 ${groupDetail[0].order.code}` : '주문 묶음'}
          subtitle={`${groupDetail[0]?.order?.externalOrderNo ? `쇼핑몰 ${groupDetail[0].order.externalOrderNo} · ` : ''}${groupDetail.length}건 · 합계 ${fmtWon(groupDetail.reduce((s, r) => s + r.amount, 0))}`}>
          <ul className="overflow-y-auto px-4 py-3 space-y-1.5">
              {groupDetail.map(r => (
                <li key={r.id}>
                  <button type="button"
                    onClick={() => { setGroupDetail(null); setDetailExp(r); setDetailExpEdit(false); setAttachShipSiblings([]); setError('') }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--canvas)] hover:bg-[var(--warm-border)]/30 transition-colors text-left">
                    <span className="text-sm text-[var(--warm-dark)] truncate">
                      {r.isShipping ? '배송비' : (r.room ? (/^\d+$/.test(r.room.roomNo) ? `${r.room.roomNo}호` : r.room.roomNo) : (r.allocationGroupId ? '미배정' : (r.detail || r.itemLabel || '방 미배정')))}
                      {r.qtyValue ? <span className="text-[var(--warm-muted)]"> · {r.qtyValue}{r.qtyUnit ?? ''}</span> : null}
                    </span>
                    <span className="text-sm font-semibold text-[var(--danger-fg)] shrink-0 tabular-nums">{fmtWon(r.amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-6 pb-4 text-[0.65625rem] text-[var(--warm-muted)]">각 방 항목을 누르면 개별 수정·삭제할 수 있습니다.</p>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 지출 상세 / 수정
      ══════════════════════════════════════════════════════════ */}
      {detailExp && (
        <Modal open width="sm" dirty={detailExpEdit && expEditDirty}
          onClose={() => { setDetailExp(null); setDetailExpEdit(false); setExpEditDirty(false) }}
          title={detailExpEdit ? '지출 수정' : '지출 상세'}>

            {!detailExpEdit ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  <DetailRow label="날짜"        value={fmtDate(detailExp.date)} />
                  <DetailRow label="카테고리"    value={detailExp.category} />
                  {detailExp.vendor && <DetailRow label="구매처"   value={detailExp.vendor} />}
                  <DetailRow label="세부 항목"   value={detailExp.detail ?? '—'} />
                  <DetailRow label="금액"        value={<span className="text-[var(--danger-fg)] font-semibold"><MoneyDisplay amount={detailExp.amount} prefix="-" /></span>} />
                  {/* #1 관리비 묶음: 세부 내역(breakdownJson)이 있으면 펼쳐 표시 */}
                  {detailExp.breakdownJson && (() => {
                    let bd: { name: string; amount: number; isVariable: boolean }[] = []
                    try { bd = JSON.parse(detailExp.breakdownJson) } catch { /* ignore */ }
                    if (bd.length === 0) return null
                    return (
                      <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-3 space-y-1.5">
                        <p className="text-[0.6875rem] font-medium text-[var(--warm-muted)]">세부 내역</p>
                        {bd.map((it, i) => (
                          <div key={i} className="flex items-center justify-between text-xs">
                            <span className="text-[var(--warm-dark)]">
                              {it.name}
                              {it.isVariable && <span className="ml-1 text-[0.65625rem] text-[var(--warning-fg)]">(변동)</span>}
                            </span>
                            <span className="num text-[var(--warm-dark)]">{fmtWon(it.amount)}</span>
                          </div>
                        ))}
                      </div>
                    )
                  })()}
                  {detailExp.room && <DetailRow label="대상 호실" value={`${detailExp.room.roomNo}호`} />}
                  <DetailRow label="결제수단"    value={detailExp.payMethod ?? '—'} />
                  {detailExp.financeName && <DetailRow label="금융사" value={detailExp.financeName} />}
                  <DetailRow label="정산상태"    value={
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ring-1 ${detailExp.settleStatus === 'UNSETTLED' ? 'bg-[var(--danger-bg)] text-[var(--danger-fg)] ring-[var(--danger-ring)]' : 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-[var(--success-ring)]'}`}>
                      {detailExp.settleStatus === 'UNSETTLED' ? '미정산' : '정산완료'}
                    </span>
                  } />
                  {detailExp.memo && <DetailRow label="메모" value={detailExp.memo} />}
                  {detailExp.order && (
                    <DetailRow label="주문 묶음" value={
                      <span className="text-[var(--warm-dark)]">
                        {(() => { const s = orderSummaries.get(detailExp.order!.id); return s ? s.label : detailExp.order!.code })()}
                        {detailExp.order.shippingType && <span className="ml-1 text-[var(--warm-muted)]">· 배송 {detailExp.order.shippingType}</span>}
                        <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">({detailExp.order.code})</span>
                        {detailExp.order.externalOrderNo && <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">· 쇼핑몰 {detailExp.order.externalOrderNo}</span>}
                      </span>
                    } />
                  )}
                  {detailExp.receiptUrl && (
                    <div className="pt-2">
                      <p className="text-xs text-[var(--warm-muted)] mb-1.5">영수증 <AiQuotaHint className="ml-1" /></p>
                      <a href={detailExp.receiptUrl} target="_blank" rel="noopener noreferrer">
                        <img src={detailExp.receiptUrl} className="rounded-xl border border-[var(--warm-border)] w-full max-h-48 object-contain" alt="영수증" />
                      </a>
                    </div>
                  )}
                  {/* 재고 계산 제외 상태 — 적용취소(다시 포함) 제공 */}
                  {detailExp.excludeFromInventory && !detailExp.isShipping && detailExp.itemLabel && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--warm-border)]/50">
                      <span className="text-[0.65625rem] text-[var(--warm-muted)]">이 구매는 재고 계산에서 제외돼 있습니다.</span>
                      <button onClick={() => startTransition(async () => {
                        const r = await includeExpenseInInventory(detailExp.id)
                        if (!r.ok) { pushToast('error', r.error); return }
                        pushToast('success', '재고 계산에 다시 포함됨'); router.refresh()
                        setDetailExp({ ...detailExp, excludeFromInventory: false })
                      })} disabled={isPending}
                        className="shrink-0 px-2.5 py-1 text-[0.65625rem] font-medium rounded-lg border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--canvas)] transition-colors disabled:opacity-40">
                        적용취소
                      </button>
                    </div>
                  )}
                  {/* 배송비(합배송 등) 관리는 [수정]에서 일괄 — 안내만 */}
                  {!detailExp.isShipping && (
                    <p className="pt-2 border-t border-[var(--warm-border)]/50 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                      배송비(이 금액에 합산 / 별도 지출로 묶기)는 아래 <strong>[수정]</strong> 에서 관리합니다.
                    </p>
                  )}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <Btn variant="danger" size="md" onClick={() => handleDeleteExp(detailExp)} disabled={isPending}>
                    {detailExp.recurringExpenseId ? '이번 달 기록 취소' : '삭제'}
                  </Btn>
                  {detailExp.settleStatus === 'SETTLED' && (detailExp.payMethod === '신용카드' || detailExp.payMethod === '체크카드') && (
                    <button onClick={() => handleUnsettle(detailExp.id)} disabled={isPending}
                      className="min-h-[44px] px-4 py-2.5 bg-[var(--warning-bg)] hover:bg-[var(--warning-ring)] text-[var(--warning-fg)] text-sm rounded-lg transition-colors disabled:opacity-40">
                      정산 취소
                    </button>
                  )}
                  <div className="flex-1" />
                  <Btn variant="primary" size="md" onClick={() => {
                    setExpEditDirty(false); setDetailExpEdit(true)
                    setEditExpDate(toDateInput(detailExp.date))
                    setEditExpMethod(detailExp.payMethod ?? '계좌이체')
                    setEditExpAccId(detailExp.financialAccountId ?? '')
                    setEditExpAccName(detailExp.financeName ?? '')
                    setEditExpRoomId(detailExp.roomId ?? '')
                    setEditReceiptUrl(detailExp.receiptUrl ?? '')
                    setEditExpCategory(detailExp.category)
                    // '배송비 포함'(합산형)으로 등록된 지출 — detail 의 '배송비 N원' 표기에서 합산분 복원.
                    // 안 하면 수정 저장 시 배송비가 이중 합산되거나 표기가 사라지고 단가가 부풀던 문제.
                    const shipMatch = !detailExp.isShipping ? (detailExp.detail ?? '').match(/배송비\s*([\d,]+)원/) : null
                    const includedShip = shipMatch ? parseInt(shipMatch[1].replace(/,/g, ''), 10) || 0 : 0
                    const baseAmount = detailExp.amount - includedShip
                    setEditItems(detailExp.itemLabel ? [{
                      label: detailExp.itemLabel,
                      specValue: detailExp.specValue?.toString() ?? '',
                      specUnit:  detailExp.specUnit ?? '',
                      // 서술형 규격·단가 기준 복원 — 누락 시 수정 저장에서 specText가 소실되던 버그(오류신고 5f44f5df)
                      specText:  detailExp.specText ?? undefined,
                      unitBasis: detailExp.unitBasis === 'qty' ? 'qty' : detailExp.unitBasis === 'spec' ? 'spec' : undefined,
                      // 수량 미입력 항목은 자동 1개로 (confirmAdd 와 동일 규칙) — 재저장 시 "x 1개" 일관 표기
                      qtyValue:  detailExp.qtyValue != null ? detailExp.qtyValue.toString() : '1',
                      qtyUnit:   detailExp.qtyValue != null ? (detailExp.qtyUnit ?? '') : (detailExp.qtyUnit ?? '개'),
                      amount:    baseAmount,
                      // 단가 복원 — (금액−배송비)÷기준수량. 개당(qty) 기준이면 규격 나눗셈 제외(basis 인지).
                      unitPrice: Math.round(baseAmount / ((Number(detailExp.qtyValue) || 1) * (detailExp.unitBasis === 'qty' ? 1 : (Number(detailExp.specValue) || 1)))),
                    }] : [])
                    setEditExpAmount(baseAmount)
                    setEditExpDetail((detailExp.detail ?? '').replace(/\s*·?\s*배송비\s*[\d,]+원/, '').trim())
                    setEditHasShipping(includedShip > 0); setEditShipping(includedShip > 0 ? includedShip : undefined)
                    // 이미 합배송 주문에 묶여 있으면 '별도 묶기' 모드로 프리필.
                    // 배송비 라인 자체는 제외 — 자기 자신을 다시 묶으려다 '지출을 찾을 수 없습니다' 오류가 나던 문제.
                    if (detailExp.order && !detailExp.isShipping) {
                      const shipRow = expenses.find(x => x.orderId === detailExp.order!.id && x.isShipping)
                      setEditShipSeparate(true)
                      setAttachShipAmount(shipRow?.amount)
                      setAttachShipType((detailExp.order.shippingType as '선불' | '착불' | '신용') ?? '선불')
                      setAttachShipMemo(detailExp.order.shippingMemo ?? '')
                      setAttachShipSiblings([])
                    } else {
                      setEditShipSeparate(false); setAttachShipAmount(undefined); setAttachShipMemo(''); setAttachShipSiblings([])
                    }
                    setError('')
                  }}>수정</Btn>
                </div>
              </>
            ) : (
              <form key={detailExp.id + '-edit'} onSubmit={handleUpdateExp} className="flex flex-col flex-1 overflow-hidden"
                onInput={() => requestAnimationFrame(() => setExpEditDirty(true))} onChange={() => setExpEditDirty(true)}>
                <input type="hidden" name="id" value={detailExp.id} />
                <input type="hidden" name="financialAccountId" value={editExpAccId} />
                <input type="hidden" name="financeName" value={editExpAccName} />
                <input type="hidden" name="roomId" value={editItems.some(it => (it.allocations?.length ?? 0) > 0) ? '' : editExpRoomId} />
                <input type="hidden" name="excludeFromInventory" value={detailExp.excludeFromInventory ? '1' : ''} />
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                      <DatePicker name="date" value={editExpDate} onChange={setEditExpDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">
                        금액 *{editItems.length >= 1 && <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal ml-1">(품목 합계 자동)</span>}
                        {editHasShipping && (editShipping ?? 0) > 0 && <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal ml-1">(+배송비 포함)</span>}
                      </label>
                      {(() => {
                        const base = editItems.length >= 1 ? editItems.reduce((s, it) => s + (it.amount ?? 0), 0) : (editExpAmount ?? 0)
                        const ship = editHasShipping ? (editShipping ?? 0) : 0
                        const total = base + ship
                        return (
                          <>
                            <input type="hidden" name="amount" value={total} />
                            {/* 합산형 배송비 — 서버 품목합 검증에서 차감(품목 2개+ 도 저장 가능) */}
                            <input type="hidden" name="shippingIncluded" value={ship} />
                            {editItems.length >= 1 ? (
                              <div className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]">
                                {fmtWon(total)}
                                {ship > 0 && <span className="text-[0.65625rem] text-[var(--warm-muted)] ml-1">(품목 {base.toLocaleString()} + 배송 {ship.toLocaleString()})</span>}
                              </div>
                            ) : (
                              <MoneyInput value={editExpAmount} onChange={setEditExpAmount} placeholder="0원" />
                            )}
                          </>
                        )
                      })()}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                    {/* 카테고리 변경 시 품목 유지 — 저장하면 품목째 새 카테고리로 이동(운영자 지시 2026-07-13).
                        서버(updateExpense)가 제출 카테고리로 품목 행을 저장하고 수령 상태도 보존한다.
                        재고 추적 카테고리 밖으로 옮기면 그 품목은 재고 인식에서 빠진다(카테고리 기준 인식). */}
                    <select name="category" value={editExpCategory}
                      onChange={e => setEditExpCategory(e.target.value)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">구매처</label>
                    <input type="text" name="vendor" defaultValue={detailExp.vendor ?? ''} placeholder="예: 쿠팡, 다이소" list="edit-exp-vendors"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                    <datalist id="edit-exp-vendors">{vendorSuggestions.map(v => <option key={v} value={v} />)}</datalist>
                  </div>
                  {(
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">품목 선택 <span className="text-[var(--warm-muted)] font-normal">(여러 품목 추가 가능)</span></label>
                      <ItemSelector
                        category={editExpCategory}
                        value={editItems}
                        onChange={setEditItems}
                        rooms={editIsDurable ? [] : rooms}
                        detailSuggestions={detailSuggestions}
                        isService={!!detailExp?.excludeFromInventory}
                      />
                      {editIsDurable && (
                        <p className="text-[0.65625rem] text-[var(--warm-muted)]">비품·자재는 <strong className="text-[var(--warm-mid)]">재고 &gt; 비품·자재</strong> 탭에서 방·공용부에 배정합니다.</p>
                      )}
                    </div>
                  )}
                  {/* 배송비 — 두 방식(합산 / 별도 묶기)을 한 곳에 모아 명확히 구분.
                      배송비 라인 자체엔 비노출(자기 자신을 묶는 모순 방지) — 금액·결제구분만 일반 필드로 수정 */}
                  {!detailExp.isShipping && (
                  <div className="space-y-2 rounded-xl border border-[var(--warm-border)]/60 bg-[var(--canvas)]/40 px-3 py-2.5">
                    <p className="text-xs font-semibold text-[var(--warm-mid)]">배송비 <span className="text-[var(--warm-muted)] font-normal">(선택)</span></p>
                    <label className="flex items-center gap-1.5 text-xs text-[var(--warm-dark)] cursor-pointer">
                      <input type="checkbox" checked={editHasShipping}
                        onChange={e => { setEditHasShipping(e.target.checked); if (e.target.checked) setEditShipSeparate(false); else setEditShipping(undefined) }}
                        className="w-3.5 h-3.5 accent-[var(--coral)]" />
                      <span><strong>이 지출 금액에 합산</strong> · 별도 줄 없이 총액에만 더함</span>
                    </label>
                    {editHasShipping && (
                      <div className="pl-5">
                        <MoneyInput value={editShipping} onChange={setEditShipping} placeholder="배송비 0원" />
                        <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-1">품목 단가엔 미포함, 총액에만 더해집니다.</p>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[var(--warm-dark)] cursor-pointer">
                      <input type="checkbox" checked={editShipSeparate}
                        onChange={e => { setEditShipSeparate(e.target.checked); if (e.target.checked) { setEditHasShipping(false); setEditShipping(undefined) } }}
                        className="w-3.5 h-3.5 accent-[var(--coral)]" />
                      <span><strong>다른 지출과 한 주문으로 묶기</strong> · 같은 날 항목 선택. 배송비 있으면 입력(없으면 묶기만)</span>
                    </label>
                    {editShipSeparate && detailExp && (
                      <div className="pl-5 space-y-2">
                        <MoneyInput value={attachShipAmount} onChange={setAttachShipAmount} placeholder="배송비 0원 (없으면 비워두기)" />
                        <div className="flex items-center gap-1.5">
                          {(['선불', '착불', '신용'] as const).map(t => (
                            <button key={t} type="button" onClick={() => setAttachShipType(t)}
                              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${attachShipType === t ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--cream-2)] text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
                              {t}
                            </button>
                          ))}
                        </div>
                        <input type="text" value={attachShipMemo} onChange={e => setAttachShipMemo(e.target.value)}
                          placeholder="배송 메모 (선택)"
                          className="w-full bg-[var(--cream-2)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                        {(() => {
                          const sibs = expenses.filter(e =>
                            e.id !== detailExp.id && !e.isShipping &&
                            kstYmdStr(new Date(e.date)) === kstYmdStr(new Date(detailExp.date)) &&
                            (!e.orderId || e.orderId === detailExp.orderId)
                          )
                          if (sibs.length === 0) return null
                          const toggle = (id: string) => setAttachShipSiblings(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
                          return (
                            <div className="space-y-1">
                              <p className="text-[0.65625rem] font-medium text-[var(--warm-mid)]">같은 날 다른 지출도 함께 묶기 (선택)</p>
                              <div className="space-y-1 max-h-28 overflow-auto">
                                {sibs.map(s => (
                                  <label key={s.id} className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer px-1.5 py-1 rounded-md hover:bg-[var(--cream)]">
                                    <input type="checkbox" checked={attachShipSiblings.includes(s.id)} onChange={() => toggle(s.id)}
                                      className="w-3.5 h-3.5 accent-[var(--coral)] shrink-0" />
                                    <span className="truncate flex-1">{[s.vendor, s.detail].filter(Boolean).join(' · ') || s.category}</span>
                                    <span className="text-[var(--warm-muted)] shrink-0">{fmtWon(s.amount)}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                        <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">아래에서 같은 주문 항목을 선택하면 같은 주문번호로 묶입니다. 배송비를 입력하면 배송비 1건도 함께 기록(신용=미정산), 비워두면 묶기만 됩니다. 체크 해제 후 저장하면 묶음 해제.</p>
                      </div>
                    )}
                  </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                    {editItems.length > 0
                      ? <input type="text" value={fmtItemListDetail(editItems)} readOnly
                          className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
                      : <input type="text" value={editExpDetail} onChange={e => setEditExpDetail(e.target.value)} placeholder="세부 내용"
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                    }
                    {/* 제출 detail = 표시 내용 + 배송비 표기(있으면) */}
                    <input type="hidden" name="detail" value={`${editItems.length > 0 ? fmtItemListDetail(editItems) : editExpDetail}${editHasShipping && (editShipping ?? 0) > 0 ? `${(editItems.length > 0 || editExpDetail) ? ' · ' : ''}배송비 ${fmtWon((editShipping ?? 0))}` : ''}`} />
                    {editItems.length > 0 && <>
                      <input type="hidden" name="itemsJson" value={JSON.stringify(editItems.map(it => ({ ...it, setHint: undefined, allocations: editIsDurable ? undefined : it.allocations })))} />
                      {editItems.length === 1 && (
                        <>
                          <input type="hidden" name="itemLabel" value={editItems[0].label} />
                          <input type="hidden" name="specValue" value={editItems[0].specValue} />
                          <input type="hidden" name="specUnit"  value={editItems[0].specUnit} />
                          <input type="hidden" name="specText"  value={editItems[0].specText ?? ''} />
                          <input type="hidden" name="unitBasis" value={editItems[0].unitBasis ?? ''} />
                          <input type="hidden" name="qtyValue"  value={editItems[0].qtyValue} />
                          <input type="hidden" name="qtyUnit"   value={editItems[0].qtyUnit} />
                        </>
                      )}
                    </>}
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
                    <select name="payMethod" value={editExpMethod}
                      onChange={e => { setEditExpMethod(e.target.value); setEditExpAccId(''); setEditExpAccName('') }}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {effectivePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {editExpMethod === '계좌이체' && bankAccounts.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">출금 계좌</label>
                      <select value={editExpAccId}
                        onChange={e => pickAccount(e.target.value, setEditExpAccId, setEditExpAccName)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {bankAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                      </select>
                    </div>
                  )}
                  {(editExpMethod === '신용카드' || editExpMethod === '체크카드') && cardAccounts.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">카드 선택</label>
                      <select value={editExpAccId}
                        onChange={e => pickAccount(e.target.value, setEditExpAccId, setEditExpAccName)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                      </select>
                    </div>
                  )}
                  {prepaidAccounts.length > 0 && prepaidAccounts.some(a => editExpMethod === a.brand || editExpMethod === accName(a)) && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">선불 계정 선택</label>
                      <select value={editExpAccId}
                        onChange={e => pickAccount(e.target.value, setEditExpAccId, setEditExpAccName)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {prepaidAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                      </select>
                    </div>
                  )}
                  {rooms.length > 0 && (
                    editIsDurable ? (
                      <p className="text-[0.6875rem] text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">비품·자재의 방·공용부 배정은 <strong className="text-[var(--warm-mid)]">재고 &gt; 비품·자재</strong> 탭에서 합니다. {detailExp.roomId ? '(현재 배정은 그대로 유지됩니다.)' : ''}</p>
                    ) : editItems.some(it => (it.allocations?.length ?? 0) > 0) ? (
                      <p className="text-[0.6875rem] text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">대상 호실은 품목별 <strong className="text-[var(--warm-mid)]">방별로 나누기</strong>로 지정됩니다.</p>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--warm-mid)]">대상 호실 (선택)</label>
                        <select value={editExpRoomId} onChange={e => setEditExpRoomId(e.target.value)}
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                          <option value="">선택 안함</option>
                          {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                        </select>
                        {/* 등록 폼과 동일한 상태 인지형 안내(오류신고 ad4256b0) */}
                        <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                          {editItems.length > 0
                            ? <>여러 방에 나눠 배정하려면 위 품목 카드에서 <strong className="text-[var(--warm-mid)]">방별로 나누기</strong>를 켜세요.</>
                            : <>여러 방에 나눠 배정하려면 먼저 <strong className="text-[var(--warm-mid)]">품목 선택</strong>에서 품목을 추가한 뒤, 품목 카드의 <strong className="text-[var(--warm-mid)]">방별로 나누기</strong>를 켜세요.</>}
                        </p>
                      </div>
                    )
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailExp.memo ?? ''} placeholder="메모 (선택)"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">영수증</label>
                    <input type="hidden" name="receiptUrl" value={editReceiptUrl} />
                    {scanCropped && scanTargetRef.current === 'edit' ? (
                      <div className="space-y-2">
                        <img src={scanCropped.dataUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증 미리보기" />
                        <Btn type="button" variant="primary" size="sm" fullWidth onClick={handleScanUpload} disabled={receiptUploading}>
                          {receiptUploading ? '업로드 중…' : '첨부'}
                        </Btn>
                      </div>
                    ) : editReceiptUrl ? (
                      <div className="relative">
                        <img src={editReceiptUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증" />
                        <button type="button" onClick={() => setEditReceiptUrl('')}
                          className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs leading-none"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                      </div>
                    ) : (
                      <label className="flex items-center justify-center w-full bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-sm px-3 py-2.5 cursor-pointer hover:border-[var(--coral)] transition-colors">
                        <span className="text-xs text-[var(--warm-muted)]">{receiptUploading ? '업로드 중…' : '영수증 첨부'}</span>
                        <input type="file" accept="image/*,application/pdf" className="hidden" disabled={receiptUploading}
                          onChange={async e => { const f = e.target.files?.[0]; if (f) { await handleOpenScan(f, 'edit'); e.target.value = '' } }} />
                      </label>
                    )}
                  </div>
                  {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setDetailExpEdit(false); setError('') }}>취소</Btn>
                  <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                    {isPending ? '저장 중…' : '저장'}
                  </Btn>
                </div>
              </form>
            )}
        </Modal>
      )}

      {tab === 'deposit' && (
        <DepositTab summary={depositSummary} ledger={depositLedger} totalBalance={totalDepositBalance} />
      )}

      {tab === 'reserve' && (
        <ReserveTab
          targetMonth={targetMonth}
          balance={reserveBalance}
          monthly={reserveMonthly}
          txns={reserveTxns}
          settleableExpenses={settleableExpenses}
          financialAccounts={financialAccounts}
          onAfterMutate={() => router.refresh()}
        />
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 수익 상세 / 수정
      ══════════════════════════════════════════════════════════ */}
      {/* ══════════════════════════════════════════════════════════
          모달: 지출 등록
      ══════════════════════════════════════════════════════════ */}
      {showAddExp && (
        <Modal open width="sm" dirty={addExpDirty}
          onClose={() => { setShowAddExp(false); setAddExpDirty(false) }}
          title="지출 등록">
            {/* dirty 의 onInput 은 rAF 지연 필수 — 셀렉트의 input·change 사이에 리렌더가 끼면
                React 가 컨트롤드 값(옛 상태)으로 DOM 을 복원해 change 가 옛 값을 들고 온다(첫 변경 유실, 신고 6f264a8f).
                onChange 는 대상 핸들러와 같은 배치라 안전. 새 폼에도 같은 패턴을 쓸 것. */}
            <form onSubmit={handleAddExp} className="flex flex-col flex-1 overflow-hidden"
              onInput={() => requestAnimationFrame(() => setAddExpDirty(true))} onChange={() => setAddExpDirty(true)}>
              <input type="hidden" name="financialAccountId" value={addExpAccId} />
              <input type="hidden" name="financeName" value={addExpAccName} />
              <input type="hidden" name="roomId" value={(addIsDurable || addItems.some(it => (it.allocations?.length ?? 0) > 0)) ? '' : addExpRoomId} />
              <input type="hidden" name="excludeFromInventory" value={addIsService ? '1' : ''} />
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <DatePicker name="date" value={addExpDate} onChange={setAddExpDate}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">
                      금액 *{addItems.length >= 1 && <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal ml-1">(품목 합계 자동)</span>}
                      {addHasShipping && (addShipping ?? 0) > 0 && <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal ml-1">(+배송비 포함)</span>}
                    </label>
                    {/* 제출 금액 = 품목합계(또는 입력금액) + 배송비. name=amount 는 항상 이 합계로 단일 제출 */}
                    {(() => {
                      const base = addItems.length >= 1 ? addItems.reduce((s, it) => s + (it.amount ?? 0), 0) : (addExpAmount ?? 0)
                      const ship = addHasShipping ? (addShipping ?? 0) : 0
                      const total = base + ship
                      return (
                        <>
                          <input type="hidden" name="amount" value={total} />
                          {/* 합산형 배송비 — 서버 품목합 검증에서 차감(품목 2개+ 도 저장 가능) */}
                          <input type="hidden" name="shippingIncluded" value={ship} />
                          {addItems.length >= 1 ? (
                            <div className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]">
                              {fmtWon(total)}
                              {ship > 0 && <span className="text-[0.65625rem] text-[var(--warm-muted)] ml-1">(품목 {base.toLocaleString()} + 배송 {ship.toLocaleString()})</span>}
                            </div>
                          ) : (
                            <MoneyInput value={addExpAmount} onChange={setAddExpAmount} placeholder="0원" />
                          )}
                        </>
                      )
                    })()}
                  </div>
                </div>
                {/* #2 유형 — 물품 구매(품목 필수) vs 서비스·무형(품목 없이 금액만) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">유형 *</label>
                  <div className="inline-flex w-full rounded-lg border border-[var(--warm-border)] overflow-hidden text-sm font-medium">
                    <button type="button" onClick={() => setAddIsService(false)}
                      className={`flex-1 px-3 py-2 transition-colors ${!addIsService ? 'bg-[var(--coral)] text-[var(--on-solid)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>물품 구매</button>
                    <button type="button" onClick={() => { setAddIsService(true); setAddItems([]); setAddHasShipping(false); setAddShipping(undefined); setAddOrderMode(false); setAddOrderShipping(undefined) }}
                      className={`flex-1 px-3 py-2 transition-colors ${addIsService ? 'bg-[var(--coral)] text-[var(--on-solid)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>서비스·무형</button>
                  </div>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                    {addIsService ? '시공비·인건비 등. 세부 항목으로 내역을 쪼개되, 재고/비품엔 안 잡힙니다.' : '실물 구매. 품목을 입력해야 재고/비품에 잡힙니다.'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                  <select name="category" value={addExpCategory}
                    onChange={e => { userPickedCategoryRef.current = true; setAddExpCategory(e.target.value) }}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">구매처</label>
                  <input type="text" name="vendor" value={addExpVendor} onChange={e => setAddExpVendor(e.target.value)} placeholder="예: 쿠팡, 다이소" list="add-exp-vendors"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                  <datalist id="add-exp-vendors">{vendorSuggestions.map(v => <option key={v} value={v} />)}</datalist>
                </div>
                {/* #1 쇼핑몰 주문번호 — 영수증 OCR로 자동입력되며 수동 수정 가능. 진위확인·재주문 참조용(보조). */}
                {!addIsService && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">쇼핑몰 주문번호 <span className="text-[var(--warm-muted)] font-normal">(선택 · 쿠팡 등)</span></label>
                    <input type="text" name="externalOrderNo" value={addExtOrderNo} onChange={e => setAddExtOrderNo(e.target.value)} placeholder="영수증 분석 시 자동 입력"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)] tabular-nums" />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">{addIsService ? '세부 항목' : '품목 선택'}{addIsService && DETAIL_OPTIONAL_CATEGORIES.includes(addExpCategory) ? '' : ' *'} <span className="text-[var(--warm-muted)] font-normal">{addIsService ? '(시공·작업별로 금액을 쪼개세요)' : '(여러 품목 추가 가능)'}</span></label>
                  <ItemSelector category={addExpCategory} value={addItems} onChange={setAddItems} rooms={addIsDurable ? [] : rooms} detailSuggestions={detailSuggestions} isService={addIsService} />
                  {addIsDurable && (
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">비품·자재는 <strong className="text-[var(--warm-mid)]">수령 후 재고 &gt; 비품·자재</strong> 탭에서 방·공용부에 배정합니다.</p>
                  )}
                </div>
                {/* 배송비 — 수정 폼과 동일한 단일 섹션(두 방식 상호배타). 용어·구조·기본값 통일. 서비스·무형이면 숨김 */}
                {!addIsService && (
                <div className="space-y-2 rounded-xl border border-[var(--warm-border)]/60 bg-[var(--canvas)]/40 px-3 py-2.5">
                  <p className="text-xs font-semibold text-[var(--warm-mid)]">배송비 <span className="text-[var(--warm-muted)] font-normal">(선택)</span></p>
                  <label className="flex items-center gap-1.5 text-xs text-[var(--warm-dark)] cursor-pointer">
                    <input type="checkbox" checked={addHasShipping}
                      onChange={e => { setAddHasShipping(e.target.checked); if (e.target.checked) setAddOrderMode(false); else setAddShipping(undefined) }}
                      className="w-3.5 h-3.5 accent-[var(--coral)]" />
                    <span><strong>이 지출 금액에 합산</strong> · 별도 줄 없이 총액에만 더함</span>
                  </label>
                  {addHasShipping && (
                    <div className="pl-5">
                      <MoneyInput value={addShipping} onChange={setAddShipping} placeholder="배송비 0원" />
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-1">품목 단가엔 미포함, 총액에만 더해집니다.</p>
                    </div>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-[var(--warm-dark)] cursor-pointer">
                    <input type="checkbox" checked={addOrderMode}
                      onChange={e => { setAddOrderMode(e.target.checked); if (e.target.checked) { setAddHasShipping(false); setAddShipping(undefined) } else setAddOrderShipping(undefined) }}
                      className="w-3.5 h-3.5 accent-[var(--coral)]" />
                    <span><strong>별도 지출로 묶기 (합배송)</strong> · 배송비가 지출 1건으로 따로 생기고 이 품목들과 주문번호로 묶입니다 (위 &lsquo;배송비&rsquo;는 품목 금액에 합산)</span>
                  </label>
                  {addOrderMode && (
                    <div className="pl-5 space-y-2">
                      <MoneyInput value={addOrderShipping} onChange={setAddOrderShipping} placeholder="배송비 0원" />
                      <div className="flex items-center gap-1.5">
                        {(['선불', '착불', '신용'] as const).map(t => (
                          <button key={t} type="button" onClick={() => setAddOrderShipType(t)}
                            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${addOrderShipType === t ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--cream-2)] text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
                            {t}
                          </button>
                        ))}
                      </div>
                      <input type="text" value={addOrderShipMemo} onChange={e => setAddOrderShipMemo(e.target.value)}
                        placeholder="배송 메모 (선택)"
                        className="w-full bg-[var(--cream-2)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">배송비가 별도 지출로 기록되고 품목들과 같은 주문번호로 묶입니다. 신용(후불)은 미정산.</p>
                      {(addOrderShipping ?? 0) > 0 && (
                        <>
                          <input type="hidden" name="orderShipping" value={addOrderShipping ?? 0} />
                          <input type="hidden" name="orderShippingType" value={addOrderShipType} />
                          <input type="hidden" name="orderShippingMemo" value={addOrderShipMemo} />
                        </>
                      )}
                    </div>
                  )}
                </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                  {addItems.length > 0
                    ? <input type="text" value={fmtItemListDetail(addItems)} readOnly
                        className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
                    : <input type="text" value={addExpDetail} onChange={e => setAddExpDetail(e.target.value)} placeholder="세부 내용"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                  }
                  {/* 제출 detail = 표시 내용 + 배송비 표기(있으면) */}
                  <input type="hidden" name="detail" value={`${addItems.length > 0 ? fmtItemListDetail(addItems) : addExpDetail}${addHasShipping && (addShipping ?? 0) > 0 ? `${(addItems.length > 0 || addExpDetail) ? ' · ' : ''}배송비 ${fmtWon((addShipping ?? 0))}` : ''}`} />
                  {addItems.length > 0 && <>
                    <input type="hidden" name="itemsJson" value={JSON.stringify(addItems.map(it => ({ ...it, setHint: undefined, allocations: addIsDurable ? undefined : it.allocations })))} />
                    {addItems.length === 1 && (
                      <>
                        <input type="hidden" name="itemLabel" value={addItems[0].label} />
                        <input type="hidden" name="specValue" value={addItems[0].specValue} />
                        <input type="hidden" name="specUnit"  value={addItems[0].specUnit} />
                        {/* 서술형 규격 — 빠지면 단일 품목만 색상·사이즈 유실(오류신고 48376868) */}
                        <input type="hidden" name="specText"  value={addItems[0].specText ?? ''} />
                        <input type="hidden" name="qtyValue"  value={addItems[0].qtyValue} />
                        <input type="hidden" name="qtyUnit"   value={addItems[0].qtyUnit} />
                      </>
                    )}
                  </>}
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
                  <select name="payMethod" value={addExpMethod}
                    onChange={e => { setAddExpMethod(e.target.value); setAddExpAccId(''); setAddExpAccName('') }}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {effectivePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {addExpMethod === '계좌이체' && bankAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">출금 계좌</label>
                    <select value={addExpAccId}
                      onChange={e => pickAccount(e.target.value, setAddExpAccId, setAddExpAccName)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {bankAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                {(addExpMethod === '신용카드' || addExpMethod === '체크카드') && cardAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카드 선택</label>
                    <select value={addExpAccId}
                      onChange={e => pickAccount(e.target.value, setAddExpAccId, setAddExpAccName)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                {prepaidAccounts.length > 0 && prepaidAccounts.some(a => addExpMethod === a.brand || addExpMethod === accName(a)) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">선불 계정 선택</label>
                    <select value={addExpAccId}
                      onChange={e => pickAccount(e.target.value, setAddExpAccId, setAddExpAccName)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {prepaidAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                {rooms.length > 0 && (
                  addIsDurable ? (
                    <p className="text-[0.6875rem] text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">비품·자재는 수령 후 <strong className="text-[var(--warm-mid)]">재고 &gt; 비품·자재</strong> 탭에서 방·공용부에 배정합니다.</p>
                  ) : addItems.some(it => (it.allocations?.length ?? 0) > 0) ? (
                    <p className="text-[0.6875rem] text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">대상 호실은 품목별 <strong className="text-[var(--warm-mid)]">방별로 나누기</strong>로 지정됩니다.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">대상 호실 <span className="font-normal text-[var(--warm-muted)]">(선택)</span></label>
                      <select value={addExpRoomId} onChange={e => setAddExpRoomId(e.target.value)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                      </select>
                      {/* 안내는 화면 상태에 맞게 — 품목이 없으면 켤 토글 자체가 없어 길을 잘못 안내(오류신고 ad4256b0) */}
                      <p className="text-[0.65625rem] text-[var(--warm-muted)]">
                        {addItems.length > 0
                          ? <>여러 방에 나눠 배정하려면 위 품목 카드에서 <strong className="text-[var(--warm-mid)]">방별로 나누기</strong>를 켜세요.</>
                          : <>여러 방에 나눠 배정하려면 먼저 <strong className="text-[var(--warm-mid)]">품목 선택</strong>에서 품목을 추가한 뒤, 품목 카드의 <strong className="text-[var(--warm-mid)]">방별로 나누기</strong>를 켜세요.</>}
                      </p>
                    </div>
                  )
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">영수증 <AiQuotaHint className="ml-1" /></label>
                  <input type="hidden" name="receiptUrl" value={addReceiptUrl} />
                  {scanCropped && scanTargetRef.current === 'add' ? (
                    <div className="space-y-2">
                      <img src={scanCropped.dataUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증 미리보기" />
                      <div className="flex gap-2">
                        <Btn type="button" variant="primary" size="sm" className="flex-1 font-semibold" onClick={handleScanAndOcr} disabled={scanOcrPending || receiptUploading}>
                          {scanOcrPending ? '분석 중…' : '자동 입력 + 첨부'}
                        </Btn>
                        <Btn type="button" variant="secondary" size="sm" className="flex-1" onClick={handleScanUpload} disabled={scanOcrPending || receiptUploading}>
                          {receiptUploading ? '업로드 중…' : '첨부만'}
                        </Btn>
                      </div>
                      {scanOcrError && <p className="text-[0.65625rem] text-[var(--danger-fg)]">{scanOcrError}</p>}
                    </div>
                  ) : addReceiptUrl ? (
                    <div className="relative">
                      <img src={addReceiptUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증" />
                      <button type="button" onClick={() => setAddReceiptUrl('')}
                        className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs leading-none"><svg className="inline-block align-middle" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center w-full bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-sm px-3 py-2.5 cursor-pointer hover:border-[var(--coral)] transition-colors">
                      <span className="text-xs text-[var(--warm-muted)]">{receiptUploading ? '업로드 중…' : '영수증 첨부 · 자동 입력'}</span>
                      <input type="file" accept="image/*,application/pdf" className="hidden" disabled={receiptUploading}
                        onChange={async e => { const f = e.target.files?.[0]; if (f) { await handleOpenScan(f, 'add'); e.target.value = '' } }} />
                    </label>
                  )}
                  {addSeedNotice && <p className="text-[0.65625rem] text-[var(--warm-muted)]">{addSeedNotice}</p>}
                </div>
                {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => setShowAddExp(false)}>취소</Btn>
                <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                  {isPending ? '저장 중…' : '저장'}
                </Btn>
              </div>
            </form>
        </Modal>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 수익 등록
      ══════════════════════════════════════════════════════════ */}
    </div>

    {showVendorMgmt && <VendorManageModal onClose={() => setShowVendorMgmt(false)} onChanged={() => router.refresh()} />}

    {/* ── 과거 구매내역 검색 모달 (전 기간) ───────────────────────── */}
    <Modal open={showExpSearch} onClose={() => setShowExpSearch(false)} title="과거 구매내역 검색" width="lg"
      subtitle="품목명·세부내역·판매처·메모·카테고리로 전 기간 검색">
      <div className="p-4 space-y-3">
        <SearchBar value={expSearchQ} onChange={setExpSearchQ} placeholder="예: 코발트 드릴비트, 쿠팡, 휴지" />
        {(() => {
          const q = expSearchQ.trim()
          if (q.length < 1) {
            return <p className="text-xs text-center py-8 text-[var(--warm-muted)]">검색어를 입력하면 모든 달의 구매내역에서 찾습니다.</p>
          }
          if (expSearching && expSearchResults.length === 0) {
            return <p className="text-xs text-center py-8 text-[var(--warm-muted)]">검색 중…</p>
          }
          if (expSearchResults.length === 0) {
            return <p className="text-xs text-center py-8 text-[var(--warm-muted)]">‘{q}’ 검색 결과가 없습니다.</p>
          }
          // 월별 그룹 (결과는 날짜 내림차순이라 월도 내림차순으로 들어옴)
          const groups: { month: string; rows: ExpenseSearchResult[] }[] = []
          for (const r of expSearchResults) {
            const m = kstYmdStr(new Date(r.date)).slice(0, 7)
            const last = groups[groups.length - 1]
            if (last && last.month === m) last.rows.push(r)
            else groups.push({ month: m, rows: [r] })
          }
          const totalAmt = expSearchResults.reduce((s, r) => s + r.amount, 0)
          const goMonth = (m: string) => {
            setShowExpSearch(false)
            router.push(`/finance?tab=expense&month=${m}`)
          }
          return (
            <>
              <p className="text-[0.6875rem] text-[var(--warm-muted)]">
                {expSearchResults.length}건{expSearchResults.length >= 300 ? '+ (최근 300건)' : ''} · 합계 <span className="font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={totalAmt} /></span>
              </p>
              <div className="space-y-3">
                {groups.map(g => {
                  const [gy, gm] = g.month.split('-')
                  const gTotal = g.rows.reduce((s, r) => s + r.amount, 0)
                  return (
                    <div key={g.month}>
                      <div className="flex items-center justify-between gap-2 px-1 pb-1">
                        <button onClick={() => goMonth(g.month)}
                          className="text-xs font-semibold text-[var(--coral)] hover:underline">
                          {gy}년 {parseInt(gm)}월 ›
                        </button>
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">{g.rows.length}건 · <MoneyDisplay amount={gTotal} /></span>
                      </div>
                      <ul className="space-y-1">
                        {g.rows.map(r => {
                          const fmtQ = (n: number) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000))
                          let label = r.detail ?? ''
                          if (r.itemLabel) {
                            const specPart = r.specValue != null ? ` ${fmtQ(r.specValue)}${r.specUnit ?? ''}` : ''
                            const qtyPart = r.qtyValue != null && r.qtyValue > 0 ? ` x ${fmtQ(r.qtyValue)}${r.qtyUnit ?? '개'}` : ''
                            label = `[${r.itemLabel}]${specPart}${qtyPart}`
                          }
                          if (!label) label = r.category
                          return (
                            <li key={r.id} className="flex items-baseline justify-between gap-2 rounded-lg bg-[var(--canvas)] px-2.5 py-1.5">
                              <span className="text-[0.65625rem] text-[var(--warm-muted)] shrink-0 tabular-nums">{kstYmdStr(new Date(r.date)).slice(5).replace('-', '.')}</span>
                              <span className="flex-1 min-w-0">
                                <span className="block truncate text-xs text-[var(--warm-dark)]">{label}</span>
                                <span className="block truncate text-[0.65625rem] text-[var(--warm-muted)]">
                                  {r.category}{r.vendor ? ` · ${r.vendor}` : ''}{r.roomNo ? ` · ${r.roomNo}호` : ''}
                                </span>
                              </span>
                              <span className="shrink-0 tabular-nums text-xs font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={r.amount} /></span>
                            </li>
                          )
                        })}
                      </ul>
                    </div>
                  )
                })}
              </div>
            </>
          )
        })()}
      </div>
    </Modal>

    {/* ── 고정 지출 관리 모달 ────────────────────────────────────── */}

    {showRecMgmt && (
      <Modal open width="lg" dirty={showRecMgmtForm && recMgmtDirty}
        onClose={() => { setShowRecMgmt(false); setShowRecMgmtForm(false); setRecMgmtDirty(false) }}
        title="고정 지출 관리" subtitle="매월 반복 지출 항목을 추가·수정·삭제합니다."
        bodyClassName="p-5">
          <div className="space-y-4" onInput={() => setRecMgmtDirty(true)} onChange={() => setRecMgmtDirty(true)}>
            {/* 추가/수정 폼 */}
            {showRecMgmtForm ? (
              <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-[var(--warm-dark)]">{editingRecMgmt ? '고정 지출 수정' : '고정 지출 추가'}</p>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">항목명 *</label>
                  <input type="text" value={recMgmtForm.title} onChange={e => setRecMgmtForm(p => ({ ...p, title: e.target.value }))}
                    placeholder="예: 건물 임대료, 관리비"
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                    <MoneyInput value={Number(recMgmtForm.amount) || 0} onChange={v => setRecMgmtForm(p => ({ ...p, amount: String(v) }))} placeholder="0원" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">납부일 (매월)</label>
                    <input type="number" min={1} max={31} value={recMgmtForm.dueDay}
                      onChange={e => setRecMgmtForm(p => ({ ...p, dueDay: e.target.value }))}
                      className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리</label>
                  <select value={recMgmtForm.category} onChange={e => setRecMgmtForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">알림 (납부일 N일 전)</label>
                  <input type="number" min={0} max={30} value={recMgmtForm.alertDaysBefore}
                    onChange={e => setRecMgmtForm(p => ({ ...p, alertDaysBefore: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">자동이체 항목은 주말·공휴일이면 다음 영업일 기준으로 알림이 계산됩니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">활성화 시작일 (선택)</label>
                  <DatePicker value={recMgmtForm.activeSince} onChange={v => setRecMgmtForm(p => ({ ...p, activeSince: v }))}
                    className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                    이 항목이 실제로 내 부담이 되는 첫 날짜입니다. 입력하지 않으면 즉시 활성화됩니다.<br />
                    예) 인터넷 요금 결제일 25일이 양도인 부담이면, 다음 달부터 내 부담 → 다음달 25일 입력.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제 수단 (선택)</label>
                  <select value={recMgmtForm.payMethod} onChange={e => setRecMgmtForm(p => ({ ...p, payMethod: e.target.value, financialAccountId: '' }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    <option value="">선택 안 함</option>
                    {effectivePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {recMgmtForm.payMethod === '계좌이체' && bankAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">출금 계좌 (선택)</label>
                    <select value={recMgmtForm.financialAccountId} onChange={e => setRecMgmtForm(p => ({ ...p, financialAccountId: e.target.value }))}
                      className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                      <option value="">선택 안함</option>
                      {bankAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                {(recMgmtForm.payMethod === '신용카드' || recMgmtForm.payMethod === '체크카드') && cardAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카드 선택 (선택)</label>
                    <select value={recMgmtForm.financialAccountId} onChange={e => setRecMgmtForm(p => ({ ...p, financialAccountId: e.target.value }))}
                      className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                      <option value="">선택 안함</option>
                      {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                {prepaidAccounts.length > 0 && prepaidAccounts.some(a => recMgmtForm.payMethod === a.brand || recMgmtForm.payMethod === accName(a)) && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">선불 계정 선택 (선택)</label>
                    <select value={recMgmtForm.financialAccountId} onChange={e => setRecMgmtForm(p => ({ ...p, financialAccountId: e.target.value }))}
                      className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                      <option value="">선택 안함</option>
                      {prepaidAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recMgmtForm.isAutoDebit} onChange={e => setRecMgmtForm(p => ({ ...p, isAutoDebit: e.target.checked }))} className="accent-[var(--coral)]" />
                    <span className="text-xs text-[var(--warm-dark)]">자동이체</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recMgmtForm.isVariable} onChange={e => setRecMgmtForm(p => ({ ...p, isVariable: e.target.checked }))} className="accent-[var(--coral)]" />
                    <div>
                      <span className="text-xs text-[var(--warm-dark)]">변동 금액</span>
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">전기·수도 등 매달 달라지는 항목</p>
                    </div>
                  </label>
                </div>
                {recMgmtForm.isVariable && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">전년동월 실적 (선택)</label>
                    <MoneyInput value={Number(recMgmtForm.priorYearAmount) || 0} onChange={v => setRecMgmtForm(p => ({ ...p, priorYearAmount: v > 0 ? String(v) : '' }))} placeholder="0원" />
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">작년 같은 달 실제 납부액. 최근 3개월 평균과 함께 예상치 계산에 반영됩니다.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모 (선택)</label>
                  <input type="text" value={recMgmtForm.memo} onChange={e => setRecMgmtForm(p => ({ ...p, memo: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                {recMgmtError && <p className="text-[var(--danger-fg)] text-xs">{recMgmtError}</p>}
                <div className="flex gap-2 pt-1">
                  <Btn variant="secondary" size="md" className="flex-1" onClick={() => { setShowRecMgmtForm(false); setEditingRecMgmt(null); setRecMgmtError('') }}>취소</Btn>
                  <Btn variant="primary" size="md" className="flex-1" onClick={handleSaveRecMgmt} disabled={recMgmtPending || !recMgmtForm.title.trim() || !recMgmtForm.amount}>
                    {recMgmtPending ? '저장 중…' : '저장'}
                  </Btn>
                </div>
              </div>
            ) : recGroupMode ? (
              /* #1 묶기 모드 — 아래 목록에서 묶을 항목 선택 후 실행 */
              <div className="rounded-xl border border-[var(--coral)]/40 bg-[var(--coral)]/5 p-3 space-y-2">
                <p className="text-xs font-semibold text-[var(--warm-dark)]">묶을 고정지출을 선택하세요 (2개 이상)</p>
                <div className="space-y-1">
                  <label className="text-[0.6875rem] text-[var(--warm-mid)]">묶음 이름</label>
                  <input type="text" value={recGroupTitle} onChange={e => setRecGroupTitle(e.target.value)}
                    placeholder="예: 임대관리비"
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                </div>
                <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">
                  선택 항목은 이 묶음의 세부항목으로 전환되고(각 변동/고정 유지), 원본은 비활성됩니다(과거 기록 보존).
                </p>
                <div className="flex gap-2">
                  <Btn variant="secondary" size="md" className="flex-1" onClick={() => { setRecGroupMode(false); setRecGroupSel(new Set()); setRecMgmtError('') }}>취소</Btn>
                  <Btn variant="primary" size="md" className="flex-1" onClick={handleGroupRec} disabled={recMgmtPending || recGroupSel.size < 2}>
                    {recMgmtPending ? '묶는 중…' : `${recGroupSel.size}개 묶기`}
                  </Btn>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={openNewRecMgmt}
                  className="flex-1 py-2.5 text-sm font-medium rounded-lg border border-dashed border-[var(--coral)] text-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">
                  + 새 항목 추가
                </button>
                <button onClick={() => { setRecGroupMode(true); setRecMgmtError('') }}
                  className="px-4 py-2.5 text-sm font-medium rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                  묶기
                </button>
              </div>
            )}

            {/* 목록 */}
            {recMgmtLoading ? (
              <Loading py={4} />
            ) : recMgmtList.length === 0 && !showRecMgmtForm ? (
              <p className="text-sm text-[var(--warm-muted)] text-center py-3">등록된 고정 지출이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {recMgmtList.map(r => {
                  const isParent = r.items && r.items.length > 0
                  const selectable = recGroupMode && r.isActive
                  return (
                  <div key={r.id}
                    onClick={selectable ? () => toggleGroupSel(r.id) : undefined}
                    className={`flex items-center gap-3 rounded-sm px-3 py-2.5 border ${recGroupSel.has(r.id) ? 'border-[var(--coral)] bg-[var(--coral)]/5' : 'border-[var(--warm-border)] bg-[var(--canvas)]'} ${!r.isActive ? 'opacity-50' : ''} ${selectable ? 'cursor-pointer' : ''}`}>
                    {recGroupMode && (
                      <input type="checkbox" checked={recGroupSel.has(r.id)} disabled={!r.isActive}
                        onChange={() => toggleGroupSel(r.id)} onClick={e => e.stopPropagation()}
                        className="w-4 h-4 accent-[var(--coral)] shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{r.title}</p>
                        {isParent && <span className="text-[0.65625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--coral)]/15 text-[var(--coral)]">묶음 {r.items.length}</span>}
                        {r.isAutoDebit && <Badge tone="pale-blue">자동이체</Badge>}
                        {!r.isActive && <span className="text-[0.65625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--neutral-bg)] text-[var(--neutral-fg)]">비활성</span>}
                        {r.activeSince && <Badge tone="pale-amber">{r.activeSince.slice(0, 7)}부터</Badge>}
                      </div>
                      <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                        매월 {r.dueDay}일 · {fmtWon(r.amount)} · {r.category}
                        {r.payMethod && <> · {r.payMethod}</>}
                        {r.financialAccountName && <> ({r.financialAccountName})</>}
                      </p>
                      {isParent && (
                        <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 truncate">
                          {r.items.map(it => `${it.name}${it.isVariable ? '(변동)' : ''}`).join(' · ')}
                        </p>
                      )}
                    </div>
                    {!recGroupMode && (
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleToggleRecMgmt(r)}
                        className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                        {r.isActive ? '비활성' : '활성화'}
                      </button>
                      <button onClick={() => openEditRecMgmt(r)}
                        className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">수정</button>
                      <button onClick={() => handleDeleteRecMgmt(r.id, r.title)}
                        className="text-xs px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] hover:text-[var(--danger-fg)] transition-colors">삭제</button>
                    </div>
                    )}
                  </div>
                  )
                })}
              </div>
            )}
          </div>
      </Modal>
    )}
    {/* ── 고정 지출 기록 모달 ────────────────────────────────────────── */}
    {recordingRec && (
      <Modal open width="sm" dirty={recRecDirty}
        onClose={() => { setRecordingRec(null); setRecError(''); setRecRecDirty(false) }}
        title="지출 기록" subtitle={recordingRec.title}>
        <div onInput={() => setRecRecDirty(true)} onChange={() => setRecRecDirty(true)}>
          {/* 폼 */}
          <div className="p-5 space-y-3">
            {recRecItems.length > 0 ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                  <DatePicker value={recRecDate} onChange={setRecRecDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
                </div>
                {/* #1 관리비 세부항목 — 변동 항목만 편집, 고정은 표시. 합계 자동. */}
                <div className="space-y-1.5 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-3">
                  <p className="text-[0.6875rem] font-medium text-[var(--warm-muted)]">세부항목 ({recRecItems.length})</p>
                  {recRecItems.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--warm-dark)] flex-1 truncate">
                        {it.name}
                        {it.isVariable
                          ? <Badge tone="pale-amber" className="ml-1">변동</Badge>
                          : <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">고정</span>}
                      </span>
                      {it.isVariable ? (
                        <div className="w-28">
                          <MoneyInput value={it.amount} onChange={v => {
                            setRecRecItems(prev => {
                              const next = prev.map((p, j) => j === i ? { ...p, amount: v } : p)
                              setRecRecAmount(next.reduce((s, p) => s + p.amount, 0))
                              return next
                            })
                          }} placeholder="0원" />
                        </div>
                      ) : (
                        <span className="text-xs num text-[var(--warm-dark)] w-28 text-right pr-1">{fmtWon(it.amount)}</span>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-[var(--warm-border)] pt-1.5 mt-1">
                    <span className="text-xs font-semibold text-[var(--warm-dark)]">합계</span>
                    <span className="text-sm font-bold num text-[var(--coral)]">{fmtWon(recRecAmount)}</span>
                  </div>
                </div>
              </>
            ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                <DatePicker value={recRecDate} onChange={setRecRecDate}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">
                  금액
                  {recordingRec.historicalAvg && (
                    <span className="ml-1 text-[var(--info-fg)] text-[0.65625rem]">평균 {fmtWon(recordingRec.historicalAvg)}</span>
                  )}
                </label>
                <MoneyInput value={recRecAmount} onChange={v => setRecRecAmount(v)} placeholder="0원" />
              </div>
            </div>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">결제수단</label>
                <select value={recRecPayMethod} onChange={e => { setRecRecPayMethod(e.target.value); setRecRecAccId('') }}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  {effectivePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  {!effectivePaymentMethods.includes('계좌이체') && <option value="계좌이체">계좌이체</option>}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">메모</label>
                <input type="text" value={recRecMemo} onChange={e => setRecRecMemo(e.target.value)}
                  placeholder="선택 입력"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              </div>
            </div>
            {recRecPayMethod === '계좌이체' && bankAccounts.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">출금 계좌</label>
                <select value={recRecAccId} onChange={e => setRecRecAccId(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">선택 안함</option>
                  {bankAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                </select>
              </div>
            )}
            {(recRecPayMethod === '신용카드' || recRecPayMethod === '체크카드') && cardAccounts.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">카드 선택</label>
                <select value={recRecAccId} onChange={e => setRecRecAccId(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">선택 안함</option>
                  {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                </select>
              </div>
            )}
            {prepaidAccounts.length > 0 && prepaidAccounts.some(a => recRecPayMethod === a.brand || recRecPayMethod === accName(a)) && (
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">선불 계정</label>
                <select value={recRecAccId} onChange={e => setRecRecAccId(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">선택 안함</option>
                  {prepaidAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                </select>
              </div>
            )}
            {recError && <p className="text-[var(--danger-fg)] text-xs">{recError}</p>}
            {recordingRec.pendingAmount != null && (
              <p className="text-[0.65625rem] text-[var(--warm-muted)] -mt-1">
                예약된 금액 {fmtWon(recordingRec.pendingAmount)}이 자동 입력되었습니다.
                <button type="button"
                  onClick={() => {
                    startTransition(async () => {
                      await clearRecurringPendingAmount({ recurringExpenseId: recordingRec.id })
                      setRecordingRec(null); router.refresh()
                    })
                  }}
                  className="ml-1 underline text-[var(--coral)]">예약 취소</button>
              </p>
            )}
            <div className="flex flex-col gap-2 pt-1">
              <div className="flex gap-2">
                <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setRecordingRec(null); setRecError('') }}>취소</Btn>
                <Btn type="button" variant="primary" size="md" className="flex-1 font-semibold"
                  disabled={isPending || !recRecDate || recRecAmount <= 0}
                  onClick={() => {
                    setRecError('')
                    startTransition(async () => {
                      const res = await recordRecurringExpense({
                        recurringExpenseId: recordingRec.id,
                        amount: recRecAmount,
                        date: recRecDate,
                        payMethod: recRecPayMethod || undefined,
                        financialAccountId: recRecAccId || undefined,
                        memo: recRecMemo || undefined,
                        breakdown: recRecItems.length > 0 ? recRecItems : undefined,
                      })
                      if (!res.ok) { setRecError(res.error); return }
                      setRecordingRec(null)
                      router.refresh()
                    })
                  }}>
                  {isPending ? '기록 중…' : '지출로 기록 (납부 완료)'}
                </Btn>
              </div>
              {/* 금액만 저장 — 결제일 전에 금액만 미리 입력해 두는 모드. 지출은 생성하지 않음(정산 안 함). */}
              <button type="button"
                disabled={isPending || recRecAmount <= 0}
                onClick={() => {
                  setRecError('')
                  startTransition(async () => {
                    const res = await setRecurringPendingAmount({
                      recurringExpenseId: recordingRec.id,
                      amount: recRecAmount,
                    })
                    if (!res.ok) { setRecError(res.error); return }
                    setRecordingRec(null)
                    router.refresh()
                  })
                }}
                className="w-full px-4 py-2.5 bg-[var(--canvas)] border border-dashed border-[var(--coral)]/50 text-[var(--coral)] text-xs font-medium rounded-lg hover:bg-[var(--coral)]/5 disabled:opacity-60 transition-colors">
                금액만 저장 (아직 납부 전)
              </button>
              <p className="text-[0.65625rem] text-[var(--warm-muted)] text-center leading-relaxed">
                ‘지출로 기록’은 바로 정산 처리돼요. 금액만 미리 적어둘 땐 아래 버튼을 쓰세요.
              </p>
            </div>
          </div>
        </div>
      </Modal>
    )}

    {/* 다중선택 묶기 — 하단 액션 바 */}
    {mergeMode && (
      <SelectionPillBar count={mergeSel.size} unit="건" onClose={exitMergeMode}>
        <PillButton primary disabled={isPending || mergeSel.size < 2} onClick={handleMergeSelected}>
          한 주문으로 묶기
        </PillButton>
      </SelectionPillBar>
    )}

    {/* 영수증 스캔 모달 (전체화면) */}
    {scanBitmap && (
      <ReceiptScanModal bitmap={scanBitmap} onConfirm={handleScanConfirm} onCancel={handleScanCancel} />
    )}
    </>
  )
}

// ── 보증금 탭 ─────────────────────────────────────────────────────

const DEPOSIT_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT: '퇴실', NON_RESIDENT: '비거주',
}

function DepositTab({ summary, ledger, totalBalance }: {
  summary: DepositPerTenant[]
  ledger: DepositLedgerEntry[]
  totalBalance: number
}) {
  type SubTab = 'tenant' | 'ledger'
  const [sub, setSub] = useState<SubTab>('tenant')
  const router = useRouter()
  const [recPending, startRec] = useTransition()

  // 전 원장 등으로 받았으나 입금기록 없는 보증금 → '받음(실수납)'으로 기록.
  const handleRecordReceived = async (leaseTermId: string, name: string, amount: number) => {
    if (!(await confirmDialog({ title: `${name} 보증금을 '받음(실수납)'으로 기록할까요?`, message: `계약상 금액(${fmtWon(amount)})으로 입금 기록이 생성됩니다.`, confirmLabel: '기록' }))) return
    startRec(async () => {
      const release = trackSave()
      try {
        await recordDepositReceived(leaseTermId)
        pushToast('success', '보증금 받음으로 기록됨')
        router.refresh()
      } catch (e) {
        pushToast('error', (e as Error).message ?? '기록 실패')
      } finally { release() }
    })
  }

  const totalIn       = summary.reduce((s, d) => s + d.totalIn, 0)
  const totalReturned = summary.reduce((s, d) => s + d.totalReturned, 0)
  const totalWithheld = summary.reduce((s, d) => s + d.totalWithheld, 0)

  return (
    <div className="space-y-5">
      {/* 잔고 요약 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">현재 보유</p>
            <p className="text-xl font-bold" style={{ color: 'var(--deposit-fg)' }}>
              <MoneyDisplay amount={totalBalance} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 입금</p>
            <p className="text-base font-semibold text-[var(--success-fg)]"><MoneyDisplay amount={totalIn} /></p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 반환</p>
            <p className="text-base font-semibold text-[var(--warning-fg)]"><MoneyDisplay amount={totalReturned} /></p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">누적 미반환</p>
            <p className="text-base font-semibold" style={{ color: 'var(--coral)' }}><MoneyDisplay amount={totalWithheld} /></p>
          </div>
        </div>
      </div>

      {/* 서브 탭 */}
      <div className="flex gap-1.5">
        {(['tenant', 'ledger'] as SubTab[]).map(k => (
          <button key={k} onClick={() => setSub(k)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              sub === k ? 'bg-[var(--coral)] text-[var(--on-solid)]'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'
            }`}>
            {k === 'tenant' ? `입주자별 (${summary.length})` : `거래 이력 (${ledger.length})`}
          </button>
        ))}
      </div>

      {sub === 'tenant' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {summary.length === 0 ? (
            <EmptyState title="보증금 거래 이력이 있는 입주자가 없습니다." className="border-0 bg-transparent" />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {summary.map(d => (
                <li key={d.leaseTermId} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--warm-dark)]">{d.tenantName}</span>
                      {d.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {d.roomNo}호</span>}
                      <span className="text-[0.65625rem] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        {DEPOSIT_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                      {d.hasNoInRecord && (
                        <Badge tone="pale-amber">입금 거래 기록 없음</Badge>
                      )}
                    </div>
                    <p className="text-xs text-[var(--warm-muted)]">
                      {d.hasNoInRecord
                        ? `계약상 보증금 ${fmtWon(d.contractDeposit)}`
                        : `입금 ${fmtWon(d.totalIn)}`}
                      {d.totalReturned > 0 && ` · 반환 ${fmtWon(d.totalReturned)}`}
                      {d.totalWithheld > 0 && ` · 미반환 ${fmtWon(d.totalWithheld)}`}
                      {!d.hasNoInRecord && d.contractDeposit !== d.totalIn && (
                        <span className="ml-1 text-[var(--warning-fg)]">(계약 {fmtWon(d.contractDeposit)})</span>
                      )}
                      {d.status === 'CHECKED_OUT' && d.balance === 0 && (d.totalReturned + d.totalWithheld === 0) && (
                        <span className="ml-1 text-[var(--warm-muted)]">· 퇴실 정리됨</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: d.balance > 0 ? 'var(--deposit-fg)' : 'var(--warm-muted)' }}>
                      {fmtWon(d.balance)}
                    </p>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)]">현재 잔고</p>
                    {d.hasNoInRecord && d.status !== 'CHECKED_OUT' && d.contractDeposit > 0 && (
                      <button onClick={() => handleRecordReceived(d.leaseTermId, d.tenantName, d.contractDeposit)} disabled={recPending}
                        className="mt-1.5 text-[0.65625rem] font-medium px-2 py-1 rounded-lg ring-1 ring-[var(--success-ring)] text-[var(--success-fg)] hover:bg-[var(--success-bg)] disabled:opacity-50 whitespace-nowrap">
                        받음으로 기록
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {sub === 'ledger' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {ledger.length === 0 ? (
            <EmptyState title="보증금 거래 이력이 없습니다." className="border-0 bg-transparent" />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {ledger.map((e, i) => (
                <li key={i} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                      <span className={`text-xs font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                        {e.type === 'IN' ? '입금' : '환불'}
                      </span>
                      <span className="text-xs text-[var(--warm-muted)]">{new Date(e.date).toISOString().slice(0, 10)}</span>
                      <span className="text-xs text-[var(--warm-dark)]">· {e.tenantName}</span>
                      {e.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {e.roomNo}호</span>}
                    </div>
                    {e.type === 'REFUND' && (
                      <p className="text-xs text-[var(--warm-muted)]">
                        반환 {fmtWon((e.returnedAmount ?? 0))}
                        {(e.withheldAmount ?? 0) > 0 && ` · 미반환 ${fmtWon((e.withheldAmount ?? 0))}`}
                        {e.reason && ` · 사유: ${e.reason}`}
                      </p>
                    )}
                    {e.memo && <p className="text-xs text-[var(--warm-muted)] truncate">메모: {e.memo}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                      {e.type === 'IN' ? '+' : '−'}{fmtWon(e.amount)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ── 예비비 탭 ─────────────────────────────────────────────────────

function ReserveTab({
  targetMonth, balance, monthly, txns, settleableExpenses, financialAccounts, onAfterMutate,
}: {
  targetMonth: string
  balance: number
  monthly: { deposit: number; withdraw: number; depositFromThisMonthRevenue: number }
  txns: ReserveTxn[]
  settleableExpenses: SettleableExpense[]
  financialAccounts: FinancialAccount[]
  onAfterMutate: () => void
}) {
  type Mode = 'deposit' | 'withdraw' | 'settle'
  const [mode, setMode] = useState<Mode | null>(null)
  const [amount, setAmount] = useState<number | undefined>(undefined)
  const [date, setDate] = useState(() => kstYmdStr())
  const [sourceMonth, setSourceMonth] = useState(targetMonth)
  const [category, setCategory] = useState('')
  const [memo, setMemo] = useState('')
  const [selectedExpenseId, setSelectedExpenseId] = useState('')
  const [linkedAccountId, setLinkedAccountId] = useState('')
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()

  // 등록된 계좌 목록 — 사용자 자유로 선택
  const accountOptions = financialAccounts

  // 출처 월 후보 — 최근 12개월
  const monthOptions = useMemo(() => {
    const opts: { value: string; label: string }[] = []
    const [yy, mm] = targetMonth.split('-').map(Number)
    for (let i = 0; i < 12; i++) {
      const d = new Date(yy, mm - 1 - i, 1)
      const v = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      opts.push({ value: v, label: v === targetMonth ? `${v} (현재)` : v })
    }
    return opts
  }, [targetMonth])

  const reset = () => {
    setMode(null); setAmount(undefined); setDate(kstYmdStr())
    setSourceMonth(targetMonth); setCategory(''); setMemo('')
    setSelectedExpenseId(''); setLinkedAccountId(''); setError('')
  }

  const submit = () => {
    setError('')
    if (mode === 'settle') {
      if (!selectedExpenseId) { setError('정산할 지출을 선택하세요.'); return }
    } else {
      if (!amount || amount <= 0) { setError('금액을 입력하세요.'); return }
    }
    startTransition(async () => {
      const release = trackSave()
      try {
        let res: { ok: true } | { ok: false; error: string }
        if (mode === 'deposit') {
          res = await addReserveDeposit({
            amount: amount!, date, sourceMonth,
            linkedAccountId: linkedAccountId || undefined,
            memo: memo || undefined,
          })
        } else if (mode === 'withdraw') {
          res = await addReserveWithdrawDirect({
            amount: amount!, date,
            category: category || undefined,
            linkedAccountId: linkedAccountId || undefined,
            memo: memo || undefined,
          })
        } else {
          res = await settleReserveFromExpense({ expenseId: selectedExpenseId, amount: amount, memo: memo || undefined })
        }
        if (!res.ok) { pushToast('error', res.error); return }
        reset()
        onAfterMutate()
        pushToast('success', mode === 'deposit' ? '예비비 적립됨' : mode === 'withdraw' ? '예비비 인출됨' : '정산 완료')
      } finally { release() }
    })
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 거래를 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      const res = await deleteReserveTransaction(id)
      if (!res.ok) { setError(res.error); return }
      onAfterMutate()
    })
  }

  const typeLabel = (t: ReserveTxn['type']) =>
    t === 'DEPOSIT' ? '적립' : t === 'WITHDRAW_DIRECT' ? '직접 인출' : '지출 차감'
  const typeColor = (t: ReserveTxn['type']) =>
    t === 'DEPOSIT' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'

  return (
    <div className="space-y-5">
      {/* 잔고 + 월간 요약 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">현재 잔고</p>
            <p className="text-xl font-bold text-[var(--warm-dark)]">
              <MoneyDisplay amount={balance} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">{targetMonth} 적립</p>
            <p className="text-base font-semibold text-[var(--success-fg)]">
              +<MoneyDisplay amount={monthly.deposit} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">{targetMonth} 사용</p>
            <p className="text-base font-semibold text-[var(--warning-fg)]">
              −<MoneyDisplay amount={monthly.withdraw} />
            </p>
          </div>
          <div>
            <p className="text-xs text-[var(--warm-muted)] mb-1">{targetMonth} 매출에서</p>
            <p className="text-base font-semibold" style={{ color: 'var(--reserve-fg)' }}>
              −<MoneyDisplay amount={monthly.depositFromThisMonthRevenue} />
            </p>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">예비비로 적립된 금액</p>
          </div>
        </div>
      </div>

      {/* 액션 버튼 */}
      {!mode && (
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setMode('deposit')}
            className="px-3 py-3 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg text-sm text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            적립
          </button>
          <button onClick={() => setMode('withdraw')}
            className="px-3 py-3 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg text-sm text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            예비비에서 지출
          </button>
          <button onClick={() => setMode('settle')}
            className="px-3 py-3 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg text-sm text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            지출을 예비비에서 차감
          </button>
        </div>
      )}

      {/* 입력 폼 */}
      {mode && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-[var(--warm-dark)]">
              {mode === 'deposit' && '예비비 적립'}
              {mode === 'withdraw' && '예비비에서 직접 지출'}
              {mode === 'settle' && '기존 지출을 예비비에서 차감'}
            </h3>
            <button onClick={reset} className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">취소</button>
          </div>

          {mode === 'settle' ? (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">정산할 지출 *</label>
                <select value={selectedExpenseId} onChange={e => setSelectedExpenseId(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">{settleableExpenses.length === 0 ? '이번 달 정산 가능한 지출 없음' : '선택'}</option>
                  {settleableExpenses.map(e => (
                    <option key={e.id} value={e.id}>
                      {new Date(e.date).toISOString().slice(5,10)} · {e.category}
                      {e.detail ? ` · ${e.detail}` : ''} · {fmtWon(e.remaining)} 남음
                    </option>
                  ))}
                </select>
                <p className="text-[0.65625rem] text-[var(--warm-muted)]">선택 후 금액 비우면 잔여 전액, 입력하면 부분 정산</p>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">정산 금액 (선택)</label>
                <MoneyInput value={amount} onChange={setAmount} placeholder="비우면 잔여 전액" />
              </div>
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                <MoneyInput value={amount} onChange={setAmount} />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                <DatePicker value={date} onChange={setDate}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
              </div>
              {mode === 'deposit' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">출처 월 (어느 달 매출에서 적립?)</label>
                  <select value={sourceMonth} onChange={e => setSourceMonth(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {monthOptions.map(o => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                </div>
              )}
              {mode === 'withdraw' && (
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">사용 분류 (선택)</label>
                  <input type="text" value={category} onChange={e => setCategory(e.target.value)}
                    placeholder="예: 시설 파손, 가전 교체"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                </div>
              )}
              {/* 이체 계좌 — 어느 계좌로 옮겼는지 / 어디서 인출했는지 */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">
                  {mode === 'deposit' ? '이체 받는 계좌 (예비비 보관처)' : '인출 계좌 (예비비 출금처)'}
                </label>
                <select value={linkedAccountId} onChange={e => setLinkedAccountId(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">{accountOptions.length === 0 ? '등록된 계좌 없음 (자산 관리 탭에서 추가)' : '선택 (선택 사항)'}</option>
                  {accountOptions.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.brand}{a.alias ? ` (${a.alias})` : ''}
                    </option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
            <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
          </div>

          {error && <p className="text-[var(--danger-fg)] text-xs">{error}</p>}

          <div className="flex gap-2 pt-1">
            <Btn variant="secondary" onClick={reset} fullWidth>취소</Btn>
            <Btn variant="primary" onClick={submit} disabled={pending} fullWidth>
              {pending ? '저장 중…' : '저장'}
            </Btn>
          </div>
        </div>
      )}

      {/* 거래 이력 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
        <div className="px-5 py-3 border-b border-[var(--warm-border)]">
          <h3 className="text-sm font-semibold text-[var(--warm-dark)]">{targetMonth} 거래 이력 ({txns.length}건)</h3>
        </div>
        {txns.length === 0 ? (
          <EmptyState title="이번 달 예비비 거래 없음" />
        ) : (
          <ul className="divide-y divide-[var(--warm-border)]/50">
            {txns.map(t => (
              <li key={t.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-xs font-semibold ${typeColor(t.type)}`}>{typeLabel(t.type)}</span>
                    <span className="text-xs text-[var(--warm-muted)]">{new Date(t.date).toISOString().slice(0, 10)}</span>
                    {t.type === 'DEPOSIT' && t.sourceMonth && (
                      <span className="text-[0.65625rem] px-1.5 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        출처 {t.sourceMonth}
                      </span>
                    )}
                    {t.category && <span className="text-xs text-[var(--warm-muted)]">· {t.category}</span>}
                  </div>
                  {/* 이체 계좌 표기 — DEPOSIT은 받는 계좌, WITHDRAW_DIRECT은 인출 계좌 */}
                  {t.linkedAccount && (
                    <p className="text-xs text-[var(--warm-muted)]">
                      {t.type === 'DEPOSIT' ? '→ 이체: ' : '← 인출: '}
                      {t.linkedAccount.brand}{t.linkedAccount.alias ? ` (${t.linkedAccount.alias})` : ''}
                    </p>
                  )}
                  {t.expense && (
                    <p className="text-xs text-[var(--warm-muted)] truncate">
                      ↪ 원 지출: {t.expense.category}{t.expense.detail ? ` · ${t.expense.detail}` : ''} ({fmtWon(t.expense.amount)})
                    </p>
                  )}
                  {t.memo && <p className="text-xs text-[var(--warm-muted)] truncate">메모: {t.memo}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-semibold ${typeColor(t.type)}`}>
                    {t.type === 'DEPOSIT' ? '+' : '−'}{fmtWon(t.amount)}
                  </span>
                  <button onClick={() => handleDelete(t.id)}
                    className="text-xs text-[var(--warm-muted)] hover:text-[var(--danger-fg)]">삭제</button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>

  )
}

// ── 공통 서브 컴포넌트 ────────────────────────────────────────────

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0 gap-4">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}
