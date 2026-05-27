import { getInviteCodes } from '../actions'
import InvitesClient from './InvitesClient'

const fmtDate = (d: Date) =>
  new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)

export default async function AdminInvitesPage() {
  const codes = await getInviteCodes()

  const rows = codes.map((c) => ({
    id: c.id,
    code: c.code,
    note: c.note || '',
    maxUses: c.maxUses,
    usedCount: c.usedCount,
    autoApprove: c.autoApprove,
    isActive: c.isActive,
    expiresAtLabel: c.expiresAt ? fmtDate(c.expiresAt) : '',
    expired: c.expiresAt ? c.expiresAt < new Date() : false,
    createdAtLabel: fmtDate(c.createdAt),
  }))

  return <InvitesClient rows={rows} />
}
