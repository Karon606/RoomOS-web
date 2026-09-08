// 모달이 보이는 띠에 맞춰 앉는 기하 — 순수 계산만 둔다(DOM 은 components/ui/Modal 이 쓴다).
//
// 왜 함수로 뺐나. 이 계산이 어긋나면 "모달이 스크롤할 때마다 작아진다"가 되는데, 브라우저 없이는
// 재현이 안 돼 신고가 올 때까지 모른다(실측 2026-08-29). 순수 함수로 두면 가짜 스냅샷을 넣어
// 회귀로 가둘 수 있다.
//
// 불변식 하나가 이 파일 전체를 지탱한다.
//   top + bottom = innerHeight - vv.height   (팬이 얼마든 합은 일정하다)
// 그래서 오버레이 content box 는 **팬 불변**이고, 패널은 밀어도 안 줄어야 한다.

/** 이보다 작은 띠는 실재하지 않는다. 스냅샷이 찢어진 것으로 보고 버린다. */
export const MIN_VV_HEIGHT = 120

export type VvSnapshot = {
  /** layout viewport 높이 */
  innerHeight: number
  /** 보이는 띠의 높이 */
  height: number
  /** 띠의 위가 layout 어디에 있나(iOS 팬) */
  offsetTop: number
}

/**
 * 오버레이 위·아래 인셋 — 셋을 합치면 content box 가 보이는 띠와 같아진다.
 *
 * **위에도 상한을 건다.** 종전에는 아래에만 0 하한이 있고 위에는 짝이 없어서, offsetTop 이
 * innerHeight - height 를 넘는 스냅샷이 오면 bottom 은 0 에 눌리고 top 만 자랐다. 그만큼
 * content box 가 깎이고, 패널 maxHeight 의 100% 안전망이 calc 를 이기면서 패널이 내려가며
 * 작아졌다. 여유가 2rem 뿐이라 32px 만 넘어도 발동한다.
 */
export function overlayInsets(vv: VvSnapshot): { top: number; bottom: number } {
  const maxTop = Math.max(0, Math.round(vv.innerHeight - vv.height))
  return {
    top: Math.min(maxTop, Math.max(0, Math.round(vv.offsetTop))),
    bottom: Math.max(0, Math.round(vv.innerHeight - (vv.offsetTop + vv.height))),
  }
}

/**
 * 패널에 쓸 띠 높이 — 불가능값이면 직전 유효값을 유지한다.
 *
 * 0 으로 떨구지 않는 이유는 ViewportOffsetGuard 가 --kbd-inset 에 적어 둔 것과 같다. 한 프레임
 * 값이 조금 낡는 것이, 레이아웃이 통째로 흔들리는 것보다 낫다. 아직 한 번도 못 읽었으면
 * null 을 내고 호출부가 100dvh 폴백을 그대로 쓴다.
 */
export function usableVvHeight(height: number, lastGood: number): number | null {
  const h = Math.round(height)
  if (h >= MIN_VV_HEIGHT) return h
  return lastGood > 0 ? lastGood : null
}

/**
 * 이 프레임에 크기를 새로 써도 되는가 — **줄이는 것은 resize 에서만, 늘리는 것은 언제든.**
 *
 * 두 증상이 반대 방향이라 한쪽만 막으면 다른 쪽이 터진다.
 *   · 팬 프레임마다 크기를 쓰면 오염 스냅샷 한 장이 박혀 드래그할수록 창이 **작아진다.**
 *   · 그렇다고 resize 전용으로 못 박으면, 앱을 나갔다 돌아와 작게 찍힌 값이 스크롤로도 안 고쳐져
 *     짧은 창이 뜬 채 남는다(실측 2026-08-29).
 *
 * 오염은 늘 너무 작은 값이고 복구는 늘 커지는 쪽이다. 그 비대칭이 답이다.
 * 키보드가 열려 띠가 진짜 줄 때는 resize 가 오므로 그 길은 안 막힌다.
 */
export function shouldWriteVvHeight(next: number, lastGood: number, fromResize: boolean): boolean {
  if (lastGood <= 0) return true
  return fromResize || next >= lastGood
}

/**
 * 복귀 재동기화의 이 패스가 **줄이는 값**을 받아도 되는가 — 첫 패스는 안 받는다.
 *
 * 앱 전환·잠금·bfcache 에서 돌아온 직후 프레임의 visualViewport 는 아직 옛 값을 낸다. 그래서
 * 재동기화는 두 패스를 돈다(그 자리 + requestAnimationFrame). 그런데 종전에는 **첫 패스도
 * 줄이는 값을 받아** 낡은 스냅샷 한 장이 그대로 박혔다. 짧은 창이 남거나, 인셋이 어긋난 채
 * 모달 조각만 뜨던 자리다(신고 2026-09-08).
 *
 * 두 번째 조건은 "편집 요소에 포커스가 있는가"다. 아무 칸에도 서 있지 않으면 키보드도 없으니,
 * 그때 오는 작은 띠는 실재가 아니라 낡은 값이다.
 *
 * **2026-08-29 의 두 규칙은 그대로다.** 커지는 값은 아무 이벤트에서나 받고, 줄이는 값은
 * resize 에서만 받는다 — 이것은 그 위에 얹는 관문일 뿐이고, 진짜 축소(키보드가 서서 띠가 주는
 * 경우)는 visualViewport 의 resize 로 들어와 이 함수를 지나지 않는다.
 */
export function resumeAllowsShrink(pass: 1 | 2, editableFocused: boolean): boolean {
  return pass === 2 && editableFocused
}
