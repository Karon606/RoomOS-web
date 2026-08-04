// 실거주 확인서 작성 전용 레이아웃 — AppShell 없이 단독 페이지.
// (app)/layout 밖이라 확인 다이얼로그·토스트 호스트를 직접 마운트해야
// '발급할까요?' confirm 과 성공/오류 토스트가 이 페이지에서 바로 뜬다.
// (없으면 confirmDialog 가 큐에만 쌓여 무반응 → 다른 페이지에서 뒤늦게 뜨던 버그)

import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import type { Metadata, Viewport } from 'next'
import SaveFeedback from '@/components/feedback/SaveFeedback'

// 서류는 작은 글씨를 확대해 읽어야 한다. 루트 layout 의 userScalable:false / maximumScale:1 을
// 이 라우트에서만 되돌린다. viewport 는 필드 단위 얕은 병합이라 여기서 안 적은 값은 루트가 그대로 남는다.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
}

// 서류 페이지는 검색엔진에 절대 노출 금지 — 성명·생년월일·금액·서명이 담긴다.
// /sign 에만 있고 이 셋에는 빠져 있었다(E페이즈 2026-08-03).
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

export default function ResidenceCertLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ConfirmHost />
      <SaveFeedback />
    </>
  )
}
