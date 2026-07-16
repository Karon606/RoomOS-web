import { getMarketingStats } from './actions'
import MarketingClient from './MarketingClient'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function MarketingPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const initialStats = await getMarketingStats('30d')
  return <MarketingClient initialStats={initialStats} />
}
