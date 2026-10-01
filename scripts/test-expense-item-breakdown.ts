// 지출 카테고리 품목 세부(lib/expenseItemBreakdown) 회귀 + 재무 화면 배선 그물 — 실행: npx tsx scripts/test-expense-item-breakdown.ts
//
// 고정하는 것(신고 bc5d1c06, 2026-10-01 운영자 승인).
//   · 행 하나는 정확히 한 버킷: 배송비 > itemLabel > 고정지출 제목 > 품목 미지정
//   · 건수는 allocationGroupId 가 같은 행을 1건으로 센다(방별로 쪼갠 한 품목)
//   · 수량 합은 단위가 전부 같고 수량이 다 있을 때만
//   · Σ버킷 금액 == 입력 합(무작위 다수)
//   · FinanceClient 가 품목 세부 입력으로 카테고리 합(currentCatMap)과 같은 배열을 쓴다
import fs from 'node:fs'
import path from 'node:path'
import { expenseItemBreakdown, UNASSIGNED_BUCKET, SHIPPING_BUCKET, type BreakdownInput } from '../lib/expenseItemBreakdown'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}

function row(p: Partial<BreakdownInput> & { amount: number }): BreakdownInput {
  return {
    isShipping: false, itemLabel: null, recurringExpenseId: null, detail: null,
    allocationGroupId: null, qtyValue: null, qtyUnit: null, ...p,
  }
}

// ── 4버킷 분류 ────────────────────────────────────────────────────
{
  const out = expenseItemBreakdown([
    row({ amount: 3000, isShipping: true, itemLabel: '김치', detail: '배송' }),   // 배송비가 라벨보다 먼저
    row({ amount: 30000, itemLabel: '김치', detail: '아무 글' }),
    row({ amount: 50000, itemLabel: '쌀', recurringExpenseId: 'r1', detail: '쌀 정기' }),   // 라벨이 제목보다 먼저
    row({ amount: 80000, recurringExpenseId: 'r2', detail: '정수기 렌탈' }),
    row({ amount: 9000, detail: '시장 장보기' }),                                // 수기 detail 은 묶지 않는다
    row({ amount: 1000, detail: '두부' }),
    row({ amount: 2000, recurringExpenseId: 'r3', detail: null }),              // 제목 없는 고정지출은 품목 미지정
  ])
  eq('분류 라벨·순서', out.map(b => [b.label, b.kind, b.amount]), [
    ['정수기 렌탈', 'recurring', 80000],
    ['쌀', 'item', 50000],
    ['김치', 'item', 30000],
    [SHIPPING_BUCKET, 'shipping', 3000],
    [UNASSIGNED_BUCKET, 'none', 12000],
  ])
}
// brand/productName 은 키가 아니다 — 입력 타입에 없어도 런타임 객체에 실려 오므로 섞여도 무시해야 한다.
{
  const out = expenseItemBreakdown([
    { ...row({ amount: 100, itemLabel: '라면' }), brand: '농심', productName: '신라면' } as BreakdownInput,
    { ...row({ amount: 200, itemLabel: '라면' }), brand: '오뚜기', productName: '진라면' } as BreakdownInput,
  ])
  eq('brand 무시', out.map(b => [b.label, b.amount, b.count]), [['라면', 300, 2]])
}
// 품목 이름이 '배송비' 인 일반 행과 실제 배송비 행은 다른 버킷
{
  const out = expenseItemBreakdown([
    row({ amount: 500, itemLabel: '배송비' }),
    row({ amount: 700, isShipping: true }),
  ])
  eq('같은 이름 다른 성질', out.map(b => [b.kind, b.amount]), [['shipping', 700], ['item', 500]])
}
// 문구 고정 — '내역 없음'은 detail 이 있는 수기 지출까지 묶여 사실과 달랐다(웹디자이너 패스).
eq('버킷 문구', UNASSIGNED_BUCKET, '품목 미지정')
// 품목 미지정은 금액이 커도 맨 뒤
{
  const out = expenseItemBreakdown([row({ amount: 999999 }), row({ amount: 1, itemLabel: '소금' })])
  eq('품목 미지정 맨 뒤', out.map(b => b.label), ['소금', UNASSIGNED_BUCKET])
}

// ── 건수: allocationGroupId ──────────────────────────────────────
{
  const out = expenseItemBreakdown([
    row({ amount: 10000, itemLabel: '장판', allocationGroupId: 'g1' }),
    row({ amount: 10000, itemLabel: '장판', allocationGroupId: 'g1' }),
    row({ amount: 10000, itemLabel: '장판', allocationGroupId: 'g1' }),
    row({ amount: 5000, itemLabel: '장판', allocationGroupId: 'g2' }),
    row({ amount: 4000, itemLabel: '장판' }),
    row({ amount: 4000, itemLabel: '장판' }),
  ])
  eq('묶음은 1건', out[0].count, 4)
  eq('묶음 금액은 전부 합', out[0].amount, 43000)
}

