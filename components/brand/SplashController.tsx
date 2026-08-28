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
// 리디렉트 체인(/ → /login → 앱) 사이의 off→on 신호 갭을 '계속 로딩 중'으로 잇는 유예.
// 없으면 홉마다 인트로가 퇴장하고 일반 스플래시가 재발동해 끝에 루프 로더 잔상이 깜빡인다.
const OFF_GRACE = 400

// 인트로 게이트 — '마지막 활동 이후 공백' 기준 (sessionStorage 세션 게이트 대체).
// iOS Safari/PWA 는 앱을 껐다 켜도 탭을 세션째 복원해 sessionStorage 가 살아남음 →
// 재접속인데 인트로가 생략되던 문제(2026-06-12 사용자 보고). 공백 기준이면:
//   새로고침·인앱 전체 네비(공백 ~2s) → 생략(연타 지루함 방지, §3b-2 목적 동일)
//   OAuth 복귀 → 명시 마커로 생략 / 앱 종료 후 재접속(공백 10s+) → 항상 재생
const LAST_ACTIVE_KEY = 'sy-last-active'     // localStorage — 하트비트(아래)
const OAUTH_INFLIGHT_KEY = 'sy-oauth-inflight'
const RELAUNCH_GAP = 10_000                  // 이보다 오래 비활성 후의 로드 = 재접속

let hostListener: ((on: boolean) => void) | null = null
let lastSignal = false

function signal(on: boolean) {
  lastSignal = on
  hostListener?.(on)
}

