import { getPropertySettings, getMembers, getMyRole, getContractSettings } from './actions'
import { getJoinCode, listJoinRequests } from './memberActions'
import SettingsForm from './SettingsForm'
import { isSettingsTab, type SettingsTab } from './tabs'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import { listSiteRoomCandidates } from '@/lib/siteCandidates'

export default async function SettingsPage({
  searchParams,
}: {
  // 홈의 '소개 페이지 반영 대기 N건' 링크가 ?tab=website 로 들어온다(호실 관리 initialTab 과 같은 문법).
  searchParams: Promise<{ tab?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { propertyId } = await requirePropertyAccess()
  const { tab } = await searchParams
  const [property, members, myRole, contractSettings, joinCode, joinRequests, siteCandidates] = await Promise.all([
    getPropertySettings(),
    getMembers(),
    getMyRole(),
    getContractSettings(),
    getJoinCode(),
    listJoinRequests(),
    // 웹사이트 탭의 '소개 페이지 반영 대기' 목록 — 홈이 세는 건수와 같은 한 벌(lib/siteCandidates).
    // 마운트 후 액션으로 다시 받지 않는다. 토글하면 revalidatePath + router.refresh 로 이 값이 갱신된다.
    listSiteRoomCandidates(propertyId),
  ])
  return (
    <SettingsForm
      property={property}
      members={members}
      myRole={myRole}
      contractSettings={contractSettings}
      initialJoinCode={joinCode}
      initialJoinRequests={joinRequests}
      siteCandidates={siteCandidates}
      initialTab={isSettingsTab(tab) ? (tab as SettingsTab) : undefined}
    />
  )
}
