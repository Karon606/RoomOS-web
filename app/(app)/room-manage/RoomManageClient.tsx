'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { addRoom, updateRoom, deleteRoom, createPhotoUploadSession, finalizeRoomPhoto, deleteRoomPhoto, applyScheduledRentNow, batchUpdateRooms } from './actions'
import { getTenantQuickInfo, getLeaseSettlementInfo } from '@/app/(app)/rooms/actions'
import { AreaInput } from '@/components/ui/AreaInput'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { Loading } from '@/components/ui/Loading'
import { Modal as SharedModal } from '@/components/ui/Modal'
import { Badge } from '@/components/ui/Badge'
import { useUrlState } from '@/lib/useUrlState'
import { kstMonthStr } from '@/lib/kstDate'
import { withSave, trackSave, pushToast } from '@/lib/saveStatus'
import { SortSelect } from '@/components/ui/SortSelect'
import { RoomCard, type CardKind } from '@/components/ui/RoomCard'
import { StatusBadge, statusTipColor, statusRowTint, type BadgeTone } from '@/components/ui/StatusBadge'
import { DisplayFieldsMenu, useDisplayFields, type FieldDef } from '@/components/ui/DisplayFieldsMenu'

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
  baseRent: number
  scheduledRent: number | null
  rentUpdateDate: Date | string | null
  nonResidentRent: number | null
  nonResidentScheduled: number | null
  nonResidentRentDate: Date | string | null
  memo: string | null
  isVacant: boolean
  floor: string | null
  windowType: string | null
  direction: string | null
  areaPyeong: number | null
  areaM2: number | null
  photos: Photo[]
  leaseTerms: {
    id: string
    status: string                 // ACTIVE | RESERVED | CHECKOUT_PENDING
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
  const lease = r.leaseTerms[0]
  if (!lease)
    return { label: '공실', kind: 'vacant', badge: null }
  if (lease.status === 'RESERVED')
    return { label: '예약', kind: 'vacant', badge: { tone: 'movein', label: '입실 예정' } }
  if (lease.status === 'CHECKOUT_PENDING')
    return { label: '퇴실 예정', kind: 'resident', badge: { tone: 'exit', label: '퇴실 예정' } }
  return { label: '거주중', kind: 'resident', badge: null }
}

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

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toISOString().slice(0, 10)
}

function deriveFloor(roomNo: string): string {
  const digits = roomNo.replace(/\D/g, '')
  if (digits.length >= 3) return digits.slice(0, digits.length - 2)
  return ''
}

