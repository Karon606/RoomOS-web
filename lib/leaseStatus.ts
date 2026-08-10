// LeaseStatus 의미 분류 + 매출 인식 헬퍼.
//
// 배경 (2026-05-31):
//   status 필터링이 50+ 곳에 산재해, 같은 의도("매출 인식 대상")인데 곳마다 다른 status
//   조합을 쓰던 패턴 버그가 두 번 발생했음 (totalExpected / totalRevenue 가 CHECKED_OUT
//   단기·중도퇴실 lease 의 그 달 매출을 놓침). 이 모듈은 의미별로 status 조합을 상수화
//   하고, 매출 인식 lease 추출을 한 곳에서 처리하기 위한 단일 진실 출처.
//
// 적용 정책:
//   1) 매출/청구 인식 = BILLABLE_STATUSES (ACTIVE/CHECKOUT_PENDING/NON_RESIDENT)
//      + CHECKED_OUT 중 targetMonth 귀속 paymentRecord 가 있는 lease (단기·중도퇴실)
//   2) "현재 거주" = CURRENT_OCCUPANCY_STATUSES (ACTIVE/CHECKOUT_PENDING) — 호실 점유 의미
//   3) "고객 관리 표시 대상" = TENANT_LIST_STATUSES — 투어·예약·비거주 포함 전 단계
//
// 점진적 마이그레이션을 가정: 신규 코드는 이 모듈을 쓰고, 기존 코드는 같은 정책이 필요
// 한 곳부터 차차 교체. 사이드이펙트 위험 때문에 일괄 교체는 하지 않음.

import type { LeaseStatus } from '@prisma/client'
import type { PrismaDb } from '@/lib/prisma'
import { billForLeaseMonth } from './billing'
import { kstDaysUntil } from './kstDate'

/**
 * 매출/청구 인식 대상 lease.
 * 정상 거주 + 퇴실 예정 (그 달은 청구) + 비거주(호실 안 살지만 임대료 계약 유지).
 * CHECKED_OUT 단기·중도퇴실의 매출은 별도로 paymentRecord 기반 추가 인식.
 */
export const BILLABLE_STATUSES: LeaseStatus[] = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']

/**
 * "현재 그 호실에 거주 중" — 호실 점유율, 공실 카운터 등에 사용.
 * NON_RESIDENT 는 본인 호실 거주 안 함, RESERVED 는 아직 입주 안 함.
 */
export const CURRENT_OCCUPANCY_STATUSES: LeaseStatus[] = ['ACTIVE', 'CHECKOUT_PENDING']

/**
 * 방을 대표하는 계약 — 실제로 그 방에 사는 사람이 먼저다. 없으면 예약자, 그마저 없으면 첫 계약.
 *
 * 화면마다 자기 방식으로 고르다가 같은 방이 화면마다 다른 사람을 가리켰다. 호실 카드는
 * 'NON_RESIDENT 가 아닌 첫 계약'을 골랐는데 getRooms 의 status asc 는 enum 선언 순서라
 * RESERVED 가 ACTIVE 보다 앞이었고, 프리즘 호실 면은 'createdAt desc 첫 계약'이라 최근에 만든
 * 예약을 골랐다. 그래서 503호는 카드에 송호준(퇴실 예정), 눌러 연 모달에 Arafat(예약)이 떴다.
 * 정렬이 아니라 의미로 고르고, 그 의미를 여기 한 곳에만 둔다.
 *
 * 마지막 폴백(leases[0])은 호출 측이 넘긴 집합에 달렸다 — 비거주까지 넘기면 비거주가,
 * 점유 계약만 넘기면 없음이 된다. 넘기는 집합이 곧 그 화면의 정의다.
 */
export function primaryRoomLease<T extends { status: string }>(leases: T[]): T | undefined {
  const residing: string[] = CURRENT_OCCUPANCY_STATUSES
  return leases.find(l => residing.includes(l.status))
    ?? leases.find(l => l.status === 'RESERVED')
    ?? leases[0]
}

/**
 * 고객 관리 목록 표시 대상 — 투어 단계부터 비거주까지 진행 중인 모든 단계.
 * 퇴실(CHECKED_OUT) · 취소(CANCELLED) 만 제외.
 */
export const TENANT_LIST_STATUSES: LeaseStatus[] = [
  'WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT',
]

/**
 * 종료된 lease — 공실 방의 직전 입주자 표시, 평균 거주기간 통계 등.
 */
export const CLOSED_STATUSES: LeaseStatus[] = ['CHECKED_OUT', 'CANCELLED']

/**
 * 퇴실 예정 보조 문구 — "6/26 퇴실 D-13" / "오늘 6/26 퇴실" / "6/26 퇴실 13일 경과".
 * 수납 관리(rooms)와 호실 관리(room-manage)가 같은 문장을 쓰도록 여기서 한 번만 만든다.
 * expectedMoveOut 은 'YYYY-MM-DD' (KST 고정 문자열).
 *
 * 오늘은 kstDaysUntil(=kstYmdStr) 로 뽑는다. new Date() 로 뽑던 시절엔 서버(UTC)와 기기(KST)가
 * KST 00~09시에 하루 다른 오늘을 봐서 같은 퇴실일이 D-11 / D-10 으로 갈렸고, 그 텍스트 불일치가
 * React #418 하이드레이션 오류로 올라왔다(신고 d4bd3aa5·9c09ca50, KST 01:13 발생).
 */
