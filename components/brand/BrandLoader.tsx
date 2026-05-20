'use client'

// Brand Guide v1.2 — Brand Loader
// 3.2초 사이클: 0–1.0s stroke draw → 1.0–1.4s fill+wordmark fade-in →
// 1.4–2.7s hold → 2.7–3.2s fade-out. ×2 cycle: 워드마크 EN(stayeum) → KO(스테이음) 교차.
//
// 사용처
// - <BrandLoader size="lg" />  : SplashScreen — Arch + 워드마크 풀 록업
// - <BrandLoader size="sm" />  : 페이지 전환 오버레이 — stroke draw 반복(워드마크 없음)
//
// 모션 토큰은 globals.css 의 --dur-load (3200ms) 와 일치시킴.

import { useEffect, useRef, useState } from 'react'
import { ARCH_PATH } from './StayeumWordmark'

const ARCH_INITIAL_LEN = 500 // useEffect 측정 전 추정값 (실제 ~430)

export function BrandLoader({
  size = 'lg',
  className,
}: {
  size?: 'sm' | 'lg'
  className?: string
}) {
  const pathRef = useRef<SVGPathElement>(null)
  const [pathLen, setPathLen] = useState(ARCH_INITIAL_LEN)

  // 실제 path 길이로 보정 — stroke-dasharray 정확도 ↑
  useEffect(() => {
    if (pathRef.current) {
      const len = pathRef.current.getTotalLength()
      if (len > 0) setPathLen(len)
    }
  }, [])

  if (size === 'sm') {
    // 페이지 전환용 — 작고 가벼운 stroke draw 반복 (워드마크 없음)
    return (
      <svg
        viewBox="8 8 113 84"
        width="54"
        height="40"
        fill="none"
        className={className}
        role="img"
        aria-label="로딩 중"
      >
        <style>{`
          @keyframes stm-draw-loop {
            0%   { stroke-dashoffset: ${pathLen}; opacity: 0.4; }
            55%  { stroke-dashoffset: 0; opacity: 1; }
            100% { stroke-dashoffset: ${-pathLen}; opacity: 0.4; }
          }
          .stm-arch-loop {
            stroke-dasharray: ${pathLen};
            stroke-dashoffset: ${pathLen};
            animation: stm-draw-loop 1.6s var(--ease-in-out, ease-in-out) infinite;
          }
        `}</style>
        <path
          ref={pathRef}
          className="stm-arch-loop"
          d={ARCH_PATH}
          fill="none"
          stroke="var(--persimmon)"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    )
  }

  // 풀 사이즈 록업 — 3.2s 사이클, EN/KO 교차 (6.4s = 2 사이클)
  return (
    <div className={`flex flex-col items-center gap-2 ${className ?? ''}`}>
      <svg
        viewBox="8 8 113 84"
        width="120"
        height="89"
        fill="none"
        style={{ color: 'var(--ink)' }}
        role="img"
        aria-label="스테이음 로딩 중"
      >
        <style>{`
          /* 한 사이클(3.2s) 안에서 Arch 만 — stroke draw → fill in → hold → fade out */
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
            0%,  31%  { stroke-opacity: 1; }
            44%, 84%  { stroke-opacity: 0; }
            100%      { stroke-opacity: 0; }
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

        {/* 1) stroke draw 단계 — 외곽선만 그려짐 */}
        <path
          ref={pathRef}
          className="stm-arch-stroke"
          d={ARCH_PATH}
          fill="none"
          stroke="var(--persimmon)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* 2) fill 단계 — fade in 으로 솔리드 마크가 채워짐 */}
        <path
          className="stm-arch-solid"
          d={ARCH_PATH}
          fill="var(--persimmon)"
        />
      </svg>

      {/* 워드마크 — EN/KO 교차. 6.4s(2 사이클)에 한 번 토글. */}
      <div className="relative h-[28px] w-[180px]">
        <style>{`
          @keyframes stm-wm-en {
            0%,  16% { opacity: 0; transform: translateY(4px); }
            22%, 42% { opacity: 1; transform: translateY(0); }
            46%, 100% { opacity: 0; }
          }
          @keyframes stm-wm-ko {
            0%,  50%  { opacity: 0; transform: translateY(4px); }
            56%, 92% { opacity: 1; transform: translateY(0); }
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
          <svg viewBox="0 0 220 56" width="180" height="46" fill="none" style={{ color: 'var(--ink)' }}>
            <text
              x="110" y="44" textAnchor="middle"
              fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
              fontSize="44" letterSpacing="-1"
            >
              <tspan fontWeight="300" fill="currentColor">stay</tspan>
              <tspan fontWeight="700" fill="var(--persimmon)">eum</tspan>
            </text>
          </svg>
        </div>
        <div className="stm-wm-ko">
          <svg viewBox="0 0 220 56" width="180" height="46" fill="none" style={{ color: 'var(--ink)' }}>
            <text
              x="110" y="42" textAnchor="middle"
              fontFamily="var(--font-sans, 'Pretendard Variable', sans-serif)"
              fontSize="36" letterSpacing="-1.4"
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
