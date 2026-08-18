// 고정지출 납부 예정일 정본(lib/recurringDueDate) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 목록 표시·D-3 필터·기록 모달 프리필이 한 함수를 쓰는지 지킨다(신고 1cfaabab).
import { recurringDueDateFor, recurringDueToday } from '../lib/recurringDueDate'
import { kstDaysUntil } from '../lib/kstDate'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (got === want) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

const manual = (dueDay: number) => ({ dueDay, isAutoDebit: false })
const auto   = (dueDay: number) => ({ dueDay, isAutoDebit: true })

// ── 비자동이체는 기준일 그대로(휴일이어도 시프트 없음 — 운영자 결정) ──
eq('비자동 25일 8월', recurringDueDateFor(manual(25), '2026-08'), '2026-08-25')
eq('비자동 15일 8월(토요일이어도 그대로)', recurringDueDateFor(manual(15), '2026-08'), '2026-08-15')
eq('비자동 말일 클램프(31 -> 30)', recurringDueDateFor(manual(31), '2026-06'), '2026-06-30')
eq('비자동 2월 클램프(31 -> 28)', recurringDueDateFor(manual(31), '2026-02'), '2026-02-28')

// ── 자동이체: 평일이면 그대로(복귀), 주말·공휴일이면 다음 영업일 ──
eq('자동 25일 8월은 화요일 = 그대로', recurringDueDateFor(auto(25), '2026-08'), '2026-08-25')
eq('자동 15일 7월은 수요일 = 그대로', recurringDueDateFor(auto(15), '2026-07'), '2026-07-15')
// 8/15 토 -> 8/16 일 -> 8/17 대체공휴일 -> 8/18 화
eq('자동 15일 8월(토+일+대체공휴일)', recurringDueDateFor(auto(15), '2026-08'), '2026-08-18')
// 9/25 추석 -> 9/26 토 -> 9/27 일 -> 9/28 추석 -> 9/29 화
eq('자동 25일 9월(추석 연휴 관통)', recurringDueDateFor(auto(25), '2026-09'), '2026-09-29')
// 1/30 설 -> 1/31 토 -> 2/1 일 -> 2/2 월 (달 넘김)
eq('자동 30일 1월(설 연휴 + 달 넘김)', recurringDueDateFor(auto(30), '2026-01'), '2026-02-02')
// 5/31 일 -> 6/1 월 (말일 + 주말, 달 넘김)
eq('자동 31일 5월(말일 주말 + 달 넘김)', recurringDueDateFor(auto(31), '2026-05'), '2026-06-01')
// 2/28 토 -> 3/1 삼일절 -> 3/2 대체 -> 3/3 화 (클램프 후 시프트)
eq('자동 31일 2월(클램프 28 후 연휴 시프트)', recurringDueDateFor(auto(31), '2026-02'), '2026-03-03')
eq('자동 28일 2월도 같은 결과', recurringDueDateFor(auto(28), '2026-02'), '2026-03-03')

// ── D-3 임박 판정은 '시프트 후' 날짜로 해야 한다 ────────────
// 회귀 방어: 기준일(dueDay)만 빼면 9/22 기준 25일은 D-3 으로 잡히지만,
// 자동이체 실제 이체일은 연휴가 끝난 9/29 라 임박이 아니다.
const isSoon = (r: { dueDay: number; isAutoDebit: boolean }, month: string, today: string) =>
  kstDaysUntil(recurringDueDateFor(r, month), today) <= 3
eq('자동 25일 9월은 9/22 기준 임박 아님', isSoon(auto(25), '2026-09', '2026-09-22'), false)
eq('시프트 전 기준일로는 임박으로 오판된다(회귀 근거)', 25 - 22 <= 3, true)
eq('자동 25일 9월은 9/26 기준 임박', isSoon(auto(25), '2026-09', '2026-09-26'), true)
eq('비자동 25일 9월은 9/22 기준 임박', isSoon(manual(25), '2026-09', '2026-09-22'), true)
eq('지난 납부일도 임박(과거 도래 포함)', isSoon(manual(5), '2026-09', '2026-09-22'), true)
eq('먼 납부일은 임박 아님', isSoon(manual(30), '2026-09', '2026-09-22'), false)

