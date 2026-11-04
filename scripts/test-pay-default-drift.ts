// 정가 기본값 이월 감지 판정(lib/payDefaultDrift) 진리표 — 404·514·509호 실제 모양을 표본으로 고정한다. 실행: npx tsx scripts/test-pay-default-drift.ts
import { bundlePayments, isListPriceCarry, overLockMonths, type DriftRecord } from '../lib/payDefaultDrift'

let pass = 0, fail = 0
const eq = (name: string, a: unknown, e: unknown) => {
  if (JSON.stringify(a) === JSON.stringify(e)) pass++
  else { fail++; console.log(`실패: ${name}\n  기대 ${JSON.stringify(e)}\n  실제 ${JSON.stringify(a)}`) }
}
let n = 0
const R = (lease: string, month: string, exp: number, act: number, date: string, at: number, method = '계좌이체'): DriftRecord =>
  ({ id: `r${++n}`, leaseTermId: lease, targetMonth: month, expectedAmount: exp, actualAmount: act, payDate: date, payMethod: method, createdAt: at })

// 404호: 11/1 470,000 → 10월 440,000 + 11월 30,000(정가 끝전 이월). 운영 기록 그대로의 모양.
const b404 = [R('L404', '2026-10', 440_000, 440_000, '2026-11-01', 1000), R('L404', '2026-11', 470_000, 30_000, '2026-11-01', 1500)]
eq('404 묶음은 한 결제', bundlePayments(b404).length, 1)
eq('404 정가 끝전 이월로 잡힌다', isListPriceCarry(bundlePayments(b404)[0], 470_000), true)
// 514호: 9/24 350,000 → 9월 340,000 + 10월 10,000(운영자 확인 결과 실입금 350,000, 정상 선납이지만 모양은 같다 → 목록에 서고 허용 목록으로 넘긴다)
const b514 = [R('L514', '2026-09', 340_000, 340_000, '2026-09-24', 2000), R('L514', '2026-10', 340_000, 10_000, '2026-09-24', 2400)]
eq('514 모양도 잡힌다(허용 목록 대상)', isListPriceCarry(bundlePayments(b514)[0], 350_000), true)
// 정상: 할인가 그대로 받은 한 달(나뉘지 않음)
eq('한 달만 적힌 결제는 아니다', isListPriceCarry([R('L1', '2026-10', 440_000, 440_000, '2026-10-31', 3000)], 470_000), false)
// 정상: 두 달 치를 받아 두 달 완납(마지막 달이 끝전이 아니다)
eq('두 달 완납 선납은 아니다', isListPriceCarry([R('L2', '2026-10', 440_000, 440_000, '2026-10-31', 4000), R('L2', '2026-11', 470_000, 470_000, '2026-10-31', 4100)], 470_000), false)
// 정상: 정가 달(할인 없음)에 조금 더 낸 선납 — 첫 달 청구가 정가라 (나)가 아니다
eq('정가 달의 끝전 선납은 아니다', isListPriceCarry([R('L3', '2026-11', 470_000, 440_000, '2026-11-05', 5000), R('L3', '2026-12', 470_000, 30_000, '2026-11-05', 5100)], 470_000), false)
// 묶음 가르기: 수단이 다르거나 5초 넘게 떨어지면 다른 결제
eq('수단이 다르면 다른 결제', bundlePayments([R('L4', '2026-10', 1, 1, '2026-10-01', 0), R('L4', '2026-11', 1, 1, '2026-10-01', 100, '현금')]).length, 2)
eq('5초 넘게 떨어지면 다른 결제', bundlePayments([R('L5', '2026-10', 1, 1, '2026-10-01', 0), R('L5', '2026-11', 1, 1, '2026-10-01', 6000)]).length, 2)
// 509호: 10월 한 행 470,000, 락 440,000(4분 뒤 수정 폼에서 금액을 올린 흔적) → (다)
eq('509 한 달 수납 합 > 락', overLockMonths([R('L509', '2026-10', 440_000, 470_000, '2026-10-14', 7000)]), [{ leaseTermId: 'L509', targetMonth: '2026-10', paid: 470_000, lock: 440_000 }])
eq('나눠 낸 완납은 락을 넘지 않는다', overLockMonths([R('L6', '2026-10', 340_000, 10_000, '2026-09-24', 0), R('L6', '2026-10', 340_000, 330_000, '2026-10-26', 9e9)]), [])

console.log(`\n정가 기본값 이월 감지: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
