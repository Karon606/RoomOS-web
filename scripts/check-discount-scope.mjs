// 할인의 소급 범위가 조용히 바뀌는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가. 할인을 지우면 이미 할인가로 받고 끝난 지난 달까지 정가로 되쓰여 없던 미수가
// 생겼다("과거는 과거지" 운영자 지적 2026-08-31).
//
// **가장 단순한 처방(엔진에 월 하한을 세운다)이 가장 위험하다.** 그러면 셋이 동시에 터진다.
//   · 신고 70cde9d6 재발 — 소급 등록에서 과거 달 락이 구 기준값으로 남아 미납이 틀리게 뜬다.
//   · 신고 50a2a69b(크리티컬) 재발 — 입주월이 지난 예약 선납 락이 영영 안 고쳐진다.
//   · 감지망 오탐 폭주 — 정합 감사와 대조 스크립트가 '할인 데이터가 적용된다고 말하는 달'로
//     기대값을 세는데, 데이터는 전 기간이라 말하고 엔진만 과거를 안 고치면 그 전부가 걸린다.
//
// 그래서 하한을 **코드가 아니라 데이터가** 갖는다. 할인 자신의 시작·끝월이 범위를 정하고,
// 엔진은 무하한 그대로 둔다. 적용 기간 밖의 달은 변경 전후 청구액이 같아 알아서 건너뛴다.
//
// 축은 셋이다.
//   ⓐ 되쓰기 엔진에 월 하한이 없다.
//   ⓑ 계산 정본이 기간을 읽는다(permanent 도).
//   ⓒ 중단·적용취소가 존재한다 — 삭제만 있으면 그 뜻이 늘 소급 정정이 된다.
//
// 실행: node scripts/check-discount-scope.mjs
import { readFileSync } from 'node:fs'

const violations = []

// ⓐ 엔진의 월 하한.
{
  const f = 'app/(app)/rooms/paymentEngine.ts'
  const src = readFileSync(f, 'utf8')
  const fn = src.match(/export async function rewriteLockedExpectedForDiscountChange[\s\S]*?\n\}\n/)
  if (!fn) {
    violations.push(`${f} — rewriteLockedExpectedForDiscountChange 를 못 찾았다.`)
  } else if (/targetMonth:\s*\{\s*(gte|gt)\b/.test(fn[0])) {
    violations.push(`${f} — 되쓰기에 월 하한이 섰다. 신고 70cde9d6·50a2a69b 가 재발하고 감지망이 과거 달을 전부 오탐한다. 범위는 할인 데이터의 시작·끝월이 정한다.`)
  }
}

// ⓑ 계산 정본이 기간을 읽는가.
{
  const f = 'lib/rentDiscount.ts'
  const src = readFileSync(f, 'utf8')
  const fn = src.match(/export function discountForMonth[\s\S]*?\n\}\n/)
  if (!fn) {
    violations.push(`${f} — discountForMonth 를 못 찾았다.`)
  } else {
    // permanent 가 기간을 안 읽고 무조건 참이면 옛 거동으로 돌아간 것이다.
    // 옛 형태는 permanent 뒤에 || 가 이어져 '무조건 참'이었다. 새 형태는 삼항으로 기간을 본다.
    if (/permanent'\s*\|\|/.test(fn[0])) {
      violations.push(`${f} — 영구 할인이 기간을 안 읽는다. 무조건 전 기간 소급으로 돌아가 지난 달 청구가 다시 흔들린다.`)
    }
    if (!/startMonth/.test(fn[0]) || !/endMonth/.test(fn[0])) {
      violations.push(`${f} — 계산 정본이 시작·끝월을 안 본다.`)
    }
  }
}

// ⓒ 중단과 적용취소.
{
  const f = 'app/(app)/rooms/actions.ts'
  const src = readFileSync(f, 'utf8')
  for (const [name, re] of [
    ['중단', /export async function endRentDiscount\b/],
    ['중단 적용취소', /export async function undoEndRentDiscount\b/],
    ['중단 미리보기', /export async function previewDiscountEnd\b/],
  ]) {
    if (!re.test(src)) {
      violations.push(`${f} — '${name}' 이 없다. 삭제만 남으면 할인을 끝내는 일이 늘 소급 정정이 된다.`)
    }
  }
  // 화면이 두 뜻을 갈라 묻는가.
  const w = readFileSync('components/entity-modal/widgets/DiscountWidget.tsx', 'utf8')
  if (!/endRentDiscount\(/.test(w) || !/choiceDialog\(/.test(w)) {
    violations.push('components/entity-modal/widgets/DiscountWidget.tsx — 중단과 소급 삭제를 갈라 묻지 않는다. 버튼 하나에 두 뜻이 숨는다.')
  }
}

console.log(`[할인 소급 범위] 축 ⓐ 엔진 무하한 · ⓑ 정본이 기간 해석 · ⓒ 중단·적용취소 / 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  소급 범위는 할인 데이터가 정한다. 엔진에 하한을 세우면 두 신고가 재발한다.')
  process.exit(1)
}
