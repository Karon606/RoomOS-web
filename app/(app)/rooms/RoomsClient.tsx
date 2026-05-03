'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { savePayment, saveDepositPayment, deletePayment, updatePayment, getPaymentsByLease, setDueDayOverride, clearDueDayOverride, getTenantQuickInfo, getRoomQuickInfo } from './actions'
import { useRouter, useSearchParams } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { formatPhone } from '@/lib/formatPhone'
import { kstYmdStr } from '@/lib/kstDate'
import { useUrlState } from '@/lib/useUrlState'

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
  prevPaidThisMonth: boolean
  firstUnpaidMonth: string | null
  cycleStatus: {
    type: 'paid' | 'today' | 'overdue'
    daysToNextDue: number
    daysOverdue: number
    nextDueDate: string | null
    earliestUnpaidDate: string | null
    requiredCycles: number
    paidCycles: number
  } | null
}

type PaymentRecord = {
  id: string
  seqNo: number
  payDate: Date
  targetMonth: string
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
  // 다음달 지정 전체 날짜 (YYYY-MM-DD)
  if (dueDay.includes('-')) {
    const due   = new Date(dueDay + 'T00:00:00')
    const today = new Date(); today.setHours(0, 0, 0, 0); due.setHours(0, 0, 0, 0)
    const diff  = Math.round((today.getTime() - due.getTime()) / 86400000)
    return { days: Math.abs(diff), overdue: diff > 0 }
  }
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const dayNum = dueDay.includes('말')
    ? new Date(yyyy, mm, 0).getDate()
    : parseInt(dueDay)
  if (isNaN(dayNum)) return null
  const due   = new Date(yyyy, mm - 1, dayNum)
  const today = new Date(); today.setHours(0, 0, 0, 0); due.setHours(0, 0, 0, 0)
  const diff  = Math.round((today.getTime() - due.getTime()) / 86400000)
  return { days: Math.abs(diff), overdue: diff > 0 }
}

function getEffectiveDueInfo(room: RoomStatus, targetMonth: string): ReturnType<typeof getDueInfo> {
  // 누적 미납자는 첫 미납월의 dueDay 기준으로 경과일 표시.
  // override는 그 override가 지정된 월(overrideDueDayMonth)에만 적용 — 미납월이
  // 그 달이면 어느 화면에서 보든 override를 사용해야 함.
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  const isOverrideActive = room.overrideDueDayMonth === dueMonth && !!room.overrideDueDay
  const effectiveDay = isOverrideActive ? room.overrideDueDay : room.dueDay
  return getDueInfo(effectiveDay, dueMonth)
}

// ── 정렬 ─────────────────────────────────────────────────────────

type SortKey = 'roomNo' | 'type' | 'windowType' | 'tenantName' | 'contact'
             | 'depositAmount' | 'expected' | 'totalPaid' | 'balance' | 'status' | 'dueDay'
type SortDir = 'asc' | 'desc'

function getDueSortValue(room: RoomStatus, targetMonth: string): number {
  const info = getEffectiveDueInfo(room, targetMonth)
  if (!info) return 0
  return info.overdue ? info.days : -info.days
}

