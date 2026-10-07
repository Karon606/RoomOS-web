'use client'

// 영업장 서류 한 칸(미리보기 상자 + 업로드·교체·삭제·적용취소) — 사업자등록증과 통장사본 국문·영문이 같은 칸을 쓴다.
//
// 사업자등록증 카드 본문을 그대로 옮겨 왔다(클래스·문구 불변). 종류마다 다른 것은 라벨과 미리보기
// 주소뿐이라 라벨은 종류 지도(lib/propertyDocs)에서, 주소는 부르는 쪽(previewUrl)에서 받는다.
// 칸이 셋인데 본문을 셋 베끼면 한 벌만 고쳐지는 날이 온다 — 그래서 한 컴포넌트다.
//
// 루트는 조각(fragment)이다. 사업자등록증 카드에서 이 칸이 놓이는 자리의 DOM 이 종전과 같아야
// (카드 space-y-3 의 직계 자식 둘: 미리보기 줄 + 썸네일 오류 한 줄) 픽셀이 그대로다.

import { useEffect, useState } from 'react'
import { Btn, btnClass } from '@/components/ui/Btn'
import { Skeleton } from '@/components/ui/Skeleton'
import { RotateCcw } from '@/components/ui/RotateCcw'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { trackSave, pushToast, humanError } from '@/lib/saveStatus'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { fileToUploadPdf } from '@/lib/uploadImage'
import { pdfToPngBlob } from '@/lib/pdfToPng'
import {
  PROPERTY_DOCS, withObjectParticle,
  type PropertyDocKind, type PropertyDocSlotValue,
} from '@/lib/propertyDocs'
import {
  createPropertyDocUploadSession, finalizePropertyDoc, deletePropertyDoc, restorePropertyDoc,
} from '@/app/(app)/settings/actions'

