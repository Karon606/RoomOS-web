import { getChecklists } from './actions'
import ChecklistClient from './ChecklistClient'

export default async function ChecklistPage() {
  const rows = await getChecklists()
  return <ChecklistClient initialRows={rows} />
}