function getEffectiveDueDayNum(room: RoomStatus, targetMonth: string): number {
  const isOverrideActive = room.overrideDueDayMonth === targetMonth && !!room.overrideDueDay
  const effectiveDay = isOverrideActive ? room.overrideDueDay : room.dueDay
  if (!effectiveDay) return 99
  if (effectiveDay.includes('-')) return parseInt(effectiveDay.split('-')[2]) || 99
  if (effectiveDay.includes('말')) return 32
  const d = parseInt(effectiveDay)
  return isNaN(d) ? 99 : d
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
    case 'dueDay':        return getEffectiveDueDayNum(room, targetMonth)
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
  const searchParams = useSearchParams()
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null)
  // 입주자/호실 정보 인라인 모달 (수납 모달은 그대로 유지된 채 위에 겹침)
  const [tenantInfoId, setTenantInfoId] = useState<string | null>(null)
  const [roomInfoId, setRoomInfoId]     = useState<string | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([])
  const [payAcquisitionDate, setPayAcquisitionDate] = useState<Date | null>(null)
  const [showPayModal, setShowPayModal] = useState(false)
  const [showPayForm, setShowPayForm] = useState(false)
  const [toast, setToast] = useState<string | null>(null)

  // viewMonth 변경 시 stale modal 자동 닫기
  useEffect(() => {
    setShowPayModal(false)
    setShowPayForm(false)
    setSelectedRoom(null)
    setPaymentHistory([])
  }, [targetMonth])

  // 토스트 자동 사라짐
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 5000)
    return () => clearTimeout(t)
  }, [toast])
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'paid'>('all')
  const [colVis, setColVis] = useState<Record<ColKey, boolean>>(DEFAULT_VIS)
  const [showColMenu, setShowColMenu] = useState(false)
  const [vacantColVis, setVacantColVis] = useState<Record<VacantColKey, boolean>>(DEFAULT_VACANT_VIS)
  const [showVacantColMenu, setShowVacantColMenu] = useState(false)
  const [vacantSortKey, setVacantSortKey] = useState<VacantSortKey>('roomNo')
  const [vacantSortDir, setVacantSortDir] = useState<SortDir>('asc')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useUrlState('q', '')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [confirmClearOverride, setConfirmClearOverride] = useState(false)
  const [overrideDateInput, setOverrideDateInput] = useState('')
  const [overrideReason, setOverrideReason] = useState('')
  const [payAmount, setPayAmount] = useState(0)
  const [payDateVal, setPayDateVal] = useState(kstYmdStr())
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [editingPayId, setEditingPayId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')
  const [editingAutoPay, setEditingAutoPay] = useState(false)
  const [autoPayDate, setAutoPayDate] = useState('')
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

  const q = search.trim().toLowerCase()
  const displayed = q
    ? sorted.filter(r =>
        r.roomNo.toLowerCase().includes(q) ||
        (r.tenantName ?? '').toLowerCase().includes(q)
      )
    : sorted

  const openPayModal = async (room: RoomStatus) => {
    setSelectedRoom(room)
    setPayAmount(room.balance < 0 ? -room.balance : room.expected)
    setPayDateVal(kstYmdStr())
    setIsDepositMode(false)
    setError('')
    setShowPayForm(false)
    setShowOverrideForm(false)
    setConfirmClearOverride(false)
    setOverrideDateInput('')
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

  // ?roomNo=xxx 딥링크 — 대시보드 팝업에서 넘어올 때 해당 호실 모달 자동 오픈
  useEffect(() => {
    const roomNo = searchParams.get('roomNo')
    if (!roomNo) return
    const room = roomStatus.find(r => r.roomNo === roomNo)
    if (room && !room.isFutureMonth) openPayModal(room)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpdatePayment = (p: PaymentRecord) => {
    setEditingPayId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
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
          const result = await savePayment({
            leaseTermId:    selectedRoom.leaseTermId!,
            tenantId:       selectedRoom.tenantId!,
            targetMonth,
            expectedAmount: selectedRoom.expected,
            actualAmount:   payAmount,
            payDate:        payDateVal,
            payMethod,
            memo,
          })
          // FIFO 결과를 사용자에게 알림 (다른 월로 분배된 경우)
          if (result.allocations.length > 0) {
            const inputMonth = result.inputMonth
            const otherMonths = result.allocations.filter(a => a.targetMonth !== inputMonth)
            if (otherMonths.length > 0) {
              const summary = otherMonths
                .map(a => `${Number(a.targetMonth.slice(5))}월분 ${a.amount.toLocaleString()}원`)
                .join(', ')
              setToast(`자동 분배: ${summary} (미수가 가장 오래된 월부터 충당)`)
            }
          }
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
  // 사이클 기반: 'today' / 'overdue' = 미납, 'paid' = 완납. cycleStatus 없는 행(예약·미래 등)은 제외.
  const isUnpaidByCycle = (r: RoomStatus) => r.cycleStatus ? r.cycleStatus.type !== 'paid' : !r.isPaid
  const unpaidCount = occupied.filter(r => r.status !== 'RESERVED' && isUnpaidByCycle(r)).length
  const paidCount   = occupied.filter(r => r.status !== 'RESERVED' && !isUnpaidByCycle(r)).length

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
      {/* 토스트 */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-md w-[calc(100%-2rem)] bg-[var(--warm-dark)] text-white text-xs rounded-xl px-4 py-3 shadow-lg flex items-start gap-2">
          <span className="text-amber-300 shrink-0">✦</span>
          <span className="flex-1 leading-relaxed">{toast}</span>
          <button onClick={() => setToast(null)} className="shrink-0 text-white/60 hover:text-white">✕</button>
        </div>
      )}

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">수납 관리</h1>
        <span className="text-sm text-[var(--warm-muted)]">{targetMonth}</span>
      </div>

      {/* 검색창 */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] text-sm pointer-events-none">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="호실 번호 또는 입주자 이름 검색"
          className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl pl-9 pr-4 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none">×</button>
        )}
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

        {/* 열 설정 드롭다운 — 데스크탑만 */}
        <div className="hidden sm:block relative" ref={colMenuRef}>
          <button
            onClick={() => setShowColMenu(v => !v)}
            className="px-3 py-1.5 bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] text-xs font-medium rounded-xl transition-colors"
          >
            ⚙ 열 설정
          </button>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowColMenu(false)} />
              <div className="absolute right-0 mt-2 z-50 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl shadow-xl p-3 space-y-2 min-w-[140px]">
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

      {/* 모바일 정렬 칩 */}
      <div className="sm:hidden flex gap-1.5 overflow-x-auto pb-0.5 -mx-4 px-4">
        {([
          { sk: 'status'        as SortKey, label: '수납상태' },
          { sk: 'roomNo'        as SortKey, label: '호실순' },
          { sk: 'dueDay'        as SortKey, label: '납부일' },
          { sk: 'balance'       as SortKey, label: '잔액' },
          { sk: 'expected'      as SortKey, label: '이용료' },
          { sk: 'totalPaid'     as SortKey, label: '총납부액' },
          { sk: 'tenantName'    as SortKey, label: '입주자' },
          { sk: 'depositAmount' as SortKey, label: '보증금' },
          { sk: 'contact'       as SortKey, label: '연락처' },
          { sk: 'type'          as SortKey, label: '타입' },
          { sk: 'windowType'    as SortKey, label: '창문' },
        ]).map(({ sk, label }) => {
          const active = sortKey === sk
          return (
            <button key={sk}
              onClick={() => handleSort(sk)}
              className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active
                  ? 'bg-[var(--coral)] text-white'
                  : 'bg-[var(--canvas)] text-[var(--warm-mid)]'
              }`}>
              {label}
              {active && <span className="text-[10px]">{sortDir === 'asc' ? '↑' : '↓'}</span>}
            </button>
          )
        })}
      </div>

      {/* 수납 현황 — 모바일 카드 뷰 */}
      <div className="sm:hidden space-y-2">
        {displayed.map(room => {
          const dueInfo = !room.isPaid ? getEffectiveDueInfo(room, targetMonth) : null
          return (
            <div key={room.roomId}
              onClick={() => !room.isFutureMonth && openPayModal(room)}
              className={`bg-[var(--cream)] border rounded-2xl px-4 py-3.5 transition-colors
                ${room.isFutureMonth ? 'opacity-50' : 'cursor-pointer active:bg-[var(--canvas)]/60'}
                ${!room.isPaid ? 'border-red-200' : 'border-[var(--warm-border)]'}`}>
              {/* 첫 줄: 호실 + 수납상태 */}
              <div className="flex items-start justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-bold text-[var(--coral)]">{room.roomNo}호</span>
                  {room.type && <span className="text-xs text-[var(--warm-muted)]">{room.type}</span>}
                </div>
                <div className="flex flex-col items-end gap-0.5">
                  {room.status === 'NON_RESIDENT' && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-orange-50 text-orange-700 ring-1 ring-orange-200">비거주</span>
                  )}
                  {room.status === 'RESERVED' ? (
                    <>
                      <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">예약</span>
                      {room.moveInDate && (() => {
                        const days = Math.round((new Date(room.moveInDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                        return (
                          <span className="text-[10px] font-medium text-blue-500">
                            {days > 0 ? `D-${days} 입주 예정` : days === 0 ? '오늘 입주' : `입주 예정일 ${Math.abs(days)}일 경과`}
                          </span>
                        )
                      })()}
                    </>
                  ) : room.cycleStatus ? (
                    <>
                      {room.cycleStatus.type === 'paid' && (
                        <>
                          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">완납</span>
                          {room.cycleStatus.nextDueDate && room.cycleStatus.daysToNextDue > 0 && (
                            <span className="text-[10px] font-medium text-[var(--warm-muted)]">
                              D-{room.cycleStatus.daysToNextDue} 납부예정
                            </span>
                          )}
                        </>
                      )}
                      {room.cycleStatus.type === 'today' && (
                        <>
                          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">오늘 납부일</span>
                        </>
                      )}
                      {room.cycleStatus.type === 'overdue' && (
                        <>
                          <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-red-50 text-red-600 ring-1 ring-red-200">미납</span>
                          <span className="text-[10px] font-medium text-red-400">{room.cycleStatus.daysOverdue}일 경과</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium
                        ${room.isPaid ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-600 ring-1 ring-red-200'}`}>
                        {room.isPaid ? '완납' : '미납'}
                      </span>
                      {!room.isPaid && dueInfo && (
                        <span className={`text-[10px] font-medium ${dueInfo.days === 0 ? 'text-orange-500' : dueInfo.overdue ? 'text-red-400' : 'text-yellow-600'}`}>
                          {dueInfo.days === 0 ? '오늘' : dueInfo.overdue ? `${dueInfo.days}일 초과` : `${dueInfo.days}일 후`}
                        </span>
                      )}
                    </>
                  )}
                </div>
              </div>
              {/* 둘째 줄: 입주자 */}
              <p className="text-sm font-medium text-[var(--warm-dark)] mt-1">{room.tenantName}</p>
              {/* 셋째 줄: 월이용료 · 잔액 · 납부일 */}
              <div className="flex items-center gap-2.5 mt-2 text-xs text-[var(--warm-mid)] flex-wrap">
                <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={room.expected} /></span>
                {room.balance !== 0 && (
                  <span className={`${room.balance > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                    잔액 {room.balance > 0 ? '+' : '-'}<MoneyDisplay amount={Math.abs(room.balance)} />
                  </span>
                )}
                {room.dueDay && (
                  <span className="text-[var(--warm-muted)]">
                    {room.dueDay === '말일' ? '매월 말일' : `매월 ${room.dueDay}일`}
                  </span>
                )}
              </div>
            </div>
          )
        })}
        {displayed.length === 0 && (
          <p className="text-sm text-[var(--warm-muted)] text-center py-6">
            {search ? '검색 결과가 없습니다.' : '해당하는 호실이 없습니다.'}
          </p>
        )}
      </div>

      {/* 수납 현황 — 데스크탑 테이블 */}
      <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100dvh-240px)]">
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
                {colVis.dueDay        && <SortTh label="납부일"    sk="dueDay" />}
                {colVis.status        && <SortTh label="수납 상태" sk="status" />}
              </tr>
            </thead>
            <tbody>
              {displayed.map(room => (
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
                        {room.status === 'RESERVED' ? (
                          <>
                            <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-blue-50 text-blue-700 ring-1 ring-blue-200">예약</span>
                            {room.moveInDate && (() => {
                              const days = Math.round((new Date(room.moveInDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                              return (
                                <span className="text-xs text-blue-500 font-medium">
                                  {days > 0 ? `D-${days} 입주 예정` : days === 0 ? '오늘 입주' : `${Math.abs(days)}일 경과`}
                                </span>
                              )
                            })()}
                          </>
                        ) : room.cycleStatus ? (
                          <>
                            {room.cycleStatus.type === 'paid' && (
                              <>
                                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">완납</span>
                                {room.cycleStatus.nextDueDate && room.cycleStatus.daysToNextDue > 0 && (
                                  <span className="text-xs text-[var(--warm-muted)] font-medium">D-{room.cycleStatus.daysToNextDue} 납부예정</span>
                                )}
                              </>
                            )}
                            {room.cycleStatus.type === 'today' && (
                              <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-amber-50 text-amber-700 ring-1 ring-amber-200">오늘 납부일</span>
                            )}
                            {room.cycleStatus.type === 'overdue' && (
                              <>
                                <span className="text-xs px-2.5 py-1 rounded-full font-medium bg-red-50 text-red-600 ring-1 ring-red-200">미납</span>
                                <span className="text-xs text-red-400 font-medium">{room.cycleStatus.daysOverdue}일 경과</span>
                              </>
                            )}
                          </>
                        ) : (
                          <>
                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium
                              ${room.isPaid ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' : 'bg-red-50 text-red-600 ring-1 ring-red-200'}`}>
                              {room.isPaid ? '완납' : '미납'}
                            </span>
                            {!room.isPaid && (() => {
                              const info = getEffectiveDueInfo(room, targetMonth)
                              if (!info) return null
                              if (info.days === 0) return (
                                <span className="text-xs text-orange-600 font-medium">오늘</span>
                              )
                              return info.overdue
                                ? <span className="text-xs text-red-400">{info.days}일 초과</span>
                                : <span className="text-xs text-yellow-600">{info.days}일 후</span>
                            })()}
                          </>
                        )}
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
            {/* 공실 열 설정 — 데스크탑만 */}
            <div className="hidden sm:block relative" ref={vacantColMenuRef}>
              <button
                onClick={() => setShowVacantColMenu(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors
                  ${showVacantColMenu ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}
              >
                <span>⚙</span> 열 설정
              </button>
              {showVacantColMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-3 z-50 shadow-xl min-w-[160px] space-y-2">
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

          {/* 공실 — 모바일 카드 */}
          <div className="sm:hidden grid grid-cols-2 gap-2">
            {sortedVacants.map(room => (
              <div key={room.roomId} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl px-4 py-3 space-y-1">
                <span className="text-sm font-bold text-[var(--warm-mid)]">{room.roomNo}호</span>
                {room.type && <p className="text-xs text-[var(--warm-muted)]">{room.type}</p>}
                <p className="text-sm font-semibold text-[var(--warm-dark)]">
                  {room.baseRent > 0 ? <MoneyDisplay amount={room.baseRent} /> : '—'}
                </p>
              </div>
            ))}
          </div>

          {/* 공실 — 데스크탑 테이블 */}
          <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-64">
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
                  {selectedRoom.dueDay && ` · ${selectedRoom.dueDay.includes('말') ? '말일' : `${selectedRoom.dueDay}일`}`}
                </p>
              </div>
              <button onClick={() => { setShowPayModal(false); setShowPayForm(false) }}
                aria-label="닫기" className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
            </div>

            {/* ── 읽기 전용 ── */}
            {!showPayForm && (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  {/* 잔액 요약 — 현금주의(통장 입금일) 기준. 발생주의 매출은 대시보드 참조 */}
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
                  <p className="text-[10px] text-[var(--warm-muted)] leading-relaxed">
                    총 수납·잔액·이월액은 입금일 기준입니다. 매출은 귀속 월로 별도 인식됩니다.
                  </p>

                  {/* 납부 내역 */}
                  {(loadingHistory || paymentHistory.length > 0 || selectedRoom.prevPaidThisMonth) && (() => {
                    const isPreAcq = (p: PaymentRecord) => !!(payAcquisitionDate && new Date(p.payDate) < payAcquisitionDate)
                    const prevOwnerPaid = paymentHistory.filter(p => !p.isDeposit && isPreAcq(p)).reduce((s, p) => s + p.actualAmount, 0)
                    // 양도인 자동 완납 — 수납 기록 없이 납부일이 귀속 기준일 이전인 경우
                    const isAutoPaidNoBilling = selectedRoom.prevPaidThisMonth && paymentHistory.filter(p => !p.isDeposit).length === 0
                    const getDueDate = (dueDay: string | null, month: string) => {
                      if (!dueDay) return ''
                      const [y, m] = month.split('-').map(Number)
                      if (dueDay === '말') return `${y}년 ${m}월 ${new Date(y, m, 0).getDate()}일`
                      const d = parseInt(dueDay, 10)
                      return isNaN(d) ? '' : `${y}년 ${m}월 ${d}일`
                    }
                    return (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[var(--warm-mid)]">납부 내역</p>
                        {loadingHistory && (
                          <div className="flex items-center justify-center py-4">
                            <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                          </div>
                        )}
                        {!loadingHistory && isAutoPaidNoBilling && (() => {
                          const getAutoDefault = () => {
                            const [y, m] = targetMonth.split('-').map(Number)
                            const dd = selectedRoom.dueDay
                            if (!dd) return `${targetMonth}-01`
                            if (dd === '말') return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`
                            const d = parseInt(dd, 10)
                            return isNaN(d) ? `${targetMonth}-01` : `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                          }
                          const handleSaveAutoPay = () => {
                            if (!selectedRoom.leaseTermId || !selectedRoom.tenantId || !autoPayDate) return
                            startTransition(async () => {
                              try {
                                await savePayment({
                                  leaseTermId: selectedRoom.leaseTermId!,
                                  tenantId: selectedRoom.tenantId!,
                                  targetMonth,
                                  expectedAmount: selectedRoom.expected,
                                  actualAmount: selectedRoom.expected,
                                  payDate: autoPayDate,
                                  payMethod: '양도인 수납',
                                  memo: '양도인 귀속 수납',
                                })
                                setEditingAutoPay(false)
                                setLoadingHistory(true)
                                const { records, acquisitionDate: acq } = await getPaymentsByLease(selectedRoom.leaseTermId!, targetMonth)
                                setPaymentHistory(records as PaymentRecord[])
                                setPayAcquisitionDate(acq ? new Date(acq) : null)
                                setLoadingHistory(false)
                              } catch (e) {
                                setError(e instanceof Error ? e.message : '저장 실패')
                              }
                            })
                          }
                          return editingAutoPay ? (
                            <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-2">
                              <p className="text-xs font-semibold text-amber-700">양도인 수납 — 납부일 직접 입력</p>
                              <div className="flex gap-2 items-center">
                                <div className="flex-1">
                                  <DatePicker value={autoPayDate} onChange={setAutoPayDate}
                                    className="bg-[var(--canvas)] border border-amber-200 rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                                </div>
                                <button onClick={handleSaveAutoPay} disabled={isPending || !autoPayDate}
                                  className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50">저장</button>
                                <button onClick={() => setEditingAutoPay(false)}
                                  className="px-3 py-1.5 text-xs text-amber-600 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors">취소</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                              <div>
                                <p className="text-xs font-semibold text-amber-700">양도인 수납</p>
                                <button onClick={() => { setAutoPayDate(getAutoDefault()); setEditingAutoPay(true) }}
                                  className="text-[10px] text-amber-600 mt-0.5 hover:underline text-left">
                                  {getDueDate(selectedRoom.dueDay, targetMonth)} 납부 (자동) · <span className="underline">날짜 수정</span>
                                </button>
                              </div>
                              <p className="text-xs font-semibold text-amber-700">{selectedRoom.expected.toLocaleString()}원</p>
                            </div>
                          )
                        })()}
                        {!loadingHistory && prevOwnerPaid > 0 && (
                          <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                            <p className="text-xs text-amber-700">양도인 귀속 (인수일 이전 납부)</p>
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
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">납부일</p>
                                    <DatePicker value={editDate} onChange={setEditDate}
                                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">납부방법</p>
                                    <input type="text" value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                                      placeholder="계좌이체, 현금…"
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[10px] text-[var(--warm-muted)]">메모</p>
                                    <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
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
                                  {prevOwner && <span className="ml-1.5 text-[10px] font-semibold bg-amber-200 text-amber-800 rounded px-1 py-0.5">양도인</span>}
                                  {!p.isDeposit && p.targetMonth !== targetMonth && (
                                    <span className="ml-1.5 text-[10px] font-semibold bg-blue-100 text-blue-700 rounded px-1 py-0.5">
                                      {p.targetMonth < targetMonth
                                        ? `${Number(p.targetMonth.slice(5))}월 미납분 처리`
                                        : `${Number(p.targetMonth.slice(5))}월 선납`}
                                    </span>
                                  )}
                                </p>
                                {p.memo && !p.isDeposit && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${p.isDeposit ? 'text-purple-700' : prevOwner ? 'text-amber-700' : 'text-[var(--warm-dark)]'}`}>
                                  {p.actualAmount.toLocaleString()}원
                                </span>
                                {canEdit && (
                                  <div className="flex gap-1.5 ml-1">
                                    <button onClick={() => handleUpdatePayment(p)}
                                      className="text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors"
                                      style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
                                      수정
                                    </button>
                                    <button onClick={() => handleDeletePayment(p.id)}
                                      className="text-[10px] font-medium px-2 py-1 rounded-lg border border-red-200 text-red-500 transition-colors">
                                      삭제
                                    </button>
                                  </div>
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
                {selectedRoom.leaseTermId && (() => {
                  const isOverrideActive = selectedRoom.overrideDueDayMonth === targetMonth && !!selectedRoom.overrideDueDay
                  const fmtOvr = (v: string | null | undefined) => {
                    if (!v) return ''
                    if (v.includes('-')) { const d = new Date(v + 'T00:00:00'); return `${d.getMonth()+1}월 ${d.getDate()}일` }
                    return v.includes('말') ? '말일' : `${v}일`
                  }
                  const overrideLabel = fmtOvr(selectedRoom.overrideDueDay)
                  return (
                  <div className="border-t border-amber-200 px-6 py-3 shrink-0 bg-amber-50">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-xs font-medium text-amber-400">납부일 임시 조정</p>
                        {isOverrideActive ? (
                          <p className="text-xs text-amber-700 mt-0.5">
                            이번 달 납부일: <span className="font-bold">{overrideLabel}</span>
                            {selectedRoom.overrideDueDayReason && ` (${selectedRoom.overrideDueDayReason})`}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--warm-muted)] mt-0.5">이번 달 임시 조정 없음</p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5">
                        {canEdit && isOverrideActive && !showOverrideForm && (
                          confirmClearOverride ? (
                            <div className="flex items-center gap-1.5 bg-red-50 border border-red-200 rounded-lg px-2 py-1">
                              <span className="text-xs text-red-500">정말 삭제할까요?</span>
                              <button type="button" onClick={() => setConfirmClearOverride(false)}
                                className="text-xs text-gray-400 hover:text-gray-600">취소</button>
                              <button
                                type="button"
                                onClick={() => {
                                  const leaseTermId = selectedRoom.leaseTermId!
                                  setConfirmClearOverride(false)
                                  setSelectedRoom(prev => prev ? { ...prev, overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null } : prev)
                                  startTransition(async () => {
                                    await clearDueDayOverride(leaseTermId)
                                    router.refresh()
                                  })
                                }}
                                className="text-xs bg-red-500 hover:bg-red-400 text-white font-semibold px-1.5 py-0.5 rounded">
                                삭제
                              </button>
                            </div>
                          ) : (
                            <button type="button" onClick={() => setConfirmClearOverride(true)}
                              className="text-xs text-red-500 hover:text-red-600 px-2 py-1 rounded-lg border border-red-200 hover:border-red-400 transition-colors">
                              삭제
                            </button>
                          )
                        )}
                        {canEdit && (
                          <button
                            onClick={() => {
                              const opening = !showOverrideForm
                              setShowOverrideForm(opening)
                              setConfirmClearOverride(false)
                              if (opening) {
                                const existingVal = isOverrideActive ? selectedRoom.overrideDueDay : null
                                let initDate = ''
                                if (existingVal) {
                                  if (existingVal.includes('-')) {
                                    initDate = existingVal  // 이미 full date
                                  } else if (existingVal.includes('말')) {
                                    const [y, m] = targetMonth.split('-').map(Number)
                                    initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
                                  } else {
                                    const n = parseInt(existingVal)
                                    if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
                                  }
                                } else {
                                  const baseDay = selectedRoom.dueDay
                                  if (baseDay?.includes('말')) {
                                    const [y, m] = targetMonth.split('-').map(Number)
                                    initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
                                  } else if (baseDay) {
                                    const n = parseInt(baseDay)
                                    if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
                                  }
                                }
                                setOverrideDateInput(initDate || kstYmdStr())
                                setOverrideReason(isOverrideActive ? (selectedRoom.overrideDueDayReason ?? '') : '')
                              }
                            }}
                            className="text-xs text-amber-600 hover:text-amber-700 px-2 py-1 rounded-lg border border-amber-200 hover:border-amber-400 transition-colors">
                            {showOverrideForm ? '닫기' : (isOverrideActive ? '수정' : '조정하기')}
                          </button>
                        )}
                      </div>
                    </div>
                    {showOverrideForm && (
                      <div className="mt-3 space-y-2">
                        <div className="flex gap-2">
                          <div className="flex-1 space-y-1">
                            <label className="text-xs text-[var(--warm-muted)]">조정 납부일</label>
                            <DatePicker
                              value={overrideDateInput}
                              onChange={setOverrideDateInput}
                              minDate={`${targetMonth}-01`}
                              className="bg-[var(--canvas)] border border-amber-200 rounded-lg px-3 py-1.5 text-sm text-[var(--warm-dark)] focus:border-amber-500"
                            />
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
                          disabled={!overrideDateInput || isPending}
                          onClick={() => {
                            if (!overrideDateInput) return
                            const selectedMonth = overrideDateInput.slice(0, 7)
                            let val: string
                            if (selectedMonth === targetMonth) {
                              const d = new Date(overrideDateInput + 'T00:00:00')
                              const dayNum = d.getDate()
                              const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                              val = dayNum >= lastDay ? '말일' : String(dayNum)
                            } else {
                              val = overrideDateInput  // cross-month: full date 저장
                            }
                            const reason = overrideReason.trim()
                            const leaseTermId = selectedRoom.leaseTermId!
                            setShowOverrideForm(false)
                            setSelectedRoom(prev => prev ? { ...prev, overrideDueDay: val, overrideDueDayMonth: targetMonth, overrideDueDayReason: reason || null } : prev)
                            startTransition(async () => {
                              await setDueDayOverride(leaseTermId, targetMonth, val, reason || undefined)
                              router.refresh()
                            })
                          }}
                          className="w-full py-2 bg-amber-500 active:bg-amber-600 hover:bg-amber-400 disabled:opacity-50 text-white text-sm font-semibold rounded-lg transition-colors">
                          {isPending ? '저장 중...' : (() => {
                            if (!overrideDateInput) return '날짜를 선택하세요'
                            const selectedMonth = overrideDateInput.slice(0, 7)
                            if (selectedMonth !== targetMonth) {
                              const d = new Date(overrideDateInput + 'T00:00:00')
                              return `${targetMonth} 납부일을 ${d.getMonth()+1}월 ${d.getDate()}일로 조정`
                            }
                            const d = new Date(overrideDateInput + 'T00:00:00')
                            const dayNum = d.getDate()
                            const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                            return `${targetMonth} 납부일을 ${dayNum >= lastDay ? '말일' : `${dayNum}일`}로 조정`
                          })()}
                        </button>
                      </div>
                    )}
                  </div>
                  )
                })()}

                {/* 읽기 전용 푸터 */}
                <div className="border-t border-[var(--warm-border)] px-6 py-3 flex gap-2 shrink-0 flex-wrap">
                  {selectedRoom.tenantId && (
                    <button
                      type="button"
                      onClick={() => {
                        const id = selectedRoom.tenantId!
                        setShowPayModal(false)
                        setShowPayForm(false)
                        setTenantInfoId(id)
                      }}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                      입주자 정보
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      const id = selectedRoom.roomId
                      setShowPayModal(false)
                      setShowPayForm(false)
                      setRoomInfoId(id)
                    }}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                    호실 정보
                  </button>
                  <div className="flex-1" />
                  {canEdit && (
                    <button
                      onClick={() => { setShowPayForm(true); setError('') }}
                      className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
                      수납 등록
                    </button>
                  )}
                </div>
              </>
            )}

            {/* ── 수납 등록 폼 ── */}
            {showPayForm && (
              <form onSubmit={handleSavePayment} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  {!isDepositMode && (
                    <p className="text-[10px] text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed">
                      미수가 있는 가장 오래된 월부터 자동으로 충당됩니다 (발생주의). 입력 금액이 한 달 이용료를 초과하면 다음 달로 이월됩니다.
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                      <DatePicker name="payDate" value={payDateVal} onChange={setPayDateVal}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
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
                              setPayDateVal(selectedRoom.moveInDate ?? kstYmdStr())
                            } else {
                              setPayDateVal(kstYmdStr())
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
                  <Btn type="button" variant="secondary" onClick={() => { setShowPayForm(false); setError('') }} fullWidth>취소</Btn>
                  <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                    {isPending ? '저장 중...' : '저장'}
                  </Btn>
                </div>
              </form>
            )}

          </div>
        </div>
      )}

      {/* 입주자 정보 인라인 모달 — 닫으면 원래 수납 모달 그대로 */}
      {tenantInfoId && (
        <TenantInfoModal
          tenantId={tenantInfoId}
          onClose={() => setTenantInfoId(null)}
          onBack={selectedRoom ? () => { setTenantInfoId(null); setShowPayModal(true) } : undefined}
        />
      )}
      {/* 호실 정보 인라인 모달 */}
      {roomInfoId && (
        <RoomInfoModal
          roomId={roomInfoId}
          onClose={() => setRoomInfoId(null)}
          onBack={selectedRoom ? () => { setRoomInfoId(null); setShowPayModal(true) } : undefined}
        />
      )}
    </div>
  )
}

// ── 입주자 정보 인라인 모달 (입주자 관리 페이지와 동일 디자인) ────────
const STATUS_LABEL_RC: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT: '퇴실', NON_RESIDENT: '비거주자', WAITING_TOUR: '투어 대기', TOUR_DONE: '투어 완료', CANCELLED: '취소',
}
function TenantInfoModal({ tenantId, onClose, onBack }: { tenantId: string; onClose: () => void; onBack?: () => void }) {
  const router = useRouter()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getTenantQuickInfo>> | null>(null)
  useEffect(() => {
    getTenantQuickInfo(tenantId).then(setInfo)
  }, [tenantId])
  const lease = info?.leaseTerms?.[0]
  const statusLabel = lease?.status ? (STATUS_LABEL_RC[lease.status] ?? lease.status) : null
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-lg flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button onClick={onBack}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors"
                title="수납 정보로 돌아가기">
                ‹
              </button>
            )}
            <h2 className="text-base font-bold text-[var(--warm-dark)]">입주자 상세정보</h2>
            {statusLabel && (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                {statusLabel}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="닫기" className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {!info ? (
            <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
          ) : (
            <>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">기본 정보</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <InfoCol label="이름" value={info.name} />
                  <InfoCol label="호실" value={lease?.room?.roomNo ? `${lease.room.roomNo}호` : '—'} />
                  <InfoCol label="성별" value={info.gender === 'MALE' ? '남성' : info.gender === 'FEMALE' ? '여성' : '—'} />
                  <InfoCol label="국적" value={info.nationality ?? '—'} />
                  <InfoCol label="직업" value={info.job ?? '—'} />
                  <InfoCol label="생년월일" value={info.birthdate ? new Date(info.birthdate).toISOString().slice(0, 10) : '—'} />
                </div>
              </div>
              {info.contacts && info.contacts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">연락처</h3>
                  <InfoCol label="주 연락처" value={info.contacts[0]?.contactValue ?? '—'} />
                </div>
              )}
              {lease && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">계약 정보</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <InfoCol label="월 이용료" value={`${lease.rentAmount.toLocaleString()}원`} />
                    <InfoCol label="보증금" value={`${(lease.depositAmount ?? 0).toLocaleString()}원`} />
                    <InfoCol label="납부일" value={lease.dueDay ? (lease.dueDay.includes('말') ? '매월 말일' : `매월 ${lease.dueDay}일`) : '—'} />
                    <InfoCol label="입주일" value={lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : '—'} />
                    {lease.expectedMoveOut && <InfoCol label="퇴실 예정일" value={new Date(lease.expectedMoveOut).toISOString().slice(0, 10)} />}
                  </div>
                </div>
              )}
              {info.memo && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">메모</h3>
                  <p className="text-sm text-[var(--warm-dark)] whitespace-pre-wrap">{info.memo}</p>
                </div>
              )}
            </>
          )}
        </div>
        <div className="border-t border-[var(--warm-border)] px-6 py-3 flex justify-end shrink-0">
          <button
            type="button"
            onClick={() => router.push(`/tenants?tenantId=${tenantId}`)}
            className="px-4 py-2 text-xs font-medium rounded-xl bg-[var(--coral)] hover:opacity-90 text-white transition-colors">
            입주자 관리로 이동
          </button>
        </div>
      </div>
    </div>
  )
}

function InfoCol({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] text-[var(--warm-muted)]">{label}</p>
      <p className="text-sm text-[var(--warm-dark)]">{value}</p>
    </div>
  )
}

// ── 호실 정보 인라인 모달 (호실 관리 페이지와 동일 디자인) ────────────
function RoomInfoModal({ roomId, onClose, onBack }: { roomId: string; onClose: () => void; onBack?: () => void }) {
  const router = useRouter()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getRoomQuickInfo>> | null>(null)
  useEffect(() => {
    getRoomQuickInfo(roomId).then(setInfo)
  }, [roomId])
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button onClick={onBack}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors"
                title="수납 정보로 돌아가기">
                ‹
              </button>
            )}
            <h2 className="text-base font-bold text-[var(--warm-dark)]">{info?.roomNo}호</h2>
            {info && (
              <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium
                ${info.isVacant ? 'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>
                {info.isVacant ? '공실' : '거주중'}
              </span>
            )}
          </div>
          <button onClick={onClose} aria-label="닫기" className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1">
          {!info ? (
            <p className="text-sm text-[var(--warm-muted)] text-center py-8">불러오는 중…</p>
          ) : (
            <>
              {info.photos.length > 0 && (
                <div className="border-b border-[var(--warm-border)] flex gap-2 overflow-x-auto px-4 py-3" style={{ scrollbarWidth: 'none' }}>
                  {info.photos.map(p => (
                    <img key={p.id} src={p.storageUrl} alt="" className="h-32 w-32 object-cover rounded-xl shrink-0" />
                  ))}
                </div>
              )}
              <div className="px-6 py-5 space-y-2 text-sm">
                <Row label="입주자" value={info.leaseTerms[0]?.tenant?.name ?? '공실'} />
                {info.type && <Row label="방 타입" value={info.type} />}
                <Row label="기본 이용료" value={`${info.baseRent.toLocaleString()}원`} />
                {info.scheduledRent != null && (
                  <Row
                    label="예약 이용료"
                    value={`${info.scheduledRent.toLocaleString()}원${info.rentUpdateDate ? ` (${new Date(info.rentUpdateDate).toISOString().slice(0, 10)} 적용)` : ''}`}
                  />
                )}
                {info.windowType && <Row label="창문" value={info.windowType === 'OUTER' ? '외창' : info.windowType === 'INNER' ? '내창' : info.windowType} />}
                {info.direction && <Row label="방향" value={info.direction} />}
                {(info.areaPyeong || info.areaM2) && (
                  <Row label="면적" value={[
                    info.areaPyeong ? `${info.areaPyeong}평` : '',
                    info.areaM2 ? `${info.areaM2}㎡` : '',
                  ].filter(Boolean).join(' / ')} />
                )}
                {info.memo && <Row label="메모" value={info.memo} />}
              </div>
            </>
          )}
        </div>
        <div className="border-t border-[var(--warm-border)] px-6 py-3 flex justify-end shrink-0">
          <button
            type="button"
            onClick={() => router.push(`/room-manage?roomId=${roomId}`)}
            className="px-4 py-2 text-xs font-medium rounded-xl bg-[var(--coral)] hover:opacity-90 text-white transition-colors">
            호실 관리로 이동
          </button>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b border-[var(--warm-border)]/50 last:border-0">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}
