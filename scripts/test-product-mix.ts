// 제품 표기 진리표(lib/productMix). 실행: npx tsx scripts/test-product-mix.ts
//
// 고정하는 것(2026-11-02 운영자 승인 '추천대로', 가이드 §22 제품 표기).
//   · 라면 7-20 모양. 삼양 120봉 다음 진라면 100봉을 받고 128봉 남았으면 '오뚜기 100 · 삼양 28' 쯤 남았다(먼저 산 것부터 썼다는 추정).
//   · 한 브랜드뿐이면 한 토막. 김치 남도청년 표기 넷은 한 묶음이고 대표는 가장 많이 쓴 원문(같으면 최근).
//   · 잔량을 모르면(null) 추정하지 않는다. 브랜드 없이 제품명만 있으면 제품명이 짧은 이름이다.
//   · 재고 제외 지출과 단위가 안 맞는 구매는 어느 셈에도 안 들어간다.
//   · 제품별 보기(2026-11 등재). 제품 줄 합 + 외 N종 + '제품 기록 없음' = 통합, 한 지출은 한 묶음, 줄·선은 3까지, 묶음 둘 미만이면 토글 없음.
//     달 줄 이름은 그 달 최빈 원문(단가 선 이름은 전 기간 최빈), 토글 판정은 두 탭이 한 함수(0원 구매는 재료 밖).
//     남아 있을 제품도 같은 셈이다. 이름 있는 묶음 합 + 이름 없는 구매가 차지한 자리 = 잔량.
//   · 카드 메타 표기(2026-11-03 운영자 지시). full = '브랜드 제품명'(기록된 원문 그대로, 제품명이 브랜드로 시작해도 줄이지 않는다), name = 제품명만(없으면 브랜드). 묶음 전체가 한 표기다.
import { resolveMadeMix, groupProducts, productKeyOf, productText, shelfName, shelfProductsText, splitInflowByProduct, splitPriceByProduct, productViewKeys, showsProductView, PRODUCT_LINES_MAX, type MixPurchase, type InflowPurchase, type InflowSplit } from '../lib/productMix'

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
  eq('라면 남은 제품', m.onShelf.map(g => [g.brand, g.qty]), [['오뚜기', 100], ['삼양', 28]])
  eq('라면 메타 브랜드 제품명', shelfProductsText(m.onShelf, 'full'), '오뚜기 진라면 매운맛, 삼양 삼양라면 깔끔한 감칠맛')
  eq('라면 메타 제품명만(둘 다 같이)', shelfProductsText(m.onShelf, 'name'), '진라면 매운맛, 삼양라면 깔끔한 감칠맛')
  eq('라면 마지막 받은 제품', [m.last?.text, m.last?.receivedOn], ['오뚜기 진라면 매운맛', '2026-07-20'])
  eq('라면 구매한 제품(같은 횟수면 최근 먼저)', m.history.map(h => [h.text, h.count]), [['오뚜기 진라면 매운맛', 1], ['삼양 삼양라면 깔끔한 감칠맛', 1]])
  eq('라면 봉당 단가', m.history.map(h => h.unitPrice), [600, 600])
}
// ── 한 브랜드 한 토막 ──
{
  const rows = [buy('오뚜기', '진라면 매운맛', '2026-10-06', 125), buy('오뚜기', '진라면 매운맛', '2026-10-24', 40), buy('오뚜기', '진라면 매운맛', '2026-10-24', 40)]
  const m = resolveMadeMix(rows, 150, U, NOW)
  eq('한 브랜드 남은 제품 하나', m.onShelf.map(g => [g.brand, g.qty]), [['오뚜기', 150]])
  eq('한 브랜드 메타', shelfProductsText(m.onShelf, 'full'), '오뚜기 진라면 매운맛')
  eq('한 브랜드 메타 제품명만', shelfProductsText(m.onShelf, 'name'), '진라면 매운맛')
  eq('한 브랜드 구매 3회', m.history.map(h => h.count), [3])
}
// ── 김치 표기 넷 = 한 묶음, 대표는 최빈(같으면 최근) ──
{
  const k = (p: string, ymd: string) => buy('남도청년', p, ymd, 2, { qtyUnit: '개', specValue: 10, specUnit: 'kg' })
  const rows = [k('땅끝해남 국내산 100% 전라도식 맛김치', '2026-09-07'), k('국내산 전라도 썰은배추김치', '2026-09-21'), k('100% 국내산 전라도 맛김치 썰은배추김치', '2026-10-10'), k('국내산 전라도 맛김치', '2026-10-27')]
  const m = resolveMadeMix(rows, 25, { qtyUnit: '개', useSpec: true, specUnit: 'kg' }, NOW)
  eq('김치 한 묶음', m.history.length, 1)
  eq('김치 대표 = 최근(모두 1회)', m.history[0].text, '남도청년 국내산 전라도 맛김치')
  eq('김치 kg 로 채움', m.onShelf.map(g => [g.brand, g.qty]), [['남도청년', 25]])
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
  eq('잔량 null 이어도 마지막 제품은 있다', resolveMadeMix(rows, null, U, NOW).last?.brand, '오뚜기')
}
// ── 브랜드 없고 제품명만 ──
{
  const m = resolveMadeMix([buy(null, '청결미(25년햅쌀)', '2026-10-03', 2)], 1, U, NOW)
  eq('브랜드 없으면 제품명만', shelfProductsText(m.onShelf, 'full'), '청결미(25년햅쌀)')
  eq('브랜드 없으면 좁아도 제품명', shelfProductsText(m.onShelf, 'name'), '청결미(25년햅쌀)')
  eq('제품명만 원문', m.last?.text, '청결미(25년햅쌀)')
}
// ── 이름 없는 구매는 자리만 차지 ──
{
  const rows = [buy('삼양', 'x', '2026-06-25', 50), buy(null, null, '2026-07-20', 100)]
  const m = resolveMadeMix(rows, 120, U, NOW)
  eq('이름 없는 구매 자리 차지', m.onShelf.map(g => [g.brand, g.qty]), [['삼양', 20]])
  eq('마지막 받은 제품은 이름 있는 구매', m.last?.brand, '삼양')
}
// ── 셋부터 외 N ──
{
  const p = (brand: string | null, productName: string | null) => ({ brand, productName })
  const three = [p('오뚜기', '진라면 매운맛'), p('삼양', '삼양라면'), p('농심', '신라면')]
  eq('셋 외 1', shelfProductsText(three, 'full'), '오뚜기 진라면 매운맛, 삼양 삼양라면 외 1')
  eq('셋 외 1 제품명만', shelfProductsText(three, 'name'), '진라면 매운맛, 삼양라면 외 1')
  eq('넷 외 2', shelfProductsText([p('a', null), p('b', null), p('c', null), p('d', null)], 'full'), 'a, b 외 2')
  eq('없으면 빈 글자', shelfProductsText([], 'full'), '')
  // 한 토막 규칙. 브랜드가 없으면 제품명만, 제품명이 없으면 브랜드만(좁아도 버릴 것이 없다).
  eq('토막 둘 다', shelfName(p(' 스파크 ', '스마트 클린 '), 'full'), '스파크 스마트 클린')
  eq('토막 좁으면 제품명', shelfName(p('스파크', '스마트 클린'), 'name'), '스마트 클린')
  eq('토막 제품명 없으면 브랜드', [shelfName(p('스파크', null), 'full'), shelfName(p('스파크', ' '), 'name')], ['스파크', '스파크'])
  eq('토막 브랜드 없으면 제품명', [shelfName(p(null, '청결미'), 'full'), shelfName(p('', '청결미'), 'name')], ['청결미', '청결미'])
  // 제품명이 브랜드로 시작해도 기록된 원문 그대로(2026-11-03 운영자 지시로 겹침 처리를 걷었다). 좁으면 제품명만은 그대로.
  eq('토막 브랜드 겹쳐도 원문', [shelfName(p('삼양', '삼양라면 깔끔한 감칠맛'), 'full'), shelfName(p('CJ', 'cj 햇반'), 'full'), shelfName(p('오뚜기', '진라면'), 'full')],
    ['삼양 삼양라면 깔끔한 감칠맛', 'CJ cj 햇반', '오뚜기 진라면'])
  eq('토막 브랜드 겹쳐도 좁으면 제품명', shelfName(p('삼양', '삼양라면 깔끔한 감칠맛'), 'name'), '삼양라면 깔끔한 감칠맛')
  eq('원문은 겹쳐도 그대로', productText('삼양', '삼양라면'), '삼양 삼양라면')
  // 섞인 묶음에서 한쪽만 브랜드가 없어도 표기는 묶음 전체에 하나다.
  eq('섞인 묶음 한 표기', [shelfProductsText([p('스파크', '스마트 클린'), p(null, '세탁세제')], 'full'), shelfProductsText([p('스파크', '스마트 클린'), p(null, '세탁세제')], 'name')],
    ['스파크 스마트 클린, 세탁세제', '스마트 클린, 세탁세제'])
}
// ── 재고 제외·단위 불일치·받기 전 ──
{
  const rows = [
    buy('삼양', 'x', '2026-06-25', 100),
    buy('농심', 'z', '2026-07-01', 100, { excludeFromInventory: true }),
    buy('팔도', 'w', '2026-07-10', 100, { qtyUnit: '박스' }),
    buy('오뚜기', 'y', '2026-07-20', 50, { receivedAt: null }),
  ]
  const m = resolveMadeMix(rows, 80, U, NOW)
  eq('제외·단위 불일치·받기 전 빼고 채움', m.onShelf.map(g => g.brand), ['삼양'])
  eq('받기 전은 마지막 받은 제품 아님', m.last?.brand, '삼양')
  eq('구매한 제품엔 받기 전 포함, 제외·불일치 빠짐', m.history.map(h => h.brand).sort(), ['삼양', '오뚜기'])
  eq('받기 전만 있는 묶음 단가 없음', m.history.find(h => h.brand === '오뚜기')?.unitPrice, null)
}
// ── 12개월 창 ──
{
  const m = resolveMadeMix([buy('삼양', 'x', '2025-10-01', 10), buy('오뚜기', 'y', '2026-10-01', 10)], 5, U, NOW)
  eq('12개월 밖 구매는 구매한 제품에서 빠짐', m.history.map(h => h.brand), ['오뚜기'])
}

