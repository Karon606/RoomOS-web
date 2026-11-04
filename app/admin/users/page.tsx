import { getSignups } from '../actions'
import { requireSuperAdmin } from '@/lib/auth/access'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import UsersClient from './UsersClient'


export default async function AdminUsersPage() {
  const me = await requireSuperAdmin()
  const { users, propertyCount } = await getSignups()

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.realName || u.name || '—',
    phone: u.phone || '',
    address: u.address || '',
    status: u.status as 'PENDING' | 'APPROVED' | 'REJECTED',
    isSuperAdmin: u.isSuperAdmin,
    envAdmin: u.envAdmin,
    isSelf: u.id === me.userId,
    inviteCode: u.inviteCode || '',
    createdAtLabel: fmtDate(u.createdAt),
    ownedCount: u._count.ownedProperties,
    roleCount: u._count.propertyRoles,
  }))

  const pendingCount = rows.filter((r) => r.status === 'PENDING').length

  return <UsersClient rows={rows} pendingCount={pendingCount} propertyCount={propertyCount} />
}
