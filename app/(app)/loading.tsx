import { SplashScreen } from '@/components/brand/SplashScreen'

// (app) 그룹 레벨 loading.tsx — 라우트 그룹 안에서 page fetch 동안 표시.
// 루트 loading.tsx 와 동일 컴포넌트 사용 → 시각·위치 일관.
export default function AppLoading() {
  return <SplashScreen />
}
