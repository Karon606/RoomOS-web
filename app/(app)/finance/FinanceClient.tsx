'use client'

import { useState, useTransition, useRef, useEffect, useCallback, useMemo } from 'react'
import {
  addExpense, updateExpense, deleteExpense, attachShippingToOrder, detachShippingFromOrder,
  addExtraIncome, updateExtraIncome, deleteExtraIncome,
  settleCardExpenses, unsettleExpenses,
  saveFinancialAccount, deleteFinancialAccount, deactivateFinancialAccount,
  recordRecurringExpense, uploadExpenseReceipt, getLastItemUnits,
  analyzeReceiptWithGemini,
  addReserveDeposit, addReserveWithdrawDirect, settleReserveFromExpense, deleteReserveTransaction,
  setRecurringPendingAmount, clearRecurringPendingAmount,
  getVendorUsage, renameVendor,
  type RecurringExpenseWithStatus,
} from './actions'
import {
  getRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense, groupRecurringExpenses,
  type RecurringExpenseRow,
} from '@/app/(app)/settings/actions'
import { includeExpenseInInventory } from '@/app/(app)/inventory/actions'
import { useRouter } from 'next/navigation'
import { recordDepositReceived } from '@/app/(app)/rooms/actions'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Loading } from '@/components/ui/Loading'
import MonthSelector from '@/components/layout/MonthSelector'
import { chartColor } from '@/lib/chartColors'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
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
  qtyValue: number | null; qtyUnit: string | null
  orderId: string | null; isShipping: boolean
  allocationGroupId: string | null   // 한 품목 방별 분배 묶음 — 목록에서 한 줄로 묶어 표시
  excludeFromInventory: boolean   // 재고 계산 제외 — 상세에서 '다시 포함' 제공
  order: { id: string; code: string; shippingType: string | null; shippingMemo: string | null } | null
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

type UnsettledExpense = {
  id: string; date: Date; amount: number; category: string
  detail: string | null; financeName: string | null
  financialAccountId: string | null
  financialAccount: {
    id: string; brand: string; alias: string | null
    cutOffDay: number | null; payDay: number | null
    linkedAccount: { brand: string; alias: string | null } | null
  } | null
}

type SettleGroup = {
  accountId: string; accountName: string; billMonth: string
  billingPeriodStr: string; linkedAccountName: string | null
  payDayStr: string; items: UnsettledExpense[]; total: number
}

// ── Constants ────────────────────────────────────────────────────

const EXPENSE_CATEGORIES = ['부식비', '소모품비', '폐기물 처리비', '수선유지비', '공과금', '마케팅/광고비', '인건비', '청소용역비', '관리비', '임대료', '통신/렌탈/보험료', '세금/수수료', '보증금 반환']

// ── 품목 선택기 설정 ─────────────────────────────────────────────

const ITEM_PRESETS: Record<string, string[]> = {
  '부식비':  ['쌀', '김치', '라면', '식빵', '계란', '고추장', '된장'],
  // 사이즈·포장 타입이 다르면 별도 카드로 추적되도록 라벨에 명시
  '소모품비': ['물티슈', '키친타월 (롤)', '키친타월 (팝업)', '주방세제', '세탁세제', '화장실 휴지'],
  '폐기물 처리비': [
    '음식물쓰레기봉투 5L', '음식물쓰레기봉투 10L', '음식물쓰레기봉투 20L',
    '재활용품수거봉투 20L', '재활용품수거봉투 50L', '재활용품수거봉투 100L',
    '종량제쓰레기봉투 10L', '종량제쓰레기봉투 20L', '종량제쓰레기봉투 50L', '종량제쓰레기봉투 100L',
    '음식물쓰레기 배출 스티커',
  ],
}

const SPEC_UNITS = ['kg', 'g', 'ml', 'L', '매', 'm', '장', '개', '인분', '봉지', '알', '권']
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
  specValue: string; specUnit: string
  qtyValue: string; qtyUnit: string
  amount?: number   // 이 품목에 할당된 총 금액
  unitPrice?: number  // 단가 — amount 와 수량으로 상호 자동계산(둘 중 하나 입력 시 다른 쪽 계산)
  // 방별 분배 (선택) — 사용자가 '방별로 나누기'를 켰을 때만. 비면 방 분할 없음(방은 선택사항).
  allocations?: { roomId: string; qty: string }[]
}

export function fmtItemDetail(d: ItemPickState): string {
  const spec = d.specValue ? `${d.specValue}${d.specUnit}` : ''
  const qty  = d.qtyValue  ? `${d.qtyValue}${d.qtyUnit}`  : ''
  return [`[${d.label}]`, spec, qty && `x ${qty}`].filter(Boolean).join(' ')
}

export function fmtItemListDetail(items: ItemPickState[]): string {
  if (items.length === 0) return ''
  if (items.length === 1) return fmtItemDetail(items[0])
  return items.map(d => fmtItemDetail(d)).join(', ')
}

// 방별 분배 묶음의 방 목록 라벨 — '101·102·103호' / 많으면 '101호 외 N곳' / 미지정 포함
function roomsLabel(rows: { room: { roomNo: string } | null }[]): string {
  const fmt = (no: string) => /^\d+$/.test(no) ? `${no}호` : no
  const named = rows.map(r => r.room?.roomNo).filter(Boolean) as string[]
  const unassigned = rows.length - named.length
  const parts = named.length <= 3 ? named.map(fmt) : [fmt(named[0]), `외 ${named.length - 1}곳`]
  if (unassigned > 0) parts.push('미지정')
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
          className="px-1.5 text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">✕</button>
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

function ItemSelector({ category, value, onChange, allowMulti = true, rooms = [], detailSuggestions = [] }: {
  category: string
  value: ItemPickState[]
  onChange: (data: ItemPickState[]) => void
  allowMulti?: boolean
  rooms?: { id: string; roomNo: string }[]   // 방별 분배용 (선택). 없으면 방 분배 UI 미표시.
  detailSuggestions?: string[]               // 과거 품목명 자동완성(구매처와 동일 방식)
}) {
  // 프리셋이 없는 카테고리도 '직접 입력'으로 품목·수량 추가 가능(옵션). 카테고리 커스터마이징 대응.
  const presets = ITEM_PRESETS[category] ?? []
  const items = value
  const [activeLabel, setActiveLabel] = useState<string | null>(null)
  const [specValue, setSpecValue]     = useState('')
  const [specUnit, setSpecUnit]       = useState('')
  const [qtyValue, setQtyValue]       = useState('')
  const [qtyUnit, setQtyUnit]         = useState('')
  const [amountStr, setAmountStr]     = useState('')
  const [customLabel, setCustomLabel] = useState('')
  const [fetching, setFetching]       = useState(false)
  const [prevUnits, setPrevUnits]     = useState<{ specUnit: string | null; qtyUnit: string | null } | null>(null)
  const [noSpec, setNoSpec]           = useState(false)   // 규격 없음(수량만) — 켜면 규격 입력 숨김

  // category 변경 시 active picker 입력만 초기화 (items는 부모가 관리)
  useEffect(() => {
    setActiveLabel(null)
    setSpecValue(''); setSpecUnit(''); setQtyValue(''); setQtyUnit('')
    setAmountStr(''); setCustomLabel(''); setPrevUnits(null); setNoSpec(false)
  }, [category])

  const numCls  = 'w-16 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const amtCls  = 'flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const textCls = 'w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  async function openPreset(label: string) {
    setActiveLabel(label)
    setSpecValue(''); setQtyValue(''); setAmountStr(''); setNoSpec(false)
    const def = ITEM_DEFAULTS[label]
    setSpecUnit(def?.specUnit ?? ''); setQtyUnit(def?.qtyUnit ?? '')
    setPrevUnits(null)
    setFetching(true)
    try {
      const last = await getLastItemUnits(label)
      if (last) {
        setPrevUnits(last)
        if (last.specUnit) setSpecUnit(last.specUnit)
        if (last.qtyUnit)  setQtyUnit(last.qtyUnit)
      }
    } finally { setFetching(false) }
  }

  function confirmAdd(label: string) {
    const amount = amountStr ? Number(amountStr.replace(/[^0-9]/g, '')) : undefined
    // 수량 미입력 → 자동 1개 (화면·detail·DB 표기 일관: "x 1개"). 단위도 비었으면 '개'.
    const noQty = qtyValue.trim() === ''
    const resolvedQty  = noQty ? '1' : qtyValue
    const resolvedUnit = noQty && qtyUnit.trim() === '' ? '개' : qtyUnit
    const q = Number(resolvedQty) || 1
    const unitPrice = amount != null && q > 0 ? Math.round(amount / q) : undefined
    const data: ItemPickState = { label, specValue, specUnit, qtyValue: resolvedQty, qtyUnit: resolvedUnit, amount, unitPrice }
    onChange([...items, data])
    setActiveLabel(null)
    setSpecValue(''); setQtyValue(''); setAmountStr(''); setCustomLabel('')
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function patchItem(idx: number, patch: Partial<ItemPickState>) {
    onChange(items.map((it, i) => i === idx ? { ...it, ...patch } : it))
  }
  const qtyNumOf = (it: ItemPickState) => Number(it.qtyValue) || 1
  // 금액 입력 → 단가 자동(금액÷수량)
  function updateItemAmount(idx: number, raw: string) {
    const amount = raw ? Number(raw.replace(/[^0-9]/g, '')) : undefined
    const q = qtyNumOf(items[idx])
    patchItem(idx, { amount, unitPrice: amount != null && q > 0 ? Math.round(amount / q) : undefined })
  }
  // 단가 입력 → 금액 자동(단가×수량)
  function updateItemUnit(idx: number, raw: string) {
    const unitPrice = raw ? Number(raw.replace(/[^0-9]/g, '')) : undefined
    const q = qtyNumOf(items[idx])
    patchItem(idx, { unitPrice, amount: unitPrice != null ? Math.round(unitPrice * q) : items[idx].amount })
  }
  // 수량 변경 → 단가 우선으로 금액 재계산(단가 없으면 금액→단가)
  function updateItemQty(idx: number, raw: string) {
    const qtyValue = raw.replace(/[^0-9.]/g, '')
    const it = items[idx]
    const q = Number(qtyValue) || 1
    if (it.unitPrice != null) patchItem(idx, { qtyValue, amount: Math.round(it.unitPrice * q) })
    else if (it.amount != null) patchItem(idx, { qtyValue, unitPrice: q > 0 ? Math.round(it.amount / q) : undefined })
    else patchItem(idx, { qtyValue })
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
        <p className="text-[0.625rem] text-[var(--warm-muted)]">
          직전 사용:{' '}
          {prevUnits.specUnit && <span className="text-[var(--warm-mid)]">규격 {prevUnits.specUnit}</span>}
          {prevUnits.specUnit && prevUnits.qtyUnit && <span className="mx-1">·</span>}
          {prevUnits.qtyUnit && <span className="text-[var(--warm-mid)]">수량 {prevUnits.qtyUnit}</span>}
        </p>
      )}
      {/* 규격 없음(수량만) — 켜면 규격 입력을 숨겨 빈 칸 혼동을 없앤다 */}
      <label className="flex items-center gap-1.5 text-[0.625rem] text-[var(--warm-muted)] cursor-pointer">
        <input type="checkbox" checked={noSpec}
          onChange={e => { setNoSpec(e.target.checked); if (e.target.checked) { setSpecValue(''); setSpecUnit(''); if (!qtyUnit.trim()) setQtyUnit('개') } }}
          className="w-3 h-3 accent-[var(--coral)]" />
        규격 없음 (수량만 입력)
      </label>
      <div className={`grid ${noSpec ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
        {!noSpec && (
        <div className="space-y-1">
          <label className="text-[0.625rem] text-[var(--warm-muted)]">규격</label>
          <div className="flex gap-1">
            <input type="text" inputMode="decimal" placeholder="0" value={specValue}
              onChange={e => setSpecValue(e.target.value.replace(/[^0-9.]/g, ''))} className={numCls} />
            <UnitCombobox value={specUnit} onChange={setSpecUnit}
              options={SPEC_UNITS} placeholder="단위" />
          </div>
        </div>
        )}
        <div className="space-y-1">
          <label className="text-[0.625rem] text-[var(--warm-muted)]">수량</label>
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
          <label className="text-[0.625rem] text-[var(--warm-muted)]">금액 <span className="text-[var(--warm-muted)]">(이 품목 분)</span></label>
          <div className="flex gap-1 items-center">
            <input type="text" inputMode="numeric"
              value={amountStr ? Number(amountStr.replace(/[^0-9]/g, '')).toLocaleString() : ''}
              onChange={e => setAmountStr(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className={amtCls} />
            <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">원</span>
          </div>
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
                  <span className="text-xs font-medium text-[var(--coral)] flex-1 min-w-0 truncate">{fmtItemDetail(it)}</span>
                  <button type="button" onClick={() => removeItem(idx)} className="text-[var(--coral)] hover:text-[var(--danger-fg)] leading-none text-sm shrink-0">×</button>
                </div>
                {allowMulti && (
                  <div className="flex items-end gap-1.5 flex-wrap">
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[0.5625rem] text-[var(--warm-muted)]">수량</span>
                      <input type="text" inputMode="decimal" value={it.qtyValue}
                        onChange={e => updateItemQty(idx, e.target.value)} placeholder="1"
                        className={`w-12 ${smallNum}`} />
                    </label>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] pb-1">×</span>
                    <label className="flex flex-col gap-0.5">
                      <span className="text-[0.5625rem] text-[var(--warm-muted)]">단가</span>
                      <input type="text" inputMode="numeric" value={it.unitPrice ? it.unitPrice.toLocaleString() : ''}
                        onChange={e => updateItemUnit(idx, e.target.value)} placeholder="0"
                        className={`w-20 ${smallNum}`} />
                    </label>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] pb-1">=</span>
                    <label className="flex flex-col gap-0.5 flex-1 min-w-[5rem]">
                      <span className="text-[0.5625rem] text-[var(--warm-muted)]">금액</span>
                      <input type="text" inputMode="numeric" value={it.amount ? it.amount.toLocaleString() : ''}
                        onChange={e => updateItemAmount(idx, e.target.value)} placeholder="0"
                        className={`w-full ${smallNum}`} />
                    </label>
                  </div>
                )}
                {allowMulti && rooms.length > 0 && (
                  <div>
                    <button type="button" onClick={() => toggleAlloc(idx)}
                      className={`text-[0.625rem] px-1.5 py-0.5 rounded-md border transition-colors ${it.allocations ? 'border-[var(--coral)] text-[var(--coral)] bg-[var(--coral)]/5' : 'border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--coral)]'}`}>
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
                              className="text-[var(--warm-muted)] hover:text-[var(--danger-fg)] text-sm shrink-0">×</button>
                          </div>
                        ))}
                        <div className="flex items-center justify-between">
                          <button type="button" onClick={() => setAllocs(idx, [...it.allocations!, { roomId: '', qty: '' }])}
                            className="text-[0.625rem] text-[var(--coral)] hover:underline">+ 방 추가</button>
                          <span className={`text-[0.5625rem] ${allocOver ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'}`}>
                            방 배정 {allocSum} / 전체 {it.qtyValue || 0}
                            {allocOver ? ' ⚠ 수량 초과' : allocRemain > 0.001 ? ` · 나머지 ${allocRemain}개 미지정` : ''}
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
            <p className="text-[0.625rem] text-[var(--warm-muted)] text-right">
              합계 {totalItemAmount.toLocaleString()}원
            </p>
          )}
        </div>
      )}

      {/* 품목 추가 버튼들 — 다중 모드면 항상, 단일 모드면 비어있을 때만 */}
      {!activeLabel && (allowMulti || items.length === 0) && (
        <div className="flex flex-wrap gap-1.5">
          {presets.map(label => (
            <button key={label} type="button" onClick={() => openPreset(label)}
              className="px-3 py-1.5 text-xs rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors">
              + {label}
            </button>
          ))}
          <button type="button" onClick={() => { setActiveLabel('__custom__'); setSpecUnit(''); setQtyUnit('') }}
            className="px-3 py-1.5 text-xs rounded-xl bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] text-[var(--warm-muted)] hover:border-[var(--coral)] hover:text-[var(--coral)] transition-colors">
            + 직접 입력
          </button>
        </div>
      )}

      {activeLabel && activeLabel !== '__custom__' && (
        <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--warm-dark)]">
              {activeLabel}{fetching && <span className="ml-1 text-[0.625rem] text-[var(--warm-muted)]">단위 불러오는 중…</span>}
            </span>
            <button type="button" onClick={() => setActiveLabel(null)}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-sm leading-none">✕</button>
          </div>
          {SpecQtyInputs()}
          <Btn variant="primary" size="sm" fullWidth onClick={() => confirmAdd(activeLabel)}>추가</Btn>
        </div>
      )}

      {activeLabel === '__custom__' && (
        <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--warm-dark)]">직접 입력</span>
            <button type="button" onClick={() => setActiveLabel(null)}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-sm leading-none">✕</button>
          </div>
          <div className="space-y-1">
            <label className="text-[0.625rem] text-[var(--warm-muted)]">품목명</label>
            <input type="text" placeholder="예: 고추장" value={customLabel} onChange={e => setCustomLabel(e.target.value)} className={textCls}
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
  const [rows, setRows] = useState<{ vendor: string; count: number }[] | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
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
    <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/70" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] shadow-lift w-full sm:max-w-md sm:rounded-2xl rounded-t-2xl max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
          <div>
            <h2 className="text-sm font-bold text-[var(--warm-dark)]">구매처 관리</h2>
            <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">오타·중복 정리. 같은 이름으로 바꾸면 합쳐지고, 비우면 그 지출들의 구매처가 제거됩니다.</p>
          </div>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] w-9 h-9 flex items-center justify-center" aria-label="닫기">✕</button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-1.5">
          {rows === null ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] text-center py-6">등록된 구매처가 없습니다.</p>
          ) : rows.map(r => {
            const val = edits[r.vendor] ?? r.vendor
            const changed = val.trim() !== r.vendor
            return (
              <div key={r.vendor} className="flex items-center gap-1.5">
                <input type="text" value={val} onChange={e => setEdits(p => ({ ...p, [r.vendor]: e.target.value }))}
                  className="flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0 w-9 text-right">{r.count}건</span>
                <button type="button" disabled={busy === r.vendor || !changed} onClick={() => apply(r.vendor, val)}
                  className="text-xs px-2 py-1 rounded-lg bg-[var(--coral)] text-white disabled:opacity-30 shrink-0">저장</button>
                <button type="button" disabled={busy === r.vendor} onClick={() => apply(r.vendor, '')}
                  className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] disabled:opacity-40 px-1.5 py-1 shrink-0" title="구매처 비우기">비움</button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const PAY_METHODS_EXP    = ['계좌이체', '신용카드', '체크카드', '현금', '기타']
// 부가 수익 전용 입금수단 — '보유 보증금'은 보증금 카테고리에서 선택 가능 (다른 카테고리/모달엔 노출 X)
const PAY_METHODS_INC    = ['계좌이체', '현금', '보유 보증금', '기타']
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
      {centerSub && <text x={cx} y={cy + 19} textAnchor="middle" fontSize="10" fill="#a89888">{centerSub}</text>}
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
        {sublabel && <span className="text-[0.625rem] text-[var(--warm-muted)] leading-tight block">{sublabel}</span>}
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

// ─── Receipt scan utilities ───────────────────────────────────────────────

type CropPt = { x: number; y: number }
type CropCorners = { tl: CropPt; tr: CropPt; br: CropPt; bl: CropPt }

function gaussSolve(A: number[][], b: number[]): number[] {
  const n = b.length
  const M = A.map((row, i) => [...row, b[i]])
  for (let c = 0; c < n; c++) {
    let max = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[max][c])) max = r
    ;[M[c], M[max]] = [M[max], M[c]]
    for (let r = 0; r < n; r++) {
      if (r === c) continue
      const f = M[r][c] / M[c][c]
      for (let j = c; j <= n; j++) M[r][j] -= f * M[c][j]
    }
  }
  return M.map((row, i) => row[n] / row[i])
}

