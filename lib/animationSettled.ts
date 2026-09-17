// 모션이 **지금 돌고 있는가**를 묻는 정본 한 벌 — 벽시계 추정을 쓰지 않는다.
//
// 왜 한 곳인가. 같은 수법을 두 벌로 두면 한쪽만 고쳐진다. 2026-09-17 계측(lib/viewportProbe)이
// 이 문제를 먼저 풀었는데, 같은 날 등장 마감(lib/useSettleEntrance)은 여전히 이벤트만 듣고 있었고
// 그 자리에서 네 번째 재현이 났다. 수법을 여기로 모아 둘이 같은 것을 본다.
//
// 아는 것 둘.
//   · **"끝났다는 신호"가 아니라 "안 돌고 있다는 사실"을 쓴다.** animationend 는 리스너가 붙기
//     전에 끝난 모션에서 영영 안 온다. 굳은 채 멈춘 것(finished·idle·paused)도 '안 도는' 상태다.
//     그 사실은 이벤트를 기다리지 않고 지금 물어볼 수 있다.
//   · **취소도 끝의 한 갈래다.** finished 는 취소되면 거부되므로 allSettled 로 받는다. 이벤트만
//     듣는 쪽은 그 갈래에서 아무 소식도 못 받는다(등장 클래스를 떼는 일이 곧 취소다).
//
// 시간은 한 글자도 안 쓴다. 벽시계로 마감하는 것은 2026-09-08 결정이 금지한 함정이다.

/**
 * 이 엘리먼트에서 **지금 도는** 애니메이션들. 미지원 환경·없는 엘리먼트는 빈 배열이다.
 *
 * `names` 를 주면 그 이름의 CSS 애니메이션만 센다(독립 검수 2026-09-17). 안 거르면 그 층에
 * 붙은 **모든** 도는 애니메이션이 섞인다 — 무한히 도는 것(`animate-pulse` 같은 로딩 표시)이
 * 하나라도 있으면 `finished` 가 영영 안 풀려 등장 클래스가 영영 안 걷힌다. 굳은 모션을 고치러
 * 온 코드가 정반대로 굳히는 자리다.
 *
 * 이름은 `@keyframes` 의 이름이고 `CSSAnimation.animationName` 으로 읽는다. 스크립트가 만든
 * 애니메이션(`Animation`)에는 그 속성이 없으므로 `names` 를 준 물음에서는 자연히 빠진다.
 */
export function runningAnimations(el: Element | null | undefined, names?: readonly string[]): Animation[] {
  if (!el || typeof el.getAnimations !== 'function') return []
  const running = el.getAnimations().filter(a => a.playState === 'running')
  if (!names) return running
  return running.filter(a => {
    const n = (a as Animation & { animationName?: string }).animationName
    return typeof n === 'string' && names.includes(n)
  })
}

/** 넘긴 애니메이션들이 **어떤 식으로든 끝날 때까지**. 취소도 끝이므로 거부를 삼킨다. */
export function whenAnimationsSettled(anims: Animation[]): Promise<void> {
  return Promise.allSettled(anims.map(a => a.finished)).then(() => { /* 취소도 끝의 한 갈래다 */ })
}

/**
 * 이 엘리먼트에 **남아 있는데 안 도는 CSS 전이**들 — 곧 중간값에 굳은 것들.
 *
 * 왜 여기에 붙나(2026-09-17). 이 파일의 두 함수는 `@keyframes` 모션만 다룬다 — `runningAnimations`
 * 가 이름을 `animationName` 으로 읽으므로 CSS 전이는 이름을 준 물음에서 자연히 빠진다. 그런데
 * 같은 병(모션이 중간에 멎으면 옅은 막이 화면을 덮고 조작을 먹는다)이 **전이로 뜨는 층**에도
 * 있었다(`components/ui/inventory/MergeSheet.tsx`). 수법이 같으니 정본도 한 벌이어야 한다 —
 * 두 벌로 두면 한쪽만 고쳐진다(2026-09-17 에 실제로 하루 사이 그 일이 났다).
 *
 * 아는 것 셋.
 *   · **전이는 `getAnimations()` 에 `CSSTransition` 으로 잡힌다.** 이름은 `animationName` 이 아니라
 *     `transitionProperty` 다. 그 속성이 있는 것만 골라 `@keyframes` 모션과 섞이지 않게 한다
 *     (모션 쪽 마감은 등장 클래스를 떼는 `lib/useSettleEntrance` 의 몫이다).
 *   · **정상적으로 끝난 전이는 목록에서 스스로 빠진다.** fill 이 없으므로 끝나면 효과가 사라지고
 *     `getAnimations()` 에 안 남는다. 그래서 여기 남아 있는데 안 도는 것은 굳은 것이다.
 *   · **막 만들어진 전이는 굳은 것이 아니다.** 시작 시각을 아직 못 받은 한두 프레임(play-pending)
 *     동안에도 `playState` 는 이미 `'running'` 이다(Web Animations 명세 — 대기 중인 play 작업이
 *     있으면 running 이다. 대기 여부는 별도 속성 `pending` 이 진다). 그래서 `!== 'running'` 하나로
 *     그 창이 막힌다. 이것까지 굳은 것으로 세면 이제 막 시작한 전이를 걷어 **모든 페이드가 조용히
 *     사라진다** — 굳은 모션을 고치러 온 코드가 정반대로 모션을 없애는 자리다.
 *
 * 부르는 쪽은 받은 것을 `cancel()` 한다. 취소는 효과를 즉시 걷어 계산값이 클래스가 정한 끝값으로
 * 떨어지고, 그 재계산이 굳은 프레임을 푼다 — 등장 클래스를 떼는 것과 같은 수법이다.
 * 시간은 여전히 한 글자도 안 쓴다(2026-09-08 결정).
 */
export function stuckTransitions(el: Element | null | undefined): Animation[] {
  if (!el || typeof el.getAnimations !== 'function') return []
  return el.getAnimations().filter(a => {
    const p = (a as Animation & { transitionProperty?: string }).transitionProperty
    if (typeof p !== 'string') return false                       // @keyframes 모션은 여기 몫이 아니다
    return a.playState !== 'running'
  })
}
