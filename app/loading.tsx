// 콜드 부트·셸 없는 세그먼트 전환의 로딩 폴백 — §18.1 ①②.
// 시각 요소 없음: 표시(인트로/스플래시·타이밍·크로스페이드)는 SplashHost(루트 레이아웃 상주)가
// 전담하고, 여기는 시작/종료 신호만 보낸다. 이전엔 여기서 루프 스플래시를 직접 렌더해
// 하이드레이션 직전 구형 로더가 깜빡이고(껌뻑) Host 인트로와 이중으로 보였음.
// 하이드레이션 전 화면은 §18.4 FOUC 인라인 CSS(html 배경 #E8DDD0)가 커버한다.
import { SplashGate } from '@/components/brand/SplashController'

export default function RootLoading() {
  return <SplashGate />
}
