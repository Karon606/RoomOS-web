import { getRooms, applyScheduledRents } from './actions'
import { getPropertyCleanings, getRecentCleaningPerformers } from './cleaningActions'
import { getRoomTypeOptions, getRoomTierOptions, getWindowTypeOptions, getRoomDirectionOptions } from '@/app/(app)/settings/actions'
import RoomManageClient from './RoomManageClient'

// 사진 업로드(Google Drive) Server Action이 같은 라우트의 페이지 timeout 따름 → 60초로 확장
export const maxDuration = 60

export default async function RoomManagePage() {
  await applyScheduledRents()

  // 청소 뷰(2026-08-12) — 영업장 전체 청소 이력. 청소 처리가 revalidatePath('/room-manage') 를 부르므로
  // 모달에서 완료·삭제해도 이 목록이 따라온다(카드 배지와 같은 갱신 경로).
  const [rooms, cleanings, performers, roomTypes, roomTiers, windowTypes, directions] = await Promise.all([
    getRooms(),
    getPropertyCleanings(),
    // 완료 폼 이름 칸 선택지 — 여기서 받아 두면 목록 행마다 클라 왕복이 없다.
    getRecentCleaningPerformers(),
    getRoomTypeOptions(),
    getRoomTierOptions(),
    getWindowTypeOptions(),
    getRoomDirectionOptions(),
  ])
  return <RoomManageClient initialRooms={rooms} initialCleanings={cleanings} recentPerformers={performers} roomTypes={roomTypes} roomTiers={roomTiers} windowTypes={windowTypes} directions={directions} />
}