// ── 제품별 보기: 남아 있을 제품도 묶음 합 + 이름 없는 자리 = 잔량 ──
{
  const rows = [buy('삼양', 'x', '2026-06-25', 50), buy(null, null, '2026-07-10', 30), buy('오뚜기', 'y', '2026-07-20', 40)]
  const m = resolveMadeMix(rows, 100, U, NOW)
  eq('남은 제품 합 + 이름 없는 자리 = 잔량', m.onShelf.reduce((s, g) => s + g.qty, 0) + 30, 100)
}
// ── 제품별 보기: 달별 입수 ──
{
  const ip = (brand: string | null, productName: string | null, ymd: string, qty: number, amount = qty * 600): InflowPurchase =>
    ({ date: d(ymd), month: ymd.slice(0, 7), brand, productName, qty, amount })
  const sumSplit = (s: InflowSplit) => s.lines.reduce((t, l) => t + l.qty, 0) + (s.more?.qty ?? 0) + (s.unrecorded?.qty ?? 0)
  const purchases = [
    ip('삼양', '삼양라면', '2026-07-02', 40), ip('오뚜기', '진라면 매운맛', '2026-07-20', 100), ip(' 오뚜기 ', '진라면 순한맛', '2026-07-25', 20),
    ip('농심', '신라면', '2026-07-10', 10), ip('팔도', '비빔면', '2026-07-11', 5), ip(null, null, '2026-07-12', 7, 4200),
    ip('삼양', '삼양라면', '2026-08-03', 30),
  ]
  const additions = [{ month: '2026-07', qty: 3 }, { month: '2026-09', qty: 6 }]
  const split = splitInflowByProduct(purchases, additions)
  const jul = split.get('2026-07')!
  // 통합(합계)은 구매 182 + 무상 3 = 185. 제품별 합 + 외 N종 + 나머지가 같은 값이어야 한다.
  eq('7월 제품별 합 = 통합', sumSplit(jul), 40 + 100 + 20 + 10 + 5 + 7 + 3)
  eq('7월 금액 합 = 통합', jul.lines.reduce((t, l) => t + l.amount, 0) + (jul.more?.amount ?? 0) + (jul.unrecorded?.amount ?? 0), (40 + 100 + 20 + 10 + 5) * 600 + 4200)
  eq('7월 줄은 많이 들어온 순 3줄', jul.lines.map(l => [l.text, l.qty]), [['오뚜기 진라면 순한맛', 120], ['삼양 삼양라면', 40], ['농심 신라면', 10]])
  eq('한 지출 한 묶음(오뚜기 둘이 한 줄)', jul.lines.filter(l => l.key === 'b:오뚜기').length, 1)
  eq('7월 외 1종', [jul.more?.keys.length, jul.more?.qty], [1, 5])
  eq('7월 제품 기록 없음 = 이름 없는 구매 + 무상', [jul.unrecorded?.qty, jul.unrecorded?.amount], [10, 4200])
  eq('줄 상한 3', jul.lines.length <= PRODUCT_LINES_MAX && PRODUCT_LINES_MAX === 3, true)
  const aug = split.get('2026-08')!
  eq('8월 한 줄, 대표 표기는 전 기간 묶음', [aug.lines.map(l => l.text), aug.more, aug.unrecorded], [['삼양 삼양라면'], null, null])
  const sep = split.get('2026-09')!
  eq('무상만 있는 달은 제품 기록 없음 한 줄', [sep.lines.length, sep.unrecorded?.qty], [0, 6])
  eq('묶음 수(브랜드 키)', productViewKeys(purchases).length, 4)
  eq('묶음 하나면 1', productViewKeys([ip('오뚜기', 'a', '2026-07-01', 1), ip('오뚜기', 'b', '2026-07-02', 1), ip(null, null, '2026-07-03', 1)]).length, 1)
  // 골든. 김치 남도청년 표기 넷은 한 묶음, 스파크 본품·리필도 한 묶음(브랜드 키).
  const kimchi = ['땅끝해남 국내산 100% 전라도식 맛김치', '국내산 전라도 썰은배추김치', '100% 국내산 전라도 맛김치 썰은배추김치', '국내산 전라도 맛김치']
    .map((p, i) => ip('남도청년', p, `2026-10-0${i + 1}`, 10))
  const ks = splitInflowByProduct(kimchi, []).get('2026-10')!
  eq('김치 표기 넷 한 줄', [ks.lines.length, ks.lines[0].qty, productViewKeys(kimchi).length], [1, 40, 1])
  const spark = [ip('스파크', '스파크 본품 2.5kg', '2026-10-01', 1), ip('스파크', '스파크 리필 2kg', '2026-10-15', 2)]
  eq('스파크 본품·리필 한 줄', [splitInflowByProduct(spark, []).get('2026-10')!.lines.length, productViewKeys(spark).length], [1, 1])
  // 줄 이름은 그 달에 실제로 산 최빈 원문(묶음은 전 기간 하나). 세탁세제 모양. 10월 분말세제 1, 11월 리필 2.
  const det = [ip('스파크', '스마트 클린 분말세제', '2026-10-10', 1), ip('스파크', '스마트 클린 분말세제 리필', '2026-11-02', 1), ip('스파크', '스마트 클린 분말세제 리필', '2026-11-20', 1)]
  const ds = splitInflowByProduct(det, [])
  eq('달 줄 이름은 그 달 원문', [ds.get('2026-10')!.lines[0].text, ds.get('2026-11')!.lines[0].text], ['스파크 스마트 클린 분말세제', '스파크 스마트 클린 분말세제 리필'])
  eq('단가 선 이름은 전 기간 최빈', splitPriceByProduct(det).series[0].text, '스파크 스마트 클린 분말세제 리필')
  eq('한 묶음 키는 그대로 하나', [ds.get('2026-10')!.lines[0].key, ds.get('2026-11')!.lines[0].key], ['b:스파크', 'b:스파크'])
  // 토글 판정은 두 탭이 한 함수. 0원 구매는 단가에 안 서므로 월별 판정 재료에서도 빠진다.
  const zero = [ip('오뚜기', 'a', '2026-07-01', 10), ip('삼양', 'b', '2026-07-02', 10, 0)]
  eq('0원 구매는 판정 재료 밖', [productViewKeys(zero), splitInflowByProduct(zero, []).get('2026-07')!.viewKeys], [['b:오뚜기'], ['b:오뚜기']])
  eq('묶음 하나면 토글 없음, 둘이면 있음', [showsProductView(productViewKeys(zero)), showsProductView(['b:a', 'b:b', 'b:a'])], [false, true])
  const months2 = splitInflowByProduct([ip('오뚜기', 'a', '2026-07-01', 1), ip('삼양', 'b', '2026-08-01', 1)], [])
  eq('달마다 하나씩이어도 합치면 둘', showsProductView([...months2.values()].flatMap(v => v.viewKeys)), true)
  eq('월별·단가 판정이 같다', showsProductView([...months2.values()].flatMap(v => v.viewKeys)), showsProductView(productViewKeys([ip('오뚜기', 'a', '2026-07-01', 1), ip('삼양', 'b', '2026-08-01', 1)])))
}
// ── 제품별 보기: 단가 선 ──
{
  const pp = (brand: string | null, productName: string | null, ymd: string, unitPrice: number) => ({ date: d(ymd), brand, productName, unitPrice })
  const pts = [
    pp('삼양', 'x', '2026-06-01', 600), pp('오뚜기', 'y', '2026-06-10', 590), pp('삼양', 'x', '2026-07-01', 620), pp(null, null, '2026-07-05', 700),
    pp('농심', 'z', '2026-07-10', 650), pp('팔도', 'w', '2026-07-20', 640), pp('오뚜기', 'y2', '2026-08-01', 580), pp('농심', 'z', '2026-08-02', 660),
  ]
  const r = splitPriceByProduct(pts)
  eq('선 3개 상한', r.series.length, 3)
  eq('선 순서 점 많은 순, 같으면 최근', r.series.map(s => s.key), ['b:농심', 'b:오뚜기', 'b:삼양'])
  eq('선 이름은 대표 표기(브랜드·제품명)', [r.series[2].brand, r.series[2].productName, r.series[2].text], ['삼양', 'x', '삼양 x'])
  eq('선 안 점은 날짜 오름차순', r.series[1].points.map(p => p.unitPrice), [590, 580])
  eq('선 밖 묶음 수·이름 없는 점 수', [r.more, r.unrecorded], [1, 1])
  eq('선 점 + 선 밖 + 이름 없음 = 전체 점', r.series.reduce((s, x) => s + x.points.length, 0) + 1 + r.unrecorded, pts.length)
}

console.log(`\n[제품 표기 진리표] 통과 ${pass} · 실패 ${fails.length}`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
