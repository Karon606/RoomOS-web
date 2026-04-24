'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { addTenant, updateTenant, moveInTenant, deleteTenant, analyzeTenantWithGemini, createTenantRequest, resolveTenantRequest, deleteTenantRequest, getTenantRequests, changeDueDay } from './actions'
import { savePayment, saveDepositPayment, deletePayment, getPaymentsByLease, setDueDayOverride, clearDueDayOverride } from '@/app/(app)/rooms/actions'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { formatPhone } from '@/lib/formatPhone'
import { CountrySelect, flagByName } from '@/components/ui/CountrySelect'
import { JobSelect } from '@/components/ui/JobSelect'
import { DatePicker } from '@/components/ui/DatePicker'

// ── 타입 ─────────────────────────────────────────────────────────

type Room = { id: string; roomNo: string; baseRent: number; isVacant: boolean; type: string | null; windowType: string | null; direction: string | null; currentLeaseStatus: string | null }

type Contact = {
  id: string; contactType: string; contactValue: string
  isEmergency: boolean; emergencyRelation: string | null; isPrimary: boolean
}

type PaymentRecord = {
  id: string; targetMonth: string; expectedAmount: number; actualAmount: number
  isPaid: boolean; payDate: string | Date; payMethod: string | null; memo: string | null
}

type PayRecord = {
  id: string; seqNo: number; payDate: Date
  actualAmount: number; payMethod: string | null; memo: string | null; isPaid: boolean
  isDeposit: boolean
}

type LeaseTerm = {
  id: string; status: string; rentAmount: number; depositAmount: number
  cleaningFee: number; dueDay: string | null
  overrideDueDay: string | null; overrideDueDayMonth: string | null; overrideDueDayReason: string | null
  moveInDate: string | Date | null; moveOutDate: string | Date | null
  expectedMoveOut: string | Date | null; tourDate: string | Date | null
  paymentTiming: string
  payMethod: string | null; cashReceipt: string | null
  registrationStatus: string; contractUrl: string | null
  wishRooms: string | null; visitRoute: string | null
  room: { id: string; roomNo: string } | null
  paymentRecords: PaymentRecord[]
}

type Tenant = {
  id: string; name: string; englishName: string | null
  birthdate: string | Date | null; memo: string | null
  nationality: string | null; gender: string; job: string | null
  isBasicRecipient: boolean; contacts: Contact[]; leaseTerms: LeaseTerm[]
}

type SortKey =
  | 'roomNo' | 'name' | 'status' | 'rentAmount' | 'depositAmount'
  | 'moveInDate' | 'moveOutDate' | 'expectedMoveOut'
  | 'nationality' | 'gender' | 'stayPeriod' | 'dueDay'
type SortDir = 'asc' | 'desc'

// ── 열 정의 ─────────────────────────────────────────────────────

const COL_DEFS = [
  { key: 'englishName',   label: '영어이름', defaultOn: false, tabs: ['active', 'past'] },
  { key: 'nationality',   label: '국적',     defaultOn: true,  tabs: ['active', 'past'] },
  { key: 'gender',        label: '성별',     defaultOn: true,  tabs: ['active', 'past'] },
  { key: 'job',           label: '직업',     defaultOn: false, tabs: ['active', 'past'] },
  { key: 'contact',       label: '연락처',   defaultOn: true,  tabs: ['active', 'past'] },
  { key: 'payMethod',     label: '결제수단', defaultOn: false, tabs: ['active', 'past'] },
  { key: 'depositAmount', label: '보증금',   defaultOn: true,  tabs: ['active', 'past'] },
  { key: 'rentAmount',    label: '월 이용료', defaultOn: true, tabs: ['active', 'past'] },
  { key: 'dueDay',        label: '납부일',   defaultOn: true,  tabs: ['active'] },
  { key: 'stayPeriod',    label: '거주기간', defaultOn: true,  tabs: ['active', 'past'] },
  { key: 'status',        label: '상태',     defaultOn: true,  tabs: ['active', 'past'] },
  { key: 'scheduledDate', label: '예정일',   defaultOn: false, tabs: ['active'] },
  { key: 'moveOutDate',   label: '퇴실일',   defaultOn: true,  tabs: ['past'] },
] as const
type ColKey = (typeof COL_DEFS)[number]['key']

const COL_VIS_KEY    = 'roomos_tenant_col_vis'
const COL_WIDTHS_KEY = 'roomos_tenant_col_widths'

const DEFAULT_WIDTHS: Record<string, number> = {
  roomNo: 72, name: 140,
  englishName: 120, nationality: 80, gender: 60, job: 100,
  contact: 130, payMethod: 90, depositAmount: 90, rentAmount: 100,
  dueDay: 90, stayPeriod: 90, status: 120, scheduledDate: 80, moveOutDate: 130,
}

function loadColWidths(): Record<string, number> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

// ── 상수 ─────────────────────────────────────────────────────────

const STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT: '퇴실', WAITING_TOUR: '투어 대기', TOUR_DONE: '투어 완료', CANCELLED: '취소',
  NON_RESIDENT: '비거주자',
}
const STATUS_COLOR: Record<string, string> = {
  ACTIVE:           'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  RESERVED:         'bg-blue-50 text-blue-700 ring-1 ring-blue-200',
  CHECKOUT_PENDING: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  CHECKED_OUT:      'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]',
  WAITING_TOUR:     'bg-purple-50 text-purple-700 ring-1 ring-purple-200',
  TOUR_DONE:        'bg-[var(--coral)]/10 text-[var(--coral)] ring-1 ring-[var(--coral)]/30',
  CANCELLED:        'bg-red-50 text-red-600 ring-1 ring-red-200',
  NON_RESIDENT:     'bg-orange-50 text-orange-700 ring-1 ring-orange-200',
}
const REG_LABEL: Record<string, string> = {
  NOT_REPORTED: '미신고', REGISTERED: '완료', EXEMPTED: '해당없음',
}
const GENDER_LABEL: Record<string, string> = {
  MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '—',
}
const PT_LABEL: Record<string, string> = { PREPAID: '선납', POSTPAID: '후납' }

// active 탭 내 빠른 상태 필터
const ACTIVE_FILTERS = [
  { key: 'all',             label: '전체' },
  { key: 'ACTIVE',          label: '거주중' },
  { key: 'RESERVED',        label: '예약' },
  { key: 'CHECKOUT_PENDING', label: '퇴실 예정' },
  { key: 'TOUR',            label: '투어' },
  { key: 'NON_RESIDENT',    label: '비거주자' },
] as const
type ActiveFilter = (typeof ACTIVE_FILTERS)[number]['key']

const PAST_FILTERS = [
  { key: 'all',         label: '전체' },
  { key: 'CHECKED_OUT', label: '퇴실' },
  { key: 'CANCELLED',   label: '취소' },
] as const
type PastFilter = (typeof PAST_FILTERS)[number]['key']

// ── 헬퍼 ─────────────────────────────────────────────────────────

function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  return new Date(d).toISOString().slice(0, 10)
}

function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
}

function fmtShortDate(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  return `${String(dt.getMonth() + 1).padStart(2, '0')}.${String(dt.getDate()).padStart(2, '0')}`
}

function fmtDueDay(dueDay: string | null | undefined): string {
  if (!dueDay) return '—'
  const n = parseInt(dueDay, 10)
  if (!isNaN(n)) return n >= 30 ? '매월 말일' : `매월 ${n}일`
  if (dueDay.includes('말')) return '매월 말일'
  return `매월 ${dueDay}일`
}

function calcStayPeriod(
  moveInDate: string | Date | null | undefined,
  endDate?: string | Date | null,
): string {
  if (!moveInDate) return '—'
  const start  = new Date(moveInDate)
  const end    = endDate ? new Date(endDate) : new Date()
  const months = (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  if (months < 1) {
    const days = Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000))
    return `${days}일`
  }
  const years = Math.floor(months / 12)
  const rem   = months % 12
  if (years > 0 && rem > 0) return `${years}년 ${rem}개월`
  if (years > 0) return `${years}년`
  return `${months}개월`
}

function fmtDDay(date: string | Date | null | undefined): string | null {
  if (!date) return null
  const today  = new Date(); today.setHours(0, 0, 0, 0)
  const target = new Date(date); target.setHours(0, 0, 0, 0)
  const days   = Math.round((target.getTime() - today.getTime()) / 86400000)
  if (days < 0) return `${Math.abs(days)}일 초과`
  if (days === 0) return '오늘'
  return `${days}일 후`
}

function getScheduledDate(lease: LeaseTerm | undefined): { date: string | Date | null; label: string } | null {
  if (!lease) return null
  if (lease.status === 'WAITING_TOUR' && lease.tourDate)
    return { date: lease.tourDate, label: '투어' }
  if (['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'].includes(lease.status) && lease.moveInDate)
    return { date: lease.moveInDate, label: '입주희망' }
  if ((lease.status === 'CHECKOUT_PENDING' || lease.status === 'ACTIVE') && lease.expectedMoveOut)
    return { date: lease.expectedMoveOut, label: '퇴실' }
  return null
}

function getSortValue(t: Tenant, key: SortKey): string | number {
  const l = t.leaseTerms[0]
  switch (key) {
    case 'roomNo':          return l?.room?.roomNo ?? ''
    case 'name':            return t.name
    case 'status':          return l?.status ?? ''
    case 'rentAmount':      return l?.rentAmount ?? 0
    case 'depositAmount':   return l?.depositAmount ?? 0
    case 'moveInDate':      return l?.moveInDate ? new Date(l.moveInDate).getTime() : 0
    case 'moveOutDate':     return l?.moveOutDate ? new Date(l.moveOutDate).getTime() : 0
    case 'expectedMoveOut': return l?.expectedMoveOut ? new Date(l.expectedMoveOut).getTime() : Infinity
    case 'nationality':     return t.nationality ?? ''
    case 'gender':          return GENDER_LABEL[t.gender] ?? ''
    case 'stayPeriod':      return l?.moveInDate ? new Date(l.moveInDate).getTime() : Infinity
    case 'dueDay':          return parseInt(l?.dueDay ?? '0', 10) || 0
    default: return ''
  }
}

