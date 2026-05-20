// 인라인 로딩 인디케이터 — 모달·패널 안 데이터 로딩 중 표시
// 전체 페이지 로딩은 app/(app)/loading.tsx, 최초 진입은 app/loading.tsx (SplashScreen)
//
// Brand Guide v1.2 — Arch line-draw 모션 (BrandLoader size="sm")

import { BrandLoader } from '@/components/brand/BrandLoader'

export function Loading({ py = 8 }: { py?: number }) {
  return (
    <div
      className="flex items-center justify-center"
      style={{ paddingTop: `${py * 0.25}rem`, paddingBottom: `${py * 0.25}rem` }}
    >
      <BrandLoader size="sm" />
    </div>
  )
}