function buildHomography(srcPts: [number, number][], dstPts: [number, number][]): number[][] {
  const A: number[][] = [], b: number[] = []
  for (let i = 0; i < 4; i++) {
    const [sx, sy] = srcPts[i], [dx, dy] = dstPts[i]
    A.push([sx, sy, 1, 0, 0, 0, -sx * dx, -sy * dx]); b.push(dx)
    A.push([0, 0, 0, sx, sy, 1, -sx * dy, -sy * dy]); b.push(dy)
  }
  const h = gaussSolve(A, b)
  return [[h[0], h[1], h[2]], [h[3], h[4], h[5]], [h[6], h[7], 1]]
}

function applyHomographyPt(H: number[][], x: number, y: number): [number, number] {
  const w = H[2][0] * x + H[2][1] * y + H[2][2]
  return [(H[0][0] * x + H[0][1] * y + H[0][2]) / w, (H[1][0] * x + H[1][1] * y + H[1][2]) / w]
}

function detectDocumentCorners(bitmap: ImageBitmap): CropCorners {
  const SIZE = 320
  const sc = Math.min(SIZE / bitmap.width, SIZE / bitmap.height)
  const cW = Math.round(bitmap.width * sc), cH = Math.round(bitmap.height * sc)
  const canvas = document.createElement('canvas')
  canvas.width = cW; canvas.height = cH
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, cW, cH)
  const { data } = canvas.getContext('2d')!.getImageData(0, 0, cW, cH)
  const px = (x: number, y: number) => { const i = (y * cW + x) * 4; return [data[i], data[i + 1], data[i + 2]] }
  const c4 = [px(0, 0), px(cW - 1, 0), px(cW - 1, cH - 1), px(0, cH - 1)]
  const bg = [c4.reduce((s, p) => s + p[0], 0) / 4, c4.reduce((s, p) => s + p[1], 0) / 4, c4.reduce((s, p) => s + p[2], 0) / 4]
  let left = cW, top = cH, right = 0, bottom = 0
  for (let y = 0; y < cH; y++) for (let x = 0; x < cW; x++) {
    const [r, g, b] = px(x, y)
    if (Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]) > 40) {
      if (x < left) left = x; if (x > right) right = x
      if (y < top) top = y; if (y > bottom) bottom = y
    }
  }
  const pad = 0.03
  if (left >= right || top >= bottom)
    return { tl: { x: pad, y: pad }, tr: { x: 1 - pad, y: pad }, br: { x: 1 - pad, y: 1 - pad }, bl: { x: pad, y: 1 - pad } }
  const nx = (v: number) => Math.max(0, Math.min(1, v / cW))
  const ny = (v: number) => Math.max(0, Math.min(1, v / cH))
  return { tl: { x: nx(left), y: ny(top) }, tr: { x: nx(right), y: ny(top) }, br: { x: nx(right), y: ny(bottom) }, bl: { x: nx(left), y: ny(bottom) } }
}

async function warpReceiptToRect(bitmap: ImageBitmap, corners: CropCorners): Promise<{ dataUrl: string; base64: string }> {
  const iW = bitmap.width, iH = bitmap.height
  const tl: [number, number] = [corners.tl.x * iW, corners.tl.y * iH]
  const tr: [number, number] = [corners.tr.x * iW, corners.tr.y * iH]
  const br: [number, number] = [corners.br.x * iW, corners.br.y * iH]
  const bl: [number, number] = [corners.bl.x * iW, corners.bl.y * iH]
  const dist = (a: [number, number], b: [number, number]) => Math.hypot(b[0] - a[0], b[1] - a[1])
  const oW = Math.max(1, Math.round(Math.max(dist(tl, tr), dist(bl, br))))
  const oH = Math.max(1, Math.round(Math.max(dist(tl, bl), dist(tr, br))))
  const H = buildHomography([[0, 0], [oW, 0], [oW, oH], [0, oH]], [tl, tr, br, bl])
  const srcCanvas = document.createElement('canvas')
  srcCanvas.width = iW; srcCanvas.height = iH
  srcCanvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  const src = srcCanvas.getContext('2d')!.getImageData(0, 0, iW, iH).data
  const outCanvas = document.createElement('canvas')
  outCanvas.width = oW; outCanvas.height = oH
  const outCtx = outCanvas.getContext('2d')!
  const outImg = outCtx.createImageData(oW, oH)
  const out = outImg.data
  for (let y = 0; y < oH; y++) {
    for (let x = 0; x < oW; x++) {
      const [sx, sy] = applyHomographyPt(H, x, y)
      const x0 = Math.floor(sx), y0 = Math.floor(sy), x1 = x0 + 1, y1 = y0 + 1
      const fx = sx - x0, fy = sy - y0
      const oi = (y * oW + x) * 4
      const ch = (px: number, py: number, c: number) => (px < 0 || py < 0 || px >= iW || py >= iH) ? 255 : src[(py * iW + px) * 4 + c]
      for (let c = 0; c < 4; c++)
        out[oi + c] = (ch(x0, y0, c) * (1 - fx) * (1 - fy) + ch(x1, y0, c) * fx * (1 - fy) + ch(x0, y1, c) * (1 - fx) * fy + ch(x1, y1, c) * fx * fy + 0.5) | 0
    }
  }
  outCtx.putImageData(outImg, 0, 0)
  const dataUrl = outCanvas.toDataURL('image/jpeg', 0.92)
  return { dataUrl, base64: dataUrl.replace(/^data:image\/jpeg;base64,/, '') }
}

function dataUrlToFile(dataUrl: string, name: string): File {
  const [header, b64] = dataUrl.split(',')
  const mime = (header.match(/:(.*?);/) ?? ['', 'image/jpeg'])[1]
  const bytes = atob(b64); const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], name, { type: mime })
}

// ─── ReceiptScanModal ─────────────────────────────────────────────────────

function CornerHandle({ cx, cy, containerRef, onMove, onStart, onEnd }: {
  cx: number; cy: number
  containerRef: React.RefObject<HTMLDivElement | null>
  onMove: (x: number, y: number) => void
  onStart?: () => void
  onEnd?: () => void
}) {
  const SIZE = 28
  return (
    <div
      style={{
        position: 'absolute', left: cx - SIZE / 2, top: cy - SIZE / 2,
        width: SIZE, height: SIZE, borderRadius: '50%',
        background: 'var(--coral)', border: '3px solid white',
        cursor: 'grab', touchAction: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.5)', zIndex: 2,
      }}
      onPointerDown={e => {
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        onStart?.()
      }}
      onPointerMove={e => {
        if (!(e.buttons & 1)) return
        const rect = containerRef.current?.getBoundingClientRect()
        if (!rect) return
        onMove(Math.max(0, Math.min(rect.width, e.clientX - rect.left)), Math.max(0, Math.min(rect.height, e.clientY - rect.top)))
      }}
      onPointerUp={() => onEnd?.()}
      onPointerCancel={() => onEnd?.()}
    />
  )
}

