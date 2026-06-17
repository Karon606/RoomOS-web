import { getDurableItems, getAssignableRooms, getAssignableLocations } from './actions'
import AssetsClient from './AssetsClient'

export default async function InventoryAssetsPage() {
  const [data, rooms, locations] = await Promise.all([
    getDurableItems(), getAssignableRooms(), getAssignableLocations(),
  ])
  return <AssetsClient data={data} rooms={rooms} locations={locations} />
}
