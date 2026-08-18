// 보정 차이 소비 귀속 판정 정본(inventory/constants.resolveDiffAttribution) 회귀 테스트 — DB 불필요.
// 운영자 승인 사양(2026-08-19)을 박제한다. '사용으로 기록'을 고르면 그 저장은 일반 점검이어야
// 하고(isReconcile=false), 그때만 직전 점검 이후 구간의 소모로 계산된다(overview.ts intervalPairs).
import { resolveDiffAttribution, DIFF_MEMO_EXCLUDE, DIFF_MEMO_USAGE } from '../app/(app)/inventory/constants'

let pass = 0
const fails: string[] = []

function eq(label: string, got: unknown, want: unknown) {
  if (Object.is(got, want)) pass++
  else fails.push(`${label}: 기대 ${String(want)} / 실제 ${String(got)}`)
}

// ── 수용 기준: 사용 기록을 고르면 isReconcile=false 로 저장된다 ──────────────
{
  const r = resolveDiffAttribution('usage', -12)   // 실측이 예상보다 12 적음 = 지난 기간 소비
  eq('사용 기록: 일반 점검으로 저장', r.isReconcile, false)
  eq('사용 기록: 기본 메모', r.defaultMemo, DIFF_MEMO_USAGE)
}

// ── 기본값은 현행(제외) — 인자를 안 주면 아무것도 바뀌지 않는다 ──────────────
{
  eq('기본값: 보정', resolveDiffAttribution(undefined, -12).isReconcile, true)
  eq('기본값: 메모', resolveDiffAttribution(undefined, -12).defaultMemo, DIFF_MEMO_EXCLUDE)
  eq('명시 제외: 보정', resolveDiffAttribution('exclude', -12).isReconcile, true)
}

// ── 늘어난 차이는 선택과 무관하게 보정 ─────────────────────────────────────
// 일반 점검으로 저장하면 그 구간이 음수 소모로 잡혀 평균 소모율을 갉아먹는다.
{
  eq('증가분: 사용 선택이어도 보정', resolveDiffAttribution('usage', +8).isReconcile, true)
  eq('증가분: 메모도 보정', resolveDiffAttribution('usage', +8).defaultMemo, DIFF_MEMO_EXCLUDE)
  eq('차이 0: 보정', resolveDiffAttribution('usage', 0).isReconcile, true)
}

// ── 부호 판정 근거가 없으면(예상 재고 미전달) 현행으로 남긴다 ────────────────
{
  eq('예상 없음: 보정', resolveDiffAttribution('usage', null).isReconcile, true)
  eq('예상 미정의: 보정', resolveDiffAttribution('usage', undefined).isReconcile, true)
}

// ── 소수 오차는 차이로 보지 않는다 (표시 반올림 0.001 보다 훨씬 촘촘한 1e-6 경계) ──
{
  eq('오차: -1e-9 는 보정', resolveDiffAttribution('usage', -1e-9).isReconcile, true)
  eq('오차: -0.01 은 사용', resolveDiffAttribution('usage', -0.01).isReconcile, false)
}

console.log(`\n보정 차이 귀속 회귀: ${pass} 통과 / ${fails.length} 실패`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
