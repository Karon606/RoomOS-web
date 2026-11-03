// 재고 제품 표기 배선 감지(가이드 §22 제품 표기, 2026-11 운영자 승인). 실행: node scripts/check-inventory-brand-mix.mjs
//
// 왜 필요한가. 제품 표기는 표시 전용이다. 같은 품명 안의 브랜드를 보여 주되 잔량을 가르지 않는다. 이 약속은
// 값 하나가 아니라 여러 자리가 같이 서야 지켜지고, 하나만 어긋나도 화면은 조용히 틀린다.
//
// 잡는 것.
//   ⓐ 개요의 두 구매 조회(수령 대기·구매 일괄)가 brand·productName 을 싣는다. 빠지면 카드 메타가 조용히 빈다.
//   ⓑ computeInventoryOverview 의 조회 수가 그대로다(제품 표기는 이미 받은 구매 위에서 메모리로만 센다).
//      상세 '월별 입수'·'단가 추이'(getMonthlyInflow·getPriceHistory)도 조회 수가 그대로이고(3·2), 구매 select 에 brand·productName 을 싣되
//      붙는 판정(where)은 두 칸을 읽지 않는다(제품별 보기, 2026-11 운영자 승인 '추천대로' 해석 A. 보기만 나누고 붙음은 품명 하나).
//   ⓒ 추정을 카드 수치 자리에 쓰지 않는다. 카드 value·valueSub 와 상세 '지금' 은 productMix 를 읽지 않는다.
//   ⓓ 카드 메타와 상세 제품 줄이 같은 row.productMix 를 읽고, 개요는 그 값을 확정된 currentStock 으로 낸다.
//   ⓔ 점검 폼 두 곳(CheckForm · LocationBatchCheckModal)은 브랜드를 입력·저장하지 않는다(점검은 품명 하나로 센다).
//      표시는 허용한다(2026-11-03 신고 ee46d0c1). 위치별 패널 행 머리의 ShelfMeta 한 자리만 빼고 본다(ⓙ).
//   ⓕ 골격과 실제의 줄 수가 같다. 제품 줄은 DetailViewSummary 안에 있고 글자를 g() 로 감싸 골격이 같은 줄을 투명하게 그린다.
//   ⓖ 정본 lib/productMix 는 순수층이다(DB 를 부르지 않는다).
//   ⓗ 한 카드 안에서 단가·날짜 꼴이 하나다(구매한 제품 = 평균 단가 `590원/봉`, 날짜 = 최근 점검 fmtDate).
//   ⓘ 카드 메타는 '브랜드 제품명'(기록된 원문 그대로, 브랜드가 겹쳐도 줄이지 않는다)이고 자리가 모자라면 묶음 전체가 제품명만이 된다(2026-11-03 운영자 지시). 판정은 폭 실측이다.
//     ShelfMeta 가 full·name 두 표기를 정본 shelfProductsText 로 만들고, 숨은 탐침(full)과 자리의 폭을 ResizeObserver 로 견준다.
//     글자 수로 자르는 꼼수(slice·substring·length 비교)가 없고, 분류는 shrink-0, 자리는 flex-1 말줄임이다.
//     재기 전엔 제품 토막만 투명, 스크린리더는 늘 전체(sr-only). 상세 추정 한 줄도 같은 토막 정본(shelfName full)을 쓰고
//     이름과 수량을 줄바꿈 없는 공백으로 붙이며 제품 사이는 ', ' 다. 브랜드만 쓰던 종전 토막(shelfBrandsText·short)은 돌아오지 않는다.
//   ⓙ 위치별 패널 행 머리 분류 줄이 카드 메타와 같은 정본 ShelfMeta 로 같은 row.productMix.onShelf 를 그린다
//      (2026-11-03 운영자 승인 '카드와 똑같이'). 글자 크기는 행 머리 10.5px 그대로, 색 prop 없음(분류는 행 머리 회색).
//      추정은 품목 전체 몫이고 이 위치 몫이 아니다(§22). 한 패널에 ShelfMeta 는 그 한 자리뿐이다.
//   ⓚ 제품별 보기(2026-11 등재, 운영자 승인 '추천대로' 해석 A). 품목 상세 '월별 입수'·'단가 추이' 맨 위 `보기` 토글로만 나눠 본다.
//      잔량·소모 셈(ledgerShift·consumptionSeries·seedLabel·lib/stockLedger)은 productMix 를 읽지 않고, 지출 화면(finance)은 칩 묶음(groupProducts)만 쓴다.
//      카드 수치와 소모 추이 막대값은 나눔을 읽지 않는다. 토글은 정본 SegmentedControl 하나(role=switch 0, 손수 버튼 0)이고,
//      제품 묶음이 둘 미만이면 그리지 않으며, 기억은 마운트 뒤에만 되살린다(useState 초기화에서 localStorage 를 읽지 않는다).
//      줄·선 상한은 정본 PRODUCT_LINES_MAX(3) 하나이고, 선 색은 §04 viz 1·2·3 차례이며 코랄을 쓰지 않는다.
//      (독립 검수 반영) 두 탭 판정은 showsProductView 하나, 이름 칸은 overflow-hidden, 안내 '자주 산 제품', 통합 단가 꼴도 fmtUnitPrice.
// 한계. 소스 가드라 '존재'만 본다. 계산의 뜻은 진리표 scripts/test-product-mix.ts 가 진다.
import { readFileSync } from 'node:fs'

