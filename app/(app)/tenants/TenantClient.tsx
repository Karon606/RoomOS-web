'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { fmtDateKor as fmtDate } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import { calcShortStay, stayDaysOf } from '@/lib/shortStay'
import { getRoomsForQuote, undoBatchUpdateTenants } from './actions'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { useRouter, useSearchParams } from 'next/navigation'
import { addTenant, updateTenant, deleteTenant, recordDepositReturn, undoDepositReturn,
  getContractFiles, deleteContractFile, createContractScanUploadSession, finalizeContractScan,
  batchUpdateTenants,
  type ContractFileRow,
} from './actions'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { savePayment, saveDepositPayment, deletePayment, updatePayment, getPaymentsByLease, setDueDayOverride, clearDueDayOverride } from '@/app/(app)/rooms/actions'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { PrismNavBar } from '@/components/entity-modal/PrismNavBar'
import { OcrToolbar, setInputByName } from './OcrToolbar'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { dueDayBucketOf, DUE_DAY_BUCKET_OPTIONS, type DueDayBucket } from '@/lib/dueDayBucket'
import { PhoneInput } from '@/components/ui/PhoneInput'
import { IntlPhoneInput } from '@/components/ui/IntlPhoneInput'
import { formatPhone } from '@/lib/formatPhone'
import { CountrySelect, flagByName } from '@/components/ui/CountrySelect'
import { JobSelect } from '@/components/ui/JobSelect'
import { DatePicker } from '@/components/ui/DatePicker'
import { kstYmdStr } from '@/lib/kstDate'
import { useUrlState } from '@/lib/useUrlState'
import { useLongPress } from '@/lib/useLongPress'
import { withSave, trackSave, pushToast } from '@/lib/saveStatus'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Modal } from '@/components/ui/Modal'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { SortSelect } from '@/components/ui/SortSelect'
import { STATUS_LABEL, leaseCardKind, statusException, leaseTipTone } from '@/lib/statusColors'
import { RoomCard } from '@/components/ui/RoomCard'
import { StatusBadge, statusTipColor, statusRowTint } from '@/components/ui/StatusBadge'
import { DisplayFieldsMenu, useDisplayFields, type FieldDef } from '@/components/ui/DisplayFieldsMenu'
import { NoticeSmsModal } from '@/components/NoticeSmsModal'

const fmtRoomNo = (no: string | null | undefined) =>
  no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—'

// ── 타입 ─────────────────────────────────────────────────────────

type Room = { id: string; roomNo: string; baseRent: number; scheduledRent: number | null; nonResidentRent: number | null; isVacant: boolean; type: string | null; floor: string | null; windowType: string | null; direction: string | null; currentLeaseStatus: string | null }

type Contact = {
  id: string; contactType: string; contactValue: string
  isEmergency: boolean; emergencyRelation: string | null; isPrimary: boolean
  isHomeCountry?: boolean; countryCode?: string | null
}

type PaymentRecord = {
  id: string; targetMonth: string; expectedAmount: number; actualAmount: number
  isPaid: boolean; payDate: string | Date; payMethod: string | null; memo: string | null
}

type PayRecord = {
  id: string; seqNo: number; payDate: Date; targetMonth: string
  actualAmount: number; payMethod: string | null; memo: string | null; isPaid: boolean
  isDeposit: boolean
  cashReceiptIssuedAt?: Date | string | null   // 발행 칩 표시(오류신고 c0936f89)
}

type LeaseTerm = {
  id: string; status: string; rentAmount: number; depositAmount: number
  cleaningFee: number; dueDay: string | null
  overrideDueDay: string | null; overrideDueDayMonth: string | null; overrideDueDayReason: string | null
  moveInDate: string | Date | null; moveOutDate: string | Date | null
  expectedMoveOut: string | Date | null; contactAlertDate?: string | Date | null; tourDate: string | Date | null; inquiryAt: string | Date | null
  reservationConfirmedAt: string | Date | null
  isShortTerm: boolean
  paymentTiming: string
  payMethod: string | null; cashReceipt: string | null
  registrationStatus: string; contractUrl: string | null
  wishRooms: string | null; wishConditions: string | null; keepAlertAfterInquiry: boolean; visitRoute: string | null
  room: { id: string; roomNo: string; floor: string | null } | null
  paymentRecords: PaymentRecord[]
}

type Tenant = {
  id: string; name: string; englishName: string | null
  email: string | null
  birthdate: string | Date | null; memo: string | null
  nationality: string | null; gender: string; job: string | null
  isBasicRecipient: boolean; smoking: boolean; contacts: Contact[]; leaseTerms: LeaseTerm[]
}

type SortKey =
  | 'roomNo' | 'name' | 'status' | 'rentAmount' | 'depositAmount'
  | 'moveInDate' | 'moveOutDate' | 'expectedMoveOut'
  | 'nationality' | 'gender' | 'stayPeriod' | 'dueDay'
type SortDir = 'asc' | 'desc'

// ── 열 정의 ─────────────────────────────────────────────────────

const COL_DEFS = [
  { key: 'englishName',   label: '영어이름', defaultOn: false, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'nationality',   label: '국적',     defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'gender',        label: '성별',     defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'job',           label: '직업',     defaultOn: false, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'contact',       label: '연락처',   defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'payMethod',     label: '결제수단', defaultOn: false, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'depositAmount', label: '보증금',   defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'rentAmount',    label: '월 이용료', defaultOn: true, tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'dueDay',        label: '납부일',   defaultOn: true,  tabs: ['residents'] },
  { key: 'stayPeriod',    label: '거주기간', defaultOn: true,  tabs: ['residents', 'past'] },
  { key: 'status',        label: '상태',     defaultOn: true,  tabs: ['residents', 'inquiry', 'past', 'dropped'] },
  { key: 'scheduledDate', label: '예정일',   defaultOn: false, tabs: ['residents'] },
  { key: 'moveOutDate',   label: '퇴실일',   defaultOn: true,  tabs: ['past'] },
] as const
type ColKey = (typeof COL_DEFS)[number]['key']

const COL_VIS_KEY    = 'stayeum_tenant_col_vis'
const COL_WIDTHS_KEY = 'stayeum_tenant_col_widths'

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

// 상태 칩 — 예외 상태는 StatusBadge, 정상 상태는 조용한 텍스트 (상세·표 컨텍스트용)
function StatusChip({ status }: { status: string }) {
  const ex = statusException(status)
  if (ex) return <StatusBadge tone={ex.tone}>{ex.label}</StatusBadge>
  return <span className="text-xs font-medium text-[var(--warm-mid)]">{STATUS_LABEL[status] ?? status}</span>
}

// 카드 표시 항목 — 이용자가 켜고 끌 수 있는 필드 (호실·이름·상태는 항상 표시)
const TENANT_CARD_FIELDS: FieldDef[] = [
  { key: 'contact', label: '연락처' },
  { key: 'payment', label: '월이용료·납부일' },
  { key: 'deposit', label: '보증금·거주기간' },
]
const REG_LABEL: Record<string, string> = {
  NOT_REPORTED: '미신고', REGISTERED: '완료', EXEMPTED: '해당없음',
}
const GENDER_LABEL: Record<string, string> = {
  MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '—',
}
const PT_LABEL: Record<string, string> = { PREPAID: '선납', POSTPAID: '후납' }

// v2.0 §23 — 탭+하위 2단계를 한 줄로 평탄화한 단일 상태 필터(생애주기 전 상태)
// '거주중(living)' = ACTIVE+CHECKOUT_PENDING — 퇴실 예정도 아직 사는 사람이라 거주중에 포함(기본값).
type StatusFilter = 'living' | 'CHECKOUT_PENDING' | 'NON_RESIDENT' | 'RESERVED' | 'TOUR' | 'CANCELLED' | 'past' | 'all'

// ── 헬퍼 ─────────────────────────────────────────────────────────

function toDateInput(d: string | Date | null | undefined): string {
  if (!d) return ''
  return kstYmdStr(new Date(d))
}

// 일시값을 날짜('YYYY-MM-DD') + 시각('HH:mm')으로 분리
function splitDateTime(d: string | Date | null | undefined): { date: string; time: string } {
  if (!d) return { date: '', time: '' }
  const dt = new Date(d)
  const date = kstYmdStr(dt)
  const hh = String(dt.getHours()).padStart(2, '0')
  const mm = String(dt.getMinutes()).padStart(2, '0')
  return { date, time: `${hh}:${mm}` }
}