// ── 수량 합 ──────────────────────────────────────────────────────
{
  const same = expenseItemBreakdown([
    row({ amount: 1, itemLabel: '김치', qtyValue: 2, qtyUnit: '포기' }),
    row({ amount: 1, itemLabel: '김치', qtyValue: 1.5, qtyUnit: '포기' }),
  ])
  eq('같은 단위 합', same[0].qty, { value: 3.5, unit: '포기' })
  const mixed = expenseItemBreakdown([
    row({ amount: 1, itemLabel: '김치', qtyValue: 2, qtyUnit: '포기' }),
    row({ amount: 1, itemLabel: '김치', qtyValue: 10, qtyUnit: 'kg' }),
  ])
  eq('단위 혼합은 미표시', mixed[0].qty, null)
  const missing = expenseItemBreakdown([
    row({ amount: 1, itemLabel: '쌀', qtyValue: 1, qtyUnit: '포대' }),
    row({ amount: 1, itemLabel: '쌀', qtyValue: null, qtyUnit: '포대' }),
  ])
  eq('수량 빠진 행이 있으면 미표시', missing[0].qty, null)
  const noUnit = expenseItemBreakdown([row({ amount: 1, itemLabel: '쌀', qtyValue: 3, qtyUnit: null })])
  eq('단위 없으면 미표시', noUnit[0].qty, null)
}

// ── Σ 불변식(무작위) ─────────────────────────────────────────────
{
  let seed = 20261001
  const rnd = () => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed / 2147483648 }
  function pick<T>(xs: T[]): T { return xs[Math.floor(rnd() * xs.length)] }
  const labels = [null, '', '  ', '김치', '쌀', '라면', '배송비']
  const details = [null, '', '정수기 렌탈', '시장', '김치']
  let bad = 0
  for (let t = 0; t < 500; t++) {
    const n = Math.floor(rnd() * 30)
    const rows: BreakdownInput[] = []
    for (let k = 0; k < n; k++) {
      rows.push(row({
        amount: Math.floor(rnd() * 200000) - 20000,   // 음수(환불·정정)도 섞는다
        isShipping: rnd() < 0.1,
        itemLabel: pick(labels),
        recurringExpenseId: rnd() < 0.3 ? 'r' : null,
        detail: pick(details),
        allocationGroupId: rnd() < 0.3 ? pick(['g1', 'g2', 'g3']) : null,
        qtyValue: rnd() < 0.8 ? Math.floor(rnd() * 5) : null,
        qtyUnit: pick([null, '개', '포기']),
      }))
    }
    const out = expenseItemBreakdown(rows)
    const sum = out.reduce((s, b) => s + b.amount, 0)
    const want = rows.reduce((s, r) => s + r.amount, 0)
    const rowsCounted = out.reduce((s, b) => s + b.count, 0)
    if (sum !== want || rowsCounted > rows.length || (n > 0 && out.length === 0)) bad++
    // 품목 미지정은 언제나 맨 뒤
    const ni = out.findIndex(b => b.kind === 'none')
    if (ni >= 0 && ni !== out.length - 1) bad++
  }
  eq('무작위 500회 Σ버킷 == 입력 합, 품목 미지정 맨 뒤', bad, 0)
}

// ── 배선: FinanceClient 가 currentCatMap 과 같은 배열로 품목 세부를 낸다 ──────
{
  const src = fs.readFileSync(path.join(__dirname, '../app/(app)/finance/FinanceClient.tsx'), 'utf8')
  const catMap = src.match(/for \(const e of (\w+)\) currentCatMap\[e\.category\]/)
  const calls = [...src.matchAll(/expenseItemBreakdown\(([^)]*)\)/g)].map(m => m[1])
  eq('currentCatMap 원천을 찾음', !!catMap, true)
  eq('품목 세부 호출 1곳', calls.length, 1)
  const call = calls[0] ?? ''
  const m = call.match(/^(\w+)\.filter\(e => e\.category === openCategory$/)
  eq('품목 세부 입력이 같은 배열을 카테고리로만 거른다', m?.[1] ?? call, catMap?.[1])
}

console.log(`expense-item-breakdown: ${pass} 통과, ${fails.length} 실패`)
if (fails.length) { for (const f of fails) console.log('  실패 ' + f); process.exit(1) }
