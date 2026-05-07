// 루트 레벨 loading.tsx — 첫 진입(cold start, 모바일 백그라운드 복귀 등)
// 시점부터 표시되는 풀스크린 스플래시. (app)/loading.tsx는 layout이
// 렌더된 이후 page fetch 동안만 표시되므로 그 이전 구간은 빈 화면이었음.
export default function RootLoading() {
  return (
    <div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center"
      style={{ background: 'var(--canvas, #f5e9d8)' }}
      aria-busy="true"
      aria-label="RoomOS 로딩 중"
    >
      <style>{`
        @keyframes roos-from-left {
          0%   { transform: translateX(-54px); }
          22%  { transform: translateX(0); }
          72%  { transform: translateX(0); }
          100% { transform: translateX(54px); }
        }
        @keyframes roos-from-right {
          0%   { transform: translateX(54px); }
          22%  { transform: translateX(0); }
          72%  { transform: translateX(0); }
          100% { transform: translateX(-54px); }
        }
        @keyframes roos-fade {
          0%, 100% { opacity: 0.5; }
          50%      { opacity: 1; }
        }
        .splash-b1 { animation: roos-from-left  2.4s ease-in-out infinite 0s;    }
        .splash-b2 { animation: roos-from-right 2.4s ease-in-out infinite 0.16s; }
        .splash-b3 { animation: roos-from-left  2.4s ease-in-out infinite 0.32s; }
        .splash-b4 { animation: roos-from-right 2.4s ease-in-out infinite 0.48s; }
        .splash-text { animation: roos-fade 2.4s ease-in-out infinite; }
      `}</style>

      {/* RoomOS 워드마크 */}
      <h1
        className="splash-text mb-7 tracking-tight"
        style={{
          fontSize: 30,
          fontWeight: 700,
          letterSpacing: '-0.04em',
          color: 'var(--warm-dark, #5a4a3a)',
        }}
      >
        Room<span style={{ color: 'var(--coral, #f4623a)' }}>OS</span>
      </h1>

      {/* 4-bar 로고 — (app)/loading.tsx 모티프와 동일 */}
      <div
        style={{ width: 54, height: 54, overflow: 'hidden', position: 'relative' }}
        aria-hidden="true"
      >
        <svg width="54" height="54" viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" style={{ overflow: 'visible' }}>
          <g className="splash-b1">
            <line x1="3" y1="6"  x2="57" y2="6"  stroke="var(--coral, #f4623a)" strokeWidth="8" strokeLinecap="round" />
          </g>
          <g className="splash-b2">
            <line x1="3" y1="23" x2="38" y2="23" stroke="var(--coral, #f4623a)" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
          </g>
          <g className="splash-b3">
            <line x1="3" y1="40" x2="57" y2="40" stroke="var(--coral, #f4623a)" strokeWidth="8" strokeLinecap="round" opacity="0.72" />
          </g>
          <g className="splash-b4">
            <line x1="3" y1="57" x2="30" y2="57" stroke="var(--coral, #f4623a)" strokeWidth="8" strokeLinecap="round" opacity="0.38" />
          </g>
        </svg>
      </div>
    </div>
  )
}
