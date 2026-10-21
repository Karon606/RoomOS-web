// 납부일 해석 정본(lib/dueDate) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 전체 날짜형('YYYY-MM-DD')을 parseInt 로 읽어 연도(2026)가 날짜로 새는 클래스를 막는다(신고 998bff27).
import { resolveDueRaw, effectiveDueRawForMonth, dueDateForMonth, overrideAbsDate, isDeferredForMonth, dueDayForCutoff } from '../lib/dueDate'
import { cycleDayOf, cyclePeriodLabel, dueDayAfterCycle, hasSplitCycle, cycleDayAfterDueChange, dueOnlyEarlierRefused } from '../lib/dueDay'

let pass = 0
const fails: string[] = []
const ymd = (d: Date | null) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : 'null')

function eq(label: string, got: unknown, want: unknown) {
  if (got === want) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

// ── resolveDueRaw — 3포맷 ──────────────────────────────────
eq('일자형 15일', ymd(resolveDueRaw('15', 2026, 7)), '2026-07-15')
eq('말일 7월(31)', ymd(resolveDueRaw('말일', 2026, 7)), '2026-07-31')
eq('말일 2월 윤년(29)', ymd(resolveDueRaw('말일', 2028, 2)), '2028-02-29')
eq('말일 2월 평년(28)', ymd(resolveDueRaw('말일', 2026, 2)), '2026-02-28')
eq('일자형 말일 클램프(31->30)', ymd(resolveDueRaw('31', 2026, 6)), '2026-06-30')
eq('전체 날짜형은 그대로', ymd(resolveDueRaw('2026-08-07', 2026, 7)), '2026-08-07')
eq('전체 날짜형은 연·월 인자 무시', ymd(resolveDueRaw('2026-08-07', 2027, 1)), '2026-08-07')
eq('빈 값', resolveDueRaw(null, 2026, 7), null)
eq('숫자 아님', resolveDueRaw('없음', 2026, 7), null)

// ── 심원재 케이스(월 경계 유예) ────────────────────────────
const shim = { dueDay: '말일', overrideDueDay: '2026-08-07', overrideDueDayMonth: '2026-07' }
eq('조정월의 원문', effectiveDueRawForMonth(shim, '2026-07'), '2026-08-07')
eq('조정월 납부일 = 8/7', ymd(dueDateForMonth(shim, '2026-07')), '2026-08-07')
eq('다음 달은 원래대로 8/31', ymd(dueDateForMonth(shim, '2026-08')), '2026-08-31')
eq('이전 달도 원래대로 6/30', ymd(dueDateForMonth(shim, '2026-06')), '2026-06-30')
eq('절대 날짜 해석', ymd(overrideAbsDate(shim)), '2026-08-07')
eq('유예 판정 = 참', isDeferredForMonth(shim, '2026-07'), true)
eq('다른 달은 유예 아님', isDeferredForMonth(shim, '2026-08'), false)

// ── 같은 달 안에서 미룬 케이스(일자형으로 저장됨) ──────────
const sameMon = { dueDay: '19', overrideDueDay: '24', overrideDueDayMonth: '2026-07' }
eq('같은 달 조정 = 7/24', ymd(dueDateForMonth(sameMon, '2026-07')), '2026-07-24')
eq('같은 달 조정 유예 판정', isDeferredForMonth(sameMon, '2026-07'), true)
eq('같은 달 조정 절대 날짜', ymd(overrideAbsDate(sameMon)), '2026-07-24')

// ── 조정 없음 / 같은 날로 조정(유예 아님) ──────────────────
const plain = { dueDay: '13', overrideDueDay: null, overrideDueDayMonth: null }
eq('조정 없음', ymd(dueDateForMonth(plain, '2026-08')), '2026-08-13')
eq('조정 없음은 유예 아님', isDeferredForMonth(plain, '2026-08'), false)
eq('조정 없음 절대 날짜 null', overrideAbsDate(plain), null)
const noop = { dueDay: '말일', overrideDueDay: '말일', overrideDueDayMonth: '2026-07' }
eq('같은 날로 조정하면 유예 아님', isDeferredForMonth(noop, '2026-07'), false)

// ── 회귀 방어: 전체 날짜형을 숫자로 오독하지 않는가 ────────
eq('parseInt 오독 방어(2026일 아님)', ymd(resolveDueRaw('2026-08-07', 2026, 8)) !== '2026-08-31', true)
eq('연말 넘김 유예 12월->1월', ymd(dueDateForMonth({ dueDay: '말일', overrideDueDay: '2027-01-05', overrideDueDayMonth: '2026-12' }, '2026-12')), '2027-01-05')

// ── cutoff 비교용 일자(인수 전 양도인 판정) ────────────────
// 전체 날짜형을 parseInt 하면 2026 이 나와 'dueDay < cutoffDay' 비교가 조용히 뒤집힌다.
eq('cutoff: 일자형 그대로', dueDayForCutoff('15', '2026-07'), 15)
eq('cutoff: 말일 = 31', dueDayForCutoff('말일', '2026-07'), 31)
eq('cutoff: 같은 달 전체 날짜형은 그 일자', dueDayForCutoff('2026-07-24', '2026-07'), 24)
eq('cutoff: 다음 달로 밀리면 99(항상 cutoff 뒤)', dueDayForCutoff('2026-08-07', '2026-07'), 99)
eq('cutoff: 이전 달이면 0(항상 cutoff 앞)', dueDayForCutoff('2026-06-28', '2026-07'), 0)
eq('cutoff: 없으면 null', dueDayForCutoff(null, '2026-07'), null)
eq('cutoff: parseInt 오독 방어(2026 아님)', dueDayForCutoff('2026-08-07', '2026-07') !== 2026, true)
// 심원재 실사례 — 7월 cutoff 비교에서 8/7 유예가 '인수 전'으로 오판되지 않아야 한다
eq('cutoff: 심원재 8/7 유예는 cutoff 앞이 아님', (dueDayForCutoff('2026-08-07', '2026-07') ?? 0) < 15, false)

// ── 이용 기간 1일·납부일 6일(납부일만 옮김, 운영자 승인 2026-10-21, 504호) ────────────
// 기한은 납부일(6일)이고 기간은 cycleDay(1일)다. 기한 정본(dueDateForMonth)은 cycleDay 를 모른다(읽지 않는다).
const split = { dueDay: '6', cycleDay: '1', overrideDueDay: null, overrideDueDayMonth: null }
eq('분리: 11월 기한은 납부일 11/6', ymd(dueDateForMonth(split, '2026-11')), '2026-11-06')
eq('분리: 기간 시작일은 1일', cycleDayOf(split), '1')
eq('분리: 기간 표기', cyclePeriodLabel(cycleDayOf(split)), '1일~말일')
eq('분리: 갈린 계약', hasSplitCycle(split), true)
eq('칸 없음: 기간 시작일 = 납부일', cycleDayOf({ dueDay: '6', cycleDay: null }), '6')
eq('같은 날 칸은 갈린 것이 아님(30 과 말일)', hasSplitCycle({ dueDay: '말일', cycleDay: '30' }), false)
eq('기간 표기 15일', cyclePeriodLabel('15'), '15일~다음 달 14일')
eq('기간 표기 말일', cyclePeriodLabel('말일'), '말일~다음 달 말일 하루 전')
eq('기간 표기 없음', cyclePeriodLabel(null), '')
// 미납 경과일은 기한(6일)에서 센다. 11/9 이면 3일 경과(홈 미납·연체 판정이 쓰는 같은 차).
const d9 = new Date(2026, 10, 9).getTime(), d6 = dueDateForMonth(split, '2026-11')!.getTime()
eq('분리: 11/9 는 기한 11/6 에서 3일 경과', Math.round((d9 - d6) / 86400000), 3)
eq('분리: 임시 조정은 기한만(10일) 미루고 기간은 그대로', ymd(dueDateForMonth({ ...split, overrideDueDay: '10', overrideDueDayMonth: '2026-11' }, '2026-11')), '2026-11-10')
eq('납부일만 옮김: 6 은 1 뒤', dueDayAfterCycle('1', '6'), true)
eq('납부일만 옮김: 말일은 29 뒤', dueDayAfterCycle('29', '말일'), true)
eq('납부일만 옮김: 30 과 말일은 같은 날(거절)', dueDayAfterCycle('30', '말일'), false)
eq('납부일만 옮김: 못 읽는 값 거절', dueDayAfterCycle('1', '없음'), false)

// 폼·일괄 수정이 납부일을 바꿀 때 기간 칸(lib/dueDay cycleDayAfterDueChange)
eq('폼: 칸 없는 계약은 그대로 null', JSON.stringify(cycleDayAfterDueChange(null, '20')), JSON.stringify({ cycleDay: null }))
eq('폼: 기간 1 · 납부 6 → 10 이면 기간 유지', JSON.stringify(cycleDayAfterDueChange('1', '10')), JSON.stringify({ cycleDay: '1' }))
eq('폼: 기간과 같은 날로 바꾸면 칸 비움', JSON.stringify(cycleDayAfterDueChange('1', '1')), JSON.stringify({ cycleDay: null }))
eq('폼: 기간보다 앞이면 거절', JSON.stringify(cycleDayAfterDueChange('10', '5')), JSON.stringify({ error: dueOnlyEarlierRefused('10') }))
eq('폼: 납부일을 비우면 칸도 비움', JSON.stringify(cycleDayAfterDueChange('1', null)), JSON.stringify({ cycleDay: null }))
eq('거절 문구에 콜론·느낌표 없음', /[:!]$/.test(dueOnlyEarlierRefused('10')), false)

console.log(`\n납부일 해석 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
