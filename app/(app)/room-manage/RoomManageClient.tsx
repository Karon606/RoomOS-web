'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { useRouter, useSearchParams } from 'next/navigation'
import { addRoom, updateRoom, createPhotoUploadSession, finalizeRoomPhoto, deleteRoomPhoto, batchUpdateRooms, undoBatchUpdateRooms } from './actions'
import { AreaInput } from '@/components/ui/AreaInput'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { useCanEdit } from '@/components/RoleContext'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { Modal as SharedModal } from '@/components/ui/Modal'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { useUrlState } from '@/lib/useUrlState'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { SortSelect } from '@/components/ui/SortSelect'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { RoomCard, type CardKind } from '@/components/ui/RoomCard'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { StatusBadge, statusTipColor, statusRowTint, type BadgeTone } from '@/components/ui/StatusBadge'
import { DisplayFieldsMenu, useDisplayFields, type FieldDef } from '@/components/ui/DisplayFieldsMenu'
import { Panorama360 } from '@/components/Panorama360'
import { driveImageUrl, looksLike360 } from '@/lib/driveImage'

const fmtRoomNo = (no: string | null | undefined) =>
  no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—'

type Photo = {
  id: string
  driveFileId: string | null
  storageUrl: string
  fileName: string | null
}

type Room = {
  id: string
  roomNo: string
  type: string | null
  tier: string | null
  baseRent: number
  scheduledRent: number | null
  rentUpdateDate: Date | string | null
  nonResidentRent: number | null
  nonResidentScheduled: number | null
  nonResidentRentDate: Date | string | null
  memo: string | null
  isVacant: boolean
  noMoveInReport: boolean        // 전입신고 불가 방 — 카드 배지 + 등록 경고(2026-07-06)
  nonResidentVacant: boolean     // 비거주 점유 시 공실로 표시할지 (false = 창고·사무실)
  floor: string | null
  windowType: string | null
  direction: string | null
  areaPyeong: number | null
  areaM2: number | null
  photos: Photo[]
  leaseTerms: {
    id: string
    status: string                 // ACTIVE | RESERVED | CHECKOUT_PENDING | NON_RESIDENT
    tenantId: string
    tenant: { id: string; name: string } | null
  }[]
}

// 호실 상태 — 카드 종류(거주중·퇴실예정=resident / 공실·예약=vacant) + 예외 뱃지.
// 거주중·공실은 카드 베이스만으로 구분(뱃지 X), 예약·퇴실예정만 뱃지.
type RoomStatus = {
  label: string
  kind: CardKind
  badge: { tone: BadgeTone; label: string } | null
}
function getRoomStatus(r: Room): RoomStatus {
  // 거주 계약 우선, 없으면 비거주 계약 — 비거주만 있을 때는 방 설정(nonResidentVacant)에 따라
  // 공실(현행) 또는 점유(창고·사무실)로 표시(운영자 요청 2026-07-06)
  const lease = r.leaseTerms.find(l => l.status !== 'NON_RESIDENT') ?? r.leaseTerms[0]
  if (!lease)
    return { label: '공실', kind: 'vacant', badge: null }
  if (lease.status === 'NON_RESIDENT')
    return r.nonResidentVacant
      ? { label: '공실', kind: 'vacant', badge: { tone: 'info', label: '비거주' } }
      : { label: '비거주', kind: 'resident', badge: { tone: 'info', label: '비거주' } }
  if (lease.status === 'RESERVED')
    // 라벨 '예약' 통일 — 수납(rooms)·고객관리·lib/statusColors 와 동일 용어 (화면마다 '입실 예정/예약' 혼용 제거)
    return { label: '예약', kind: 'vacant', badge: { tone: 'movein', label: '예약' } }
  if (lease.status === 'CHECKOUT_PENDING')
    return { label: '퇴실 예정', kind: 'resident', badge: { tone: 'exit', label: '퇴실 예정' } }
  return { label: '거주중', kind: 'resident', badge: null }
}

// 상태 빠른 필터 키 — 공실/예약/거주중/퇴실예정. getRoomStatus 와 동일한 분기.
type RoomStatusKey = 'vacant' | 'reserved' | 'active' | 'checkout'
function roomStatusKey(r: Room): RoomStatusKey {
  const lease = r.leaseTerms.find(l => l.status !== 'NON_RESIDENT') ?? r.leaseTerms[0]
  if (!lease) return 'vacant'
  if (lease.status === 'NON_RESIDENT') return r.nonResidentVacant ? 'vacant' : 'active'
  if (lease.status === 'RESERVED') return 'reserved'
  if (lease.status === 'CHECKOUT_PENDING') return 'checkout'
  return 'active'
}
const STATUS_FILTERS: { key: RoomStatusKey; label: string }[] = [
  { key: 'vacant', label: '공실' },
  { key: 'reserved', label: '예약' },
  { key: 'active', label: '거주중' },
  { key: 'checkout', label: '퇴실 예정' },
]

// 카드 표시 항목 — 이용자가 켜고 끌 수 있는 필드 (호실번호·상태는 항상 표시)
const RM_CARD_FIELDS: FieldDef[] = [
  { key: 'floor',     label: '층' },
  { key: 'tenant',    label: '입주자' },
  { key: 'spec',      label: '타입·창문·면적' },
  { key: 'scheduled', label: '예정 이용료' },
  { key: 'photo',     label: '사진' },
]

// 구 enum 값 → 한국어 표시 (마이그레이션 전 데이터 호환)
const WINDOW_TYPE_LABEL: Record<string, string> = {
  OUTER: '외창', INNER: '내창',
}
const DIRECTION_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}

function getWindowLabel(val: string) {
  return WINDOW_TYPE_LABEL[val] ?? val
}

function getDirectionLabel(val: string) {
  return DIRECTION_LABEL[val] ?? val
}


function deriveFloor(roomNo: string): string {
  const digits = roomNo.replace(/\D/g, '')
  if (digits.length >= 3) return digits.slice(0, digits.length - 2)
  return ''
}

