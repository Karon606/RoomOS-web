// 월세 영수증 작성 전용 레이아웃 — AppShell 밖 단독 페이지.
// confirm·토스트 호스트를 직접 마운트(없으면 발급 confirm 이 큐에만 쌓여 무반응).

import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import type { Metadata } from 'next'
import SaveFeedback from '@/components/feedback/SaveFeedback'

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
