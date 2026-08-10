// 수납 재계산·락인 청구액 되쓰기 내부 엔진 — 서버 액션이 아니다('use server' 없음).
//
// 왜 별도 모듈인가. 이 함수들은 화면에서 직접 부르는 것이 아니라 저장 액션들이 뒤에서 쓰는
// 내부 헬퍼인데, 'use server' 파일 안에 export 로 있으면 그 자체가 서버 액션 엔드포인트가 된다.
// 즉 권한 검사도 영업장 스코프도 없이 leaseTermId·roomId 만 알면 남의 청구액을 되쓸 수 있었다
// (보안 감사 2026-08-10). 여기로 옮겨 엔드포인트를 없앤다 — 호출은 서버 안에서만 가능하고,
// 권한·격리는 이 함수를 부르는 액션들이 이미 requireEdit + propertyId 로 확인한다.
//
// 락인 되쓰기 3형제(할인·인상 예약·이용료)는 안전장치가 같아야 해서 한 파일에 둔다.
//   · 일할 정산이 걸린 달은 불변(그 달은 정산액이 청구 권위다)
//   · 변경 전 기준값 그대로 락인된 record 만 되쓴다(협의 락인은 손대지 않는다)
//   · 되쓴 달마다 recalculatePayments 로 완납 여부를 다시 판정한다
import prisma from '@/lib/prisma'
import { billForLeaseMonth } from '@/lib/billing'

// 수납 재계산 — GAS의 recalculatePayments 이관
export async function recalculatePayments(
  leaseTermId: string,
  targetMonth: string,
  expectedAmount: number
) {
  const records = await prisma.paymentRecord.findMany({
    where: { leaseTermId, targetMonth, isDeposit: false },
    orderBy: { payDate: 'asc' },
  })

  let cumulative = 0
  for (const record of records) {
    cumulative += record.actualAmount
    const isPaid = cumulative >= expectedAmount

    await prisma.paymentRecord.update({
      where: { id: record.id },
      data:  { isPaid },
    })
  }
}

// 할인 변경 → 락인 record 정합 되쓰기 (신고 70cde9d6 근본 수정, 운영자 승인 2026-07-20)
// 부분 납부로 그 달 청구액이 record에 락인된 뒤 할인을 등록·삭제하면, 락인이 할인 fallback을 이겨
// 미납이 원금 기준으로 계속 표시됐다. 할인 변경 시 "변경 전 기준값 그대로 락인된" 현재월 이후
// record만 새 기준값으로 되쓰고 완납을 재계산한다. 협의 락인(기준값과 다른 금액)·일할 월·단기는 불변.
export async function rewriteLockedExpectedForDiscountChange(
  leaseTermId: string,
  prevDiscounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[],
  nextDiscounts: { discountType: string; value: number; scope: string; startMonth: string | null; endMonth: string | null }[],
) {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      isShortTerm: true, rentAmount: true, checkoutProratedMonth: true, status: true,
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    },
  })
  if (!lease || lease.isShortTerm) return
  // 월 하한 제거(크리티컬 신고 50a2a69b 후속) — 입주월이 이미 지난 예약 선납 락도 되쓰기 대상.
  // 안전장치는 아래 '기준값 그대로 락인된 record만' 조건이 담당(협의 락인·일할 월·단기는 여전히 불변).
  const recs = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isDeposit: false, isPrevOwner: false, deletedAt: null },
    select: { id: true, targetMonth: true, expectedAmount: true },
  })
  const months = [...new Set(recs.map(r => r.targetMonth))]
  for (const mon of months) {
    if (lease.checkoutProratedMonth === mon) continue   // 일할 정산 권위 월 — 불변
    const base = { rentAmount: lease.rentAmount, status: lease.status, room: lease.room }
    const before = billForLeaseMonth({ ...base, discounts: prevDiscounts }, mon, null)
    const after  = billForLeaseMonth({ ...base, discounts: nextDiscounts }, mon, null)
    if (before === after) continue
    const monthRecs = recs.filter(r => r.targetMonth === mon)
    const lockedMax = monthRecs.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    if (lockedMax !== before) continue   // 협의 락인 등 기준값과 다른 금액 — 손대지 않음
    const targets = monthRecs.filter(r => r.expectedAmount === lockedMax).map(r => r.id)
    await prisma.paymentRecord.updateMany({ where: { id: { in: targets } }, data: { expectedAmount: after } })
    await recalculatePayments(leaseTermId, mon, after)
  }
}

