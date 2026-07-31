// 오버레이가 떠 있는 동안 배경 스크롤을 막는 잠금 — 중첩 카운팅, 셸 페이지에서는 무동작.
//
// 왜 필요한가: 셸(app-main) 페이지는 html·body 가 이미 overflow:hidden 이라 배경이 원래 안 움직인다.
// 그래서 Modal 은 배경 잠금을 의도적으로 생략해 왔다(Modal.tsx 주석). 그런데 2026-07-31 에
// DocumentScroll(html.doc-scroll)로 셸 밖 페이지에 문서 스크롤을 켜면서 그 전제가 깨졌고,
// 그 페이지들에서 모달을 열면 백드롭 위 드래그로 뒤 페이지가 스크롤됐다(F페이즈에서 발견).
//
// 왜 이 방식인가: body position:fixed 잠금은 iOS 에서 상·하단 바가 밀리는 회귀를 냈다(신고 d4cf82d5).
// 그래서 위치를 건드리지 않고 html 의 overflow 만 잠근다. height 는 auto 로 두므로 스크롤 위치가 보존된다.
// doc-scroll 이 없는 셸 페이지에서는 클래스를 붙여도 이미 hidden 이라 시각·동작 변화가 0이다.

let depth = 0

export function lockBackgroundScroll(): void {
  if (typeof document === 'undefined') return
  depth += 1
  if (depth === 1) document.documentElement.classList.add('doc-scroll-locked')
}

export function unlockBackgroundScroll(): void {
  if (typeof document === 'undefined') return
  depth = Math.max(0, depth - 1)
  if (depth === 0) document.documentElement.classList.remove('doc-scroll-locked')
}
