// 고아 재고 카드 정리의 화면·서버 배선 감지망(신고 f3866bca, 독립 검수 R1 2026-10-27). 읽기 전용, 위반 시 exit 1.
// 실행: node scripts/check-tracked-orphan-wiring.mjs
//
// 통합 회귀(test-tracked-orphan-flow)는 서버 쓰기만 돈다. 화면이 정리된 카드를 알리지 않거나, 제외·삭제의 적용취소가 카드를
// 먼저 되살리지 않으면(지출만 돌아와 이을 카드가 없다) 통합은 모른다. 그 순서와 자리를 글자로 지킨다.
import { readFileSync } from 'node:fs'

const read = p => readFileSync(p, 'utf8')
// 줄 주석과 블록 주석을 걷는다(주석에 같은 글자를 적어 축을 속이지 않게).
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1')
const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` (${hint})` : ''}`) }

const inv = strip(read('app/(app)/inventory/actions.ts'))
const fin = strip(read('app/(app)/finance/actions.ts'))
const snap = strip(read('app/(app)/inventory/trackedItemSnapshot.ts'))
const toast = strip(read('app/(app)/inventory/retiredCardToast.ts'))
const ic = strip(read('app/(app)/inventory/InventoryClient.tsx'))
const fc = strip(read('app/(app)/finance/FinanceClient.tsx'))
const imp = strip(read('app/api/import/route.ts'))
const orphanScript = read('scripts/check-tracked-orphans.mjs')

// ① 정본 한 곳. 정리 판정과 손질 판정
need('정리 정본이 재고 구매(includedExpenseWhere)·기록 다섯·숨김·손질을 본다',
  /export async function retireTrackedItemIfOrphan\(tx: InventoryTx, propertyId: string, category: string, label: string \| null \| undefined\)/.test(snap) &&
  /if \(!it \|\| it\.isArchived \|\| cardHandTouched\(it\) \|\| it\.locations\.length > 0 \|\| it\.checkDrafts\.length > 0\) return null/.test(snap) &&
  /tx\.expense\.count\(\{ where: includedExpenseWhere\(propertyId, category, label\) \}\)/.test(snap) &&
  /stockChecks: \{ none: \{\} \}, additions: \{ none: \{\} \}, disposals: \{ none: \{\} \}, locations: \{ none: \{\} \}, checkDrafts: \{ none: \{\} \}/.test(snap),
  '한 자리만 조건이 빠지면 기록 있는 카드가 지워진다')
need('손질 판정 네 칸이 앱 정본과 감지 스크립트에서 같고 사용자 순서는 넣지 않는다',
  /return filled\(it\.purchaseUrl\) \|\| filled\(it\.reorderMemo\) \|\| filled\(it\.memo\) \|\| it\.alertThresholdDays !== DEFAULT_ALERT_THRESHOLD_DAYS\n/.test(snap) &&
  /filled\(c\.purchaseUrl\) && '구매 링크', filled\(c\.reorderMemo\) && '발주 메모', filled\(c\.memo\) && '메모',\s*\n\s*c\.alertThresholdDays !== DEFAULT_ALERT_THRESHOLD_DAYS && `[^`]*`,\n\]/.test(orphanScript) &&
  !/sortOrder != null/.test(snap.slice(snap.indexOf('export function cardHandTouched'), snap.indexOf('export async function retireTrackedItemIfOrphan'))) &&
  !/c\.sortOrder != null/.test(orphanScript),
  '앱이 안 지우는 카드를 감지가 실패로 세거나 그 반대가 된다. 사용자 순서는 끌어 저장하면 카테고리 전 카드에 붙어 넣으면 정리가 꺼진다(재검수 B-1)')

// ② 서버. 정리를 부르는 쓰기 자리
need('재고 제외가 같은 트랜잭션에서 정리하고 다시 포함은 시드를 돈다',
  /return exclude \? retireTrackedItemIfOrphan\(tx, e\.propertyId, e\.category, e\.itemLabel\) : null/.test(inv) &&
  /if \(!exclude && e\.itemLabel\) await seedTrackedItemsFromExpenses\(\[e\.itemLabel\]\)/.test(inv))
