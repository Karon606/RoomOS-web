import { getDurableItems, getAssignableRooms } from './actions'
import AssetsClient from './AssetsClient'

export default async function InventoryAssetsPage() {
  const [data, rooms] = await Promise.all([getDurableItems(), getAssignableRooms()])
  return <AssetsClient data={data} rooms={rooms} />
}
