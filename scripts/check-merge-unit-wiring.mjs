// 단위 정본 배선 감지 — 실행: node scripts/check-merge-unit-wiring.mjs
//
// 왜 필요한가. 진리표(test-item-unit-source)는 판정 함수만 본다. 함수가 맞아도 **부르지 않으면**
// 김치 사건이 그대로 재발한다 — 단위 교정은 itemsJson 에만 실려 오고, 병합은 라벨만 고친다.
// 그래서 여기서는 판정이 실제로 저장·병합 경로에 꽂혀 있는지 모양으로 확인한다.
//
// 잡는 것 넷.
//   · addExpense 가 낱개 폼 필드를 직접 저장하지 않고 resolveSingleItemFields 를 거친다.
//   · 병합 갈래가 shouldLoosenTargetUnit 으로 대상 카드를 단위 무시로 바꾼다.
//   · 그 원래 단위가 적용취소 payload 에 실리고, 지출 병합 되돌리기에서 원복된다.
//   · 화면이 단위를 함께 보내고, 적용 직후 실제로 붙었는지 재판정한다.
import { readFileSync } from 'node:fs'

const finance   = readFileSync('app/(app)/finance/actions.ts', 'utf8')
const inventory = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
const client    = readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }
const count = (s, re) => (s.match(re) ?? []).length

// 함수 하나만 잘라 본다 — updateExpense 도 같은 formData 키를 읽어서 파일 전체로는 셀 수 없다.
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const next = src.indexOf('\nexport async function', start + header.length)
  return src.slice(start, next < 0 ? src.length : next)
}

