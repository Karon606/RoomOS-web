// 계약서 출력 전용 레이아웃 — AppShell 없이 단독 페이지로 렌더한다.
// (app)/layout 하위가 아닌 위치에 두어 사이드바·하단 네비를 자동으로 제외.

import type { Viewport } from 'next'
import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import SaveFeedback from '@/components/feedback/SaveFeedback'

// 계약서·잔여소지품 동의서는 서명 전 작은 글씨를 확대해 봐야 하므로 핀치줌 허용.
// 루트 layout 의 userScalable:false / maximumScale:1 을 이 라우트에서만 override (하위 세그먼트 우선).
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#E8DDD0' },
    { media: '(prefers-color-scheme: dark)', color: '#000000' },
  ],
  viewportFit: 'cover',
}

export default function ContractLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* AppShell 밖이므로 확인 다이얼로그·토스트 호스트를 직접 마운트 */}
      <ConfirmHost />
      <SaveFeedback />
    </>
  )
}
