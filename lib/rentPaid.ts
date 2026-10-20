// 이용료 실입금 판정 정본 — "이 계약의 이 달에 돈이 실제로 들어왔는가" 한 물음에 답한다.
//
// 같은 판정이 세 자리에서 필요해졌다. 발급 화면이 확인서 금액을 채울 때, 서류 시트가 '이번 달
// 확인서 작성' 문을 열지 정할 때, 감사 규칙이 스냅샷과 대조할 때다. 사본을 두면 한 자리만
// 고쳐지는 날이 오고, 그때 문은 열렸는데 금액은 0 이거나 그 반대가 된다.
//
// 판정의 뜻.
//   · 귀속월(targetMonth) 기준이다 — 이 앱의 매출 축이 발생주의이고 확인서도 '그 달의 사실'을
//     증명하는 종이다. 입금일(payDate)이 아니다.
//   · 보증금(isDeposit)은 이용료가 아니다.
//   · 양도인 몫(isPrevOwner)은 이 사업자의 수입이 아니다.
//   · **조정 전표(isBillingAdjust)는 실입금이 아니다.** 청구액을 고치는 종이지 들어온 돈이
//     아니라, 이것을 세면 받지도 않은 달에 확인서 문이 열린다.
//   · 금액이 0 이하면 실입금이 아니다(환불로 0 이 된 행 포함).
//   · **납입일 변경 조정 행은 실입금이 아니다**(신고 df82ce57, 2026-10-20). 받을 돈을 고치는 장부 줄이다.
//     추가납부(음수)는 위 금액 조건이 이미 빼지만, 부호가 뒤집혀 양수가 된 조정 행(513호 +130,000)은 확인서에
//     480,000원으로 잡혔다. 돌려줄 금액(양수 조정)도 들어온 돈이 아니다. 판정은 lib/dueDayAdjust 정본.
//
// 소프트삭제는 최상위 조회의 자동 필터가 걸러 준다(중첩 관계 조회는 안 걸리므로 그때는 손수 적는다).
import { isDueDayAdjust, notDueDayAdjustWhere } from './dueDayAdjust'

/** 실입금 record 인가 — 이미 읽어 둔 행을 거를 때 쓴다. */
export function isRealRentPayment(r: { isBillingAdjust: boolean; actualAmount: number; memo: string | null }): boolean {
  return !r.isBillingAdjust && r.actualAmount > 0 && !isDueDayAdjust(r.memo)
}

/**
 * 이 달 실입금을 찾는 Prisma where 조각.
 *
 * `leaseTermIds` 를 안 넘기면 계약 조건을 안 건다(부르는 쪽이 다른 축으로 좁힌다는 뜻).
 * 금액 조건까지 DB 에 실어 보내므로 결과가 곧 "실입금이 있는 행"이다.
 */
export function rentPaidWhere(month: string, leaseTermIds?: readonly string[]) {
  return {
    ...(leaseTermIds ? { leaseTermId: { in: [...leaseTermIds] } } : {}),
    targetMonth: month,
    isDeposit: false,
    isPrevOwner: false,
    isBillingAdjust: false,
    actualAmount: { gt: 0 },
    ...notDueDayAdjustWhere(),
  }
}
