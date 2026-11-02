// 제품 표기 진리표(lib/productMix). 실행: npx tsx scripts/test-product-mix.ts
//
// 고정하는 것(2026-11-02 운영자 승인 '추천대로', 가이드 §22 제품 표기).
//   · 라면 7-20 모양. 삼양 120봉 다음 진라면 100봉을 받고 128봉 남았으면 '오뚜기 100 · 삼양 28' 쯤 남았다(먼저 산 것부터 썼다는 추정).
//   · 한 브랜드뿐이면 한 토막. 김치 남도청년 표기 넷은 한 묶음이고 대표는 가장 많이 쓴 원문(같으면 최근).
//   · 잔량을 모르면(null) 추정하지 않는다. 브랜드 없이 제품명만 있으면 제품명이 짧은 이름이다.
//   · 재고 제외 지출과 단위가 안 맞는 구매는 어느 셈에도 안 들어간다.
import { resolveMadeMix, groupProducts, productKeyOf, productText, shelfBrandsText, type MixPurchase } from '../lib/productMix'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}
const d = (ymd: string) => new Date(`${ymd}T00:00:00Z`)
const buy = (brand: string | null, productName: string | null, ymd: string, qty: number, extra: Partial<MixPurchase> = {}): MixPurchase => ({
  brand, productName, date: d(ymd), receivedAt: new Date(`${ymd}T03:00:00Z`), qtyValue: qty, qtyUnit: '봉',
  specValue: null, specUnit: null, amount: qty * 600, ...extra,
})
const NOW = d('2026-11-03')
const U = { qtyUnit: '봉', useSpec: false, specUnit: null }

// ── 키와 원문 ──
eq('키 브랜드 대소문자·공백 무시', productKeyOf(' IKEA ', 'DVÅLA'), productKeyOf('ikea', null))
eq('키 브랜드 없으면 제품명', productKeyOf(null, '청결미'), 'p:청결미')
eq('키 둘 다 없으면 null', productKeyOf(' ', null), null)
eq('원문 공백 연결 브랜드 먼저', productText('오뚜기', '진라면 매운맛'), '오뚜기 진라면 매운맛')