// 모서리 드래그 중 원본 해상도에서 잘라낸 작은 영역을 확대해 표시.
// 손가락이 코너를 가려도 화면 위의 확대경으로 정확히 픽셀 단위 조정 가능.
function CornerLoupe({ bitmap, cornerX, cornerY, dW, dH }: {
  bitmap: ImageBitmap
  cornerX: number; cornerY: number
  dW: number; dH: number
}) {
  const SIZE = 120
  const MAG = 2.8
  const canvasRef = useRef<HTMLCanvasElement>(null)
  // 원본 비트맵에서 잘라낼 영역 (코너 중심으로)
  const sourceX = (cornerX / dW) * bitmap.width
  const sourceY = (cornerY / dH) * bitmap.height
  const srcW = SIZE / MAG / (dW / bitmap.width)
  const srcH = SIZE / MAG / (dH / bitmap.height)
  const sx = sourceX - srcW / 2
  const sy = sourceY - srcH / 2

  useEffect(() => {
    const c = canvasRef.current; if (!c) return
    const ctx = c.getContext('2d'); if (!ctx) return
    ctx.clearRect(0, 0, SIZE, SIZE)
    // 비트맵을 그리기 전에 원형 클립
    ctx.save()
    ctx.beginPath()
    ctx.arc(SIZE / 2, SIZE / 2, SIZE / 2, 0, Math.PI * 2)
    ctx.clip()
    // 비어보일 수 있는 가장자리 흰색으로 채워두기
    ctx.fillStyle = 'rgba(255,255,255,0.6)'
    ctx.fillRect(0, 0, SIZE, SIZE)
    // 코너가 이미지 가장자리에 있을 때(예: 우측 하단 모서리) sx/sy 가 음수이거나
    // sx+srcW 가 bitmap.width 를 넘어서 source 사각형의 일부가 bitmap 밖으로 벗어남.
    // 단순 drawImage 는 그 잘려나간 만큼 destination 의 (0,0) 부터 그리기 때문에
    // 결과적으로 십자선이 가리키는 위치가 어긋남 (사용자 진단 2026-06-01).
    // 해결: bitmap 영역 안으로 잘린 source 만 그리되, destination 위치도 같은 비율로
    // 이동시켜 핸들 위치(sourceX,sourceY) 가 캔버스 중앙(SIZE/2,SIZE/2) 에 오게 유지한다.
    let drawSx = sx, drawSy = sy
    let drawSw = srcW, drawSh = srcH
    let drawDx = 0, drawDy = 0
    const pxPerSrcX = SIZE / srcW
    const pxPerSrcY = SIZE / srcH
    if (drawSx < 0) { drawDx = -drawSx * pxPerSrcX; drawSw = srcW + drawSx; drawSx = 0 }
    if (drawSy < 0) { drawDy = -drawSy * pxPerSrcY; drawSh = srcH + drawSy; drawSy = 0 }
    if (drawSx + drawSw > bitmap.width)  drawSw = bitmap.width  - drawSx
    if (drawSy + drawSh > bitmap.height) drawSh = bitmap.height - drawSy
    if (drawSw > 0 && drawSh > 0) {
      const drawDw = drawSw * pxPerSrcX
      const drawDh = drawSh * pxPerSrcY
      ctx.drawImage(bitmap, drawSx, drawSy, drawSw, drawSh, drawDx, drawDy, drawDw, drawDh)
    }
    ctx.restore()
  }, [sx, sy, srcW, srcH, bitmap])

  // 위치: 기본은 코너 위로 18px, 화면 위로 넘어가면 아래로 fallback.
  // 가로는 코너 중심으로 두되 컨테이너 안에서 클램프.
  const aboveY = cornerY - SIZE - 22
  const useAbove = aboveY > 4
  const top = useAbove ? aboveY : cornerY + 28
  const left = Math.max(4, Math.min(dW - SIZE - 4, cornerX - SIZE / 2))

  return (
    <div
      style={{
        position: 'absolute', left, top, width: SIZE, height: SIZE,
        borderRadius: '50%', border: '3px solid white',
        boxShadow: '0 6px 16px rgba(0,0,0,0.55)', pointerEvents: 'none',
        zIndex: 3, overflow: 'hidden',
      }}
      aria-hidden="true"
    >
      <canvas ref={canvasRef} width={SIZE} height={SIZE} />
      {/* 십자선 — 정확한 픽셀 위치 표시 */}
      <div style={{ position: 'absolute', top: '50%', left: 0, width: '100%', height: 1, background: 'var(--coral)', opacity: 0.85 }} />
      <div style={{ position: 'absolute', left: '50%', top: 0, height: '100%', width: 1, background: 'var(--coral)', opacity: 0.85 }} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', width: 6, height: 6, marginTop: -3, marginLeft: -3, borderRadius: '50%', border: '1.5px solid white', background: 'transparent' }} />
    </div>
  )
}

function ReceiptScanModal({ bitmap, onConfirm, onCancel }: {
  bitmap: ImageBitmap
  onConfirm: (result: { dataUrl: string; base64: string }) => void
  onCancel: () => void
}) {
  const MAX_DIM = Math.min(window.innerWidth * 0.92, window.innerHeight * 0.62, 520)
  const sc = Math.min(MAX_DIM / bitmap.width, MAX_DIM / bitmap.height)
  const dW = Math.round(bitmap.width * sc), dH = Math.round(bitmap.height * sc)
  const [corners, setCorners] = useState<CropCorners>(() => detectDocumentCorners(bitmap))
  const [processing, setProcessing] = useState(false)
  const [activeCorner, setActiveCorner] = useState<keyof CropCorners | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, dW, dH)
  }, [bitmap, dW, dH])

  const moveCorner = (key: keyof CropCorners, x: number, y: number) =>
    setCorners(prev => ({ ...prev, [key]: { x: x / dW, y: y / dH } }))

  const handleConfirm = async () => {
    setProcessing(true)
    try {
      const MAX = 1600
      const compSc = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height))
      const cW = Math.round(bitmap.width * compSc), cH = Math.round(bitmap.height * compSc)
      const compCanvas = document.createElement('canvas')
      compCanvas.width = cW; compCanvas.height = cH
      compCanvas.getContext('2d')!.drawImage(bitmap, 0, 0, cW, cH)
      const compBitmap = await createImageBitmap(compCanvas)
      const result = await warpReceiptToRect(compBitmap, corners)
      compBitmap.close?.()
      onConfirm(result)
    } catch {
      const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height
      c.getContext('2d')!.drawImage(bitmap, 0, 0)
      const dataUrl = c.toDataURL('image/jpeg', 0.85)
      onConfirm({ dataUrl, base64: dataUrl.replace(/^data:image\/jpeg;base64,/, '') })
    } finally { setProcessing(false) }
  }

  const pts = `${corners.tl.x*dW},${corners.tl.y*dH} ${corners.tr.x*dW},${corners.tr.y*dH} ${corners.br.x*dW},${corners.br.y*dH} ${corners.bl.x*dW},${corners.bl.y*dH}`

  return (
    <div className="fixed inset-0 z-[var(--z-modal)] flex flex-col items-center justify-center bg-black/92">
      <p className="text-white text-sm font-medium mb-4 px-4 text-center">모서리를 드래그해서 영수증 테두리를 맞추세요</p>
      <div ref={containerRef} className="relative" style={{ width: dW, height: dH, touchAction: 'none' }}>
        <canvas ref={canvasRef} width={dW} height={dH} className="block rounded-xl" />
        <svg className="absolute inset-0 pointer-events-none rounded-xl" width={dW} height={dH}>
          <path fillRule="evenodd" fill="rgba(0,0,0,0.45)"
            d={`M0,0 L${dW},0 L${dW},${dH} L0,${dH} Z M${pts.replace(/ /g,' L')} Z`} />
          <polygon points={pts} fill="none" stroke="var(--coral)" strokeWidth="2.5" />
        </svg>
        {(['tl', 'tr', 'br', 'bl'] as const).map(key => (
          <CornerHandle key={key} cx={corners[key].x * dW} cy={corners[key].y * dH}
            containerRef={containerRef}
            onMove={(x, y) => moveCorner(key, x, y)}
            onStart={() => setActiveCorner(key)}
            onEnd={() => setActiveCorner(null)}
          />
        ))}
        {activeCorner && (
          <CornerLoupe
            bitmap={bitmap}
            cornerX={corners[activeCorner].x * dW}
            cornerY={corners[activeCorner].y * dH}
            dW={dW} dH={dH}
          />
        )}
      </div>
      <div className="flex gap-3 mt-6">
        <button type="button" onClick={onCancel}
          className="px-6 py-2.5 rounded-xl bg-white/15 text-white text-sm font-medium hover:bg-white/25 transition-colors">
          취소
        </button>
        <Btn variant="primary" size="md" onClick={handleConfirm} disabled={processing}>
          {processing ? '처리 중…' : '영역 확정'}
        </Btn>
      </div>
    </div>
  )
}

function toDateInput(d: Date | string | null | undefined) {
  if (!d) return ''
  return kstYmdStr(new Date(d))
}

function fmtDate(d: Date | string | null | undefined) {
  if (!d) return '—'
  const dt = new Date(d)
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
}

function accName(a: FAcc | { brand: string; alias: string | null } | null) {
  if (!a) return ''
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}

function displayDay(day: number | null) {
  if (!day || day >= 31) return '말일'
  return `${day}일`
}

function getBillMonth(date: Date | string, cutOffDay: number | null) {
  const d = new Date(date)
  const cutOff = cutOffDay && cutOffDay < 31 ? cutOffDay : 31
  let year = d.getFullYear(), month = d.getMonth() + 1
  if (d.getDate() > cutOff) {
    month += 1
    if (month > 12) { month = 1; year += 1 }
  }
  return `${year}-${String(month).padStart(2, '0')}`
}

function buildSettleGroups(unsettledExpenses: UnsettledExpense[]): SettleGroup[] {
  const map = new Map<string, SettleGroup>()
  unsettledExpenses.forEach(exp => {
    const acc = exp.financialAccount
    const cutOff = acc?.cutOffDay ?? null
    const billMonth = getBillMonth(exp.date, cutOff)
    const accountId = acc?.id ?? (exp.financeName ?? 'unknown')
    const name = acc ? accName(acc) : (exp.financeName ?? '미지정 카드')
    const key = `${accountId}__${billMonth}`

    if (!map.has(key)) {
      const [billYStr, billMStr] = billMonth.split('-')
      const billY = parseInt(billYStr), billM = parseInt(billMStr)
      let prevM = billM - 1, prevY = billY
      if (prevM < 1) { prevM = 12; prevY -= 1 }
      const startDay = (cutOff && cutOff < 31) ? cutOff + 1 : 1
      const endDayStr = (cutOff && cutOff < 31) ? `${cutOff}일` : '말일'
      const periodStr = `${prevY}년 ${prevM}월 ${startDay}일 ~ ${billY}년 ${billM}월 ${endDayStr}`
      const linked = acc?.linkedAccount ? accName(acc.linkedAccount) : null
      const payDayStr = acc?.payDay ? displayDay(acc.payDay) : '미지정'
      map.set(key, { accountId, accountName: name, billMonth, billingPeriodStr: periodStr, linkedAccountName: linked, payDayStr, items: [], total: 0 })
    }
    const g = map.get(key)!
    g.items.push(exp)
    g.total += exp.amount
  })
  return Array.from(map.values()).sort((a, b) => a.billMonth.localeCompare(b.billMonth))
}

// ── Main Component ────────────────────────────────────────────────

