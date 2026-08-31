// 고정지출 납부 예정일 정본(lib/recurringDueDate) 회귀 테스트 — DB 불필요, 순수 함수 케이스 고정.
// 목록 표시·D-3 필터·기록 모달 프리필이 한 함수를 쓰는지 지킨다(신고 1cfaabab).
import {
  recurringDueDateFor, recurringDueToday,
  isRecurringDueMonth, nextRecurringDueMonth, resolveRecurringAnchorMonth, recurringCycleLabel, recurringCycleWord,
  type RecurringCycleSource,
} from '../lib/recurringDueDate'
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
  ({ isPending: false, recordedExpenseId: null, isDueThisMonth: true, ...o })

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

// ── 주기 도래 판정(isRecurringDueMonth 계열, 신고 7e7da5c4) ────────────
// 판정·다음 도래·표기·폴백이 전부 한 파일 한 식에서 나오는지 지킨다.
const cyc = (o: Partial<RecurringCycleSource> & { intervalMonths: number }): RecurringCycleSource =>
  ({ anchorMonth: null, activeSince: null, createdAt: '2026-01-10T03:00:00.000Z', ...o })

// 매월 — anchorMonth 에 쓰레기 값이 있어도 어느 달이나 참(기존 15건 무변경의 근거)
eq('매월은 어느 달이나 도래', isRecurringDueMonth(cyc({ intervalMonths: 1, anchorMonth: 3 }), '2026-08'), true)
eq('interval 0 도 매월 취급', isRecurringDueMonth(cyc({ intervalMonths: 0 }), '2026-08'), true)

// 격월 홀짝 — 연 경계 포함
eq('격월 anchor 1: 1월 도래', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 1 }), '2026-01'), true)
eq('격월 anchor 1: 3월 도래', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 1 }), '2026-03'), true)
eq('격월 anchor 1: 11월 도래', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 1 }), '2026-11'), true)
eq('격월 anchor 1: 2월 비도래', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 1 }), '2026-02'), false)
eq('격월 anchor 2: 12월 도래', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 2 }), '2026-12'), true)
eq('격월 anchor 2: 1월 비도래(연 경계)', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 2 }), '2027-01'), false)
eq('격월 anchor 2: 2월 도래(연 경계)', isRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 2 }), '2027-02'), true)

// 분기 — 연 넘김 음수 mod, 같은 집합의 다른 기준 달
eq('분기 anchor 11: 11월 도래', isRecurringDueMonth(cyc({ intervalMonths: 3, anchorMonth: 11 }), '2026-11'), true)
eq('분기 anchor 11: 2월 도래(음수 mod)', isRecurringDueMonth(cyc({ intervalMonths: 3, anchorMonth: 11 }), '2026-02'), true)
eq('분기 anchor 11: 5월 도래', isRecurringDueMonth(cyc({ intervalMonths: 3, anchorMonth: 11 }), '2026-05'), true)
eq('분기 anchor 11: 4월 비도래', isRecurringDueMonth(cyc({ intervalMonths: 3, anchorMonth: 11 }), '2026-04'), false)
eq('분기 anchor 2 와 anchor 5 는 같은 판정', isRecurringDueMonth(cyc({ intervalMonths: 3, anchorMonth: 2 }), '2026-08'),
  isRecurringDueMonth(cyc({ intervalMonths: 3, anchorMonth: 5 }), '2026-08'))

// 반기·연1회
eq('반기 anchor 3: 9월 도래', isRecurringDueMonth(cyc({ intervalMonths: 6, anchorMonth: 3 }), '2026-09'), true)
eq('반기 anchor 3: 6월 비도래', isRecurringDueMonth(cyc({ intervalMonths: 6, anchorMonth: 3 }), '2026-06'), false)
eq('연1회 anchor 3: 3월 도래', isRecurringDueMonth(cyc({ intervalMonths: 12, anchorMonth: 3 }), '2026-03'), true)
eq('연1회 anchor 3: 4월 비도래', isRecurringDueMonth(cyc({ intervalMonths: 12, anchorMonth: 3 }), '2026-04'), false)
eq('연1회 anchor 3: 이듬해 2월 비도래', isRecurringDueMonth(cyc({ intervalMonths: 12, anchorMonth: 3 }), '2027-02'), false)
eq('연1회 anchor 3: 이듬해 3월 도래', isRecurringDueMonth(cyc({ intervalMonths: 12, anchorMonth: 3 }), '2027-03'), true)