need('지출 삭제가 같은 트랜잭션에서 정리하고 끄는 옵션(keepOrphanCard)을 둔다',
  /const retiredCard = opts\?\.keepOrphanCard \? null : await retireTrackedItemIfOrphan\(tx, target\.propertyId, target\.category, target\.itemLabel\)/.test(fin))
need('엑셀 가져오기 교체는 카드 정리를 끈다(적용취소 길이 없다, R6)', /deleteExpense\(existing\.id, \{ keepOrphanCard: true \}\)/.test(imp))
need("'지출만'·'같이 변경' 둘 다 서명 토큰만 받고 저장 전 카테고리·품명을 거기서 읽는다(B2·재검수 1)",
  /export async function retireCardAfterExpenseCategoryChange\(token: CategoryMoveToken\)/.test(inv) &&
  /export async function syncTrackedItemCategory\(token: CategoryMoveToken\)/.test(inv) &&
  (inv.match(/const m = await readMoveForExpense\(propertyId, token\)\n\s*if \(!m\.ok\) return m/g) ?? []).length === 2 &&
  /retireTrackedItemIfOrphan\(tx, propertyId, t\.fromCategory, t\.fromLabel\)/.test(inv) &&
  /const \{ fromLabel: label, fromCategory, toCategory \} = m\.t/.test(inv),
  '화면 값이나 지금 행의 품명으로 찾으면 품명을 함께 바꾼 저장에서 옛 카드를 못 찾는다. 날값을 받으면 서버 액션 직접 호출로 아무 카드나 옮긴다')
