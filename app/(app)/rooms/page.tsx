import { getRoomPaymentStatus, getMonthPaymentAggregates } from './actions'
import { getExtraIncomes, getExtraIncomeLeaseOptions, getDepositSummaryByTenant, getDepositLedger } from '@/app/(app)/finance/actions'
import { getIncomeCategories, getMyRole } from '@/app/(app)/settings/actions'
import { kstMonthStr } from '@/lib/kstDate'
import { requireRouteAccess } from '@/lib/auth/requireRouteAccess'
import { requirePropertyAccess } from '@/lib/auth/propertyAccess'
import prisma from '@/lib/prisma'
import { getCheckedOutRecognizedRevenue, getPaidRevenue, getReservedFullMonthRevenue } from '@/lib/leaseStatus'
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
  // 보증금 — /finance에서 이동(2026-08-12). 받고 돌려주는 돈이라 지출이 아니다. 조회는 두 화면이 같은 정본을 쓰도록
  // finance/actions 에 그대로 두고 여기서 부른다(이 파일이 settings/actions 를 부르는 것과 같은 문법).
  const [roomStatus, myRole, incomes, incomeCategories, payAggregates, reservedExpected, checkedOutRecognized, paidRevenue, leaseOptions, depositSummary, depositLedger] = await Promise.all([
    getRoomPaymentStatus(targetMonth),
    getMyRole(),
    getExtraIncomes(targetMonth),
    getIncomeCategories(),
    getMonthPaymentAggregates(targetMonth),
    getReservedFullMonthRevenue(prisma, propertyId, targetMonth),
    getCheckedOutRecognizedRevenue(prisma, propertyId, targetMonth),
    // 미래월 '미리 받은 이 달 이용료' 보조줄 — 홈 실수납과 같은 정본을 부른다.
    // 미래월 행은 서버가 그 달 수납을 0으로 잠그기 때문에 화면이 행에서 되계산할 수 없다.
    getPaidRevenue(prisma, propertyId, targetMonth),
    // 부가수익 입주자 연결 선택지 — 그 달 수납 행이 아니라 연결 가능한 계약 전부(퇴실 포함).
    getExtraIncomeLeaseOptions(),
    // 보증금은 원장 성격이라 월 스코프가 없다 — 종전 지출 관리 탭과 같은 무인자 조회 그대로.
    getDepositSummaryByTenant(),
    getDepositLedger(),
  ])
  // 아직 오지 않은 달인가 — KST 기준 서버 판정. 클라가 오늘을 다시 구하면 하이드레이션이 갈린다.
  const isFutureMonth = targetMonth > kstMonthStr()
  return (
    <RoomsClient
      roomStatus={roomStatus}
      targetMonth={targetMonth}
      isFutureMonth={isFutureMonth}
      myRole={myRole}
      incomes={incomes}
      incomeCategories={incomeCategories}
      payAggregates={payAggregates}
      reservedExpected={reservedExpected.amount}
      checkedOutRecognized={checkedOutRecognized}
      prepaidReceived={paidRevenue.occupied}
      leaseOptions={leaseOptions}
      depositSummary={depositSummary}
      depositLedger={depositLedger}
      initialTab={tab === 'income' || tab === 'deposit' ? tab : 'rooms'}
    />
  )
}
