// 스침 가드 회귀 테스트 — 실행: npx tsx scripts/test-tap-guard.ts
//
// 여기서 고정하는 것: 임계 이내의 탭은 통과한다 · 임계를 넘긴 이동은 click 을 삼킨다 ·
// 세로로만 움직여도 삼킨다(페이지 스크롤) · 표면이 흘렀으면 이동이 0 이어도 삼킨다 ·
// **키보드·보조기기 활성화는 어떤 상태에서도 통과한다**.
//
// 마지막 축이 이 파일의 존재 이유다. 이동 래치는 눈에 보이는 것이 아니라, 그것이 키보드
// 활성화를 삼키기 시작해도 화면에는 아무 표시가 없다. 마우스를 못 쓰는 사용자만 앱을 못 쓰게
// 되는 종류의 회귀라 여기서 못 박는다.
//
// 시간 축은 **일부러 없다**(운영자 지시 2026-08-24). 천천히 누르는 손을 오탐으로 걸지 않으려면
// 가르는 자가 '얼마나 움직였나'와 '표면이 흘렀나' 둘이어야 한다. 이 파일에 duration·ms 인자가
// 등장하면 그것이 곧 회귀다.

import { TAP_SLOP_PX, movedBeyondSlop, suppressesTap, type TapOrigin } from '../lib/tapGuard'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

const O: TapOrigin = { x: 100, y: 200 }

// ── 임계 ─────────────────────────────────────────────────
// 16 은 같은 일을 하는 저장소 전례 둘이 쓰는 값이다(PhotoStrip:141 · PhotoViewer:134).
// 롱프레스 취소 임계(useLongPress 10 · ErrorReportButton 8)를 베끼지 않은 이유는 lib/tapGuard 주석.
eq('임계 · 탭 대 끌기 전례와 같은 16px', TAP_SLOP_PX, 16)

// ── 이동 판정(빗변) ───────────────────────────────────────
eq('이동 · 한 픽셀도 안 움직인 탭', movedBeyondSlop(O, { x: 100, y: 200 }), false)
eq('이동 · 임계 직전(15px)은 탭이다', movedBeyondSlop(O, { x: 115, y: 200 }), false)
eq('이동 · 임계와 같으면(16px) 아직 탭이다', movedBeyondSlop(O, { x: 116, y: 200 }), false)
eq('이동 · 임계를 넘으면(17px) 탭이 아니다', movedBeyondSlop(O, { x: 117, y: 200 }), true)
eq('이동 · 왼쪽으로 넘어가도 같다(부호 무관)', movedBeyondSlop(O, { x: 83, y: 200 }), true)

// 세로만 움직인 경우 — 트랙은 가로로만 끌리지만 **페이지는 세로로 끌린다.**
// 막대를 짚고 화면을 위아래로 넘긴 손도 탭이 아니다.
eq('이동 · 세로로만 17px 이면 탭이 아니다', movedBeyondSlop(O, { x: 100, y: 217 }), true)
eq('이동 · 세로로만 15px 이면 탭이다', movedBeyondSlop(O, { x: 100, y: 215 }), false)
eq('이동 · 위로 올려도 같다', movedBeyondSlop(O, { x: 100, y: 183 }), true)

// **빗변으로 잰다.** 축별 판정이면 축당 16 을 허용해 실제 22.6px 이동이 탭이 된다.
// 이 트랙에서 모호한 손짓이 정확히 대각선이라(가로 트랙 위에서 시작한 세로 페이지 스크롤)
// 이 축이 회귀 대상이다 — 누가 abs 축별로 되돌리면 아래가 깨진다.
eq('이동 · 대각선 12/12(빗변 17.0)는 탭이 아니다', movedBeyondSlop(O, { x: 112, y: 212 }), true)
eq('이동 · 대각선 11/11(빗변 15.6)은 탭이다', movedBeyondSlop(O, { x: 111, y: 211 }), false)

// 세션이 없으면 잴 것이 없다.
eq('이동 · 시작점이 없으면 언제나 false', movedBeyondSlop(null, { x: 9999, y: 9999 }), false)

// 임계는 인자로 갈아 끼울 수 있다.
eq('이동 · 임계 인자 8 에서 9px 은 넘는다', movedBeyondSlop(O, { x: 109, y: 200 }, 8), true)

