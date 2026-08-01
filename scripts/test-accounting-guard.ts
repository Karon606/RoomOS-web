// 과거 회계월 보호 정본 회귀 테스트 — lib/accountingGuard. 실패 시 exit 1.
// 실행: npx tsx scripts/test-accounting-guard.ts
//
// 2026-08-02 전면 개정. 초판은 '연도가 작년이면 무조건 차단'을 정답으로 못박고 있었다.
// 틀렸다 — 2026-01-05 에 2025-12 를 고치는 것은 신고 전에 맞추는 행위다(소득세 확정신고 5/31).
// 매년 1월부터 5월까지 다섯 달을 불필요하게 막았고, 매년 1월 퇴실자에게 상시 재현되는 장애였다.
// 경계선은 연도가 아니라 **신고 기한 날짜**다.
import { checkSettlementMonth } from '../lib/accountingGuard'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}
const okNoWarn = (name: string, mon: string, today: string, acq?: string) => {
  const v = checkSettlementMonth(mon, today, acq ?? null)
  eq(name, v.ok, true)
  if (v.ok) eq(name + ' (고지 없음)', v.warning, null)
}
const warned = (name: string, mon: string, today: string, acq?: string) => {
  const v = checkSettlementMonth(mon, today, acq ?? null)
  eq(name, v.ok, true)
  if (v.ok) eq(name + ' (고지 있음)', typeof v.warning === 'string' && v.warning.length > 0, true)
}
const blocked = (name: string, mon: string, today: string, acq?: string) => {
  eq(name, checkSettlementMonth(mon, today, acq ?? null).ok, false)
}
const strongWarn = (name: string, mon: string, today: string) => {
  const v = checkSettlementMonth(mon, today, null)
  eq(name, v.ok && v.warning?.includes('수정신고'), true)
}

// ── 미래·당월은 언제나 통과 ────────────────────────────────────────────
okNoWarn('당월', '2026-08', '2026-08-02')
okNoWarn('다음 달', '2026-09', '2026-08-02')
okNoWarn('내년', '2027-01', '2026-08-02')

// ── 회계 패널이 제시한 네 케이스 (핵심) ───────────────────────────────
// (a) 1월 초 퇴실 — 어떤 신고 기한도 안 지났다. 오히려 지금 고치는 게 정답
warned('(a) 2026-01-05 에 2025-12', '2025-12', '2026-01-05')
{
  const v = checkSettlementMonth('2025-12', '2026-01-05')
  eq('(a) 는 가벼운 고지', v.ok && v.warning?.includes('수정신고'), false)
}
// (b) 부가세 2기 확정신고(1/25) 지난 뒤 — 허용하되 강한 고지
strongWarn('(b) 2026-02-10 에 2025-12', '2025-12', '2026-02-10')
// (c) 소득세 확정신고(5/31) 지난 뒤 — 차단
blocked('(c) 2026-06-15 에 2025-12', '2025-12', '2026-06-15')
// (d) 2년 전 — 차단
blocked('(d) 2026-08-01 에 2024-11', '2024-11', '2026-08-01')

// ── 경계 하루 전후 ────────────────────────────────────────────────────
warned('5/31 당일은 아직 허용', '2025-12', '2026-05-31')
blocked('6/1 부터 차단', '2025-12', '2026-06-01')
{
  // 부가세 2기 기한 1/25 경계
  const before = checkSettlementMonth('2025-12', '2026-01-24')
  const after = checkSettlementMonth('2025-12', '2026-01-25')
  eq('1/24 는 가벼운 고지', before.ok && before.warning?.includes('수정신고'), false)
  eq('1/25 부터 강한 고지', after.ok && after.warning?.includes('수정신고'), true)
}
{
  // 상반기 귀속은 그 해 7/25 가 기한
  const before = checkSettlementMonth('2026-05', '2026-07-24')
  const after = checkSettlementMonth('2026-05', '2026-07-25')
  eq('상반기·7/24 는 가벼운 고지', before.ok && before.warning?.includes('수정신고'), false)
  eq('상반기·7/25 부터 강한 고지', after.ok && after.warning?.includes('수정신고'), true)
}

// ── 같은 해 과거 달 ───────────────────────────────────────────────────
warned('직전 달', '2026-07', '2026-08-02')
strongWarn('같은 해 5월·8월 시점', '2026-05', '2026-08-02')
{
  // 하반기 귀속은 같은 해 안에서 기한(다음해 1/25)에 안 걸린다
  const v = checkSettlementMonth('2026-08', '2026-11-30')
  eq('하반기·같은 해는 가벼운 고지', v.ok && v.warning?.includes('수정신고'), false)
}

// ── 인수 이전은 차단 ──────────────────────────────────────────────────
blocked('인수 이전 달', '2026-02', '2026-08-02', '2026-03-15')
warned('인수 이후 과거 달', '2026-04', '2026-08-02', '2026-03-15')
{
  const v = checkSettlementMonth('2026-03', '2026-08-02', '2026-03-15')
  eq('인수월은 허용', v.ok, true)
}
{
  // 인수 이전 + 소득세 기한 경과가 겹치면 인수 사유가 먼저(더 구체적)
  const v = checkSettlementMonth('2024-06', '2026-08-02', '2026-03-15')
  eq('겹칠 때 인수 사유 우선', !v.ok && v.reason.includes('인수'), true)
}

// ── 차단 문구에 대안과 출구가 있어야 한다 ─────────────────────────────
{
  const v = checkSettlementMonth('2024-11', '2026-08-01')
  eq('차단 사유에 당월 조정 안내', !v.ok && v.reason.includes('이번 달'), true)
  eq('차단 사유에 경정청구 출구', !v.ok && v.reason.includes('경정청구'), true)
}

// ── 방어 ──────────────────────────────────────────────────────────────
eq('잘못된 월 형식', checkSettlementMonth('2026-8', '2026-08-02').ok, false)
eq('오늘이 월 형식이면 거부', checkSettlementMonth('2026-07', '2026-08').ok, false)
eq('빈 값', checkSettlementMonth('', '2026-08-02').ok, false)

console.log(`\n과거 회계월 보호: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
