export default function AppLoading() {
  return (
    <div className="flex items-center justify-center" style={{ minHeight: 'calc(100vh - 120px)' }}>
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
        .rl-b1 { animation: roos-from-left  2.4s ease-in-out infinite 0s;    }
        .rl-b2 { animation: roos-from-right 2.4s ease-in-out infinite 0.16s; }
        .rl-b3 { animation: roos-from-left  2.4s ease-in-out infinite 0.32s; }
        .rl-b4 { animation: roos-from-right 2.4s ease-in-out infinite 0.48s; }
      `}</style>
      {/* overflow:hidden 으로 로고 영역 밖 바를 클리핑 */}
      <div style={{ width: 54, height: 54, overflow: 'hidden', position: 'relative' }} aria-label="로딩 중">
        <svg
          width="54"
          height="54"
          viewBox="0 0 64 64"
          xmlns="http://www.w3.org/2000/svg"
          style={{ overflow: 'visible' }}
        >
          <g className="rl-b1">
            <line x1="3" y1="6"  x2="57" y2="6"  stroke="#f4623a" strokeWidth="8" strokeLinecap="round" />
          </g>
          <g className="rl-b2">
            <line x1="3" y1="23" x2="38" y2="23" stroke="#f4623a" strokeWidth="8" strokeLinecap="round" opacity="0.5" />
          </g>
          <g className="rl-b3">
            <line x1="3" y1="40" x2="57" y2="40" stroke="#f4623a" strokeWidth="8" strokeLinecap="round" opacity="0.72" />
          </g>
          <g className="rl-b4">
            <line x1="3" y1="57" x2="30" y2="57" stroke="#f4623a" strokeWidth="8" strokeLinecap="round" opacity="0.38" />
          </g>
        </svg>
      </div>
    </div>
  )
}
