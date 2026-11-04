'use client'

// v2.0 §22 SelectionPillBar — 선택 모드 하단 floating 다크 알약.
// 탭별 가능한 액션만 children 으로 노출하되 셸(컨테이너·카운트·닫기)은 동일.
// 합치기는 양 탭 공통 승격. 불가능한 액션은 숨김(비활성 아님).
import React, { useEffect, useRef } from 'react'
import { useVisibleBand } from '@/lib/useVisibleBand'
import { usePillReserve } from '@/lib/usePillReserve'
import { pillShown } from '@/lib/overlayPresence'

export function SelectionPillBar({
  count, onClose, children, label = '선택', unit = '개', aboveModal = false, compactNarrow = false,
}: {
  count: number
  onClose: () => void
  children: React.ReactNode      // PillButton 들 또는 서브플로(select 등)
  label?: string                 // 카운트 라벨(기본 '선택')
  unit?: string                  // 조수사(기본 '개'; 사람은 '명' 등)
  aboveModal?: boolean           // 모달 안 선택 모드용 — 알약을 모달 위층(--z-modal-2)으로
  compactNarrow?: boolean        // 버튼이 둘 이상이라 좁은 폭(360px 미만)에서 넘칠 때만, 그 폭에서 카운트를 숫자로 줄인다
}) {
  // 키보드가 선 동안은 하단 내비가 접히므로 내비 위 자리 대신 보이는 띠 아래 끝 위에 앉는다(.kbd-float, 2026-11-03 가이드 §19).
  // 모달 안 알약(aboveModal)은 오버레이가 열린 채라 종전 바닥(키보드 뒤)에 둔다(2026-11-04 임시 규칙, globals.css).
  // 그 자리(--vv-bottom)는 정본 훅이 이 상자에 적는다.
  const barRef = useRef<HTMLDivElement>(null)
  useVisibleBand({ active: true, overlayRef: barRef, floating: true })
  // 서 있는 동안 제 높이 + 12px 을 스크롤 끝에 예약한다(--pill-reserve, 신고 e791b6f7). 더하는 곳은 globals.css 한 곳이다.
  // 바닥(--pill-floor)도 거기 한 벌이다. 모달 본문 끝 예약이 이 바닥과 모달 바닥의 차이를 함께 더한다.
  usePillReserve(barRef)
  // 모달 안 알약(aboveModal)이 서 있는 동안만 루트 알약 표식(data-pill-open)을 연다. 오버레이가 열린 채 그 알약이 서 있으면 모바일 신고 버튼이
  // 숨는다(globals.css, 모달 안 알약 X 보호). 셸 알약은 모달 막 뒤(z 120)라 버튼과 안 겹치므로 열지 않는다. 셸 선택 중 '일괄 편집' 같은
  // 모달을 열면 그 내내 버튼이 숨던 것을 막는다(재검수). prop 이 바뀌면 의존성으로 닫고 다시 연다.
  useEffect(() => (aboveModal ? pillShown() : undefined), [aboveModal])
  // 카운트 숫자는 --on-solid-accent(#F2D9B8 모드 불변)다. --sand 는 다크에서 hover 표면(#332619)으로 뒤집혀 알약 위 1.11:1 로 사라졌다
  // (2026-11-03, 라이트 10.51 · 다크 11.89).
  return (
    <div ref={barRef} data-pill-bar="" className={`kbd-float pointer-events-none fixed inset-x-0 bottom-[var(--pill-floor)] ${aboveModal ? 'z-[var(--z-modal-2)]' : 'z-[var(--z-pill)]'} flex justify-center`}>
      <div className="pointer-events-auto mx-3.5 flex max-w-[calc(100vw-28px)] items-center gap-2 rounded-[15px] bg-[var(--pill-bg)] px-4 py-3 shadow-[0_8px_24px_-8px_rgba(0,0,0,.45)]">
        <span className="whitespace-nowrap text-[0.8125rem] font-semibold text-white">
          <span className="mono tnum text-[var(--on-solid-accent)]">{count}</span><span className={compactNarrow ? 'max-[359px]:hidden' : undefined}>{unit} {label}</span>
        </span>
        <span className="h-4 w-px bg-white/20" />
        {children}
        <button type="button" onClick={onClose} aria-label="선택 취소"
          className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-[9px] bg-white/10 text-white/80 transition-colors hover:bg-white/20 hover:text-white">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}

// 알약 내부 액션 버튼 — ghost(기본) / primary(주액션 solid --coral-dark 계열)
export function PillButton({
  onClick, primary = false, disabled = false, children,
}: {
  onClick?: () => void
  primary?: boolean
  disabled?: boolean
  children: React.ReactNode
}) {
  return (
    <button type="button" onClick={onClick} disabled={disabled}
      className={[
        'h-9 shrink-0 whitespace-nowrap rounded-[9px] px-3 text-sm font-semibold transition-colors disabled:opacity-50',
        primary
          ? 'bg-[var(--coral)] text-[var(--on-solid)] hover:bg-[var(--coral-dark)]'
          : 'bg-white/[0.13] text-white hover:bg-white/20',
      ].join(' ')}>
      {children}
    </button>
  )
}
