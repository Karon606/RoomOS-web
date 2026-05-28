import { getPropertySettings, getMembers, getMyRole, getContractSettings } from './actions'
import { getJoinCode, listJoinRequests } from './memberActions'
import SettingsForm from './SettingsForm'

export default async function SettingsPage() {
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
