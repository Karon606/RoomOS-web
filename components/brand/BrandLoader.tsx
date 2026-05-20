'use client'

// Brand Guide v1.2 — Brand Loader
// 3.2초 사이클: 0–1.0s stroke draw → 1.0–1.4s fill+wordmark fade-in →
// 1.4–2.7s hold → 2.7–3.2s fade-out. ×2 cycle: 워드마크 EN(stayeum) → KO(스테이음) 교차.
//
// 단일 path 에 stroke + fill 모두 적용하고 한 keyframes 로 통합 — 두 path 분리 시
// fill-opacity 가 적용 안 되어 윤곽선만 보이던 호환성 이슈 회피.

import { useEffect, useRef, useState } from 'react'
import { ARCH_PATH } from './StayeumWordmark'

const ARCH_INITIAL_LEN = 500

type Size = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<Size, { arch: number; wmW: number; wmH: number; gap: string; fontEN: number; fontKO: number; stroke: number }> = {
  sm: { arch: 56,  wmW: 110, wmH: 28, gap: '6px',  fontEN: 26, fontKO: 22, stroke: 2 },
  md: { arch: 88,  wmW: 160, wmH: 40, gap: '8px',  fontEN: 38, fontKO: 32, stroke: 2.5 },
  lg: { arch: 120, wmW: 200, wmH: 50, gap: '10px', fontEN: 48, fontKO: 40, stroke: 3 },
}

export function BrandLoader({
  size = 'md',
  className,
}: {
  size?: Size
  className?: string
}) {
  const pathRef = useRef<SVGPathElement>(null)
  const [pathLen, setPathLen] = useState(ARCH_INITIAL_LEN)
  const { arch, wmW, wmH, gap, fontEN, fontKO, stroke } = SIZE_MAP[size]
  const archH = Math.round(arch * (84 / 113))

  useEffect(() => {
    if (pathRef.current) {
      const len = pathRef.current.getTotalLength()
      if (len > 0) setPathLen(len)
    }
  }, [])

  return (
    <div
      className={`flex flex-col items-center ${className ?? ''}`}
      style={{ gap }}
    >
      <svg
        viewBox="8 8 113 84"
        width={arch}
        height={archH}
        role="img"
        aria-label="스테이음 로딩 중"
      >
        <style>{`
          /* 통합 keyframes — 한 path 안에서 stroke draw → fill fade → fade out */
          @keyframes stm-arch {
            0%   { stroke-dashoffset: ${pathLen}; fill-opacity: 0; stroke-opacity: 1; }
            31%  { stroke-dashoffset: 0;          fill-opacity: 0; stroke-opacity: 1; }
            44%  { stroke-dashoffset: 0;          fill-opacity: 1; stroke-opacity: 0; }
            84%  { stroke-dashoffset: 0;          fill-opacity: 1; stroke-opacity: 0; }
            100% { stroke-dashoffset: 0;          fill-opacity: 0; stroke-opacity: 0; }
          }
          .stm-arch {
            fill-opacity: 0;
            stroke-dasharray: ${pathLen};
            stroke-dashoffset: ${pathLen};
            animation: stm-arch 3200ms ease-in-out infinite;
          }
          @media (prefers-reduced-motion: reduce) {
            .stm-arch { animation: none; fill-opacity: 1; stroke-opacity: 0; }
          }
        `}</style>

        <path
          ref={pathRef}
          className="stm-arch"
          d={ARCH_PATH}
          fill="var(--persimmon)"
          stroke="var(--persimmon)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* 워드마크 — EN/KO 교차. 6.4s(2 사이클)에 한 번 토글. */}
      <div className="relative" style={{ width: wmW, height: wmH }}>
        <style>{`
          @keyframes stm-wm-en {
            0%,  16%  { opacity: 0; transform: translateY(4px); }
            22%, 42%  { opacity: 1; transform: translateY(0); }
            46%, 100% { opacity: 0; }
          }
          @keyframes stm-wm-ko {
            0%,  50%  { opacity: 0; transform: translateY(4px); }
            56%, 92%  { opacity: 1; transform: translateY(0); }
            96%, 100% { opacity: 0; }
          }
          .stm-wm-en, .stm-wm-ko {
            position: absolute; inset: 0;
            display: flex; align-items: center; justify-content: center;
            opacity: 0;
          }
          .stm-wm-en { animation: stm-wm-en 6.4s ease-in-out infinite; }
          .stm-wm-ko { animation: stm-wm-ko 6.4s ease-in-out infinite; }
          @media (prefers-reduced-motion: reduce) {
            .stm-wm-en { animation: none; opacity: 1; }
            .stm-wm-ko { animation: none; opacity: 0; }
          }
        `}</style>
        <div className="stm-wm-en">
          <svg viewBox="0 0 220 56" width={wmW} height={wmH} style={{ color: 'var(--ink)' }}>
            <text
              x="110" y={fontEN + 8} textAnchor="middle"
              fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
              fontSize={fontEN} letterSpacing="-1"
            >
              <tspan fontWeight="300" fill="currentColor">stay</tspan>
              <tspan fontWeight="700" fill="var(--persimmon)">eum</tspan>
            </text>
          </svg>
        </div>
        <div className="stm-wm-ko">
          <svg viewBox="0 0 220 56" width={wmW} height={wmH} style={{ color: 'var(--ink)' }}>
            <text
              x="110" y={fontKO + 8} textAnchor="middle"
              fontFamily="var(--font-sans, 'Pretendard Variable', sans-serif)"
              fontSize={fontKO} letterSpacing="-1.4"
            >
              <tspan fontWeight="500" fill="currentColor">스테이</tspan>
              <tspan fontWeight="700" fill="var(--persimmon)">음</tspan>
            </text>
          </svg>
        </div>
      </div>
    </div>
  )
}
