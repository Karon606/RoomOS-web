import { getAllRequestsForProperty, getActiveTenantsForRequests } from '@/app/(app)/tenants/actions'
import RequestsClient from './RequestsClient'

// 요청·컴플레인 — 미처리(open)는 월 무관 활성 큐로 항상 노출, 처리됨은 선택한 달에 해결된 것만(월 전환).
export default async function RequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const now = new Date()
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [requests, tenants] = await Promise.all([
    getAllRequestsForProperty(),
    getActiveTenantsForRequests(),
  ])
  return <RequestsClient initialRequests={requests} activeTenants={tenants} targetMonth={targetMonth} />
}
