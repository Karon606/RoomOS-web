import { getRooms, applyScheduledRents, getMoveCalendarRange } from './actions'
import { getPropertyCleanings, getRecentCleaningPerformers } from './cleaningActions'
import { getRoomTypeOptions, getRoomTierOptions, getWindowTypeOptions, getRoomDirectionOptions } from '@/app/(app)/settings/actions'
import { resolveTrackMonth } from '@/lib/monthParam'
import RoomManageClient from './RoomManageClient'

// 사진 업로드(Google Drive) Server Action이 같은 라우트의 페이지 timeout 따름 → 60초로 확장
export const maxDuration = 60

export default async function RoomManagePage({
  searchParams,
}: {
  searchParams: Promise<{ at?: string; month?: string; tab?: string }>
}) {
  await applyScheduledRents()

  // 입퇴실 뷰가 보고 있는 달 — 캘린더 전용 키 ?at= 이 정본이고, 없으면 ?month= 로 떨어진다
  // (홈 '이달 입퇴실 N건'이 ?tab=moves&month= 로 들어온다). 키를 가른 이유는 뜻이 달라서다 —
  // 형제 화면의 month 는 '조회 장부 월'이고 이 값은 '지금 보고 있는 트랙 위치'다. 한 키를 쓰면
  // 하단 내비·사이드바가 트랙 위치를 조회 월로 복사해 홈·지출·재고·내보내기까지 흘린다
  // (lib/monthParam TRACK_MONTH_KEY).
  //
  // 연속 뷰에서는 조회 창이 아니라 **착지 지점**이다. 범위는 데이터가 정하고, 이 달은 그 안
  // 어디에 내려앉을지를 말한다(범위 밖이면 창이 그쪽으로 미끄러진다 — getMoveCalendarRange).
  // 기본은 KST 이번 달. 서버 로컬(Vercel=UTC)로 잡으면 매월 1일 00~09시 KST 에 전월을 본다.
  const { at, month, tab } = await searchParams
  // 미래 월이 본론인 유일한 화면 — 해석 정본은 같이 쓰되 잠금만 푼다(lib/monthParam).
  const targetMonth = resolveTrackMonth(at, month)

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
