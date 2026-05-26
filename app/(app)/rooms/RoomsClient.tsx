'use client'

import { useState, useTransition, useRef, useEffect, useCallback } from 'react'
import { savePayment, saveDepositPayment, deletePayment, updatePayment, getPaymentsByLease, setDueDayOverride, clearDueDayOverride, getTargetMonthOptions, savePrevOwnerSettle, getPrevOwnerSettleState, setPrevOwnerSettleMenu, getRentDiscounts, addRentDiscount, deleteRentDiscount, type TargetMonthOption, type RentDiscountRow } from './actions'
import { discountLabel } from '@/lib/rentDiscount'
import { changeDueDay } from '@/app/(app)/tenants/actions'
import { calcProRata, PRORATE_BASE_DAYS } from '@/lib/prorate'
import { useRouter, useSearchParams } from 'next/navigation'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { Loading } from '@/components/ui/Loading'
import MonthSelector from '@/components/layout/MonthSelector'
import { formatPhone } from '@/lib/formatPhone'
import { kstYmdStr } from '@/lib/kstDate'
import { useUrlState } from '@/lib/useUrlState'
import { withSave, trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { SortSelect } from '@/components/ui/SortSelect'
import { RoomCard } from '@/components/ui/RoomCard'
import { StatusBadge, statusTipColor, statusRowTint, type BadgeTone } from '@/components/ui/StatusBadge'

const fmtRoomNo = (no: string | null | undefined) =>
  no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—'

type RoomStatus = {
  roomId: string
  roomNo: string
  type: string | null
  floor: string | null
  windowType: string | null
  direction: string | null
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
  cleaningFee: number
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
  isReservationConfirmed: boolean
  latePaidAt: string | null
  nextDueDate: string | null
  nextDueAmount: number
  expectedMoveOut: string | null
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
  isPrevOwner: boolean
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

type VacantColKey = 'type' | 'windowType' | 'direction' | 'floor' | 'baseRent' | 'prevTenantName' | 'prevContact'
type VacantSortKey = 'roomNo' | 'type' | 'windowType' | 'baseRent' | 'prevTenantName'

const VACANT_COL_DEFS: { key: VacantColKey; label: string; defaultOn: boolean }[] = [
  { key: 'type',          label: '타입',       defaultOn: true  },
  { key: 'windowType',    label: '창문',       defaultOn: true  },
  { key: 'direction',     label: '방향',       defaultOn: true  },
  { key: 'floor',         label: '층',         defaultOn: false },
  { key: 'baseRent',      label: '기본 월이용료', defaultOn: true  },
  { key: 'prevTenantName', label: '직전 입주자', defaultOn: false },
  { key: 'prevContact',   label: '직전 연락처', defaultOn: false },
]

const DEFAULT_VACANT_VIS = Object.fromEntries(
  VACANT_COL_DEFS.map(c => [c.key, c.defaultOn])
) as Record<VacantColKey, boolean>

const COL_WIDTHS_KEY = 'stayeum_rooms_col_widths'

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

// 호실 수납 상태 → 배지/팁 톤. 수납(미납·연체)이 비거주보다 우선 —
// 비거주여도 미납이면 미납/연체 색으로 표시(회색으로 묻히지 않도록).
function roomStatusTone(room: RoomStatus, targetMonth: string): BadgeTone {
  if (room.status === 'RESERVED') return 'movein'
  if (!room.isPaid) {
    const info = getEffectiveDueInfo(room, targetMonth)
    return info && info.days > 7 ? 'overdue' : 'unpaid'
  }
  if (room.status === 'NON_RESIDENT') return 'info'
  const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
  if (room.status === 'CHECKOUT_PENDING' && !!checkoutMonth && checkoutMonth <= targetMonth) return 'exit'
  if (room.nextDueDate && room.nextDueAmount > 0) return 'await'
  return 'paid'
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
  const entityModal = useEntityModal()
  const [selectedRoom, setSelectedRoom] = useState<RoomStatus | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentRecord[]>([])
  const [payAcquisitionDate, setPayAcquisitionDate] = useState<Date | null>(null)
  // #14 월세 할인 — 현재 lease의 할인 목록 + 추가 폼
  const [payDiscounts, setPayDiscounts] = useState<RentDiscountRow[]>([])
  const [showDiscForm, setShowDiscForm] = useState(false)
  const [discType, setDiscType]   = useState<'amount' | 'percent'>('amount')
  const [discValue, setDiscValue] = useState(0)
  const [discScope, setDiscScope] = useState<'permanent' | 'temporary'>('permanent')
  const [discStart, setDiscStart] = useState('')   // 'YYYY-MM'
  const [discEnd, setDiscEnd]     = useState('')
  const [prevOwnerCanSettle, setPrevOwnerCanSettle] = useState(false)  // 양도인 정산 메뉴 노출
  const [prevOwnerMenuMode, setPrevOwnerMenuMode] = useState<string>('auto')  // auto|show|hide
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

  // 수납 등록 폼 열릴 때 귀속월 옵션 fetch
  useEffect(() => {
    if (!showPayForm || !selectedRoom?.leaseTermId) {
      setTmOptions([])
      setForcedTm('auto')
      return
    }
    let cancelled = false
    getTargetMonthOptions(selectedRoom.leaseTermId, targetMonth).then(opts => {
      if (!cancelled) setTmOptions(opts)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [showPayForm, selectedRoom?.leaseTermId, targetMonth])
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'checkout' | 'awaiting' | 'paid'>('all')
  const [floorFilter, setFloorFilter] = useState('')
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
  const [showDueDayChange, setShowDueDayChange] = useState(false)
  const [newDueDayInput, setNewDueDayInput] = useState('')
  const [payAmount, setPayAmount] = useState(0)
  const [payDateVal, setPayDateVal] = useState(kstYmdStr())
  const [isDepositMode, setIsDepositMode] = useState(false)
  // 직전에 사용한 납부방법 — 연속 수납 입력 시 자동 prefill (대시보드와 localStorage 공유)
  const [lastPayMethod, setLastPayMethod] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('stayeum-last-pay-method') ?? '') : ''
  )
  const [isCleaningFeeMode, setIsCleaningFeeMode] = useState(false)
  // 귀속월 — 'auto' = FIFO 자동, 'YYYY-MM' = 사용자가 명시한 귀속월
  const [forcedTm, setForcedTm] = useState<'auto' | string>('auto')
  const [tmOptions, setTmOptions] = useState<TargetMonthOption[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [editingPayId, setEditingPayId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')
  const [editTargetMonth, setEditTargetMonth] = useState('')
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

  const getRoomFloor = (r: RoomStatus) => {
    if (r.floor) return r.floor
    const n = r.roomNo.replace(/[^0-9]/g, '')
    return n.length >= 3 ? n.slice(0, n.length - 2) : ''
  }
  const allFloors = [...new Set(roomStatus.map(r => getRoomFloor(r)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))

  const occupied = roomStatus.filter(r => !r.isVacant)
  const vacants  = roomStatus.filter(r => r.isVacant).sort((a, b) =>
    a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })
  )

  const isAwaitingRoom = (r: RoomStatus) => r.isPaid && !!r.nextDueDate && r.nextDueAmount > 0
  const isCheckoutRoom = (r: RoomStatus) => {
    const ck = r.expectedMoveOut?.slice(0, 7) ?? null
    return r.status === 'CHECKOUT_PENDING' && r.isPaid && !!ck && ck <= targetMonth
  }
  const filtered = occupied.filter(r => {
    if (floorFilter && getRoomFloor(r) !== floorFilter) return false
    if (filter === 'unpaid')   return !r.isPaid
    if (filter === 'checkout') return isCheckoutRoom(r)
    if (filter === 'awaiting') return isAwaitingRoom(r) && !isCheckoutRoom(r)
    if (filter === 'paid')     return r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r)
    return true
  })

  const sorted = [...filtered].sort((a, b) => {
    // 상태 열: 미납(0)→퇴실예정(1)→예약(2)→납부예정(3)→완납(4)→공실(5) 그룹 고정
    if (sortKey === 'status') {
      const grpKey = (r: RoomStatus) => {
        if (r.isVacant) return 5
        if (!r.isPaid) return 0
        if (isCheckoutRoom(r)) return 1
        if (r.status === 'RESERVED') return 2
        if (isAwaitingRoom(r)) return 3
        return 4
      }
      const grpA = grpKey(a), grpB = grpKey(b)
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
    setIsCleaningFeeMode(false)
    setError('')
    setShowPayForm(false)
    setShowOverrideForm(false)
    setConfirmClearOverride(false)
    setOverrideDateInput('')
    setOverrideReason('')
    setShowDueDayChange(false)
    setNewDueDayInput('')
    setEditingPayId(null)
    setPaymentHistory([])
    setPrevOwnerCanSettle(false)
    setShowPayModal(true)
    if (room.leaseTermId) {
      setLoadingHistory(true)
      const { records, acquisitionDate, lastPayMethod: leaseLast } = await getPaymentsByLease(room.leaseTermId, targetMonth)
      setPaymentHistory(records as PaymentRecord[])
      setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
      // #5: 이 입주자(lease)의 최근 납부방법을 기본값으로 (전역 localStorage 대신 입주자별)
      setLastPayMethod(leaseLast ?? '')
      setLoadingHistory(false)
      // #14 할인 목록 로드
      setShowDiscForm(false)
      getRentDiscounts(room.leaseTermId).then(setPayDiscounts).catch(() => setPayDiscounts([]))
      getPrevOwnerSettleState(room.leaseTermId, targetMonth)
        .then(s => { setPrevOwnerCanSettle(s.canSettle); setPrevOwnerMenuMode(s.menuMode) })
        .catch(() => setPrevOwnerCanSettle(false))
    }
  }

  // 납입일 영구 변경(일할 정산) — 고객관리와 동일 기능, 수납관리에서도 사용
  const handleChangeDueDayPerm = () => {
    if (!selectedRoom?.leaseTermId || !newDueDayInput.trim()) return
    const calc = calcProRata(selectedRoom.expected, selectedRoom.dueDay, newDueDayInput, targetMonth)
    if (!calc || calc.type === 'none') return
    const adjustAmount = calc.type === 'extra' ? -calc.amount : calc.amount
    const leaseTermId = selectedRoom.leaseTermId
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await changeDueDay(leaseTermId, newDueDayInput.trim(), targetMonth, adjustAmount)
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        setShowDueDayChange(false)
        setNewDueDayInput('')
        setShowPayModal(false)
        router.refresh()
        pushToast('success', '납입일 변경됨')
      } catch (e) {
        const msg = e instanceof Error ? e.message : '변경 실패'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
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
    setEditTargetMonth(p.targetMonth)
    // 편집 시 귀속월 옵션 fetch (보증금이 아닌 경우)
    if (!p.isDeposit && selectedRoom?.leaseTermId) {
      getTargetMonthOptions(selectedRoom.leaseTermId, targetMonth).then(setTmOptions).catch(() => {})
    }
  }

  const handleSaveEdit = async () => {
    if (!editingPayId) return
    startTransition(async () => {
      const res = await withSave(() => updatePayment(editingPayId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
        targetMonth:  editTargetMonth || undefined,
      }), { success: '수납 기록 수정됨' })
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
      const release = trackSave()
      try {
        if (isDepositMode || isCleaningFeeMode) {
          await saveDepositPayment({
            leaseTermId:   selectedRoom.leaseTermId!,
            tenantId:      selectedRoom.tenantId!,
            targetMonth,
            depositAmount: isCleaningFeeMode ? selectedRoom.cleaningFee : selectedRoom.depositAmount,
            rentAmount:    selectedRoom.expected,
            totalPaid:     payAmount,
            payDate:       payDateVal,
            payMethod,
            memo:          isCleaningFeeMode ? (memo || '청소비') : (memo || undefined),
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
            forcedTargetMonth: forcedTm === 'auto' ? undefined : forcedTm,
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
        if (payMethod) {
          localStorage.setItem('stayeum-last-pay-method', payMethod)
          setLastPayMethod(payMethod)
        }
        setShowPayForm(false)
        setShowPayModal(false)
        router.refresh()
        pushToast('success', isDepositMode ? '보증금 수납됨' : isCleaningFeeMode ? '청소비 수납됨' : '월세 수납됨')
      } catch (err: unknown) {
        const msg = (err as Error).message
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  // #14 할인 추가/삭제
  const handleAddDiscount = () => {
    if (!selectedRoom?.leaseTermId) return
    if (!(discValue > 0)) { setError('할인 값을 입력하세요.'); return }
    if (discScope === 'temporary' && !discStart) { setError('일시 할인은 시작 월을 선택하세요.'); return }
    const leaseTermId = selectedRoom.leaseTermId
    startTransition(async () => {
      const res = await addRentDiscount({
        leaseTermId, discountType: discType, value: discValue, scope: discScope,
        startMonth: discScope === 'temporary' ? discStart : null,
        endMonth: discScope === 'temporary' ? (discEnd || null) : null,
      })
      if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
      setPayDiscounts(await getRentDiscounts(leaseTermId))
      setShowDiscForm(false); setDiscValue(0); setDiscStart(''); setDiscEnd('')
      router.refresh()
      pushToast('success', '할인 적용됨')
    })
  }
  const handleDeleteDiscount = (id: string) => {
    if (!selectedRoom?.leaseTermId) return
    const leaseTermId = selectedRoom.leaseTermId
    startTransition(async () => {
      const res = await deleteRentDiscount(id)
      if (!res.ok) { pushToast('error', res.error); return }
      setPayDiscounts(await getRentDiscounts(leaseTermId))
      router.refresh()
      pushToast('success', '할인 삭제됨')
    })
  }

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('이 수납 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      const release = trackSave()
      try {
        await deletePayment(paymentId)
        setShowPayModal(false)
        router.refresh()
        pushToast('success', '수납 기록 삭제됨')
      } catch (err: unknown) {
        const msg = (err as Error).message
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  function fmtDate(d: Date | string | null | undefined): string {
    if (!d) return '—'
    const dt = new Date(d)
    const DAYS = ['일', '월', '화', '수', '목', '금', '토']
    return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
  }

  // 요약 통계
  const unpaidCount   = occupied.filter(r => !r.isPaid).length
  const checkoutCount = occupied.filter(r => isCheckoutRoom(r)).length
  const awaitingCount = occupied.filter(r => isAwaitingRoom(r) && !isCheckoutRoom(r)).length
  const paidCount     = occupied.filter(r => r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r)).length

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
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] max-w-md w-[calc(100%-2rem)] bg-[var(--warm-dark)] text-white text-xs rounded-lg px-4 py-3 shadow-lift flex items-start gap-2">
          <span className="text-amber-300 shrink-0">✦</span>
          <span className="flex-1 leading-relaxed">{toast}</span>
          <button onClick={() => setToast(null)} className="shrink-0 text-white/60 hover:text-white">✕</button>
        </div>
      )}

      {/* 헤더 — 우측 월 셀렉터(기간) */}
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">수납 관리</h1>
        <MonthSelector />
      </div>

      {/* 검색창 */}
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] text-sm pointer-events-none">🔍</span>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="호실 번호 또는 입주자 이름 검색"
          className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm pl-9 pr-4 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
        />
        {search && (
          <button onClick={() => setSearch('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none">×</button>
        )}
      </div>

      {/* 빠른 필터 + 열 설정 */}
      <div className="flex gap-2 flex-wrap items-center">
        <SegmentedControl
          size="sm"
          scroll
          ariaLabel="수납 상태 필터"
          value={filter}
          onChange={setFilter}
          options={[
            { value: 'all',      label: `전체 ${occupied.length}실` },
            { value: 'unpaid',   label: `미납 ${unpaidCount}실` },
            { value: 'checkout', label: `퇴실 예정 ${checkoutCount}실` },
            { value: 'awaiting', label: `납부 예정 ${awaitingCount}실` },
            { value: 'paid',     label: `완납 ${paidCount}실` },
          ]}
        />
        {allFloors.length > 1 && (
          <select
            value={floorFilter}
            onChange={e => setFloorFilter(e.target.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors outline-none
              ${floorFilter
                ? 'bg-[var(--coral)] text-white border-[var(--coral)]'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}
          >
            <option value="">전체 층</option>
            {allFloors.map(f => <option key={f} value={f}>{f}층</option>)}
          </select>
        )}

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
              <div className="absolute right-0 mt-2 z-50 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl shadow-lift p-3 space-y-2 min-w-[140px]">
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

      {/* 모바일 정렬 */}
      <div className="sm:hidden">
        <SortSelect<SortKey>
          ariaLabel="호실 정렬 기준"
          value={sortKey}
          dir={sortDir}
          onChange={sk => { setSortKey(sk); setSortDir('desc') }}
          onToggleDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          options={[
            { value: 'status',        label: '수납상태' },
            { value: 'roomNo',        label: '호실순' },
            { value: 'dueDay',        label: '납부일' },
            { value: 'balance',       label: '잔액' },
            { value: 'expected',      label: '이용료' },
            { value: 'totalPaid',     label: '총납부액' },
            { value: 'tenantName',    label: '입주자' },
            { value: 'depositAmount', label: '보증금' },
            { value: 'contact',       label: '연락처' },
            { value: 'type',          label: '타입' },
            { value: 'windowType',    label: '창문' },
          ]}
        />
      </div>

      {/* 수납 현황 — 모바일 카드 뷰 */}
      <div className="sm:hidden space-y-2">
        {displayed.map(room => {
          const dueInfo = !room.isPaid ? getEffectiveDueInfo(room, targetMonth) : null
          const tone = roomStatusTone(room, targetMonth)
          return (
            <RoomCard key={room.roomId}
              kind="neutral"
              tipColor={statusTipColor(tone)}
              tipBg={statusRowTint(tone)}
              onClick={room.isFutureMonth ? undefined : () => openPayModal(room)}
              className={`px-4 py-3.5 ${room.isFutureMonth ? 'opacity-50' : ''}`}>
              {/* 첫 줄: 호실 + 수납상태 */}
              <div className="flex items-start justify-between">
                <div className="flex items-baseline gap-1.5">
                  <span className="text-base font-bold text-[var(--coral)]">{fmtRoomNo(room.roomNo)}</span>
                  {room.type && <span className="text-xs text-[var(--warm-muted)]">{room.type}</span>}
                </div>
                <div className="flex flex-col items-end gap-1">
                  {room.status === 'NON_RESIDENT' && <StatusBadge tone="info">비거주</StatusBadge>}
                  {room.status === 'RESERVED' ? (() => {
                    let sub: string | undefined
                    if (room.moveInDate) {
                      const days = Math.round((new Date(room.moveInDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                      sub = days > 0 ? `D-${days} 입주 예정` : days === 0 ? '오늘 입주' : `입주 예정일 ${Math.abs(days)}일 경과`
                    }
                    return <StatusBadge tone="movein" sub={sub}>{room.isReservationConfirmed ? '예약 확정' : '예약'}</StatusBadge>
                  })() : (() => {
                    const isAwaiting = room.isPaid && room.nextDueDate && room.nextDueAmount > 0
                    // 퇴실 예정 배지는 expectedMoveOut이 viewMonth 안(또는 그 이전)일 때만 표시
                    const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
                    const showCheckout = room.status === 'CHECKOUT_PENDING'
                      && room.isPaid && !!checkoutMonth && checkoutMonth <= targetMonth
                    // 미납 / 연체 — 7일 초과면 연체(Terracotta 솔리드), 그 외 미납(Amber)
                    if (!room.isPaid) {
                      const sub = dueInfo ? (dueInfo.days === 0 ? '오늘' : `${dueInfo.days}일 초과`) : undefined
                      const isOverdue = !!(dueInfo && dueInfo.days > 7)
                      return <StatusBadge tone={isOverdue ? 'overdue' : 'unpaid'} sub={sub}>{isOverdue ? '연체' : '미납'}</StatusBadge>
                    }
                    // 퇴실 예정 — Camel
                    if (showCheckout && room.expectedMoveOut) {
                      const [, mm, dd] = room.expectedMoveOut.split('-')
                      const days = Math.round((new Date(room.expectedMoveOut).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                      const sub = days > 0 ? `D-${days} (${Number(mm)}/${Number(dd)} 퇴실)` : days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 퇴실` : `${Number(mm)}/${Number(dd)} 퇴실 (${Math.abs(days)}일 경과)`
                      return <StatusBadge tone="exit" sub={sub}>퇴실 예정</StatusBadge>
                    }
                    if (showCheckout) return <StatusBadge tone="exit">퇴실 예정</StatusBadge>
                    // 납부 예정 — 알림 필요, Sand
                    if (isAwaiting) {
                      const [, mm, dd] = room.nextDueDate!.split('-')
                      const days = Math.round((new Date(room.nextDueDate!).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                      const sub = days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 납부일` : `D-${days} (${Number(mm)}/${Number(dd)})`
                      return <StatusBadge tone="await" sub={sub}>납부 예정</StatusBadge>
                    }
                    // 완납 — Olive 뱃지 (지연납부 이력이 있으면 sub로)
                    let lateSub: string | undefined
                    if (room.latePaidAt) {
                      const [, mm, dd] = room.latePaidAt.split('-')
                      lateSub = `${Number(mm)}/${Number(dd)} 지연납부`
                    }
                    return <StatusBadge tone="paid" sub={lateSub}>완납</StatusBadge>
                  })()}
                </div>
              </div>
              {/* 둘째 줄: 입주자 */}
              <p className="text-sm font-medium text-[var(--warm-dark)] mt-1">{room.tenantName}</p>
              {/* 셋째 줄: 월이용료 · 잔액/예정 · 납부일 */}
              <div className="flex items-center gap-2.5 mt-2 text-xs text-[var(--warm-mid)] flex-wrap">
                <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={room.expected} /></span>
                {/* 진짜 미수 = 이월 미수 + (이번 달 도래 후 미회수). 도래 전 청구는 미수 아님.
                   carryOver < 0이면 이월 미수, balance < 0이면 viewMonth 정산 부족.
                   단, viewMonth가 도래 전이면 balance는 미수 아닌 '예정 잔액'이므로
                   nextDueDate가 있을 때(도래 전 + 이월 없음)는 carryOver만 카운트. */}
                {(() => {
                  const carryUnpaid    = room.carryOver < 0 ? -room.carryOver : 0
                  // viewMonth 도래 전이면(=nextDueDate 있음) balance는 미수 아님.
                  // nextDueDate가 null인 케이스: (a) 도래 후 미회수 (b) 이월 있어 nextDue 미표시.
                  // (b)일 때 balance는 5월 단일 청구액으로 잡혀 있어 미수에 합산하면 과대 계산.
                  // → balance는 carryOver==0이고 nextDueDate==null일 때만 미수에 합산.
                  const viewUnpaid     = (!room.isPaid && room.carryOver === 0 && !room.nextDueDate && room.balance < 0)
                                          ? -room.balance : 0
                  const totalUnpaid    = carryUnpaid + viewUnpaid
                  if (totalUnpaid > 0) {
                    return <span className="font-medium text-[var(--coral)]">미수 -<MoneyDisplay amount={totalUnpaid} /></span>
                  }
                  if (room.balance > 0) {
                    return <span className="text-[var(--warm-mid)]">선납 +<MoneyDisplay amount={room.balance} /></span>
                  }
                  return null
                })()}
                {room.isPaid && room.nextDueDate && room.nextDueAmount > 0 && (
                  <span className="text-[var(--warm-mid)]">
                    예정 <MoneyDisplay amount={room.nextDueAmount} />
                  </span>
                )}
                {room.dueDay && (
                  <span className="text-[var(--warm-muted)]">
                    {room.dueDay === '말일' ? '매월 말일' : `매월 ${room.dueDay}일`}
                  </span>
                )}
              </div>
            </RoomCard>
          )
        })}
        {displayed.length === 0 && (
          <p className="text-sm text-[var(--warm-muted)] text-center py-6">
            {search ? '검색 결과가 없습니다.' : '해당하는 호실이 없습니다.'}
          </p>
        )}
      </div>

      {/* 수납 현황 — 데스크탑 테이블 */}
      <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100dvh-240px)]">
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
              {displayed.map(room => {
                const tone = roomStatusTone(room, targetMonth)
                return (
                <tr key={room.roomId}
                  onClick={() => !room.isFutureMonth && openPayModal(room)}
                  className={`border-b border-[var(--warm-border)]/50 transition-colors
                    ${room.isFutureMonth ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:scale-[0.995] active:opacity-80'}`}>

                  {/* sticky — 호실 */}
                  <td className="px-4 py-4 text-sm font-bold text-[var(--coral)] overflow-hidden sticky left-0 z-20 bg-[var(--cream)]"
                    style={{ width: colWidths.roomNo, minWidth: colWidths.roomNo, maxWidth: colWidths.roomNo, borderLeft: `3px solid ${statusTipColor(tone)}` }}>
                    <span className="truncate block">{fmtRoomNo(room.roomNo)}</span>
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
                      <span className={room.balance >= 0 ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'}>
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
                        {room.status === 'NON_RESIDENT' && <StatusBadge tone="info">비거주</StatusBadge>}
                        {room.status === 'RESERVED' ? (() => {
                          let sub: string | undefined
                          if (room.moveInDate) {
                            const days = Math.round((new Date(room.moveInDate).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                            sub = days > 0 ? `D-${days} 입주 예정` : days === 0 ? '오늘 입주' : `${Math.abs(days)}일 경과`
                          }
                          return <StatusBadge tone="movein" sub={sub}>{room.isReservationConfirmed ? '예약 확정' : '예약'}</StatusBadge>
                        })() : (() => {
                          const isAwaiting = room.isPaid && room.nextDueDate && room.nextDueAmount > 0
                          const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
                          const showCheckout = room.status === 'CHECKOUT_PENDING'
                            && room.isPaid && !!checkoutMonth && checkoutMonth <= targetMonth
                          if (!room.isPaid) {
                            const info = getEffectiveDueInfo(room, targetMonth)
                            const sub = info ? (info.days === 0 ? '오늘' : `${info.days}일 초과`) : undefined
                            const isOverdue = !!(info && info.days > 7)
                            return <StatusBadge tone={isOverdue ? 'overdue' : 'unpaid'} sub={sub}>{isOverdue ? '연체' : '미납'}</StatusBadge>
                          }
                          if (showCheckout && room.expectedMoveOut) {
                            const [, mm, dd] = room.expectedMoveOut.split('-')
                            const days = Math.round((new Date(room.expectedMoveOut).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                            const sub = days > 0 ? `D-${days} (${Number(mm)}/${Number(dd)} 퇴실)` : days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 퇴실` : `${Number(mm)}/${Number(dd)} 퇴실 (${Math.abs(days)}일 경과)`
                            return <StatusBadge tone="exit" sub={sub}>퇴실 예정</StatusBadge>
                          }
                          if (showCheckout) return <StatusBadge tone="exit">퇴실 예정</StatusBadge>
                          if (isAwaiting) {
                            const [, mm, dd] = room.nextDueDate!.split('-')
                            const days = Math.round((new Date(room.nextDueDate!).setHours(0,0,0,0) - new Date().setHours(0,0,0,0)) / 86400000)
                            const sub = days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 납부일` : `D-${days} (${Number(mm)}/${Number(dd)})`
                            return <StatusBadge tone="await" sub={sub}>납부 예정</StatusBadge>
                          }
                          let lateSub: string | undefined
                          if (room.latePaidAt) {
                            const [, mm, dd] = room.latePaidAt.split('-')
                            lateSub = `${Number(mm)}/${Number(dd)} 지연납부`
                          }
                          return <StatusBadge tone="paid" sub={lateSub}>완납</StatusBadge>
                        })()}
                      </div>
                    </td>
                  )}
                </tr>
                )
              })}
            </tbody>
          </table>
      </div>

      {/* 공실 섹션 */}
      {vacants.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--warm-muted)]">공실 {vacants.length}실</h2>
            {/* 공실 표시 정보 설정 — 데스크탑(열)·모바일(카드 칩) 공통 */}
            <div className="relative" ref={vacantColMenuRef}>
              <button
                onClick={() => setShowVacantColMenu(v => !v)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full transition-colors
                  ${showVacantColMenu ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'}`}
              >
                <span>⚙</span> 열 설정
              </button>
              {showVacantColMenu && (
                <div className="absolute right-0 top-full mt-1.5 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-3 z-50 shadow-lift min-w-[160px] space-y-2">
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

          {/* 공실 — 모바일 카드 (열 설정으로 고른 정보를 칩으로, 최대 4개) */}
          <div className="sm:hidden grid grid-cols-2 gap-2">
            {sortedVacants.map(room => {
              // 선택된 표시 정보 — 가격이 다른 이유(창문·방향 등)를 카드만 봐도 알 수 있게
              const chips: string[] = []
              if (vacantColVis.type && room.type) chips.push(room.type)
              if (vacantColVis.windowType && room.windowType) chips.push(WINDOW_LABEL[room.windowType] ?? room.windowType)
              if (vacantColVis.direction && room.direction) chips.push(room.direction)
              if (vacantColVis.floor && room.floor) chips.push(/^\d+$/.test(room.floor) ? `${room.floor}층` : room.floor)
              const shown = chips.slice(0, 4)   // 공간 한도 — 최대 4개
              return (
                <div key={room.roomId} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-4 py-3 space-y-1.5">
                  <span className="text-sm font-bold text-[var(--warm-mid)]">{fmtRoomNo(room.roomNo)}</span>
                  {shown.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {shown.map((c, i) => (
                        <span key={i} className="text-[0.625rem] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>{c}</span>
                      ))}
                    </div>
                  )}
                  {vacantColVis.baseRent && (
                    <p className="text-sm font-semibold text-[var(--warm-dark)]">
                      {room.baseRent > 0 ? <MoneyDisplay amount={room.baseRent} /> : '—'}
                    </p>
                  )}
                  {vacantColVis.prevTenantName && room.prevTenantName && (
                    <p className="text-[0.625rem] text-[var(--warm-muted)] truncate">직전 {room.prevTenantName}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* 공실 — 데스크탑 테이블 */}
          <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-64">
            <table className="w-full min-w-[400px]">
              <thead className="sticky top-0 z-10 bg-[var(--cream)]">
                <tr className="border-b border-[var(--warm-border)]">
                  <VSortTh label="호실" sk="roomNo" />
                  {vacantColVis.type           && <VSortTh label="타입"          sk="type" />}
                  {vacantColVis.windowType     && <VSortTh label="창문"          sk="windowType" />}
                  {vacantColVis.direction      && <th className={thCls}>방향</th>}
                  {vacantColVis.floor          && <th className={thCls}>층</th>}
                  {vacantColVis.baseRent       && <VSortTh label="기본 월이용료" sk="baseRent" />}
                  {vacantColVis.prevTenantName && <VSortTh label="직전 입주자"   sk="prevTenantName" />}
                  {vacantColVis.prevContact    && <th className={thCls}>직전 연락처</th>}
                </tr>
              </thead>
              <tbody>
                {sortedVacants.map(room => (
                  <tr key={room.roomId} className="border-b border-[var(--warm-border)]/50">
                    <td className="px-4 py-3 text-sm font-bold text-[var(--warm-mid)]">{fmtRoomNo(room.roomNo)}</td>
                    {vacantColVis.type && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.type ?? '—'}</td>
                    )}
                    {vacantColVis.windowType && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">
                        {room.windowType ? (WINDOW_LABEL[room.windowType] ?? room.windowType) : '—'}
                      </td>
                    )}
                    {vacantColVis.direction && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.direction ?? '—'}</td>
                    )}
                    {vacantColVis.floor && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.floor ? (/^\d+$/.test(room.floor) ? `${room.floor}층` : room.floor) : '—'}</td>
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
        <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4"
          onClick={() => { setShowPayModal(false); setShowPayForm(false) }}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-md flex flex-col max-h-[88vh]"
            onClick={e => e.stopPropagation()}>

            {/* 헤더 */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <div>
                <h2 className="text-base font-bold text-[var(--warm-dark)]">
                  {fmtRoomNo(selectedRoom.roomNo)} — {selectedRoom.tenantName}
                </h2>
                <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                  예정 {selectedRoom.expected.toLocaleString()}원
                  {selectedRoom.dueDay && ` · ${selectedRoom.dueDay.includes('말') ? '말일' : `${selectedRoom.dueDay}일`}`}
                </p>
              </div>
              <button onClick={() => { setShowPayModal(false); setShowPayForm(false) }}
                aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
            </div>

            {/* ── 읽기 전용 ── */}
            {!showPayForm && (
              <>
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  {/* 잔액 요약 — 귀속월(targetMonth) 기준 발생주의 */}
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
                  <p className="text-[0.625rem] text-[var(--warm-muted)] leading-relaxed">
                    총 수납·잔액·이월액은 귀속월 기준입니다. 지연 입금된 record도 그 귀속월에 인식됩니다.
                  </p>

                  {/* 납부 내역 */}
                  {(loadingHistory || paymentHistory.length > 0 || selectedRoom.prevPaidThisMonth) && (() => {
                    const isPreAcq = (p: PaymentRecord) => !!(payAcquisitionDate && new Date(p.payDate) < payAcquisitionDate)
                    const prevOwnerPaid = paymentHistory.filter(p => !p.isDeposit && (isPreAcq(p) || p.isPrevOwner)).reduce((s, p) => s + p.actualAmount, 0)
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
                              const release = trackSave()
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
                                pushToast('success', '양도인 수납 저장됨')
                              } catch (e) {
                                const msg = e instanceof Error ? e.message : '저장 실패'
                                setError(msg); pushToast('error', msg)
                              } finally { release() }
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
                                  className="text-[0.625rem] text-amber-600 mt-0.5 hover:underline text-left">
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
                          const prevOwner = !p.isDeposit && (isPreAcq(p) || p.isPrevOwner)
                          if (editingPayId === p.id) {
                            return (
                              <div key={p.id} className="rounded-xl border border-[var(--coral)] bg-[var(--canvas)] px-3 py-2.5 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className="text-[0.625rem] text-[var(--warm-muted)]">금액</p>
                                    <input type="text" inputMode="numeric"
                                      value={editAmount.toLocaleString()}
                                      onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[0.625rem] text-[var(--warm-muted)]">납부일</p>
                                    <DatePicker value={editDate} onChange={setEditDate}
                                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className="text-[0.625rem] text-[var(--warm-muted)]">납부방법</p>
                                    <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                                      {!['계좌이체', '현금', '신용카드', '기타'].includes(editPayMethod) && editPayMethod && (
                                        <option value={editPayMethod}>{editPayMethod}</option>
                                      )}
                                      <option value="계좌이체">계좌이체</option>
                                      <option value="현금">현금</option>
                                      <option value="신용카드">신용카드</option>
                                      <option value="기타">기타</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[0.625rem] text-[var(--warm-muted)]">메모</p>
                                    <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                </div>
                                {!p.isDeposit && (
                                  <div className="space-y-1">
                                    <p className="text-[0.625rem] text-[var(--warm-muted)]">귀속월 (이 record가 인식되는 월)</p>
                                    <select value={editTargetMonth} onChange={e => setEditTargetMonth(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                                      {/* 현재 record의 targetMonth가 옵션 목록에 없을 수 있어 항상 포함 */}
                                      {!tmOptions.some(o => o.month === p.targetMonth) && (
                                        <option value={p.targetMonth}>
                                          {Number(p.targetMonth.split('-')[0])}년 {Number(p.targetMonth.split('-')[1])}월분 (현재)
                                        </option>
                                      )}
                                      {tmOptions.map(o => {
                                        const [y, m] = o.month.split('-')
                                        const yn = Number(y), mn = Number(m)
                                        const tag =
                                          o.status === 'paid' ? '완납'
                                          : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${o.expectedAmount.toLocaleString()}원`
                                          : o.status === 'future' ? '향후'
                                          : '미수'
                                        return (
                                          <option key={o.month} value={o.month}>
                                            {yn}년 {mn}월분 — {tag}
                                          </option>
                                        )
                                      })}
                                    </select>
                                  </div>
                                )}
                                <div className="flex gap-2 justify-end">
                                  <Btn variant="secondary" size="sm" onClick={() => setEditingPayId(null)}>
                                    취소
                                  </Btn>
                                  <Btn variant="primary" size="sm" onClick={handleSaveEdit} disabled={isPending}>
                                    저장
                                  </Btn>
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
                                  {p.isDeposit && <span className="ml-1.5 text-[0.625rem] font-semibold bg-purple-200 text-purple-800 rounded px-1 py-0.5">보증금</span>}
                                  {prevOwner && <span className="ml-1.5 text-[0.625rem] font-semibold bg-amber-200 text-amber-800 rounded px-1 py-0.5">양도인</span>}
                                  {!p.isDeposit && (
                                    <span className={`ml-1.5 text-[0.625rem] font-semibold rounded px-1 py-0.5 ${
                                      p.targetMonth === targetMonth
                                        ? 'bg-[var(--cream-2)] text-[var(--warm-mid)]'
                                        : 'bg-[var(--badge-await-bg)] text-[var(--badge-await-fg)]'
                                    }`}>
                                      귀속 {Number(p.targetMonth.slice(5))}월
                                      {p.targetMonth < targetMonth && ' (지난 미납분)'}
                                      {p.targetMonth > targetMonth && ' (선납)'}
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
                                      className="text-[0.625rem] font-medium px-2 py-1 rounded-lg border transition-colors"
                                      style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
                                      수정
                                    </button>
                                    <button onClick={() => handleDeletePayment(p.id)}
                                      className="text-[0.625rem] font-medium px-2 py-1 rounded-lg border border-red-200 text-red-500 transition-colors">
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

                {/* #14 월세 할인 (입주자별, 여러 개) */}
                {selectedRoom.leaseTermId && (
                  <div className="border-t border-[var(--warm-border)] pt-3 mt-1 space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-medium text-emerald-600">월세 할인</p>
                      {!showDiscForm && (
                        <button onClick={() => { setShowDiscForm(true); setError('') }}
                          className="text-xs px-2.5 py-1 rounded-lg border border-emerald-300 text-emerald-600 hover:bg-emerald-50 transition-colors">+ 할인 추가</button>
                      )}
                    </div>
                    {payDiscounts.length === 0 && !showDiscForm && (
                      <p className="text-[0.6875rem] text-[var(--warm-muted)]">적용된 할인이 없습니다.</p>
                    )}
                    {payDiscounts.map(d => (
                      <div key={d.id} className="flex items-center gap-2 text-xs">
                        <span className="flex-1 text-[var(--warm-dark)]">{discountLabel(d)}</span>
                        <button onClick={() => handleDeleteDiscount(d.id)} disabled={isPending}
                          className="text-[0.6875rem] px-2 py-1 rounded-lg border border-red-200 text-red-400 hover:text-red-600 transition-colors disabled:opacity-40">삭제</button>
                      </div>
                    ))}
                    {showDiscForm && (
                      <div className="rounded-xl border border-emerald-200 bg-emerald-50/40 p-3 space-y-2">
                        <div className="flex gap-2">
                          <select value={discType} onChange={e => setDiscType(e.target.value as 'amount' | 'percent')}
                            className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none">
                            <option value="amount">금액(원)</option>
                            <option value="percent">퍼센트(%)</option>
                          </select>
                          <div className="flex-1">
                            <MoneyInput value={discValue} onChange={setDiscValue} placeholder={discType === 'percent' ? '예: 10' : '예: 50000'} />
                          </div>
                        </div>
                        <select value={discScope} onChange={e => setDiscScope(e.target.value as 'permanent' | 'temporary')}
                          className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none">
                          <option value="permanent">영구(매월)</option>
                          <option value="temporary">일시(기간)</option>
                        </select>
                        {discScope === 'temporary' && (
                          <div className="flex items-center gap-1.5">
                            <div className="flex-1">
                              <DatePicker monthOnly placeholder="시작 월"
                                value={discStart ? discStart + '-01' : ''}
                                onChange={v => setDiscStart(v ? v.slice(0, 7) : '')}
                                className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)]" />
                            </div>
                            <span className="text-xs text-[var(--warm-muted)]">~</span>
                            <div className="flex-1">
                              <DatePicker monthOnly placeholder="끝(무기한)"
                                value={discEnd ? discEnd + '-01' : ''}
                                onChange={v => setDiscEnd(v ? v.slice(0, 7) : '')}
                                className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-xs text-[var(--warm-dark)]" />
                            </div>
                          </div>
                        )}
                        <div className="flex gap-2">
                          <button onClick={() => { setShowDiscForm(false); setError('') }}
                            className="flex-1 py-1.5 text-sm rounded-lg border border-[var(--warm-border)] text-[var(--warm-mid)]">취소</button>
                          <button onClick={handleAddDiscount} disabled={isPending || !(discValue > 0)}
                            className="flex-1 py-1.5 text-sm font-medium rounded-lg text-white disabled:opacity-50" style={{ background: '#16a34a' }}>적용</button>
                        </div>
                        <p className="text-[0.625rem] text-[var(--warm-muted)]">할인은 해당 월 청구액(이용료)에서 차감돼 미수 계산에 반영됩니다.</p>
                      </div>
                    )}
                  </div>
                )}

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
                                    const release = trackSave()
                                    try {
                                      await clearDueDayOverride(leaseTermId)
                                      router.refresh()
                                      pushToast('success', '이번 달 납부일 임시 변경 해제됨')
                                    } finally { release() }
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
                              const release = trackSave()
                              try {
                                await setDueDayOverride(leaseTermId, targetMonth, val, reason || undefined)
                                router.refresh()
                                pushToast('success', '이번 달 납부일 임시 변경됨')
                              } finally { release() }
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

                {/* 납입일 영구 변경 (일할 정산) — 고객관리와 동일 */}
                {canEdit && selectedRoom.leaseTermId && (
                  <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
                    {!showDueDayChange ? (
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p className="text-xs font-medium text-[var(--warm-mid)]">납입일 영구 변경</p>
                          <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">일할 정산 후 다음 달부터 계속 적용</p>
                        </div>
                        <button type="button"
                          onClick={() => { setShowDueDayChange(true); setNewDueDayInput('') }}
                          className="text-[0.6875rem] px-2 py-1 rounded transition-colors shrink-0"
                          style={{ color: 'var(--coral)', border: '1px solid rgba(160,60,46,0.35)' }}>
                          변경
                        </button>
                      </div>
                    ) : (() => {
                      const calc = newDueDayInput.trim()
                        ? calcProRata(selectedRoom.expected, selectedRoom.dueDay, newDueDayInput, targetMonth)
                        : null
                      const canApply = !!calc && calc.type !== 'none'
                      return (
                        <div className="space-y-2.5">
                          <p className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>
                            납입일 영구 변경 — {targetMonth} 기준 일할 정산
                          </p>
                          <div className="flex items-end gap-3">
                            <div className="flex-1 space-y-1">
                              <label className="text-xs text-[var(--warm-muted)]">새 납입일</label>
                              <input type="text" value={newDueDayInput}
                                onChange={e => setNewDueDayInput(e.target.value)}
                                placeholder="예: 25, 말일"
                                className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
                                style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }} />
                            </div>
                            <div className="text-xs pb-1.5" style={{ color: 'var(--warm-muted)' }}>
                              현재 {selectedRoom.dueDay ? (selectedRoom.dueDay.includes('말') ? '말일' : `${selectedRoom.dueDay}일`) : '—'}
                            </div>
                          </div>
                          {calc && calc.type !== 'none' && (
                            <div className="rounded-lg px-3 py-2 text-xs font-medium"
                              style={{
                                background: calc.type === 'extra' ? 'rgba(160,60,46,0.10)' : 'rgba(122,154,82,0.12)',
                                color: calc.type === 'extra' ? 'var(--coral-dark)' : '#4e6834',
                                border: `1px solid ${calc.type === 'extra' ? 'rgba(160,60,46,0.20)' : 'rgba(122,154,82,0.25)'}`,
                              }}>
                              {calc.type === 'extra'
                                ? `납입일 ${calc.days}일 늦어짐 → 추가납부 ${calc.amount.toLocaleString()}원 발생`
                                : `납입일 ${calc.days}일 빨라짐 → 과입금 ${calc.amount.toLocaleString()}원 환급`}
                              <span className="block mt-0.5 font-normal" style={{ color: 'var(--warm-muted)' }}>
                                월 {selectedRoom.expected.toLocaleString()}원 ÷ {PRORATE_BASE_DAYS}일 × {calc.days}일
                              </span>
                            </div>
                          )}
                          {calc && calc.type === 'none' && (
                            <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>기존 납입일과 동일합니다.</p>
                          )}
                          {newDueDayInput.trim() && !calc && (
                            <p className="text-xs" style={{ color: 'var(--coral)' }}>유효한 날짜를 입력하세요 (1~31 또는 말일)</p>
                          )}
                          <div className="flex gap-2">
                            <Btn type="button" variant="secondary" size="sm"
                              onClick={() => { setShowDueDayChange(false); setNewDueDayInput('') }}
                              className="flex-1">
                              취소
                            </Btn>
                            <Btn type="button" variant="primary" size="sm"
                              disabled={isPending || !canApply}
                              onClick={handleChangeDueDayPerm}
                              className="flex-1 font-semibold">
                              {isPending ? '처리 중...' : '변경 적용'}
                            </Btn>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* 읽기 전용 푸터 */}
                <div className="border-t border-[var(--warm-border)] px-6 py-3 flex gap-2 shrink-0 flex-wrap items-center">
                  {canEdit && selectedRoom.leaseTermId && (
                    <div className="flex items-center gap-1">
                      <span className="text-[0.625rem] text-[var(--warm-muted)]">양도인 메뉴</span>
                      <select
                        value={prevOwnerMenuMode}
                        onChange={e => {
                          const mode = e.target.value as 'auto' | 'show' | 'hide'
                          setPrevOwnerMenuMode(mode)
                          startTransition(async () => {
                            const release = trackSave()
                            try {
                              await setPrevOwnerSettleMenu(selectedRoom.leaseTermId!, mode)
                              const s = await getPrevOwnerSettleState(selectedRoom.leaseTermId!, targetMonth)
                              setPrevOwnerCanSettle(s.canSettle)
                              pushToast('success', '양도인 정산 메뉴 설정 변경됨')
                            } finally { release() }
                          })
                        }}
                        className="text-[0.625rem] bg-[var(--canvas)] border border-[var(--warm-border)] rounded-md px-1.5 py-1 text-[var(--warm-dark)] outline-none">
                        <option value="auto">자동</option>
                        <option value="show">항상 표시</option>
                        <option value="hide">숨김</option>
                      </select>
                    </div>
                  )}
                  {selectedRoom.tenantId && (
                    <button
                      type="button"
                      onClick={() => entityModal.open({ kind: 'tenant', tenantId: selectedRoom.tenantId! })}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                      입주자 정보
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => entityModal.open({ kind: 'room', roomId: selectedRoom.roomId })}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                    호실 정보
                  </button>
                  <div className="flex-1" />
                  {canEdit && prevOwnerCanSettle && (
                    <button
                      type="button"
                      onClick={() => {
                        if (!selectedRoom.leaseTermId) return
                        if (!confirm(`${Number(targetMonth.slice(5))}월 임대료를 양도인 정산으로 처리할까요?\n이 달은 현 소유주 미납·매출 집계에서 제외됩니다.`)) return
                        startTransition(async () => {
                          const release = trackSave()
                          try {
                            const res = await savePrevOwnerSettle(selectedRoom.leaseTermId!, targetMonth)
                            if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
                            pushToast('success', '양도인 정산 처리됨')
                            setShowPayModal(false)
                            router.refresh()
                          } finally { release() }
                        })
                      }}
                      className="px-3 py-2 text-xs font-medium rounded-lg bg-amber-50 border border-amber-200 text-amber-700 hover:bg-amber-100 transition-colors">
                      양도인 정산
                    </button>
                  )}
                  {canEdit && (
                    <Btn variant="primary" size="md" onClick={() => { setShowPayForm(true); setError('') }}>
                      수납 등록
                    </Btn>
                  )}
                </div>
              </>
            )}

            {/* ── 수납 등록 폼 ── */}
            {showPayForm && (
              <form onSubmit={handleSavePayment} className="flex flex-col flex-1 overflow-hidden">
                <div className="flex-1 overflow-y-auto p-6 space-y-3">
                  {!isDepositMode && !isCleaningFeeMode && (
                    <>
                      <p className="text-[0.625rem] text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed">
                        기본은 미수가 있는 가장 오래된 월부터 자동 충당(FIFO·발생주의)입니다. 특정 월로 귀속시키려면 아래에서 직접 선택하세요.
                      </p>
                      <div className="space-y-1">
                        <label className="text-xs text-[var(--warm-muted)]">귀속월</label>
                        <select
                          value={forcedTm}
                          onChange={e => setForcedTm(e.target.value as 'auto' | string)}
                          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
                        >
                          <option value="auto">자동 (FIFO · 가장 오래된 미수월부터)</option>
                          {tmOptions.map(o => {
                            const [y, m] = o.month.split('-')
                            const yn = Number(y), mn = Number(m)
                            const tag =
                              o.status === 'paid' ? '완납'
                              : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${o.expectedAmount.toLocaleString()}원`
                              : o.status === 'future' ? '향후'
                              : '미수'
                            return (
                              <option key={o.month} value={o.month}>
                                {yn}년 {mn}월분 — {tag}
                              </option>
                            )
                          })}
                        </select>
                        {forcedTm !== 'auto' && (
                          <p className="text-[0.625rem] text-amber-600 leading-relaxed">
                            FIFO 우회 — 입력 금액이 한 달 이용료를 초과하면 그 다음 달로 이월됩니다.
                          </p>
                        )}
                      </div>
                    </>
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
                              setIsCleaningFeeMode(false)
                              // #11: 보증금 + 이번 달 이용료 전체로 프리필 (청소비 모드와 동일).
                              //      이전엔 보증금만 채워서, 사용자가 입력한 합산금액이 보증금으로 덮어써져 월세가 누락됐음.
                              setPayAmount(selectedRoom.depositAmount + selectedRoom.expected)
                              setPayDateVal(selectedRoom.moveInDate ?? kstYmdStr())
                            } else {
                              setPayDateVal(kstYmdStr())
                            }
                          }}
                          className="w-4 h-4 accent-[var(--coral)]"
                        />
                        <span className="text-xs text-[var(--warm-mid)]">
                          보증금 수납 ({fmtKorMoney(selectedRoom.depositAmount)})
                        </span>
                      </label>
                      {isDepositMode && (
                        payAmount > selectedRoom.depositAmount ? (
                          <p className="text-xs text-emerald-600">
                            보증금 {fmtKorMoney(selectedRoom.depositAmount)} + 이용료 {fmtKorMoney(payAmount - selectedRoom.depositAmount)} = {fmtKorMoney(payAmount)}
                          </p>
                        ) : (
                          <p className="text-xs text-[var(--warm-muted)]">
                            보증금만 수납 (이용료 포함하려면 금액을 늘리세요 — 초과분은 {targetMonth} 이용료로 처리)
                          </p>
                        )
                      )}
                    </div>
                  )}
                  {selectedRoom.depositAmount === 0 && selectedRoom.cleaningFee > 0 && (
                    <div className="space-y-1">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isCleaningFeeMode}
                          onChange={e => {
                            const checked = e.target.checked
                            setIsCleaningFeeMode(checked)
                            if (checked) {
                              setPayAmount(selectedRoom.cleaningFee + selectedRoom.expected)
                              setPayDateVal(selectedRoom.moveInDate ?? kstYmdStr())
                            } else {
                              setPayDateVal(kstYmdStr())
                            }
                          }}
                          className="w-4 h-4 accent-[var(--coral)]"
                        />
                        <span className="text-xs text-[var(--warm-mid)]">
                          청소비 포함 수납 (청소비 {fmtKorMoney(selectedRoom.cleaningFee)})
                        </span>
                      </label>
                      {isCleaningFeeMode && (
                        <p className="text-xs text-emerald-600">
                          청소비 {fmtKorMoney(selectedRoom.cleaningFee)} + 이용료 {fmtKorMoney(selectedRoom.expected)} = {fmtKorMoney(selectedRoom.cleaningFee + selectedRoom.expected)}
                        </p>
                      )}
                    </div>
                  )}
                  <div className="space-y-1">
                    <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
                    {/* #5: key에 lastPayMethod 포함 — lease 최근 방법이 fetch로 도착하면 select가 remount되어 기본값 반영 */}
                    <select key={`pm-${selectedRoom?.leaseTermId ?? ''}-${lastPayMethod}`} name="payMethod" defaultValue={lastPayMethod || '계좌이체'}
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                      <option value="계좌이체">계좌이체</option>
                      <option value="현금">현금</option>
                      <option value="신용카드">신용카드</option>
                      <option value="기타">기타</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-[var(--warm-muted)]">메모</label>
                    <input type="text" name="memo" placeholder="메모 (선택)"
                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
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
    </div>
  )
}
