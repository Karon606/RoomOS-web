import { getAllRentReceiptFiles, getIssuableTenants } from './actions'
import RentReceiptsClient from './RentReceiptsClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { resolveMonthParam } from '@/lib/monthParam'

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
  // 링크에 실리는 달은 화면 상단 월 셀렉터가 말하는 달과 같아야 한다. 잠긴 화면이라
  // 미래 월 URL 은 이번 달로 읽히므로, 발급 대상월도 같은 자를 쓴다(lib/monthParam).
  // 없을 때는 없는 채로 넘긴다 — 링크에 달을 새로 얹으면 서류의 청구 주기 앵커가 바뀐다.
  return <RentReceiptsClient files={files} tenants={tenants} month={month ? resolveMonthParam(month) : undefined} kind={receiptKind} />
}
