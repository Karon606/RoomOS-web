// 월세 영수증 작성 전용 레이아웃 — AppShell 밖 단독 페이지.
// confirm·토스트 호스트를 직접 마운트(없으면 발급 confirm 이 큐에만 쌓여 무반응).

import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import type { Metadata, Viewport } from 'next'
import SaveFeedback from '@/components/feedback/SaveFeedback'

// 서류는 작은 글씨를 확대해 읽어야 한다. 루트 layout 의 userScalable:false / maximumScale:1 을
// 이 라우트에서만 되돌린다. viewport 는 필드 단위 얕은 병합이라 여기서 안 적은 값은 루트가 그대로 남는다.
//
// **이 선언만으로는 아이폰 홈화면 앱의 확대가 풀리지 않는다.** 그 표시 모드는 선언을 존중하지만
// 사용자 확대 자체를 주지 않는다. 반대로 사파리·안드로이드 크롬은 접근성 때문에 확대 금지를 무시해
// 이 선언이 없어도 확대된다. 그러니 이건 데스크톱과 접근성을 위한 올바른 선언이지 확대 문제의 해답이 아니다.
// 확대의 정본은 뷰어(/doc)의 자체 확대다(실기 확정 2026-08-04).
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

export default function RentReceiptLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ConfirmHost />
      <SaveFeedback />
    </>
  )
}
