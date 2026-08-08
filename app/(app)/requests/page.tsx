import { getAllRequestsForProperty, getActiveTenantsForRequests } from '@/app/(app)/tenants/actions'
import { getRequestCategories } from '@/app/(app)/settings/actions'
import RequestsClient from './RequestsClient'
import { kstMonthStr } from '@/lib/kstDate'

// 요청·컴플레인 — 미처리(open)는 월 무관 활성 큐로 항상 노출, 처리됨은 선택한 달에 해결된 것만(월 전환).
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = month ?? kstMonthStr()   // 기본 조회월은 KST — 서버(UTC) 로컬이면 매월 1일 KST 00~09 시에 지난달이 열린다
  const [requests, tenants, categories] = await Promise.all([
    getAllRequestsForProperty(),
    getActiveTenantsForRequests(),
    getRequestCategories(),
  ])
  return <RequestsClient initialRequests={requests} activeTenants={tenants} targetMonth={targetMonth} categories={categories} />
}
