'use client'

import { AppProgressBar } from 'next-nprogress-bar'

// 페이지 이동 시 화면 최상단에 표시되는 얇은 진행 바.
// 풀스크린 스플래시 대신 가벼운 이동 피드백을 제공한다.
export default function NavProgress() {
  return (
    <AppProgressBar
      height="3px"
      color="var(--tc, #A03C2E)"
      options={{ showSpinner: false }}
      // 같은 주소의 쿼리 변경(월 전환·탭·필터)도 표시한다 — 기본값(true)이면 그 구간은
      // 스켈레톤도 진행바도 없는 완전 무표시가 된다(F페이즈). 진행바가 0~300ms 즉시 층을 맡는다.
      disableSameURL={false}
      shallowRouting={false}
    />
  )
}
