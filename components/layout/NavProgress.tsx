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
      shallowRouting
    />
  )
}
