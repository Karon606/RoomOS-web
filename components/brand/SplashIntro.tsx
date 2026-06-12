'use client'

// 콜드 부트 인트로 — Brand Guide v1.3.1 §3b. 루프형 BrandLoader 와 달리 1회성 시퀀스.
//   draw 0–1.0s → lockup EN 1.0–1.4 → hold EN –2.0 → swap KO 2.0–2.35 → hold KO –3.2
//   이후 로딩 지속 시: 3200ms 마다 KO↔EN 크로스페이드(350ms), 5s 캡션, 10s 재시도.
// ⚠️ 레퍼런스 'stayeum Splash Intro.html' 이 리포에 없어(지시서와 달리 미제공)
//   아치 마크업은 기존 BrandLoader 자산(ARCH_PATH 컨투어 드로잉)을 재사용하고
//   타이밍·이징·크기·시퀀스만 §3b 표 그대로 구현 — 파일 수령 시 마크업 교체 여지.
// 완주 보장(3200ms)·세션 1회 게이트는 SplashController 가 담당.

import { useEffect, useState } from 'react'
import { ARCH_PATH } from './StayeumWordmark'

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

  // extended 구간 워드마크 표시 여부 (350ms 크로스페이드는 CSS transition)
  const enOn = phase === 'extended' && word === 'en'
  const koOn = phase === 'extended' ? word === 'ko' : true   // seq 구간은 키프레임이 제어

  return (
    <div className="fixed inset-0 z-[var(--z-loader)]" aria-busy="true" aria-label="스테이음 로딩 중"
      style={{ background: 'var(--cold-bg, #E8DDD0)' }}>
      <style>{`
        @media (prefers-color-scheme: dark) { [data-intro-bg] { background: var(--cold-bg-dark, #2A1A10) !important; } }
        html.dark [data-intro-bg] { background: var(--cold-bg-dark, #2A1A10) !important; }

        /* §3b draw 대체 — 0–1.0s 와이프 리빌(transform만 = 컴포지터 스레드).
           stroke-dashoffset 드로잉은 메인스레드라 하이드레이션 직후의 대형 렌더·패치에
           컨투어 중간 프레임으로 얼어붙었음(실기기 반복 확인) — 부트 경로 stroke 모션 전면 금지. */
        @keyframes sy-intro-wipe { to { transform: translateX(103%); } }
        .sy-intro-wipe {
          position: absolute; inset: -2px;
          background: var(--cold-bg, #E8DDD0);
          animation: sy-intro-wipe 1000ms cubic-bezier(.65,0,.35,1) forwards;
          will-change: transform;
        }
        @media (prefers-color-scheme: dark) { .sy-intro-wipe { background: var(--cold-bg-dark, #2A1A10) !important; } }
        html.dark .sy-intro-wipe { background: var(--cold-bg-dark, #2A1A10) !important; }
        /* 디바이더 — 1.0–1.4s scaleY (데스크톱 가로 락업 전용) */
        @keyframes sy-intro-div { from { transform: scaleY(0); opacity: 0; } to { transform: scaleY(1); opacity: 1; } }
        .sy-intro-div { transform: scaleY(0); opacity: 0; transform-origin: center; animation: sy-intro-div 400ms cubic-bezier(.65,0,.35,1) 1000ms forwards; }
        /* EN — 1.0–1.4 페이드인(translateX −6→0) → 2.0–2.35 페이드아웃 */
        @keyframes sy-intro-en {
          0%, 71.4%      { opacity: 0; transform: translateX(-6px); }   /* –1.0s */
          100%           { opacity: 1; transform: translateX(0); }      /* 1.4s */
        }
        @keyframes sy-intro-en-out { from { opacity: 1; } to { opacity: 0; } }
        .sy-intro-en {
          opacity: 0;
          animation: sy-intro-en 1400ms cubic-bezier(.65,0,.35,1) forwards,
                     sy-intro-en-out ${SWAP_MS}ms ease 2000ms forwards;
        }
        /* KO — 2.0–2.35 크로스페이드 인 → hold */
        @keyframes sy-intro-ko { from { opacity: 0; } to { opacity: 1; } }
        .sy-intro-ko { opacity: 0; animation: sy-intro-ko ${SWAP_MS}ms ease 2000ms forwards; }

        /* extended 구간 — JS 제어 + transition 크로스페이드 */
        .sy-intro-x { transition: opacity ${SWAP_MS}ms ease; animation: none !important; }

        @keyframes sy-intro-caption { from { opacity: 0 } to { opacity: 1 } }

        /* 모바일(<640px) — 세로 스택, 디바이더 생략 (§3b-7) */
        .sy-intro-lockup { display: flex; align-items: center; gap: 20px; }
        .sy-intro-mark   { width: 104px; }
        .sy-intro-wm     { font-size: 44px; }
        .sy-intro-wm-ko  { font-size: 36px; }
        @media (max-width: 639px) {
          .sy-intro-lockup { flex-direction: column; gap: 14px; }
          .sy-intro-mark   { width: 88px; }
          .sy-intro-div    { display: none; }
          .sy-intro-wm     { font-size: 32px; }
          .sy-intro-wm-ko  { font-size: 27px; }
        }

        /* 접근성 — 인트로 생략, 정적 락업 즉시 (전역 reduce 규칙과 별개로 명시) */
        @media (prefers-reduced-motion: reduce) {
          .sy-intro-wipe { animation: none; transform: translateX(103%); }
          .sy-intro-div  { animation: none; transform: scaleY(1); opacity: 1; }
          .sy-intro-en   { animation: none; opacity: 1; }
          .sy-intro-ko   { animation: none; opacity: 0; }
        }
      `}</style>
      <div data-intro-bg className="absolute inset-0" style={{ background: 'var(--cold-bg, #E8DDD0)' }} />

      {/* 수직 중앙 -8% (시각 중심) */}
      <div className="absolute inset-x-0 flex flex-col items-center"
        style={{ top: '42%', transform: 'translateY(-50%)', color: 'var(--ink, #3d2418)' }}>
        <div className="sy-intro-lockup">
          {/* 마크 — 채워진 아치 위로 배경색 커버가 왼→오로 밀려나며 드러남 (와이프 클리핑) */}
          <div className="relative overflow-hidden" style={{ lineHeight: 0 }}>
            <svg viewBox="8 8 113 84" className="sy-intro-mark" style={{ height: 'auto' }} aria-hidden="true">
              <path d={ARCH_PATH} fill="var(--persimmon, #a03c2e)" />
            </svg>
            <div className="sy-intro-wipe" />
          </div>
          <div className="sy-intro-div" style={{ width: 1.5, height: 56, background: 'var(--border-s, rgba(61,36,24,.18))' }} />
          {/* 워드마크 — EN/KO 같은 자리 교차 */}
          <div className="relative" style={{ width: 'max-content', minWidth: 220, height: 62 }}>
            <span className={`sy-intro-en ${phase === 'extended' ? 'sy-intro-x' : ''} sy-intro-wm absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap leading-none`}
              style={{
                fontFamily: "var(--font-plus-jakarta, 'Plus Jakarta Sans', sans-serif)",
                letterSpacing: '-0.025em',
                ...(phase === 'extended' ? { opacity: enOn ? 1 : 0 } : {}),
              }}>
              <span style={{ fontWeight: 300 }}>stay</span>
              <span style={{ fontWeight: 700, color: 'var(--persimmon, #a03c2e)' }}>eum</span>
            </span>
            <span className={`sy-intro-ko ${phase === 'extended' ? 'sy-intro-x' : ''} sy-intro-wm-ko absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap leading-none`}
              style={{
                letterSpacing: '-0.03em',
                ...(phase === 'extended' ? { opacity: koOn ? 1 : 0 } : {}),
              }}>
              <span style={{ fontWeight: 500 }}>스테이</span>
              <span style={{ fontWeight: 700, color: 'var(--persimmon, #a03c2e)' }}>음</span>
            </span>
          </div>
        </div>

        {net !== 'normal' && (
          <p className="text-[12.5px]" style={{
            marginTop: 24, color: 'var(--ink-s, #7A6553)',
            animation: 'sy-intro-caption 400ms ease forwards',
          }}>
            연결이 느립니다 — 계속 시도 중입니다
          </p>
        )}
        {net === 'stalled' && (
          <button type="button" onClick={() => window.location.reload()}
            className="mt-3 px-4 h-10 rounded-lg text-sm font-medium border transition-colors"
            style={{ borderColor: 'var(--border-s, rgba(61,36,24,.18))', color: 'var(--ink, #3d2418)' }}>
            다시 시도
          </button>
        )}
      </div>
    </div>
  )
}
