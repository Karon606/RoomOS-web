'use client'

import { usePathname } from 'next/navigation'
import { ViewTabs } from '@/components/ui/ViewTabs'

// 관리자 페이지 링크 탭(§25 링크 탭 = ViewTabs 외형 + href). 종전 코랄 채움 알약은 §25·§03 위반이라 걷었다(2026-11-04).
// '가입자' 접미는 '대기 N'(0이면 붙이지 않는다, 빈 괄호 금지). 전체 수와 헷갈리지 않게 뜻을 붙인다(독립 디자이너 검수). 수는 정본 countPendingSignups.
const TABS = [
  { id: 'users', href: '/admin/users', label: '가입자' },
  { id: 'properties', href: '/admin/properties', label: '영업장' },
  { id: 'invites', href: '/admin/invites', label: '초대코드' },
] as const

export default function AdminNav({ pendingCount }: { pendingCount: number }) {
  const pathname = usePathname()
  const active = TABS.find(t => pathname === t.href || pathname.startsWith(t.href + '/'))?.id ?? 'users'
  return (
    <ViewTabs
      ariaLabel="스테이음 관리자 화면"
      activeId={active}
      tabs={TABS.map(t => ({
        id: t.id,
        href: t.href,
        label: t.label,
        ...(t.id === 'users' && pendingCount > 0 ? { suffix: `대기 ${pendingCount}` } : {}),
      }))}
    />
  )
}
