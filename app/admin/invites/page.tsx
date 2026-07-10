import { getInviteCodes } from '../actions'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import InvitesClient from './InvitesClient'


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
