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
 * **두 끝에 다 상한을 건다.** 위 주석의 불변식(top + bottom = innerHeight - height)은 두 항이
 * 모두 [0, 그 합] 안에 있을 때만 성립한다. 한쪽만 잠그면 반대 방향 스냅샷에서 그대로 새어 나간다.
 *
 * 종전 1차(2026-08-29) — 아래에만 0 하한이 있고 위에는 짝이 없었다. offsetTop 이
 * innerHeight - height 를 넘는 스냅샷이 오면 bottom 은 0 에 눌리고 top 만 자랐다. 그만큼
 * content box 가 깎이고, 패널 maxHeight 의 100% 안전망이 calc 를 이기면서 패널이 내려가며
 * 작아졌다. 여유가 2rem 뿐이라 32px 만 넘어도 발동한다.
 *
 * 종전 2차(2026-09-16, 신고 bf0a6fff) — 이번에는 **위만 잠겨 있고 아래에 상한이 없었다.**
 * offsetTop 이 음수로 오거나 height 가 실제보다 작게 찢어져 오면 bottom 이 무한정 자라고,
 * 오버레이 content box 가 화면 위쪽 짧은 띠로 쪼그라든다. items-center 가 그 띠 안에서 가운데를
 * 잡으니 패널이 위로 붙고 maxHeight 100% 가 본문을 누른다. 사진의 기하가 정확히 그 모양이었다
 * (패널 상단 90pt · 헤더와 푸터 사이 36pt · 가로는 max-w-xs 그대로).
 *
 * 찢어진 height 자체는 여기서 못 막는다 — 합을 정하는 값이 그것이라 상한도 같이 커진다.
 * 그 문은 usableVvHeight 가 지키고, 호출부(lib/useVisibleBand)가 인셋에도 그 문을 지나게 한다.
 */
export function overlayInsets(vv: VvSnapshot): { top: number; bottom: number } {
  const span = Math.max(0, Math.round(vv.innerHeight - vv.height))
  return {
    top: Math.min(span, Math.max(0, Math.round(vv.offsetTop))),
    bottom: Math.min(span, Math.max(0, Math.round(vv.innerHeight - (vv.offsetTop + vv.height)))),
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

/**
 * **이 프레임에 쓸 띠 높이** — 위생 검사와 쓰기 방향 관문을 한 번에 지난 한 값.
 *
 * 왜 합쳤나(신고 bf0a6fff, 2026-09-16). 종전에는 이 두 관문이 훅 안에서 패널 높이에만 걸려
 * 있었고, 오버레이 인셋은 `vv.height` 를 날것으로 썼다. **보호가 한쪽에만 걸린 값 쌍은 언젠가
 * 갈린다.** 찢어진 스냅샷 한 장에 아래 인셋이 무한정 커져 content box 가 화면 위쪽 짧은 띠로
 * 쪼그라들었고, `items-center` 가 그 띠 안에서 가운데를 잡아 패널이 위로 붙어 눌렸다.
 *
 * 돌려주는 값 셋의 뜻.
 *   · `null`  — 아직 한 번도 못 읽었다. 호출부는 **아무것도 안 쓰고** CSS 폴백을 그대로 둔다.
 *   · `lastGood` — 이 프레임 값은 안 믿는다(불가능값이거나, 줄이면 안 되는 자리의 축소다).
 *   · 새 값 — 믿는다. 호출부가 `lastGood` 을 이것으로 갱신한다.
 *
 * 거부를 0 이 아니라 `lastGood` 으로 답하는 것이 요점이다. 인셋도 같은 값으로 계산해야 팬
 * 프레임마다 합(top + bottom)이 흔들리지 않는다.
 */
export function bandHeight(height: number, lastGood: number, allowShrink: boolean): number | null {
  const h = usableVvHeight(height, lastGood)
  if (h == null) return null
  if (!shouldWriteVvHeight(h, lastGood, allowShrink)) return lastGood
  return h
}
