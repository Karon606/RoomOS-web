import { getRoomPaymentStatus, getMonthPaymentAggregates } from './actions'
import { getExtraIncomes } from '@/app/(app)/finance/actions'
import { getIncomeCategories, getMyRole } from '@/app/(app)/settings/actions'
import { kstMonthStr } from '@/lib/kstDate'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { getCheckedOutRecognizedRevenue, getReservedFullMonthRevenue } from '@/lib/leaseStatus'
import RoomsClient from './RoomsClient'

export default async function RoomsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; tab?: string }>
}) {
  await requireRouteAccess()   // 클라 내비 뒷문 차단(제한 스태프)
  const { month, tab } = await searchParams
  // 기본 월은 KST 기준 — 서버 로컬(new Date, Vercel=UTC)이면 매월 1일 00:00-09:00 KST에 전월로 잡힘(적대검증 필수 4)
  const targetMonth = month ?? kstMonthStr()

  // 홈 예상 수입과의 다리 — 이 화면 청구액에는 안 잡히지만 홈에는 잡히는 두 항(2026-08-07).
  // 기타수익은 아래 incomes 를 그대로 쓴다(같은 조회, 같은 월 범위).
  const { propertyId } = await requirePropertyAccess()

  // 부가수익 — /finance에서 이동(2026-07-02). 과납분·보증금 미반환분 등 수납 파생 수익이라 수납 흐름 옆에.
  const [roomStatus, myRole, incomes, incomeCategories, payAggregates, reservedExpected, checkedOutRecognized] = await Promise.all([
    getRoomPaymentStatus(targetMonth),
    getMyRole(),
    getExtraIncomes(targetMonth),
    getIncomeCategories(),
    getMonthPaymentAggregates(targetMonth),
    getReservedFullMonthRevenue(prisma, propertyId, targetMonth),
    getCheckedOutRecognizedRevenue(prisma, propertyId, targetMonth),
  ])
  return (
    <RoomsClient
      roomStatus={roomStatus}
      targetMonth={targetMonth}
      myRole={myRole}
      incomes={incomes}
      incomeCategories={incomeCategories}
      payAggregates={payAggregates}
      reservedExpected={reservedExpected}
      checkedOutRecognized={checkedOutRecognized}
      initialTab={tab === 'income' ? 'income' : 'rooms'}
    />
  )
}
