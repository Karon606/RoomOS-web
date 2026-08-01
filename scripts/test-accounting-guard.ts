// 과거 회계월 보호 정본 회귀 테스트 — lib/accountingGuard. 실패 시 exit 1.
// 실행: npx tsx scripts/test-accounting-guard.ts
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
  if (v.ok) eq(name + ' (경고 없음)', v.warning, null)
}
const blocked = (name: string, mon: string, today: string, acq?: string) => {
  const v = checkSettlementMonth(mon, today, acq ?? null)
  eq(name, v.ok, false)
}
const warned = (name: string, mon: string, today: string, acq?: string) => {
  const v = checkSettlementMonth(mon, today, acq ?? null)
  eq(name, v.ok, true)
  if (v.ok) eq(name + ' (경고 있음)', typeof v.warning === 'string' && v.warning.length > 0, true)
}

// ── 미래·당월은 언제나 통과 ────────────────────────────────────────────
okNoWarn('당월', '2026-08', '2026-08')
okNoWarn('다음 달', '2026-09', '2026-08')
okNoWarn('내년', '2027-01', '2026-08')

// ── 같은 해 과거 달 — 허용하되 알린다 ─────────────────────────────────
warned('직전 달(7월)', '2026-07', '2026-08')
warned('같은 해 3월', '2026-03', '2026-08')

// 부가세 1기(1~6월) 확정신고는 7/25 — 8월부터는 이미 낸 기간이다
{
  const v = checkSettlementMonth('2026-05', '2026-08')
  eq('5월·8월 시점은 부가세 문구', v.ok && v.warning?.includes('부가가치세'), true)
}
{
  // 7월 시점에는 아직 확정신고 전이라 부가세 문구를 붙이지 않는다
  const v = checkSettlementMonth('2026-05', '2026-07')
  eq('5월·7월 시점은 일반 문구', v.ok && v.warning?.includes('부가가치세'), false)
}
{
  // 하반기 달은 같은 해 안에서 부가세 경계에 안 걸린다
  const v = checkSettlementMonth('2026-08', '2026-11')
  eq('8월·11월 시점은 일반 문구', v.ok && v.warning?.includes('부가가치세'), false)
}

// ── 전년도는 차단 (종합소득세 신고 완료 구간) ─────────────────────────
blocked('작년 12월', '2025-12', '2026-01')
blocked('작년 6월', '2025-06', '2026-08')
{
  const v = checkSettlementMonth('2025-12', '2026-01')
  eq('작년 차단 사유에 대안 안내', !v.ok && v.reason.includes('조정'), true)
}

// ── 인수 이전은 차단 ──────────────────────────────────────────────────
blocked('인수 이전 달', '2026-02', '2026-08', '2026-03-15')
okNoWarn('인수 당월(미래 아님이나 당월 이후)', '2026-08', '2026-08', '2026-03-15')
warned('인수 이후 과거 달', '2026-04', '2026-08', '2026-03-15')
{
  // 인수월 자체는 허용한다 — 그 달부터 우리 장부다
  const v = checkSettlementMonth('2026-03', '2026-08', '2026-03-15')
  eq('인수월은 허용', v.ok, true)
}
{
  // 전년도 + 인수 이전이 겹치면 인수 판정이 먼저(더 구체적인 사유)
  const v = checkSettlementMonth('2025-06', '2026-08', '2026-03-15')
  eq('겹칠 때 인수 사유 우선', !v.ok && v.reason.includes('인수'), true)
}

// ── 방어 ──────────────────────────────────────────────────────────────
eq('잘못된 월 형식', checkSettlementMonth('2026-8', '2026-08').ok, false)
eq('빈 값', checkSettlementMonth('', '2026-08').ok, false)
okNoWarn('인수일 없음 + 당월', '2026-08', '2026-08')

console.log(`\n과거 회계월 보호: ${pass} 통과 / ${fail} 실패`)
if (fail > 0) process.exit(1)