// 인증 리디렉트로 떠나기 직전 호출 — 복귀 로드는 재접속이 아니므로 인트로 생략 마커
export function markAuthRedirect() {
  try { localStorage.setItem(OAUTH_INFLIGHT_KEY, '1') } catch { /* ignore */ }
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
  // 정적 스플래시(loading.tsx)가 이미 획을 그렸으면 인트로는 재드로잉 생략 (두 번 그어짐 방지)
  const [introSkip, setIntroSkip] = useState(false)
  const phaseRef = useRef<Phase>('off')
  const introRef = useRef(false)
  const shownAt = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])
  /**
   * 예약된 퇴장의 **벽시계 마감**. 0 이면 예약 없음.
   *
   * 퇴장이 서로 다른 두 시계 위에 있었다. setTimeout 은 백그라운드에서 늦춰지고 CSS transition 은
   * 문서 애니메이션 타임라인째로 정지한다. 둘의 재개 시점이 400ms 페이드 창 안에서 갈리면
   * 오버레이가 중간 불투명도로 얼어붙어 화면을 크림색 막으로 덮는다(운영자 실측 2026-08-28,
   * "나갔다 돌아오거나 잠깐 기다리면 원래대로 돌아온다" — 막이 걷히는 시간 = 페이지 시계가
   * 멈춰 있던 시간이다). 남은 시간으로 재면 그 어긋남을 되물을 수 없지만, 마감 시각으로 재면
   * 돌아온 첫 프레임에 "이미 지났는가"를 한 번 물어 씻을 수 있다.
   */
  const exitAt = useRef(0)
  // 이 로드에서 인트로를 재생할 자격 — 마운트 시 1회 판정(하트비트 기록 전), 재생하면 소진
  const shouldPlayIntroOnce = useRef(false)

  useEffect(() => {
    const go = (p: Phase) => { phaseRef.current = p; setPhase(p) }
    const clear = () => { timers.current.forEach(clearTimeout); timers.current = []; exitAt.current = 0 }
    const touch = () => { try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())) } catch { /* ignore */ } }
    // 재접속 판정 — 마지막 활동 공백 > GAP 이면 인트로. OAuth 왕복은 마커로 제외.
    const shouldPlayIntro = () => {
      try {
        if (localStorage.getItem(OAUTH_INFLIGHT_KEY)) {
          localStorage.removeItem(OAUTH_INFLIGHT_KEY)
          return false
        }
        const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0)
        return !last || Date.now() - last > RELAUNCH_GAP
      } catch { return false }
    }
    const introSeen = () => !shouldPlayIntroOnce.current
    const markIntroSeen = () => { shouldPlayIntroOnce.current = false }
    const reducedMotion = () =>
      typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    // 정적 스플래시가 이 로드에서 떴는가 — 파싱 시점 인라인 스크립트가 심은 플래그(SplashStatic)
    const staticShown = () =>
      typeof window !== 'undefined' && !!(window as { __sySplashStatic?: number }).__sySplashStatic

    // 퇴장은 한 곳에서만 시작한다 — 두 자리에 흩어져 있으면 마감 기록이 한쪽에서만 선다.
    const runExit = () => {
      exitAt.current = 0
      go('fading')
      timers.current.push(setTimeout(() => go('off'), FADE))
    }
    const scheduleExit = (wait: number) => {
      exitAt.current = Date.now() + wait
      timers.current.push(setTimeout(runExit, wait))
    }
    /**
     * 돌아온 첫 프레임의 재동기 — 이 저장소가 이미 쓰는 문법이다(Modal·ViewportOffsetGuard).
     *
     * 아직 로딩 신호가 살아 있으면 아무것도 안 한다. 리디렉트 갭을 잇는 OFF_GRACE 규약이
     * 그 위에 서 있어서, 여기서 손대면 홉마다 스플래시가 깜빡인다.
     * 백그라운드에 있는 동안 완주 시각이 지나간 연출은 복귀 즉시 정리한다 — 아무도 못 본
     * 3.2초를 돌아온 사람에게 다시 재생하지 않는다.
     */
    const reconcile = () => {
      if (document.visibilityState !== 'visible') return
      if (lastSignal) return
      if (phaseRef.current === 'fading') { clear(); go('off'); return }
      if (phaseRef.current === 'visible' && exitAt.current && Date.now() >= exitAt.current) {
        clear(); runExit()
      }
    }

    // 판정은 하트비트가 기록을 덮기 전에 1회만
    shouldPlayIntroOnce.current = shouldPlayIntro()
    // 활동 하트비트 — 가시성 변화·페이지 이탈·20s 주기로 갱신. 마지막 기록 = 떠난 시각.
    touch()
    const onVis = () => { touch(); reconcile() }
    document.addEventListener('visibilitychange', onVis)
    window.addEventListener('pagehide', onVis)
    // bfcache 복원은 visibilitychange 없이 오기도 한다 — 그 경로가 정확히 이 결함이 사는 자리다.
    window.addEventListener('pageshow', reconcile)
    const beat = setInterval(() => { if (document.visibilityState === 'visible') touch() }, 20_000)

    hostListener = (on) => {
      if (on && phaseRef.current === 'visible') {
        // 표시 중(인트로·일반 공통) 새 로딩 신호 — 표시 유지, 예약된 퇴장만 취소.
        // 리디렉트 갭을 이어 부트 체인 전체를 한 번의 스플래시로 커버한다.
        clear()
        return
      }
      clear()
      if (on) {
        if (!introSeen()) {
          // §3b 인트로 — 즉시 표시(지연 규칙 미적용), 재생 시작 시점에 세션 게이트 기록
          markIntroSeen()
          introRef.current = true; setIntroMode(true); setIntroSkip(staticShown())
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
        // 일반: 최소 유지 1000ms. + OFF_GRACE — 리디렉트 갭 동안 on 신호가 돌아오면 위 가드가 취소.
        const hold = introRef.current ? (reducedMotion() ? 0 : INTRO) : MIN
        const wait = Math.max(OFF_GRACE, hold - (Date.now() - shownAt.current))
        scheduleExit(wait)
      }
    }
    // 콜드 부트 자가 발동 — 서버가 페이지를 suspend 없이 즉시 렌더하면 loading.tsx(Gate)가
    // 아예 마운트되지 않아 신호만 기다려선 인트로가 영영 안 뜬다. 세션 첫 하이드레이션 시
    // Host 가 스스로 인트로를 재생하고, 진행 중 로딩(Gate 신호)이 없으면 3200ms 완주 후 퇴장.
    if (!introSeen()) {
      markIntroSeen()
      introRef.current = true; setIntroMode(true); setIntroSkip(staticShown())
      shownAt.current = Date.now()
      go('visible')
      if (!lastSignal) {
        scheduleExit(reducedMotion() ? 0 : INTRO)
      }
      // lastSignal === true 면 Gate 의 off 신호가 INTRO 완주 기준으로 퇴장 처리
    } else if (lastSignal) {
      hostListener(true)
    }
    return () => {
      hostListener = null; clear()
      document.removeEventListener('visibilitychange', onVis)
      window.removeEventListener('pagehide', onVis)
      window.removeEventListener('pageshow', reconcile)
      clearInterval(beat)
    }
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
      {introMode ? <SplashIntro skipDraw={introSkip} /> : <SplashScreen immediate />}
    </div>
  )
}
