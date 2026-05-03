'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import {
  addExpense, updateExpense, deleteExpense,
  addExtraIncome, updateExtraIncome, deleteExtraIncome,
  settleCardExpenses, unsettleExpenses,
  saveFinancialAccount, deleteFinancialAccount, deactivateFinancialAccount,
  recordRecurringExpense, uploadExpenseReceipt, getLastItemUnits,
  analyzeReceiptWithGemini,
  type RecurringExpenseWithStatus,
} from './actions'
import {
  getRecurringExpenses, addRecurringExpense, updateRecurringExpense, deleteRecurringExpense,
  type RecurringExpenseRow,
} from '@/app/(app)/settings/actions'
import { useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Btn } from '@/components/ui/Btn'
import { chartColor } from '@/lib/chartColors'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'

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
  itemLabel: string | null
  specValue: number | null; specUnit: string | null
  qtyValue: number | null; qtyUnit: string | null
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
  '소모품비': ['물티슈', '키친타월', '주방세제', '세탁세제', '화장실 휴지'],
  '폐기물 처리비': ['종량제쓰레기봉투', '재활용품수거봉투', '음식물쓰레기봉투', '음식물쓰레기 배출 스티커'],
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
  '키친타월':   { specUnit: '매',  qtyUnit: '롤' },
  '주방세제':   { specUnit: 'ml',  qtyUnit: '개' },
  '세탁세제':   { specUnit: 'ml',  qtyUnit: '개' },
  '화장실 휴지':{ specUnit: 'm',   qtyUnit: '롤' },
  '종량제쓰레기봉투':         { specUnit: 'L', qtyUnit: '매' },
  '재활용품수거봉투':         { specUnit: 'L', qtyUnit: '매' },
  '음식물쓰레기봉투':         { specUnit: 'L', qtyUnit: '매' },
  '음식물쓰레기 배출 스티커': { specUnit: 'L', qtyUnit: '매' },
}

export type ItemPickState = {
  label: string
  specValue: string; specUnit: string
  qtyValue: string; qtyUnit: string
  amount?: number   // 다중 품목 입력 시: 이 품목에 할당된 금액 (단일 품목일 때는 미사용)
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
          className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
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
      className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
    >
      <option value="">{placeholder ?? '단위'}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
      <option value="__custom__">기타(직접 입력)</option>
    </select>
  )
}

