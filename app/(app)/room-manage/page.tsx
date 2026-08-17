import { getRooms, applyScheduledRents, getMoveCalendarRange } from './actions'
import { getPropertyCleanings, getRecentCleaningPerformers } from './cleaningActions'
import { getRoomTypeOptions, getRoomTierOptions, getWindowTypeOptions, getRoomDirectionOptions } from '@/app/(app)/settings/actions'
import { kstMonthStr } from '@/lib/kstDate'
import RoomManageClient from './RoomManageClient'

// 사진 업로드(Google Drive) Server Action이 같은 라우트의 페이지 timeout 따름 → 60초로 확장
export const maxDuration = 60

export default async function RoomManagePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  await applyScheduledRents()

  // 입퇴실 뷰가 보고 있는 달 — MonthSelector 가 ?month= 로 적어 넣는다(수납·재고와 같은 문법).
  // 연속 뷰에서는 조회 창이 아니라 **착지 지점**이다. 범위는 데이터가 정하고, 이 달은 그 안
  // 어디에 내려앉을지를 말한다(범위 밖이면 그쪽으로 범위가 늘어난다 — getMoveCalendarRange).
  // 기본은 KST 이번 달. 서버 로컬(Vercel=UTC)로 잡으면 매월 1일 00~09시 KST 에 전월을 본다.
  const { month, tab } = await searchParams
  const targetMonth = month ?? kstMonthStr()

  // 청소 뷰(2026-08-12) — 영업장 전체 청소 이력. 청소 처리가 revalidatePath('/room-manage') 를 부르므로
  // 모달에서 완료·삭제해도 이 목록이 따라온다(카드 배지와 같은 갱신 경로).
  const [rooms, cleanings, performers, roomTypes, roomTiers, windowTypes, directions, moveCalendar] = await Promise.all([
    getRooms(),
    getPropertyCleanings(),
    // 완료 폼 이름 칸 선택지 — 여기서 받아 두면 목록 행마다 클라 왕복이 없다.
    getRecentCleaningPerformers(),
    getRoomTypeOptions(),
    getRoomTierOptions(),
    getWindowTypeOptions(),
    getRoomDirectionOptions(),
    // 입퇴실 뷰(2026-08-17) — 탭 접미 N 도 이 한 벌이 딛는다. 조회 셋뿐이라 다른 탭에서도 함께 받는다.
    getMoveCalendarRange(targetMonth),
  ])
  return <RoomManageClient initialRooms={rooms} initialCleanings={cleanings} recentPerformers={performers} roomTypes={roomTypes} roomTiers={roomTiers} windowTypes={windowTypes} directions={directions}
    moveCalendar={moveCalendar} initialTab={tab === 'cleaning' || tab === 'moves' ? tab : 'rooms'} />
}
