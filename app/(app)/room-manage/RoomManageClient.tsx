'use client'

import { useState, useTransition, useRef } from 'react'
import { addRoom, updateRoom, deleteRoom, uploadRoomPhoto, deleteRoomPhoto } from './actions'
import { addRoomTypeOption } from '@/app/(app)/settings/actions'
import { AreaInput } from '@/components/ui/AreaInput'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'

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

const WINDOW_TYPE_LABEL: Record<string, string> = {
  WINDOW: '내창', NO_WINDOW: '외창', SKYLIGHT: '천창',
}
const DIRECTION_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
const DIRECTION_OPTIONS = Object.entries(DIRECTION_LABEL).map(([value, label]) => ({ value, label }))

function getWindowLabel(val: string) {
  return WINDOW_TYPE_LABEL[val] ?? val
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toISOString().slice(0, 10)
}

export default function RoomManageClient({
  initialRooms,
  roomTypes,
  windowTypes,
}: {
  initialRooms: Room[]
  roomTypes: string[]
  windowTypes: string[]
}) {
  const [rooms] = useState(initialRooms)
  const windowTypeOptions = windowTypes.map(v => ({ value: v, label: getWindowLabel(v) }))

  // 모달 상태
  const [detailRoom, setDetailRoom]   = useState<Room | null>(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [editRoom, setEditRoom]         = useState<Room | null>(null)

  // 사진
  const [editPhotos, setEditPhotos]           = useState<Photo[]>([])
  const [addPhotoPreviews, setAddPhotoPreviews] = useState<{ file: File; previewUrl: string }[]>([])
  const [photoUploading, setPhotoUploading]   = useState(false)

  // 기타
  const [types, setTypes]   = useState<string[]>(roomTypes)
  const [newType, setNewType] = useState('')
  const [error, setError]   = useState('')
  const [isPending, startTransition] = useTransition()
  const photoInputRef    = useRef<HTMLInputElement>(null)
  const addPhotoInputRef = useRef<HTMLInputElement>(null)

  const currentTenant = (room: Room) => room.leaseTerms[0]?.tenant?.name ?? null

  // ── 핸들러 ────────────────────────────────────────────────────────

  const closeDetail = () => { setDetailRoom(null); setError('') }

  const openEdit = (room: Room) => {
    setDetailRoom(null)
    setEditRoom(room)
    setEditPhotos(room.photos)
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
      try {
        const { id: roomId } = await addRoom(formData)
        for (const { file } of addPhotoPreviews) {
          const fd = new FormData()
          fd.set('roomId', roomId)
          fd.set('photo', file)
          await uploadRoomPhoto(fd)
        }
        closeAddModal()
        window.location.reload()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      }
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
      try {
        await deleteRoom(id)
        closeDetail()
        window.location.reload()
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : '오류가 발생했습니다.')
      }
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
        const photo = await uploadRoomPhoto(fd)
        setEditPhotos(prev => [...prev, photo])
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '업로드 실패')
    } finally {
      setPhotoUploading(false); e.target.value = ''
    }
  }

  const handlePhotoDelete = async (photoId: string) => {
    if (!confirm('이 사진을 삭제하시겠습니까?')) return
    try {
      await deleteRoomPhoto(photoId)
      setEditPhotos(prev => prev.filter(p => p.id !== photoId))
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '삭제 실패')
    }
  }

  const TypeSection = ({ defaultValue }: { defaultValue?: string }) => (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-400">방 타입</label>
      <select name="type" defaultValue={defaultValue ?? ''}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500">
        <option value="">선택</option>
        {types.map(t => <option key={t} value={t}>{t}</option>)}
      </select>
      <div className="flex gap-2">
        <input type="text" value={newType} onChange={e => setNewType(e.target.value)}
          placeholder="새 방타입 추가..."
          className="flex-1 bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 outline-none focus:border-indigo-500" />
        <button type="button"
          onClick={async () => {
            if (!newType.trim()) return
            await addRoomTypeOption(newType.trim())
            setTypes(prev => [...prev, newType.trim()])
            setNewType('')
          }}
          className="px-3 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-xs rounded-xl transition-colors">
          등록
        </button>
      </div>
    </div>
  )

  // ── 렌더 ─────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* 헤더 */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">호실 관리</h1>
          <p className="text-sm text-gray-500 mt-0.5">전체 {rooms.length}실</p>
        </div>
        <button
          onClick={() => { setShowAddModal(true); setError('') }}
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors">
          + 호실 등록
        </button>
      </div>

      {/* 에러 */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3">
          <p className="text-red-400 text-sm">{error}</p>
        </div>
      )}

      {/* 호실 그리드 */}
      {rooms.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-12 text-center">
          <p className="text-4xl mb-3">🏠</p>
          <p className="text-white font-medium">등록된 호실이 없습니다</p>
          <p className="text-sm text-gray-500 mt-1">호실 등록 버튼을 눌러 시작하세요</p>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
          {rooms.map(room => {
            const tenant = currentTenant(room)
            const thumb  = room.photos[0]
            return (
              <div key={room.id}
                onClick={() => { setDetailRoom(room); setError('') }}
                className={`bg-gray-900 border rounded-2xl overflow-hidden cursor-pointer hover:border-gray-600 transition-colors
                  ${room.isVacant ? 'border-gray-800' : 'border-indigo-500/40'}`}>
                {/* 썸네일 */}
                {thumb ? (
                  <div className="h-28 bg-gray-800">
                    <img src={thumb.storageUrl} alt={`${room.roomNo}호`} className="w-full h-full object-cover" />
                  </div>
                ) : (
                  <div className="h-28 bg-gray-800 flex items-center justify-center">
                    <span className="text-3xl opacity-20">🏠</span>
                  </div>
                )}
                {/* 정보 */}
                <div className="p-3 space-y-1.5">
                  <div className="flex items-start justify-between">
                    <span className="text-base font-bold text-white">{room.roomNo}호</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                      ${room.isVacant ? 'bg-gray-700 text-gray-400' : 'bg-indigo-500/20 text-indigo-300'}`}>
                      {room.isVacant ? '공실' : '입주중'}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400 truncate">{tenant ?? '—'}</p>
                  <div>
                    {room.type && <p className="text-xs text-gray-500">{room.type}</p>}
                    <p className="text-sm font-semibold text-white"><MoneyDisplay amount={room.baseRent} /></p>
                    {room.scheduledRent != null && (
                      <p className="text-xs text-amber-400 mt-0.5">
                        → <MoneyDisplay amount={room.scheduledRent} />
                        {room.rentUpdateDate && (
                          <span className="text-gray-500 ml-1">({fmtDate(room.rentUpdateDate)})</span>
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
            <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-sm flex flex-col max-h-[85vh]"
              onClick={e => e.stopPropagation()}>

              {/* 헤더 */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 shrink-0">
                <div className="flex items-center gap-2.5">
                  <h2 className="text-base font-bold text-white">{r.roomNo}호</h2>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium
                    ${r.isVacant ? 'bg-gray-700 text-gray-400' : 'bg-indigo-500/20 text-indigo-300'}`}>
                    {r.isVacant ? '공실' : '입주중'}
                  </span>
                </div>
                <button onClick={closeDetail} className="text-gray-500 hover:text-white text-xl leading-none">✕</button>
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
                        {r.rentUpdateDate && <span className="text-gray-500 ml-1 text-xs">({fmtDate(r.rentUpdateDate)} 적용)</span>}
                      </span>
                    } />
                  )}
                  {r.windowType && <DetailRow label="창문 타입" value={WINDOW_TYPE_LABEL[r.windowType] ?? r.windowType} />}
                  {r.direction  && <DetailRow label="방향"     value={DIRECTION_LABEL[r.direction] ?? r.direction} />}
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
              <div className="border-t border-gray-800 px-6 py-4 flex gap-2 shrink-0">
                <button
                  onClick={() => handleDelete(r.id, r.roomNo)}
                  disabled={!r.isVacant || isPending}
                  title={!r.isVacant ? '입주중인 호실은 삭제할 수 없습니다' : ''}
                  className="px-4 py-2.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-sm rounded-xl transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                  삭제
                </button>
                <div className="flex-1" />
                <button
                  onClick={() => openEdit(r)}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors">
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
              <label className="text-xs font-medium text-gray-400">기본 월 이용료</label>
              <MoneyInput name="baseRent" placeholder="0원" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="창문 타입" name="windowType" options={windowTypeOptions} />
              <SelectField label="방향" name="direction" options={DIRECTION_OPTIONS} />
            </div>
            <AreaInput />
            <Field label="메모" name="memo" placeholder="방 컨디션 메모" />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">사진</label>
                <button type="button" onClick={() => addPhotoInputRef.current?.click()}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
                  + 사진 선택
                </button>
                <input ref={addPhotoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handleAddPhotoSelect} />
              </div>
              {addPhotoPreviews.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {addPhotoPreviews.map((p, i) => (
                    <div key={p.previewUrl} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-800">
                      <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                      <button type="button" onClick={() => removeAddPhoto(i)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div onClick={() => addPhotoInputRef.current?.click()}
                  className="h-20 border border-dashed border-gray-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-gray-600 transition-colors">
                  <p className="text-xs text-gray-600">클릭하여 사진 선택 (추가 시 업로드)</p>
                </div>
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeAddModal}
                className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors">
                취소
              </button>
              <button type="submit" disabled={isPending}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
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
              <label className="text-xs font-medium text-gray-400">기본 월 이용료</label>
              <MoneyInput name="baseRent" defaultValue={editRoom.baseRent} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400">예약 이용료 <span className="text-gray-600">(가격 예약)</span></label>
                <MoneyInput name="scheduledRent" defaultValue={editRoom.scheduledRent ?? undefined} placeholder="미설정" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-gray-400">적용 예정일</label>
                <input type="date" name="rentUpdateDate"
                  defaultValue={editRoom.rentUpdateDate ? fmtDate(editRoom.rentUpdateDate) : ''}
                  className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500 transition-colors" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <SelectField label="창문 타입" name="windowType" options={windowTypeOptions} defaultValue={editRoom.windowType ?? ''} />
              <SelectField label="방향" name="direction" options={DIRECTION_OPTIONS} defaultValue={editRoom.direction ?? ''} />
            </div>
            <AreaInput defaultPyeong={editRoom.areaPyeong} defaultM2={editRoom.areaM2} />
            <Field label="메모" name="memo" defaultValue={editRoom.memo ?? ''} />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-gray-400">사진</label>
                <button type="button" onClick={() => photoInputRef.current?.click()}
                  disabled={photoUploading}
                  className="text-xs text-indigo-400 hover:text-indigo-300 transition-colors disabled:opacity-50">
                  {photoUploading ? '업로드 중...' : '+ 사진 추가'}
                </button>
                <input ref={photoInputRef} type="file" accept="image/*" multiple className="hidden"
                  onChange={handlePhotoUpload} />
              </div>
              {editPhotos.length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {editPhotos.map(photo => (
                    <div key={photo.id} className="relative group aspect-square rounded-lg overflow-hidden bg-gray-800">
                      <img src={photo.storageUrl} alt={photo.fileName ?? ''} className="w-full h-full object-cover" />
                      <button type="button" onClick={() => handlePhotoDelete(photo.id)}
                        className="absolute top-1 right-1 w-5 h-5 bg-black/70 rounded-full text-white text-xs opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        ✕
                      </button>
                    </div>
                  ))}
                  {photoUploading && (
                    <div className="aspect-square rounded-lg bg-gray-800 flex items-center justify-center">
                      <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    </div>
                  )}
                </div>
              ) : (
                <div onClick={() => photoInputRef.current?.click()}
                  className="h-20 border border-dashed border-gray-700 rounded-xl flex items-center justify-center cursor-pointer hover:border-gray-600 transition-colors">
                  {photoUploading
                    ? <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    : <p className="text-xs text-gray-600">클릭하여 사진 업로드</p>}
                </div>
              )}
            </div>

            {error && <p className="text-red-400 text-sm">{error}</p>}
            <div className="flex gap-2 pt-2">
              <button type="button" onClick={closeEdit}
                className="flex-1 py-2.5 bg-gray-800 hover:bg-gray-700 text-gray-300 text-sm rounded-xl transition-colors">
                취소
              </button>
              <button type="submit" disabled={isPending}
                className="flex-1 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60">
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
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-2xl w-full max-w-md flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800 flex-shrink-0">
          <h2 className="text-base font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-white transition-colors text-xl leading-none">✕</button>
        </div>
        <div className="overflow-y-auto px-6 py-5 flex-1">{children}</div>
      </div>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between py-2 border-b border-gray-800/50 last:border-0 gap-4">
      <span className="text-xs text-gray-500 shrink-0">{label}</span>
      <span className="text-sm text-gray-200 text-right">{value}</span>
    </div>
  )
}

function Field({ label, name, placeholder, defaultValue }: {
  label: string; name: string; placeholder?: string; defaultValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <input type="text" name={name} defaultValue={defaultValue} placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white placeholder-gray-600 outline-none focus:border-indigo-500 transition-colors" />
    </div>
  )
}

function SelectField({ label, name, options, defaultValue }: {
  label: string; name: string; options: { value: string; label: string }[]; defaultValue?: string
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-gray-400">{label}</label>
      <select name={name} defaultValue={defaultValue ?? ''}
        className="w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2.5 text-sm text-white outline-none focus:border-indigo-500">
        <option value="">선택</option>
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}
