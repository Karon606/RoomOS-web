// 모달이 보이는 띠에 맞춰 앉는 기하 — 순수 계산만 둔다(DOM 은 components/ui/Modal 이 쓴다).
//
// 왜 함수로 뺐나. 이 계산이 어긋나면 "모달이 스크롤할 때마다 작아진다"가 되는데, 브라우저 없이는
// 재현이 안 돼 신고가 올 때까지 모른다(실측 2026-08-29). 순수 함수로 두면 가짜 스냅샷을 넣어
// 회귀로 가둘 수 있다.
//
// 불변식 하나가 이 파일 전체를 지탱한다.
//   top + bottom = innerHeight - vv.height   (팬이 얼마든 합은 일정하다)
// 그래서 오버레이 content box 는 **팬 불변**이고, 패널은 밀어도 안 줄어야 한다.

import { KBD_OPEN_PX, ZOOM_NEUTRAL_SCALE } from './keyboardViewport'

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
 * 그 문은 usableVvHeight 가 지키고, 호출부(lib/useVisibleBand)가 인셋에도 **그 문만** 지나게 한다
 * (방향 관문은 패널 높이 전용이다 — bandHeight 주석 참조).
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
 * 한 프레임의 읽기 — 띠 높이와, 그 높이를 믿을지 가르는 사실 셋을 **같은 순간에** 담는다.
 * 훅·가드가 한 번 읽어 넘기고, 판정은 아래 순수 함수들이 한다(2026-10-03).
 */
export type VvReading = {
  /** 보이는 띠의 높이(vv.height) */
  height: number
  /** layout viewport 높이 */
  innerHeight: number
  /** vv.scale — 핀치 줌 배율 */
  scale: number
  /** 키보드를 부를 수 있는 곳에 포커스가 있는가(lib/editableTarget keyboardCapableFocus — iframe 포함) */
  editing: boolean
}

/**
 * **키보드 칸이 없는데 키보드만큼 줄었는가** — 그렇다면 그 띠는 실재가 아니라 낡거나 찢어진 값이다.
 *
 * 왜 세웠나(2026-10-03, 운영자 iPhone 하루 3회). 홈 알림 상세와 재고 모달 패널이 화면 위쪽에
 * 약 190pt 로 눌렸고, 확인창이 화면 위로 밀려나 막만 남았다. 위생 하한(120)은 120~800 을 전부
 * 통과시켰고, '포커스가 없으면 작은 띠는 낡은 값'이라는 물음(resumeAllowsShrink)은 복귀 2패스에만
 * 걸려 있었다. 마운트 첫 읽기는 lastGood 이 0 이라 무엇이든 받았고, 뒤에 vv 이벤트가 안 오면
 * 그 값이 영구히 남았다. 이 물음을 **모든 읽기**(마운트·vv resize·scroll·복귀)에 건다.
 *
 * 세 조건이 다 참일 때만 참이다.
 *   · 가려진 높이가 키보드 문턱(KBD_OPEN_PX)을 넘는다 — 그 미만은 툴바·단축바 수준이라 무해하다.
 *   · 키보드를 부를 곳에 포커스가 없다. **iframe 포커스는 편집 중으로 친다** — 안쪽 칸에 선
 *     포커스는 바깥 문서에서 iframe 으로만 보인다(PeekSheet). 거부하면 거기서 키보드가 덮는다.
 *   · 핀치 줌이 아니다(scale ≤ ZOOM_NEUTRAL_SCALE). 줌은 띠를 정당하게 줄이므로 기존 규칙에 맡긴다.
 *
 * 키보드가 진짜 열려 있으면 포커스가 반드시 있으므로 이 함수는 거짓이고, 그 경로는 종전과
 * 한 글자도 안 달라진다 — 키보드 가림 회귀가 구조적으로 0 인 이유다(전수 훑기는 테스트에).
 */