// ── '오늘 출금·납부' 알림 모집단 판정(recurringDueToday) ────────
// 푸시·인앱 종이 이 한 함수로 오늘 나가는 돈을 고른다(신고 568633fb).
const due = (o: Partial<Parameters<typeof recurringDueToday>[0]> & { dueDay: number; isAutoDebit: boolean }) =>
  ({ isPending: false, recordedExpenseId: null, ...o })

// 실사례: 인터넷 요금 15일 자동이체 — 8/15 토 · 8/16 일 · 8/17 대체공휴일이라 실제 출금은 8/18.
// 기준일(15일)만 보면 8/18 에는 안 잡히고, 8/15 에는 은행이 안 빼간 돈을 알린다.
eq('자동 15일: 시프트로 오늘이 된 8/18 은 발화', recurringDueToday(due(auto(15)), '2026-08-18'), true)
eq('자동 15일: 기준일 8/15 는 발화 안 함(실제 출금 아님)', recurringDueToday(due(auto(15)), '2026-08-15'), false)
eq('자동 15일: 하루 뒤 8/19 는 발화 안 함', recurringDueToday(due(auto(15)), '2026-08-19'), false)

// 비자동은 시프트가 없어 기준일 그대로 — 평일이든 휴일이든 dueDay 당일에만 발화(운영자 결정 2026-08-17)
eq('비자동 25일: 평일 당일 발화', recurringDueToday(due(manual(25)), '2026-08-25'), true)
eq('비자동 15일: 토요일이어도 그날 발화', recurringDueToday(due(manual(15)), '2026-08-15'), true)
eq('비자동 15일: 다음 영업일엔 발화 안 함', recurringDueToday(due(manual(15)), '2026-08-18'), false)

// 이미 기록된 건은 제외 — 재무 화면의 예정 행이 사라진 것과 같은 판정(recordedExpenseId)
eq('기록 있으면 제외(자동)', recurringDueToday(due({ ...auto(15), recordedExpenseId: 'exp_1' }), '2026-08-18'), false)
eq('기록 있으면 제외(비자동)', recurringDueToday(due({ ...manual(25), recordedExpenseId: 'exp_2' }), '2026-08-25'), false)
// 활성화 전(activeSince 가 이번 달 이후) 항목도 제외 — 목록엔 있어도 낼 돈이 아니다
eq('활성화 전이면 제외', recurringDueToday(due({ ...auto(15), isPending: true }), '2026-08-18'), false)

// 말일 클램프 — 31일 항목은 그 달 말일에 발화(6월은 30일)
eq('비자동 31일: 6/30 에 발화', recurringDueToday(due(manual(31)), '2026-06-30'), true)
eq('비자동 31일: 6/29 엔 발화 안 함', recurringDueToday(due(manual(31)), '2026-06-29'), false)
// 자동 31일 5월은 5/31 일요일 → 6/1 월. 클램프한 말일이 주말이면 그 자리에선 안 울린다.
eq('자동 31일 5월: 5/31 은 발화 안 함', recurringDueToday(due(auto(31)), '2026-05-31'), false)
// 알려진 한계 — 시프트가 달을 넘기면(5/31 일 → 6/1) 실제 이체일에도 발화하지 않는다. 판정이 '오늘이 속한
// 달'만 보기 때문이다(운영자 사양 2026-08-18). 재무 예정 행·홈 AlertsStrip 도 같은 달 단위라 셋이 함께
// 침묵한다 — 범위를 넓히려면 세 곳을 같이 고쳐야 하므로 여기 못으로 박아 둔다.
eq('자동 31일 5월: 실제 이체일 6/1 도 발화 안 함(달 넘김 한계)', recurringDueToday(due(auto(31)), '2026-06-01'), false)

console.log(`\n고정지출 예정일 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
