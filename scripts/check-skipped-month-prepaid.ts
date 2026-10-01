// 밀린 달을 건너뛴 선납 이용료 record 를 세는 DB 래칫 — 읽기 전용, 기준선 초과 시 exit 1
//
// 신고 955f47b1(2026-10-01, 523호). 수납 폼 분해 모드가 이용료 몫을 모달 조회 월로 못박아,
// 10월 1일에 넣은 9월 30일 입금이 10월분 선납이 되고 9월이 미수로 남았다. 모양은 이렇다.
//   이용료 record 의 귀속월이 입금일의 달이거나 그 뒤인데, 그 계약에 그보다 이른 달 중
//   청구 > 수납인 달이 아직 있다. FIFO 였다면 그 이른 달부터 채웠을 돈이다.
//   (2차 2026-10-01: 입금월 당월도 본다 — 조회 월이 입금월과 같으면 못박기가 당월 record 로 남는다.)
//
// 판정은 서버 findFirstUnpaidMonth(app/(app)/rooms/actions.ts)와 같은 규칙을 lib/billing 정본
// 함수로 잰다 — 시작 달 max(입주월, 인수월) · 양도인 정산 달 제외 · 퇴실월 이후/무청구 퇴실월 제외 ·
// 청구 = billForLeaseMonth(락 = 그 달 비양도인 record 의 expectedAmount 최댓값) · 수납 = 그 달
// 이용료 record 합. 서버 함수는 'use server' 파일 안의 비공개 함수라 직접 부를 수 없다.
// 인수월(인수일이 속한 달)은 서버가 메모 이력으로 양도인 자동 처리를 판정하는 전용 규칙이라
// 여기서는 보수적으로 건너뛴다(그 달은 거짓 양성을 내느니 놓친다).
//
// 사람이 귀속월을 직접 골라 밀린 달을 두고 미래 달에 넣은 경우도 같은 모양이라 걸린다. 그건 앱이
// 구분할 수 없으므로 운영자가 보고 정정하거나 기준선을 정한다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-skipped-month-prepaid.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  billForLeaseMonth, isAfterMoveOutMonth, isCheckoutNoBillingMonthFor, resolveDueDateForMonth, monthOfDate,
} from '@/lib/billing'
import { BILLABLE_STATUSES } from '@/lib/leaseStatus'
import { shiftMonth } from '@/lib/moveCalendar'

// 이 날짜 이후 생성분만 본다(분해 모드 도입 2026-08-24). 그 전 기록은 다른 경로의 역사다.
const SINCE = new Date('2026-08-24T00:00:00+09:00')
// 허용목록 — 건수 기준선이 아니라 record id 와 사유다. 건수로 두면 하나가 고쳐지고 하나가 새로
// 생겨도 초록이다. 523호 63c7591c 는 정정 예정이라 넣지 않는다(정정 전에는 빨강이 맞다).
const KNOWN: Record<string, string> = {}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  const leases = await prisma.leaseTerm.findMany({
    where: { status: { in: BILLABLE_STATUSES } },
    select: {
      id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, dueDay: true,
      expectedMoveOut: true, checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
      property: { select: { name: true, acquisitionDate: true, prevOwnerCutoffDate: true } },
      tenant: { select: { name: true } },
      paymentRecords: {
        where: { isDeposit: false, deletedAt: null },
        select: {
          id: true, targetMonth: true, actualAmount: true, expectedAmount: true,
          payDate: true, createdAt: true, isPrevOwner: true, isBillingAdjust: true,
        },
      },
    },
  })

  const hits: string[] = []
  const known: string[] = []
  for (const l of leases) {
    const candidates = l.paymentRecords.filter(r =>
      !r.isPrevOwner && !r.isBillingAdjust && r.actualAmount > 0 && r.createdAt >= SINCE
      && r.targetMonth >= r.payDate.toISOString().slice(0, 7))
    if (candidates.length === 0) continue

    const cutoffRaw = l.property.prevOwnerCutoffDate ?? l.property.acquisitionDate
    const cutoff = cutoffRaw ? new Date(cutoffRaw) : null
    const moveIn = l.moveInDate ? new Date(l.moveInDate) : null
    const startBase = moveIn && cutoff && moveIn > cutoff ? moveIn : (cutoff ?? moveIn)
    const startMonth = monthOfDate(startBase)
    if (!startMonth) continue
    const acqMonth = cutoff ? monthOfDate(cutoff) : null

    const byMonth = new Map<string, typeof l.paymentRecords>()
    for (const r of l.paymentRecords) {
      const arr = byMonth.get(r.targetMonth) ?? []
      arr.push(r)
      byMonth.set(r.targetMonth, arr)
    }
    const unpaidMonth = (ms: string): { bill: number; received: number } | null => {
      const recs = byMonth.get(ms) ?? []
      if (recs.some(r => r.isPrevOwner)) return null
      if (ms === acqMonth) return null
      if (isAfterMoveOutMonth(l.expectedMoveOut, ms)
        || isCheckoutNoBillingMonthFor(l, l.expectedMoveOut, ms, resolveDueDateForMonth(l.dueDay, ms))) return null
      const lockedMax = recs.filter(r => !r.isPrevOwner).reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
      const bill = billForLeaseMonth(l, ms, lockedMax > 0 ? lockedMax : null)
      const received = recs.reduce((s, r) => s + r.actualAmount, 0)
      return received < bill ? { bill, received } : null
    }

    for (const c of candidates) {
      const skipped: string[] = []
      for (let ms = startMonth; ms < c.targetMonth; ms = shiftMonth(ms, 1)) {
        const u = unpaidMonth(ms)
        if (u) skipped.push(`${ms} 청구 ${u.bill.toLocaleString()} · 수납 ${u.received.toLocaleString()}`)
      }
      if (skipped.length === 0) continue
      if (KNOWN[c.id]) { known.push(`${c.id.slice(0, 8)} (${KNOWN[c.id]})`); continue }
      hits.push(
        `${l.property.name} ${l.room?.roomNo ?? '-'}호 ${l.tenant.name} — record ${c.id}`
        + ` 귀속 ${c.targetMonth} · 입금 ${c.payDate.toISOString().slice(0, 10)} · ${c.actualAmount.toLocaleString()}원`
        + ` / 앞선 미수: ${skipped.join(', ')}`,
      )
    }
  }

  await prisma.$disconnect()

  if (known.length) console.log(`[밀린 달 건너뛴 선납] 허용목록 ${known.length}건: ${known.join(', ')}`)
  if (hits.length > 0) {
    console.error(`\n[밀린 달 건너뛴 선납] ${hits.length}건 (허용목록 밖)`)
    for (const h of hits) console.error('  - ' + h)
    console.error('\n  FIFO 였다면 앞선 미수 달부터 채웠을 돈이다. 입금 사실을 확인해 귀속월을 정정하고(되돌리기 파일 동반),')
    console.error('  생성 경로가 조회 월을 못박는지 확인한다(scripts/check-rent-month-pin.mjs).')
    process.exit(1)
  }
  console.log(`[밀린 달 건너뛴 선납] 계약 ${leases.length}개 / 위반 0건 (허용목록 ${known.length}건)`)
}
void main()
