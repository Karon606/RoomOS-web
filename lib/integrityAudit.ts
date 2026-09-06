// 데이터 정합 감사 — 일일 크론이 실행해 위반을 오류신고(error_reports)로 자동 적재.
// 원칙(운영자 2026-07-20, 데이터 땜빵 금지): 어긋난 데이터는 손으로 찾기 전에 시스템이 먼저 신고한다.
// 규칙 추가는 아래에 블록 하나를 더하면 된다. 서명(errorText)이 같은 open·dismissed 신고가 있으면
// 재적재하지 않는다 — done 처리 후 재발하면 다시 적재(해결 실패 감지).
import { Prisma } from '@prisma/client'
import type { PrismaDb } from '@/lib/prisma'
import { billForLeaseMonth } from '@/lib/billing'
import { discountedRent } from '@/lib/rentDiscount'
import { calcCheckoutProration } from '@/lib/prorate'
import { settlementPeriodFor } from '@/lib/settlementPeriod'
import { parseShortStayPolicy, calcShortStay, stayDaysOf, isWithinOneCalendarMonth } from '@/lib/shortStay'
import { inheritableCheckoutReason } from '@/lib/checkoutReason'

type Violation = { signature: string; note: string; tenantId: string | null; propertyId: string }

export async function runIntegrityAudit(
  prisma: PrismaDb,
  // 예행: 위반만 모아 돌려주고 신고는 적재하지 않는다 — 새 규칙이 실제 데이터를 잡는지 확인하는 길.
  opts: { dryRun?: boolean } = {},
): Promise<{ found: number; created: number; violations: Violation[] }> {
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

  // 규칙 1-b — 거주 전 상태인데 납부일이 남아 있음 (등록 폼 파생 잔존 패턴, 운영자 지적 2026-07-30:
  // 문의·예약 건에 '말일' 등이 박혀 확정 전 거짓 정보로 보임. 서버가 pending 저장 시 비우므로 재발 = 새 오염 경로)
  const pendingWithDueDay = await prisma.leaseTerm.findMany({
    where: { status: { in: ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'CANCELLED'] }, dueDay: { not: null } },
    select: { id: true, tenantId: true, propertyId: true, status: true, dueDay: true, tenant: { select: { name: true } } },
  })
  for (const l of pendingWithDueDay) violations.push({
    signature: `[정합] pending-has-dueday · ${l.id}`,
    note: `${l.tenant.name}: 거주 전 상태(${l.status})인데 납부일('${l.dueDay}')이 남아 있습니다. 입실 전에는 납부일이 없어야 합니다.`,
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

  // 규칙 3 — 중도퇴실 환불 스냅샷 불일치 (finalizeRentRefund 스냅샷과 청구 고정 월·금액이 어긋남)
  const withUndo = await prisma.leaseTerm.findMany({
    where: { checkoutProrationUndo: { not: Prisma.DbNull } },
    select: { id: true, tenantId: true, propertyId: true, checkoutProratedMonth: true, checkoutProratedAmount: true, checkoutProrationUndo: true, tenant: { select: { name: true } } },
  })
  for (const l of withUndo) {
    const undoObj = l.checkoutProrationUndo as Record<string, unknown> | null
    const snap = undoObj?.refund as { month?: string; refunded?: number; prepaid?: number } | undefined
    if (!snap?.month) continue
    if (l.checkoutProratedMonth !== snap.month) {
      violations.push({
        signature: `[정합] refund-snapshot-mismatch · ${l.id}`,
        note: `${l.tenant.name}: 중도퇴실 환불 스냅샷(${snap.month})과 청구 고정 월(${l.checkoutProratedMonth ?? '없음'})이 어긋납니다. 환불 이후 청구가 수정된 흔적 — 장부 확인이 필요합니다.`,
        tenantId: l.tenantId, propertyId: l.propertyId,
      })
      continue
    }
    // 규칙 3-b. 청구 확정이 스냅샷의 원 수납 − 환불과 다름 (2026-09-02 환불 없음 0 확정과 함께).
    // 확정은 청구를 이 값으로 고정한다. 그 뒤 퇴실 정산 위젯이나 스크립트가 청구를 다시 손대면 카드는
    // '환불 완료'인데 장부는 다른 금액을 청구하는 상태가 된다. 되돌리기 전에 사람이 봐야 한다.
    if (typeof snap.refunded !== 'number' || typeof snap.prepaid !== 'number') continue
    const expectedKeeps = snap.prepaid - snap.refunded
    if (l.checkoutProratedAmount === expectedKeeps) continue
    violations.push({
      signature: `[정합] refund-billing-drift · ${l.id}`,
      note: `${l.tenant.name}: ${Number(snap.month.slice(5, 7))}월 청구 확정이 ${(l.checkoutProratedAmount ?? 0).toLocaleString()}원인데 환불 확정(원 수납 ${snap.prepaid.toLocaleString()}원 − 환불 ${snap.refunded.toLocaleString()}원)대로면 ${expectedKeeps.toLocaleString()}원이어야 합니다. 환불 뒤 청구가 다시 수정된 흔적입니다. 수납 정보의 이용료 정산에서 적용취소한 뒤 다시 확정해 주세요.`,
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
      id: true, tenantId: true, propertyId: true, rentAmount: true, checkoutProratedMonth: true, status: true,
      dueDay: true, moveInDate: true,
      tenant: { select: { name: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
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
      const base = billForLeaseMonth({ rentAmount: l.rentAmount, status: l.status, room: l.room, dueDay: l.dueDay, moveInDate: l.moveInDate }, mon, null)
      const disc = billForLeaseMonth({ rentAmount: l.rentAmount, status: l.status, discounts: l.discounts, room: l.room, dueDay: l.dueDay, moveInDate: l.moveInDate }, mon, null)
      if (disc >= base || lockedMax !== base) continue
      violations.push({
        signature: `[정합] discount-locked-expected · ${l.id} · ${mon}`,
        note: `${l.tenant.name}: ${mon} 청구가 할인 미반영 원금 ${lockedMax.toLocaleString()}원으로 잠겨 있습니다. 할인가 ${disc.toLocaleString()}원 기준으로 미납이 ${(lockedMax - disc).toLocaleString()}원 부풀려 표시됩니다.`,
        tenantId: l.tenantId, propertyId: l.propertyId,
      })
    }
  }

  // 규칙 6 — 단기 자격 퇴실인데 단기 요금 갈래보다 큰 환불이 확정됨 (506호 패턴, 2026-09-02 신고:
  // 퇴실 처리 화면이 갈래 없이 '위약금' 고정이라 단기 요금 380,000 대신 79,800원이 환불됨).
  // 자격 판정은 previewCheckoutRefund 와 같다 — 단기 계약이 아니고, 입주부터 퇴실까지 달력으로 1개월
  // 안이며, 만기가 아닌 중도 퇴실. 그때 단기 갈래의 환불(결제액 − 단기 요금, 0 하한)보다 많이 돌려줬으면
  // 잡는다. 화면에 갈래가 생긴 뒤에는 운영자가 일부러 면제를 고른 경우도 걸리는데, 그건 무시(dismiss)로
  // 닫으면 재적재되지 않는다. 사후 그물이라 놓치는 쪽보다 한 번 더 묻는 쪽을 택했다.
  const refundedShort = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', isShortTerm: false, moveInDate: { not: null }, moveOutDate: { not: null }, checkoutProrationUndo: { not: Prisma.DbNull } },
    select: {
      id: true, tenantId: true, propertyId: true, dueDay: true, rentAmount: true, moveInDate: true, moveOutDate: true, checkoutProrationUndo: true,
      tenant: { select: { name: true } },
      property: { select: { shortStayPolicy: true } },
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
    },
  })
  for (const l of refundedShort) {
    const snap = (l.checkoutProrationUndo as Record<string, unknown> | null)?.refund as { refunded?: number; prepaid?: number; reason?: string } | undefined
    if (!snap || typeof snap.refunded !== 'number' || typeof snap.prepaid !== 'number' || snap.refunded <= 0) continue
    // 사유가 적힌 스냅샷은 운영자가 계산값과 다른 줄 알고 고른 금액이다(수납 정보 카드의 수동 확정, 2026-09-02) — 건너뛴다.
    if (typeof snap.reason === 'string' && snap.reason.trim()) continue
    // DB @db.Date 는 UTC 자정 저장이라 toISOString 슬라이스가 그 날짜다.
    const moveInYmd = l.moveInDate!.toISOString().slice(0, 10)
    const moveOutYmd = l.moveOutDate!.toISOString().slice(0, 10)
    if (!isWithinOneCalendarMonth(moveInYmd, moveOutYmd)) continue
    const period = settlementPeriodFor({ dueDay: l.dueDay, moveInDate: l.moveInDate }, moveOutYmd)
    if (!period) continue
    const monthlyRent = discountedRent(l.discounts, period.month, l.rentAmount)
    const calc = calcCheckoutProration(monthlyRent, l.dueDay, moveOutYmd, moveInYmd)
    if (!calc || moveOutYmd >= calc.mustLeaveYmd) continue
    const days = stayDaysOf(moveInYmd, moveOutYmd)
    if (days == null || days < 1) continue
    const q = calcShortStay(parseShortStayPolicy(l.property.shortStayPolicy), monthlyRent, days, { moveInYmd, moveOutYmd })
    if (!q) continue
    const shortRefund = Math.max(0, snap.prepaid - q.baseAmount)
    if (snap.refunded <= shortRefund) continue
    violations.push({
      signature: `[정합] refund-over-short-stay · ${l.id}`,
      note: `${l.tenant.name}: 거주 ${days}일 중도 퇴실이라 단기 요금(${q.units}주 계약 ${q.baseAmount.toLocaleString()}원) 기준 환불은 ${shortRefund.toLocaleString()}원인데 ${snap.refunded.toLocaleString()}원을 환불했습니다. 위약금 갈래로 확정된 것이면 수납 정보의 이용료 정산에서 '적용취소'로 되돌린 뒤 단기 요금으로 다시 확정하고, 일부러 면제한 것이면 이 신고를 무시하세요.`,
      tenantId: l.tenantId, propertyId: l.propertyId,
    })
  }

  // 규칙 7 — 퇴실 예정 때 고른 사유가 퇴실 확정 기록에서 빠짐 (506호 패턴, 2026-09-02 신고: 예정 때 적은
  // 사유를 퇴실 처리 폼이 비우고 열어 확정 행의 사유가 null). 이어받을 사유가 있었는지는 화면·서버가
  // 쓰는 같은 판정(lib/checkoutReason)으로 본다 — 확정 행 직전 이력에서 판정이 사유를 돌려주는데
  // 확정 행이 비어 있으면 잡는다. 확정 행에 무엇이든 적혀 있으면 운영자가 골라 적은 것이라 건드리지 않는다.
  const checkedOut = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT' },
    select: {
      id: true, tenantId: true, propertyId: true,
      tenant: { select: { name: true } },
      statusLogs: {
        where: { deletedAt: null },
        orderBy: { changedAt: 'desc' },
        take: 10,
        select: { fromStatus: true, toStatus: true, reason: true },
      },
    },
  })
  for (const l of checkedOut) {
    const idx = l.statusLogs.findIndex(r => r.toStatus === 'CHECKED_OUT')
    if (idx < 0 || (l.statusLogs[idx].reason ?? '').trim()) continue
    const inherited = inheritableCheckoutReason(l.statusLogs.slice(idx + 1))
    if (!inherited) continue
    violations.push({
      signature: `[정합] checkout-reason-dropped · ${l.id}`,
      note: `${l.tenant.name}: 퇴실 예정 때 고른 사유는 '${inherited}'인데 퇴실 확정 기록에는 비어 있습니다. 입주자 정보의 상태 이력에서 퇴실 행의 사유를 적어 주세요.`,
      tenantId: l.tenantId, propertyId: l.propertyId,
    })
  }

  // 규칙 8 — 환불 확정 스냅샷과 그 달 수납 기록이 어긋남 (2026-09-02 수납 정보 카드 도입과 함께).
  // 확정이 만든 record 는 화면·서버가 잠그지만(rooms/actions updatePayment·deletePayment 거부) 옛 화면이나
  // 스크립트가 고치면 스냅샷의 prepaid − refunded 와 그 달 살아 있는 이용료 수납 합이 갈리고, 그때
  // 적용취소가 엉뚱한 금액을 복원한다. 첫 실행에 기존 불일치가 나오면 정리는 운영자 판단이다.
  const refundedAll = await prisma.leaseTerm.findMany({
    where: { status: 'CHECKED_OUT', checkoutProrationUndo: { not: Prisma.DbNull } },
    select: { id: true, tenantId: true, propertyId: true, checkoutProrationUndo: true, tenant: { select: { name: true } } },
  })
  for (const l of refundedAll) {
    const snap = (l.checkoutProrationUndo as Record<string, unknown> | null)?.refund as { refunded?: number; prepaid?: number; month?: string } | undefined
    if (!snap || typeof snap.refunded !== 'number' || typeof snap.prepaid !== 'number' || typeof snap.month !== 'string') continue
    const agg = await prisma.paymentRecord.aggregate({
      where: { leaseTermId: l.id, targetMonth: snap.month, isDeposit: false, isPrevOwner: false, isBillingAdjust: false, deletedAt: null },
      _sum: { actualAmount: true },
    })
    const actual = agg._sum.actualAmount ?? 0
    const expected = snap.prepaid - snap.refunded
    if (actual === expected) continue
    violations.push({
      signature: `[정합] rent-refund-record-drift · ${l.id}`,
      note: `${l.tenant.name}: ${Number(snap.month.slice(5, 7))}월 이용료 수납 합이 ${actual.toLocaleString()}원인데 환불 확정(원 수납 ${snap.prepaid.toLocaleString()}원 − 환불 ${snap.refunded.toLocaleString()}원)대로면 ${expected.toLocaleString()}원이어야 합니다. 수납 정보의 이용료 정산에서 적용취소한 뒤 다시 확정해 주세요.`,
      tenantId: l.tenantId, propertyId: l.propertyId,
    })
  }

  // 적재 — 같은 서명의 open(아직 처리 전)·dismissed(운영자가 무시 선택) 신고가 있으면 건너뛴다.
  let created = 0
  if (opts.dryRun) return { found: violations.length, created, violations }
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
  return { found: violations.length, created, violations }
}
