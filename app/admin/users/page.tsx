import { getSignups } from '../actions'
import UsersClient from './UsersClient'

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export default async function AdminUsersPage() {
  const users = await getSignups()

  const rows = users.map((u) => ({
    id: u.id,
    email: u.email,
    name: u.realName || u.name || '—',
    phone: u.phone || '',
    address: u.address || '',
    status: u.status as 'PENDING' | 'APPROVED' | 'REJECTED',
    isSuperAdmin: u.isSuperAdmin,
    inviteCode: u.inviteCode || '',
    createdAtLabel: fmtDate(u.createdAt),
    ownedCount: u._count.ownedProperties,
    roleCount: u._count.propertyRoles,
  }))

  const pendingCount = rows.filter((r) => r.status === 'PENDING').length

  return <UsersClient rows={rows} pendingCount={pendingCount} />
}
