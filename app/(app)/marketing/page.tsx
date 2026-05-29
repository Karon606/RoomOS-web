import { getMarketingStats } from './actions'
import MarketingClient from './MarketingClient'

export default async function MarketingPage() {
  const initialStats = await getMarketingStats('30d')
  return <MarketingClient initialStats={initialStats} />
}
