'use client'

// 콜드 부트 인트로 — Brand Guide §3b, 레퍼런스 'stayeum Splash Intro.html' 이식.
// 핵심: 드로잉은 외곽선 컨투어가 아니라 **중심선 한 획 + stroke-width 20** —
// 두꺼운 획 자체가 아치라 그리는 중에도 '채워진 아치가 자라나는' 모습(§3b draw).
// pathLength=1 정규화로 측정 불필요. 타이밍·이징·구조 레퍼런스 그대로:
//   draw 0–1.0s → EN 락업 1.0–1.4 → swap KO 2.0–2.35 → hold → (대기 연장) KO↔EN 3.2s 주기
// 완주 보장(3200ms)·세션 게이트·퇴장 페이드는 SplashController 가 담당.

import { useEffect, useState } from 'react'

// 레퍼런스 중심선 패스 — viewBox 0 0 130 100, 열린 곡선 (StayeumWordmark 의 외곽선 ARCH_PATH 와 다름)
const STROKE_PATH = 'M 8 82 C 8 32 22 8 55 8 C 88 8 121 32 121 82'

const SWAP_MS = 350
const SEQ_MS = 3200

export function SplashIntro() {
  // seq: 0–3.2s CSS 키프레임 구간 / extended: 이후 JS 제어 교차 구간
  const [phase, setPhase] = useState<'seq' | 'extended'>('seq')
  const [word, setWord] = useState<'ko' | 'en'>('ko')   // extended 시작 시 KO 에서 이어받음
  const [net, setNet] = useState<'normal' | 'slow' | 'stalled'>('normal')

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    timers.push(setTimeout(() => setPhase('extended'), SEQ_MS))
    timers.push(setTimeout(() => setNet('slow'), 5000))      // --splash-slow
    timers.push(setTimeout(() => setNet('stalled'), 10000))
    const alt = setInterval(() => setWord(w => (w === 'ko' ? 'en' : 'ko')), SEQ_MS)
    return () => { timers.forEach(clearTimeout); clearInterval(alt) }
  }, [])

  const enOn = phase === 'extended' && word === 'en'
  const koOn = phase === 'extended' ? word === 'ko' : true   // seq 구간은 키프레임이 제어

  return (
    <div className="fixed inset-0 z-[var(--z-loader)] flex items-center justify-center"
      aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      <style>{`
        @media (prefers-color-scheme: dark) { [data-intro-bg] { background: var(--cold-bg-dark, #000000) !important; } }
        html.dark [data-intro-bg] { background: var(--cold-bg-dark, #000000) !important; }

        /* §3b draw — 중심선 한 획(stroke 20) 왼→오. pathLength=1 정규화 */
        .sy-in-stroke {
          fill: none; stroke: var(--tc, #A03C2E);
          stroke-width: 20; stroke-linecap: round; stroke-linejoin: round;
          stroke-dasharray: 1; stroke-dashoffset: 1;
          animation: sy-in-draw 1000ms cubic-bezier(.65,0,.35,1) forwards;
        }
        @keyframes sy-in-draw { to { stroke-dashoffset: 0; } }

        .sy-in-mark { width: 104px; height: 80px; display: flex; align-items: center; justify-content: center; }
        .sy-in-mark svg { width: 100%; height: 100%; overflow: visible; }

        /* 디바이더 — 1.0s 에 scaleY */
        .sy-in-div { width: 1px; height: 42px; background: var(--border-s, rgba(61,36,24,.18)); opacity: 0; transform: scaleY(0); animation: sy-in-div 400ms ease 1000ms forwards; }
        @keyframes sy-in-div { to { opacity: 1; transform: scaleY(1); } }

        /* 워드마크 — 같은 자리 교차. EN 1.0s 인 → 2.0s 아웃, KO 2.0s 인 */
        .sy-in-words { position: relative; height: 52px; min-width: 200px; }
        .sy-in-word {
          position: absolute; inset: 0; display: flex; align-items: center;
          font-family: var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif);
          font-weight: 600; font-size: 44px; letter-spacing: -.028em; line-height: 1;
          white-space: nowrap; opacity: 0;
        }
        @keyframes sy-in-word { from { opacity: 0; transform: translateX(-6px); } to { opacity: 1; transform: translateX(0); } }
        @keyframes sy-out-word { from { opacity: 1; } to { opacity: 0; } }
        .sy-in-en { animation: sy-in-word 400ms ease 1000ms forwards, sy-out-word ${SWAP_MS}ms ease 2000ms forwards; }
        .sy-in-ko { animation: sy-in-word ${SWAP_MS}ms ease 2000ms forwards; }
        /* extended 구간 — JS 제어 + transition 크로스페이드 */
        .sy-in-x { transition: opacity ${SWAP_MS}ms ease; animation: none !important; }

        @keyframes sy-in-caption { from { opacity: 0 } to { opacity: 1 } }

        /* 모바일 — 가로 락업이 분리되므로 세로 스택 (레퍼런스 그대로) */
        .sy-in-lockup { display: flex; align-items: center; gap: 22px; }
        @media (max-width: 640px) {
          .sy-in-lockup { flex-direction: column; gap: 22px; }
          .sy-in-div { display: none; }
          .sy-in-mark { width: 88px; height: 68px; }
          .sy-in-words { height: 40px; min-width: 220px; }
          .sy-in-word { font-size: 32px; justify-content: center; }
        }

        @media (prefers-reduced-motion: reduce) {
          .sy-in-stroke { animation: none; stroke-dashoffset: 0; }
          .sy-in-div { animation: none; opacity: 1; transform: scaleY(1); }
          .sy-in-en { animation: none; opacity: 1; }
          .sy-in-ko { animation: none; opacity: 0; }
        }
      `}</style>
      <div data-intro-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />

      {/* 레퍼런스: 수직 중앙 기준 translateY(-8vh) */}
      <div className="relative flex flex-col items-center" style={{ gap: 32, transform: 'translateY(-8vh)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-in-lockup">
          <div className="sy-in-mark">
            <svg viewBox="0 0 130 100" aria-hidden="true">
              <path className="sy-in-stroke" d={STROKE_PATH} pathLength={1} />
            </svg>
          </div>
          <div className="sy-in-div" />
          <div className="sy-in-words">
            <span className={`sy-in-word sy-in-en ${phase === 'extended' ? 'sy-in-x' : ''}`}
              style={phase === 'extended' ? { opacity: enOn ? 1 : 0 } : undefined}>
              <span style={{ color: 'var(--ink, #3D2418)' }}>stay</span>
              <span style={{ color: 'var(--tc, #A03C2E)' }}>eum</span>
            </span>
            <span className={`sy-in-word sy-in-ko ${phase === 'extended' ? 'sy-in-x' : ''}`}
              style={phase === 'extended' ? { opacity: koOn ? 1 : 0 } : undefined}>
              <span style={{ color: 'var(--ink, #3D2418)' }}>스테이</span>
              <span style={{ color: 'var(--tc, #A03C2E)' }}>음</span>
            </span>
          </div>
        </div>

        {net !== 'normal' && (
          <p className="text-[12.5px]" style={{ color: 'var(--ink-s, #7A6553)', animation: 'sy-in-caption 400ms ease forwards' }}>
            연결이 느립니다 — 계속 시도 중입니다
          </p>
        )}
        {net === 'stalled' && (
          <button type="button" onClick={() => window.location.reload()}
            className="px-4 h-10 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--border-s, rgba(61,36,24,.18))', color: 'var(--ink, #3d2418)' }}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  )
}
