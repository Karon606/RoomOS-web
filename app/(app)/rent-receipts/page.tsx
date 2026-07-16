import { getAllRentReceiptFiles, getIssuableTenants } from './actions'
import RentReceiptsClient from './RentReceiptsClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function RentReceiptsPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const [files, tenants] = await Promise.all([
    getAllRentReceiptFiles(),
    getIssuableTenants(),
  ])
  return <RentReceiptsClient files={files} tenants={tenants} />
}