export default function RoomManageClient({
  initialRooms,
  roomTypes,
  windowTypes,
  directions,
}: {
  initialRooms: Room[]
  roomTypes: string[]
  windowTypes: string[]
  directions: string[]
}) {
  const [rooms] = useState(initialRooms)
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
  const [showFilters, setShowFilters]         = useState(false)
  const [filterRoomNo, setFilterRoomNo]       = useState('')
  const [filterType, setFilterType]           = useState('')
  const [filterWindowType, setFilterWindowType] = useState('')
  const [filterDirection, setFilterDirection] = useState('')
  const [filterAreaPyeong, setFilterAreaPyeong] = useState<AreaPyeongRange>('')
  const [filterAreaM2, setFilterAreaM2]       = useState<AreaM2Range>('')
  const [filterRentMin, setFilterRentMin]     = useState<number | undefined>(undefined)
  const [filterRentMax, setFilterRentMax]     = useState<number | undefined>(undefined)

  const resetFilters = () => {
    setFilterRoomNo(''); setFilterType(''); setFilterWindowType(''); setFilterDirection('')
    setFilterAreaPyeong(''); setFilterAreaM2('')
    setFilterRentMin(undefined); setFilterRentMax(undefined)
  }
  const activeFilterCount =
    (filterRoomNo ? 1 : 0) +
    (filterType ? 1 : 0) +
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
  const [detailRoom, setDetailRoom]   = useState<Room | null>(null)
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
  // 호실 상세에서 띄우는 인라인 모달 (입주자 정보 / 수납 정보) — 닫으면 원래 호실 상세로 복귀
  const [detailTenantInfoId, setDetailTenantInfoId] = useState<string | null>(null)
  const [detailSettlementLeaseId, setDetailSettlementLeaseId] = useState<string | null>(null)
  const [returnToRoomId, setReturnToRoomId] = useState<string | null>(null)

  // URL ?roomId=xxx로 진입 시 해당 호실 상세 팝업 자동 열기
  const searchParams = useSearchParams()
  useEffect(() => {
    const roomId = searchParams.get('roomId')
    if (!roomId) return
    const found = initialRooms.find(r => r.id === roomId)
    if (found) setDetailRoom(found)
  }, [searchParams, initialRooms])
  // 라이트박스 (사진 확대 보기)
  const [lightboxPhotos, setLightboxPhotos] = useState<Photo[] | null>(null)
  const [lightboxIndex, setLightboxIndex]   = useState(0)

  // 사진
  const [editPhotos, setEditPhotos]           = useState<Photo[]>([])
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
  const [error, setError]   = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const entityModal = useEntityModal()
  const photoInputRef    = useRef<HTMLInputElement>(null)
  const addPhotoInputRef = useRef<HTMLInputElement>(null)

  const handleApplyScheduledNow = (room: Room) => {
    if (room.scheduledRent == null) return
    const diff = room.scheduledRent - room.baseRent
    const dirLabel = diff > 0 ? '인상' : diff < 0 ? '인하' : '동결'
    const ok = confirm(`${fmtRoomNo(room.roomNo)} 예정 가격을 즉시 적용할까요?\n\n기존 ${room.baseRent.toLocaleString()}원 → ${dirLabel} ${room.scheduledRent.toLocaleString()}원`)
    if (!ok) return
    startTransition(async () => {
      const res = await withSave(() => applyScheduledRentNow(room.id), { success: '예정 가격 적용됨' })
      if (!res.ok) { setError(res.error); return }
      setDetailRoom(null)
      router.refresh()
    })
  }

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
      if (roomNoQ && !r.roomNo.toLowerCase().includes(roomNoQ)) return false
      if (filterType && r.type !== filterType) return false
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

  const closeDetail = () => { setDetailRoom(null); setError('') }

  const openEdit = (room: Room) => {
    setDetailRoom(null)
    setEditRoom(room)
    setEditPhotos(room.photos)
    setEditFloorVal(room.floor ?? '')
    setRentUpdateDateVal(room.rentUpdateDate ? new Date(room.rentUpdateDate).toISOString().slice(0, 10) : '')
    setNrEnabled(room.nonResidentRent != null)
    setNrDateVal(room.nonResidentRentDate ? new Date(room.nonResidentRentDate).toISOString().slice(0, 10) : '')
    setError('')
  }

  const closeEdit = () => {
    setEditRoom(null)
    setEditPhotos([])
    setEditFloorVal('')
    setNrEnabled(false)
    setNrDateVal('')
    setError('')
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
        if (!res.ok) { setError(res.error); pushToast('error', res.error); return }
        for (const { file } of addPhotoPreviews) {
          try {
            const session = await createPhotoUploadSession({
              roomId: res.id,
              fileName: file.name,
              mimeType: file.type,
              fileSize: file.size,
              origin: window.location.origin,
            })
            if (!session.ok) { setError(session.error); continue }
            const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file, () => {})
            await finalizeRoomPhoto({ roomId: res.id, driveFileId, fileName: file.name })
          } catch (err) {
            console.error('[handleAdd photo]', err)
            // 일부 사진 실패해도 나머지/호실 자체는 유지
          }
        }
        closeAddModal()
        pushToast('success', '호실 추가됨')
        window.location.reload()
      } finally { release() }
    })
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      const release = trackSave()
      try {
        await updateRoom(formData)
        closeEdit()
        pushToast('success', '호실 수정됨')
        window.location.reload()
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : '오류가 발생했습니다.'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  const handleDelete = async (id: string, roomNo: string) => {
    if (!confirm(`${fmtRoomNo(roomNo)}를 삭제하시겠습니까?`)) return
    setError('')
    startTransition(async () => {
      const res = await withSave(() => deleteRoom(id), { success: `${fmtRoomNo(roomNo)} 삭제됨` })
      if (!res.ok) { setError(res.error); return }
      closeDetail()
      window.location.reload()
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
    if (!confirm('이 사진을 삭제하시겠습니까?')) return
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
      <p className="text-[0.625rem] text-[var(--warm-muted)]">방 타입 추가·관리는 환경설정에서 할 수 있습니다.</p>
    </div>
  )

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

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
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
            className="px-3 py-2 text-sm font-medium text-[var(--warm-mid)] border border-[var(--warm-border)] hover:border-[var(--coral)] rounded-xl transition-colors">
            {selectMode ? `선택 취소${selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}` : '선택'}
          </button>
          <Btn variant="primary" size="md" onClick={() => { setShowAddModal(true); setError('') }}>
            + 호실 등록
          </Btn>
        </div>
      </div>

      {/* 검색바 + 필터 토글 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M16 16 L21 21" />
          </svg>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="호실 번호, 입주자 이름, 방 타입 검색"
            className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm pl-9 pr-8 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
          />
          {search && (
            <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] text-base leading-none">×</button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowFilters(v => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
            showFilters || activeFilterCount > 0
              ? 'bg-[var(--coral)] text-white'
              : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
          }`}
        >
          필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

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
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* 호실 그리드 */}
      {filteredRooms.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-12 text-center">
          <svg className="mx-auto mb-3" width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" />
          </svg>
          <p className="text-[var(--warm-dark)] font-medium">{search ? '검색 결과가 없습니다' : '등록된 호실이 없습니다'}</p>
          {!search && <p className="text-sm text-[var(--warm-muted)] mt-1">호실 등록 버튼을 눌러 시작하세요</p>}
        </div>
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
                onClick={() => selectMode ? toggleSelectRoom(room.id) : (setDetailRoom(room), setError(''))}
                className="overflow-hidden flex items-stretch">
                {/* 정보 */}
                <div className="flex-1 p-4 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`text-base font-bold ${rs.kind === 'vacant' ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'}`}>{fmtRoomNo(room.roomNo)}</span>
                    {cardFields.floor && room.floor && (
                      <span className="text-[0.625rem] px-2 py-0.5 rounded-full font-medium shrink-0 bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]">
                        {room.floor}층
                      </span>
                    )}
                    {rs.badge && <StatusBadge tone={rs.badge.tone}>{rs.badge.label}</StatusBadge>}
                  </div>
                  {cardFields.tenant && tenant && <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{tenant}</p>}
                  <div className="space-y-0.5 pt-0.5">
                    {cardFields.spec && (
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5 text-xs text-[var(--warm-muted)]">
                        {room.type && <span>{room.type}</span>}
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

      {/* ── 상세 모달 ───────────────────────────────────────────────── */}
      {detailRoom && (() => {
        const r      = detailRoom
        const tenant = currentTenant(r)
        return (
          <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4"
            onClick={closeDetail}>
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
              onClick={e => e.stopPropagation()}>

              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-[var(--warm-dark)]">{fmtRoomNo(r.roomNo)}</h2>
                  {(() => { const rs = getRoomStatus(r); return rs.badge
                    ? <StatusBadge tone={rs.badge.tone}>{rs.badge.label}</StatusBadge>
                    : <span className="text-xs font-medium text-[var(--warm-mid)]">{rs.label}</span>
                  })()}
                </div>
                <button onClick={closeDetail} aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
              </div>

              {/* 사진 슬라이더 — 클릭하면 확대 라이트박스 */}
              {r.photos.length > 0 && (
                <div className="shrink-0 border-b border-[var(--warm-border)]">
                  <div className="flex gap-2 overflow-x-auto px-4 py-3"
                    style={{ scrollbarWidth: 'none' }}>
                    {r.photos.map((p, idx) => (
                      <img key={p.id} src={p.storageUrl} alt=""
                        onClick={() => { setLightboxPhotos(r.photos); setLightboxIndex(idx) }}
                        className="h-44 w-44 object-cover rounded-xl shrink-0 cursor-zoom-in" />
                    ))}
                  </div>
                </div>
              )}

              {/* 바디 */}
              <div className="flex-1 overflow-y-auto">
                {/* 정보 */}
                <div className="px-6 py-5 space-y-2.5">
                  <DetailRow label="입주자"    value={tenant ?? '공실'} />
                  {r.type && <DetailRow label="방 타입" value={r.type} />}
                  <DetailRow label="기본 이용료" value={<MoneyDisplay amount={r.baseRent} />} />
                  {r.scheduledRent != null && (
                    <>
                      <DetailRow label="예약 이용료" value={
                        <span className="text-amber-400">
                          <MoneyDisplay amount={r.scheduledRent} />
                          {r.rentUpdateDate && <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(r.rentUpdateDate)} 적용)</span>}
                        </span>
                      } />
                      {r.leaseTerms.length === 0 && (
                        <div className="flex justify-end">
                          <button type="button" onClick={() => handleApplyScheduledNow(r)} disabled={isPending}
                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-60">
                            {isPending ? '적용 중...' : '예정 가격 즉시 적용'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
                  {r.nonResidentRent != null && (
                    <>
                      <div className="border-t border-[var(--warm-border)] my-1" />
                      <DetailRow label="비거주 이용료" value={
                        <span className="text-indigo-600 font-medium">
                          <MoneyDisplay amount={r.nonResidentRent} />
                        </span>
                      } />
                      {r.nonResidentScheduled != null && (
                        <DetailRow label="비거주 예약료" value={
                          <span className="text-amber-400">
                            <MoneyDisplay amount={r.nonResidentScheduled} />
                            {r.nonResidentRentDate && (
                              <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(r.nonResidentRentDate)} 적용)</span>
                            )}
                          </span>
                        } />
                      )}
                    </>
                  )}
                  {r.floor      && <DetailRow label="층"       value={`${r.floor}층`} />}
                  {r.windowType && <DetailRow label="창문 타입" value={getWindowLabel(r.windowType)} />}
                  {r.direction  && <DetailRow label="방향"     value={getDirectionLabel(r.direction)} />}
                  {(r.areaPyeong || r.areaM2) && (
                    <DetailRow label="면적" value={[
                      r.areaPyeong ? `${r.areaPyeong}평` : '',
                      r.areaM2     ? `${r.areaM2}㎡`    : '',
                    ].filter(Boolean).join(' / ')} />
                  )}
                  {r.memo && <DetailRow label="메모" value={r.memo} />}
                </div>
              </div>

              {/* 푸터 */}
              <div className="border-t border-[var(--warm-border)] px-6 py-3 flex gap-2 shrink-0 flex-wrap">
                <button
                  onClick={() => handleDelete(r.id, r.roomNo)}
                  disabled={r.leaseTerms.length > 0 || isPending}
                  title={r.leaseTerms.length > 0 ? '입주자(예약 포함)가 있는 호실은 삭제할 수 없습니다' : ''}
                  className="px-3 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium rounded-lg transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  삭제
                </button>
                {r.leaseTerms[0]?.tenant?.id && (
                  <button
                    type="button"
                    onClick={() => entityModal.open({ kind: 'tenant', tenantId: r.leaseTerms[0].tenant!.id })}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                    입주자 정보
                  </button>
                )}
                {r.leaseTerms[0]?.id && (
                  <button
                    type="button"
                    onClick={() => entityModal.open({ kind: 'payment', leaseTermId: r.leaseTerms[0].id })}
                    className="px-3 py-2 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                    수납 정보
                  </button>
                )}
                <div className="flex-1" />
                <Btn variant="primary" size="md" onClick={() => openEdit(r)}>
                  수정
                </Btn>
              </div>
            </div>
          </div>
        )
      })()}

      {/* 호실 상세에서 띄우는 인라인 모달 — 입주자 정보 */}
      {detailTenantInfoId && (
        <RoomMgrTenantInfoModal
          tenantId={detailTenantInfoId}
          onClose={() => { setDetailTenantInfoId(null); setReturnToRoomId(null) }}
          onBack={returnToRoomId ? () => {
            const back = rooms.find(x => x.id === returnToRoomId) ?? null
            setDetailTenantInfoId(null)
            setReturnToRoomId(null)
            if (back) setDetailRoom(back)
          } : undefined}
        />
      )}

      {/* 호실 상세에서 띄우는 인라인 모달 — 수납 정보 */}
      {detailSettlementLeaseId && (
        <RoomMgrSettlementInfoModal
          leaseTermId={detailSettlementLeaseId}
          targetMonth={kstMonthStr()}
          onClose={() => { setDetailSettlementLeaseId(null); setReturnToRoomId(null) }}
          onBack={returnToRoomId ? () => {
            const back = rooms.find(x => x.id === returnToRoomId) ?? null
            setDetailSettlementLeaseId(null)
            setReturnToRoomId(null)
            if (back) setDetailRoom(back)
          } : undefined}
        />
      )}

      {/* ── 배치 편집 모달 ─────────────────────────────────────────────── */}
      {showBatchEdit && (
        <BatchEditRoomsModal
          selectedIds={Array.from(selectedIds)}
          roomTypes={types}
          windowTypeOptions={windowTypeOptions}
          directionOptions={directionOptions}
          onClose={() => setShowBatchEdit(false)}
          onDone={() => { setShowBatchEdit(false); exitSelectMode(); router.refresh() }}
        />
      )}

      {/* 배치 액션 바 */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-[calc(env(safe-area-inset-bottom)+56px)] md:bottom-4 left-0 right-0 z-50 flex justify-center pointer-events-none">
          <div className="flex items-center gap-3 bg-[var(--ink)] text-[var(--canvas)] rounded-xl px-4 py-3 shadow-lift pointer-events-auto mx-4">
            <span className="text-sm font-medium">{selectedIds.size}개 선택됨</span>
            <div className="w-px h-4 bg-[var(--canvas)]/20" />
            <button type="button" onClick={() => setShowBatchEdit(true)}
              className="text-sm font-semibold text-[var(--coral)] hover:text-[var(--coral-dark)] transition-colors">
              일괄 편집
            </button>
          </div>
        </div>
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
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <input
                  name="floor"
                  placeholder="자동"
                  value={addFloorVal}
                  onChange={e => setAddFloorVal(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
            </div>
            <TypeSection />
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
                  <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">일반 이용료와 별도로 비거주자 전용 금액을 설정합니다</p>
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
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
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
                      <button type="button" onClick={() => removeAddPhoto(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-[var(--warm-dark)] text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        ✕
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

            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Btn type="button" variant="secondary" onClick={closeAddModal} fullWidth>취소</Btn>
              <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                {isPending ? '저장 중...' : `저장${addPhotoPreviews.length > 0 ? ` (사진 ${addPhotoPreviews.length}장)` : ''}`}
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
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <input
                  name="floor"
                  placeholder="예: 1"
                  value={editFloorVal}
                  onChange={e => setEditFloorVal(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]"
                />
              </div>
            </div>
            <TypeSection defaultValue={editRoom.type ?? ''} />
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
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
              </div>
            </div>

            {/* 비거주 이용료 설정 */}
            <div className="border border-[var(--warm-border)] rounded-xl p-3.5 space-y-3">
              <input type="hidden" name="nonResidentEnabled" value={nrEnabled ? '1' : '0'} />
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs font-medium text-[var(--warm-mid)]">비거주 이용료 설정</p>
                  <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">일반 이용료와 별도로 비거주자 전용 금액을 설정합니다</p>
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
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
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

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-[var(--warm-mid)]">사진</label>
                <button type="button" onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="text-xs text-[var(--coral)] hover:text-[var(--coral)] transition-colors disabled:opacity-50">
                  {photoUploading ? '업로드 중...' : '+ 사진 추가'}
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handlePhotoUpload} />
              </div>
              {editPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {editPhotos.map(photo => (
                    <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]">
                      <img src={photo.storageUrl} alt={photo.fileName ?? ''} className="w-full h-full object-cover" />
                      <button type="button" onClick={() => handlePhotoDelete(photo.id)}
                        className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-red-600/80 rounded-full text-[var(--warm-dark)] text-xs transition-colors flex items-center justify-center">
                        ✕
                      </button>
                    </div>
                  ))}
                  {photoUploading && (
                    <div className="aspect-square rounded-lg bg-[var(--canvas)] flex flex-col items-center justify-center gap-1">
                      <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                      {photoProgress && (
                        <span className="text-[0.625rem] text-[var(--warm-muted)]">{photoProgress.percent}%</span>
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
                          <span className="text-[0.625rem] text-[var(--warm-muted)]">{photoProgress.percent}%</span>
                        )}
                      </div>
                    : <p className="text-xs text-[var(--warm-muted)]">클릭하여 사진 업로드</p>}
                </div>
              )}
              {photoProgress && photoProgress.total > 1 && (
                <p className="text-[0.625rem] text-[var(--warm-muted)] text-right">
                  업로드 중 ({photoProgress.current}/{photoProgress.total}) · {photoProgress.percent}%
                </p>
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <Btn type="button" variant="secondary" onClick={closeEdit} fullWidth>취소</Btn>
              <Btn type="submit" variant="primary" disabled={isPending} fullWidth>
                {isPending ? '저장 중...' : '저장'}
              </Btn>
            </div>
          </form>
        </Modal>
      )}

      {/* ── 사진 라이트박스 ───────────────────────────────────────── */}
      {lightboxPhotos && (
        <Lightbox
          photos={lightboxPhotos}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxPhotos(null)}
        />
      )}
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
          if (!body.id) return reject(new Error(`Drive 응답에 파일 ID 없음 — ${dump()}`))
          resolve(body.id)
        } catch (err) {
          reject(new Error(`Drive 응답 파싱 실패 — ${(err as Error).message} | ${dump()}`))
        }
      } else if (xhr.status === 0) {
        // CORS 차단 또는 네트워크 단절 시 일반적으로 status=0
        reject(new Error(`Drive 응답 차단 (CORS 의심) — ${dump()}`))
      } else {
        reject(new Error(`Drive 업로드 거절 — ${dump()}`))
      }
    })

    xhr.onerror = () => settle(() => {
      // 가장 흔한 케이스: status=0 — CORS 또는 네트워크
      reject(new Error(`네트워크/CORS 오류 — ${dump()}`))
    })
    xhr.upload.onerror = () => settle(() => {
      reject(new Error(`업로드 전송 중 오류 — ${dump()}`))
    })
    xhr.onabort = () => settle(() => reject(new Error(`업로드 중단 — ${dump()}`)))
    xhr.ontimeout = () => settle(() => reject(new Error(`업로드 타임아웃 — ${dump()}`)))

    xhr.send(file)
  })
}

// ── 호실 일괄 편집 모달 ──────────────────────────────────────────

function BatchEditRoomsModal({ selectedIds, roomTypes, windowTypeOptions, directionOptions, onClose, onDone }: {
  selectedIds: string[]
  roomTypes: string[]
  windowTypeOptions: { value: string; label: string }[]
  directionOptions: { value: string; label: string }[]
  onClose: () => void
  onDone: () => void
}) {
  const [type, setType]             = useState('')
  const [baseRent, setBaseRent]     = useState<number | undefined>(undefined)
  const [scheduledRent, setScheduledRent] = useState<number | undefined>(undefined)
  const [clearScheduled, setClearScheduled] = useState(false)
  const [windowType, setWindowType] = useState('')
  const [direction, setDirection]   = useState('')
  const [pending, setPending]       = useState(false)
  const [error, setError]           = useState('')

  const handleApply = async () => {
    const data: Parameters<typeof batchUpdateRooms>[1] = {}
    if (type) data.type = type
    if (baseRent != null) data.baseRent = baseRent
    if (clearScheduled) data.scheduledRent = null
    else if (scheduledRent != null) data.scheduledRent = scheduledRent
    if (windowType) data.windowType = windowType
    if (direction)  data.direction  = direction

    if (Object.keys(data).length === 0) { setError('변경할 항목을 하나 이상 입력하세요.'); return }

    setPending(true); setError('')
    const res = await batchUpdateRooms(selectedIds, data)
    setPending(false)
    if (!res.ok) { setError(res.error); return }
    pushToast('success', `${res.count}개 호실 업데이트 완료`)
    onDone()
  }

  return (
    <Modal title={`호실 일괄 편집 (${selectedIds.length}개)`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-xs text-[var(--warm-muted)]">입력하지 않은 항목은 변경되지 않습니다.</p>
        {error && <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{error}</p>}

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
          <div className="flex gap-1 flex-wrap">
            {['미변경', ...roomTypes].map(t => (
              <button key={t} type="button"
                onClick={() => setType(t === '미변경' ? '' : t)}
                className={`text-xs px-2.5 py-1.5 rounded-lg border transition-colors ${(t === '미변경' && !type) || type === t ? 'bg-[var(--coral)] text-white border-[var(--coral)]' : 'bg-[var(--canvas)] text-[var(--warm-mid)] border-[var(--warm-border)]'}`}>
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
              <span className="text-[0.625rem] text-[var(--warm-muted)]">예약이용료 삭제</span>
            </label>
          </div>
        </div>

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
            {pending ? '적용 중...' : '적용'}
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

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-[var(--warm-border)]/50 last:border-0 gap-4">
      <span className="text-xs text-[var(--warm-muted)] shrink-0">{label}</span>
      <span className="text-sm text-[var(--warm-dark)] text-right">{value}</span>
    </div>
  )
}

function Field({ label, name, placeholder, defaultValue }: {
  label: string; name: string; placeholder?: string; defaultValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-[var(--warm-mid)]">{label}</label>
      <input type="text" name={name} defaultValue={defaultValue} placeholder={placeholder}
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)] transition-colors" />
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
      {hint && <p className="text-[0.625rem] text-[var(--warm-muted)]">{hint}</p>}
    </div>
  )
}

// ── 사진 확대 라이트박스 ─────────────────────────────────────────

function Lightbox({ photos, index, onIndexChange, onClose }: {
  photos: Photo[]
  index: number
  onIndexChange: (i: number) => void
  onClose: () => void
}) {
  const total = photos.length
  const [mounted, setMounted]   = useState(false)  // 진입 애니메이션 트리거
  const [drag, setDrag]         = useState(0)      // 현재 드래그 오프셋(px)
  const [animating, setAnimating] = useState(false) // 손가락 떼고 미끄러질 때 transition on
  const touchStart = useRef<{ x: number; y: number } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // mount 직후 한 프레임 후 mounted=true 로 전환 → fade+scale 진입
    const t = requestAnimationFrame(() => setMounted(true))
    return () => cancelAnimationFrame(t)
  }, [])

  const go = (delta: number) => {
    const next = (index + delta + total) % total
    setAnimating(true)
    onIndexChange(next)
    setTimeout(() => setAnimating(false), 320)
  }

  // 키보드 ←/→/ESC
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft')  go(-1)
      if (e.key === 'ArrowRight') go(1)
      if (e.key === 'Escape')     onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, total])

  // 터치 스와이프 — 드래그 중 실시간 이동
  const onTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }
    setAnimating(false)
  }
  const onTouchMove = (e: React.TouchEvent) => {
    if (!touchStart.current) return
    const dx = e.touches[0].clientX - touchStart.current.x
    const dy = e.touches[0].clientY - touchStart.current.y
    // 가로 우세 시 사진 따라 이동, 세로 우세는 무시
    if (Math.abs(dx) > Math.abs(dy)) setDrag(dx)
  }
  const onTouchEnd = () => {
    if (!touchStart.current) { setDrag(0); return }
    const w = containerRef.current?.offsetWidth ?? window.innerWidth
    const threshold = Math.max(50, w * 0.15)
    setAnimating(true)
    if (Math.abs(drag) > threshold) {
      go(drag > 0 ? -1 : 1)
    }
    setDrag(0)
    touchStart.current = null
  }

  const handleClose = () => {
    setMounted(false)
    setTimeout(onClose, 200)
  }

  // translateX: 현재 인덱스 위치 + 드래그 오프셋
  const trackTransform = `translate3d(calc(${-index * 100}% + ${drag}px), 0, 0)`

  return (
    <div
      className={`fixed inset-0 z-[300] flex items-center justify-center select-none transition-[opacity,backdrop-filter] duration-200 ${
        mounted ? 'opacity-100' : 'opacity-0'
      }`}
      style={{ background: 'rgba(0,0,0,0.95)' }}
      onClick={handleClose}
    >
      {/* 닫기 */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClose() }}
        className="absolute top-4 right-4 z-10 text-white/80 hover:text-white text-3xl leading-none w-10 h-10 flex items-center justify-center rounded-full bg-black/40"
        aria-label="닫기"
      >
        ✕
      </button>

      {/* 원본 보기 — Drive에서 풀해상도 열기 */}
      {photos[index]?.driveFileId && (
        <a
          href={`https://drive.google.com/file/d/${photos[index].driveFileId}/view`}
          target="_blank"
          rel="noopener noreferrer"
          onClick={e => e.stopPropagation()}
          className="absolute top-4 right-16 z-10 text-white/80 hover:text-white text-xs px-3 h-10 flex items-center rounded-full bg-black/40"
        >
          원본 보기 ↗
        </a>
      )}

      {/* 인덱스 */}
      <div className="absolute top-4 left-4 z-10 text-white/80 text-sm font-medium px-3 py-1 rounded-full bg-black/40">
        {index + 1} / {total}
      </div>

      {/* 좌측 이전 (데스크탑) */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); go(-1) }}
          className="absolute left-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hidden sm:flex"
          aria-label="이전"
        >
          ‹
        </button>
      )}

      {/* 우측 다음 (데스크탑) */}
      {total > 1 && (
        <button
          onClick={(e) => { e.stopPropagation(); go(1) }}
          className="absolute right-4 top-1/2 -translate-y-1/2 z-10 text-white/80 hover:text-white text-3xl w-12 h-12 flex items-center justify-center rounded-full bg-black/40 hidden sm:flex"
          aria-label="다음"
        >
          ›
        </button>
      )}

      {/* 가로 슬라이드 트랙 — 모든 사진을 나란히 두고 translateX로 이동 */}
      <div
        ref={containerRef}
        className={`w-full h-full overflow-hidden ${mounted ? 'scale-100' : 'scale-95'} transition-transform duration-200`}
        onClick={(e) => e.stopPropagation()}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
      >
        <div
          className="flex h-full"
          style={{
            transform: trackTransform,
            transition: animating ? 'transform 320ms cubic-bezier(0.22,1,0.36,1)' : 'none',
          }}
        >
          {photos.map(p => (
            <div key={p.id} className="w-full h-full shrink-0 flex items-center justify-center px-2">
              <img
                src={p.driveFileId
                  ? `https://drive.google.com/thumbnail?id=${p.driveFileId}&sz=w2000`
                  : p.storageUrl}
                alt={p.fileName ?? ''}
                className="max-w-[95vw] max-h-[90vh] object-contain pointer-events-none"
                draggable={false}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── 입주자 정보 인라인 모달 (호실 상세에서 띄움) ──────────────────
const STATUS_LABEL_RM: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
  CHECKED_OUT: '퇴실', NON_RESIDENT: '비거주자', WAITING_TOUR: '투어 대기', TOUR_DONE: '투어 완료', CANCELLED: '취소',
}
function RoomMgrTenantInfoModal({ tenantId, onClose, onBack }: { tenantId: string; onClose: () => void; onBack?: () => void }) {
  const router = useRouter()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getTenantQuickInfo>> | null>(null)
  useEffect(() => {
    getTenantQuickInfo(tenantId).then(setInfo)
  }, [tenantId])
  const lease = info?.leaseTerms?.[0]
  const statusLabel = lease?.status ? (STATUS_LABEL_RM[lease.status] ?? lease.status) : null
  return (
    <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-lg flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button onClick={onBack}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors"
                title="호실 정보로 돌아가기">
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
          <button onClick={onClose} aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-5">
          {!info ? (
            <Loading />
          ) : (
            <>
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">기본 정보</h3>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <RmInfoCol label="이름" value={info.name} />
                  <RmInfoCol label="호실" value={fmtRoomNo(lease?.room?.roomNo)} />
                  <RmInfoCol label="성별" value={info.gender === 'MALE' ? '남성' : info.gender === 'FEMALE' ? '여성' : '—'} />
                  <RmInfoCol label="국적" value={info.nationality ?? '—'} />
                  <RmInfoCol label="직업" value={info.job ?? '—'} />
                  <RmInfoCol label="생년월일" value={info.birthdate ? new Date(info.birthdate).toISOString().slice(0, 10) : '—'} />
                </div>
              </div>
              {info.contacts && info.contacts.length > 0 && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">연락처</h3>
                  <RmInfoCol label="주 연락처" value={info.contacts[0]?.contactValue ?? '—'} />
                </div>
              )}
              {lease && (
                <div className="space-y-2">
                  <h3 className="text-xs font-semibold text-[var(--warm-mid)] pb-1 border-b border-[var(--warm-border)]">계약 정보</h3>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <RmInfoCol label="월 이용료" value={`${lease.rentAmount.toLocaleString()}원`} />
                    <RmInfoCol label="보증금" value={`${(lease.depositAmount ?? 0).toLocaleString()}원`} />
                    <RmInfoCol label="납부일" value={lease.dueDay ? (lease.dueDay.includes('말') ? '매월 말일' : `매월 ${lease.dueDay}일`) : '—'} />
                    <RmInfoCol label="입주일" value={lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : '—'} />
                    {lease.expectedMoveOut && <RmInfoCol label="퇴실 예정일" value={new Date(lease.expectedMoveOut).toISOString().slice(0, 10)} />}
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
          <Btn
            type="button"
            variant="primary"
            size="sm"
            onClick={() => router.push(`/tenants?tenantId=${tenantId}`)}>
            입주자 관리로 이동
          </Btn>
        </div>
      </div>
    </div>
  )
}

function RmInfoCol({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <p className="text-[0.6875rem] text-[var(--warm-muted)]">{label}</p>
      <p className="text-sm text-[var(--warm-dark)]">{value}</p>
    </div>
  )
}

// ── 수납 정보 인라인 모달 (호실 상세에서 띄움) ──────────────────
function RoomMgrSettlementInfoModal({
  leaseTermId, targetMonth, onClose, onBack,
}: {
  leaseTermId: string
  targetMonth: string
  onClose: () => void
  onBack?: () => void
}) {
  const router = useRouter()
  const [info, setInfo] = useState<Awaited<ReturnType<typeof getLeaseSettlementInfo>> | null>(null)
  useEffect(() => {
    getLeaseSettlementInfo(leaseTermId, targetMonth).then(setInfo)
  }, [leaseTermId, targetMonth])

  return (
    <div className="fixed inset-0 bg-black/70 z-[200] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
          <div className="flex items-center gap-2.5">
            {onBack && (
              <button onClick={onBack}
                className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none w-7 h-7 flex items-center justify-center rounded-lg hover:bg-[var(--canvas)] transition-colors"
                title="호실 정보로 돌아가기">‹</button>
            )}
            <h2 className="text-base font-bold text-[var(--warm-dark)]">
              {info ? `${fmtRoomNo(info.roomNo)} — ${info.tenantName ?? ''}` : '수납 정보'}
            </h2>
          </div>
          <button onClick={onClose} aria-label="닫기" className="w-11 h-11 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5 space-y-4">
          {!info ? (
            <Loading />
          ) : (
            <>
              <p className="text-[0.625rem] text-[var(--warm-muted)]">총 수납·잔액·이월액은 입금일 기준입니다. 매출은 귀속 월로 별도 인식됩니다.</p>
              <div className="grid grid-cols-3 gap-2">
                <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                  <p className="text-xs text-[var(--warm-muted)]">총 수납</p>
                  <p className="text-sm font-bold mt-0.5 text-[var(--warm-dark)]">{info.totalPaid.toLocaleString()}원</p>
                </div>
                <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                  <p className="text-xs text-[var(--warm-muted)]">잔액</p>
                  <p className={`text-sm font-bold mt-0.5 ${info.balance >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {info.balance > 0 ? `+${info.balance.toLocaleString()}원` : info.balance < 0 ? `-${Math.abs(info.balance).toLocaleString()}원` : '0원'}
                  </p>
                </div>
                <div className="bg-[var(--canvas)] rounded-xl p-3 text-center">
                  <p className="text-xs text-[var(--warm-muted)]">이월액</p>
                  <p className="text-sm font-bold mt-0.5 text-[var(--coral)]">
                    {info.carryOver !== 0
                      ? `${info.carryOver > 0 ? '+' : '-'}${Math.abs(info.carryOver).toLocaleString()}원`
                      : '0원'}
                  </p>
                </div>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-[var(--warm-muted)]">월 이용료</span><span className="text-[var(--warm-dark)]">{info.expected.toLocaleString()}원</span></div>
                {info.dueDay && <div className="flex justify-between"><span className="text-[var(--warm-muted)]">납부일</span><span className="text-[var(--warm-dark)]">{info.dueDay.includes('말') ? '매월 말일' : `매월 ${info.dueDay}일`}</span></div>}
              </div>
            </>
          )}
        </div>
        <div className="border-t border-[var(--warm-border)] px-6 py-3 flex justify-end shrink-0">
          <Btn
            type="button"
            variant="primary"
            size="sm"
            onClick={() => {
              const params = new URLSearchParams({ month: targetMonth })
              if (info?.roomNo) params.set('roomNo', info.roomNo)
              router.push(`/rooms?${params.toString()}`)
            }}>
            수납 관리로 이동
          </Btn>
        </div>
      </div>
    </div>
  )
}
