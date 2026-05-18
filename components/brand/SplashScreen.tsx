// 스플래시 스크린 — Brand Guide (Arch Symbol)
//
// 배경: var(--canvas)  → 라이트=Page 톤, 다크=거의 검정 (모드 자동 대응)
// 선·텍스트 색: color: var(--ink) 설정 후 currentColor 참조
//   → 라이트=#3d2418(잉크), 다크=#fbf6ef(크림) 자동 전환
// Arch & "eum": var(--persimmon) Terracotta 고정
//
// 애니메이션: Arch가 살짝 떠오르며 페이드인 → 워드마크 페이드인 (2.6s 무한 루프)

import { ARCH_PATH } from './StayeumWordmark'

export function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'var(--canvas, #e8ddd0)', color: 'var(--ink, #3d2418)' }}
      aria-busy="true"
      aria-label="스테이음 로딩 중"
    >
      <style>{`
        @keyframes stm-arch {
          0%, 6%    { opacity: 0; transform: scale(0.84); }
          26%, 80%  { opacity: 1; transform: scale(1); }
          92%, 100% { opacity: 0; transform: scale(1.04); }
        }
        @keyframes stm-wm {
          0%, 44%   { opacity: 0; transform: translateY(6px); }
          62%, 80%  { opacity: 1; transform: translateY(0); }
          92%, 100% { opacity: 0; transform: translateY(-4px); }
        }
        .stm-arch { transform-box: fill-box; transform-origin: center;
                    animation: stm-arch 2.6s ease-in-out infinite; }
        .stm-wm   { animation: stm-wm 2.6s ease-in-out infinite; }
      `}</style>

      <svg
        viewBox="8 8 366 74"
        width="250"
        height="51"
        fill="none"
        style={{ color: 'inherit' }}
        aria-hidden="true"
      >
        {/* Arch Symbol — Terracotta 고정 */}
        <path className="stm-arch" d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />
        {/* 워드마크 — "stay" currentColor(잉크) / "eum" Terracotta */}
        <g className="stm-wm">
          <text
            x="143"
            y="66"
            fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
            fontSize="56"
            letterSpacing="-1.5"
          >
            <tspan fontWeight="300" fill="currentColor">stay</tspan>
            <tspan fontWeight="700" fill="var(--persimmon, #a03c2e)">eum</tspan>
          </text>
        </g>
      </svg>
    </div>
  )
}
