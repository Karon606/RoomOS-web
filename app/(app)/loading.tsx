// 페이지 이동 중 콘텐츠 영역에 표시되는 가벼운 로더.
// AppShell(사이드바·헤더)은 그대로 유지되고 본문 영역만 잠깐 로딩 상태가 된다.
// 전체 화면 SplashScreen은 앱 최초 진입(app/loading.tsx)에만 사용.
//
// Brand Guide v1.2 — Arch line-draw 모션 (BrandLoader size="sm")
import { BrandLoader } from '@/components/brand/BrandLoader'

export default function AppLoading() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]" aria-busy="true" aria-label="불러오는 중">
      <BrandLoader size="md" />
    </div>
  )
}
