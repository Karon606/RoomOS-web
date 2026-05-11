// 공통 스플래시 — 루트 loading.tsx / (app)/loading.tsx 가 동일 시각으로 보이도록.
// fixed inset-0 으로 viewport 정중앙 고정 (sidebar/header 위에 덮어쓰기) → 상단바
// 유무와 관계없이 위치 일정.

import { RoomOSWordmark } from './RoomOSWordmark'

export function SplashScreen() {
  // 워드마크 / 4-bar 사이즈 — 사용자 요청으로 키움
  const WORDMARK_H = 56   // 기존 32~42
  const BAR_BOX    = 72   // 기존 54
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center gap-7"
      style={{ background: 'var(--canvas, #f5e9d8)' }}
      aria-busy="true"
      aria-label="RoomOS 로딩 중"
    >
      <style>{`
        @keyframes roos-from-left {
          0%   { transform: translateX(${-BAR_BOX}px); }
          22%  { transform: translateX(0); }
          72%  { transform: translateX(0); }
          100% { transform: translateX(${BAR_BOX}px); }
        }
        @keyframes roos-from-right {
          0%   { transform: translateX(${BAR_BOX}px); }
          22%  { transform: translateX(0); }
          72%  { transform: translateX(0); }
          100% { transform: translateX(${-BAR_BOX}px); }
        }
        @keyframes roos-fade {
          0%, 100% { opacity: 0.55; }
          50%      { opacity: 1; }
        }
        .splash-b1 { animation: roos-from-left  2.4s ease-in-out infinite 0s;    }
        .splash-b2 { animation: roos-from-right 2.4s ease-in-out infinite 0.16s; }
        .splash-b3 { animation: roos-from-left  2.4s ease-in-out infinite 0.32s; }
        .splash-b4 { animation: roos-from-right 2.4s ease-in-out infinite 0.48s; }
        .splash-text { animation: roos-fade 2.4s ease-in-out infinite; }
      `}</style>

      {/* 워드마크 */}
      <div className="splash-text">
        <RoomOSWordmark height={WORDMARK_H} />
      </div>

      {/* 4-bar 로고 — overflow hidden 으로 로고 영역 밖 클리핑 */}
      <div
        style={{ width: BAR_BOX, height: BAR_BOX, overflow: 'hidden', position: 'relative' }}
        aria-hidden="true"
      >
        <svg width={BAR_BOX} height={BAR_BOX} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
          <g className="splash-b1">
            <line x1="3" y1="6"  x2="57" y2="6"  stroke="var(--coral, var(--persimmon))" strokeWidth="8" strokeLinecap="round" />
          </g>
          <g className="splash-b2">
            <line x1="3" y1="23" x2="38" y2="23" stroke="var(--coral, var(--persimmon))" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
          </g>
          <g className="splash-b3">
            <line x1="3" y1="40" x2="57" y2="40" stroke="var(--coral, var(--persimmon))" strokeWidth="8" strokeLinecap="round" opacity="0.72" />
          </g>
          <g className="splash-b4">
            <line x1="3" y1="57" x2="30" y2="57" stroke="var(--coral, var(--persimmon))" strokeWidth="8" strokeLinecap="round" opacity="0.38" />
          </g>
        </svg>
      </div>
    </div>
  )
}
