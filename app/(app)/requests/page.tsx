import { getAllRequestsForProperty, getActiveTenantsForRequests } from '@/app/(app)/tenants/actions'
import RequestsClient from './RequestsClient'

export default async function RequestsPage() {
  const [requests, tenants] = await Promise.all([
    getAllRequestsForProperty(),
    getActiveTenantsForRequests(),
  ])
  return <RequestsClient initialRequests={requests} activeTenants={tenants} />
}
