import { notFound } from 'next/navigation'
import { getResidenceCertData } from './actions'
import ResidenceCertView from './ResidenceCertView'

export default async function ResidenceCertPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const data = await getResidenceCertData(tenantId)
  if (!data) notFound()
  return <ResidenceCertView data={data} />
}
