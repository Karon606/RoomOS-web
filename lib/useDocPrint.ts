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
// 새 인쇄 경로를 만들지 않는다 — 두 벌이 되면 한쪽만 고쳐지고 나머지가 조용히 죽는다.

import { useCallback, useRef } from 'react'
import { fetchDocBytes } from '@/lib/docBytes'
import { sniffDocMime, extForDocMime } from '@/lib/docMime'
import { sharePdfFile } from '@/lib/docPreview'
import { photoSaveNeedsShareSheet } from '@/lib/shareFile'
import { pushToast } from '@/lib/saveStatus'

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
 * 공유 시트 경유 인쇄.
 *
 * 바이트를 ref 에 캐시하는 이유 — 공유 시트는 탭 직후(transient activation)에만 열린다.
 * 다운로드가 길어져 거부되면 안내만 하고, 재탭 때 캐시로 즉시 시트를 연다(SendDocButton 과 같은 처방).
 */
export function useShareSheetPrint(driveFileId: string, fileName: string) {
  const bytes = useRef<Promise<ArrayBuffer> | null>(null)

  return useCallback(async () => {
    pushToast('info', '공유 창이 열리면 [프린트]를 눌러 주세요.')
    try {
      bytes.current ??= fetchDocBytes(driveFileId)()
      const buf = await bytes.current
      // 0바이트를 그대로 넘기면 상대가 못 여는 빈 PDF 가 조용히 나간다(신고 5c99b5c8 클래스)
      if (buf.byteLength === 0) throw new Error('서류 준비에 실패했습니다. 화면을 새로고침한 뒤 다시 시도해 주세요.')
      // 형식은 바이트가 정한다 — 스캔 이미지를 .pdf 로 싸면 시트의 프린트가 깨진 파일을 받는다.
      const mime = sniffDocMime(buf)
      const ok = await sharePdfFile(new Blob([buf], { type: mime }), `${fileName}.${extForDocMime(mime)}`)
      if (!ok) pushToast('info', '준비가 끝났습니다. 다시 한 번 눌러 주세요.')
    } catch (e) {
      bytes.current = null
      pushToast('error', (e as Error).message || '서류를 불러오지 못했습니다.')
    }
  }, [driveFileId, fileName])
}
