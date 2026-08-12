// 예약된 가격 일괄 적용 — 적용일이 지난 예약값을 baseRent 로 옮기고 예약 칸을 비운다.
//
// 규칙 본문은 종전 room-manage/actions applyScheduledRents 에 있던 것을 **한 글자도 안 바꾸고**
// 그대로 옮긴 것이다. 여기로 내린 이유는 하나 — 크론이 페이지 로드와 **문자 그대로 같은 함수**를
// 불러야 하기 때문이다(운영자 오더 2026-08-12: 자동 적용은 결제 마스터 변경이므로 새 규칙 신설 금지).
//
// 왜 'use server' 파일에 두지 않았나 — 그러면 propertyId 를 받는 이 함수가 그대로 서버 액션
// 엔드포인트가 되어, 누구나 남의 영업장 id 로 부를 수 있다. 접근 검사는 부르는 쪽이 한다:
// 서버 액션 래퍼(room-manage/actions applyScheduledRents)는 requirePropertyAccess 를 거치고,
// 크론 라우트는 CRON_SECRET 으로 문지기를 세운 뒤 전 영업장을 돈다.
import prisma from '@/lib/prisma'
import { revalidatePath } from 'next/cache'
import { scheduledRentApplyCutoff } from '@/lib/billing'

export async function applyScheduledRentsFor(propertyId: string) {
  // '오늘'은 KST 기준(lib/billing 정본). 로컬 자정이면 서버(UTC)에서 KST 00~09 시 동안
  // 아직 어제라, 적용일 당일 아침 9시까지 인상이 안 걸렸다.
  const today = scheduledRentApplyCutoff()

  // 날짜가 오늘 이전이고 scheduledRent가 있는 호실 조회
  const rooms = await prisma.room.findMany({
    where: {
      propertyId,
      OR: [
        { scheduledRent: { not: null }, rentUpdateDate: { lte: today } },
        { nonResidentScheduled: { not: null }, nonResidentRentDate: { lte: today } },
      ],
    },
    select: {
      id: true,
      scheduledRent: true,
      rentUpdateDate: true,
      nonResidentScheduled: true,
      nonResidentRentDate: true,
    },
  })

  if (rooms.length === 0) return { updated: 0 }

  // 각 호실 업데이트 (baseRent 적용 + 예약 필드 초기화 + 활성 계약 rentAmount 동기화)
  await Promise.all(rooms.map(async room => {
    const data: Record<string, unknown> = {}

    if (room.scheduledRent != null && room.rentUpdateDate && room.rentUpdateDate <= today) {
      data.baseRent      = room.scheduledRent
      data.scheduledRent = null
      data.rentUpdateDate = null
    }
    if (room.nonResidentScheduled != null && room.nonResidentRentDate && room.nonResidentRentDate <= today) {
      data.nonResidentRent      = room.nonResidentScheduled
      data.nonResidentScheduled = null
      data.nonResidentRentDate  = null
    }
    if (Object.keys(data).length === 0) return

    await prisma.room.update({ where: { id: room.id }, data })

    if (data.baseRent != null) {
      await prisma.leaseTerm.updateMany({
        where: { roomId: room.id, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
        data: { rentAmount: data.baseRent as number },
      })
    }

    // 비거주 축의 거울 — 예약 필드를 비우기 전에 계약 rentAmount 로 옮겨야 한다.
    // 없으면 적용일이 경과하는 순간 선반영과 모순된다(청구 엔진이 예약값을 잃어 구가로 회귀).
    if (data.nonResidentRent != null) {
      await prisma.leaseTerm.updateMany({
        where: { roomId: room.id, status: 'NON_RESIDENT' },
        data: { rentAmount: data.nonResidentRent as number },
      })
    }
  }))

  revalidatePath('/room-manage')
  revalidatePath('/rooms')
  revalidatePath('/tenants')

  return { updated: rooms.length }
}
