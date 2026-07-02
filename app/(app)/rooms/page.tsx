import { getRoomPaymentStatus } from './actions'
import { getExtraIncomes } from '@/app/(app)/finance/actions'
import { getIncomeCategories, getMyRole } from '@/app/(app)/settings/actions'
import RoomsClient from './RoomsClient'

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  const { month, tab } = await searchParams
  const now = new Date()
  const targetMonth = month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // 부가수익 — /finance에서 이동(2026-07-02). 과납분·보증금 미반환분 등 수납 파생 수익이라 수납 흐름 옆에.
  const [roomStatus, myRole, incomes, incomeCategories] = await Promise.all([
    getRoomPaymentStatus(targetMonth),
    getMyRole(),
    getExtraIncomes(targetMonth),
    getIncomeCategories(),
  ])
  return (
    <RoomsClient
      roomStatus={roomStatus}
      targetMonth={targetMonth}
      myRole={myRole}
      incomes={incomes}
      incomeCategories={incomeCategories}
      initialTab={tab === 'income' ? 'income' : 'rooms'}
    />
  )
}