need('카테고리 이동 토큰 공용 관문이 모양·서명·지출 영업장·지금 카테고리를 본다(재검수 1)',
  /const r = readCategoryMove\(propertyId, raw\)\n\s*if \(!r\) return \{ ok: false, error: CARD_MOVE_STALE \}/.test(inv) &&
  /prisma\.expense\.findFirst\(\{ where: \{ id: r\.token\.expenseId, propertyId \}, select: \{ category: true \} \}\)\n\s*if \(!e\) return \{ ok: false/.test(inv) &&
  /if \(e\.category !== r\.token\.toCategory \|\| r\.token\.fromCategory === r\.token\.toCategory\) return \{ ok: false, error: CARD_MOVE_STALE \}/.test(inv),
  '남의 영업장 지출이나 그 사이 다시 바꾼 지출의 토큰으로 카드를 옮기거나 지운다')
need("키가 없어 서명 없이 나간 토큰이면 '지출만'은 카드를 안 건드리고 물음은 늘 뜬다(재검수 5)",
  /if \(m\.unsigned\) return \{ ok: true \}/.test(inv) &&
  /if \(unsigned && categoryMoveSigningAvailable\(propertyId\)\) return \{ ok: false, error: CARD_MOVE_STALE \}/.test(inv) &&
  /return typeof sig === 'string' \? \{ \.\.\.t, sig \} : t\n/.test(snap),
  '키가 없을 때 토큰을 안 내면 물음 자체가 사라진다')
need('지출 수정이 카테고리를 바꾸면 저장 전 값을 서명해 돌려준다(단일·다품목)',
  (fin.match(/signCategoryMove\(existing\.propertyId, \{ v: 1, expenseId: id, fromCategory: existing\.category, fromLabel: existing\.itemLabel, toCategory: category,/g) ?? []).length === 2)
need("'같이 변경' 비추적 분기는 품목 삭제와 같은 계수로 남은 재고 구매를 센다(R8 d)",
  /const n = await itemRecordCounts\(propertyId, item\)\s*\n\s*if \(n\.expense > 0\) return \{ ok: true, moved: false, kept: true \}/.test(inv))
need("'같이 변경' 추적 분기는 옛 카테고리에 재고 구매가 남으면 옛 카드를 두고 새 카드를 만들며 서명 토큰으로만 되돌린다(재검수 2)",
  /if \(\(await prisma\.expense\.count\(\{ where: includedExpenseWhere\(propertyId, fromCategory, label\) \}\)\) > 0\) \{[\s\S]{0,900}split: signCardSplit\(propertyId, \{ v: 1, cardId: created\.id, expenseId: m\.t\.expenseId \}\)/.test(inv) &&
  /const t = readCardSplit\(propertyId, token\)\n\s*if \(!t\) return \{ ok: false/.test(inv) &&
  /void undoSplitCardMove\(split\)\.then/.test(fc),
  '옮기면 남은 구매들이 카드를 잃는다. 토큰 없이 카드 id 를 받으면 재고 구매가 걸린 카드도 지운다')
need("'같이 변경' 충돌 분기는 고아가 된 옛 카드를 정리한다(R8 b)",
  /if \(clash\) \{[\s\S]{0,200}retireTrackedItemIfOrphan\(tx, propertyId, fromCategory, label\)/.test(inv))
need('품명 통합 충돌 분기가 정리하고 병합 적용취소가 먼저 되살린다(R8 a)',
  /const r = await retireTrackedItemIfOrphan\(tx, propertyId, c\.category, c\.label\)/.test(fin) &&
  /for \(const c of aff\?\.retiredCards \?\? \[\]\) await restoreTrackedItemTx\(tx, propertyId, c\)/.test(fin))

// ③ 화면. 알림과 적용취소 차례
need('공용 토스트가 품목 삭제의 적용취소(undoDeleteTrackedItem)로 되살린다', /void undoDeleteTrackedItem\(card\)\.then/.test(toast))
need('재고 제외의 적용취소가 카드를 먼저 되살린 뒤 다시 포함한다',
  /void restoreRetiredCardFirst\(retiredCard\)\.then\(\(\) => includeExpenseInInventory\(entry\.id/.test(ic))
need('재고 제외로 카드가 정리되면 같은 토스트 둘째 줄로 알리고 모달을 닫는다',
  /retiredCard \? retiredCardLine\(retiredCard\) : null/.test(ic) && /if \(retiredCard\) \(onGone \?\? onChanged\)\(\)/.test(ic))
need('지출 삭제의 적용취소가 카드를 먼저 되살린 뒤 지출을 복원한다',
  /void restoreRetiredCardFirst\(retiredCard\)\.then\(\(\) => undoDeleteExpense\(res\.undo\)\)/.test(fc))
need('정리된 카드가 오는 자리마다 알린다(삭제는 삭제 토스트 둘째 줄, 수정·지출만·충돌·다시 제외는 공용 토스트)',
  /\.\.\.\(retiredCard \? \{ detail: retiredCardLine\(retiredCard\) \} : \{\}\)/.test(fc) &&
  /if \(res\.retiredCard\) pushRetiredCardToast\(res\.retiredCard,/.test(fc) &&
  /else if \(r\.retiredCard\) pushRetiredCardToast\(r\.retiredCard,/.test(fc) &&
  /else if \(sync\.retiredCard\) pushRetiredCardToast\(sync\.retiredCard,/.test(fc) &&
  /if \(u\.retiredCard\) pushRetiredCardToast\(u\.retiredCard,/.test(fc))
need("'같이 변경 / 지출만'은 정본 3지선다이고 닫기·취소는 무변경이다(R3)",
  /const pick = await choiceDialog\(\{\s*title: '재고 카드 카테고리도 같이 바꿀까요\?'/.test(fc) &&
  /if \(pick === 'alt'\) \{\s*const r = await retireCardAfterExpenseCategoryChange\(mv\)/.test(fc) &&
  /if \(pick === 'confirm'\) \{\s*const sync = await syncTrackedItemCategory\(mv\)/.test(fc) &&
  !/cancelLabel: '지출만'/.test(fc),
  '확인창의 취소 버튼에 지출만을 실으면 닫기만 해도 카드가 지워진다')

if (fails.length) {
  console.log(`[고아 재고 카드 배선] 위반 ${fails.length}건`)
  for (const f of fails) console.log(`  - ${f}`)
  process.exit(1)
}
console.log('[고아 재고 카드 배선] 위반 0건')
