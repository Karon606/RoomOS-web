import { getDurableItems, getAssignableRooms, getAssignableLocations } from './actions'
import AssetsClient from './AssetsClient'
import { kstMonthStr } from '@/lib/kstDate'

export default async function InventoryAssetsPage({ searchParams }: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = month ?? kstMonthStr()
  const [data, rooms, locations] = await Promise.all([
    getDurableItems(), getAssignableRooms(), getAssignableLocations(),
  ])
  return <AssetsClient data={data} rooms={rooms} locations={locations} targetMonth={targetMonth} />
}
