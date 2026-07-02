'use client'

// 꾹 눌러 선택 모드 진입 — 전 목록 공통 제스처(지출 목록 원형, 2026-07-02 통일).
// 500ms 유지 시 발화, 10px 이상 이동(스크롤)하면 취소, 발화 직후의 click은 캡처 단계에서 삼킨다.
// 사용: const press = useLongPress(); <div {...press(() => enterSelect(id))}>…</div>
import { useRef } from 'react'

export function useLongPress(delay = 500) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const fired = useRef(false)
  const start = useRef<{ x: number; y: number } | null>(null)

  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null } }

  // fire 미지정(이미 선택모드 등) 시 핸들러를 아예 붙이지 않는다 — 클릭 삼킴 오동작 방지
  return (fire?: () => void) => fire == null ? {} : ({
    onPointerDown: (e: React.PointerEvent) => {
      start.current = { x: e.clientX, y: e.clientY }
      cancel()
      timer.current = setTimeout(() => { fired.current = true; fire() }, delay)
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (start.current && (Math.abs(e.clientX - start.current.x) > 10 || Math.abs(e.clientY - start.current.y) > 10)) cancel()
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    // 발화 후 따라오는 click(상세 열기 등)을 캡처에서 차단 — 롱프레스와 탭이 겹치지 않게
    onClickCapture: (e: React.MouseEvent) => {
      if (fired.current) { e.stopPropagation(); e.preventDefault(); fired.current = false }
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  })
}
