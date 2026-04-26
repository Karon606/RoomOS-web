import { getRooms, applyScheduledRents } from './actions'
import { getRoomTypeOptions, getWindowTypeOptions, getRoomDirectionOptions } from '@/app/(app)/settings/actions'
import RoomManageClient from './RoomManageClient'

export default async function RoomManagePage() {
  await applyScheduledRents()

  const [rooms, roomTypes, windowTypes, directions] = await Promise.all([
    getRooms(),
    getRoomTypeOptions(),
    getWindowTypeOptions(),
    getRoomDirectionOptions(),
  ])
  return <RoomManageClient initialRooms={rooms} roomTypes={roomTypes} windowTypes={windowTypes} directions={directions} />
}