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
//   ── 4단계(지난 기록 목록·저장 때 묻기, 2026-10-27) ──
//   ⓗ 규격별 나누기의 옛 카드 개명은 적용취소가 남는 splitTrackedItemLabel 이다. 기록 없이 개명하던 renameTrackedItemLabel 은 0 이다(D5).
//   ⓘ 소모품 크기 게이트와 비품 서술 규격 게이트가 같은 판정 정본 classifySpecChoice 를 쓴다(손으로 쓴 환산 비교 없음).
//   ⓙ 비품 서술 규격 게이트는 세 조건(비품·자재 · 불러온 값을 고침 · 어느 지난 기록과도 동치 아님)일 때만 caution 으로 한 번 묻고,
//      '같은 품목' 은 불러온 값으로 되돌린다. 표기만 다르면 묻지 않고 맞춘다.
//   ⓚ 직접 입력 품명 칸은 이력 제안 패널이다(datalist 아님). 변형이 하나면 채우고 캡션·되살리기, 둘 이상이면 채우지 않는다.
//   ⓛ 불러온 규격(specLoaded)은 화면 전용이라 저장에 안 싣는다.
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
  need(`ⓒ ${FC}: 화면 전용 칸(specNote·specRevert)이 저장으로 샌다`, /setHint: undefined, (?:setAsked: undefined, )?specNote: undefined, specRevert: undefined/.test(body(fc, 'function itemsForSave(')))
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

// ⓗ
{
  const walk = (d, o = []) => { for (const n of readdirSync(d)) { if (n === 'node_modules' || n.startsWith('.')) continue; const f = join(d, n); statSync(f).isDirectory() ? walk(f, o) : /\.(tsx?)$/.test(n) && o.push(f) } return o }
  for (const f of [...walk('app'), ...walk('components'), ...walk('lib')]) {
    if (/\brenameTrackedItemLabel\b/.test(read(f))) need(`ⓗ ${f}: 기록 없이 옛 카드를 개명하는 renameTrackedItemLabel 이 남았다. splitTrackedItemLabel(품명 병합 기록 + 적용취소)로`, false)
  }
  const split = body(fin, 'export async function splitTrackedItemLabel(')
  need(`ⓗ ${FIN}: splitTrackedItemLabel 이 한 트랜잭션에 kind 'split' 병합 기록(지출·카드 옛 이름)을 남기지 않는다`,
    /prisma\.\$transaction\(/.test(split) && /kind: 'split', expenses: exps\.map\(e => \(\{ id: e\.id, oldLabel: e\.itemLabel \}\)\), tracked: \[\{ id: it\.id, oldLabel: it\.label \}\]/.test(split) && /newAliasKeys: \[\]/.test(split))
  need(`ⓗ ${FC}: 나누기가 splitTrackedItemLabel 을 부르고 둘째 토스트 [적용취소] 가 undoItemNameMerge 를 부르지 않는다`,
    /await splitTrackedItemLabel\(card\.cardId, renamed\)/.test(fc) && /afterSave\.push\([\s\S]{0,260}?label: '적용취소', run: \(\) => \{ void undoItemNameMerge\(r\.runId\)/.test(fc))
}
// ⓘ
{
  need(`ⓘ ${FC}: 소모품 크기 게이트가 classifySpecChoice 를 쓰지 않는다`, /classifySpecChoice\(\{ specValue: now\.value, specUnit: now\.unit \}, sizes\.map/.test(fc))
  need(`ⓘ ${FC}: 크기 동치를 손으로 환산해 비교한다(정본 밖)`, !/convertUnit\(a\.value, a\.unit, b\.unit\)/.test(fc))
}
// ⓙ
{
  const g0 = fc.indexOf('const loadedOf = (it: ItemPickState) => it.specLoaded')
  const g = g0 < 0 ? '' : fc.slice(Math.max(0, g0 - 80), fc.indexOf('const noSpec = finalItems.filter', g0))
  need(`ⓙ ${FC}: 비품 서술 규격 게이트를 찾지 못했다`, g.length > 100)
  need(`ⓙ ${FC}: 게이트가 비품·자재일 때만 서지 않는다`, /if \(addIsDurable \|\| durableConv\) \{/.test(g))
  need(`ⓙ ${FC}: 게이트가 불러온 값을 고친 품목만 보지 않는다`, /filter\(\(\{ it \}\) => it\.label\?\.trim\(\) && changed\(it\)\)/.test(g))
  need(`ⓙ ${FC}: 게이트가 classifySpecChoice 로 판정하지 않는다`, /const verdict = classifySpecChoice\(now, mine\.flatMap\(v => v\.raws\)\)/.test(g) && /if \(verdict === 'same'\) continue/.test(g))
  need(`ⓙ ${FC}: 묻는 창이 승인 문형(나누기 / 같은 품목 / 취소, caution)이 아니다`,
    /confirmLabel: '나누기', altLabel: '같은 품목', level: 'caution'/.test(g) && /지금까지 '\$\{oldText\}' /.test(g) && /if \(choice === null \|\| choice === 'back'\) return/.test(g))
  need(`ⓙ ${FC}: '같은 품목' 이 불러온 값으로 되돌리지 않는다`, /if \(choice === 'alt'\) target = loaded/.test(g))
}
// ⓚ
{
  need(`ⓚ ${FC}: 직접 입력 품명 칸에 datalist 가 남았다(메타 있는 변형은 이력 제안 패널로)`, !/list="item-detail-suggestions"/.test(fc))
  need(`ⓚ ${FC}: 직접 입력 품명 칸 아래 이력 제안 패널이 없다`, /<ItemHistoryPanel idPrefix="item-custom"[\s\S]{0,200}?onPick=\{applyVariant\}[\s\S]{0,120}?onNew=/.test(fc))
  need(`ⓚ ${FC}: 변형이 둘 이상인데도 직전 구매로 채운다`, /if \(last && vars\.length <= 1\) \{\s*applyLastContext\(last\)/.test(fc))
  need(`ⓚ ${FC}: 지난번 값 캡션에 되살리기(고르기 직전 모습 전체)가 없다`, /<WhyCaption id="item-picked-why" action=\{\{ label: '되살리기', onClick: \(\) => restoreSnapshot\(picked\.restore\) \}\}>/.test(fc))
  need(`ⓚ ${FC}: 영수증 품목의 변형 고르기(OcrVariantRows)가 없다(홈 '지출 등록에서 고르기' 가 갈 곳)`, /<OcrVariantRows idPrefix=\{`ocr-item-\$\{idx\}`\} label=\{it\.label\} onPick=\{v => pickVariantForItem\(idx, v\)\} caption=\{caption\} \/>/.test(fc))
}
// ⓛ
need(`ⓛ ${FC}: 불러온 규격(specLoaded)이 저장으로 샌다`, /specRevert: undefined, (?:specOffer: undefined, )?specLoaded: undefined/.test(body(fc, 'function itemsForSave(')))

console.log(`[영수증 지난 기록 배선] 축 ⓐ~ⓛ / 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length) process.exit(1)
