import { getAllRequestsForProperty, getActiveTenantsForRequests } from '@/app/(app)/tenants/actions'
import { getRequestCategories } from '@/app/(app)/settings/actions'
import RequestsClient from './RequestsClient'
import { resolveMonthParam } from '@/lib/monthParam'

// 요청·컴플레인 — 미처리(open)는 월 무관 활성 큐로 항상 노출, 처리됨은 선택한 달에 해결된 것만(월 전환).
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = resolveMonthParam(month)   // 기본 조회월은 KST · 잠긴 화면이라 미래 월은 이번 달로(lib/monthParam)
  const [requests, tenants, categories] = await Promise.all([
    getAllRequestsForProperty(),
    getActiveTenantsForRequests(),
    getRequestCategories(),
  ])
  return <RequestsClient initialRequests={requests} activeTenants={tenants} targetMonth={targetMonth} categories={categories} />
}
