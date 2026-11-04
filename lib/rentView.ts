// 계약 정보 '월 이용료' 칸의 할인 후 금액. 청구 엔진의 요율 조각(기준액·할인)만 묶는 순수 함수.
//
// 운영자 요청(2026-11-04) "계약정보의 금액과 할인된 후의 금액 둘 다 표시되는게 안헷갈릴 것 같아", 승인 '추천대로'.
// 주 값은 계약 금액(lease.rentAmount) 그대로이고, 이번 달 할인이 실제로 걸리는 계약에만 그 아래 '할인 후 N' 한 줄을 둔다.
//
// 새 계산은 없다. 청구 엔진(billForLeaseMonth ④·viewExpectedForMonth)이 쓰는 두 조각을 그대로 부른다.
//   기준액 base   = effectiveBaseRent(lease, mon)        예약 인상·비거주 축 반영
//   할인 합계     = discountForMonth(discounts, mon, base) 기간 판정·비율 반올림·상한
//   할인 후 net   = discountedRent(discounts, mon, base)
// 일할(퇴실·첫 달)·락은 섞지 않는다. 이 칸이 말하는 것은 그 달 청구가 아니라 그 달 요율이다
// (입주달에 '할인 후 23만원' 이 뜨면 할인이 아니라 일할이 섞인 숫자다).
import { effectiveBaseRent, monthOfDate, type BillingLeaseFields } from './billing'
import { discountForMonth, discountedRent } from './rentDiscount'

export type RentViewLease = Omit<BillingLeaseFields, 'dueDayAdjusts' | 'cycleDay'>

export type MonthlyRentView = { base: number; discount: number; net: number }

/** 그 달 요율 셋. 세 값 모두 엔진 함수의 반환 그대로다. */
export function monthlyRentView(lease: RentViewLease, mon: string): MonthlyRentView {
  const base = effectiveBaseRent(lease, mon)
  return {
    base,
    discount: discountForMonth(lease.discounts, mon, base),
    net: discountedRent(lease.discounts, mon, base),
  }
}

// 줄을 세우는 상태. 청구가 생기는(또는 곧 생기는) 계약만이다. 문의·투어·취소 단계는 할인을 말할 청구가 없다.
const RENT_VIEW_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'RESERVED']

/**
 * '이번 달' 이 어느 달인가. 기본은 오늘(KST)의 달이다.
 * 단기는 입주월에 한 번만 청구되므로 입주월, 예약은 입주월이 미래면 입주월(청구가 처음 생기는 달)이다.
 * 줄을 세우지 않는 상태면 null.
 */
export function rentViewMonth(
  lease: { status: string; isShortTerm?: boolean; moveInDate?: Date | string | null },
  todayMonth: string,
): string | null {
  if (!RENT_VIEW_STATUSES.includes(lease.status)) return null
  const inMonth = monthOfDate(lease.moveInDate ?? null)
  if (lease.isShortTerm && inMonth) return inMonth
  if (lease.status === 'RESERVED' && inMonth && inMonth > todayMonth) return inMonth
  return todayMonth
}

/**
 * 칸 아래 '할인 후 N' 의 N. 줄을 세우지 않으면 null.
 *
 * 세우는 조건은 둘이다. 할인 표시는 순수 할인일 때만 선다.
 *   ① 이번 달 할인이 실제로 걸린다(discount > 0).
 *   ② 그 달 기준액이 주 값(계약 금액)과 같다(base === contract).
 * ② 는 예약 가격 변경이 기준액에 먼저 들어오고 계약 금액은 나중에 옮겨지는 틈 때문에 있다
 * (knowledge/domain-billing 절 "두 개의 '월 이용료' 소스"). 틈은 두 구간이다.
 *   가. effectiveBaseRent 는 달 단위라 적용 달에 들어서면 적용일 전이라도 그 달 기준액이 예약가다.
 *       계약 금액은 적용일이 지나야 옮겨진다(lib/scheduledRent 는 rentUpdateDate <= 오늘 만 처리).
 *   나. 적용일이 지나도 스케줄러는 호실·홈·고객 페이지를 열 때만 돈다. 그 전까지 계약 금액은 옛값이다.
 * 이 틈에서 줄을 세우면 가격 변경이 할인처럼 읽힌다. 계약 47만원 · 예약 45만원 · 할인 3만원이면 '할인 후 42만원' 이
 * 5만원 할인으로 읽히고, 예약 50만원이면 '47만원 / 할인 후 47만원' 이 된다. 그래서 줄을 세우지 않는다(칸은 지금 화면 그대로).
 * 줄이 서면 N 은 계약 금액 - 할인이고, 그 달 엔진 요율과 같다. 진리표 scripts/test-rent-view.ts.
 */
export function rentAfterDiscountLine(contract: number, view: MonthlyRentView): number | null {
  if (view.discount <= 0) return null
  if (view.base !== contract) return null
  return view.net
}

/** 서버 한 자리(getTenantDetail)가 부르는 묶음. 금액 스코프 판정은 호출부가 한다. */
export function rentAfterDiscountFor(lease: RentViewLease & { isShortTerm?: boolean }, todayMonth: string): number | null {
  const mon = rentViewMonth(lease, todayMonth)
  if (!mon) return null
  return rentAfterDiscountLine(lease.rentAmount, monthlyRentView(lease, mon))
}
