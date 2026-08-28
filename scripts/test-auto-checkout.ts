// 퇴실 예정 자동 전환 판정 회귀 — 실행: npx tsx scripts/test-auto-checkout.ts
//
// 여기서 고정하는 것 넷(2026-08-28 운영자 확정).
//   · **'한 달'은 달력이다** — 30일로 못 박으면 윤달과 30/31 월에서 갈린다.
//   · **두 축 중 하나라도 짧으면 짧다** — 플래그만 보면 3주 손님이 입주 첫날부터 퇴실 예정이 되고,
//     기간만 보면 45일 단기가 입주 보름째부터 퇴실 예정이 된다.
//   · **입주 전에 퇴실 예정이 되지 않는다** — 리드가 체류보다 길면 입주일로 당긴다.
//   · **퇴실일이 없으면 전환도 없다** — 언제 바꿀지 정할 근거가 없다.
import {
  checkoutLeadKind, autoCheckoutFlipYmd, autoCheckoutDue, minusCalendarMonths,
  needsCheckoutTimingChoice, resolveCheckoutTiming,
} from '../lib/autoCheckout'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const L = (o: Partial<Parameters<typeof autoCheckoutFlipYmd>[0]>) =>
  ({ isShortTerm: false, expectedMoveOut: null, moveInDate: null, ...o })

// ── 달력 한 달 빼기 ────────────────────────────────────────────────
eq('10/19 의 한 달 전은 9/19', minusCalendarMonths('2026-10-19', 1), '2026-09-19')
eq('3/31 의 한 달 전은 2/28(말일로 당김)', minusCalendarMonths('2026-03-31', 1), '2026-02-28')
eq('윤년 3/31 의 한 달 전은 2/29', minusCalendarMonths('2028-03-31', 1), '2028-02-29')
eq('1/15 의 한 달 전은 전년 12/15', minusCalendarMonths('2026-01-15', 1), '2025-12-15')
eq('5/31 의 한 달 전은 4/30', minusCalendarMonths('2026-05-31', 1), '2026-04-30')
// 30일 고정이었다면 3/31 은 3/1 이 되어 한 달이 아니게 된다. 그 차이를 여기서 잠근다.
eq('달력과 30일 고정은 다른 답이다', minusCalendarMonths('2026-03-31', 1) === '2026-03-01', false)

// ── 짧게 보는가 ────────────────────────────────────────────────────
eq('단기 체크는 짧다', checkoutLeadKind(L({ isShortTerm: true })), 'short')
eq('수개월 체류는 길다',
  checkoutLeadKind(L({ moveInDate: '2025-06-21', expectedMoveOut: '2026-10-19' })), 'normal')
// 체크를 안 켠 3주 손님 — 플래그만 보면 입주 첫날부터 퇴실 예정이 된다.
eq('체크를 안 켠 3주 손님도 짧다',
  checkoutLeadKind(L({ moveInDate: '2026-09-01', expectedMoveOut: '2026-09-21' })), 'short')
// 체크를 켠 45일 — 기간만 보면 입주 보름째부터 퇴실 예정이 된다.
eq('체크를 켠 45일은 플래그가 이긴다',
  checkoutLeadKind(L({ isShortTerm: true, moveInDate: '2026-09-01', expectedMoveOut: '2026-10-16' })), 'short')
eq('입주일을 모르면 플래그만 본다', checkoutLeadKind(L({ expectedMoveOut: '2026-10-19' })), 'normal')
// 달력 한 달 경계 — 8/21~9/20 은 31일이어도 한 달이다(shortStay 정본과 같은 답).
eq('8/21에서 9/20은 한 달',
  checkoutLeadKind(L({ moveInDate: '2026-08-21', expectedMoveOut: '2026-09-20' })), 'short')
eq('8/21에서 9/21은 한 달을 넘는다',
  checkoutLeadKind(L({ moveInDate: '2026-08-21', expectedMoveOut: '2026-09-21' })), 'normal')

// ── 전환 예정일 ────────────────────────────────────────────────────
// 이경호 님 건(522호) — 2025-06-21 입주, 2026-10-19 퇴실.
eq('일반 계약은 퇴실 한 달 전',
  autoCheckoutFlipYmd(L({ moveInDate: '2025-06-21', expectedMoveOut: '2026-10-19' })), '2026-09-19')
// 퇴실일을 당기면 전환일도 따라 움직인다.
eq('퇴실일을 당기면 전환일도 당겨진다',
  autoCheckoutFlipYmd(L({ moveInDate: '2025-06-21', expectedMoveOut: '2026-09-19' })), '2026-08-19')
eq('단기는 퇴실 일주일 전',
  autoCheckoutFlipYmd(L({ isShortTerm: true, moveInDate: '2026-09-01', expectedMoveOut: '2026-09-14' })), '2026-09-07')