function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—'
  const dt = new Date(d)
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const hh = dt.getHours()
  const mm = dt.getMinutes()
  const ampm = hh < 12 ? '오전' : '오후'
  const hh12 = hh === 0 ? 12 : hh > 12 ? hh - 12 : hh
  return `${dt.getFullYear()}년 ${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]}) ${ampm} ${hh12}:${String(mm).padStart(2, '0')}`
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
  today?: string,            // 'YYYY-MM-DD'(서버 KST 기준) — SSR/클라 동일값으로 하이드레이션 불일치(#418) 방지
): string {
  if (!moveInDate) return '—'
  const start  = new Date(moveInDate)
  const end    = endDate ? new Date(endDate) : (today ? new Date(today) : new Date())
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

function fmtDDay(date: string | Date | null | undefined, today?: string): string | null {
  if (!date) return null
  // 날짜(YYYY-MM-DD)만으로 일수 차 — Date.UTC 로 계산해 서버(UTC)/클라(KST) 동일 결과(하이드레이션 #418 방지).
  // setHours/getTime 방식은 TZ에 따라 '오늘'이 달라져 D-day 텍스트가 서버≠클라가 됨.
  const ymd = (d: string | Date) => (typeof d === 'string' ? d : d.toISOString()).slice(0, 10)
  const todayStr = today ?? ymd(new Date())
  const [ay, am, ad] = todayStr.split('-').map(Number)
  const [by, bm, bd] = ymd(date).split('-').map(Number)
  const days = Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86400000)
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
    case 'dueDay': {
      const d = l?.dueDay
      if (!d) return 0
      if (d.includes('말')) return 32
      const n = parseInt(d, 10)
      return n >= 30 ? 32 : (isNaN(n) ? 0 : n)
    }
    default: return ''
  }
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
  initialTenants, rooms, targetMonth, today, defaultDeposit, defaultCleaningFee, contactLeadDays = 14, myRole,
}: {
  initialTenants: Tenant[]
  rooms: Room[]
  targetMonth: string
  today: string              // 'YYYY-MM-DD' 서버 KST 기준 — 거주기간·D-day 가 SSR/클라 동일하게(하이드레이션 안전)
  defaultDeposit: number | null
  contactLeadDays?: number
  defaultCleaningFee: number | null
  myRole: string
}) {
  const canEdit = myRole === 'OWNER' || myRole === 'MANAGER'
  const router = useRouter()
  const searchParams = useSearchParams()
  const entityModal = useEntityModal()

  // 퇴실자 클릭 시 Prism의 month를 퇴실월로 자동 세팅 (수납 내역이 그 월 안에 있어야 보임).
  // 일반 입주자는 현재 month 유지.
  const openTenantPrism = (tenant: Tenant) => {
    const lease = tenant.leaseTerms[0]
    if (lease && ['CHECKED_OUT', 'CANCELLED'].includes(lease.status) && lease.moveOutDate) {
      const d = new Date(lease.moveOutDate)
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      if (searchParams.get('month') !== month) {
        const params = new URLSearchParams(searchParams.toString())
        params.set('month', month)
        router.replace(`?${params.toString()}`, { scroll: false })
      }
    }
    entityModal.open({
      kind: 'tenant',
      tenantId: tenant.id,
      leaseTermId: lease?.id ?? undefined,
      roomId: lease?.room?.id ?? undefined,
    })
  }

  const initColVis = Object.fromEntries(
    COL_DEFS.map(c => [c.key, c.defaultOn])
  ) as Record<ColKey, boolean>

  const [showAdd, setShowAdd]             = useState(false)
  const [showNoticeSms, setShowNoticeSms] = useState(false)   // 단체 공지 문자 (R4)
  // v2.0 §12 — 폼 모달 입력 보호(dirty). 입력 시작 후 배경클릭 무시, Esc/X 확인(Modal 내장).
  const [addTenantDirty, setAddTenantDirty] = useState(false)
  const [editTenantDirty, setEditTenantDirty] = useState(false)
  const [detailEditDirty, setDetailEditDirty] = useState(false)
  const [selectMode, setSelectMode]       = useState(false)
  const [selectedIds, setSelectedIds]     = useState<Set<string>>(new Set())
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  const toggleSelectTenant = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
  const press = useLongPress()      // 데스크톱 행 꾹 눌러 선택 진입 (v2.0 §23 공통 제스처, 카드는 RoomCard 내장)
  const [editTenant, setEditTenant]       = useState<Tenant | null>(null)
  const [detailTenant, setDetailTenant]   = useState<Tenant | null>(null)
  const [detailEditMode, setDetailEditMode] = useState(false)
  const [roomDetailId, setRoomDetailId]   = useState<string | null>(null)
  const [error, setError]               = useState('')
  const [depositRefundModal, setDepositRefundModal] = useState<{ fd: FormData; tenantName: string; depositAmount: number; cleaningFee: number; fromDetail: boolean; leaseTermId: string; tenantId: string } | null>(null)
  const [depositReturnAmt, setDepositReturnAmt] = useState(0)
  const [depositReturnDate, setDepositReturnDate] = useState(() => kstYmdStr())
  const [rentChangeModal, setRentChangeModal] = useState<{ fd: FormData; fromDetail: boolean; roomNo: string; baseRent: number; scheduledRent: number } | null>(null)
  // 단일 상태 필터(탭+하위 평탄화). 선택값 → 생애주기 범주(cat)로 표 열·정렬 구성
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('living')   // 기본 = 거주중(퇴실예정 포함)
  const cat: 'residents' | 'inquiry' | 'dropped' | 'past' =
    statusFilter === 'RESERVED' || statusFilter === 'TOUR' ? 'inquiry'
    : statusFilter === 'CANCELLED' ? 'dropped'
    : statusFilter === 'past' ? 'past'
    : 'residents'
  const [floorFilter, setFloorFilter]   = useState('')
  const [showFilters, setShowFilters]   = useState(false)   // 검색창 옆 필터 토글(정본 §23 호실관리 패턴)
  // 필터 패널 조건들 — 순수 표시 필터(서버 로직 불변). 탭별 유효성은 아래 게이팅 상수가 단일 판정.
  const [natFilter, setNatFilter]           = useState('')
  const [genderFilter, setGenderFilter]     = useState('')
  const [dueDayFilter, setDueDayFilter]     = useState<'' | DueDayBucket>('')
  const [stayFilter, setStayFilter]         = useState('')   // lt1 | m1_6 | m6_12 | y1_2 | y2p
  const [rentMinFilter, setRentMinFilter]   = useState<number | undefined>(undefined)
  const [rentMaxFilter, setRentMaxFilter]   = useState<number | undefined>(undefined)
  const [search, setSearch]             = useUrlState('q', '')
  const [sortKey, setSortKey]           = useState<SortKey>('roomNo')
  const [sortDir, setSortDir]           = useState<SortDir>('asc')
  const [cardFields, toggleCardField]   = useDisplayFields('tenants.cardFields', TENANT_CARD_FIELDS)
  const [colVis, setColVis]             = useState<Record<ColKey, boolean>>(initColVis)
  const [isPending, startTransition]    = useTransition()
  const [colWidths, setColWidths]       = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const colWidthsRef                    = useRef<Record<string, number>>(DEFAULT_WIDTHS)

  // 수납 모달
  const [payTarget, setPayTarget]   = useState<{ tenant: Tenant; lease: LeaseTerm } | null>(null)
  const [payHistory, setPayHistory] = useState<PayRecord[]>([])
  const [distNotice, setDistNotice] = useState<string | null>(null)   // 자동 분배 요약 — 모달 내 지속 표시
  const [payAcquisitionDate, setPayAcquisitionDate] = useState<Date | null>(null)
  const [showPayForm, setShowPayForm] = useState(false)
  const [payAmount, setPayAmount]   = useState(0)
  const [payDateVal, setPayDateVal] = useState(kstYmdStr())
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [showOverrideForm, setShowOverrideForm] = useState(false)
  const [overrideDateInput, setOverrideDateInput] = useState('')
  const [confirmClearOverride, setConfirmClearOverride] = useState(false)
  const [overrideReason, setOverrideReason] = useState('')
  const [editingPayId, setEditingPayId] = useState<string | null>(null)
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')

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

  // URL 파라미터 — /tenants?tenantId=xxx → 셸 열기, &edit=1 → 자체 편집 폼(페이지 종속) 열기.
  // Phase 2.3c (2026-05-30): 상세 팝업은 전역 Prism 셸로 마이그레이션. 편집 폼만 페이지에 잔존.
  //
  // 최초 mount 시(예: /tenants?tenantId=X 딥링크) Prism 자동 오픈은 1회만.
  // Prism 셸의 [수정] 버튼이 ?edit=1 을 추가로 push 하므로, 편집 폼 분기는 별도 useEffect 로 항상 감지.
  // (이전엔 deps=[] 라 mount 후 URL 변화를 못 잡아 [수정] 누르면 Prism 만 닫히고 폼 안 열리는 버그가 있었음 — 2026-05-31)
  const initialOpenRef = useRef(false)
  useEffect(() => {
    if (initialOpenRef.current) return
    const tenantId = searchParams.get('tenantId')
    const edit = searchParams.get('edit')
    if (!tenantId) return
    const found = initialTenants.find(t => t.id === tenantId)
    if (!found) return
    initialOpenRef.current = true
    if (edit === '1') {
      setDetailTenant(found); setDetailEditMode(true)
    } else {
      entityModal.open({
        kind: 'tenant',
        tenantId: found.id,
        leaseTermId: found.leaseTerms[0]?.id ?? undefined,
        roomId: found.leaseTerms[0]?.room?.id ?? undefined,
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ?edit=1 변화 감지 — Prism [수정] 버튼 클릭 시 호출됨.
  // ⚠️ 한 edit 요청(tenantId+edit=1)당 폼을 '한 번만' 연다(handledEditRef). 안 그러면 저장 후
  //   detailEditMode 가 false 로 바뀌는 순간 useEffect 가 재실행돼(아직 URL 에 edit=1 잔존) 폼을
  //   옛 데이터로 다시 여는 레이스 발생 → 깜빡임·2중 팝업·수정 전 내용 표시 (2026-06-05 사용자 보고).
  //   edit 가 사라지면 ref 를 리셋해 다음 [수정] 요청은 정상 처리.
  const handledEditRef = useRef<string | null>(null)
  useEffect(() => {
    const tenantId = searchParams.get('tenantId')
    const edit = searchParams.get('edit')
    if (edit !== '1' || !tenantId) { handledEditRef.current = null; return }
    if (handledEditRef.current === tenantId) return
    const found = initialTenants.find(t => t.id === tenantId)
    if (!found) return
    handledEditRef.current = tenantId
    setDetailTenant(found); setDetailEditMode(true)
  }, [searchParams, initialTenants])

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
    c => (c.tabs as readonly string[]).includes(cat) && colVis[c.key]
  )

  // ── 필터 ────────────────────────────────────────────────────────

  // 패널 필터 게이팅 — 납부일·거주기간은 해당 탭에서만 유효. 렌더·적용·계수·리셋이 이 판정을 공유(유령 필터 방지).
  const dueDayFilterValid = cat === 'residents'
  const stayFilterValid   = cat === 'residents' || cat === 'past'
  // 옵션은 전체 집합 기준 파생(하드코딩 금지 — 존재하는 값만)
  const natOptions    = [...new Set(initialTenants.map(t => t.nationality).filter((v): v is string => !!v))].sort()
  const genderOptions = [...new Set(initialTenants.map(t => t.gender).filter(Boolean))]
  // 거주기간(개월) — 표시 로직(calcStayPeriod)과 동일식·동일 종점(moveOutDate ?? today, SSR 안전)
  const stayMonthsOf = (t: Tenant): number | null => {
    const l = t.leaseTerms[0]
    if (!l?.moveInDate) return null
    const start = new Date(l.moveInDate)
    const end   = l.moveOutDate ? new Date(l.moveOutDate) : new Date(today)
    return (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  }
  const matchStayBucket = (m: number): boolean =>
    stayFilter === 'lt1'   ? m < 1 :
    stayFilter === 'm1_6'  ? m >= 1 && m < 6 :
    stayFilter === 'm6_12' ? m >= 6 && m < 12 :
    stayFilter === 'y1_2'  ? m >= 12 && m < 24 :
    stayFilter === 'y2p'   ? m >= 24 : true
  const activeFilterCount =
    (floorFilter ? 1 : 0) + (natFilter ? 1 : 0) + (genderFilter ? 1 : 0) +
    (dueDayFilterValid && dueDayFilter ? 1 : 0) +
    (stayFilterValid && stayFilter ? 1 : 0) +
    (rentMinFilter != null || rentMaxFilter != null ? 1 : 0)
  const resetFilters = () => {
    setFloorFilter(''); setNatFilter(''); setGenderFilter(''); setDueDayFilter(''); setStayFilter('')
    setRentMinFilter(undefined); setRentMaxFilter(undefined)
  }

  const filtered = initialTenants.filter(t => {
    const status = t.leaseTerms[0]?.status ?? ''

    // 단일 상태 필터 — 생애주기 전 상태를 한 줄로 평탄화
    const isResident = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT'].includes(status)
    const isInquiry  = ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE'].includes(status)
    const isDropped  = status === 'CANCELLED'
    const isPast     = !isResident && !isInquiry && !isDropped   // 퇴실·종료
    const matchStatus =
      statusFilter === 'all'    ? true :
      statusFilter === 'living' ? ['ACTIVE', 'CHECKOUT_PENDING'].includes(status) :   // 거주중 = 거주중+퇴실예정
      statusFilter === 'TOUR'   ? ['WAITING_TOUR', 'TOUR_DONE'].includes(status) :
      statusFilter === 'past'   ? isPast :
      status === statusFilter   // CHECKOUT_PENDING/NON_RESIDENT/RESERVED/CANCELLED
    if (!matchStatus) return false

    // 층 필터
    if (floorFilter && getTenantFloor(t) !== floorFilter) return false

    // 패널 필터 — 매칭 불가 값(계약·입주일 없음 등)은 필터 설정 시 제외(정본 면적 필터와 동일 규칙)
    if (natFilter && t.nationality !== natFilter) return false
    if (genderFilter && t.gender !== genderFilter) return false
    if (dueDayFilterValid && dueDayFilter) {
      // 날짜형(일회성 지정)은 월 컨텍스트가 없어 제외 — 정기 납부일만 매칭
      if (dueDayBucketOf(t.leaseTerms[0]?.dueDay) !== dueDayFilter) return false
    }
    if (stayFilterValid && stayFilter) {
      const m = stayMonthsOf(t)
      if (m == null || !matchStayBucket(m)) return false
    }
    if (rentMinFilter != null || rentMaxFilter != null) {
      const rent = t.leaseTerms[0]?.rentAmount
      if (rent == null) return false
      if (rentMinFilter != null && rent < rentMinFilter) return false
      if (rentMaxFilter != null && rent > rentMaxFilter) return false
    }

    // 검색
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const qDigits = q.replace(/[^0-9]/g, '')   // 전화번호 검색 — 하이픈·공백 무관 숫자 비교
    return (
      t.name.toLowerCase().includes(q) ||
      (t.englishName?.toLowerCase().includes(q) ?? false) ||
      (t.leaseTerms[0]?.room?.roomNo ?? '').includes(q) ||
      (STATUS_LABEL[status] ?? '').includes(q) ||
      (t.nationality?.toLowerCase().includes(q) ?? false) ||
      (t.job?.toLowerCase().includes(q) ?? false) ||
      (qDigits.length >= 2 && t.contacts.some(c => c.contactValue.replace(/[^0-9]/g, '').includes(qDigits)))
    )
  })

  // inquiryAt 보조 정렬 (오래된 순 = 오래 기다린 순). 없으면 createdAt fallback. asc 고정.
  const inquiryTime = (t: Tenant): number => {
    const l = t.leaseTerms[0]
    const inq = l?.inquiryAt
    if (inq) return new Date(inq).getTime()
    const c = (l as any)?.createdAt
    return c ? new Date(c).getTime() : Infinity
  }
  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1

    // 호실순: 미배정자(호실 없음)는 항상 하단, 미배정 내에서는 inquiryAt asc 고정
    if (sortKey === 'roomNo') {
      const ra = a.leaseTerms[0]?.room?.roomNo ?? ''
      const rb = b.leaseTerms[0]?.room?.roomNo ?? ''
      const aHas = !!ra
      const bHas = !!rb
      if (aHas !== bHas) return aHas ? -1 : 1   // 배정된 사람 위로 (sortDir 무관)
      if (!aHas) return inquiryTime(a) - inquiryTime(b)  // 미배정 그룹은 문의 오래된 순
      return dir * ra.localeCompare(rb, 'ko', { numeric: true })
    }

    // 상태순: 같은 상태 내에서는 inquiryAt asc로 보조 정렬
    if (sortKey === 'status') {
      const sa = a.leaseTerms[0]?.status ?? ''
      const sb = b.leaseTerms[0]?.status ?? ''
      if (sa !== sb) return dir * sa.localeCompare(sb, 'ko', { numeric: true })
      return inquiryTime(a) - inquiryTime(b)
    }

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
    setDetailTenant(prev => {
      if (!prev) return prev
      const updated = initialTenants.find(t => t.id === prev.id)
      return updated ?? prev
    })
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
      const res = await withSave(() => addTenant(fd), { success: '입주자 등록됨' })
      if (!res.ok) { setError(res.error); return }
      setShowAdd(false); refresh()
    })
  }

  const openDepositRefundModal = (fd: FormData, fromDetail: boolean) => {
    const tenantName    = fd.get('name') as string || '입주자'
    const depositAmount = Number(fd.get('depositAmount')) || 0
    const cleaningFee   = Number(fd.get('cleaningFee')) || 0
    const leaseTermId   = (fd.get('leaseTermId') as string) || ''
    const tenantId      = (fd.get('id') as string) || ''
    // 환불 가능 max = 보증금 - 청소비 (default도 동일)
    const maxRefund = Math.max(0, depositAmount - cleaningFee)
    setDepositReturnAmt(maxRefund)
    setDepositReturnDate(kstYmdStr())
    setDepositRefundModal({ fd, tenantName, depositAmount, cleaningFee, fromDetail, leaseTermId, tenantId })
  }

  // 거주중→공실 변경 시 호실에 예정 가격이 있으면 가격 변동 팝업 표시
  // 팝업이 떴으면 true 반환(이후 처리는 모달 confirm에서)
  const tryOpenRentChangeModal = (fd: FormData, fromDetail: boolean): boolean => {
    const status = fd.get('status') as string
    const roomId = fd.get('roomId') as string
    if (status !== 'CHECKED_OUT' && status !== 'CANCELLED') return false
    if (!roomId) return false
    const room = rooms.find(r => r.id === roomId)
    if (!room || room.scheduledRent == null) return false
    setRentChangeModal({
      fd, fromDetail,
      roomNo: room.roomNo,
      baseRent: room.baseRent,
      scheduledRent: room.scheduledRent,
    })
    return true
  }

  // URL ?edit=1·?tenantId 정리 — 안 지우면 저장/새로고침 후 edit 감지 useEffect 가 폼을 다시 염(깜빡·유지 버그).
  const clearTenantUrlParams = () => {
    if (searchParams.get('edit') === '1' || searchParams.get('tenantId')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('edit'); params.delete('tenantId')
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    }
  }

  // 보증금 환불 또는 즉시 업데이트로 진행 (가격 모달 처리 이후 호출)
  const proceedAfterRentDecision = (fd: FormData, fromDetail: boolean) => {
    const status        = fd.get('status') as string
    const depositAmount = Number(fd.get('depositAmount')) || 0
    if (status === 'CHECKED_OUT' && depositAmount > 0) {
      openDepositRefundModal(fd, fromDetail)
      return
    }
    startTransition(async () => {
      const res = await withSave(() => updateTenant(fd), { success: '입주자 정보 수정됨' })
      if (!res.ok) { setError(res.error); return }
      if (res.notice) pushToast('info', res.notice)
      if (fromDetail) { setDetailTenant(null); setDetailEditMode(false); clearTenantUrlParams() }
      else setEditTenant(null)
      refresh()
    })
  }

  // 단기 연장 정리 — 퇴실 예정 상태 그대로 퇴실일만 미래로 바꾸면 거주중 복귀를 확인(자동 전환 연장 흐름, 2026-07-11)
  const maybeConfirmExtension = async (fd: FormData): Promise<void> => {
    const prevStatus = fd.get('prevStatus') as string | null
    const newStatus = fd.get('status') as string | null
    const prevOut = (fd.get('prevExpectedMoveOut') as string | null) ?? ''
    const newOut = (fd.get('expectedMoveOut') as string | null) ?? ''
    if (prevStatus !== 'CHECKOUT_PENDING' || newStatus !== 'CHECKOUT_PENDING') return
    if (!newOut || newOut === prevOut) return
    if (newOut <= kstYmdStr()) return
    const revert = await confirmDialog({
      title: '퇴실일이 미래로 변경됐습니다',
      message: '연장이라면 상태를 거주중으로 되돌리는 것을 권합니다. 되돌리면 새 퇴실일 하루 전에 다시 퇴실 예정으로 자동 전환됩니다(단기).',
      confirmLabel: '거주중으로 변경', cancelLabel: '퇴실 예정 유지',
    })
    if (revert) fd.set('status', 'ACTIVE')
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    await maybeConfirmExtension(fd)
    if (tryOpenRentChangeModal(fd, false)) return
    proceedAfterRentDecision(fd, false)
  }

  // 상세 모달 내 편집 저장
  const handleUpdateFromDetail = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const fd = new FormData(e.currentTarget)
    await maybeConfirmExtension(fd)
    if (tryOpenRentChangeModal(fd, true)) return
    proceedAfterRentDecision(fd, true)
  }

  const handleRentChangeChoice = (apply: boolean) => {
    if (!rentChangeModal) return
    const { fd, fromDetail } = rentChangeModal
    fd.set('applyScheduledRent', apply ? '1' : '0')
    setRentChangeModal(null)
    proceedAfterRentDecision(fd, fromDetail)
  }


  const handleDepositRefundConfirm = () => {
    if (!depositRefundModal) return
    const { fd, tenantName, depositAmount, fromDetail, leaseTermId, tenantId } = depositRefundModal
    startTransition(async () => {
      const release = trackSave()
      try {
        const refundRes = await recordDepositReturn({
          leaseTermId,
          tenantId,
          depositAmount,
          returnedAmount: depositReturnAmt,
          date: depositReturnDate,
          tenantName,
        })
        if (!refundRes.ok) { setError(refundRes.error); pushToast('error', refundRes.error); return }
        const updateRes = await updateTenant(fd)
        if (!updateRes.ok) { setError(updateRes.error); pushToast('error', updateRes.error); return }
        if (updateRes.notice) pushToast('info', updateRes.notice)
        setDepositRefundModal(null)
        if (fromDetail) { setDetailTenant(null); setDetailEditMode(false); clearTenantUrlParams() }
        else setEditTenant(null)
        refresh()
        const { refundId, extraIncomeId } = refundRes
        pushToast('success', '보증금 환불 + 퇴실 처리됨', {
          action: { label: '반환기록 취소', run: () => { void undoDepositReturn(refundId, extraIncomeId).then(r => { if (r.ok) { pushToast('info', '보증금 반환 기록을 지웠습니다 (퇴실 상태는 유지 — 필요 시 상태 변경으로 복구)'); refresh() } else pushToast('error', r.error) }) } },
        })
      } finally { release() }
    })
  }

  const openPayModal = async (tenant: Tenant, lease: LeaseTerm) => {
    setPayTarget({ tenant, lease })
    setPayAmount(lease.rentAmount)
    setPayDateVal(kstYmdStr())
    setIsDepositMode(false)
    setShowPayForm(false)
    setError('')
    setDistNotice(null)
    const { records, acquisitionDate } = await getPaymentsByLease(lease.id, targetMonth)
    setPayHistory(records as PayRecord[])
    setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
  }

  const closePayModal = () => {
    setPayTarget(null); setPayHistory([]); setShowPayForm(false); setError(''); setDistNotice(null)
    setShowOverrideForm(false); setOverrideDateInput(''); setOverrideReason(''); setConfirmClearOverride(false)
    setIsDepositMode(false); setPayDateVal(kstYmdStr())
  }

  const handleSavePayment = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    if (!payTarget) return
    const fd = new FormData(e.currentTarget)
    const payMethod = fd.get('payMethod') as string
    const memo = fd.get('memo') as string
    const cashReceiptIssued = fd.get('cashReceipt') === 'on'   // 현금영수증 발행 표시(오류신고 2bd8befa)
    startTransition(async () => {
      const release = trackSave()
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
            cashReceiptIssued,
          })
        } else {
          const result = await savePayment({
            leaseTermId:    payTarget.lease.id,
            tenantId:       payTarget.tenant.id,
            targetMonth,
            expectedAmount: payTarget.lease.rentAmount,
            actualAmount:   payAmount,
            payDate:        payDateVal,
            payMethod,
            memo,
            cashReceiptIssued,
          })
          const otherMonths = result.allocations.length > 0
            ? result.allocations.filter(a => a.targetMonth !== result.inputMonth)
            : []
          if (otherMonths.length > 0) {
            const summary = otherMonths
              .map(a => `${Number(a.targetMonth.slice(5))}월분 ${fmtWon(a.amount)}`)
              .join(', ')
            setDistNotice(`이번 입력은 ${summary}으로 나뉘어 반영되었습니다. 미수가 가장 오래된 월부터 충당됩니다.`)
          } else {
            setDistNotice(null)
          }
        }
        setShowPayForm(false)
        const { records } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records as PayRecord[])
        refresh()
        pushToast('success', isDepositMode ? '보증금 수납됨' : '월 이용료 수납됨')
      } catch (err: unknown) {
        const msg = (err as Error).message
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  const handleDeletePayRecord = async (paymentId: string) => {
    if (!(await confirmDialog({ title: '이 수납 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      const res = await withSave(() => deletePayment(paymentId), { success: '수납 기록 삭제됨' })
      if (!res.ok) { setError(res.error); return }
      if (payTarget) {
        const { records } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records as PayRecord[])
      }
      refresh()
    })
  }

  const handleUpdatePayRecord = (p: PayRecord) => {
    setEditingPayId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
  }

  const handleSaveEdit = async () => {
    if (!editingPayId) return
    startTransition(async () => {
      const res = await withSave(() => updatePayment(editingPayId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
      }), { success: '수납 기록 수정됨' })
      if (!res.ok) { setError(res.error); return }
      if (payTarget) {
        const { records, acquisitionDate } = await getPaymentsByLease(payTarget.lease.id, targetMonth)
        setPayHistory(records as PayRecord[])
        setPayAcquisitionDate(acquisitionDate ? new Date(acquisitionDate) : null)
      }
      setEditingPayId(null)
      refresh()
    })
  }

  const handleDelete = async (tenantId: string, name: string) => {
    const id = tenantId
    const ok = await confirmDialog({
      title: `${name}님을 완전 삭제할까요?`,
      message: '수납 기록, 계약 이력, 연락처 등 모든 데이터가 영구적으로 삭제되며 복구할 수 없습니다. 거주중이었다면 해당 호실은 공실로 전환됩니다.',
      level: 'danger',
      confirmLabel: '영구 삭제',
    })
    if (!ok) return
    startTransition(async () => {
      const res = await withSave(() => deleteTenant(id), { success: `${name}님 삭제됨`, silentError: true })
      // 계약·수납 이력 — 건수를 보여주는 영향 고지형 다이얼로그(v2.0 §14) 동의 후에만 영구 삭제
      if (!res.ok && res.needsForce) {
        const force = await confirmDialog({
          title: `${name}님 기록을 영구 삭제할까요?`,
          message: '매출 통계·과거 조회에서도 함께 사라집니다.',
          level: 'danger', confirmLabel: '영구 삭제',
          impact: [
            { label: '계약', count: res.leases ?? 0 },
            { label: '수납 기록', count: res.payments ?? 0 },
          ],
        })
        if (!force) return
        const res2 = await withSave(() => deleteTenant(id, { force: true }), { success: `${name}님 삭제됨` })
        if (!res2.ok) { setError(res2.error); return }
        setDetailTenant(null); refresh()
        return
      }
      if (!res.ok) { pushToast('error', res.error); return }
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

  const statusOf = (t: typeof initialTenants[0]) => t.leaseTerms[0]?.status ?? ''
  const cntBy = (pred: (s: string) => boolean) => initialTenants.filter(t => pred(statusOf(t))).length
  const countAll       = initialTenants.length
  const countCheckout  = cntBy(s => s === 'CHECKOUT_PENDING')
  const countLiving    = cntBy(s => ['ACTIVE', 'CHECKOUT_PENDING'].includes(s))   // 거주중 = 거주중+퇴실예정
  const countNonRes    = cntBy(s => s === 'NON_RESIDENT')
  const countReserved  = cntBy(s => s === 'RESERVED')
  const countTour      = cntBy(s => ['WAITING_TOUR', 'TOUR_DONE'].includes(s))
  const countCancelled = cntBy(s => s === 'CANCELLED')
  const countPast      = countAll - countLiving - countNonRes - countReserved - countTour - countCancelled

  // function 선언 — 호이스팅되어 위쪽 필터(.filter, 478번 줄)에서도 TDZ 없이 안전하게 호출됨
  function getTenantFloor(t: typeof initialTenants[0]) {
    const room = t.leaseTerms[0]?.room
    if (!room) return ''
    if (room.floor) return room.floor
    const n = room.roomNo.replace(/[^0-9]/g, '')
    return n.length >= 3 ? n.slice(0, n.length - 2) : ''
  }
  const allFloors = [...new Set(initialTenants.map(t => getTenantFloor(t)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {showNoticeSms && <NoticeSmsModal onClose={() => setShowNoticeSms(false)} />}

      {/* 헤더 */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">입주자 관리</h1>
        {/* 뷰어(STAFF)에게는 편집 진입 숨김 — 서버 requireEdit가 최종 방어(감사 D3) */}
        {canEdit && (
        <div className="flex items-center gap-2">
          <Btn type="button" variant="secondary" size="md" onClick={() => setShowNoticeSms(true)}>
            단체 문자
          </Btn>
          <Btn type="button" variant="secondary" size="md"
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
            {selectMode ? '선택 취소' : '선택'}
          </Btn>
          <Btn variant="primary" size="md"
            onClick={() => { setAddTenantDirty(false); setShowAdd(true); setError('') }}>
            + 입주자 등록
          </Btn>
        </div>
        )}
      </div>

      {/* 검색바 + 필터 토글 — v2.0 §23 정본(호실관리) 패턴. 스크롤 시 상단 고정(운영자 지시 2026-07-13) */}
      <div className="flex gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={search} onChange={setSearch} placeholder="이름, 호실, 전화번호, 국적, 직업 검색" className="flex-1" />
        <button type="button" onClick={() => setShowFilters(v => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
            showFilters || activeFilterCount > 0
              ? 'bg-[var(--coral)] text-[var(--on-solid)]'
              : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
          }`}>
          필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

      {/* 접이식 필터 패널 — §23 정본 문법(grid-cols-2·label 12px). 납부일·거주기간은 유효 탭에서만 렌더 */}
      {showFilters && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {allFloors.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <select value={floorFilter} onChange={e => setFloorFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체 층</option>
                  {allFloors.map(f => <option key={f} value={f}>{f}층</option>)}
                </select>
              </div>
            )}
            {natOptions.length > 0 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
                <select value={natFilter} onChange={e => setNatFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {natOptions.map(n => <option key={n} value={n}>{n}</option>)}
                </select>
              </div>
            )}
            {genderOptions.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">성별</label>
                <select value={genderFilter} onChange={e => setGenderFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {genderOptions.map(g => <option key={g} value={g}>{GENDER_LABEL[g] ?? g}</option>)}
                </select>
              </div>
            )}
            {dueDayFilterValid && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
                <select value={dueDayFilter} onChange={e => setDueDayFilter(e.target.value as '' | DueDayBucket)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {DUE_DAY_BUCKET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
            {stayFilterValid && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">거주기간</label>
                <select value={stayFilter} onChange={e => setStayFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  <option value="lt1">1개월 미만</option>
                  <option value="m1_6">1~6개월</option>
                  <option value="m6_12">6개월~1년</option>
                  <option value="y1_2">1~2년</option>
                  <option value="y2p">2년 이상</option>
                </select>
              </div>
            )}
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료 범위 (원)</label>
            <div className="flex items-center gap-2">
              <MoneyInput value={rentMinFilter} onChange={v => setRentMinFilter(v && v > 0 ? v : undefined)} placeholder="최소" />
              <span className="text-[var(--warm-muted)] text-sm">~</span>
              <MoneyInput value={rentMaxFilter} onChange={v => setRentMaxFilter(v && v > 0 ? v : undefined)} placeholder="최대" />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Btn type="button" variant="secondary" size="sm" className="flex-1" onClick={resetFilters}>초기화</Btn>
            <Btn type="button" variant="primary" size="sm" className="flex-1" onClick={() => setShowFilters(false)}>닫기</Btn>
          </div>
        </div>
      )}

      {/* 상태 필터 — v2.0 §23 단일 SegmentedControl(탭+하위 2단계를 생애주기 한 줄로 평탄화) */}
      <div className="flex gap-2 flex-wrap items-center">
        <SegmentedControl
          size="md"
          scroll
          ariaLabel="고객 상태 필터"
          value={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: 'living',           label: `거주중 ${countLiving} (퇴실예정 포함)` },
            { value: 'CHECKOUT_PENDING', label: `퇴실 예정 ${countCheckout}` },
            { value: 'NON_RESIDENT',     label: `비거주자 ${countNonRes}` },
            { value: 'RESERVED',         label: `예약 ${countReserved}` },
            { value: 'TOUR',             label: `투어 ${countTour}` },
            { value: 'CANCELLED',        label: `입실취소 ${countCancelled}` },
            { value: 'past',             label: `퇴실 ${countPast}` },
            { value: 'all',              label: `전체 ${countAll}` },
          ]}
        />

        {/* 구분선 */}
        <div className="flex-1" />

        {/* 표시 항목 — 데스크탑 표 열. v2.0 §23 공용 DisplayFieldsMenu(다른 페이지와 동일) */}
        <DisplayFieldsMenu
          className="hidden sm:block"
          fields={COL_DEFS.filter(c => (c.tabs as readonly string[]).includes(cat))}
          visible={colVis as Record<string, boolean>}
          onToggle={k => updateColVis(k as ColKey, !colVis[k as ColKey])}
          heading="표에 표시할 항목"
        />
      </div>

      {/* 모바일 검색바는 상단 공용 SearchBar(전 사이즈)로 통일 — 중복 제거 */}

      {/* 모바일 정렬 + 표시 항목 */}
      <div className="sm:hidden flex items-center justify-between gap-2">
        <SortSelect<SortKey>
          ariaLabel="입주자 정렬 기준"
          value={sortKey}
          dir={sortDir}
          onChange={sk => { setSortKey(sk); setSortDir('asc') }}
          onToggleDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          options={[
            { value: 'status',        label: '상태' },
            { value: 'roomNo',        label: '호실순' },
            { value: 'name',          label: '이름' },
            { value: 'rentAmount',    label: '이용료' },
            { value: 'depositAmount', label: '보증금' },
            { value: 'dueDay',        label: '납부일' },
            { value: 'stayPeriod',    label: '거주기간' },
            { value: 'moveInDate',    label: '입실일' },
          ]}
        />
        <DisplayFieldsMenu fields={TENANT_CARD_FIELDS} visible={cardFields} onToggle={toggleCardField} />
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-xl p-3">
          <p className="text-[var(--danger-fg)] text-sm">{error}</p>
        </div>
      )}


      {/* 보증금 환불 모달 — 대시보드 알림 퇴실 처리와 동일 UI */}
      {depositRefundModal && (() => {
        const dep = depositRefundModal.depositAmount
        const fee = depositRefundModal.cleaningFee
        const maxRefund = Math.max(0, dep - fee)
        const unreturned = dep - depositReturnAmt
        const exceedsMax = depositReturnAmt > maxRefund
        return (
          <Modal open z={260} width="sm" dirty
            onClose={() => setDepositRefundModal(null)}
            title="보증금 환불" subtitle={`${depositRefundModal.tenantName}님 퇴실 정산`}>

              <div className="px-5 py-4 space-y-3">
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div className="bg-[var(--canvas)] rounded-lg px-3 py-2">
                    <p className="text-[var(--warm-muted)]">보증금</p>
                    <p className="text-sm font-semibold mt-0.5 text-[var(--warm-dark)]">{fmtWon(dep)}</p>
                  </div>
                  <div className="bg-[var(--canvas)] rounded-lg px-3 py-2">
                    <p className="text-[var(--warm-muted)]">청소비 차감</p>
                    <p className={`text-sm font-semibold mt-0.5 ${fee > 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-mid)]'}`}>
                      {fee > 0 ? `−${fmtWon(fee)}` : '없음'}
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">
                      환불 금액 (최대 {fmtWon(maxRefund)})
                    </label>
                    {/* 퇴실 전이 미니폼과 동일한 빠른 버튼 — 두 경로의 문법 통일(신규유저 감사) */}
                    <button type="button" onClick={() => setDepositReturnAmt(0)}
                      className={`shrink-0 text-[0.65625rem] px-2 py-1 rounded-md border transition-colors ${
                        depositReturnAmt === 0
                          ? 'border-[var(--coral)] text-[var(--coral)] bg-[var(--coral)]/10'
                          : 'border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40'
                      }`}>
                      환불 안 함
                    </button>
                  </div>
                  <MoneyInput value={depositReturnAmt} onChange={setDepositReturnAmt} placeholder="0원" />
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">환불하지 않은 금액은 보증금 수익으로 자동 기록됩니다.</p>
                  {exceedsMax && (
                    <p className="text-[0.6875rem] text-[var(--danger-fg)]">환불 금액은 최대 {fmtWon(maxRefund)}입니다.</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-[var(--warm-mid)]">반환일</label>
                  <DatePicker value={depositReturnDate} onChange={setDepositReturnDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                </div>

                <div className="rounded-lg px-3 py-2.5 text-xs space-y-1" style={{ background: 'color-mix(in srgb, var(--coral) 8%, transparent)', color: 'var(--warm-dark)' }}>
                  <div className="flex justify-between">
                    <span className="text-[var(--warm-muted)]">환불</span>
                    <span className="font-medium">{fmtWon(depositReturnAmt)}</span>
                  </div>
                  {unreturned > 0 && (
                    <div className="flex justify-between">
                      <span className="text-[var(--warm-muted)]">부가수익 귀속 (보증금)</span>
                      <span className="font-medium">{fmtWon(unreturned)}</span>
                    </div>
                  )}
                  <p className="text-[0.65625rem] pt-1 text-[var(--warm-muted)]">
                    미환불분은 부가수익 카테고리 &apos;보증금&apos; · 입금수단 &apos;보유 보증금&apos;으로 자동 등록됩니다.
                  </p>
                </div>

                {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
              </div>

              <div className="px-5 pb-5 pt-1 flex gap-2">
                <button type="button" onClick={() => setDepositRefundModal(null)} disabled={isPending}
                  className="flex-1 py-2.5 rounded-lg text-sm font-medium border border-[var(--warm-border)] text-[var(--warm-mid)] hover:opacity-70 transition-opacity disabled:opacity-50">
                  취소
                </button>
                <button type="button" onClick={handleDepositRefundConfirm} disabled={isPending || exceedsMax}
                  className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                  style={{ background: 'var(--warning-solid)', color: 'var(--on-solid)' }}>
                  {isPending ? '처리 중…' : '퇴실 처리'}
                </button>
              </div>
          </Modal>
        )
      })()}

      {/* 가격 변동 적용 확인 모달 */}
      {rentChangeModal && (() => {
        const diff = rentChangeModal.scheduledRent - rentChangeModal.baseRent
        const dirLabel = diff > 0 ? '인상' : diff < 0 ? '인하' : '동결'
        const dirColor = diff > 0 ? 'text-[var(--danger-fg)]' : diff < 0 ? 'text-[var(--success-fg)]' : 'text-[var(--warm-dark)]'
        return (
          <Modal open z={280} width="sm" onClose={() => setRentChangeModal(null)}
            title="가격 변동 적용" bodyClassName="p-6 space-y-4">
              <p className="text-sm text-[var(--warm-mid)] leading-relaxed">
                <span className="font-semibold text-[var(--warm-dark)]">{fmtRoomNo(rentChangeModal.roomNo)}</span>가 공실로 변경됩니다. 예정된 가격 변동을 즉시 적용할까요?
              </p>
              <div className="bg-[var(--canvas)] rounded-sm px-3 py-2.5 text-sm flex items-center justify-center gap-2 flex-wrap">
                <span className="text-[var(--warm-muted)]">기존</span>
                <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(rentChangeModal.baseRent)}</span>
                <span className="text-[var(--warm-muted)]" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" width="14" height="14"><path d="M5 12h14M13 6l6 6-6 6"/></svg></span>
                <span className={`font-semibold ${dirColor}`}>{dirLabel} {fmtWon(rentChangeModal.scheduledRent)}</span>
              </div>
              <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
                네: 즉시 적용 (예정일 무시) · 아니오: 변경 예정일에 자동 적용
              </p>
              <div className="flex gap-2 pt-1">
                <Btn type="button" variant="secondary" size="md" disabled={isPending}
                  onClick={() => handleRentChangeChoice(false)} className="flex-1">
                  아니오
                </Btn>
                <Btn type="button" variant="primary" size="md" disabled={isPending}
                  onClick={() => handleRentChangeChoice(true)} className="flex-1">
                  네, 즉시 적용
                </Btn>
              </div>
          </Modal>
        )
      })()}


      {/* 모바일 카드 뷰 — 빈 상태는 v2.0 §17 공용 EmptyState */}
      {sorted.length === 0 ? (
        <EmptyState
          className="sm:hidden"
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" /></svg>}
          title={search.trim() ? '검색 결과가 없습니다' : '고객이 없습니다'}
          description={search.trim() ? '다른 검색어로 시도해 보세요.' : '고객을 등록하면 이곳에 표시됩니다.'}
        />
      ) : (
        <div className="sm:hidden space-y-2">
          {sorted.map(tenant => {
            const lease   = tenant.leaseTerms[0]
            const primary = tenant.contacts.find(c => c.isPrimary) ?? tenant.contacts[0]
            const status  = lease?.status ?? ''
            const stayPeriod = calcStayPeriod(lease?.moveInDate, lease?.moveOutDate ?? undefined, today)
            const tipTone = leaseTipTone(status)
            return (
              <RoomCard key={tenant.id}
                kind={leaseCardKind(status)}
                tipColor={tipTone ? statusTipColor(tipTone) : undefined}
                tipBg={tipTone ? statusRowTint(tipTone) : undefined}
                selected={selectMode && selectedIds.has(tenant.id)}
                onClick={() => selectMode ? toggleSelectTenant(tenant.id) : openTenantPrism(tenant)}
                onLongPress={!selectMode ? () => { setSelectMode(true); toggleSelectTenant(tenant.id) } : undefined}
                className="p-4"
              >
                {/* 첫 줄: 호실(또는 희망 조건/미배정) + 이름 + 상태 */}
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    {lease?.room?.roomNo ? (
                      <>
                        <span className="text-sm font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(lease.room.roomNo)}</span>
                        {lease.room.floor && <span className="text-[0.65625rem] px-1.5 py-0.5 rounded-full bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">{lease.room.floor}층</span>}
                      </>
                    ) : (() => {
                      // 호실 미배정자 — wishRooms > wishConditions > '미배정' 순으로 라벨 결정
                      const wishRoomList = (lease?.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
                      const cond = parseWishConditions(lease?.wishConditions)
                      const condParts: string[] = []
                      if (cond.floor) condParts.push(`${cond.floor}층`)
                      if (cond.windowType) condParts.push(WISH_WINDOW_LABEL[cond.windowType] ?? cond.windowType)
                      if (cond.type) condParts.push(cond.type)
                      if (cond.direction) condParts.push(cond.direction)
                      const minR = cond.minRent ?? 0; const maxR = cond.maxRent ?? 400000
                      if (minR !== 0 || maxR !== 400000) condParts.push(`${(minR/10000).toFixed(0)}~${(maxR/10000).toFixed(0)}만`)
                      let label: string
                      if (wishRoomList.length > 0) {
                        label = `희망 ${wishRoomList[0]}호${wishRoomList.length > 1 ? ` 외 ${wishRoomList.length - 1}` : ''}`
                      } else if (condParts.length > 0) {
                        label = condParts.join('·')
                      } else {
                        label = '미배정'
                      }
                      return (
                        <span className="text-[0.6875rem] px-1.5 py-0.5 rounded-md bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-muted)] font-medium">
                          {label}
                        </span>
                      )
                    })()}
                    <span className="text-sm font-semibold text-[var(--warm-dark)]">{tenant.name}</span>
                  </div>
                  {(() => { const ex = statusException(status); return ex && <StatusBadge tone={ex.tone}>{ex.label}</StatusBadge> })()}
                  {/* 예약 확정자 구분 — 예약금까지 받은 단계라 일반 예약과 다름(운영자 요청 2026-07-15) */}
                  {status === 'RESERVED' && lease?.reservationConfirmedAt && (
                    <span className="text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1.5 py-0.5 whitespace-nowrap">확정</span>
                  )}
                </div>
                {/* 연락처 — 탭하면 바로 전화 */}
                {cardFields.contact && primary && (
                  <a href={`tel:${primary.contactValue.replace(/[^0-9+]/g, '')}`} onClick={e => e.stopPropagation()}
                    className="text-xs text-[var(--coral)] mb-2 inline-block hover:underline underline-offset-2">{formatPhone(primary.contactValue)}</a>
                )}
                {/* 이용료 · 납부일 */}
                {cardFields.payment && (
                  <div className="flex items-center gap-2 text-xs flex-wrap">
                    <span className="text-[var(--warm-muted)]">월이용료</span>
                    <span className="font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={lease?.rentAmount ?? 0} /></span>
                    <span className="text-[var(--warm-border)]">·</span>
                    <span className="text-[var(--warm-muted)]">납부일</span>
                    <span className="font-medium text-[var(--warm-dark)]">{fmtDueDay(lease?.dueDay)}</span>
                    {lease && (
                      <button type="button" onClick={e => { e.stopPropagation(); openPayModal(tenant, lease) }}
                        className="ml-auto shrink-0 inline-flex items-center justify-center min-h-[44px] -my-2 px-3 text-xs font-semibold text-[var(--coral)]">
                        수납
                      </button>
                    )}
                  </div>
                )}
                {/* 보증금 · 거주기간 */}
                {cardFields.deposit && ((lease?.depositAmount ?? 0) > 0 || lease?.moveInDate) && (() => {
                  const isReservation = lease && ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED'].includes(lease.status)
                  return (
                    <div className="flex items-center gap-2 text-xs flex-wrap mt-1">
                      {(lease?.depositAmount ?? 0) > 0 && (
                        <>
                          <span className="text-[var(--warm-muted)]">보증금</span>
                          <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={lease!.depositAmount} /></span>
                        </>
                      )}
                      {(lease?.depositAmount ?? 0) > 0 && lease?.moveInDate && (
                        <span className="text-[var(--warm-border)]">·</span>
                      )}
                      {lease?.moveInDate && (
                        <>
                          <span className="text-[var(--warm-muted)]">{isReservation ? '입주 희망일' : '거주기간'}</span>
                          <span className="font-medium text-[var(--warm-dark)]">{isReservation ? fmtDate(lease.moveInDate) : stayPeriod}</span>
                        </>
                      )}
                    </div>
                  )
                })()}
              </RoomCard>
            )
          })}
        </div>
      )}

      {/* 데스크탑 테이블 — 빈 상태는 v2.0 §17 공용 EmptyState */}
      {sorted.length === 0 ? (
        <EmptyState
          className="hidden sm:block"
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="9" r="4" /><path d="M4 21 C4 16 8 14 12 14 C16 14 20 16 20 21" /></svg>}
          title={search.trim() ? '검색 결과가 없습니다' : '고객이 없습니다'}
          description={search.trim() ? '다른 검색어로 시도해 보세요.' : '고객을 등록하면 이곳에 표시됩니다.'}
        />
      ) : (
        <div className="hidden sm:block relative bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100dvh-310px)]">
          {/* 저장 후 서버 재요청 완료 전 클릭 차단 오버레이 */}
          {(isPending || isRefreshing) && (
            <div className="absolute inset-0 z-40 rounded-xl bg-[var(--cream)]/60 backdrop-blur-[1px] flex items-center justify-center">
              <div className="flex items-center gap-2 text-xs text-[var(--warm-muted)]">
                <svg className="animate-spin w-3.5 h-3.5" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
                </svg>
                업데이트 중…
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
                const tipTone = leaseTipTone(status)

                return (
                  <tr key={tenant.id}
                    onClick={() => selectMode ? toggleSelectTenant(tenant.id) : openTenantPrism(tenant)}
                    {...press(!selectMode ? () => { setSelectMode(true); toggleSelectTenant(tenant.id) } : undefined)}
                    className={`border-b border-[var(--warm-border)]/50 hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:opacity-80 transition-colors cursor-pointer ${selectMode && selectedIds.has(tenant.id) ? 'bg-[var(--coral)]/5 ring-inset ring-1 ring-[var(--coral)]/30' : ''}`}
                  >
                    {/* sticky — 호실 (클릭 시 호실 관리 페이지로) */}
                    <td className="sticky left-0 z-20 bg-[var(--cream)] px-4 py-3 text-sm font-semibold overflow-hidden"
                      style={{ maxWidth: colWidths.roomNo, borderLeft: tipTone ? `3px solid ${statusTipColor(tipTone)}` : undefined }}
                      onClick={e => { e.stopPropagation(); if (lease?.room?.id) setRoomDetailId(lease.room.id) }}>
                      <span className="block truncate text-[var(--coral)] cursor-pointer underline-offset-2 hover:underline">
                        {fmtRoomNo(lease?.room?.roomNo)}
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
                              className={`${tdBase} text-sm text-[var(--warm-dark)] transition-colors ${lease ? 'cursor-pointer hover:text-[var(--coral)]' : ''}`}>
                              {lease ? (
                                <span className="flex items-center gap-1.5 min-w-0">
                                  <span className="truncate underline decoration-dotted decoration-[var(--coral)]/50 underline-offset-2"><MoneyDisplay amount={lease.rentAmount} /></span>
                                  <span className="shrink-0 text-[0.625rem] font-medium text-[var(--coral)]">수납</span>
                                </span>
                              ) : <span className="block truncate">—</span>}
                            </td>
                          )
                        case 'dueDay':
                          return <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}><span className="block truncate">{fmtDueDay(lease?.dueDay)}</span></td>
                        case 'stayPeriod':
                          return (
                            <td key={c.key} className={`${tdBase} text-sm text-[var(--warm-mid)]`}>
                              <span className="block truncate">{calcStayPeriod(lease?.moveInDate, lease?.moveOutDate ?? undefined, today)}</span>
                            </td>
                          )
                        case 'status': {
                          const ddLabel = sched ? fmtDDay(sched.date, today) : null
                          const ddColor = sched?.label === '입실' ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'
                          return (
                            <td key={c.key} className={tdBase}>
                              <div className="flex flex-col gap-0.5">
                                <span className="self-start"><StatusChip status={status} /></span>
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

      {/* 편집 폼 모달 — 페이지 종속 (상세 팝업은 전역 Prism 셸이 담당, Phase 2.3c) */}
      {detailTenant && detailEditMode && (() => {
        const t = detailTenant
        const closeEdit = () => {
          setDetailEditMode(false); setDetailTenant(null); setError('')
          clearTenantUrlParams()
        }
        return (
          <Modal open z={260} width="lg" dirty={detailEditDirty}
            onClose={() => { setDetailEditDirty(false); closeEdit() }}
            title={`고객 정보 수정 · ${t.name}`}>
              <form key={t.id} onSubmit={handleUpdateFromDetail} className="flex flex-col flex-1 overflow-hidden"
                onInput={() => requestAnimationFrame(() => setDetailEditDirty(true))} onChange={() => setDetailEditDirty(true)}>
                <input type="hidden" name="tenantId"    value={t.id} />
                <input type="hidden" name="leaseTermId" value={t.leaseTerms[0]?.id ?? ''} />
                <div className="overflow-y-auto p-6 space-y-4 flex-1">
                  <TenantForm rooms={rooms} tenant={t} error={error} contactLeadDays={contactLeadDays} />
                </div>
                <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                  <Btn type="button" variant="secondary" size="md" onClick={closeEdit} className="flex-1">취소</Btn>
                  <Btn type="submit" variant="primary" size="md" disabled={isPending} className="flex-1">
                    {isPending ? '저장 중…' : '저장'}
                  </Btn>
                </div>
              </form>
          </Modal>
        )
      })()}


      {/* ── 배치 편집 모달 ─────────────────────────────────────────── */}
      {showBatchEdit && (
        <BatchEditTenantsModal
          selectedIds={Array.from(selectedIds)}
          onClose={() => setShowBatchEdit(false)}
          onDone={() => { setShowBatchEdit(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 배치 액션 바 — v2.0 §22 공용 SelectionPillBar */}

      {selectMode && selectedIds.size > 0 && (
        <SelectionPillBar count={selectedIds.size} unit="명" onClose={exitSelectMode}>
          <PillButton primary onClick={() => setShowBatchEdit(true)}>일괄 편집</PillButton>
        </SelectionPillBar>
      )}

      {/* ── 입주자 추가 모달 ────────────────────────────────────────── */}
      {showAdd && (
        <Modal open width="lg" dirty={addTenantDirty}
          onClose={() => { setShowAdd(false); setAddTenantDirty(false) }} title="입주자 등록">
            <form onSubmit={handleAdd} className="overflow-y-auto p-6 space-y-4"
              onInput={() => requestAnimationFrame(() => setAddTenantDirty(true))} onChange={() => setAddTenantDirty(true)}>
              <TenantForm rooms={rooms} error={error} defaultDeposit={defaultDeposit} defaultCleaningFee={defaultCleaningFee} contactLeadDays={contactLeadDays} />
              <div className="flex gap-2 pt-2">
                <Btn type="button" variant="secondary" size="md" onClick={() => setShowAdd(false)}
                  className="flex-1">
                  취소
                </Btn>
                <Btn type="submit" variant="primary" size="md" disabled={isPending}
                  className="flex-1">
                  {isPending ? '저장 중…' : '저장'}
                </Btn>
              </div>
            </form>
        </Modal>
      )}

      {/* ── 입주자 수정 모달 ────────────────────────────────────────── */}
      {editTenant && (
        <Modal open width="lg" dirty={editTenantDirty}
          onClose={() => { setEditTenant(null); setEditTenantDirty(false) }}
          title={`수정 · ${editTenant.name}`}>
            <form key={editTenant.id} onSubmit={handleUpdate} className="overflow-y-auto p-6 space-y-4"
              onInput={() => requestAnimationFrame(() => setEditTenantDirty(true))} onChange={() => setEditTenantDirty(true)}>
              <input type="hidden" name="tenantId"    value={editTenant.id} />
              <input type="hidden" name="leaseTermId" value={editTenant.leaseTerms[0]?.id ?? ''} />
              <TenantForm rooms={rooms} tenant={editTenant} error={error} contactLeadDays={contactLeadDays} />
              <div className="flex gap-2 pt-2">
                <Btn type="button" variant="secondary" size="md" onClick={() => setEditTenant(null)}
                  className="flex-1">
                  취소
                </Btn>
                <Btn type="submit" variant="primary" size="md" disabled={isPending}
                  className="flex-1">
                  {isPending ? '저장 중…' : '저장'}
                </Btn>
              </div>
            </form>
        </Modal>
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
          <Modal open width="md" onClose={closePayModal} dirty={showPayForm}
            title={`${lease.room?.roomNo ? `${fmtRoomNo(lease.room.roomNo)} — ` : ''}${tenant.name}`}
            subtitle={`${targetMonth} · 예정 ${fmtWon(lease.rentAmount)}`}>

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
                          <p className="text-[0.65625rem] mt-0.5 font-medium"
                            style={{ color: adjNet > 0 ? 'var(--success-fg)' : 'var(--danger-fg)' }}>
                            조정 {adjNet > 0 ? '+' : ''}{fmtWon(adjNet)}
                          </p>
                        )}
                      </div>
                      <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                        <p className="text-xs text-[var(--warm-muted)]">잔액</p>
                        <p className={`text-sm font-bold mt-0.5 ${balance >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
                          {balance > 0
                            ? <MoneyDisplay amount={balance} prefix="+" />
                            : balance < 0
                              ? <MoneyDisplay amount={Math.abs(balance)} prefix="-" />
                              : '0원'}
                        </p>
                      </div>
                    </div>
                    {prevOwnerPaid > 0 && (
                      <div className="flex items-center justify-between bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2">
                        <p className="text-xs text-[var(--info-fg)]">양도인 귀속 (인수일 이전 납부)</p>
                        <p className="text-xs font-semibold text-[var(--info-fg)]">{fmtWon(prevOwnerPaid)}</p>
                      </div>
                    )}

                    {/* 자동 분배 요약 — 저장 후 모달 안에 지속 표시(닫을 때까지). 여러 달에 걸쳐 충당·이월된 내역 확인용 */}
                    {distNotice && (
                      <div className="flex items-start gap-2 bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2.5">
                        <p className="text-xs font-medium text-[var(--info-fg)] leading-relaxed">{distNotice}</p>
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
                            <div key={p.id} className="flex items-center justify-between rounded-sm px-3 py-2.5"
                              style={{
                                background: isExtra ? 'var(--danger-bg)' : 'var(--success-bg)',
                                border: `1px solid ${isExtra ? 'var(--danger-ring)' : 'var(--success-ring)'}`,
                              }}>
                              <div>
                                <p className="text-xs font-semibold"
                                  style={{ color: isExtra ? 'var(--danger-fg)' : 'var(--success-fg)' }}>
                                  {isExtra ? '추가납부 필요' : '과입금 처리'}
                                </p>
                                {label && (
                                  <p className="text-[0.65625rem] mt-0.5" style={{ color: 'var(--warm-muted)' }}>{label}</p>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold"
                                  style={{ color: isExtra ? 'var(--danger-fg)' : 'var(--success-fg)' }}>
                                  {isExtra ? '-' : '+'}{fmtWon(absAmt)}
                                </span>
                                <button onClick={() => handleDeletePayRecord(p.id)}
                                  className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">삭제</button>
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
                        {depositRecords.map(p => {
                          if (editingPayId === p.id) {
                            return (
                              <div key={p.id} className="rounded-xl border border-[var(--deposit-ring)] bg-[var(--deposit-bg)] px-3 py-2.5 space-y-2">
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className="text-[0.65625rem] text-[var(--deposit-fg)]">금액</p>
                                    <input type="text" inputMode="numeric"
                                      value={editAmount.toLocaleString()}
                                      onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className="text-[0.65625rem] text-[var(--deposit-fg)]">납부일</p>
                                    <DatePicker value={editDate} onChange={setEditDate}
                                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                                  </div>
                                </div>
                                <div className="space-y-1">
                                  <p className="text-[0.65625rem] text-[var(--deposit-fg)]">납부방법</p>
                                  <input type="text" value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                                    placeholder="계좌이체, 현금…"
                                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <button onClick={() => setEditingPayId(null)}
                                    className="text-xs text-[var(--deposit-fg)] hover:text-[var(--deposit-fg)] px-3 py-1.5 rounded-lg border border-[var(--deposit-ring)] transition-colors">취소</button>
                                  <button onClick={handleSaveEdit} disabled={isPending}
                                    className="text-xs bg-[var(--deposit-bg)] hover:bg-[var(--deposit-ring)] text-[var(--deposit-fg)] px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50">저장</button>
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={p.id} className="flex items-center justify-between rounded-sm px-3 py-2.5 bg-[var(--deposit-bg)] border border-[var(--deposit-ring)]">
                              <div>
                                <p className="text-xs text-[var(--deposit-fg)]">
                                  {fmtPayDate(p.payDate)} · {p.payMethod ?? '—'}
                                  <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--deposit-bg)] text-[var(--deposit-fg)] rounded px-1 py-0.5">보증금</span>
                                  {p.cashReceiptIssuedAt && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1 py-0.5 whitespace-nowrap">현금영수증</span>}
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-semibold text-[var(--deposit-fg)]">{fmtWon(p.actualAmount)}</span>
                                <div className="flex gap-1.5 ml-1">
                                  <button onClick={() => handleUpdatePayRecord(p)}
                                    className="text-[0.65625rem] font-medium px-2 py-1 rounded-lg border border-[var(--deposit-ring)] text-[var(--deposit-fg)] transition-colors">
                                    수정
                                  </button>
                                  <button onClick={() => handleDeletePayRecord(p.id)}
                                    className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">
                                    삭제
                                  </button>
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    )}

                    {/* 납부 내역 */}
                    {regularRecords.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-xs font-medium text-[var(--warm-mid)]">납부 내역</p>
                        {regularRecords.map(p => {
                          const prevOwner = isPreAcq(p)
                          if (editingPayId === p.id) {
                            return (
                              <div key={p.id} className={`rounded-xl border px-3 py-2.5 space-y-2 ${prevOwner ? 'border-[var(--info-ring)] bg-[var(--info-bg)]' : 'border-[var(--coral)] bg-[var(--canvas)]'}`}>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>금액</p>
                                    <input type="text" inputMode="numeric"
                                      value={editAmount.toLocaleString()}
                                      onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>납부일</p>
                                    <DatePicker value={editDate} onChange={setEditDate}
                                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                                  </div>
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>납부방법</p>
                                    {/* 자유 입력이던 것을 정본 select로 통일 — '카드' 등 변형 표기가 카드 수납 합계에서 누락되는 것 방지(적대검증 필수) */}
                                    <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                                      {!['계좌이체', '현금', '신용카드', '결제선생', '기타'].includes(editPayMethod) && editPayMethod && (
                                        <option value={editPayMethod}>{editPayMethod}</option>
                                      )}
                                      <option value="계좌이체">계좌이체</option>
                                      <option value="현금">현금</option>
                                      <option value="신용카드">신용카드</option>
                                      <option value="결제선생">결제선생</option>
                                      <option value="기타">기타</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1">
                                    <p className={`text-[0.65625rem] ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-muted)]'}`}>메모</p>
                                    <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                                      className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                                  </div>
                                </div>
                                <div className="flex gap-2 justify-end">
                                  <Btn variant="secondary" size="sm" onClick={() => setEditingPayId(null)}>취소</Btn>
                                  <Btn variant="primary" size="sm" onClick={handleSaveEdit} disabled={isPending}>저장</Btn>
                                </div>
                              </div>
                            )
                          }
                          return (
                            <div key={p.id} className={`flex items-center justify-between rounded-sm px-3 py-2.5 ${prevOwner ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'}`}>
                              <div>
                                <p className={`text-xs ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'}`}>
                                  {p.seqNo}회차 · {fmtPayDate(p.payDate)} · {p.payMethod ?? '—'}
                                  {p.cashReceiptIssuedAt && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1 py-0.5 whitespace-nowrap">현금영수증</span>}
                                  {prevOwner && <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1 py-0.5">양도인</span>}
                                  {!p.isDeposit && p.targetMonth !== targetMonth && (
                                    <span className="ml-1.5 text-[0.65625rem] font-semibold bg-[var(--badge-await-bg)] text-[var(--badge-await-fg)] rounded px-1 py-0.5">
                                      {p.targetMonth < targetMonth
                                        ? `${Number(p.targetMonth.slice(5))}월 미납분 처리`
                                        : `${Number(p.targetMonth.slice(5))}월 선납`}
                                    </span>
                                  )}
                                </p>
                                {p.memo && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
                              </div>
                              <div className="flex items-center gap-2">
                                <span className={`text-sm font-semibold ${prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'}`}>{fmtWon(p.actualAmount)}</span>
                                <div className="flex gap-2 ml-1">
                                  <button onClick={() => handleUpdatePayRecord(p)}
                                    className="text-[0.65625rem] font-medium px-2.5 py-1 -my-2 min-h-[44px] inline-flex items-center rounded-lg border transition-colors"
                                    style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
                                    수정
                                  </button>
                                  <button onClick={() => handleDeletePayRecord(p.id)}
                                    className="text-xs font-medium px-2.5 py-1 -my-2 min-h-[44px] inline-flex items-center rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">
                                    삭제
                                  </button>
                                </div>
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
                    const fmtOvr = (v: string | null | undefined) => {
                      if (!v) return ''
                      if (v.includes('-')) { const d = new Date(v + 'T00:00:00'); return `${d.getMonth()+1}월 ${d.getDate()}일` }
                      return v.includes('말') ? '말일' : `${v}일`
                    }
                    return (
                      <div className="border-t border-[var(--warning-ring)] bg-[var(--warning-solid)]/5 px-6 py-3 space-y-2 shrink-0">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--warning-fg)]">납부일 임시 조정</span>
                            {isOverrideActive && (
                              <span className="text-xs bg-[var(--warning-solid)]/20 text-[var(--warning-fg)] px-1.5 py-0.5 rounded-full">
                                {targetMonth} · {fmtOvr(lease.overrideDueDay)}로 적용 중
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2">
                            {isOverrideActive && !showOverrideForm && (
                              confirmClearOverride ? (
                                <div className="flex items-center gap-2 bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-lg px-2.5 py-1.5">
                                  <span className="text-xs text-[var(--danger-fg)]">정말 삭제할까요?</span>
                                  <button type="button" onClick={() => setConfirmClearOverride(false)}
                                    className="text-xs text-[var(--warm-muted)] hover:text-[var(--warm-dark)] px-1.5 py-0.5 rounded">취소</button>
                                  <button
                                    type="button"
                                    disabled={isPending}
                                    onClick={() => {
                                      const leaseId = lease.id
                                      setConfirmClearOverride(false)
                                      setDetailTenant(prev => {
                                        if (!prev) return prev
                                        return {
                                          ...prev,
                                          leaseTerms: prev.leaseTerms.map(lt =>
                                            lt.id === leaseId
                                              ? { ...lt, overrideDueDay: null, overrideDueDayMonth: null, overrideDueDayReason: null }
                                              : lt
                                          ),
                                        }
                                      })
                                      startTransition(async () => {
                                        const release = trackSave()
                                        try {
                                          await clearDueDayOverride(leaseId)
                                          refresh()
                                          pushToast('success', '이번 달 납부일 임시 변경 해제됨')
                                        } finally { release() }
                                      })
                                    }}
                                    className="text-xs bg-[var(--danger-bg)] hover:bg-[var(--danger-ring)] text-[var(--danger-fg)] font-semibold px-2 py-0.5 rounded disabled:opacity-40">
                                    삭제
                                  </button>
                                </div>
                              ) : (
                                <button type="button" onClick={() => setConfirmClearOverride(true)}
                                  className="text-xs text-[var(--danger-fg)] hover:text-[var(--danger-fg)] border border-[var(--danger-ring)] rounded px-2 py-0.5 transition-colors">
                                  삭제
                                </button>
                              )
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const opening = !showOverrideForm
                                setShowOverrideForm(opening)
                                if (opening) {
                                  const existingVal = isOverrideActive ? lease.overrideDueDay : null
                                  let initDate = ''
                                  if (existingVal) {
                                    if (existingVal.includes('-')) {
                                      initDate = existingVal
                                    } else if (existingVal.includes('말')) {
                                      const [y, m] = targetMonth.split('-').map(Number)
                                      initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
                                    } else {
                                      const n = parseInt(existingVal)
                                      if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
                                    }
                                  } else {
                                    const baseDay = lease.dueDay
                                    if (baseDay?.includes('말')) {
                                      const [y, m] = targetMonth.split('-').map(Number)
                                      initDate = `${targetMonth}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
                                    } else if (baseDay) {
                                      const n = parseInt(baseDay)
                                      if (!isNaN(n)) initDate = `${targetMonth}-${String(n).padStart(2, '0')}`
                                    }
                                  }
                                  setOverrideDateInput(initDate || kstYmdStr())
                                  setOverrideReason(isOverrideActive ? (lease.overrideDueDayReason ?? '') : '')
                                }
                              }}
                              className="text-xs text-[var(--warning-fg)] hover:text-[var(--warning-fg)] transition-colors">
                              {showOverrideForm ? '닫기' : isOverrideActive ? '수정' : '조정하기'}
                            </button>
                          </div>
                        </div>

                        {isOverrideActive && !showOverrideForm && (
                          <p className="text-xs text-[var(--warm-muted)]">
                            기준 {fmtDueDay(lease.dueDay)} → 이번달 {fmtOvr(lease.overrideDueDay)}
                            {lease.overrideDueDayReason ? ` · ${lease.overrideDueDayReason}` : ''}
                          </p>
                        )}

                        {showOverrideForm && (
                          <div className="space-y-2">
                            <div className="flex gap-2">
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-[var(--warm-muted)]">조정 납부일</label>
                                <DatePicker
                                  value={overrideDateInput}
                                  onChange={setOverrideDateInput}
                                  minDate={`${targetMonth}-01`}
                                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--warm-dark)] focus:border-[var(--warning-ring)]"
                                />
                              </div>
                              <div className="flex-1 space-y-1">
                                <label className="text-xs text-[var(--warm-muted)]">사유 (선택)</label>
                                <input
                                  type="text"
                                  value={overrideReason}
                                  onChange={e => setOverrideReason(e.target.value)}
                                  placeholder="예: 급여일 변경"
                                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-1.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--warning-ring)]"
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              disabled={isPending || !overrideDateInput}
                              onClick={() => {
                                if (!overrideDateInput) return
                                const d = new Date(overrideDateInput + 'T00:00:00')
                                const selectedYM = overrideDateInput.slice(0, 7)
                                let val: string
                                if (selectedYM !== targetMonth) {
                                  val = overrideDateInput
                                } else {
                                  const dayNum = d.getDate()
                                  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                                  val = dayNum >= lastDay ? '말일' : String(dayNum)
                                }
                                const reason = overrideReason.trim()
                                const leaseId = lease.id
                                setShowOverrideForm(false)
                                setDetailTenant(prev => {
                                  if (!prev) return prev
                                  return {
                                    ...prev,
                                    leaseTerms: prev.leaseTerms.map(lt =>
                                      lt.id === leaseId
                                        ? { ...lt, overrideDueDay: val, overrideDueDayMonth: targetMonth, overrideDueDayReason: reason || null }
                                        : lt
                                    ),
                                  }
                                })
                                startTransition(async () => {
                                  const release = trackSave()
                                  try {
                                    await setDueDayOverride(leaseId, targetMonth, val, reason)
                                    refresh()
                                    pushToast('success', '이번 달 납부일 임시 변경됨')
                                  } finally { release() }
                                })
                              }}
                              className="w-full py-2 bg-[var(--warning-solid)] active:bg-[var(--warning-solid)] text-[var(--on-solid)] text-sm font-semibold rounded-lg transition-colors disabled:opacity-40">
                              {isPending ? '저장 중…' : (() => {
                                if (!overrideDateInput) return '날짜를 선택하세요'
                                const selectedYM = overrideDateInput.slice(0, 7)
                                if (selectedYM !== targetMonth) {
                                  const d2 = new Date(overrideDateInput + 'T00:00:00')
                                  return `${d2.getMonth() + 1}월 ${d2.getDate()}일로 조정`
                                }
                                const d = new Date(overrideDateInput + 'T00:00:00')
                                const dayNum = d.getDate()
                                const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
                                const label = dayNum >= lastDay ? '말일' : `${dayNum}일`
                                return `${targetMonth} 납부일을 ${label}로 조정`
                              })()}
                            </button>
                          </div>
                        )}
                      </div>
                    )
                  })()}

                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <div className="flex-1" />
                    <Btn variant="primary" size="md"
                      onClick={() => { setShowPayForm(true); setError('') }}>
                      수납 등록
                    </Btn>
                  </div>
                </>
              )}

              {/* ── 수납 등록 폼 ── */}
              {showPayForm && (
                <form onSubmit={handleSavePayment} className="flex flex-col flex-1 overflow-hidden">
                  <div className="flex-1 overflow-y-auto p-6 space-y-3">
                    {!isDepositMode && (
                      <p className="text-[0.65625rem] text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed">
                        미수가 있는 가장 오래된 월부터 자동으로 충당됩니다 (발생주의). 입력 금액이 한 달 이용료를 초과하면 다음 달로 이월됩니다.
                      </p>
                    )}
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs text-[var(--warm-muted)]">날짜</label>
                        <DatePicker name="payDate" value={payDateVal} onChange={setPayDateVal}
                          className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
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
                                const mi = lease.moveInDate ? kstYmdStr(new Date(lease.moveInDate)) : null
                                setPayDateVal(mi ?? kstYmdStr())
                              } else {
                                setPayDateVal(kstYmdStr())
                              }
                            }}
                            className="w-4 h-4 accent-[var(--coral)]"
                          />
                          <span className="text-xs text-[var(--warm-mid)]">
                            보증금 수납 ({fmtWon(lease.depositAmount)})
                          </span>
                        </label>
                        {isDepositMode && payAmount > lease.depositAmount && (
                          <p className="text-xs text-[var(--success-fg)]">
                            초과금 {fmtWon((payAmount - lease.depositAmount))} → {targetMonth} 이용료 처리
                          </p>
                        )}
                      </div>
                    )}
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
                      <select name="payMethod"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                        <option value="계좌이체">계좌이체</option>
                        <option value="현금">현금</option>
                        <option value="신용카드">신용카드</option>
                        <option value="결제선생">결제선생</option>
                        <option value="기타">기타</option>
                      </select>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" name="cashReceipt" className="w-3.5 h-3.5 accent-[var(--coral)]" />
                      <span className="text-xs text-[var(--warm-dark)]">현금영수증 발행함</span>
                    </label>
                    <div className="space-y-1">
                      <label className="text-xs text-[var(--warm-muted)]">메모</label>
                      <input type="text" name="memo" placeholder="메모 (선택)"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)]" />
                    </div>
                    {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
                  </div>
                  <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                    <Btn type="button" variant="secondary" size="md" onClick={() => { setShowPayForm(false); setError('') }}
                      className="flex-1">
                      취소
                    </Btn>
                    <Btn type="submit" variant="primary" size="md" disabled={isPending}
                      className="flex-1">
                      {isPending ? '저장 중…' : '저장'}
                    </Btn>
                  </div>
                </form>
              )}
          </Modal>
        )
      })()}

      {/* ── 호실 미니 모달 ─────────────────────────────────────────── */}
      {roomDetailId && (() => {
        const room = rooms.find(r => r.id === roomDetailId)
        return (
          <Modal open width="sm" onClose={() => setRoomDetailId(null)}
            title={`${fmtRoomNo(room?.roomNo)} 정보`} bodyClassName="p-6 space-y-3">
              {room ? (
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between"><span className="text-[var(--warm-muted)]">상태</span><span className={room.isVacant ? 'text-[var(--warm-mid)]' : 'text-[var(--success-fg)]'}>{room.isVacant ? '공실' : '거주중'}</span></div>
                  <div className="flex justify-between"><span className="text-[var(--warm-muted)]">기본 이용료</span><span className="text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></span></div>
                </div>
              ) : (
                <p className="text-[var(--warm-muted)] text-sm">호실 정보를 찾을 수 없습니다.</p>
              )}
              <a href="/room-manage" className="block w-full text-center py-2 mt-2 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-lg transition-colors">
                호실 관리 페이지로 →
              </a>
          </Modal>
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

function KeepAlertCheckbox({ defaultValue }: { defaultValue: boolean }) {
  const [checked, setChecked] = useState(defaultValue)
  return (
    <label className="flex items-center gap-2 text-xs text-[var(--warm-mid)] cursor-pointer select-none">
      <input type="hidden" name="keepAlertAfterInquiry" value={checked ? 'true' : 'false'} />
      <input
        type="checkbox"
        checked={checked}
        onChange={e => setChecked(e.target.checked)}
        className="w-4 h-4 rounded border-[var(--warm-border)] accent-[var(--coral)]"
      />
      <span>입주 희망일이 지나도 알림 유지 <span className="opacity-60">(희망일이 명확하지 않은 경우)</span></span>
    </label>
  )
}

type WishConditionsObj = { floor?: string; windowType?: string; type?: string; direction?: string; minRent?: number; maxRent?: number }

function parseWishConditions(raw: string | null | undefined): WishConditionsObj {
  if (!raw) return {}
  try { return JSON.parse(raw) as WishConditionsObj } catch { return {} }
}

function WishSelector({ rooms, lease, allowConditions, isMove }: {
  rooms: Room[]
  lease?: LeaseTerm
  allowConditions: boolean
  isMove?: boolean           // ACTIVE/NON_RESIDENT 상태 — 라벨을 "이동 희망"으로
}) {
  const initialRooms = (lease?.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)
  const initialCond  = parseWishConditions(lease?.wishConditions)
  // 기존 lease 데이터에 따라 모드 추론, 신규/미설정은 '조건만 선택' 디폴트
  const initialMode: 'rooms' | 'conditions' =
    !allowConditions ? 'rooms'
    : initialRooms.length > 0 ? 'rooms'
    : 'conditions'

  const [mode, setMode] = useState<'rooms' | 'conditions'>(initialMode)

  // 호실 모드 상태
  const [selected, setSelected] = useState<string[]>(initialRooms.slice(0, 5))
  const [floorF, setFloorF]     = useState('')
  const [windowF, setWindowF]   = useState('')
  const [typeF, setTypeF]       = useState('')
  const [directionF, setDirF]   = useState('')

  // 조건 모드 상태
  const [condFloor, setCondFloor]       = useState(initialCond.floor ?? '')
  const [condWindow, setCondWindow]     = useState(initialCond.windowType ?? '')
  const [condType, setCondType]         = useState(initialCond.type ?? '')
  const [condDirection, setCondDirection] = useState(initialCond.direction ?? '')
  const [rentEnabled, setRentEnabled]   = useState(initialCond.minRent !== undefined || initialCond.maxRent !== undefined)
  const [condMinRent, setCondMinRent]   = useState(initialCond.minRent ?? 0)
  const [condMaxRent, setCondMaxRent]   = useState(initialCond.maxRent ?? 400000)

  // status 변경에 따른 allowConditions 토글 시 모드 재설정
  // 신규 등록은 status=ACTIVE로 시작 → allowConditions=false → mode='rooms'로 초기화됨.
  // 사용자가 RESERVED/WAITING_TOUR로 바꾸면 allowConditions가 true가 되는데,
  // 이때 mode가 자동으로 '조건만 선택'(conditions)으로 전환되도록 동기화.
  const prevAllowConditionsRef = useRef(allowConditions)
  useEffect(() => {
    if (prevAllowConditionsRef.current === allowConditions) return
    prevAllowConditionsRef.current = allowConditions
    if (!allowConditions) {
      setMode('rooms')
    } else if (initialRooms.length === 0) {
      setMode('conditions')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowConditions])

  const getRoomFloor = (r: Room) => r.floor || getFloor(r.roomNo)
  const floors     = [...new Set(rooms.map(r => getRoomFloor(r)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))
  const windowTypes = [...new Set(rooms.map(r => r.windowType).filter(Boolean))] as string[]
  const types      = [...new Set(rooms.map(r => r.type).filter(Boolean))] as string[]
  const directions = [...new Set(rooms.map(r => r.direction).filter(Boolean))] as string[]

  const filtered = rooms.filter(r => {
    if (floorF && getRoomFloor(r) !== floorF) return false
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

  // 폼 제출용 hidden 값 — 모드에 따라 한 쪽만 채움
  const wishRoomsValue = mode === 'rooms' ? selected.join(',') : ''
  const condObj: WishConditionsObj = {}
  if (mode === 'conditions') {
    if (condFloor)     condObj.floor       = condFloor
    if (condWindow)    condObj.windowType  = condWindow
    if (condType)      condObj.type        = condType
    if (condDirection) condObj.direction   = condDirection
    if (rentEnabled) {
      condObj.minRent = condMinRent
      condObj.maxRent = condMaxRent
    }
  }
  // 조건 모드 빈 객체("{}") = "조건 무관, 모든 빈 방 매칭" — 호실 미지정 예약자(seeker)에게만 유효한 의도.
  // 거주중 이동희망(isMove)은 조건 미입력이면 '희망 없음'이므로 "{}" 대신 빈값(null) 저장 — 잔여 "{}" 재발 방지.
  const wishConditionsValue = mode === 'conditions'
    ? (isMove && Object.keys(condObj).length === 0 ? '' : JSON.stringify(condObj))
    : ''

  const selCls = 'bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2.5 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] w-full'

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-[var(--warm-mid)]">
        {isMove ? '이동 희망' : '입실 희망'} {allowConditions ? '호실 / 조건' : '호실'} <span className="font-normal opacity-60">(공실/퇴실 예정 시 대시보드 알림)</span>
      </label>
      <input type="hidden" name="wishRooms"      value={wishRoomsValue} />
      <input type="hidden" name="wishConditions" value={wishConditionsValue} />

      {allowConditions && (
        <SegmentedControl
          size="sm"
          ariaLabel="희망 모드"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'rooms',      label: '구체적 호실 선택' },
            { value: 'conditions', label: '조건만 선택' },
          ]}
        />
      )}

      {mode === 'rooms' ? (
        <>
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

          {/* 호실 선택 (최대 5개) */}
          <select
            value=""
            onChange={e => { add(e.target.value); e.target.value = '' }}
            disabled={selected.length >= 5}
            className={selCls}
          >
            <option value="">호실 선택… {allowConditions ? '(선택사항, 최대 5개)' : '(최대 5개)'}</option>
            {filtered.filter(r => !selected.includes(r.roomNo)).map(r => (
              <option key={r.id} value={r.roomNo}>
                {fmtRoomNo(r.roomNo)}{r.isVacant ? ' (공실)' : ''}
              </option>
            ))}
          </select>

          {selected.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {selected.map((roomNo, i) => (
                <span key={roomNo} className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-[var(--coral)]/20 text-[var(--coral)]">
                  {WISH_RANK[i]} {fmtRoomNo(roomNo)}
                  <button type="button" onClick={() => remove(roomNo)}
                    className="leading-none hover:text-[var(--danger-fg)] transition-colors">×</button>
                </span>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
            지정 항목과 일치하는 방이 공실/퇴실 예정이 되면 대시보드 알림이 표시됩니다. 선택하지 않은 항목은 무시됩니다.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <select value={condFloor} onChange={e => setCondFloor(e.target.value)} className={selCls}>
              <option value="">층 무관</option>
              {floors.map(f => <option key={f} value={f}>{f}층</option>)}
            </select>
            <select value={condWindow} onChange={e => setCondWindow(e.target.value)} className={selCls}>
              <option value="">창문 무관</option>
              {windowTypes.map(w => <option key={w} value={w}>{WISH_WINDOW_LABEL[w] ?? w}</option>)}
            </select>
            <select value={condType} onChange={e => setCondType(e.target.value)} className={selCls}>
              <option value="">타입 무관</option>
              {types.map(t => <option key={t} value={t}>{t}</option>)}
            </select>
            <select value={condDirection} onChange={e => setCondDirection(e.target.value)} className={selCls}>
              <option value="">방향 무관</option>
              {directions.map(d => <option key={d} value={d}>{WISH_DIR_LABEL[d] ?? d}</option>)}
            </select>
          </div>
          <div className="space-y-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={rentEnabled}
                onChange={e => setRentEnabled(e.target.checked)}
                className="accent-[var(--coral)] w-3.5 h-3.5"
              />
              <span className="text-[0.6875rem] text-[var(--warm-muted)]">이용료 범위 설정</span>
            </label>
            {rentEnabled ? (
              <div className="flex items-center gap-2">
                <MoneyInput value={condMinRent} onChange={setCondMinRent} placeholder="최소 0원" />
                <span className="text-sm text-[var(--warm-muted)] flex-shrink-0">~</span>
                <MoneyInput value={condMaxRent} onChange={setCondMaxRent} placeholder="최대 400,000원" />
              </div>
            ) : (
              <p className="text-[0.6875rem] text-[var(--warm-muted)] pl-0.5">제한 없음 · 이용료 무관하게 매칭</p>
            )}
          </div>
        </>
      )}
    </div>
  )
}

// ── 폼 컴포넌트 (추가/수정 공용) ─────────────────────────────────

function TenantForm({ rooms, tenant, error, defaultDeposit, defaultCleaningFee, contactLeadDays = 14 }: {
  rooms: Room[]; tenant?: Tenant; error?: string
  defaultDeposit?: number | null; defaultCleaningFee?: number | null; contactLeadDays?: number
}) {
  const lease     = tenant?.leaseTerms[0]
  const primary   = tenant?.contacts.find(c => c.isPrimary)
  const emergency = tenant?.contacts.find(c => c.isEmergency)
  const homeCountry = tenant?.contacts.find(c => c.isHomeCountry)

  const [statusVal, setStatusVal]   = useState(lease?.status ?? 'ACTIVE')
  const [natVal, setNatVal]         = useState(tenant?.nationality ?? '')   // 국적 연동(본국 연락처 숨김)
  const [selectedRoomId, setSelectedRoomId] = useState(lease?.room?.id ?? '')
  const [rentAmount, setRentAmount] = useState<number | undefined>(lease?.rentAmount)
  const [tourDateVal, setTourDateVal] = useState(toDateInput(lease?.tourDate))
  const initialInquiry = splitDateTime(lease?.inquiryAt)
  const [inquiryDateVal, setInquiryDateVal] = useState(initialInquiry.date)
  const [inquiryTimeVal, setInquiryTimeVal] = useState(initialInquiry.time)
  const [reservationConfirmed, setReservationConfirmed] = useState(!!lease?.reservationConfirmedAt)
  const [isShortTerm, setIsShortTerm] = useState(!!lease?.isShortTerm)
  // 단기 요금 자동 계산 — 홈 '단기 요금 계산'과 동일 로직(calcShortStay), 운영자 요청 2026-07-09
  const [shortQuoteData, setShortQuoteData] = useState<Awaited<ReturnType<typeof getRoomsForQuote>> | null>(null)
  // 입실일 = 입주 희망일(moveInDateVal)과 동일 값(운영자 지적 2026-07-10: 따로 입력할 필요 없음)
  const [shortOut, setShortOut] = useState(toDateInput(lease?.expectedMoveOut))
  const [contactAlertVal, setContactAlertVal] = useState(toDateInput(lease?.contactAlertDate ?? null))
  useEffect(() => {
    if (!isShortTerm || shortQuoteData) return
    getRoomsForQuote().then(setShortQuoteData).catch(() => { /* 정책 로드 실패 시 계산기만 미표시 */ })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isShortTerm])
  const inquiryAtCombined = inquiryDateVal
    ? `${inquiryDateVal}T${inquiryTimeVal || '00:00'}`
    : ''

  const handleRoomChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const roomId = e.target.value
    setSelectedRoomId(roomId)
    if (isShortTerm) return  // 단기 희망: 호실 표준가 자동입력 건너뛰기
    const room = rooms.find(r => r.id === roomId)
    if (!room) return
    const isNR = statusVal === 'NON_RESIDENT'
    setRentAmount(isNR && room.nonResidentRent != null ? room.nonResidentRent : room.baseRent)
  }

  // 비거주자 ↔ 일반 전환 시 해당 호실의 적정 이용료로 자동 교체
  useEffect(() => {
    if (isShortTerm || !selectedRoomId) return
    const room = rooms.find(r => r.id === selectedRoomId)
    if (!room) return
    const isNR = statusVal === 'NON_RESIDENT'
    setRentAmount(isNR && room.nonResidentRent != null ? room.nonResidentRent : room.baseRent)
  }, [statusVal]) // eslint-disable-line react-hooks/exhaustive-deps

  // WAITING_TOUR/TOUR_DONE/RESERVED는 호실 필수 아님 (단, 예약 확정 시 RESERVED는 호실 필수)
  const roomIsOptional = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'].includes(statusVal) && !(statusVal === 'RESERVED' && reservationConfirmed)
  // 호실 입력 강제 여부 — 예약확정이라도 RESERVED 면 '미지정' 허용(만실 맞바꾸기 임시 파킹용). 라벨·날짜 로직은 roomIsOptional 그대로.
  const roomCanBeEmpty = roomIsOptional || statusVal === 'RESERVED'
  // ACTIVE, CHECKOUT_PENDING + 예약 확정 → 입주중/퇴실예정 방만 비활성화 (공실 + 퇴실예정만 선택 가능)
  const activeOnlyStatus = ['ACTIVE', 'CHECKOUT_PENDING'].includes(statusVal) || (statusVal === 'RESERVED' && reservationConfirmed)
  const isWaitingTourStatus = statusVal === 'WAITING_TOUR' || (statusVal === 'RESERVED' && reservationConfirmed)

  // 보증금/청소비 자동 입력 제외 상태 (계약/납입 단계 이전 — 잘못 저장 방지)
  // 단기 희망(isShortTerm)도 모두 수기 입력 → 자동입력 제외
  const NO_AUTOFILL_STATUSES = ['RESERVED', 'WAITING_TOUR', 'TOUR_DONE', 'CANCELLED', 'NON_RESIDENT']
  const isNoAutoFill = (s: string, shortTerm: boolean) => shortTerm || NO_AUTOFILL_STATUSES.includes(s)
  const [depositAmountVal, setDepositAmountVal] = useState<number | undefined>(
    lease?.depositAmount ?? (isNoAutoFill(statusVal, isShortTerm) ? undefined : (defaultDeposit ?? undefined))
  )
  const [cleaningFeeVal, setCleaningFeeVal] = useState<number | undefined>(
    lease?.cleaningFee ?? (isNoAutoFill(statusVal, isShortTerm) ? undefined : (defaultCleaningFee ?? undefined))
  )
  // status 또는 단기 토글 변경 시 default 재적용
  useEffect(() => {
    setDepositAmountVal(isNoAutoFill(statusVal, isShortTerm) ? (lease?.depositAmount ?? undefined) : (lease?.depositAmount ?? defaultDeposit ?? undefined))
    setCleaningFeeVal(isNoAutoFill(statusVal, isShortTerm) ? (lease?.cleaningFee ?? undefined) : (lease?.cleaningFee ?? defaultCleaningFee ?? undefined))
  }, [statusVal, isShortTerm]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <OcrToolbar
        onContract={data => {
          // controlled state
          if (data.rentAmount != null) setRentAmount(data.rentAmount)
          if (data.depositAmount != null) setDepositAmountVal(data.depositAmount)
          if (data.cleaningFee != null) setCleaningFeeVal(data.cleaningFee)
          if (data.roomNo) {
            // '402호' → '402' 매칭
            const norm = (s: string) => s.replace(/[^0-9가-힣A-Za-z]/g, '')
            const target = norm(data.roomNo)
            const m = rooms.find(r => norm(r.roomNo) === target || r.roomNo === data.roomNo)
            if (m) setSelectedRoomId(m.id)
          }
          if (data.dueDay) applyDueDay(data.dueDay)
          if (data.moveInDate) setInputByName('moveInDate', data.moveInDate)
          // uncontrolled
          setInputByName('name', data.name)
          setInputByName('englishName', data.englishName)
          setInputByName('gender', data.gender)
          setInputByName('nationality', data.nationality)
          setInputByName('birthdate', data.birthdate)
          setInputByName('job', data.job)
          setInputByName('contactValue', data.contactPhone)
          setInputByName('emergencyContact', data.emergencyPhone)
          setInputByName('emergencyRelation', data.emergencyRelation)
        }}
        onIdCard={data => {
          setInputByName('name', data.name)
          setInputByName('englishName', data.englishName)
          setInputByName('gender', data.gender)
          setInputByName('nationality', data.nationality)
          setInputByName('birthdate', data.birthdate)
        }}
      />

      <FormSection title="기본 정보">
        <div className="grid grid-cols-2 gap-3">
          <Field label="이름 *" name="name" defaultValue={tenant?.name} placeholder="홍길동" required />
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
        <div className="grid grid-cols-3 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
            <CountrySelect name="nationality" defaultValue={tenant?.nationality} onChange={v => setNatVal(v ?? '')} />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">직업</label>
            <JobSelect name="job" defaultValue={tenant?.job} />
          </div>
          <SelectField label="흡연 여부" name="smoking" defaultValue={tenant?.smoking ? 'true' : 'false'}>
            <option value="false">비흡연</option>
            <option value="true">흡연</option>
          </SelectField>
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
        <Field label="이메일" name="email" type="email" defaultValue={tenant?.email ?? ''} placeholder="example@email.com" />
        <div className="grid grid-cols-3 gap-2">
          <Field label="비상연락 관계" name="emergencyRelation" defaultValue={emergency?.emergencyRelation ?? ''} placeholder="부모님" />
          <div className="col-span-2 space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">비상 연락처</label>
            <PhoneInput name="emergencyContact" defaultValue={emergency?.contactValue ?? ''} />
          </div>
        </div>
        {/* 본국 연락처 — 외국인 전용. 국적이 대한민국이면 숨김(운영자 요청 2026-07-11).
            숨겨져도 저장 시 기존 값은 보존(필드 부재 = 서버가 건드리지 않음). */}
        {natVal !== '대한민국' && (
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">본국 연락처 <span className="text-[0.65625rem] text-[var(--warm-muted)] font-normal">(외국인 고객 · 국가 선택 시 자동 포맷)</span></label>
          <IntlPhoneInput
            name="homeCountryContact"
            countryName="homeCountryCode"
            defaultValue={homeCountry?.contactValue ?? ''}
            defaultCountry={homeCountry?.countryCode ?? 'KR'}
            placeholder="국가 선택 후 번호 입력"
          />
        </div>
        )}
      </FormSection>

      <FormSection title="계약 정보">
        <div className="grid grid-cols-2 gap-3">
          {/* 상태 — controlled: 호실 선택 가능 여부 및 퇴실일 표시 결정 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">상태</label>
            <select name="status" value={statusVal} onChange={e => setStatusVal(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="ACTIVE">거주중</option>
              <option value="CHECKOUT_PENDING">퇴실 예정</option>
              <option value="CHECKED_OUT">퇴실</option>
              <option value="NON_RESIDENT">비거주자</option>
              <option value="WAITING_TOUR">투어 대기</option>
              <option value="TOUR_DONE">투어 완료</option>
              <option value="RESERVED">예약</option>
              <option value="CANCELLED">입실 취소</option>
            </select>
            {/* 처음 보는 상태 정의 — 선택했을 때만 한 줄(신규유저 감사 #5) */}
            {statusVal === 'NON_RESIDENT' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">비거주자 = 방에 살지는 않지만 계약·요금이 있는 경우 (창고·사무실 임대 등)</p>
            )}
            {statusVal === 'RESERVED' && (
              <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed">예약 = 입주 의사만 받은 상태 · 아래 &lsquo;예약 확정&rsquo;을 체크하면 방을 실제로 잡아둡니다</p>
            )}
          </div>
          <SelectField label="선납/후납" name="paymentTiming" defaultValue={lease?.paymentTiming ?? 'PREPAID'}>
            <option value="PREPAID">선납</option>
            <option value="POSTPAID">후납</option>
          </SelectField>
        </div>

        {/* 연장 확인용 이전 값 — 제출 핸들러가 '퇴실 예정인데 퇴실일만 미래로 변경'을 감지 */}
        {lease && <input type="hidden" name="prevStatus" value={lease.status} />}
        {lease && <input type="hidden" name="prevExpectedMoveOut" value={toDateInput(lease.expectedMoveOut)} />}
        {/* 상태별 단계 정보 — 상태에 따라 관련 입력이 상태 바로 아래에 표시됨 */}
        {/* 입실 문의 일시 (예약/투어/취소 — 예약자 순번 기준. 취소자도 이력 보존·열람) */}
        {(statusVal === 'RESERVED' || statusVal === 'WAITING_TOUR' || statusVal === 'TOUR_DONE' || statusVal === 'CANCELLED') && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">
              입실 문의 일시 <span className="font-normal opacity-60">(예약자 순번 기준)</span>
            </label>
            <input type="hidden" name="inquiryAt" value={inquiryAtCombined} />
            <div className="flex gap-2">
              <div className="flex-1">
                <DatePicker
                  value={inquiryDateVal}
                  onChange={(date) => {
                    setInquiryDateVal(date)
                    // 날짜 선택 시 시간이 비어있으면 현재 시각을 디폴트로 자동 입력
                    // (브라우저 native time input의 placeholder는 실제 값이 아니라 사용자 혼동 방지용)
                    if (date && !inquiryTimeVal) {
                      const now = new Date()
                      setInquiryTimeVal(`${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`)
                    }
                  }}
                  placeholder="문의 날짜 선택"
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
                />
              </div>
              <input
                type="time"
                value={inquiryTimeVal}
                onChange={e => setInquiryTimeVal(e.target.value)}
                disabled={!inquiryDateVal}
                className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors disabled:opacity-50"
              />
            </div>
            <KeepAlertCheckbox defaultValue={lease?.keepAlertAfterInquiry ?? true} />
          </div>
        )}
        {/* 투어 날짜 — 예약자도 투어 일정을 가질 수 있고, 취소자도 이력을 보존한다(운영자 요청 2026-07-11) */}
        {['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'].includes(statusVal) && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">
              {statusVal === 'WAITING_TOUR' ? '투어 예정일' : '투어 날짜'}
              {statusVal !== 'WAITING_TOUR' && <span className="font-normal opacity-60"> (예정 또는 다녀간 날, 선택)</span>}
            </label>
            <DatePicker
              name="tourDate"
              value={tourDateVal}
              onChange={setTourDateVal}
              placeholder={statusVal === 'WAITING_TOUR' ? '투어 예정일 선택' : '투어 날짜 선택 (선택)'}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
            />
          </div>
        )}
        {/* 예약 확정 토글 (RESERVED 전용) — 호실/이용료/입주희망일 필수 + 매칭 알림 제외 */}
        {statusVal === 'RESERVED' && (
          <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]/50 px-3 py-2.5 space-y-1.5">
            <input type="hidden" name="reservationConfirmed" value={reservationConfirmed ? 'true' : 'false'} />
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={reservationConfirmed}
                onChange={e => setReservationConfirmed(e.target.checked)}
                className="w-4 h-4 accent-[var(--coral)]"
              />
              <span className="text-xs font-medium text-[var(--warm-dark)]">예약 확정</span>
              {reservationConfirmed && lease?.reservationConfirmedAt && (
                <span className="text-[0.65625rem] text-[var(--warm-muted)]">· {fmtDate(lease.reservationConfirmedAt)}</span>
              )}
            </label>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed pl-6">
              체크 시 호실/월 이용료/입주 희망일이 필수가 되고, 공실·퇴실 예정 방만 선택할 수 있습니다. 입주 희망일이 도래하면 대시보드 알림에서 거주중 전환을 진행하세요.
            </p>
          </div>
        )}
        {/* 입주 희망일 — 예약/투어 단계는 상태 클러스터 안(상태 바로 아래)에 표시 */}
        {roomIsOptional && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">입주 희망일</label>
            <DatePicker
              name="moveInDate"
              value={moveInDateVal}
              onChange={setMoveInDateVal}
              placeholder="입주 희망일 선택"
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
            />
            {/* 연락 알림일 — 이 날부터 '연락할 때' 알림. 비우면 영업장 기본(입주 희망일 N일 전). 운영자 요청 2026-07-10 */}
            {moveInDateVal && (() => {
              const def = (() => {
                const d = new Date(moveInDateVal + 'T00:00:00')
                if (isNaN(d.getTime())) return ''
                d.setDate(d.getDate() - contactLeadDays)
                const today = new Date(); today.setHours(0, 0, 0, 0)
                const eff = d < today ? today : d
                return `${eff.getFullYear()}-${String(eff.getMonth() + 1).padStart(2, '0')}-${String(eff.getDate()).padStart(2, '0')}`
              })()
              const effective = contactAlertVal || def
              return (
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <span className="text-xs font-medium text-[var(--warm-mid)]">연락 알림일</span>
                  {/* 날짜를 탭하면 달력이 열려 바로 변경(운영자 요청 2026-07-10). 저장값은 직접 지정했을 때만 */}
                  <DatePicker value={effective} onChange={setContactAlertVal}
                    className="!w-auto inline-flex items-center px-1 text-sm font-semibold text-[var(--coral)] underline decoration-dotted underline-offset-4" />
                  <input type="hidden" name="contactAlertDate" value={contactAlertVal} />
                  <span className="text-[0.65625rem] text-[var(--warm-muted)]">
                    {contactAlertVal ? '직접 지정' : `기본 · 희망일 ${contactLeadDays}일 전`} · 이 날부터 홈 화면과 알림(종 아이콘)에 표시
                  </span>
                  {contactAlertVal && (
                    <button type="button" onClick={() => setContactAlertVal('')}
                      className="min-h-[28px] inline-flex items-center text-[0.65625rem] px-1.5 text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">기본값으로</button>
                  )}
                </div>
              )
            })()}
          </div>
        )}

        {/* 단기 희망 토글 — 체크 시 월 이용료/보증금/청소비 자동 입력 건너뛰고 수동 입력 강제 */}
        <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--canvas)]/50 px-3 py-2.5 space-y-1">
          <input type="hidden" name="isShortTerm" value={isShortTerm ? 'true' : 'false'} />
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isShortTerm} onChange={e => setIsShortTerm(e.target.checked)}
              className="w-4 h-4 accent-[var(--coral)]" />
            <span className="text-xs font-medium text-[var(--warm-dark)]">단기 희망</span>
          </label>
          <p className="text-[0.65625rem] text-[var(--warm-muted)] leading-relaxed pl-6">
            체크 시 호실 선택 후에도 월 이용료/보증금/청소비가 자동 채워지지 않고 모두 수동 입력합니다. 호실의 표준 가격에는 영향이 없으며 퇴실 후 다음 입주자는 다시 자동 채워집니다.
          </p>
          {isShortTerm && (() => {
            const baseRent = shortQuoteData?.rooms.find(r => r.id === selectedRoomId)?.baseRent
              ?? rooms.find(r => r.id === selectedRoomId)?.baseRent ?? 0
            const days = moveInDateVal && shortOut ? stayDaysOf(moveInDateVal, shortOut) : null
            const short = shortQuoteData && baseRent > 0 && days != null
              ? calcShortStay(shortQuoteData.shortStay, baseRent, days) : null
            return (
              <div className="pl-6 pt-1 space-y-2">
                <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)]">단기 요금 자동 계산 <span className="font-normal text-[var(--warm-muted)]">(홈의 단기 요금 계산과 같은 규칙)</span></p>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">입실일 = 입주 희망일</span>
                    <DatePicker value={moveInDateVal} onChange={setMoveInDateVal} placeholder="입실일"
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none w-full" />
                  </div>
                  <div>
                    <span className="block text-[0.65625rem] text-[var(--warm-muted)] mb-0.5">퇴실일 (예정 퇴실일로 저장)</span>
                    <DatePicker value={shortOut} onChange={setShortOut} placeholder="퇴실일"
                      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none w-full" />
                  </div>
                </div>
                {/* 문의·예약 단계(거주 전)에는 퇴실일 필드가 폼에 없어 여기 값으로 저장 — 거주 단계(showExitDate)는 기존 필드 사용.
                    roomIsOptional 게이트면 '예약 확정'자가 제외되어 입력해도 저장이 안 됐다(운영자 신고 2026-07-15) */}
                {!showExitDate && shortOut && <input type="hidden" name="expectedMoveOut" value={shortOut} />}
                {!selectedRoomId ? (
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">호실을 고르면 그 방의 표준가로 자동 계산합니다</p>
                ) : short && days != null ? (
                  <div className="rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] px-2.5 py-2 space-y-1">
                    <p className="text-[0.6875rem] text-[var(--warm-dark)]">
                      {days}일 → {short.units}주 계약{short.cappedAtMonth ? ' (1개월 상한 적용)' : ''} ·
                      사용료 {fmtWon(short.baseAmount)} + 청소비 {fmtWon(short.cleaningFee)} = <span className="font-bold">{fmtWon(short.total)}</span>
                      {short.deposit > 0 && <span className="text-[var(--warm-muted)]"> · 보증금 {fmtWon(short.deposit)} 별도(퇴실 시 환불)</span>}
                    </p>
                    <button type="button"
                      onClick={() => { setRentAmount(short.baseAmount); setCleaningFeeVal(short.cleaningFee); if (short.deposit > 0) setDepositAmountVal(short.deposit) }}
                      className="min-h-[32px] inline-flex items-center text-[0.6875rem] px-2.5 py-1 rounded-md bg-[var(--coral)] text-[var(--on-solid)] hover:opacity-90 transition-opacity">
                      이 금액 채우기
                    </button>
                    <span className="ml-2 text-[0.65625rem] text-[var(--warm-muted)]">채운 뒤 아래에서 자유롭게 수정할 수 있어요</span>
                  </div>
                ) : days != null && shortQuoteData && days > shortQuoteData.shortStay.thresholdDays ? (
                  <p className="text-[0.65625rem] text-[var(--warning-fg)]">단기 정책 범위({shortQuoteData.shortStay.thresholdDays}일)를 넘는 기간입니다. 월 단위로 입력해 주세요.</p>
                ) : (
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">입실일과 퇴실일을 고르면 요금이 자동 계산됩니다</p>
                )}
              </div>
            )
          })()}
        </div>

        {/* 호실 — 상태에 따라 선택 규칙 다름 */}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">
            호실{roomCanBeEmpty ? '' : ' *'}
            {!roomIsOptional && statusVal === 'RESERVED' && <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)] font-normal">(맞바꿈 시 잠시 비워둘 수 있음)</span>}
          </label>
          <select name="roomId" value={selectedRoomId} onChange={handleRoomChange} required={!roomCanBeEmpty}
            onWheel={e => e.stopPropagation()}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
            <option value="">{roomCanBeEmpty ? '호실 선택 (선택사항)' : '호실 선택'}</option>
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
                  {fmtRoomNo(r.roomNo)}{isWaitingTourStatus && isCheckoutPending && !r.isVacant ? ' (퇴실예정)' : ''}
                </option>
              )
            })}
          </select>
        </div>

        {(() => {
          const selectedRoom = rooms.find(r => r.id === selectedRoomId)
          const isNR = statusVal === 'NON_RESIDENT'
          const hasNRRate = isNR && selectedRoom?.nonResidentRent != null
          return (
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">
                  {hasNRRate ? '비거주 이용료' : '월 이용료'}
                </label>
                {hasNRRate && (
                  <Badge tone="pale-blue">비거주 전용</Badge>
                )}
              </div>
              <MoneyInput name="rentAmount" value={rentAmount} onChange={setRentAmount} placeholder="0원" />
              {isNR && selectedRoom && selectedRoom.nonResidentRent == null && (
                <p className="text-[0.65625rem] text-[var(--warning-fg)]">
                  이 호실에 비거주 이용료가 설정되어 있지 않습니다. 호실 관리에서 먼저 설정해 주세요.
                </p>
              )}
            </div>
          )
        })()}
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">보증금</label>
          <MoneyInput
            name="depositAmount"
            value={depositAmountVal}
            onChange={setDepositAmountVal}
            placeholder="0원"
          />
          {(depositAmountVal ?? 0) > 0 && (
            <label className="flex items-center gap-1.5 text-[0.6875rem] text-[var(--warm-mid)] cursor-pointer pt-0.5">
              <input type="checkbox" name="depositReceived" value="1" className="w-3.5 h-3.5 accent-[var(--coral)]" />
              보증금 실제로 받음 — 실수납으로 기록 (이미 기록됐으면 자동 무시)
            </label>
          )}
        </div>
        {/* 청소비 | 입주일 — 입주일은 거주 단계(roomIsOptional=false)만. 예약/투어는 위 상태 클러스터의 입주 희망일 사용 */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">청소비</label>
            <MoneyInput
              name="cleaningFee"
              value={cleaningFeeVal}
              onChange={setCleaningFeeVal}
              placeholder="0원"
            />
          </div>
          {!roomIsOptional && (
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
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none transition-colors"
              />
            </div>
          )}
        </div>
        {/* 납부일 | 퇴실일(조건부) (아이템 5, 7, 8) */}
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
            <input type="hidden" name="dueDay" value={dueDayRaw} />
            <input
              type="text"
              value={dueDayDisp}
              onChange={e => {
                const v = e.target.value
                const stripped = v.replace(/일$/, '').trim()
                const n = Number(stripped)
                if (/[ㅁ마말]/.test(v) || (stripped !== '' && !isNaN(n) && n >= 30)) {
                  setDueDayRaw('말일'); setDueDayDisp('말일')
                } else {
                  setDueDayDisp(v)
                }
              }}
              onFocus={() => setDueDayDisp(prev => prev.replace(/일$/, ''))}
              onBlur={() => applyDueDay(dueDayDisp)}
              placeholder="15일, 말일 등"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
            />
          </div>
          {showExitDate && (
            <Field label="퇴실일" name="expectedMoveOut" type="date" defaultValue={toDateInput(lease?.expectedMoveOut)} />
          )}
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
            <option value="결제선생">결제선생</option>
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
        <WishSelector
          rooms={rooms}
          lease={lease}
          allowConditions={true}
          isMove={statusVal === 'ACTIVE' || statusVal === 'NON_RESIDENT'}
        />
        {/* 계약서 파일 — 기존 입주자 수정 시에만 표시. Prism 뷰어와 동일한 ContractFilesPanel.
            (사용자 피드백 2026-06-01: 뷰어에는 첨부 UI 있지만 수정 폼에는 없어 헷갈림) */}
        {tenant && (
          <div className="space-y-1.5">
            <label className="text-[0.6875rem] font-medium" style={{ color: 'var(--warm-mid)' }}>계약서 파일</label>
            <ContractFilesPanel tenantId={tenant.id} tenantName={tenant.name} />
          </div>
        )}
        <Field label="외부 계약서 링크 (Google Drive·Dropbox 등, 선택)" name="contractUrl" type="url" defaultValue={lease?.contractUrl ?? ''} placeholder="https://…" />
      </FormSection>

      <FormSection title="메모">
        <textarea name="memo" rows={2} defaultValue={tenant?.memo ?? ''} placeholder="입주자 특이사항"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] resize-none" />
      </FormSection>

      {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
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

function DateFieldInner({ name, defaultValue, placeholder }: { name: string; defaultValue?: string; placeholder?: string }) {
  const [val, setVal] = useState(defaultValue ?? '')
  return (
    <DatePicker name={name} value={val} onChange={setVal} placeholder={placeholder ?? '날짜 선택'}
      className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
  )
}

function Field({ label, name, type = 'text', placeholder, defaultValue, required }: {
  label: string; name: string; type?: string; placeholder?: string; defaultValue?: string; required?: boolean
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      {type === 'date'
        ? <DateFieldInner name={name} defaultValue={defaultValue} placeholder={placeholder} />
        : <input type={type} name={name} defaultValue={defaultValue} placeholder={placeholder} required={required}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors" />
      }
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
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
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

// ── 계약서 파일 패널 — 상세 모달 정보 탭에서 서명된 계약서 PDF / 스캔본 관리
function ContractFilesPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [files, setFiles]   = useState<ContractFileRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try { setFiles(await getContractFiles(tenantId)) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const release = trackSave()
    try {
      const session = await createContractScanUploadSession({
        tenantId, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeContractScan({ tenantId, driveFileId, fileName: file.name })
      if (!fin.ok) { pushToast('error', fin.error); return }
      pushToast('success', '스캔 본 업로드됨')
      await reload()
    } catch (err) {
      pushToast('error', (err as Error).message ?? '업로드 실패')
    } finally { release(); setUploading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 계약서 파일을 삭제할까요?', message: 'Google Drive에서도 삭제됩니다.', level: 'danger', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deleteContractFile(id)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '삭제됨')
      await reload()
    } finally { release() }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 -mt-1">
        <a href={`/contract/${tenantId}`} target="_blank" rel="noreferrer"
          className="px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
          출력 / 서명 받기
        </a>
        <label className={`px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'opacity-60' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'}`}>
          {uploading ? '업로드 중…' : '스캔 본 첨부'}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      {loading && <SkeletonRows rows={2} />}
      {!loading && files && files.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)]">등록된 계약서가 없습니다. 출력 페이지에서 서명을 받거나 스캔 본을 첨부하세요.</p>
      )}
      {!loading && files && files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map(f => {
            const dt = new Date(f.signedAt)
            const dateLabel = `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
            return (
              <li key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)]">
                <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded font-medium ${f.source === 'GENERATED' ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
                  {f.source === 'GENERATED' ? '서명' : '스캔'}
                </span>
                <a href={f.viewUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-xs text-[var(--warm-dark)] hover:text-[var(--coral)] truncate">
                  {tenantName} · {dateLabel}
                </a>
                <button onClick={() => handleDelete(f.id)} className="text-[0.6875rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)]">
                  삭제
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

// ── 입주자 일괄 편집 모달 ────────────────────────────────────────

function BatchEditTenantsModal({ selectedIds, onClose, onDone }: {
  selectedIds: string[]; onClose: () => void; onDone: () => void
}) {
  // Tenant 필드
  const [nationality, setNationality] = useState('')
  const [gender, setGender]           = useState('')
  // LeaseTerm 필드
  const [depositAmount, setDepositAmount] = useState<number | undefined>(undefined)
  const [dueDay, setDueDay]           = useState('')
  const [status, setStatus]           = useState('')

  const [pending, setPending] = useState(false)
  const [error, setError]     = useState('')

  const handleApply = async () => {
    const data: Parameters<typeof batchUpdateTenants>[1] = {}
    if (nationality) data.nationality = nationality
    if (gender)      data.gender      = gender
    if (depositAmount != null) data.depositAmount = depositAmount
    if (dueDay.trim()) data.dueDay = dueDay.trim()
    if (status)      data.status   = status

    if (Object.keys(data).length === 0) { setError('변경할 항목을 하나 이상 입력하세요.'); return }

    setPending(true); setError('')
    const res = await batchUpdateTenants(selectedIds, data)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    {
      const u = res.undo
      pushToast('success', `입주자 ${res.tenantCount}명${res.leaseCount > 0 ? `, 계약 ${res.leaseCount}건` : ''} 업데이트 완료`, {
        action: { label: '적용취소', run: () => { void undoBatchUpdateTenants(u).then(r => { if (r.ok) pushToast('info', '일괄 수정을 적용취소했습니다'); else pushToast('error', r.error) }) } },
      })
    }
    onDone()
  }

  const [dirty, setDirty] = useState(false)   // v2.0 §12
  const inputCls = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]'

  return (
    <Modal open onClose={onClose} width="md" dirty={dirty}
      title="고객 일괄 편집" subtitle={`${selectedIds.length}명 선택됨 · 입력하지 않은 항목은 변경되지 않습니다`}>
      <div className="px-6 py-4 space-y-4" onInput={() => requestAnimationFrame(() => setDirty(true))} onChange={() => setDirty(true)}>
          {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">국적</label>
            <input type="text" value={nationality} onChange={e => setNationality(e.target.value)}
              placeholder="미변경 (예: 한국, Vietnam, China)"
              className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">성별</label>
            <div>
              <SegmentedControl
                size="sm"
                ariaLabel="성별"
                value={gender}
                onChange={setGender}
                options={[
                  { value: '',       label: '미변경' },
                  { value: 'MALE',   label: '남성' },
                  { value: 'FEMALE', label: '여성' },
                  { value: 'OTHER',  label: '기타' },
                ]}
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">보증금 (계약 전체 적용)</label>
            <MoneyInput value={depositAmount} onChange={setDepositAmount} placeholder="미변경" />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">납부일 (계약 전체 적용)</label>
            <input type="text" inputMode="numeric" value={dueDay} onChange={e => setDueDay(e.target.value.replace(/[^0-9말]/g, ''))}
              placeholder="미변경 (예: 5, 25, 말)"
              className={inputCls} />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">상태 (계약 전체 적용)</label>
            <select value={status} onChange={e => setStatus(e.target.value)} className={inputCls}>
              <option value="">미변경</option>
              <option value="ACTIVE">거주중</option>
              <option value="CHECKOUT_PENDING">퇴실 예정</option>
              <option value="CHECKED_OUT">퇴실</option>
              <option value="NON_RESIDENT">비거주자</option>
              <option value="WAITING_TOUR">투어 대기</option>
              <option value="TOUR_DONE">투어 완료</option>
              <option value="RESERVED">예약</option>
              <option value="CANCELLED">입실 취소</option>
            </select>
          </div>
        </div>
        <div className="border-t border-[var(--warm-border)] px-6 py-3 flex gap-2 shrink-0">
          <Btn type="button" variant="secondary" size="md" onClick={onClose} className="flex-1">
            취소
          </Btn>
          <Btn type="button" variant="primary" size="md" onClick={handleApply} disabled={pending}
            className="flex-1 font-semibold">
            {pending ? '적용 중…' : '적용'}
          </Btn>
        </div>
    </Modal>
  )
}


