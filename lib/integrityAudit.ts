// 데이터 정합 감사 — 일일 크론이 실행해 위반을 오류신고(error_reports)로 자동 적재.
// 원칙(운영자 2026-07-20, 데이터 땜빵 금지): 어긋난 데이터는 손으로 찾기 전에 시스템이 먼저 신고한다.
// 규칙 추가는 아래에 블록 하나를 더하면 된다. 서명(errorText)이 같은 open·dismissed 신고가 있으면
// 재적재하지 않는다 — done 처리 후 재발하면 다시 적재(해결 실패 감지).
import { Prisma } from '@prisma/client'
import type { PrismaDb } from '@/lib/prisma'
import { billForLeaseMonth } from '@/lib/billing'

type Violation = { signature: string; note: string; tenantId: string | null; propertyId: string }

export async function runIntegrityAudit(prisma: PrismaDb): Promise<{ found: number; created: number }> {
  const violations: Violation[] = []

  // 규칙 1 — 퇴실 상태인데 퇴실일 없음 (파트쿨리나·임형진 패턴: 결산 미수가 허수로 무한 누적)
  const noMoveOut = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', moveOutDate: null },
    select: { id: true, tenantId: true, propertyId: true, tenant: { select: { name: true } } },
  })
  for (const l of noMoveOut) violations.push({
    signature: `[정합] checked-out-no-moveout · ${l.id}`,
    note: `${l.tenant.name}: 퇴실 상태인데 퇴실일(moveOutDate)이 비어 있습니다. 결산 미수가 허수로 쌓일 수 있습니다.`,
    tenantId: l.tenantId, propertyId: l.propertyId,
  })

  // 규칙 2 — 일할 정산 잔존인데 그 달 수납 기록 0건 (조원섭 패턴: 받기로 한 금액이 미수인 채 종결)
  const prorated = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', checkoutProratedMonth: { not: null }, checkoutProratedAmount: { gt: 0 } },
    select: { id: true, tenantId: true, propertyId: true, checkoutProratedMonth: true, checkoutProratedAmount: true, tenant: { select: { name: true } } },
  })
  for (const l of prorated) {
    const cnt = await prisma.paymentRecord.count({
      where: { leaseTermId: l.id, targetMonth: l.checkoutProratedMonth!, isDeposit: false },
    })
    if (cnt === 0) violations.push({
      signature: `[정합] prorated-no-record · ${l.id}`,
      note: `${l.tenant.name}: 퇴실 일할 정산 ${l.checkoutProratedAmount!.toLocaleString()}원(${l.checkoutProratedMonth})이 걸려 있는데 그 달 수납 기록이 없습니다. 받을 돈이면 수납 기록을, 안 받기로 했다면 일할 해제가 필요합니다.`,
      tenantId: l.tenantId, propertyId: l.propertyId,
    })
  }

  // 규칙 3 — 중도퇴실 환불 스냅샷 불일치 (finalizeRentRefund 스냅샷과 청구 고정 월이 어긋남)
  const withUndo = await prisma.leaseTerm.findMany({
    where: { checkoutProrationUndo: { not: Prisma.DbNull } },
    select: { id: true, tenantId: true, propertyId: true, checkoutProratedMonth: true, checkoutProrationUndo: true, tenant: { select: { name: true } } },
  })
  for (const l of withUndo) {
    const undoObj = l.checkoutProrationUndo as Record<string, unknown> | null
    const snap = undoObj?.refund as { month?: string } | undefined
    if (!snap?.month) continue
    if (l.checkoutProratedMonth !== snap.month) violations.push({
      signature: `[정합] refund-snapshot-mismatch · ${l.id}`,
      note: `${l.tenant.name}: 중도퇴실 환불 스냅샷(${snap.month})과 청구 고정 월(${l.checkoutProratedMonth ?? '없음'})이 어긋납니다. 환불 이후 청구가 수정된 흔적 — 장부 확인이 필요합니다.`,
      tenantId: l.tenantId, propertyId: l.propertyId,
    })
  }

  // 규칙 4 — 단기 거주중인데 퇴실 예정일 없음 (D-1 자동 전환·캘린더·연장이 전부 무력화되는 상태)
  const shortNoOut = await prisma.leaseTerm.findMany({
    where: { isShortTerm: true, status: { in: ['ACTIVE', 'CHECKOUT_PENDING'] }, expectedMoveOut: null },
    select: { id: true, tenantId: true, propertyId: true, tenant: { select: { name: true } } },
  })
  for (const l of shortNoOut) violations.push({
    signature: `[정합] short-no-expected-out · ${l.id}`,
    note: `${l.tenant.name}: 단기 거주중인데 퇴실 예정일이 없습니다. 자동 퇴실 전환·캘린더·연장이 동작하지 않으니 퇴실일을 입력해 주세요.`,
    tenantId: l.tenantId, propertyId: l.propertyId,
  })

  // 규칙 5 — 할인 미반영 락인 (403호 패턴, 신고 70cde9d6: 납부 후 등록한 할인이 락인에 무효화돼 미납 과대 표시)
  // 원금 그대로 락인된 달만 검출 — 협의 락인(원금과 다른 금액)·일할 권위 월·단기는 제외.
  // 할인 등록 이전의 종결 월 소음 방지를 위해 가장 이른 할인 등록월부터만 본다.
  const discountedLeases = await prisma.leaseTerm.findMany({
    where: { isShortTerm: false, discounts: { some: {} } },
    select: {
      id: true, tenantId: true, propertyId: true, rentAmount: true, checkoutProratedMonth: true,
      tenant: { select: { name: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true, createdAt: true } },
    },
  })
  for (const l of discountedLeases) {
    const earliest = l.discounts.reduce<Date | null>((m, d) => (!m || d.createdAt < m ? d.createdAt : m), null)
    if (!earliest) continue
    const fromMon = `${earliest.getFullYear()}-${String(earliest.getMonth() + 1).padStart(2, '0')}`
    const recs = await prisma.paymentRecord.findMany({
      where: { leaseTermId: l.id, isDeposit: false, isPrevOwner: false, targetMonth: { gte: fromMon } },
      select: { targetMonth: true, expectedAmount: true },
    })
    const byMon = new Map<string, number>()
    for (const r of recs) byMon.set(r.targetMonth, Math.max(byMon.get(r.targetMonth) ?? 0, r.expectedAmount))
    for (const [mon, lockedMax] of byMon) {
      if (l.checkoutProratedMonth === mon) continue
      const base = billForLeaseMonth({ rentAmount: l.rentAmount, room: l.room }, mon, null)
      const disc = billForLeaseMonth({ rentAmount: l.rentAmount, discounts: l.discounts, room: l.room }, mon, null)
      if (disc >= base || lockedMax !== base) continue
      violations.push({
        signature: `[정합] discount-locked-expected · ${l.id} · ${mon}`,
        note: `${l.tenant.name}: ${mon} 청구가 할인 미반영 원금 ${lockedMax.toLocaleString()}원으로 잠겨 있습니다. 할인가 ${disc.toLocaleString()}원 기준으로 미납이 ${(lockedMax - disc).toLocaleString()}원 부풀려 표시됩니다.`,
        tenantId: l.tenantId, propertyId: l.propertyId,
      })
    }
  }

  // 적재 — 같은 서명의 open(아직 처리 전)·dismissed(운영자가 무시 선택) 신고가 있으면 건너뛴다.
  let created = 0
  for (const v of violations) {
    const dup = await prisma.errorReport.findFirst({
      where: { errorText: v.signature, status: { in: ['open', 'dismissed'] } },
      select: { id: true },
    })
    if (dup) continue
    await prisma.errorReport.create({
      data: {
        propertyId: v.propertyId,
        userEmail: 'integrity-audit',
        url: v.tenantId ? `/tenants?tenantId=${v.tenantId}` : null,
        errorText: v.signature,
        userNote: v.note,
      },
    })
    created++
  }
  return { found: violations.length, created }
}