export default function RoomManageClient({
  initialRooms,
  roomTypes,
  roomTiers,
  windowTypes,
  directions,
}: {
  initialRooms: Room[]
  roomTypes: string[]
  roomTiers: string[]
  windowTypes: string[]
  directions: string[]
}) {
  const canEditUi = useCanEdit()   // 뷰어(STAFF) 편집 버튼 숨김(감사 D3)
  // #12: initialRooms를 useState로 캡처하면 router.refresh() 후에도 갱신 안 됨(즉시 적용·편집 미반영).
  //      prop을 직접 사용 → revalidatePath+router.refresh 페어로 즉시 반영. (feedback_auto_refresh)
  const rooms = initialRooms
  const windowTypeOptions  = windowTypes.map(v => ({ value: v, label: getWindowLabel(v) }))
  const directionOptions   = directions.map(v => ({ value: v, label: getDirectionLabel(v) }))

  // 검색 · 정렬
  const [search, setSearch]     = useUrlState('q', '')
  const [sortKey, setSortKey]   = useState<'roomNo' | 'baseRent' | 'vacancy'>('roomNo')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc')
  const [cardFields, toggleCardField] = useDisplayFields('roomManage.cardFields', RM_CARD_FIELDS)

  // 필터
  type AreaPyeongRange  = '' | '<1' | '1-2' | '2-3' | '3+'
  type AreaM2Range      = '' | '<3.3' | '3.3-6.6' | '6.6-9.9' | '9.9+'
  const [filterStatus, setFilterStatus]       = useState<RoomStatusKey | ''>('')
  const [showFilters, setShowFilters]         = useState(false)
  const [filterRoomNo, setFilterRoomNo]       = useState('')
  const [filterType, setFilterType]           = useState('')
  const [filterTier, setFilterTier]           = useState('')
  const [filterWindowType, setFilterWindowType] = useState('')
  const [filterDirection, setFilterDirection] = useState('')
  const [filterAreaPyeong, setFilterAreaPyeong] = useState<AreaPyeongRange>('')
  const [filterAreaM2, setFilterAreaM2]       = useState<AreaM2Range>('')
  const [filterRentMin, setFilterRentMin]     = useState<number | undefined>(undefined)
  const [filterRentMax, setFilterRentMax]     = useState<number | undefined>(undefined)

  const resetFilters = () => {
    setFilterRoomNo(''); setFilterType(''); setFilterTier(''); setFilterWindowType(''); setFilterDirection('')
    setFilterAreaPyeong(''); setFilterAreaM2('')
    setFilterRentMin(undefined); setFilterRentMax(undefined)
  }
  const activeFilterCount =
    (filterRoomNo ? 1 : 0) +
    (filterType ? 1 : 0) +
    (filterTier ? 1 : 0) +
    (filterWindowType ? 1 : 0) +
    (filterDirection ? 1 : 0) +
    (filterAreaPyeong ? 1 : 0) +
    (filterAreaM2 ? 1 : 0) +
    (filterRentMin != null || filterRentMax != null ? 1 : 0)

  const matchAreaPyeong = (val: number | null): boolean => {
    if (!filterAreaPyeong) return true
    if (val == null) return false
    if (filterAreaPyeong === '<1')   return val < 1
    if (filterAreaPyeong === '1-2')  return val >= 1 && val < 2
    if (filterAreaPyeong === '2-3')  return val >= 2 && val < 3
    if (filterAreaPyeong === '3+')   return val >= 3
    return true
  }
  const matchAreaM2 = (val: number | null): boolean => {
    if (!filterAreaM2) return true
    if (val == null) return false
    if (filterAreaM2 === '<3.3')     return val < 3.3
    if (filterAreaM2 === '3.3-6.6')  return val >= 3.3 && val < 6.6
    if (filterAreaM2 === '6.6-9.9')  return val >= 6.6 && val < 9.9
    if (filterAreaM2 === '9.9+')     return val >= 9.9
    return true
  }

  // 모달 상태
  const [showAddModal, setShowAddModal] = useState(false)
  const [editRoom, setEditRoom]         = useState<Room | null>(null)
  const [rentUpdateDateVal, setRentUpdateDateVal] = useState('')
  // 층 상태 — 등록·수정 모달
  const [addRoomNoVal, setAddRoomNoVal]   = useState('')
  const [addFloorVal, setAddFloorVal]     = useState('')
  const [editFloorVal, setEditFloorVal]   = useState('')
  // 비거주 이용료 상태 — 수정 모달
  const [nrEnabled, setNrEnabled]         = useState(false)
  const [nrDateVal, setNrDateVal]         = useState('')
  // 비거주 이용료 상태 — 등록 모달
  const [addNrEnabled, setAddNrEnabled]   = useState(false)
  const [addNrDateVal, setAddNrDateVal]   = useState('')

  // URL ?roomId=xxx 자동 열기 — ?edit=1 면 편집 폼, 아니면 Prism 셸의 호실 면.
  // handledOpenRef: 같은 요청은 1회만 처리 — initialRooms 갱신(저장 후 refresh)마다
  // effect 가 재실행되며 닫은 폼이 옛 데이터로 재오픈되던 레이스 방지(고객관리 edit=1 버그와 동일 패턴).
  const searchParams = useSearchParams()
  const handledOpenRef = useRef<string | null>(null)
  useEffect(() => {
    const roomId = searchParams.get('roomId')
    if (!roomId) { handledOpenRef.current = null; return }
    const key = `${roomId}:${searchParams.get('edit') ?? ''}`
    if (handledOpenRef.current === key) return
    const found = initialRooms.find(r => r.id === roomId)
    if (!found) return
    handledOpenRef.current = key
    if (searchParams.get('edit') === '1') openEdit(found)
    else entityModal.open({ kind: 'room', roomId })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, initialRooms])

  // 사진
  const [editPhotos, setEditPhotos]           = useState<Photo[]>([])
  const [viewPhoto, setViewPhoto]             = useState<Photo | null>(null)  // 큰 사진/360 뷰어 lightbox
  const [addPhotoPreviews, setAddPhotoPreviews] = useState<{ file: File; previewUrl: string }[]>([])
  const [photoUploading, setPhotoUploading]   = useState(false)
  const [photoProgress, setPhotoProgress]     = useState<{ name: string; percent: number; current: number; total: number } | null>(null)

  // 배치 선택
  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [showBatchEdit, setShowBatchEdit] = useState(false)
  const toggleSelectRoom = (id: string) => setSelectedIds(prev => {
    const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }

  // 기타
  const [types, setTypes]   = useState<string[]>(roomTypes)
  const [tiers, setTiers]   = useState<string[]>(roomTiers)
  const [error, setError]   = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const entityModal = useEntityModal()
  const photoInputRef    = useRef<HTMLInputElement>(null)
  const addPhotoInputRef = useRef<HTMLInputElement>(null)

  const currentTenant = (room: Room) => room.leaseTerms[0]?.tenant?.name ?? null

  // 검색 · 정렬 적용
  const filteredRooms = (() => {
    const q = search.trim().toLowerCase()
    const roomNoQ = filterRoomNo.trim().toLowerCase()
    const base = rooms.filter(r => {
      if (q) {
        const ok =
          r.roomNo.toLowerCase().includes(q) ||
          (currentTenant(r) ?? '').toLowerCase().includes(q) ||
          (r.type ?? '').toLowerCase().includes(q)
        if (!ok) return false
      }
      if (filterStatus && roomStatusKey(r) !== filterStatus) return false
      if (roomNoQ && !r.roomNo.toLowerCase().includes(roomNoQ)) return false
      if (filterType && r.type !== filterType) return false
      if (filterTier && r.tier !== filterTier) return false
      if (filterWindowType && r.windowType !== filterWindowType) return false
      if (filterDirection && r.direction !== filterDirection) return false
      if (!matchAreaPyeong(r.areaPyeong)) return false
      if (!matchAreaM2(r.areaM2)) return false
      if (filterRentMin != null && r.baseRent < filterRentMin) return false
      if (filterRentMax != null && r.baseRent > filterRentMax) return false
      return true
    })
    return [...base].sort((a, b) => {
      const dir = sortDir === 'asc' ? 1 : -1
      if (sortKey === 'vacancy') {
        const av = a.isVacant ? 1 : 0
        const bv = b.isVacant ? 1 : 0
        return dir * (av - bv)
      }
      if (sortKey === 'baseRent') return dir * (a.baseRent - b.baseRent)
      return dir * a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })
    })
  })()

  // ── 핸들러 ────────────────────────────────────────────────────────

  const openEdit = (room: Room) => {
    entityModal.close()
    setEditRoom(room)
    setEditPhotos(room.photos)
    setEditFloorVal(room.floor ?? '')
    setRentUpdateDateVal(room.rentUpdateDate ? new Date(room.rentUpdateDate).toISOString().slice(0, 10) : '')
    setNrEnabled(room.nonResidentRent != null)
    setNrDateVal(room.nonResidentRentDate ? new Date(room.nonResidentRentDate).toISOString().slice(0, 10) : '')
    setError('')
  }

  // URL ?roomId·?edit=1 정리 — 안 지우면 저장/닫기 후에도 파라미터가 남는다.
  // 그 상태에서 같은 방을 다시 [수정](EntityModal)하면 router.push 가 '동일 URL' 이라 무시되고
  // handledOpenRef 도 그대로라 useEffect 가 openEdit 을 호출하지 않아 → 셸만 닫히고 편집 폼이
  // 안 열려 목록으로 '튕겨나오는' 문제가 생긴다(고객관리 clearTenantUrlParams 와 동일 패턴).
  const clearRoomUrlParams = () => {
    if (searchParams.get('edit') === '1' || searchParams.get('roomId')) {
      const params = new URLSearchParams(searchParams.toString())
      params.delete('edit'); params.delete('roomId')
      const qs = params.toString()
      router.replace(qs ? `?${qs}` : '?', { scroll: false })
    }
  }

  const closeEdit = () => {
    setEditRoom(null)
    setEditPhotos([])
    setEditFloorVal('')
    setNrEnabled(false)
    setNrDateVal('')
    setError('')
    clearRoomUrlParams()
  }

  const closeAddModal = () => {
    addPhotoPreviews.forEach(p => URL.revokeObjectURL(p.previewUrl))
    setAddPhotoPreviews([])
    setAddNrEnabled(false)
    setAddNrDateVal('')
    setAddRoomNoVal('')
    setAddFloorVal('')
    setShowAddModal(false)
    setError('')
  }

  const MAX_PHOTOS = 10

  const handleAddPhotoSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return
    const files = Array.from(e.target.files)
    const remaining = MAX_PHOTOS - addPhotoPreviews.length
    if (remaining <= 0) { setError(`사진은 최대 ${MAX_PHOTOS}장까지 추가할 수 있습니다.`); e.target.value = ''; return }
    const newPreviews = files.slice(0, remaining).map(file => ({
      file, previewUrl: URL.createObjectURL(file),
    }))
    setAddPhotoPreviews(prev => [...prev, ...newPreviews])
    e.target.value = ''
  }

  const removeAddPhoto = (index: number) => {
    setAddPhotoPreviews(prev => {
      URL.revokeObjectURL(prev[index].previewUrl)
      return prev.filter((_, i) => i !== index)
    })
  }

  const handleAdd = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await addRoom(formData)
        if (!res.ok) { pushToast('error', res.error); return }
        let failedPhotos = 0
        for (const { file } of addPhotoPreviews) {
          try {
            const session = await createPhotoUploadSession({
              roomId: res.id,
              fileName: file.name,
              mimeType: file.type,
              fileSize: file.size,
              origin: window.location.origin,
            })
            if (!session.ok) { failedPhotos++; continue }
            const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file, () => {})
            await finalizeRoomPhoto({ roomId: res.id, driveFileId, fileName: file.name })
          } catch (err) {
            console.error('[handleAdd photo]', err)
            failedPhotos++   // 일부 사진 실패해도 나머지/호실 자체는 유지, 실패 장수는 아래서 안내
          }
        }
        closeAddModal()
        router.refresh()
        pushToast('success', '호실 추가됨')
        if (failedPhotos > 0) pushToast('info', `사진 ${failedPhotos}장은 업로드하지 못했어요. 호실 수정에서 다시 추가해 주세요.`)
      } finally { release() }
    })
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await updateRoom(formData)
        if (res && !res.ok) { pushToast('error', res.error); return }
        closeEdit()
        // 전체 새로고침(window.reload) 대신 soft refresh — 토스트가 살아남고,
        // URL ?roomId&edit=1 이 남아 있어도 handledOpenRef 가 유지돼 폼이 재오픈되지 않음
        // (full reload 시 ref 초기화로 수정 팝업이 되돌아오던 글리치 해소).
        router.refresh()
        pushToast('success', '호실 수정됨')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '오류가 발생했습니다.'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!editRoom || !e.target.files?.length) return
    const files = Array.from(e.target.files)
    if (editPhotos.length >= MAX_PHOTOS) {
      setError(`사진은 최대 ${MAX_PHOTOS}장까지 추가할 수 있습니다.`)
      e.target.value = ''; return
    }
    const toUpload = files.slice(0, MAX_PHOTOS - editPhotos.length)
    setPhotoUploading(true); setError('')
    try {
      for (let i = 0; i < toUpload.length; i++) {
        const file = toUpload[i]
        setPhotoProgress({ name: file.name, percent: 0, current: i + 1, total: toUpload.length })
        try {
          // 1) 서버에 Drive 업로드 세션 요청 (파일은 보내지 않음 — 메타데이터만)
          const session = await createPhotoUploadSession({
            roomId: editRoom.id,
            fileName: file.name,
            mimeType: file.type,
            fileSize: file.size,
            origin: window.location.origin,
          })
          if (!session.ok) { setError(session.error); break }

          // 2) 클라이언트가 Drive로 직접 PUT 업로드 (Vercel 함수 우회)
          const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file, percent =>
            setPhotoProgress({ name: file.name, percent, current: i + 1, total: toUpload.length })
          )

          // 3) 권한 설정 + DB 저장
          const fin = await finalizeRoomPhoto({
            roomId: editRoom.id,
            driveFileId,
            fileName: file.name,
          })
          if (!fin.ok) { setError(fin.error); break }
          setEditPhotos(prev => [...prev, { id: fin.id, driveFileId: fin.driveFileId, storageUrl: fin.storageUrl, fileName: fin.fileName }])
        } catch (err) {
          console.error('[handlePhotoUpload]', err)
          setError(`업로드 중 오류: ${(err as Error).message ?? '알 수 없는 오류'}`)
          break
        }
      }
    } finally {
      setPhotoUploading(false)
      setPhotoProgress(null)
      e.target.value = ''
    }
  }

  const handlePhotoDelete = async (photoId: string) => {
    if (!(await confirmDialog({ title: '이 사진을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    const res = await deleteRoomPhoto(photoId)
    if (!res.ok) { setError(res.error); return }
    setEditPhotos(prev => prev.filter(p => p.id !== photoId))
  }

  const TypeSection = ({ defaultValue }: { defaultValue?: string }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
      <select name="type" defaultValue={defaultValue ?? ''}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[0.65625rem] text-[var(--warm-muted)]">방 타입 추가·관리는 환경설정에서 할 수 있습니다.</p>
    </div>
  )

  const TierSection = ({ defaultValue }: { defaultValue?: string }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">등급</label>
      <select name="tier" defaultValue={defaultValue ?? ''}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {tiers.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[0.65625rem] text-[var(--warm-muted)]">등급(스탠다드/실속형 등) 추가·관리는 환경설정에서 할 수 있습니다.</p>
    </div>
  )

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-4">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">호실 관리</h1>
          {(() => {
            const occupied = rooms.filter(r => r.leaseTerms[0]?.status === 'ACTIVE' || r.leaseTerms[0]?.status === 'CHECKOUT_PENDING').length
            const reserved = rooms.filter(r => r.leaseTerms[0]?.status === 'RESERVED').length
            const vacant   = rooms.filter(r => r.leaseTerms.length === 0).length
            return (
              <p className="text-sm text-[var(--warm-muted)] mt-0.5">
                전체 {rooms.length}실
                <span className="mx-1.5 text-[var(--warm-border)]">·</span>
                거주중 {occupied}실
                {reserved > 0 && (
                  <>
                    <span className="mx-1.5 text-[var(--warm-border)]">·</span>
                    예약 {reserved}실
                  </>
                )}
                <span className="mx-1.5 text-[var(--warm-border)]">·</span>
                공실 {vacant}실
              </p>
            )
          })()}
        </div>
        {/* 뷰어(STAFF)에겐 편집 진입 숨김(감사 D3) */}
        {canEditUi && (
        <div className="flex items-center gap-2">
          <Btn variant="secondary" size="md" onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
            {selectMode ? '선택 취소' : '선택'}
          </Btn>
          <Btn variant="primary" size="md" onClick={() => { setShowAddModal(true); setError('') }}>
            + 호실 등록
          </Btn>
        </div>
        )}
      </div>

      {/* 검색바 + 필터 토글 — v2.0 §23 공용 SearchBar. 스크롤 시 상단 고정 */}
      <div className="flex gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={search} onChange={setSearch} placeholder="호실 번호, 입주자 이름, 방 타입 검색" className="flex-1" />
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
            showFilters || activeFilterCount > 0
              ? 'bg-[var(--coral)] text-[var(--on-solid)]'
              : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
          }`}
        >
          필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

      {/* 상태 빠른 필터 — v2.0 §23 공용 SegmentedControl(수납·고객과 동일). '전체'가 곧 해제. */}
      {(() => {
        const counts = rooms.reduce((acc, r) => { const k = roomStatusKey(r); acc[k] = (acc[k] ?? 0) + 1; return acc }, {} as Record<RoomStatusKey, number>)
        return (
          <SegmentedControl<RoomStatusKey | ''>
            size="sm"
            scroll
            ariaLabel="호실 상태 필터"
            value={filterStatus}
            onChange={setFilterStatus}
            options={[
              { value: '', label: `전체 ${rooms.length}` },
              ...STATUS_FILTERS.map(s => ({ value: s.key, label: `${s.label} ${counts[s.key] ?? 0}` })),
            ]}
          />
        )
      })()}

      {/* 필터 패널 */}
      {showFilters && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호</label>
              <input
                value={filterRoomNo}
                onChange={e => setFilterRoomNo(e.target.value)}
                placeholder="예: 401, 5"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {types.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">등급</label>
              <select
                value={filterTier}
                onChange={e => setFilterTier(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {tiers.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">창문 타입</label>
              <select
                value={filterWindowType}
                onChange={e => setFilterWindowType(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {windowTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방향</label>
              <select
                value={filterDirection}
                onChange={e => setFilterDirection(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                {directionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">면적 (평)</label>
              <select
                value={filterAreaPyeong}
                onChange={e => setFilterAreaPyeong(e.target.value as AreaPyeongRange)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                <option value="<1">1평 미만</option>
                <option value="1-2">1평~2평 미만</option>
                <option value="2-3">2평~3평 미만</option>
                <option value="3+">3평 이상</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">면적 (㎡)</label>
              <select
                value={filterAreaM2}
                onChange={e => setFilterAreaM2(e.target.value as AreaM2Range)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              >
                <option value="">전체</option>
                <option value="<3.3">3.3㎡ 미만</option>
                <option value="3.3-6.6">3.3㎡~6.6㎡ 미만</option>
                <option value="6.6-9.9">6.6㎡~9.9㎡ 미만</option>
                <option value="9.9+">9.9㎡ 이상</option>
              </select>
            </div>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료 범위 (원)</label>
            <div className="flex items-center gap-2">
              <MoneyInput
                value={filterRentMin}
                onChange={v => setFilterRentMin(v && v > 0 ? v : undefined)}
                placeholder="최소"
              />
              <span className="text-[var(--warm-muted)] text-sm">~</span>
              <MoneyInput
                value={filterRentMax}
                onChange={v => setFilterRentMax(v && v > 0 ? v : undefined)}
                placeholder="최대"
              />
            </div>
          </div>
          <div className="flex gap-2 pt-1">
            <Btn
              type="button"
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={resetFilters}
            >
              초기화
            </Btn>
            <Btn
              type="button"
              variant="primary"
              size="sm"
              className="flex-1"
              onClick={() => setShowFilters(false)}
            >
              닫기
            </Btn>
          </div>
        </div>
      )}

      {/* 정렬 + 표시 항목 */}
      <div className="flex items-center justify-between gap-2">
        <SortSelect
          ariaLabel="호실 정렬 기준"
          value={sortKey}
          dir={sortDir}
          onChange={sk => { setSortKey(sk); setSortDir('asc') }}
          onToggleDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          options={[
            { value: 'roomNo',   label: '호실순' },
            { value: 'vacancy',  label: '공실' },
            { value: 'baseRent', label: '이용료' },
          ]}
        />
        <DisplayFieldsMenu fields={RM_CARD_FIELDS} visible={cardFields} onToggle={toggleCardField} />
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-xl p-3">
          <p className="text-[var(--danger-fg)] text-sm">{error}</p>
        </div>
      )}

      {/* 호실 그리드 — 빈 상태는 v2.0 §17 공용 EmptyState */}
      {filteredRooms.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" /></svg>}
          title={search ? '검색 결과가 없습니다' : '등록된 호실이 없습니다'}
          description={search ? '다른 검색어로 시도해 보세요.' : '호실 등록 버튼을 눌러 시작하세요.'}
        />
      ) : (
        <div className="space-y-2">
          {filteredRooms.map(room => {
            const tenant = currentTenant(room)
            const thumb  = room.photos[0]
            const rs     = getRoomStatus(room)
            // Status Row 팁/틴트 톤 — 예약·퇴실은 배지 톤, 거주중은 olive(paid),
            // 공실은 RoomCard vacant 기본(ink-mute 팁) 유지.
            const tipTone: BadgeTone | null = rs.badge ? rs.badge.tone : rs.kind === 'resident' ? 'paid' : null
            const selected = selectMode && selectedIds.has(room.id)
            return (
              <RoomCard key={room.id}
                kind={rs.kind}
                selected={selected}
                tipColor={tipTone ? statusTipColor(tipTone) : undefined}
                tipBg={tipTone ? statusRowTint(tipTone) : undefined}
                onClick={() => selectMode ? toggleSelectRoom(room.id) : (entityModal.open({ kind: 'room', roomId: room.id }), setError(''))}
                onLongPress={!selectMode ? () => { setSelectMode(true); toggleSelectRoom(room.id) } : undefined}
                className="overflow-hidden flex items-stretch">
                {/* 정보 */}
                <div className="flex-1 p-4 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-base font-bold ${rs.kind === 'vacant' ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'}`}>{fmtRoomNo(room.roomNo)}</span>
                    {cardFields.floor && room.floor && (
                      <span className="text-[0.65625rem] px-2 py-0.5 rounded-full font-medium shrink-0 bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        {room.floor}층
                      </span>
                    )}
                    {rs.badge && <StatusBadge tone={rs.badge.tone}>{rs.badge.label}</StatusBadge>}
                    {room.noMoveInReport && <StatusBadge tone="exit">전입신고 불가</StatusBadge>}
                  </div>
                  {cardFields.tenant && tenant && <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{tenant}</p>}
                  <div className="space-y-0.5 pt-0.5">
                    {cardFields.spec && (
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--warm-muted)]">
                        {room.type && <span>{room.type}</span>}
                        {room.tier && <span>{room.tier}</span>}
                        {(room.windowType || room.direction) && (
                          <span>
                            {[
                              room.windowType ? getWindowLabel(room.windowType) : null,
                              room.direction  ? getDirectionLabel(room.direction) : null,
                            ].filter(Boolean).join(' · ')}
                          </span>
                        )}
                        {(room.areaPyeong || room.areaM2) && (
                          <span>
                            {[
                              room.areaPyeong ? `${room.areaPyeong}평` : null,
                              room.areaM2     ? `${room.areaM2}㎡`    : null,
                            ].filter(Boolean).join(' / ')}
                          </span>
                        )}
                      </div>
                    )}
                    <p className="text-sm font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></p>
                    {cardFields.scheduled && room.scheduledRent != null && (
                      <p className="text-xs text-[var(--warm-mid)]">
                        → <MoneyDisplay amount={room.scheduledRent} />
                        {room.rentUpdateDate && <span className="text-[var(--warm-muted)] ml-1">({fmtDate(room.rentUpdateDate)})</span>}
                      </p>
                    )}
                  </div>
                </div>
                {/* 썸네일 (오른쪽) */}
                {cardFields.photo && (
                  <div className="w-24 sm:w-28 shrink-0 bg-[var(--canvas)]">
                    {thumb ? (
                      <img src={thumb.storageUrl} alt={fmtRoomNo(room.roomNo)} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.4 }}>
                          <path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" />
                        </svg>
                      </div>
                    )}
                  </div>
                )}
              </RoomCard>
            )
          })}
        </div>
      )}

      {/* 상세 모달은 전역 Prism 셸(EntityModal)이 담당. 카드 클릭이 entityModal.open() 호출 */}

      {/* ── 배치 편집 모달 ─────────────────────────────────────────────── */}
      {showBatchEdit && (
        <BatchEditRoomsModal
          selectedIds={Array.from(selectedIds)}
          roomTypes={types}
          roomTiers={tiers}
          windowTypeOptions={windowTypeOptions}
          directionOptions={directionOptions}
          onClose={() => setShowBatchEdit(false)}
          onDone={() => { setShowBatchEdit(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 배치 액션 바 — v2.0 §22 공용 SelectionPillBar */}
      {selectMode && selectedIds.size > 0 && (
        <SelectionPillBar count={selectedIds.size} unit="실" onClose={exitSelectMode}>
          <PillButton primary onClick={() => setShowBatchEdit(true)}>일괄 편집</PillButton>
        </SelectionPillBar>
      )}

      {/* ── 호실 추가 모달 ──────────────────────────────────────────── */}
      {showAddModal && (
        <Modal title="호실 등록" onClose={closeAddModal}>
          <form onSubmit={handleAdd} className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호 *</label>
                <input
                  name="roomNo"
                  placeholder="예: 101, A동-3, 옥탑방"
                  value={addRoomNoVal}
                  onChange={e => {
                    const val = e.target.value
                    setAddRoomNoVal(val)
                    setAddFloorVal(deriveFloor(val))
                  }}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <input
                  name="floor"
                  placeholder="자동"
                  value={addFloorVal}
                  onChange={e => setAddFloorVal(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
            </div>
            <TypeSection />
            <TierSection />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">기본 월 이용료</label>
              <MoneyInput name="baseRent" placeholder="0원" />
            </div>

            {/* 비거주 이용료 설정 */}
            <div className="border border-[var(--warm-border)] rounded-xl p-3.5 space-y-3">
              <input type="hidden" name="nonResidentEnabled" value={addNrEnabled ? '1' : '0'} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--warm-mid)]">비거주 이용료 설정</p>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">일반 이용료와 별도로 비거주자 전용 금액을 설정합니다</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" className="sr-only" checked={addNrEnabled} onChange={e => setAddNrEnabled(e.target.checked)} />
                  <div className={`w-9 h-5 rounded-full transition-colors ${addNrEnabled ? 'bg-[var(--coral)]' : 'bg-[var(--warm-border)]'}`} />
                  <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-[var(--cream)] rounded-full shadow transition-transform ${addNrEnabled ? 'translate-x-4' : ''}`} />
                </label>
              </div>
              {addNrEnabled && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">비거주 월이용료</label>
                    <MoneyInput name="nonResidentRent" placeholder="0원" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">예약 이용료 <span className="text-[var(--warm-muted)]">(선택)</span></label>
                      <MoneyInput name="nonResidentScheduled" placeholder="미설정" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일</label>
                      <DatePicker name="nonResidentRentDate" value={addNrDateVal} onChange={setAddNrDateVal}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="창문 타입" name="windowType" options={windowTypeOptions}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
              <SelectField label="방향" name="direction" options={directionOptions}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
            </div>
            <AreaInput />
            <Field label="메모" name="memo" placeholder="방 컨디션 메모" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--warm-mid)]">사진</label>
                <button type="button" onClick={() => addPhotoInputRef.current?.click()}
                  className="text-xs text-[var(--coral)] hover:text-[var(--coral)] transition-colors">
                  + 사진 선택
                </button>
                <input ref={addPhotoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handleAddPhotoSelect} />
              </div>
              {addPhotoPreviews.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {addPhotoPreviews.map((p, i) => (
                    <div key={p.previewUrl} className="relative group aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]">
                      <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeAddPhoto(i)} aria-label="사진 삭제"
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div onClick={() => addPhotoInputRef.current?.click()}
                  className="h-20 border border-dashed border-[var(--warm-border)] rounded-xl flex items-center justify-center cursor-pointer hover:border-[var(--warm-border)] transition-colors">
                  <p className="text-xs text-[var(--warm-muted)]">클릭하여 사진 선택 (추가 시 업로드)</p>
                </div>
              )}
            </div>

            {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Btn type="button" variant="secondary" onClick={closeAddModal} fullWidth>취소</Btn>
              <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                {isPending ? '저장 중…' : `저장${addPhotoPreviews.length > 0 ? ` (사진 ${addPhotoPreviews.length}장)` : ''}`}
              </Btn>
            </div>
          </form>
        </Modal>
      )}

      {/* ── 호실 수정 모달 ──────────────────────────────────────────── */}
      {editRoom && (
        <Modal title={`${fmtRoomNo(editRoom.roomNo)} 수정`} onClose={closeEdit}>
          <form onSubmit={handleUpdate} className="space-y-4">
            <input type="hidden" name="id" value={editRoom.id} />
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2 space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호 *</label>
                <input
                  name="roomNo"
                  defaultValue={editRoom.roomNo}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <input
                  name="floor"
                  placeholder="예: 1"
                  value={editFloorVal}
                  onChange={e => setEditFloorVal(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
            </div>
            <TypeSection defaultValue={editRoom.type ?? ''} />
            <TierSection defaultValue={editRoom.tier ?? ''} />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">기본 월 이용료</label>
              <MoneyInput name="baseRent" defaultValue={editRoom.baseRent} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">예약 이용료 <span className="text-[var(--warm-muted)]">(가격 예약)</span></label>
                <MoneyInput name="scheduledRent" defaultValue={editRoom.scheduledRent ?? undefined} placeholder="미설정" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일</label>
                <DatePicker name="rentUpdateDate" value={rentUpdateDateVal} onChange={setRentUpdateDateVal}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
              </div>
            </div>

            {/* 비거주 이용료 설정 */}
            <div className="border border-[var(--warm-border)] rounded-xl p-3.5 space-y-3">
              <input type="hidden" name="nonResidentEnabled" value={nrEnabled ? '1' : '0'} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--warm-mid)]">비거주 이용료 설정</p>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">일반 이용료와 별도로 비거주자 전용 금액을 설정합니다</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input type="checkbox" className="sr-only" checked={nrEnabled} onChange={e => setNrEnabled(e.target.checked)} />
                  <div className={`w-9 h-5 rounded-full transition-colors ${nrEnabled ? 'bg-[var(--coral)]' : 'bg-[var(--warm-border)]'}`} />
                  <div className={`absolute left-0.5 top-0.5 w-4 h-4 bg-[var(--cream)] rounded-full shadow transition-transform ${nrEnabled ? 'translate-x-4' : ''}`} />
                </label>
              </div>
              {nrEnabled && (
                <div className="space-y-3 pt-1">
                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-[var(--warm-mid)]">비거주 월이용료</label>
                    <MoneyInput name="nonResidentRent" defaultValue={editRoom.nonResidentRent ?? undefined} placeholder="0원" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">예약 이용료 <span className="text-[var(--warm-muted)]">(선택)</span></label>
                      <MoneyInput name="nonResidentScheduled" defaultValue={editRoom.nonResidentScheduled ?? undefined} placeholder="미설정" />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일</label>
                      <DatePicker name="nonResidentRentDate" value={nrDateVal} onChange={setNrDateVal}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <SelectField label="창문 타입" name="windowType" options={windowTypeOptions} defaultValue={editRoom.windowType ?? ''}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
              <SelectField label="방향" name="direction" options={directionOptions} defaultValue={editRoom.direction ?? ''}
                hint="추가·관리는 환경설정에서 할 수 있습니다." />
            </div>
            <AreaInput defaultPyeong={editRoom.areaPyeong} defaultM2={editRoom.areaM2} />
            <Field label="메모" name="memo" defaultValue={editRoom.memo ?? ''} />

            {/* 방 특성 (2026-07-06, 운영자 요청 — 415 창고·사무실 사례) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방 특성</label>
              <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
                <input type="checkbox" name="noMoveInReport" value="1" defaultChecked={editRoom.noMoveInReport}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                전입신고 불가 <span className="text-[var(--warm-muted)]">(등록 시 경고 + 카드에 표시)</span>
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--warm-dark)] cursor-pointer">
                <input type="checkbox" defaultChecked={!editRoom.nonResidentVacant}
                  onChange={e => { const h = e.currentTarget.form?.elements.namedItem('nonResidentVacant') as HTMLInputElement | null; if (h) h.value = e.currentTarget.checked ? '0' : '1' }}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                비거주 점유 시 공실로 표시하지 않음 <span className="text-[var(--warm-muted)]">(창고·사무실 등)</span>
              </label>
              <input type="hidden" name="nonResidentVacant" defaultValue={editRoom.nonResidentVacant ? '1' : '0'} />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--warm-mid)]">사진</label>
                <button type="button" onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="text-xs text-[var(--coral)] hover:text-[var(--coral)] transition-colors disabled:opacity-50">
                  {photoUploading ? '업로드 중…' : '+ 사진 추가'}
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handlePhotoUpload} />
              </div>
              {editPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {editPhotos.map(photo => (
                    <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]">
                      <img src={photo.storageUrl} alt={photo.fileName ?? ''}
                        onClick={() => setViewPhoto(photo)}
                        className="w-full h-full object-cover cursor-zoom-in" />
                      {looksLike360(photo.fileName) && (
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-full bg-black/65 text-white text-[0.65625rem] font-bold pointer-events-none">360°</span>
                      )}
                      <button type="button" onClick={() => handlePhotoDelete(photo.id)} aria-label="사진 삭제"
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-[var(--danger-solid)]/80 rounded-full text-white transition-colors flex items-center justify-center">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
                      </button>
                    </div>
                  ))}
                  {photoUploading && (
                    <div className="aspect-square rounded-lg bg-[var(--canvas)] flex flex-col items-center justify-center gap-1">
                      <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                      {photoProgress && (
                        <span className="text-[0.65625rem] text-[var(--warm-muted)]">{photoProgress.percent}%</span>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <div onClick={() => photoInputRef.current?.click()}
                  className="h-20 border border-dashed border-[var(--warm-border)] rounded-xl flex items-center justify-center cursor-pointer hover:border-[var(--warm-border)] transition-colors">
                  {photoUploading
                    ? <div className="flex flex-col items-center gap-1">
                        <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                        {photoProgress && (
                          <span className="text-[0.65625rem] text-[var(--warm-muted)]">{photoProgress.percent}%</span>
                        )}
                      </div>
                    : <p className="text-xs text-[var(--warm-muted)]">클릭하여 사진 업로드</p>}
                </div>
              )}
              {photoProgress && photoProgress.total > 1 && (
                <p className="text-[0.65625rem] text-[var(--warm-muted)] text-right">
                  업로드 중 ({photoProgress.current}/{photoProgress.total}) · {photoProgress.percent}%
                </p>
              )}
            </div>

            {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Btn type="button" variant="secondary" onClick={closeEdit} fullWidth>취소</Btn>
              <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                {isPending ? '저장 중…' : '저장'}
              </Btn>
            </div>
          </form>
        </Modal>
      )}

      {/* 큰 사진 / 360 뷰어 lightbox */}
      {viewPhoto && (
        <PhotoLightbox photo={viewPhoto} onClose={() => setViewPhoto(null)} />
      )}

    </div>
  )
}

// 사진 lightbox — 큰 사진 + 360 뷰어. 360 판정: 파일명 단서(기본) + 2:1 종횡비 자동 감지 + 수동 토글.
function PhotoLightbox({ photo, onClose }: { photo: Photo; onClose: () => void }) {
  const hiRes = photo.driveFileId ? driveImageUrl(photo.driveFileId, 2048) : photo.storageUrl
  const [is360, setIs360] = useState(looksLike360(photo.fileName))
  // 360 전환 버튼은 360 가능 사진일 때만 노출 — 파일명 단서 또는 2:1(equirectangular) 비율 감지 시.
  const [ratioIs360, setRatioIs360] = useState(false)
  const canBe360 = looksLike360(photo.fileName) || ratioIs360
  const manualRef = useRef(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleImgLoad = (e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget
    const ratio = img.naturalWidth / img.naturalHeight
    const is2to1 = ratio >= 1.9 && ratio <= 2.1
    setRatioIs360(is2to1)
    if (is2to1 && !manualRef.current) setIs360(true)  // 2:1 → 360 자동 전환
  }

  return (
    <div className="fixed inset-0 z-[var(--z-lightbox)] bg-black/90 flex flex-col" onClick={onClose}>
      <div className="flex items-center justify-between gap-2 px-4 py-3 shrink-0" onClick={e => e.stopPropagation()}>
        <span className="text-white/80 text-sm font-medium truncate">{photo.fileName ?? '사진'}{is360 && ' · 360°'}</span>
        <div className="flex items-center gap-2 shrink-0">
          {canBe360 && (
            <button type="button" onClick={() => { manualRef.current = true; setIs360(v => !v) }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-white/15 text-white hover:bg-white/25 transition-colors">
              {is360 ? '일반 사진으로 보기' : '360°로 보기'}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label="닫기"
            className="w-8 h-8 rounded-full bg-white/15 text-white hover:bg-white/25 transition-colors flex items-center justify-center"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
      </div>
      <div className="flex-1 min-h-0 px-3 pb-2" onClick={e => e.stopPropagation()}>
        {is360 ? (
          <Panorama360 url={hiRes} className="w-full h-full rounded-xl overflow-hidden" />
        ) : (
          <ZoomableImage src={hiRes} alt={photo.fileName ?? ''} onImgLoad={handleImgLoad} />
        )}
      </div>
      <p className="text-center text-white/40 text-[0.65625rem] pb-3 shrink-0" onClick={e => e.stopPropagation()}>
        {is360 ? '드래그해서 둘러보기 · 휠로 확대/축소' : '두 손가락으로 확대/축소 · 두 번 탭하면 확대 · 배경을 누르면 닫힘'}
      </p>
    </div>
  )
}

// 일반 사진 줌 뷰어 — 핀치(두 손가락)·휠 확대축소 + 더블탭/더블클릭 확대 + 확대 시 드래그 팬.
function ZoomableImage({ src, alt, onImgLoad }: {
  src: string; alt: string; onImgLoad?: (e: React.SyntheticEvent<HTMLImageElement>) => void
}) {
  const MAX = 4
  const [scale, setScale] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const wrapRef = useRef<HTMLDivElement>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map())
  const pinch = useRef<{ dist: number; scale: number } | null>(null)
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)
  const tap = useRef<{ t: number; x: number; y: number; moved: boolean } | null>(null)
  const lastTap = useRef(0)

  // 확대 상태에서 이미지가 화면 밖으로 과하게 빠지지 않게 오프셋 제한
  const clamp = (o: { x: number; y: number }, s: number) => {
    const img = imgRef.current, wrap = wrapRef.current
    if (!img || !wrap) return o
    const maxX = Math.max(0, (img.offsetWidth * s - wrap.clientWidth) / 2)
    const maxY = Math.max(0, (img.offsetHeight * s - wrap.clientHeight) / 2)
    return { x: Math.max(-maxX, Math.min(maxX, o.x)), y: Math.max(-maxY, Math.min(maxY, o.y)) }
  }
  const applyScale = (next: number) => {
    const s = Math.max(1, Math.min(MAX, next))
    setScale(s)
    setOffset(o => clamp(s === 1 ? { x: 0, y: 0 } : o, s))
  }
  const toggleZoom = () => applyScale(scale > 1 ? 1 : 2)

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), scale }
      drag.current = null; tap.current = null
    } else {
      drag.current = scale > 1 ? { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y } : null
      tap.current = { t: Date.now(), x: e.clientX, y: e.clientY, moved: false }
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (pinch.current && pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      applyScale(pinch.current.scale * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.current.dist))
      return
    }
    if (tap.current && Math.hypot(e.clientX - tap.current.x, e.clientY - tap.current.y) > 16) tap.current.moved = true
    if (drag.current) setOffset(clamp({ x: drag.current.ox + (e.clientX - drag.current.x), y: drag.current.oy + (e.clientY - drag.current.y) }, scale))
  }
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (pointers.current.size === 0) drag.current = null
    const t = tap.current
    if (t && !t.moved && Date.now() - t.t < 400) {
      const now = Date.now()
      if (now - lastTap.current < 400) { toggleZoom(); lastTap.current = 0 }
      else lastTap.current = now
    }
    tap.current = null
  }

  return (
    <div ref={wrapRef}
      className="w-full h-full flex items-center justify-center overflow-hidden"
      style={{ touchAction: 'none' }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}
      onWheel={e => applyScale(scale - e.deltaY * 0.003)}
      onDoubleClick={toggleZoom}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img ref={imgRef} src={src} alt={alt} onLoad={onImgLoad} draggable={false}
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
          transformOrigin: 'center', cursor: scale > 1 ? 'grab' : 'auto',
        }}
        className="max-w-full max-h-full object-contain rounded-xl select-none" />
    </div>
  )
}

// Drive resumable upload — XHR로 진행률 추적 + Drive에 직접 PUT
function uploadFileToDriveSession(
  uploadUrl: string,
  file: File,
  onProgress: (percent: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    let settled = false
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn() } }

    xhr.open('PUT', uploadUrl, true)
    xhr.responseType = 'text'
    // Content-Type은 세션 생성 시 X-Upload-Content-Type과 일치해야 함
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream')

    xhr.upload.onprogress = e => {
      if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100))
    }

    const dump = () => `status=${xhr.status} statusText=${xhr.statusText || '(빈)'} readyState=${xhr.readyState} body=${(xhr.responseText || '').slice(0, 400) || '(빈)'}`

    xhr.onload = () => settle(() => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try {
          const body = JSON.parse(xhr.responseText) as { id?: string }
          if (!body.id) return reject(new Error(`Drive 응답에 파일 ID 없음 · ${dump()}`))
          resolve(body.id)
        } catch (err) {
          reject(new Error(`Drive 응답 파싱 실패 · ${(err as Error).message} | ${dump()}`))
        }
      } else if (xhr.status === 0) {
        // CORS 차단 또는 네트워크 단절 시 일반적으로 status=0
        reject(new Error(`Drive 응답 차단 (CORS 의심) · ${dump()}`))
      } else {
        reject(new Error(`Drive 업로드 거절 · ${dump()}`))
      }
    })

    xhr.onerror = () => settle(() => {
      // 가장 흔한 케이스: status=0 — CORS 또는 네트워크
      reject(new Error(`네트워크/CORS 오류 · ${dump()}`))
    })
    xhr.upload.onerror = () => settle(() => {
      reject(new Error(`업로드 전송 중 오류 · ${dump()}`))
    })
    xhr.onabort = () => settle(() => reject(new Error(`업로드 중단 · ${dump()}`)))
    xhr.ontimeout = () => settle(() => reject(new Error(`업로드 타임아웃 · ${dump()}`)))

    xhr.send(file)
  })
}

// ── 호실 일괄 편집 모달 ──────────────────────────────────────────

function BatchEditRoomsModal({ selectedIds, roomTypes, roomTiers, windowTypeOptions, directionOptions, onClose, onDone }: {
  selectedIds: string[]
  roomTypes: string[]
  roomTiers: string[]
  windowTypeOptions: { value: string; label: string }[]
  directionOptions: { value: string; label: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const [type, setType]             = useState('')
  const [tier, setTier]             = useState('')
  const [baseRent, setBaseRent]     = useState<number | undefined>(undefined)
  const [scheduledRent, setScheduledRent] = useState<number | undefined>(undefined)
  const [rentUpdateDateVal, setRentUpdateDateVal] = useState('')
  const [clearScheduled, setClearScheduled] = useState(false)
  const [windowType, setWindowType] = useState('')
  const [direction, setDirection]   = useState('')
  const [pending, setPending]       = useState(false)
  const [error, setError]           = useState('')

  const handleApply = async () => {
    const data: Parameters<typeof batchUpdateRooms>[1] = {}
    if (type) data.type = type
    if (tier) data.tier = tier
    if (baseRent != null) data.baseRent = baseRent
    if (clearScheduled) data.scheduledRent = null
    else if (scheduledRent != null) {
      if (!rentUpdateDateVal) { setError('예약이용료를 설정하려면 적용 예정일을 함께 지정하세요. (적용일이 없으면 적용되지 않습니다)'); return }
      data.scheduledRent = scheduledRent
      data.rentUpdateDate = new Date(rentUpdateDateVal)
    }
    if (windowType) data.windowType = windowType
    if (direction)  data.direction  = direction

    if (Object.keys(data).length === 0) { setError('변경할 항목을 하나 이상 입력하세요.'); return }

    setPending(true); setError('')
    const res = await batchUpdateRooms(selectedIds, data)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    {
      const u = res.undo
      pushToast('success', `${res.count}개 호실 업데이트 완료`, {
        action: { label: '적용취소', run: () => { void undoBatchUpdateRooms(u).then(r => { if (r.ok) pushToast('info', '일괄 수정을 적용취소했습니다 (동기화된 계약 임대료 포함 복원)'); else pushToast('error', r.error) }) } },
      })
    }
    if ((res.skippedNegotiated ?? 0) > 0) {
      pushToast('info', `협의 임대료(기준가와 다른 금액) 계약 ${res.skippedNegotiated}건은 덮어쓰지 않았습니다. 필요하면 고객관리에서 개별 변경하세요.`)
    }
    onDone()
  }

  return (
    <Modal title={`호실 일괄 편집 (${selectedIds.length}개)`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--warm-muted)]">입력하지 않은 항목은 변경되지 않습니다.</p>
        {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{error}</p>}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
          <div className="flex gap-1 flex-wrap">
            {['미변경', ...roomTypes].map(t => (
              <button key={t} type="button"
                onClick={() => setType(t === '미변경' ? '' : t)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${(t === '미변경' && !type) || type === t ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">등급</label>
          <div className="flex gap-1 flex-wrap">
            {['미변경', ...roomTiers].map(t => (
              <button key={t} type="button"
                onClick={() => setTier(t === '미변경' ? '' : t)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${(t === '미변경' && !tier) || tier === t ? 'bg-[var(--coral)] text-[var(--on-solid)] border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}>
                {t}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">기본이용료</label>
            <MoneyInput value={baseRent} onChange={setBaseRent} placeholder="미변경" />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">예약이용료</label>
            <div className={clearScheduled ? 'opacity-40 pointer-events-none' : ''}>
              <MoneyInput value={scheduledRent} onChange={setScheduledRent} placeholder="미변경" />
            </div>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="checkbox" checked={clearScheduled} onChange={e => { setClearScheduled(e.target.checked); if (e.target.checked) setScheduledRent(undefined) }} className="rounded" />
              <span className="text-[0.65625rem] text-[var(--warm-muted)]">예약이용료 삭제</span>
            </label>
          </div>
        </div>

        {!clearScheduled && scheduledRent != null && (
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">적용 예정일 <span className="text-[var(--danger-fg)]">*</span> <span className="text-[var(--warm-muted)]">(예약이용료가 적용될 날짜 · 없으면 적용 안 됨)</span></label>
            <DatePicker name="batchRentUpdateDate" value={rentUpdateDateVal} onChange={setRentUpdateDateVal}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">창문 타입</label>
            <select value={windowType} onChange={e => setWindowType(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">미변경</option>
              {windowTypeOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">방향</label>
            <select value={direction} onChange={e => setDirection(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="">미변경</option>
              {directionOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={onClose}>
            취소
          </Btn>
          <Btn type="button" variant="primary" size="md" className="flex-1 font-semibold" onClick={handleApply} disabled={pending}>
            {pending ? '적용 중…' : '적용'}
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

// ── 공통 컴포넌트 ─────────────────────────────────────────────────

function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void
}) {
  return (
    <SharedModal open onClose={onClose} title={title} width="md">
      <div className="px-5 sm:px-6 py-5">{children}</div>
    </SharedModal>
  )
}

function Field({ label, name, placeholder, defaultValue }: {
  label: string; name: string; placeholder?: string; defaultValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" name={name} defaultValue={defaultValue} placeholder={placeholder}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)] transition-colors" />
    </div>
  )
}

function SelectField({ label, name, options, defaultValue, hint }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string; hint?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <select name={name} defaultValue={defaultValue ?? ''}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-[0.65625rem] text-[var(--warm-muted)]">{hint}</p>}
    </div>
  )
}

