'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { savePayment, saveDepositPayment, deletePayment, updatePayment, getPaymentsByLease, setDueDayOverride, clearDueDayOverride } from './actions'
import { useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { formatPhone } from '@/lib/formatPhone'

type RoomStatus = {
  roomId: string
  roomNo: string
  type: string | null
  windowType: string | null
  isVacant: boolean
  tenantId: string | null
  tenantName: string | null
  contact: string | null
  status: string | null
  expected: number
  dueDay: string | null
  currentPaid: number
  carryOver: number
  totalPaid: number
  balance: number
  isPaid: boolean
  leaseTermId: string | null
  depositAmount: number
  accumulatedUnpaid: number
  isFutureMonth: boolean
  baseRent: number
  prevTenantName: string | null
  prevContact: string | null
  overrideDueDay: string | null
  overrideDueDayMonth: string | null
  overrideDueDayReason: string | null
  moveInDate: string | null
}

type PaymentRecord = {
  id: string
  seqNo: number
  payDate: Date
  actualAmount: number
  payMethod: string | null
  memo: string | null
  isPaid: boolean
  isDeposit: boolean
}

// ── 열 설정 ──────────────────────────────────────────────────────

type ColKey = 'type' | 'windowType' | 'contact' | 'depositAmount' | 'expected' | 'totalPaid' | 'balance' | 'dueDay' | 'status'

const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'type',          label: '타입',     defaultOn: false },
  { key: 'windowType',    label: '창문',     defaultOn: false },
  { key: 'contact',       label: '연락처',   defaultOn: true  },
  { key: 'depositAmount', label: '보증금',   defaultOn: false },
  { key: 'expected',      label: '월 이용료', defaultOn: true  },
  { key: 'totalPaid',     label: '총납부액', defaultOn: true  },
  { key: 'balance',       label: '잔액',     defaultOn: true  },
  { key: 'dueDay',        label: '납부일',   defaultOn: true  },
  { key: 'status',        label: '수납 상태', defaultOn: true  },
]

const DEFAULT_VIS = Object.fromEntries(
  COL_DEFS.map(c => [c.key, c.defaultOn])
) as Record<ColKey, boolean>

// ── 공실 열 설정 ──────────────────────────────────────────────────

type VacantColKey = 'type' | 'windowType' | 'baseRent' | 'prevTenantName' | 'prevContact'
type VacantSortKey = 'roomNo' | 'type' | 'windowType' | 'baseRent' | 'prevTenantName'

const VACANT_COL_DEFS: { key: VacantColKey; label: string; defaultOn: boolean }[] = [
  { key: 'type',          label: '타입',       defaultOn: true  },
  { key: 'windowType',    label: '창문',       defaultOn: true  },
  { key: 'baseRent',      label: '기본 월이용료', defaultOn: true  },
  { key: 'prevTenantName', label: '직전 입주자', defaultOn: false },
  { key: 'prevContact',   label: '직전 연락처', defaultOn: false },
]

const DEFAULT_VACANT_VIS = Object.fromEntries(
  VACANT_COL_DEFS.map(c => [c.key, c.defaultOn])
) as Record<VacantColKey, boolean>

const COL_WIDTHS_KEY = 'roomos_rooms_col_widths'

const DEFAULT_WIDTHS: Record<string, number> = {
  roomNo: 80, tenantName: 140,
  contact: 130, type: 80, windowType: 80,
  depositAmount: 100, expected: 110, totalPaid: 110,
  balance: 100, dueDay: 110, status: 130,
}

function loadColWidths(): Record<string, number> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

const WINDOW_LABEL: Record<string, string> = {
  OUTER: '외창',
  INNER: '내창',
}

// 납부일 경과/잔여일 계산
function getDueInfo(dueDay: string | null, targetMonth: string): { days: number; overdue: boolean } | null {
  if (!dueDay) return null
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const dayNum = dueDay === '말일'
    ? new Date(yyyy, mm, 0).getDate()
    : parseInt(dueDay)
  if (isNaN(dayNum)) return null
  const due   = new Date(yyyy, mm - 1, dayNum)
  const today = new Date(); today.setHours(0, 0, 0, 0); due.setHours(0, 0, 0, 0)
  const diff  = Math.round((today.getTime() - due.getTime()) / 86400000)
  return { days: Math.abs(diff), overdue: diff > 0 }
}

// ── 정렬 ─────────────────────────────────────────────────────────

type SortKey = 'roomNo' | 'type' | 'windowType' | 'tenantName' | 'contact'
             | 'depositAmount' | 'expected' | 'totalPaid' | 'balance' | 'status'
