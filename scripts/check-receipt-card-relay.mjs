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

// (3) 지출 폼 — 확인형 고지와 정본 매칭(lib/cardMatch, 신고 eee44d8d 2026-10-26).
//     매칭 순서(끝 4자리 > 카드사 + 별칭 낱말 > 카드사만)의 값은 scripts/test-card-match.ts 진리표가 지킨다.
//     여기서는 배선만 본다. 폼이 정본을 부르는가, 못 맞혔을 때 기본값 카드를 비우고 그 사실을 되살리기와 함께 말하는가.
{
  const canon = read('lib/cardMatch.ts')
  for (const [re, why] of [
    [/export function matchReceiptCard\b/, '정본 매칭 함수가 사라짐'],
    [/f\.includes\(p\.flat\)/, '카드사를 못 알아본 표기의 한 방향(영수증 표기가 계정 표기를 품는 경우)이 사라짐'],
    [/p\.flat\.includes\(f\)/, '카드사를 못 알아본 표기의 반대 방향이 사라짐. 한 방향만 보면 표기가 조금만 달라도 못 맞힌다'],
    [/parse\(`\$\{a\.brand\} \$\{a\.alias \?\? ''\}`\)/, '계정 쪽 표기(브랜드·별칭) 대조가 사라짐'],
    [/const GENERIC = new Set\(/, "뜻 없는 낱말('카드'·'체크'·'현금' 등) 거르기가 사라짐. 일반 표기가 아무 카드에나 붙는다"],
    [/PAY_APP/, "간편결제 앱 이름('삼성페이' 등) 거르기가 사라짐. 삼성페이가 삼성카드로 맞춰진다"],
  ]) if (!re.test(canon)) violations.push(`lib/cardMatch.ts — ${why}`)

  const src = read('app/(app)/finance/FinanceClient.tsx')
  for (const [re, why] of [
    [/setAddCardHint\(/, '못 맞힌 카드 표기를 담아 두는 자리가 사라짐. 실패가 다시 조용해진다'],
    [/addCardHint && \(!cardAccounts\.some\(/, '고지 한 줄이 사라짐. 운영자는 영수증이 무엇을 봤는지 못 본다'],
    [/matchReceiptCard\(/, '지출 폼이 정본 매칭(lib/cardMatch)을 안 부른다. 홈 승인과 판정이 갈린다'],
    [/addCardHint\.candidates/, '후보가 둘 이상일 때 이름을 보이는 자리가 사라짐'],
    [/if \(!userPickedPayRef\.current\) \{\s*if \(matchedCard\)/, '직접 고른 결제수단을 영수증 매칭이 덮는다(맞힌 갈래도 userPickedPayRef 를 지켜야 한다)'],
    [/\} else if \(cardMatch\.kind !== 'none'\) \{/, '못 맞혔을 때 직전 지출의 기본값 카드를 비우는 자리가 사라짐(신고 eee44d8d 의 원인)'],
    [/setAddCardCleared\(\{ id: prevCard\.id/, '비운 직전 카드를 쥐지 않는다. 무엇을 비웠는지 말할 수 없다(§27.8 ①)'],
    [/직전 카드 되살리기/, '비운 직전 카드를 되살리는 링크가 사라짐(적용취소 원칙)'],
    [/addCardCleared\.reason === 'ambiguous'/, "비운 이유(맞는 카드 없음·후보 여럿)를 가르지 않는다. 후보 여럿인데 '달라'라고 말한다"],
    [/if \(prevCard && !prevInCandidates\)/, '직전 카드가 후보 안에 있어도 비운다(영수증과 어긋나지 않는 값을 잃는다)'],
    [/setAddCardSuggest\(\{ id: matchedCard\.id/, '직접 고른 카드와 영수증 카드가 달라도 조용히 지나간다(영수증 카드는 B입니다 한 줄)'],
    [/userPickedPayRef\.current = true/, '운영자가 직접 고른 결제수단 표시가 사라짐. 고른 카드까지 지워진다'],
    [/카드를 고르지 않았습니다\. 이대로 저장할까요\?/, '신용카드인데 카드를 안 고른 저장의 확인이 사라짐'],
    [/addExpMethod === '신용카드' && !addExpAccId && cardAccounts\.some\(a => a\.type === 'CREDIT_CARD'\)/, '카드 미선택 확인이 신용카드 계정만 세지 않는다(고를 신용카드가 없는데 묻는다)'],
  ]) if (!re.test(src)) violations.push(`app/(app)/finance/FinanceClient.tsx — ${why}`)

  // 자동 기입 금지 — payMethod 는 **매칭에 성공했을 때만** 쓴다(운영자 결정: 확인형).
  // 그 칸이 정산 상태(settleStatus)를 파생시키므로 못 맞힌 표기로 쓰면 정산이 따라 움직인다.
  const hintBlock = block(src, 'setAddCardHint(')
  if (hintBlock && /setAddExpMethod\(/.test(hintBlock)) {
    violations.push("app/(app)/finance/FinanceClient.tsx — 못 맞힌 카드 표기로 결제수단을 쓴다. "
      + "자동 기입은 정산 상태(actions.ts 의 payMethod === '신용카드')를 움직인다 — 확인형이다")
  }

  // 고지가 가리키는 컨트롤이 화면에 실제로 서는가(디자이너 검수 2026-09-17).
  // 카드 선택 셀렉트는 결제수단이 신용카드·체크카드일 때만 선다. 그런데 못 맞힌 그 경우에는
  // 결제수단이 직전 기본값(거의 항상 계좌이체)으로 남으므로, 고지가 조건 없이 "카드를 골라
  // 주세요" 라고 말하면 운영자가 읽고 내려다봐도 고를 것이 화면에 없다. 같은 폼 안에서 한 번
  // 겪은 클래스다(오류신고 ad4256b0 — 품목이 없으면 켤 토글 자체가 없는데 켜라고 안내했다).
  const hintLine = (src.match(/^.*cardAccounts\.length === 0 \?.*$/m) ?? [''])[0]
  if (!/addExpMethod === '신용카드'/.test(hintLine) || !/addExpMethod === '체크카드'/.test(hintLine)) {
    violations.push('app/(app)/finance/FinanceClient.tsx — 카드 고지가 결제수단 상태를 안 보고 말한다. '
      + '카드 선택 셀렉트가 서는 조건(신용카드·체크카드)과 같은 조건으로 갈라야, 고를 것이 없는 화면에서 '
      + '고르라고 하지 않는다(오류신고 ad4256b0 과 같은 클래스)')
  }
}

console.log(`\n[영수증 결제수단 전달] 인식 칸 ${declared.length}개 / 위반 ${violations.length}건`)
for (const v of violations) console.log('  - ' + v)
if (violations.length > 0) process.exit(1)
