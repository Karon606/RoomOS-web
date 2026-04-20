import { getRoomPaymentStatus } from './actions'
import { getMyRole } from '@/app/(app)/settings/actions'
import RoomsClient from './RoomsClient'

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>
}) {
  const { month } = await searchParams
  const now = new Date()
  const targetMonth = month ??
    `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const [roomStatus, myRole] = await Promise.all([
    getRoomPaymentStatus(targetMonth),
    getMyRole(),
  ])
  return <RoomsClient roomStatus={roomStatus} targetMonth={targetMonth} myRole={myRole} />
}
