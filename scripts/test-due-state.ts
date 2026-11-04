// 기한 상태 정본(lib/dueState) 진리표. 납부일 전 · 납부일 당일 · 미납 세 상태와 기한 날짜 고르기를 고정한다. 실행 npx tsx scripts/test-due-state.ts
//
// 운영자 원문(2026-11-04) "납부일 당일은 납부일 당일이라고 표시하는게 좋을 것 같아. 납기 전도 아니고 미납도 아니고", 승인 '추천대로'.
// 고정하는 것
//   · 11/3 · 11/4 · 11/5 가 납부일 4일 계약에서 납부일 전 · 납부일 당일 · 미납
//   · 말일·31일 없는 달·평년과 윤년 2월 29일은 그 달 말일로 접는다(다음 달로 넘기지 않는다, 종전 넘침 3/1 봉합)
//   · 유예 날짜 당일은 유예가 아니라 납부일 당일, 첫 달 기한(입주일) 당일도 납부일 당일
//   · 기한을 못 읽으면(null) 지난 달은 미납, 이번 달·앞 달은 납부일 전(한 규칙)
//   · KST 자정 경계(UTC 14:59:59 는 전날, 15:00:00 은 그날)
import {
  dueStateOf, daysPastDue, dueYmdForMonth, dueYmdOfLeaseMonth, scheduledDueYmd, monthDueState,
  leaseMonthDueState, deferredDueYmd, ymdOfParts,
} from '../lib/dueState'
import { kstYmdStr, kstYmd } from '../lib/kstDate'

let pass = 0
const fails: string[] = []
function eq(label: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) pass++
  else fails.push(`${label}: 기대 ${b} / 실제 ${a}`)
}
function throws(label: string, fn: () => unknown) {
  try { fn(); fails.push(`${label}: 던지지 않았다`) } catch { pass++ }
}

// ── 1. 세 상태(납부일 4일, 11월) ──
const L4 = { dueDay: '4' }
eq('11/3 납부일 전', leaseMonthDueState(L4, '2026-11', '2026-11-03'), 'before')
eq('11/4 납부일 당일', leaseMonthDueState(L4, '2026-11', '2026-11-04'), 'today')
eq('11/5 미납', leaseMonthDueState(L4, '2026-11', '2026-11-05'), 'overdue')
eq('경과일 11/3', daysPastDue('2026-11-04', '2026-11-03'), -1)
eq('경과일 11/4', daysPastDue('2026-11-04', '2026-11-04'), 0)
eq('경과일 11/5', daysPastDue('2026-11-04', '2026-11-05'), 1)
eq('경과일 8일 연체 경계', daysPastDue('2026-11-04', '2026-11-12'), 8)
eq('경과일 달 경계', daysPastDue('2026-10-31', '2026-11-01'), 1)
eq('경과일 해 경계', daysPastDue('2026-12-31', '2027-01-01'), 1)
eq('해 경계 상태', dueStateOf('2026-12-31', '2027-01-01'), 'overdue')
throws('날짜 모양이 아니면 던진다(문자열 비교 함정 2026-11-4)', () => dueStateOf('2026-11-4', '2026-11-04'))

// ── 2. 기한 날짜(말일·클램프) ──
eq('말일 11월', dueYmdForMonth('말일', '2026-11'), '2026-11-30')
eq('말일 평년 2월', dueYmdForMonth('말일', '2027-02'), '2027-02-28')
eq('말일 윤년 2월', dueYmdForMonth('말일', '2028-02'), '2028-02-29')
eq('31일 납부 4월', dueYmdForMonth('31', '2026-04'), '2026-04-30')
eq('31일 납부 6월', dueYmdForMonth('31', '2026-06'), '2026-06-30')
eq('31일 납부 9월', dueYmdForMonth('31', '2026-09'), '2026-09-30')
eq('31일 납부 11월', dueYmdForMonth('31', '2026-11'), '2026-11-30')
eq('31일 납부 평년 2월', dueYmdForMonth('31', '2027-02'), '2027-02-28')
eq('29일 납부 평년 2월(넘침 3/1 아님)', dueYmdForMonth('29', '2027-02'), '2027-02-28')
eq('29일 납부 윤년 2월', dueYmdForMonth('29', '2028-02'), '2028-02-29')
eq('전체 날짜형 그대로', dueYmdForMonth('2026-11-07', '2026-10'), '2026-11-07')
eq('없는 날짜는 null', dueYmdForMonth('2026-02-30', '2026-02'), null)
eq('빈 값 null', dueYmdForMonth(null, '2026-11'), null)
eq('읽을 수 없으면 null', dueYmdForMonth('abc', '2026-11'), null)
eq('0일 null', dueYmdForMonth('0', '2026-11'), null)
// 2027-02-28 이 29일 납부 계약의 납부일 당일이다(종전 홈은 넘침으로 3/1 까지 '납부일 전'이었다)
eq('29일 납부 2027-02-28 당일', leaseMonthDueState({ dueDay: '29' }, '2027-02', '2027-02-28'), 'today')
eq('말일 납부 11/30 당일', leaseMonthDueState({ dueDay: '말일' }, '2026-11', '2026-11-30'), 'today')
eq('31일 납부 11/30 당일', leaseMonthDueState({ dueDay: '31' }, '2026-11', '2026-11-30'), 'today')

