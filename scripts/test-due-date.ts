// 납부일 해석 정본(lib/dueDate) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 전체 날짜형('YYYY-MM-DD')을 parseInt 로 읽어 연도(2026)가 날짜로 새는 클래스를 막는다(신고 998bff27).
import { resolveDueRaw, effectiveDueRawForMonth, dueDateForMonth, overrideAbsDate, isDeferredForMonth } from '../lib/dueDate'

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

console.log(`\n납부일 해석 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
