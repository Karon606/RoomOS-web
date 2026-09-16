// 영수증 인식 결과가 홈 경로에서 통째로 전해지는지 + 결제수단 확인형 고지가 살아 있는지.
// 읽기 전용, 위반 시 exit 1.
//
// 왜 있나(2026-09-17, 신고 73c18e13). 운영자 원문 — "영수증에 사용한 결제수단이 현대카드라고
// 되어있는데 왜 그 데이터는 활용을 안하는거지?". 인식은 되고 있었다. 버리는 자리가 둘이었다.
//   · 홈 찍어올리기의 재조립 두 군데가 카드 두 칸(과 사업자번호)을 안 실어서, 저장 전에 사라졌다.
//   · 지출 폼은 딱 1건 매칭일 때만 쓰고 실패하면 **폴백도 고지도 없이** 버렸다.
//
// 첫째 것은 이 저장소가 이미 한 번 크게 데인 클래스다 — 분할 복제 목록 셋이 서로 같기만 하고
// 스키마를 덮는지 아무도 안 보던 자리(2026-09-16 cloneExpenseScalars). 그래서 여기서도 **목록을
// 손으로 세지 않고** lib/receiptOcr 의 ReceiptOcrResult 를 읽어 대조한다. 새 칸이 생기면 이 그물이
// "홈 경로가 그것을 나르는지 정하라"고 막는다.
import { readFileSync } from 'fs'

const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
  .replace(/(^|[^:])\/\/[^\n]*/g, (_, p) => p)

const violations = []
const read = f => { try { return strip(readFileSync(f, 'utf8')) } catch { violations.push(`${f} — 읽을 수 없음`); return '' } }

/** `anchor` 뒤 첫 '{' 부터 짝이 맞는 '}' 까지. 못 찾으면 null. */
function block(src, anchor) {
  const at = src.indexOf(anchor)
  if (at < 0) return null
  const open = src.indexOf('{', at)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < src.length; i++) {
    if (src[i] === '{') depth++
    else if (src[i] === '}') { depth--; if (depth === 0) return src.slice(open, i + 1) }
  }
  return null
}

// ReceiptOcrResult 의 칸 → 홈 경로(GeminiResult)에서의 이름. relay=false 면 지출 폼이 안 보는 칸이다.
const FIELDS = {
  date:        { as: 'date',        relay: true },
  vendor:      { as: 'vendor',      relay: true },
  vendorBizNo: { as: 'vendorBizNo', relay: true },
  totalAmount: { as: 'amount',      relay: true },
  items:       { as: 'items',       relay: true },
  category:    { as: 'category',    relay: true },
  orderNo:     { as: 'orderNo',     relay: true },
  cardName:    { as: 'cardName',    relay: true },
  cardLast4:   { as: 'cardLast4',   relay: true },
  kind:        { as: 'kind',        relay: false, why: '분류는 홈 카드가 쓰고 지출 폼은 안 본다' },
  notes:       { as: 'notes',       relay: false, why: '한 줄 요약은 홈 카드 표시용' },
}

// (1) 인식 결과의 칸 목록 — 정본에서 읽는다.
const ocrSrc = read('lib/receiptOcr.ts')
const resultBlock = block(ocrSrc, 'export type ReceiptOcrResult')
if (!resultBlock) {
  violations.push('lib/receiptOcr.ts — ReceiptOcrResult 를 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다(침묵 통과 금지)')
}
const declared = resultBlock
  ? [...resultBlock.matchAll(/^\s{2}(\w+)\??:/gm)].map(m => m[1])
  : []
for (const f of declared) {
  if (!(f in FIELDS)) {
    violations.push(`lib/receiptOcr.ts — 새 칸 '${f}' 이 생겼다. 홈 찍어올리기가 그것을 나르는지 정하고 `
      + `scripts/check-receipt-card-relay.mjs 의 목록에 올릴 것(안 나르면 저장 전에 사라진다)`)
  }
}
for (const f of Object.keys(FIELDS)) {
  if (declared.length && !declared.includes(f)) {
    violations.push(`scripts/check-receipt-card-relay.mjs — 목록의 '${f}' 이 ReceiptOcrResult 에 없다. 목록에서 내릴 것`)
  }
}