// ── 라면 7-20: 진라면 100 + 삼양 28 ──
{
  const rows = [buy('삼양', '삼양라면 깔끔한 감칠맛', '2026-06-25', 120), buy('오뚜기', '진라면 매운맛', '2026-07-20', 100)]
  const m = resolveMadeMix(rows, 128, U, NOW)
  eq('라면 남은 제품', m.onShelf.map(g => [g.short, g.qty]), [['오뚜기', 100], ['삼양', 28]])
  eq('라면 메타', shelfBrandsText(m.onShelf), '오뚜기·삼양')
  eq('라면 마지막 받은 제품', [m.last?.text, m.last?.receivedOn], ['오뚜기 진라면 매운맛', '2026-07-20'])
  eq('라면 구매한 제품(같은 횟수면 최근 먼저)', m.history.map(h => [h.text, h.count]), [['오뚜기 진라면 매운맛', 1], ['삼양 삼양라면 깔끔한 감칠맛', 1]])
  eq('라면 봉당 단가', m.history.map(h => h.unitPrice), [600, 600])
}
// ── 한 브랜드 한 토막 ──
{
  const rows = [buy('오뚜기', '진라면 매운맛', '2026-10-06', 125), buy('오뚜기', '진라면 매운맛', '2026-10-24', 40), buy('오뚜기', '진라면 매운맛', '2026-10-24', 40)]
  const m = resolveMadeMix(rows, 150, U, NOW)
  eq('한 브랜드 남은 제품 하나', m.onShelf.map(g => [g.short, g.qty]), [['오뚜기', 150]])
  eq('한 브랜드 메타', shelfBrandsText(m.onShelf), '오뚜기')
  eq('한 브랜드 구매 3회', m.history.map(h => h.count), [3])
}
// ── 김치 표기 넷 = 한 묶음, 대표는 최빈(같으면 최근) ──
{
  const k = (p: string, ymd: string) => buy('남도청년', p, ymd, 2, { qtyUnit: '개', specValue: 10, specUnit: 'kg' })
  const rows = [k('땅끝해남 국내산 100% 전라도식 맛김치', '2026-09-07'), k('국내산 전라도 썰은배추김치', '2026-09-21'), k('100% 국내산 전라도 맛김치 썰은배추김치', '2026-10-10'), k('국내산 전라도 맛김치', '2026-10-27')]
  const m = resolveMadeMix(rows, 25, { qtyUnit: '개', useSpec: true, specUnit: 'kg' }, NOW)
  eq('김치 한 묶음', m.history.length, 1)
  eq('김치 대표 = 최근(모두 1회)', m.history[0].text, '남도청년 국내산 전라도 맛김치')
  eq('김치 kg 로 채움', m.onShelf.map(g => [g.short, g.qty]), [['남도청년', 25]])
  eq('김치 kg당 단가', m.history[0].unitPrice, 60)
  const twice = groupProducts([{ brand: '남도청년', productName: 'B' }, { brand: '남도청년', productName: 'A' }, { brand: '남도청년', productName: 'A' }])
  eq('대표 최빈 원문', twice[0].text, '남도청년 A')
  // 같은 원문이 groupBy 행 여럿으로 나뉘어 와도(n) 합산한다. B 2 대 A 1+2 = 3 이면 A.
  const weighted = groupProducts([{ brand: '남도청년', productName: 'B', n: 2 }, { brand: '남도청년', productName: 'A', n: 1 }, { brand: '남도청년', productName: 'A', n: 2 }])
  eq('조합별 건수(n)로 센 최빈', weighted[0].text, '남도청년 A')
}
// ── 잔량 null 이면 추정 없음, 0 도 없음 ──
{
  const rows = [buy('삼양', 'x', '2026-06-25', 120), buy('오뚜기', 'y', '2026-07-20', 100)]
  eq('잔량 null 추정 없음', resolveMadeMix(rows, null, U, NOW).onShelf, [])
  eq('잔량 0 추정 없음', resolveMadeMix(rows, 0, U, NOW).onShelf, [])
  eq('잔량 null 이어도 마지막 제품은 있다', resolveMadeMix(rows, null, U, NOW).last?.short, '오뚜기')
}
// ── 브랜드 없고 제품명만 ──
{
  const m = resolveMadeMix([buy(null, '청결미(25년햅쌀)', '2026-10-03', 2)], 1, U, NOW)
  eq('제품명만 짧은 이름', shelfBrandsText(m.onShelf), '청결미(25년햅쌀)')
  eq('제품명만 원문', m.last?.text, '청결미(25년햅쌀)')
}
// ── 이름 없는 구매는 자리만 차지 ──
{
  const rows = [buy('삼양', 'x', '2026-06-25', 50), buy(null, null, '2026-07-20', 100)]
  const m = resolveMadeMix(rows, 120, U, NOW)
  eq('이름 없는 구매 자리 차지', m.onShelf.map(g => [g.short, g.qty]), [['삼양', 20]])
  eq('마지막 받은 제품은 이름 있는 구매', m.last?.short, '삼양')
}
// ── 셋부터 외 N ──
eq('셋 외 1', shelfBrandsText([{ short: '오뚜기' }, { short: '삼양' }, { short: '농심' }]), '오뚜기·삼양 외 1')
eq('넷 외 2', shelfBrandsText([{ short: 'a' }, { short: 'b' }, { short: 'c' }, { short: 'd' }]), 'a·b 외 2')
eq('없으면 빈 글자', shelfBrandsText([]), '')
// ── 재고 제외·단위 불일치·받기 전 ──
{
  const rows = [
    buy('삼양', 'x', '2026-06-25', 100),
    buy('농심', 'z', '2026-07-01', 100, { excludeFromInventory: true }),
    buy('팔도', 'w', '2026-07-10', 100, { qtyUnit: '박스' }),
    buy('오뚜기', 'y', '2026-07-20', 50, { receivedAt: null }),
  ]
  const m = resolveMadeMix(rows, 80, U, NOW)
  eq('제외·단위 불일치·받기 전 빼고 채움', m.onShelf.map(g => g.short), ['삼양'])
  eq('받기 전은 마지막 받은 제품 아님', m.last?.short, '삼양')
  eq('구매한 제품엔 받기 전 포함, 제외·불일치 빠짐', m.history.map(h => h.short).sort(), ['삼양', '오뚜기'])
  eq('받기 전만 있는 묶음 단가 없음', m.history.find(h => h.short === '오뚜기')?.unitPrice, null)
}
// ── 12개월 창 ──
{
  const m = resolveMadeMix([buy('삼양', 'x', '2025-10-01', 10), buy('오뚜기', 'y', '2026-10-01', 10)], 5, U, NOW)
  eq('12개월 밖 구매는 구매한 제품에서 빠짐', m.history.map(h => h.short), ['오뚜기'])
}

console.log(`\n[제품 표기 진리표] 통과 ${pass} · 실패 ${fails.length}`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
