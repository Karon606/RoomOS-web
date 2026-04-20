import { getTenants, getRoomsForSelect } from './actions'
import { getPropertySettings, getMyRole } from '@/app/(app)/settings/actions'
import TenantClient from './TenantClient'

export default async function TenantsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const now = new Date()
  const targetMonth = month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [tenants, rooms, settings, myRole] = await Promise.all([
    getTenants(),
    getRoomsForSelect(),
    getPropertySettings(),
    getMyRole(),
  ])
  return (
    <TenantClient
      initialTenants={tenants}
      rooms={rooms}
      targetMonth={targetMonth}
      defaultDeposit={settings?.defaultDeposit ?? null}
      defaultCleaningFee={settings?.defaultCleaningFee ?? null}
      myRole={myRole}
    />
  )
}
