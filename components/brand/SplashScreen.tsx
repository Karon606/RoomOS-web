'use client'

// 콜드 스타트 스플래시 — Brand Guide v1.3 §18.2.
// 셸이 없는 구간(도메인 콜드 부트·소셜 인증 리디렉트 복귀·로그아웃) 전용.
// 배경 = --cold-bg(=--page, manifest background 와 동일값 — PWA 3단계 연속성),
// 로더는 화면 수직 중앙 -8%(시각 중심), 5s 초과 시 느린 연결 캡션, 10s 초과 시 재시도.
// 300ms 표시 지연(.delayed-fallback)으로 빠른 로드에선 한 프레임도 안 보임(§18.3).

import { useEffect, useState } from 'react'
import { BrandLoader } from './BrandLoader'

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
      `}</style>
      <div data-splash-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      {/* 수직 중앙 -8% (시각 중심) */}
      <div className={`${immediate ? '' : 'delayed-fallback '}absolute inset-x-0 flex flex-col items-center`}
        style={{ top: '42%', transform: 'translateY(-50%)', color: 'var(--ink, #3d2418)' }}>
        <BrandLoader size="lg" />
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
