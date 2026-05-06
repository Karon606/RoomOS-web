import { getExpenses, getExtraIncomes, getFinancialAccounts, getUnsettledExpenses, getSettledCardExpenses, getRecurringExpensesWithStatus, getRoomList, getExpenseCategoryTotals, getExpenseDetailSuggestions, getReserveBalance, getReserveMonthlySummary, getReserveTransactions, getSettleableExpenses, getDepositSummaryByTenant, getDepositLedger } from './actions'
import { getIncomeCategories, getExpenseCategories, getPaymentMethods, getPropertySettings } from '@/app/(app)/settings/actions'
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

  const [y, m] = targetMonth.split('-').map(Number)
  const prevMonthDate = new Date(y, m - 2, 1)
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`
  const lastYearMonth = `${y - 1}-${String(m).padStart(2, '0')}`

  const [expenses, incomes, financialAccounts, unsettledExpenses, settledCardExpenses, incomeCategories, expenseCategories, paymentMethods, recurringExpensesWithStatus, rooms, prevMonthTotals, lastYearTotals, propertySettings, detailSuggestions, reserveBalance, reserveMonthly, reserveTxns, settleableExpenses, depositSummary, depositLedger] = await Promise.all([
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
    getExpenseCategoryTotals(prevMonth),
    getExpenseCategoryTotals(lastYearMonth),
    getPropertySettings(),
    getExpenseDetailSuggestions(),
    getReserveBalance(),
    getReserveMonthlySummary(targetMonth),
    getReserveTransactions(targetMonth),
    getSettleableExpenses(targetMonth),
    getDepositSummaryByTenant(),
    getDepositLedger(),
  ])

  const acquisitionDate = propertySettings?.acquisitionDate
    ? propertySettings.acquisitionDate.toISOString().slice(0, 10)
    : null

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
      prevMonth={prevMonth}
      prevMonthTotals={prevMonthTotals}
      lastYearMonth={lastYearMonth}
      lastYearTotals={lastYearTotals}
      acquisitionDate={acquisitionDate}
      detailSuggestions={detailSuggestions}
      reserveBalance={reserveBalance}
      reserveMonthly={reserveMonthly}
      reserveTxns={reserveTxns}
      settleableExpenses={settleableExpenses}
      depositSummary={depositSummary}
      depositLedger={depositLedger}
    />
  )
}
