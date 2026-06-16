// 월세 영수증 작성 전용 레이아웃 — AppShell 밖 단독 페이지.
// confirm·토스트 호스트를 직접 마운트(없으면 발급 confirm 이 큐에만 쌓여 무반응).

import { ConfirmHost } from '@/components/ui/ConfirmDialog'
import SaveFeedback from '@/components/feedback/SaveFeedback'

export default function RentReceiptLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      <ConfirmHost />
      <SaveFeedback />
    </>
  )
}