// ── ① 단일 품목 저장 정본 ──────────────────────────────────────────
const addExpense = body(finance, 'export async function addExpense(')
need('addExpense 를 찾음', addExpense.length > 0)
need('resolveSingleItemFields 를 부른다',
  /resolveSingleItemFields\(ocrCaptureItems, !!multiItems,/.test(addExpense),
  'itemsJson 이 단일 품목 저장의 정본이어야 한다')
// 낱개 폼 필드는 폴백 전용이라 이름이 form* 여야 한다. 원래 이름으로 읽으면 정본을 우회한다.
for (const k of ['itemLabel', 'specUnit', 'qtyUnit', 'specValue', 'specText', 'brand', 'productName', 'qtyValue']) {
  const cap = k[0].toUpperCase() + k.slice(1)
  need(`낱개 폼 필드 ${k} 는 폴백 이름으로 읽는다`,
    new RegExp(`const form${cap}\\s*=\\s*formData\\.get\\('${k}'\\)`).test(addExpense),
    `form${cap} 이 아니면 교정 전 값이 저장으로 샌다`)
}
// 저장·후처리는 정본을 거친 이름을 쓴다(낱개 이름을 그대로 쓰면 교정이 증발한다).
need('단일 저장이 정본 단위를 쓴다', /qtyUnit:\s+cleanUnit\(qtyUnit\)/.test(addExpense))
need('단일 저장이 정본 규격단위를 쓴다', /specUnit:\s+cleanUnit\(specUnit\)/.test(addExpense))
need('재고 시드가 정본 품명을 쓴다',
  /if \(itemLabel\) await seedTrackedItemsFromExpenses\(\[itemLabel\]\)/.test(addExpense))
need('단위 목록 적립이 정본 단위를 쓴다', /noteUnits\(\[specUnit\], \[qtyUnit\]\)/.test(addExpense))

// ── ①-B 수정 저장도 같은 정본 ─────────────────────────────────────
// 등록만 고치고 수정을 두면 같은 결함이 반쪽으로 남는다. 수정 폼에는 단위 게이트가 없어 김치는
// 재현되지 않지만, 내구재 세트 환산 확인창이 고친 값이 itemsJson 에만 실려 1품목 수정에서 증발했다.
// 진리표는 순수함수만 보므로 이 배선이 빠져도 초록이다 — 역주입이 안 잡히는 자리라 여기서 잡는다.
const updateExpense = body(finance, 'export async function updateExpense(')
need('updateExpense 를 찾음', updateExpense.length > 0)
need('수정 저장도 resolveSingleItemFields 를 부른다',
  /resolveSingleItemFields\(parsedItems, !!multiItems,/.test(updateExpense),
  'itemsJson 이 단일 품목 수정 저장의 정본이어야 한다')
// 수정 폼에만 있는 unitBasis 까지 아홉 칸 — 세트 환산이 바로 이 칸을 'qty' 로 바꾼다.
for (const k of ['itemLabel', 'specUnit', 'qtyUnit', 'specValue', 'specText', 'brand', 'productName', 'qtyValue', 'unitBasis']) {
  const cap = k[0].toUpperCase() + k.slice(1)
  need(`수정 저장의 낱개 폼 필드 ${k} 는 폴백 이름으로 읽는다`,
    new RegExp(`const form${cap}\\s+=\\s+formData\\.get\\('${k}'\\)`).test(updateExpense),
    `form${cap} 이 아니면 환산 전 값이 저장으로 샌다`)
}
// 미전송 칸 보존(formData.has)은 그대로 두고 **값의 출처만** 정본으로 바꾼 모양이어야 한다.
need('수정 저장이 정본 단위를 쓴다', /qtyUnit: cleanUnit\(qtyUnit\)/.test(updateExpense))
need('수정 저장이 정본 규격단위를 쓴다', /specUnit: cleanUnit\(specUnit\)/.test(updateExpense))
need('수정 저장이 보존 게이트를 지킨 채 정본 단가기준을 쓴다',
  /formData\.has\('unitBasis'\) \? \{ unitBasis: unitBasisRaw ===/.test(updateExpense),
  'has 게이트가 빠지면 카테고리만 수정할 때 단가 기준이 null 로 덮인다')
need('수정 후처리가 정본 품명을 쓴다',
  /propagateItemLabelRename\(propertyId, category, existing\.itemLabel, itemLabel\)/.test(updateExpense))
need('수정 저장의 단위 적립이 정본 단위를 쓴다', /noteUnits\(\[specUnit\], \[qtyUnit\]\)/.test(updateExpense))
// 화면 — 재고 미리보기도 환산 후 수량으로 물어야 한다(서버가 저장하는 값과 같은 값으로).
const financeClient = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
need('수정 저장의 재고 미리보기가 환산 후 품목을 쓴다',
  /savedItems = converted/.test(financeClient) && /detailExp\?\.receivedAt && savedItems\.length === 1/.test(financeClient),
  '환산 전 수량으로 물으면 묻는 값과 저장되는 값이 갈린다')

// ── ② 병합 갈래가 대상 카드를 단위 무시로 ──────────────────────────
const applyMerge = body(inventory, 'export async function applyMergeDecision(')
need('applyMergeDecision 을 찾음', applyMerge.length > 0)
need('병합이 단위 차이를 판정한다',
  /shouldLoosenTargetUnit\(input\.qtyUnit, target\.qtyUnit\)/.test(applyMerge),
  '라벨만 고치면 단위 다른 구매는 영원히 미부착이다')
need('병합이 대상 카드를 단위 무시로 바꾼다',
  /trackedItem\.update\(\{ where: \{ id: target\.id \}, data: \{ qtyUnit: null \} \}\)/.test(applyMerge))
// 지출 단위를 카드 값으로 덮어쓰는 길은 기각됐다 — '개 30 = 박스 1' 이면 수량이 왜곡된다.
need('지출 단위를 덮어쓰지 않는다',
  !/expense\.updateMany\([^)]*qtyUnit:\s*target\.qtyUnit/s.test(applyMerge))

// ── ③ 적용취소 원복 ───────────────────────────────────────────────
need('적용취소 payload 에 원래 단위를 싣는다', applyMerge.includes('targetQtyUnitBefore,'))
need('카드를 열었으면 적용취소 기록을 남긴다',
  /if \(expenseIds\.length > 0 \|\| targetQtyUnitBefore != null\)/.test(applyMerge),
  '지출이 없어도 카드를 바꿨으면 되돌릴 근거가 있어야 한다')
// 카드 병합(CARD)과 지출 병합(IMPORT) 두 갈래 모두 원복해야 한다 — 한 자리면 IMPORT 가 빠진 것이다.
const unmerge = body(inventory, 'export async function unmergeTrackedItem(')
need('unmergeTrackedItem 을 찾음', unmerge.length > 0)
const restores = count(unmerge, /if \(p\.targetQtyUnitBefore != null\)/g)
need('적용취소가 두 갈래 모두 단위를 원복한다', restores === 2, `실제 ${restores}자리(IMPORT·CARD)`)

// ── ④ 화면 — 단위 전달과 사후 재판정 ──────────────────────────────
need('병합 호출이 단위를 함께 보낸다',
  /choice: \{ kind: 'merge'/.test(client) && /specUnit: d\.specUnit, qtyUnit: d\.qtyUnit,\n\s+choice: \{ kind: 'merge'/.test(client),
  '단위가 안 가면 서버가 카드를 열 근거가 없다')
need('적용 직후 재판정을 한다',
  /await getPendingMergeDecisions\(\)\.catch/.test(client),
  '"완료" 라고 해놓고 실제로는 안 붙는 종류를 잡는 자리다')
need('재판정이 미부착이면 성공 토스트를 안 띄운다',
  /if \(stuck\.length > 0\) \{[\s\S]{0,400}?\} else \{\s*\n\s*pushToast\('success', '병합 처리 완료'\)/.test(client))

console.log(`\n[단위 정본 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