eq('퇴실일이 없으면 전환도 없다', autoCheckoutFlipYmd(L({ moveInDate: '2026-09-01' })), null)
// 리드가 체류보다 길다 — 입주 전에 퇴실 예정이 되면 안 된다.
eq('입주일보다 앞서면 입주일로 당긴다',
  autoCheckoutFlipYmd(L({ isShortTerm: true, moveInDate: '2026-09-10', expectedMoveOut: '2026-09-13' })), '2026-09-10')
eq('입주일을 모르면 당기지 않는다',
  autoCheckoutFlipYmd(L({ isShortTerm: true, expectedMoveOut: '2026-09-13' })), '2026-09-06')

// ── 영업장별 설정 ──────────────────────────────────────────────────
eq('영업장이 단기 리드를 14일로 늘림',
  autoCheckoutFlipYmd(L({ isShortTerm: true, expectedMoveOut: '2026-09-20' }), { shortDays: 14 }), '2026-09-06')
eq('영업장이 일반 리드를 두 달로 늘림',
  autoCheckoutFlipYmd(L({ moveInDate: '2025-01-01', expectedMoveOut: '2026-10-19' }), { normalMonths: 2 }), '2026-08-19')
eq('설정이 null 이면 앱 기본을 쓴다',
  autoCheckoutFlipYmd(L({ moveInDate: '2025-01-01', expectedMoveOut: '2026-10-19' }), { normalMonths: null }), '2026-09-19')

// ── 오늘 기준 판정 ─────────────────────────────────────────────────
const lee = L({ moveInDate: '2025-06-21', expectedMoveOut: '2026-10-19' })
eq('전환일 전날은 아직 아니다', autoCheckoutDue(lee, '2026-09-18'), false)
eq('전환일 당일은 대상이다', autoCheckoutDue(lee, '2026-09-19'), true)
// 크론이 하루 결번해도 다음 날 잡힌다 — 창이 '이하'라 자동으로 성립한다.
eq('전환일을 지나쳐도 잡힌다', autoCheckoutDue(lee, '2026-09-25'), true)
eq('퇴실일이 없으면 대상이 아니다', autoCheckoutDue(L({ moveInDate: '2026-01-01' }), '2026-09-19'), false)

// ── 언제 묻는가 ────────────────────────────────────────────────────
const ask = (o: Parameters<typeof needsCheckoutTimingChoice>[0]) => needsCheckoutTimingChoice(o)
eq('퇴실일을 새로 정했고 전환일이 미래면 묻는다',
  ask({ lease: lee, prevMoveOut: null, todayYmd: '2026-08-28' }), true)
eq('퇴실일이 그대로면 안 묻는다',
  ask({ lease: lee, prevMoveOut: '2026-10-19', todayYmd: '2026-08-28' }), false)
// 전환일이 이미 지났으면 어느 쪽을 골라도 결과가 같다 — 답이 하나뿐인 물음은 방해다.
eq('전환일이 지났으면 안 묻는다',
  ask({ lease: lee, prevMoveOut: null, todayYmd: '2026-09-20' }), false)
eq('전환일 당일도 안 묻는다',
  ask({ lease: lee, prevMoveOut: null, todayYmd: '2026-09-19' }), false)
eq('퇴실일이 없으면 안 묻는다',
  ask({ lease: L({ moveInDate: '2025-06-21' }), prevMoveOut: null, todayYmd: '2026-08-28' }), false)
// 단기는 리드가 짧아 묻는 창도 좁다.
eq('단기도 전환일이 미래면 묻는다',
  ask({ lease: L({ isShortTerm: true, moveInDate: '2026-09-01', expectedMoveOut: '2026-09-20' }), prevMoveOut: null, todayYmd: '2026-09-05' }), true)
eq('단기 전환일이 지났으면 안 묻는다',
  ask({ lease: L({ isShortTerm: true, moveInDate: '2026-09-01', expectedMoveOut: '2026-09-20' }), prevMoveOut: null, todayYmd: '2026-09-15' }), false)

// ── 고른 시점의 저장 조각 ──────────────────────────────────────────
eq("'지금'은 퇴실 예정으로", resolveCheckoutTiming('now'), { status: 'CHECKOUT_PENDING', autoCheckoutAt: null })
eq("'그날'은 거주중으로 두고 표식을 비운다", resolveCheckoutTiming('auto'), { status: 'ACTIVE', autoCheckoutAt: null })
// 안전 기본값이 곧 현행 동작이라 부분 배포에도 결과가 안 갈린다.
eq('안 고르면 종전 동작', resolveCheckoutTiming(undefined), { status: 'CHECKOUT_PENDING', autoCheckoutAt: null })

console.log(`\n퇴실 자동 전환 판정 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
