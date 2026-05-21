'use client'

// Brand Guide v1.2 — Brand Loader
// 3.2s 사이클: stroke draw → fill in → hold → fade out. ×2 사이클마다 EN/KO 교차.
//
// 모션 CSS 는 SVG 외부의 일반 <style> 태그에 두고 (SVG 내부 <style> 의 스코프 이슈 회피),
// 워드마크는 SVG <text> 대신 HTML <span> 으로 — y 아랫부분(descender) 자동 보존.

import { useEffect, useRef, useState } from 'react'
import { ARCH_PATH } from './StayeumWordmark'

const ARCH_INITIAL_LEN = 500

type Size = 'sm' | 'md' | 'lg'

const SIZE_MAP: Record<Size, { arch: number; gap: string; fontEN: number; fontKO: number; stroke: number }> = {
  sm: { arch: 56,  gap: '8px',  fontEN: 22, fontKO: 18, stroke: 2 },
  md: { arch: 88,  gap: '10px', fontEN: 32, fontKO: 26, stroke: 2.5 },
  lg: { arch: 120, gap: '12px', fontEN: 44, fontKO: 36, stroke: 3 },
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
  const { arch, gap, fontEN, fontKO, stroke } = SIZE_MAP[size]
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
      {/* 모션 CSS — SVG 밖의 일반 style 태그. SVG 내부 style 의 스코프 이슈 회피. */}
      <style>{`
        @keyframes stm-arch {
          0%   { stroke-dashoffset: ${pathLen}; fill-opacity: 0; stroke-opacity: 1; }
          31%  { stroke-dashoffset: 0;          fill-opacity: 0; stroke-opacity: 1; }
          44%  { stroke-dashoffset: 0;          fill-opacity: 1; stroke-opacity: 0; }
          84%  { stroke-dashoffset: 0;          fill-opacity: 1; stroke-opacity: 0; }
          100% { stroke-dashoffset: 0;          fill-opacity: 0; stroke-opacity: 0; }
        }
        .stm-arch-path {
          fill-opacity: 0;
          stroke-dasharray: ${pathLen};
          stroke-dashoffset: ${pathLen};
          animation: stm-arch 3200ms ease-in-out infinite;
        }
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
        .stm-wm-en { animation: stm-wm-en 6.4s ease-in-out infinite; opacity: 0; }
        .stm-wm-ko { animation: stm-wm-ko 6.4s ease-in-out infinite; opacity: 0; }
        @media (prefers-reduced-motion: reduce) {
          .stm-arch-path { animation: none; fill-opacity: 1; stroke-opacity: 0; }
          .stm-wm-en     { animation: none; opacity: 1; }
          .stm-wm-ko     { animation: none; opacity: 0; }
        }
      `}</style>

      <svg
        viewBox="8 8 113 84"
        width={arch}
        height={archH}
        role="img"
        aria-label="스테이음 로딩 중"
      >
        <path
          ref={pathRef}
          className="stm-arch-path"
          d={ARCH_PATH}
          fill="var(--persimmon)"
          stroke="var(--persimmon)"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>

      {/* 워드마크 — HTML 텍스트 (descender 자연 보존). 두 워드마크가 같은 위치에서 교차. */}
      <div className="relative" style={{ height: Math.round(fontEN * 1.4) }}>
        <span
          className="stm-wm-en absolute left-1/2 -translate-x-1/2 whitespace-nowrap leading-none"
          style={{
            fontFamily: "var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)",
            fontSize: fontEN,
            letterSpacing: '-0.025em',
            color: 'var(--ink)',
          }}
        >
          <span style={{ fontWeight: 300 }}>stay</span>
          <span style={{ fontWeight: 700, color: 'var(--persimmon)' }}>eum</span>
        </span>
        <span
          className="stm-wm-ko absolute left-1/2 -translate-x-1/2 whitespace-nowrap leading-none"
          style={{
            fontFamily: "var(--font-sans, 'Pretendard Variable', sans-serif)",
            fontSize: fontKO,
            letterSpacing: '-0.03em',
            color: 'var(--ink)',
          }}
        >
          <span style={{ fontWeight: 500 }}>스테이</span>
          <span style={{ fontWeight: 700, color: 'var(--persimmon)' }}>음</span>
        </span>
      </div>
    </div>
  )
}
