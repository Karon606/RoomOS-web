// 브랜드·제품명 배선 감지 — 실행: node scripts/check-expense-brand-wiring.mjs
//
// 왜 필요한가. 지출 저장 경로가 **셋**이다(단일 품목·다품목·방별 분배). 한 갈래만 고치면
// 브랜드가 첫 줄에만 남고 나머지는 조용히 빈다 — 패널이 1순위 함정으로 짚은 자리다.
// 그리고 수정 프리필을 빼먹으면 수정 저장에서 값이 소실된다(specText 가 겪은 오류신고 5f44f5df).
//
// 잡는 것 넷.
//   · 저장 경로 세 갈래가 모두 brand·productName 을 쓴다.
//   · 수정 저장이 formData.has 가드를 쓴다(안 실어 보낸 칸을 지우지 않는다).
//   · 수정 프리필이 두 값을 복원한다.
//   · 폼 hidden input 두 자리가 두 값을 싣는다.
import { readFileSync } from 'node:fs'

const actions = readFileSync('app/(app)/finance/actions.ts', 'utf8')
const client  = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
const ocr     = readFileSync('lib/receiptOcr.ts', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }
const count = (s, re) => (s.match(re) ?? []).length

// 저장 — 다품목 두 자리 + 단일 + 방별 분배 대표 = 최소 4자리에서 brand 를 쓴다.
need('저장 경로에 brand', count(actions, /brand:\s+r\.it\.brand \|\| null/g) === 2, '다품목 두 자리')
need('저장 경로에 단일 품목 brand', actions.includes('brand:              brandRaw || null'), '단일 품목')
need('방별 분배 대표 행 brand', actions.includes('brand:       firstRow.it.brand || null'), '분배 대표')
// 수정 — has 가드가 없으면 안 실어 보낸 칸이 지워지거나 지운 값이 살아남는다.
need('수정 저장 has 가드(brand)', actions.includes("formData.has('brand')"))
need('수정 저장 has 가드(productName)', actions.includes("formData.has('productName')"))
// 검색 — 브랜드로 과거 구매를 찾는 축.
need('검색 축에 brand', /OR:\s*\[[\s\S]{0,600}?brand:\s*\{ contains: q/.test(actions))
need('검색 축에 productName', /OR:\s*\[[\s\S]{0,700}?productName:\s*\{ contains: q/.test(actions))
// 직전값 — 채우되 표시를 남기는 쪽이라 값 자체는 서버가 줘야 한다.
need('직전값에 brand', actions.includes('brand: row?.brand ?? null'))

// 화면 — 수정 프리필과 hidden input.
need('수정 프리필 brand', client.includes('brand:       detailExp.brand ?? undefined'))
need('수정 프리필 productName', client.includes('productName: detailExp.productName ?? undefined'))
// hidden 만 센다 — 같은 파일에 금융 자산 등록 폼의 select name="brand"(은행·카드사)가 따로 있다.
// 별개 <form> 이라 FormData 가 안 섞이지만, 이름이 같으므로 세는 자를 좁혀 둔다.
const hiddenBrand = count(client, /<input type="hidden" name="brand"/g)
const hiddenProduct = count(client, /<input type="hidden" name="productName"/g)
need('hidden input brand 두 자리', hiddenBrand === 2, `실제 ${hiddenBrand}`)
need('hidden input productName 두 자리', hiddenProduct === 2, `실제 ${hiddenProduct}`)
// 다음 품목으로 브랜드가 넘어가면 안 된다.
need('품목 확정 후 브랜드 초기화', client.includes("setBrand(''); setProductName('')"))

// OCR — 추측 금지와 label 복사 금지가 프롬프트에 박혀 있어야 한다.
need('OCR 타입에 brand', ocr.includes('brand?: string'))
need('OCR 파싱에 brand', ocr.includes('brand:       typeof it.brand'))
need('OCR 프롬프트 추측 금지', ocr.includes('절대 추측해서 만들지 마세요'))
need('OCR 프롬프트 label 복사 금지', ocr.includes('label과 같은 값을 productName에 복사하지 마세요'))

// 지난 제품 칩과 섞인 품목의 직전값 끔(가이드 §22 제품 표기, 2026-11 운영자 승인 · 8-27 확정 개정).
need('직전값에 지난 제품 목록', /products: productsOf\.get\(itemLabel\) \?\? \[\]/.test(actions) && /loadItemProducts\(propertyId, \[itemLabel\]\)/.test(actions))
need('지난 제품 묶음이 정본(groupProducts)', /groupProducts\(rows\.filter\(r => r\.itemLabel === label\)\)/.test(actions) && /isShipping: false, OR: \[\{ brand: \{ not: null \} \}, \{ productName: \{ not: null \} \}\]/.test(actions))
need('다품목 칩 일괄 조회', /export async function getItemProducts\(labels: string\[\]\)/.test(actions))
need('섞인 품목은 직전값을 안 채운다(품목 고르기)', client.includes('if (last.products.length < 2 && (last.brand || last.productName)) {'),
  '브랜드 둘 이상이면 칩으로 고르게 한다')
need('섞인 품목은 직전값을 안 채운다(지난 기록 행)', client.includes('if ((last?.products.length ?? 0) < 2) fillBrand()'))
need('칩 두 자리(품목 고르기 · 다품목 카드)', count(client, /<ProductChips chips=/g) === 2, `실제 ${count(client, /<ProductChips chips=/g)}`)
// 칩 모양은 한 클래스(SpecWizard pickChip, 40px)다. 세부스펙 칩과 지난 제품 칩이 같은 폼에서 높이가 갈리면 이질감이다(2026-11-03 독립 검수).
const wizard = readFileSync('components/ui/SpecWizard.tsx', 'utf8')
need('칩 정본 40px', /const chip = \(on: boolean\) =>\s*`min-h-\[40px\]/.test(wizard) && wizard.includes('export const pickChip = chip'))
need('지난 제품 칩 · 세부스펙 칩이 같은 클래스', /function ProductChips\([\s\S]{0,1200}aria-pressed=\{on\}[\s\S]{0,300}className=\{`\$\{pickChip\(on\)\}/.test(client) &&
  /aria-pressed=\{specText === o\}[\s\S]{0,200}className=\{`\$\{pickChip\(specText === o\)\}/.test(client), '칩 높이가 둘이면 이질감')
need('칩 안내 문장', client.includes("'지난 구매 제품입니다. 같은 제품이면 눌러 주세요.'"))
need("칩 안내는 '지난번 값' 일 때 숨고, 다품목은 첫 칩 카드에만", client.includes('guide={!brandFromLast}') && client.includes('guide={idx === firstChipIdx}') &&
  client.includes('{guide && <p className="text-[0.65625rem] text-[var(--warm-muted)]">{PRODUCT_CHIP_GUIDE}</p>}'))
// 다품목 칩이 실제로 그려지는 조건까지 본다(칩 블록을 꺼도 지나가던 구멍, 2026-11-03 독립 검수).
need('다품목 칩이 그 품명의 지난 제품으로 그려진다',
  client.includes("const chips = allowMulti ? (productsByLabel[it.label.trim()] ?? []) : []") &&
  /\{allowMulti && chips\.length > 0 && \(\s*<div className="rounded-lg bg-\[var\(--cream\)\] ring-1 ring-\[var\(--warm-border\)\] px-2 py-1\.5">\s*<ProductChips chips=\{chips\}/.test(client) &&
  /getItemProducts\(need\)\.then\(r => \{ if \(alive\) setProductsByLabel/.test(client))
need("다품목 브랜드 줄은 값이 있을 때만 펴고 '지우기' 가 접는다(형제 줄과 같은 동작)",
  client.includes('const brandOpen = it.brand != null || it.productName != null\n') &&
  /onClick=\{\(\) => patchItem\(idx, \{ brand: undefined, productName: undefined \}\)\}/.test(client))
// 지난 기록 맥락은 품명과 함께 쥐고 지금 품명과 같을 때만 읽는다(lib/heldContext, 독립 검수 차단 2: '라면' 칩이 '라면 컵' 에 남던 결함 클래스).
need('지난 기록 맥락을 품명과 함께 쥔다', client.includes("const prevUnits = contextFor(prevHeld, activeLabel === '__custom__' ? customLabel : activeLabel)") &&
  !/setPrevUnits\(/.test(client) && !/useState<Awaited<ReturnType<typeof getLastItemUnits>>>/.test(client),
  '맥락을 품명 없이 상태 하나에 담으면 다음 품목에 옛 칩·세부스펙 칩·단위 안내가 남는다')
{
  const sets = [...client.matchAll(/setPrevHeld\(([^)]*\)?)\)/g)].map(m => m[1])
  need('맥락을 쥐는 자리는 holdFor(품명, 맥락)·null·되살리기뿐', sets.length > 0 && sets.every(a => /^holdFor\(/.test(a) || a === 'null' || a === 'r.prevHeld'), `실제 ${JSON.stringify(sets)}`)
}
need('품목을 담으면 맥락을 비운다', /onChange\(\[\.\.\.items, data\]\)\n[^\n]*setPrevHeld\(null\)/.test(client))
// 지난 기록 행의 늦은 응답이 되살리기·다른 선택을 덮지 않는다(차례 번호). 조회 실패면 종전처럼 그 행의 브랜드로 채운다.
need('지난 기록 행 늦은 응답 가드', /const seq = \+\+pickSeq\.current/.test(client) && /if \(pickSeq\.current !== seq\) return/.test(client) &&
  /\.catch\(\(\) => \{ if \(pickSeq\.current === seq\) fillBrand\(\) \}\)/.test(client) &&
  /setPrevHeld\(r\.prevHeld\)\n\s*pickSeq\.current\+\+/.test(client))
// 지난 제품 조회는 행 수 상한 없이 조합별로 센다(take 상한이면 많이 산 품명이 다른 품명 칩을 밀어낸다).
need('지난 제품 조회가 조합별 groupBy', /async function loadItemProducts[\s\S]{0,900}prisma\.expense\.groupBy\(\{\s*by: \['itemLabel', 'brand', 'productName'\]/.test(actions) &&
  !/async function loadItemProducts[\s\S]{0,900}take:/.test(actions.slice(actions.indexOf('async function loadItemProducts'), actions.indexOf('export async function getItemProducts'))))
// 지출 목록 검색. 서버 검색 축과 같은 칸을 화면 거름에도.
need('목록 검색 거름에 brand·productName', /const hay = `[^`]*\$\{e\.brand \?\? ''\} \$\{e\.productName \?\? ''\}`/.test(client))

console.log(`\n[지출 브랜드 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
