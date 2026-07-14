import { getRoomPaymentStatus, getMonthPaymentAggregates } from './actions'
import { getExtraIncomes } from '@/app/(app)/finance/actions'
import { getIncomeCategories, getMyRole } from '@/app/(app)/settings/actions'
import { kstMonthStr } from '@/lib/kstDate'
import RoomsClient from './RoomsClient'

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  const { month, tab } = await searchParams
  // 기본 월은 KST 기준 — 서버 로컬(new Date, Vercel=UTC)이면 매월 1일 00:00-09:00 KST에 전월로 잡힘(적대검증 필수 4)
  const targetMonth = month ?? kstMonthStr()

  // 부가수익 — /finance에서 이동(2026-07-02). 과납분·보증금 미반환분 등 수납 파생 수익이라 수납 흐름 옆에.
  const [roomStatus, myRole, incomes, incomeCategories, payAggregates] = await Promise.all([
    getRoomPaymentStatus(targetMonth),
    getMyRole(),
    getExtraIncomes(targetMonth),
    getIncomeCategories(),
    getMonthPaymentAggregates(targetMonth),
  ])
  return (
    <RoomsClient
      roomStatus={roomStatus}
      targetMonth={targetMonth}
      myRole={myRole}
      incomes={incomes}
      incomeCategories={incomeCategories}
      payAggregates={payAggregates}
      initialTab={tab === 'income' ? 'income' : 'rooms'}
    />
  )
}
