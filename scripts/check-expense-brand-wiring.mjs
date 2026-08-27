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

console.log(`\n[지출 브랜드 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
