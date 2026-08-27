// 수납 편집 범위 회귀 — 실행: npx tsx scripts/test-payment-edit-scope.ts
//
// 고정하는 것 셋.
//   · **귀속월 화면에서는 언제나 된다** — 편집 접점을 귀속월 하나로 묶는 원칙.
//   · **미래 귀속은 어느 화면에서든 된다** — 선납이 원칙인 사업이라 9월 귀속 건이 8월에 계속
//     생기는데, 종전에는 고칠 길이 아예 없었다(406호 실기 2026-08-27).
//   · **과거 귀속은 그 달로 가야 한다** — 예외가 원칙을 무르지 않는다. 지난달 매출이
//     어느 화면에서나 바뀌면 안 된다는 원래 걱정은 그대로 살아 있다.
import { canEditPaymentHere } from '../lib/paymentEditScope'

let pass = 0
const fails: string[] = []
function eq(name: string, got: boolean, want: boolean) {
  if (got === want) { pass++; return }
  fails.push(`${name}: 기대 ${want ? '가능' : '불가'} / 실제 ${got ? '가능' : '불가'}`)
}

const NOW = '2026-08'

// ── 귀속월 화면 ─────────────────────────────────────────────────────
eq('이번 달 귀속을 이번 달 화면에서', canEditPaymentHere('2026-08', '2026-08', NOW), true)
eq('지난달 귀속을 지난달 화면에서', canEditPaymentHere('2026-07', '2026-07', NOW), true)
eq('작년 귀속을 그 달 화면에서', canEditPaymentHere('2025-12', '2025-12', NOW), true)

// ── 미래 귀속 — 어느 화면에서든 ─────────────────────────────────────
// 406호 실기가 정확히 이 줄이다. 8/27 입금 · 9월 귀속을 8월 화면에서 봤다.
eq('다음 달 귀속을 이번 달 화면에서', canEditPaymentHere('2026-09', '2026-08', NOW), true)
eq('다음 달 귀속을 그 달 화면에서', canEditPaymentHere('2026-09', '2026-09', NOW), true)
eq('두 달 뒤 귀속을 이번 달 화면에서', canEditPaymentHere('2026-10', '2026-08', NOW), true)
eq('해를 넘긴 미래 귀속', canEditPaymentHere('2027-01', '2026-08', NOW), true)
eq('미래 귀속을 지난달 화면에서도', canEditPaymentHere('2026-09', '2026-07', NOW), true)

// ── 과거 귀속 — 그 달로 가야 한다 ───────────────────────────────────
eq('지난달 귀속을 이번 달 화면에서는 불가', canEditPaymentHere('2026-07', '2026-08', NOW), false)
eq('작년 귀속을 이번 달 화면에서는 불가', canEditPaymentHere('2025-12', '2026-08', NOW), false)
eq('지난달 귀속을 다른 지난달 화면에서는 불가', canEditPaymentHere('2026-06', '2026-07', NOW), false)
// 이번 달 귀속도 예외가 아니다 — 미래가 아니라서다(경계).
eq('이번 달 귀속을 지난달 화면에서는 불가', canEditPaymentHere('2026-08', '2026-07', NOW), false)

// ── 경계 ────────────────────────────────────────────────────────────
// 문자열 비교라 자릿수가 같아야 한다('2026-9' 같은 값이 들어오면 비교가 깨진다).
eq('이번 달은 미래가 아니다', canEditPaymentHere('2026-08', '2026-05', NOW), false)
eq('해 바뀜 직전 · 12월에서 본 1월 귀속', canEditPaymentHere('2027-01', '2026-12', '2026-12'), true)
eq('해 바뀜 직후 · 1월에서 본 12월 귀속', canEditPaymentHere('2026-12', '2027-01', '2027-01'), false)

console.log(`\n수납 편집 범위 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
