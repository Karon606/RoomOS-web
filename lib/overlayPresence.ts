// 열린 오버레이(모달·시트·확인창·검색) 수를 세어 루트에 표식(data-overlay-open)을 찍는 정본(2026-11-03, 가이드 §19·§30).
//
// 왜 필요한가. 오류신고 버튼 기본 자리를 키보드가 선 동안 띠 위로 올리면(a안), 모달이 열린 채 키보드가 서는 때
// 그 자리가 모달 발끝 주 버튼(저장·보내기)을 덮는다(독립 검수 실측 29x40px, 390px 이상에서는 그 자리를 누르면 신고가
// 열렸다. 발끝 있는 모달 44곳). 그래서 '셸 화면에서만' 올린다. 그 판정에 쓸 열린 오버레이 신호가 저장소에 없었다
// (Modal 의 escStack 은 Modal 만, aria-modal 은 셋뿐).
//
// 왜 useVisibleBand 에 다는가. §30 오버레이 규칙이 '키보드를 받는 fixed 오버레이는 Modal 이나 useVisibleBand 를 쓴다' 이고
// check-kbd-canonical 이 그것을 지킨다. 키보드와 겹칠 수 있는 오버레이는 전부 그 훅 한 곳을 지나므로, 거기서 세면
// 새 오버레이도 저절로 세어진다. 떠 있는 층(알약·토스트·신고 버튼)은 오버레이가 아니라 floating 으로 빠진다.
// 키보드를 못 띄우는 오버레이(사진 확대·날짜 고르기·사이드 메뉴)는 세지 않아도 표식의 뜻(키보드 동안 발끝이 있는가)에 무관하다.
//
// 읽는 쪽은 CSS 한 곳이다(globals.css .report-floor 의 키보드 규칙).
export const OVERLAY_OPEN_ATTR = 'data-overlay-open'

let open = 0

function stamp() {
  const root = document.documentElement
  if (open > 0) root.setAttribute(OVERLAY_OPEN_ATTR, String(open))
  else root.removeAttribute(OVERLAY_OPEN_ATTR)
}

/** 오버레이 하나가 열렸다. 돌려준 함수로 닫는다(두 번 불러도 한 번만 센다). */
export function overlayOpened(): () => void {
  open++
  stamp()
  let done = false
  return () => {
    if (done) return
    done = true
    open = Math.max(0, open - 1)
    stamp()
  }
}

/** 지금 센 수(진리표용). */
export function overlayOpenCount(): number {
  return open
}
