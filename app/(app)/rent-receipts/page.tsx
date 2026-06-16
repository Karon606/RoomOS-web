import { getAllRentReceiptFiles, getIssuableTenants } from './actions'
import RentReceiptsClient from './RentReceiptsClient'

export default async function RentReceiptsPage() {
  const [files, tenants] = await Promise.all([
    getAllRentReceiptFiles(),
    getIssuableTenants(),
  ])
  return <RentReceiptsClient files={files} tenants={tenants} />
}
