// 인라인 로딩 인디케이터 — 모달·패널 안 데이터 로딩 중 표시.
// 채워진 아치 + 숨쉬기 펄스(opacity만 = 컴포지터 스레드) — stroke 드로잉(메인스레드)은
// 무거운 렌더·패치 중 컨투어 중간 프레임으로 얼어붙어 제품 전체에서 퇴출(2026-06-12).

import { ARCH_PATH } from '@/components/brand/StayeumWordmark'

export function Loading({ py = 8 }: { py?: number }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ paddingTop: `${py * 0.25}rem`, paddingBottom: `${py * 0.25}rem` }}
      aria-busy="true" aria-label="불러오는 중"
    >
      <style>{`
        @keyframes sy-load-breathe { 0%, 100% { opacity: .9; } 50% { opacity: .35; } }
        .sy-load-breathe { animation: sy-load-breathe 1.6s ease-in-out infinite; will-change: opacity; }
        @media (prefers-reduced-motion: reduce) { .sy-load-breathe { animation: none; opacity: .9; } }
      `}</style>
      <svg viewBox="8 8 113 84" width={42} height={31} className="sy-load-breathe" aria-hidden="true">
        <path d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />
      </svg>
    </div>
  )
}
