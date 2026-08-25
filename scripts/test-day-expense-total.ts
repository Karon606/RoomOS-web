// 날짜별 합계 문구 회귀 — lib/dayExpenseTotal. 실행: npx tsx scripts/test-day-expense-total.ts
//
// 고정하는 것(오류신고 6e358d34). 예정만 있는 날에 '합계 0원'을 적지 않는다. 실지출과 예정을
// 더하지 않는다(추정이 장부 숫자에 섞이면 f7b0292a 로 되돌아간다).
import { dayTotalText } from '../lib/dayExpenseTotal'

const won = (n: number) => `${n.toLocaleString()}원`
let pass = 0, fail = 0
const eq = (name: string, got: string, want: string) => {
  if (got === want) { pass++; return }
  fail++; console.log(`  실패 ${name}\n    기대 ${want}\n    실제 ${got}`)
}

eq('실지출만', dayTotalText({ actual: 50000, planned: 0 }, '합계', won), '합계 50,000원')
// 신고의 실제 모양 — 8/28 은 예정만 있었고 머리가 '합계 0원' 이었다.
eq('예정만이면 0원 합계를 안 적는다', dayTotalText({ actual: 0, planned: 1050500 }, '합계', won), '예정 1,050,500원')
// 같은 신고의 혼합일 — 8/25 실지출은 맞게 떴고 예정 31,900원이 어디에도 없었다.
eq('혼합일은 병기', dayTotalText({ actual: 50000, planned: 31900 }, '합계', won), '합계 50,000원 · 예정 31,900원')
eq('둘 다 0이면 합계만', dayTotalText({ actual: 0, planned: 0 }, '합계', won), '합계 0원')
eq('데스크톱 접두', dayTotalText({ actual: 0, planned: 31900 }, '해당일 합계', won), '예정 31,900원')
eq('데스크톱 병기', dayTotalText({ actual: 1000, planned: 2000 }, '해당일 합계', won), '해당일 합계 1,000원 · 예정 2,000원')
// **더하지 않는다** — 합치면 추정이 장부 숫자가 된다.
eq('둘을 더하지 않는다', dayTotalText({ actual: 100, planned: 200 }, '합계', won), '합계 100원 · 예정 200원')

console.log(`[날짜별 합계 문구] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
