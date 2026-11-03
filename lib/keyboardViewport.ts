// 가상 키보드 판정·기하의 순수 정본 — DOM 은 ViewportOffsetGuard 가 쓴다(키보드 패널 2026-09-02).
//
// 왜 함수로 뺐나. 이 판정들이 어긋나면 "화면이 튄다"류가 되는데 브라우저 없이는 재현이 안 돼
// 신고가 올 때까지 모른다. 8월의 키보드 회귀들(716e7b0c·d0833496 등)을 어느 것도 헤드리스로
// 못 잡은 이유가 판정이 컴포넌트 안에만 있어서다. 가짜 스냅샷으로 회귀를 가둔다
// (scripts/test-keyboard-viewport.ts).
//
// 판정과 겹침 크기는 서로 다른 숫자다(신고 716e7b0c). 판정은 팬 불변(offsetTop 무관),
// 크기는 팬 차감. 하나로 합치면 iOS 가 팬한 만큼 값이 줄어 '닫혔다'로 오판한다.
//
// **기준틀은 innerHeight 가 아니라 화면 고정 상자다(2026-10-20, 신고 be5316e8).** 키보드가 선
// iOS 는 팬하면 innerHeight 를 812 − offsetTop 으로, 때로는 vv.height 로 줄여 보고하는데, 화면 고정
// 상자(fixed inset-0)는 높이 H 를 지키고 위 끝 T0 만 움직인다. 종전 식은 innerHeight 를 그 상자의
// 높이로 전제해 판정이 뒤집히고 겹침이 모자랐다. 이제 모든 식은 lib/viewportFrame readKbdSnapshot 이
// 잰 H·T0 를 쓴다. 안드로이드·데스크톱은 H = innerHeight, T0 = 0 이라 종전 식과 같다(동치 전수 테스트).
//   열림   H − vv.height > 60
//   겹침   H − offsetTop − vv.height      (셸 여백 · 오버레이 아래 인셋, 고정 상자 좌표)
//   띠     client 기준 T0 + offsetTop 부터 vv.height 만큼

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
  frameH: number        // 화면 고정 상자(fixed inset-0)의 높이 H, 키보드 기하의 기준틀
  frameTop: number      // 같은 상자의 client top T0 (iOS 가 팬하며 innerHeight 를 줄이면 −offsetTop)
  vvHeight: number      // 보이는 띠 높이
  offsetTop: number     // 띠의 위가 상자 위 끝에서 얼마 아래인가(iOS 팬)
  scale: number         // visualViewport.scale — 핀치 줌 배율
}

export function zoomNeutral(s: KbdSnapshot): boolean {
  return s.scale > ZOOM_NEUTRAL_SCALE
}

/** 키보드가 올라와 있는가 — 팬 불변 판정. 줌 중이면 무조건 아니다. */
export function keyboardOpen(s: KbdSnapshot): boolean {
  if (zoomNeutral(s)) return false
  return s.frameH - s.vvHeight > KBD_OPEN_PX
}

/**
 * 셸 본문에 줄 겹침 인셋 — 팬한 만큼 실제로 덜 가리므로 offsetTop 을 뺀다.
 *
 * 상한은 **기각이 아니라 클램프다**(패널 안 2 채택). 종전에는 상한을 넘는 값을 버리고 직전
 * 값을 유지했는데, 가로 모드·Stage Manager 소형 창처럼 키보드가 정당하게 70%를 넘는 화면에서는
 * 인셋 0 으로 방치됐다. 클램프면 오염 스냅샷의 폭주도 막고 정당한 큰 겹침도 상한만큼은 받는다.
 */
export function overlapInset(s: KbdSnapshot): number {
  const raw = Math.max(0, Math.round(s.frameH - (s.vvHeight + s.offsetTop)))
  return Math.min(raw, Math.round(s.frameH * KBD_MAX_RATIO))
}

/**
 * 보이는 띠의 client 좌표. 재노출이 칸의 getBoundingClientRect 와 견주는 틀이다.
 *
 * 종전에는 위 끝을 offsetTop 으로 봤다. 상자가 client 0 에 서 있을 때(T0 = 0)만 맞는 식이다.
 * iOS 가 팬하며 innerHeight 를 줄이면 상자가 −offsetTop 에 서고 띠는 client 0 에서 시작하는데,
 * 종전 식은 띠를 offsetTop 만큼 아래로 봐서 칸을 키보드 밑으로 보냈다(신고 be5316e8).
 */
export function visibleBand(s: KbdSnapshot): { top: number; bottom: number } {
  const top = s.frameTop + s.offsetTop
  return { top, bottom: top + s.vvHeight }
}

