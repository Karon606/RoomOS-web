'use client'

// 저장된 서류(Drive PDF)를 메일·메시지에 첨부해 입주자에게 전달.
// navigator.share({ files }) 지원 시 시스템 시트가 뜨고 사용자가 메일·카톡 등을 골라 발송한다.
// 미지원(데스크톱)·제스처 만료면 다운로드 폴백 — shareOrDownloadFile 정본 사용(사진 저장 버튼과 동일 클래스).
//
// 라벨은 여기서만 정한다 — 호출부가 label prop 으로 덮어쓰던 시절 같은 버튼이 모달에서는 '공유',
// 계약서 목록에서는 '보내기' 로 불려 운영자가 혼동했다(2026-08-01 지적). 정본 동사는 '보내기'
// (= 만들어진 서류를 입주자에게 전달). 새 호출부에서도 label 을 넘기지 말 것.

import { useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { shareOrDownloadFile } from '@/lib/shareFile'

export function ShareDocButton({ driveFileId, fileName, label = '보내기', className }: {
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
      if (result === 'downloaded') pushToast('info', '이 기기에서는 바로 보낼 수 없어 파일로 저장했습니다. 파일 앱의 Download 에서 확인하세요.')
    } catch (e) {
      pushToast('error', (e as Error).message ?? '보내기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={handleShare} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '준비 중…' : label}
    </button>
  )
}
