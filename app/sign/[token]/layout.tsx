// 계약서 원격 서명 레이아웃 — AppShell 없이 단독 렌더 + 검색엔진 색인 차단(noindex).
// app/contract/[tenantId]/layout.tsx 를 본뜸 — (app) 그룹 밖이라 사이드바·하단 네비 자동 제외.

import type { Metadata, Viewport } from 'next'
import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import SaveFeedback from '@/components/feedback/SaveFeedback'

// 공유 링크는 검색엔진에 절대 노출 금지 — robots 메타(noindex, nofollow) 출력
export const metadata: Metadata = {
  robots: { index: false, follow: false },
}

// 계약서 작은 글씨 확대용 핀치줌 허용 (계약서 출력 레이아웃과 동일)
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

export default function SignLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* AppShell 밖이므로 확인 다이얼로그·토스트 호스트를 직접 마운트 */}
      <ConfirmHost />
      <SaveFeedback />
    </>
  )
}
