// 브랜드 스플래시(서버 렌더, JS 불필요) — 레퍼런스 'stayeum Splash Intro.html'의
// 첫 구간(draw 0–1.0s → EN 락업)과 동일. 드로잉 = 중심선 한 획 + stroke-width 20
// (두꺼운 획 자체가 아치 — 그리는 중에도 채워진 아치가 자라나는 모습, 외곽선 컨투어 아님).
// pathLength=1 정규화라 측정 불필요 → 서버 CSS 만으로 동작.
// 용도: 루트 loading.tsx 스트리밍 폴백. 300ms 표시 지연(.delayed-fallback, v2.0 §21).

const STROKE_PATH = 'M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82'

export function SplashStatic() {
  return (
    <div className="fixed inset-0 z-[var(--z-loader)] flex items-center justify-center"
      aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      {/* 파싱 시점(하이드레이션 전)에 플래그 — 인트로가 '획은 이미 그려졌다'고 판단해 재드로잉 생략 */}
      <script dangerouslySetInnerHTML={{ __html: 'window.__sySplashStatic=1' }} />
      <style>{`
        /* 배경의 판정 주체는 html.dark 하나다. 종전에는 OS 미디어쿼리가 두 번째 주체로 얹혀 있어,
           앱 테마가 라이트인데 기기 외관이 다크면 밝은 앱 위에 새까만 시작 화면이 떴다.
           themeBootstrapScript 가 <head> 안에서 동기로 .dark 를 확정하므로 미디어쿼리가 지킬 창이 없다. */
        html.dark [data-static-bg] { background: var(--cold-bg-dark, #000000) !important; }

        .sy-st-stroke {
          fill: none; stroke: var(--tc, #A03C2E);
          stroke-width: 20; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 1; stroke-dashoffset: 1;
          animation: sy-st-draw 1000ms cubic-bezier(.65,0,.35,1) forwards;
        }
        @keyframes sy-st-draw { to { stroke-dashoffset: 0; } }
        .sy-st-mark { width: 104px; height: 80px; display: flex; align-items: center; justify-content: center; }
        .sy-st-mark svg { width: 100%; height: 100%; overflow: visible; }
        .sy-st-div { width: 1px; height: 42px; background: var(--border-s, rgba(61,36,24,.18)); opacity: 0; transform: scaleY(0); animation: sy-st-div 400ms ease 1000ms forwards; }
        @keyframes sy-st-div { to { opacity: 1; transform: scaleY(1); } }
        .sy-st-word {
          font-family: var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif);
          font-weight: 600; font-size: 44px; letter-spacing: -.028em; line-height: 1;
          white-space: nowrap; opacity: 0;
          animation: sy-st-word 400ms ease 1000ms forwards;
        }
        @keyframes sy-st-word { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }

        .sy-st-lockup { display: flex; align-items: center; gap: 22px; }
        @media (max-width: 640px) {
          .sy-st-lockup { flex-direction: column; gap: 22px; }
          .sy-st-div { display: none; }
          .sy-st-mark { width: 88px; height: 68px; }
          .sy-st-word { font-size: 32px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sy-st-stroke { animation: none; stroke-dashoffset: 0; }
          .sy-st-div { animation: none; opacity: 1; transform: scaleY(1); }
          .sy-st-word { animation: none; opacity: 1; }
        }
      `}</style>
      <div data-static-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      <div className="delayed-fallback relative flex flex-col items-center"
        style={{ transform: 'translateY(-8vh)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-st-lockup">
          <div className="sy-st-mark">
            <svg viewBox="0 0 130 100" aria-hidden="true">
              <path className="sy-st-stroke" d={STROKE_PATH} pathLength={1} />
            </svg>
          </div>
          <div className="sy-st-div" />
          <span className="sy-st-word">
            <span style={{ color: 'var(--ink, #3D2418)' }}>stay</span>
            <span style={{ color: 'var(--tc, #A03C2E)' }}>eum</span>
          </span>
        </div>
      </div>
    </div>
  )
}
