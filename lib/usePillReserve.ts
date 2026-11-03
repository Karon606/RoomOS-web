'use client'
// 하단에 떠 있는 층(선택 알약·토스트 스택)이 서 있는 동안 그 실측 높이 + 간격을 루트 변수에 적는 정본 훅(신고 e791b6f7, 가이드 §15·§22).
//
// 알약은 fixed 라 스크롤러 끝을 덮는다. 종전에는 스크롤러가 그 자리를 예약하지 않아 마지막 행이 알약 뒤에 남았다
// (서류 시트 맨 아래 사업자등록증 행). 화면마다 여백을 따로 두면 숫자가 갈린다(계약서 화면 96px 하드코딩이 그 예였다).
// 그래서 층이 제 높이를 재 한 변수에 적고, 읽는 쪽은 CSS 한 곳(globals.css)이 더하기만 한다.
//   · --pill-reserve  = 알약 높이 + 12. 스크롤 끝 예약(.app-main · 모달 본문 끝), 토스트·신고 버튼 바닥을 알약 위로.
//   · --toast-reserve = 토스트 스택 높이 + --toast-gap(§15 스택 간격 토큰). 모바일 신고 버튼 기본 자리를 토스트 위로(2026-11-03).
// --kbd-inset(키보드 겹침, ViewportOffsetGuard 단일 소유)과는 다른 변수이고 합산만 한다.
//
// 같은 변수에 둘이 서면(셸 알약 위에 모달 알약) 큰 쪽을 적는다. 마지막 하나가 내려가면 변수를 지운다(읽는 쪽 폴백 0).
import { useEffect, type RefObject } from 'react'

export const PILL_RESERVE_VAR = '--pill-reserve'
// 알약 위 끝과 마지막 행 사이에 남길 간격.
export const PILL_RESERVE_GAP = 12
export const TOAST_RESERVE_VAR = '--toast-reserve'
// 토스트 스택 위 끝과 그 위에 앉는 신고 버튼 사이 간격. 숫자를 따로 두지 않고 §15 스택 간격 토큰을 그대로 따른다.
export const TOAST_RESERVE_GAP = 'var(--toast-gap)'

const live = new Map<string, Map<object, number>>()

/** 서 있는 층 높이들로 예약값을 낸다. 간격이 숫자면 px, CSS 길이(토큰)면 calc 로 잇는다. 없으면 null(변수를 지운다). */
export function heightReserve(heights: Iterable<number>, gap: number | string): string | null {
  let max = -1
  for (const h of heights) if (h > max) max = h
  if (max < 0) return null
  return typeof gap === 'number' ? `${Math.ceil(max) + gap}px` : `calc(${Math.ceil(max)}px + ${gap})`
}

function write(name: string, gap: number | string) {
  const root = document.documentElement
  const v = heightReserve(live.get(name)?.values() ?? [], gap)
  if (v == null) root.style.removeProperty(name)
  else root.style.setProperty(name, v)
}

export function useHeightReserve(ref: RefObject<HTMLElement | null>, name: string, gap: number | string, active = true): void {
  useEffect(() => {
    if (!active) return
    const el = ref.current
    if (!el) return
    const key = {}
    const bag = live.get(name) ?? new Map<object, number>()
    live.set(name, bag)
    // offsetHeight 는 transform(등장 모션의 scale·translate)에 흔들리지 않는 배치 높이다.
    const measure = () => { bag.set(key, el.offsetHeight); write(name, gap) }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => { ro.disconnect(); bag.delete(key); write(name, gap) }
  }, [ref, name, gap, active])
}

export function usePillReserve(ref: RefObject<HTMLElement | null>, active = true): void {
  useHeightReserve(ref, PILL_RESERVE_VAR, PILL_RESERVE_GAP, active)
}
