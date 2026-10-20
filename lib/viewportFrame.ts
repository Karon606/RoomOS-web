// 키보드 기하의 기준틀(화면 고정 상자 높이 H·위 끝 T0)과 visualViewport 를 같은 순간에 재는 정본. 키보드 기하의 DOM 읽기는 여기 한 곳이다.
//
// 왜 innerHeight 를 버렸나(신고 be5316e8, 2026-10-20 운영자 승인 '후보 1'). 키보드가 선 iOS Safari 에서
// vv.height 는 늘 416 인데 innerHeight 가 세 상태를 오간다(iPhone 신고 22건 계측).
//   (a) innerHeight 812, offsetTop 0
//   (b) innerHeight = 812 − offsetTop  (칸을 드러내려 팬한 10건 전부. top 190 이면 622)
//   (c) innerHeight = vv.height
// 화면 고정 상자(fixed inset-0)는 그 사이에도 높이 812 를 지키고, (b) 에서는 위 끝이 client 기준
// −offsetTop 에 선다. 종전 정본은 innerHeight 를 그 상자의 높이로 전제했다. 그래서 (b) 에서 셸 여백이
// 16(실제 206)이 되고 모달 패널이 95 내려앉아 아래 53 이 키보드 밑에 깔렸고, (c) 에서는 키보드가
// 닫혔다고 오판해 인셋 0·표식 제거·되감기(scrollTo 0,0)가 돌았다. 근거는 (b) 패널 위 끝 계산 119 가
// 계측과 맞는다는 것이다(innerHeight 기준이면 214).
//
// 그래서 상자를 직접 잰다. 안드로이드·데스크톱·구형 iOS 는 H = innerHeight, T0 = 0 이라 종전 식과 같다
// (scripts/test-keyboard-viewport.ts 동치 전수).
//
// **값의 쓰임은 lib/keyboardViewport(판정·겹침·띠)와 lib/modalViewport(오버레이 인셋)가 정한다.**
// 이 파일은 재기만 한다. 그 경로의 다른 파일은 window.innerHeight 를 읽지 않는다
// (scripts/check-kbd-canonical.mjs 6).
//
// 비용. getBoundingClientRect 는 레이아웃이 더러우면 강제 레이아웃을 부른다. 가드와 useVisibleBand 가
// 같은 vv 이벤트를 듣고 둘 다 여기를 부르므로, 같은 프레임·같은 vv 값이면 한 번 잰 값을 돌려준다.
// 기억은 다음 애니메이션 프레임에 지운다(낡은 값이 프레임을 넘지 않는다).

import { visibleBand, type KbdSnapshot } from './keyboardViewport'

/** 기준틀 상자. 처음 잴 때 한 번 만들어 body 끝에 두고 계속 쓴다(매번 붙였다 떼면 그때마다 레이아웃이 돈다). */
let frameBox: HTMLElement | null = null
let memo: { key: string; snap: KbdSnapshot } | null = null
let memoExpiryArmed = false

/**
 * 보이지 않고(visibility hidden), 누름을 안 받고(pointer-events none), 접근성 트리에 안 서는(aria-hidden)
 * 화면 고정 상자. fixed 라 흐름 밖이어서 다른 요소의 자리를 안 바꾼다.
 */
function frameSentinel(): HTMLElement | null {
  if (frameBox && frameBox.isConnected) return frameBox
  const body = document.body
  if (!body) return null
  const el = document.createElement('div')
  el.setAttribute('aria-hidden', 'true')
  el.setAttribute('data-viewport-frame', '')
  el.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none'
  body.appendChild(el)
  frameBox = el
  return el
}

/**
 * 기준틀 상자의 지금 자리. 오류신고 계측(lib/viewportProbe sentinelRect)도 이 함수로 잰다(2026-10-20 검수,
 * 상자를 만드는 곳이 두 벌이면 한쪽만 다른 조건으로 잰다). 실패는 null 로 삼킨다. 신고 버튼을 누른 순간에도
 * 불리므로 여기서 던지면 신고창이 안 열린다.
 */
export function frameBoxRect(): DOMRect | null {
  try {
    const el = frameSentinel()
    return el ? el.getBoundingClientRect() : null
  } catch { return null }
}

/**
 * 이 순간의 키보드 스냅샷. 기준틀(H·T0)과 vv 세 값(높이·offsetTop·배율)을 한 번에 담는다.
 *
 * 상자를 못 재거나 값이 이상하면(높이 0, 폭이 문서 폭과 다름 = transform 조상 아래 틀어짐) 종전 틀
 * (H = innerHeight, T0 = 0)로 답한다. 잘못 잰 값으로 판정하는 것보다 종전 동작이 낫다.
 */
export function readKbdSnapshot(vv: VisualViewport): KbdSnapshot {
  const inner = window.innerHeight
  const key = `${vv.height}|${vv.offsetTop}|${vv.scale}|${vv.width}|${inner}`
  if (memo && memo.key === key) return memo.snap
  let frameH = inner
  let frameTop = 0
  try {
    const r = frameBoxRect()
    if (r) {
      const docW = document.documentElement.clientWidth
      if (Number.isFinite(r.height) && Number.isFinite(r.top) && r.height > 0 && Math.abs(r.width - docW) < 2) {
        frameH = r.height
        frameTop = r.top
      }
    }
  } catch { /* 종전 틀 그대로 */ }
  const snap: KbdSnapshot = Object.freeze({
    frameH, frameTop, vvHeight: vv.height, offsetTop: vv.offsetTop, scale: vv.scale,
  })
  memo = { key, snap }
  if (!memoExpiryArmed) {
    memoExpiryArmed = true
    requestAnimationFrame(() => { memo = null; memoExpiryArmed = false })
  }
  return snap
}

/**
 * 지금 보이는 띠의 아래 끝(client 좌표). 화면 고정 팝업이 아래 공간을 셀 때 쓴다(lib/keyboardViewport visibleBand).
 * 키보드가 없으면 innerHeight 와 같고(H = innerHeight, T0 = 0, offsetTop 0, vv.height = 화면), 키보드가 서면
 * 키보드 선이다. visualViewport 가 없는 브라우저는 종전대로 innerHeight 다.
 */
export function visibleBottomNow(): number {
  const vv = window.visualViewport
  if (!vv) return window.innerHeight
  return visibleBand(readKbdSnapshot(vv)).bottom
}
