import { getAllRentReceiptFiles, getIssuableTenants } from './actions'
import RentReceiptsClient from './RentReceiptsClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function RentReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { month } = await searchParams
  const [files, tenants] = await Promise.all([
    getAllRentReceiptFiles(),
    getIssuableTenants(),
  ])
  // month 는 발급 링크에만 전달 — 발급 이력은 월과 무관하게 전체를 보여준다.
  return <RentReceiptsClient files={files} tenants={tenants} month={month} />
}
