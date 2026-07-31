import { notFound } from 'next/navigation'
import { getRentReceiptData } from './actions'
import RentReceiptView from './RentReceiptView'

export default async function RentReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>
  searchParams: Promise<{ month?: string; kind?: string }>
}) {
  const { tenantId } = await params
  const { month, kind } = await searchParams
  // kind='deposit' 이면 보증금 영수증. 미지정·오타는 기존 입실료 확인서로 폴백(무회귀).
  const receiptKind = kind === 'deposit' ? 'deposit' : 'rent'
  const data = await getRentReceiptData(tenantId, month, receiptKind)
  if (!data) notFound()
  // key — 월·종류를 바꾸면 폼 useState 초기값이 새 자동값으로 다시 잡히도록 리마운트.
  return <RentReceiptView key={`${receiptKind}-${data.anchorMonth}`} data={data} />
}
