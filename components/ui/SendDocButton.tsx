'use client'

// 서류 '내보내기' — 사진(PNG)/PDF 형식을 고른 뒤 기기에 저장하거나 문자로 보낸다.
// 이름이 '보내기'였을 때 운영자가 사진 저장 경로를 못 찾았다. 이 버튼은 문서를 앱 밖으로
// 빼내는 모든 길의 입구이고, 종이 출력까지 여기로 들어올 수 있어야 해서 '내보내기'가 정본이다.
// (운영자 실기기 확인 2026-07-22:
// 일부 휴대폰 문자 앱은 PDF 첨부 전송이 안 됨 — 사진이 확실한 경로라 선택지를 제공한다).
// 형식 선택은 choiceDialog 정본(§14 3지선다).
// 제스처 만료 대책(첫 탭 실패 재발 방지): 버튼 탭 즉시 백그라운드로 fetch·변환을 시작해 선택창을 읽는
// 동안 준비를 끝내고, 그래도 늦어 거부되면 다운로드로 새지 않고 '공유 창 열기' 확인 창을 띄운다 —
// 그 확인 탭이 곧 신선한 제스처라 같은 흐름 안에서 시트가 열린다(재탭 안내 토스트를 대체).
// 다운로드는 '기기에 저장'(아이폰 계열 제외)과, 전달 자체를 못 하는 기기(데스크톱) 폴백에서만.
//
// 다페이지 지원(2026-08-01). 종전에는 계약서를 이 버튼에서 금지했다 — pdfToPng 가 1페이지만 그려
// 뒷장이 유실됐기 때문이다. 제기역점은 임의처분 동의서가 켜져 있어 계약서가 실제로 2장이라
// 그대로 붙였으면 동의서가 통째로 빠진 채 전송됐다. 이제 pdfToPngBlobs 로 전 페이지를 그려
// 페이지마다 한 장씩 함께 보낸다.
// 1장 서류(영수증·확인서)는 파일명·첨부 개수·문구가 종전과 완전히 동일하다 — blobs.length === 1
// 분기가 그것을 보장한다. 번호 접미는 2장 이상일 때만 붙는다.

import { useEffect, useRef, useState } from 'react'
import { pushToast, TOAST_DUR_LONG } from '@/lib/saveStatus'
import { choiceDialog, confirmDialog } from '@/components/ui/ConfirmDialog'
import { pdfToPngBlobs, prewarmPdfToPng } from '@/lib/pdfToPng'
import { shareFiles, canShareFiles, shareOrDownloadFile, photoSaveNeedsShareSheet } from '@/lib/shareFile'
import { sniffDocMime, extForDocMime, isImageDocMime } from '@/lib/docMime'

// 빈 바이트로 PDF 를 만들면 0KB 파일이 조용히 공유돼 상대가 못 여는 사고가 된다(신고 5c99b5c8 —
// pdf.js 버퍼 이관이 원본을 비우던 것. 근본은 pdfToPng 사본 전달로 봉합, 이건 그 클래스의 재발 감지망).
function pdfBlobOf(bytes: ArrayBuffer): Blob {
  if (bytes.byteLength === 0) throw new Error('서류 준비에 실패했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.')
  return new Blob([bytes], { type: 'application/pdf' })
}

