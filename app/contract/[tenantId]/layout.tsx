// 계약서 출력 전용 레이아웃 — AppShell 없이 단독 페이지로 렌더한다.
// (app)/layout 하위가 아닌 위치에 두어 사이드바·하단 네비를 자동으로 제외.

import { ConfirmHost } from '@/components/ui/ConfirmDialog'

export default function ContractLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {children}
      {/* AppShell 밖이므로 확인 다이얼로그 호스트를 직접 마운트 */}
      <ConfirmHost />
    </>
  )
}
