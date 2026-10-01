// 방을 공실로 돌리기 전에 묻는 점유 확인 정본과 퇴실 시 예약 인상가 조기 적용 판정
//
// 왜 lib 로 뺐나 (2026-10-01, 513호 사고).
//   퇴실 부수 처리 정본(tenants/actions applyCheckoutSideEffects)이 이 확인 없이 isVacant=true 를
//   무조건 썼다. 10/5 입주 예약이 걸린 513호가 퇴실 처리 한 번에 공실이 됐고, 홈 공실 수·타일·배치도·
//   입주자 폼 '(공실)'·웹사이트 '올릴 방' 권유가 함께 틀어졌다. 엑셀 가져오기 보관 경로도 같은 무가드
//   쓰기를 들고 있었다. 확인 함수는 tenants/actions 안에만 있어서('use server' 파일은 async 함수만
//   내보낼 수 있다) 가져오기 라우트가 쓸 수 없었다. 그래서 순수 쿼리 함수로 여기 한 벌만 둔다.
//
// 감지망: scripts/check-vacant-write-guard.mjs 가 app/·lib/ 의 isVacant 공실 쓰기가 이 확인 뒤에서만
// 일어나는지 본다. 정의는 knowledge/domain-vacancy.md '공실 전환은 정본 확인 뒤에만'.
import prisma from '@/lib/prisma'
import { OCCUPYING_STATUSES } from '@/lib/leaseStatus'

/**
 * 이 방을 아직 점유하고 있는 다른 계약이 있는가 — 거주중·퇴실 예정·입실 예약(OCCUPYING_STATUSES).
 *
 * 비거주(NON_RESIDENT)는 세지 않는다. isVacant 는 비거주에 관여하지 않는 raw 플래그이고, 창고·사무실
 * 집계 제외는 lib/vacancy 가 집계 시점에 따로 거른다.
 *
 * exceptLeaseId 는 선택이다. '예외 없음'을 '' 로 표현하면 Postgres 가 uuid 캐스팅에서 터진다
 * (invalid input syntax for type uuid, 2026-09-01 오늘 이사 처리 실사고). 빈 값이면 조건을 아예 뺀다.
 */
export async function roomStillOccupied(roomId: string, exceptLeaseId?: string): Promise<boolean> {
  const other = await prisma.leaseTerm.findFirst({
    where: {
      roomId,
      ...(exceptLeaseId ? { id: { not: exceptLeaseId } } : {}),
      status: { in: OCCUPYING_STATUSES },
    },
    select: { id: true },
  })
  return !!other
}

/**
 * 퇴실 때 예약 인상가(Room.scheduledRent)를 적용일보다 앞당겨 표준가로 올리는가.
 *
 * - 방이 실제로 빌 때만 앞당긴다. 다음 예약자·남은 거주자가 있으면 앞당기지 않고 정본 날짜 적용
 *   (lib/scheduledRent)에 맡긴다. 정본은 적용 시 RESERVED 를 포함한 계약 rentAmount 까지 맞추는데
 *   이 조기 적용은 그러지 않아, 앞당기면 다음 예약자 계약이 옛 가격에 남고 적용일 크론은
 *   scheduledRent=null 이라 아무것도 안 한다.
 * - 운영자 답(수정 폼의 '가격 변동 적용' 확인창)이 '적용 안 함'(false)이면 앞당기지 않는다.
 *   답이 없으면(undefined) 빈 방의 예약가를 지금 올리는 종전 규칙이다.
 */
export function shouldApplyScheduledRentOnCheckout(p: {
  occupied: boolean
  scheduledRent: number | null | undefined
  operatorAnswer?: boolean
}): boolean {
  if (p.occupied) return false
  if (p.scheduledRent == null) return false
  return p.operatorAnswer !== false
}
