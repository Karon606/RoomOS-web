// 끌리는 표면 위의 탭 판정 정본 — 스친 손짓이 click 으로 성립하는 것을 막는다.
//
// 왜 필요한가 (오류신고 16f691e1, 2026-08-24)
//   "입주자 스케줄 바를 잘못 건드려서 넘어가는 경우가 빈번해. 스치듯 터치되었을때는 무시하는게
//   필요한듯". 작업 일정 트랙은 가로로 끌리는데 그 위의 막대가 `onClick` 하나뿐이라 제스처
//   판정이 없었다. 손가락이 지나가기만 해도 계약이 열린다.
//
// 왜 lib 인가
//   같은 판정이 이미 저장소에 두 벌 있다 — `components/entity-modal/widgets/PhotoStrip`(:141)
//   과 `components/room-manage/PhotoViewer`(:134). 둘 다 `Math.hypot(...) > 16` 으로 "끌었으면
//   탭이 아니다"를 가른다. 세 번째 자리가 손사본으로 태어나면 규칙이 자리마다 갈리기 시작한다
//   (lib/roomNo 가 열세 벌을 모은 것과 같은 이유). 판정만 순수 함수로 세워 회귀로 못 박고,
//   React 배선은 각 화면이 자기 형편대로 한다.
//
// **시간을 안 본다.** '얼마나 오래 눌렀나'로 탭을 가르면 천천히 누르는 손이 오탐으로 걸린다
//   (운영자 지시 2026-08-24). 가르는 자는 '얼마나 움직였나'와 '그 사이 표면이 흘렀나' 둘뿐이다.
//
// **히트영역·touch-action 에 손대지 않는다.** 이 판정은 이미 성립한 click 을 삼킬지만 정한다.
//   브라우저의 스크롤 처리와 겹치는 자리가 없어서, 이 트랙이 겨우 봉합한 Android Blink 터치
//   래치(신고 d8554128)의 표면을 다시 열지 않는다.

/**
 * 탭으로 인정하는 최대 이동 거리(px). 빗변으로 잰다.
 *
 * 16 은 **같은 일을 하는** 저장소 전례 둘이 쓰는 값이다(PhotoStrip · PhotoViewer 의 탭 대 끌기).
 * 롱프레스 취소 임계(`lib/useLongPress:23` 10 · `ErrorReportButton:18` 8)를 베끼지 않은 이유는 실패의
 * 방향이 반대라서다 — 그쪽은 과민해도 롱프레스만 취소되고 탭은 살지만, 여기서 과민하면 정직한
 * 탭이 삼켜지고 사용자에게는 "눌렀는데 아무 일도 안 남"으로 보인다. 이번 신고의 반대편 증상이
 * 정확히 그것이라 큰 쪽을 쓴다.
 *
 * 축을 따로 재지 않고 빗변인 것도 전례를 따른 것이다. 축별 16 은 대각선에서 축당 16 을 허용해
 * 실제 이동이 22px 이어도 탭이 되는데, 이 트랙에서 모호한 손짓이 정확히 대각선이다(가로로
 * 끌리는 트랙 위에서 시작한 세로 페이지 스크롤).
 */
export const TAP_SLOP_PX = 16

/** 포인터가 처음 닿은 자리. */
export type TapOrigin = { x: number; y: number }

/**
 * 누른 자리에서 임계를 넘게 움직였는가. `origin` 이 없으면 잴 것이 없으므로 false.
 */
export function movedBeyondSlop(origin: TapOrigin | null, at: TapOrigin, slop: number = TAP_SLOP_PX): boolean {
  if (!origin) return false
  return Math.hypot(at.x - origin.x, at.y - origin.y) > slop
}

/**
 * 이 click 을 삼킬 것인가.
 *
 * 축이 둘이고, 서로의 사각을 덮는다.
 *
 * **① 이동** — 누른 자리에서 뗀 자리까지의 거리. 브라우저가 스크롤을 가져가면 click 이 애초에
 * 안 나므로 이 축이 혼자 일하는 구간은 좁아 보이지만, 그렇지 않은 자리가 실제로 있다.
 * 스크롤이 끝까지 간 트랙(`overscroll-behavior: contain`)에서는 아무리 쓸어도 스크롤이
 * 시작되지 않아 브라우저의 클릭 억제가 안 걸린다. 거기서는 이 축이 유일한 방어선이다.
 *
 * **② 흐름** — 누른 뒤 뗄 때까지 그 표면이 실제로 스크롤됐는가. 엔진 슬롭(약 8px) 미만으로
 * 스쳐 트랙이 한두 픽셀만 흐른 손짓은 이동 축(16px)에 안 걸리는데 이 축에는 걸린다.
 * 관성으로 흐르는 트랙을 손가락으로 짚어 멈추는 동작도 여기서 잡힌다 — 그때 이동은 0 이다.
 *
 * **`detail` 이 0 이면 언제나 통과시킨다.** 키보드 Enter·Space 와 보조기기의 활성화가 만든
 * click 이 그것이다(UI Events 규약 — 포인터가 만든 click 만 클릭 횟수를 싣는다). 그 길에는
 * '끌림'이라는 것이 애초에 없으므로 어느 축도 관여하면 안 된다. 이 한 줄이 없으면 화살표로
 * 트랙을 스크롤한 뒤 Enter 를 친 사용자가 아무것도 못 연다.
 */
export function suppressesTap(session: {
  /** pointerdown 자리. 포인터 세션이 없었으면 null. */
  origin: TapOrigin | null
  /** click 이 난 자리. */
  at: TapOrigin
  /** 그 포인터 세션 동안 표면이 스크롤됐는가. */
  scrolled: boolean
  /** click 의 `detail` — 0 이면 포인터가 만든 click 이 아니다. */
  detail: number
}, slop: number = TAP_SLOP_PX): boolean {
  if (session.detail === 0) return false
  if (!session.origin) return false
  return session.scrolled || movedBeyondSlop(session.origin, session.at, slop)
}
