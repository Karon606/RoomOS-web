// 퇴실 정산 기간 정본 회귀 테스트 — lib/settlementPeriod. 실패 시 exit 1.
// 실행: npx tsx scripts/test-settlement-period.ts
import { settlementPeriodFor, asYmd } from '../lib/settlementPeriod'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

const L = (dueDay: string, moveIn?: string, ov?: { day: string; month: string }) => ({
  dueDay, moveInDate: moveIn ?? null,
  overrideDueDay: ov?.day ?? null, overrideDueDayMonth: ov?.month ?? null,
})

// ── 기본: 납부일 20일. 기간은 20일~다음달 19일 ──────────────────────────
{
  const p = settlementPeriodFor(L('20'), '2026-09-20')!
  eq('20일·9/20 퇴실 → 기간은 9월', p.month, '2026-09')
  eq('20일·9/20 시작', p.startYmd, '2026-09-20')
  eq('20일·9/20 퇴실해야 하는 날', p.mustLeaveYmd, '2026-10-19')
  eq('20일·9/20 일수', p.daysUsed, 1)
  eq('20일·9/20 차이', p.daysDiff, -29)
}
{
  // 퇴실일이 그 달 납부일보다 앞 → 전월 기간에 속한다
  const p = settlementPeriodFor(L('20'), '2026-09-19')!
  eq('20일·9/19 는 8월 기간', p.month, '2026-08')
  eq('20일·9/19 시작', p.startYmd, '2026-08-20')
  eq('20일·9/19 는 딱 맞음', p.mustLeaveYmd, '2026-09-19')
  eq('20일·9/19 차이 0', p.daysDiff, 0)
  eq('20일·9/19 일수 31', p.daysUsed, 31)
}
{
  const p = settlementPeriodFor(L('20'), '2026-09-15')!
  eq('4일 일찍 · 차이 −4', p.daysDiff, -4)
  eq('4일 일찍 · 일수', p.daysUsed, 27)   // 8/20~9/15
}
{
  const p = settlementPeriodFor(L('20'), '2026-09-22')!
  eq('초과 · 9월 기간으로 넘어감', p.month, '2026-09')
  eq('초과 · 차이 −27', p.daysDiff, -27)  // 9/22 는 9월 기간(9/20~10/19)의 3일차
}

// ── 말일 납부일 ───────────────────────────────────────────────────────
{
  // 2026년 2월 말일은 28일 — 2/28 은 2월 기간의 '시작일'이지 전월 기간의 끝이 아니다
  const p = settlementPeriodFor(L('말일'), '2026-02-28')!
  eq('말일·2/28 은 2월 기간 시작', p.month, '2026-02')
  eq('말일·2/28 시작', p.startYmd, '2026-02-28')
  eq('말일·2/28 퇴실해야 하는 날', p.mustLeaveYmd, '2026-03-30')
  eq('말일·2/28 일수 1', p.daysUsed, 1)
}
{
  // 하루 앞인 2/27 이 1월 기간의 마지막 날이다
  const p = settlementPeriodFor(L('말일'), '2026-02-27')!
  eq('말일·2/27 은 1월 기간', p.month, '2026-01')
  eq('말일·2/27 시작', p.startYmd, '2026-01-31')
  eq('말일·2/27 은 딱 맞음', p.mustLeaveYmd, '2026-02-27')
  eq('말일·2/27 차이 0', p.daysDiff, 0)
}
{
  const p = settlementPeriodFor(L('말일'), '2026-03-30')!
  eq('말일·3/30 은 2월 기간', p.month, '2026-02')
  eq('말일·3/30 시작(2월 말일)', p.startYmd, '2026-02-28')
  eq('말일·3/30 퇴실해야 하는 날', p.mustLeaveYmd, '2026-03-30')
  eq('말일·3/30 차이 0', p.daysDiff, 0)
}

// ── 짧은 달과 만나는 30·31일 납부일 (min 클램프) ──────────────────────
{
  const p = settlementPeriodFor(L('31'), '2026-02-27')!
  eq('31일·2월 기간 시작은 1/31', p.startYmd, '2026-01-31')
  eq('31일·2월 기간 끝은 2/27', p.mustLeaveYmd, '2026-02-27')  // 다음 시작 2/28 − 1
}
{
  const p = settlementPeriodFor(L('30'), '2026-02-10')!
  eq('30일·2월 기간 시작 1/30', p.startYmd, '2026-01-30')
  eq('30일·2월 기간 끝 2/27', p.mustLeaveYmd, '2026-02-27')
}

// ── 연말 경계 ─────────────────────────────────────────────────────────
{
  const p = settlementPeriodFor(L('20'), '2026-01-05')!
  eq('연말 넘김 · 12월 기간', p.month, '2025-12')
  eq('연말 넘김 · 시작', p.startYmd, '2025-12-20')
  eq('연말 넘김 · 끝', p.mustLeaveYmd, '2026-01-19')
}
{
  const p = settlementPeriodFor(L('20'), '2026-12-25')!
  eq('연말 시작 · 끝은 다음해', p.mustLeaveYmd, '2027-01-19')
}

// ── 입주월 보정 — 기간 시작은 입주일보다 앞설 수 없다 ─────────────────
{
  const p = settlementPeriodFor(L('1', '2026-05-10'), '2026-05-26')!
  eq('입주월 · 시작이 입주일로 올라감', p.startYmd, '2026-05-10')
  eq('입주월 · 끝은 5/31', p.mustLeaveYmd, '2026-05-31')
  eq('입주월 · 일수 17', p.daysUsed, 17)   // 5/10~5/26
}
{
  // 입주 다음 달부터는 보정하지 않는다
  const p = settlementPeriodFor(L('1', '2026-05-10'), '2026-06-20')!
  eq('입주 다음달 · 시작은 납부일', p.startYmd, '2026-06-01')
}

// ── 납부일 임시조정 — 그 달 기간 시작이 옮겨진다 ──────────────────────
{
  const p = settlementPeriodFor(L('7', undefined, { day: '10', month: '2026-08' }), '2026-08-15')!
  eq('임시조정 · 8월 시작이 10일로', p.startYmd, '2026-08-10')
  eq('임시조정 · 끝은 9/6', p.mustLeaveYmd, '2026-09-06')
}
{
  // 조정이 걸린 달이 아니면 원래 납부일
  const p = settlementPeriodFor(L('7', undefined, { day: '10', month: '2026-08' }), '2026-07-15')!
  eq('조정 무관 달 · 시작 7/7', p.startYmd, '2026-07-07')
}
{
  // 전체 날짜형 조정(월 경계를 넘긴 유예)
  const p = settlementPeriodFor(L('7', undefined, { day: '2026-09-03', month: '2026-08' }), '2026-08-20')!
  eq('날짜형 조정 · 8월 시작이 9/3 이라 8/20 은 7월 기간', p.month, '2026-07')
  eq('날짜형 조정 · 7월 기간 끝', p.mustLeaveYmd, '2026-09-02')
}

// ── 방어 ──────────────────────────────────────────────────────────────
eq('납부일 없음 → null', settlementPeriodFor({ dueDay: null }, '2026-09-20'), null)
eq('잘못된 날짜 → null', settlementPeriodFor(L('20'), 'bad'), null)
eq('asYmd(UTC Date)', asYmd(new Date(Date.UTC(2026, 7, 1))), '2026-08-01')
eq('asYmd(문자열)', asYmd('2026-08-01T00:00:00.000Z'), '2026-08-01')
eq('asYmd(null)', asYmd(null), null)

console.log(`\n퇴실 정산 기간: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
