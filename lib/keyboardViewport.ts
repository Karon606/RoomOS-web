// 가상 키보드 판정·기하의 순수 정본 — DOM 은 ViewportOffsetGuard 가 쓴다(키보드 패널 2026-09-02).
//
// 왜 함수로 뺐나. 이 판정들이 어긋나면 "화면이 튄다"류가 되는데 브라우저 없이는 재현이 안 돼
// 신고가 올 때까지 모른다. 8월의 키보드 회귀들(716e7b0c·d0833496 등)을 어느 것도 헤드리스로
// 못 잡은 이유가 판정이 컴포넌트 안에만 있어서다. 가짜 스냅샷으로 회귀를 가둔다
// (scripts/test-keyboard-viewport.ts).
//
// 판정과 겹침 크기는 서로 다른 숫자다(신고 716e7b0c). 판정은 팬 불변(offsetTop 무관),
// 크기는 팬 차감. 하나로 합치면 iOS 가 팬한 만큼 값이 줄어 '닫혔다'로 오판한다.

export const KBD_OPEN_PX = 60      // 이만큼 가려지면 키보드가 올라온 것으로 본다
// 겹침 크기의 물리적 상한(화면 높이 대비). 소프트 키보드는 액세서리 바를 포함해도 화면의
// 절반을 크게 넘지 못한다. 이보다 큰 값은 잘못 찍힌 스냅샷이다.
export const KBD_MAX_RATIO = 0.7
export const REVEAL_GAP = 16       // 재노출 시 칸 위·아래로 남길 여백
// 포커스한 칸을 놓을 목표선. 보이는 띠 위에서 35 퍼센트 지점이다.
// 50 퍼센트가 아닌 이유 — 입력칸 위 라벨·참고줄이 항상 띠 안에 남고, 다음 칸이 키보드 위로
// 미리 보여야 한다(숫자 키패드에는 '다음' 버튼이 없어 다음 칸을 손가락으로 탭한다).
// 중앙에 놓으면 매 칸 이동이 커져 오히려 '튀는' 체감이 커진다(키보드 패널 폼 해부, 운영자 승인).
export const TARGET_RATIO = 0.35
/**
 * 이 배율을 넘으면 사용자가 핀치 줌 중이다 — 키보드 대응 전체를 중립으로 둔다.
 * 줌은 vv.height 를 줄여 키보드 열림으로 오판되고(1.075배면 이미 문턱을 넘는다), 열림이면
 * 유령 패딩이, 닫힘 판정이면 복원이 줌 팬을 계속 되감아 화면 이동이 불능이 된다
 * (운영자 iPad 실사용 경로, 키보드 패널 적대 검토 최우선 지적).
 */
export const ZOOM_NEUTRAL_SCALE = 1.02
/** 이 이하의 겹침은 '닫힘'으로 본다 — 복원 발동 판정용. */
export const RESTORE_EPS = 2

export type KbdSnapshot = {
  innerHeight: number   // layout viewport 높이
  vvHeight: number      // 보이는 띠 높이
  offsetTop: number     // 띠의 위가 layout 어디에 있나(iOS 팬)
  scale: number         // visualViewport.scale — 핀치 줌 배율
}

export function zoomNeutral(s: KbdSnapshot): boolean {
  return s.scale > ZOOM_NEUTRAL_SCALE
}

/** 키보드가 올라와 있는가 — 팬 불변 판정. 줌 중이면 무조건 아니다. */
export function keyboardOpen(s: KbdSnapshot): boolean {
  if (zoomNeutral(s)) return false
  return s.innerHeight - s.vvHeight > KBD_OPEN_PX
}

/**
 * 셸 본문에 줄 겹침 인셋 — 팬한 만큼 실제로 덜 가리므로 offsetTop 을 뺀다.
 *
 * 상한은 **기각이 아니라 클램프다**(패널 안 2 채택). 종전에는 상한을 넘는 값을 버리고 직전
 * 값을 유지했는데, 가로 모드·Stage Manager 소형 창처럼 키보드가 정당하게 70%를 넘는 화면에서는
 * 인셋 0 으로 방치됐다. 클램프면 오염 스냅샷의 폭주도 막고 정당한 큰 겹침도 상한만큼은 받는다.
 */
export function overlapInset(s: KbdSnapshot): number {
  const raw = Math.max(0, Math.round(s.innerHeight - (s.vvHeight + s.offsetTop)))
  return Math.min(raw, Math.round(s.innerHeight * KBD_MAX_RATIO))
}

/**
 * 잔존 오프셋을 복원해도 되는가 — **진짜 닫힘(엡실론 이내)일 때만.**
 *
 * 종전에는 '열림 아님'이면 무조건 되감았다. 그러면 외장 키보드 단축바(약 55px, 문턱 미만)가
 * 뜬 채 OS 가 팬으로 칸을 드러낼 때마다 복원이 그 팬을 되감아 스크롤 전쟁이 났다(iPad).
 * 줌 중에도 중립 — 줌 팬을 되감으면 화면 이동이 불능이 된다.
 */
export function shouldRestore(s: KbdSnapshot, scrolled: boolean): boolean {
  if (zoomNeutral(s)) return false
  if (s.innerHeight - s.vvHeight > RESTORE_EPS) return false
  return scrolled
}

/**
 * 포커스한 칸을 얼마나 스크롤할까 — 양수는 위로 올림, 음수는 아래로 내림, 0 은 무동작.
 *
 * 올림은 두 요구의 큰 쪽(목표선까지 / 칸 아래 여백 확보)이되 상단 보호 클램프를 넘지 않는다 —
 * 목표선을 좇다 과대 스크롤하면 칸 위 라벨이 띠 위로 사라진다. 음수(내림)는 **포커스당 1회**
 * (aligned 래치)만 연다. 재시도는 resize 마다 도는데 양방향으로 열어두면 액세서리 바·모달 축소가
 * 순서를 바꿔 올 때 올렸다 내렸다를 반복해 수렴하지 않는다(신고 d0833496 정리 그대로).
 */
export function revealDelta(a: {
  bandTop: number; bandBottom: number
  fieldTop: number; fieldBottom: number
  aligned: boolean
}): number {
  const targetY = a.bandTop + TARGET_RATIO * (a.bandBottom - a.bandTop)
  const rise = Math.min(
    Math.max(a.fieldTop - targetY, a.fieldBottom + REVEAL_GAP - a.bandBottom),
    a.fieldTop - (a.bandTop + REVEAL_GAP),
  )
  if (rise > 0) return rise
  if (!a.aligned && a.fieldTop < a.bandTop + REVEAL_GAP) return a.fieldTop - (a.bandTop + REVEAL_GAP)
  return 0
}
