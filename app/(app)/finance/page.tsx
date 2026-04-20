import { getExpenses, getExtraIncomes, getFinancialAccounts, getUnsettledExpenses, getSettledCardExpenses } from './actions'
import { getIncomeCategories } from '@/app/(app)/settings/actions'
import FinanceClient from './FinanceClient'

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const now = new Date()
  const targetMonth = month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [expenses, incomes, financialAccounts, unsettledExpenses, settledCardExpenses, incomeCategories] = await Promise.all([
    getExpenses(targetMonth),
    getExtraIncomes(targetMonth),
    getFinancialAccounts(),
    getUnsettledExpenses(),
    getSettledCardExpenses(targetMonth),
    getIncomeCategories(),
  ])

  return (
    <FinanceClient
      expenses={expenses}
      incomes={incomes}
      financialAccounts={financialAccounts}
      unsettledExpenses={unsettledExpenses}
      settledCardExpenses={settledCardExpenses}
      incomeCategories={incomeCategories}
      targetMonth={targetMonth}
    />
  )
}