type SortDir = 'asc' | 'desc'

function getDueSortValue(room: RoomStatus, targetMonth: string): number {
  const info = getDueInfo(room.dueDay, targetMonth)
  if (!info) return 0
  // overdue → positive (15일 초과 = +15), 잔여 → negative (5일 후 = -5)
  return info.overdue ? info.days : -info.days
}

function getSortValue(room: RoomStatus, key: SortKey, targetMonth: string): string | number {
  switch (key) {
    case 'roomNo':        return room.roomNo
    case 'type':          return room.type ?? ''
    case 'windowType':    return room.windowType ?? ''
    case 'tenantName':    return room.tenantName ?? ''
    case 'contact':       return room.contact ?? ''
    case 'depositAmount': return room.depositAmount
    case 'expected':      return room.expected
    case 'totalPaid':     return room.totalPaid
    case 'balance':       return room.balance
    case 'status':        return getDueSortValue(room, targetMonth)
    default:              return ''
  }
}

// ── 컴포넌트 ─────────────────────────────────────────────────────

export default function RoomsClient({
  roomStatus, targetMonth, myRole
}: {
  roomStatus: RoomStatus[]
  targetMonth: string
  myRole: string
}) {
  const canEdit = myRole === 'OWNER' || myRole === 'MANAGER'
  const router = useRouter()
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([])
  const [payAcquisitionDate, setPayAcquisitionDate] = useState<Date | null>(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showPayForm, setShowPayForm] = useState(false)
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all')
  const [colVis, setColVis] = useState<Record<ColKey, boolean>>(DEFAULT_VIS)
  const [showColMenu, setShowColMenu] = useState(false)
  const [vacantColVis, setVacantColVis] = useState<Record<VacantColKey, boolean>>(DEFAULT_VACANT_VIS)
  const [showVacantColMenu, setShowVacantColMenu] = useState(false)
  const [vacantSortKey, setVacantSortKey] = useState<VacantSortKey>('roomNo')
  const [vacantSortDir, setVacantSortDir] = useState<SortDir>('asc')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [payAmount, setPayAmount] = useState(0)
  const [payDateVal, setPayDateVal] = useState(new Date().toISOString().slice(0, 10))
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [editingPayId, setEditingPayId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')
  const colMenuRef       = useRef<HTMLDivElement>(null)
  const vacantColMenuRef = useRef<HTMLDivElement>(null)
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const colWidthsRef              = useRef<Record<string, number>>(DEFAULT_WIDTHS)

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const handleVacantSort = (key: VacantSortKey) => {
    if (vacantSortKey === key) {
      setVacantSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setVacantSortKey(key)
      setVacantSortDir('asc')
    }
  }

  // 열 설정 드롭다운 외부 클릭 닫기
  useEffect(() => {
    if (!showColMenu) return
    const handleClick = (e: MouseEvent) => {
      if (colMenuRef.current && !colMenuRef.current.contains(e.target as Node)) {
        setShowColMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showColMenu])

  useEffect(() => {
    if (!showVacantColMenu) return
    const handleClick = (e: MouseEvent) => {
      if (vacantColMenuRef.current && !vacantColMenuRef.current.contains(e.target as Node)) {
        setShowVacantColMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showVacantColMenu])

  useEffect(() => {
    const savedW = loadColWidths()
    if (savedW) {
      const merged = { ...DEFAULT_WIDTHS, ...savedW }
      setColWidths(merged)
      colWidthsRef.current = merged
    }
  }, [])

  useEffect(() => { colWidthsRef.current = colWidths }, [colWidths])

  const startResize = useCallback((col: string, startX: number) => {
    const startW = colWidthsRef.current[col] ?? 100
    const onMove = (clientX: number) => {
      const newW = Math.max(50, startW + clientX - startX)
      setColWidths(prev => ({ ...prev, [col]: newW }))
    }
    const onMouseMove = (ev: MouseEvent) => onMove(ev.clientX)
    const onTouchMove = (ev: TouchEvent) => onMove(ev.touches[0].clientX)
    const onEnd = () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidthsRef.current))
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onEnd)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onEnd)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onEnd)
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onEnd)
  }, [])

  const occupied = roomStatus.filter(r => !r.isVacant)
  const vacants  = roomStatus.filter(r => r.isVacant).sort((a, b) =>
    a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })
  )

  const filtered = occupied.filter(r => {
    if (filter === 'unpaid') return !r.isPaid
    if (filter === 'paid')   return r.isPaid
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    // 상태 열일 때만 미납(0)→완납(1)→공실(2) 그룹 고정
    if (sortKey === 'status') {
      const grpA = a.isVacant ? 2 : (a.isPaid ? 1 : 0)
      const grpB = b.isVacant ? 2 : (b.isPaid ? 1 : 0)
      if (grpA !== grpB) return grpA - grpB
    }

    const va = getSortValue(a, sortKey, targetMonth)
    const vb = getSortValue(b, sortKey, targetMonth)
    let cmp = 0
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), 'ko')
    }
    return sortDir === 'asc' ? cmp : -cmp
  })

  const openPayModal = async (room: RoomStatus) => {
    setSelectedRoom(room)
    setPayAmount(room.expected)
    setPayDateVal(new Date().toISOString().slice(0, 10))
    setIsDepositMode(false)
    setError('')
    setShowPayForm(false)
    setShowOverrideForm(false)
    setOverrideInput('')
    setOverrideReason('')
    setEditingPayId(null)
    setPaymentHistory([])
    setShowPayModal(true)
    if (room.leaseTermId) {
      setLoadingHistory(true)
      const { records, acquisitionDate } = await getPaymentsByLease(room.leaseTermId, targetMonth)
      setPaymentHistory(records as PaymentRecord[])
      setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
      setLoadingHistory(false)
    }
  }

  const handleUpdatePayment = (p: PaymentRecord) => {
    setEditingPayId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(new Date(p.payDate).toISOString().slice(0, 10))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
  }

  const handleSaveEdit = async () => {
    if (!editingPayId) return
    startTransition(async () => {
      const res = await updatePayment(editingPayId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
      })
      if (!res.ok) { setError(res.error); return }
      if (selectedRoom?.leaseTermId) {
        const { records, acquisitionDate } = await getPaymentsByLease(selectedRoom.leaseTermId, targetMonth)
        setPaymentHistory(records as PaymentRecord[])
        setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
      }
      setEditingPayId(null)
      router.refresh()
    })
  }

  const handleSavePayment = async (e: { preventDefault(): void; currentTarget: HTMLFormElement }) => {
    e.preventDefault()
    if (!selectedRoom?.leaseTermId) return
    setError('')
    const fd = new FormData(e.currentTarget)
    const payMethod = fd.get('payMethod') as string
    const memo = fd.get('memo') as string
    startTransition(async () => {
      try {
        if (isDepositMode) {
          await saveDepositPayment({
            leaseTermId:   selectedRoom.leaseTermId!,
            tenantId:      selectedRoom.tenantId!,
            targetMonth,
            depositAmount: selectedRoom.depositAmount,
            rentAmount:    selectedRoom.expected,
            totalPaid:     payAmount,
            payDate:       payDateVal,
            payMethod,
            memo:          memo || undefined,
          })
        } else {
          await savePayment({
            leaseTermId:    selectedRoom.leaseTermId!,
            tenantId:       selectedRoom.tenantId!,
            targetMonth,
            expectedAmount: selectedRoom.expected,
            actualAmount:   payAmount,
            payDate:        payDateVal,
            payMethod,
            memo,
          })
        }
        setShowPayForm(false)
        setShowPayModal(false)
        router.refresh()
      } catch (err: unknown) {
        setError((err as Error).message)
      }
    })
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('이 수납 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      try {
        await deletePayment(paymentId)
        setShowPayModal(false)
        router.refresh()
      } catch (err: unknown) {
        setError((err as Error).message)
      }
    })
  }

  function fmtDate(d: Date | string | null | undefined): string {
    if (!d) return '—'
    const dt = new Date(d)
    const DAYS = ['일', '월', '화', '수', '목', '금', '토']
    return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
  }

  // 요약 통계
  const unpaidCount = occupied.filter(r => !r.isPaid).length
  const paidCount   = occupied.filter(r => r.isPaid).length

  const thCls = 'text-left text-xs text-[var(--warm-muted)] font-medium px-4 py-3'

  function ResizableTh({ label, colKey, onClick, isActive, stickyLeft }: {
    label: string; colKey: string; onClick?: () => void; isActive?: boolean; stickyLeft?: number
  }) {
    const w = colWidths[colKey] ?? 100
    return (
      <th
        onClick={onClick}
        className={`relative text-left text-xs font-medium px-4 py-3 select-none overflow-hidden whitespace-nowrap ${
          onClick ? 'cursor-pointer transition-colors' : ''
        } ${isActive ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'} ${
          stickyLeft !== undefined ? 'sticky z-40 bg-[var(--cream)]' : ''
        }`}
        style={{
          width: w, minWidth: w, maxWidth: w,
          ...(stickyLeft !== undefined ? { left: stickyLeft } : {}),
        }}
      >
        <span className="truncate block">{label}{isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        <div
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startResize(colKey, e.clientX) }}
          onTouchStart={e => { e.stopPropagation(); startResize(colKey, e.touches[0].clientX) }}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-[12px] cursor-col-resize group touch-none"
          style={{ userSelect: 'none' }}
        >
          <div className="absolute right-[5px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
        </div>
      </th>
    )
  }

  const SortTh = ({ label, sk }: { label: string; sk: SortKey }) => (
    <ResizableTh
      label={label}
      colKey={sk}
      onClick={() => handleSort(sk)}
      isActive={sortKey === sk}
    />
  )

  const VSortTh = ({ label, sk }: { label: string; sk: VacantSortKey }) => (
    <th onClick={() => handleVacantSort(sk)}
      className={`${thCls} cursor-pointer select-none hover:text-[var(--warm-dark)] whitespace-nowrap`}>
      {label}
      <span className="ml-1 inline-block w-3 text-center">
        {vacantSortKey === sk ? (vacantSortDir === 'asc' ? '↑' : '↓') : ''}
      </span>
    </th>
  )

  const sortedVacants = [...vacants].sort((a, b) => {
    const getVal = (r: typeof a): string | number => {
      switch (vacantSortKey) {
        case 'roomNo':         return r.roomNo
        case 'type':           return r.type ?? ''
        case 'windowType':     return r.windowType ?? ''
        case 'baseRent':       return r.baseRent
        case 'prevTenantName': return r.prevTenantName ?? ''
        default:               return ''
      }
    }
    const va = getVal(a), vb = getVal(b)
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'ko', { numeric: true })
    return vacantSortDir === 'asc' ? cmp : -cmp
  })

  return (
    <div className="space-y-6">
      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">수납 관리</h1>
        <span className="text-sm text-[var(--warm-muted)]">{targetMonth}</span>
      </div>

      {/* 빠른 필터 + 열 설정 */}
      <div className="flex gap-2 flex-wrap items-center">
        {[
          { key: 'all',    label: `전체 ${occupied.length}실` },
          { key: 'unpaid', label: `미납 ${unpaidCount}실` },
          { key: 'paid',   label: `완납 ${paidCount}실` },
        ].map(f => (
          <button key={f.key}
            onClick={() => setFilter(f.key as any)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors
              ${filter === f.key
                ? 'bg-[var(--canvas)] text-[var(--warm-dark)]'
                : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}>
            {f.label}
          </button>
        ))}

        <div className="flex-1" />

        {/* 열 설정 드롭다운 */}
        <div className="relative" ref={colMenuRef}>
          <button
            onClick={() => setShowColMenu(v => !v)}
            className="px-3 py-1.5 bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] text-xs font-medium rounded-xl transition-colors"
          >
            ⚙ 열 설정
          </button>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
              <div className="absolute right-0 mt-2 z-20 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl shadow-xl p-3 space-y-2 min-w-[140px]">
                {COL_DEFS.map(col => (
                  <label key={col.key} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colVis[col.key] ?? false}
                      onChange={e => setColVis(v => ({ ...v, [col.key]: e.target.checked }))}
                      className="w-4 h-4 accent-indigo-500"
                    />
                    <span className="text-sm text-[var(--warm-dark)]">{col.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 수납 현황 테이블 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100dvh-240px)]">
          <table className="w-full" style={{
            tableLayout: 'fixed',
            minWidth: colWidths.roomNo + colWidths.tenantName +
              COL_DEFS.filter(c => colVis[c.key]).reduce((s, c) => s + (colWidths[c.key] ?? 100), 0),
          }}>
            <thead className="sticky top-0 z-30 bg-[var(--cream)]">
              <tr className="border-b border-[var(--warm-border)]">
                <ResizableTh label="호실"   colKey="roomNo"     onClick={() => handleSort('roomNo')}     isActive={sortKey === 'roomNo'}     stickyLeft={0} />
                <ResizableTh label="입주자" colKey="tenantName" onClick={() => handleSort('tenantName')} isActive={sortKey === 'tenantName'} stickyLeft={colWidths.roomNo} />
                {colVis.contact       && <SortTh label="연락처"    sk="contact" />}
                {colVis.type          && <SortTh label="타입"      sk="type" />}
                {colVis.windowType    && <SortTh label="창문"      sk="windowType" />}
                {colVis.depositAmount && <SortTh label="보증금"    sk="depositAmount" />}
                {colVis.expected      && <SortTh label="월 이용료" sk="expected" />}
                {colVis.totalPaid     && <SortTh label="총납부액"  sk="totalPaid" />}
                {colVis.balance       && <SortTh label="잔액"      sk="balance" />}
                {colVis.dueDay        && <ResizableTh label="납부일"    colKey="dueDay" />}
                {colVis.status        && <SortTh label="수납 상태" sk="status" />}
              </tr>
            </thead>
            <tbody>
              {sorted.map(room => (
                <tr key={room.roomId}
                  onClick={() => !room.isFutureMonth && openPayModal(room)}
                  className={`border-b border-[var(--warm-border)]/50 transition-colors
                    ${room.isFutureMonth ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:scale-[0.995] active:opacity-80'}`}>

                  {/* sticky — 호실 */}
                  <td className="px-4 py-4 text-sm font-bold text-[var(--coral)] overflow-hidden sticky left-0 z-20 bg-[var(--cream)]"
                    style={{ width: colWidths.roomNo, minWidth: colWidths.roomNo, maxWidth: colWidths.roomNo }}>
                    <span className="truncate block">{room.roomNo}호</span>
                  </td>
                  {/* sticky — 입주자 */}
                  <td className="px-4 py-4 text-sm font-medium text-[var(--warm-dark)] overflow-hidden sticky z-20 bg-[var(--cream)]"
                    style={{ left: colWidths.roomNo, width: colWidths.tenantName, minWidth: colWidths.tenantName, maxWidth: colWidths.tenantName }}>
                    <span className="truncate block">{room.tenantName}</span>
                  </td>

                  {colVis.contact && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)]">
                      {room.contact ? formatPhone(room.contact) : '—'}
                    </td>
                  )}

                  {colVis.type && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)]">{room.type ?? '—'}</td>
                  )}

                  {colVis.windowType && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)]">
                      {room.windowType ? (WINDOW_LABEL[room.windowType] ?? room.windowType) : '—'}
                    </td>
                  )}

                  {colVis.depositAmount && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-dark)]">
                      <MoneyDisplay amount={room.depositAmount} />
                    </td>
                  )}

                  {colVis.expected && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-dark)]">
                      <MoneyDisplay amount={room.expected} />
                    </td>
                  )}

                  {colVis.totalPaid && (
                    <td className="px-4 py-4 text-sm">
                      <span className="text-[var(--warm-dark)]"><MoneyDisplay amount={room.totalPaid} /></span>
                      {room.carryOver > 0 && (
                        <span className="text-xs text-[var(--coral)] ml-1">(+이월액 <MoneyDisplay amount={room.carryOver} />)</span>
                      )}
                    </td>
                  )}

                  {colVis.balance && (
                    <td className="px-4 py-4 text-sm font-semibold">
                      <span className={room.balance >= 0 ? 'text-emerald-600' : 'text-red-500'}>
                        {room.balance > 0
                          ? <MoneyDisplay amount={room.balance} prefix="+" />
                          : room.balance < 0
                            ? <MoneyDisplay amount={Math.abs(room.balance)} prefix="-" />
                            : '0원'}
                      </span>
                    </td>
                  )}

                  {colVis.dueDay && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)] whitespace-nowrap">
                      {room.dueDay
                        ? room.dueDay === '말일' ? '매월 말일' : `매월 ${room.dueDay}일`
                        : '—'}
                    </td>
                  )}

                  {colVis.status && (
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 items-center text-center">
                        {room.status === 'NON_RESIDENT' && (
                          <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200 mb-0.5">
                            비거주
                          </span>
                        )}
                        <span className={`text-xs px-2.5 py-1 rounded-full font-medium
                          ${room.isPaid ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-600 ring-1 ring-red-200'}`}>
                          {room.isPaid ? '완납' : '미납'}
                        </span>
                        {!room.isPaid && (() => {
                          const info = getDueInfo(room.dueDay, targetMonth)
                          if (!info) return null
                          if (info.days === 0) return (
                            <span className="text-xs text-orange-600 font-medium">오늘</span>
                          )
                          return info.overdue
                            ? <span className="text-xs text-red-400">{info.days}일 초과</span>
                            : <span className="text-xs text-yellow-600">{info.days}일 후</span>
                        })()}
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
      </div>

      {/* 공실 섹션 */}
      {vacants.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--warm-muted)]">공실 {vacants.length}실</h2>
            <div className="relative" ref={vacantColMenuRef}>
              <button
                onClick={() => setShowVacantColMenu(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors
                  ${showVacantColMenu ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}
              >
                <span>⚙</span> 열 설정
              </button>
              {showVacantColMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-3 z-20 shadow-xl min-w-[160px] space-y-2">
                  {VACANT_COL_DEFS.map(col => (
                    <label key={col.key} className="flex items-center gap-2.5 cursor-pointer group">
                      <input type="checkbox" checked={vacantColVis[col.key] ?? false}
                        onChange={e => setVacantColVis(v => ({ ...v, [col.key]: e.target.checked }))}
                        className="w-3.5 h-3.5 rounded accent-indigo-500" />
                      <span className="text-xs text-[var(--warm-dark)] group-hover:text-[var(--warm-dark)] transition-colors">{col.label}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-64">
            <table className="w-full min-w-[400px]">
              <thead className="sticky top-0 z-10 bg-[var(--cream)]">
                <tr className="border-b border-[var(--warm-border)]">
                  <VSortTh label="호실" sk="roomNo" />
                  {vacantColVis.type           && <VSortTh label="타입"          sk="type" />}
                  {vacantColVis.windowType     && <VSortTh label="창문"          sk="windowType" />}
                  {vacantColVis.baseRent       && <VSortTh label="기본 월이용료" sk="baseRent" />}
                  {vacantColVis.prevTenantName && <VSortTh label="직전 입주자"   sk="prevTenantName" />}
                  {vacantColVis.prevContact    && <th className={thCls}>직전 연락처</th>}
                </tr>
              </thead>
              <tbody>
                {sortedVacants.map(room => (
                  <tr key={room.roomId} className="border-b border-[var(--warm-border)]/50">
                    <td className="px-4 py-3 text-sm font-bold text-[var(--warm-mid)]">{room.roomNo}호</td>
                    {vacantColVis.type && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.type ?? '—'}</td>
                    )}
                    {vacantColVis.windowType && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">
                        {room.windowType ? (WINDOW_LABEL[room.windowType] ?? room.windowType) : '—'}
                      </td>
                    )}
                    {vacantColVis.baseRent && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-dark)]">
                        {room.baseRent > 0 ? <MoneyDisplay amount={room.baseRent} /> : '—'}
                      </td>
                    )}
                    {vacantColVis.prevTenantName && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-mid)]">{room.prevTenantName ?? '—'}</td>
                    )}
                    {vacantColVis.prevContact && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-mid)]">
                        {room.prevContact ? formatPhone(room.prevContact) : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 수납 모달 */}
      {showPayModal && selectedRoom && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => { setShowPayModal(false); setShowPayForm(false) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-md flex flex-col max-h-[88vh]"
            onClick={e => e.stopPropagation()}>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <div>
                <h2 className="text-base font-bold text-[var(--warm-dark)]">
                  {selectedRoom.roomNo}호 — {selectedRoom.tenantName}
                </h2>
                <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                  예정 {selectedRoom.expected.toLocaleString()}원
                  {selectedRoom.dueDay && ` · ${selectedRoom.dueDay}일`}
                </p>
              </div>
              <button onClick={() => { setShowPayModal(false); setShowPayForm(false) }}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
            </div>

            {/* ── 읽기 전용 ── */}
            {!showPayForm && (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-5">
                  {/* 잔액 요약 */}
                  <div className="grid grid-cols-3 gap-2">
                    <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                      <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
                      <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]">
                        <MoneyDisplay amount={selectedRoom.totalPaid} />
                      </p>
                    </div>
                    <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                      <p className="text-xs text-[var(--warm-muted)]">잔액</p>
                      <p className={`text-sm font-bold mt-0.5 ${selectedRoom.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {selectedRoom.balance > 0
                          ? <MoneyDisplay amount={selectedRoom.balance} prefix="+" />
                          : selectedRoom.balance < 0
                            ? <MoneyDisplay amount={Math.abs(selectedRoom.balance)} prefix="-" />
                            : '0원'}
                      </p>
                    </div>
                    <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                      <p className="text-xs text-[var(--warm-muted)]">이월액</p>
                      <p className="text-sm font-bold mt-0.5 text-[var(--coral)]">
                        {selectedRoom.carryOver !== 0
                          ? <MoneyDisplay amount={Math.abs(selectedRoom.carryOver)} prefix={selectedRoom.carryOver > 0 ? '+' : '-'} />
                          : '0원'}
                      </p>
                    </div>
                  </div>

                  {/* 납부 내역 */}
                  {(loadingHistory || paymentHistory.length > 0) && (() => {
                    const isPreAcq = (p: PaymentRecord) => !!(payAcquisitionDate && new Date(p.payDate) < payAcquisitionDate)
                    const prevOwnerPaid = paymentHistory.filter(p => !p.isDeposit && isPreAcq(p)).reduce((s, p) => s + p.actualAmount, 0)
                    return (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[var(--warm-mid)]">납부 내역</p>
                        {loadingHistory && (
                          <div className="flex items-center justify-center py-4">
                            <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        {!loadingHistory && prevOwnerPaid > 0 && (
                          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            <p className="text-xs text-amber-700">이전 원장 귀속 (인수일 이전 납부)</p>
                            <p className="text-xs font-semibold text-amber-700">{prevOwnerPaid.toLocaleString()}원</p>
                          </div>
                        )}
                        {!loadingHistory && paymentHistory.map(p => {
                          const prevOwner = !p.isDeposit && isPreAcq(p)
                          if (editingPayId === p.id) {
                            return (
                              <div key={p.id} className="rounded-xl border border-[var(--coral)] bg-[var(--canvas)] px-3 py-2.5 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">금액</p>
                                    <input type="text" inputMode="numeric"
                                      value={editAmount.toLocaleString()}
                                      onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                                      className="w-full bg-white border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">납부일</p>
                                    <input type="date" value={editDate} onChange={e => setEditDate(e.target.value)}
                                      className="w-full bg-white border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[var(--coral)]" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">납부방법</p>
                                    <input type="text" value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                                      placeholder="계좌이체, 현금…"
                                      className="w-full bg-white border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[var(--coral)]" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">메모</p>
                                    <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                                      className="w-full bg-white border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm outline-none focus:border-[var(--coral)]" />
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => setEditingPayId(null)}
                                    className="text-xs text-[var(--warm-mid)] hover:text-[var(--warm-dark)] px-3 py-1.5 rounded-lg border border-[var(--warm-border)] transition-colors">
                                    취소
                                  </button>
                                  <button onClick={handleSaveEdit} disabled={isPending}
                                    className="text-xs text-white bg-[var(--coral)] hover:bg-[var(--coral-dark)] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">
                                    저장
                                  </button>
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={p.id}
                              className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${
                                p.isDeposit ? 'bg-purple-50 border border-purple-200' :
                                prevOwner ? 'bg-amber-50 border border-amber-200' : 'bg-[var(--canvas)]'
                              }`}>
                              <div>
                                <p className={`text-xs ${p.isDeposit ? 'text-purple-600' : prevOwner ? 'text-amber-600' : 'text-[var(--warm-mid)]'}`}>
                                  {p.seqNo}회차 · {fmtDate(p.payDate)} · {p.payMethod ?? '—'}
                                  {p.isDeposit && <span className="ml-1.5 text-[10px] font-semibold bg-purple-200 text-purple-800 rounded px-1 py-0.5">보증금</span>}
                                  {prevOwner && <span className="ml-1.5 text-[10px] font-semibold bg-amber-200 text-amber-800 rounded px-1 py-0.5">이전 원장</span>}
                                </p>
                                {p.memo && !p.isDeposit && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${p.isDeposit ? 'text-purple-700' : prevOwner ? 'text-amber-700' : 'text-[var(--warm-dark)]'}`}>
                                  {p.actualAmount.toLocaleString()}원
                                </span>
                                {canEdit && (
                                  <>
                                    <button onClick={() => handleUpdatePayment(p)}
                                      className="text-xs text-[var(--warm-mid)] hover:text-[var(--coral)] transition-colors">
                                      수정
                                    </button>
                                    <button onClick={() => handleDeletePayment(p.id)}
                                      className="text-xs text-red-600 hover:text-red-700 transition-colors">
                                      ✕
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>

                {/* 납부일 임시 조정 */}
                {selectedRoom.leaseTermId && (
                  <div className="border-t border-amber-200 px-6 py-3 shrink-0 bg-amber-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-amber-400">납부일 임시 조정</p>
                        {selectedRoom.overrideDueDayMonth === targetMonth && selectedRoom.overrideDueDay ? (
                          <p className="text-xs text-amber-700 mt-0.5">
                            이번 달 납부일: <span className="font-bold">{selectedRoom.overrideDueDay}일</span>
                            {selectedRoom.overrideDueDayReason && ` (${selectedRoom.overrideDueDayReason})`}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--warm-muted)] mt-0.5">이번 달 임시 조정 없음</p>
                        )}
                      </div>
                      <div className="flex gap-1.5">
                        {canEdit && selectedRoom.overrideDueDayMonth === targetMonth && selectedRoom.overrideDueDay && (
                          <button
                            onClick={() => startTransition(async () => {
                              await clearDueDayOverride(selectedRoom.leaseTermId!)
                              setShowOverrideForm(false)
                              router.refresh()
                            })}
                            className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded-lg border border-red-200 hover:border-red-400 transition-colors">
                            해제
                          </button>
                        )}
                        {canEdit && (
                          <button
                            onClick={() => {
                              setShowOverrideForm(v => !v)
                              setOverrideInput(selectedRoom.overrideDueDayMonth === targetMonth ? (selectedRoom.overrideDueDay ?? '') : '')
                              setOverrideReason(selectedRoom.overrideDueDayMonth === targetMonth ? (selectedRoom.overrideDueDayReason ?? '') : '')
                            }}
                            className="text-xs text-amber-600 hover:text-amber-700 px-2 py-1 rounded-lg border border-amber-200 hover:border-amber-400 transition-colors">
                            {showOverrideForm ? '닫기' : (selectedRoom.overrideDueDayMonth === targetMonth && selectedRoom.overrideDueDay ? '수정' : '조정하기')}
                          </button>
                        )}
                      </div>
                    </div>
                    {showOverrideForm && (
                      <div className="mt-3 space-y-2">
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-xs text-[var(--warm-muted)]">조정 납부일</label>
                            <input
                              type="text" inputMode="numeric" placeholder="예: 15 또는 말일"
                              value={overrideInput}
                              onChange={e => setOverrideInput(e.target.value)}
                              className="w-full bg-[var(--canvas)] border border-amber-200 rounded-lg px-3 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-amber-500" />
                          </div>
                          <div className="flex-1 space-y-1">
                            <label className="text-xs text-[var(--warm-muted)]">사유 (선택)</label>
                            <input
                              type="text" placeholder="사유"
                              value={overrideReason}
                              onChange={e => setOverrideReason(e.target.value)}
                              className="w-full bg-[var(--canvas)] border border-amber-200 rounded-lg px-3 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-amber-500" />
                          </div>
                        </div>
                        <button
                          disabled={!overrideInput.trim() || isPending}
                          onClick={() => startTransition(async () => {
                            await setDueDayOverride(selectedRoom.leaseTermId!, targetMonth, overrideInput.trim(), overrideReason.trim() || undefined)
                            setShowOverrideForm(false)
                            router.refresh()
                          })}
                          className="w-full py-1.5 bg-amber-700 hover:bg-amber-600 disabled:opacity-50 text-[var(--warm-dark)] text-xs font-medium rounded-lg transition-colors">
                          저장
                        </button>
                      </div>
                    )}
                  </div>
                )}

                {/* 읽기 전용 푸터 */}
                {canEdit && (
                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <div className="flex-1" />
                    <button
                      onClick={() => { setShowPayForm(true); setError('') }}
                      className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
                      수납 등록
                    </button>
                  </div>
                )}
              </>
            )}

            {/* ── 수납 등록 폼 ── */}
            {showPayForm && (
              <form onSubmit={handleSavePayment} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                      <input type="date" name="payDate"
                        value={payDateVal}
                        onChange={e => setPayDateVal(e.target.value)}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">금액</label>
                      <MoneyInput name="amount" value={payAmount} onChange={setPayAmount} placeholder="0원" />
                    </div>
                  </div>
                  {selectedRoom.depositAmount > 0 && (
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isDepositMode}
                          onChange={e => {
                            const checked = e.target.checked
                            setIsDepositMode(checked)
                            if (checked) {
                              setPayAmount(selectedRoom.depositAmount)
                              setPayDateVal(selectedRoom.moveInDate ?? new Date().toISOString().slice(0, 10))
                            } else {
                              setPayDateVal(new Date().toISOString().slice(0, 10))
                            }
                          }}
                          className="w-4 h-4 accent-[var(--coral)]"
                        />
                        <span className="text-xs text-[var(--warm-mid)]">
                          보증금 수납 ({selectedRoom.depositAmount.toLocaleString()}원)
                        </span>
                      </label>
                      {isDepositMode && payAmount > selectedRoom.depositAmount && (
                        <p className="text-xs text-emerald-600">
                          초과금 {(payAmount - selectedRoom.depositAmount).toLocaleString()}원 → {targetMonth} 이용료 처리
                        </p>
                      )}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
                    <select name="payMethod"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="계좌이체">계좌이체</option>
                      <option value="현금">현금</option>
                      <option value="신용카드">신용카드</option>
                      <option value="기타">기타</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[var(--warm-muted)]">메모</label>
                    <input type="text" name="memo" placeholder="메모 (선택)"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
                  </div>
                  {error && <p className="text-red-400 text-sm">{error}</p>}
                </div>

                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <button type="button" onClick={() => { setShowPayForm(false); setError('') }}
                    className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                    취소
                  </button>
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
    </div>
  )
}
