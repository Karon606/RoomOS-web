'use client'

// 서류 인쇄 운반로 정본 — 뷰어와 발급 이력 목록이 같은 분기를 쓴다.
//
// 인쇄 경로는 두 갈래뿐이고 여기서만 갈린다.
//   ① 아이폰 홈화면 앱(standalone) — window.print() 가 아무 일도 하지 않는다(신고 2523aa1e).
//      공유 시트의 [프린트]가 실기로 확인된 유일한 운반로다.
//   ② 그 밖(데스크톱·안드로이드·아이폰 사파리) — window.print() 가 그대로 걸린다.
//      단 종이가 우리 DOM 인 화면에서만 뜻이 있다. 목록에는 인쇄할 종이가 없으므로
//      목록의 [인쇄]는 이 갈래에서 뷰어로 넘긴다(components/ui/PrintDocButton).
//
// DocViewer 가 이 분기를 먼저 세웠고(커밋 29c7ef7) 목록이 그것을 그대로 쓴다.
// 결산 보고서(app/(app)/report)도 같은 분기를 쓴다(신고 2e41ddb1). 그 종이는 보관본이 없어
// ① 갈래의 바이트를 Drive 대신 제 라우트(/api/report/pdf)에서 받는다. 달라지는 것은 바이트 출처뿐이다.
// 새 인쇄 경로를 만들지 않는다 — 두 벌이 되면 한쪽만 고쳐지고 나머지가 조용히 죽는다.
// window.print() 호출은 이 분기 안에서만 산다(scripts/check-print-branch.mjs 가 지킨다).

import { useCallback, useRef } from 'react'
import { fetchDocBytes } from '@/lib/docBytes'
import { sniffDocMime, extForDocMime } from '@/lib/docMime'
import { sharePdfFile } from '@/lib/docPreview'
import { photoSaveNeedsShareSheet } from '@/lib/shareFile'
import { pushToast, humanError } from '@/lib/saveStatus'

// 홈화면 앱(manifest display: standalone)인가. display-mode 미디어 쿼리가 정본이고,
// 구형 iOS 는 navigator.standalone 만 갖고 있어 둘을 함께 본다.
function isStandaloneApp(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches
      || (navigator as { standalone?: boolean }).standalone === true
  } catch { return false }
}

/** window.print() 가 무동작인 환경인가. 참이면 공유 시트가 유일한 인쇄 운반로다. */
export function printNeedsShareSheet(): boolean {
  return photoSaveNeedsShareSheet() && isStandaloneApp()
}

/**
 * 종이 바이트를 어디서 받는가.
 *   · 문자열. 보관된 서류의 Drive 파일 id. /api/doc-file 로 받는다(뷰어·발급 이력 목록).
 *   · { key, load }. 보관본이 없는 종이. load 가 바이트를 만들고 key 가 캐시 열쇠다(결산 보고서는 연도).
 */
export type PrintBytesSource = string | { key: string; load: () => Promise<ArrayBuffer> }

/**
 * 공유 시트 경유 인쇄.
 *
 * 바이트를 ref 에 캐시하는 이유 — 공유 시트는 탭 직후(transient activation)에만 열린다.
 * 다운로드가 길어져 거부되면 안내만 하고, 재탭 때 캐시로 즉시 시트를 연다(SendDocButton 과 같은 처방).
 * 캐시는 출처 열쇠별이다. 한 화면에서 출처가 바뀌어도(보고서의 연도 전환) 다른 종이가 나가지 않고,
 * 이미 받은 종이로 돌아오면 다시 만들지 않는다.
 */
export function useShareSheetPrint(source: PrintBytesSource, fileName: string) {
  const bytes = useRef(new Map<string, Promise<ArrayBuffer>>())

  return useCallback(async () => {
    pushToast('info', '공유 창이 열리면 [프린트]를 눌러 주세요.')
    const key = typeof source === 'string' ? source : source.key
    try {
      let pending = bytes.current.get(key)
      if (!pending) {
        pending = typeof source === 'string' ? fetchDocBytes(source)() : source.load()
        bytes.current.set(key, pending)
      }
      const buf = await pending
      // 0바이트를 그대로 넘기면 상대가 못 여는 빈 PDF 가 조용히 나간다(신고 5c99b5c8 클래스)
      if (buf.byteLength === 0) throw new Error('서류 준비에 실패했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.')
      // 형식은 바이트가 정한다 — 스캔 이미지를 .pdf 로 싸면 시트의 프린트가 깨진 파일을 받는다.
      const mime = sniffDocMime(buf)
      const ok = await sharePdfFile(new Blob([buf], { type: mime }), `${fileName}.${extForDocMime(mime)}`)
      if (!ok) pushToast('info', '준비가 끝났습니다. 다시 한 번 눌러 주세요.')
    } catch (e) {
      bytes.current.delete(key)
      // 통신 실패의 영어("Load failed" 등)는 사람 말로 바꾼다. 한국어로 던진 사유는 그대로 선다.
      pushToast('error', humanError(e, '서류를 불러오지 못했습니다.'))
    }
  }, [source, fileName])
}
