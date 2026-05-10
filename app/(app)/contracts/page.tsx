import { getAllContractsForProperty } from '@/app/(app)/tenants/actions'
import ContractsClient from './ContractsClient'

export default async function ContractsPage() {
  const contracts = await getAllContractsForProperty()
  return <ContractsClient initialContracts={contracts} />
}
