// 콜드 부트·셸 없는 세그먼트 전환의 로딩 폴백 — v2.0 §21 ①②.
// SplashStatic: 서버 스트리밍 구간(SSR 대기 = 하이드레이션 전이라 Host 가 못 덮는 구간)을
//   빈 배경 대신 정적 락업으로 채움 — 애니메이션 없음(루프 잔상 재발 방지), 300ms 지연 표시.
// SplashGate: SplashHost 에 시작/종료 신호 — 인트로·타이밍·크로스페이드는 Host 단일 주체.
import { SplashStatic } from '@/components/brand/SplashStatic'
import { SplashGate } from '@/components/brand/SplashController'

export default function RootLoading() {
  return (
    <>
      <SplashStatic />
      <SplashGate />
    </>
  )
}
