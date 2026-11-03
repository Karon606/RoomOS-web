'use client'
// 하단에 떠 있는 선택 알약이 서 있는 동안 그 실측 높이 + 12px 을 루트 --pill-reserve 에 적는 정본 훅(신고 e791b6f7, 가이드 §22).
//
// 알약은 fixed 라 스크롤러 끝을 덮는다. 종전에는 스크롤러가 그 자리를 예약하지 않아 마지막 행이 알약 뒤에 남았다
// (서류 시트 맨 아래 사업자등록증 행). 화면마다 여백을 따로 두면 숫자가 갈린다(계약서 화면 96px 하드코딩이 그 예였다).
// 그래서 알약이 제 높이를 재 한 변수에 적고, 읽는 쪽은 CSS 한 곳(globals.css .app-main · 모달 본문 끝)이 더하기만 한다.
// --kbd-inset(키보드 겹침, ViewportOffsetGuard 단일 소유)과는 다른 변수이고 합산만 한다.
//
// 동시에 둘이 서면(셸 알약 위에 모달 알약) 큰 쪽을 적는다. 마지막 하나가 내려가면 변수를 지운다(읽는 쪽 폴백 0).
import { useEffect, type RefObject } from 'react'

export const PILL_RESERVE_VAR = '--pill-reserve'
// 알약 위 끝과 마지막 행 사이에 남길 간격.
export const PILL_RESERVE_GAP = 12

const live = new Map<object, number>()

/** 서 있는 알약 높이들로 예약값(px)을 낸다. 없으면 null(변수를 지운다). */
export function pillReserve(heights: Iterable<number>): number | null {
  let max = -1
  for (const h of heights) if (h > max) max = h
  return max < 0 ? null : Math.ceil(max) + PILL_RESERVE_GAP
}

function write() {
  const root = document.documentElement
  const v = pillReserve(live.values())
  if (v == null) root.style.removeProperty(PILL_RESERVE_VAR)
  else root.style.setProperty(PILL_RESERVE_VAR, `${v}px`)
}

export function usePillReserve(ref: RefObject<HTMLElement | null>, active = true): void {
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const key = {}
    // offsetHeight 는 transform(등장 모션의 scale·translate)에 흔들리지 않는 배치 높이다.
    const measure = () => { live.set(key, el.offsetHeight); write() }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect(); live.delete(key); write() }
  }, [ref, active])
}
