// 품목 빠른선택 유형 안내 배선 감지 — 실행: node scripts/check-item-quickpick-wiring.mjs
//
// 왜 필요한가. 진리표(test-item-unit-source)는 가르는 함수만 본다. 함수가 맞아도 **안 꽂히면**
// 신고가 그대로 재발한다 — 9/5 '옥상 폐기물처리'(서비스)를 다음날 물품 폼에서 못 찾은 자리다.
// 칩이 유형별로 갈린 것 자체는 운영자 확정 규칙이고(2026-07-08), 결함은 반대편에 이력이 있는데
// 화면이 한 마디도 안 하는 것이었다.
//
// 잡는 것 넷.
//   · 반대 유형 건수를 1단계 질의에서 함께 세고, 질의 수는 늘지 않았다.
//   · 2·3단계(전 카테고리 보충·프리셋)는 종전 그대로다.
//   · 안내 줄은 반대편이 있을 때만 서고, 유형이 고정인 수정 폼에는 아예 없다.
//   · 재고 카드 시드가 재고 제외 지출을 거른다(같은 배포의 별건).
import { readFileSync } from 'node:fs'

const finance   = readFileSync('app/(app)/finance/actions.ts', 'utf8')
const client    = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
const inventory = readFileSync('app/(app)/inventory/actions.ts', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }
const count = (s, re) => (s.match(re) ?? []).length

// 함수 하나만 잘라 본다 — 같은 파일에 지출 질의가 여럿이라 파일 전체로는 셀 수 없다.
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const end = src.indexOf('\n}\n', start)
  return src.slice(start, end < 0 ? src.length : end)
}

// ── ① 반대 유형 건수를 같은 질의에서 ───────────────────────────────
const picks = body(finance, 'export async function getItemQuickPicks(')
need('getItemQuickPicks 를 찾음', picks.length > 0)
need('1단계 groupBy 가 유형까지 묶는다',
  /by: \['itemLabel', 'excludeFromInventory'\]/.test(picks),
  '유형이 키에 없으면 반대편 건수를 셀 수 없다')
need('1단계 where 가 유형을 거르지 않는다',
  !/where: \{ propertyId, category,[^}]*excludeFromInventory/.test(picks),
  'where 가 한쪽만 걸러 오면 반대편이 있다는 사실을 화면이 알 길이 없다')
need('가르기는 정본 함수가 한다', /splitQuickPickRows\(catRows, service\)/.test(picks))
need('칩은 같은 유형 행만 본다', /rank\(catSame\)/.test(picks))
need('반대 유형 건수를 함께 돌려준다', /return \{ picks, otherTypeCount \}/.test(picks))
// 질의 수 불변 — 건수를 따로 세는 질의를 하나 더 붙이면 여기서 붉게 선다.
const queries = count(picks, /await prisma\./g)
need('질의 수가 종전과 같다(1·2단계 둘)', queries === 2, `실제 ${queries}회`)

// ── ② 2·3단계는 종전 그대로 ────────────────────────────────────────
need('2단계는 유형 전체 이력을 종전 where 로 본다',
  /by: \['itemLabel'\],\n\s+where: \{ propertyId, itemLabel: \{ not: null \}, isShipping: false, excludeFromInventory: service \},/.test(picks),
  '보충 단계까지 양쪽을 섞으면 물품·서비스 분리가 무너진다')