// anchorMonth null 폴백 — activeSince(@db.Date UTC 자정) 우선, 없으면 createdAt 의 KST 달
eq('폴백 1: activeSince 4월', resolveRecurringAnchorMonth(cyc({ intervalMonths: 12, activeSince: '2026-04-15' })), 4)
eq('폴백 1: 연1회는 그 달만 도래', isRecurringDueMonth(cyc({ intervalMonths: 12, activeSince: '2026-04-15' }), '2027-04'), true)
eq('폴백 2: activeSince 없으면 createdAt', resolveRecurringAnchorMonth(cyc({ intervalMonths: 12, createdAt: '2026-07-03T05:00:00.000Z' })), 7)
// KST 자정 경계 — UTC 3/31 15:30 은 KST 4/1 이라 기준 달 4 (UTC 로 읽으면 3 이 되는 자리)
eq('폴백 3: KST 자정 경계', resolveRecurringAnchorMonth(cyc({ intervalMonths: 12, createdAt: '2026-03-31T15:30:00.000Z' })), 4)
// @db.Date 불변 — UTC 자정 값은 +9h 시프트로도 날짜가 안 바뀐다
eq('폴백 4: @db.Date UTC 자정 11월', resolveRecurringAnchorMonth(cyc({ intervalMonths: 12, activeSince: new Date('2026-11-01T00:00:00.000Z') })), 11)
eq('anchorMonth 범위 밖(13)은 폴백', resolveRecurringAnchorMonth(cyc({ intervalMonths: 12, anchorMonth: 13, activeSince: '2026-04-15' })), 4)

// 다음 도래 — 연 넘김·12월 경계
eq('연1회 anchor 3: 4월 기준 다음 도래', nextRecurringDueMonth(cyc({ intervalMonths: 12, anchorMonth: 3 }), '2026-04'), '2027-03')
eq('연1회 anchor 3: 3월 기준 다음 도래(미포함)', nextRecurringDueMonth(cyc({ intervalMonths: 12, anchorMonth: 3 }), '2026-03'), '2027-03')
eq('격월 anchor 12: 12월 기준 다음 도래', nextRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 12 }), '2026-12'), '2027-02')
eq('격월 anchor 1: 12월 기준 다음 도래', nextRecurringDueMonth(cyc({ intervalMonths: 2, anchorMonth: 1 }), '2026-12'), '2027-01')
eq('매월: 다음 달', nextRecurringDueMonth(cyc({ intervalMonths: 1 }), '2026-12'), '2027-01')

// 표기 정본 — 열거가 판정에서 파생되므로 표기와 도래가 갈릴 수 없다
eq('표기: 매월', recurringCycleLabel(cyc({ intervalMonths: 1 })), '매월')
eq('표기: 격월 홀수달', recurringCycleLabel(cyc({ intervalMonths: 2, anchorMonth: 3 })), '격월 (홀수달)')
eq('표기: 격월 짝수달', recurringCycleLabel(cyc({ intervalMonths: 2, anchorMonth: 8 })), '격월 (짝수달)')
eq('표기: 분기 열거', recurringCycleLabel(cyc({ intervalMonths: 3, anchorMonth: 11 })), '분기 (2·5·8·11월)')
eq('표기: 반기 열거', recurringCycleLabel(cyc({ intervalMonths: 6, anchorMonth: 9 })), '반기 (3·9월)')
eq('표기: 연 1회', recurringCycleLabel(cyc({ intervalMonths: 12, anchorMonth: 3 })), '연 1회 (3월)')


// 짧은 말 — 알림 detail 과 '납부일 (…)' 라벨이 쓰는 정본. 열거 없이 부사형이라야 문장이 된다.
eq('짧은 말: 매월', recurringCycleWord(cyc({ intervalMonths: 1 })), '매월')
eq('짧은 말: 격월', recurringCycleWord(cyc({ intervalMonths: 2, anchorMonth: 3 })), '격월')
eq('짧은 말: 분기마다', recurringCycleWord(cyc({ intervalMonths: 3, anchorMonth: 2 })), '분기마다')
eq('짧은 말: 반기마다', recurringCycleWord(cyc({ intervalMonths: 6, anchorMonth: 3 })), '반기마다')
eq('짧은 말: 해마다', recurringCycleWord(cyc({ intervalMonths: 12, anchorMonth: 3 })), '해마다')

// 알림 게이트 — 비도래 달이면 날짜가 오늘이어도 침묵한다(푸시·인앱 종이 함께 걸러진다).
eq('비도래 달이면 오늘이어도 발화 안 함', recurringDueToday(due({ ...manual(25), isDueThisMonth: false }), '2026-08-25'), false)


