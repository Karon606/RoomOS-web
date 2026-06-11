// 정적 브랜드 락업 스플래시 — 서버 렌더 가능(클라이언트 JS 불필요).
// 용도: 루트 loading.tsx 의 스트리밍 폴백. 콜드 부트의 가장 긴 구간(SSR 대기)은
// 하이드레이션 전이라 SplashHost(인트로)가 못 덮는다 — 이 구간을 빈 배경 대신
// 인트로의 EN 락업 프레임과 동일한 정적 화면으로 채운다 (애니메이션 없음 = 잔상 없음).
// 하이드레이션 후에는 SplashHost 오버레이(인트로/일반)가 위를 덮어 자연스럽게 이어받는다.
// 300ms 표시 지연(.delayed-fallback)으로 빠른 전환에선 보이지 않는다(§18.3).

import { ARCH_PATH } from './StayeumWordmark'

export function SplashStatic() {
  return (
    <div className="fixed inset-0 z-[var(--z-loader)]" aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      <style>{`
        @media (prefers-color-scheme: dark) { [data-static-bg] { background: var(--cold-bg-dark, #2A1A10) !important; } }
        html.dark [data-static-bg] { background: var(--cold-bg-dark, #2A1A10) !important; }
        .sy-static-lockup { display: flex; align-items: center; gap: 20px; }
        .sy-static-mark   { width: 104px; }
        .sy-static-wm     { font-size: 44px; }
        @media (max-width: 639px) {
          .sy-static-lockup { flex-direction: column; gap: 14px; }
          .sy-static-mark   { width: 88px; }
          .sy-static-div    { display: none; }
          .sy-static-wm     { font-size: 32px; }
        }
      `}</style>
      <div data-static-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      <div className="delayed-fallback absolute inset-x-0 flex flex-col items-center"
        style={{ top: '42%', transform: 'translateY(-50%)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-static-lockup">
          <svg viewBox="8 8 113 84" className="sy-static-mark" style={{ overflow: 'visible', height: 'auto' }} aria-hidden="true">
            <path d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />
          </svg>
          <div className="sy-static-div" style={{ width: 1.5, height: 56, background: 'var(--border-s, rgba(61,36,24,.18))' }} />
          <span className="sy-static-wm whitespace-nowrap leading-none"
            style={{ fontFamily: "var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)", letterSpacing: '-0.025em' }}>
            <span style={{ fontWeight: 300 }}>stay</span>
            <span style={{ fontWeight: 700, color: 'var(--persimmon, #a03c2e)' }}>eum</span>
          </span>
        </div>
      </div>
    </div>
  )
}
