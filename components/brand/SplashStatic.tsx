// 브랜드 락업 스플래시 — 서버 렌더 가능. **컴포지터 안전 모션만 사용**.
// 이 컴포넌트가 보이는 구간(SSR 스트리밍·하이드레이션)은 무거운 JS 가 메인스레드를 점유해
// stroke-dashoffset 선 드로잉은 컨투어 중간 프레임에서 얼어붙는다(실기기 확인, 2026-06-12).
// transform/opacity 는 GPU 합성 스레드에서 돌아 메인스레드가 막혀도 계속 움직이므로:
//   ① 와이프 리빌 — 배경색 커버가 왼→오로 밀려나며 채워진 아치가 '칠해지듯' 드러남(0.9s)
//   ② 워드마크·디바이더 페이드인(translate/opacity)
//   ③ 완료 후 은은한 숨쉬기 펄스(무한) — 긴 SSR 대기에도 '살아있음'이 보임
// 진짜 선 드로잉은 SplashIntro(§3b, 하이드레이션 후 안정 구간) 전용.
// 300ms 표시 지연(.delayed-fallback)으로 빠른 전환에선 보이지 않는다(§18.3).

import { ARCH_PATH } from './StayeumWordmark'

export function SplashStatic() {
  return (
    <div className="fixed inset-0 z-[var(--z-loader)]" aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      <style>{`
        @media (prefers-color-scheme: dark) {
          [data-static-bg], .sy-wipe-cover { background: var(--cold-bg-dark, #2A1A10) !important; }
        }
        html.dark [data-static-bg], html.dark .sy-wipe-cover { background: var(--cold-bg-dark, #2A1A10) !important; }

        /* ① 와이프 리빌 — transform만 사용(컴포지터 스레드, 메인스레드 정체에도 안 멈춤) */
        @keyframes sy-wipe { to { transform: translateX(103%); } }
        .sy-wipe-cover {
          position: absolute; inset: -2px;
          background: var(--cold-bg, #E8DDD0);
          animation: sy-wipe 900ms cubic-bezier(.65,0,.35,1) forwards;
          will-change: transform;
        }
        /* ② 워드마크·디바이더 — opacity/transform 페이드인 */
        @keyframes sy-stat-in { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        .sy-stat-in { opacity: 0; animation: sy-stat-in 400ms cubic-bezier(.65,0,.35,1) 700ms forwards; will-change: opacity, transform; }
        /* ③ 숨쉬기 펄스 — 리빌 완료 후 무한 (opacity만) */
        @keyframes sy-breathe { 0%, 100% { opacity: 1; } 50% { opacity: .82; } }
        .sy-breathe { animation: sy-breathe 2.4s ease-in-out 1600ms infinite; will-change: opacity; }

        .sy-static-lockup { display: flex; align-items: center; gap: 20px; }
        .sy-static-mark   { width: 104px; }
        .sy-static-wm     { font-size: 44px; }
        @media (max-width: 639px) {
          .sy-static-lockup { flex-direction: column; gap: 14px; }
          .sy-static-mark   { width: 88px; }
          .sy-static-div    { display: none; }
          .sy-static-wm     { font-size: 32px; }
        }
        @media (prefers-reduced-motion: reduce) {
          .sy-wipe-cover { animation: none; transform: translateX(103%); }
          .sy-stat-in    { animation: none; opacity: 1; }
          .sy-breathe    { animation: none; }
        }
      `}</style>
      <div data-static-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />
      <div className="delayed-fallback absolute inset-x-0 flex flex-col items-center"
        style={{ top: '42%', transform: 'translateY(-50%)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-breathe sy-static-lockup">
          {/* 마크 — 채워진 아치 위로 배경색 커버가 밀려나며 드러남 (클리핑용 overflow hidden) */}
          <div className="relative overflow-hidden" style={{ lineHeight: 0 }}>
            <svg viewBox="8 8 113 84" className="sy-static-mark" style={{ height: 'auto' }} aria-hidden="true">
              <path d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />
            </svg>
            <div className="sy-wipe-cover" />
          </div>
          <div className="sy-stat-in sy-static-div" style={{ width: 1.5, height: 56, background: 'var(--border-s, rgba(61,36,24,.18))' }} />
          <span className="sy-stat-in sy-static-wm whitespace-nowrap leading-none"
            style={{ fontFamily: "var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)", letterSpacing: '-0.025em' }}>
            <span style={{ fontWeight: 300 }}>stay</span>
            <span style={{ fontWeight: 700, color: 'var(--persimmon, #a03c2e)' }}>eum</span>
          </span>
        </div>
      </div>
    </div>
  )
}
