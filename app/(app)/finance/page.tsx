import { getExpenses, getExtraIncomes, getFinancialAccounts, getUnsettledExpenses, getSettledCardExpenses, getRecurringExpensesWithStatus, getRoomList } from './actions'
import { getIncomeCategories, getExpenseCategories, getPaymentMethods } from '@/app/(app)/settings/actions'
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

  const [expenses, incomes, financialAccounts, unsettledExpenses, settledCardExpenses, incomeCategories, expenseCategories, paymentMethods, recurringExpensesWithStatus, rooms] = await Promise.all([
    getExpenses(targetMonth),
    getExtraIncomes(targetMonth),
    getFinancialAccounts(),
    getUnsettledExpenses(),
    getSettledCardExpenses(targetMonth),
    getIncomeCategories(),
    getExpenseCategories(),
    getPaymentMethods(),
    getRecurringExpensesWithStatus(targetMonth),
    getRoomList(),
  ])

  return (
    <FinanceClient
      expenses={expenses}
      incomes={incomes}
      financialAccounts={financialAccounts}
      unsettledExpenses={unsettledExpenses}
      settledCardExpenses={settledCardExpenses}
      incomeCategories={incomeCategories}
      expenseCategories={expenseCategories}
      paymentMethods={paymentMethods}
      targetMonth={targetMonth}
      recurringExpensesWithStatus={recurringExpensesWithStatus}
      rooms={rooms}
    />
  )
}
