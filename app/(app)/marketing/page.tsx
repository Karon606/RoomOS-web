import { getMarketingStats } from './actions'
import MarketingClient from './MarketingClient'

export default async function MarketingPage() {
  const stats = await getMarketingStats()
  return <MarketingClient stats={stats} />
}
