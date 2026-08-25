'use client'
// 공용·외관 사진 관리 — 카테고리별 업로드·공개·360·삭제. 방 사진 편집과 같은 조작감(PhotoLightbox 재사용).
import { useState, useEffect, useRef } from 'react'
import { PhotoLightbox, uploadFileToDriveSession, type Photo } from '@/components/room-manage/PhotoViewer'
import {
  getPropertyPhotoData, createPhotoCategory, renamePhotoCategory, deletePhotoCategory,
  createPropertyPhotoUploadSession, finalizePropertyPhoto, deletePropertyPhoto,
  setPropertyPhotoShowOnSite, setPropertyPhotoIs360,
} from './actions'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { looksLike360 } from '@/lib/driveImage'

type Category = { id: string; name: string; photos: Photo[] }

const EyeIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>
)
const EyeOffIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9.9 5.1A9.5 9.5 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.3 3.9M6.1 6.1A15 15 0 0 0 2 12s3.5 7 10 7a9.5 9.5 0 0 0 4-.9M3 3l18 18" /></svg>
)
const XIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
)

export default function PropertyPhotosManager({ onClose }: { onClose: () => void }) {
  const [cats, setCats] = useState<Category[] | null>(null)
  const [viewPhoto, setViewPhoto] = useState<Photo | null>(null)
  const [uploadingCat, setUploadingCat] = useState<string | null>(null)
  const [newCatName, setNewCatName] = useState('')
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  useEffect(() => {
    getPropertyPhotoData()
      .then(data => setCats(data.map(c => ({
        id: c.id, name: c.name,
        photos: c.photos.map(p => ({ id: p.id, driveFileId: p.driveFileId, storageUrl: p.storageUrl, fileName: p.fileName, showOnSite: p.showOnSite, is360: p.is360 })),
      }))))
      .catch(() => { setCats([]); pushToast('error', '공용 사진을 불러오지 못했어요') })
  }, [])

  const handleUpload = async (catId: string, files: FileList | null) => {
    if (!files || !files.length) return
    setUploadingCat(catId)
    try {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const session = await createPropertyPhotoUploadSession({ categoryId: catId, fileName: file.name, mimeType: file.type, fileSize: file.size, origin: window.location.origin })
        if (!session.ok) { pushToast('error', session.error); continue }
        const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file, () => {})
        const fin = await finalizePropertyPhoto({ categoryId: catId, driveFileId, fileName: file.name })
        if (!fin.ok) { pushToast('error', fin.error); continue }
        setCats(prev => prev && prev.map(c => c.id === catId
          ? { ...c, photos: [...c.photos, { id: fin.id, driveFileId: fin.driveFileId, storageUrl: fin.storageUrl, fileName: fin.fileName, showOnSite: true, is360: looksLike360(fin.fileName) }] }
          : c))
      }
    } finally { setUploadingCat(null) }
  }

  const togglePhotoShow = async (catId: string, photoId: string, next: boolean) => {
    setCats(prev => prev && prev.map(c => c.id === catId ? { ...c, photos: c.photos.map(p => p.id === photoId ? { ...p, showOnSite: next } : p) } : c))
    const res = await setPropertyPhotoShowOnSite(photoId, next)
    if (!res.ok) {
      setCats(prev => prev && prev.map(c => c.id === catId ? { ...c, photos: c.photos.map(p => p.id === photoId ? { ...p, showOnSite: !next } : p) } : c))
      pushToast('error', res.error)
    }
  }

  const removePhoto = async (catId: string, photoId: string) => {
    if (!(await confirmDialog({ title: '이 사진을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    const res = await deletePropertyPhoto(photoId)
    if (!res.ok) { pushToast('error', res.error); return }
    setCats(prev => prev && prev.map(c => c.id === catId ? { ...c, photos: c.photos.filter(p => p.id !== photoId) } : c))
  }

  const togglePhoto360 = async (photoId: string, next: boolean): Promise<boolean> => {
    setCats(prev => prev && prev.map(c => ({ ...c, photos: c.photos.map(p => p.id === photoId ? { ...p, is360: next } : p) })))
    setViewPhoto(prev => prev && prev.id === photoId ? { ...prev, is360: next } : prev)
    const res = await setPropertyPhotoIs360(photoId, next)
    if (!res.ok) {
      setCats(prev => prev && prev.map(c => ({ ...c, photos: c.photos.map(p => p.id === photoId ? { ...p, is360: !next } : p) })))
      pushToast('error', res.error)
      return false
    }
    return true
  }

  const addCategory = async () => {
    const name = newCatName.trim()
    if (!name) return
    const res = await createPhotoCategory(name)
    if (!res.ok) { pushToast('error', res.error); return }
    setCats(prev => [...(prev ?? []), { id: res.id, name, photos: [] }])
    setNewCatName('')
  }

  const renameCategory = async (catId: string, name: string) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const res = await renamePhotoCategory(catId, trimmed)
    if (!res.ok) pushToast('error', res.error)
  }

  const removeCategory = async (catId: string, hasPhotos: boolean) => {
    const message = hasPhotos ? '이 카테고리와 안의 사진이 모두 삭제됩니다. 되돌릴 수 없어요.' : '이 카테고리를 삭제할까요?'
    if (!(await confirmDialog({ title: '카테고리 삭제', message, level: 'danger', confirmLabel: '삭제' }))) return
    const res = await deletePhotoCategory(catId)
    if (!res.ok) { pushToast('error', res.error); return }
    setCats(prev => prev && prev.filter(c => c.id !== catId))
  }

  return (
    <Modal open title="공용·외관 사진" subtitle="카테고리별로 공용공간·외관 사진을 올리고 공개를 정합니다" onClose={onClose} bodyClassName="px-5 sm:px-6 py-4">
      <div className="space-y-3">
        {cats === null ? (
          <p className="text-sm text-[var(--warm-muted)]">불러오는 중…</p>
        ) : (
          <>
            {cats.map(cat => (
              <div key={cat.id} className="bg-[var(--canvas)] rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2">
                  {/* 이름 편집 — 평소 투명, hover·focus 시 배경으로 '탭하면 입력'을 드러낸다(밑줄만은 편집 신호가 약함) */}
                  <input defaultValue={cat.name} onBlur={e => renameCategory(cat.id, e.target.value)}
                    aria-label="카테고리 이름" placeholder="카테고리 이름"
                    className="flex-1 min-w-0 rounded-md px-2 py-1 text-sm font-semibold text-[var(--warm-dark)] bg-transparent border border-transparent hover:bg-[var(--cream)] focus:bg-[var(--cream)] focus:border-[var(--coral)] outline-none transition-colors" />
                  <button type="button" onClick={() => fileRefs.current[cat.id]?.click()} disabled={uploadingCat === cat.id}
                    className="text-xs text-[var(--coral)] shrink-0 px-2 py-1 disabled:opacity-50">
                    {uploadingCat === cat.id ? '업로드 중…' : '+ 사진'}
                  </button>
                  {/* 파괴적 액션 — 주 액션에서 gap 만큼 떼고, 32px hit area + hover 시에만 위험색 */}
                  <button type="button" onClick={() => removeCategory(cat.id, cat.photos.length > 0)} aria-label="카테고리 삭제"
                    className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ml-1 text-[var(--warm-muted)] hover:text-[var(--danger-fg)] hover:bg-[var(--cream)] transition-colors"><XIcon /></button>
                  <input ref={el => { fileRefs.current[cat.id] = el }} type="file" accept="image/*" multiple className="hidden"
                    onChange={e => { void handleUpload(cat.id, e.target.files); e.target.value = '' }} />
                </div>
                {cat.photos.length > 0 ? (
                  <div className="grid grid-cols-3 gap-2">
                    {cat.photos.map(photo => {
                      const shown = photo.showOnSite ?? true
                      const is360 = photo.is360 ?? looksLike360(photo.fileName)
                      return (
                        <div key={photo.id} className="relative aspect-square rounded-lg overflow-hidden bg-[var(--canvas)]">
                          <img src={photo.storageUrl} alt={photo.fileName ?? ''} onClick={() => setViewPhoto(photo)}
                            className={`w-full h-full object-cover cursor-zoom-in transition-opacity ${shown ? '' : 'opacity-40'}`} />
                          {is360 && (
                            <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-sm bg-black/65 text-white text-[0.65625rem] font-bold pointer-events-none">360°</span>
                          )}
                          <button type="button" onClick={() => togglePhotoShow(cat.id, photo.id, !shown)}
                            aria-label={shown ? '소개 페이지에서 숨기기' : '소개 페이지에 표시'} title={shown ? '공개 중 · 눌러서 숨김' : '숨김 · 눌러서 공개'}
                            className={`absolute bottom-1 right-1 w-6 h-6 rounded-full flex items-center justify-center transition-colors ${shown ? 'bg-[var(--coral)]/85 text-[var(--on-solid)]' : 'bg-black/60 text-white/80'}`}>
                            {shown ? <EyeIcon /> : <EyeOffIcon />}
                          </button>
                          <button type="button" onClick={() => removePhoto(cat.id, photo.id)} aria-label="사진 삭제"
                            className="absolute top-1 right-1 w-6 h-6 bg-black/70 hover:bg-[var(--danger-solid)]/80 rounded-full text-white transition-colors flex items-center justify-center"><XIcon /></button>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  <div onClick={() => fileRefs.current[cat.id]?.click()}
                    className="h-16 border border-dashed border-[var(--warm-border)] rounded-xl flex items-center justify-center cursor-pointer text-xs text-[var(--warm-muted)] hover:border-[var(--coral)] transition-colors">
                    클릭하여 사진 업로드
                  </div>
                )}
              </div>
            ))}

            <div className="flex items-center gap-2 pt-3 border-t border-[var(--warm-border)]">
              <input value={newCatName} onChange={e => setNewCatName(e.target.value)} placeholder="새 카테고리 이름 (예: 옥상, 주차장)"
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addCategory() } }}
                className="flex-1 min-w-0 bg-[var(--cream)] border border-[var(--warm-border)] rounded-lg px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <Btn type="button" variant="secondary" onClick={addCategory}>추가</Btn>
            </div>
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">사진을 누르면 크게 보고 360으로 지정할 수 있어요. 눈 아이콘으로 공개·숨김을 정합니다.</p>
          </>
        )}
      </div>

      {viewPhoto && (
        <PhotoLightbox photo={viewPhoto} onClose={() => setViewPhoto(null)}
          onToggle360={next => togglePhoto360(viewPhoto.id, next)} />
      )}
    </Modal>
  )
}