export function phantomKeyboardGap(r: VvReading): boolean {
  if (r.scale > ZOOM_NEUTRAL_SCALE) return false
  if (r.editing) return false
  return r.innerHeight - r.height > KBD_OPEN_PX
}

/**
 * **위생 검사 + 타당성 관문** — 불가능값(120 미만)과 '칸 없는 키보드 높이'를 둘 다 거른 띠 높이.
 *
 * 거부는 `lastGood`(없으면 `null` → 호출부가 100dvh 폴백)으로 답한다. 다만 거부된 값이라도
 * `lastGood` 보다 **크면** 받는다 — 키보드가 내려가는 중(포커스는 이미 떠났고 띠는 커지는 중)이나
 * 낡은 값에서 회복하는 중이다. 오염은 늘 작은 쪽이라는 8-29 의 비대칭과 같은 이유다.
 *
 * 방향 관문(줄이기는 resize 에서만)은 여기 없다. 이 함수는 높이와 인셋이 **둘 다** 지나는 문이고,
 * 방향 관문은 높이 전용이다(67f91325 — 인셋에 걸면 키보드가 선 팬 프레임에서 되레 가린다).
 */
export function plausibleVvHeight(r: VvReading, lastGood: number): number | null {
  const h = usableVvHeight(r.height, lastGood)
  // 위생 검사에서 이미 직전 값으로 대체됐거나(120 미만) 아직 아무것도 없다.
  if (h == null || Math.round(r.height) < MIN_VV_HEIGHT) return h
  if (!phantomKeyboardGap(r)) return h
  if (lastGood > 0 && h > lastGood) return h
  return lastGood > 0 ? lastGood : null
}

/**
 * **오버레이 인셋에 쓸 띠 높이** — 타당성 관문까지만 지나고 방향 관문은 안 지난다.
 *
 * 높이와 다른 한 가지. 아직 믿을 값이 없을 때(`null`) **편집 중이 아니면 띠 = 화면 전체**로 답한다
 * (인셋 0). null 을 내면 받는 쪽이 CSS 폴백을 쓰는데, Modal 의 아래 폴백은 `--kbd-inset` 이라 그
 * 값이 낡았으면 그대로 새어 든다. 키보드 칸이 없으면 키보드도 없으니 0 이 뜻에 맞다.
 * 편집 중이면 종전대로 null — 폴백(가드가 잰 키보드 인셋)을 지워 버리면 키보드가 칸을 덮는다.
 */
export function insetBand(r: VvReading, lastGood: number): number | null {
  const h = plausibleVvHeight(r, lastGood)
  if (h != null) return h
  return r.editing ? null : Math.round(r.innerHeight)
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
 * 거부를 0 이 아니라 `lastGood` 으로 답하는 것이 요점이다. 한 프레임 값이 조금 낡는 것이
 * 레이아웃이 통째로 흔들리는 것보다 낫다.
 *
 * **이 함수는 패널 높이 전용이다(2026-09-17).** 인셋은 위생 검사(`usableVvHeight`)만 지나고
 * 여기를 안 지난다. 방향 관문을 인셋에 걸었더니, 키보드가 서서 띠가 진짜 줄어든 팬 프레임에서
 * 관문이 작아진 값을 거부하고 인셋까지 '키보드 없음'이라 답해 패널이 키보드 밑까지 뻗었다
 * (신고 2026-09-17, 전수 훑기 실측: 띠 416 에서 패널 384 -> 780).
 */
export function bandHeight(r: VvReading, lastGood: number, allowShrink: boolean): number | null {
  // 2026-10-03 — 위생 검사 자리에 타당성 관문까지 지난다(plausibleVvHeight). 마운트 첫 읽기도
  // 여기를 지나므로 lastGood 이 0 이어도 칸 없는 키보드 높이는 안 박힌다.
  const h = plausibleVvHeight(r, lastGood)
  if (h == null) return null
  if (!shouldWriteVvHeight(h, lastGood, allowShrink)) return lastGood
  return h
}
