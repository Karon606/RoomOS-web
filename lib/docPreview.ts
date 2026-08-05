// 서류 미리보기 전달 정본 — 기기별로 전달 방식만 가른다(결과물 PDF 는 동일).
//
// 모바일(터치)은 네이티브 공유 시트로 넘긴다. 프린트·파일에 저장·메일이 그 안에 다 들어 있다.
// 데스크톱은 새 탭에 PDF 를 열어 브라우저 뷰어에서 인쇄한다.
//
// **왜 새 탭을 터치 기기에서 피하는가** — 홈화면 앱(manifest display: standalone)에는 주소창도
// 뒤로가기도 없다. 새 탭으로 PDF 를 열면 우리 마크업이 0바이트라 돌아올 길이 사라지고,
// 운영자는 앱을 껐다 켜야 한다(신고 f12c265b·083239c3). 공유 시트는 앱 위에 얹혔다 닫히므로
// 그 문제가 없다. 계약서 화면이 먼저 이 분기를 확립했고 여기로 수렴시킨다.
'use client'

export function canShareFiles(): boolean {
  try {
    const touch = navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    return touch && typeof navigator.canShare === 'function' && typeof navigator.share === 'function'
  } catch { return false }
}

// 공유 시트로 PDF 전달 — 성공·사용자 취소면 true, 미지원·실패면 false(호출부가 새 탭으로 폴백)
// payload 에 files 와 title 을 섞지 않는다 — 메시지 등 일부 타깃이 텍스트만 받고 파일을 떨어뜨려
// '파일 이름만 전송'된다(신고 5c99b5c8). 파일명은 File 객체의 name 으로 이미 전달된다.
export async function sharePdfFile(blob: Blob, fileName: string): Promise<boolean> {
  try {
    const file = new File([blob], fileName, { type: 'application/pdf' })
    if (!navigator.canShare?.({ files: [file] })) return false
    await navigator.share({ files: [file] })
    return true
  } catch (e) {
    // 사용자가 공유를 취소한 것은 실패가 아니다 — 여기서 새 탭으로 폴백하면 오히려 갇힌다
    if ((e as Error)?.name === 'AbortError') return true
    return false
  }
}

// 파일명 안전화 — 서류 이름에 쓰는 문자만 남긴다
export function pdfFileName(docLabel: string, who: string, date: string): string {
  const safe = (s: string) => (s || '').replace(/[^\p{L}\p{N}_-]+/gu, '_')
  return `${safe(docLabel)}_${safe(who)}_${date}.pdf`
}
