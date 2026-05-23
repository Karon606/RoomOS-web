import { getAllContractFiles } from './actions'
import ContractsClient from './ContractsClient'

export default async function ContractsPage() {
  const contracts = await getAllContractFiles()
  return <ContractsClient contracts={contracts} />
}