function ItemSelector({ category, value, onChange, allowMulti = true }: {
  category: string
  value: ItemPickState[]
  onChange: (data: ItemPickState[]) => void
  allowMulti?: boolean
}) {
  const presets = ITEM_PRESETS[category]
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

  // category 변경 시 active picker 입력만 초기화 (items는 부모가 관리)
  useEffect(() => {
    setActiveLabel(null)
    setSpecValue(''); setSpecUnit(''); setQtyValue(''); setQtyUnit('')
    setAmountStr(''); setCustomLabel(''); setPrevUnits(null)
  }, [category])

  if (!presets) return null

  const numCls  = 'w-16 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const amtCls  = 'flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'
  const textCls = 'w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  async function openPreset(label: string) {
    setActiveLabel(label)
    setSpecValue(''); setQtyValue(''); setAmountStr('')
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
    const data: ItemPickState = { label, specValue, specUnit, qtyValue, qtyUnit, amount }
    onChange([...items, data])
    setActiveLabel(null)
    setSpecValue(''); setQtyValue(''); setAmountStr(''); setCustomLabel('')
  }

  function removeItem(idx: number) {
    onChange(items.filter((_, i) => i !== idx))
  }

  function updateItemAmount(idx: number, raw: string) {
    const amount = raw ? Number(raw.replace(/[^0-9]/g, '')) : undefined
    onChange(items.map((it, i) => i === idx ? { ...it, amount } : it))
  }

  const totalItemAmount = items.reduce((s, it) => s + (it.amount ?? 0), 0)

  const SpecQtyInputs = () => (
    <div className="space-y-2">
      {prevUnits && (prevUnits.specUnit || prevUnits.qtyUnit) && (
        <p className="text-[10px] text-[var(--warm-muted)]">
          직전 사용:{' '}
          {prevUnits.specUnit && <span className="text-[var(--warm-mid)]">규격 {prevUnits.specUnit}</span>}
          {prevUnits.specUnit && prevUnits.qtyUnit && <span className="mx-1">·</span>}
          {prevUnits.qtyUnit && <span className="text-[var(--warm-mid)]">수량 {prevUnits.qtyUnit}</span>}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--warm-muted)]">규격</label>
          <div className="flex gap-1">
            <input type="text" inputMode="decimal" placeholder="0" value={specValue}
              onChange={e => setSpecValue(e.target.value.replace(/[^0-9.]/g, ''))} className={numCls} />
            <UnitCombobox value={specUnit} onChange={setSpecUnit}
              options={SPEC_UNITS} placeholder="단위" />
          </div>
        </div>
        <div className="space-y-1">
          <label className="text-[10px] text-[var(--warm-muted)]">수량</label>
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
          <label className="text-[10px] text-[var(--warm-muted)]">금액 <span className="text-[var(--warm-muted)]">(이 품목 분)</span></label>
          <div className="flex gap-1 items-center">
            <input type="text" inputMode="numeric"
              value={amountStr ? Number(amountStr.replace(/[^0-9]/g, '')).toLocaleString() : ''}
              onChange={e => setAmountStr(e.target.value.replace(/[^0-9]/g, ''))}
              placeholder="0"
              className={amtCls} />
            <span className="text-[10px] text-[var(--warm-muted)] shrink-0">원</span>
          </div>
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-2">
      {/* 등록된 품목 칩 리스트 */}
      {items.length > 0 && (
        <div className="space-y-1.5">
          {items.map((it, idx) => (
            <div key={idx} className="flex items-center gap-2 px-2.5 py-1.5 bg-[var(--coral-pale)] text-[var(--coral)] rounded-xl ring-1 ring-[var(--coral)]/20">
              <span className="text-xs flex-1 min-w-0 truncate">{fmtItemDetail(it)}</span>
              {allowMulti && (
                <div className="flex items-center gap-1 shrink-0">
                  <input
                    type="text" inputMode="numeric"
                    value={it.amount ? it.amount.toLocaleString() : ''}
                    onChange={e => updateItemAmount(idx, e.target.value)}
                    placeholder="금액"
                    className="w-20 bg-[var(--cream)] border border-[var(--coral)]/30 rounded-md px-1.5 py-0.5 text-xs text-[var(--warm-dark)] text-right outline-none focus:border-[var(--coral)]"
                  />
                  <span className="text-[10px]">원</span>
                </div>
              )}
              <button type="button" onClick={() => removeItem(idx)} className="hover:text-red-600 leading-none text-sm shrink-0">×</button>
            </div>
          ))}
          {allowMulti && items.length > 1 && (
            <p className="text-[10px] text-[var(--warm-muted)] text-right">
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
              {activeLabel}{fetching && <span className="ml-1 text-[10px] text-[var(--warm-muted)]">단위 불러오는 중…</span>}
            </span>
            <button type="button" onClick={() => setActiveLabel(null)}
              className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-sm leading-none">✕</button>
          </div>
          {SpecQtyInputs()}
          <button type="button" onClick={() => confirmAdd(activeLabel)}
            className="w-full py-1.5 bg-[var(--coral)] hover:opacity-90 text-white text-xs font-medium rounded-lg transition-colors">추가</button>
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
            <label className="text-[10px] text-[var(--warm-muted)]">품목명</label>
            <input type="text" placeholder="예: 고추장" value={customLabel} onChange={e => setCustomLabel(e.target.value)} className={textCls} />
          </div>
          {SpecQtyInputs()}
          <button type="button" onClick={() => { if (customLabel.trim()) confirmAdd(customLabel.trim()) }}
            className="w-full py-1.5 bg-[var(--coral)] hover:opacity-90 text-white text-xs font-medium rounded-lg transition-colors">
            추가
          </button>
        </div>
      )}
    </div>
  )
}


const PAY_METHODS_EXP    = ['계좌이체', '신용카드', '체크카드', '현금', '기타']
const PAY_METHODS_INC    = ['계좌이체', '현금', '기타']
const ACCOUNT_TYPE_LABEL: Record<string, string> = {
  BANK_ACCOUNT: '은행계좌', CREDIT_CARD: '신용카드', DEBIT_CARD: '체크카드',
}

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

const FIN_WIDTHS_KEY = 'roomos_finance_col_widths'

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
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e8ddd2" strokeWidth={strokeWidth} />
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
      {centerLabel && <text x={cx} y={cy + 5} textAnchor="middle" fontSize="13" fontWeight="700" fill="#5a4a3a">{centerLabel}</text>}
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
        <span className="text-[11px] font-medium text-[var(--warm-dark)] leading-tight block">{label}</span>
        {sublabel && <span className="text-[10px] text-[var(--warm-muted)] leading-tight block">{sublabel}</span>}
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
      <span className="text-[11px] font-medium text-[var(--warm-dark)] font-mono w-16 text-right shrink-0">
        {total > 0 ? `${Math.round(total / 10000).toLocaleString()}만원` : '—'}
      </span>
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────────

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

type Tab = 'expense' | 'income' | 'settle' | 'assets'

type CategoryTotal = { category: string; total: number }

export default function FinanceClient({
  expenses, incomes, financialAccounts, unsettledExpenses, settledCardExpenses, incomeCategories, expenseCategories, paymentMethods, targetMonth, recurringExpensesWithStatus, rooms, prevMonth, prevMonthTotals, lastYearMonth, lastYearTotals, acquisitionDate, detailSuggestions,
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
}) {
  const router = useRouter()
  const [tab, setTab] = useState<Tab>('expense')
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [finColWidths, setFinColWidths] = useState<Record<string, number>>(DEFAULT_FIN_WIDTHS)
  const finColWidthsRef                 = useRef<Record<string, number>>(DEFAULT_FIN_WIDTHS)

  // ── 지출 탭 상태 ─────────────────────────────────────────────
  const [expFilter, setExpFilter] = useState({ method: 'all', category: 'all', finance: 'all' })
  const [showAddExp, setShowAddExp]       = useState(false)
  const [addExpDate, setAddExpDate]       = useState(() => kstYmdStr())
  const [detailExp, setDetailExp]         = useState<Expense | null>(null)
  const [detailExpEdit, setDetailExpEdit] = useState(false)
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
  // 영수증 OCR (지출 등록 폼)
  const [addExpVendor, setAddExpVendor]     = useState('')
  const [addExpAmount, setAddExpAmount]     = useState<number | undefined>(undefined)
  const [addExpDetail, setAddExpDetail]     = useState('')
  const [ocrPending, setOcrPending]         = useState(false)
  const [ocrError, setOcrError]             = useState('')
  const [ocrPreview, setOcrPreview]         = useState<string | null>(null)
  const ocrFileRef                          = useRef<HTMLInputElement | null>(null)
  const [editExpCategory, setEditExpCategory] = useState('')
  const [addItems, setAddItems]   = useState<ItemPickState[]>([])
  const [editItems, setEditItems] = useState<ItemPickState[]>([])

  // 영수증 OCR 핸들러 — 사진 → base64 → Gemini → 폼 자동 채움
  const handleReceiptOcr = (file: File) => {
    setOcrError('')
    setOcrPending(true)
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string
        setOcrPreview(dataUrl)
        const base64 = dataUrl.replace(/^data:[^;]+;base64,/, '')
        const res = await analyzeReceiptWithGemini(base64, file.type || 'image/jpeg')
        if (!res.ok) { setOcrError(res.error); setOcrPending(false); return }
        const d = res.data
        if (d.date) setAddExpDate(d.date)
        if (d.vendor) setAddExpVendor(d.vendor)
        if (d.category && EXPENSE_CATEGORIES.includes(d.category)) setAddExpCategory(d.category)
        if (d.items.length > 0 && ITEM_PRESETS[d.category ?? '']) {
          // 다중 품목 — addItems에 주입
          setAddItems(d.items.map(it => ({
            label:     it.label,
            specValue: it.specValue ?? '',
            specUnit:  it.specUnit  ?? '',
            qtyValue:  it.qtyValue  ?? '',
            qtyUnit:   it.qtyUnit   ?? '',
            amount:    it.amount,
          })))
          setAddExpAmount(d.items.reduce((s, it) => s + it.amount, 0))
        } else {
          setAddItems([])
          if (d.totalAmount) setAddExpAmount(d.totalAmount)
          if (d.items.length > 0) {
            setAddExpDetail(d.items.map(it => `[${it.label}] ${it.amount.toLocaleString()}원`).join(', '))
          }
        }
        setOcrPending(false)
      } catch (err) {
        setOcrError((err as Error).message ?? '영수증 분석 중 오류가 발생했습니다.')
        setOcrPending(false)
      }
    }
    reader.onerror = () => { setOcrError('이미지를 읽지 못했습니다.'); setOcrPending(false) }
    reader.readAsDataURL(file)
  }

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
  const [recRecDate, setRecRecDate]     = useState('')
  const [recRecMemo, setRecRecMemo]     = useState('')
  const [recRecPayMethod, setRecRecPayMethod] = useState('')
  const [recError, setRecError]         = useState('')

  // ── 고정 지출 관리 모달 상태 ─────────────────────────────────
  const [showRecMgmt, setShowRecMgmt]   = useState(false)
  const [recMgmtList, setRecMgmtList]   = useState<RecurringExpenseRow[]>([])
  const [recMgmtLoading, setRecMgmtLoading] = useState(false)
  const [editingRecMgmt, setEditingRecMgmt] = useState<RecurringExpenseRow | null>(null)
  const [showRecMgmtForm, setShowRecMgmtForm] = useState(false)
  const [recMgmtForm, setRecMgmtForm]   = useState({ title: '', amount: '', category: '관리비', dueDay: '25', payMethod: '', isAutoDebit: false, isVariable: false, alertDaysBefore: '7', activeSince: '', priorYearAmount: '', memo: '' })
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
    setRecMgmtForm({ title: '', amount: '', category: expenseCategories[0] ?? '관리비', dueDay: '25', payMethod: '', isAutoDebit: false, isVariable: false, alertDaysBefore: '7', activeSince: defaultActiveSince, priorYearAmount: '', memo: '' })
    setShowRecMgmtForm(true)
    setRecMgmtError('')
  }
  const openEditRecMgmt = (r: RecurringExpenseRow) => {
    setEditingRecMgmt(r)
    setRecMgmtForm({ title: r.title, amount: r.amount.toString(), category: r.category, dueDay: r.dueDay.toString(), payMethod: r.payMethod ?? '', isAutoDebit: r.isAutoDebit, isVariable: r.isVariable, alertDaysBefore: r.alertDaysBefore.toString(), activeSince: r.activeSince ?? '', priorYearAmount: r.priorYearAmount ? r.priorYearAmount.toString() : '', memo: r.memo ?? '' })
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
  const handleDeleteRecMgmt = (id: string, title: string) => {
    if (!confirm(`'${title}' 고정 지출을 삭제할까요?`)) return
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
  const cardAccounts = financialAccounts.filter(a => a.type === 'CREDIT_CARD' || a.type === 'DEBIT_CARD')
  const bankAccounts = financialAccounts.filter(a => a.type === 'BANK_ACCOUNT')

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
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await addExpense(fd)
      if (!res.ok) { setError(res.error); return }
      setShowAddExp(false); setAddExpDate(kstYmdStr()); setAddReceiptUrl(''); router.refresh()
    })
  }
  const handleUpdateExp = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updateExpense(fd)
      if (!res.ok) { setError(res.error); return }
      setDetailExp(null); setDetailExpEdit(false); router.refresh()
    })
  }
  const handleDeleteExp = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return
    startTransition(async () => {
      await deleteExpense(id); setDetailExp(null); router.refresh()
    })
  }

  const handleAddInc = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await addExtraIncome(fd)
      if (!res.ok) { setError(res.error); return }
      setShowAddInc(false); setAddIncDate(kstYmdStr()); router.refresh()
    })
  }
  const handleUpdateInc = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updateExtraIncome(fd)
      if (!res.ok) { setError(res.error); return }
      setDetailInc(null); setDetailIncEdit(false); router.refresh()
    })
  }
  const handleDeleteInc = (id: string) => {
    if (!confirm('삭제하시겠습니까?')) return
    startTransition(async () => {
      await deleteExtraIncome(id); setDetailInc(null); router.refresh()
    })
  }

  const handleSettle = (ids: string[], name: string, billMonth: string) => {
    if (!confirm(`'${name}' ${billMonth} 청구분(${ids.length}건)을 정산 완료 처리하시겠습니까?`)) return
    startTransition(async () => {
      await settleCardExpenses(ids); router.refresh()
    })
  }

  const handleUnsettle = (id: string) => {
    if (!confirm('이 지출을 미정산 상태로 되돌리시겠습니까?')) return
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
  const handleDeleteAsset = (id: string) => {
    if (!confirm('자산을 완전히 삭제하시겠습니까?\n기존 지출·수익 기록과의 연결도 끊어집니다.')) return
    startTransition(async () => {
      await deleteFinancialAccount(id)
      setEditingAcc(null); setAssetBrand(''); setAssetFormKey(k => k + 1); router.refresh()
    })
  }

  const handleDeactivateAsset = (id: string) => {
    if (!confirm('해지 처리 하시겠습니까?\n기존 기록은 유지되며 신규 사용은 불가합니다.')) return
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
  const TABS: { key: Tab; label: string }[] = [
    { key: 'expense', label: `지출 내역${recUnrecordedCount > 0 ? ` (고정 ${recUnrecordedCount}건 미확인)` : ''}` },
    { key: 'income',  label: '부가 수익' },
    { key: 'settle',  label: `카드 정산${unsettledExpenses.length > 0 ? ` (${unsettledExpenses.length})` : ''}` },
    { key: 'assets',  label: `자산 관리${financialAccounts.length > 0 ? ` (${financialAccounts.length})` : ''}` },
  ]

  return (
    <>
    <div className="space-y-5">

      {/* 헤더 */}
      <h1 className="text-xl font-bold text-[var(--warm-dark)]">지출/기타 수익</h1>

      {/* ── 월간 요약 위젯 ── */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-hidden">
        {/* 상단: 지출 / 부가수익 */}
        <div className="grid grid-cols-2 divide-x divide-[var(--warm-border)]">

          {/* 전체 예상 지출 */}
          <div className="px-5 py-4 space-y-2">
            <p className="text-xs font-medium text-[var(--warm-muted)]">전체 예상 지출</p>
            <p className="text-xl font-bold text-[var(--warm-dark)] font-mono">
              <MoneyDisplay amount={totalExpectedExp} prefix="-" />
            </p>
            <div className="space-y-1 pt-1 border-t border-[var(--warm-border)]">
              <div className="flex items-center justify-between text-xs">
                <span className="text-[var(--warm-muted)]">일반 지출</span>
                <span className="text-[var(--warm-dark)] font-medium font-mono">
                  <MoneyDisplay amount={normalExpTotal} />
                </span>
              </div>
              {(recRecordedTotal > 0 || recPendingTotal > 0) && (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-[var(--warm-muted)]">고정 지출 (기록됨)</span>
                    <span className="text-[var(--warm-dark)] font-medium font-mono">
                      <MoneyDisplay amount={recRecordedTotal} />
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-1">
                      <span className="text-[var(--warm-muted)]">고정 지출 (예정)</span>
                      {recPendingTotal > 0 && (
                        <span className="text-[9px] bg-amber-400/15 text-amber-600 px-1.5 py-0.5 rounded-full font-medium">
                          {recUnrecordedCount}건 미기록
                        </span>
                      )}
                    </div>
                    <span className="text-amber-600 font-medium font-mono">
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
            <p className="text-xl font-bold text-[var(--warm-dark)] font-mono">
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
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-5 space-y-4">
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
                    <span className="text-xs font-medium text-[var(--warm-dark)] font-mono shrink-0">
                      {amt.toLocaleString()}원
                    </span>
                    <span className="text-[10px] text-[var(--warm-muted)] w-6 text-right shrink-0">{pct}%</span>
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
      <div className="flex gap-1.5 overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium whitespace-nowrap transition-colors rounded-xl
              ${tab === t.key
                ? 'bg-[var(--coral)] text-white'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          탭 1: 지출 내역
      ══════════════════════════════════════════════════════════ */}
      {tab === 'expense' && (
        <div className="space-y-4">
          {/* 필터 + 합계 + 버튼 */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={expFilter.method} onChange={e => setExpFilter(f => ({ ...f, method: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
              <option value="all">결제수단 (전체)</option>
              {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={expFilter.category} onChange={e => setExpFilter(f => ({ ...f, category: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
              <option value="all">카테고리 (전체)</option>
              {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {financialAccounts.length > 0 && (
              <select value={expFilter.finance} onChange={e => setExpFilter(f => ({ ...f, finance: e.target.value }))}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
                <option value="all">금융사 (전체)</option>
                {financialAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
              </select>
            )}
            <button onClick={() => setExpFilter({ method: 'all', category: 'all', finance: 'all' })}
              className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2">초기화</button>
            <span className="ml-auto text-sm font-bold text-red-400 font-mono">
              합계: <MoneyDisplay amount={totalExp} />
            </span>
            <button onClick={openRecMgmt}
              className="px-4 py-2 bg-[var(--canvas)] border border-[var(--warm-border)] hover:border-[var(--coral)] text-[var(--warm-dark)] text-sm font-medium rounded-xl transition-colors">
              고정 지출 관리
            </button>
            <button onClick={() => { setShowAddExp(true); setAddExpMethod('계좌이체'); setAddExpAccId(''); setAddExpAccName(''); setAddExpCategory(EXPENSE_CATEGORIES[0]); setAddItems([]); setAddExpVendor(''); setAddExpAmount(undefined); setAddExpDetail(''); setOcrPreview(null); setOcrError(''); setError('') }}
              className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
              + 지출 등록
            </button>
          </div>

          {(() => {
            // 미확인 고정 지출 — 필터 적용 후 납부일 기준 날짜 부여
            const unconfirmedRecs = activeRecs.filter(r =>
              !r.recordedExpenseId &&
              (expFilter.category === 'all' || r.category === expFilter.category) &&
              (expFilter.method === 'all' || r.payMethod === expFilter.method)
            )

            type ListItem =
              | { kind: 'expense'; exp: Expense; dateStr: string }
              | { kind: 'recurring'; rec: RecurringExpenseWithStatus; dateStr: string }

            const items: ListItem[] = [
              ...filteredExpenses.map(e => ({
                kind: 'expense' as const,
                exp: e,
                dateStr: kstYmdStr(new Date(e.date)),
              })),
              ...unconfirmedRecs.map(r => ({
                kind: 'recurring' as const,
                rec: r,
                dateStr: `${targetMonth}-${String(r.dueDay).padStart(2, '0')}`,
              })),
            ].sort((a, b) => b.dateStr.localeCompare(a.dateStr))

            const isEmpty = items.length === 0

            return (
              <>
                {/* 모바일 카드 */}
                {isEmpty ? (
                  <div className="sm:hidden bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-10 text-center">
                    <EmptyState label="지출 내역이 없습니다" />
                  </div>
                ) : (
                  <div className="sm:hidden space-y-2">
                    {items.map(item => {
                      if (item.kind === 'expense') {
                        const e = item.exp
                        return (
                          <div key={e.id}
                            onClick={() => { setDetailExp(e); setDetailExpEdit(false); setError('') }}
                            className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 cursor-pointer active:opacity-70 transition-opacity">
                            <div className="flex items-center justify-between mb-2">
                              <span className="text-xs text-[var(--warm-muted)]">{fmtDate(e.date)}</span>
                              <div className="flex items-center gap-1.5">
                                <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ring-1
                                  ${e.settleStatus === 'UNSETTLED' ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                                  {e.settleStatus === 'UNSETTLED' ? '미정산' : '정산완료'}
                                </span>
                                <span className="text-sm font-bold text-red-500"><MoneyDisplay amount={e.amount} prefix="-" alwaysFull /></span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20">{e.category}</span>
                              {e.recurringExpenseId && <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 font-medium">고정</span>}
                              {e.recurringExpense?.isVariable && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 ring-1 ring-blue-100">변동</span>}
                              {e.payMethod && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-mid)]">{e.payMethod}</span>}
                              {e.financialAccount && <span className="text-[10px] text-[var(--warm-muted)]">{accName(e.financialAccount)}</span>}
                            </div>
                            <div className="flex items-center gap-1.5">
                              {(e.vendor || e.detail || e.memo) && (
                                <p className="text-xs text-[var(--warm-dark)] truncate">{[e.vendor, e.detail, e.memo].filter(Boolean).join(' · ')}</p>
                              )}
                              {e.receiptUrl && <span className="text-[10px] shrink-0">🧾</span>}
                            </div>
                          </div>
                        )
                      }
                      // 미확인 고정 지출 카드
                      const r = item.rec
                      const expectedAmt = r.historicalAvg ?? r.amount
                      return (
                        <div key={`rec-${r.id}`}
                          onClick={() => { setRecordingRec(r); setRecRecAmount(expectedAmt); setRecRecDate(item.dateStr); setRecRecMemo(r.memo ?? ''); setRecRecPayMethod(r.payMethod ?? '계좌이체'); setRecError('') }}
                          className="bg-[var(--cream)] border border-[var(--warm-border)] border-l-[3px] border-l-amber-400 rounded-2xl p-4 cursor-pointer hover:bg-[var(--canvas)] active:opacity-70 transition-colors">
                          <div className="flex items-center justify-between mb-2">
                            <span className="text-xs text-[var(--warm-muted)]">{item.dateStr.slice(5).replace('-', '/')} 납부일</span>
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 font-medium">
                                {r.isAutoDebit ? '자동이체 확인' : '지출 확인 필요'}
                              </span>
                              <div className="text-right">
                                <span className="text-sm font-bold text-red-500">
                                  <MoneyDisplay amount={expectedAmt} prefix="-" />
                                </span>
                                {r.isVariable && (
                                  <p className="text-[9px] text-blue-400 mt-0.5">
                                    {r.historicalAvg ? '과거 평균 기준 예상치' : '예상치'}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 font-medium">고정</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20">{r.category}</span>
                            {r.payMethod && <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-mid)]">{r.payMethod}</span>}
                            {r.isVariable && <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-500 ring-1 ring-blue-100">변동</span>}
                          </div>
                          <p className="text-xs text-[var(--warm-dark)] font-medium">{r.title}{r.memo ? ` · ${r.memo}` : ''}</p>
                        </div>
                      )
                    })}
                  </div>
                )}

                {/* 데스크탑 테이블 */}
                <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100vh-340px)]">
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
                            return (
                              <tr key={e.id}
                                onClick={() => { setDetailExp(e); setDetailExpEdit(false); setError('') }}
                                className="border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 transition-colors cursor-pointer">
                                <td className="px-4 py-3 text-xs text-[var(--warm-mid)] overflow-hidden"><span className="truncate block">{fmtDate(e.date)}</span></td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] whitespace-nowrap">{e.payMethod ?? '—'}</span>
                                  {e.financialAccount && <div className="text-xs text-[var(--warm-muted)] mt-0.5 truncate">{accName(e.financialAccount)}</div>}
                                </td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <div className="flex items-center gap-1 flex-wrap">
                                    <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20 whitespace-nowrap">{e.category}</span>
                                    {e.recurringExpenseId && <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 whitespace-nowrap font-medium">고정</span>}
                                    {e.recurringExpense?.isVariable && <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-blue-50 text-blue-500 ring-1 ring-blue-100 whitespace-nowrap">변동</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                                  <div className="flex items-center gap-1.5">
                                    <span className="truncate">{e.detail ?? '—'}</span>
                                    {e.receiptUrl && <span className="shrink-0 text-xs">🧾</span>}
                                  </div>
                                </td>
                                <td className="px-4 py-3 text-sm font-semibold text-red-500 overflow-hidden"><span className="truncate block"><MoneyDisplay amount={e.amount} prefix="-" /></span></td>
                                <td className="px-4 py-3 overflow-hidden">
                                  <span className={`inline-flex items-center text-xs px-2 py-1 rounded-full font-medium ring-1 whitespace-nowrap
                                    ${e.settleStatus === 'UNSETTLED' ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                                    {e.settleStatus === 'UNSETTLED' ? '미정산' : '정산완료'}
                                  </span>
                                </td>
                              </tr>
                            )
                          }
                          // 미확인 고정 지출 행
                          const r = item.rec
                          const expectedAmt = r.historicalAvg ?? r.amount
                          return (
                            <tr key={`rec-${r.id}`}
                              onClick={() => { setRecordingRec(r); setRecRecAmount(expectedAmt); setRecRecDate(item.dateStr); setRecRecMemo(r.memo ?? ''); setRecRecPayMethod(r.payMethod ?? '계좌이체'); setRecError('') }}
                              className="border-b border-[var(--warm-border)] bg-[var(--canvas)]/40 hover:bg-[var(--canvas)] transition-colors cursor-pointer"
                              style={{ boxShadow: 'inset 3px 0 0 #fbbf24' }}>
                              <td className="px-4 py-3 text-xs text-[var(--warm-muted)] overflow-hidden">
                                <span className="truncate block">{item.dateStr.slice(5).replace('-', '/')} 납부</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] whitespace-nowrap">{r.payMethod ?? '—'}</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <div className="flex items-center gap-1">
                                  <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-amber-50 text-amber-600 ring-1 ring-amber-200 whitespace-nowrap font-medium">고정</span>
                                  <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20 whitespace-nowrap">{r.category}</span>
                                </div>
                              </td>
                              <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                                <span className="truncate block font-medium">{r.title}</span>
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="text-sm font-semibold text-red-500 truncate block">
                                  <MoneyDisplay amount={expectedAmt} prefix="-" />
                                </span>
                                {r.isVariable && (
                                  <span className="text-[9px] text-blue-400">
                                    {r.historicalAvg ? '과거 평균 기준 예상치' : '예상치'}
                                  </span>
                                )}
                              </td>
                              <td className="px-4 py-3 overflow-hidden">
                                <span className="inline-flex items-center text-xs px-2 py-1 rounded-full font-medium ring-1 whitespace-nowrap bg-amber-50 text-amber-600 ring-amber-200">
                                  {r.isAutoDebit ? '자동이체 확인' : '확인 필요'}
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
                        <div key={rec.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 opacity-50">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className="text-xs text-[var(--warm-muted)]">매월 {rec.dueDay}일</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 ring-1 ring-blue-200 font-medium">{rec.activeSince?.slice(0, 7)} 활성화</span>
                          </div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20">{rec.category}</span>
                          </div>
                          <div className="flex justify-between">
                            <p className="text-xs text-[var(--warm-dark)] font-medium">{rec.title}</p>
                            <span className="text-sm font-bold text-[var(--warm-muted)]"><MoneyDisplay amount={rec.amount} prefix="-" /></span>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-hidden opacity-60">
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
                                <span className="text-[10px] font-semibold text-blue-500 bg-blue-500/10 px-2 py-1 rounded-lg">{rec.activeSince?.slice(0, 7)} 활성화</span>
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
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
              <option value="all">입금수단 (전체)</option>
              {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={incFilter.category} onChange={e => setIncFilter(f => ({ ...f, category: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
              <option value="all">카테고리 (전체)</option>
              {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <button onClick={() => setIncFilter({ method: 'all', category: 'all' })}
              className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-2">초기화</button>
            <span className="ml-auto text-sm font-bold text-green-400 font-mono">
              합계: <MoneyDisplay amount={totalInc} />
            </span>
            <button onClick={() => { setShowAddInc(true); setAddIncMethod('계좌이체'); setAddIncAccId(''); setError('') }}
              className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
              + 수익 등록
            </button>
          </div>

          {/* 부가 수익 목록 — 모바일 카드 */}
          {filteredIncomes.length === 0 ? (
            <div className="sm:hidden bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-10 text-center">
              <EmptyState label="부가 수익 내역이 없습니다" />
            </div>
          ) : (
            <div className="sm:hidden space-y-2">
              {filteredIncomes.map(i => (
                <div key={i.id}
                  onClick={() => { setDetailInc(i); setDetailIncEdit(false); setError('') }}
                  className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 cursor-pointer active:opacity-70 transition-opacity">
                  {/* 날짜 + 금액 */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs text-[var(--warm-muted)]">{fmtDate(i.date)}</span>
                    <span className="text-sm font-bold text-emerald-600"><MoneyDisplay amount={i.amount} prefix="+" alwaysFull /></span>
                  </div>
                  {/* 카테고리 + 입금수단 */}
                  <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">{i.category}</span>
                    {i.payMethod && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-mid)]">{i.payMethod}</span>
                    )}
                    {i.financialAccount && (
                      <span className="text-[10px] text-[var(--warm-muted)]">{accName(i.financialAccount)}</span>
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
          <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100vh-340px)]">
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
                        <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 whitespace-nowrap">{i.category}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                        <span className="truncate block">{i.detail ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-emerald-600 overflow-hidden">
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
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-1">미정산 신용카드 대금 합산</h2>
            <p className="text-xs text-[var(--warm-muted)] mb-5">신용카드로 결제된 미정산 지출을 카드별로 합산합니다.</p>

            {settleGroups.length === 0 ? (
              <EmptyState label="미정산 건이 없습니다" />
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {settleGroups.map((g, idx) => (
                  <div key={idx} className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-2xl p-5 flex flex-col gap-3">
                    {/* 카드명 */}
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--warm-dark)] text-base">{g.accountName}</span>
                      {g.payDayStr !== '미지정' && (
                        <span className="text-xs px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 ring-1 ring-amber-200 font-medium">
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
                      <span className="text-xl font-bold text-red-400 font-mono">
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
                          <span className="text-[var(--warm-dark)] font-medium font-mono shrink-0">
                            {item.amount.toLocaleString()}원
                          </span>
                        </div>
                      ))}
                    </div>

                    {/* 정산 버튼 */}
                    {g.accountId && g.accountId !== 'unknown' ? (
                      <button
                        onClick={() => handleSettle(g.items.map(i => i.id), g.accountName, g.billMonth)}
                        disabled={isPending}
                        className="w-full py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                        출금 확인 (정산 완료 처리)
                      </button>
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
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-5 space-y-3">
              <h3 className="text-sm font-semibold text-[var(--warm-mid)]">정산 완료 내역 (최근 4개월)</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {settledGroups.map(g => (
                  <div key={`${g.accountId}__${g.billMonth}`}
                    className="bg-[var(--canvas)]/60 border border-[var(--warm-border)] rounded-xl p-4 space-y-3 opacity-70">
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-sm font-semibold text-[var(--warm-dark)]">{g.accountName}</span>
                        <span className="text-xs text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">정산완료</span>
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
                        onClick={() => {
                          if (!confirm(`'${g.accountName}' ${g.billMonth} 청구분 정산을 전부 취소하시겠습니까?`)) return
                          startTransition(async () => {
                            await unsettleExpenses(g.items.map(i => i.id)); router.refresh()
                          })
                        }}
                        disabled={isPending}
                        className="text-xs text-yellow-400 hover:text-yellow-300 px-3 py-1.5 bg-yellow-500/10 hover:bg-yellow-500/20 rounded-lg transition-colors disabled:opacity-40">
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
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-[var(--warm-dark)] mb-4">
              {editingAcc ? '자산 수정' : '자산 등록'}
            </h2>
            <form key={assetFormKey} onSubmit={handleSaveAsset} className="space-y-3">
              {editingAcc && <input type="hidden" name="id" value={editingAcc.id} />}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">분류 *</label>
                <select name="type" value={assetType}
                  onChange={e => { setAssetType(e.target.value); setAssetBrand('') }}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="BANK_ACCOUNT">은행계좌</option>
                  <option value="CREDIT_CARD">신용카드</option>
                  <option value="DEBIT_CARD">체크카드</option>
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">
                  {assetType === 'BANK_ACCOUNT' ? '은행' : '카드'} *
                </label>
                <div className="flex items-center gap-2">
                  <BrandLogo name={assetBrand} size={22} />
                  <select name="brand" value={assetBrand}
                    onChange={e => setAssetBrand(e.target.value)}
                    className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    <option value="">선택하세요</option>
                    {(assetType === 'BANK_ACCOUNT' ? BANKS
                      : assetType === 'CREDIT_CARD' ? CREDIT_CARDS
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
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">
                    {assetType === 'BANK_ACCOUNT' ? '계좌번호' : '번호 (끝 4자리)'}
                  </label>
                  <input type="text" name="identifier"
                    defaultValue={editingAcc?.identifier ?? ''}
                    placeholder={assetType === 'BANK_ACCOUNT' ? '예: 110-123-456789' : '예: 1234'}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">소유주명</label>
                <input type="text" name="owner"
                  defaultValue={editingAcc?.owner ?? ''}
                  placeholder="예: 홍길동"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">결제 연결 계좌</label>
                    <select name="linkedAccountId"
                      defaultValue={editingAcc?.linkedAccountId ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {bankAccounts.map(a => (
                        <option key={a.id} value={a.id}>{accName(a)}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}

              {assetError && <p className="text-red-400 text-sm">{assetError}</p>}

              <div className="flex gap-2 pt-1">
                {editingAcc && (
                  <button type="button"
                    onClick={() => { setEditingAcc(null); setAssetType('BANK_ACCOUNT'); setAssetBrand(''); setAssetFormKey(k => k + 1) }}
                    className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">
                    취소
                  </button>
                )}
                <button type="submit" disabled={isPending}
                  className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl border border-transparent transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  {isPending ? '저장 중...' : (editingAcc ? '수정 저장' : '등록')}
                </button>
              </div>
            </form>
          </div>

          {/* 자산 목록 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-hidden">
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
                  ] as const
                ).map(({ type, label }) => {
                  const group = financialAccounts.filter(a => a.type === type)
                  if (group.length === 0) return null
                  return (
                    <div key={type} className="border-b border-[var(--warm-border)] last:border-0">
                      <p className="px-5 pt-3 pb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--warm-muted)]">{label}</p>
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
                              className="text-xs text-amber-400 hover:text-amber-300 px-3 py-1.5 bg-amber-500/10 rounded-lg transition-colors shrink-0">
                              해지
                            </button>
                            <button
                              onClick={() => handleDeleteAsset(a.id)}
                              className="text-xs text-red-400 hover:text-red-300 px-3 py-1.5 bg-red-500/10 rounded-lg transition-colors shrink-0">
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
          모달: 지출 상세 / 수정
      ══════════════════════════════════════════════════════════ */}
      {detailExp && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => { setDetailExp(null); setDetailExpEdit(false) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">
                {detailExpEdit ? '지출 수정' : '지출 상세'}
              </h2>
              <button onClick={() => { setDetailExp(null); setDetailExpEdit(false) }}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
            </div>

            {!detailExpEdit ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  <DetailRow label="날짜"        value={fmtDate(detailExp.date)} />
                  <DetailRow label="카테고리"    value={detailExp.category} />
                  {detailExp.vendor && <DetailRow label="구매처"   value={detailExp.vendor} />}
                  <DetailRow label="세부 항목"   value={detailExp.detail ?? '—'} />
                  <DetailRow label="금액"        value={<span className="text-red-400 font-semibold"><MoneyDisplay amount={detailExp.amount} prefix="-" /></span>} />
                  {detailExp.room && <DetailRow label="대상 호실" value={`${detailExp.room.roomNo}호`} />}
                  <DetailRow label="결제수단"    value={detailExp.payMethod ?? '—'} />
                  {detailExp.financeName && <DetailRow label="금융사" value={detailExp.financeName} />}
                  <DetailRow label="정산상태"    value={
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ring-1 ${detailExp.settleStatus === 'UNSETTLED' ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                      {detailExp.settleStatus === 'UNSETTLED' ? '미정산' : '정산완료'}
                    </span>
                  } />
                  {detailExp.memo && <DetailRow label="메모" value={detailExp.memo} />}
                  {detailExp.receiptUrl && (
                    <div className="pt-2">
                      <p className="text-xs text-[var(--warm-muted)] mb-1.5">영수증</p>
                      <a href={detailExp.receiptUrl} target="_blank" rel="noopener noreferrer">
                        <img src={detailExp.receiptUrl} className="rounded-xl border border-[var(--warm-border)] w-full max-h-48 object-contain" alt="영수증" />
                      </a>
                    </div>
                  )}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button onClick={() => handleDeleteExp(detailExp.id)} disabled={isPending}
                    className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-xl transition-colors disabled:opacity-40">삭제</button>
                  {detailExp.settleStatus === 'SETTLED' && (detailExp.payMethod === '신용카드' || detailExp.payMethod === '체크카드') && (
                    <button onClick={() => handleUnsettle(detailExp.id)} disabled={isPending}
                      className="px-4 py-2.5 bg-yellow-500/10 hover:bg-yellow-500/20 text-yellow-400 text-sm rounded-xl transition-colors disabled:opacity-40">
                      정산 취소
                    </button>
                  )}
                  <div className="flex-1" />
                  <button onClick={() => {
                    setDetailExpEdit(true)
                    setEditExpDate(toDateInput(detailExp.date))
                    setEditExpMethod(detailExp.payMethod ?? '계좌이체')
                    setEditExpAccId(detailExp.financialAccountId ?? '')
                    setEditExpAccName(detailExp.financeName ?? '')
                    setEditExpRoomId(detailExp.roomId ?? '')
                    setEditReceiptUrl(detailExp.receiptUrl ?? '')
                    setEditExpCategory(detailExp.category)
                    setEditItems(detailExp.itemLabel ? [{
                      label: detailExp.itemLabel,
                      specValue: detailExp.specValue?.toString() ?? '',
                      specUnit:  detailExp.specUnit ?? '',
                      qtyValue:  detailExp.qtyValue?.toString() ?? '',
                      qtyUnit:   detailExp.qtyUnit ?? '',
                      amount:    detailExp.amount,
                    }] : [])
                    setError('')
                  }}
                    className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">수정</button>
                </div>
              </>
            ) : (
              <form key={detailExp.id + '-edit'} onSubmit={handleUpdateExp} className="flex flex-col flex-1 overflow-hidden">
                <input type="hidden" name="id" value={detailExp.id} />
                <input type="hidden" name="financialAccountId" value={editExpAccId} />
                <input type="hidden" name="financeName" value={editExpAccName} />
                <input type="hidden" name="roomId" value={editExpRoomId} />
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                      <DatePicker name="date" value={editExpDate} onChange={setEditExpDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">
                        금액 *{editItems.length > 1 && <span className="text-[10px] text-[var(--warm-muted)] font-normal ml-1">(품목 합계 자동)</span>}
                      </label>
                      {editItems.length > 1 ? (
                        <div className="relative">
                          <input type="hidden" name="amount" value={editItems.reduce((s, it) => s + (it.amount ?? 0), 0)} />
                          <div className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]">
                            {editItems.reduce((s, it) => s + (it.amount ?? 0), 0).toLocaleString()}원
                          </div>
                        </div>
                      ) : <MoneyInput name="amount" defaultValue={detailExp.amount} placeholder="0원" />}
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                    <select name="category" value={editExpCategory}
                      onChange={e => { setEditExpCategory(e.target.value); setEditItems([]) }}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">구매처</label>
                    <input type="text" name="vendor" defaultValue={detailExp.vendor ?? ''} placeholder="예: 쿠팡, 다이소"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  {ITEM_PRESETS[editExpCategory] && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">품목 선택 <span className="text-[var(--warm-muted)] font-normal">(여러 품목 추가 가능)</span></label>
                      <ItemSelector
                        category={editExpCategory}
                        value={editItems}
                        onChange={setEditItems}
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                    {editItems.length > 0
                      ? <input type="text" name="detail" value={fmtItemListDetail(editItems)} readOnly
                          className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
                      : <input type="text" name="detail" defaultValue={detailExp.detail ?? ''} placeholder="세부 내용"
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                    }
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
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  {editExpMethod === '계좌이체' && bankAccounts.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">출금 계좌</label>
                      <select value={editExpAccId}
                        onChange={e => pickAccount(e.target.value, setEditExpAccId, setEditExpAccName)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
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
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                      </select>
                    </div>
                  )}
                  {rooms.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">대상 호실 (선택)</label>
                      <select value={editExpRoomId} onChange={e => setEditExpRoomId(e.target.value)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="">선택 안함</option>
                        {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                      </select>
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailExp.memo ?? ''} placeholder="메모 (선택)"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">영수증</label>
                    <input type="hidden" name="receiptUrl" value={editReceiptUrl} />
                    <label className="flex items-center justify-center gap-1.5 w-full bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-xl px-3 py-2 cursor-pointer hover:border-[var(--coral)] transition-colors">
                      <span className="text-lg">📎</span>
                      <span className="text-xs text-[var(--warm-muted)]">{receiptUploading ? '업로드 중...' : editReceiptUrl ? '파일 변경' : '파일 선택'}</span>
                      <input type="file" accept="image/*,application/pdf" className="hidden" disabled={receiptUploading}
                        onChange={async e => { const f = e.target.files?.[0]; if (f) await handleReceiptUpload(f, setEditReceiptUrl) }} />
                    </label>
                    {editReceiptUrl && (
                      <div className="relative">
                        <img src={editReceiptUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증" />
                        <button type="button" onClick={() => setEditReceiptUrl('')}
                          className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs leading-none">✕</button>
                      </div>
                    )}
                  </div>
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button type="button" onClick={() => { setDetailExpEdit(false); setError('') }}
                    className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">취소</button>
                  <button type="submit" disabled={isPending}
                    className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl border border-transparent transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                    {isPending ? '저장 중...' : '저장'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 수익 상세 / 수정
      ══════════════════════════════════════════════════════════ */}
      {detailInc && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => { setDetailInc(null); setDetailIncEdit(false) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">
                {detailIncEdit ? '수익 수정' : '수익 상세'}
              </h2>
              <button onClick={() => { setDetailInc(null); setDetailIncEdit(false) }}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
            </div>

            {!detailIncEdit ? (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  <DetailRow label="날짜"      value={fmtDate(detailInc.date)} />
                  <DetailRow label="카테고리"  value={detailInc.category} />
                  <DetailRow label="세부 항목" value={detailInc.detail ?? '—'} />
                  <DetailRow label="금액"      value={<span className="text-green-400 font-semibold"><MoneyDisplay amount={detailInc.amount} prefix="+" /></span>} />
                  <DetailRow label="입금수단"  value={detailInc.payMethod ?? '—'} />
                  {detailInc.financialAccount && <DetailRow label="금융사" value={accName(detailInc.financialAccount)} />}
                  {detailInc.memo && <DetailRow label="메모" value={detailInc.memo} />}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button onClick={() => handleDeleteInc(detailInc.id)} disabled={isPending}
                    className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-xl transition-colors disabled:opacity-40">삭제</button>
                  <div className="flex-1" />
                  <button onClick={() => {
                    setDetailIncEdit(true)
                    setEditIncDate(toDateInput(detailInc.date))
                    setEditIncMethod(detailInc.payMethod ?? '계좌이체')
                    setEditIncAccId(detailInc.financialAccountId ?? '')
                    setError('')
                  }}
                    className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">수정</button>
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
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                      <MoneyInput name="amount" defaultValue={detailInc.amount} placeholder="0원" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                    <select name="category" defaultValue={detailInc.category}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                    <input type="text" name="detail" defaultValue={detailInc.detail ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">입금수단</label>
                    <select name="payMethod" value={editIncMethod}
                      onChange={e => { setEditIncMethod(e.target.value); setEditIncAccId('') }}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailInc.memo ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button type="button" onClick={() => { setDetailIncEdit(false); setError('') }}
                    className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">취소</button>
                  <button type="submit" disabled={isPending}
                    className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl border border-transparent transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                    {isPending ? '저장 중...' : '저장'}
                  </button>
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
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddExp(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">지출 등록</h2>
              <button onClick={() => setShowAddExp(false)} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleAddExp} className="flex flex-col flex-1 overflow-hidden">
              <input type="hidden" name="financialAccountId" value={addExpAccId} />
              <input type="hidden" name="financeName" value={addExpAccName} />
              <input type="hidden" name="roomId" value={addExpRoomId} />
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {/* 영수증 OCR (Gemini Vision) */}
                <div className="rounded-xl border border-[var(--coral)]/30 bg-[var(--coral)]/5 px-3 py-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span>✨</span>
                      <span className="text-xs font-semibold text-[var(--coral)]">영수증 사진으로 자동 입력</span>
                    </div>
                    <input
                      ref={ocrFileRef}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      className="hidden"
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (f) handleReceiptOcr(f)
                        e.target.value = ''
                      }}
                    />
                    <button
                      type="button"
                      disabled={ocrPending}
                      onClick={() => ocrFileRef.current?.click()}
                      className="text-xs px-3 py-1.5 bg-[var(--coral)] hover:opacity-90 text-white rounded-lg transition-opacity disabled:opacity-50 shrink-0">
                      {ocrPending ? '분석 중...' : '📷 인식'}
                    </button>
                  </div>
                  {ocrPreview && !ocrPending && (
                    <div className="flex items-center gap-2">
                      <img src={ocrPreview} alt="영수증" className="h-12 w-12 object-cover rounded-lg" />
                      <p className="text-[10px] text-[var(--warm-muted)] flex-1">분석 결과를 폼에 채웠습니다. 필요하면 수정해서 저장하세요.</p>
                    </div>
                  )}
                  {ocrError && <p className="text-[10px] text-red-500">{ocrError}</p>}
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <DatePicker name="date" value={addExpDate} onChange={setAddExpDate}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">
                      금액 *{addItems.length > 1 && <span className="text-[10px] text-[var(--warm-muted)] font-normal ml-1">(품목 합계 자동)</span>}
                    </label>
                    {addItems.length > 1 ? (
                      <div className="relative">
                        <input type="hidden" name="amount" value={addItems.reduce((s, it) => s + (it.amount ?? 0), 0)} />
                        <div className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]">
                          {addItems.reduce((s, it) => s + (it.amount ?? 0), 0).toLocaleString()}원
                        </div>
                      </div>
                    ) : <MoneyInput name="amount" value={addExpAmount} onChange={setAddExpAmount} placeholder="0원" />}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                  <select name="category" value={addExpCategory}
                    onChange={e => { setAddExpCategory(e.target.value); setAddItems([]) }}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">구매처</label>
                  <input type="text" name="vendor" value={addExpVendor} onChange={e => setAddExpVendor(e.target.value)} placeholder="예: 쿠팡, 다이소"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                {ITEM_PRESETS[addExpCategory] && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">품목 선택 <span className="text-[var(--warm-muted)] font-normal">(여러 품목 추가 가능)</span></label>
                    <ItemSelector category={addExpCategory} value={addItems} onChange={setAddItems} />
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                  {addItems.length > 0
                    ? <input type="text" name="detail" value={fmtItemListDetail(addItems)} readOnly
                        className="w-full bg-[var(--canvas)] border border-[var(--coral)]/40 rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none" />
                    : <input type="text" name="detail" value={addExpDetail} onChange={e => setAddExpDetail(e.target.value)} placeholder="세부 내용"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  }
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
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                {addExpMethod === '계좌이체' && bankAccounts.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">출금 계좌</label>
                    <select value={addExpAccId}
                      onChange={e => pickAccount(e.target.value, setAddExpAccId, setAddExpAccName)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
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
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
                    </select>
                  </div>
                )}
                {rooms.length > 0 && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">대상 호실 (선택)</label>
                    <select value={addExpRoomId} onChange={e => setAddExpRoomId(e.target.value)}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="">선택 안함</option>
                      {rooms.map(r => <option key={r.id} value={r.id}>{r.roomNo}호</option>)}
                    </select>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">영수증</label>
                  <input type="hidden" name="receiptUrl" value={addReceiptUrl} />
                  <label className="flex items-center justify-center gap-1.5 w-full bg-[var(--canvas)] border border-dashed border-[var(--warm-border)] rounded-xl px-3 py-2 cursor-pointer hover:border-[var(--coral)] transition-colors">
                    <span className="text-lg">📎</span>
                    <span className="text-xs text-[var(--warm-muted)]">{receiptUploading ? '업로드 중...' : addReceiptUrl ? '파일 변경' : '파일 선택'}</span>
                    <input type="file" accept="image/*,application/pdf" className="hidden" disabled={receiptUploading}
                      onChange={async e => { const f = e.target.files?.[0]; if (f) await handleReceiptUpload(f, setAddReceiptUrl) }} />
                  </label>
                  {addReceiptUrl && (
                    <div className="relative">
                      <img src={addReceiptUrl} className="w-full rounded-xl object-contain max-h-52 border border-[var(--warm-border)]" alt="영수증" />
                      <button type="button" onClick={() => setAddReceiptUrl('')}
                        className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-6 h-6 flex items-center justify-center text-xs leading-none">✕</button>
                    </div>
                  )}
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <button type="button" onClick={() => setShowAddExp(false)}
                  className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">취소</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl border border-transparent transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                  {isPending ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════
          모달: 수익 등록
      ══════════════════════════════════════════════════════════ */}
      {showAddInc && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowAddInc(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">부가 수익 등록</h2>
              <button onClick={() => setShowAddInc(false)} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
            </div>
            <form onSubmit={handleAddInc} className="flex flex-col flex-1 overflow-hidden">
              <input type="hidden" name="financialAccountId" value={addIncAccId} />
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <DatePicker name="date" value={addIncDate} onChange={setAddIncDate}
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                    <MoneyInput name="amount" placeholder="0원" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                  <select name="category"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {incomeCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                  <input type="text" name="detail" placeholder="세부 내용"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">입금수단</label>
                  <select name="payMethod" value={addIncMethod}
                    onChange={e => { setAddIncMethod(e.target.value); setAddIncAccId('') }}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {PAY_METHODS_INC.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <button type="button" onClick={() => setShowAddInc(false)}
                  className="flex-1 inline-flex items-center justify-center py-2.5 min-h-[40px] bg-[var(--canvas)] hover:bg-[var(--warm-border)] text-[var(--warm-dark)] text-sm font-medium rounded-xl border border-[var(--warm-border)] transition-colors">취소</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-green-700 hover:bg-green-600 text-[var(--warm-dark)] text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                  {isPending ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>

    {/* ── 고정 지출 관리 모달 ────────────────────────────────────── */}

    {showRecMgmt && (
      <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm" onClick={e => { if (e.target === e.currentTarget) { setShowRecMgmt(false); setShowRecMgmtForm(false) } }}>
        <div className="bg-[var(--cream)] rounded-2xl w-full max-w-lg max-h-[90dvh] flex flex-col shadow-2xl border border-[var(--warm-border)]">
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
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
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
                      className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리</label>
                  <select value={recMgmtForm.category} onChange={e => setRecMgmtForm(p => ({ ...p, category: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    {expenseCategories.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">알림 (납부일 N일 전)</label>
                  <input type="number" min={0} max={30} value={recMgmtForm.alertDaysBefore}
                    onChange={e => setRecMgmtForm(p => ({ ...p, alertDaysBefore: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                  <p className="text-[10px] text-[var(--warm-muted)]">자동이체 항목은 주말·공휴일이면 다음 영업일 기준으로 알림이 계산됩니다.</p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">활성화 시작일 (선택)</label>
                  <DatePicker value={recMgmtForm.activeSince} onChange={v => setRecMgmtForm(p => ({ ...p, activeSince: v }))}
                    className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
                  <p className="text-[10px] text-[var(--warm-muted)] leading-relaxed">
                    이 항목이 실제로 내 부담이 되는 첫 날짜입니다. 입력하지 않으면 즉시 활성화됩니다.<br />
                    예) 인터넷 요금 결제일 25일이 양도인 부담이면, 다음 달부터 내 부담 → 다음달 25일 입력.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제 수단 (선택)</label>
                  <select value={recMgmtForm.payMethod} onChange={e => setRecMgmtForm(p => ({ ...p, payMethod: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                    <option value="">선택 안 함</option>
                    {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                </div>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recMgmtForm.isAutoDebit} onChange={e => setRecMgmtForm(p => ({ ...p, isAutoDebit: e.target.checked }))} className="accent-[var(--coral)]" />
                    <span className="text-xs text-[var(--warm-dark)]">자동이체</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={recMgmtForm.isVariable} onChange={e => setRecMgmtForm(p => ({ ...p, isVariable: e.target.checked }))} className="accent-[var(--coral)]" />
                    <div>
                      <span className="text-xs text-[var(--warm-dark)]">변동 금액</span>
                      <p className="text-[10px] text-[var(--warm-muted)] mt-0.5">전기·수도 등 매달 달라지는 항목</p>
                    </div>
                  </label>
                </div>
                {recMgmtForm.isVariable && (
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">전년동월 실적 (선택)</label>
                    <MoneyInput value={Number(recMgmtForm.priorYearAmount) || 0} onChange={v => setRecMgmtForm(p => ({ ...p, priorYearAmount: v > 0 ? String(v) : '' }))} placeholder="0원" />
                    <p className="text-[10px] text-[var(--warm-muted)]">작년 같은 달 실제 납부액 — 최근 3개월 평균과 함께 예상치 계산에 반영됩니다.</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모 (선택)</label>
                  <input type="text" value={recMgmtForm.memo} onChange={e => setRecMgmtForm(p => ({ ...p, memo: e.target.value }))}
                    className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                </div>
                {recMgmtError && <p className="text-red-400 text-xs">{recMgmtError}</p>}
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
            ) : (
              <button onClick={openNewRecMgmt}
                className="w-full py-2.5 text-sm font-medium rounded-xl border border-dashed border-[var(--coral)] text-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">
                + 새 항목 추가
              </button>
            )}

            {/* 목록 */}
            {recMgmtLoading ? (
              <p className="text-xs text-[var(--warm-muted)] text-center py-4">불러오는 중...</p>
            ) : recMgmtList.length === 0 && !showRecMgmtForm ? (
              <p className="text-sm text-[var(--warm-muted)] text-center py-3">등록된 고정 지출이 없습니다.</p>
            ) : (
              <div className="space-y-2">
                {recMgmtList.map(r => (
                  <div key={r.id} className={`flex items-center gap-3 rounded-xl px-3 py-2.5 border border-[var(--warm-border)] ${r.isActive ? 'bg-[var(--canvas)]' : 'bg-[var(--canvas)] opacity-50'}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{r.title}</p>
                        {r.isAutoDebit && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-600">자동이체</span>}
                        {!r.isActive && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500">비활성</span>}
                        {r.activeSince && <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-600">{r.activeSince.slice(0, 7)}부터</span>}
                      </div>
                      <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                        매월 {r.dueDay}일 · {r.amount.toLocaleString()}원 · {r.category}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button onClick={() => handleToggleRecMgmt(r)}
                        className="text-[10px] px-2 py-1 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
                        {r.isActive ? '비활성' : '활성화'}
                      </button>
                      <button onClick={() => openEditRecMgmt(r)}
                        className="text-[10px] px-2 py-1 rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">수정</button>
                      <button onClick={() => handleDeleteRecMgmt(r.id, r.title)}
                        className="text-[10px] px-2 py-1 rounded-lg border border-red-200 text-red-400 hover:text-red-600 transition-colors">삭제</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    )}
    {/* ── 고정 지출 기록 모달 ────────────────────────────────────────── */}
    {recordingRec && (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
        onClick={e => { if (e.target === e.currentTarget) { setRecordingRec(null); setRecError('') } }}>
        <div className="bg-[var(--cream)] rounded-2xl w-full max-w-sm shadow-2xl border border-[var(--warm-border)]">
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
                    <span className="ml-1 text-blue-400 text-[10px]">평균 {recordingRec.historicalAvg.toLocaleString()}원</span>
                  )}
                </label>
                <MoneyInput value={recRecAmount} onChange={v => setRecRecAmount(v)} placeholder="0원" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">결제수단</label>
                <select value={recRecPayMethod} onChange={e => setRecRecPayMethod(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                  {!paymentMethods.includes('계좌이체') && <option value="계좌이체">계좌이체</option>}
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-[var(--warm-muted)]">메모</label>
                <input type="text" value={recRecMemo} onChange={e => setRecRecMemo(e.target.value)}
                  placeholder="선택 입력"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              </div>
            </div>
            {recError && <p className="text-red-400 text-xs">{recError}</p>}
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setRecordingRec(null); setRecError('') }}
                className="flex-1 px-4 py-2.5 bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] text-sm rounded-xl">취소</button>
              <button type="button"
                disabled={isPending || !recRecDate || recRecAmount <= 0}
                onClick={() => {
                  setRecError('')
                  startTransition(async () => {
                    const res = await recordRecurringExpense({
                      recurringExpenseId: recordingRec.id,
                      amount: recRecAmount,
                      date: recRecDate,
                      payMethod: recRecPayMethod || undefined,
                      memo: recRecMemo || undefined,
                    })
                    if (!res.ok) { setRecError(res.error); return }
                    setRecordingRec(null)
                    router.refresh()
                  })
                }}
                className="flex-1 px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-semibold rounded-xl disabled:opacity-60 transition-opacity">
                {isPending ? '저장 중...' : '기록 저장'}
              </button>
            </div>
          </div>
        </div>
      </div>
    )}
    </>
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
