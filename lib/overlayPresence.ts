// 열린 오버레이(모달·시트·확인창·검색)와 떠 있는 토스트를 세어 루트에 표식을 찍는 정본(2026-11-03, 가이드 §19·§30).
//
// 왜 필요한가. 오류신고 버튼 기본 자리를 키보드가 선 동안 띠 위로 올리면(a안), 모달이 열린 채 키보드가 서는 때
// 그 자리가 모달 발끝 주 버튼(저장·보내기)을 덮는다(독립 검수 실측 29x40px, 390px 이상에서는 그 자리를 누르면 신고가
// 열렸다. 발끝 있는 모달 44곳). 그래서 '셸 화면에서만' 올린다. 그 판정에 쓸 열린 오버레이 신호가 저장소에 없었다
// (Modal 의 escStack 은 Modal 만, aria-modal 은 셋뿐).
//
// 왜 useVisibleBand 에서 세는가. §30 오버레이 규칙이 '키보드를 받는 fixed 오버레이는 Modal 이나 useVisibleBand 를 쓴다' 이고
// check-kbd-canonical 이 그것을 지킨다. 키보드와 겹칠 수 있는 오버레이는 전부 그 훅 한 곳을 지나므로, 거기서 세면
// 새 오버레이도 저절로 세어진다. 떠 있는 층(알약·토스트·신고 버튼)은 오버레이가 아니라 floating 으로 빠진다.
// 키보드를 못 띄우는 오버레이(사진 확대·날짜 고르기·사이드 메뉴)는 세지 않아도 표식의 뜻(키보드 동안 발끝이 있는가)에 무관하다.
//
// 토스트 표식(data-toast-open)은 SaveFeedback 이, 알약 표식(data-pill-open)은 SelectionPillBar 가 떠 있는 동안 연다. 오버레이가
// 열려 있고 둘 중 하나가 떠 있으면 모바일에서 신고 버튼을 숨긴다. 쌓아 올리면 발끝 주 버튼에 닿고, 그대로 두면 토스트가 버튼을
// 가리거나(독립 검수 B2) 버튼이 모달 안 알약의 '선택 취소' X 를 덮는다(R1).
//
// 읽는 쪽은 CSS 한 곳이다(globals.css .report-floor 규칙들).
export const OVERLAY_OPEN_ATTR = 'data-overlay-open'
export const TOAST_OPEN_ATTR = 'data-toast-open'
export const PILL_OPEN_ATTR = 'data-pill-open'

/** 닫힘 뒤의 수. 0 아래로는 내려가지 않는다(정리 순서가 어긋나도 표식이 음수로 남지 않게). */
export function nextCount(n: number, delta: 1 | -1): number {
  return Math.max(0, n + delta)
}

function counter(attr: string) {
  let n = 0
  const stamp = () => {
    const root = document.documentElement
    if (n > 0) root.setAttribute(attr, String(n))
    else root.removeAttribute(attr)
  }
  return {
    /** 하나 열렸다. 돌려준 함수로 닫는다(두 번 불러도 한 번만 센다). */
    open(): () => void {
      n = nextCount(n, 1)
      stamp()
      let done = false
      return () => {
        if (done) return
        done = true
        n = nextCount(n, -1)
        stamp()
      }
    },
    count: () => n,
  }
}

const overlays = counter(OVERLAY_OPEN_ATTR)
const toasts = counter(TOAST_OPEN_ATTR)
const pills = counter(PILL_OPEN_ATTR)

/** 오버레이 하나가 열렸다. 돌려준 함수로 닫는다. */
export const overlayOpened = (): (() => void) => overlays.open()
/** 지금 센 열린 오버레이 수(진리표용). */
export const overlayOpenCount = (): number => overlays.count()
/** 토스트 스택이 떴다(SaveFeedback 한 곳). 돌려준 함수로 내린다. */
export const toastShown = (): (() => void) => toasts.open()
/** 지금 센 토스트 표식 수(진리표용). */
export const toastOpenCount = (): number => toasts.count()
/** 선택 알약이 섰다(SelectionPillBar 한 곳). 돌려준 함수로 내린다. */
export const pillShown = (): (() => void) => pills.open()
/** 지금 센 알약 표식 수(진리표용). */
export const pillOpenCount = (): number => pills.count()
