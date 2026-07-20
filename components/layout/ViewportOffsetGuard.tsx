'use client'

// iOS 가상 키보드 잔존 오프셋 복원 가드 — 키보드가 배경을 밀어 올린 채 복원하지 않으면
// 화면에 보이는 위치와 터치 히트 판정이 세션 내내 어긋난다(신고 6c196aeb: 생년월일 탭이 국적을 염).
// 이 앱은 셸이 h-dvh overflow-hidden + app-main 내부 스크롤이라 window.scrollY는 항상 0이 정상 —
// 키보드가 닫힌 시점에 잔존 오프셋이 있으면 0으로 복원한다. 레이아웃 무접점(모달 body 고정 방식은
// 상·하단 바가 밀리는 회귀를 냈다 — 신고 d4cf82d5 교훈). 키보드가 열려 있는 동안(뷰포트 축소 중)은
// iOS가 입력을 보이려 스크롤한 정상 동작이라 개입하지 않는다.
import { useEffect } from 'react'

export default function ViewportOffsetGuard() {
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    const restore = () => {
      const keyboardOpen = window.innerHeight - vv.height > 60
      if (keyboardOpen) return
      if (window.scrollY !== 0 || vv.offsetTop > 0) window.scrollTo(0, 0)
    }
    vv.addEventListener('resize', restore)
    vv.addEventListener('scroll', restore)
    return () => {
      vv.removeEventListener('resize', restore)
      vv.removeEventListener('scroll', restore)
    }
  }, [])
  return null
}