// ── 간격 주기의 유연한 재기준 (2026-08-31 운영자 요구) ────────────────────
//
// 주기 판정은 달력 달 고정이라 6개월을 8월에 걸면 다음은 무조건 2월이다. 사정상 3월에 하면
// 그 뒤로 계속 어긋난다. 그래서 **기록하는 순간 기준 달을 그 지출의 달로 옮긴다.**
// 여기서는 옮긴 뒤의 도래 판정이 실제로 새 리듬을 따르는지를 고정한다.
{
  const base = { activeSince: null, createdAt: new Date('2026-08-25'), nextDueOverrideMonth: null }
  // 8월에 걸어 둔 6개월 주기 — 다음은 2월이다.
  const aug = { ...base, intervalMonths: 6, anchorMonth: 8 }
  eq('6개월: 8월 기준이면 2월이 도래', isRecurringDueMonth(aug, '2027-02'), true)
  eq('6개월: 8월 기준이면 3월은 아니다', isRecurringDueMonth(aug, '2027-03'), false)
  // 3월에 실제로 해서 기준이 3월로 옮겨지면, 그 다음은 9월이다.
  const mar = { ...base, intervalMonths: 6, anchorMonth: 3 }
  eq('6개월: 기준이 3월로 옮겨지면 9월이 도래', isRecurringDueMonth(mar, '2027-09'), true)
  eq('6개월: 그때 2월은 더 이상 도래가 아니다', isRecurringDueMonth(mar, '2027-02'), false)
  // 매월 항목은 기준 달이라는 개념이 없다 — 어느 달이든 도래다.
  const monthly = { ...base, intervalMonths: 1, anchorMonth: 8 }
  eq('매월: 1월도 도래', isRecurringDueMonth(monthly, '2027-01'), true)
  eq('매월: 7월도 도래', isRecurringDueMonth(monthly, '2027-07'), true)
}

// ── 다음 회차 지정 (2026-08-31 운영자 승인) ───────────────────────────
//
// anchorMonth 는 달력 달의 위상만 담아서 "다음 한 번만 내년 3월로"를 적을 자리가 없다. 반기 항목의
// 기준을 3월로 고치면 3·9월 짝이 통째로 옮겨져, 8월에 고치면 다음 도래가 내년 3월이 아니라 당장
// 다음 달인 9월이 된다(2026-08-31 실측). 지정 칸이 그 자리다.
{
  const base = { activeSince: null, createdAt: new Date('2026-08-25') }
  const rec = { ...base, intervalMonths: 6, anchorMonth: 8, nextDueOverrideMonth: '2027-03' }

  eq('지정: 지정한 달은 위상과 무관하게 도래', isRecurringDueMonth(rec, '2027-03'), true)
  // 미룬다는 것은 곧 "원래 달에는 안 한다"이다 — 지정보다 앞의 위상 도래는 숨어야 한다.
  eq('지정: 지정보다 앞의 위상 달은 숨는다', isRecurringDueMonth(rec, '2027-02'), false)
  eq('지정: 지정보다 앞이면 옛 위상 달도 숨는다', isRecurringDueMonth(rec, '2026-08'), false)
  // 뒤의 위상은 살려 둔다 — 지정만 하고 기록을 안 하면 다시 떠올라야 잊히지 않는다.
  eq('지정: 지정보다 뒤의 위상 달은 살아 있다', isRecurringDueMonth(rec, '2027-08'), true)
  eq('지정: 지정보다 뒤여도 위상이 아니면 도래가 아니다', isRecurringDueMonth(rec, '2027-05'), false)
  eq('지정: 다음 도래는 지정한 달', nextRecurringDueMonth(rec, '2026-08'), '2027-03')

  // 리듬 표기는 지정을 빼고 본다 — 한 번뿐인 이동이 항구적 문구를 거짓으로 만들면 안 된다.
  eq('지정: 주기 표기는 리듬 그대로', recurringCycleLabel(rec), '반기 (2·8월)')

  // 당기기도 같은 규칙으로 선다.
  const early = { ...base, intervalMonths: 6, anchorMonth: 8, nextDueOverrideMonth: '2027-01' }
  eq('지정: 당긴 달이 도래', isRecurringDueMonth(early, '2027-01'), true)
  eq('지정: 당긴 뒤의 원래 위상은 살아 있다', isRecurringDueMonth(early, '2027-02'), true)

  // 깨진 값은 지정이 없는 것으로 본다 — 항목이 소리 없이 숨는 것이 가장 나쁜 실패다.
  for (const bad of ['2027-13', '2027-1', 'x', '']) {
    eq(`지정: 깨진 값('${bad}')은 무시하고 위상 판정`, isRecurringDueMonth({ ...base, intervalMonths: 6, anchorMonth: 8, nextDueOverrideMonth: bad }, '2027-02'), true)
  }
  // 매월 항목은 지정이 있어도 항상 도래다 — 거동 불변.
  eq('지정: 매월 항목은 지정과 무관하게 도래', isRecurringDueMonth({ ...base, intervalMonths: 1, anchorMonth: null, nextDueOverrideMonth: '2027-03' }, '2027-05'), true)
}
console.log(`\n고정지출 예정일 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
