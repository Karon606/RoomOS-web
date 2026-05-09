import { notFound } from 'next/navigation'
import { getContractData } from './actions'
import ContractView from './ContractView'

export default async function ContractPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const data = await getContractData(tenantId)
  if (!data) notFound()
  return <ContractView data={data} />
}
