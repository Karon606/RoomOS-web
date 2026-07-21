'use client'

// 1장짜리 서류 '보내기' — 사진(PNG)/PDF 형식 선택 후 공유 시트(운영자 실기기 확인 2026-07-22:
// 일부 휴대폰 문자 앱은 PDF 첨부 전송이 안 됨 — 사진이 확실한 경로라 선택지를 제공한다).
// 형식 선택은 choiceDialog 정본(§14 3지선다), 공유·폴백은 shareOrDownloadFile 정본.
// 다페이지 서류(계약서)는 이 버튼 금지 — pdfToPng 가 1페이지만 그려 뒷장이 유실된다(ShareDocButton 유지).

import { useEffect, useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { pdfToPngBlob, prewarmPdfToPng } from '@/lib/pdfToPng'
import { shareOrDownloadFile } from '@/lib/shareFile'

export function SendDocButton({ getPdfBytes, fileName, label = '보내기', className }: {
  getPdfBytes: () => Promise<ArrayBuffer>
  fileName: string   // 확장자 없이 — 형식에 따라 .png/.pdf 부여
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // 사진 선택 시 변환 지연으로 공유 시트 제스처가 만료되지 않게 선로딩(lib/shareFile.ts 제스처 규칙)
  useEffect(() => { prewarmPdfToPng() }, [])

  const handleSend = async () => {
    const format = await choiceDialog({
      title: '어떤 형식으로 보낼까요?',
      message: '문자메시지는 사진이 가장 확실합니다. PDF는 일부 휴대폰·문자 앱에서 첨부 전송이 안 될 수 있습니다.',
      confirmLabel: '사진으로',
      altLabel: 'PDF로',
    })
    if (!format) return
    setBusy(true)
    try {
      const bytes = await getPdfBytes()
      const asPng = format === 'confirm'
      const blob = asPng ? await pdfToPngBlob(bytes) : new Blob([bytes], { type: 'application/pdf' })
      const name = `${fileName}.${asPng ? 'png' : 'pdf'}`
      const result = await shareOrDownloadFile(blob, name, asPng ? 'image/png' : 'application/pdf')
      if (result === 'downloaded') pushToast('info', '공유 시트를 열 수 없어 파일을 내려받았습니다. 파일 앱의 Download 에서 확인하세요.')
    } catch (e) {
      pushToast('error', (e as Error).message ?? '보내기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={handleSend} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '변환 중…' : label}
    </button>
  )
}
