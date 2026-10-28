// 재고 소모 추이 표기 진리표(신고 9d26a7ee). 진행 중인 달 라벨, 하루당, 캡션. 실패 시 exit 1.
// 실행: npx tsx scripts/test-consumption-series.ts
import { perDayText, partialMonthTail, perDayCaption, type MonthSlot } from '../app/(app)/inventory/consumptionSeries'

let pass = 0
const fails: string[] = []
const eq = (name: string, got: unknown, want: unknown) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++
  else fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const M = (month: string, qty: number | null, days: number | null, lastDate: string | null): MonthSlot => ({ month, qty, days, lastDate })

// ① 하루당. 소수 첫째 자리 고정, 분모는 그 달 구간 일수 합(신고 실측 9월 190봉 30일, 10월 138봉 23일).
eq('① 9월 6.3봉', perDayText(190, 30, '봉'), '6.3봉')
eq('① 10월 6.0봉(소수 고정)', perDayText(138, 23, '봉'), '6.0봉')
eq('① 일수 없음은 null', perDayText(10, null, '봉'), null)
eq('① 미관측은 null', perDayText(null, 30, '봉'), null)
eq('① 0일은 null', perDayText(5, 0, '봉'), null)
eq('① 단위 없음', perDayText(3, 2, null), '1.5')

// ② 진행 중인 달 꼬리. 마지막 슬롯이고 그 달 점검이 있을 때만.
eq('② 10월 23일까지', partialMonthTail(M('2026-10', 138, 23, '2026-10-23'), true), '23일까지')
eq('② 한 자리 날짜는 앞 0 없이', partialMonthTail(M('2026-11', 5, 2, '2026-11-02'), true), '2일까지')
eq('② 지난 달 슬롯은 없음', partialMonthTail(M('2026-09', 190, 30, '2026-09-30'), false), null)
eq('② 이번 달 미관측이면 없음', partialMonthTail(M('2026-10', null, null, null), true), null)
eq('② 끝 점검일이 다른 달이면 없음(방어)', partialMonthTail(M('2026-10', 5, 3, '2026-09-30'), true), null)

// ③ 캡션
const S = [M('2026-08', 158, 31, '2026-08-31'), M('2026-09', 190, 30, '2026-09-30'), M('2026-10', 138, 23, '2026-10-23')]
eq('③ 이번 달 · 지난달', perDayCaption(S, '봉'), '이번 달 하루 6.0봉 · 지난달 6.3봉')
eq('③ 지난달 미관측이면 앞 토막만', perDayCaption([M('2026-09', null, null, null), M('2026-10', 138, 23, '2026-10-23')], '봉'), '이번 달 하루 6.0봉')
eq('③ 이번 달 미관측이면 캡션 없음', perDayCaption([M('2026-09', 190, 30, '2026-09-30'), M('2026-10', null, null, null)], '봉'), null)
eq('③ 빈 시리즈', perDayCaption([], '봉'), null)
for (const c of [perDayCaption(S, '봉') ?? '']) if (/[—→!]/.test(c)) fails.push('③ 캡션에 금지 부호'); else pass++

console.log(`[소모 추이 표기] 통과 ${pass} / 실패 ${fails.length}`)
for (const f of fails) console.log('  - ' + f)
process.exit(fails.length ? 1 : 0)
