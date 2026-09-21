'use client'
// 보이는 띠 동기화 훅 — fixed 오버레이가 키보드·팬에 맞춰 앉는 정본(키보드 패널 2026-09-02, 2단계).
//
// Modal 이 검증해 온 기하(lib/modalViewport 순수 함수 + 이벤트 배선)를 훅으로 뽑아, 수제
// 오버레이들(확인창·시트류·검색·재고 점검)이 같은 한 벌을 쓰게 한다. 종전에는 그들이
// --kbd-inset 하단 한 항만 밀어서, 시트 높이(85vh)가 키보드에 안 줄어 헤더가 화면 위로
// 최대 205px 잘렸다(신고 2026-08-30 "위쪽으로 숨겨지는").
//
// 쓰는 값 셋 — 오버레이에 위·아래 인셋(--vv-top/--vv-bottom), 패널에 띠 높이(--vv-h).
// 규칙은 Modal 주석에 쌓인 그대로다. 팬 불변(top+bottom 합 일정), 줄이기는 resize 에서만,
// 불가능값은 직전 유효값 유지, 복귀 재동기(pageshow·회전·visibilitychange + rAF 한 박자).
//
// **관문은 두 겹이고 쓰는 곳이 다르다(2026-09-17 회귀 수정).** 위생 검사(불가능값을 버리고
// 직전 유효값을 쓴다)는 높이와 인셋 **둘 다** 지난다 — 그 문이 찢어진 스냅샷을 막는다(bf0a6fff).
// 방향 관문(줄이는 것은 resize 에서만)은 **패널 높이만** 지난다. 09-16 에 둘을 한 값으로 묶었다가
// 반대쪽이 터졌다 — 키보드가 서서 띠가 진짜 줄어든 팬 프레임에서 인셋이 '키보드 없음'이라 답해
// 패널이 키보드 밑까지 뻗었다(신고 2026-09-17). 한 스냅샷을 한 번만 읽는 규칙은 그대로다.

import { useEffect, type RefObject } from 'react'
import { overlayInsets, bandHeight, usableVvHeight, resumeAllowsShrink } from '@/lib/modalViewport'
import { editableFocused } from '@/lib/editableTarget'