export function SendDocButton({ getPdfBytes, fileName, label = '내보내기', className }: {
  getPdfBytes: () => Promise<ArrayBuffer>
  fileName: string   // 확장자 없이 — 형식에 따라 .png/.pdf 부여
  label?: string
  className?: string
}) {
  const [busy, setBusy] = useState(false)
  // 준비 캐시 — 선택창을 읽는 동안 시작해 둔 fetch·변환을 본 흐름과 재시도가 함께 쓴다.
  // 탭 단위로만 유효하다(handleSend 진입에서 비운다) — 서명 전 서류가 다음 탭까지 살면 안 된다.
  const cache = useRef<{ bytes?: Promise<ArrayBuffer>; pngs?: Promise<Blob[]> }>({})
  useEffect(() => { prewarmPdfToPng() }, [])

  const ensureBytes = () => (cache.current.bytes ??= getPdfBytes().catch(e => { cache.current.bytes = undefined; throw e }))
  const ensurePngs = () => (cache.current.pngs ??= ensureBytes().then(b => pdfToPngBlobs(b)).catch(e => { cache.current.pngs = undefined; throw e }))

  // 두 번 묻는다(§30.5). 형식을 먼저 정하고 그다음 어디로 보낼지 정한다.
  // 두 물음을 하나로 합치면 선택지가 넷이 되어 다이얼로그가 못 담고, 무엇보다
  // '사진으로 문자' 와 '사진으로 저장' 이 사용자 머릿속에서 다른 일인데 한 줄에 섞인다.
  // isImage 면 형식 질문을 건너뛴다 — 스캔 사진은 이미 사진이고, 여기서 PDF 를 고르게 하면
  // 앱이 없는 종이를 지어내야 한다(419호 사고 계열: 이미지를 PDF 로 싸면 깨진 파일이 나간다).
  const ask = async (isImage: boolean): Promise<{ asPng: boolean; toPhone: boolean } | null> => {
    for (;;) {
      const format = isImage ? 'confirm' as const : await choiceDialog({
        title: '어떤 형식으로 만들까요?',
        message: '문자메시지로 보낼 때는 사진이 가장 확실합니다. PDF는 일부 휴대폰·문자 앱에서 첨부가 안 될 수 있습니다. 서류가 여러 장이면 사진도 장수만큼 만들어집니다.',
        confirmLabel: '사진으로',
        altLabel: 'PDF로',
      })
      if (!format || format === 'back') return null
      // 아이폰 계열에서 '기기에 저장'은 공유 창을 거친다. 시트만 덜렁 열면 어느 항목이 저장인지 못 찾으므로
      // (운영자 실기) 고르기 전에 여기서 미리 알려준다 — 선택창은 사용자가 읽을 때까지 떠 있다.
      const viaSheet = photoSaveNeedsShareSheet() && canShareFiles()
      const dest = await choiceDialog({
        title: '만든 서류를 어떻게 할까요?',
        ...(viaSheet ? {
          message: format === 'confirm'
            ? '[기기에 저장]을 고르면 공유 창이 열립니다. 공유 창에서 [이미지 저장]을 누르면 사진첩에 저장됩니다.'
            : '[기기에 저장]을 고르면 공유 창이 열립니다. 공유 창에서 [파일에 저장]을 누르면 원하는 위치에 저장됩니다.',
        } : {}),
        confirmLabel: '기기에 저장',
        altLabel: '문자로 보내기',
        // 형식을 잘못 골랐을 때 되짚을 길. 취소는 흐름 전체를 무변경으로 닫는 것이라 이것과 다르다.
        backLabel: '형식 다시 고르기',
      })
      // 이미지는 형식 질문이 없어 되짚을 앞 단계도 없다 — 되돌아가면 같은 창이 다시 뜬다.
      if (dest === 'back') { if (isImage) return null; continue }
      if (!dest) return null
      return { asPng: format === 'confirm', toPhone: dest === 'alt' }
    }
  }

  const handleSend = async () => {
    // 탭할 때마다 캐시를 버린다 — 앞선 탭에서 만든 '서명 전' PDF 가 남아 있으면 서명하고 다시 눌러도
    // 옛 서류가 나간다. 선택창을 읽는 시간이 다시 받아오는 비용을 그대로 흡수한다.
    cache.current = {}
    // 선택창이 떠 있는 동안 미리 준비 — 사용자가 읽고 고르는 몇 초가 다운로드·변환 시간을 흡수한다.
    // 형식을 묻기 전에 바이트를 봐야 한다(이미지면 질문 자체가 없다). 이미지는 변환기에 넣지 않는다.
    const head = await ensureBytes().catch(() => null)
    const srcMime = head ? sniffDocMime(head) : ''
    const isImage = isImageDocMime(srcMime)
    if (!isImage) void ensurePngs().catch(() => { /* 실패는 선택 후 본 흐름에서 처리 */ })
    const pick = await ask(isImage)
    if (!pick) return
    const { asPng, toPhone } = pick
    setBusy(true)
    try {
      const blobs = isImage
        ? [new Blob([await ensureBytes()], { type: srcMime })]
        : asPng ? await ensurePngs() : [pdfBlobOf(await ensureBytes())]
      const mime = isImage ? srcMime : asPng ? 'image/png' : 'application/pdf'
      const ext = extForDocMime(mime)
      // 1장이면 종전과 완전히 같은 파일명 — 영수증·확인서는 아무것도 달라지지 않는다
      const nameAt = (i: number) => blobs.length === 1 ? `${fileName}.${ext}` : `${fileName}_${i + 1}.${ext}`

      // 기기에 저장 — 아이폰 계열만 시트를 거친다. 다운로드가 '파일' 앱으로만 가서 사진첩에 못 넣고,
      // PDF 도 시트의 [파일에 저장]을 눌러야 원하는 곳에 들어가기 때문이다. 어느 항목을 눌러야 하는지는
      // ask() 의 목적지 선택창 문구가 이미 알려줬다.
      // 아이폰이 아니면 공유를 아예 시도하지 않고 바로 다운로드한다 — 갤럭시에서 '기기에 저장'이
      // 공유 시트로 새던 것을 막는다(신고 5c99b5c8). 안드로이드는 a[download] 가 확실히 동작한다.
      const saveViaSheet = photoSaveNeedsShareSheet() && canShareFiles()
      if (!toPhone && !saveViaSheet) {
        await fallbackDownloadAll(blobs, nameAt, mime, 'save')
        return
      }

      if (canShareFiles()) {
        const files = blobs.map((b, i) => new File([b], nameAt(i), { type: mime }))
        let result = await shareFiles(files)
        if (result === 'retry') {
          // 제스처 만료 — 준비가 시트를 여는 허용 시간을 넘겼다. 종전에는 '다시 한 번 눌러 주세요' 토스트였는데
          // 왜 또 눌러야 하는지 설명이 없었고 읽기도 전에 사라졌다(운영자 신고). 확인 창은 사정을 말한 채
          // 기다리고, 그 확인 탭이 곧 신선한 제스처라 준비된 파일로 시트가 바로 열린다.
          if (!(await confirmDialog({
            title: '서류가 준비되었습니다',
            message: '서류를 준비하는 동안 공유 창을 여는 허용 시간이 지났습니다. 아래 버튼을 누르면 준비된 서류로 공유 창이 바로 열립니다.',
            confirmLabel: '공유 창 열기',
          }))) return
          result = await shareFiles(files)
          // 신선한 제스처 + 준비된 파일인데도 거부되면 이 기기는 실질 공유 불가(주로 PC 브라우저의 지원
          // 사칭) — 안내가 무한 반복되지 않게 다운로드로 확정 폴백(운영자 PC 확인 2026-07-22).
          if (result === 'retry' || result === 'unsupported') await fallbackDownloadAll(blobs, nameAt, mime)
          return
        }
        if (result === 'unsupported') await fallbackDownloadAll(blobs, nameAt, mime)
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
  // intent 'save' 는 사용자가 '기기에 저장'을 고른 것 — 공유를 시도하지 않고, 폴백 안내도 띄우지 않는다.
  const fallbackDownloadAll = async (blobs: Blob[], nameAt: (i: number) => string, mime: string, intent: 'share' | 'save' = 'share') => {
    let downloaded = false
    for (let i = 0; i < blobs.length; i++) {
      if (i > 0) await new Promise(r => setTimeout(r, 300))
      const result = await shareOrDownloadFile(blobs[i], nameAt(i), mime, intent)
      if (result === 'downloaded') downloaded = true
      if (result === 'cancelled') return
    }
    if (downloaded && intent === 'share') {
      // 예상 밖의 결말이라 읽을 시간이 필요하다 — 짧은 지속시간으로는 눈에 담기 전에 사라진다.
      pushToast('info', blobs.length > 1
        ? `이 기기에서는 바로 보낼 수 없어 ${blobs.length}장을 파일로 저장했습니다.`
        : '이 기기에서는 바로 보낼 수 없어 파일로 저장했습니다.', { duration: TOAST_DUR_LONG })
    }
  }

  return (
    <button type="button" onClick={handleSend} disabled={busy}
      className={className ?? 'text-[0.6875rem] text-[var(--coral)] hover:text-[var(--coral)] disabled:opacity-50'}>
      {busy ? '준비 중…' : label}
    </button>
  )
}
