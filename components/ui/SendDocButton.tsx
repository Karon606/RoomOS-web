'use client'

// 서류 '보내기' — 사진(PNG)/PDF 형식 선택 후 전달(운영자 실기기 확인 2026-07-22:
// 일부 휴대폰 문자 앱은 PDF 첨부 전송이 안 됨 — 사진이 확실한 경로라 선택지를 제공한다).
// 형식 선택은 choiceDialog 정본(§14 3지선다).
// 제스처 만료 대책(첫 탭 실패 재발 방지): 버튼 탭 즉시 백그라운드로 fetch·변환을 시작해 선택창을 읽는
// 동안 준비를 끝내고, 그래도 늦어 거부되면 다운로드로 새지 않고 재탭 안내(결과 캐시로 재탭은 즉시 성공).
// 다운로드 폴백은 전달 자체를 못 하는 기기(데스크톱)에서만.
//
// 다페이지 지원(2026-08-01). 종전에는 계약서를 이 버튼에서 금지했다 — pdfToPng 가 1페이지만 그려
// 뒷장이 유실됐기 때문이다. 제기역점은 임의처분 동의서가 켜져 있어 계약서가 실제로 2장이라
// 그대로 붙였으면 동의서가 통째로 빠진 채 전송됐다. 이제 pdfToPngBlobs 로 전 페이지를 그려
// 페이지마다 한 장씩 함께 보낸다.
// 1장 서류(영수증·확인서)는 파일명·첨부 개수·문구가 종전과 완전히 동일하다 — blobs.length === 1
// 분기가 그것을 보장한다. 번호 접미는 2장 이상일 때만 붙는다.

import { useEffect, useRef, useState } from 'react'
import { pushToast } from '@/lib/saveStatus'
import { choiceDialog } from '@/components/ui/ConfirmDialog'
import { pdfToPngBlobs, prewarmPdfToPng } from '@/lib/pdfToPng'
import { shareFiles, canShareFiles, shareOrDownloadFile } from '@/lib/shareFile'

export function SendDocButton({ getPdfBytes, fileName, label = '보내기', className }: {
  getPdfBytes: () => Promise<ArrayBuffer>
  fileName: string   // 확장자 없이 — 형식에 따라 .png/.pdf 부여
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // 준비 캐시 — 첫 시도가 제스처 만료로 거부돼도 재탭이 즉시 성공하게 유지
  const cache = useRef<{ bytes?: Promise<ArrayBuffer>; pngs?: Promise<Blob[]> }>({})
  // 재탭 대기 형식 — 만료 재시도 때 선택창을 다시 묻지 않고 바로 시트를 연다
  const retryFormat = useRef<'confirm' | 'alt' | null>(null)
  useEffect(() => { prewarmPdfToPng() }, [])

  const ensureBytes = () => (cache.current.bytes ??= getPdfBytes().catch(e => { cache.current.bytes = undefined; throw e }))
  const ensurePngs = () => (cache.current.pngs ??= ensureBytes().then(b => pdfToPngBlobs(b)).catch(e => { cache.current.pngs = undefined; throw e }))

  const handleSend = async () => {
    // 선택창이 떠 있는 동안 미리 준비 — 사용자가 읽고 고르는 몇 초가 다운로드·변환 시간을 흡수한다
    void ensurePngs().catch(() => { /* 실패는 선택 후 본 흐름에서 처리 */ })
    const wasRetry = retryFormat.current != null
    const format = retryFormat.current ?? await choiceDialog({
      title: '어떤 형식으로 보낼까요?',
      message: '문자메시지는 사진이 가장 확실합니다. PDF는 일부 휴대폰·문자 앱에서 첨부 전송이 안 될 수 있습니다. 서류가 여러 장이면 사진도 장수만큼 함께 보냅니다.',
      confirmLabel: '사진으로',
      altLabel: 'PDF로',
    })
    retryFormat.current = null
    if (!format) return
    setBusy(true)
    try {
      const asPng = format === 'confirm'
      const blobs = asPng ? await ensurePngs() : [new Blob([await ensureBytes()], { type: 'application/pdf' })]
      const mime = asPng ? 'image/png' : 'application/pdf'
      const ext = asPng ? 'png' : 'pdf'
      // 1장이면 종전과 완전히 같은 파일명 — 영수증·확인서는 아무것도 달라지지 않는다
      const nameAt = (i: number) => blobs.length === 1 ? `${fileName}.${ext}` : `${fileName}_${i + 1}.${ext}`
      if (canShareFiles()) {
        const result = await shareFiles(blobs.map((b, i) => new File([b], nameAt(i), { type: mime })))
        // 제스처 만료 — 캐시·형식이 준비돼 있어 재탭은 선택창 없이 즉시 시트가 열린다. 다운로드로 새지 않는다(운영자 혼란 보고).
        // 단, 재탭(신선한 제스처 + 캐시 준비)마저 거부되면 이 기기는 실질 공유 불가(주로 PC 브라우저의
        // 지원 사칭) — 안내가 무한 반복되지 않게 다운로드로 확정 폴백(운영자 PC 확인 2026-07-22).
        if (result === 'retry') {
          if (wasRetry) await fallbackDownloadAll(blobs, nameAt, mime)
          else { retryFormat.current = format; pushToast('info', '준비가 끝났습니다. 다시 한 번 눌러 주세요.') }
        }
        else if (result === 'unsupported') await fallbackDownloadAll(blobs, nameAt, mime)
      } else {
        await fallbackDownloadAll(blobs, nameAt, mime)
      }
    } catch (e) {
      pushToast('error', (e as Error).message ?? '보내기에 실패했습니다.')
    } finally {
      setBusy(false)
    }
  }

  // 다운로드 폴백 — 여러 장이면 순차로. 연속 a.click() 은 브라우저가 두 번째부터 막을 수 있어
  // 한 장씩 사이를 띄운다(shareFile.ts 의 다중 공유 주석과 같은 사정).
  const fallbackDownloadAll = async (blobs: Blob[], nameAt: (i: number) => string, mime: string) => {
    let downloaded = false
    for (let i = 0; i < blobs.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300))
      const result = await shareOrDownloadFile(blobs[i], nameAt(i), mime)
      if (result === 'downloaded') downloaded = true
      if (result === 'cancelled') return
    }
    if (downloaded) {
      pushToast('info', blobs.length > 1
        ? `이 기기에서는 바로 보낼 수 없어 ${blobs.length}장을 파일로 저장했습니다.`
        : '이 기기에서는 바로 보낼 수 없어 파일로 저장했습니다.')
    }
  }

  return (
    <button type="button" onClick={handleSend} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '준비 중…' : label}
    </button>
  )
}
