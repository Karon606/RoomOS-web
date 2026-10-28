// 재고 소모 추이 표기 진리표(신고 9d26a7ee). 진행 중인 달 라벨, 하루당, 캡션. 실패 시 exit 1.
// 실행: npx tsx scripts/test-consumption-series.ts
import { showsBarValues, bucketReadout, bucketTitle, perDayText, partialMonthTail, perDayCaption, bucketKey, shiftKey, trendWindow, windowSummary, trendCompare, dayViewNote, intervalConsumption, dedupSameDay, type MonthSlot, type SeriesInterval } from '../app/(app)/inventory/consumptionSeries'

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


// ④ 칸 열쇠·이동. 주는 월요일 시작.
eq('④ 연', bucketKey('2026-10-23', 'year'), '2026')
eq('④ 분기', bucketKey('2026-10-23', 'quarter'), '2026-Q4')
eq('④ 월', bucketKey('2026-10-23', 'month'), '2026-10')
eq('④ 주(금요일 → 그 주 월요일)', bucketKey('2026-10-23', 'week'), '2026-10-19')
eq('④ 주(일요일은 앞 월요일)', bucketKey('2026-10-25', 'week'), '2026-10-19')
eq('④ 일', bucketKey('2026-10-23', 'day'), '2026-10-23')
eq('④ 분기 해 넘김', shiftKey('2026-Q1', 'quarter', -1), '2025-Q4')
eq('④ 월 해 넘김', shiftKey('2026-01', 'month', -1), '2025-12')
eq('④ 주 이동', shiftKey('2026-10-19', 'week', 1), '2026-10-26')

// ⑤ 창. 귀속은 구간 끝 날짜, 미관측은 null, 진행 중 칸 꼬리, 앞뒤 여부.
const IV: SeriesInterval[] = [
  { start: '2026-08-29', end: '2026-08-31', consumed: 12, days: 2 },
  { start: '2026-08-31', end: '2026-09-30', consumed: 190, days: 30 },
  { start: '2026-09-30', end: '2026-10-22', consumed: 132, days: 22 },
  { start: '2026-10-22', end: '2026-10-23', consumed: 6, days: 1 },
]
{
  const w = trendWindow(IV, 'month', '2026-10-25', 0)
  eq('⑤ 월 12칸(1년치, 2026-10-28 운영자 결정)', w.buckets.length, 12)
  eq('⑤ 끝 칸이 이번 달', w.buckets[11].key, '2026-10')
  eq('⑤ 10월 합·일수·구간', [w.buckets[11].qty, w.buckets[11].days, w.buckets[11].n, w.buckets[11].oneDay], [138, 23, 2, 1])
  eq('⑤ 10월 꼬리', w.buckets[11].tail, '23일까지')
  eq('⑤ 9월은 꼬리 없음', w.buckets[10].tail, null)
  eq('⑤ 관측 없는 달은 null', w.buckets[0].qty, null)
  eq('⑤ 앞 창 없음(첫 구간이 창 안)', w.hasPrev, false)
  eq('⑤ 최근 창은 다음 없음', w.hasNext, false)
  eq('⑤ 범위 글(해가 다르면 둘 다 연도)', w.range, '2025년 11월 ~ 2026년 10월')
  eq('⑤ 범위 글(같은 해면 뒤 연도 생략)', trendWindow(IV, 'month', '2026-12-10', 0).range, '2026년 1월 ~ 12월')
  eq('⑤ 해가 다르면 둘 다 연도', trendWindow(IV, 'month', '2026-03-10', 0).range, '2025년 4월 ~ 2026년 3월')
  eq('⑤ 해가 바뀌는 월 칸 둘째 줄에 연도', trendWindow(IV, 'month', '2026-03-10', 0).buckets.map(b => b.tail), [null, null, null, null, null, null, null, null, null, '2026년', null, null])
  eq('⑤ 일 범위는 점 날짜', trendWindow(IV, 'day', '2026-10-25', 0).range, '2026.10.12 ~ 10.25')
  eq('⑤ 주 범위는 첫 월요일 ~ 끝 일요일', trendWindow(IV, 'week', '2026-10-25', 0).range, '2026.8.31 ~ 10.25')
  eq('⑤ 분기 범위(해가 다름)', trendWindow(IV, 'quarter', '2026-10-25', 0).range, '25년 1분기 ~ 26년 4분기')
  eq('⑤ 연 범위', trendWindow(IV, 'year', '2026-10-25', 0).range, '2022년 ~ 2026년')
  eq('⑤ 비교 줄', trendCompare(w.buckets, 'month', 0, '봉'), '이번 달 하루 6.0봉 · 지난달 6.3봉')
  eq('⑤ 지난 창에서는 비교 줄 없음', trendCompare(w.buckets, 'month', 1, '봉'), null)
  eq('⑤ 요약 줄', windowSummary(w.buckets, '봉', q => `${q}봉`), '합계 340봉 · 하루 6.2봉 · 점검 구간 4개')
}
{
  const w = trendWindow(IV, 'quarter', '2026-10-25', 0)
  eq('⑤ 분기 꼬리는 월/일', w.buckets[7].tail, '10/23까지')
  eq('⑤ 3분기 합(구간 끝 날짜 귀속)', w.buckets[6].qty, 202)
}
{
  const w = trendWindow(IV, 'day', '2026-10-25', 0)
  const b22 = w.buckets.find(b => b.key === '2026-10-22')!
  eq('⑤ 일 단위 여러 날 구간은 띠(창 시작에서 자름)', [b22.qty, b22.span], [132, 11])
  eq('⑤ 하루 구간 띠 폭 1', w.buckets.find(b => b.key === '2026-10-23')!.span, 1)
  eq('⑤ 일 단위는 꼬리 없음', w.buckets.every(b => b.tail == null), true)
  eq('⑤ 일 단위 표본 줄', dayViewNote(w.buckets), '하루 간격 점검 1일 · 여러 날 묶인 구간 1개. 옅은 띠는 여러 날 구간이고 높이는 그 구간의 하루 평균입니다.')
  eq('⑤ 일 단위는 비교 줄 없음', trendCompare(w.buckets, 'day', 0, '봉'), null)
  eq('⑤ 앞 창 있음', w.hasPrev, true)
}
{
  const w = trendWindow(IV, 'month', '2026-10-25', 1)
  eq('⑤ 앞 창 범위', w.range, '2024년 11월 ~ 2025년 10월')
  eq('⑤ 분기 해 바뀜 칸 연도', trendWindow(IV, 'quarter', '2026-10-25', 0).buckets[4].tail, '2026년')
  eq('⑤ 앞 창은 다음 있음', w.hasNext, true)
}
eq('⑤ 주 칸 이름은 달이 바뀌는 칸만 월/일', trendWindow(IV, 'week', '2026-10-25', 0).buckets.map(b => b.label), ['8/31', '9/7', '14', '21', '28', '10/5', '12', '19'])
eq('⑤ 음수 칸은 0(사용량은 음수일 수 없다)', trendWindow([{ start: '2026-10-01', end: '2026-10-02', consumed: -5, days: 1 }], 'month', '2026-10-25', 0).buckets[11].qty, 0)

