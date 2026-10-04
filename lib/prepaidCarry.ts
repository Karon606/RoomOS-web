// 조회 월 M 기준 '지난달에서 넘어온 선납(prepaidIn)'과 '다음 달 이후로 넘어가는 선납(prepaidOut)'을 세는 순수 함수
//
// 왜 필요한가(2026-10-05 운영자 신고, 502호). 매달 1,500원씩 더 내 이월시키는데 이월액 카드는 늘 0원이었다.
// 이월액(carryOver)은 '앞 달 귀속 수납 − 앞 달 청구'라, FIFO 저장이 앞 달을 정확히 채우고 남은 돈을
// 다음 달 record(targetMonth > 입금월)로 밀어 두는 한 거의 0 이다. 넘긴 돈은 귀속월 축에서는
// 다음 달 몫이고, 입금일 축에서는 이번 달에 받은 돈이다. 두 축이 갈리는 그 몫을 여기서 센다.
//
// 정의(축은 둘 — 귀속월 targetMonth 와 입금월 = payDate 의 달).
//   prepaidIn(M)  = targetMonth === M 이고 입금월 < M 인 금액 합   (지난달에 미리 받아 이 달분을 채운 돈)
//   prepaidOut(M) = targetMonth  >  M 이고 입금월 ≤ M 인 금액 합   (이 달까지 받은 돈 중 다음 달 이후분)
//   outByMonth    = prepaidOut 를 귀속월별로 나눈 것
// 보증금(isDeposit)·청구 조정 전표(isBillingAdjust)는 수납이 아니라 제외한다.
//
// 항등(테스트가 지킨다).
//   outByMonth(M)[M+1] === prepaidIn(M+1)   — 늘 성립한다(같은 집합을 두 쪽에서 센 것).
//   prepaidOut(M)      === prepaidIn(M+1)   — 선납이 바로 다음 달 하나에만 걸릴 때만 성립한다.
//     M 까지 받은 돈이 M+2 이후까지 퍼져 있으면 prepaidOut(M) 이 그만큼 더 크다. 그 몫은 M+1 화면에서
//     다시 prepaidOut(M+1) 로 이어진다(M+2 몫은 M+1 에서도 여전히 '다음 달 이후분'이다).
//
// 입금월은 lib/kstDate dbDateMonthKey 로만 뽑는다 — payDate 는 @db.Date(UTC 자정 저장)라
// 로컬 게터(getMonth)를 쓰면 실행 환경 타임존만큼 달이 밀린다.

import { dbDateMonthKey } from './kstDate'

export type PrepaidCarryRecord = {
  targetMonth: string
  payDate: Date | string
  actualAmount: number
  isDeposit?: boolean | null
  isBillingAdjust?: boolean | null
}

export type PrepaidCarry = {
  prepaidIn: number
  prepaidOut: number
  outByMonth: Record<string, number>
}

export function prepaidCarry(records: readonly PrepaidCarryRecord[], month: string): PrepaidCarry {
  let prepaidIn = 0
  let prepaidOut = 0
  const outByMonth: Record<string, number> = {}
  for (const r of records) {
    if (r.isDeposit || r.isBillingAdjust) continue
    const payMonth = dbDateMonthKey(r.payDate)
    if (r.targetMonth === month && payMonth < month) prepaidIn += r.actualAmount
    else if (r.targetMonth > month && payMonth <= month) {
      prepaidOut += r.actualAmount
      outByMonth[r.targetMonth] = (outByMonth[r.targetMonth] ?? 0) + r.actualAmount
    }
  }
  return { prepaidIn, prepaidOut, outByMonth }
}
