// 재고 제품 표기 배선 감지(가이드 §22 제품 표기, 2026-11 운영자 승인). 실행: node scripts/check-inventory-brand-mix.mjs
//
// 왜 필요한가. 제품 표기는 표시 전용이다. 같은 품명 안의 브랜드를 보여 주되 잔량을 가르지 않는다. 이 약속은
// 값 하나가 아니라 여러 자리가 같이 서야 지켜지고, 하나만 어긋나도 화면은 조용히 틀린다.
//
// 잡는 것.
//   ⓐ 개요의 두 구매 조회(수령 대기·구매 일괄)가 brand·productName 을 싣는다. 빠지면 카드 메타가 조용히 빈다.
//   ⓑ computeInventoryOverview 의 조회 수가 그대로다(제품 표기는 이미 받은 구매 위에서 메모리로만 센다).
//   ⓒ 추정을 카드 수치 자리에 쓰지 않는다. 카드 value·valueSub 와 상세 '지금' 은 productMix 를 읽지 않는다.
//   ⓓ 카드 메타와 상세 제품 줄이 같은 row.productMix 를 읽고, 개요는 그 값을 확정된 currentStock 으로 낸다.
//   ⓔ 점검 폼 두 곳(CheckForm · LocationBatchCheckModal)에 브랜드가 없다(점검은 품명 하나로 센다).
//   ⓕ 골격과 실제의 줄 수가 같다. 제품 줄은 DetailViewSummary 안에 있고 글자를 g() 로 감싸 골격이 같은 줄을 투명하게 그린다.
//   ⓖ 정본 lib/productMix 는 순수층이다(DB 를 부르지 않는다).
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
need('ⓓ 카드 메타가 row.productMix.onShelf', /shelfBrandsText\(row\.productMix\.onShelf\)/.test(metaProp))
need('ⓓ 상세 제품 줄이 row.productMix', /row\.productMix\.last/.test(summary) && /shelfEstimateText\(row\.productMix, unit\)/.test(summary))
need('ⓓ 개요가 확정 잔량으로 제품 표기를 낸다', /resolveMadeMix\(itemPurchases, currentStock, \{ qtyUnit: it\.qtyUnit, useSpec, specUnit: it\.specUnit \}\)/.test(comp) && /\n\s*productMix,\n/.test(comp))

// ⓔ 점검 폼엔 브랜드가 없다
for (const h of ['function CheckForm(', 'function LocationBatchCheckModal(']) {
  const b = fnBody(client, h)
  need(`ⓔ ${h.slice(9, -1)} 본문 확보`, b.length > 0)
  need(`ⓔ ${h.slice(9, -1)} 에 브랜드 없음`, !/productMix|\bbrand\b|productName/.test(b), '점검은 품명 하나로 센다(제품별 분리는 보류)')
}

// ⓕ 골격과 실제가 한 함수
const skel = fnBody(client, 'function DetailModalSkeleton(')
need('ⓕ 골격이 요약을 ghost 로 그린다', /<DetailViewSummary row=\{row\} ghost \/>/.test(skel))
need('ⓕ 제품 줄 글자를 g() 로 감싼다', /\{g\('제품'\)\}/.test(summary) && /\{g\(row\.productMix\.last\.text\)\}/.test(summary) && /\{g\(est\)\}/.test(summary))

// ⓖ 순수층
need('ⓖ lib/productMix 는 DB 를 부르지 않는다', !/prisma/.test(mix) && /export function resolveMadeMix\(/.test(mix))

console.log(`\n[재고 제품 표기 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