// ⑥ 구간 셈 정본(개요와 공용). 보정 구간 제외, 입고 상쇄(부호 그대로), 같은 날 dedup.
{
  const d = (ymd: string, hh = 12) => new Date(`${ymd}T${String(hh).padStart(2, '0')}:00:00Z`)
  const day = (ymd: string) => new Date(`${ymd}T00:00:00Z`)
  const checks = dedupSameDay([
    { date: day('2026-10-01'), createdAt: d('2026-10-01', 1), remainingQty: 100 },
    { date: day('2026-10-02'), createdAt: d('2026-10-02', 1), remainingQty: 80 },
    { date: day('2026-10-02'), createdAt: d('2026-10-02', 3), remainingQty: 90 },   // 같은 날 늦은 점검이 이긴다
    { date: day('2026-10-04'), createdAt: d('2026-10-04', 1), remainingQty: 70, isReconcile: true },
    { date: day('2026-10-05'), createdAt: d('2026-10-05', 1), remainingQty: 160 },
  ])
  const iv = intervalConsumption({
    checks,
    purchases: [{ receivedAt: d('2026-10-04', 6), qtyUnit: null, qtyValue: 100, specValue: null, specUnit: null }],
    adds: [], disps: [], qtyUnit: null, useSpec: false, specUnit: null,
  })
  eq('⑥ 보정으로 끝나는 구간은 빠진다', iv.length, 2)
  eq('⑥ 같은 날 dedup 뒤 첫 구간', [iv[0].consumed, iv[0].days], [10, 1])
  eq('⑥ 입고 구간은 부호 그대로(70 + 100 - 160 = 10)', [iv[1].consumed, iv[1].days], [10, 1])
}

// ⑦ 칸이 많으면 막대 위 숫자 대신 고른 칸 읽기 줄(2026-10-28 운영자 결정, 월 12칸).
eq('⑦ 월·일은 막대 숫자 없음', [showsBarValues('month'), showsBarValues('day')], [false, false])
eq('⑦ 연·분기·주는 막대 숫자', [showsBarValues('year'), showsBarValues('quarter'), showsBarValues('week')], [true, true, true])
{
  const w = trendWindow(IV, 'month', '2026-10-25', 0)
  eq('⑦ 진행 중 칸 읽기', bucketReadout(w.buckets[11], 'month', '봉', q => `${q}봉`), '2026년 10월 · 138봉 · 하루 6.0봉 · 23일까지')
  eq('⑦ 지난 칸 읽기(꼬리 없음)', bucketReadout(w.buckets[10], 'month', '봉', q => `${q}봉`), '2026년 9월 · 190봉 · 하루 6.3봉')
  eq('⑦ 미관측 칸 읽기', bucketReadout(w.buckets[0], 'month', '봉', q => `${q}봉`), '2025년 11월 · 점검 기록 없음')
  const y = trendWindow(IV, 'month', '2026-03-10', 0)
  eq('⑦ 해 바뀜 연도는 읽기 줄에 꼬리로 안 붙는다', bucketReadout(y.buckets[9], 'month', '봉', q => `${q}봉`), '2026년 1월 · 점검 기록 없음')
}
eq('⑦ 칸 이름', ['2026', '2026-Q4', '2026-10', '2026-10-19', '2026-10-27'].map((k, i) => bucketTitle(k, (['year', 'quarter', 'month', 'week', 'day'] as const)[i])), ['2026년', '2026년 4분기', '2026년 10월', '2026.10.19 주', '2026.10.27'])

console.log(`[소모 추이 표기] 통과 ${pass} / 실패 ${fails.length}`)
for (const f of fails) console.log('  - ' + f)
process.exit(fails.length ? 1 : 0)
