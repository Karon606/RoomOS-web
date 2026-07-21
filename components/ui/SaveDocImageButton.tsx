'use client'

// 서류 PDF를 PNG로 바꿔 휴대폰 사진첩에 저장 — '사진 저장' 버튼(오류신고 dc56f953).
// iOS는 다운로드로는 사진첩에 못 넣으므로 공유 시트(navigator.share files → '이미지 저장')가 정경로,
// 안드로이드·데스크톱은 다운로드 폴백으로 충분. ShareDocButton 과 동일한 흐름·폴백 문법.
// PDF 바이트 출처는 호출부가 주입한다(발급 이력 = /api/doc-file, 발급 화면 = preview 응답).

import { useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { pdfToPngBlob } from '@/lib/pdfToPng'

export function SaveDocImageButton({ getPdfBytes, fileName, label = '사진 저장', className }: {
  getPdfBytes: () => Promise<ArrayBuffer>
  fileName: string   // 확장자 없이 넘겨도 됨 — .png 자동 부여
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)

  const handleSave = async () => {
    setBusy(true)
    try {
      const bytes = await getPdfBytes()
      const blob = await pdfToPngBlob(bytes)
      const name = fileName.toLowerCase().endsWith('.png') ? fileName : `${fileName}.png`
      const file = new File([blob], name, { type: 'image/png' })

      const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
      if (nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
        try {
          await nav.share({ files: [file], title: name })
        } catch (e) {
          if ((e as Error)?.name !== 'AbortError') throw e   // 사용자가 취소한 건 무시
        }
      } else {
        // 폴백 — 공유 미지원(주로 데스크톱): 다운로드
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url; a.download = name; a.click()
        URL.revokeObjectURL(url)
        pushToast('info', '이 기기는 공유를 지원하지 않아 이미지를 내려받았습니다.')
      }
    } catch (e) {
      pushToast('error', (e as Error).message ?? '사진 저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={handleSave} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '변환 중…' : label}
    </button>
  )
}
