import { getExpenses, getExtraIncomes, getFinancialAccounts, getRecurringExpensesWithStatus, getRoomList, getExpenseCategoryTotals, getExpenseDetailSuggestions, getExpenseVendorSuggestions, getReserveBalance, getReserveMonthlySummary, getReserveTransactions, getSettleableExpenses, getDepositSummaryByTenant, getDepositLedger, getTrackedCategories, getLastPayDefaults } from './actions'
import { getIncomeCategories, getExpenseCategories, getPaymentMethods, getPropertySettings } from '@/app/(app)/settings/actions'
import FinanceClient from './FinanceClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { kstMonthStr } from '@/lib/kstDate'

// 'income'(부가 수익)은 2026-07-02 수납관리(/rooms?tab=income)로 이동 — 여기선 더 이상 유효 탭 아님.
type FinTab = 'expense' | 'assets' | 'deposit' | 'reserve'

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { month, tab } = await searchParams
  const initialTab: FinTab | undefined =
    tab === 'expense' || tab === 'assets' || tab === 'deposit' || tab === 'reserve'
      ? tab
      : undefined
  const targetMonth = month ?? kstMonthStr()   // 기본 조회월은 KST — 서버(UTC) 로컬이면 매월 1일 KST 00~09 시에 지난달이 열린다

  const [y, m] = targetMonth.split('-').map(Number)
  const prevMonthDate = new Date(y, m - 2, 1)
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`
  const lastYearMonth = `${y - 1}-${String(m).padStart(2, '0')}`

  const [expenses, incomes, financialAccounts, incomeCategories, expenseCategories, paymentMethods, recurringExpensesWithStatus, rooms, prevMonthTotals, lastYearTotals, propertySettings, detailSuggestions, vendorSuggestions, reserveBalance, reserveMonthly, reserveTxns, settleableExpenses, depositSummary, depositLedger, trackedCategories, lastPayDefaults] = await Promise.all([
    getExpenses(targetMonth),
    getExtraIncomes(targetMonth),
    getFinancialAccounts(),
    getIncomeCategories(),
    getExpenseCategories(),
    getPaymentMethods(),
    getRecurringExpensesWithStatus(targetMonth),
    getRoomList(),
    getExpenseCategoryTotals(prevMonth),
    getExpenseCategoryTotals(lastYearMonth),
    getPropertySettings(),
    getExpenseDetailSuggestions(),
    getExpenseVendorSuggestions(),
    getReserveBalance(),
    getReserveMonthlySummary(targetMonth),
    getReserveTransactions(targetMonth),
    getSettleableExpenses(targetMonth),
    getDepositSummaryByTenant(),
    getDepositLedger(),
    getTrackedCategories(),
    getLastPayDefaults(),
  ])

  const acquisitionDate = propertySettings?.acquisitionDate
    ? propertySettings.acquisitionDate.toISOString().slice(0, 10)
    : null

  return (
    <FinanceClient
      expenses={expenses}
      incomes={incomes}
      financialAccounts={financialAccounts}
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
      vendorSuggestions={vendorSuggestions}
      reserveBalance={reserveBalance}
      reserveMonthly={reserveMonthly}
      reserveTxns={reserveTxns}
      settleableExpenses={settleableExpenses}
      lastPayDefaults={lastPayDefaults}
      depositSummary={depositSummary}
      depositLedger={depositLedger}
      trackedCategories={trackedCategories}
      initialTab={initialTab}
    />
  )
}
