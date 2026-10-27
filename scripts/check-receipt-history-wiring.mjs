// 영수증 인식이 지난 기록 규격 표기를 따르는 배선 감지망. 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계). 같은 '원목무늬 장판' 이 비품 창고에 카드 둘로 섰다.
// 영수증 자동 읽기가 AI 글자('183cm, 1.8T')를 그대로 저장했고, 지난 기록 표기('폭 183cm · 두께 1.8T')를 기억하는 장치가 품명에만
// 있었다. 판정 진리표(test-spec-notation)는 순수 함수만 본다. 함수가 맞아도 영수증을 읽는 두 자리가 **부르지 않으면** 같은 일이 난다.
//
// 축.
//   ⓐ 지출 등록 OCR(analyzeReceiptWithGemini)이 별칭 다음·세트 감지 전에 reconcileOcrItemsWithHistory 를 부른다.
//   ⓑ 홈 찍어올리기(uploadPendingReceipt · retryPendingReceiptAnalyze)가 별칭 다음에 같은 도우미를 부르고, 요약 칸을 맞춘 값으로
//      다시 쓰며, 딥링크(getPendingReceiptImage)도 옛 대기 항목을 같은 도우미로 맞춘다.
//   ⓒ 지출 등록 폼이 AI 서술 규격을 그대로 대입하지 않는다(맞춘 값 + 되살리기 specRevert + 캡션 specNote). 화면 전용 칸은 저장에 안 싣는다.
//   ⓓ 영수증 인식 사전(buildVocabBlock)이 품목별 규격 표기를 싣고, 지출 등록 OCR 이 그것으로 사전을 짓는다.
//   ⓔ 홈 승인 카드가 같은 캡션 정본(specNoteText)을 쓰고, 변형이 둘 이상이면 '지난 기록 N가지 · 지출 등록에서 고르기' 로 기존 딥링크를 건다.
//   ⓕ 세부스펙 사전(ItemSpecOption)은 읽기 소스로만 남는다. 앱 코드에 쓰기(upsert·create·createMany)가 없다. 칩은 장부 파생이다.
//   ⓖ 도우미가 이미 맞춘 품목(specNote)을 다시 맞추지 않는다(홈에서 맞춘 결과를 딥링크가 또 맞추면 영수증 원문이 사라진다).
//
// 실행: node scripts/check-receipt-history-wiring.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const strip = s => s
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, m => m.replace(/[^\n]/g, ''))
  .replace(/(^|[\s{(,;])\/\*[\s\S]*?\*\//gm, (m, pre) => pre + m.slice(pre.length).replace(/[^\n]/g, ''))
  .replace(/^[^\S\n]*\/\/.*$/gm, '')
const read = f => strip(readFileSync(f, 'utf8'))
const fails = []
const need = (name, cond) => { if (!cond) fails.push(name) }
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const rest = src.slice(start + header.length)
  const next = rest.search(/\n(export )?(async )?function \w/)
  return header + (next < 0 ? rest : rest.slice(0, next))
}

const FIN = 'app/(app)/finance/actions.ts'
const PR = 'app/(app)/dashboard/pendingReceipt.ts'
const FC = 'app/(app)/finance/FinanceClient.tsx'
const PRS = 'components/dashboard/PendingReceiptSection.tsx'
const OCR = 'lib/receiptOcr.ts'
const IV = 'lib/itemVariants.ts'
const fin = read(FIN), pr = read(PR), fc = read(FC), prs = read(PRS), ocr = read(OCR), iv = read(IV)

// ⓐ
{
  const an = body(fin, 'export async function analyzeReceiptWithGemini(')
  need(`${FIN}: analyzeReceiptWithGemini 를 찾음`, an.length > 0)
  const at = an.indexOf('await reconcileOcrItemsWithHistory(ocrPropertyId,')
  need(`ⓐ ${FIN}: 지출 등록 OCR 이 reconcileOcrItemsWithHistory 를 부르지 않는다`, at > 0)
  need(`ⓐ ${FIN}: 지난 기록 맞추기가 별칭 적용 뒤가 아니다(별칭으로 맞춘 품명을 받아야 한다)`,
    /await reconcileOcrItemsWithHistory\(ocrPropertyId, data\.items\.map\(it => \{\s*const pref = aliasMap\.get\(normalizeItemName\(it\.label\)\)/.test(an))
  need(`ⓐ ${FIN}: 지난 기록 맞추기가 세트 감지(computeSetHint)보다 늦다`, at > 0 && at < an.indexOf('computeSetHint('))
}
// ⓑ
{
  const rec = body(pr, 'async function reconcileInferred(')
  need(`ⓑ ${PR}: reconcileInferred 가 도우미를 부르지 않는다`, /await reconcileOcrItemsWithHistory\(propertyId, inferred\.items\)/.test(rec))
  need(`ⓑ ${PR}: 홈 카드 요약 칸(specValue·specUnit)을 맞춘 값으로 다시 쓰지 않는다`, /specValue: first\?\.specValue, specUnit: first\?\.specUnit/.test(rec))
  for (const fn of ['export async function uploadPendingReceipt(', 'export async function retryPendingReceiptAnalyze(']) {
    const b = body(pr, fn)
    const a = b.indexOf('inferred = await applyLearnedItemAlias(propertyId, inferred)')
    const r = b.indexOf('inferred = await reconcileInferred(propertyId, inferred)')
    need(`ⓑ ${PR}: ${fn.slice(22, -1)} 가 별칭 다음에 지난 기록 맞추기를 부르지 않는다`, a > 0 && r > a)
  }
  need(`ⓑ ${PR}: 딥링크(getPendingReceiptImage)가 옛 대기 항목을 맞추지 않는다`,
    /items: await reconcileOcrItemsWithHistory\(propertyId, parsed\?\.items \?\? \[\]\)/.test(body(pr, 'export async function getPendingReceiptImage(')))
}
// ⓒ
{
  need(`ⓒ ${FC}: AI 서술 규격을 그대로 대입한다(hasTextSpec ? it.specText)`, !/hasTextSpec \? it\.specText/.test(fc))
  need(`ⓒ ${FC}: 영수증 품목이 맞춘 규격(it.spec*)으로 지어지지 않는다`, /const now = pickOf\(it, fill, \{ specValue: it\.specValue, specUnit: it\.specUnit, specText: it\.specText \}\)/.test(fc))
  need(`ⓒ ${FC}: 되살리기가 영수증 원문(note.receipt)으로 지어지지 않는다`, /pickOf\(it, fill, note\.receipt\)/.test(fc) && /specNote: note,/.test(fc) && /specRevert: receipt \?/.test(fc))
  need(`ⓒ ${FC}: 지난번 숫자 규격을 조용히 채운다(제안 'offer' 는 '채우기' 한 번 누름이어야 한다, 돈의 축)`,
    /label: '채우기', onClick: \(\) => applyItemOffer\(idx\)/.test(fc) && /const offer = note && note\.kind === 'offer' \? pickOf\(it, fill, note\.spec\) : null/.test(fc))
  need(`ⓒ ${FC}: 품목 카드에 맞춘 흔적 캡션(specNoteText + 되살리기)이 없다`, /const t = specNoteText\(it\.specNote\)/.test(fc) && /onClick: \(\) => revertItemSpec\(idx\)/.test(fc))
  need(`ⓒ ${FC}: 화면 전용 칸(specNote·specRevert)이 저장으로 샌다`, /setHint: undefined, specNote: undefined, specRevert: undefined/.test(body(fc, 'function itemsForSave(')))
}
// ⓓ
{
  const vb = body(ocr, 'export function buildVocabBlock(')
  need(`ⓓ ${OCR}: 사전 블록이 품목별 규격 표기를 싣지 않는다`, /규격 표기 \$\{e\.notations/.test(vb) && /specText 를 그 표기 그대로/.test(vb))
  need(`ⓓ ${FIN}: 지출 등록 OCR 사전이 buildVocabBlock(notations) 로 지어지지 않는다`, /vocabBlock = buildVocabBlock\(/.test(fin) && /notations: \[\.\.\.\(notes\.get\(label\)/.test(fin))
}
// ⓔ
{
  need(`ⓔ ${PRS}: 홈 승인 카드가 캡션 정본(specNoteText)을 쓰지 않는다`, /specNoteText\(specNote\)/.test(prs))
  need(`ⓔ ${PRS}: 변형이 둘 이상일 때 '지난 기록 N가지 · 지출 등록에서 고르기' 딥링크가 없다`,
    /label: '지출 등록에서 고르기', onClick: \(\) => router\.push\(`\/finance\?pendingReceipt=\$\{row\.id\}`\)/.test(prs) && /지난 기록 \{specNote\.count\}가지/.test(prs))
}
// ⓕ
{
  const walk = (d, o = []) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const f = join(d, n); statSync(f).isDirectory() ? walk(f, o) : /\.(tsx?|mjs)$/.test(n) && o.push(f) } return o }
  for (const f of [...walk('app'), ...walk('components'), ...walk('lib')]) {
    const s = read(f)
    if (/itemSpecOption\.(upsert|create|createMany)\(/.test(s)) need(`ⓕ ${f}: 세부스펙 사전에 쓴다. 사전은 읽기 소스로만 남고 칩은 장부에서 파생한다`, false)
  }
  need(`ⓕ ${FIN}: 세부스펙 칩이 장부 파생(loadSpecHistory)이 아니다`, /const hist = \(await loadSpecHistory\(propertyId, \[itemLabel\]\)\)/.test(body(fin, 'export async function getLastItemUnits(')))
}
// ⓖ
{
  const rc = body(iv, 'export async function reconcileOcrItemsWithHistory')
  need(`ⓖ ${IV}: 이미 맞춘 품목(specNote)을 다시 맞춘다`, /items\.filter\(it => !it\.specNote/.test(rc) && /if \(it\.specNote \|\| !it\.label\?\.trim\(\)\) return it/.test(rc))
}

console.log(`[영수증 지난 기록 배선] 축 ⓐ~ⓖ / 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length) process.exit(1)