/**
 * 이 window resize 를 팬으로 볼까. 키보드가 이미 서 있고(가드 표식), 키보드 칸에 포커스가 있고,
 * 기준틀로도 여전히 열림일 때만 참이다(2026-10-20, 신고 be5316e8 '스크롤해서 올리면 화면이 톡톡튀고').
 *
 * 키보드가 선 iOS 는 팬할 때마다 innerHeight 를 고쳐 보고하며 window resize 를 낸다. 종전에는 그것을
 * 복귀 재동기로 받아 가드가 --kbd-inset 을 다시 쓰고(팬 차감 크기라 매번 달라진다) 재노출을 다시 돌렸고,
 * 열림이 거짓으로 뒤집히면 표식을 떼고 scrollTo(0, 0) 로 팬을 되감았다. 훅도 두 번 재동기했다.
 * '크기는 vv resize 에서만 쓴다'(716e7b0c)는 팬 프레임에서 셸 여백을 다시 쓰지 말라는 규칙인데, 그
 * resize 가 vv 가 아니라 window 쪽으로 들어와 규칙을 비켜 간 것이다. 참이면 받는 쪽은 판정만 갱신하고
 * 인셋 재기록·재노출·복원을 하지 않는다. 키보드가 진짜 내려가는 resize 는 열림이 거짓이 되어 종전
 * 경로로 간다(그때는 vv resize 도 온다).
 */
export function windowResizeIsPan(stamped: boolean, editing: boolean, s: KbdSnapshot): boolean {
  return stamped && editing && keyboardOpen(s)
}

/**
 * 팬으로 받은 window resize 의 늦은 재확인. 두 프레임 뒤의 스냅샷이 닫힘이면 참이고, 받는 쪽은 그때만
 * 종전 재동기를 돈다(검수 2026-10-20). 키보드가 내려가는 순간의 window resize 는 아직 옛 vv 로 읽혀 팬으로
 * 판정될 수 있는데, 그 뒤 vv resize 가 빠지면 표식과 셸 여백 396 이 남는다. 여전히 열림이면 아무것도 안 한다
 * (팬마다 다시 쓰지 않는다는 튐 수정은 그대로다).
 */
export function resyncAfterPan(s: KbdSnapshot): boolean {
  return !keyboardOpen(s)
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
  if (s.frameH - s.vvHeight > RESTORE_EPS) return false
  return scrolled
}

/**
 * 올림의 상단 보호 클램프. 이만큼 넘게 올리면 지켜야 할 위 끝이 띠 위 여백 위로 나간다.
 *
 * **반복 행 폼은 칸이 아니라 행 머리를 지킨다(2026-11-03, 키보드 칸 이동 튐 패널 결정 3, 가이드 §30).** 재고 위치별 점검처럼
 * '채우기 전'·'채운 후' 같은 라벨이 행마다 되풀이되는 폼은 칸 위 라벨만 남아서는 어느 품목의 칸인지 모른다. 그래서 행 머리
 * (품목 이름 줄)에 data-reveal-anchor 를 달고, 그 위 끝이 띠 위 여백 아래에 남도록 클램프한다. 띠가 좁아 행 머리와 칸을
 * 함께 담을 수 없으면 칸이 이긴다(종전 클램프). 목표선 35%·즉시 이동은 그대로다.
 */
function topClamp(a: { bandTop: number; bandBottom: number; fieldTop: number; fieldBottom: number; anchorTop?: number }): number {
  const fieldClamp = a.fieldTop - (a.bandTop + REVEAL_GAP)
  if (a.anchorTop == null || !Number.isFinite(a.anchorTop) || a.anchorTop > a.fieldTop) return fieldClamp
  const fits = a.fieldBottom - a.anchorTop + 2 * REVEAL_GAP <= a.bandBottom - a.bandTop
  return fits ? a.anchorTop - (a.bandTop + REVEAL_GAP) : fieldClamp
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
  /** 반복 행 폼의 행 머리 위 끝(data-reveal-anchor). 없으면 종전과 같다. */
  anchorTop?: number
}): number {
  const targetY = a.bandTop + TARGET_RATIO * (a.bandBottom - a.bandTop)
  const rise = Math.min(
    Math.max(a.fieldTop - targetY, a.fieldBottom + REVEAL_GAP - a.bandBottom),
    topClamp(a),
  )
  if (rise > 0) return rise
  if (!a.aligned && a.fieldTop < a.bandTop + REVEAL_GAP) return a.fieldTop - (a.bandTop + REVEAL_GAP)
  return 0
}