export function checkoutSubText(expectedMoveOut: string | null): string | null {
  if (!expectedMoveOut) return null
  const [, mm, dd] = expectedMoveOut.split('-')
  const days = kstDaysUntil(expectedMoveOut)
  const label = `${Number(mm)}/${Number(dd)} 퇴실`
  return days > 0 ? `${label} D-${days}` : days === 0 ? `오늘 ${label}` : `${label} ${Math.abs(days)}일 경과`
}

/**
 * 입주 예정 보조 문구 — "9/1 입주 예정". 퇴실 표기(checkoutSubText)와 대칭인 짧은 인라인 날짜.
 */
export function moveInSubText(moveInDate: string | null): string | null {
  if (!moveInDate) return null
  const [, mm, dd] = moveInDate.split('-')
  return `${Number(mm)}/${Number(dd)} 입주 예정`
}

/**
 * 단기 퇴실 도래 — 단기는 D-1 자동 전환 전까지 ACTIVE 로 남아 화면에 퇴실 신호가 늦게 붙는다.
 * 상태·청구·전환 크론은 그대로 두고, 사실 축(퇴실 예정일)에서 표기와 칩 포함만 파생한다.
 * 두 화면(수납 관리·호실 관리)이 같은 판정을 쓰도록 여기가 정본이다.
 */
export function isShortTermCheckoutDue(
  lease: { isShortTerm: boolean; status: string | null; expectedMoveOut: string | null },
  targetMonth: string,
): boolean {
  const ck = lease.expectedMoveOut?.slice(0, 7) ?? null
  return lease.isShortTerm && lease.status === 'ACTIVE' && !!ck && ck <= targetMonth
}

/**
 * CHECKED_OUT lease 중 그 달 귀속 paymentRecord 가 있는 lease 목록.
 * 단기 입주 후 퇴실, 거주 중 중도퇴실 등 — 그 달 매출 인식이 필요한 케이스.
 * rentAmount 와 함께 반환되어 호출 측에서 Math.min(paid, rent) 과납 처리에 사용 가능.
 */
export async function getCheckedOutLeasesWithRevenue(
  prisma: PrismaDb,
  propertyId: string,
  targetMonth: string,
): Promise<{ id: string; rentAmount: number }[]> {
  return prisma.leaseTerm.findMany({
    where: {
      propertyId, status: 'CHECKED_OUT', rentAmount: { gt: 0 },
      paymentRecords: { some: { targetMonth, isDeposit: false, isPrevOwner: false, deletedAt: null } },
    },
    select: { id: true, rentAmount: true },
  })
}

/**
 * CHECKED_OUT lease 의 그 달 귀속 paymentRecord 합계.
 * totalExpected (발생주의 청구) 의 단기·중도퇴실 보정 — rentAmount 전체가 아닌
 * 실제 정산된 금액(일할 등)이 paymentRecord 에 들어 있으므로 그대로 사용.
 */
export async function getCheckedOutRecognizedRevenue(
  prisma: PrismaDb,
  propertyId: string,
  targetMonth: string,
): Promise<number> {
  const agg = await prisma.paymentRecord.aggregate({
    where: {
      propertyId, targetMonth, isDeposit: false, isPrevOwner: false,
      leaseTerm: { status: 'CHECKED_OUT' },
    },
    _sum: { actualAmount: true },
  })
  return agg._sum.actualAmount ?? 0
}

/**
 * 예약 확정(RESERVED) lease 의 그 달 예상 매출 — 입주 예정월이 그 달 이내면 전액(할인·예약 인상 반영).
 * (사용자 결정 2026-06-20: RESERVED 이상은 그 달 전액으로 예상 매출에 반영. 입주 후엔 ACTIVE 로 일반 청구.)
 *
 * dashboard/page.tsx 안에 갇혀 있던 계산을 문자 그대로 옮긴 것이다(2026-08-07). 수납 관리 화면이
 * 홈 예상 수입과의 차이를 등식 캡션으로 적으려면 같은 값을 같은 식으로 구해야 한다 — 한쪽이
 * 자기 식을 만드는 순간 두 화면 숫자가 다시 갈린다.
 */
export async function getReservedFullMonthRevenue(
  prisma: PrismaDb,
  propertyId: string,
  targetMonth: string,
): Promise<number> {
  const reservedLeases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: 'RESERVED', rentAmount: { gt: 0 } },
    select: {
      id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
    },
  })
  // 이번달(targetMonth) 청구 대상 여부 — 입주월 ≤ 대상월 ≤ 퇴실월.
  // (다음달 입주 예정인 계약이 이번달 예상매출에 잡히던 버그 방지: 507·509호 사례)
  const monthOfDate = (d: Date | string | null): string | null => {
    if (!d) return null
    const dt = new Date(d)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }
  const billableInTargetMonth = (l: { moveInDate?: Date | string | null; expectedMoveOut?: Date | string | null }): boolean => {
    const mi = monthOfDate(l.moveInDate ?? null)
    if (mi && mi > targetMonth) return false   // 아직 입주 전
    const mo = monthOfDate(l.expectedMoveOut ?? null)
    if (mo && mo < targetMonth) return false   // 이미 퇴실
    return true
  }
  return reservedLeases
    .filter(l => billableInTargetMonth(l))
    .reduce((s, l) => s + billForLeaseMonth(l, targetMonth, null), 0)
}