function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map(l => l.replace(/\/\/.*$/, ''))
    .join('\n')
}
// 함수 하나만 잘라 본다. 매개변수 구조 분해 `({ a }: { ... })` 의 중괄호를 건너뛰려고 머리 뒤 첫 `) {` 또는 `) => {` 부터 짝을 센다.
function fnBody(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const m = /\)(?:\s*:\s*[\w<>\[\]| ]+)?\s*(?:=>\s*)?\{\n/.exec(src.slice(start))
  if (!m) return ''
  const i = start + m.index + m[0].length - 2
  if (i < 0) return ''
  let depth = 0
  for (let j = i; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(start, j + 1) }
  }
  return ''
}
// JSX 프롭 한 개의 값(중괄호 짝). `value={...}` 처럼 이름으로 자른다.
function propBody(src, from, name) {
  const at = src.indexOf(`${name}={`, from)
  if (at < 0) return ''
  let depth = 0
  for (let j = at + name.length + 1; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(at, j + 1) }
  }
  return ''
}

const overview = stripComments(readFileSync('app/(app)/inventory/overview.ts', 'utf8'))
const actions = stripComments(readFileSync('app/(app)/inventory/actions.ts', 'utf8'))
const client = stripComments(readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8'))
const mix = stripComments(readFileSync('lib/productMix.ts', 'utf8'))

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? `. ${hint}` : ''}`) }

// ⓐ 두 select
const comp = fnBody(overview, 'export async function computeInventoryOverview(')
const expenseSelects = [...comp.matchAll(/prisma\.expense\.findMany\(\{[\s\S]*?select: \{([^}]*)\}/g)].map(m => m[1])
need('ⓐ 개요 구매 조회 둘', expenseSelects.length === 2, `실제 ${expenseSelects.length}`)
for (const [i, sel] of expenseSelects.entries()) {
  need(`ⓐ 개요 구매 조회 ${i + 1} 에 brand·productName`, /brand: true/.test(sel) && /productName: true/.test(sel),
    '빠지면 카드 메타·상세 제품 줄이 조용히 빈다')
}

// ⓑ 조회 수 불변. 2026-11 시공 시점 8회(trackedItem·stockCheck·trackedItemLocation·expense 둘·stockAddition·stockDisposal·storageLocation).
const queries = (comp.match(/prisma\.\w+\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\(/g) ?? []).length
need('ⓑ computeInventoryOverview 조회 수 8', queries === 8, `실제 ${queries}. 제품 표기는 이미 받은 구매 위에서 센다`)
for (const [fn, want] of [['getMonthlyInflow', 3], ['getPriceHistory', 2]]) {
  const body = fnBody(actions, `export async function ${fn}(`)
  need(`ⓑ ${fn} 본문 확보`, body.length > 0)
  const n = (body.match(/prisma\.\w+\.(findMany|findFirst|findUnique|count|groupBy|aggregate)\(/g) ?? []).length
  need(`ⓑ ${fn} 조회 수 ${want}`, n === want, `실제 ${n}. 제품별 나눔은 이미 받은 구매 위에서 센다`)
  const ex = /prisma\.expense\.findMany\(\{\s*where: \{([\s\S]*?)\},\s*select: \{([^}]*)\}/.exec(body)
  need(`ⓑ ${fn} 구매 조회에 brand·productName`, !!ex && /brand: true/.test(ex[2]) && /productName: true/.test(ex[2]), '빠지면 제품별 보기가 조용히 전부 제품 기록 없음이 된다')
  need(`ⓑ ${fn} 붙는 판정(where)에 brand·productName 없음`, !!ex && !/brand|productName/.test(ex[1]), '보기만 나눈다(해석 A). 붙음을 브랜드로 가르면 통합 합계가 달라진다')
}

// ⓒ 추정은 수치 자리에 안 쓴다
const cardAt = client.indexOf('<InvCard')
const valueProp = propBody(client, cardAt, 'value')
const valueSubProp = propBody(client, cardAt, 'valueSub')
need('ⓒ 카드 수치가 잔량 그대로', /fmtQty\(row\.currentStock, stockUnit\)/.test(valueProp) && !/productMix|onShelf/.test(valueProp),
  '추정을 카드 수치 자리에 쓰면 표시 전용 약속이 깨진다(§22)')
need('ⓒ 카드 보조줄에 추정 없음', valueSubProp !== '' && !/productMix|onShelf/.test(valueSubProp))
const summary = fnBody(client, 'function DetailViewSummary(')
need("ⓒ 상세 '지금' 은 잔량 그대로", /const nowText = row\.currentStock == null \? '미확인' : fmtQty\(row\.currentStock, unit\)/.test(summary))

// ⓓ 같은 출처
const metaProp = propBody(client, cardAt, 'meta')
need('ⓓ 카드 메타가 row.productMix.onShelf', /<ShelfMeta category=\{row\.category\} color=\{tint\?\.fg\} onShelf=\{row\.productMix\.onShelf\} \/>/.test(metaProp))
need('ⓓ 상세 제품 줄이 row.productMix', /row\.productMix\.last/.test(summary) && /shelfEstimateText\(row\.productMix, unit\)/.test(summary))
need('ⓓ 개요가 확정 잔량으로 제품 표기를 낸다', /resolveMadeMix\(itemPurchases, currentStock, \{ qtyUnit: it\.qtyUnit, useSpec, specUnit: it\.specUnit \}\)/.test(comp) && /\n\s*productMix,\n/.test(comp))

// ⓔ 점검 폼은 브랜드를 입력·저장하지 않는다(표시 한 자리 ⓙ 는 빼고 본다)
const LOC_META = '<ShelfMeta category={r.category} onShelf={r.productMix.onShelf} />'
for (const h of ['function CheckForm(', 'function LocationBatchCheckModal(']) {
  const b = fnBody(client, h).split(LOC_META).join('')
  need(`ⓔ ${h.slice(9, -1)} 본문 확보`, b.length > 0)
  need(`ⓔ ${h.slice(9, -1)} 에 브랜드 입력·저장 없음`, !/productMix|\bbrand\b|productName/.test(b), '점검은 품명 하나로 센다(제품별 분리는 보류)')
}

// ⓙ 위치별 패널 행 머리는 카드와 같은 정본으로 그린다
{
  const loc = fnBody(client, 'function LocationBatchCheckModal(')
  need('ⓙ 위치별 행 머리 분류 줄이 ShelfMeta', loc.includes(`<p className="min-w-0 flex-1 truncate text-[0.65625rem] text-[var(--warm-muted)]">${LOC_META}</p>`),
    '분류만 서면 카드에서 본 제품을 점검 화면에서 못 본다(신고 ee46d0c1)')
  need('ⓙ 위치별 패널 ShelfMeta 한 자리', loc.split('<ShelfMeta').length === 2)
}

// ⓕ 골격과 실제가 한 함수
const skel = fnBody(client, 'function DetailModalSkeleton(')
need('ⓕ 골격이 요약을 ghost 로 그린다', /<DetailViewSummary row=\{row\} ghost \/>/.test(skel))
need('ⓕ 제품 줄 글자를 g() 로 감싼다', /\{g\('제품'\)\}/.test(summary) && /\{g\(row\.productMix\.last\.text\)\}/.test(summary) && /\{g\(est\)\}/.test(summary))

// ⓗ 한 카드 안 단가·날짜 꼴 하나(2026-11-03 독립 검수 차단 1). '구매한 제품' 은 형제 '평균 단가' 의 `금액/단위` 와 '최근 점검' 의 fmtDate 를 쓴다.
{
  const at = client.indexOf('구매한 제품 (최근 12개월)')
  const block = at < 0 ? '' : client.slice(at, client.indexOf('</ul>', at))
  need('ⓗ 구매한 제품 단가가 평균 단가와 같은 꼴', /`\$\{fmtUnitPrice\(h\.unitPrice\)\}\$\{priceUnit \? `\/\$\{priceUnit\}` : ''\}`/.test(block) && !/당 /.test(block) &&
    /\$\{fmtUnitPrice\(row\.avgUnitPrice\)\}\$\{priceUnit \? `\/\$\{priceUnit\}` : ''\}/.test(client),
    "한 카드 안에서 '590원/봉' 과 '봉당 590원' 이 같이 서면 이질감이다")
  need("ⓗ 구매한 제품 날짜가 '최근 점검' 과 같은 정본", /`마지막 \$\{fmtDate\(h\.lastDate\)\}`/.test(block) && /최근 점검 \{fmtDate\(row\.lastCheckDate\)\}/.test(client) &&
    /fmtDate\(row\.productMix\.last\.receivedOn\)/.test(summary) && !/fmtMixDate/.test(client))
}

// ⓘ 카드 메타 '브랜드 제품명', 자리가 모자라면 묶음 전체가 제품명만(폭 실측)
{
  const sm = fnBody(client, 'function ShelfMeta(')
  need('ⓘ ShelfMeta 본문 확보', sm.length > 0)
  need('ⓘ 두 표기를 정본으로 만든다', /const full = shelfProductsText\(onShelf, 'full'\)/.test(sm) && /const name = shelfProductsText\(onShelf, 'name'\)/.test(sm),
    '토막마다 따로 고르면 한쪽만 브랜드가 빠져 둘이 다른 급으로 읽힌다')
  need('ⓘ 폭 실측(ResizeObserver)으로 고른다', /new ResizeObserver\(measure\)/.test(sm) && /ro\.observe\(slot\)/.test(sm) && /ro\.observe\(probe\)/.test(sm) &&
    /probe\.getBoundingClientRect\(\)\.width <= slot\.getBoundingClientRect\(\)\.width/.test(sm) && /<span aria-hidden>\{fits === false \? name : full\}<\/span>/.test(sm))
  need('ⓘ 재기 전엔 제품 토막만 투명(깜빡임 대신 한 번 나타남)', /useState<boolean \| null>\(null\)/.test(sm) && /fits == null && full !== name \? ' opacity-0' : ''/.test(sm))
  need('ⓘ 스크린리더는 늘 브랜드 제품명 전체', /<span className="sr-only">\{full\}<\/span>/.test(sm), '화면에서 브랜드가 빠져도 듣는 사람은 잃지 않는다')
  need('ⓘ 숨은 탐침이 full 을 잰다', /<span ref=\{probeRef\} aria-hidden className="[^"]*invisible absolute[^"]*whitespace-pre[^"]*">\{full\}<\/span>/.test(sm),
    '탐침이 보이거나 줄을 바꾸면 폭이 틀린다')
  need('ⓘ 글자 수로 자르지 않는다', !/\.slice\(|\.substring\(|\.substr\(|\.length\s*[<>]=?|maxLength|\d+ch\b/.test(sm), '폭은 글꼴·화면마다 다르다')
  need('ⓘ 분류는 남고 자리만 말줄임', /<span className="shrink-0" style=\{\{ color \}\}>\{category\}<\/span>/.test(sm) &&
    /<span ref=\{slotRef\} className=\{`relative min-w-0 flex-1 truncate text-\[var\(--ink-m\)\]\$\{/.test(sm) && /if \(!full\) return <span style=\{\{ color \}\}>\{category\}<\/span>/.test(sm) && !/<Badge|미입력/.test(sm))
  const est = fnBody(client, 'function shelfEstimateText(')
  need('ⓘ 상세 추정도 같은 토막 정본(브랜드 제품명)', /\$\{shelfName\(g, 'full'\)\}\\u00a0\$\{fmtQty\(g\.qty, unit\)\}/.test(est) && /\.join\(', '\)/.test(est),
    "이름과 수량은 줄바꿈 없는 공백으로 한 덩이, 제품 사이는 카드와 같은 ', '")
  need('ⓘ 브랜드만 쓰던 종전 토막이 없다', !/shelfBrandsText|\.short\b/.test(client) && !/shelfBrandsText|\bshort:/.test(mix))
  need('ⓘ 정본 토막 규칙', /if \(mode === 'name'\) return p \|\| b\n\s*return productText\(b, p\)/.test(mix) &&
    /const names = onShelf\.map\(g => shelfName\(g, mode\)\)/.test(mix), '자리가 모자랄 때 버리는 쪽은 브랜드다')
  need('ⓘ 브랜드 겹침을 줄이지 않는다(원문 그대로)', !/startsWith/.test(fnBody(mix, 'export function shelfName(')),
    "'삼양 삼양라면' 을 '삼양라면' 으로 줄이면 기록된 원문과 갈린다(2026-11-03 운영자 지시)")
}

