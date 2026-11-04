import { getSignups } from '../actions'
import { requireSuperAdmin } from '@/lib/auth/access'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { isStaleSignup, providerLabel, type AccessStatus } from '@/lib/adminAccess'
import UsersClient from './UsersClient'


export default async function AdminUsersPage() {
  const me = await requireSuperAdmin()
  const { users, propertyCount, myProperties, authMetaOk } = await getSignups()
  const now = new Date()

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.realName || u.name || '',   // 비면 화면이 이메일을 식별자로 올린다('—' 금지, §29)
    phone: u.phone || '',
    address: u.address || '',
    status: u.status as AccessStatus,
    isSuperAdmin: u.isSuperAdmin,
    envAdmin: u.envAdmin,
    isSelf: u.id === me.userId,
    inviteCode: u.inviteCode || '',
    createdAtLabel: fmtDate(u.createdAt),
    ownedCount: u._count.ownedProperties,
    roleCount: u._count.propertyRoles,
    providerLabel: providerLabel(u.provider),
    lastSignInLabel: u.lastSignInAt ? fmtDate(u.lastSignInAt) : '',
    archived: !!u.archivedAt,
    // 오래된 계정 정리 후보(화면 버튼·확인창 건수). 서버가 쓸 때 같은 정본으로 다시 센다.
    // 최근 접속을 못 읽었으면 후보를 세우지 않는다(서버도 정리를 거부한다, 독립 검수 R3)
    stale: authMetaOk && isStaleSignup({
      status: u.status as AccessStatus, dbAdmin: u.isSuperAdmin, envAdmin: u.envAdmin, isSelf: u.id === me.userId,
      ownedCount: u._count.ownedProperties, roleCount: u._count.propertyRoles, archived: !!u.archivedAt,
      lastActiveAt: u.lastSignInAt ?? u.createdAt,
    }, now),
  }))

  const pendingCount = rows.filter((r) => r.status === 'PENDING' && !r.archived && !r.isSuperAdmin && !r.envAdmin).length

  return <UsersClient rows={rows} pendingCount={pendingCount} propertyCount={propertyCount} myProperties={myProperties} />
}
