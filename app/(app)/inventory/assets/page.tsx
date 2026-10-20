import { getDurableItems, getAssignableRooms, getAssignableLocations, getStorageLocations } from './actions'
import AssetsClient from './AssetsClient'
import { resolveMonthParam } from '@/lib/monthParam'

export default async function InventoryAssetsPage({ searchParams }: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const targetMonth = resolveMonthParam(month)   // 잠긴 화면 — 미래 월은 이번 달로(lib/monthParam)
  // storages = 보관 위치 후보(그 영업장 위치 전부, 기본 창고 먼저). 공용부 배정 후보(locations, 기본 창고 제외)와 다른 목록이다.
  const [data, rooms, locations, storages] = await Promise.all([
    getDurableItems(), getAssignableRooms(), getAssignableLocations(), getStorageLocations(),
  ])
  return <AssetsClient data={data} rooms={rooms} locations={locations} storages={storages} targetMonth={targetMonth} />
}
