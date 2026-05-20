'use client'

// Brand Guide v1.2 — Brand Loader
// 3.2초 사이클: 0–1.0s stroke draw → 1.0–1.4s fill+wordmark fade-in →
// 1.4–2.7s hold → 2.7–3.2s fade-out. ×2 cycle: 워드마크 EN(stayeum) → KO(스테이음) 교차.
//
// 모든 사용처(SplashScreen·페이지 전환·인라인 모달)가 동일한 풀 록업을 보여준다.
// 크기는 size prop 으로만 조절 (sm | md | lg). 텍스트·모션은 동일.

import { useEffect, useRef, useState } from 'react'
import { ARCH_PATH } from './StayeumWordmark'

const ARCH_INITIAL_LEN = 500 // useEffect 측정 전 추정값 (실제 ~430)

type Size = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<Size, { arch: number; wmW: number; wmH: number; gap: string; fontEN: number; fontKO: number }> = {
  sm: { arch: 56, wmW: 110, wmH: 28, gap: '6px',  fontEN: 26, fontKO: 22 },
  md: { arch: 88, wmW: 160, wmH: 40, gap: '8px',  fontEN: 38, fontKO: 32 },
  lg: { arch: 120, wmW: 200, wmH: 50, gap: '10px', fontEN: 48, fontKO: 40 },
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
  const { arch, wmW, wmH, gap, fontEN, fontKO } = SIZE_MAP[size]
  // viewBox 8 8 113 84 → 종횡비 113:84
  const archH = Math.round(arch * (84 / 113))
  const strokeWidth = size === 'lg' ? 2.5 : size === 'md' ? 2.2 : 1.8

  // 실제 path 길이로 보정 — stroke-dasharray 정확도 ↑
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
        fill="none"
        role="img"
        aria-label="스테이음 로딩 중"
      >
        <style>{`
          /* 한 사이클(3.2s) 안에서 Arch — stroke draw → fill in → hold → fade out */
          @keyframes stm-arch-draw {
            0%   { stroke-dashoffset: ${pathLen}; }
            31%  { stroke-dashoffset: 0; }
            100% { stroke-dashoffset: 0; }
          }
          @keyframes stm-arch-fill {
            0%,  31%  { fill-opacity: 0; }
            44%, 84%  { fill-opacity: 1; }
            100%      { fill-opacity: 0; }
          }
          @keyframes stm-arch-stroke {
            0%        { stroke-opacity: 1; }
            31%       { stroke-opacity: 1; }
            44%, 100% { stroke-opacity: 0; }
          }
          .stm-arch-stroke {
            stroke-dasharray: ${pathLen};
            stroke-dashoffset: ${pathLen};
            animation:
              stm-arch-draw   var(--dur-load, 3200ms) var(--ease-in-out, ease-in-out) infinite,
              stm-arch-stroke var(--dur-load, 3200ms) var(--ease-in-out, ease-in-out) infinite;
          }
          .stm-arch-solid {
            fill-opacity: 0;
            animation: stm-arch-fill var(--dur-load, 3200ms) var(--ease-in-out, ease-in-out) infinite;
          }
        `}</style>

        {/* 1) stroke draw — 외곽선만 그려짐 */}
        <path
          ref={pathRef}
          className="stm-arch-stroke"
          d={ARCH_PATH}
          fill="none"
          stroke="var(--persimmon)"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 2) fill — fade in 으로 솔리드 마크가 채워짐 */}
        <path
          className="stm-arch-solid"
          d={ARCH_PATH}
          fill="var(--persimmon)"
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
          .stm-wm-en { animation: stm-wm-en 6.4s var(--ease-in-out, ease-in-out) infinite; }
          .stm-wm-ko { animation: stm-wm-ko 6.4s var(--ease-in-out, ease-in-out) infinite; }
        `}</style>
        <div className="stm-wm-en">
          <svg viewBox="0 0 220 56" width={wmW} height={wmH} fill="none" style={{ color: 'var(--ink)' }}>
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
          <svg viewBox="0 0 220 56" width={wmW} height={wmH} fill="none" style={{ color: 'var(--ink)' }}>
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

      {/* prefers-reduced-motion — 정적 마크 + 워드마크 (EN 고정) */}
      <style>{`
        @media (prefers-reduced-motion: reduce) {
          .stm-arch-stroke { animation: none !important; stroke-dashoffset: 0 !important; stroke-opacity: 0 !important; }
          .stm-arch-solid  { animation: none !important; fill-opacity: 1 !important; }
          .stm-wm-en       { animation: none !important; opacity: 1 !important; }
          .stm-wm-ko       { animation: none !important; opacity: 0 !important; }
        }
      `}</style>
    </div>
  )
}
