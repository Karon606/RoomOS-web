import { getUnsettledExpenses, getSettledCardExpenses } from '../finance/actions'
import CardSettlementClient from './CardSettlementClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { resolveMonthParam } from '@/lib/monthParam'

// 카드 정산 — 기존 '지출/기타수익' 탭에서 분리한 독립 페이지(직관적 접근).
// 미정산은 항상 전체(월 무관, 아직 갚을 것). 정산 완료 내역만 선택한 달(청구월)로 한정 → 상단 월 전환.
export default async function CardSettlementPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { month } = await searchParams
  const targetMonth = resolveMonthParam(month)   // 기본 조회월은 KST · 잠긴 화면이라 미래 월은 이번 달로(lib/monthParam)
  const [unsettledExpenses, settledCardExpenses] = await Promise.all([
    getUnsettledExpenses(),
    getSettledCardExpenses(targetMonth),
  ])
  return (
    <CardSettlementClient
      unsettledExpenses={unsettledExpenses}
      settledCardExpenses={settledCardExpenses}
      targetMonth={targetMonth}
    />
  )
}