type Tab = 'expense' | 'income' | 'settle' | 'assets' | 'deposit' | 'reserve'

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
  expenses, incomes, financialAccounts, unsettledExpenses, settledCardExpenses, incomeCategories, expenseCategories, paymentMethods, targetMonth, recurringExpensesWithStatus, rooms, prevMonth, prevMonthTotals, lastYearMonth, lastYearTotals, acquisitionDate, detailSuggestions, vendorSuggestions,
  reserveBalance, reserveMonthly, reserveTxns, settleableExpenses,
  depositSummary, depositLedger,
  initialTab,
}: {
  expenses: Expense[]
  incomes: Income[]
  financialAccounts: FinancialAccount[]
  unsettledExpenses: UnsettledExpense[]
  settledCardExpenses: UnsettledExpense[]
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
  depositSummary: DepositPerTenant[]
  depositLedger: DepositLedgerEntry[]
  initialTab?: Tab
}) {
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
  const [expFilter, setExpFilter] = useState({ method: 'all', category: 'all', finance: 'all' })
  // 미확인 고정 지출 가시성: 'all' = 전체, 'soon' = 결제일 D-3 이내(과거 도래 포함)만
  const [recVisibility, setRecVisibility] = useState<'all' | 'soon'>(() => {
    if (typeof window === 'undefined') return 'soon'
    return (localStorage.getItem('stayeum-rec-visibility') as 'all' | 'soon') ?? 'soon'
  })
  useEffect(() => {
    if (typeof window !== 'undefined') localStorage.setItem('stayeum-rec-visibility', recVisibility)
  }, [recVisibility])
  const [showAddExp, setShowAddExp]       = useState(false)
  const [addExpDate, setAddExpDate]       = useState(() => kstYmdStr())
  const [detailExp, setDetailExp]         = useState<Expense | null>(null)
  const [detailExpEdit, setDetailExpEdit] = useState(false)
  // 방별 분배 묶음 펼침 — 멤버 행 목록(각 방별 금액). null 이면 닫힘.
  const [groupDetail, setGroupDetail]     = useState<Expense[] | null>(null)
  // 지출내역 보기 — '아이템별'(기본) / '주문별'(같은 주문 묶음 + 배송비 포함, 쇼핑몰 주문내역처럼). 선택 기억.
  const [expView, setExpView] = useState<'item' | 'order'>(() =>
    typeof window !== 'undefined' && localStorage.getItem('stayeum-finance-expview') === 'order' ? 'order' : 'item')
  const changeExpView = (v: 'item' | 'order') => { setExpView(v); if (typeof window !== 'undefined') localStorage.setItem('stayeum-finance-expview', v) }
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
  const [addExpCategory, setAddExpCategory]   = useState(EXPENSE_CATEGORIES[0])
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
  const scanTargetRef                         = useRef<'add' | 'edit'>('add')
  const [editExpCategory, setEditExpCategory] = useState('')
  const [addItems, setAddItems]   = useState<ItemPickState[]>([])
  const [addIsService, setAddIsService] = useState(false)   // #2 서비스·무형(시공·인건비 등) — 품목 없이 금액만
  const [editItems, setEditItems] = useState<ItemPickState[]>([])
  const [editExpAmount, setEditExpAmount]     = useState<number | undefined>(undefined)  // 품목 없을 때 controlled 금액
  const [editExpDetail, setEditExpDetail]     = useState('')
  const [editHasShipping, setEditHasShipping] = useState(false)   // 배송비를 이 지출 금액에 합산
  const [editShipping, setEditShipping]       = useState<number | undefined>(undefined)
  const [editShipSeparate, setEditShipSeparate] = useState(false) // 배송비를 별도 지출(합배송)로 묶기

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
  const ocrCropped = async (cropped: { dataUrl: string; base64: string }) => {
    setScanOcrPending(true)
    setScanOcrError('')
    try {
      const res = await analyzeReceiptWithGemini(cropped.base64, 'image/jpeg')
      if (!res.ok) { setScanOcrError(res.error) }
      else {
        const d = res.data
        if (d.date) setAddExpDate(d.date)
        if (d.vendor) setAddExpVendor(d.vendor)
        if (d.category && EXPENSE_CATEGORIES.includes(d.category)) setAddExpCategory(d.category)
        if (d.items.length > 0 && ITEM_PRESETS[d.category ?? '']) {
          setAddItems(d.items.map(it => ({ label: it.label, specValue: it.specValue ?? '', specUnit: it.specUnit ?? '', qtyValue: it.qtyValue ?? '', qtyUnit: it.qtyUnit ?? '', amount: it.amount, unitPrice: it.amount != null ? Math.round(it.amount / (Number(it.qtyValue) || 1)) : undefined })))
          setAddExpAmount(d.items.reduce((s, it) => s + it.amount, 0))
        } else {
          setAddItems([])
          if (d.totalAmount) setAddExpAmount(d.totalAmount)
          if (d.items.length > 0) setAddExpDetail(d.items.map(it => `[${it.label}] ${it.amount.toLocaleString()}원`).join(', '))
        }
      }
      await uploadCropped(cropped)
    } finally { setScanOcrPending(false) }
  }

  // 스캔(크롭) 완료 → 지출 등록 폼이면 '분석할까요?' 팝업으로 자동 분석/첨부 분기.
  // 편집 폼은 기존대로 미리보기 + 수동 버튼 유지.
  const handleScanConfirm = async (result: { dataUrl: string; base64: string }) => {
    setScanBitmap(prev => { prev?.close?.(); return null })
    setScanCropped(result)
    if (scanTargetRef.current === 'add') {
      if (await confirmDialog({ title: '영수증을 분석해서 자동 입력할까요?', message: '날짜·금액·품목을 자동으로 채웁니다. 첨부만 할 수도 있습니다.', confirmLabel: '자동 분석', cancelLabel: '영수증만 첨부' })) {
        void ocrCropped(result)
      } else {
        void uploadCropped(result)
      }
    }
  }

  const handleScanCancel = () => {
    setScanBitmap(prev => { prev?.close?.(); return null })
  }

  // 버튼용 래퍼 (state 의 현재 cropped 사용) — 편집 폼 수동 버튼 등
  const handleScanUpload = async () => { if (scanCropped) await uploadCropped(scanCropped) }
  const handleScanAndOcr = async () => { if (scanCropped) await ocrCropped(scanCropped) }

  // ── 수익 탭 상태 ─────────────────────────────────────────────
  const [incFilter, setIncFilter] = useState({ method: 'all', category: 'all' })
  const [showAddInc, setShowAddInc]       = useState(false)
  const [addIncDate, setAddIncDate]       = useState(() => kstYmdStr())
  const [detailInc, setDetailInc]         = useState<Income | null>(null)
  const [detailIncEdit, setDetailIncEdit] = useState(false)
  const [addIncMethod, setAddIncMethod]   = useState('계좌이체')
  const [addIncAccId, setAddIncAccId]     = useState('')
  const [editIncMethod, setEditIncMethod]   = useState('계좌이체')
  const [editIncAccId, setEditIncAccId]     = useState('')
  const [editIncDate, setEditIncDate]       = useState('')

  // ── 고정 지출 탭 상태 ────────────────────────────────────────
  const [recordingRec, setRecordingRec] = useState<RecurringExpenseWithStatus | null>(null)
  const [recRecAmount, setRecRecAmount] = useState(0)
  // #1 관리비 묶음: 기록 시 세부항목별 금액(변동은 편집). 비어있으면 단일 금액 모드.
  const [recRecItems, setRecRecItems]   = useState<{ name: string; amount: number; isVariable: boolean }[]>([])
  const [recRecDate, setRecRecDate]     = useState('')
  const [recRecMemo, setRecRecMemo]     = useState('')
  const [recRecPayMethod, setRecRecPayMethod] = useState('')
  const [recRecAccId, setRecRecAccId]   = useState('')
  const [recError, setRecError]         = useState('')

  const [showVendorMgmt, setShowVendorMgmt] = useState(false)
  // ── 고정 지출 관리 모달 상태 ─────────────────────────────────
  const [showRecMgmt, setShowRecMgmt]   = useState(false)
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
    setShowRecMgmtForm(true)
    setRecMgmtError('')
  }
  const openEditRecMgmt = (r: RecurringExpenseRow) => {
    setEditingRecMgmt(r)
    setRecMgmtForm({ title: r.title, amount: r.amount.toString(), category: r.category, dueDay: r.dueDay.toString(), payMethod: r.payMethod ?? '', financialAccountId: r.financialAccountId ?? '', isAutoDebit: r.isAutoDebit, isVariable: r.isVariable, alertDaysBefore: r.alertDaysBefore.toString(), activeSince: r.activeSince ?? '', priorYearAmount: r.priorYearAmount ? r.priorYearAmount.toString() : '', memo: r.memo ?? '' })
    setShowRecMgmtForm(true)
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

  const filteredExpenses = expenses.filter(e => {
    if (expFilter.method   !== 'all' && e.payMethod !== expFilter.method) return false
    if (expFilter.category !== 'all' && e.category  !== expFilter.category) return false
    if (expFilter.finance  !== 'all' && e.financialAccountId !== expFilter.finance) return false
    return true
  })
  const filteredIncomes = incomes.filter(i => {
    if (incFilter.method   !== 'all' && i.payMethod !== incFilter.method) return false
    if (incFilter.category !== 'all' && i.category  !== incFilter.category) return false
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
  const totalInc = filteredIncomes.reduce((s, i) => s + i.amount, 0)
  const settleGroups = buildSettleGroups(unsettledExpenses)
  const settledGroups = buildSettleGroups(settledCardExpenses)

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
    // #2 물품 구매는 품목 필수(재고/비품 누락 방지). 시공비·인건비 등 무형이면 '서비스·무형' 으로 전환.
    if (!addIsService && addItems.length === 0) {
      const msg = '품목을 1개 이상 추가하세요. (물품이 아닌 시공비·인건비 등이면 유형을 \'서비스·무형\'으로 바꾸세요)'
      setError(msg); pushToast('error', msg); return
    }
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await addExpense(fd)
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        setShowAddExp(false); setAddExpDate(kstYmdStr()); setAddReceiptUrl(''); setAddIsService(false); setAddHasShipping(false); setAddShipping(undefined); setAddOrderMode(false); setAddOrderShipping(undefined); setAddOrderShipMemo(''); router.refresh()
        pushToast('success', '지출 등록됨')
      } finally { release() }
    })
  }
  const handleUpdateExp = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await updateExpense(fd)
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        // 배송비 '별도 지출로 묶기(합배송)' — 수정 저장 후 주문 묶기/해제 처리.
        // 배송비 라인 자체는 제외(자기 자신을 묶으려다 오류 + 반쪽 저장이 되던 문제).
        if (detailExp && !detailExp.isShipping) {
          if (editShipSeparate && (attachShipAmount ?? 0) > 0) {
            const sres = await attachShippingToOrder({ expenseIds: [detailExp.id, ...attachShipSiblings], amount: attachShipAmount!, shippingType: attachShipType, shippingMemo: attachShipMemo || null })
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
          title: `이 지출(${exp.amount.toLocaleString()}원)을 삭제할까요?`,
          level: 'danger', confirmLabel: '삭제',
        })
    if (!ok) return
    startTransition(async () => {
      const release = trackSave()
      try {
        await deleteExpense(exp.id); setDetailExp(null); router.refresh()
        pushToast('success', isFixed ? '이번 달 기록이 취소되었습니다' : '삭제됨')
      } finally { release() }
    })
  }

  const handleAddInc = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await addExtraIncome(fd)
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        setShowAddInc(false); setAddIncDate(kstYmdStr()); router.refresh()
        pushToast('success', '수익 등록됨')
      } finally { release() }
    })
  }
  const handleUpdateInc = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await updateExtraIncome(fd)
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        setDetailInc(null); setDetailIncEdit(false); router.refresh()
        pushToast('success', '수익 수정됨')
      } finally { release() }
    })
  }
  const handleDeleteInc = async (id: string) => {
    if (!(await confirmDialog({ title: '이 수익 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      await deleteExtraIncome(id); setDetailInc(null); router.refresh()
    })
  }

  const handleSettle = async (ids: string[], name: string, billMonth: string) => {
    if (!(await confirmDialog({ title: `'${name}' ${billMonth} 청구분 ${ids.length}건을 정산 완료로 처리할까요?`, confirmLabel: '정산 완료' }))) return
    startTransition(async () => {
      await settleCardExpenses(ids); router.refresh()
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
  const recPendingTotal  = activeRecs.filter(r => !r.recordedExpenseId).reduce((s, r) => s + (r.historicalAvg ?? r.amount), 0)
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
  const TABS: { key: Tab; label: string }[] = [
    { key: 'expense', label: `지출 내역${recUnrecordedCount > 0 ? ` (고정 ${recUnrecordedCount}건 미확인)` : ''}` },
    { key: 'income',  label: '부가 수익' },
    { key: 'settle',  label: `카드 정산${unsettledExpenses.length > 0 ? ` (${unsettledExpenses.length})` : ''}` },
    { key: 'assets',  label: `자산 관리${financialAccounts.length > 0 ? ` (${financialAccounts.length})` : ''}` },
    { key: 'deposit', label: `보증금 (${fmtKorMoney(totalDepositBalance)})` },
    { key: 'reserve', label: `예비비 (${fmtKorMoney(reserveBalance)})` },
  ]

  return (
    <>
    <div className="space-y-5">

      {/* 헤더 — 우측 월 셀렉터(기간) */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">지출/기타 수익</h1>
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
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--warm-muted)]">고정 지출 (예정)</span>
                      {recPendingTotal > 0 && (
                        <span className="text-[0.5625rem] bg-[var(--warning-bg)] text-[var(--warning-fg)] px-1.5 py-0.5 rounded-full font-medium">
                          {recUnrecordedCount}건 미기록
                        </span>
                      )}
                    </div>
                    <span className="text-[var(--warning-fg)] font-medium num">
                      <MoneyDisplay amount={recPendingTotal} />
                    </span>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* 부가수익 */}
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs font-medium text-[var(--warm-muted)]">부가 수익 합계</p>
            <p className="text-xl font-bold text-[var(--warm-dark)] num">
              <MoneyDisplay amount={totalIncomeSum} prefix="+" />
            </p>
            <div className="pt-1 border-t border-[var(--warm-border)]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--warm-muted)]">수익 건수</span>
                <span className="text-[var(--warm-dark)] font-medium">{incomes.length}건</span>
              </div>
            </div>
          </div>
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
                      {amt.toLocaleString()}원
                    </span>
                    <span className="text-[0.625rem] text-[var(--warm-muted)] w-6 text-right shrink-0">{pct}%</span>
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
        <SegmentedControl
          size="md"
          scroll
          ariaLabel="재무 탭"
          value={tab}
          onChange={setTab}
          options={TABS.map(t => ({ value: t.key, label: t.label }))}
        />
      </div>

      {/* ══════════════════════════════════════════════════════════
          탭 1: 지출 내역
      ══════════════════════════════════════════════════════════ */}
      {tab === 'expense' && (
        <div className="space-y-4">
          {/* 필터 + 합계 + 버튼 */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={expFilter.method} onChange={e => setExpFilter(f => ({ ...f, method: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-lg px-3 py-1.5 outline-none">
              <option value="all">결제수단 (전체)</option>
              {effectivePaymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={expFilter.category} onChange={e => setExpFilter(f => ({ ...f, category: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-lg px-3 py-1.5 outline-none">
              <option value="all">카테고리 (전체)</option>
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {financialAccounts.length > 0 && (
              <select value={expFilter.finance} onChange={e => setExpFilter(f => ({ ...f, finance: e.target.value }))}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-lg px-3 py-1.5 outline-none">
                <option value="all">금융사 (전체)</option>
                {financialAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
              </select>
            )}
            <button onClick={() => setExpFilter({ method: 'all', category: 'all', finance: 'all' })}
              className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2">초기화</button>
            <span className="ml-auto flex flex-col items-end">
              <span className="text-[0.6875rem] text-[var(--warm-muted)] leading-none">실제 지출 합계 <span className="text-[0.5625rem]">(예정 제외)</span></span>
              <span className="text-sm font-bold text-[var(--danger-fg)] num mt-0.5">
                <MoneyDisplay amount={totalExp} />
              </span>
            </span>
            <Btn variant="secondary" size="md" onClick={openRecMgmt}>
              고정 지출 관리
            </Btn>
            <Btn variant="secondary" size="md" onClick={() => setShowVendorMgmt(true)}>
              구매처 관리
            </Btn>
            <Btn variant="primary" size="md" onClick={() => { setShowAddExp(true); setAddExpMethod('계좌이체'); setAddExpAccId(''); setAddExpAccName(''); setAddExpCategory(EXPENSE_CATEGORIES[0]); setAddItems([]); setAddIsService(false); setAddExpVendor(''); setAddExpAmount(undefined); setAddExpDetail(''); setAddHasShipping(false); setAddShipping(undefined); setAddOrderMode(false); setAddOrderShipping(undefined); setAddOrderShipMemo(''); setScanCropped(null); setScanOcrError(''); setError('') }}>
              + 지출 등록
            </Btn>
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
                          <li key={it.id} className="flex items-baseline justify-between gap-2 text-[0.625rem]">
                            <span className="text-[var(--warm-muted)] shrink-0 tabular-nums">{kstYmdStr(new Date(it.date)).slice(5)}</span>
                            <span className="flex-1 min-w-0 truncate text-[var(--warm-mid)]">{it.detail || it.category}{it.vendor ? ` · ${it.vendor}` : ''}</span>
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
              (expFilter.method === 'all' || r.payMethod === expFilter.method)
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
                  // 대표 = 비배송 최대금액 행(없으면 첫 행)
                  const rep = rows.filter(r => !r.isShipping).sort((a, b) => b.amount - a.amount)[0] ?? rows[0]
                  const total = rows.reduce((s, r) => s + r.amount, 0)
                  out.push({ exp: { ...rep, amount: total }, groupRows: rows, groupKind: 'order' })
                  continue
                }
                if (e.allocationGroupId) {
                  if (seenAlloc.has(e.allocationGroupId)) continue
                  seenAlloc.add(e.allocationGroupId)
                  const rows = filteredExpenses.filter(x => x.allocationGroupId === e.allocationGroupId)
                  const total = rows.reduce((s, r) => s + r.amount, 0)
                  out.push({ exp: { ...e, amount: total }, groupRows: rows, groupKind: 'room' })
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
                dateStr: `${targetMonth}-${String(r.dueDay).padStart(2, '0')}`,
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

            const isEmpty = items.length === 0

            return (
              <>
                {/* 보기 토글 — 아이템별 / 주문별(같은 주문 묶음 + 배송비) */}
                <div className="flex items-center justify-end">
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
                        + 임박하지 않은 고정 <span className="text-[var(--warm-dark)] font-semibold">{hiddenRecs.length}건</span> · 합계 <span className="num text-[var(--warm-dark)] font-semibold">{hiddenRecsTotal.toLocaleString()}원</span> 숨김
                      </button>
                    )}
                  </div>
                )}
                {/* 모바일 카드 */}
                {isEmpty ? (
                  <div className="sm:hidden bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-10 text-center">
                    <EmptyState label="지출 내역이 없습니다" />
                  </div>
                ) : (
                  <div className="sm:hidden space-y-1.5">
                    {items.map(item => {
                      if (item.kind === 'expense') {
                        const e = item.exp
                        const grp = item.groupRows
                        const isUnsettled = e.settleStatus === 'UNSETTLED'
                        const isFixed = !!e.recurringExpenseId
                        const meta = [e.payMethod, e.financialAccount ? accName(e.financialAccount) : null].filter(Boolean).join(' · ')
                        return (
                          <div key={e.id}
                            onClick={() => { if (grp) { setGroupDetail(grp) } else { setDetailExp(e); setDetailExpEdit(false); setAttachShipSiblings([]); setError('') } }}
                            className={`bg-[var(--cream)] border rounded-xl px-4 py-3 cursor-pointer active:opacity-70 transition-opacity ${isUnsettled ? 'border-[var(--danger-ring)]' : 'border-[var(--warm-border)]'}`}>
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  {isFixed && <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0 mt-0.5" />}
                                  <span className="text-[0.625rem] text-[var(--coral)] font-medium">{e.category}</span>
                                  {grp && (item.groupKind === 'order'
                                    ? <span className="text-[0.625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded">주문 {grp.filter(r => !r.isShipping).length}품목</span>
                                    : <span className="text-[0.625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded">방 {grp.length}개</span>)}
                                  {isUnsettled && <span className="text-[0.625rem] text-[var(--danger-fg)] font-medium">· 미정산</span>}
                                </div>
                                <p className="text-sm text-[var(--warm-dark)] truncate">{[e.vendor, e.detail].filter(Boolean).join(' · ') || '—'}</p>
                                {grp && (item.groupKind === 'order'
                                  ? <p className="text-[0.6875rem] text-[var(--coral)] truncate mt-0.5">{e.order?.code ? `주문 ${e.order.code}` : '주문 묶음'}{grp.some(r => r.isShipping) ? ' · 배송비 포함' : ''}</p>
                                  : <p className="text-[0.6875rem] text-[var(--coral)] truncate mt-0.5">{roomsLabel(grp)}</p>)}
                                {item.groupKind !== 'order' && (() => { const c = orderChip(e); return c ? (
                                  <span title={c.title} className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-md bg-[var(--honey)]/15 border border-[var(--honey)]/40 text-[0.5625rem] text-[var(--warm-dark)] font-medium max-w-full truncate">
                                    {c.text}
                                  </span>
                                ) : null })()}
                                <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">
                                  {fmtDate(e.date)}{meta ? ` · ${meta}` : ''}
                                  {e.memo ? ` · ${e.memo}` : ''}
                                </p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-semibold text-[var(--danger-fg)]"><MoneyDisplay amount={e.amount} prefix="-" alwaysFull /></p>
                                {e.receiptUrl && <span className="text-[0.5625rem] text-[var(--coral)]">영수증</span>}
                              </div>
                            </div>
                          </div>
                        )
                      }
                      // 미확인 고정 지출 카드
                      const r = item.rec
                      const expectedAmt = r.pendingAmount ?? r.historicalAvg ?? r.amount
                      return (
                        <div key={`rec-${r.id}`}
                          onClick={() => { setRecordingRec(r); setRecRecItems(r.items.map(it => ({ name: it.name, amount: it.amount, isVariable: it.isVariable }))); setRecRecAmount(r.items.length > 0 ? r.items.reduce((s, it) => s + it.amount, 0) : expectedAmt); setRecRecDate(item.dateStr); setRecRecMemo(r.memo ?? ''); setRecRecPayMethod(r.lastPayMethod ?? r.payMethod ?? '계좌이체'); setRecRecAccId(r.lastFinancialAccountId ?? r.financialAccountId ?? ''); setRecError('') }}
                          className="border border-[var(--warning-ring)] rounded-xl px-4 py-3 cursor-pointer active:opacity-70 transition-opacity bg-[var(--warning-bg)]/30">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0 mt-0.5" />
                                <span className="text-[0.625rem] text-[var(--warning-fg)] font-medium">{r.category}</span>
                                <span className="text-[0.625rem] text-[var(--warm-muted)]">고정{r.isVariable ? ' · 변동' : ''}</span>
                              </div>
                              <p className="text-sm text-[var(--warm-dark)] font-medium truncate">{r.title}</p>
                              <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">
                                {item.dateStr.slice(5).replace('-', '/')} 납부{r.isAutoDebit ? ' · 자동이체' : ''}
                                {r.pendingAmount != null ? ` · 예약금액 있음` : ''}
                              </p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold text-[var(--danger-fg)]"><MoneyDisplay amount={expectedAmt} prefix="-" /></p>
                              {r.isVariable && <p className="text-[0.5625rem] text-[var(--warm-muted)] mt-0.5">예상치</p>}
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 데스크탑 테이블 */}
                <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100vh-340px)]">
                  {isEmpty ? (
                    <EmptyState label="지출 내역이 없습니다" />
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
                        {items.map(item => {
                          if (item.kind === 'expense') {
                            const e = item.exp
                            const grp = item.groupRows
                            return (
                              <tr key={e.id}
                                onClick={() => { if (grp) { setGroupDetail(grp) } else { setDetailExp(e); setDetailExpEdit(false); setAttachShipSiblings([]); setError('') } }}
                                className="border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 transition-colors cursor-pointer">
                                <td className="px-4 py-3 text-xs text-[var(--warm-mid)] overflow-hidden"><span className="truncate block">{fmtDate(e.date)}</span></td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <p className="text-xs text-[var(--warm-dark)] truncate">{e.payMethod ?? '—'}</p>
                                  {e.financialAccount && <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">{accName(e.financialAccount)}</p>}
                                </td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    {e.recurringExpenseId && <span className="w-1.5 h-1.5 rounded-full bg-[var(--warning-fg)] shrink-0" title="고정지출" />}
                                    <span className="text-xs text-[var(--coral)] font-medium truncate">{e.category}</span>
                                    {e.recurringExpense?.isVariable && <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">변동</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate">{e.detail ?? '—'}</span>
                                    {grp && (item.groupKind === 'order'
                                      ? <span className="text-[0.5625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded shrink-0">주문 {grp.filter(r => !r.isShipping).length}품목</span>
                                      : <span className="text-[0.5625rem] text-[var(--warm-dark)] font-medium bg-[var(--honey)]/20 px-1.5 rounded shrink-0">방 {grp.length}개</span>)}
                                    {e.receiptUrl && <span className="text-[0.5625rem] text-[var(--coral)] shrink-0">영수증</span>}
                                  </div>
                                  {grp && (item.groupKind === 'order'
                                    ? <p className="text-[0.625rem] text-[var(--coral)] truncate mt-0.5">{e.order?.code ? `주문 ${e.order.code}` : '주문 묶음'}{grp.some(r => r.isShipping) ? ' · 배송비 포함' : ''}</p>
                                    : <p className="text-[0.625rem] text-[var(--coral)] truncate mt-0.5">{roomsLabel(grp)}</p>)}
                                  {item.groupKind !== 'order' && (() => { const c = orderChip(e); return c ? (
                                    <span title={c.title} className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded-md bg-[var(--honey)]/15 border border-[var(--honey)]/40 text-[0.5625rem] text-[var(--warm-dark)] font-medium max-w-full truncate">
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
                            )
                          }
                          // 미확인 고정 지출 행
                          const r = item.rec
                          // 예약 금액이 있으면 우선 prefill, 없으면 평균 또는 기본 금액
                      const expectedAmt = r.pendingAmount ?? r.historicalAvg ?? r.amount
                          return (
                            <tr key={`rec-${r.id}`}
                              onClick={() => { setRecordingRec(r); setRecRecItems(r.items.map(it => ({ name: it.name, amount: it.amount, isVariable: it.isVariable }))); setRecRecAmount(r.items.length > 0 ? r.items.reduce((s, it) => s + it.amount, 0) : expectedAmt); setRecRecDate(item.dateStr); setRecRecMemo(r.memo ?? ''); setRecRecPayMethod(r.lastPayMethod ?? r.payMethod ?? '계좌이체'); setRecRecAccId(r.lastFinancialAccountId ?? r.financialAccountId ?? ''); setRecError('') }}
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
                                    {r.isVariable && <span className="text-[0.625rem] text-[var(--warm-muted)] shrink-0">변동</span>}
                                  </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                                <span className="truncate block font-medium">{r.title}</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="text-sm font-semibold text-[var(--danger-fg)] truncate block">
                                  <MoneyDisplay amount={expectedAmt} prefix="-" />
                                </span>
                                {r.isVariable && <span className="text-[0.625rem] text-[var(--warm-muted)]">예상치</span>}
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="text-xs text-[var(--warning-fg)] font-medium">
                                  {r.isAutoDebit ? '자동이체' : '확인 필요'}
                                </span>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* 활성화 예정 항목 (하단) */}
                {pendingRecs.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <p className="text-xs font-semibold text-[var(--warm-muted)] px-1">활성화 예정 — 아직 내 부담이 아닌 항목</p>
                    <div className="sm:hidden space-y-2">
                      {pendingRecs.map(rec => (
                        <div key={rec.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 opacity-50">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-[var(--warm-muted)]">매월 {rec.dueDay}일</span>
                            <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--info-bg)] text-[var(--info-fg)] ring-1 ring-[var(--info-ring)] font-medium">{rec.activeSince?.slice(0, 7)} 활성화</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20">{rec.category}</span>
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
                                <span className="text-[0.625rem] font-semibold text-[var(--info-fg)] bg-[var(--info-bg)] px-2 py-1 rounded-lg">{rec.activeSince?.slice(0, 7)} 활성화</span>
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
          탭 2: 부가 수익
      ══════════════════════════════════════════════════════════ */}
      {tab === 'income' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <select value={incFilter.method} onChange={e => setIncFilter(f => ({ ...f, method: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-lg px-3 py-1.5 outline-none">
              <option value="all">입금수단 (전체)</option>
              {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={incFilter.category} onChange={e => setIncFilter(f => ({ ...f, category: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-lg px-3 py-1.5 outline-none">
              <option value="all">카테고리 (전체)</option>
              {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setIncFilter({ method: 'all', category: 'all' })}
              className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2">초기화</button>
            <span className="ml-auto text-sm font-bold text-[var(--success-fg)] num">
              합계: <MoneyDisplay amount={totalInc} />
            </span>
            <Btn variant="primary" size="md" onClick={() => { setShowAddInc(true); setAddIncMethod('계좌이체'); setAddIncAccId(''); setError('') }}>
              + 수익 등록
            </Btn>
          </div>

          {/* 부가 수익 목록 — 모바일 카드 */}
          {filteredIncomes.length === 0 ? (
            <div className="sm:hidden bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-10 text-center">
              <EmptyState label="부가 수익 내역이 없습니다" />
            </div>
          ) : (
            <div className="sm:hidden space-y-2">
              {filteredIncomes.map(i => (
                <div key={i.id}
                  onClick={() => { setDetailInc(i); setDetailIncEdit(false); setError('') }}
                  className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 cursor-pointer active:opacity-70 transition-opacity">
                  {/* 날짜 + 금액 */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[var(--warm-muted)]">{fmtDate(i.date)}</span>
                    <span className="text-sm font-bold text-[var(--success-fg)]"><MoneyDisplay amount={i.amount} prefix="+" alwaysFull /></span>
                  </div>
                  {/* 카테고리 + 입금수단 */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]">{i.category}</span>
                    {i.payMethod && (
                      <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-mid)]">{i.payMethod}</span>
                    )}
                    {i.financialAccount && (
                      <span className="text-[0.625rem] text-[var(--warm-muted)]">{accName(i.financialAccount)}</span>
                    )}
                  </div>
                  {/* 세부항목 · 메모 */}
                  {(i.detail || i.memo) && (
                    <p className="text-xs text-[var(--warm-dark)] truncate">
                      {[i.detail, i.memo].filter(Boolean).join(' · ')}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 부가 수익 목록 — 데스크탑 테이블 */}
          <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100vh-340px)]">
            {filteredIncomes.length === 0 ? (
              <EmptyState label="부가 수익 내역이 없습니다" />
            ) : (
              <table className="w-full" style={{
                tableLayout: 'fixed',
                minWidth: ['incDate','incMethod','incCategory','incDetail','incAmount'].reduce((s, k) => s + (finColWidths[k] ?? 100), 0),
              }}>
                <thead className="sticky top-0 z-10 bg-[var(--cream)]">
                  <tr className="border-b border-[var(--warm-border)]">
                    <ResizableTh label="날짜"     colKey="incDate" />
                    <ResizableTh label="입금수단" colKey="incMethod" />
                    <ResizableTh label="카테고리" colKey="incCategory" />
                    <ResizableTh label="세부 항목" colKey="incDetail" />
                    <ResizableTh label="금액"     colKey="incAmount" />
                  </tr>
                </thead>
                <tbody>
                  {filteredIncomes.map(i => (
                    <tr key={i.id}
                      onClick={() => { setDetailInc(i); setDetailIncEdit(false); setError('') }}
                      className="border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 transition-colors cursor-pointer">
                      <td className="px-4 py-3 text-xs text-[var(--warm-mid)] overflow-hidden">
                        <span className="truncate block">{fmtDate(i.date)}</span>
                      </td>
                      <td className="px-4 py-3 overflow-hidden">
                        <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] whitespace-nowrap">{i.payMethod ?? '—'}</span>
                        {i.financialAccount && (
                          <div className="text-xs text-[var(--warm-muted)] mt-0.5 truncate">{accName(i.financialAccount)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 overflow-hidden">
                        <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)] whitespace-nowrap">{i.category}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                        <span className="truncate block">{i.detail ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-[var(--success-fg)] overflow-hidden">
                        <span className="truncate block"><MoneyDisplay amount={i.amount} prefix="+" /></span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          탭 3: 카드 대금 정산
      ══════════════════════════════════════════════════════════ */}
      {tab === 'settle' && (
        <div className="space-y-4">
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">미정산 신용카드 대금 합산</h2>
            <p className="text-xs text-[var(--warm-muted)] mb-5">신용카드로 결제된 미정산 지출을 카드별로 합산합니다.</p>

            {settleGroups.length === 0 ? (
              <EmptyState label="미정산 건이 없습니다" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {settleGroups.map((g, idx) => (
                  <div key={idx} className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-5 flex flex-col gap-3">
                    {/* 카드명 */}
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--warm-dark)] text-base">{g.accountName}</span>
                      {g.payDayStr !== '미지정' && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)] font-medium">
                          결제일: {g.payDayStr}
                        </span>
                      )}
                    </div>

                    {/* 청구 정보 */}
                    <div className="text-xs text-[var(--warm-mid)] space-y-0.5">
                      <div>청구기간: {g.billingPeriodStr}</div>
                      {g.linkedAccountName && (
                        <div>출금계좌: <span className="text-[var(--warm-dark)]">{g.linkedAccountName}</span></div>
                      )}
                    </div>

                    {/* 청구 총액 */}
                    <div className="flex items-baseline justify-between border-b border-[var(--warm-border)] pb-3">
                      <span className="text-xs text-[var(--warm-mid)] font-medium">
                        {g.billMonth.replace('-', '년 ')}월 청구 총액
                      </span>
                      <span className="text-xl font-bold text-[var(--danger-fg)] num">
                        {g.total.toLocaleString()}원
                      </span>
                    </div>

                    {/* 지출 목록 */}
                    <div className="max-h-40 overflow-y-auto space-y-1.5">
                      {g.items.map(item => (
                        <div key={item.id} className="flex items-center justify-between text-xs gap-2">
                          <span className="text-[var(--warm-mid)] min-w-0 truncate">
                            {new Date(item.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                            &nbsp;
                            <span className="text-[var(--warm-muted)]">{item.category}</span>
                            {item.detail && <span className="text-[var(--warm-muted)]"> · {item.detail}</span>}
                          </span>
                          <span className="text-[var(--warm-dark)] font-medium num shrink-0">
                            {item.amount.toLocaleString()}원
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 정산 버튼 */}
                    {g.accountId && g.accountId !== 'unknown' ? (
                      <Btn
                        variant="primary" size="md" fullWidth
                        onClick={() => handleSettle(g.items.map(i => i.id), g.accountName, g.billMonth)}
                        disabled={isPending}>
                        출금 확인 (정산 완료 처리)
                      </Btn>
                    ) : (
                      <p className="text-xs text-[var(--warm-muted)] text-center">자산 등록 후 정산하세요</p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 정산 완료 내역 */}
          {settledGroups.length > 0 && (
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--warm-mid)]">정산 완료 내역 (최근 4개월)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {settledGroups.map(g => (
                  <div key={`${g.accountId}__${g.billMonth}`}
                    className="bg-[var(--canvas)]/60 border border-[var(--warm-border)] rounded-xl p-4 space-y-3 opacity-70">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[var(--warm-dark)]">{g.accountName}</span>
                        <span className="text-xs text-[var(--success-fg)] bg-[var(--success-bg)] px-2 py-0.5 rounded-full">정산완료</span>
                      </div>
                      <p className="text-xs text-[var(--warm-muted)] mt-0.5">{g.billingPeriodStr}</p>
                    </div>
                    <div className="space-y-1">
                      {g.items.map(item => (
                        <div key={item.id} className="flex justify-between text-xs text-[var(--warm-muted)]">
                          <span>{new Date(item.date).getMonth() + 1}. {new Date(item.date).getDate()}. {item.detail ?? item.category}</span>
                          <span>{item.amount.toLocaleString()}원</span>
                        </div>
                      ))}
                    </div>
                    <div className="flex items-center justify-between pt-1 border-t border-[var(--warm-border)]">
                      <span className="text-sm font-bold text-[var(--warm-dark)]">{g.total.toLocaleString()}원</span>
                      <button
                        onClick={async () => {
                          if (!(await confirmDialog({ title: `'${g.accountName}' ${g.billMonth} 청구분 정산을 전부 취소할까요?`, confirmLabel: '전체 취소' }))) return
                          startTransition(async () => {
                            await unsettleExpenses(g.items.map(i => i.id)); router.refresh()
                          })
                        }}
                        disabled={isPending}
                        className="text-xs text-[var(--warning-fg)] hover:text-[var(--warning-fg)] px-3 py-1.5 bg-[var(--warning-bg)] hover:bg-[var(--warning-bg)] rounded-lg transition-colors disabled:opacity-40">
                        전체 정산 취소
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}


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
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">
                    {assetType === 'BANK_ACCOUNT' ? '계좌번호' : '번호 (끝 4자리)'}
                  </label>
                  <input type="text" name="identifier"
                    defaultValue={editingAcc?.identifier ?? ''}
                    placeholder={assetType === 'BANK_ACCOUNT' ? '예: 110-123-456789' : '예: 1234'}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">소유주명</label>
                <input type="text" name="owner"
                  defaultValue={editingAcc?.owner ?? ''}
                  placeholder="예: 홍길동"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
                  {isPending ? '저장 중...' : (editingAcc ? '수정 저장' : '등록')}
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
              <EmptyState label="등록된 자산이 없습니다" />
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
                      <p className="px-5 pt-3 pb-1 text-[0.625rem] font-semibold uppercase tracking-wide text-[var(--warm-muted)]">{label}</p>
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
        <div className="fixed inset-0 bg-black/70 z-[var(--z-modal)] flex items-center justify-center p-4"
          onClick={() => setGroupDetail(null)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2 px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[var(--warm-dark)] truncate">{groupDetail[0]?.order?.code ? `주문 ${groupDetail[0].order.code}` : (groupDetail[0]?.detail || groupDetail[0]?.itemLabel || '묶음 지출')}</h3>
                <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">{groupDetail.length}건 · 합계 {groupDetail.reduce((s, r) => s + r.amount, 0).toLocaleString()}원</p>
              </div>
              <button onClick={() => setGroupDetail(null)} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none shrink-0">✕</button>
            </div>
            <ul className="overflow-y-auto px-4 py-3 space-y-1.5">
              {groupDetail.map(r => (
                <li key={r.id}>
                  <button type="button"
                    onClick={() => { setGroupDetail(null); setDetailExp(r); setDetailExpEdit(false); setAttachShipSiblings([]); setError('') }}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--canvas)] hover:bg-[var(--warm-border)]/30 transition-colors text-left">
                    <span className="text-sm text-[var(--warm-dark)] truncate">
                      {r.isShipping ? '배송비' : (r.room ? (/^\d+$/.test(r.room.roomNo) ? `${r.room.roomNo}호` : r.room.roomNo) : (r.detail || r.itemLabel || '방 미지정'))}
                      {r.qtyValue ? <span className="text-[var(--warm-muted)]"> · {r.qtyValue}{r.qtyUnit ?? ''}</span> : null}
                    </span>
                    <span className="text-sm font-semibold text-[var(--danger-fg)] shrink-0 tabular-nums">{r.amount.toLocaleString()}원</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="px-6 pb-4 text-[0.625rem] text-[var(--warm-muted)] shrink-0">각 방 항목을 누르면 개별 수정·삭제할 수 있습니다.</p>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 지출 상세 / 수정
      ══════════════════════════════════════════════════════════ */}
      {detailExp && (
        <div className="fixed inset-0 bg-black/70 z-[var(--z-modal)] flex items-center justify-center p-4"
          onClick={() => { setDetailExp(null); setDetailExpEdit(false) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">
                {detailExpEdit ? '지출 수정' : '지출 상세'}
              </h2>
              <button onClick={() => { setDetailExp(null); setDetailExpEdit(false) }}
                aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
            </div>

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
                              {it.isVariable && <span className="ml-1 text-[0.5625rem] text-[var(--warning-fg)]">(변동)</span>}
                            </span>
                            <span className="num text-[var(--warm-dark)]">{it.amount.toLocaleString()}원</span>
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
                        <span className="ml-1 text-[0.625rem] text-[var(--warm-muted)]">({detailExp.order.code})</span>
                      </span>
                    } />
                  )}
                  {detailExp.receiptUrl && (
                    <div className="pt-2">
                      <p className="text-xs text-[var(--warm-muted)] mb-1.5">영수증</p>
                      <a href={detailExp.receiptUrl} target="_blank" rel="noopener noreferrer">
                        <img src={detailExp.receiptUrl} className="rounded-xl border border-[var(--warm-border)] w-full max-h-48 object-contain" alt="영수증" />
                      </a>
                    </div>
                  )}
                  {/* 재고 계산 제외 상태 — 적용취소(다시 포함) 제공 */}
                  {detailExp.excludeFromInventory && !detailExp.isShipping && detailExp.itemLabel && (
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--warm-border)]/50">
                      <span className="text-[0.625rem] text-[var(--warm-muted)]">이 구매는 재고 계산에서 제외돼 있습니다.</span>
                      <button onClick={() => startTransition(async () => {
                        const r = await includeExpenseInInventory(detailExp.id)
                        if (!r.ok) { pushToast('error', r.error); return }
                        pushToast('success', '재고 계산에 다시 포함됨'); router.refresh()
                        setDetailExp({ ...detailExp, excludeFromInventory: false })
                      })} disabled={isPending}
                        className="shrink-0 px-2.5 py-1 text-[0.625rem] font-medium rounded-lg border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--canvas)] transition-colors disabled:opacity-40">
                        적용취소
                      </button>
                    </div>
                  )}
                  {/* 배송비(합배송 등) 관리는 [수정]에서 일괄 — 안내만 */}
                  {!detailExp.isShipping && (
                    <p className="pt-2 border-t border-[var(--warm-border)]/50 text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
                      배송비(이 금액에 합산 / 별도 지출로 묶기)는 아래 <strong>[수정]</strong> 에서 관리합니다.
                    </p>
                  )}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button onClick={() => handleDeleteExp(detailExp)} disabled={isPending}
                    className="px-4 py-2.5 bg-[var(--danger-bg)] hover:bg-[var(--danger-bg)] text-[var(--danger-fg)] text-sm rounded-xl transition-colors disabled:opacity-40">
                    {detailExp.recurringExpenseId ? '이번 달 기록 취소' : '삭제'}
                  </button>
                  {detailExp.settleStatus === 'SETTLED' && (detailExp.payMethod === '신용카드' || detailExp.payMethod === '체크카드') && (
                    <button onClick={() => handleUnsettle(detailExp.id)} disabled={isPending}
                      className="px-4 py-2.5 bg-[var(--warning-bg)] hover:bg-[var(--warning-bg)] text-[var(--warning-fg)] text-sm rounded-xl transition-colors disabled:opacity-40">
                      정산 취소
                    </button>
                  )}
                  <div className="flex-1" />
                  <Btn variant="primary" size="md" onClick={() => {
                    setDetailExpEdit(true)
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
                      // 수량 미입력 항목은 자동 1개로 (confirmAdd 와 동일 규칙) — 재저장 시 "x 1개" 일관 표기
                      qtyValue:  detailExp.qtyValue != null ? detailExp.qtyValue.toString() : '1',
                      qtyUnit:   detailExp.qtyValue != null ? (detailExp.qtyUnit ?? '') : (detailExp.qtyUnit ?? '개'),
                      amount:    baseAmount,
                      // 단가 복원 — (금액−배송비)÷수량(저장엔 단가 없음). 안 채우면 수정 시 단가 0 으로 보임.
                      unitPrice: Math.round(baseAmount / (Number(detailExp.qtyValue) || 1)),
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
              <form key={detailExp.id + '-edit'} onSubmit={handleUpdateExp} className="flex flex-col flex-1 overflow-hidden">
                <input type="hidden" name="id" value={detailExp.id} />
                <input type="hidden" name="financialAccountId" value={editExpAccId} />
                <input type="hidden" name="financeName" value={editExpAccName} />
                <input type="hidden" name="roomId" value={editItems.some(it => (it.allocations?.length ?? 0) > 0) ? '' : editExpRoomId} />
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                      <DatePicker name="date" value={editExpDate} onChange={setEditExpDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">
                        금액 *{editItems.length >= 1 && <span className="text-[0.625rem] text-[var(--warm-muted)] font-normal ml-1">(품목 합계 자동)</span>}
                        {editHasShipping && (editShipping ?? 0) > 0 && <span className="text-[0.625rem] text-[var(--warm-muted)] font-normal ml-1">(+배송비 포함)</span>}
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
                                {total.toLocaleString()}원
                                {ship > 0 && <span className="text-[0.625rem] text-[var(--warm-muted)] ml-1">(품목 {base.toLocaleString()} + 배송 {ship.toLocaleString()})</span>}
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
                    <select name="category" value={editExpCategory}
                      onChange={e => { setEditExpCategory(e.target.value); setEditItems([]) }}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">구매처</label>
                    <input type="text" name="vendor" defaultValue={detailExp.vendor ?? ''} placeholder="예: 쿠팡, 다이소" list="edit-exp-vendors"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                    <datalist id="edit-exp-vendors">{vendorSuggestions.map(v => <option key={v} value={v} />)}</datalist>
                  </div>
                  {(
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">품목 선택 <span className="text-[var(--warm-muted)] font-normal">(여러 품목 추가 가능)</span></label>
                      <ItemSelector
                        category={editExpCategory}
                        value={editItems}
                        onChange={setEditItems}
                        rooms={rooms}
                        detailSuggestions={detailSuggestions}
                      />
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
                        <p className="text-[0.625rem] text-[var(--warm-muted)] mt-1">품목 단가엔 미포함, 총액에만 더해집니다.</p>
                      </div>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-[var(--warm-dark)] cursor-pointer">
                      <input type="checkbox" checked={editShipSeparate}
                        onChange={e => { setEditShipSeparate(e.target.checked); if (e.target.checked) { setEditHasShipping(false); setEditShipping(undefined) } }}
                        className="w-3.5 h-3.5 accent-[var(--coral)]" />
                      <span><strong>별도 지출로 묶기 (합배송)</strong> · 배송비 1건 + 주문번호로 묶음</span>
                    </label>
                    {editShipSeparate && detailExp && (
                      <div className="pl-5 space-y-2">
                        <MoneyInput value={attachShipAmount} onChange={setAttachShipAmount} placeholder="배송비 0원" />
                        <div className="flex items-center gap-1.5">
                          {(['선불', '착불', '신용'] as const).map(t => (
                            <button key={t} type="button" onClick={() => setAttachShipType(t)}
                              className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${attachShipType === t ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'bg-white text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
                              {t}
                            </button>
                          ))}
                        </div>
                        <input type="text" value={attachShipMemo} onChange={e => setAttachShipMemo(e.target.value)}
                          placeholder="배송 메모 (선택)"
                          className="w-full bg-white border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-500 outline-none focus:border-[var(--coral)]" />
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
                              <p className="text-[0.625rem] font-medium text-[var(--warm-mid)]">같은 날 다른 지출도 함께 묶기 (선택)</p>
                              <div className="space-y-1 max-h-28 overflow-auto">
                                {sibs.map(s => (
                                  <label key={s.id} className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer px-1.5 py-1 rounded-md hover:bg-white">
                                    <input type="checkbox" checked={attachShipSiblings.includes(s.id)} onChange={() => toggle(s.id)}
                                      className="w-3.5 h-3.5 accent-[var(--coral)] shrink-0" />
                                    <span className="truncate flex-1">{[s.vendor, s.detail].filter(Boolean).join(' · ') || s.category}</span>
                                    <span className="text-[var(--warm-muted)] shrink-0">{s.amount.toLocaleString()}원</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )
                        })()}
                        <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">저장하면 배송비가 별도 지출로 기록되고 같은 주문번호로 묶입니다. 신용(후불)은 미정산. 체크를 해제하고 저장하면 묶음이 해제됩니다.</p>
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
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                    }
                    {/* 제출 detail = 표시 내용 + 배송비 표기(있으면) */}
                    <input type="hidden" name="detail" value={`${editItems.length > 0 ? fmtItemListDetail(editItems) : editExpDetail}${editHasShipping && (editShipping ?? 0) > 0 ? `${(editItems.length > 0 || editExpDetail) ? ' · ' : ''}배송비 ${(editShipping ?? 0).toLocaleString()}원` : ''}`} />
                    {editItems.length > 0 && <>
                      <input type="hidden" name="itemsJson" value={JSON.stringify(editItems)} />
                      {editItems.length === 1 && (
                        <>
                          <input type="hidden" name="itemLabel" value={editItems[0].label} />
                          <input type="hidden" name="specValue" value={editItems[0].specValue} />
                          <input type="hidden" name="specUnit"  value={editItems[0].specUnit} />
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
                    editItems.some(it => (it.allocations?.length ?? 0) > 0) ? (
                      <p className="text-[0.6875rem] text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">대상 호실은 품목별 <strong className="text-[var(--warm-mid)]">'방별로 나누기'</strong>로 지정됩니다.</p>
                    ) : (
                      <div className="space-y-1.5">
                        <label className="text-xs font-medium text-[var(--warm-mid)]">대상 호실 (선택)</label>
                        <select value={editExpRoomId} onChange={e => setEditExpRoomId(e.target.value)}
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                          <option value="">선택 안함</option>
                          {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                        </select>
                      </div>
                    )
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailExp.memo ?? ''} placeholder="메모 (선택)"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
                          className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs leading-none">✕</button>
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
                    {isPending ? '저장 중...' : '저장'}
                  </Btn>
                </div>
              </form>
            )}
          </div>
        </div>
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
      {detailInc && (
        <div className="fixed inset-0 bg-black/70 z-[var(--z-modal)] flex items-center justify-center p-4"
          onClick={() => { setDetailInc(null); setDetailIncEdit(false) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">
                {detailIncEdit ? '수익 수정' : '수익 상세'}
              </h2>
              <button onClick={() => { setDetailInc(null); setDetailIncEdit(false) }}
                aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
            </div>

            {!detailIncEdit ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  <DetailRow label="날짜"      value={fmtDate(detailInc.date)} />
                  <DetailRow label="카테고리"  value={detailInc.category} />
                  <DetailRow label="세부 항목" value={detailInc.detail ?? '—'} />
                  <DetailRow label="금액"      value={<span className="text-[var(--success-fg)] font-semibold"><MoneyDisplay amount={detailInc.amount} prefix="+" /></span>} />
                  <DetailRow label="입금수단"  value={detailInc.payMethod ?? '—'} />
                  {detailInc.financialAccount && <DetailRow label="금융사" value={accName(detailInc.financialAccount)} />}
                  {detailInc.memo && <DetailRow label="메모" value={detailInc.memo} />}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button onClick={() => handleDeleteInc(detailInc.id)} disabled={isPending}
                    className="px-4 py-2.5 bg-[var(--danger-bg)] hover:bg-[var(--danger-bg)] text-[var(--danger-fg)] text-sm rounded-xl transition-colors disabled:opacity-40">삭제</button>
                  <div className="flex-1" />
                  <Btn variant="primary" size="md" onClick={() => {
                    setDetailIncEdit(true)
                    setEditIncDate(toDateInput(detailInc.date))
                    setEditIncMethod(detailInc.payMethod ?? '계좌이체')
                    setEditIncAccId(detailInc.financialAccountId ?? '')
                    setError('')
                  }}>수정</Btn>
                </div>
              </>
            ) : (
              <form key={detailInc.id + '-edit'} onSubmit={handleUpdateInc} className="flex flex-col flex-1 overflow-hidden">
                <input type="hidden" name="id" value={detailInc.id} />
                <input type="hidden" name="financialAccountId" value={editIncAccId} />
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                      <DatePicker name="date" value={editIncDate} onChange={setEditIncDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                      <MoneyInput name="amount" defaultValue={detailInc.amount} placeholder="0원" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                    <select name="category" defaultValue={detailInc.category}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                    <input type="text" name="detail" defaultValue={detailInc.detail ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">입금수단</label>
                    <select name="payMethod" value={editIncMethod}
                      onChange={e => { setEditIncMethod(e.target.value); setEditIncAccId('') }}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailInc.memo ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setDetailIncEdit(false); setError('') }}>취소</Btn>
                  <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                    {isPending ? '저장 중...' : '저장'}
                  </Btn>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 지출 등록
      ══════════════════════════════════════════════════════════ */}
      {showAddExp && (
        <div className="fixed inset-0 bg-black/70 z-[var(--z-modal)] flex items-center justify-center p-4"
          onClick={() => setShowAddExp(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">지출 등록</h2>
              <button onClick={() => setShowAddExp(false)} aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
            </div>
            <form onSubmit={handleAddExp} className="flex flex-col flex-1 overflow-hidden">
              <input type="hidden" name="financialAccountId" value={addExpAccId} />
              <input type="hidden" name="financeName" value={addExpAccName} />
              <input type="hidden" name="roomId" value={addItems.some(it => (it.allocations?.length ?? 0) > 0) ? '' : addExpRoomId} />
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <DatePicker name="date" value={addExpDate} onChange={setAddExpDate}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">
                      금액 *{addItems.length >= 1 && <span className="text-[0.625rem] text-[var(--warm-muted)] font-normal ml-1">(품목 합계 자동)</span>}
                      {addHasShipping && (addShipping ?? 0) > 0 && <span className="text-[0.625rem] text-[var(--warm-muted)] font-normal ml-1">(+배송비 포함)</span>}
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
                              {total.toLocaleString()}원
                              {ship > 0 && <span className="text-[0.625rem] text-[var(--warm-muted)] ml-1">(품목 {base.toLocaleString()} + 배송 {ship.toLocaleString()})</span>}
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
                      className={`flex-1 px-3 py-2 transition-colors ${!addIsService ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>물품 구매</button>
                    <button type="button" onClick={() => { setAddIsService(true); setAddItems([]); setAddHasShipping(false); setAddShipping(undefined); setAddOrderMode(false); setAddOrderShipping(undefined) }}
                      className={`flex-1 px-3 py-2 transition-colors ${addIsService ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}>서비스·무형</button>
                  </div>
                  <p className="text-[0.625rem] text-[var(--warm-muted)]">
                    {addIsService ? '시공비·인건비·공과금 등 — 품목 없이 금액만. 재고/비품에 안 잡힙니다.' : '실물 구매 — 품목을 입력해야 재고/비품에 잡힙니다.'}
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                  <select name="category" value={addExpCategory}
                    onChange={e => setAddExpCategory(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">구매처</label>
                  <input type="text" name="vendor" value={addExpVendor} onChange={e => setAddExpVendor(e.target.value)} placeholder="예: 쿠팡, 다이소" list="add-exp-vendors"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  <datalist id="add-exp-vendors">{vendorSuggestions.map(v => <option key={v} value={v} />)}</datalist>
                </div>
                {!addIsService && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">품목 선택 * <span className="text-[var(--warm-muted)] font-normal">(여러 품목 추가 가능)</span></label>
                    <ItemSelector category={addExpCategory} value={addItems} onChange={setAddItems} rooms={rooms} detailSuggestions={detailSuggestions} />
                  </div>
                )}
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
                      <p className="text-[0.625rem] text-[var(--warm-muted)] mt-1">품목 단가엔 미포함, 총액에만 더해집니다.</p>
                    </div>
                  )}
                  <label className="flex items-center gap-1.5 text-xs text-[var(--warm-dark)] cursor-pointer">
                    <input type="checkbox" checked={addOrderMode}
                      onChange={e => { setAddOrderMode(e.target.checked); if (e.target.checked) { setAddHasShipping(false); setAddShipping(undefined) } else setAddOrderShipping(undefined) }}
                      className="w-3.5 h-3.5 accent-[var(--coral)]" />
                    <span><strong>별도 지출로 묶기 (합배송)</strong> · 배송비 1건 + 주문번호로 묶음</span>
                  </label>
                  {addOrderMode && (
                    <div className="pl-5 space-y-2">
                      <MoneyInput value={addOrderShipping} onChange={setAddOrderShipping} placeholder="배송비 0원" />
                      <div className="flex items-center gap-1.5">
                        {(['선불', '착불', '신용'] as const).map(t => (
                          <button key={t} type="button" onClick={() => setAddOrderShipType(t)}
                            className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-lg border transition-colors ${addOrderShipType === t ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'bg-white text-[var(--warm-dark)] border-[var(--warm-border)]'}`}>
                            {t}
                          </button>
                        ))}
                      </div>
                      <input type="text" value={addOrderShipMemo} onChange={e => setAddOrderShipMemo(e.target.value)}
                        placeholder="배송 메모 (선택)"
                        className="w-full bg-white border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-500 outline-none focus:border-[var(--coral)]" />
                      <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">배송비가 별도 지출로 기록되고 품목들과 같은 주문번호로 묶입니다. 신용(후불)은 미정산.</p>
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
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  }
                  {/* 제출 detail = 표시 내용 + 배송비 표기(있으면) */}
                  <input type="hidden" name="detail" value={`${addItems.length > 0 ? fmtItemListDetail(addItems) : addExpDetail}${addHasShipping && (addShipping ?? 0) > 0 ? `${(addItems.length > 0 || addExpDetail) ? ' · ' : ''}배송비 ${(addShipping ?? 0).toLocaleString()}원` : ''}`} />
                  {addItems.length > 0 && <>
                    <input type="hidden" name="itemsJson" value={JSON.stringify(addItems)} />
                    {addItems.length === 1 && (
                      <>
                        <input type="hidden" name="itemLabel" value={addItems[0].label} />
                        <input type="hidden" name="specValue" value={addItems[0].specValue} />
                        <input type="hidden" name="specUnit"  value={addItems[0].specUnit} />
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
                  addItems.some(it => (it.allocations?.length ?? 0) > 0) ? (
                    <p className="text-[0.6875rem] text-[var(--warm-muted)] bg-[var(--canvas)] border border-[var(--warm-border)]/60 rounded-lg px-3 py-2">대상 호실은 품목별 <strong className="text-[var(--warm-mid)]">'방별로 나누기'</strong>로 지정됩니다.</p>
                  ) : (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">대상 호실 (선택)</label>
                      <select value={addExpRoomId} onChange={e => setAddExpRoomId(e.target.value)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                      </select>
                    </div>
                  )
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">영수증</label>
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
                      {scanOcrError && <p className="text-[0.625rem] text-[var(--danger-fg)]">{scanOcrError}</p>}
                    </div>
                  ) : addReceiptUrl ? (
                    <div className="relative">
                      <img src={addReceiptUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증" />
                      <button type="button" onClick={() => setAddReceiptUrl('')}
                        className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs leading-none">✕</button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center w-full bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-sm px-3 py-2.5 cursor-pointer hover:border-[var(--coral)] transition-colors">
                      <span className="text-xs text-[var(--warm-muted)]">{receiptUploading ? '업로드 중…' : '영수증 첨부 · 자동 입력'}</span>
                      <input type="file" accept="image/*,application/pdf" className="hidden" disabled={receiptUploading}
                        onChange={async e => { const f = e.target.files?.[0]; if (f) { await handleOpenScan(f, 'add'); e.target.value = '' } }} />
                    </label>
                  )}
                </div>
                {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => setShowAddExp(false)}>취소</Btn>
                <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                  {isPending ? '저장 중...' : '저장'}
                </Btn>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 수익 등록
      ══════════════════════════════════════════════════════════ */}
      {showAddInc && (
        <div className="fixed inset-0 bg-black/70 z-[var(--z-modal)] flex items-center justify-center p-4"
          onClick={() => setShowAddInc(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">부가 수익 등록</h2>
              <button onClick={() => setShowAddInc(false)} aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
            </div>
            <form onSubmit={handleAddInc} className="flex flex-col flex-1 overflow-hidden">
              <input type="hidden" name="financialAccountId" value={addIncAccId} />
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <DatePicker name="date" value={addIncDate} onChange={setAddIncDate}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                    <MoneyInput name="amount" placeholder="0원" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                  <select name="category"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                  <input type="text" name="detail" placeholder="세부 내용"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">입금수단</label>
                  <select name="payMethod" value={addIncMethod}
                    onChange={e => { setAddIncMethod(e.target.value); setAddIncAccId('') }}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <button type="button" onClick={() => setShowAddInc(false)}
                  className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">취소</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-[var(--success-solid)] hover:opacity-90 text-[var(--cream)] text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                  {isPending ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>

    {showVendorMgmt && <VendorManageModal onClose={() => setShowVendorMgmt(false)} onChanged={() => router.refresh()} />}

    {/* ── 고정 지출 관리 모달 ────────────────────────────────────── */}

    {showRecMgmt && (
      <div className="fixed inset-0 z-[var(--z-modal)] flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) { setShowRecMgmt(false); setShowRecMgmtForm(false) } }}>
        <div className="bg-[var(--cream)] rounded-2xl w-full max-w-lg max-h-[90dvh] flex flex-col shadow-lift border border-[var(--warm-border)]">
          {/* 모달 헤더 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
            <div>
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">고정 지출 관리</h2>
              <p className="text-xs text-[var(--warm-muted)] mt-0.5">매월 반복 지출 항목을 추가·수정·삭제합니다.</p>
            </div>
            <button onClick={() => { setShowRecMgmt(false); setShowRecMgmtForm(false) }}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none px-1">×</button>
          </div>

          <div className="overflow-y-auto flex-1 p-5 space-y-4">
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
                  <p className="text-[0.625rem] text-[var(--warm-muted)]">자동이체 항목은 주말·공휴일이면 다음 영업일 기준으로 알림이 계산됩니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">활성화 시작일 (선택)</label>
                  <DatePicker value={recMgmtForm.activeSince} onChange={v => setRecMgmtForm(p => ({ ...p, activeSince: v }))}
                    className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
                  <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
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
                      <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">전기·수도 등 매달 달라지는 항목</p>
                    </div>
                  </label>
                </div>
                {recMgmtForm.isVariable && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">전년동월 실적 (선택)</label>
                    <MoneyInput value={Number(recMgmtForm.priorYearAmount) || 0} onChange={v => setRecMgmtForm(p => ({ ...p, priorYearAmount: v > 0 ? String(v) : '' }))} placeholder="0원" />
                    <p className="text-[0.625rem] text-[var(--warm-muted)]">작년 같은 달 실제 납부액 — 최근 3개월 평균과 함께 예상치 계산에 반영됩니다.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모 (선택)</label>
                  <input type="text" value={recMgmtForm.memo} onChange={e => setRecMgmtForm(p => ({ ...p, memo: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                {recMgmtError && <p className="text-[var(--danger-fg)] text-xs">{recMgmtError}</p>}
                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setShowRecMgmtForm(false); setEditingRecMgmt(null); setRecMgmtError('') }}
                    className="flex-1 py-2 text-sm rounded-xl border border-[var(--warm-border)] text-[var(--warm-mid)]">취소</button>
                  <button onClick={handleSaveRecMgmt} disabled={recMgmtPending || !recMgmtForm.title.trim() || !recMgmtForm.amount}
                    className="flex-1 py-2 text-sm font-medium rounded-xl text-white disabled:opacity-50"
                    style={{ background: 'var(--coral)' }}>
                    {recMgmtPending ? '저장 중…' : '저장'}
                  </button>
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
                <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
                  선택 항목은 이 묶음의 세부항목으로 전환되고(각 변동/고정 유지), 원본은 비활성됩니다(과거 기록 보존).
                </p>
                <div className="flex gap-2">
                  <button onClick={() => { setRecGroupMode(false); setRecGroupSel(new Set()); setRecMgmtError('') }}
                    className="flex-1 py-2 text-sm rounded-xl border border-[var(--warm-border)] text-[var(--warm-mid)]">취소</button>
                  <button onClick={handleGroupRec} disabled={recMgmtPending || recGroupSel.size < 2}
                    className="flex-1 py-2 text-sm font-medium rounded-xl text-white disabled:opacity-50" style={{ background: 'var(--coral)' }}>
                    {recMgmtPending ? '묶는 중…' : `${recGroupSel.size}개 묶기`}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <button onClick={openNewRecMgmt}
                  className="flex-1 py-2.5 text-sm font-medium rounded-xl border border-dashed border-[var(--coral)] text-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">
                  + 새 항목 추가
                </button>
                <button onClick={() => { setRecGroupMode(true); setRecMgmtError('') }}
                  className="px-4 py-2.5 text-sm font-medium rounded-xl border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                  🔗 묶기
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
                        {isParent && <span className="text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--coral)]/15 text-[var(--coral)]">묶음 {r.items.length}</span>}
                        {r.isAutoDebit && <span className="text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--info-bg)] text-[var(--info-fg)]">자동이체</span>}
                        {!r.isActive && <span className="text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--neutral-bg)] text-[var(--neutral-fg)]">비활성</span>}
                        {r.activeSince && <span className="text-[0.5625rem] font-semibold px-1.5 py-0.5 rounded-full bg-[var(--warning-bg)] text-[var(--warning-fg)]">{r.activeSince.slice(0, 7)}부터</span>}
                      </div>
                      <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                        매월 {r.dueDay}일 · {r.amount.toLocaleString()}원 · {r.category}
                        {r.payMethod && <> · {r.payMethod}</>}
                        {r.financialAccountName && <> ({r.financialAccountName})</>}
                      </p>
                      {isParent && (
                        <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5 truncate">
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
        </div>
      </div>
    )}
    {/* ── 고정 지출 기록 모달 ────────────────────────────────────────── */}
    {recordingRec && (
      <div
        className="fixed inset-0 z-[var(--z-modal)] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget) { setRecordingRec(null); setRecError('') } }}>
        <div className="bg-[var(--cream)] rounded-2xl w-full max-w-sm shadow-lift border border-[var(--warm-border)]">
          {/* 헤더 */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
            <div>
              <h2 className="text-sm font-semibold text-[var(--warm-dark)]">지출 기록</h2>
              <p className="text-xs text-[var(--warm-muted)] mt-0.5">{recordingRec.title}</p>
            </div>
            <button onClick={() => { setRecordingRec(null); setRecError('') }}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none transition-colors">✕</button>
          </div>
          {/* 폼 */}
          <div className="p-5 space-y-3">
            {recRecItems.length > 0 ? (
              <>
                <div className="space-y-1">
                  <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                  <DatePicker value={recRecDate} onChange={setRecRecDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
                </div>
                {/* #1 관리비 세부항목 — 변동 항목만 편집, 고정은 표시. 합계 자동. */}
                <div className="space-y-1.5 rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)] p-3">
                  <p className="text-[0.6875rem] font-medium text-[var(--warm-muted)]">세부항목 ({recRecItems.length})</p>
                  {recRecItems.map((it, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="text-xs text-[var(--warm-dark)] flex-1 truncate">
                        {it.name}
                        {it.isVariable
                          ? <span className="ml-1 text-[0.5625rem] text-[var(--warning-fg)] bg-[var(--warning-bg)] px-1 py-0.5 rounded-full">변동</span>
                          : <span className="ml-1 text-[0.5625rem] text-[var(--warm-muted)]">고정</span>}
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
                        <span className="text-xs num text-[var(--warm-dark)] w-28 text-right pr-1">{it.amount.toLocaleString()}원</span>
                      )}
                    </div>
                  ))}
                  <div className="flex items-center justify-between border-t border-[var(--warm-border)] pt-1.5 mt-1">
                    <span className="text-xs font-semibold text-[var(--warm-dark)]">합계</span>
                    <span className="text-sm font-bold num text-[var(--coral)]">{recRecAmount.toLocaleString()}원</span>
                  </div>
                </div>
              </>
            ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                <DatePicker value={recRecDate} onChange={setRecRecDate}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">
                  금액
                  {recordingRec.historicalAvg && (
                    <span className="ml-1 text-[var(--info-fg)] text-[0.625rem]">평균 {recordingRec.historicalAvg.toLocaleString()}원</span>
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
              <p className="text-[0.625rem] text-[var(--warm-muted)] -mt-1">
                예약된 금액 {recordingRec.pendingAmount.toLocaleString()}원이 자동 입력되었습니다.
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
                  {isPending ? '기록 중...' : '지출로 기록 (정산 완료)'}
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
                className="w-full px-4 py-2.5 bg-[var(--canvas)] border border-dashed border-[var(--coral)]/50 text-[var(--coral)] text-xs font-medium rounded-xl hover:bg-[var(--coral)]/5 disabled:opacity-60 transition-colors">
                💾 금액만 저장 (정산 안 함 · 나중에 납부)
              </button>
              <p className="text-[0.625rem] text-[var(--warm-muted)] text-center leading-relaxed">
                ‘지출로 기록’은 바로 정산 처리돼요. 금액만 미리 적어둘 땐 아래 버튼을 쓰세요.
              </p>
            </div>
          </div>
        </div>
      </div>
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
    if (!(await confirmDialog({ title: `${name} 보증금을 '받음(실수납)'으로 기록할까요?`, message: `계약상 금액(${amount.toLocaleString()}원)으로 입금 기록이 생성됩니다.`, confirmLabel: '기록' }))) return
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
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              sub === k ? 'bg-[var(--coral)] text-white'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'
            }`}>
            {k === 'tenant' ? `입주자별 (${summary.length})` : `거래 이력 (${ledger.length})`}
          </button>
        ))}
      </div>

      {sub === 'tenant' && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden">
          {summary.length === 0 ? (
            <EmptyState label="보증금 거래 이력이 있는 입주자가 없습니다." />
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/50">
              {summary.map(d => (
                <li key={d.leaseTermId} className="px-5 py-3 flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="text-sm font-semibold text-[var(--warm-dark)]">{d.tenantName}</span>
                      {d.roomNo && <span className="text-xs text-[var(--warm-muted)]">· {d.roomNo}호</span>}
                      <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        {DEPOSIT_STATUS_LABEL[d.status] ?? d.status}
                      </span>
                      {d.hasNoInRecord && (
                        <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]">
                          입금 거래 기록 없음
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--warm-muted)]">
                      {d.hasNoInRecord
                        ? `계약상 보증금 ${d.contractDeposit.toLocaleString()}원`
                        : `입금 ${d.totalIn.toLocaleString()}원`}
                      {d.totalReturned > 0 && ` · 반환 ${d.totalReturned.toLocaleString()}원`}
                      {d.totalWithheld > 0 && ` · 미반환 ${d.totalWithheld.toLocaleString()}원`}
                      {!d.hasNoInRecord && d.contractDeposit !== d.totalIn && (
                        <span className="ml-1 text-[var(--warning-fg)]">(계약 {d.contractDeposit.toLocaleString()}원)</span>
                      )}
                      {d.status === 'CHECKED_OUT' && d.balance === 0 && (d.totalReturned + d.totalWithheld === 0) && (
                        <span className="ml-1 text-[var(--warm-muted)]">· 퇴실 정리됨</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-bold" style={{ color: d.balance > 0 ? 'var(--deposit-fg)' : 'var(--warm-muted)' }}>
                      {d.balance.toLocaleString()}원
                    </p>
                    <p className="text-[0.625rem] text-[var(--warm-muted)]">현재 잔고</p>
                    {d.hasNoInRecord && d.status !== 'CHECKED_OUT' && d.contractDeposit > 0 && (
                      <button onClick={() => handleRecordReceived(d.leaseTermId, d.tenantName, d.contractDeposit)} disabled={recPending}
                        className="mt-1.5 text-[0.625rem] font-medium px-2 py-1 rounded-lg ring-1 ring-[var(--success-ring)] text-[var(--success-fg)] hover:bg-[var(--success-bg)] disabled:opacity-50 whitespace-nowrap">
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
            <EmptyState label="보증금 거래 이력이 없습니다." />
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
                        반환 {(e.returnedAmount ?? 0).toLocaleString()}원
                        {(e.withheldAmount ?? 0) > 0 && ` · 미반환 ${(e.withheldAmount ?? 0).toLocaleString()}원`}
                        {e.reason && ` · 사유: ${e.reason}`}
                      </p>
                    )}
                    {e.memo && <p className="text-xs text-[var(--warm-muted)] truncate">메모: {e.memo}</p>}
                  </div>
                  <div className="text-right shrink-0">
                    <p className={`text-sm font-semibold ${e.type === 'IN' ? 'text-[var(--success-fg)]' : 'text-[var(--warning-fg)]'}`}>
                      {e.type === 'IN' ? '+' : '−'}{e.amount.toLocaleString()}원
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
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
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
    t === 'DEPOSIT' ? '적립' : t === 'WITHDRAW_DIRECT' ? '직접 인출' : '사후 정산'
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
            <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">예비비로 적립된 금액</p>
          </div>
        </div>
      </div>

      {/* 액션 버튼 */}
      {!mode && (
        <div className="grid grid-cols-3 gap-2">
          <button onClick={() => setMode('deposit')}
            className="px-3 py-3 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl text-sm text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            적립
          </button>
          <button onClick={() => setMode('withdraw')}
            className="px-3 py-3 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl text-sm text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            예비비에서 지출
          </button>
          <button onClick={() => setMode('settle')}
            className="px-3 py-3 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl text-sm text-[var(--warm-dark)] hover:border-[var(--coral)] transition-colors">
            지출을 예비비로 정산
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
              {mode === 'settle' && '기존 지출을 예비비로 정산'}
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
                      {e.detail ? ` · ${e.detail}` : ''} · {e.remaining.toLocaleString()}원 남음
                    </option>
                  ))}
                </select>
                <p className="text-[0.625rem] text-[var(--warm-muted)]">선택 후 금액 비우면 잔여 전액, 입력하면 부분 정산</p>
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
              {pending ? '저장 중...' : '저장'}
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
          <EmptyState label="이번 달 예비비 거래 없음" />
        ) : (
          <ul className="divide-y divide-[var(--warm-border)]/50">
            {txns.map(t => (
              <li key={t.id} className="px-5 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                    <span className={`text-xs font-semibold ${typeColor(t.type)}`}>{typeLabel(t.type)}</span>
                    <span className="text-xs text-[var(--warm-muted)]">{new Date(t.date).toISOString().slice(0, 10)}</span>
                    {t.type === 'DEPOSIT' && t.sourceMonth && (
                      <span className="text-[0.625rem] px-1.5 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
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
                      ↪ 원 지출: {t.expense.category}{t.expense.detail ? ` · ${t.expense.detail}` : ''} ({t.expense.amount.toLocaleString()}원)
                    </p>
                  )}
                  {t.memo && <p className="text-xs text-[var(--warm-muted)] truncate">메모: {t.memo}</p>}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={`text-sm font-semibold ${typeColor(t.type)}`}>
                    {t.type === 'DEPOSIT' ? '+' : '−'}{t.amount.toLocaleString()}원
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

function EmptyState({ label }: { label: string }) {
  return <div className="p-12 text-center"><p className="text-[var(--warm-muted)] text-sm">{label}</p></div>
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0 gap-4">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}
