import { getPropertySettings, getMembers, getMyRole } from './actions'
import SettingsForm from './SettingsForm'

export default async function SettingsPage() {
  const [property, members, myRole] = await Promise.all([
    getPropertySettings(),
    getMembers(),
    getMyRole(),
  ])
  return <SettingsForm property={property} members={members} myRole={myRole} />
}
