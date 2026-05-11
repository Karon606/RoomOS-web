// 스플래시 스크린 — Brand Guide v2 · Animation A (Sequential Draw)
//
// 동작: Floor 선 4개가 순차 등장(좌→우) → 워드마크 페이드인 → 반복
// 배경: var(--ink) #1a1a1a  (가이드 Animation C Dark 버전)
// 타이밍: 2.4s loop (실사용 시 1회 재생 후 페이지 전환)

export function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center"
      style={{ background: 'var(--ink, #1a1a1a)' }}
      aria-busy="true"
      aria-label="RoomOS 로딩 중"
    >
      <style>{`
        /* 선 순차 등장 — stroke-dashoffset draw */
        @keyframes roos-l1 {
          0%, 10%  { stroke-dashoffset: 48; opacity: 0; }
          22%, 78% { stroke-dashoffset: 0;  opacity: 1; }
          90%, 100%{ stroke-dashoffset: 48; opacity: 0; }
        }
        @keyframes roos-l2 {
          0%, 22%  { stroke-dashoffset: 31; opacity: 0; }
          34%, 78% { stroke-dashoffset: 0;  opacity: 0.45; }
          90%, 100%{ stroke-dashoffset: 31; opacity: 0; }
        }
        @keyframes roos-l3 {
          0%, 34%  { stroke-dashoffset: 48; opacity: 0; }
          46%, 78% { stroke-dashoffset: 0;  opacity: 0.65; }
          90%, 100%{ stroke-dashoffset: 48; opacity: 0; }
        }
        @keyframes roos-l4 {
          0%, 46%  { stroke-dashoffset: 24; opacity: 0; }
          58%, 78% { stroke-dashoffset: 0;  opacity: 0.28; }
          90%, 100%{ stroke-dashoffset: 24; opacity: 0; }
        }
        @keyframes roos-wm {
          0%, 54%  { opacity: 0; transform: translateY(5px); }
          68%, 78% { opacity: 1; transform: translateY(0);   }
          90%, 100%{ opacity: 0; transform: translateY(-3px);}
        }

        .roos-l1 { stroke-dasharray:48; stroke-dashoffset:48; animation: roos-l1 2.4s ease-in-out infinite; }
        .roos-l2 { stroke-dasharray:31; stroke-dashoffset:31; animation: roos-l2 2.4s ease-in-out infinite; }
        .roos-l3 { stroke-dasharray:48; stroke-dashoffset:48; animation: roos-l3 2.4s ease-in-out infinite; }
        .roos-l4 { stroke-dasharray:24; stroke-dashoffset:24; animation: roos-l4 2.4s ease-in-out infinite; }
        .roos-wm  { animation: roos-wm 2.4s ease-in-out infinite; }
      `}</style>

      {/* 통합 SVG — Floor 마크 + 워드마크 (가이드 § 01 WORDMARK Dark 버전) */}
      <svg
        viewBox="0 0 440 56"
        width="220"
        height="28"
        fill="none"
        aria-hidden="true"
      >
        <line className="roos-l1" x1="0" y1="6"  x2="48" y2="6"  stroke="#e84a1a" strokeWidth="8" strokeLinecap="round"/>
        <line className="roos-l2" x1="0" y1="22" x2="31" y2="22" stroke="#fbf6ee" strokeWidth="8" strokeLinecap="round"/>
        <line className="roos-l3" x1="0" y1="38" x2="48" y2="38" stroke="#fbf6ee" strokeWidth="8" strokeLinecap="round"/>
        <line className="roos-l4" x1="0" y1="54" x2="24" y2="54" stroke="#fbf6ee" strokeWidth="8" strokeLinecap="round"/>
        <g className="roos-wm">
          <text
            x="68"
            y="44"
            fontFamily="var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)"
            fontSize="44"
            letterSpacing="-1.2"
          >
            <tspan fontWeight="300" fill="#fbf6ee">Room</tspan>
            <tspan fontWeight="700" fill="#e84a1a">OS</tspan>
          </text>
        </g>
      </svg>
    </div>
  )
}
