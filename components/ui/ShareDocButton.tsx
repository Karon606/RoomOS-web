'use client'

// 저장된 서류(Drive PDF)를 모바일 '공유'로 메일/메시지에 첨부 전송.
// navigator.share({ files }) 지원 시 공유 시트 → 사용자가 메일/카톡 등 선택해 첨부 발송.
// 미지원(데스크톱 등)이면 다운로드로 폴백.

import { useState } from 'react'
import { pushToast } from '@/lib/saveStatus'

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
      const file = new File([blob], name, { type: 'application/pdf' })

      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
        try {
          await nav.share({ files: [file], title: fileName })
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') throw e   // 사용자가 취소한 건 무시
        }
      } else {
        // 폴백 — 공유 미지원(주로 데스크톱): 다운로드
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = name; a.click()
        URL.revokeObjectURL(url)
        pushToast('info', '이 기기는 공유를 지원하지 않아 파일을 내려받았습니다.')
      }
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
