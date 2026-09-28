// 로그인 전 공개 화면 묶음(첫 화면·운영 가이드·글 모음·공지)의 공통 틀 — 상단 바와 푸터
//
// 광고 자리는 이 묶음에만 둔다. 앱 안 화면에는 입주자 개인정보가 있어 바깥 스크립트를 붙이지 않는다.

import DocumentScroll from '@/components/layout/DocumentScroll'
import { PortalHeader } from '@/components/portal/PortalHeader'
import { PortalFooter } from '@/components/portal/PortalFooter'

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-dvh break-keep bg-[var(--canvas)] text-[var(--ink)] tabular-nums">
      <DocumentScroll />
      <PortalHeader />
      {children}
      <PortalFooter />
    </div>
  )
}