// ── 3. 임시조정·유예 ──
// 10월분을 11/4 로 미룸(전체 날짜형, 같은 달에 건 조정)
const D = { dueDay: '4', overrideDueDay: '2026-11-04', overrideDueDayMonth: '2026-10' }
eq('유예 기한 11/4', dueYmdOfLeaseMonth(D, '2026-10'), '2026-11-04')
eq('유예 전날은 유예', deferredDueYmd(D, '2026-10', '2026-11-03'), '2026-11-04')
eq('유예 전날 상태 납부일 전', leaseMonthDueState(D, '2026-10', '2026-11-03'), 'before')
eq('유예 날짜 당일은 유예 아님', deferredDueYmd(D, '2026-10', '2026-11-04'), null)
eq('유예 날짜 당일 상태 납부일 당일', leaseMonthDueState(D, '2026-10', '2026-11-04'), 'today')
eq('유예 다음 날 미납', leaseMonthDueState(D, '2026-10', '2026-11-05'), 'overdue')
// 이후 달에 건 늦은 조정이 이 달 기한을 미룬다(2026-06-02 규칙), 원래보다 이르면 무시
eq('늦은 유예가 이 달 기한을 미룬다', dueYmdOfLeaseMonth({ dueDay: '20', overrideDueDay: '5', overrideDueDayMonth: '2026-11' }, '2026-10'), '2026-11-05')
eq('이른 조정은 이 달 기한을 안 바꾼다', dueYmdOfLeaseMonth({ dueDay: '20', overrideDueDay: '2026-10-15', overrideDueDayMonth: '2026-11' }, '2026-10'), '2026-10-20')
eq('그 달 직접 조정(앞당김)', dueYmdOfLeaseMonth({ dueDay: '20', overrideDueDay: '15', overrideDueDayMonth: '2026-11' }, '2026-11'), '2026-11-15')
eq('앞당김은 유예 아님', deferredDueYmd({ dueDay: '20', overrideDueDay: '15', overrideDueDayMonth: '2026-11' }, '2026-11', '2026-11-10'), null)
eq('같은 달 늦춤은 유예(416호형 2 → 7)', deferredDueYmd({ dueDay: '2', overrideDueDay: '7', overrideDueDayMonth: '2026-11' }, '2026-11', '2026-11-04'), '2026-11-07')
eq('조정 없는 다른 달은 원래 납부일', dueYmdOfLeaseMonth(D, '2026-11'), '2026-11-04')

// ── 4. 첫 달 기한(입주일) ──
const F = { dueDay: '20', moveInDate: '2026-11-04', cycleDay: null }
eq('첫 달 기한은 입주일', scheduledDueYmd(F, '2026-11'), '2026-11-04')
eq('첫 달 입주일 당일', leaseMonthDueState(F, '2026-11', '2026-11-04'), 'today')
eq('첫 달 입주 다음 날 미납', leaseMonthDueState(F, '2026-11', '2026-11-05'), 'overdue')
eq('둘째 달은 납부일', scheduledDueYmd(F, '2026-12'), '2026-12-20')
eq('첫 달 입주일 기한은 유예가 아니다', deferredDueYmd(F, '2026-11', '2026-11-03'), null)
// 납부일과 입주일이 같은 날이면 첫 달 규칙이 안 선다(그냥 납부일)
eq('입주일 = 납부일이면 납부일', scheduledDueYmd({ dueDay: '4', moveInDate: '2026-11-04', cycleDay: null }, '2026-11'), '2026-11-04')

// ── 5. 기한 null 규칙 ──
eq('null 지난 달 미납', monthDueState('2026-10', null, '2026-11-04'), 'overdue')
eq('null 이번 달 납부일 전', monthDueState('2026-11', null, '2026-11-04'), 'before')
eq('null 앞 달 납부일 전', monthDueState('2026-12', null, '2026-11-04'), 'before')
eq('계약 납부일 없음 이번 달', leaseMonthDueState({ dueDay: null }, '2026-11', '2026-11-04'), 'before')

// ── 6. KST 자정 경계 ──
eq('UTC 14:59:59 는 KST 전날', kstYmdStr(new Date('2026-11-03T14:59:59Z')), '2026-11-03')
eq('UTC 15:00:00 은 KST 그날', kstYmdStr(new Date('2026-11-03T15:00:00Z')), '2026-11-04')
eq('경계 직전 상태 납부일 전', leaseMonthDueState(L4, '2026-11', kstYmdStr(new Date('2026-11-03T14:59:59Z'))), 'before')
eq('경계 직후 상태 납부일 당일', leaseMonthDueState(L4, '2026-11', kstYmdStr(new Date('2026-11-03T15:00:00Z'))), 'today')
eq('ymdOfParts 는 kstYmd 와 같은 날', ymdOfParts(kstYmd(new Date('2026-11-03T15:00:00Z'))), '2026-11-04')

console.log(`\n기한 상태 정본: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
