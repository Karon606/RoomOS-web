// 브랜드 락업 스플래시 — 서버 렌더 가능(JS 불필요, CSS 애니메이션만).
// 1회성 시퀀스: 아치 드로잉(0–1.0s) → 채움(1.0–1.4s) + 워드마크 페이드인 → 락업 정지.
// 루프 없음 — '그리다 만' 컨투어 잔상이 생길 수 없고, 끝나면 완성형 락업으로 머문다.
// 용도: 루트 loading.tsx 스트리밍 폴백(SSR 대기 — 하이드레이션 전이라 Host 가 못 덮는 구간).
// 300ms 표시 지연(.delayed-fallback)으로 빠른 전환에선 보이지 않는다(§18.3).

import { ARCH_PATH } from './StayeumWordmark'

// 서버 렌더라 getTotalLength() 측정 불가 — 실측 근사 상수(여유분은 드로잉 시작이
// 수십 ms 늦어 보이는 정도로만 작용). 클라이언트 측 SplashScreen 은 실측 사용.
const ARCH_LEN = 680

export function SplashStatic() {
  return (
    <div className="fixed inset-0 z-[var(--z-loader)]" aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      <style>{`
        @media (prefers-color-scheme: dark) { [data-static-bg] { background: var(--cold-bg-dark, #2A1A10) !important; } }
        html.dark [data-static-bg] { background: var(--cold-bg-dark, #2A1A10) !important; }
        @keyframes sy-stat-arch {
          0%    { stroke-dashoffset: ${ARCH_LEN}; fill-opacity: 0; stroke-opacity: 1; }
          71.4% { stroke-dashoffset: 0;           fill-opacity: 0; stroke-opacity: 1; }
          100%  { stroke-dashoffset: 0;           fill-opacity: 1; stroke-opacity: 0; }
        }
        .sy-stat-arch {
          stroke-dasharray: ${ARCH_LEN};
          stroke-dashoffset: ${ARCH_LEN};
          fill-opacity: 0;
          animation: sy-stat-arch 1400ms cubic-bezier(.65,0,.35,1) forwards;
        }
        @keyframes sy-stat-wm { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        .sy-stat-wm-anim { opacity: 0; animation: sy-stat-wm 400ms cubic-bezier(.65,0,.35,1) 1000ms forwards; }
        @keyframes sy-stat-div { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
        .sy-stat-div { transform: scaleY(0); opacity: 0; transform-origin: center; animation: sy-stat-div 400ms cubic-bezier(.65,0,.35,1) 1000ms forwards; }
        .sy-static-lockup { display: flex; align-items: center; gap: 20px; }
        .sy-static-mark   { width: 104px; }
        .sy-static-wm     { font-size: 44px; }
        @media (max-width: 639px) {
          .sy-static-lockup { flex-direction: column; gap: 14px; }
          .sy-static-mark   { width: 88px; }
          .sy-stat-div      { display: none; }
          .sy-static-wm     { font-size: 32px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sy-stat-arch { animation: none; stroke-dashoffset: 0; fill-opacity: 1; stroke-opacity: 0; }
          .sy-stat-wm-anim { animation: none; opacity: 1; }
          .sy-stat-div { animation: none; transform: scaleY(1); opacity: 1; }
        }
      `}</style>
      <div data-static-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      <div className="delayed-fallback absolute inset-x-0 flex flex-col items-center"
        style={{ top: '42%', transform: 'translateY(-50%)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-static-lockup">
          <svg viewBox="8 8 113 84" className="sy-static-mark" style={{ overflow: 'visible', height: 'auto' }} aria-hidden="true">
            <path className="sy-stat-arch" d={ARCH_PATH}
              fill="var(--persimmon, #a03c2e)" stroke="var(--persimmon, #a03c2e)"
              strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <div className="sy-stat-div" style={{ width: 1.5, height: 56, background: 'var(--border-s, rgba(61,36,24,.18))' }} />
          <span className="sy-stat-wm-anim sy-static-wm whitespace-nowrap leading-none"
            style={{ fontFamily: "var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)", letterSpacing: '-0.025em' }}>
            <span style={{ fontWeight: 300 }}>stay</span>
            <span style={{ fontWeight: 700, color: 'var(--persimmon, #a03c2e)' }}>eum</span>
          </span>
        </div>
      </div>
    </div>
  )
}