// ⓚ 제품별 보기
{
  // 최상위 함수 하나를 다음 맨 앞 `}` 줄까지 자른다(반환 타입에 쉼표·괄호가 있어 fnBody 의 머리 규칙이 못 잡는 함수용).
  const topFn = (src, header) => { const at = src.indexOf(header); if (at < 0) return ''; const end = src.indexOf('\n}\n', at); return end < 0 ? '' : src.slice(at, end + 2) }
  for (const f of ['app/(app)/inventory/ledgerShift.ts', 'app/(app)/inventory/consumptionSeries.ts', 'app/(app)/inventory/seedLabel.ts', 'lib/stockLedger.ts']) {
    need(`ⓚ ${f} 는 productMix 를 읽지 않는다`, !/productMix/.test(stripComments(readFileSync(f, 'utf8'))), '잔량·소모 셈은 늘 합계다(보기만 나눈다)')
  }
  const fin = stripComments(readFileSync('app/(app)/finance/actions.ts', 'utf8'))
  const finImport = /import \{([^}]*)\} from '@\/lib\/productMix'/.exec(fin)
  need('ⓚ 지출 화면은 칩 묶음(groupProducts)만 쓴다', !finImport || finImport[1].trim() === 'groupProducts')
  const cardAt2 = client.indexOf('<InvCard')
  for (const name of ['value', 'valueSub']) need(`ⓚ 카드 ${name} 가 나눔을 읽지 않는다`, !/byProduct|splitInflowByProduct|splitPriceByProduct/.test(propBody(client, cardAt2, name)))
  need('ⓚ 소모 추이 막대값이 나눔을 읽지 않는다', !/productMix|byProduct|splitInflowByProduct|splitPriceByProduct|useProductView/.test(fnBody(client, 'function ConsumptionTrend(')))
  const hook = topFn(client, 'function useProductView(')
  need('ⓚ 기억은 마운트 뒤 복원(useState 초기화에서 읽지 않는다)', /useState<ProductView>\('merged'\)/.test(hook) && /use(?:Layout)?Effect\(\(\) => \{[\s\S]*localStorage\.getItem\(PRODUCT_VIEW_KEY\)[\s\S]*\}, \[\]\)/.test(hook) &&
    !/useState(<[^>]*>)?\(\(\) =>[^)]*localStorage/.test(hook), '첫 렌더에서 읽으면 하이드레이션 #418(오류신고 5489fac1)')
  need('ⓚ 기억 키는 기기 전역 하나', (client.match(/PRODUCT_VIEW_KEY = '/g) ?? []).length === 1 && /const PRODUCT_VIEW_KEY = 'stayeum-inventory-product-view'/.test(client))
  const toggle = fnBody(client, 'function ProductViewToggle(')
  need('ⓚ 토글은 정본 SegmentedControl', /<SegmentedControl<ProductView> size="sm" ariaLabel="보기"/.test(toggle) && !/<button|role="switch"/.test(toggle))
  const monthly = fnBody(client, 'function MonthlyInflowList(')
  const price = fnBody(client, 'function PriceChart(')
  const pchart = fnBody(client, 'function ProductPriceChart(')
  for (const [n, b] of [['월별 입수', monthly], ['단가 추이', price], ['단가 제품별', pchart]]) need(`ⓚ ${n} 본문 확보`, b.length > 0)
  need('ⓚ role=switch 0', !/role="switch"/.test(monthly + price + pchart + toggle))
  need('ⓚ 묶음 둘 미만이면 토글을 그리지 않는다',
    /const showToggle = showsProductView\(rows\.flatMap\(r => r\.byProduct\.viewKeys\)\)/.test(monthly) && /\{showToggle && <ProductViewToggle value=\{view\} onChange=\{setView\} \/>\}/.test(monthly) && /const byProduct = showToggle && view === 'product'/.test(monthly) &&
    /const showToggle = showsProductView\(productViewKeys\(points\)\)/.test(price) && /\{showToggle && <ProductViewToggle value=\{view\} onChange=\{setView\} \/>\}/.test(price) && /\{showToggle && view === 'product' \? <ProductPriceChart /.test(price),
    '나눌 것이 없는 품목에 토글이 서면 누를 이유가 없는 컨트롤이다')
  need('ⓚ 월별 입수 달 합계는 통합 값', /\{Math\.round\(r\.totalQty \* 100\) \/ 100\}\{u\}/.test(monthly) && !/byProduct[\s\S]{0,40}totalQty/.test(monthly))
  need('ⓚ 제품 줄은 정본 나눔 그대로(손수 자르지 않는다)', /r\.byProduct\.lines\.map\(/.test(monthly) && !/lines\.slice\(/.test(monthly) && /제품 기록 없음/.test(monthly) && /외 \{r\.byProduct\.more\.keys\.length\}종/.test(monthly))
  need('ⓚ 단가 선은 정본 나눔(최대 3)', /splitPriceByProduct\(points\)/.test(pchart) && !/series\.slice\(/.test(pchart))
  need('ⓚ 선 색 viz 1·2·3 차례, 코랄 0', /const PRICE_SERIES_COLORS = \['var\(--viz-1\)', 'var\(--viz-2\)', 'var\(--viz-3\)'\] as const/.test(client) && !/--coral|--tc\b/.test(pchart))
  need('ⓚ 단가 제품별 최저·최고는 카드 펼침과 같은 꼴, 날짜는 fmtDateDot',
    /최저 \{fmtUnitPrice\(minP\)\}\{unitSuffix\}/.test(pchart) && /최고 \{fmtUnitPrice\(maxP\)\}\{unitSuffix\}/.test(pchart) && /fmtDate\(new Date\(t0\)\)/.test(pchart))
  need('ⓚ 단가 선 이름 칸은 카드 메타와 같은 토막 규칙(폭 실측, 세 줄 함께)', /new ResizeObserver\(measure\)/.test(pchart) && /shelfName\(series\[l\.i\], fits === false \? 'name' : 'full'\)/.test(pchart) &&
    /\.every\(c => c\.getBoundingClientRect\(\)\.width/.test(pchart) && !/\.slice\(|\.substring\(|maxLength/.test(pchart), '브랜드만 남고 제품명이 잘리면 같은 브랜드 두 선이 같은 이름이 된다')
  need('ⓚ 두 탭 토글 판정이 한 함수(같은 품목이면 같은 노출)', (client.match(/showsProductView\(/g) ?? []).length === 2 && /export function showsProductView\(/.test(mix) &&
    /if \(!\(r\.amount > 0\)\) continue/.test(topFn(mix, 'export function productViewKeys(')) && /viewKeys: productViewKeys\(m\.all\)/.test(mix), '월별이 0원 구매를 세고 단가가 빼면 같은 품목에서 한 탭에만 토글이 선다')
  need('ⓚ 이름 칸이 모달을 가로로 넘치지 않는다(overflow-hidden)', /<ul ref=\{colRef\} className="[^"]*\boverflow-(?:hidden|clip)\b[^"]*"/.test(pchart), '숨은 탐침도 scrollWidth 에 들어간다(320px 121px 넘침, 독립 검수 차단)')
  need("ⓚ 선 밖 안내는 '자주 산 제품'(기준이 구매 건수)", /'자주 산 제품 3종만 선으로 그립니다\.'/.test(pchart) && !/많이 산 제품 3종/.test(pchart))
  need('ⓚ 단가 추이 통합도 정본 단가 꼴(fmtUnitPrice·tnum)', /최저 \{fmtUnitPrice\(minP\)\}\{unitSuffix\}/.test(price) && /\{fmtUnitPrice\(p\.unitPrice\)\}\{unitSuffix\}/.test(price) &&
    !/fmtWon\(Math\.round\((minP|maxP|p\.unitPrice)\)\)/.test(price) && /text-\[var\(--warm-muted\)\] tabular-nums">\s*<span>최저/.test(price), "토글하면 '2원/ml' 이 '2.15원/ml' 로 바뀌던 것")
  need('ⓚ 줄·선 상한 정본 3', /export const PRODUCT_LINES_MAX = 3\n/.test(mix) && /slice\(0, PRODUCT_LINES_MAX\)/.test(topFn(mix, 'export function splitInflowByProduct(')) && /slice\(0, PRODUCT_LINES_MAX\)/.test(topFn(mix, 'export function splitPriceByProduct<')))
}

// ⓖ 순수층
need('ⓖ lib/productMix 는 DB 를 부르지 않는다', !/prisma/.test(mix) && /export function resolveMadeMix\(/.test(mix))

console.log(`\n[재고 제품 표기 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