// ── click 억제 판정 ───────────────────────────────────────
const tap = (at: TapOrigin, scrolled = false, detail = 1, origin: TapOrigin | null = O) =>
  suppressesTap({ origin, at, scrolled, detail })

eq('억제 · 제자리 탭은 열린다', tap({ x: 101, y: 201 }), false)
eq('억제 · 임계를 넘긴 이동은 삼킨다', tap({ x: 140, y: 200 }), true)
eq('억제 · 더블클릭(detail 2)도 같은 규칙', suppressesTap({ origin: O, at: { x: 140, y: 200 }, scrolled: false, detail: 2 }), true)

// **흐름 축** — 이동이 0 이어도 그 사이 트랙이 흘렀으면 삼킨다.
// 엔진 슬롭(약 8px) 미만으로 스쳐 트랙이 한두 픽셀만 흐른 손짓과, 관성으로 흐르는 트랙을
// 손가락으로 짚어 멈추는 동작이 여기서 잡힌다. 이동 축(16px)만으로는 둘 다 못 잡는다.
eq('억제 · 이동 0 이어도 표면이 흘렀으면 삼킨다', tap({ x: 100, y: 200 }, true), true)
eq('억제 · 표면이 안 흘렀으면 제자리 탭은 열린다', tap({ x: 100, y: 200 }, false), false)
eq('억제 · 두 축은 OR 다(둘 다 참)', tap({ x: 200, y: 200 }, true), true)

// **키보드·보조기기는 어떤 상태에서도 통과한다.** detail 0 이 그 표식이다.
// 화살표로 트랙을 스크롤한 뒤(흐름 참) Enter 를 치는 것이 실제 동선이라 이 축이 특히 중요하다.
eq('억제 · 키보드는 이동이 커도 통과', tap({ x: 900, y: 900 }, false, 0), false)
eq('억제 · 키보드는 표면이 흘렀어도 통과', tap({ x: 100, y: 200 }, true, 0), false)
eq('억제 · 키보드는 둘 다 참이어도 통과', tap({ x: 900, y: 900 }, true, 0), false)

// 포인터 세션 없이 온 click — 가드가 붙기 전에 시작된 손짓, 또는 스크롤러 밖에서 온 click.
eq('억제 · 시작점이 없으면 통과', tap({ x: 900, y: 900 }, false, 1, null), false)
eq('억제 · 시작점이 없으면 흐름과 무관하게 통과', tap({ x: 900, y: 900 }, true, 1, null), false)

// ── 화면이 하는 그대로의 흐름 ─────────────────────────────
{
  /** pointerdown → (스크롤?) → click 한 판. */
  const play = (down: TapOrigin | null, up: TapOrigin, tickBefore: number, tickAfter: number, detail = 1) =>
    suppressesTap({ origin: down, at: up, scrolled: down != null && tickBefore !== tickAfter, detail })

  eq('흐름 · 가만히 탭하면 열린다', play(O, { x: 102, y: 201 }, 7, 7), false)
  eq('흐름 · 가로로 끌면 안 열린다', play(O, { x: 260, y: 203 }, 7, 31), true)
  // 스크롤이 끝까지 간 트랙 — overscroll-behavior: contain 이라 스크롤이 시작조차 안 된다.
  // 눈금이 안 오르므로 **이동 축이 유일한 방어선**인 구간이다.
  eq('흐름 · 스크롤 끝에서 쓸어도 이동 축이 잡는다', play(O, { x: 260, y: 203 }, 31, 31), true)
  // 엔진 슬롭 미만으로 스쳤는데 트랙은 흐른 손짓 — 이동 축은 못 잡고 흐름 축이 잡는다.
  eq('흐름 · 6px 스침이라도 트랙이 흘렀으면 안 열린다', play(O, { x: 106, y: 200 }, 7, 8), true)
  // 관성으로 흐르는 트랙을 짚어 멈추기 — 이동 0.
  eq('흐름 · 관성 멈추기 탭은 안 열린다', play(O, { x: 100, y: 200 }, 7, 9), true)
  // 화살표 키로 트랙을 스크롤한 뒤 Enter.
  eq('흐름 · 화살표로 스크롤한 뒤 Enter 는 열린다', play(O, { x: 0, y: 0 }, 7, 40, 0), false)
  eq('흐름 · 포인터 세션 없는 활성화는 열린다', play(null, { x: 0, y: 0 }, 7, 7, 0), false)
}

console.log(`\n스침 가드 회귀: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