// ── 칸에서 칸으로 옮길 때의 정착 관문(2026-11-03, 키보드 칸 이동 튐 패널 1단계 A안 · 운영자 승인) ─────────
//
// 신고. 아이폰 홈화면 앱, 재고 '위치별' 인라인 점검에서 키친타월 '채운 후' 다음 물티슈 '채우기 전' 을 누르면 칸이
// 276pt 튀어 띠 위 +16 에 붙었다(35% 목표선보다 약 130pt 더). 처음 한 번만이고, 손으로 한 번 스크롤한 뒤엔 없었다.
//
// 원인. 키보드가 선 채 칸을 옮기면 focusin 이 바로 재노출을 예약하고 다음 프레임에 스크롤러 scrollTop 에 델타를 더한
// 뒤 음수 래치를 잠근다. 같은 순간 iOS 자체 포커스 팬(문서·visual viewport 이동)이 진행 중이라 재노출이 팬 도중의
// 기하를 읽고 확정했다. 둘이 겹쳐 이중 이동이 됐다. 착지 '띠 위 +16' 은 revealDelta 의 상단 보호 클램프나 첫 회 음수
// 정렬에서만 나오는 값이라 찢어진 기하의 지문이다(목표선까지 59 올린 뒤 iOS 가 130 을 더 밀면 205 − 189 = 16).
//
// 처방. 키보드가 이미 선 채 들어온 focusin 에만, 칸 위 끝과 띠 위·아래가 두 프레임 연속 1px 미만으로 멈췄을 때
// 한 번 재노출한다. 다만 첫 표본부터 SETTLE_MIN_MS(130ms) 안에는 멈춰 있어도 진행하지 않는다(독립 검수 2026-11-03 차단 1).
// iOS 포커스 팬이 focusin 뒤 몇 프레임 늦게 시작하면, 시작 전 정지 두 프레임만으로 진행해 종전과 같은 이중 이동이 났다.
// 상한은 SETTLE_MAX_MS(350ms)다. 둘 다 프레임 수가 아니라 rAF 타임스탬프로 잰다. 저전력 30Hz 에서 20프레임 상한은
// 0.67초로 늘어나서다(벽시계 setTimeout 은 안 쓴다). 기다리는 동안 스크롤러
// scrollTop 이 가드 밖에서 바뀌면 손 스크롤로 보고 취소한다. 기준은 첫 rAF 표본의 scrollTop 이고(focus 직후 브라우저가
// 스크롤러를 직접 민 몫은 손 스크롤이 아니다), 셸 여백이 줄어 scrollTop 이 최대값으로 잘린 것도 손 스크롤이 아니다. 멈춘 자리가 이미 목표선 근처(허용 구간)면 움직이지
// 않는다. 이 관문은 이동을 늦출 뿐 방향·크기는 그대로 revealDelta 가 정한다(35% 목표선·즉시 이동·음수 1회 래치).
// vv resize 의 재시도 경로(키보드가 서는 순간)는 종전 그대로다.

/** 이 차이 미만이면 '안 움직였다'로 본다(px). */
export const SETTLE_EPS = 1
/** 연속으로 멈춰 있어야 하는 프레임 수. 두 번 견줘 두 번 다 멈췄으면 정착이다. */
export const SETTLE_STILL_FRAMES = 2
/**
 * 첫 표본부터 이만큼은 멈춰 있어도 진행하지 않는다(ms, rAF 타임스탬프). iOS 포커스 팬이 늦게 시작해도 그 전 정지로
 * 진행하지 않게 하는 최소 대기다. 60Hz 8프레임, 30Hz 4프레임쯤이다. '칸이 한 번 움직인 걸 본 뒤에만' 으로 여는 길은
 * 버렸다. iOS 가 팬하지 않는 이동(칸이 이미 보임)은 매번 상한까지 기다리게 되고, 1px 미만으로만 움직인 팬도 그렇다.
 */
export const SETTLE_MIN_MS = 130
/**
 * 최소 대기는 프레임 수로도 지킨다(첫 표본 뒤 이만큼의 프레임). 늦은 팬의 지연이 시간이 아니라 프레임 단위로 오면 저전력
 * 30Hz 에서 130ms 는 4프레임뿐이라 '4프레임 늦은 팬' 을 놓친다. 둘 중 늦은 쪽까지 기다린다(30Hz 에서 약 267ms, 상한 350ms 안).
 */