export function useVisibleBand(opts: {
  active: boolean
  /** 인셋 두 항을 받을 엘리먼트(보통 fixed 오버레이 자신). */
  overlayRef: RefObject<HTMLElement | null>
  /** 띠 높이를 받을 엘리먼트(패널). 없으면 높이 항은 안 쓴다. */
  panelRef?: RefObject<HTMLElement | null>
  /** CSS 변수 이름 — Modal 은 제 기존 이름을 물려 픽셀 무변화로 갈아탄다. */
  vars?: { top?: string; bottom?: string; height?: string }
}): void {
  const { active, overlayRef, panelRef } = opts
  const varTop = opts.vars?.top ?? '--vv-top'
  const varBottom = opts.vars?.bottom ?? '--vv-bottom'
  const varHeight = opts.vars?.height ?? '--vv-h'
  useEffect(() => {
    if (!active) return
    const vv = window.visualViewport
    if (!vv) return
    let lastTop = '', lastBottom = '', lastHeight = ''
    // 마지막으로 믿을 만했던 띠 높이. 0 이면 아직 한 번도 못 읽었다(그때는 dvh 폴백).
    let lastGoodH = 0

    // **패널 높이에 쓸 띠 높이 — 관문 둘을 지난 값.** 인셋은 이 값이 아니라 위생 검사만 지난
    // 값을 쓴다(아래 pass 참조). 방향 관문을 인셋에 걸면 키보드가 선 프레임에서 되레 가린다.
    //
    // 종전에는 이 관문이 높이에만 걸려 있었다(신고 bf0a6fff, 2026-09-16). 인셋 쪽 sync 는
    // vv.height 를 날것으로 넣어, 찢어진 스냅샷 한 장이 오면 아래 인셋이 무한정 커지고 오버레이
    // content box 가 화면 위쪽 짧은 띠로 쪼그라들었다. items-center 가 그 띠 안에서 가운데를
    // 잡으니 패널이 위로 붙고 maxHeight 100% 가 본문을 눌렀다. 09-08 봉합이 세운 관문을 인셋은
    // 통과조차 안 하고 있었다 — 그래서 문을 하나로 합친다.
    //
    // 규칙 둘은 종전 그대로고(실측 2026-08-29), 판정은 정본 bandHeight 한 자리에서 한다.
    //   · 불가능값(120 미만)은 버리고 직전 유효값을 쓴다 — usableVvHeight.
    //   · **줄이는 것은 resize 에서만, 늘리는 것은 언제든** — shouldWriteVvHeight.
    const gatedHeight = (height: number, allowShrink: boolean): number | null => {
      const h = bandHeight(height, lastGoodH, allowShrink)
      if (h != null) lastGoodH = h
      return h
    }

    const syncSize = (h: number | null) => {
      if (!panelRef || h == null) return                 // 아직 못 읽었다 — dvh 폴백 그대로
      const next = `${h}px`
      if (next === lastHeight) return
      const pa = panelRef.current
      if (!pa) return
      pa.style.setProperty(varHeight, next)
      lastHeight = next
    }

    // **인자로만 받는다 — 여기서는 vv 를 안 본다**(독립 검수 2026-09-17). 종전에는 이 함수가
    // vv 를 클로저로 봤고, 그래서 `height: h` 를 `height: Math.round(vv.height)` 로 한 군데만
    // 되돌리면 그물이 전부 초록인 채 결함이 글자 그대로 복원됐다(문자열만 보던 판정이
    // Math.round( 한 겹에 뚫렸다). 날것이 **사거리에 없게** 구조를 바꾼 것이 1차 방어고,
    // check-kbd-canonical 이 이 함수 본문에 vv.height 가 있는지를 보는 것이 2차다.
    const sync = (h: number | null, offsetTop: number, innerHeight: number) => {
      const ov = overlayRef.current
      if (!ov) return
      // 아직 못 읽었다 — CSS 폴백 그대로 둔다(높이와 같은 규칙). 폴백은 받는 쪽이 정하고
      // 0 이 아닌 자리도 있다: Modal 은 위가 0px, 아래가 var(--kbd-inset, 0px) 다
      // (components/ui/Modal.tsx:187).
      if (h == null) return
      // 위·아래 여백 둘 다에 상한 — 어긋난 스냅샷 한 장에 패널이 내려가며 작아지거나(8-29),
      // 위로 붙어 눌리던(bf0a6fff) 그 자리다. 클램프는 정본 overlayInsets 가 한다.
      const ins = overlayInsets({ innerHeight, height: h, offsetTop })
      const top = `${ins.top}px`
      const bottom = `${ins.bottom}px`
      if (top !== lastTop) { ov.style.setProperty(varTop, top); lastTop = top }
      if (bottom !== lastBottom) { ov.style.setProperty(varBottom, bottom); lastBottom = bottom }
    }
    // **한 스냅샷, 관문 둘.** 세 항을 같은 순간에 한 번씩만 읽어(찢어짐 방지) 패널 높이는
    // bandHeight(위생 + 방향)를, 인셋은 usableVvHeight(위생만)를 지난다. 읽는 자리가 여기
    // 하나뿐이라 둘이 **다른 프레임**의 값을 섞을 길은 없다 — 같은 프레임에서 뜻이 갈릴 뿐이고,
    // 그 갈림이 의도다. 아래 sync 호출부에 이유를 적어 뒀다.
    const pass = (allowShrink: boolean) => {
      const height = vv.height
      const offsetTop = vv.offsetTop
      const innerHeight = window.innerHeight
      const h = gatedHeight(height, allowShrink)
      syncSize(h)
      // **인셋은 위생 검사만 지나고 방향 관문은 안 지난다**(신고 2026-09-17, 09-16 회귀 수정).
      // 09-16 에 높이와 인셋을 한 값으로 묶었더니 반대쪽이 터졌다. 방향 관문(줄이는 것은 resize
      // 에서만)은 **패널 높이에만 맞는 규칙**이다. 인셋에 걸면, 키보드가 서서 띠가 진짜 줄어든
      // 팬 프레임에서 관문이 작아진 값을 거부하고 인셋까지 '키보드 없음'이라 답한다 — 패널이
      // 키보드 밑까지 뻗어 입력 칸이 덮인다(전수 훑기 실측: 띠 416 에서 패널 384 -> 780).
      // 위생 검사(불가능값 버리기)는 인셋에도 필요하다 — 그 문이 bf0a6fff 를 막는다.
      sync(usableVvHeight(height, lastGoodH), offsetTop, innerHeight)
    }
    // vv 의 resize — 키보드가 서서 띠가 진짜 주는 길이다. 여기서는 줄이는 값을 받는다(8-29 규칙).
    const both = () => pass(true)
    // 팬은 위치만 옮긴다. 크기는 커지는 쪽만 받아 복귀 직후 작게 찍힌 값이 여기서 씻긴다.
    const onPan = () => pass(false)
    // 복귀 재동기(오류신고 734ea211·e97f4b2b) — 앱 전환·bfcache·회전은 vv 이벤트가 안 온다.
    // 크기·위치를 둘 다 다시 적고, rAF 한 박자를 더 돈다(직후 프레임의 vv 는 옛 값을 낼 수 있다).
    //
    // **그런데 첫 패스는 줄이는 값을 안 받는다**(신고 2026-09-08). 그 자리에서 읽은 vv 가 아직 옛
    // 값이면 낡은 스냅샷이 그대로 박혀 짧은 창·어긋난 인셋이 남는다. 두 번째 패스에서만, 그것도
    // 편집 요소에 포커스가 있을 때만 받는다 — 판정은 정본 resumeAllowsShrink 가 한다.
    // 커지는 값(복원)은 두 패스 모두 종전 그대로 들어오고, 진짜 축소는 위 both 로 들어온다.
    //
    // **인셋도 이 관문을 지난다**(신고 bf0a6fff). 종전에는 syncSize 에만 게이트를 걸어 두고
    // sync() 는 두 패스 모두 조건 없이 불렀다 — 관문을 세워 놓고 옆문을 열어 둔 셈이었다.
    const resyncPass = (p: 1 | 2) => pass(resumeAllowsShrink(p, editableFocused()))
    const resync = () => { resyncPass(1); requestAnimationFrame(() => resyncPass(2)) }
    const onVisibility = () => { if (document.visibilityState === 'visible') resync() }
    both()
    vv.addEventListener('resize', both)
    vv.addEventListener('scroll', onPan)
    window.addEventListener('pageshow', resync)
    window.addEventListener('resize', resync)
    window.addEventListener('orientationchange', resync)
    document.addEventListener('visibilitychange', onVisibility)
    const panelEl = panelRef?.current
    const overlayEl = overlayRef.current
    return () => {
      vv.removeEventListener('resize', both)
      vv.removeEventListener('scroll', onPan)
      window.removeEventListener('pageshow', resync)
      window.removeEventListener('resize', resync)
      window.removeEventListener('orientationchange', resync)
      document.removeEventListener('visibilitychange', onVisibility)
      panelEl?.style.removeProperty(varHeight)
      overlayEl?.style.removeProperty(varTop)
      overlayEl?.style.removeProperty(varBottom)
    }
    // vars 문자열은 호출부 상수다 — 렌더마다 새 객체여도 재구독하지 않게 원시값만 의존한다.
  }, [active, overlayRef, panelRef, varTop, varBottom, varHeight])
}
