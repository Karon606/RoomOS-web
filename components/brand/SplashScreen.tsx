'use client'

// 일반 모드 스플래시 — 셸 없는 구간(인트로 이후 재발동·소셜 리디렉트·로그아웃) 전용.
// 비주얼 = 정적 락업(채워진 아치 + 워드마크): 인트로(§3b)의 락업 프레임과 동일해
// 콜드 부트 전 구간이 한 비주얼로 이어진다. 구형 루프 로더(가는 선 컨투어 드로잉)는
// 인트로와 톤이 달라 '과거 로고 잔상'으로 보였음(2026-06-12 사용자 보고) — 폐지.
// 5s 초과 시 느린 연결 캡션, 10s 초과 시 재시도 (§18.2). 표시 타이밍은 SplashHost 가 관리.

import { useEffect, useState } from 'react'
import { ARCH_PATH } from './StayeumWordmark'

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
    <div
      className="fixed inset-0 z-[var(--z-loader)]"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}
      aria-busy="true"
      aria-label="스테이음 로딩 중"
    >
      {/* 다크모드 배경 — JS 테마 감지 전에도 CSS 미디어쿼리로 즉시 적용 (§18.4) */}
      <style>{`
        @media (prefers-color-scheme: dark) {
          [data-splash-bg] { background: var(--cold-bg-dark, #2A1A10) !important; }
        }
        html.dark [data-splash-bg] { background: var(--cold-bg-dark, #2A1A10) !important; }
        @keyframes splash-caption-in { from { opacity: 0 } to { opacity: 1 } }
        .sy-splash-lockup { display: flex; align-items: center; gap: 20px; }
        .sy-splash-mark   { width: 104px; }
        .sy-splash-wm     { font-size: 44px; }
        @media (max-width: 639px) {
          .sy-splash-lockup { flex-direction: column; gap: 14px; }
          .sy-splash-mark   { width: 88px; }
          .sy-splash-div    { display: none; }
          .sy-splash-wm     { font-size: 32px; }
        }
      `}</style>
      <div data-splash-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      {/* 수직 중앙 -8% (시각 중심) */}
      <div className={`${immediate ? '' : 'delayed-fallback '}absolute inset-x-0 flex flex-col items-center`}
        style={{ top: '42%', transform: 'translateY(-50%)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-splash-lockup">
          <svg viewBox="8 8 113 84" className="sy-splash-mark" style={{ overflow: 'visible', height: 'auto' }} aria-hidden="true">
            <path d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />
          </svg>
          <div className="sy-splash-div" style={{ width: 1.5, height: 56, background: 'var(--border-s, rgba(61,36,24,.18))' }} />
          <span className="sy-splash-wm whitespace-nowrap leading-none"
            style={{ fontFamily: "var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)", letterSpacing: '-0.025em' }}>
            <span style={{ fontWeight: 300 }}>stay</span>
            <span style={{ fontWeight: 700, color: 'var(--persimmon, #a03c2e)' }}>eum</span>
          </span>
        </div>
        {phase !== 'normal' && (
          <p className="text-[12.5px]" style={{
            marginTop: 24, color: 'var(--ink-s, #7A6553)',
            animation: 'splash-caption-in 400ms ease forwards',
          }}>
            연결이 느립니다 — 계속 시도 중입니다
          </p>
        )}
        {phase === 'stalled' && (
          <button type="button" onClick={() => window.location.reload()}
            className="mt-3 px-4 h-10 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--border-s, rgba(61,36,24,.18))', color: 'var(--ink, #3d2418)' }}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  )
}
