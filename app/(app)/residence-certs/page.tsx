import { getAllResidenceCertFiles, getIssuableTenants } from './actions'
import ResidenceCertClient from './ResidenceCertClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function ResidenceCertsPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const [files, tenants] = await Promise.all([
    getAllResidenceCertFiles(),
    getIssuableTenants(),
  ])
  return <ResidenceCertClient files={files} tenants={tenants} />
}
