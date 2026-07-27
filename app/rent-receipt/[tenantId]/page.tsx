import { notFound } from 'next/navigation'
import { getRentReceiptData } from './actions'
import RentReceiptView from './RentReceiptView'

export default async function RentReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ month?: string }>
}) {
  const { tenantId } = await params
  const { month } = await searchParams
  const data = await getRentReceiptData(tenantId, month)
  if (!data) notFound()
  // key — 월을 바꾸면 폼 useState 초기값이 새 자동값으로 다시 잡히도록 리마운트.
  return <RentReceiptView key={data.anchorMonth} data={data} />
}
