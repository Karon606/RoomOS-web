// 브랜드 락업 스플래시 — 서버 렌더 가능. **즉시 완성형 락업** (드로잉 모션 없음).
// 이 컴포넌트가 보이는 구간(SSR 스트리밍·하이드레이션)은 무거운 JS 가 메인스레드를 점유해
// stroke-dashoffset 드로잉이 중간 프레임(컨투어)에서 얼어붙는다 — 실기기 검증으로 확인
// (2026-06-12). 얼 수 있는 중간 상태를 없애기 위해 완성 락업만 표시하고,
// 드로잉 모션은 하이드레이션 이후(메인스레드 한가)에 도는 SplashIntro(§3b) 전용으로 한정.
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
