import { getInventoryOverview, getInventoryCategorySettings } from './actions'
import InventoryClient from './InventoryClient'
import { resolveMonthParam } from '@/lib/monthParam'

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = resolveMonthParam(month)   // 잠긴 화면 — 미래 월은 이번 달로(lib/monthParam)
  const [rows, catSettings] = await Promise.all([
    getInventoryOverview(),
    getInventoryCategorySettings(),
  ])
  return (
    <InventoryClient
      initialRows={rows}
      targetMonth={targetMonth}
      categories={catSettings.categories}
      allExpenseCategories={catSettings.allExpenseCategories}
    />
  )
}
