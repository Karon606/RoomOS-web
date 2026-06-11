// 스플래시 스크린 — Brand Guide v1.2 (Arch line-draw + 워드마크 EN/KO 교차)
//
// 배경: var(--canvas)  → 라이트=Page 톤, 다크=거의 검정 (모드 자동 대응)
// 모션은 BrandLoader 컴포넌트에 위임 — 3.2s 사이클, ×2 사이클마다 워드마크 교차.

import { BrandLoader } from './BrandLoader'

export function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-[var(--z-loader)] flex items-center justify-center"
      style={{ background: 'var(--canvas, #e8ddd0)', color: 'var(--ink, #3d2418)' }}
      aria-busy="true"
      aria-label="스테이음 로딩 중"
    >
      <BrandLoader size="lg" />
    </div>
  )
}
