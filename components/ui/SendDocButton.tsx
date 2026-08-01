'use client'

// 1장짜리 서류 '보내기' — 사진(PNG)/PDF 형식 선택 후 공유 시트(운영자 실기기 확인 2026-07-22:
// 일부 휴대폰 문자 앱은 PDF 첨부 전송이 안 됨 — 사진이 확실한 경로라 선택지를 제공한다).
// 형식 선택은 choiceDialog 정본(§14 3지선다).
// 제스처 만료 대책(첫 탭 실패 재발 방지): 버튼 탭 즉시 백그라운드로 fetch·변환을 시작해 선택창을 읽는
// 동안 준비를 끝내고, 그래도 늦어 거부되면 다운로드로 새지 않고 재탭 안내(결과 캐시로 재탭은 즉시 성공).
// 다운로드 폴백은 공유 자체를 못 하는 기기(데스크톱)에서만. 다페이지 서류(계약서)는 이 버튼 금지 —
// pdfToPng 가 1페이지만 그려 뒷장이 유실된다(ShareDocButton 유지).

import { useEffect, useRef, useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { pdfToPngBlob, prewarmPdfToPng } from '@/lib/pdfToPng'
import { shareFiles, canShareFiles, shareOrDownloadFile } from '@/lib/shareFile'

export function SendDocButton({ getPdfBytes, fileName, label = '보내기', className }: {
  getPdfBytes: () => Promise<ArrayBuffer>
  fileName: string   // 확장자 없이 — 형식에 따라 .png/.pdf 부여
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // 준비 캐시 — 첫 시도가 제스처 만료로 거부돼도 재탭이 즉시 성공하게 유지
  const cache = useRef<{ bytes?: Promise<ArrayBuffer>; png?: Promise<Blob> }>({})
  // 재탭 대기 형식 — 만료 재시도 때 선택창을 다시 묻지 않고 바로 시트를 연다
  const retryFormat = useRef<'confirm' | 'alt' | null>(null)
  useEffect(() => { prewarmPdfToPng() }, [])

  const ensureBytes = () => (cache.current.bytes ??= getPdfBytes().catch(e => { cache.current.bytes = undefined; throw e }))
  const ensurePng = () => (cache.current.png ??= ensureBytes().then(pdfToPngBlob).catch(e => { cache.current.png = undefined; throw e }))

  const handleSend = async () => {
    // 선택창이 떠 있는 동안 미리 준비 — 사용자가 읽고 고르는 몇 초가 다운로드·변환 시간을 흡수한다
    void ensurePng().catch(() => { /* 실패는 선택 후 본 흐름에서 처리 */ })
    const wasRetry = retryFormat.current != null
    const format = retryFormat.current ?? await choiceDialog({
      title: '어떤 형식으로 보낼까요?',
      message: '문자메시지는 사진이 가장 확실합니다. PDF는 일부 휴대폰·문자 앱에서 첨부 전송이 안 될 수 있습니다.',
      confirmLabel: '사진으로',
      altLabel: 'PDF로',
    })
    retryFormat.current = null
    if (!format) return
    setBusy(true)
    try {
      const asPng = format === 'confirm'
      const blob = asPng ? await ensurePng() : new Blob([await ensureBytes()], { type: 'application/pdf' })
      const name = `${fileName}.${asPng ? 'png' : 'pdf'}`
      const mime = asPng ? 'image/png' : 'application/pdf'
      if (canShareFiles()) {
        const result = await shareFiles([new File([blob], name, { type: mime })])
        // 제스처 만료 — 캐시·형식이 준비돼 있어 재탭은 선택창 없이 즉시 시트가 열린다. 다운로드로 새지 않는다(운영자 혼란 보고).
        // 단, 재탭(신선한 제스처 + 캐시 준비)마저 거부되면 이 기기는 실질 공유 불가(주로 PC 브라우저의
        // 지원 사칭) — 안내가 무한 반복되지 않게 다운로드로 확정 폴백(운영자 PC 확인 2026-07-22).
        if (result === 'retry') {
          if (wasRetry) await fallbackDownload(blob, name, mime)
          else { retryFormat.current = format; pushToast('info', '준비가 끝났습니다. 다시 한 번 눌러 주세요.') }
        }
        else if (result === 'unsupported') await fallbackDownload(blob, name, mime)
      } else {
        await fallbackDownload(blob, name, mime)
      }
    } catch (e) {
      pushToast('error', (e as Error).message ?? '보내기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  const fallbackDownload = async (blob: Blob, name: string, mime: string) => {
    const result = await shareOrDownloadFile(blob, name, mime)
    if (result === 'downloaded') pushToast('info', '이 기기에서는 바로 보낼 수 없어 파일로 저장했습니다.')
  }

  return (
    <button type="button" onClick={handleSend} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '준비 중…' : label}
    </button>
  )
}
