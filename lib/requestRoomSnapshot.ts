// 요청 등록 시점의 호실번호를 뽑는 공용 헬퍼 — 등록·수정·엑셀 임포트가 같은 규칙을 쓴다.

import prisma from '@/lib/prisma'

/**
 * 입주자의 활성 계약(ACTIVE·RESERVED·CHECKOUT_PENDING) 호실번호.
 * 공용부 요청(tenantId null)이거나 활성 계약이 없으면 null — 표시는 동적 폴백으로 떨어진다.
 */
export async function getRoomNoSnapshot(tenantId: string | null | undefined): Promise<string | null> {
  if (!tenantId) return null
  const lease = await prisma.leaseTerm.findFirst({
    where: { tenantId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] } },
    orderBy: { status: 'asc' },
    select: { room: { select: { roomNo: true } } },
  })
  return lease?.room?.roomNo ?? null
}
