// 앱 밖 주소 전달 정본(클라이언트 전용) — 터치 기기는 공유 시트로 넘긴다. 파일은 lib/docPreview 가 정본이다.
//
// **왜 새 탭이 안 되는가** — 홈화면 앱(manifest display: standalone, scope 전역)은 같은 오리진
// 주소면 target="_blank" 를 무시하고 앱 창에서 연다. 소개 페이지처럼 우리 앱 마크업이 없는 곳으로
// 가면 주소창도 뒤로가기도 없어 돌아올 길이 사라진다(신고 3353a4ed). 공유 시트는 앱 위에 얹혔다
// 닫히므로 그 문제가 없고, 사용자가 그 안에서 보낼 곳·열 곳을 직접 고를 수 있다.
'use client'

// 이 기기가 공유 시트로 주소를 넘길 수 있는지 — 터치 기기에서만 참이다.
// 데스크톱은 창이 여러 개라 새 탭이 갇히지 않으므로 종전 동작을 그대로 둔다(docPreview 와 같은 분기).
export function canShareUrl(): boolean {
  try {
    const touch = navigator.maxTouchPoints > 0 || /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    return touch && typeof navigator.share === 'function'
  } catch { return false }
}

// 공유 시트로 주소 전달 — 성공·사용자 취소면 true, 미지원·실패면 false(호출부가 새 탭으로 폴백).
// payload 에 url 하나만 싣는다 — title/text 를 섞으면 일부 타깃이 글만 받고 주소를 떨어뜨린다
// (파일 공유에서 같은 함정을 겪었다, 신고 5c99b5c8).
export async function shareUrl(url: string): Promise<boolean> {
  try {
    if (typeof navigator.share !== 'function') return false
    await navigator.share({ url })
    return true
  } catch (e) {
    // 사용자가 공유를 취소한 것은 실패가 아니다 — 여기서 새 탭으로 폴백하면 오히려 갇힌다
    if ((e as Error)?.name === 'AbortError') return true
    return false
  }
}
