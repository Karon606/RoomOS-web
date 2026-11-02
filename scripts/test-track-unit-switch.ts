// 재고 추적 단위 전환 배수 정본(lib/trackUnitSwitch) 진리표. 실패 시 exit 1
// 실행: npx tsx scripts/test-track-unit-switch.ts
//
// 왜(운영자 승인 2026-11-02). 종전 전환은 trackUnit 만 바꿔 옛 단위 점검 위에 새 단위 구매가 더해졌다(4500ml 점검에 개수 구매).
// 배수는 그 품명 구매 규격이 물리 동치로 한 규격일 때만 서고, 섞였거나 이력이 없으면 기록이 있을 때 거부한다.
import { planTrackUnitSwitch, countsBySpec, rescaleReceiptMemo } from '../lib/trackUnitSwitch'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const P = (specValue: number | null, specUnit: string | null) => ({ specValue, specUnit })
const ok = (r: ReturnType<typeof planTrackUnitSwitch>) => r.ok ? { ok: true, factor: Number(r.factor.toFixed(9)), m: r.multiplier } : { ok: false, reason: r.reason }

// C 잔량 축(overview useSpec 과 같은 식)
eq('C1 규격 + 단위', countsBySpec('spec', 'ml'), true)
eq('C2 규격 + 단위 없음', countsBySpec('spec', null), false)
eq('C3 규격 + 공백 단위', countsBySpec('spec', '  '), false)
eq('C4 수량', countsBySpec('qty', 'ml'), false)

// S 규격에서 수량으로 · 450ml 한 규격이면 1/450
eq('S1 한 규격', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'ml'), P(450, 'ml')], hasRecords: true })), { ok: true, factor: 0.002222222, m: 450 })
eq('S2 물리 동치(0.45L 와 450ml)', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'ml'), P(0.45, 'L')], hasRecords: true })), { ok: true, factor: 0.002222222, m: 450 })
eq('S3 규격 없는 구매는 판정에서 뺀다', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'ml'), P(null, null)], hasRecords: true })), { ok: true, factor: 0.002222222, m: 450 })
eq('S4 섞임은 거부', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'ml'), P(500, 'ml')], hasRecords: true })), { ok: false, reason: 'mixed' })
eq('S5 이력 없음은 거부', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(null, null)], hasRecords: true })), { ok: false, reason: 'none' })
eq('S6 카드 단위로 환산 안 되는 규격은 거부', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'g')], hasRecords: true })), { ok: false, reason: 'dimension' })
eq('S7 기록이 없으면 섞여도 배수 1', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'ml'), P(500, 'ml')], hasRecords: false })), { ok: true, factor: 1, m: null })
eq('S8 길이(빨래줄 10m 세트)', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'm', purchases: [P(10, 'm')], hasRecords: true })), { ok: true, factor: 0.1, m: 10 })

// Q 수량에서 규격으로 · 배수 m
eq('Q1 한 규격', ok(planTrackUnitSwitch({ from: 'qty', to: 'spec', cardSpecUnit: 'ml', purchases: [P(450, 'ml')], hasRecords: true })), { ok: true, factor: 450, m: 450 })
eq('Q2 섞임 거부', ok(planTrackUnitSwitch({ from: 'qty', to: 'spec', cardSpecUnit: 'kg', purchases: [P(20, 'kg'), P(10, 'kg')], hasRecords: true })), { ok: false, reason: 'mixed' })

// N 잔량 축이 안 바뀌면 배수 1(카드 규격 단위가 없으면 규격으로도 개수로 센다)
eq('N1 카드 규격 단위 없음', ok(planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: null, purchases: [P(450, 'ml'), P(500, 'ml')], hasRecords: true })), { ok: true, factor: 1, m: null })

// 거부 문장 · 까닭과 규격을 말한다(마침표로 끝난다)
{
  const r = planTrackUnitSwitch({ from: 'spec', to: 'qty', cardSpecUnit: 'ml', purchases: [P(450, 'ml'), P(500, 'ml')], hasRecords: true })
  eq('M1 섞임 문장', r.ok ? null : r.message, '구매 규격이 450ml, 500ml 로 섞여 있어 지난 점검 값을 바꿀 배수를 정할 수 없습니다.')
}

// R 수령 자동 메모 다시 쓰기
eq('R1 ml 에서 개', rescaleReceiptMemo('[수령 자동] +4500ml', 1 / 450, '개'), '[수령 자동] +10개')
eq('R2 개에서 ml', rescaleReceiptMemo('[수령 자동] +10개', 450, 'ml'), '[수령 자동] +4500ml')
eq('R3 다른 메모는 손대지 않음', rescaleReceiptMemo('위치별 점검 (4층 주방)', 450, 'ml'), null)
eq('R4 합산 메모는 손대지 않음', rescaleReceiptMemo('[수령 자동·합산] 수령 2건 합산', 450, 'ml'), null)
eq('R5 소수', rescaleReceiptMemo('[수령 자동] +1.5kg', 1 / 20, '포대'), '[수령 자동] +0.075포대')

console.log(`[추적 단위 전환 판정] 통과 ${pass} · 실패 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
