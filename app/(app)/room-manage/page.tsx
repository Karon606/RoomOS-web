import { getRooms, applyScheduledRents } from './actions'
import { getRoomTypeOptions, getWindowTypeOptions, getRoomDirectionOptions } from '@/app/(app)/settings/actions'
import RoomManageClient from './RoomManageClient'

// 사진 업로드(Google Drive) Server Action이 같은 라우트의 페이지 timeout 따름 → 60초로 확장
export const maxDuration = 60

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