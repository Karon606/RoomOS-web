'use client'

// v2.0 §22 InventoryCard — 재고관리 카드 해부구조 정본.
// 하나의 골격에 데이터만 교체: 좌(정체성) · 우(핵심 수치 1개) · 하단(액션 행) · 옵션(펼치기).
// 소모품·비품 두 탭이 같은 카드를 쓴다(중복 구현 금지). 토큰은 v2.0 §03·§04 정본.
import React from 'react'

export function InventoryCard({
  title, badges, meta,
  value, valueSub, valueDanger = false,
  actions, expand, expanded = false,
  selectable = false, selected = false, onToggleSelect,
  attn = false, onClick, onLongPress, className = '',
}: {
  title: React.ReactNode
  badges?: React.ReactNode
  meta?: React.ReactNode
  value?: React.ReactNode       // 핵심 수치 1개 (우측). 두 개 이상은 펼치기/상세로.
  valueSub?: React.ReactNode    // 보조(최소/금액)
  valueDanger?: boolean         // 위험 시 핵심 수치 --coral
  actions?: React.ReactNode     // 하단 액션 행 (Btn 들)
  expand?: React.ReactNode      // 펼침 영역(합산·구매 N건·이력 요약)
  expanded?: boolean
  selectable?: boolean          // 선택 모드 — 체크박스 노출
  selected?: boolean
  onToggleSelect?: () => void
  attn?: boolean                // 주의 강조(소진 임박·연체 등) — border-left
  onClick?: () => void          // 카드 본문 탭 → 상세 풀화면
  /** 꾹 눌러 선택 모드 진입(+이 카드 선택) — 지출 목록과 동일 제스처(전 목록 통일). '선택' 버튼과 병행. */
  onLongPress?: () => void
  className?: string
}) {
  // 롱프레스(500ms) — 발화 시 뒤따르는 click 무시. 이동(스크롤)하면 취소.
  const lpTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const lpFired = React.useRef(false)
  const lpStart = React.useRef<{ x: number; y: number } | null>(null)
  const lpClear = () => { if (lpTimer.current) { clearTimeout(lpTimer.current); lpTimer.current = null } }
  const lpDown = (e: React.PointerEvent) => {
    if (!onLongPress) return
    lpStart.current = { x: e.clientX, y: e.clientY }
    lpClear()
    lpTimer.current = setTimeout(() => { lpFired.current = true; onLongPress() }, 500)
  }
  const lpMove = (e: React.PointerEvent) => {
    if (!lpStart.current) return
    if (Math.abs(e.clientX - lpStart.current.x) > 10 || Math.abs(e.clientY - lpStart.current.y) > 10) lpClear()
  }
  const clickable = !!onClick && !selectable
  return (
    <div
      onClick={() => {
        if (lpFired.current) { lpFired.current = false; return }
        ;(selectable ? onToggleSelect : onClick)?.()
      }}
      onPointerDown={lpDown}
      onPointerMove={lpMove}
      onPointerUp={lpClear}
      onPointerLeave={lpClear}
      onContextMenu={e => { if (onLongPress) e.preventDefault() }}
      className={[
        'rounded-[13px] border bg-[var(--cream)] px-3.5 py-3 transition-colors select-none',
        selected
          ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]'
          : 'border-[var(--warm-border)]',
        attn ? 'border-l-[3px] border-l-[var(--coral)]' : '',
        (clickable || selectable) ? 'cursor-pointer hover:border-[var(--coral)]/50' : '',
        className,
      ].join(' ')}>
      <div className="flex items-start justify-between gap-2">
        {/* 좌 — 체크박스(선택모드) + 정체성 */}
        <div className="flex min-w-0 flex-1 items-start gap-2.5">
          {selectable && (
            <span className={[
              'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border text-[0.6875rem] transition-colors',
              selected ? 'border-[var(--coral)] bg-[var(--coral)] text-white' : 'border-[var(--warm-border)] text-transparent',
            ].join(' ')} aria-hidden>✓</span>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex flex-wrap items-center gap-1.5 text-[0.90625rem] font-semibold tracking-[-0.015em] text-[var(--warm-dark)]">
              <span className="truncate">{title}</span>
              {badges}
            </p>
            {meta && <p className="mt-0.5 truncate text-[0.71875rem] text-[var(--warm-muted)]">{meta}</p>}
          </div>
        </div>
        {/* 우 — 핵심 수치 1개 */}
        {(value != null || valueSub != null) && (
          <div className="shrink-0 text-right">
            {value != null && (
              <p className={`mono tnum text-[1.1875rem] font-bold leading-none ${valueDanger ? 'text-[var(--coral)]' : 'text-[var(--warm-dark)]'}`}>{value}</p>
            )}
            {valueSub != null && <p className="mt-0.5 text-[0.6875rem] text-[var(--warm-muted)]">{valueSub}</p>}
          </div>
        )}
      </div>

      {/* 펼치기 — 합산·구매 N건·이력 요약 */}
      {expanded && expand && (
        <div className="mt-2 border-t border-[var(--warm-border)] pt-2 text-[0.71875rem] text-[var(--warm-muted)]">{expand}</div>
      )}

      {/* 하단 액션 행 — 상단 1px 구분, 버튼 높이 34px */}
      {actions && (
        <div className="mt-2.5 flex flex-wrap items-center justify-end gap-1.5 border-t border-[var(--warm-border)] pt-2.5"
          onClick={e => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </div>
  )
}
