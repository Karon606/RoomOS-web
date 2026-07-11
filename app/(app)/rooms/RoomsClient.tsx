'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import MonthSelector from '@/components/layout/MonthSelector'
import { formatPhone } from '@/lib/formatPhone'
import { useUrlState } from '@/lib/useUrlState'
import { useLongPress } from '@/lib/useLongPress'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { InfoHint } from '@/components/ui/InfoHint'
import { SortSelect } from '@/components/ui/SortSelect'
import { RoomCard } from '@/components/ui/RoomCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchBar } from '@/components/ui/SearchBar'
import { IncomeSection, type Income, type LeaseOption } from './IncomeSection'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { fmtKorMoney, fmtWon } from '@/lib/fmtMoney'
import { DisplayFieldsMenu } from '@/components/ui/DisplayFieldsMenu'
import { Modal } from '@/components/ui/Modal'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { batchRecordRentPayment, batchDeletePayments } from './actions'
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
  lastPayDate: string | null
  nextDueDate: string | null
  nextDueAmount: number
  expectedMoveOut: string | null
}

// ── 열 설정 ──────────────────────────────────────────────────────

type ColKey = 'type' | 'windowType' | 'contact' | 'depositAmount' | 'expected' | 'totalPaid' | 'balance' | 'dueDay' | 'status'

// defaultOn — 데스크탑 표 + 모바일 카드 공통 정책. 모바일 카드에서 항상 보이던 '타입'을
// colVis 토글 대상에 편입하면서 default true 로 변경 (회귀 방지, 2026-06-01).
const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'type',          label: '타입',     defaultOn: true  },
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

