'use client'

// 서류 PDF를 PNG로 바꿔 휴대폰 사진첩에 저장 — '사진 저장' 버튼(오류신고 dc56f953).
// iOS는 다운로드로는 사진첩에 못 넣으므로 공유 시트(navigator.share files → '이미지 저장')가 정경로,
// 안드로이드·데스크톱은 다운로드 폴백으로 충분. 공유·폴백은 shareOrDownloadFile 정본 사용.
// PDF 바이트 출처는 호출부가 주입한다(발급 이력 = /api/doc-file, 발급 화면 = preview 응답).

import { useEffect, useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { pdfToPngBlob, prewarmPdfToPng } from '@/lib/pdfToPng'
import { shareOrDownloadFile } from '@/lib/shareFile'

export function SaveDocImageButton({ getPdfBytes, fileName, label = '사진 저장', className }: {
  getPdfBytes: () => Promise<ArrayBuffer>
  fileName: string   // 확장자 없이 넘겨도 됨 — .png 자동 부여
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // 변환 라이브러리 선로딩 — 첫 탭이 느려 공유 시트 제스처 허용 시간이 만료되던 문제(갤럭시) 방어
  useEffect(() => { prewarmPdfToPng() }, [])

  const handleSave = async () => {
    setBusy(true)
    try {
      const bytes = await getPdfBytes()
      const blob = await pdfToPngBlob(bytes)
      const name = fileName.toLowerCase().endsWith('.png') ? fileName : `${fileName}.png`
      const result = await shareOrDownloadFile(blob, name, 'image/png')
      if (result === 'downloaded') pushToast('info', '이 기기에서는 사진첩에 바로 넣을 수 없어 파일로 저장했습니다. 갤러리 또는 파일 앱의 Download 에서 확인하세요.')
    } catch (e) {
      pushToast('error', (e as Error).message ?? '사진 저장에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={handleSave} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '준비 중…' : label}
    </button>
  )
}
