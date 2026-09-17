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

/** 이 엘리먼트에서 **지금 도는** 애니메이션들. 미지원 환경·없는 엘리먼트는 빈 배열이다. */
export function runningAnimations(el: Element | null | undefined): Animation[] {
  if (!el || typeof el.getAnimations !== 'function') return []
  return el.getAnimations().filter(a => a.playState === 'running')
}

/** 넘긴 애니메이션들이 **어떤 식으로든 끝날 때까지**. 취소도 끝이므로 거부를 삼킨다. */
export function whenAnimationsSettled(anims: Animation[]): Promise<void> {
  return Promise.allSettled(anims.map(a => a.finished)).then(() => { /* 취소도 끝의 한 갈래다 */ })
}
