'use client'

// iOS 가상 키보드 대응 가드 — 두 가지를 한 구독처에서 처리한다.
//
// ① 키보드가 열려 있는 동안 — 셸 본문에 겹침만큼 아래 여백을 준다(--kbd-inset).
//    iOS 는 키보드가 떠도 layout viewport(dvh)를 줄이지 않는다. 셸은 h-dvh 고정이라
//    스크롤 여유가 1px 도 안 늘고, 하단 입력칸이 키보드 뒤에 깔린 채 손가락으로 꺼낼 수 없다
//    (신고 e1df22e9·395652b3 — 재고 실사 위치별 점검).
//    Modal 은 --modal-vvh 로 이미 보정하는데, 인라인 패널은 모달 껍데기를 벗어서 그 보정을 못 받는다.
//    **높이를 줄이지 않고 패딩을 더하는 이유** — 높이를 줄이면 --shell-content-h 를 쓰는
//    편집기류(도면)까지 파급된다. 패딩은 스크롤 여유만 늘리고 고정 요소를 안 건드린다.
//    안드로이드는 키보드가 layout viewport 를 함께 줄이므로 겹침이 0 으로 나와 이중 차감이 없다.
//
// ② 키보드가 닫힌 시점 — 잔존 오프셋 복원.
//    키보드가 배경을 밀어 올린 채 복원하지 않으면 화면에 보이는 위치와 터치 히트 판정이
//    세션 내내 어긋난다(신고 6c196aeb: 생년월일 탭이 국적을 염).
//    이 앱은 셸이 h-dvh overflow-hidden + app-main 내부 스크롤이라 window.scrollY 는 항상 0 이 정상.
//    레이아웃 무접점(모달 body 고정 방식은 상·하단 바가 밀리는 회귀를 냈다 — 신고 d4cf82d5 교훈).
//
// 키보드 열림 판정을 여기 한 곳에 둔다. 두 곳에 생기면 한쪽만 참인 구간에서
// 패딩과 스크롤 복원이 어긋난다.
//
// 제약(knowledge/mobile-scroll-viewport.md) — 이 컴포넌트를 루트 layout 으로 승격하지 말 것.
// B 패턴(문서 스크롤) 페이지들이 맨 위로 튄다. app/(app)/layout.tsx 에만 둔다.
import { useEffect } from 'react'

// 셸 본문이 읽는 키보드 겹침 값. 기본 0px 이라 키보드가 없는 동안 레이아웃이 종전과 완전히 같다.
const KBD_INSET = '--kbd-inset'

export default function ViewportOffsetGuard() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const root = document.documentElement
    const sync = () => {
      // offsetTop 을 함께 빼야 한다 — iOS 가 visual viewport 를 팬한 만큼 과대 계산되는 것을 막는다
      const overlap = Math.max(0, Math.round(window.innerHeight - (vv.height + vv.offsetTop)))
      const keyboardOpen = overlap > 60
      root.style.setProperty(KBD_INSET, keyboardOpen ? `${overlap}px` : '0px')
      if (keyboardOpen) return
      if (window.scrollY !== 0 || vv.offsetTop > 0) window.scrollTo(0, 0)
    }
    vv.addEventListener('resize', sync)
    vv.addEventListener('scroll', sync)
    return () => {
      vv.removeEventListener('resize', sync)
      vv.removeEventListener('scroll', sync)
      root.style.removeProperty(KBD_INSET)
    }
  }, [])
  return null
}
