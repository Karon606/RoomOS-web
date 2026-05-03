import { getInventoryOverview } from './actions'
import InventoryClient from './InventoryClient'

export default async function InventoryPage() {
  const rows = await getInventoryOverview()
  return <InventoryClient initialRows={rows} />
}