// 납입일 변경 일할 계산
function calcProRata(rentAmount: number, oldDueDay: string | null, newDueDayStr: string, targetMonth: string) {
  const str = newDueDayStr.trim()
  if (!str) return null
  const [y, m] = targetMonth.split('-').map(Number)
  const daysInMonth = new Date(y, m, 0).getDate()
  const parseDay = (d: string) => {
    if (d.includes('말')) return daysInMonth
    const n = parseInt(d, 10)
    if (isNaN(n) || n < 1 || n > 31) return null
    return Math.min(n, daysInMonth)
  }
  const oldDay = oldDueDay ? parseDay(oldDueDay) : null
  const newDay = parseDay(str)
  if (oldDay === null || newDay === null) return null
  const diff = newDay - oldDay
  if (diff === 0) return { days: 0, amount: 0, type: 'none' as const }
  const amount = Math.floor(Math.abs(diff) * rentAmount / daysInMonth)
  return { days: Math.abs(diff), amount, type: diff > 0 ? 'extra' as const : 'refund' as const }
}

function loadColVis(): Record<ColKey, boolean> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COL_VIS_KEY)
    return raw ? (JSON.parse(raw) as Record<ColKey, boolean>) : null
  } catch { return null }
}

// ── 메인 컴포넌트 ─────────────────────────────────────────────────

