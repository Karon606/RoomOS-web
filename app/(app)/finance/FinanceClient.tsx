'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import {
  addExpense, updateExpense, deleteExpense,
  addExtraIncome, updateExtraIncome, deleteExtraIncome,
  settleCardExpenses, unsettleExpenses,
  saveFinancialAccount, deleteFinancialAccount, deactivateFinancialAccount,
} from './actions'
import { useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { MoneyInput } from '@/components/ui/MoneyInput'

// ── Types ───────────────────────────────────────────────────────

type FAcc = { brand: string; alias: string | null }

type Expense = {
  id: string; date: Date; amount: number; category: string
  detail: string | null; memo: string | null; payMethod: string | null
  settleStatus: string; financeName: string | null
  financialAccountId: string | null; financialAccount: FAcc | null
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

const EXPENSE_CATEGORIES = ['관리비', '수선유지', '세금', '인건비', '소모품', '보증금 반환', '기타']
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

// ── Helpers ──────────────────────────────────────────────────────

function toDateInput(d: Date | string | null | undefined) {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
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

export default function FinanceClient({
  expenses, incomes, financialAccounts, unsettledExpenses, settledCardExpenses, incomeCategories, targetMonth,
}: {
  expenses: Expense[]
  incomes: Income[]
  financialAccounts: FinancialAccount[]
  unsettledExpenses: UnsettledExpense[]
  settledCardExpenses: UnsettledExpense[]
  incomeCategories: string[]
  targetMonth: string
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
  const [detailExp, setDetailExp]         = useState<Expense | null>(null)
  const [detailExpEdit, setDetailExpEdit] = useState(false)
  const [addExpMethod, setAddExpMethod]   = useState('계좌이체')
  const [addExpAccId, setAddExpAccId]     = useState('')
  const [addExpAccName, setAddExpAccName] = useState('')
  const [editExpMethod, setEditExpMethod]   = useState('계좌이체')
  const [editExpAccId, setEditExpAccId]     = useState('')
  const [editExpAccName, setEditExpAccName] = useState('')

  // ── 수익 탭 상태 ─────────────────────────────────────────────
  const [incFilter, setIncFilter] = useState({ method: 'all', category: 'all' })
  const [showAddInc, setShowAddInc]       = useState(false)
  const [detailInc, setDetailInc]         = useState<Income | null>(null)
  const [detailIncEdit, setDetailIncEdit] = useState(false)
  const [addIncMethod, setAddIncMethod]   = useState('계좌이체')
  const [addIncAccId, setAddIncAccId]     = useState('')
  const [editIncMethod, setEditIncMethod]   = useState('계좌이체')
  const [editIncAccId, setEditIncAccId]     = useState('')

  // ── 자산 탭 상태 ─────────────────────────────────────────────
  const [editingAcc, setEditingAcc]     = useState<FinancialAccount | null>(null)
  const [assetType, setAssetType]       = useState('BANK_ACCOUNT')
  const [assetBrand, setAssetBrand]     = useState('')
  const [assetError, setAssetError]     = useState('')
  const [assetFormKey, setAssetFormKey] = useState(0)

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

  const handleAddExp = (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await addExpense(fd)
      if (!res.ok) { setError(res.error); return }
      setShowAddExp(false); router.refresh()
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
      setShowAddInc(false); router.refresh()
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
  const monthLabel = `${yyyy}년 ${parseInt(mm)}월`

  const TABS: { key: Tab; label: string }[] = [
    { key: 'expense', label: '지출 내역' },
    { key: 'income',  label: '부가 수익' },
    { key: 'settle',  label: `카드 정산${unsettledExpenses.length > 0 ? ` (${unsettledExpenses.length})` : ''}` },
    { key: 'assets',  label: `자산 관리${financialAccounts.length > 0 ? ` (${financialAccounts.length})` : ''}` },
  ]

  return (
    <div className="space-y-5">

      {/* 헤더 */}
      <h1 className="text-xl font-bold text-[var(--warm-dark)]">지출/기타 수익</h1>

      {/* 서브탭 */}
      <div className="flex gap-1 border-b border-[var(--warm-border)] overflow-x-auto scrollbar-hide">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap transition-colors rounded-t-xl
              ${tab === t.key
                ? 'text-[var(--coral)] border-b-2 border-[var(--coral)] bg-[var(--cream)]'
                : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════════
          탭 1: 지출 내역
      ══════════════════════════════════════════════════════════ */}
      {tab === 'expense' && (
        <div className="space-y-4">
          <h2 className="text-sm font-semibold text-[var(--warm-mid)]">{monthLabel} 지출 내역</h2>
          {/* 필터 + 합계 + 추가 버튼 */}
          <div className="flex flex-wrap items-center gap-2">
            <select value={expFilter.method} onChange={e => setExpFilter(f => ({ ...f, method: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
              <option value="all">결제수단 (전체)</option>
              {PAY_METHODS_EXP.map(m => <option key={m} value={m}>{m}</option>)}
            </select>
            <select value={expFilter.category} onChange={e => setExpFilter(f => ({ ...f, category: e.target.value }))}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] text-xs rounded-full px-3 py-1.5 outline-none">
              <option value="all">카테고리 (전체)</option>
              {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
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
            <button onClick={() => { setShowAddExp(true); setAddExpMethod('계좌이체'); setAddExpAccId(''); setAddExpAccName(''); setError('') }}
              className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
              + 지출 등록
            </button>
          </div>

          {/* 지출 목록 */}
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100vh-340px)]">
            {filteredExpenses.length === 0 ? (
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
                    <ResizableTh label="정산상태" colKey="expSettle" />
                  </tr>
                </thead>
                <tbody>
                  {filteredExpenses.map(e => (
                    <tr key={e.id}
                      onClick={() => { setDetailExp(e); setDetailExpEdit(false); setError('') }}
                      className="border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 transition-colors cursor-pointer">
                      <td className="px-4 py-3 text-xs text-[var(--warm-mid)] overflow-hidden">
                        <span className="truncate block">{fmtDate(e.date)}</span>
                      </td>
                      <td className="px-4 py-3 overflow-hidden">
                        <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--canvas)] text-[var(--warm-dark)] whitespace-nowrap">{e.payMethod ?? '—'}</span>
                        {e.financialAccount && (
                          <div className="text-xs text-[var(--warm-muted)] mt-0.5 truncate">{accName(e.financialAccount)}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 overflow-hidden">
                        <span className="inline-flex items-center text-xs px-2 py-1 rounded-full bg-[var(--coral-pale)] text-[var(--coral)] ring-1 ring-[var(--coral)]/20 whitespace-nowrap">{e.category}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--warm-dark)] overflow-hidden">
                        <span className="truncate block">{e.detail ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 text-sm font-semibold text-red-500 overflow-hidden">
                        <span className="truncate block"><MoneyDisplay amount={e.amount} prefix="-" /></span>
                      </td>
                      <td className="px-4 py-3 overflow-hidden">
                        <span className={`inline-flex items-center text-xs px-2 py-1 rounded-full font-medium ring-1 whitespace-nowrap
                          ${e.settleStatus === 'UNSETTLED'
                            ? 'bg-red-50 text-red-600 ring-red-200'
                            : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                          {e.settleStatus === 'UNSETTLED' ? '미정산' : '정산완료'}
                        </span>
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

          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100vh-340px)]">
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
                        <MoneyDisplay amount={g.total} />
                      </span>
                    </div>

                    {/* 지출 목록 */}
                    <div className="max-h-40 overflow-y-auto space-y-1.5">
                      {g.items.map(item => (
                        <div key={item.id} className="flex items-center justify-between text-xs">
                          <span className="text-[var(--warm-mid)]">
                            {new Date(item.date).toLocaleDateString('ko-KR', { month: 'numeric', day: 'numeric' })}
                            &nbsp;
                            <span className="text-[var(--warm-muted)]">{item.category}</span>
                            {item.detail && <span className="text-[var(--warm-muted)]"> · {item.detail}</span>}
                          </span>
                          <span className="text-[var(--warm-dark)] font-medium font-mono">
                            <MoneyDisplay amount={item.amount} />
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
                    defaultValue={editingAcc?.payDay ? displayDay(editingAcc.payDay) : ''}
                    placeholder="예: 15, 말일"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
              )}
              {assetType === 'CREDIT_CARD' && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">이용종료일 (결제 기준일)</label>
                    <input type="text" name="cutOffDay"
                      defaultValue={editingAcc?.cutOffDay ? displayDay(editingAcc.cutOffDay) : ''}
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
                    className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                    취소
                  </button>
                )}
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
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
              <div className="divide-y divide-gray-800">
                {financialAccounts.map(a => (
                  <div key={a.id} className="px-5 py-4 flex items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                          ${a.type === 'BANK_ACCOUNT'
                            ? 'bg-blue-500/15 text-blue-400'
                            : a.type === 'CREDIT_CARD'
                            ? 'bg-red-500/15 text-red-400'
                            : 'bg-yellow-500/15 text-yellow-400'}`}>
                          {ACCOUNT_TYPE_LABEL[a.type]}
                        </span>
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
                  <DetailRow label="세부 항목"   value={detailExp.detail ?? '—'} />
                  <DetailRow label="금액"        value={<span className="text-red-400 font-semibold"><MoneyDisplay amount={detailExp.amount} prefix="-" /></span>} />
                  <DetailRow label="결제수단"    value={detailExp.payMethod ?? '—'} />
                  {detailExp.financeName && <DetailRow label="금융사" value={detailExp.financeName} />}
                  <DetailRow label="정산상태"    value={
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ring-1 ${detailExp.settleStatus === 'UNSETTLED' ? 'bg-red-50 text-red-600 ring-red-200' : 'bg-emerald-50 text-emerald-700 ring-emerald-200'}`}>
                      {detailExp.settleStatus === 'UNSETTLED' ? '미정산' : '정산완료'}
                    </span>
                  } />
                  {detailExp.memo && <DetailRow label="메모" value={detailExp.memo} />}
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
                    setEditExpMethod(detailExp.payMethod ?? '계좌이체')
                    setEditExpAccId(detailExp.financialAccountId ?? '')
                    setEditExpAccName(detailExp.financeName ?? '')
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
                <div className="flex-1 overflow-y-auto p-6 space-y-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                      <input type="date" name="date" defaultValue={toDateInput(detailExp.date)} required
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">금액 *</label>
                      <MoneyInput name="amount" defaultValue={detailExp.amount} placeholder="0원" />
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리 *</label>
                    <select name="category" defaultValue={detailExp.category}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                    <input type="text" name="detail" defaultValue={detailExp.detail ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
                    <select name="payMethod" value={editExpMethod}
                      onChange={e => { setEditExpMethod(e.target.value); setEditExpAccId(''); setEditExpAccName('') }}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      {PAY_METHODS_EXP.map(m => <option key={m} value={m}>{m}</option>)}
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
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                    <input type="text" name="memo" defaultValue={detailExp.memo ?? ''}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button type="button" onClick={() => { setDetailExpEdit(false); setError('') }}
                    className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">취소</button>
                  <button type="submit" disabled={isPending}
                    className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
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
                      <input type="date" name="date" defaultValue={toDateInput(detailInc.date)} required
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
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
                    className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">취소</button>
                  <button type="submit" disabled={isPending}
                    className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
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
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">날짜 *</label>
                    <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
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
                    {EXPENSE_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">세부 항목</label>
                  <input type="text" name="detail" placeholder="세부 내용"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
                  <select name="payMethod" value={addExpMethod}
                    onChange={e => { setAddExpMethod(e.target.value); setAddExpAccId(''); setAddExpAccName('') }}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {PAY_METHODS_EXP.map(m => <option key={m} value={m}>{m}</option>)}
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
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
                  <input type="text" name="memo" placeholder="메모 (선택)"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                </div>
                {error && <p className="text-red-400 text-sm">{error}</p>}
              </div>
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <button type="button" onClick={() => setShowAddExp(false)}
                  className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">취소</button>
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
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
                    <input type="date" name="date" defaultValue={new Date().toISOString().slice(0, 10)} required
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
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
                  className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">취소</button>
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
