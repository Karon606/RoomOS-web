// 퇴실 정산 기간 정본 회귀 테스트 — lib/settlementPeriod. 실패 시 exit 1.
// 실행: npx tsx scripts/test-settlement-period.ts
//
// 2026-08-01 정정. 초판은 48건이 전부 통과했지만 **틀린 동작 둘을 정답으로 못 박고** 있었다.
//   · 31일 기간의 daysUsed 를 31 로 기대 — 일할 분모가 30 이라 월세를 넘는 금액이 나온다
//   · 납부일 임시조정이 기간 시작을 옮기는 것을 기대 — 유예는 기한만 미룰 뿐 기간을 안 옮긴다
// 적대적 검증 패널이 잡았다. 통과 건수는 감지망의 실효를 보장하지 않는다. 기대값 자체가 정답인지를
// 의심해야 한다. 아래 케이스들은 그 교훈을 박아둔 것이다.
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
  eq('20일·9/19 기간 전체는 31일', p.periodDays, 31)
  // 계약서가 1일 요금을 월/30 으로 못박았다. 31 을 그대로 쓰면 월세를 넘어 조항 위반이 된다
  eq('20일·9/19 일할 일수는 30 상한', p.daysUsed, 30)
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
  eq('말일·2/28 기간 31일', p.periodDays, 31)
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

// ── 납부일 임시조정은 기간을 옮기지 않는다 (운영자 확정 2026-08-01) ────
//   "납부일 유예는 납부 기한을 미루는거지... 기간 시작을 옮기면 공짜로 사는 기간이 생기잖아"
// 초판은 조정값을 기간 시작으로 썼다. 그래서 8월분을 9/3 까지 유예받은 사람이 8/20 에 퇴실하면
// 정산월이 두 달 전(7월)로 가고 기간이 45일이 됐다. 월세의 150% 를 청구하는 값이다.
{
  const p = settlementPeriodFor(L('7', undefined, { day: '10', month: '2026-08' }), '2026-08-15')!
  eq('같은 달 조정 · 시작은 그대로 8/7', p.startYmd, '2026-08-07')
  eq('같은 달 조정 · 끝도 그대로 9/6', p.mustLeaveYmd, '2026-09-06')
}
{
  const p = settlementPeriodFor(L('7', undefined, { day: '2026-09-03', month: '2026-08' }), '2026-08-20')!
  eq('날짜형 유예 · 여전히 8월 기간', p.month, '2026-08')
  eq('날짜형 유예 · 시작 8/7', p.startYmd, '2026-08-07')
  eq('날짜형 유예 · 끝 9/6', p.mustLeaveYmd, '2026-09-06')
  eq('날짜형 유예 · 일수 14(45 아님)', p.daysUsed, 14)
}

// ── 잘못된 입력 — null 로 걸러야 한다(멀쩡한 객체를 돌려주면 확정 데이터가 된다) ──
{
  // 입주 5/20 인데 퇴실 5/10 — 입주일 보정이 시작을 올려 사용 일수가 음수가 되는 경우
  eq('퇴실일 < 입주일 → null', settlementPeriodFor(L('1', '2026-05-20'), '2026-05-10'), null)
}

// ── 월세 초과 금지 — 계약서 조항이 근거다 ────────────────────────────
// "1일 이용요금은 월 이용료의 30분의 1로 합니다"(lib/contract.ts buildRefundClause, 공정위 기준 고정).
// 31일 기간을 그대로 청구하면 우리 계약서를 우리가 어긴다.
{
  const p = settlementPeriodFor(L('24'), '2026-06-23')!   // 조홍래 실계약 형태
  eq('납부일24·6/23 기간 31일', p.periodDays, 31)
  eq('납부일24·6/23 일할 일수 30', p.daysUsed, 30)
  eq('납부일24·6/23 딱 맞음', p.daysDiff, 0)
}
{
  const p = settlementPeriodFor(L('21'), '2026-09-20')!   // 이경호 실계약 형태
  eq('납부일21·9/20 일할 일수 30', p.daysUsed, 30)
}
{
  const p = settlementPeriodFor(L('말일'), '2026-03-30')!
  eq('말일·3/30 일할 일수 30', p.daysUsed, 30)
}

// ── 방어 ──────────────────────────────────────────────────────────────
eq('납부일 없음 → null', settlementPeriodFor({ dueDay: null }, '2026-09-20'), null)
eq('잘못된 날짜 → null', settlementPeriodFor(L('20'), 'bad'), null)
eq('asYmd(UTC Date)', asYmd(new Date(Date.UTC(2026, 7, 1))), '2026-08-01')
eq('asYmd(문자열)', asYmd('2026-08-01T00:00:00.000Z'), '2026-08-01')
eq('asYmd(null)', asYmd(null), null)

console.log(`\n퇴실 정산 기간: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
