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

import { useEffect, type RefObject } from 'react'
import { overlayInsets, usableVvHeight, shouldWriteVvHeight } from '@/lib/modalViewport'

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
    let lastTop = '', lastBottom = ''
    // 마지막으로 믿을 만했던 띠 높이. 0 이면 아직 한 번도 못 읽었다(그때는 dvh 폴백).
    let lastGoodH = 0

    // **줄이는 것은 resize 에서만, 늘리는 것은 언제든.** 오염 스냅샷은 늘 너무 작은 값이고
    // 복구는 늘 커지는 쪽이라는 비대칭이 답이다(실측 2026-08-29, lib/modalViewport 주석).
    const syncSize = (allowShrink: boolean) => {
      if (!panelRef) return
      const h = usableVvHeight(vv.height, lastGoodH)
      if (h == null) return                              // 아직 못 읽었다 — dvh 폴백 그대로
      if (!shouldWriteVvHeight(h, lastGoodH, allowShrink)) return
      lastGoodH = h
      panelRef.current?.style.setProperty(varHeight, `${h}px`)
    }

    const sync = () => {
      const ov = overlayRef.current
      if (!ov) return
      // 위 여백에도 상한 — 어긋난 스냅샷 한 장에 패널이 내려가며 작아지던 그 자리(정본이 클램프).
      const ins = overlayInsets({ innerHeight: window.innerHeight, height: vv.height, offsetTop: vv.offsetTop })
      const top = `${ins.top}px`
      const bottom = `${ins.bottom}px`
      if (top !== lastTop) { ov.style.setProperty(varTop, top); lastTop = top }
      if (bottom !== lastBottom) { ov.style.setProperty(varBottom, bottom); lastBottom = bottom }
    }
    // 복귀 재동기(오류신고 734ea211·e97f4b2b) — 앱 전환·bfcache·회전은 vv 이벤트가 안 온다.
    // 크기·위치를 둘 다 다시 적고, rAF 한 박자를 더 돈다(직후 프레임의 vv 는 옛 값을 낼 수 있다).
    const both = () => { syncSize(true); sync() }
    // 팬은 위치만 옮긴다. 크기는 커지는 쪽만 받아 복귀 직후 작게 찍힌 값이 여기서 씻긴다.
    const onPan = () => { syncSize(false); sync() }
    const resync = () => { both(); requestAnimationFrame(both) }
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
