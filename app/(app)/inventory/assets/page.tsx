import { getDurableItems, getAssignableRooms, getAssignableLocations } from './actions'
import AssetsClient from './AssetsClient'
import { resolveMonthParam } from '@/lib/monthParam'

export default async function InventoryAssetsPage({ searchParams }: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = resolveMonthParam(month)   // 잠긴 화면 — 미래 월은 이번 달로(lib/monthParam)
  const [data, rooms, locations] = await Promise.all([
    getDurableItems(), getAssignableRooms(), getAssignableLocations(),
  ])
  return <AssetsClient data={data} rooms={rooms} locations={locations} targetMonth={targetMonth} />
}
