import { getExpenses, getFinancialAccounts, getRecurringExpensesWithStatus, getRoomList, getExpenseCategoryTotals, getExpenseDetailSuggestions, getExpenseVendorSuggestions, getReserveBalance, getReserveMonthlySummary, getReserveTransactions, getSettleableExpenses, getTrackedCategories, getLastPayDefaults } from './actions'
import { getIncomeCategories, getExpenseCategories, getPaymentMethods, getPropertySettings } from '@/app/(app)/settings/actions'
import FinanceClient from './FinanceClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { kstMonthStr } from '@/lib/kstDate'

// 영수증 OCR·업로드 Server Action 이 같은 라우트의 페이지 timeout 을 따름 → 60초로 확장(room-manage 와 같은 처방).
// OCR 은 스스로 30초에 끊고 안내 문구를 돌려주는데, 플랫폼 기본 한도가 그보다 짧으면 그 문구 대신 함수가 먼저 죽는다.
export const maxDuration = 60

// 'income'(부가 수익)은 2026-07-02, 'deposit'(보증금)은 2026-08-12 수납관리(/rooms?tab=…)로 이동 —
// 여기선 더 이상 유효 탭 아니다.
type FinTab = 'expense' | 'assets' | 'reserve'

export default async function FinancePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string; cat?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  // cat = 지출 목록 카테고리 필터 초기값. 홈 지출 도넛의 '지출 관리에서 전체 보기'가 실어 보낸다 —
  // 조각을 눌러 상위 5건까지 본 사람이 전체를 보러 올 때, 도착해서 필터를 다시 고르게 하지 않는다.
  const { month, tab, cat } = await searchParams
  const initialTab: FinTab | undefined =
    tab === 'expense' || tab === 'assets' || tab === 'reserve'
      ? tab
      : undefined
  const targetMonth = month ?? kstMonthStr()   // 기본 조회월은 KST — 서버(UTC) 로컬이면 매월 1일 KST 00~09 시에 지난달이 열린다

  const [y, m] = targetMonth.split('-').map(Number)
  const prevMonthDate = new Date(y, m - 2, 1)
  const prevMonth = `${prevMonthDate.getFullYear()}-${String(prevMonthDate.getMonth() + 1).padStart(2, '0')}`
  const lastYearMonth = `${y - 1}-${String(m).padStart(2, '0')}`

  const [expenses, financialAccounts, incomeCategories, expenseCategories, paymentMethods, recurringExpensesWithStatus, rooms, prevMonthTotals, lastYearTotals, propertySettings, detailSuggestions, vendorSuggestions, reserveBalance, reserveMonthly, reserveTxns, settleableExpenses, trackedCategories, lastPayDefaults] = await Promise.all([
    getExpenses(targetMonth),
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
    getTrackedCategories(),
    getLastPayDefaults(),
  ])

  const acquisitionDate = propertySettings?.acquisitionDate
    ? propertySettings.acquisitionDate.toISOString().slice(0, 10)
    : null

  return (
    <FinanceClient
      expenses={expenses}
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
      trackedCategories={trackedCategories}
      initialTab={initialTab}
      initialCategory={cat && cat.trim() ? cat.trim() : undefined}
    />
  )
}
