// 재단 축 배선 감지 — 실행: node scripts/check-cut-axis-wiring.mjs
//
// 왜 필요한가. 진리표(test-cut-axis-gate)는 판정 함수만 본다. 함수가 맞아도 **부르지 않으면**
// 빨래줄이 그대로 미터로 세어진다 — 물음이 안 뜨거나, 답이 fd 에 안 실리거나, 카드를 만드는
// 자리가 종전 기본값을 그대로 쓰면 화면만 바뀌고 데이터는 안 바뀐다.
//
// 잡는 것 다섯.
//   · 길이 단위 목록이 lib/units 하나뿐이다(정본 복제가 5일짜리 사고를 낸 클래스).
//   · 지출 저장 직전에 조건 넷을 다 보고 묻는다. 취소는 저장 중단(§27.5).
//   · 답이 fd 로 실려 서버로 가고, addExpense 가 그것을 시드로 넘긴다.
//   · 카드를 만드는 자리가 판정 정본을 거친다(카테고리 기본값 직행 금지).
//   · 정합 검사가 이 값을 오류가 아니라 명부로 본다.
import { readFileSync } from 'node:fs'

const units      = readFileSync('lib/units.ts', 'utf8')
const gate       = readFileSync('lib/trackUnitGate.ts', 'utf8')
const finance    = readFileSync('app/(app)/finance/actions.ts', 'utf8')
const client     = readFileSync('app/(app)/finance/FinanceClient.tsx', 'utf8')
const inventory  = readFileSync('app/(app)/inventory/actions.ts', 'utf8')
const invClient  = readFileSync('app/(app)/inventory/InventoryClient.tsx', 'utf8')
const splitCheck = readFileSync('scripts/check-item-category-split.ts', 'utf8')

const fails = []
const need = (name, cond, hint) => { if (!cond) fails.push(`${name}${hint ? ` — ${hint}` : ''}`) }

// 함수 하나만 잘라 본다 — updateExpense 도 같은 formData 를 읽어서 파일 전체로는 셀 수 없다.
function body(src, header) {
  const start = src.indexOf(header)
  if (start < 0) return ''
  const next = src.indexOf('\nexport async function', start + header.length)
  return src.slice(start, next < 0 ? src.length : next)
}
// 주석 사이 한 덩어리 — 게이트 블록만 본다(형제 게이트의 문법이 섞이지 않게).
function between(src, from, to) {
  const start = src.indexOf(from)
  if (start < 0) return ''
  const end = src.indexOf(to, start)
  return src.slice(start, end < 0 ? src.length : end)
}

