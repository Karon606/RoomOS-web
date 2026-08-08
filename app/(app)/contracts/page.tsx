import { getAllContractFiles, getPendingIssueContracts } from './actions'
import ContractsClient from './ContractsClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function ContractsPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const [contracts, pending] = await Promise.all([getAllContractFiles(), getPendingIssueContracts()])
  return <ContractsClient contracts={contracts} pending={pending} />
}
