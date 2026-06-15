import { getAllResidenceCertFiles, getIssuableTenants } from './actions'
import ResidenceCertClient from './ResidenceCertClient'

export default async function ResidenceCertsPage() {
  const [files, tenants] = await Promise.all([
    getAllResidenceCertFiles(),
    getIssuableTenants(),
  ])
  return <ResidenceCertClient files={files} tenants={tenants} />
}
