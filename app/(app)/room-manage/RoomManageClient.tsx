'use client'

import { useState, useTransition, useRef } from 'react'
import { addRoom, updateRoom, deleteRoom, uploadRoomPhoto, deleteRoomPhoto } from './actions'
import { AreaInput } from '@/components/ui/AreaInput'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'

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
  const [search, setSearch]     = useState('')
  const [sortKey, setSortKey]   = useState<'roomNo' | 'baseRent' | 'vacancy'>('roomNo')
  const [sortDir, setSortDir]   = useState<'asc' | 'desc'>('asc')

  // 모달 상태
  const [detailRoom, setDetailRoom]   = useState<Room | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editRoom, setEditRoom]         = useState<Room | null>(null)
  const [rentUpdateDateVal, setRentUpdateDateVal] = useState('')

  // 사진
  const [editPhotos, setEditPhotos]           = useState<Photo[]>([])
  const [addPhotoPreviews, setAddPhotoPreviews] = useState<{ file: File; previewUrl: string }[]>([])
  const [photoUploading, setPhotoUploading]   = useState(false)

  // 기타
  const [types, setTypes]   = useState<string[]>(roomTypes)
  const [error, setError]   = useState('')
  const [isPending, startTransition] = useTransition()
  const photoInputRef    = useRef<HTMLInputElement>(null)
  const addPhotoInputRef = useRef<HTMLInputElement>(null)

  const currentTenant = (room: Room) => room.leaseTerms[0]?.tenant?.name ?? null

  // 검색 · 정렬 적용
  const handleSortRoom = (key: typeof sortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  const filteredRooms = (() => {
    const q = search.trim().toLowerCase()
    const base = q
      ? rooms.filter(r =>
          r.roomNo.toLowerCase().includes(q) ||
          (currentTenant(r) ?? '').toLowerCase().includes(q) ||
          (r.type ?? '').toLowerCase().includes(q)
        )
      : rooms
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

      {/* 검색바 */}
      <div className="relative">
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
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {filteredRooms.map(room => {
            const tenant = currentTenant(room)
            const thumb  = room.photos[0]
            return (
              <div key={room.id}
                onClick={() => { setDetailRoom(room); setError('') }}
                className={`bg-[var(--cream)] border rounded-2xl overflow-hidden cursor-pointer hover:border-[var(--warm-border)] transition-colors
                  ${room.isVacant ? 'border-[var(--warm-border)]' : 'border-[var(--coral)]/40'}`}>
                {/* 썸네일 */}
                {thumb ? (
                  <div className="h-28 bg-[var(--canvas)]">
                    <img src={thumb.storageUrl} alt={`${room.roomNo}호`} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-28 bg-[var(--canvas)] flex items-center justify-center">
                    <span className="text-3xl opacity-20">🏠</span>
                  </div>
                )}
                {/* 정보 */}
                <div className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between">
                    <span className="text-base font-bold text-[var(--warm-dark)]">{room.roomNo}호</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${room.isVacant ? 'bg-[var(--canvas)] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]' : 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'}`}>
                      {room.isVacant ? '공실' : '거주중'}
                    </span>
                  </div>
                  <p className="text-xs text-[var(--warm-mid)] truncate">{tenant ?? '—'}</p>
                  <div className="space-y-0.5">
                    {room.type && <p className="text-xs text-[var(--warm-muted)]">{room.type}</p>}
                    {/* 창문 · 방향 */}
                    {(room.windowType || room.direction) && (
                      <p className="text-xs text-[var(--warm-muted)]">
                        {[
                          room.windowType ? getWindowLabel(room.windowType) : null,
                          room.direction  ? getDirectionLabel(room.direction) : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                    )}
                    {/* 면적 */}
                    {(room.areaPyeong || room.areaM2) && (
                      <p className="text-xs text-[var(--warm-muted)]">
                        {[
                          room.areaPyeong ? `${room.areaPyeong}평` : null,
                          room.areaM2     ? `${room.areaM2}㎡`    : null,
                        ].filter(Boolean).join(' / ')}
                      </p>
                    )}
                    <p className="text-sm font-semibold text-[var(--warm-dark)]"><MoneyDisplay amount={room.baseRent} /></p>
                    {room.scheduledRent != null && (
                      <p className="text-xs text-amber-400">
                        → <MoneyDisplay amount={room.scheduledRent} />
                        {room.rentUpdateDate && (
                          <span className="text-[var(--warm-muted)] ml-1">({fmtDate(room.rentUpdateDate)})</span>
                        )}
                      </p>
                    )}
                  </div>
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

              {/* 바디 */}
              <div className="flex-1 overflow-y-auto">
                {/* 사진 */}
                {r.photos.length > 0 && (
                  <div className="flex gap-2 p-4 overflow-x-auto">
                    {r.photos.map(p => (
                      <img key={p.id} src={p.storageUrl} alt=""
                        className="h-36 w-36 object-cover rounded-xl shrink-0" />
                    ))}
                  </div>
                )}

                {/* 정보 */}
                <div className="px-6 pb-6 space-y-2.5">
                  <DetailRow label="입주자"    value={tenant ?? '공실'} />
                  {r.type && <DetailRow label="방 타입" value={r.type} />}
                  <DetailRow label="기본 이용료" value={<MoneyDisplay amount={r.baseRent} />} />
                  {r.scheduledRent != null && (
                    <DetailRow label="예약 이용료" value={
                      <span className="text-amber-400">
                        <MoneyDisplay amount={r.scheduledRent} />
                        {r.rentUpdateDate && <span className="text-[var(--warm-muted)] ml-1 text-xs">({fmtDate(r.rentUpdateDate)} 적용)</span>}
                      </span>
                    } />
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
