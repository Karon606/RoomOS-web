'use client'

// 스플래시 수명주기 컨트롤러 — Brand Guide v1.3 §18.3·18.2 퇴장.
// Next 의 loading.tsx 는 콘텐츠 준비 즉시 언마운트되어 '최소 유지 1000ms'와
// '퇴장 크로스페이드 400ms'를 스스로 지킬 수 없다 → 신호(pub/sub)와 표시를 분리:
//   · SplashGate — 루트 loading.tsx 가 렌더. 마운트=로딩 시작, 언마운트=콘텐츠 준비 신호만 보냄.
//   · SplashHost — 루트 레이아웃에 상주. 신호를 받아 표시 지연(300ms)·최소 유지(1000ms)·
//     페이드아웃(400ms)을 관리. 콘텐츠가 아래에 먼저 렌더된 뒤 위에서 사라지므로
//     빈 화면 프레임 없는 크로스페이드가 된다.
// 수치는 globals.css 토큰(--loader-delay/--loader-min/--splash-fade)과 동기 — 한쪽 수정 시 함께.

import { useEffect, useRef, useState } from 'react'
import { SplashScreen } from './SplashScreen'

const DELAY = 300   // --loader-delay
const MIN = 1000    // --loader-min
const FADE = 400    // --splash-fade

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
  const phaseRef = useRef<Phase>('off')
  const shownAt = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const go = (p: Phase) => { phaseRef.current = p; setPhase(p) }
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = [] }

    hostListener = (on) => {
      clear()
      if (on) {
        // 표시 지연 — 300ms 안에 끝나는 로딩에선 한 프레임도 안 보임
        go('pending')
        timers.current.push(setTimeout(() => {
          shownAt.current = Date.now()
          go('visible')
        }, DELAY))
      } else {
        if (phaseRef.current === 'pending' || phaseRef.current === 'off') { go('off'); return }
        // 최소 유지 — 보였으면 1000ms 채운 뒤 400ms 페이드아웃 (사이클 완주는 기다리지 않음)
        const wait = Math.max(0, MIN - (Date.now() - shownAt.current))
        timers.current.push(setTimeout(() => {
          go('fading')
          timers.current.push(setTimeout(() => go('off'), FADE))
        }, wait))
      }
    }
    if (lastSignal) hostListener(true)
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
      <SplashScreen immediate />
    </div>
  )
}
