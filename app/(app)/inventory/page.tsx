import { getInventoryOverview, getInventoryCategorySettings } from './actions'
import InventoryClient from './InventoryClient'
import { kstMonthStr } from '@/lib/kstDate'

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = month ?? kstMonthStr()
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