export const SETTLE_MIN_FRAMES = 8
/** 이만큼 기다려도 안 멈추면 그 기하로 진행한다(ms, rAF 타임스탬프. 60Hz 약 20프레임, 운영자 승인 '두 박자' 상한). */
export const SETTLE_MAX_MS = 350
/** 목표선 아래로 이만큼까지는 이미 읽기 편한 자리로 보고 움직이지 않는다(허용 구간). */
export const SETTLE_REST_PX = REVEAL_GAP

/** 한 프레임에 잰 정착 재료. 띠는 재노출과 같은 띠(스크롤러 rect 와 겹친 보이는 띠)다. */
export type SettleSample = {
  fieldTop: number; fieldBottom: number; bandTop: number; bandBottom: number
  scrollTop: number
  /** 스크롤러가 갈 수 있는 최대 scrollTop(scrollHeight − clientHeight). 여백이 줄어 잘린 것을 손 스크롤과 가른다. */
  maxScrollTop: number
}

/**
 * 정착 관문 한 걸음. 매 프레임 지금 표본(cur)과 직전 표본(prev)을 견줘 다음 할 일을 정한다.
 *   abort  기다리는 동안 스크롤러가 가드 밖에서 움직였다(손 스크롤). 재노출하지 않는다.
 *   wait   아직 움직인다. 한 프레임 더 본다.
 *   stay   멈췄고 칸이 이미 허용 구간이다. 움직이지 않는다.
 *   go     멈췄거나(두 프레임 연속 1px 미만) 상한에 닿았다. 지금 기하로 한 번 재노출한다.
 * elapsedMs 는 첫 표본부터 지난 시간(rAF 타임스탬프 차, 첫 표본은 0), frame 은 몇 번째 표본인가(1부터), still 은 지금까지 연속으로 멈춘 견줌 수다.
 * base 는 손 스크롤을 가를 기준 scrollTop 이다(첫 표본에서 받는다, prev 가 없으면 cur 로 연다). 돌려준 still·base 를 다음 걸음에 넘긴다.
 * 관문은 기다리는 동안 아무것도 안 쓰므로 scrollTop 이 base 와 달라졌다면 가드 밖이다. 다만 줄어든 값이 지금 최대 scrollTop 에
 * 붙어 있으면 셸 여백(--kbd-inset)이 줄어 잘린 것이라 손 스크롤이 아니고, 기준을 그 값으로 옮긴다.
 */
export function revealGate(a: {
  prev: SettleSample | null
  cur: SettleSample
  still: number
  elapsedMs: number
  frame: number
  base: number
}): { verdict: 'abort' | 'wait' | 'stay' | 'go'; still: number; base: number } {
  const { prev, cur } = a
  // 첫 표본이 기준을 연다(focus 직후 브라우저가 민 몫을 손 스크롤로 안 본다).
  let base = prev ? a.base : cur.scrollTop
  if (Math.abs(cur.scrollTop - base) >= SETTLE_EPS) {
    const clamped = cur.scrollTop < base && cur.scrollTop >= cur.maxScrollTop - SETTLE_EPS
    if (!clamped) return { verdict: 'abort', still: 0, base }
    base = cur.scrollTop
  }
  const moved = !prev
    || Math.abs(cur.fieldTop - prev.fieldTop) >= SETTLE_EPS
    || Math.abs(cur.bandTop - prev.bandTop) >= SETTLE_EPS
    || Math.abs(cur.bandBottom - prev.bandBottom) >= SETTLE_EPS
  const still = moved ? 0 : a.still + 1
  const settled = still >= SETTLE_STILL_FRAMES && a.elapsedMs >= SETTLE_MIN_MS && a.frame > SETTLE_MIN_FRAMES
  if (!settled && a.elapsedMs < SETTLE_MAX_MS) return { verdict: 'wait', still, base }
  return { verdict: settled && restsNearTarget(cur) ? 'stay' : 'go', still, base }
}

/**
 * 칸이 이미 읽기 편한 자리인가. 위는 띠 위 여백(REVEAL_GAP) 아래, 위 끝이 목표선에서 SETTLE_REST_PX 안쪽 아래까지,
 * 아래 끝은 띠 아래 여백 위. 목표선 위로 올라가 있는 칸은 revealDelta 가 원래 안 움직이므로(공짜 모션 없음) 여기서도 참이다.
 */
export function restsNearTarget(s: Pick<SettleSample, 'fieldTop' | 'fieldBottom' | 'bandTop' | 'bandBottom'>): boolean {
  const targetY = s.bandTop + TARGET_RATIO * (s.bandBottom - s.bandTop)
  return s.fieldTop >= s.bandTop + REVEAL_GAP
    && s.fieldTop <= targetY + SETTLE_REST_PX
    && s.fieldBottom + REVEAL_GAP <= s.bandBottom
}
