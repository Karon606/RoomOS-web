// 콜드 부트·셸 없는 세그먼트 전환의 로딩 폴백 — §18.1 ①②.
// SplashScreen: 하이드레이션 전에도 보이는 서버 렌더 스플래시 (느린 연결 대비).
// SplashGate: SplashHost(루트 레이아웃 상주)에 시작/종료 신호 — 최소 유지 1000ms 와
//   400ms 크로스페이드는 Host 가 담당 (이 파일은 콘텐츠 준비 즉시 언마운트되므로).
//   Host 오버레이가 동일 비주얼로 위를 덮고 있어 이 컴포넌트의 즉시 언마운트는 보이지 않는다.
import { SplashScreen } from '@/components/brand/SplashScreen'
import { SplashGate } from '@/components/brand/SplashController'

export default function RootLoading() {
  return (
    <>
      <SplashScreen />
      <SplashGate />
    </>
  )
}
