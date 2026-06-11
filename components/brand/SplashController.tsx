'use client'

// 스플래시 수명주기 컨트롤러 — Brand Guide v1.3.1 §3b·§4.
// Next 의 loading.tsx 는 콘텐츠 준비 즉시 언마운트되어 수명주기를 스스로 못 지킨다 →
// 신호(pub/sub)와 표시를 분리:
//   · SplashGate — 루트 loading.tsx 가 렌더. 마운트=로딩 시작, 언마운트=콘텐츠 준비 신호만.
//   · SplashHost — 루트 레이아웃에 상주. 두 모드:
//     [인트로 모드] 세션 첫 스플래시(sessionStorage 'sy-intro-seen' 없음) — §3b 1회성 인트로.
//       즉시 표시(지연 없음), 앱이 먼저 준비돼도 3200ms 완주 보장 후 400ms 크로스페이드.
//       표시 지연·최소 유지 규칙 미적용(§3b-1, 유일한 예외). reduced-motion 은 완주 대기 없음.
//     [일반 모드] 같은 세션 재발동 — 표시 지연 300ms → 보였으면 1000ms 유지 → 400ms 페이드.
// 수치는 globals.css 토큰(--loader-delay/--loader-min/--splash-intro/--splash-fade)과 동기.

import { useEffect, useRef, useState } from 'react'
import { SplashScreen } from './SplashScreen'
import { SplashIntro } from './SplashIntro'

const DELAY = 300    // --loader-delay
const MIN = 1000     // --loader-min
const INTRO = 3200   // --splash-intro
const FADE = 400     // --splash-fade

const INTRO_SEEN_KEY = 'sy-intro-seen'   // sessionStorage — 새 세션(새 탭·재방문)에선 다시 재생

let hostListener: ((on: boolean) => void) | null = null
let lastSignal = false

function signal(on: boolean) {
  lastSignal = on
  hostListener?.(on)
}

// 루트 loading.tsx 전용 — 시각 요소 없음, 신호만.
export function SplashGate() {
  useEffect(() => {
    signal(true)
    return () => signal(false)
  }, [])
  return null
}

type Phase = 'off' | 'pending' | 'visible' | 'fading'

export function SplashHost() {
  const [phase, setPhase] = useState<Phase>('off')
  const [introMode, setIntroMode] = useState(false)
  const phaseRef = useRef<Phase>('off')
  const introRef = useRef(false)
  const shownAt = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const go = (p: Phase) => { phaseRef.current = p; setPhase(p) }
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }
    const introSeen = () => {
      try { return !!sessionStorage.getItem(INTRO_SEEN_KEY) } catch { return true }
    }
    const markIntroSeen = () => { try { sessionStorage.setItem(INTRO_SEEN_KEY, '1') } catch { /* ignore */ } }
    const reducedMotion = () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

    hostListener = (on) => {
      if (on && introRef.current && phaseRef.current === 'visible') {
        // 인트로 재생 중 새 로딩 신호 — 인트로 유지, 예약된 자가 퇴장만 취소
        // (퇴장은 off 신호가 INTRO 완주 기준으로 처리)
        clear()
        return
      }
      clear()
      if (on) {
        if (!introSeen()) {
          // §3b 인트로 — 즉시 표시(지연 규칙 미적용), 재생 시작 시점에 세션 게이트 기록
          markIntroSeen()
          introRef.current = true; setIntroMode(true)
          shownAt.current = Date.now()
          go('visible')
        } else {
          introRef.current = false; setIntroMode(false)
          go('pending')
          timers.current.push(setTimeout(() => {
            shownAt.current = Date.now()
            go('visible')
          }, DELAY))
        }
      } else {
        if (phaseRef.current === 'pending' || phaseRef.current === 'off') { go('off'); return }
        // 인트로: 3200ms 완주 보장 (reduced-motion 은 정적 락업이라 대기 없이 즉시 크로스페이드)
        // 일반: 최소 유지 1000ms
        const hold = introRef.current ? (reducedMotion() ? 0 : INTRO) : MIN
        const wait = Math.max(0, hold - (Date.now() - shownAt.current))
        timers.current.push(setTimeout(() => {
          go('fading')
          timers.current.push(setTimeout(() => go('off'), FADE))
        }, wait))
      }
    }
    // 콜드 부트 자가 발동 — 서버가 페이지를 suspend 없이 즉시 렌더하면 loading.tsx(Gate)가
    // 아예 마운트되지 않아 신호만 기다려선 인트로가 영영 안 뜬다. 세션 첫 하이드레이션 시
    // Host 가 스스로 인트로를 재생하고, 진행 중 로딩(Gate 신호)이 없으면 3200ms 완주 후 퇴장.
    if (!introSeen()) {
      markIntroSeen()
      introRef.current = true; setIntroMode(true)
      shownAt.current = Date.now()
      go('visible')
      if (!lastSignal) {
        const hold = reducedMotion() ? 0 : INTRO
        timers.current.push(setTimeout(() => {
          go('fading')
          timers.current.push(setTimeout(() => go('off'), FADE))
        }, hold))
      }
      // lastSignal === true 면 Gate 의 off 신호가 INTRO 완주 기준으로 퇴장 처리
    } else if (lastSignal) {
      hostListener(true)
    }
    return () => { hostListener = null; clear() }
  }, [])

  if (phase === 'off' || phase === 'pending') return null
  return (
    <div
      className="fixed inset-0 z-[var(--z-loader)]"
      style={{
        transition: `opacity ${FADE}ms ease`,
        opacity: phase === 'fading' ? 0 : 1,
        pointerEvents: phase === 'fading' ? 'none' : 'auto',
      }}
    >
      {introMode ? <SplashIntro /> : <SplashScreen immediate />}
    </div>
  )
}