export default function TenantClient({
  initialTenants, rooms, targetMonth, defaultDeposit, defaultCleaningFee, myRole,
}: {
  initialTenants: Tenant[]
  rooms: Room[]
  targetMonth: string
  defaultDeposit: number | null
  defaultCleaningFee: number | null
  myRole: string
}) {
  const canEdit = myRole === 'OWNER' || myRole === 'MANAGER'
  const router = useRouter()
  const searchParams = useSearchParams()

  const initColVis = Object.fromEntries(
    COL_DEFS.map(c => [c.key, c.defaultOn])
  ) as Record<ColKey, boolean>

  const [showAdd, setShowAdd]             = useState(false)
  const [editTenant, setEditTenant]       = useState<Tenant | null>(null)
  const [detailTenant, setDetailTenant]   = useState<Tenant | null>(null)
  const [detailEditMode, setDetailEditMode] = useState(false)
  const [detailTab, setDetailTab]         = useState<'info' | 'requests' | 'analysis'>('info')

  // 요청사항 탭 상태
  const [requests, setRequests]               = useState<Awaited<ReturnType<typeof getTenantRequests>>>([])
  const [requestsLoading, setRequestsLoading] = useState(false)
  const [newContent, setNewContent]           = useState('')
  const [newReqDate, setNewReqDate]           = useState(() => new Date().toISOString().slice(0, 10))
  const [newTargetDate, setNewTargetDate]     = useState('')
  const [reqPending, startReqTransition]      = useTransition()
  const [showHistory, setShowHistory]         = useState(false)
  const [aiText, setAiText]               = useState('')
  const [aiLoading, setAiLoading]         = useState(false)
  const [roomDetailId, setRoomDetailId]   = useState<string | null>(null)
  const [error, setError]               = useState('')
  const [deleteTarget, setDeleteTarget]   = useState<{ id: string; name: string } | null>(null)
  const [filter, setFilter]             = useState<'active' | 'past'>('active')
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all')
  const [pastFilter, setPastFilter]     = useState<PastFilter>('all')
  const [search, setSearch]             = useState('')
  const [sortKey, setSortKey]           = useState<SortKey>('roomNo')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [colVis, setColVis]             = useState<Record<ColKey, boolean>>(initColVis)
  const [showColMenu, setShowColMenu]   = useState(false)
  const [isPending, startTransition]    = useTransition()
  const [colWidths, setColWidths]       = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const colWidthsRef                    = useRef<Record<string, number>>(DEFAULT_WIDTHS)

  // 납입일 변경
  const [showDueDayChange, setShowDueDayChange] = useState(false)
  const [newDueDayInput, setNewDueDayInput]     = useState('')

  // 수납 모달
  const [payTarget, setPayTarget]   = useState<{ tenant: Tenant; lease: LeaseTerm } | null>(null)
  const [payHistory, setPayHistory] = useState<PayRecord[]>([])
  const [payAcquisitionDate, setPayAcquisitionDate] = useState<Date | null>(null)
  const [showPayForm, setShowPayForm] = useState(false)
  const [payAmount, setPayAmount]   = useState(0)
  const [payDateVal, setPayDateVal] = useState(new Date().toISOString().slice(0, 10))
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideInput, setOverrideInput] = useState('')
  const [overrideReason, setOverrideReason] = useState('')

  // localStorage에서 열 설정 불러오기
  useEffect(() => {
    const saved = loadColVis()
    if (saved) setColVis(prev => ({ ...prev, ...saved }))
    const savedW = loadColWidths()
    if (savedW) {
      const merged = { ...DEFAULT_WIDTHS, ...savedW }
      setColWidths(merged)
      colWidthsRef.current = merged
    }
  }, [])

  // colWidths 변경 시 ref 동기화
  useEffect(() => { colWidthsRef.current = colWidths }, [colWidths])

  // URL 파라미터로 특정 입주자 팝업 열기 (/tenants?tenantId=xxx&tab=requests)
  useEffect(() => {
    const tenantId = searchParams.get('tenantId')
    const tab = searchParams.get('tab')
    if (tenantId) {
      const found = initialTenants.find(t => t.id === tenantId)
      if (found) {
        setDetailTenant(found)
        setDetailTab(tab === 'requests' ? 'requests' : tab === 'analysis' ? 'analysis' : 'info')
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 요청사항 탭 진입 시 목록 로드
  useEffect(() => {
    if (detailTab === 'requests' && detailTenant) {
      setRequestsLoading(true)
      getTenantRequests(detailTenant.id).then(r => {
        setRequests(r)
        setRequestsLoading(false)
      })
    }
  }, [detailTab, detailTenant?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 열 설정 변경 시 저장
  const updateColVis = (key: ColKey, val: boolean) => {
    const next = { ...colVis, [key]: val }
    setColVis(next)
    localStorage.setItem(COL_VIS_KEY, JSON.stringify(next))
  }

  const startResize = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = colWidthsRef.current[col] ?? 100

    const onMove = (ev: MouseEvent) => {
      const newW = Math.max(50, startW + ev.clientX - startX)
      setColWidths(prev => ({ ...prev, [col]: newW }))
    }
    const onUp = () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidthsRef.current))
      document.removeEventListener('mousemove', onMove)
      document.removeEventListener('mouseup', onUp)
    }
    document.addEventListener('mousemove', onMove)
    document.addEventListener('mouseup', onUp)
  }, [])

  const visibleCols = COL_DEFS.filter(
    c => (c.tabs as readonly string[]).includes(filter) && colVis[c.key]
  )

  // ── 필터 ────────────────────────────────────────────────────────

  const filtered = initialTenants.filter(t => {
    const status = t.leaseTerms[0]?.status ?? ''

    // 탭 필터
    const isActive = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'].includes(status)
    if (filter === 'active' && !isActive) return false
    if (filter === 'past'   && isActive)  return false

    // 빠른 상태 필터
    if (filter === 'active') {
      if (activeFilter === 'TOUR' && !['WAITING_TOUR', 'TOUR_DONE'].includes(status)) return false
      if (activeFilter !== 'all' && activeFilter !== 'TOUR' && status !== activeFilter) return false
    }
    if (filter === 'past') {
      if (pastFilter !== 'all' && status !== pastFilter) return false
    }

    // 검색
    if (!search.trim()) return true
    const q = search.toLowerCase()
    return (
      t.name.toLowerCase().includes(q) ||
      (t.englishName?.toLowerCase().includes(q) ?? false) ||
      (t.leaseTerms[0]?.room?.roomNo ?? '').includes(q) ||
      (STATUS_LABEL[status] ?? '').includes(q) ||
      (t.nationality?.toLowerCase().includes(q) ?? false) ||
      (t.job?.toLowerCase().includes(q) ?? false)
    )
  })

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    const va = getSortValue(a, sortKey)
    const vb = getSortValue(b, sortKey)
    if (typeof va === 'number' && typeof vb === 'number') return dir * (va - vb)
    return dir * String(va).localeCompare(String(vb), 'ko', { numeric: true })
  })

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // ── 새로고침 상태 ────────────────────────────────────────────────
  // router.refresh()는 void를 반환해서 isPending으로 추적 불가.
  // initialTenants prop이 교체될 때(= 서버 재요청 완료)를 감지해서 클리어.
  const [isRefreshing, setIsRefreshing] = useState(false)

  useEffect(() => {
    if (isRefreshing) setIsRefreshing(false)
  }, [initialTenants]) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 액션 핸들러 ─────────────────────────────────────────────────

  const refresh = useCallback(() => {
    setIsRefreshing(true)
    router.refresh()
  }, [router])

  const handleAdd = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await addTenant(fd)
      if (!res.ok) { setError(res.error); return }
      setShowAdd(false); refresh()
    })
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updateTenant(fd)
      if (!res.ok) { setError(res.error); return }
      setEditTenant(null); refresh()
    })
  }

  // 상세 모달 내 편집 저장
  const handleUpdateFromDetail = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    startTransition(async () => {
      const res = await updateTenant(fd)
      if (!res.ok) { setError(res.error); return }
      setDetailTenant(null)
      setDetailEditMode(false)
      refresh()
    })
  }

  const handleMoveIn = async (leaseTermId: string, tenantId: string, name: string) => {
    if (!confirm(`${name}님 입실 처리하시겠습니까?`)) return
    startTransition(async () => {
      const res = await moveInTenant(leaseTermId, tenantId)
      if (!res.ok) { setError(res.error); return }
      setDetailTenant(null); refresh()
    })
  }


  const openPayModal = async (tenant: Tenant, lease: LeaseTerm) => {
    setPayTarget({ tenant, lease })
    setPayAmount(lease.rentAmount)
    setPayDateVal(new Date().toISOString().slice(0, 10))
    setIsDepositMode(false)
    setShowPayForm(false)
    setError('')
    const { records, acquisitionDate } = await getPaymentsByLease(lease.id, targetMonth)
    setPayHistory(records as PayRecord[])
    setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
  }

  const closePayModal = () => {
    setPayTarget(null); setPayHistory([]); setShowPayForm(false); setError('')
    setShowOverrideForm(false); setOverrideInput(''); setOverrideReason('')
    setIsDepositMode(false); setPayDateVal(new Date().toISOString().slice(0, 10))
  }

  const handleSavePayment = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    if (!payTarget) return
    const fd = new FormData(e.currentTarget)
    const payMethod = fd.get('payMethod') as string
    const memo = fd.get('memo') as string
    startTransition(async () => {
      try {
        if (isDepositMode) {
          await saveDepositPayment({
            leaseTermId:   payTarget.lease.id,
            tenantId:      payTarget.tenant.id,
            targetMonth,
            depositAmount: payTarget.lease.depositAmount,
            rentAmount:    payTarget.lease.rentAmount,
            totalPaid:     payAmount,
            payDate:       payDateVal,
            payMethod,
            memo:          memo || undefined,
          })
        } else {
          await savePayment({
            leaseTermId:    payTarget.lease.id,
            tenantId:       payTarget.tenant.id,
            targetMonth,
            expectedAmount: payTarget.lease.rentAmount,
            actualAmount:   payAmount,
            payDate:        payDateVal,
            payMethod,
            memo,
          })
        }
        setShowPayForm(false)
        const { records } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records as PayRecord[])
        refresh()
      } catch (err: unknown) { setError((err as Error).message) }
    })
  }

  const handleDeletePayRecord = async (paymentId: string) => {
    if (!confirm('이 수납 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      const res = await deletePayment(paymentId)
      if (!res.ok) { setError(res.error); return }
      if (payTarget) {
        const { records } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records as PayRecord[])
      }
      refresh()
    })
  }

  const handleChangeDueDayAction = async () => {
    if (!detailTenant || !newDueDayInput.trim()) return
    const lease = detailTenant.leaseTerms[0]
    if (!lease) return
    const calc = calcProRata(lease.rentAmount, lease.dueDay, newDueDayInput, targetMonth)
    if (!calc || calc.type === 'none') return
    const adjustAmount = calc.type === 'extra' ? -calc.amount : calc.amount
    startTransition(async () => {
      const res = await changeDueDay(lease.id, newDueDayInput.trim(), targetMonth, adjustAmount)
      if (!res.ok) { setError(res.error); return }
      setShowDueDayChange(false)
      setNewDueDayInput('')
      setDetailTenant(null)
      refresh()
    })
  }

  const handleDelete = (tenantId: string, name: string) => {
    setDeleteTarget({ id: tenantId, name })
  }

  const confirmDelete = () => {
    if (!deleteTarget) return
    const { id, name } = deleteTarget
    setDeleteTarget(null)
    startTransition(async () => {
      const res = await deleteTenant(id)
      if (!res.ok) { setError(res.error); return }
      setDetailTenant(null); refresh()
    })
  }

  // ── 정렬 헤더 ─────────────────────────────────────────────────

  function ResizableTh({ label, colKey, onClick, isActive }: {
    label: string; colKey: string; onClick?: () => void; isActive?: boolean
  }) {
    const w = colWidths[colKey] ?? 100
    return (
      <th
        onClick={onClick}
        className={`relative text-left text-xs font-medium px-4 py-3 select-none overflow-hidden ${
          onClick ? 'cursor-pointer transition-colors' : ''
        } ${isActive ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}
        style={{ width: w, minWidth: w, maxWidth: w }}
      >
        <span className="truncate block">{label}{isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        {/* 드래그 핸들 */}
        <div
          onMouseDown={e => startResize(colKey, e)}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group"
          style={{ userSelect: 'none' }}
        >
          <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
        </div>
      </th>
    )
  }

  function SortTh({ label, sKey, colKey }: { label: string; sKey: SortKey; colKey: string }) {
    const active = sortKey === sKey
    return (
      <ResizableTh
        label={label}
        colKey={colKey}
        onClick={() => handleSort(sKey)}
        isActive={active}
      />
    )
  }

  // ── 인원수 ────────────────────────────────────────────────────

  const activeCount = initialTenants.filter(t =>
    ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT'].includes(t.leaseTerms[0]?.status ?? '')
  ).length
  const pastCount = initialTenants.length - activeCount

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">입주자 관리</h1>
        <button
          onClick={() => { setShowAdd(true); setError('') }}
          className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors"
        >
          + 입주자 등록
        </button>
      </div>

      {/* 탭 */}
      <div className="flex gap-2">
        {(['active', 'past'] as const).map(tab => (
          <button key={tab} onClick={() => setFilter(tab)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              filter === tab ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'
            }`}
          >
            {tab === 'active' ? `입주/예약자 (${activeCount})` : `퇴실자 내역 (${pastCount})`}
          </button>
        ))}
      </div>

      {/* 빠른 상태 필터 */}
      <div className="flex gap-2 flex-wrap items-center">
        {(filter === 'active' ? ACTIVE_FILTERS : PAST_FILTERS).map(f => {
          const cur = filter === 'active' ? activeFilter : pastFilter
          const set = filter === 'active'
            ? (v: string) => setActiveFilter(v as ActiveFilter)
            : (v: string) => setPastFilter(v as PastFilter)
          return (
            <button key={f.key} onClick={() => set(f.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                cur === f.key
                  ? 'bg-[var(--canvas)] text-[var(--warm-dark)]'
                  : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'
              }`}
            >
              {f.label}
            </button>
          )
        })}

        {/* 구분선 */}
        <div className="flex-1" />

        {/* 검색 */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="이름, 호실, 국적, 직업 검색..."
          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-4 py-1.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors w-56"
        />

        {/* 열 설정 */}
        <div className="relative">
          <button
            onClick={() => setShowColMenu(v => !v)}
            className="px-3 py-1.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] text-sm rounded-xl transition-colors"
          >
            ⚙ 열 설정
          </button>
          {showColMenu && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setShowColMenu(false)} />
              <div className="absolute right-0 mt-2 z-20 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl shadow-xl p-3 space-y-2 min-w-[160px]">
                {COL_DEFS.filter(c => (c.tabs as readonly string[]).includes(filter)).map(c => (
                  <label key={c.key} className="flex items-center gap-2.5 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={colVis[c.key] ?? false}
                      onChange={e => updateColVis(c.key, e.target.checked)}
                      className="w-4 h-4 accent-indigo-500"
                    />
                    <span className="text-sm text-[var(--warm-dark)]">{c.label}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* 삭제 확인 모달 */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4">
          <div className="bg-[var(--cream)] rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="text-2xl">⚠️</span>
              <div>
                <p className="font-semibold text-[var(--warm-dark)]">{deleteTarget.name}님을 완전 삭제하시겠습니까?</p>
                <p className="text-sm text-[var(--warm-mid)] mt-1.5 leading-relaxed">
                  수납 기록, 계약 이력, 연락처 등 모든 데이터가 <span className="text-red-400 font-medium">영구적으로 삭제</span>되며 복구할 수 없습니다. 거주중이었다면 해당 호실은 공실로 전환됩니다.
                </p>
              </div>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setDeleteTarget(null)}
                className="flex-1 py-2.5 rounded-xl text-sm bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                취소
              </button>
              <button
                onClick={confirmDelete}
                disabled={isPending}
                className="flex-1 py-2.5 rounded-xl text-sm bg-red-500 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50">
                {isPending ? '삭제 중...' : '영구 삭제'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 테이블 */}
      {sorted.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-12 text-center">
          <p className="text-4xl mb-3">👤</p>
          <p className="text-[var(--warm-dark)] font-medium">
            {search.trim() ? '검색 결과가 없습니다' : '입주자가 없습니다'}
          </p>
        </div>
      ) : (
        <div className="relative bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-auto max-h-[calc(100dvh-310px)]">
          {/* 저장 후 서버 재요청 완료 전 클릭 차단 오버레이 */}
          {(isPending || isRefreshing) && (
            <div className="absolute inset-0 z-40 rounded-2xl bg-[var(--cream)]/60 backdrop-blur-[1px] flex items-center justify-center">
              <div className="flex items-center gap-2 text-xs text-[var(--warm-muted)]">
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                업데이트 중...
              </div>
            </div>
          )}
          <table className="w-full" style={{ tableLayout: 'fixed', minWidth: colWidths.roomNo + colWidths.name + visibleCols.reduce((s, c) => s + (colWidths[c.key] ?? 100), 0) }}>
            <thead className="sticky top-0 z-30 bg-[var(--cream)]">
              <tr className="border-b border-[var(--warm-border)]">
                {/* sticky — 호실 */}
                <th
                  onClick={() => handleSort('roomNo')}
                  className={`relative sticky left-0 z-40 bg-[var(--cream)] text-left text-xs font-medium px-4 py-3 cursor-pointer select-none overflow-hidden transition-colors ${sortKey === 'roomNo' ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}
                  style={{ width: colWidths.roomNo, minWidth: colWidths.roomNo, maxWidth: colWidths.roomNo }}
                >
                  <span className="truncate block">호실{sortKey === 'roomNo' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
                  <div onMouseDown={e => startResize('roomNo', e)} onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group" style={{ userSelect: 'none' }}>
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
                  </div>
                </th>
                {/* sticky — 이름 */}
                <th
                  onClick={() => handleSort('name')}
                  className={`relative sticky z-40 bg-[var(--cream)] text-left text-xs font-medium px-4 py-3 cursor-pointer select-none overflow-hidden transition-colors ${sortKey === 'name' ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'}`}
                  style={{ left: colWidths.roomNo, width: colWidths.name, minWidth: colWidths.name, maxWidth: colWidths.name }}
                >
                  <span className="truncate block">이름{sortKey === 'name' ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
                  <div onMouseDown={e => startResize('name', e)} onClick={e => e.stopPropagation()}
                    className="absolute right-0 top-0 bottom-0 w-[5px] cursor-col-resize group" style={{ userSelect: 'none' }}>
                    <div className="absolute right-[2px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
                  </div>
                </th>
                {visibleCols.map(c => {
                  const sortMap: Partial<Record<ColKey, SortKey>> = {
                    rentAmount: 'rentAmount', depositAmount: 'depositAmount',
                    moveOutDate: 'moveOutDate', status: 'status',
                    nationality: 'nationality', gender: 'gender',
                    stayPeriod: 'stayPeriod', dueDay: 'dueDay',
                  }
                  const sk = sortMap[c.key]
                  return sk
                    ? <SortTh key={c.key} label={c.label} sKey={sk} colKey={c.key} />
                    : <ResizableTh key={c.key} label={c.label} colKey={c.key} />
                })}
              </tr>
            </thead>
            <tbody>
              {sorted.map(tenant => {
                const lease   = tenant.leaseTerms[0]
                const primary = tenant.contacts.find(c => c.isPrimary)
                const status  = lease?.status ?? ''
                const sched   = getScheduledDate(lease)

                return (
                  <tr key={tenant.id}
                    onClick={() => { setDetailTenant(tenant); setDetailTab('info') }}
                    className="border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:opacity-80 transition-colors cursor-pointer"
                  >
                    {/* sticky — 호실 (클릭 시 호실 관리 페이지로) */}
                    <td className="sticky left-0 z-20 bg-[var(--cream)] px-4 py-3 text-sm font-semibold overflow-hidden"
                      style={{ maxWidth: colWidths.roomNo }}
                      onClick={e => { e.stopPropagation(); if (lease?.room?.id) setRoomDetailId(lease.room.id) }}>
                      <span className="block truncate text-[var(--coral)] cursor-pointer underline-offset-2 hover:underline">
                        {lease?.room?.roomNo ? `${lease.room.roomNo}호` : '—'}
                      </span>
                    </td>
                    {/* sticky — 이름 */}
                    <td className="sticky z-20 bg-[var(--cream)] px-4 py-3 overflow-hidden"
                      style={{ left: colWidths.roomNo, maxWidth: colWidths.name }}>
                      <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{tenant.name}</p>
                    </td>
                    {visibleCols.map(c => {
                      const tdBase = 'px-4 py-3 overflow-hidden'
                      switch (c.key) {
                        case 'nationality': {
                          const f = flagByName(tenant.nationality)
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-dark)]`}>
                              <span className="block truncate">{tenant.nationality ? `${f} ${tenant.nationality}` : '—'}</span>
                            </td>
                          )
                        }
                        case 'gender':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{GENDER_LABEL[tenant.gender] ?? '—'}</span></td>
                        case 'englishName':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{tenant.englishName || '—'}</span></td>
                        case 'job':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{tenant.job || '—'}</span></td>
                        case 'contact':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{primary?.contactValue ? formatPhone(primary.contactValue) : '—'}</span></td>
                        case 'payMethod':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{lease?.payMethod || '—'}</span></td>
                        case 'depositAmount':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-dark)]`}><span className="block truncate">{lease && lease.depositAmount > 0 ? <MoneyDisplay amount={lease.depositAmount} /> : '—'}</span></td>
                        case 'rentAmount':
                          return (
                            <td key={c.key}
                              onClick={e => { e.stopPropagation(); if (lease) openPayModal(tenant, lease) }}
                              className={`${tdBase} text-sm text-[var(--warm-dark)] cursor-pointer hover:text-[var(--coral)] transition-colors`}>
                              <span className="block truncate">{lease ? <MoneyDisplay amount={lease.rentAmount} /> : '—'}</span>
                            </td>
                          )
                        case 'dueDay':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{fmtDueDay(lease?.dueDay)}</span></td>
                        case 'stayPeriod':
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}>
                              <span className="block truncate">{calcStayPeriod(lease?.moveInDate, lease?.moveOutDate ?? undefined)}</span>
                            </td>
                          )
                        case 'status': {
                          const ddLabel = sched ? fmtDDay(sched.date) : null
                          const ddColor = sched?.label === '입실' ? 'text-blue-600' : 'text-red-500'
                          return (
                            <td key={c.key} className={tdBase}>
                              <div className="flex flex-col gap-0.5">
                                <span className={`text-xs px-2.5 py-1 rounded-full font-medium self-start whitespace-nowrap ${STATUS_COLOR[status] ?? ''}`}>
                                  {STATUS_LABEL[status] ?? status}
                                </span>
                                {ddLabel && <span className={`text-xs font-medium pl-1 whitespace-nowrap ${ddColor}`}>{ddLabel}</span>}
                              </div>
                            </td>
                          )
                        }
                        case 'scheduledDate':
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}>
                              <span className="block truncate">{sched ? fmtShortDate(sched.date) : '—'}</span>
                            </td>
                          )
                        case 'moveOutDate':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{fmtDate(lease?.moveOutDate)}</span></td>
                        default: return null
                      }
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 상세 팝업 ──────────────────────────────────────────────── */}
      {detailTenant && (() => {
        const t       = detailTenant
        const lease   = t.leaseTerms[0]
        const primary   = t.contacts.find(c => c.isPrimary)
        const emergency = t.contacts.find(c => c.isEmergency)
        const status    = lease?.status ?? ''
        const sched     = getScheduledDate(lease)
        const natFlag   = flagByName(t.nationality)

        const closeDetail = () => {
          setDetailTenant(null); setDetailEditMode(false); setError('')
          setAiText(''); setAiLoading(false)
          setShowDueDayChange(false); setNewDueDayInput('')
        }

        const handleAiAnalyze = async () => {
          setAiLoading(true); setAiText('')
          try {
            const result = await analyzeTenantWithGemini(t.id)
            setAiText(result)
          } catch (e) {
            setAiText('분석 중 오류가 발생했습니다.')
          } finally {
            setAiLoading(false)
          }
        }

        const payments      = lease?.paymentRecords ?? []
        const totalExpected = payments.reduce((s, p) => s + p.expectedAmount, 0)
        const totalPaid     = payments.reduce((s, p) => s + p.actualAmount, 0)
        const unpaid        = totalExpected - totalPaid
        const paidMonths    = payments.filter(p => p.isPaid).length

        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={closeDetail}>
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-lg flex flex-col max-h-[88vh]"
              onClick={e => e.stopPropagation()}>

              {/* 팝업 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-[var(--warm-dark)]">
                    {detailEditMode ? '입주자 정보 수정' : '입주자 상세정보'}
                  </h2>
                  {!detailEditMode && (
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_COLOR[status] ?? ''}`}>
                      {STATUS_LABEL[status] ?? status}
                    </span>
                  )}
                  {!detailEditMode && sched && (() => {
                    const dd = fmtDDay(sched.date)
                    if (!dd) return null
                    const color = sched.label === '입실' ? 'text-blue-400' : 'text-red-400'
                    return <span className={`text-xs font-bold ${color}`}>{dd}</span>
                  })()}
                </div>
                <div className="flex items-center gap-2 ml-4 shrink-0">
                  <button onClick={closeDetail} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
                </div>
              </div>

              {/* ── 읽기 전용 모드 ── */}
              {!detailEditMode && (
                <>
                    {/* 탭 헤더 */}
                    <div className="flex border-b border-[var(--warm-border)] px-6 shrink-0">
                      {([
                        { key: 'info',     label: '상세 정보' },
                        { key: 'requests', label: '요청·컴플레인' },
                        { key: 'analysis', label: '수납 분석' },
                      ] as const).map(t => (
                        <button key={t.key} onClick={() => setDetailTab(t.key)}
                          className={`py-2.5 px-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
                            detailTab === t.key
                              ? 'border-[var(--coral)] text-[var(--coral)]'
                              : 'border-transparent text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'
                          }`}>
                          {t.label}
                        </button>
                      ))}
                    </div>

                    {/* 팝업 바디 */}
                    <div className="flex-1 overflow-y-auto p-6 space-y-5">
                      {detailTab === 'info' && (
                        <>
                          <InfoSection title="기본 정보">
                            <InfoGrid>
                              <InfoItem label="이름"       value={<span className="font-semibold text-[var(--warm-dark)]">{t.name}</span>} />
                              <InfoItem label="호실"       value={lease?.room?.roomNo ? `${lease.room.roomNo}호` : '—'} />
                              {t.englishName && <InfoItem label="영어이름" value={t.englishName} />}
                              <InfoItem label="성별"       value={GENDER_LABEL[t.gender] ?? t.gender} />
                              <InfoItem label="국적"       value={t.nationality ? `${natFlag} ${t.nationality}` : '—'} />
                              <InfoItem label="직업"       value={t.job ?? '—'} />
                              <InfoItem label="생년월일"   value={fmtDate(t.birthdate)} />
                              <InfoItem label="기초수급자" value={t.isBasicRecipient ? '예/대상자' : '아니오/해당없음'} />
                            </InfoGrid>
                          </InfoSection>

                          <InfoSection title="연락처">
                            <InfoGrid>
                              <InfoItem label="주 연락처" value={primary?.contactValue ? formatPhone(primary.contactValue) : '—'} />
                              {emergency && <>
                                <InfoItem label="비상 관계"   value={emergency.emergencyRelation ?? '—'} />
                                <InfoItem label="비상 연락처" value={formatPhone(emergency.contactValue)} />
                              </>}
                            </InfoGrid>
                          </InfoSection>

                          {lease && (
                            <InfoSection title="계약 정보">
                              <InfoGrid>
                                <InfoItem label="월 이용료"  value={<MoneyDisplay amount={lease.rentAmount} />} />
                                <InfoItem label="보증금"     value={<MoneyDisplay amount={lease.depositAmount} />} />
                                <InfoItem label="청소비"     value={<MoneyDisplay amount={lease.cleaningFee} />} />
                                <InfoItem label="납부일" value={
                                  <span className="flex items-center gap-2">
                                    <span>{fmtDueDay(lease.dueDay)}</span>
                                    {canEdit && (
                                      <button
                                        onClick={() => { setShowDueDayChange(v => !v); setNewDueDayInput('') }}
                                        className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                                        style={{ color: 'var(--coral)', border: '1px solid rgba(244,98,58,0.35)' }}>
                                        납입일 변경
                                      </button>
                                    )}
                                  </span>
                                } />
                                <InfoItem label="납부방식"   value={PT_LABEL[lease.paymentTiming] ?? lease.paymentTiming} />
                                <InfoItem label="입주일"     value={fmtDate(lease.moveInDate)} />
                                <InfoItem label="거주기간"   value={calcStayPeriod(lease.moveInDate, lease.moveOutDate ?? undefined)} />
                                {lease.expectedMoveOut && <InfoItem label="퇴실 예정일" value={fmtDate(lease.expectedMoveOut)} />}
                                {lease.moveOutDate && <InfoItem label="퇴실일" value={fmtDate(lease.moveOutDate)} />}
                              </InfoGrid>

                              {/* 납입일 변경 인라인 폼 */}
                              {showDueDayChange && (() => {
                                const calc = newDueDayInput.trim()
                                  ? calcProRata(lease.rentAmount, lease.dueDay, newDueDayInput, targetMonth)
                                  : null
                                const canApply = !!calc && calc.type !== 'none'
                                return (
                                  <div className="mt-3 p-3 rounded-xl space-y-3"
                                    style={{ background: 'var(--canvas)', border: '1px solid rgba(244,98,58,0.25)' }}>
                                    <p className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>
                                      납입일 변경 — {targetMonth} 기준 일할 계산
                                    </p>
                                    <div className="flex items-end gap-3">
                                      <div className="flex-1 space-y-1">
                                        <label className="text-xs text-[var(--warm-muted)]">새 납입일</label>
                                        <input
                                          type="text"
                                          value={newDueDayInput}
                                          onChange={e => setNewDueDayInput(e.target.value)}
                                          placeholder="예: 25, 말일"
                                          className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
                                          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}
                                        />
                                      </div>
                                      <div className="text-xs pb-1.5" style={{ color: 'var(--warm-muted)' }}>
                                        현재 {fmtDueDay(lease.dueDay)}
                                      </div>
                                    </div>

                                    {calc && calc.type !== 'none' && (
                                      <div className="rounded-lg px-3 py-2 text-xs font-medium"
                                        style={{
                                          background: calc.type === 'extra' ? 'rgba(239,68,68,0.1)' : 'rgba(34,197,94,0.1)',
                                          color: calc.type === 'extra' ? '#ef4444' : '#16a34a',
                                          border: `1px solid ${calc.type === 'extra' ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                                        }}>
                                        {calc.type === 'extra'
                                          ? `납입일 ${calc.days}일 늦어짐 → 추가납부 ${calc.amount.toLocaleString()}원 발생`
                                          : `납입일 ${calc.days}일 빨라짐 → 과입금 ${calc.amount.toLocaleString()}원 환급`}
                                        <span className="block mt-0.5 font-normal" style={{ color: 'var(--warm-muted)' }}>
                                          월 {lease.rentAmount.toLocaleString()}원 ÷ {(() => { const [y,mo] = targetMonth.split('-').map(Number); return new Date(y,mo,0).getDate() })()}일 × {calc.days}일
                                        </span>
                                      </div>
                                    )}
                                    {calc && calc.type === 'none' && (
                                      <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>기존 납입일과 동일합니다.</p>
                                    )}
                                    {newDueDayInput.trim() && !calc && (
                                      <p className="text-xs text-red-400">유효한 날짜를 입력하세요 (1~31 또는 말일)</p>
                                    )}

                                    <div className="flex gap-2">
                                      <button type="button"
                                        onClick={() => { setShowDueDayChange(false); setNewDueDayInput('') }}
                                        className="flex-1 py-1.5 text-xs rounded-lg transition-colors"
                                        style={{ background: 'var(--cream)', color: 'var(--warm-mid)', border: '1px solid var(--warm-border)' }}>
                                        취소
                                      </button>
                                      <button type="button"
                                        disabled={isPending || !canApply}
                                        onClick={handleChangeDueDayAction}
                                        className="flex-1 py-1.5 text-xs font-semibold rounded-lg transition-colors disabled:opacity-40"
                                        style={{ background: 'var(--coral)', color: '#fff' }}>
                                        {isPending ? '처리 중...' : '변경 적용'}
                                      </button>
                                    </div>
                                  </div>
                                )
                              })()}
                            </InfoSection>
                          )}

                          {lease && (
                            <InfoSection title="추가 정보">
                              <InfoGrid>
                                <InfoItem label="전입신고"       value={REG_LABEL[lease.registrationStatus] ?? lease.registrationStatus} />
                                <InfoItem label="결제 수단"      value={lease.payMethod ?? '—'} />
                                <InfoItem label="현금영수증"     value={lease.cashReceipt ?? '—'} />
                                <InfoItem label="방문 경로"      value={lease.visitRoute ?? '—'} />
                                <InfoItem label="희망 이동 호실" value={lease.wishRooms ?? '—'} />
                                {lease.contractUrl && (
                                  <InfoItem label="계약서" value={
                                    <a href={lease.contractUrl} target="_blank" rel="noopener noreferrer"
                                      className="text-[var(--coral)] hover:text-[var(--coral)] text-xs">링크 열기 ↗</a>
                                  } />
                                )}
                              </InfoGrid>
                            </InfoSection>
                          )}

                          {t.memo && (
                            <InfoSection title="메모">
                              <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap">{t.memo}</p>
                            </InfoSection>
                          )}
                        </>
                      )}

                      {detailTab === 'requests' && (() => {
                        const unresolved = requests.filter(r => !r.resolvedAt)
                        const resolved   = requests.filter(r =>  r.resolvedAt)
                        const fmtDate = (d: string | Date | null) => d ? new Date(d).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' }) : '—'

                        const handleCreate = () => {
                          if (!newContent.trim()) return
                          startReqTransition(async () => {
                            await createTenantRequest({
                              tenantId:    detailTenant!.id,
                              content:     newContent,
                              requestDate: newReqDate,
                              targetDate:  newTargetDate || null,
                            })
                            setNewContent(''); setNewTargetDate('')
                            setNewReqDate(new Date().toISOString().slice(0, 10))
                            const updated = await getTenantRequests(detailTenant!.id)
                            setRequests(updated)
                          })
                        }

                        const handleResolve = (id: string) => {
                          startReqTransition(async () => {
                            await resolveTenantRequest(id)
                            const updated = await getTenantRequests(detailTenant!.id)
                            setRequests(updated)
                          })
                        }

                        const handleDelete = (id: string) => {
                          if (!confirm('이 요청을 삭제하시겠습니까? 복구할 수 없습니다.')) return
                          startReqTransition(async () => {
                            await deleteTenantRequest(id)
                            const updated = await getTenantRequests(detailTenant!.id)
                            setRequests(updated)
                          })
                        }

                        return (
                          <div className="space-y-4">
                            {/* 새 요청 등록 */}
                            <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                              <p className="text-xs font-semibold" style={{ color: 'var(--warm-mid)' }}>새 요청 등록</p>
                              <textarea
                                value={newContent}
                                onChange={e => setNewContent(e.target.value)}
                                rows={3}
                                placeholder="요청 내용을 입력하세요"
                                className="w-full text-sm rounded-lg px-3 py-2 resize-none"
                                style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)', outline: 'none' }}
                              />
                              <div className="flex flex-col xs:grid xs:grid-cols-2 gap-2" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                                <div className="min-w-0">
                                  <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>요청 날짜</label>
                                  <input type="date" value={newReqDate} onChange={e => setNewReqDate(e.target.value)}
                                    className="w-full text-[11px] rounded-lg px-2 py-2 min-w-0"
                                    style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }} />
                                </div>
                                <div className="min-w-0">
                                  <label className="block text-[10px] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>처리 목표일 (선택)</label>
                                  <input type="date" value={newTargetDate} onChange={e => setNewTargetDate(e.target.value)}
                                    className="w-full text-[11px] rounded-lg px-2 py-2 min-w-0"
                                    style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }} />
                                </div>
                              </div>
                              <button onClick={handleCreate} disabled={reqPending || !newContent.trim()}
                                className="w-full py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                                style={{ background: 'var(--coral)', color: '#fff' }}>
                                {reqPending ? '등록 중...' : '등록'}
                              </button>
                            </div>

                            {/* 미처리 요청 목록 */}
                            {requestsLoading ? (
                              <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>불러오는 중...</p>
                            ) : unresolved.length === 0 ? (
                              <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>미처리 요청 없음</p>
                            ) : (
                              <div className="space-y-2">
                                {unresolved.map(r => (
                                  <div key={r.id} className="rounded-xl p-4 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                                    <div className="flex items-start justify-between gap-2">
                                      <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--warm-muted)' }}>
                                        <span>요청 {fmtDate(r.requestDate)}</span>
                                        {r.targetDate && <span className="font-medium" style={{ color: '#f97316' }}>목표 {fmtDate(r.targetDate)}</span>}
                                      </div>
                                      {/* 삭제 버튼 */}
                                      <button onClick={() => handleDelete(r.id)} disabled={reqPending}
                                        className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors disabled:opacity-40"
                                        style={{ color: 'var(--warm-muted)' }}
                                        title="삭제">
                                        <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                          <path d="M1 3h12M4 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M5.5 6v5M8.5 6v5M2 3l.8 9a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L12 3"/>
                                        </svg>
                                      </button>
                                    </div>
                                    <p className="text-sm leading-snug" style={{ color: 'var(--warm-dark)' }}>{r.content}</p>
                                    {/* 완료 처리 CTA */}
                                    <button onClick={() => handleResolve(r.id)} disabled={reqPending}
                                      className="w-full py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                                      style={{ background: 'rgba(34,197,94,0.12)', color: '#16a34a', border: '1.5px solid rgba(34,197,94,0.35)' }}>
                                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M2 6l3 3 5-5"/>
                                      </svg>
                                      완료로 처리하기
                                    </button>
                                  </div>
                                ))}
                              </div>
                            )}

                            {/* 처리 이력 */}
                            {resolved.length > 0 && (
                              <div>
                                <button onClick={() => setShowHistory(v => !v)}
                                  className="text-xs font-medium flex items-center gap-1"
                                  style={{ color: 'var(--warm-muted)' }}>
                                  처리된 이력 {resolved.length}건 {showHistory ? '▲' : '▼'}
                                </button>
                                {showHistory && (
                                  <div className="mt-2 space-y-2">
                                    {resolved.map(r => (
                                      <div key={r.id} className="rounded-xl p-3 opacity-60" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                                        <div className="flex items-start justify-between gap-1 mb-1">
                                          <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--warm-muted)' }}>
                                            <span className="font-medium text-green-500">완료</span>
                                            <span>{fmtDate(r.resolvedAt)}</span>
                                            <span>·</span>
                                            <span>요청 {fmtDate(r.requestDate)}</span>
                                          </div>
                                          <button onClick={() => handleDelete(r.id)} disabled={reqPending}
                                            className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors disabled:opacity-40"
                                            style={{ color: 'var(--warm-muted)' }} title="삭제">
                                            <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                                              <path d="M1 3h12M4 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M5.5 6v5M8.5 6v5M2 3l.8 9a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L12 3"/>
                                            </svg>
                                          </button>
                                        </div>
                                        <p className="text-xs" style={{ color: 'var(--warm-mid)' }}>{r.content}</p>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )
                      })()}

                      {detailTab === 'analysis' && (
                        <>
                          <div className="grid grid-cols-3 gap-3">
                            <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                              <p className="text-xs text-[var(--warm-muted)] mb-1">납부월</p>
                              <p className="text-lg font-bold text-green-400">{paidMonths}개월</p>
                            </div>
                            <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                              <p className="text-xs text-[var(--warm-muted)] mb-1">총 납부액</p>
                              <p className="text-lg font-bold text-[var(--warm-dark)]"><MoneyDisplay amount={totalPaid} /></p>
                            </div>
                            <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                              <p className="text-xs text-[var(--warm-muted)] mb-1">미납액</p>
                              <p className={`text-lg font-bold ${unpaid > 0 ? 'text-red-400' : 'text-[var(--warm-mid)]'}`}>
                                <MoneyDisplay amount={Math.max(0, unpaid)} />
                              </p>
                            </div>
                          </div>
                          <InfoSection title="최근 수납 내역 (최대 12개월)">
                            {payments.length === 0 ? (
                              <p className="text-sm text-[var(--warm-muted)] text-center py-4">수납 기록이 없습니다.</p>
                            ) : (
                              <div className="space-y-2">
                                {payments.map(p => (
                                  <div key={p.id} className="flex items-center justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0">
                                    <div className="flex items-center gap-2">
                                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${p.isPaid ? 'bg-green-400' : 'bg-red-400'}`} />
                                      <span className="text-sm text-[var(--warm-dark)]">{p.targetMonth}</span>
                                      {p.payMethod && <span className="text-xs text-[var(--warm-muted)]">{p.payMethod}</span>}
                                    </div>
                                    <div className="text-right">
                                      <span className={`text-sm font-medium ${p.isPaid ? 'text-green-300' : 'text-red-400'}`}>
                                        <MoneyDisplay amount={p.actualAmount} />
                                      </span>
                                      {p.expectedAmount !== p.actualAmount && (
                                        <span className="text-xs text-[var(--warm-muted)] ml-1">/ <MoneyDisplay amount={p.expectedAmount} /></span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </InfoSection>

                          {/* Gemini AI 분석 */}
                          <div className="rounded-xl border border-[var(--coral)]/20 bg-[var(--coral)]/5 p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-base">✨</span>
                                <span className="text-sm font-semibold text-[var(--coral)]">Gemini AI 수납 진단</span>
                              </div>
                              <button
                                onClick={handleAiAnalyze}
                                disabled={aiLoading}
                                className="text-xs px-3 py-1.5 bg-[var(--coral)] hover:opacity-90 text-white rounded-lg transition-colors disabled:opacity-50">
                                {aiLoading ? '분석 중...' : aiText ? '다시 분석' : '분석하기'}
                              </button>
                            </div>
                            {aiLoading && (
                              <div className="flex items-center gap-2 text-xs text-[var(--coral)] animate-pulse">
                                <span className="w-1.5 h-1.5 rounded-full bg-[var(--coral)] animate-bounce" />
                                AI가 수납 패턴을 분석하고 있습니다...
                              </div>
                            )}
                            {aiText && !aiLoading && (
                              <p className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap">{aiText}</p>
                            )}
                            {!aiText && !aiLoading && (
                              <p className="text-xs text-[var(--warm-muted)]">'분석하기'를 눌러 이 입주자의 수납 건전성을 AI로 진단하세요.</p>
                            )}
                          </div>
                        </>
                      )}
                    </div>

                    {/* 읽기 전용 푸터 */}
                    <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                      <button onClick={() => handleDelete(t.id, t.name)} disabled={isPending}
                        className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-xl transition-colors disabled:opacity-40">
                        삭제
                      </button>
                      <div className="flex-1" />
                      {status === 'RESERVED' && (
                        <button onClick={() => handleMoveIn(lease!.id, t.id, t.name)} disabled={isPending}
                          className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 text-sm rounded-xl transition-colors disabled:opacity-40">
                          입실 처리
                        </button>
                      )}
                      <button
                        onClick={() => { setDetailEditMode(true); setDetailTab('info'); setError('') }}
                        className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
                        수정
                      </button>
                    </div>
                  </>
              )}

              {/* ── 편집 모드 ── */}
              {detailEditMode && (
                <form key={t.id} onSubmit={handleUpdateFromDetail} className="flex flex-col flex-1 overflow-hidden">
                  <input type="hidden" name="tenantId"    value={t.id} />
                  <input type="hidden" name="leaseTermId" value={t.leaseTerms[0]?.id ?? ''} />
                  <div className="overflow-y-auto p-6 space-y-4 flex-1">
                    <TenantForm rooms={rooms} tenant={t} error={error} />
                  </div>
                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <button type="button"
                      onClick={() => { setDetailEditMode(false); setError('') }}
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
        )
      })()}

      {/* ── 입주자 추가 모달 ────────────────────────────────────────── */}
      {showAdd && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setShowAdd(false)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">입주자 등록</h2>
              <button onClick={() => setShowAdd(false)} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl">✕</button>
            </div>
            <form onSubmit={handleAdd} className="overflow-y-auto p-6 space-y-4">
              <TenantForm rooms={rooms} error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                  취소
                </button>
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                  {isPending ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 입주자 수정 모달 ────────────────────────────────────────── */}
      {editTenant && (
        <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
          onClick={() => setEditTenant(null)}>
          <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-lg flex flex-col max-h-[90vh]"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--warm-dark)]">수정 — {editTenant.name}</h2>
              <button onClick={() => setEditTenant(null)} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl">✕</button>
            </div>
            <form key={editTenant.id} onSubmit={handleUpdate} className="overflow-y-auto p-6 space-y-4">
              <input type="hidden" name="tenantId"    value={editTenant.id} />
              <input type="hidden" name="leaseTermId" value={editTenant.leaseTerms[0]?.id ?? ''} />
              <TenantForm rooms={rooms} tenant={editTenant} error={error} />
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setEditTenant(null)}
                  className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                  취소
                </button>
                <button type="submit" disabled={isPending}
                  className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                  {isPending ? '저장 중...' : '저장'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── 수납 모달 ─────────────────────────────────────────────── */}
      {payTarget && (() => {
        const { tenant, lease } = payTarget
        const adjRecords = payHistory.filter(p => p.memo?.startsWith('[납입일변경]'))
        const depositRecords = payHistory.filter(p => p.isDeposit)
        const regularRecords = payHistory.filter(p => !p.memo?.startsWith('[납입일변경]') && !p.isDeposit)
        const isPreAcq = (p: PayRecord) => !!(payAcquisitionDate && new Date(p.payDate) < payAcquisitionDate)
        const prevOwnerPaid = regularRecords.filter(isPreAcq).reduce((s, p) => s + p.actualAmount, 0)
        const regularPaid = regularRecords.reduce((s, p) => s + p.actualAmount, 0) - prevOwnerPaid
        const adjNet = adjRecords.reduce((s, p) => s + p.actualAmount, 0)
        const balance = regularPaid + adjNet - lease.rentAmount
        const DAYS = ['일', '월', '화', '수', '목', '금', '토']
        const fmtPayDate = (d: Date | string) => {
          const dt = new Date(d)
          return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
        }
        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={closePayModal}>
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-md flex flex-col max-h-[88vh]"
              onClick={e => e.stopPropagation()}>

              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
                <div>
                  <h2 className="text-base font-bold text-[var(--warm-dark)]">
                    {lease.room?.roomNo ? `${lease.room.roomNo}호 — ` : ''}{tenant.name}
                  </h2>
                  <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                    {targetMonth} · 예정 {lease.rentAmount.toLocaleString()}원
                  </p>
                </div>
                <button onClick={closePayModal} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
              </div>

              {/* ── 읽기 전용 ── */}
              {!showPayForm && (
                <>
                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    {/* 요약 */}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                        <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
                        <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]"><MoneyDisplay amount={regularPaid} /></p>
                        {adjNet !== 0 && (
                          <p className="text-[10px] mt-0.5 font-medium"
                            style={{ color: adjNet > 0 ? '#16a34a' : '#ef4444' }}>
                            조정 {adjNet > 0 ? '+' : ''}{adjNet.toLocaleString()}원
                          </p>
                        )}
                      </div>
                      <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                        <p className="text-xs text-[var(--warm-muted)]">잔액</p>
                        <p className={`text-sm font-bold mt-0.5 ${balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {balance > 0
                            ? <MoneyDisplay amount={balance} prefix="+" />
                            : balance < 0
                              ? <MoneyDisplay amount={Math.abs(balance)} prefix="-" />
                              : '0원'}
                        </p>
                      </div>
                    </div>
                    {prevOwnerPaid > 0 && (
                      <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                        <p className="text-xs text-amber-700">이전 원장 귀속 (인수일 이전 납부)</p>
                        <p className="text-xs font-semibold text-amber-700">{prevOwnerPaid.toLocaleString()}원</p>
                      </div>
                    )}

                    {/* 납입일 변경 조정 내역 */}
                    {adjRecords.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>납입일 변경 조정</p>
                        {adjRecords.map(p => {
                          const isExtra = p.actualAmount < 0
                          const absAmt = Math.abs(p.actualAmount)
                          const label = p.memo?.replace('[납입일변경] ', '') ?? ''
                          return (
                            <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2.5"
                              style={{
                                background: isExtra ? 'rgba(239,68,68,0.07)' : 'rgba(34,197,94,0.07)',
                                border: `1px solid ${isExtra ? 'rgba(239,68,68,0.2)' : 'rgba(34,197,94,0.2)'}`,
                              }}>
                              <div>
                                <p className="text-xs font-semibold"
                                  style={{ color: isExtra ? '#ef4444' : '#16a34a' }}>
                                  {isExtra ? '추가납부 필요' : '과입금 처리'}
                                </p>
                                {label && (
                                  <p className="text-[10px] mt-0.5" style={{ color: 'var(--warm-muted)' }}>{label}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold"
                                  style={{ color: isExtra ? '#ef4444' : '#16a34a' }}>
                                  {isExtra ? '-' : '+'}{absAmt.toLocaleString()}원
                                </span>
                                <button onClick={() => handleDeletePayRecord(p.id)}
                                  className="text-xs text-red-400 hover:text-red-300 transition-colors">✕</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 보증금 수납 내역 */}
                    {depositRecords.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[var(--warm-mid)]">보증금 수납 내역</p>
                        {depositRecords.map(p => (
                          <div key={p.id} className="flex items-center justify-between rounded-xl px-3 py-2.5 bg-purple-50 border border-purple-200">
                            <div>
                              <p className="text-xs text-purple-600">
                                {fmtPayDate(p.payDate)} · {p.payMethod ?? '—'}
                                <span className="ml-1.5 text-[10px] font-semibold bg-purple-200 text-purple-800 rounded px-1 py-0.5">보증금</span>
                              </p>
                            </div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold text-purple-700">{p.actualAmount.toLocaleString()}원</span>
                              <button onClick={() => handleDeletePayRecord(p.id)}
                                className="text-xs text-red-400 hover:text-red-300 transition-colors">✕</button>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* 납부 내역 */}
                    {regularRecords.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[var(--warm-mid)]">납부 내역</p>
                        {regularRecords.map(p => {
                          const prevOwner = isPreAcq(p)
                          return (
                            <div key={p.id} className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${prevOwner ? 'bg-amber-50 border border-amber-200' : 'bg-[var(--canvas)]'}`}>
                              <div>
                                <p className={`text-xs ${prevOwner ? 'text-amber-600' : 'text-[var(--warm-mid)]'}`}>
                                  {p.seqNo}회차 · {fmtPayDate(p.payDate)} · {p.payMethod ?? '—'}
                                  {prevOwner && <span className="ml-1.5 text-[10px] font-semibold bg-amber-200 text-amber-800 rounded px-1 py-0.5">이전 원장</span>}
                                </p>
                                {p.memo && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${prevOwner ? 'text-amber-700' : 'text-[var(--warm-dark)]'}`}>{p.actualAmount.toLocaleString()}원</span>
                                <button onClick={() => handleDeletePayRecord(p.id)}
                                  className="text-xs text-red-400 hover:text-red-300 transition-colors">✕</button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {payHistory.length === 0 && (
                      <p className="text-sm text-[var(--warm-muted)] text-center py-4">이 달 수납 기록이 없습니다.</p>
                    )}
                  </div>

                  {/* 납부일 임시 조정 — 항상 보이는 영역 */}
                  {(() => {
                    const isOverrideActive = lease.overrideDueDayMonth === targetMonth && !!lease.overrideDueDay
                    return (
                      <div className="border-t border-amber-500/20 bg-amber-500/5 px-6 py-3 space-y-2 shrink-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs">📅</span>
                            <span className="text-xs font-semibold text-amber-300">납부일 임시 조정</span>
                            {isOverrideActive && (
                              <span className="text-xs bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full">
                                {targetMonth} · {lease.overrideDueDay}일로 적용 중
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isOverrideActive && !showOverrideForm && (
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  if (!confirm('납부일 조정을 해제하시겠습니까?')) return
                                  startTransition(async () => {
                                    await clearDueDayOverride(lease.id)
                                    refresh()
                                  })
                                }}
                                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-40">
                                해제
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                setShowOverrideForm(v => !v)
                                setOverrideInput(isOverrideActive ? (lease.overrideDueDay ?? '') : '')
                                setOverrideReason(isOverrideActive ? (lease.overrideDueDayReason ?? '') : '')
                              }}
                              className="text-xs text-amber-400 hover:text-amber-300 transition-colors">
                              {showOverrideForm ? '닫기' : isOverrideActive ? '수정' : '조정하기'}
                            </button>
                          </div>
                        </div>

                        {isOverrideActive && !showOverrideForm && (
                          <p className="text-xs text-[var(--warm-muted)]">
                            기준 {fmtDueDay(lease.dueDay)} → 이번달 {lease.overrideDueDay}일
                            {lease.overrideDueDayReason ? ` · ${lease.overrideDueDayReason}` : ''}
                          </p>
                        )}

                        {showOverrideForm && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-[var(--warm-muted)]">조정 납부일</label>
                                <input
                                  type="text"
                                  value={overrideInput}
                                  onChange={e => setOverrideInput(e.target.value)}
                                  placeholder="예: 20, 말일"
                                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-amber-500"
                                />
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-[var(--warm-muted)]">사유 (선택)</label>
                                <input
                                  type="text"
                                  value={overrideReason}
                                  onChange={e => setOverrideReason(e.target.value)}
                                  placeholder="예: 급여일 변경"
                                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-amber-500"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={isPending || !overrideInput.trim()}
                              onClick={() => {
                                startTransition(async () => {
                                  await setDueDayOverride(lease.id, targetMonth, overrideInput.trim(), overrideReason.trim())
                                  setShowOverrideForm(false)
                                  refresh()
                                })
                              }}
                              className="w-full py-1.5 bg-amber-600 hover:bg-amber-500 text-[var(--warm-dark)] text-xs font-medium rounded-lg transition-colors disabled:opacity-40">
                              {isPending ? '저장 중...' : `${targetMonth} 납부일을 ${overrideInput || '?'}일로 조정`}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <div className="flex-1" />
                    <button onClick={() => { setShowPayForm(true); setError('') }}
                      className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
                      수납 등록
                    </button>
                  </div>
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
                    {lease.depositAmount > 0 && (
                      <div className="space-y-1">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isDepositMode}
                            onChange={e => {
                              const checked = e.target.checked
                              setIsDepositMode(checked)
                              if (checked) {
                                setPayAmount(lease.depositAmount)
                                const mi = lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null
                                setPayDateVal(mi ?? new Date().toISOString().slice(0, 10))
                              } else {
                                setPayDateVal(new Date().toISOString().slice(0, 10))
                              }
                            }}
                            className="w-4 h-4 accent-[var(--coral)]"
                          />
                          <span className="text-xs text-[var(--warm-mid)]">
                            보증금 수납 ({lease.depositAmount.toLocaleString()}원)
                          </span>
                        </label>
                        {isDepositMode && payAmount > lease.depositAmount && (
                          <p className="text-xs text-emerald-600">
                            초과금 {(payAmount - lease.depositAmount).toLocaleString()}원 → {targetMonth} 이용료 처리
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
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)]" />
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
        )
      })()}

      {/* ── 호실 미니 모달 ─────────────────────────────────────────── */}
      {roomDetailId && (() => {
        const room = rooms.find(r => r.id === roomDetailId)
        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={() => setRoomDetailId(null)}>
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm p-6 space-y-3"
              onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between">
                <h2 className="text-base font-bold text-[var(--warm-dark)]">{room?.roomNo}호 정보</h2>
                <button onClick={() => setRoomDetailId(null)} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl">✕</button>
              </div>
              {room ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-[var(--warm-muted)]">상태</span><span className={room.isVacant ? 'text-[var(--warm-mid)]' : 'text-green-300'}>{room.isVacant ? '공실' : '거주중'}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--warm-muted)]">기본 이용료</span><span className="text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></span></div>
                </div>
              ) : (
                <p className="text-[var(--warm-muted)] text-sm">호실 정보를 찾을 수 없습니다.</p>
              )}
              <a href="/room-manage" className="block w-full text-center py-2 mt-2 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                호실 관리 페이지로 →
              </a>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

// ── 희망 호실 선택기 ──────────────────────────────────────────────

const WISH_WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const WISH_DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
const WISH_RANK = ['1순위', '2순위', '3순위', '4순위', '5순위']

function getFloor(roomNo: string): string {
  const n = roomNo.replace(/[^0-9]/g, '')
  if (n.length >= 3) return n.slice(0, n.length - 2)
  return ''
}

function WishRoomPicker({ rooms, defaultValue }: { rooms: Room[]; defaultValue?: string | null }) {
  const initial = (defaultValue ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const [selected, setSelected] = useState<string[]>(initial.slice(0, 5))
  const [floorF, setFloorF]     = useState('')
  const [windowF, setWindowF]   = useState('')
  const [typeF, setTypeF]       = useState('')
  const [directionF, setDirF]   = useState('')

  const floors     = [...new Set(rooms.map(r => getFloor(r.roomNo)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
  const windowTypes = [...new Set(rooms.map(r => r.windowType).filter(Boolean))] as string[]
  const types      = [...new Set(rooms.map(r => r.type).filter(Boolean))] as string[]
  const directions = [...new Set(rooms.map(r => r.direction).filter(Boolean))] as string[]

  const filtered = rooms.filter(r => {
    if (floorF && getFloor(r.roomNo) !== floorF) return false
    if (windowF && r.windowType !== windowF) return false
    if (typeF && r.type !== typeF) return false
    if (directionF && r.direction !== directionF) return false
    return true
  })

  const add = (roomNo: string) => {
    if (!roomNo || selected.includes(roomNo) || selected.length >= 5) return
    setSelected(prev => [...prev, roomNo])
  }
  const remove = (roomNo: string) => setSelected(prev => prev.filter(r => r !== roomNo))

  const selCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-2.5 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] w-full'

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-[var(--warm-mid)]">
        입실 희망 호실 <span className="font-normal opacity-60">(최대 5개 · 공실/퇴실 예정 시 대시보드 알림)</span>
      </label>
      <input type="hidden" name="wishRooms" value={selected.join(',')} />

      {/* 필터 */}
      <div className="grid grid-cols-4 gap-2">
        <select value={floorF} onChange={e => setFloorF(e.target.value)} className={selCls}>
          <option value="">층 전체</option>
          {floors.map(f => <option key={f} value={f}>{f}층</option>)}
        </select>
        <select value={windowF} onChange={e => setWindowF(e.target.value)} className={selCls}>
          <option value="">창문 전체</option>
          {windowTypes.map(w => <option key={w} value={w}>{WISH_WINDOW_LABEL[w] ?? w}</option>)}
        </select>
        <select value={typeF} onChange={e => setTypeF(e.target.value)} className={selCls}>
          <option value="">타입 전체</option>
          {types.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={directionF} onChange={e => setDirF(e.target.value)} className={selCls}>
          <option value="">방향 전체</option>
          {directions.map(d => <option key={d} value={d}>{WISH_DIR_LABEL[d] ?? d}</option>)}
        </select>
      </div>

      {/* 호실 선택 */}
      <select
        value=""
        onChange={e => { add(e.target.value); e.target.value = '' }}
        disabled={selected.length >= 5}
        className={selCls}
      >
        <option value="">호실 선택...</option>
        {filtered.filter(r => !selected.includes(r.roomNo)).map(r => (
          <option key={r.id} value={r.roomNo}>
            {r.roomNo}호{r.isVacant ? ' (공실)' : ''}
          </option>
        ))}
      </select>

      {/* 선택된 순위 칩 */}
      {selected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {selected.map((roomNo, i) => (
            <span key={roomNo} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--coral)]/20 text-[var(--coral)]">
              {WISH_RANK[i]} {roomNo}호
              <button type="button" onClick={() => remove(roomNo)}
                className="leading-none hover:text-red-400 transition-colors">×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// ── 폼 컴포넌트 (추가/수정 공용) ─────────────────────────────────

function TenantForm({ rooms, tenant, error, defaultDeposit, defaultCleaningFee }: {
  rooms: Room[]; tenant?: Tenant; error?: string
  defaultDeposit?: number | null; defaultCleaningFee?: number | null
}) {
  const lease     = tenant?.leaseTerms[0]
  const primary   = tenant?.contacts.find(c => c.isPrimary)
  const emergency = tenant?.contacts.find(c => c.isEmergency)

  const [statusVal, setStatusVal]   = useState(lease?.status ?? 'ACTIVE')
  const [selectedRoomId, setSelectedRoomId] = useState(lease?.room?.id ?? '')
  const [rentAmount, setRentAmount] = useState<number | undefined>(lease?.rentAmount)
  const [tourDateVal, setTourDateVal] = useState(toDateInput(lease?.tourDate))

  const handleRoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const roomId = e.target.value
    setSelectedRoomId(roomId)
    const room = rooms.find(r => r.id === roomId)
    if (room) setRentAmount(room.baseRent)
  }

  // WAITING_TOUR/TOUR_DONE/RESERVED는 호실 필수 아님
  const roomIsOptional = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED'].includes(statusVal)
  // ACTIVE, CHECKOUT_PENDING → 입주중 방 비활성화
  const activeOnlyStatus = ['ACTIVE', 'CHECKOUT_PENDING'].includes(statusVal)
  const isWaitingTourStatus = statusVal === 'WAITING_TOUR'

  // 납부일 상태 — raw 값(숫자 또는 '말일')과 표시 문자열 분리
  const initDueDay = (): { raw: string; disp: string } => {
    const d = lease?.dueDay ?? ''
    if (!d) return { raw: '', disp: '' }
    const n = parseInt(d, 10)
    if (!isNaN(n)) return n >= 30 ? { raw: '말일', disp: '말일' } : { raw: d, disp: `${n}일` }
    return d.includes('말') ? { raw: '말일', disp: '말일' } : { raw: d, disp: d }
  }
  const [dueDayRaw, setDueDayRaw] = useState(initDueDay().raw)
  const [dueDayDisp, setDueDayDisp] = useState(initDueDay().disp)
  const [moveInDateVal, setMoveInDateVal] = useState(toDateInput(lease?.moveInDate))

  const applyDueDay = (input: string) => {
    const t = input.trim()
    if (!t) { setDueDayRaw(''); setDueDayDisp(''); return }
    if (/^[ㅁ마말]/.test(t) || t === '말일') {
      setDueDayRaw('말일'); setDueDayDisp('말일'); return
    }
    const n = parseInt(t.replace(/\D/g, ''), 10)
    if (!isNaN(n) && n > 0) {
      if (n >= 30) { setDueDayRaw('말일'); setDueDayDisp('말일') }
      else { setDueDayRaw(String(n)); setDueDayDisp(`${n}일`) }
    } else {
      setDueDayRaw(t); setDueDayDisp(t)
    }
  }

  const handleMoveInChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value
    if (!val) return
    const d = new Date(val)
    const day = d.getDate()
    const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
    applyDueDay(day >= lastDay ? '말일' : String(day))
  }

  const showExitDate = ['CHECKOUT_PENDING', 'CHECKED_OUT'].includes(statusVal)
  const moveInLabel = roomIsOptional ? '입주희망일' : '입주일'

  return (
    <>
      <FormSection title="기본 정보">
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름 *" name="name" defaultValue={tenant?.name} placeholder="홍길동" />
          <Field label="영어이름" name="englishName" defaultValue={tenant?.englishName ?? ''} placeholder="Hong Gildong" />
        </div>
        <div className="grid grid-cols-3 gap-3">
          <Field label="생년월일" name="birthdate" type="date" defaultValue={toDateInput(tenant?.birthdate)} />
          <SelectField label="성별" name="gender" defaultValue={tenant?.gender}>
            <option value="UNKNOWN">미기재</option>
            <option value="MALE">남성</option>
            <option value="FEMALE">여성</option>
            <option value="OTHER">기타</option>
          </SelectField>
          <SelectField label="기초수급자" name="isBasicRecipient" defaultValue={tenant?.isBasicRecipient ? 'true' : 'false'}>
            <option value="false">아니오/해당없음</option>
            <option value="true">예/대상자</option>
          </SelectField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
            <CountrySelect name="nationality" defaultValue={tenant?.nationality} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">직업</label>
            <JobSelect name="job" defaultValue={tenant?.job} />
          </div>
        </div>
      </FormSection>

      <FormSection title="계약 정보">
        <div className="grid grid-cols-2 gap-3">
          {/* 상태 — controlled: 호실 선택 가능 여부 및 퇴실일 표시 결정 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">상태</label>
            <select name="status" value={statusVal} onChange={e => setStatusVal(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="ACTIVE">거주중</option>
              <option value="CHECKOUT_PENDING">퇴실 예정</option>
              <option value="NON_RESIDENT">비거주자 (명의만)</option>
              <option value="WAITING_TOUR">투어 대기</option>
              <option value="TOUR_DONE">투어 완료</option>
              <option value="RESERVED">예약</option>
              {tenant && <option value="CHECKED_OUT">퇴실</option>}
              {tenant && <option value="CANCELLED">취소</option>}
            </select>
          </div>
          <SelectField label="선납/후납" name="paymentTiming" defaultValue={lease?.paymentTiming ?? 'PREPAID'}>
            <option value="PREPAID">선납</option>
            <option value="POSTPAID">후납</option>
          </SelectField>
        </div>

        {/* 호실 — 상태에 따라 선택 규칙 다름 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">
            호실{roomIsOptional ? '' : ' *'}
          </label>
          <select name="roomId" value={selectedRoomId} onChange={handleRoomChange} required={!roomIsOptional}
            onWheel={e => e.stopPropagation()}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
            <option value="">{roomIsOptional ? '호실 선택 (선택사항)' : '호실 선택'}</option>
            {rooms.map(r => {
              const isCurrentRoom = r.id === lease?.room?.id
              const isCheckoutPending = r.currentLeaseStatus === 'CHECKOUT_PENDING'
              // WAITING_TOUR: 공실이거나 퇴실예정인 방만 활성화
              const disableRoom = isWaitingTourStatus
                ? (!r.isVacant && !isCheckoutPending && !isCurrentRoom)
                : (activeOnlyStatus && !r.isVacant && !isCurrentRoom)
              return (
                <option key={r.id} value={r.id} disabled={disableRoom}
                  style={isWaitingTourStatus && isCheckoutPending && !r.isVacant ? { fontWeight: 'bold' } : undefined}>
                  {r.roomNo}호{isWaitingTourStatus && isCheckoutPending && !r.isVacant ? ' (퇴실예정)' : ''}
                </option>
              )
            })}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료</label>
            <MoneyInput name="rentAmount" value={rentAmount} onChange={setRentAmount} placeholder="0원" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">보증금</label>
            <MoneyInput name="depositAmount" defaultValue={lease?.depositAmount ?? (defaultDeposit ?? undefined)} placeholder="0원" />
          </div>
        </div>
        {/* 청소비 | 입주일 or 입주희망일 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">청소비</label>
            <MoneyInput name="cleaningFee" defaultValue={lease?.cleaningFee ?? (defaultCleaningFee ?? undefined)} placeholder="0원" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">{moveInLabel}</label>
            <DatePicker
              name="moveInDate"
              value={moveInDateVal}
              onChange={(v) => {
                setMoveInDateVal(v)
                if (v && !roomIsOptional) {
                  const d = new Date(v)
                  const day = d.getDate()
                  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                  applyDueDay(day >= lastDay ? '말일' : String(day))
                }
              }}
              placeholder={`${moveInLabel} 선택`}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
            />
          </div>
        </div>
        {/* 투어 예정일 (WAITING_TOUR 전용) */}
        {statusVal === 'WAITING_TOUR' && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">투어 예정일</label>
            <DatePicker
              name="tourDate"
              value={tourDateVal}
              onChange={setTourDateVal}
              placeholder="투어 예정일 선택"
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
            />
          </div>
        )}
        {/* 납부일 | 퇴실일(조건부) (아이템 5, 7, 8) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
            <input type="hidden" name="dueDay" value={dueDayRaw} />
            <input
              type="text"
              value={dueDayDisp}
              onChange={e => setDueDayDisp(e.target.value)}
              onFocus={() => setDueDayDisp(prev => prev.replace(/일$/, ''))}
              onBlur={() => applyDueDay(dueDayDisp)}
              placeholder="15일, 말일 등"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
            />
          </div>
          {showExitDate && (
            <Field label="퇴실일" name="expectedMoveOut" type="date" defaultValue={toDateInput(lease?.expectedMoveOut)} />
          )}
        </div>
      </FormSection>

      <FormSection title="연락처">
        <div className="grid grid-cols-3 gap-2">
          <SelectField label="연락 수단" name="contactType" defaultValue={primary?.contactType ?? 'PHONE'}>
            <option value="PHONE">전화</option>
            <option value="KAKAO">카카오</option>
            <option value="WECHAT">위챗</option>
            <option value="LINE">라인</option>
            <option value="TELEGRAM">텔레그램</option>
          </SelectField>
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">연락처</label>
            <PhoneInput name="contactValue" defaultValue={primary?.contactValue ?? ''} />
          </div>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <Field label="비상연락 관계" name="emergencyRelation" defaultValue={emergency?.emergencyRelation ?? ''} placeholder="부모님" />
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">비상 연락처</label>
            <PhoneInput name="emergencyContact" defaultValue={emergency?.contactValue ?? ''} />
          </div>
        </div>
      </FormSection>

      <FormSection title="추가 정보">
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="전입신고" name="registrationStatus" defaultValue={lease?.registrationStatus ?? 'NOT_REPORTED'}>
            <option value="NOT_REPORTED">미신고</option>
            <option value="REGISTERED">완료</option>
            <option value="EXEMPTED">해당없음</option>
          </SelectField>
          <SelectField label="결제 수단" name="payMethod" defaultValue={lease?.payMethod ?? ''}>
            <option value="">미선택</option>
            <option value="계좌이체">계좌이체</option>
            <option value="신용카드">신용카드</option>
            <option value="현금">현금</option>
          </SelectField>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <SelectField label="현금영수증" name="cashReceipt" defaultValue={lease?.cashReceipt ?? ''}>
            <option value="">미선택</option>
            <option value="불필요">불필요</option>
            <option value="소득공제">소득공제</option>
            <option value="지출증빙">지출증빙</option>
          </SelectField>
          <Field label="방문 경로" name="visitRoute" defaultValue={lease?.visitRoute ?? ''} placeholder="소개, 네이버 등" />
        </div>
        <WishRoomPicker rooms={rooms} defaultValue={lease?.wishRooms} />
        <Field label="계약서 링크" name="contractUrl" type="url" defaultValue={lease?.contractUrl ?? ''} placeholder="https://..." />
      </FormSection>

      <FormSection title="메모">
        <textarea name="memo" rows={2} defaultValue={tenant?.memo ?? ''} placeholder="입주자 특이사항"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] resize-none" />
      </FormSection>

      {error && <p className="text-red-400 text-sm">{error}</p>}
    </>
  )
}

// ── 서브 컴포넌트 ─────────────────────────────────────────────────

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-[var(--warm-muted)] uppercase tracking-wider pb-1 border-b border-[var(--warm-border)]/60">{title}</p>
      {children}
    </div>
  )
}

function Field({ label, name, type = 'text', placeholder, defaultValue, required }: {
  label: string; name: string; type?: string; placeholder?: string; defaultValue?: string; required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} required={required}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors" />
    </div>
  )
}

function SelectField({ label, name, children, defaultValue, required }: {
  label: string; name: string; children: React.ReactNode; defaultValue?: string; required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <select name={name} defaultValue={defaultValue} required={required}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        {children}
      </select>
    </div>
  )
}

function InfoSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-[var(--warm-muted)] uppercase tracking-wider pb-1.5 border-b border-[var(--warm-border)]/60">{title}</p>
      {children}
    </div>
  )
}

function InfoGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">{children}</div>
}

function InfoItem({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-[var(--warm-muted)]">{label}</p>
      <p className="text-sm text-[var(--warm-dark)] mt-0.5">{value}</p>
    </div>
  )
}