// (2) 홈 경로의 세 자리 — 타입·인식 재조립·딥링크 재조립이 같은 칸을 다 실어야 한다.
{
  const src = read('app/(app)/dashboard/pendingReceipt.ts')
  const typeBlock    = block(src, 'type GeminiResult')
  const analyzeBlock = block(src, 'const first = d.items[0]\n  return')
  const relayBlock   = block(src, 'const ocr: ReceiptOcrResult')
  const places = [
    ['GeminiResult 타입', typeBlock, f => new RegExp(`\\b${f}\\??:`)],
    ['analyzeImage 재조립', analyzeBlock, f => new RegExp(`\\b${f}\\s*:`)],
    ['getPendingReceiptImage 재조립', relayBlock, f => new RegExp(`\\b${f}\\s*:`)],
  ]
  for (const [name, b] of places) {
    if (!b) violations.push(`app/(app)/dashboard/pendingReceipt.ts — ${name} 를 못 찾았다. 모양이 바뀌었으면 이 그물부터 고친다`)
  }
  for (const [ocrField, spec] of Object.entries(FIELDS)) {
    if (!spec.relay) continue
    for (const [name, b, re] of places) {
      if (!b) continue
      // 딥링크 재조립은 ReceiptOcrResult 이름으로, 나머지 둘은 GeminiResult 이름으로 적힌다.
      const key = name.startsWith('getPendingReceiptImage') ? ocrField : spec.as
      if (!re(key).test(b)) {
        violations.push(`app/(app)/dashboard/pendingReceipt.ts — ${name} 에 '${key}' 가 없다. `
          + `영수증이 읽은 값이 저장 전에 사라진다(신고 73c18e13 의 카드 두 칸이 그렇게 사라졌다)`)
      }
    }
  }
}

// (3) 지출 폼 — 확인형 고지와 양방향 브랜드 매칭.
{
  const src = read('app/(app)/finance/FinanceClient.tsx')
  for (const [re, why] of [
    [/setAddCardHint\(/, '못 맞힌 카드 표기를 담아 두는 자리가 사라짐. 실패가 다시 조용해진다'],
    [/addCardHint && !cardAccounts\.some\(/, '고지 한 줄이 사라짐. 운영자는 영수증이 무엇을 봤는지 못 본다'],
    [/ocrCardName\.includes\(n\)/, '브랜드 매칭의 한 방향(영수증 표기가 계정 표기를 품는 경우)이 사라짐'],
    [/n\.includes\(ocrCardName\)/, '브랜드 매칭의 반대 방향이 사라짐. 한 방향만 보면 표기가 조금만 달라도 못 맞힌다'],
    [/\[a\.brand, a\.alias \?\? '', accName\(a\)\]/, '계정 쪽 표기 셋(브랜드·별칭·표시명) 대조가 사라짐'],
  ]) if (!re.test(src)) violations.push(`app/(app)/finance/FinanceClient.tsx — ${why}`)

  // 자동 기입 금지 — payMethod 는 **매칭에 성공했을 때만** 쓴다(운영자 결정: 확인형).
  // 그 칸이 정산 상태(settleStatus)를 파생시키므로 못 맞힌 표기로 쓰면 정산이 따라 움직인다.
  const hintBlock = block(src, 'setAddCardHint(')
  if (hintBlock && /setAddExpMethod\(/.test(hintBlock)) {
    violations.push("app/(app)/finance/FinanceClient.tsx — 못 맞힌 카드 표기로 결제수단을 쓴다. "
      + "자동 기입은 정산 상태(actions.ts 의 payMethod === '신용카드')를 움직인다 — 확인형이다")
  }
}

console.log(`\n[영수증 결제수단 전달] 인식 칸 ${declared.length}개 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exit(1)
