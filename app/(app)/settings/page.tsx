import { getPropertySettings, getMembers, getMyRole, getContractSettings } from './actions'
import SettingsForm from './SettingsForm'

export default async function SettingsPage() {
  const [property, members, myRole, contractSettings] = await Promise.all([
    getPropertySettings(),
    getMembers(),
    getMyRole(),
    getContractSettings(),
  ])
  return <SettingsForm property={property} members={members} myRole={myRole} contractSettings={contractSettings} />
}
