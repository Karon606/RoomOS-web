import { getRooms, applyScheduledRents } from './actions'
import { getRoomTypeOptions, getWindowTypeOptions } from '@/app/(app)/settings/actions'
import RoomManageClient from './RoomManageClient'

export default async function RoomManagePage() {
  await applyScheduledRents()

  const [rooms, roomTypes, windowTypes] = await Promise.all([
    getRooms(),
    getRoomTypeOptions(),
    getWindowTypeOptions(),
  ])
  return <RoomManageClient initialRooms={rooms} roomTypes={roomTypes} windowTypes={windowTypes} />
}