// 퇴실 예정 보조 문구 — "6/26 퇴실 D-13" / "오늘 6/26 퇴실" / "6/26 퇴실 13일 경과".
// 미납 뱃지(완납 전)에도 퇴실 임박 정보를 함께 보여주기 위해 사용(B안).
function checkoutSubText(expectedMoveOut: string | null): string | null {
  if (!expectedMoveOut) return null
  const [, mm, dd] = expectedMoveOut.split('-')
  const days = Math.round((new Date(expectedMoveOut).setHours(0, 0, 0, 0) - new Date().setHours(0, 0, 0, 0)) / 86400000)
  const label = `${Number(mm)}/${Number(dd)} 퇴실`
  return days > 0 ? `${label} D-${days}` : days === 0 ? `오늘 ${label}` : `${label} ${Math.abs(days)}일 경과`
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
  roomStatus, targetMonth, myRole, incomes, incomeCategories, initialTab,
}: {
  roomStatus: RoomStatus[]
  targetMonth: string
  myRole: string
  incomes: Income[]
  incomeCategories: string[]
  initialTab?: 'rooms' | 'income'
}) {
  const searchParams = useSearchParams()
  const entityModal = useEntityModal()
  // 수납 / 부가수익 탭 — 부가수익은 /finance에서 이동(2026-07-02, 과납·보증금 몰수 등 수납 파생 수익)
  const [viewTab, setViewTab] = useState<'rooms' | 'income'>(initialTab ?? 'rooms')
  const [filter, setFilter] = useState<'all' | 'unpaid' | 'checkout' | 'awaiting' | 'paid' | 'adjusted' | 'vacant'>('all')
  const [floorFilter, setFloorFilter] = useState('')
  const [colVis, setColVis] = useState<Record<ColKey, boolean>>(DEFAULT_VIS)
  const [vacantColVis, setVacantColVis] = useState<Record<VacantColKey, boolean>>(DEFAULT_VACANT_VIS)
  const [vacantSortKey, setVacantSortKey] = useState<VacantSortKey>('roomNo')
  const [vacantSortDir, setVacantSortDir] = useState<SortDir>('asc')
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [search, setSearch] = useUrlState('q', '')
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const colWidthsRef              = useRef<Record<string, number>>(DEFAULT_WIDTHS)

  // ── 선택 모드 + 일괄 수납 (v2.0 §23 선택모드 · v2.0 §16 적용취소) ──────────────
  const router = useRouter()
  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen]     = useState(false)
  const [batchMethod, setBatchMethod] = useState('계좌이체')
  const [batchDate, setBatchDate]     = useState('')      // 열 때 오늘(KST)로 채움
  const [batchBusy, setBatchBusy]     = useState(false)
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const press = useLongPress()      // 데스크톱 행 꾹 눌러 선택 진입 (v2.0 §23 공통 제스처, 카드는 RoomCard 내장)
  // 일괄 수납 대상 — 비공실 + 미래월 아님 + 이번 달 미수(balance<0)
  const isBatchEligible = (r: RoomStatus) =>
    !r.isVacant && !r.isFutureMonth && !!r.leaseTermId && r.balance < 0

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

  // 열 설정 드롭다운 외부 클릭 닫기는 DisplayFieldsMenu가 자체 처리(v2.0 §23 통일)

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
  // 이 달(targetMonth)에 납부일 임시 조정이 적용된 호실
  const isAdjustedRoom = (r: RoomStatus) =>
    !!r.overrideDueDay && r.overrideDueDayMonth === targetMonth
  const filtered = occupied.filter(r => {
    if (floorFilter && getRoomFloor(r) !== floorFilter) return false
    if (filter === 'unpaid')   return !r.isPaid
    if (filter === 'checkout') return isCheckoutRoom(r)
    if (filter === 'awaiting') return isAwaitingRoom(r) && !isCheckoutRoom(r)
    if (filter === 'paid')     return r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r)
    if (filter === 'adjusted') return isAdjustedRoom(r)
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

  // Phase 2.4c (2026-05-30): 자체 수납 모달 제거. 카드 클릭/URL 진입 → 전역 Prism 셸 사용.
  // 셸의 PaymentBody (summary/full) 가 모든 수납 기능 in-place 처리.
  const openPayModal = (room: RoomStatus) => {
    if (!room.leaseTermId) return
    entityModal.open({
      kind: 'payment',
      leaseTermId: room.leaseTermId,
      roomId: room.roomId,
      tenantId: room.tenantId ?? undefined,
    })
  }

  // 일괄 수납 — 선택된 호실 중 '대상'만, 이번 달 미수 합계
  const batchTargets = displayed.filter(r => selectedIds.has(r.roomId) && isBatchEligible(r))
  const batchTotal   = batchTargets.reduce((s, r) => s + Math.max(0, Math.round(-r.balance)), 0)

  const openBatchPay = () => {
    setBatchDate(kstYmdStr())
    try { const m = localStorage.getItem('stayeum-last-pay-method'); if (m) setBatchMethod(m) } catch {}
    setBatchOpen(true)
  }

  const runBatchPay = async () => {
    if (batchBusy) return
    const ids = batchTargets.map(r => r.roomId)
    if (!ids.length) { setBatchOpen(false); return }
    setBatchBusy(true)
    try {
      const res = await batchRecordRentPayment({
        targetMonth, roomIds: ids, payDate: batchDate || kstYmdStr(), payMethod: batchMethod,
      })
      if (!res.ok) { pushToast('error', res.error); return }
      try { localStorage.setItem('stayeum-last-pay-method', batchMethod) } catch {}
      setBatchOpen(false)
      exitSelectMode()
      const created = res.createdIds
      pushToast('success', `${res.paidRoomNos.length}개 호실 일괄 수납 완료`, {
        detail: res.skippedRoomNos.length
          ? `${res.skippedRoomNos.length}개 호실은 대상 아님(완납·미래월 등)으로 제외`
          : undefined,
        action: created.length ? {
          label: '적용취소',
          run: async () => {
            const u = await batchDeletePayments(created)
            if (u.ok) pushToast('info', '일괄 수납을 취소했습니다')
            router.refresh()
          },
        } : undefined,
      })
      router.refresh()
    } finally {
      setBatchBusy(false)
    }
  }

  // ?roomNo=xxx 딥링크 — 대시보드 등에서 넘어올 때 해당 호실 셸 자동 오픈
  useEffect(() => {
    const roomNo = searchParams.get('roomNo')
    if (!roomNo) return
    const room = roomStatus.find(r => r.roomNo === roomNo)
    if (room && !room.isFutureMonth && room.leaseTermId) {
      entityModal.open({
        kind: 'payment',
        leaseTermId: room.leaseTermId,
        roomId: room.roomId,
        tenantId: room.tenantId ?? undefined,
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 요약 통계
  const unpaidCount   = occupied.filter(r => !r.isPaid).length
  const checkoutCount = occupied.filter(r => isCheckoutRoom(r)).length
  const awaitingCount = occupied.filter(r => isAwaitingRoom(r) && !isCheckoutRoom(r)).length
  const paidCount     = occupied.filter(r => r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r)).length
  const adjustedCount = occupied.filter(r => isAdjustedRoom(r)).length

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

  // ── 상단 수납 진행 스트립 (표시 전용 — 서버가 계산한 행 값을 그대로 합산, §4 재계산 없음) ──
  // 예상 = 이 화면 행들의 그 달 청구액 합(Σ expected) → 공실 제외·무청구 퇴실월 0원·퇴실 일할이 자동 반영.
  // 수납 = 예상 − 이번 달 미수(행별 balance<0, 이월 미수와 구분되도록 expected로 캡).
  // 만실 시 = 예상 + 공실들의 기준 임대료(baseRent) — 점유 손실 참고치.
  const expectedSum  = occupied.reduce((s, r) => s + r.expected, 0)
  const collectedSum = occupied.reduce((s, r) => s + (r.expected - Math.min(r.expected, Math.max(0, -r.balance))), 0)
  const maxSum       = expectedSum + vacants.reduce((s, r) => s + (r.baseRent || 0), 0)
  const collectPct   = expectedSum > 0 ? Math.round((collectedSum / expectedSum) * 100) : 0
  const incomeSum    = incomes.reduce((s, i) => s + i.amount, 0)

  // 부가수익 입주자 연결 선택지 — 현재 수납 화면의 계약들(비공실 + 계약 존재)
  const leaseOptions: LeaseOption[] = (() => {
    const seen = new Set<string>()
    const out: LeaseOption[] = []
    for (const r of roomStatus) {
      if (!r.leaseTermId || !r.tenantName || seen.has(r.leaseTermId)) continue
      seen.add(r.leaseTermId)
      out.push({ leaseTermId: r.leaseTermId, tenantName: r.tenantName, roomNo: r.roomNo })
    }
    return out
  })()

  return (
    <div className="space-y-4">
      {/* 헤더 — 좌측 제목+탭(수납/부가수익), 우측 월 셀렉터(기간) */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">수납 관리</h1>
          <ViewTabs ariaLabel="수납 관리 뷰" activeId={viewTab} equal
            onChange={id => setViewTab(id as 'rooms' | 'income')}
            tabs={[
              { id: 'rooms',  label: '수납' },
              { id: 'income', label: '부가수익', suffix: incomeSum > 0 ? `+${fmtKorMoney(incomeSum)}` : undefined },
            ]} />
        </div>
        <MonthSelector />
      </div>

      {/* 부가수익 탭 — 과납분·보증금 미반환분 등 수납 파생 수익 + 일반 기타수입 */}
      {viewTab === 'income' && (
        <IncomeSection incomes={incomes} incomeCategories={incomeCategories} leaseOptions={leaseOptions} />
      )}

      {viewTab === 'rooms' && <>
      {/* 수납 진행 스트립 — 걷은 돈/걷을 돈(%) + 만실 참고치. 예상=아래 목록 청구액 합(일할·무청구 반영) */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-4 py-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          <p className="text-sm text-[var(--warm-dark)]">
            <span className="text-xs text-[var(--warm-muted)]">수납 </span>
            <span className="font-bold text-[var(--success-fg)] num">{fmtWon(collectedSum)}</span>
            <span className="text-[var(--warm-muted)]"> / 이 달 청구액 </span>
            <span className="font-semibold num">{fmtWon(expectedSum)}</span>
            <span className="text-xs text-[var(--warm-muted)]"> ({collectPct}%)</span>
            <InfoHint title="이 달 청구액">
              이 화면 목록에 있는 계약들의 이번 달 이용료 청구 합계입니다. 일할과 무청구 퇴실월(납부일 이전 퇴실)이 반영됩니다.
              홈의 예상 매출은 여기에 부가수익, 퇴실 완료자의 이 달 귀속 인식분, 예약 확정자의 그 달 전액을 더한
              사업 전체 전망입니다. 그런 항목이 없는 달엔 두 숫자가 같고, 있는 달엔 홈이 그만큼 커집니다.
            </InfoHint>
          </p>
          {maxSum > expectedSum && (
            <span className="text-[0.6875rem] text-[var(--warm-muted)] num">만실 시 {fmtWon(maxSum)}</span>
          )}
        </div>
        <div className="h-1.5 rounded-full bg-[var(--canvas)] border border-[var(--warm-border)]/60 overflow-hidden">
          <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, collectPct)}%`, background: 'var(--success-fg)' }} />
        </div>
      </div>

      {/* 검색창 — v2.0 §23 공용 SearchBar */}
      <SearchBar value={search} onChange={setSearch} placeholder="호실 번호 또는 입주자 이름 검색" />

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
            { value: 'adjusted', label: `임시 조정 ${adjustedCount}실` },
            { value: 'vacant',   label: `공실 ${vacants.length}실` },
          ]}
        />
        {allFloors.length > 1 && (
          <select
            value={floorFilter}
            onChange={e => setFloorFilter(e.target.value)}
            className={`px-3 py-1.5 text-xs font-medium rounded-sm border transition-colors outline-none
              ${floorFilter
                ? 'bg-[var(--coral)] text-white border-[var(--coral)]'
                : 'bg-[var(--cream)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}
          >
            <option value="">전체 층</option>
            {allFloors.map(f => <option key={f} value={f}>{f}층</option>)}
          </select>
        )}

        {/* 공실 표시 · 열 설정 — flex-wrap 새 줄로 떨어져도 항상 우측 정렬되도록 ml-auto 그룹.
            (모바일에서 새 줄에 떨어졌을 때 부모가 좌측 끝에 정렬되어 드롭다운이 화면 왼쪽으로
            잘리던 문제 해결, 사용자 피드백 2026-06-01) */}
        <div className="ml-auto flex gap-2 items-center">

        {/* 선택 모드 토글 — 일괄 수납 (v2.0 §23 선택모드). 뷰어(STAFF)에겐 숨김(감사 D3, 서버 requireEdit 최종 방어) */}
        {(myRole === 'OWNER' || myRole === 'MANAGER') && (
        <Btn variant="secondary" size="md" onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
          {selectMode ? '선택 취소' : '선택'}
        </Btn>
        )}

        {/* 표시 항목 — 점유·공실 카드 항목을 버튼 하나로(운영자 지적 2026-07-06, '공실 카드 항목' 별도 버튼 제거) */}
        <DisplayFieldsMenu
          fields={COL_DEFS}
          visible={colVis as Record<string, boolean>}
          onToggle={k => setColVis(v => ({ ...v, [k as ColKey]: !v[k as ColKey] }))}
          sections={[
            {
              heading: '이 화면에 보일 정보 선택',
              fields: COL_DEFS,
              visible: colVis as Record<string, boolean>,
              onToggle: k => setColVis(v => ({ ...v, [k as ColKey]: !v[k as ColKey] })),
            },
            {
              heading: '공실 카드 항목',
              fields: VACANT_COL_DEFS,
              visible: vacantColVis as Record<string, boolean>,
              onToggle: k => setVacantColVis(v => ({ ...v, [k as VacantColKey]: !v[k as VacantColKey] })),
            },
          ]}
        />
        </div> {/* /ml-auto group */}
      </div>

      {filter !== 'vacant' && (<>
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
              selected={selectMode && selectedIds.has(room.roomId)}
              onClick={
                selectMode
                  ? (isBatchEligible(room) ? () => toggleSelect(room.roomId) : undefined)
                  : (room.isFutureMonth ? undefined : () => openPayModal(room))
              }
              onLongPress={(!selectMode && !room.isFutureMonth) ? () => {
                setSelectMode(true)
                if (isBatchEligible(room)) toggleSelect(room.roomId)
              } : undefined}
              className={`px-4 py-3.5 ${(room.isFutureMonth || (selectMode && !isBatchEligible(room))) ? 'opacity-50' : ''}`}>
              {/* 첫 줄: 호실 + 수납상태. 표시 항목 메뉴(colVis)로 타입 ON/OFF. */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {selectMode && isBatchEligible(room) && (
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border transition-colors
                      ${selectedIds.has(room.roomId) ? 'bg-[var(--coral)] border-[var(--coral)] text-white' : 'border-[var(--warm-border)] bg-[var(--cream)]'}`}>
                      {selectedIds.has(room.roomId) && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
                      )}
                    </span>
                  )}
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-base font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(room.roomNo)}</span>
                    {colVis.type && room.type && <span className="text-xs text-[var(--warm-muted)]">{room.type}</span>}
                  </div>
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
                      const overdueSub = dueInfo ? (dueInfo.days === 0 ? '오늘' : `${dueInfo.days}일 초과`) : undefined
                      // 퇴실 예정자가 미납이면 '퇴실 예정' 뱃지를 나란히 + 퇴실 D-day를 보조줄에 함께
                      const exitSub = room.status === 'CHECKOUT_PENDING' ? checkoutSubText(room.expectedMoveOut) : null
                      const sub = [overdueSub, exitSub].filter(Boolean).join(' · ') || undefined
                      const isOverdue = !!(dueInfo && dueInfo.days > 7)
                      return <StatusBadge tone={isOverdue ? 'overdue' : 'unpaid'} sub={sub}
                        secondary={exitSub ? { tone: 'exit', label: '퇴실 예정' } : undefined}>{isOverdue ? '연체' : '미납'}</StatusBadge>
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
              {/* 둘째 줄: 입주자 + 연락처(colVis.contact) */}
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <p className="text-sm font-medium text-[var(--warm-dark)]">{room.tenantName}</p>
                {colVis.contact && room.contact && (
                  <span className="text-[0.6875rem] text-[var(--warm-muted)]">{room.contact}</span>
                )}
              </div>
              {/* 셋째 줄: 월이용료 · 잔액/예정 · 납부일 · 보증금 · 총납부액 (colVis 토글) */}
              <div className="flex items-center gap-2.5 mt-2 text-xs text-[var(--warm-mid)] flex-wrap">
                {colVis.expected && (
                  <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={room.expected} /></span>
                )}
                {/* 미수/선납/예정 — '잔액' 컬럼 토글로 묶음. balance 의 의미 분기는 기존 로직 그대로. */}
                {colVis.balance && (() => {
                  const carryUnpaid = room.carryOver < 0 ? -room.carryOver : 0
                  const viewUnpaid  = (!room.isPaid && room.carryOver === 0 && !room.nextDueDate && room.balance < 0)
                                       ? -room.balance : 0
                  const totalUnpaid = carryUnpaid + viewUnpaid
                  if (totalUnpaid > 0) {
                    return <span className="font-medium text-[var(--coral)]">미수 -<MoneyDisplay amount={totalUnpaid} /></span>
                  }
                  if (room.balance > 0) {
                    return <span className="text-[var(--warm-mid)]">선납 +<MoneyDisplay amount={room.balance} /></span>
                  }
                  if (room.isPaid && room.nextDueDate && room.nextDueAmount > 0) {
                    return <span className="text-[var(--warm-mid)]">예정 <MoneyDisplay amount={room.nextDueAmount} /></span>
                  }
                  return null
                })()}
                {colVis.dueDay && room.dueDay && (
                  <span className="text-[var(--warm-muted)]">
                    {room.dueDay === '말일' ? '매월 말일' : `매월 ${room.dueDay}일`}
                  </span>
                )}
                {colVis.depositAmount && room.depositAmount > 0 && (
                  <span className="text-[var(--warm-muted)]">
                    보증금 <MoneyDisplay amount={room.depositAmount} />
                  </span>
                )}
                {colVis.totalPaid && (
                  <span className="text-[var(--warm-muted)]">
                    총납부 <MoneyDisplay amount={room.totalPaid} />
                    {room.lastPayDate && <span className="text-[var(--warm-muted)]"> · 납부 {room.lastPayDate.slice(5).replace('-', '/')}</span>}
                  </span>
                )}
              </div>
            </RoomCard>
          )
        })}
        {displayed.length === 0 && (
          <EmptyState
            icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" /></svg>}
            title={search ? '검색 결과가 없습니다' : '해당하는 호실이 없습니다'}
            description={search ? '다른 검색어로 시도해 보세요.' : '필터를 바꾸면 다른 호실이 표시됩니다.'}
          />
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
                  onClick={
                    selectMode
                      ? (isBatchEligible(room) ? () => toggleSelect(room.roomId) : undefined)
                      : () => { if (!room.isFutureMonth) openPayModal(room) }
                  }
                  {...press((!selectMode && !room.isFutureMonth) ? () => {
                    setSelectMode(true)
                    if (isBatchEligible(room)) toggleSelect(room.roomId)
                  } : undefined)}
                  className={`border-b border-[var(--warm-border)]/50 transition-colors
                    ${(room.isFutureMonth || (selectMode && !isBatchEligible(room))) ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:scale-[0.995] active:opacity-80'}
                    ${selectMode && selectedIds.has(room.roomId) ? 'bg-[var(--coral)]/5' : ''}`}>

                  {/* sticky — 호실 (식별자 v2.0 §23: 기본 ink, 연체만 coral · 선택모드 시 체크박스) */}
                  <td className={`py-4 text-sm font-bold tnum overflow-hidden sticky left-0 z-20 bg-[var(--cream)] ${selectMode ? 'px-2' : 'px-4'} ${tone === 'overdue' ? 'text-[var(--coral)]' : 'text-[var(--warm-dark)]'}`}
                    style={{ width: colWidths.roomNo, minWidth: colWidths.roomNo, maxWidth: colWidths.roomNo, borderLeft: `3px solid ${statusTipColor(tone)}` }}>
                    <span className="flex items-center gap-2 min-w-0">
                      {selectMode && isBatchEligible(room) && (
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border ${selectedIds.has(room.roomId) ? 'bg-[var(--coral)] border-[var(--coral)] text-white' : 'border-[var(--warm-border)] bg-[var(--cream)]'}`}>
                          {selectedIds.has(room.roomId) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>}
                        </span>
                      )}
                      <span className="truncate">{fmtRoomNo(room.roomNo)}</span>
                    </span>
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
                      {room.lastPayDate && (
                        <span className="block text-[0.6875rem] text-[var(--warm-muted)] mt-0.5">납부 {room.lastPayDate.slice(5).replace('-', '/')}</span>
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
                            const overdueSub = info ? (info.days === 0 ? '오늘' : `${info.days}일 초과`) : undefined
                            // 퇴실 예정자가 미납이면 '퇴실 예정' 뱃지를 나란히 + 퇴실 D-day를 보조줄에 함께
                            const exitSub = room.status === 'CHECKOUT_PENDING' ? checkoutSubText(room.expectedMoveOut) : null
                            const sub = [overdueSub, exitSub].filter(Boolean).join(' · ') || undefined
                            const isOverdue = !!(info && info.days > 7)
                            return <StatusBadge tone={isOverdue ? 'overdue' : 'unpaid'} sub={sub}
                              secondary={exitSub ? { tone: 'exit', label: '퇴실 예정' } : undefined}>{isOverdue ? '연체' : '미납'}</StatusBadge>
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
      </>)}

      {/* 공실 섹션 — 상단 상태 필터의 '공실'과 연동: 필터 선택 시 본 목록 자리에 이 섹션만 표시 */}
      {filter === 'vacant' && vacants.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)] text-center py-10">공실이 없습니다.</p>
      )}
      {vacants.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--warm-muted)]">공실 {vacants.length}실</h2>
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
                  <span className="text-sm font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(room.roomNo)}</span>
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
                    <td className="px-4 py-3 text-sm font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(room.roomNo)}</td>
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

      {/* 수납 모달은 전역 Prism 셸 (EntityModal/PaymentBody) 가 담당 */}

      {/* 선택 모드 하단 바 — v2.0 §22 공용 SelectionPillBar */}
      {selectMode && selectedIds.size > 0 && (
        <SelectionPillBar count={selectedIds.size} unit="실" onClose={exitSelectMode}>
          <PillButton primary disabled={batchTargets.length === 0} onClick={openBatchPay}>
            일괄 수납 처리
          </PillButton>
        </SelectionPillBar>
      )}

      {/* 일괄 수납 확인 모달 — v2.0 §13 Modal · v2.0 §12 세그먼트 · v2.0 §06 금액 · v2.0 §14② 되돌리기 가능 */}
      <Modal
        open={batchOpen}
        onClose={() => { if (!batchBusy) setBatchOpen(false) }}
        title="일괄 수납 처리"
        subtitle={`${targetMonth.replace('-', '년 ') + '월'} · ${batchTargets.length}개 호실`}
        width="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="md" onClick={() => setBatchOpen(false)} disabled={batchBusy}>취소</Btn>
            <Btn variant="primary" size="md" onClick={runBatchPay} disabled={batchBusy || batchTargets.length === 0}>
              {batchBusy ? '처리 중…' : '수납 처리'}
            </Btn>
          </div>
        }
      >
        <div className="space-y-4">
          {/* 미수 합계 — v2.0 §12 자동합산 강조 + v2.0 §06 금액 */}
          <div className="rounded-md bg-[var(--sand)]/40 border border-[var(--warm-border)] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--warm-mid)]">이번 달 미수 합계</span>
            <span className="text-lg font-bold tnum text-[var(--warm-dark)]"><MoneyDisplay amount={batchTotal} /></span>
          </div>

          {/* 납부일 — v2.0 §12 */}
          <div>
            <label className="block text-xs font-medium text-[var(--warm-mid)] mb-1.5">납부일</label>
            <DatePicker value={batchDate} onChange={setBatchDate} />
          </div>

          {/* 수납 방법 — v2.0 §12 상호배타는 세그먼트 */}
          <div>
            <label className="block text-xs font-medium text-[var(--warm-mid)] mb-1.5">수납 방법</label>
            <SegmentedControl
              size="md"
              ariaLabel="수납 방법"
              value={batchMethod}
              onChange={setBatchMethod}
              options={[
                { value: '계좌이체', label: '계좌이체' },
                { value: '현금',     label: '현금' },
                { value: '신용카드', label: '신용카드' },
              ]}
            />
          </div>

          <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
            선택한 호실의 <span className="font-medium text-[var(--warm-dark)]">이번 달 미수액을 전액</span> 수납 처리합니다.
            완납·미래월 등 대상이 아닌 호실은 자동 제외됩니다. 처리 후 토스트의 <span className="font-medium text-[var(--warm-dark)]">적용취소</span>로 되돌릴 수 있습니다.
          </p>
        </div>
      </Modal>
      </>}

    </div>
  )
}
