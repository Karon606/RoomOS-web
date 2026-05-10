import { getAllRequestsForProperty } from '@/app/(app)/tenants/actions'
import RequestsClient from './RequestsClient'

export default async function RequestsPage() {
  const requests = await getAllRequestsForProperty()
  return <RequestsClient initialRequests={requests} />
}
