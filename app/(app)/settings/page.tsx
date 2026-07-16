import { getPropertySettings, getMembers, getMyRole, getContractSettings } from './actions'
import { getJoinCode, listJoinRequests } from './memberActions'
import SettingsForm from './SettingsForm'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'

export default async function SettingsPage() {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const [property, members, myRole, contractSettings, joinCode, joinRequests] = await Promise.all([
    getPropertySettings(),
    getMembers(),
    getMyRole(),
    getContractSettings(),
    getJoinCode(),
    listJoinRequests(),
  ])
  return (
    <SettingsForm
      property={property}
      members={members}
      myRole={myRole}
      contractSettings={contractSettings}
      initialJoinCode={joinCode}
      initialJoinRequests={joinRequests}
    />
  )
}
