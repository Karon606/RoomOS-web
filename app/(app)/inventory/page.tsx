import { getInventoryOverview } from './actions'
import InventoryClient from './InventoryClient'
import { kstMonthStr } from '@/lib/kstDate'

export default async function InventoryPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = month ?? kstMonthStr()
  const rows = await getInventoryOverview()
  return <InventoryClient initialRows={rows} targetMonth={targetMonth} />
}
