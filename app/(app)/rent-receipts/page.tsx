import { getAllRentReceiptFiles, getIssuableTenants } from './actions'
import RentReceiptsClient from './RentReceiptsClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function RentReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; kind?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { month, kind } = await searchParams
  // 보증금 탭이면 발급 대상에 예약 확정도 포함(보증금은 입주 전에 받는다)
  const receiptKind = kind === 'deposit' ? 'deposit' : 'rent'
  const [files, tenants] = await Promise.all([
    getAllRentReceiptFiles(),
    getIssuableTenants(receiptKind),
  ])
  // month 는 발급 링크에만 전달 — 발급 이력은 월과 무관하게 전체를 보여준다.
  return <RentReceiptsClient files={files} tenants={tenants} month={month} kind={receiptKind} />
}
