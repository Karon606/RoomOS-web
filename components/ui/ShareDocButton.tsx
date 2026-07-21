'use client'

// 저장된 서류(Drive PDF)를 모바일 '공유'로 메일/메시지에 첨부 전송.
// navigator.share({ files }) 지원 시 공유 시트 → 사용자가 메일/카톡 등 선택해 첨부 발송.
// 미지원(데스크톱)·제스처 만료면 다운로드 폴백 — shareOrDownloadFile 정본 사용(사진 저장 버튼과 동일 클래스).

import { useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { shareOrDownloadFile } from '@/lib/shareFile'

export function ShareDocButton({ driveFileId, fileName, label = '공유', className }: {
  driveFileId: string
  fileName: string
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)

  const handleShare = async () => {
    setBusy(true)
    try {
      const res = await fetch(`/api/doc-file?id=${encodeURIComponent(driveFileId)}`)
      if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
      const blob = await res.blob()
      const name = fileName.toLowerCase().endsWith('.pdf') ? fileName : `${fileName}.pdf`
      const result = await shareOrDownloadFile(blob, name, 'application/pdf')
      if (result === 'downloaded') pushToast('info', '공유 시트를 열 수 없어 파일을 내려받았습니다. 파일 앱의 Download 에서 확인하세요.')
    } catch (e) {
      pushToast('error', (e as Error).message ?? '공유에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={handleShare} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '여는 중…' : label}
    </button>
  )
}