// ── ① 길이 단위 정본 하나 ──────────────────────────────────────────
need('lib/units 가 길이 판정을 내보낸다', /export function isLengthUnit\(/.test(units))
need('길이 판정이 UNIT_DIMS 에서 나온다', /dimsOf\(canon\)\?\.length != null/.test(units),
  '목록을 따로 들면 별칭(센티·피트)이 새고 낡는다')
need('판정 정본이 길이 목록을 베끼지 않는다',
  /import \{ isLengthUnit \} from '\.\/units'/.test(gate) && !/\bkm\b.*\binch\b/.test(gate))
need('정합 검사가 길이 목록을 베끼지 않는다',
  /import \{ isLengthUnit \} from '\.\.\/lib\/units'/.test(splitCheck) && !/LENGTH_UNITS/.test(splitCheck),
  '검증 스크립트가 규칙을 복제하면 정본 개정을 못 따라온다')
need('지출 화면이 길이 목록을 베끼지 않는다',
  /isLengthUnit/.test(client) && !/\['cm', 'mm', 'm', '인치'\]/.test(client))

// ── ② 묻는 자리 — 조건 넷 ─────────────────────────────────────────
const block = between(client, '// 잔량을 길이로 셀지 세트로 셀지', '// 같은 쇼핑몰 주문번호의')
need('재단 물음 블록을 찾음', block.length > 0)
need('추적 카테고리일 때만 후보를 모은다', /isTrackedCat\(cat\)/.test(block))
need('애매한 조합만 후보다', /isCutAxisAmbiguous\(it\.specUnit, it\.qtyUnit\)/.test(block))
need('활성 카드 유무를 서버에 묻는다', /getTrackedCardLabels\(cat, names\)/.test(block),
  '카드가 있으면 답이 이미 카드에 있다')
need('조건 넷을 판정 정본으로 확인한다', /shouldAskCutAxis\(\{ tracked: true, hasCard: carded\.has\(label\)/.test(block),
  '조건을 화면에서 다시 쓰면 진리표가 지키는 것과 갈린다')
need('choiceDialog 로 묻는다', /choiceDialog\(\{/.test(block) && /잘라서 쓰는 품목인가요\?/.test(block))
need('취소·X 는 저장 중단(무변경)', /if \(pick === null \|\| pick === 'back'\) return/.test(block),
  '§27.5 — 취소에 실 동작을 실으면 안 된다')
need('두 선택지가 모두 동사다', /confirmLabel: `잘라서 씀, /.test(block) && /altLabel: `통으로 씀, /.test(block))
need('단위 보간에 조사를 붙인다', /unitWithRo\(/.test(block), "'팩로' 가 확인창에 나간다")

// ── ③ 답의 전달 ───────────────────────────────────────────────────
need('화면이 답을 fd 에 싣는다', /fd\.set\('cutAxisJson', JSON\.stringify\(declared\)\)/.test(block))
const addExpense = body(finance, 'export async function addExpense(')
need('addExpense 를 찾음', addExpense.length > 0)
need('서버가 답을 읽는다', /formData\.get\('cutAxisJson'\)/.test(addExpense))
need("답은 'spec'·'qty' 만 통과시킨다", /if \(v === 'spec' \|\| v === 'qty'\)/.test(addExpense))
const seedCalls = addExpense.match(/seedTrackedItemsFromExpenses\([^\n]*/g) ?? []
need('시드 호출 두 자리(다품목·단일)를 찾음', seedCalls.length === 2, `실제 ${seedCalls.length}자리`)
need('두 자리 모두 답을 넘긴다', seedCalls.every(c => c.includes('declaredTrackUnit')),
  '한쪽만 넘기면 단일 품목 구매에서 답이 증발한다')

// ── ④ 카드를 만드는 자리 ──────────────────────────────────────────
const seed = body(inventory, 'export async function seedTrackedItemsFromExpenses(')
need('seedTrackedItemsFromExpenses 를 찾음', seed.length > 0)
need('시드가 답을 받는다', /declaredTrackUnit\?: Record<string, 'spec' \| 'qty'>/.test(seed))
need('카드 생성이 판정 정본을 거친다', /trackUnit: resolveTrackUnitForNewCard\(\{/.test(seed))
need('카테고리 기본값으로 직행하지 않는다', !/trackUnit: defaultTrackUnitForCategory\(g\.category\),/.test(seed),
  '직행하면 물을 수 없는 경로가 종전 그대로 굳는다')
need('sub-label 이 붙어도 답을 찾는다',
  /declaredTrackUnit\?\.\[label\] \?\? opts\?\.declaredTrackUnit\?\.\[g\.baseLabel\]/.test(seed))

// ── ⑤ 정합 검사·토글 문구 ─────────────────────────────────────────
need('길이 규격은 오류가 아니라 명부다', /warns\.push\(`\[재단\]/.test(splitCheck))
need('옛 오류 문구가 남아 있지 않다', !/errors\.push\(`\[단위\]/.test(splitCheck),
  '게이트가 선언한 값을 실패로 보면 verify:db 가 운영자의 답을 되돌리라고 요구한다')
need('품목 설정 토글이 재단 여부를 말한다', /잘라서 쓰는 품목인지로 갈립니다/.test(invClient),
  '축이 무엇인지 안 보이면 정정할 자리를 못 찾는다')

console.log(`\n[재단 축 배선] 위반 ${fails.length}건`)
for (const f of fails) console.log('  - ' + f)
if (fails.length > 0) process.exit(1)
