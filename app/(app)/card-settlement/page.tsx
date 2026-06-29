import { getUnsettledExpenses, getSettledCardExpenses } from '../finance/actions'
import CardSettlementClient from './CardSettlementClient'

// 카드 정산 — 기존 '지출/기타수익' 탭에서 분리한 독립 페이지(직관적 접근).
// 월 한정이 아님: 미정산은 전체, 정산 완료는 최근 4개월(getSettledCardExpenses 기본).
export default async function CardSettlementPage() {
  const now = new Date()
  const targetMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const [unsettledExpenses, settledCardExpenses] = await Promise.all([
    getUnsettledExpenses(),
    getSettledCardExpenses(targetMonth),
  ])
  return (
    <CardSettlementClient
      unsettledExpenses={unsettledExpenses}
      settledCardExpenses={settledCardExpenses}
    />
  )
}
