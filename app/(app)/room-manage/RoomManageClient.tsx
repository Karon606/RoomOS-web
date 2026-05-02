'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { addRoom, updateRoom, deleteRoom, uploadRoomPhoto, deleteRoomPhoto, applyScheduledRentNow } from './actions'
import { AreaInput } from '@/components/ui/AreaInput'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'
import { useUrlState } from '@/lib/useUrlState'

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
  memo: string | null
  isVacant: boolean
  windowType: string | null
  direction: string | null
  areaPyeong: number | null
  areaM2: number | null
  photos: Photo[]
  leaseTerms: { tenant: { name: string } | null }[]
}

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
  // 라이트박스 (사진 확대 보기)
  const [lightboxPhotos, setLightboxPhotos] = useState<Photo[] | null>(null)
  const [lightboxIndex, setLightboxIndex]   = useState(0)

  // 사진
  const [editPhotos, setEditPhotos]           = useState<Photo[]>([])
  const [addPhotoPreviews, setAddPhotoPreviews] = useState<{ file: File; previewUrl: string }[]>([])
  const [photoUploading, setPhotoUploading]   = useState(false)

  // 기타
  const [types, setTypes]   = useState<string[]>(roomTypes)
  const [error, setError]   = useState('')
  const [isPending, startTransition] = useTransition()
  const router = useRouter()
  const photoInputRef    = useRef<HTMLInputElement>(null)
  const addPhotoInputRef = useRef<HTMLInputElement>(null)

  const handleApplyScheduledNow = (room: Room) => {
    if (room.scheduledRent == null) return
    const diff = room.scheduledRent - room.baseRent
    const dirLabel = diff > 0 ? '인상' : diff < 0 ? '인하' : '동결'
    const ok = confirm(`${room.roomNo}호 예정 가격을 즉시 적용할까요?\n\n기존 ${room.baseRent.toLocaleString()}원 → ${dirLabel} ${room.scheduledRent.toLocaleString()}원`)
    if (!ok) return
    startTransition(async () => {
      const res = await applyScheduledRentNow(room.id)
      if (!res.ok) { setError(res.error); return }
      setDetailRoom(null)
      router.refresh()
    })
  }

  const currentTenant = (room: Room) => room.leaseTerms[0]?.tenant?.name ?? null

  // 검색 · 정렬 적용
  const handleSortRoom = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

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
    setRentUpdateDateVal(room.rentUpdateDate ? new Date(room.rentUpdateDate).toISOString().slice(0, 10) : '')
    setError('')
  }

  const closeEdit = () => { setEditRoom(null); setEditPhotos([]); setError('') }

  const closeAddModal = () => {
    addPhotoPreviews.forEach(p => URL.revokeObjectURL(p.previewUrl))
    setAddPhotoPreviews([])
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
      const res = await addRoom(formData)
      if (!res.ok) { setError(res.error); return }
      for (const { file } of addPhotoPreviews) {
        const fd = new FormData()
        fd.set('roomId', res.id)
        fd.set('photo', file)
        await uploadRoomPhoto(fd)
      }
      closeAddModal()
      window.location.reload()
    })
  }

  const handleUpdate = async (e: React.SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault(); setError('')
    const formData = new FormData(e.currentTarget)
    startTransition(async () => {
      try {
        await updateRoom(formData)
        closeEdit()
        window.location.reload()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      }
    })
  }

  const handleDelete = async (id: string, roomNo: string) => {
    if (!confirm(`${roomNo}호를 삭제하시겠습니까?`)) return
    setError('')
    startTransition(async () => {
      const res = await deleteRoom(id)
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
      for (const file of toUpload) {
        const fd = new FormData()
        fd.set('roomId', editRoom.id)
        fd.set('photo', file)
        const res = await uploadRoomPhoto(fd)
        if (!res.ok) { setError(res.error); break }
        setEditPhotos(prev => [...prev, { id: res.id, driveFileId: res.driveFileId, storageUrl: res.storageUrl, fileName: res.fileName }])
      }
    } finally {
      setPhotoUploading(false); e.target.value = ''
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
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <p className="text-[10px] text-[var(--warm-muted)]">방 타입 추가·관리는 환경설정에서 할 수 있습니다.</p>
    </div>
  )

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">호실 관리</h1>
          <p className="text-sm text-[var(--warm-muted)] mt-0.5">
            전체 {rooms.length}실
            <span className="mx-1.5 text-[var(--warm-border)]">·</span>
            거주중 {rooms.filter(r => !r.isVacant).length}실
            <span className="mx-1.5 text-[var(--warm-border)]">·</span>
            공실 {rooms.filter(r => r.isVacant).length}실
          </p>
        </div>
        <button
          onClick={() => { setShowAddModal(true); setError('') }}
          className="px-4 py-2 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
          + 호실 등록
        </button>
      </div>

      {/* 검색바 + 필터 토글 */}
      <div className="flex gap-2">
        <div className="relative flex-1">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--warm-muted)] text-sm">🔍</span>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="호실 번호, 입주자 이름, 방 타입 검색"
            className="w-full bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl pl-9 pr-8 py-2.5 text-sm text-[var(--warm-dark)] placeholder-[var(--warm-muted)] outline-none focus:border-[var(--coral)] transition-colors"
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
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">호실 번호</label>
              <input
                value={filterRoomNo}
                onChange={e => setFilterRoomNo(e.target.value)}
                placeholder="예: 401, 5"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">방 타입</label>
              <select
                value={filterType}
                onChange={e => setFilterType(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
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
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
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
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
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
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
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
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
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
            <button
              type="button"
              onClick={resetFilters}
              className="flex-1 py-2 rounded-xl text-xs bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors"
            >
              초기화
            </button>
            <button
              type="button"
              onClick={() => setShowFilters(false)}
              className="flex-1 py-2 rounded-xl text-xs bg-[var(--coral)] hover:opacity-90 text-white font-medium transition-opacity"
            >
              닫기
            </button>
          </div>
        </div>
      )}

      {/* 정렬 칩 */}
      <div className="flex gap-1.5 overflow-x-auto pb-0.5 -mx-4 px-4 sm:mx-0 sm:px-0">
        {([
          { sk: 'roomNo'  as const, label: '호실순' },
          { sk: 'vacancy' as const, label: '공실' },
          { sk: 'baseRent'as const, label: '이용료' },
        ]).map(({ sk, label }) => {
          const active = sortKey === sk
          return (
            <button key={sk} onClick={() => handleSortRoom(sk)}
              className={`shrink-0 flex items-center gap-0.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors ${
                active ? 'bg-[var(--coral)] text-white' : 'bg-[var(--canvas)] text-[var(--warm-mid)]'
              }`}
            >
              {label}{active ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
            </button>
          )
        })}
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* 호실 그리드 */}
      {filteredRooms.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-12 text-center">
          <p className="text-4xl mb-3">🏠</p>
          <p className="text-[var(--warm-dark)] font-medium">{search ? '검색 결과가 없습니다' : '등록된 호실이 없습니다'}</p>
          {!search && <p className="text-sm text-[var(--warm-muted)] mt-1">호실 등록 버튼을 눌러 시작하세요</p>}
        </div>
      ) : (
        <div className="space-y-2">
          {filteredRooms.map(room => {
            const tenant = currentTenant(room)
            const thumb  = room.photos[0]
            return (
              <div key={room.id}
                onClick={() => { setDetailRoom(room); setError('') }}
                className={`bg-[var(--cream)] border rounded-2xl overflow-hidden cursor-pointer active:opacity-70 transition-opacity flex items-stretch
                  ${room.isVacant ? 'border-[var(--warm-border)]' : 'border-[var(--coral)]/40'}`}>
                {/* 정보 */}
                <div className="flex-1 p-4 min-w-0 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-[var(--coral)]">{room.roomNo}호</span>
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium shrink-0
                      ${room.isVacant ? 'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>
                      {room.isVacant ? '공실' : '거주중'}
                    </span>
                  </div>
                  {tenant && <p className="text-sm font-medium text-[var(--warm-dark)] truncate">{tenant}</p>}
                  <div className="space-y-0.5 pt-0.5">
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
                    <p className="text-sm font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></p>
                    {room.scheduledRent != null && (
                      <p className="text-xs text-amber-500">
                        → <MoneyDisplay amount={room.scheduledRent} />
                        {room.rentUpdateDate && <span className="text-[var(--warm-muted)] ml-1">({fmtDate(room.rentUpdateDate)})</span>}
                      </p>
                    )}
                  </div>
                </div>
                {/* 썸네일 (오른쪽) */}
                <div className="w-24 sm:w-28 shrink-0 bg-[var(--canvas)]">
                  {thumb ? (
                    <img src={thumb.storageUrl} alt={`${room.roomNo}호`} className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <span className="text-3xl opacity-20">🏠</span>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* ── 상세 모달 ───────────────────────────────────────────────── */}
      {detailRoom && (() => {
        const r      = detailRoom
        const tenant = currentTenant(r)
        return (
          <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
            onClick={closeDetail}>
            <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
              onClick={e => e.stopPropagation()}>

              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-[var(--warm-dark)]">{r.roomNo}호</h2>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium
                    ${r.isVacant ? 'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>
                    {r.isVacant ? '공실' : '거주중'}
                  </span>
                </div>
                <button onClick={closeDetail} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
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
                      {r.isVacant && (
                        <div className="flex justify-end">
                          <button type="button" onClick={() => handleApplyScheduledNow(r)} disabled={isPending}
                            className="text-xs px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 ring-1 ring-amber-200 hover:bg-amber-100 transition-colors disabled:opacity-60">
                            {isPending ? '적용 중...' : '예정 가격 즉시 적용'}
                          </button>
                        </div>
                      )}
                    </>
                  )}
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
              <div className="border-t border-[var(--warm-border)] px-6 py-4 flex gap-2 shrink-0">
                <button
                  onClick={() => handleDelete(r.id, r.roomNo)}
                  disabled={!r.isVacant || isPending}
                  title={!r.isVacant ? '거주중인 호실은 삭제할 수 없습니다' : ''}
                  className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  삭제
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => openEdit(r)}
                  className="px-4 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors">
                  수정
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── 호실 추가 모달 ──────────────────────────────────────────── */}
      {showAddModal && (
        <Modal title="호실 등록" onClose={closeAddModal}>
          <form onSubmit={handleAdd} className="space-y-4">
            <Field label="호실 번호 *" name="roomNo" placeholder="예: 101, A동-3, 옥탑방" />
            <TypeSection />
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">기본 월 이용료</label>
              <MoneyInput name="baseRent" placeholder="0원" />
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
              <button type="button" onClick={closeAddModal}
                className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                취소
              </button>
              <button type="submit" disabled={isPending}
                className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                {isPending ? '저장 중...' : `저장${addPhotoPreviews.length > 0 ? ` (사진 ${addPhotoPreviews.length}장)` : ''}`}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* ── 호실 수정 모달 ──────────────────────────────────────────── */}
      {editRoom && (
        <Modal title={`${editRoom.roomNo}호 수정`} onClose={closeEdit}>
          <form onSubmit={handleUpdate} className="space-y-4">
            <input type="hidden" name="id" value={editRoom.id} />
            <Field label="호실 번호 *" name="roomNo" defaultValue={editRoom.roomNo} />
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
                    <div className="aspect-square rounded-lg bg-[var(--canvas)] flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <div onClick={() => photoInputRef.current?.click()}
                  className="h-20 border border-dashed border-[var(--warm-border)] rounded-xl flex items-center justify-center cursor-pointer hover:border-[var(--warm-border)] transition-colors">
                  {photoUploading
                    ? <div className="w-5 h-5 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
                    : <p className="text-xs text-[var(--warm-muted)]">클릭하여 사진 업로드</p>}
                </div>
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeEdit}
                className="flex-1 py-2.5 bg-[var(--canvas)] hover:bg-[var(--canvas)] text-[var(--warm-dark)] text-sm rounded-xl transition-colors">
                취소
              </button>
              <button type="submit" disabled={isPending}
                className="flex-1 py-2.5 bg-[var(--coral)] hover:opacity-90 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
                {isPending ? '저장 중...' : '저장'}
              </button>
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

// ── 공통 컴포넌트 ─────────────────────────────────────────────────

function Modal({ title, children, onClose }: {
  title: string; children: React.ReactNode; onClose: () => void
}) {
  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-md flex flex-col max-h-[90vh]"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] flex-shrink-0">
          <h2 className="text-base font-bold text-[var(--warm-dark)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] transition-colors text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
      </div>
    </div>
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
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)] transition-colors" />
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
        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
        <option value="">선택</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {hint && <p className="text-[10px] text-[var(--warm-muted)]">{hint}</p>}
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
                src={p.storageUrl}
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
