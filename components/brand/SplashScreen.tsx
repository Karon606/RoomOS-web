'use client'

// 일반 모드 스플래시 — 셸 없는 구간(인트로 이후 재발동·소셜 리디렉트·로그아웃) 전용.
// 레퍼런스 'stayeum Splash Intro.html'의 첫 구간(draw 0–1.0s → EN 락업)과 동일 비주얼.
// 드로잉 = 중심선 한 획 + stroke-width 20 (외곽선 컨투어 아님 — 채워진 아치가 자라남).
// 5s 초과 시 느린 연결 캡션, 10s 초과 시 재시도 (v2.0 §21). 표시 타이밍은 SplashHost 가 관리.

import { useEffect, useState } from 'react'

const STROKE_PATH = 'M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82'

export function SplashScreen({ immediate = false }: {
  /** SplashHost 가 자체적으로 300ms 지연을 관리할 때 — 내부 delayed-fallback 생략 */
  immediate?: boolean
}) {
  const [phase, setPhase] = useState<'normal' | 'slow' | 'stalled'>('normal')

  useEffect(() => {
    const slow = setTimeout(() => setPhase('slow'), 5000)      // --splash-slow
    const stalled = setTimeout(() => setPhase('stalled'), 10000)
    return () => { clearTimeout(slow); clearTimeout(stalled) }
  }, [])

  return (
    <div className="fixed inset-0 z-[var(--z-loader)] flex items-center justify-center"
      aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      <style>{`
        @media (prefers-color-scheme: dark) { [data-splash-bg] { background: var(--cold-bg-dark, #000000) !important; } }
        html.dark [data-splash-bg] { background: var(--cold-bg-dark, #000000) !important; }

        .sy-sp-stroke {
          fill: none; stroke: var(--tc, #A03C2E);
          stroke-width: 20; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 1; stroke-dashoffset: 1;
          animation: sy-sp-draw 1000ms cubic-bezier(.65,0,.35,1) forwards;
        }
        @keyframes sy-sp-draw { to { stroke-dashoffset: 0; } }
        .sy-sp-mark { width: 104px; height: 80px; display: flex; align-items: center; justify-content: center; }
        .sy-sp-mark svg { width: 100%; height: 100%; overflow: visible; }
        .sy-sp-div { width: 1px; height: 42px; background: var(--border-s, rgba(61,36,24,.18)); opacity: 0; transform: scaleY(0); animation: sy-sp-div 400ms ease 1000ms forwards; }
        @keyframes sy-sp-div { to { opacity: 1; transform: scaleY(1); } }
        .sy-sp-word {
          font-family: var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif);
          font-weight: 600; font-size: 44px; letter-spacing: -.028em; line-height: 1;
          white-space: nowrap; opacity: 0;
          animation: sy-sp-word 400ms ease 1000ms forwards;
        }
        @keyframes sy-sp-word { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes sy-sp-caption { from { opacity: 0 } to { opacity: 1 } }

        .sy-sp-lockup { display: flex; align-items: center; gap: 22px; }
        @media (max-width: 640px) {
          .sy-sp-lockup { flex-direction: column; gap: 22px; }
          .sy-sp-div { display: none; }
          .sy-sp-mark { width: 88px; height: 68px; }
          .sy-sp-word { font-size: 32px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sy-sp-stroke { animation: none; stroke-dashoffset: 0; }
          .sy-sp-div { animation: none; opacity: 1; transform: scaleY(1); }
          .sy-sp-word { animation: none; opacity: 1; }
        }
      `}</style>
      <div data-splash-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      <div className={`${immediate ? '' : 'delayed-fallback '}relative flex flex-col items-center`}
        style={{ gap: 32, transform: 'translateY(-8vh)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-sp-lockup">
          <div className="sy-sp-mark">
            <svg viewBox="0 0 130 100" aria-hidden="true">
              <path className="sy-sp-stroke" d={STROKE_PATH} pathLength={1} />
            </svg>
          </div>
          <div className="sy-sp-div" />
          <span className="sy-sp-word">
            <span style={{ color: 'var(--ink, #3D2418)' }}>stay</span>
            <span style={{ color: 'var(--tc, #A03C2E)' }}>eum</span>
          </span>
        </div>
        {phase !== 'normal' && (
          <p className="text-[12.5px]" style={{
            color: 'var(--ink-s, #7A6553)',
            animation: 'sy-sp-caption 400ms ease forwards',
          }}>
            연결이 느립니다 — 계속 시도 중입니다
          </p>
        )}
        {phase === 'stalled' && (
          <button type="button" onClick={() => window.location.reload()}
            className="px-4 h-10 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--border-s, rgba(61,36,24,.18))', color: 'var(--ink, #3d2418)' }}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  )
}
