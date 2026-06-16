import { notFound } from 'next/navigation'
import { getRentReceiptData } from './actions'
import RentReceiptView from './RentReceiptView'

export default async function RentReceiptPage({
  params,
}: {
  params: Promise<{ tenantId: string }>
}) {
  const { tenantId } = await params
  const data = await getRentReceiptData(tenantId)
  if (!data) notFound()
  return <RentReceiptView data={data} />
}
