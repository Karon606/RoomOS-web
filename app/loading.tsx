import { SplashScreen } from '@/components/brand/SplashScreen'

// 루트 레벨 loading.tsx — 첫 진입(cold start, 모바일 백그라운드 복귀 등)
// 시점부터 표시되는 풀스크린 스플래시. (app)/loading.tsx 와 동일 컴포넌트 사용.
export default function RootLoading() {
  return <SplashScreen />
}