need('2단계 보충 조건은 종전 그대로', /if \(picks\.length < 10\) \{/.test(picks))
need('3단계 프리셋은 종전 그대로',
  /if \(!service\) for \(const p of \(ITEM_PRESETS\[category\] \?\? \[\]\)\) push\(p\)/.test(picks))

// ── ③ 안내 줄 — 반대편이 있을 때만, 등록 폼에만 ────────────────────
need('안내 줄은 반대편이 있을 때만 선다',
  /\{onSwitchType && otherTypeCount > 0 && \(/.test(client),
  '조건이 빠지면 이력이 0건인 카테고리에도 줄이 선다')
need('칩 줄은 종전 그대로', /<div className="flex flex-wrap gap-1\.5">/.test(client))
// 문안 두 벌 — 습니다체이고, 375px 한 줄에 버튼까지 앉도록 짧다. 긴 초안(‘이 카테고리에 ~로
// 등록된 이력이’)으로 돌아가면 버튼이 2행에 혼자 떨어진다(디자이너 권고 3).
const copies = [
  '`서비스·무형 이력이 ${otherTypeCount}건 있습니다.`',
  '`물품 이력이 ${otherTypeCount}건 있습니다.`',
]
for (const c of copies) need(`문안이 짧은 습니다체다: ${c.slice(1, 15)}…`, client.includes(c))
need('긴 초안 문장으로 돌아가지 않았다', !client.includes('이 카테고리에 서비스·무형으로 등록된 이력이'))
need('전환 버튼 두 벌이 있다',
  client.includes("'물품으로 바꾸기'") && client.includes("'서비스·무형으로 바꾸기'"))
// 전환 버튼 클래스 — 44px 터치 타겟·--tc-text·포커스 링. 셋 중 하나만 빠져도 디자이너 차단 1로 돌아간다.
const switchBtn = client.slice(client.indexOf('<button type="button" onClick={onSwitchType}'), client.indexOf('{isService ? \'물품으로 바꾸기\''))
need('전환 버튼이 44px 터치 타겟이다', /-my-2 min-h-\[44px\] inline-flex items-center/.test(switchBtn),
  '글자 높이 15.8px 라 상자를 넓히지 않으면 44px 에 못 미친다')
need('전환 버튼이 --tc-text 를 쓴다', /text-\[var\(--tc-text\)\]/.test(switchBtn) && !/text-\[var\(--coral\)\]/.test(switchBtn),
  '--coral 은 다크 카드 위 2.78:1 로 §28 본문 대비 미달이다')
need('전환 버튼에 포커스 링이 있다',
  /focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-\[var\(--tc-text\)\]/.test(switchBtn))
need('전환은 세그먼트와 같은 한 곳을 부른다',
  /onSwitchType=\{\(\) => void switchAddType\(!addIsService\)\}/.test(client) &&
  /onClick=\{\(\) => void switchAddType\(false\)\}/.test(client) && /onClick=\{\(\) => void switchAddType\(true\)\}/.test(client),
  '전환 동작이 두 벌이면 비우는 칸이 한쪽에만 늘어난다')

// ── ③-B 입력이 지워지는 전환은 먼저 묻는다 ────────────────────────
// 안내 줄은 설명문으로 읽혀 세그먼트보다 오조작 값이 크다(디자이너 차단 2).
const switchFn = client.slice(client.indexOf('const switchAddType = async'), client.indexOf('// 파일 선택 → 이미지면'))
need('switchAddType 을 찾음', switchFn.length > 0)
need('전환 확인창이 switchAddType 안에 있다', /await confirmDialog\(\{/.test(switchFn),
  '진입점마다 따로 물으면 세그먼트와 안내 줄이 갈린다')
need('확인창은 §14 주의 단계다', /level: 'caution'/.test(switchFn))
need('확인 라벨이 동사다', /confirmLabel: '바꾸기'/.test(switchFn))
need('제목이 방향을 말한다',
  /title: service \? '서비스·무형으로 바꿀까요\?' : '물품으로 바꿀까요\?'/.test(switchFn))
need('지워질 값이 있을 때만 묻는다', /if \(clearingItems > 0 \|\| clearingShip\) \{/.test(switchFn),
  '입력이 비었는데 물으면 아무 일도 없는 전환에 확인창이 선다')
need('배송비·합배송까지 지워질 값으로 센다',
  /addHasShipping \|\| addShipping != null \|\| addOrderMode \|\| addOrderShipping != null/.test(switchFn))
need('취소하면 아무것도 안 지운다', /if \(!ok\) return/.test(switchFn))
// 비우기가 확인 뒤에 오는지 — 순서가 뒤집히면 확인창이 사후 통보가 된다.
need('비우기는 확인 뒤에 온다',
  switchFn.indexOf('if (!ok) return') < switchFn.indexOf('setAddItems([])'),
  '먼저 지우고 물으면 취소해도 값이 돌아오지 않는다')

// 폼별 배선 — 수정 폼은 유형이 고정이라 줄이 서면 안 된다.
const selectors = []
for (let i = client.indexOf('<ItemSelector'); i >= 0; i = client.indexOf('<ItemSelector', i + 1)) {
  selectors.push(client.slice(i, client.indexOf('/>', i) + 2))
}
need('ItemSelector 사용처는 둘(등록·수정)', selectors.length === 2, `실제 ${selectors.length}곳`)
const addSel  = selectors.find(s => s.includes('addExpCategory')) ?? ''
const editSel = selectors.find(s => s.includes('editExpCategory')) ?? ''
need('등록 폼이 전환을 넘긴다', addSel.includes('onSwitchType='))
need('수정 폼은 전환을 안 넘긴다', editSel.length > 0 && !editSel.includes('onSwitchType='),
  '수정 폼은 유형이 고정이라 바꿀 길이 없다 — 줄이 서면 누를 수 없는 안내가 된다')

// ── ④ 재고 카드 시드가 재고 제외를 거른다 ──────────────────────────
const seed = body(inventory, 'export async function seedTrackedItemsFromExpenses(')
need('seedTrackedItemsFromExpenses 를 찾음', seed.length > 0)
need('시드 질의가 재고 제외 지출을 거른다',
  /category: \{ in: trackedCats \},[\s\S]{0,600}?excludeFromInventory: false,/.test(seed),
  '조건이 없으면 서비스로 등록한 지출이 재고 카드를 만든다(9/5 옥상 폐기물처리)')

console.log(`\n[품목 빠른선택 유형 안내 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