// 인상 예약 변경 → 락인 record 정합 되쓰기 (A페이즈 2026-08-01)
// 할인에는 rewriteLockedExpectedForDiscountChange 가 있는데 인상 예약에는 같은 장치가 없었다.
// 그래서 인상 적용월이 이미 선납돼 락인돼 있으면 billForLeaseMonth 가 락인을 우선해
// **인상분이 영원히 미청구·미수 미인식**으로 남았다(할인 사고 70cde9d6 의 정확한 반대편).
// 안전장치는 할인 쪽과 동일 — '변경 전 기준값 그대로 락인된' record 만 되쓰고,
// 협의 락인(기준값과 다른 금액)·퇴실 일할 월·단기는 손대지 않는다.
export async function rewriteLockedExpectedForRentSchedule(
  roomId: string,
  prev: { scheduledRent: number | null; rentUpdateDate: Date | null; nonResidentScheduled?: number | null; nonResidentRentDate?: Date | null },
  next: { scheduledRent: number | null; rentUpdateDate: Date | null; nonResidentScheduled?: number | null; nonResidentRentDate?: Date | null },
) {
  // 두 축을 함께 넘긴다 — 엔진이 계약 상태로 축을 고른다(거주 축만 바뀌면 비거주 계약은
  // before === after 라 자동으로 건너뛴다. 명시 분기가 필요 없다).
  const beforeRoom = {
    scheduledRent: prev.scheduledRent, rentUpdateDate: prev.rentUpdateDate,
    nonResidentScheduled: prev.nonResidentScheduled ?? null, nonResidentRentDate: prev.nonResidentRentDate ?? null,
  }
  const afterRoom  = {
    scheduledRent: next.scheduledRent, rentUpdateDate: next.rentUpdateDate,
    nonResidentScheduled: next.nonResidentScheduled ?? null, nonResidentRentDate: next.nonResidentRentDate ?? null,
  }
  // 이 방의 청구 대상 계약 전부(퇴실·취소 제외)
  const leases = await prisma.leaseTerm.findMany({
    where: { roomId, status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'NON_RESIDENT'] } },
    select: {
      id: true, isShortTerm: true, rentAmount: true, checkoutProratedMonth: true, status: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  for (const lease of leases) {
    if (lease.isShortTerm) continue
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: lease.id, isDeposit: false, isPrevOwner: false, deletedAt: null },
      select: { id: true, targetMonth: true, expectedAmount: true },
    })
    const months = [...new Set(recs.map(r => r.targetMonth))]
    for (const mon of months) {
      if (lease.checkoutProratedMonth === mon) continue   // 일할 정산 권위 월 — 불변
      const base = { rentAmount: lease.rentAmount, status: lease.status, discounts: lease.discounts }
      const before = billForLeaseMonth({ ...base, room: beforeRoom }, mon, null)
      const after  = billForLeaseMonth({ ...base, room: afterRoom }, mon, null)
      if (before === after) continue
      const monthRecs = recs.filter(r => r.targetMonth === mon)
      const lockedMax = monthRecs.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
      if (lockedMax !== before) continue   // 협의 락인 등 기준값과 다른 금액 — 손대지 않음
      const targets = monthRecs.filter(r => r.expectedAmount === lockedMax).map(r => r.id)
      await prisma.paymentRecord.updateMany({ where: { id: { in: targets } }, data: { expectedAmount: after } })
      await recalculatePayments(lease.id, mon, after)
    }
  }
}

// 이용료(rentAmount) 자체가 바뀔 때 락인된 청구액을 되쓴다 — 2026-08-02.
//
// 왜 필요한가: 단기에서 월 단위로 내려올 때 rentAmount 만 바꾸면 화면이 하나도 안 바뀐다.
// billForLeaseMonth 우선순위가 '일할 > 락인 > 이용료' 라 이미 박힌 락인이 이용료를 이긴다.
// 520호 김민정이 그 사례다 — 월 계약으로 바꿨는데 2주 단가 329,000 이 락인으로 남아
// 7월·8월 청구가 계속 329,000 이었다(신고 2c6de978).
//
// 안전장치는 형제 두 정본(rewriteLockedExpectedForDiscountChange·ForRentSchedule)과 같다.
//   · 일할 정산이 걸린 달은 불변(그 달은 정산액이 청구 권위다)
//   · **변경 전 기준값 그대로 락인된 record 만** 되쓴다. 협의 락인(기준가와 다른 금액)은 손대지 않는다
//   · 되쓴 달마다 recalculatePayments 로 완납 여부를 다시 판정한다
// fromMonth 를 주면 그 달 이후만 손댄다 — 입주월 이전이나 양도인 구간을 건드리지 않기 위해서다.
export async function rewriteLockedExpectedForRentAmount(
  leaseTermId: string,
  prevRentAmount: number,
  nextRentAmount: number,
  fromMonth?: string | null,
): Promise<{ changed: { month: string; before: number; after: number }[] }> {
  const changed: { month: string; before: number; after: number }[] = []
  if (prevRentAmount === nextRentAmount) return { changed }
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: leaseTermId },
    select: {
      id: true, isShortTerm: true, checkoutProratedMonth: true, status: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    },
  })
  if (!lease) return { changed }
  const recs = await prisma.paymentRecord.findMany({
    where: { leaseTermId, isDeposit: false, isPrevOwner: false, deletedAt: null, isBillingAdjust: false },
    select: { id: true, targetMonth: true, expectedAmount: true },
  })
  const months = [...new Set(recs.map(r => r.targetMonth))].sort()
  for (const mon of months) {
    if (fromMonth && mon < fromMonth) continue
    if (lease.checkoutProratedMonth === mon) continue
    const base = { discounts: lease.discounts, status: lease.status, room: lease.room }
    const before = billForLeaseMonth({ ...base, rentAmount: prevRentAmount }, mon, null)
    const after  = billForLeaseMonth({ ...base, rentAmount: nextRentAmount }, mon, null)
    if (before === after) continue
    const monthRecs = recs.filter(r => r.targetMonth === mon)
    const lockedMax = monthRecs.reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    if (lockedMax !== before) continue   // 협의 락인 등 기준값과 다른 금액 — 손대지 않음
    const targets = monthRecs.filter(r => r.expectedAmount === lockedMax).map(r => r.id)
    await prisma.paymentRecord.updateMany({ where: { id: { in: targets } }, data: { expectedAmount: after } })
    await recalculatePayments(leaseTermId, mon, after)
    changed.push({ month: mon, before, after })
  }
  return { changed }
}
