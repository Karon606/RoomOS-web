'use client'
// 트리거 옆에 뜨는 팝업의 자리 산출 정본 — 날짜 선택기와 국적 선택이 함께 쓴다.
//
// 왜 한 벌인가. 팝업을 트리거의 형제로 두고 `absolute w-full` 로 그리면 두 가지가 깨진다.
//
// 첫째, **폭이 트리거에 묶인다.** 좁은 칸에서는 팝업 안의 검색칸·입력칸이 같이 눌린다.
// 입주자 폼의 직업 드롭다운이 그랬다 — 칸이 98px 이라 그 안 입력칸 실효 폭이 20px 였다
// (2026-08-31 운영자 실기).
//
// 둘째, **모달 안에서 잘린다.** 모달 본문은 세로 스크롤 컨테이너라, 폼 아래쪽 칸에서 연 팝업이
// 바닥에서 잘리거나 스크롤을 억지로 늘린다.
//
// 그래서 화면 기준(fixed)으로 띄우고 자리만 여기서 센다. 날짜 선택기가 먼저 이 방식으로 풀었고
// 그 산수를 그대로 옮겼다 — 사본을 만들면 언젠가 갈린다.

import { useState, useRef } from 'react'

export type PopoverPos = { top: number; left: number; width: number }

/**
 * 트리거 아래(또는 공간이 없으면 위)에 뜰 자리를 센다.
 *
 * 폭은 `max(트리거 폭, minWidth)` 다. 좁은 칸에서도 팝업 안이 눌리지 않게 하한을 둔다.
 * 좌우는 화면에서 8px 안쪽으로 물린다. 아래 공간이 `estimatedHeight` 보다 좁으면 위로 뒤집는다.
 */
export function usePopoverAnchor<T extends HTMLElement = HTMLButtonElement>(opts?: {
  minWidth?: number
  estimatedHeight?: number
}) {
  const minWidth = opts?.minWidth ?? 280
  const estimatedHeight = opts?.estimatedHeight ?? 340
  const [pos, setPos] = useState<PopoverPos>({ top: 0, left: 0, width: 0 })
  const triggerRef = useRef<T>(null)

  /** 팝업을 열기 직전에 부른다 — 여는 쪽이 상태를 쥐므로 여기서는 자리만 센다. */
  const measure = () => {
    const el = triggerRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const width = Math.max(r.width, minWidth)
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8))
    const spaceBelow = window.innerHeight - r.bottom - 8
    const top = spaceBelow >= estimatedHeight
      ? r.bottom + 4
      : Math.max(8, r.top - estimatedHeight - 4)
    setPos({ top, left, width })
  }

  return { pos, triggerRef, measure }
}