// PDF 첫 장을 PNG 로 — 래스터화 정본은 lib/pdfToPng(서류 '사진 저장'·상담 도구가 쓰는 그것)이고 바이트는
// 미리보기와 같은 인증 프록시에서 온다. 컴포넌트 밖에 두는 이유는 하나다 — try 안의 throw 를 보면
// react-hooks 컴파일러 규칙이 컴포넌트 분석을 통째로 포기해 아래 효과의 검사까지 조용히 꺼진다.
async function firstPagePng(url: string, title: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${withObjectParticle(title)} 불러오지 못했습니다 (${res.status}).`)
  return pdfToPngBlob(await res.arrayBuffer(), 1.5)
}

export function PropertyDocSlot({ kind, slot, previewUrl, onChange, canUndo, onCanUndoChange }: {
  kind: PropertyDocKind
  /** 지금 등록된 파일 — null 이면 미등록. 상태는 부르는 쪽(카드)이 쥔다. */
  slot: PropertyDocSlotValue | null
  /**
   * 미리보기·첫 장 썸네일이 무는 인증 프록시 주소. v= 로 파일 ID 를 실어 교체 직후 옛 캐시를 끊는다.
   * 첫 장 효과의 의존이라 부르는 쪽은 모듈 상수로 넘긴다(렌더마다 새 함수면 매번 다시 그린다).
   */
  previewUrl: (driveFileId: string) => string
  onChange: (next: PropertyDocSlotValue | null) => void
  /** 서버에 직전 스냅샷이 남아 있는가 — 있으면 버튼 열 맨 아래에 '적용취소'가 선다(§16 진입점 2). */
  canUndo: boolean
  onCanUndoChange: (next: boolean) => void
}) {
  const { title } = PROPERTY_DOCS[kind]
  const [uploading, setUploading] = useState(false)
  const [undoing, setUndoing]     = useState(false)
  // PDF 는 첫 장을 그려 같은 칸에 얹는다(운영자 지적 2026-09-16).
  // 사진을 올리기 전에 PDF 한 장으로 정규화하면서(handleSelect) 이미지 갈래로 떨어지는
  // 파일이 사라져, 어떤 장이 올라가 있는지 화면이 말해 주지 못했다. 실패하면 종전 'PDF' 표시로
  // 떨어지되 아래 한 줄이 무엇을 못 그렸는지 말한다 — 조용히 삼키면 같은 회귀가 또 안 보인다.
  const [thumb, setThumb]           = useState<string | null>(null)
  const [thumbError, setThumbError] = useState<string | null>(null)

  // 등록된 것이 PDF 면 첫 장을 래스터화해 같은 칸에 그린다(firstPagePng). 파일이 바뀌면(driveFileId)
  // 다시 그린다 — 교체 직후 옛 장이 남으면 미리보기가 거짓말을 한다.
  const slotId = slot?.driveFileId
  const slotMime = slot?.mimeType
  useEffect(() => {
    // 파일이 바뀐 그 순간 옛 장을 걷는 자리라 동기여야 한다 — 늦추면 교체 직후 한 프레임 옛 장이 선다.
    // 그리지 않을 갈래(미등록·이미지)도 같은 줄에서 걷힌다.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThumb(null); setThumbError(null)
    // 조건이 아래 그리는 갈래와 **같은 문장**이다 — 지금 맨 'PDF' 글자만 서는 그 집합이 곧
    // 첫 장을 그려야 하는 집합이다. 갈라 적으면 mime 이 빈 옛 저장분이 어느 쪽에도 안 든다.
    if (!slotId || slotMime === undefined || slotMime.startsWith('image/')) return
    const id = slotId
    let alive = true
    let made: string | null = null
    void (async () => {
      try {
        const blob = await firstPagePng(previewUrl(id), title)
        if (!alive) return
        made = URL.createObjectURL(blob)
        setThumb(made)
      } catch (err) {
        if (!alive) return
        setThumb(null)
        setThumbError(humanError(err, '첫 장을 여는 데 실패했습니다.'))
      }
    })()
    return () => { alive = false; if (made) URL.revokeObjectURL(made) }
  }, [slotId, slotMime, title, previewUrl])

  // 상태 정리를 finally 로 묶지 않는다 — try/finally 안의 setState 를 보면 react-hooks 컴파일러 규칙이
  // 컴포넌트 전체 분석을 포기해 위 효과의 검사까지 조용히 꺼진다(ConsultToolsModal 에 적힌 함정).
  // 대신 catch 가 전부 삼키게 두고 그 뒤에서 정리한다 — 여기까지 오는 길이 하나라 결과는 finally 와 같다.

  // 적용취소 — 서버가 교체·삭제 때 남긴 스냅샷으로 되살린다(Drive ID 는 안 보낸다).
  // 결과 토스트의 목적어('삭제를'·'교체를')는 서버가 실제로 무른 쪽으로 정한다. 토스트 액션과
  // 카드 버튼이 같은 함수를 지나므로 어느 입구로 눌러도 같은 문장이다.
  const runRestore = async () => {
    setUndoing(true)
    const release = trackSave()
    try {
      const res = await restorePropertyDoc(kind)
      if (res.ok) {
        onChange(res.slot)
        onCanUndoChange(false)
        pushToast('info', `${title} ${res.undid === 'replace' ? '교체를' : '삭제를'} 적용취소했습니다 · 이전 파일로 복귀`)
      } else {
        // 되살릴 수 없게 된 스냅샷은 서버가 걷었다 — 카드 버튼도 함께 내린다.
        if (res.stale) onCanUndoChange(false)
        pushToast('error', res.error)
      }
    } catch (err) {
      pushToast('error', humanError(err, `${title} 적용취소 실패`))
    }
    release(); setUndoing(false)
  }

  // 첫 업로드의 적용취소는 곧 삭제다 — 되살릴 이전 파일이 없다. 삭제는 그 자체로 스냅샷을 남기므로
  // 이 뒤에 카드의 적용취소가 서고, 누르면 방금 지운 파일이 돌아온다.
  const runUndoUpload = async () => {
    setUndoing(true)
    const release = trackSave()
    try {
      const res = await deletePropertyDoc(kind)
      if (res.ok) {
        onChange(null)
        onCanUndoChange(true)
        pushToast('info', `${title} 업로드를 적용취소했습니다 · 미등록으로 복귀`)
      } else {
        pushToast('error', res.error)
      }
    } catch (err) {
      pushToast('error', humanError(err, `${title} 적용취소 실패`))
    }
    release(); setUndoing(false)
  }

  // 업로드 축은 도장과 같다(세션 발급 → Drive 직접 PUT → 마무리).
  // 다른 점은 둘뿐이다. 저장 형식이 PDF 하나라는 것과, mime 을 서버가 판정해 함께 저장한다는 것.
  //
  // **사진은 올리기 전에 PDF 한 장으로 바뀐다**(lib/uploadImage, 운영자 결정 2026-09-16).
  // 아이폰 HEIC 를 그대로 저장하면 상담 문자·메일 첨부가 열리지 않는 파일로 나간다. 변환에
  // 실패하면 던지므로 원본이 조용히 올라가는 분기가 없고, 그 문구는 handleSelect 의 catch 가 띄운다.
  const upload = async (file: File) => {
    const replacing = slot !== null
    const { file: upFile, converted } = await fileToUploadPdf(file)
    const session = await createPropertyDocUploadSession(kind, {
      fileName: upFile.name, mimeType: upFile.type, fileSize: upFile.size,
      origin: window.location.origin,
    })
    if (!session.ok) { pushToast('error', session.error); return }
    const driveFileId = await uploadFileToDriveSession(session.uploadUrl, upFile)
    const fin = await finalizePropertyDoc(kind, driveFileId)
    if (!fin.ok) { pushToast('error', fin.error); return }
    onChange({ driveFileId, mimeType: fin.mimeType })
    // 교체면 서버가 이전 파일 스냅샷을 남겼고, 처음 올림이면 남은 스냅샷을 걷었다.
    onCanUndoChange(replacing)
    pushToast('success', `${title} ${replacing ? '교체됨' : '업로드됨'}`, {
      ...(converted ? { detail: '사진을 PDF 한 장으로 바꿔 저장했습니다.' } : {}),
      action: { label: '적용취소', run: () => { void (replacing ? runRestore() : runUndoUpload()) } },
    })
  }
  const handleSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const release = trackSave()
    try {
      await upload(file)
    } catch (err) {
      pushToast('error', humanError(err, `${title} 업로드 실패`))
    }
    release(); setUploading(false)
  }
  const handleDelete = async () => {
    if (!(await confirmDialog({ title: `${withObjectParticle(title)} 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deletePropertyDoc(kind)
      if (res.ok) {
        onChange(null)
        onCanUndoChange(true)
        pushToast('success', `${title} 삭제됨`, {
          action: { label: '적용취소', run: () => { void runRestore() } },
        })
      } else {
        pushToast('error', res.error)
      }
    } catch (err) {
      pushToast('error', humanError(err, `${title} 삭제 실패`))
    }
    release()
  }

  const busy = uploading || undoing

  return (
    <>
      <div className="flex items-center gap-4">
        {/* 미리보기 바탕은 --cream-soft — 다크에서 --canvas 는 #000 이라 카드에 검은 구멍이 뚫린다(§28) */}
        {/* self-start — 적용취소까지 서면 버튼 열(148px)이 상자(96px)보다 커져 가운데 정렬로는 상자가
            26px 내려앉고 서는 순간 뛴다. 열이 상자보다 작거나 같은 평소에는 상자가 행 높이라 무변동이다. */}
        <div className="self-start w-24 h-24 rounded-xl border border-dashed border-[var(--warm-border)] flex items-center justify-center bg-[var(--cream-soft)] overflow-hidden">
          {slot?.mimeType.startsWith('image/') ? (
            // 인증 프록시를 직접 문다 — Drive 공개 URL 을 쓰지 않는다. v= 는 교체 직후 옛 캐시를 끊는 키다.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl(slot.driveFileId)} alt={title} className="max-w-full max-h-full object-contain" />
          ) : thumb ? (
            // PDF 첫 장. 위 효과가 만든 화면 안 주소(blob:)라 v= 가 필요 없다 — 파일이 바뀌면 효과가 다시 그린다.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt={`${title} 첫 장`} className="max-w-full max-h-full object-contain" />
          ) : slot ? (
            // 아직 그리는 중 — 'PDF' 글자를 먼저 세우면 1~3초 뒤 그림으로 바뀌며 칸이 튄다.
            // delayed-fallback 은 300ms 안에 끝나면 한 프레임도 안 보인다(§18.3).
            thumbError
              ? <span className="text-xs font-medium text-[var(--warm-mid)]">PDF</span>
              : <Skeleton className="w-full h-full delayed-fallback" />
          ) : (
            // --warm-muted 는 이 바탕(--cream-soft) 위에서 다크 4.46:1 로 §28 본문 하한(4.5)에 못 미쳤다
            // (헤드리스 실측). --warm-mid 는 라이트에서 --warm-muted 와 같은 값이라 밝은 화면은 무변동.
            <span className="text-xs text-[var(--warm-mid)]">미등록</span>
          )}
        </div>
        <div className="flex flex-col gap-2">
          {/* 파일 input 을 감싸는 label 이라 Btn 을 쓸 수 없다 — 토큰은 btnClass 로 공유한다. */}
          <label className={btnClass('primary', 'sm', `cursor-pointer ${busy ? 'opacity-60 pointer-events-none' : ''}`)}>
            {uploading ? '업로드 중…' : (slot ? '교체' : '업로드')}
            <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleSelect} disabled={busy} />
          </label>
          {slot && <Btn variant="danger" size="sm" onClick={handleDelete} disabled={busy}>삭제</Btn>}
          {/* 토스트(6초)가 지나가도 되돌릴 길이 남아야 한다(§16 진입점 2, 원위치 btn-subtle sm).
              스냅샷이 없는 영업장(대부분)에는 안 선다 — 그래서 이 칸의 평소 모양은 종전과 같다. */}
          {canUndo && (
            <Btn variant="subtle" size="sm" onClick={() => { void runRestore() }} disabled={busy}>
              <RotateCcw />
              적용취소
            </Btn>
          )}
        </div>
      </div>
      {/* 미리보기만 못 그린 것이라 파일·보내기는 멀쩡하다는 것까지 말한다 — 그 말이 없으면
          운영자가 서류가 깨진 줄 알고 멀쩡한 파일을 다시 올린다. */}
      {thumbError && (
        <p className="text-xs text-[var(--warm-mid)]">미리보기를 그리지 못했습니다. {thumbError} 파일은 그대로 있어 보내기와 첨부는 됩니다.</p>
      )}
    </>
  )
}
