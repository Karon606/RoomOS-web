// 분류 목록(콤마 칸) 정합 감지망. 읽기 전용 소스 검사, 위반 시 exit 1.
//
// 왜 필요한가(신고 78bb0141, 2026-10-13). 기본값이 조회·초기화·확인창 세 자리에 따로 적혀 있었고
// 결제 수단은 4종·12종·4종으로 이미 갈려 있었다. 이름 변경은 칸이 비었을 때 기본값 대신 빈 목록을
// 읽어 아무것도 안 바꾸고 성공 토스트를 띄웠다(운영 영업장의 결제 수단·창문 유형이 그 상태였다).
// 그 결함을 고치자 결제 수단 이름 변경이 수납 기록까지 실제로 바꾸게 됐고, 코드가 '신용카드' 같은 글자로
// 판정하는 자리가 조용히 틀어질 길이 열렸다(독립 검수). 적용취소는 화면이 들고 있던 이전 목록을 통째로
// 다시 써서 그사이 바뀐 항목을 지웠고, 자동 추가는 운영자가 뺀 항목을 기존 값 재저장마다 되살렸다.
//
// 축은 열하나다.
//   ⓐ 조회 정본: 목록 열셋의 조회가 전부 parseOptionList 를 거친다. 어느 파일에서도 목록 칸에 `??`·`||` 폴백을
//      붙이거나(오른쪽이 글자든 변수든) 직접 split 하지 않고, 기본값 목록을 배열(작은·큰따옴표)이나 쉼표 문자열로
//      베껴 두지도 않는다(빈 칸을 빈 목록이나 손으로 적은 기본값으로 읽는 자리, 정본과 갈릴 사본이 되살아나지 않는다).
//   ⓑ 초기화 정본: resetOptionsToDefault 가 OPTION_LIST_DEFAULTS 를 쓴다.
//   ⓒ 이름 변경이 기본값을 거친다: renameOption 이 parseOptionList 로 지금 목록을 읽는다(`?? ''` 금지).
//   ⓓ 확인창: '기본값(' 뒤에는 정본에서 읽은 값(${...})만 온다. 손으로 적은 목록은 갈린다.
//   ⓔ 할인 사유 이름 변경은 영업장 범위: 연쇄 표에 via: 'leaseTerm', 조건은 optionRenameWhere 한 곳.
//   ⓕ '관리는 설정에서' 가 사실이다: '목록에 추가' 체크박스를 세우는 목록(addMode="auto", 2026-10-22 전 showAddHint)마다
//      분류 관리 탭에 그 카드가 있다. 체크박스는 저장하면 실제로 더해질 때(직접 입력·기록에 저장된 값과 다른 새 값)만 서고
//      기본은 켜짐이다(사유 목록 ask 는 기본 꺼짐, ⓛ). 끄면 서버가 목록에 안 더한다.
//   ⓖ 적용취소가 모든 카드에 같고 지금 서버 목록 위에서 돈다: 삭제는 restoreOption(그 이름 하나를 뺄 때의
//      자리에), 초기화는 undoResetOptions(서버가 쥐어 준 직전 목록에), 이름 변경은 바뀐 행 id 로. 서버 액션의
//      목록 계산은 lib/optionLists 순수 함수(표는 test-discount-reasons)이고 액션은 그 함수를 저장된 칸 그대로
//      넘겨 부른다. 이름 변경은 바뀐 행 id 를 적용취소 표에 싣고, 되돌릴 조건은 renameUndoPlan 이 서버 표로 만든다.
//      화면은 실패 응답을 보기 전에 목록을 덮지 않고, 바뀐 것이 없으면 '원래 자리로 복귀' 라고 하지 않는다.
//   ⓗ 보호 이름: 이름 변경 입구(renameOption)·그 적용취소(undoRenameOption)와 화면(runRename·OptionSection)이
//      protectedRenameError · protectedOptionReason 한 벌로 막는다. 결제 수단 보호 집합은 판정 상수에서 끌어온다.
//      부가수익·지출 보호 이름(코드가 그 글자로 기록을 만드는 이름 포함, 2026-10-13 운영자 승인)도 상수에서 끌어오고,
//      그 상수는 한 곳에서만 정의한다. 같은 글자를 다른 상수로 따로 적은 사본이 생기면 붉게 선다.
//      이름 편집은 보호 이름·이미 있는 이름을 인라인으로 막고, 서버가 받아 준 뒤에만 그 행일 때만 편집 칸을 닫는다.
//   ⓘ 정규화: 목록에 이름을 넣는 길(손 추가·이름 변경·적용취소, 그리고 다른 파일의 자동 추가)이 전부
//      정본 정규화(normalizeOptionName 또는 resolveCategoryForSave·resolveUnitForSave)를 거친다. 그 글자를
//      쓰는 기록(할인 사유 memo·입주자 직업, 엑셀 가져오기 포함)도 같은 정규화로 저장한다. 창문 유형 표기는
//      설정과 엑셀 가져오기가 한 표(windowTypeCode)로 원값에 접는다.
//   ⓙ 자동 추가는 새로 적은 값만: 기존 기록을 고치는 update 함수는 이전 값을 넘겨 견준다. 뺀 항목이
//      그 기록을 다시 저장할 때마다 되살아나지 않는다.
//   ⓚ 목록 서버 액션은 field 검사를 거친다: 칸 이름을 받아 `{ [field]: … }` 로 쓰는 액션은 무엇을 읽거나
//      쓰기 전에 assertOptionField 로 정본 표의 칸인지 본다. 없으면 편집 권한으로 영업장 행 아무 칸에나 쓴다.
//   ⓛ 사유 목록 셋(입실 취소·퇴실·보증금 미반환, 2026-10-22): 고르는 자리 전부가 CategorySelect addMode="ask" 이고
//      ('관리는 설정에서' 라 말하므로 분류 관리 카드가 있다), 사유를 저장하는 서버 경로는 전부 reasonForSave 로 다시 잰다.
//      옛 상수(reasonsForStatus·CANCEL_REASONS·CHECKOUT_REASONS·WITHHOLD_REASONS)는 없다. '기타 · 글' 을 만드는 자리는
//      lib/reasonLists 한 곳이다. 이어받기 판정은 시스템 라벨 집합으로 하고, 이름 변경은 상태 이력을 toStatus 로 나눈다.
//      '기타'·'기타 · …'·시스템 라벨은 손 추가·이름 변경 입구에서 막는다.
//   ⓜ 카드 행 넘침(아래 블록 머리말).
//   ⓝ 2차 목록 여섯(2026-10-22): 기타 규약 칸 등록·이름 변경 범위(재고 기록은 추적 품목으로)·저장 검증이 칸 이름으로 한 벌·
//      분류 관리 묶음 머리 다섯과 카드 자리·2차 카드 손놀림(정규화·기본값 있는 칸만 초기화). 고르는 자리 축은 각 블록에 있다.
//
// 실행: node scripts/check-option-lists.mjs
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const LIB = 'lib/optionLists.ts'
const ACTIONS = 'app/(app)/settings/actions.ts'
const FORM = 'app/(app)/settings/SettingsForm.tsx'
const violations = []

const lib = readFileSync(LIB, 'utf8')
const actions = readFileSync(ACTIONS, 'utf8')
const form = readFileSync(FORM, 'utf8')

// 함수 본문을 잘라 온다. headRe 는 매개변수 여는 괄호까지 맞춘다. 괄호 깊이로 매개변수를 넘고
// (구조 분해·타입 속 중괄호가 있다), 반환 타입의 <...> 와 객체 타입 { … } 를 넘어, 줄 끝에 선 첫 중괄호부터
// 깊이로 본문을 자른다(반환 타입 `{ next: string[] }` 의 중괄호를 본문으로 잘못 잡지 않는다).
function bodyOf(src, headRe) {
  const m = headRe.exec(src)
  if (!m) return null
  let k = m.index + m[0].length - 1
  if (src[k] !== '(') return null
  for (let depth = 0; k < src.length; k++) {
    if (src[k] === '(') depth++
    else if (src[k] === ')') { depth--; if (depth === 0) break }
  }
  let angle = 0, typeBrace = 0
  for (k = k + 1; k < src.length; k++) {
    const c = src[k]
    if (c === '<') angle++
    else if (c === '>' && src[k - 1] !== '=') angle--
    else if (c === '{' && angle === 0 && typeBrace === 0 && src[k + 1] === '\n') break
    else if (c === '{') typeBrace++
    else if (c === '}') typeBrace--
  }
  let depth = 0
  for (let j = k; j < src.length; j++) {
    if (src[j] === '{') depth++
    else if (src[j] === '}') { depth--; if (depth === 0) return src.slice(k, j + 1) }
  }
  return null
}

// 주석을 걷는다. 설명 글자가 검사를 통과시키면 그물이 아니라 장식이다.
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ')
}

function walk(dir, out = [], re = /\.tsx?$/) {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out, re)
    else if (re.test(n)) out.push(p)
  }
  return out
}
const SOURCES = [...walk('app'), ...walk('components'), ...walk('lib')]

// 정본의 목록 칸 이름들.
const defaultsBlock = lib.match(/export const OPTION_LIST_DEFAULTS[^=]*=\s*\{([\s\S]*?)\n\}/)
const FIELDS = defaultsBlock ? [...defaultsBlock[1].matchAll(/^\s{2}(\w+):/gm)].map(m => m[1]) : []
if (FIELDS.length < 13) violations.push(`${LIB} · OPTION_LIST_DEFAULTS 에서 목록 칸을 ${FIELDS.length}개만 읽었다(13 기대).`)
const FIELD_RE = FIELDS.join('|')

// ⓐ 조회 정본.
for (const f of FIELDS) {
  if (!actions.includes(`parseOptionList('${f}'`)) {
    violations.push(`${ACTIONS} · ${f} 조회가 parseOptionList 를 안 거친다. 조회와 이름 변경이 다른 기본값을 읽게 된다.`)
  }
}
for (const name of ['FIELD_DEFAULTS', 'DEFAULT_PAYMENT_METHODS', 'DEFAULT_DIRECTION_OPTIONS', 'DEFAULT_EXPENSE_CATEGORIES', 'DEFAULT_JOB_OPTIONS', 'DEFAULT_DISCOUNT_REASONS']) {
  if (new RegExp(`\\b${name}\\b`).test(actions)) violations.push(`${ACTIONS} · 옛 기본값 상수 ${name} 가 되살아났다. 기본값은 ${LIB} 한 벌이다.`)
}
for (const p of SOURCES) {
  if (p === LIB) continue
  const code = stripComments(readFileSync(p, 'utf8'))
  const at = i => code.slice(0, i).split('\n').length
  // 폴백의 오른쪽이 무엇이든(글자·상수·소문자 변수) 목록 칸에 ?? · || 를 붙이면 빈 칸을 제 뜻대로 읽는 것이다.
  for (const m of code.matchAll(new RegExp(`\\b(${FIELD_RE})\\s*(\\?\\?|\\|\\|)`, 'g'))) {
    violations.push(`${p}:${at(m.index)} · 목록 칸 ${m[1]} 을 \`${m[2]} …\` 폴백으로 읽는다. 빈 칸(null)을 빈 목록이나 손으로 적은 기본값으로 읽으면 조회 화면과 갈린다. ${LIB} 의 parseOptionList 를 쓴다.`)
  }
  // 직접 split 은 `x.paymentMethods?.split(` 뿐 아니라 `(x.paymentMethods ?? d).split(` 처럼 괄호를 닫고 붙는 꼴도 본다.
  for (const m of code.matchAll(new RegExp(`\\b(${FIELD_RE})\\b(\\s*\\??\\.split\\(|[^\\n]{0,40}\\)\\s*\\.split\\()`, 'g'))) {
    violations.push(`${p}:${at(m.index)} · 목록 칸 ${m[1]} 을 직접 split 한다. 빈 칸(null)의 기본값을 잃는다. ${LIB} 의 parseOptionList 를 쓴다.`)
  }
}
// 기본값 목록의 사본. 어느 목록의 기본값을 80% 이상 담은 배열 글자(작은따옴표·큰따옴표)나 쉼표 문자열은 정본
// (OPTION_LIST_DEFAULTS)의 손 사본이다(PendingReceiptSection 폴백은 13개 중 12개, FinanceClient 결제 수단은 4개 전부였다,
// 2차 검수). 두 항목 목록(방타입·등급·창문·작업 종류)도 둘 다 담으면 사본이다. 저장소에 그런 사본은 정본뿐이라 오탐이
// 없다(3차 검수 실측). 판정용 부분집합(세부 항목 면제 5개·재고 3개·수납 어휘 4개 중 3개)은 이 문턱 아래라 안 걸린다.
// 기본값 배열이 사는 정본 파일(lib/optionLists·lib/requestCategories·lib/unitOptions)만 빼고 본다.
{
  const resolveConst = name => {
    for (const f of ['lib/requestCategories.ts', 'lib/unitOptions.ts']) {
      const m = readFileSync(f, 'utf8').match(new RegExp(`export const ${name}\\b[^=]*=\\s*\\[([\\s\\S]*?)\\]`))
      if (m) return [...m[1].matchAll(/'([^']+)'/g)].map(x => x[1])
    }
    return []
  }
  const defaults = {}
  for (const m of (defaultsBlock?.[1] ?? '').matchAll(/^\s{2}(\w+):\s*(\[[^\n]*\]|[A-Z_]+),?\s*$/gm)) {
    defaults[m[1]] = m[2].startsWith('[') ? [...m[2].matchAll(/'([^']+)'/g)].map(x => x[1]) : resolveConst(m[2])
  }
  if (Object.keys(defaults).length < 13) violations.push(`${LIB} · 기본값 사본 검사가 OPTION_LIST_DEFAULTS 를 ${Object.keys(defaults).length}칸만 읽었다(13 기대).`)
  const CANON = new Set([LIB, 'lib/requestCategories.ts', 'lib/unitOptions.ts'])
  const copied = strs => Object.entries(defaults)
    .filter(([, vals]) => vals.length >= 2 && vals.filter(v => strs.has(v)).length >= vals.length * 0.8)
    .map(([f]) => f)
  for (const p of SOURCES) {
    if (CANON.has(p)) continue
    const code = stripComments(readFileSync(p, 'utf8'))
    const at = i => code.slice(0, i).split('\n').length
    for (const m of code.matchAll(/\[([^\[\]]*)\]/g)) {
      const strs = new Set([...m[1].matchAll(/(['"])([^'"\n]+)\1/g)].map(x => x[2]))
      if (strs.size < 2) continue
      for (const f of copied(strs)) violations.push(`${p}:${at(m.index)} · ${f} 기본값 목록을 배열로 베껴 두었다. 정본(OPTION_LIST_DEFAULTS.${f})을 import 해 쓴다.`)
    }
    for (const m of code.matchAll(/(['"`])([^'"`\n]*,[^'"`\n]*)\1/g)) {
      const strs = new Set(m[2].split(',').map(x => x.trim()).filter(Boolean))
      if (strs.size < 2) continue
      for (const f of copied(strs)) violations.push(`${p}:${at(m.index)} · ${f} 기본값 목록을 쉼표 문자열로 베껴 두었다. 정본(OPTION_LIST_DEFAULTS.${f})을 import 해 쓴다.`)
    }
  }
}

// ⓑ 초기화 정본.
{
  const b = bodyOf(actions, /export async function resetOptionsToDefault\(/)
  if (!b) violations.push(`${ACTIONS} · resetOptionsToDefault 를 못 찾았다.`)
  else if (!/OPTION_LIST_DEFAULTS\[field\]/.test(b)) violations.push(`${ACTIONS} · 초기화가 정본 기본값(OPTION_LIST_DEFAULTS)을 안 쓴다. 확인창이 말한 값과 실제로 쓰는 값이 갈린다.`)
}

// ⓒ 이름 변경이 기본값을 거친다.
{
  const b = bodyOf(actions, /export async function renameOption\(/)
  if (!b) violations.push(`${ACTIONS} · renameOption 을 못 찾았다.`)
  else {
    if (!/parseOptionList\(field,/.test(b)) violations.push(`${ACTIONS} · renameOption 이 parseOptionList 로 지금 목록을 안 읽는다. 칸이 빈 영업장에서 이름 변경이 조용히 무시된다.`)
    if (/\?\?\s*''\)/.test(b)) violations.push(`${ACTIONS} · renameOption 에 \`?? ''\` 가 있다. 빈 칸을 빈 목록으로 읽으면 기본값 목록의 이름 변경이 무시되고 성공 토스트만 뜬다.`)
  }
}

// ⓓ 확인창이 정본에서 읽는다. 확인창 제목 문자열 안의 '기본값(' 만 본다(주석의 '기본값(%)' 따위는 대상 밖).
for (const m of form.matchAll(/title:\s*([`'"])([^\n]*?)\1/g)) {
  const text = m[2]
  for (const h of text.matchAll(/기본값\(/g)) {
    if (text.slice(h.index + '기본값('.length, h.index + '기본값('.length + 2) !== '${') {
      const line = form.slice(0, m.index).split('\n').length
      violations.push(`${FORM}:${line} · 초기화 확인창이 기본값을 손으로 적었다. OPTION_LIST_DEFAULTS 에서 읽어야 초기화가 실제로 쓰는 값과 안 갈린다.`)
    }
  }
}

// ⓔ 할인 사유 이름 변경은 영업장 범위.
{
  if (!/discountReasons:\s*\[\{\s*model:\s*'rentDiscount',\s*column:\s*'memo',\s*via:\s*'leaseTerm'\s*\}\]/.test(actions)) {
    violations.push(`${ACTIONS} · RENAME_CASCADE.discountReasons 가 via: 'leaseTerm' 을 안 쥔다. RentDiscount 에는 propertyId 가 없어 실행 오류이거나 다른 영업장 할인까지 바뀐다.`)
  }
  const w = bodyOf(lib, /export function optionRenameWhere\(/)
  if (!w || !/t\.via === 'leaseTerm'/.test(w) || !/leaseTerm:\s*\{\s*propertyId\s*\}/.test(w)) {
    violations.push(`${LIB} · optionRenameWhere 가 계약(leaseTerm)으로 영업장을 거르는 갈래를 잃었다.`)
  }
  if (/function renameWhere\(/.test(actions)) violations.push(`${ACTIONS} · 옛 renameWhere 가 되살아났다. 조건은 optionRenameWhere 한 곳이어야 건수·변경·적용취소가 안 갈린다.`)
  for (const fn of ['countRenameTargets', 'renameOption']) {
    const b = bodyOf(actions, new RegExp(`export async function ${fn}\\(`))
    if (!b) violations.push(`${ACTIONS} · ${fn} 를 못 찾았다.`)
    else if (!/optionRenameWhere\(/.test(b)) violations.push(`${ACTIONS} · ${fn} 가 optionRenameWhere 를 안 쓴다. 영업장 범위가 한 자리에서만 지켜진다.`)
  }
  // 적용취소의 조건은 renameUndoPlan 이 서버 표의 칸과 지금 적힌 새 이름으로 만든다(영업장 범위는 optionRenameWhere).
  const plan = bodyOf(lib, /export function renameUndoPlan\(/)
  if (!plan || !/optionRenameWhere\(t, propertyId, undo\.newValue\)/.test(plan) || !/cascade\.find\(/.test(plan)) {
    violations.push(`${LIB} · renameUndoPlan 이 서버 표(cascade)의 칸과 새 이름(undo.newValue)·optionRenameWhere 로 조건을 만들지 않는다. 화면이 보낸 칸을 그대로 쓰면 영업장 범위를 화면이 정한다.`)
  }
}

// ⓕ '목록에 추가' 체크박스(addMode="auto")를 쓰는 목록마다 설정 카드.
// 새 자리에서 addMode="auto" 를 쓰면 여기에 그 목록 칸을 적는다. 적지 않으면 붉게 선다.
const HINT_FIELD = {
  'app/(app)/requests/RequestsClient.tsx': 'requestCategories',
  'components/entity-modal/widgets/TenantRequestsTab.tsx': 'requestCategories',
  'app/(app)/finance/FinanceClient.tsx': 'expenseCategories',
  'components/ui/JobSelect.tsx': 'jobOptions',
  'components/entity-modal/widgets/DiscountWidget.tsx': 'discountReasons',
  // 2차(2026-10-22). 작업 종류·부가수익 카테고리·지출 카테고리 남은 자리(고정 지출 둘·일괄 수정·홈 승인).
  'components/work/RoomWorkPlanForm.tsx': 'workKindOptions',
  'app/(app)/rooms/IncomeSection.tsx': 'incomeCategories',
  'app/(app)/settings/SettingsForm.tsx': 'expenseCategories',
  'components/dashboard/PendingReceiptSection.tsx': 'expenseCategories',
}
const cardFields = new Set([...form.matchAll(/<OptionSection[\s\S]*?\n\s*field="(\w+)"/g)].map(m => m[1]))
for (const p of [...walk('app', [], /\.tsx$/), ...walk('components', [], /\.tsx$/)]) {
  if (p === 'components/ui/CategorySelect.tsx') continue
  const src = readFileSync(p, 'utf8')
  if (/\bshowAddHint\b|\baddHintText\b/.test(src)) violations.push(`${p} · 옛 '저절로 추가됩니다' 힌트(showAddHint·addHintText)가 되살아났다. addMode="auto" 체크박스 한 문법이다.`)
  if (!/addMode="auto"/.test(src)) continue
  const f = HINT_FIELD[p]
  if (!f) { violations.push(`${p} · addMode="auto"('관리는 설정에서')를 쓰는데 어느 목록인지 이 그물에 안 적혔다. HINT_FIELD 에 적고 분류 관리 탭에 카드가 있는지 본다.`); continue }
  if (!cardFields.has(f)) violations.push(`${p} · '관리는 설정에서' 라고 말하는데 분류 관리 탭에 ${f} 카드(OptionSection)가 없다. 거짓 약속이다.`)
}
// '목록에 추가' 체크박스는 실제로 더해질 때만 선다. 직접 입력을 골랐거나 기록에 저장된 값과 다른
// 새 값을 쳤을 때다(서버는 이전 값과 같으면 안 더한다). 고치는 폼은 그 기록의 값을, 새 기록 폼은 '' 를 savedValue 로
// 넘긴다(3차 검수). 지출 수정·지출 등록·입주자 직업이 그 자리다.
{
  const cs = readFileSync('components/ui/CategorySelect.tsx', 'utf8')
  if (!/addMode === 'auto' && \(customMode \|\| \(value !== '' && value !== baseline\)\) && addBox/.test(cs) || !/const baseline = savedValue \?\? initialValue/.test(cs)) {
    violations.push(`components/ui/CategorySelect.tsx · '목록에 추가' 체크박스가 '실제로 목록에 더해질 때'(직접 입력·저장된 값과 다른 새 값)만 서지 않는다.`)
  }
  // 끄면 목록에 안 더한다. 서버가 그 체크를 읽어야 체크박스가 거짓말이 아니다(2026-10-22 운영자 결정 2).
  const OFF_READS = [
    ['app/(app)/finance/actions.ts', /resolveExpenseCategoryForSave\(propertyId, categoryRaw, undefined, formData\.get\('categoryAddToList'\) !== '0'\)/, '지출 등록'],
    ['app/(app)/finance/actions.ts', /resolveExpenseCategoryForSave\(propertyId, categoryRaw, existing\?\.category, formData\.get\('categoryAddToList'\) !== '0'\)/, '지출 수정'],
    ['app/(app)/finance/actions.ts', /if \(addToList && nextList && value !== prev\)/, '지출 카테고리 적립'],
    ['app/(app)/tenants/actions.ts', /if \(addToList && nextList && value !== prev\)/, '요청 카테고리 적립'],
    ['app/(app)/tenants/actions.ts', /resolveRequestCategoryForSave\(propertyId, data\.category, undefined, data\.addCategoryToList !== false\)/, '요청 등록'],
    ['app/(app)/tenants/actions.ts', /resolveRequestCategoryForSave\(propertyId, data\.category, before\.category, data\.addCategoryToList !== false\)/, '요청 수정'],
    ['app/(app)/tenants/actions.ts', /if \(job && formData\.get\('jobAddToList'\) !== '0'\) await addJobOption\(job\)/, '입주자 등록 직업'],
    ['app/(app)/tenants/actions.ts', /if \(job && job !== prevJob && formData\.get\('jobAddToList'\) !== '0'\) await addJobOption\(job\)/, '입주자 수정 직업'],
    ['components/entity-modal/widgets/DiscountWidget.tsx', /if \(why && reasonToList && !reasonOptions\.includes\(why\)\)/, '할인 사유'],
    ['app/(app)/requests/RequestsClient.tsx', /addCategoryToList,\n/, '요청 폼'],
    ['components/entity-modal/widgets/TenantRequestsTab.tsx', /addCategoryToList: newCategoryToList/, '입주자 요청 탭'],
  ]
  for (const [p, re, what] of OFF_READS) {
    if (!re.test(readFileSync(p, 'utf8'))) violations.push(`${p} · ${what} 이(가) '목록에 추가' 체크를 끈 것을 읽지 않는다. 꺼도 목록에 쌓인다.`)
  }
  const SAVED = [
    ['app/(app)/finance/FinanceClient.tsx', /value=\{editExpCategory\}[\s\S]{0,200}savedValue=\{detailExp\.category \?\? ''\}/, '지출 수정'],
    ['app/(app)/finance/FinanceClient.tsx', /value=\{addExpCategory\}[\s\S]{0,240}savedValue=""/, '지출 등록'],
    ['components/ui/JobSelect.tsx', /savedValue=\{defaultValue \?\? ''\}/, '입주자 직업'],
  ]
  for (const [p, re, what] of SAVED) {
    if (!re.test(readFileSync(p, 'utf8'))) violations.push(`${p} · ${what} 칸이 CategorySelect 에 기록의 저장 값(savedValue)을 안 넘긴다. 추가 힌트가 사실과 달라진다.`)
  }
}

// ⓖ 적용취소가 모든 카드에 같고, 지금 서버 목록 위에서 돈다.
const os = bodyOf(form, /function OptionSection\(/)
{
  if (!os) violations.push(`${FORM} · OptionSection 을 못 찾았다.`)
  else {
    const code = stripComments(os)
    const n = (code.match(/label: '적용취소'/g) ?? []).length
    if (n < 3) violations.push(`${FORM} · OptionSection 의 [적용취소] 가 ${n}곳이다(삭제·초기화·이름 변경 셋 기대).`)
    if (/reorderOptions\(/.test(code)) violations.push(`${FORM} · OptionSection 의 적용취소가 이전 목록으로 순서 저장(reorderOptions)을 다시 부른다. 화면이 들고 있던 목록을 통째로 쓰면 그사이 더하거나 다른 화면이 쌓은 항목이 지워진다. restoreOption·undoResetOptions 를 쓴다.`)
    if (!/restoreOption\(field, item, index\)/.test(code) || !/const index = items\.indexOf\(item\)/.test(code)) violations.push(`${FORM} · 삭제 적용취소가 삭제할 때의 자리(index)로 그 이름 하나만 되돌리지(restoreOption) 않는다.`)
    if (!/undoResetOptions\(field,/.test(code)) violations.push(`${FORM} · 초기화 적용취소가 서버가 쥐어 준 직전 목록(undoResetOptions)을 안 쓴다.`)
    if (!/undoRenameOption\(/.test(code)) violations.push(`${FORM} · 이름 변경 적용취소가 서버의 id 기준 되돌리기를 안 부른다.`)
    // 적용취소 결과가 실패면 화면 목록을 덮지 않는다. 실패 응답에는 목록이 없어 그대로 덮으면 카드가 빈다(3차 검수 역주입 N8).
    if (!/const undoToast = [\s\S]*?if \(!r\.ok\) \{ pushToast\('error', r\.error\); return \}\s*setItems\(\(\) => r\.items\)/.test(code)) {
      violations.push(`${FORM} · 삭제·초기화 적용취소가 실패 응답(r.ok)을 보기 전에 화면 목록을 덮는다.`)
    }
    if (!/if \(!u\.ok\) \{ pushToast\('error', u\.error\); return \}\s*setItems\(\(\) => u\.items\)/.test(code)) {
      violations.push(`${FORM} · 이름 변경 적용취소가 실패 응답(u.ok)을 보기 전에 화면 목록을 덮는다.`)
    }
    // 그사이 같은 이름이 다시 생겨 바뀐 것이 없으면 '원래 자리로 복귀' 대신 사실대로 말한다(changed).
    if (!/r\.changed === false && unchangedMessage/.test(code) || !/restoreOption\(field, item, index\), REMOVE_TOAST\.undone\(getLabel\(item\)\), ALREADY_LISTED\(getLabel\(item\)\)\)/.test(code)) {
      violations.push(`${FORM} · 삭제 적용취소가 바뀐 것이 없을 때(changed false)도 '원래 자리로 복귀' 라고 말한다.`)
    }
  }
  const reset = bodyOf(actions, /export async function resetOptionsToDefault\(/)
  if (reset && !/return \{ items, before \}/.test(reset)) violations.push(`${ACTIONS} · 초기화가 직전 서버 목록(before)을 돌려주지 않는다. 적용취소가 화면의 낡은 목록을 기준으로 삼게 된다.`)
  // 목록 계산은 순수 함수가 하고(표는 test-discount-reasons), 액션은 저장된 칸 그대로를 넘긴다.
  // 빈 목록이나 화면 목록을 넘기거나 직전 목록만 쓰면 그사이 바뀐 항목이 지워진다(2차 검수 역주입 M26·M27).
  const WIRING = {
    restoreOption: [/optionListAfterRestore\(field, property\?\.\[field\], name, index\)/, /if \(!r\.name\) return \{ ok: false/, /data: \{ \[field\]: r\.next\.join\(','\) \}/, /items: r\.next, changed: r\.changed/],
    undoResetOptions: [/optionListAfterResetUndo\(field, property\?\.\[field\], before\)/, /data: \{ \[field\]: next\.join\(','\) \}/],
    undoRenameOption: [/optionListAfterRenameUndo\(field, property\?\.\[field\], oldValue, newValue\)/, /renameUndoPlan\(cascade, undo, propertyId\)/, /const cascade = RENAME_CASCADE\[field\]/, /where: step\.where/],
    renameOption: [/optionListAfterRename\(current, oldValue, newValue\)/, /rows\.push\(\{ model: t\.model, column: t\.column, ids \}\)/, /rows: changed\.rows/],
  }
  for (const [fn, res] of Object.entries(WIRING)) {
    const b = bodyOf(actions, new RegExp(`export async function ${fn}\\(`))
    if (!b) { violations.push(`${ACTIONS} · ${fn} 를 못 찾았다.`); continue }
    const code = stripComments(b)
    for (const re of res) {
      if (!re.test(code)) violations.push(`${ACTIONS} · ${fn} 가 목록·적용취소 계산을 정본 그대로 하지 않는다(${re.source.replace(/\\/g, '').slice(0, 60)} 없음). 그사이 바뀐 항목이 지워지거나 적용취소가 빈손이 된다.`)
    }
  }
  const blocks = [...form.matchAll(/<OptionSection\b[\s\S]*?\/>/g)].map(m => m[0])
  for (const b of blocks) {
    const title = b.match(/title="([^"]+)"/)?.[1] ?? '(제목 없음)'
    if (!/\bfield="\w+"/.test(b) || !/\bsetItems=\{/.test(b)) violations.push(`${FORM} · '${title}' 카드가 field·setItems 를 안 넘긴다. 이 카드만 적용취소가 빠진다.`)
  }
  for (const f of FIELDS) {
    if (!cardFields.has(f)) violations.push(`${FORM} · ${f} 목록의 카드가 분류 관리 탭에 없다.`)
  }
  const r = bodyOf(actions, /export async function renameOption\(/)
  if (r && (!/select: \{ id: true \}/.test(r) || !/undo:/.test(r))) {
    violations.push(`${ACTIONS} · renameOption 이 바뀐 행 id 를 쥐어 돌려주지 않는다. 적용취소가 값 기준이 되면 원래 새 이름이던 행까지 옛 이름이 된다.`)
  }
}

// ⓗ 보호 이름 · 서버 입구와 화면이 한 벌.
{
  const r = bodyOf(actions, /export async function renameOption\(/)
  if (r && !/protectedRenameError\(field, oldValue, newValue\)/.test(stripComments(r))) {
    violations.push(`${ACTIONS} · renameOption 입구가 보호 이름(protectedRenameError)을 안 막는다. 코드가 글자로 판정하는 이름이 바뀌면 카드 매출·현금영수증 대상이 조용히 틀어진다.`)
  }
  const u = bodyOf(actions, /export async function undoRenameOption\(/)
  if (!u || !/protectedRenameError\(field, newValue, oldValue\)/.test(stripComments(u)) || !/normalizeOptionName\(field, oldValue\) !== oldValue/.test(stripComments(u))) {
    violations.push(`${ACTIONS} · undoRenameOption 이 이름 변경 입구와 같은 문(보호 이름·정규화)을 안 지난다. 화면을 거쳐 온 적용취소 표로 보호 이름을 되살릴 수 있다.`)
  }
  const rr = bodyOf(form, /const runRename = async \(/)
  if (!rr || !/protectedRenameError\(field, oldVal, newVal\)/.test(stripComments(rr))) {
    violations.push(`${FORM} · runRename 이 건수 확인창 전에 보호 이름(protectedRenameError)을 안 본다. 확인을 받고 나서야 거절당한다.`)
  }
  if (os && !/protectedOptionReason\(field, item\)/.test(stripComments(os))) {
    violations.push(`${FORM} · OptionSection 이 보호 이름의 수정 버튼을 서버와 같은 함수(protectedOptionReason)로 가리지 않는다.`)
  }
  // 이름 편집의 인라인 검증(§27.2). 보호 이름·이미 있는 이름을 치는 자리에서 막고, 걸리면 저장을 못 누르고,
  // 저장은 입구에서 그 오류를 다시 본다. 편집 칸은 서버가 받아 준 뒤에만, 그 행일 때만 닫는다(3차 검수 역주입 N9·N10).
  if (os) {
    const code = stripComments(os)
    if (!/protectedRenameError\(field, editingItem, editName\)/.test(code) || !/editName !== editingItem && items\.includes\(editName\)/.test(code)) {
      violations.push(`${FORM} · 이름 편집의 인라인 검증이 보호 이름·이미 있는 이름을 서버와 같은 기준으로 재지 않는다.`)
    }
    if (!/disabled=\{!!editError \|\| savingEdit\}/.test(code)) violations.push(`${FORM} · 인라인 오류가 있어도 저장 버튼이 눌린다.`)
    const save = bodyOf(code, /const saveEdit = async \(/)
    if (!save) violations.push(`${FORM} · saveEdit 를 못 찾았다.`)
    else {
      if (!/if \(editingItem === null \|\| !onRename \|\| savingEdit \|\| editError\) return/.test(save)) violations.push(`${FORM} · saveEdit 가 입구에서 인라인 오류(editError)를 다시 보지 않는다. Enter 로 오류를 지나 저장할 수 있다.`)
      const between = save.slice(save.indexOf('setSavingEdit(true)'), save.indexOf('if (!res) return'))
      if (save.indexOf('setSavingEdit(true)') < 0 || save.indexOf('if (!res) return') < 0 || /setEditingItem\(/.test(between)) {
        violations.push(`${FORM} · saveEdit 가 서버 응답 전에 편집 칸을 닫는다. 거절당하면 친 글자가 사라진다.`)
      }
      if (!/setEditingItem\(cur => cur === oldVal \? null : cur\)/.test(save)) violations.push(`${FORM} · saveEdit 가 응답 뒤 지금 열린 행이 그 행인지 보지 않고 닫는다. 그사이 연 다른 행 편집이 닫힌다.`)
    }
  }
  const pay = lib.match(/paymentMethods:\s*\{\s*names:([^\n]*)/)?.[1] ?? ''
  for (const c of ['...PAYMENT_METHODS', '...CARD_LIKE_METHODS', 'DEPOSIT_SOURCED_PAY_METHOD']) {
    if (!pay.includes(c)) violations.push(`${LIB} · 결제 수단 보호 이름이 판정 상수 ${c.replace('...', '')} 에서 오지 않는다. 손으로 적으면 판정 자리와 두 벌이 된다.`)
  }
  // 부가수익·지출 보호 이름. 코드가 그 글자로 기록을 만들거나(청소·작업 지출, 퇴실 정산·예약 취소·과납 부가수익)
  // 묶는(재고) 이름이다. 손으로 적으면 기록을 만드는 자리와 두 벌이 되고, 그 자리 글자가 바뀌는 날 보호가 헛돈다.
  const PROTECTED_CONSTS = {
    incomeCategories: {
      CLEANING_FEE_CATEGORY: 'lib/incomeCategories.ts', FORFEIT_CATEGORY: 'lib/incomeCategories.ts',
      PENALTY_CATEGORY: 'lib/incomeCategories.ts', OVERPAY_INCOME_CATEGORY: 'lib/incomeCategories.ts',
    },
    expenseCategories: {
      CLEANING_EXPENSE_CATEGORY: 'app/(app)/room-manage/cleaningConstants.ts', WORK_EXPENSE_CATEGORY: 'app/(app)/room-manage/cleaningConstants.ts',
    },
  }
  for (const [field, consts] of Object.entries(PROTECTED_CONSTS)) {
    const line = lib.match(new RegExp(`\\b${field}:\\s*\\{\\s*names:([^\\n]*)`))?.[1] ?? ''
    if (!line) { violations.push(`${LIB} · ${field} 보호 이름 줄을 못 찾았다.`); continue }
    if (/'/.test(line)) violations.push(`${LIB} · ${field} 보호 이름에 손으로 적은 글자가 있다. 기록을 만드는 자리의 상수에서 끌어온다.`)
    for (const c of Object.keys(consts)) {
      if (!new RegExp(`\\b${c}\\b`).test(line)) violations.push(`${LIB} · ${field} 보호 이름이 ${c} 를 안 쥔다. 코드가 그 글자로 기록을 만들어 이름을 바꾸면 지난 기록과 다음 기록이 갈린다.`)
    }
    if (field === 'expenseCategories' && !line.includes('DEFAULT_INVENTORY_CATEGORIES')) violations.push(`${LIB} · 지출 보호 이름이 재고 기본 카테고리(DEFAULT_INVENTORY_CATEGORIES)에서 오지 않는다.`)
  }
  // 그 상수는 한 곳에서만 정의한다. 같은 글자를 다른 상수로 따로 적은 사본도 안 된다(이중 정의).
  const canonOf = new Map()
  for (const consts of Object.values(PROTECTED_CONSTS)) {
    for (const [name, file] of Object.entries(consts)) {
      const v = readFileSync(file, 'utf8').match(new RegExp(`export const ${name}\\s*=\\s*'([^']+)'`))?.[1]
      if (!v) violations.push(`${file} · 보호 이름 상수 ${name} 의 정의를 못 찾았다.`)
      else canonOf.set(v, { file, name })
    }
  }
  // 수납 폼은 같은 글자를 따로 적고 있다. 그 파일은 같은 날 현금영수증 작업이 고치는 중이라 이번에 손대지 않았다.
  // 그 작업을 합친 뒤 lib/incomeCategories OVERPAY_INCOME_CATEGORY 를 import 하고 이 줄을 지운다(2026-10-13).
  const PENDING_COPIES = { 'components/entity-modal/widgets/PaymentEntryForm.tsx': 'EXTRA_INCOME_CATEGORY' }
  // 글자만 같고 다른 칸에 쓰는 상수. 보증금 미반환 사유 목록의 '청소비' 항은 DepositRefund 사유이지 부가수익 카테고리가 아니다.
  const OTHER_MEANING = { 'lib/depositWithholdReasons.ts': 'CLEANING_WITHHOLD_REASON' }
  for (const p of SOURCES) {
    const code = stripComments(readFileSync(p, 'utf8'))
    for (const m of code.matchAll(/\bconst (\w+)\s*(?::[^=\n]*)?=\s*'([^']+)'/g)) {
      const canon = canonOf.get(m[2])
      if (!canon || (canon.file === p && canon.name === m[1]) || PENDING_COPIES[p] === m[1] || OTHER_MEANING[p] === m[1]) continue
      violations.push(`${p} · 보호 이름 '${m[2]}' 을 상수 ${m[1]} 로 따로 적었다. 정본(${canon.file} ${canon.name})을 import 해 한 벌로 쓴다.`)
    }
  }
  for (const [p, name] of Object.entries(PENDING_COPIES)) {
    if (!new RegExp(`\\bconst ${name}\\s*=\\s*'`).test(stripComments(readFileSync(p, 'utf8')))) {
      violations.push(`${p} · ${name} 사본이 이미 걷혔다. 이 그물의 PENDING_COPIES 에서 그 줄을 지운다.`)
    }
  }
}

// ⓘ 정규화 · 목록에 이름을 넣는 길은 전부 정본 정규화를 거친다.
{
  for (const m of actions.matchAll(/export async function (add\w+)\(/g)) {
    const b = bodyOf(actions, new RegExp(`export async function ${m[1]}\\(`))
    if (!b || !new RegExp(`\\b(${FIELD_RE})\\s*:[^\\n]*\\.join\\(','\\)`).test(b)) continue
    if (!/normalizeOptionName\(/.test(stripComments(b))) violations.push(`${ACTIONS} · ${m[1]} 가 목록에 넣는 이름을 normalizeOptionName 으로 정규화하지 않는다. 쉼표가 든 이름이 두 줄로 쪼개진다.`)
  }
  const note = bodyOf(actions, /export async function noteUnitsUsed\(/)
  if (!note || !/resolveUnitForSave\(/.test(note)) violations.push(`${ACTIONS} · noteUnitsUsed 가 단위 정본(resolveUnitForSave)을 안 거친다.`)
  {
    const b = bodyOf(actions, /export async function renameOption\(/)
    if (b && !/normalizeOptionName\(field, rawNewValue\)/.test(stripComments(b))) violations.push(`${ACTIONS} · renameOption 이 새 이름을 normalizeOptionName 으로 정규화하지 않는다.`)
  }
  for (const [fn, re] of [['optionListAfterRestore', /normalizeOptionName\(field, rawName\)/], ['optionListAfterResetUndo', /before\.map\(v => normalizeOptionName\(field, v\)\)/]]) {
    const b = bodyOf(lib, new RegExp(`export function ${fn}\\(`))
    if (!b || !re.test(stripComments(b))) violations.push(`${LIB} · ${fn} 가 화면을 거쳐 온 이름을 normalizeOptionName 으로 정규화하지 않는다.`)
  }
  // 그 글자를 쓰는 기록도 같은 정규화로 저장한다. 목록 글자와 기록 글자가 갈리면 이름 변경이 그 기록을 못 따라간다.
  // 자리가 새로 생기면 여기에 적는다(파일 · 기대 모양 · 최소 개수).
  const RECORD_NORMALIZERS = [
    ['app/(app)/rooms/actions.ts', /memo:\s+normalizeOptionName\('discountReasons', data\.memo\) \|\| null/g, 1, '할인 사유 memo'],
    ['components/entity-modal/widgets/DiscountWidget.tsx', /const why = normalizeOptionName\('discountReasons', reason\)/g, 1, '할인 위젯 사유'],
    ['app/(app)/tenants/actions.ts', /const job\s+= normalizeOptionName\('jobOptions', formData\.get\('job'\) as string\)/g, 2, '입주자 등록·수정 직업'],
    ['app/api/import/route.ts', /normalizeOptionName\('jobOptions', str\(row\['직업'\]\)\)/g, 3, '엑셀 가져오기 직업(비교·덮어쓰기·새로 만들기)'],
    ['app/api/import/preview/route.ts', /normalizeOptionName\('jobOptions', str\(row\['직업'\]\)\)/g, 1, '엑셀 가져오기 미리보기 직업'],
  ]
  // 창문 유형 표기 표는 정본 한 벌이다. 목록 이름 정규화와 엑셀 가져오기 두 경로가 같은 표(windowTypeCode)를 쓴다.
  // 표가 갈리면 '외창' 이 원값 OUTER 옆에 두 줄로 서거나 가져오기와 설정이 다른 원값을 고른다(3차 검수).
  {
    const n = bodyOf(lib, /export function normalizeOptionName\(/)
    if (!n || !/field === 'windowTypeOptions'\) return windowTypeCode\(name\) \?\? name/.test(n)) violations.push(`${LIB} · normalizeOptionName 이 창문 유형의 화면 이름(외창·내창)을 원값으로 접지 않는다.`)
    for (const p of ['app/api/import/route.ts', 'app/api/import/preview/route.ts']) {
      const code = stripComments(readFileSync(p, 'utf8'))
      if (/WINDOW_MAP\b|'외창'\s*:/.test(code) || !/windowTypeCode\(str\(row\['채광'\]\)\)/.test(code)) violations.push(`${p} · 창문 표기를 제 표로 읽는다. lib/optionLists 의 windowTypeCode 한 벌을 쓴다.`)
    }
  }
  for (const [p, re, min, what] of RECORD_NORMALIZERS) {
    const n = (stripComments(readFileSync(p, 'utf8')).match(re) ?? []).length
    if (n < min) violations.push(`${p} · ${what} 를 목록과 같은 정규화(normalizeOptionName)로 저장하지 않는다(${n}/${min}). 목록 글자와 기록 글자가 갈려 이름 변경이 그 기록을 못 따라간다.`)
  }
  for (const p of SOURCES) {
    const code = stripComments(readFileSync(p, 'utf8'))
    for (const m of code.matchAll(/\bjob:\s+(str\(row\['직업'\]\)|job\b(?! \|\| null)|data\.job|formData\.get\('job'\))/g)) {
      violations.push(`${p}:${code.slice(0, m.index).split('\n').length} · 입주자 직업을 정규화 없이 저장한다(${m[1]}). normalizeOptionName('jobOptions', …) 를 거친다.`)
    }
  }
  for (const m of form.matchAll(/const (handleAdd\w+) = async \(\) => \{\n\s*const v = ([^;\n]*);/g)) {
    if (!/^normalizeOptionName\('\w+', \w+\)$/.test(m[2])) violations.push(`${FORM} · ${m[1]} 가 화면 목록에 넣는 이름을 normalizeOptionName 으로 정규화하지 않는다. 화면과 저장 글자가 갈린다.`)
  }
  const rr = bodyOf(form, /const runRename = async \(/)
  if (rr && !/normalizeOptionName\(field, rawNew\)/.test(rr)) violations.push(`${FORM} · runRename 이 새 이름을 서버와 같은 정규화로 다듬지 않는다.`)
  // 다른 파일에서 목록 칸을 쓰는 자리. 새로 생기면 정규화를 거치게 하고 여기에 적는다.
  const EXTERNAL_LIST_WRITERS = {
    // 쇼핑몰 목록(2026-10-19)은 lib/channelOptions appendChannelOption 이 SQL 한 문장으로 쌓는다(정본 normalizeChannel 을 거친다).
    'app/(app)/finance/actions.ts': { expenseCategories: /resolveCategoryForSave\(/ },
    'app/(app)/tenants/actions.ts': { requestCategories: /resolveCategoryForSave\(/, incomeCategories: /(PENALTY_CATEGORY|parts\.map\(p => p\.category\))/ },
    'app/(app)/rooms/actions.ts': { incomeCategories: /CLEANING_FEE_CATEGORY\]\.join/ },
  }
  for (const p of SOURCES) {
    if (p === ACTIONS || p === LIB) continue
    const code = stripComments(readFileSync(p, 'utf8'))
    for (const m of code.matchAll(new RegExp(`data:\\s*\\{\\s*(${FIELD_RE})\\s*:`, 'g'))) {
      const rule = EXTERNAL_LIST_WRITERS[p]?.[m[1]]
      const line = code.slice(0, m.index).split('\n').length
      if (!rule) violations.push(`${p}:${line} · 목록 칸 ${m[1]} 을 여기서 쓴다. 정본 정규화(resolveCategoryForSave·normalizeOptionName)를 거치게 하고 이 그물의 EXTERNAL_LIST_WRITERS 에 적는다.`)
      else if (!rule.test(code)) violations.push(`${p}:${line} · ${m[1]} 을 쓰는 자리가 적어 둔 정규화 길을 잃었다.`)
    }
  }
}

// ⓙ 자동 추가는 새로 적은 값만 · 기존 기록을 고치는 update 함수는 이전 값과 견준다.
{
  for (const p of SOURCES.filter(p => /actions\.ts$/.test(p))) {
    const src = readFileSync(p, 'utf8')
    // 자동 추가 헬퍼 자체가 이전 값을 받아 견준다.
    for (const m of src.matchAll(/async function (resolve\w*CategoryForSave)\(/g)) {
      const b = bodyOf(src, new RegExp(`async function ${m[1]}\\(`))
      if (b && !/value !== prev/.test(b)) violations.push(`${p} · ${m[1]} 가 이전 값(prev)과 견주지 않는다. 목록에서 뺀 항목이 그 기록을 다시 저장할 때마다 되살아난다.`)
    }
    for (const m of src.matchAll(/export async function (update\w+)\(/g)) {
      const b = bodyOf(src, new RegExp(`export async function ${m[1]}\\(`))
      if (!b) continue
      const code = stripComments(b)
      for (const c of code.matchAll(/resolve\w*CategoryForSave\(([^)]*)\)/g)) {
        // 셋째 인자는 고치기 전 기록의 칸 그대로여야 한다(`existing?.category`·`before.category`). `?? 새 값` 따위로
        // 섞으면 이전 값이 없을 때 새로 적은 값까지 안 더해지거나, 견줄 값이 틀어진다.
        const prev = c[1].split(',')[2]?.trim() ?? ''
        if (!/^(existing|before)\??\.category$/.test(prev)) violations.push(`${p} · ${m[1]} 가 ${c[0].split('(')[0]} 에 고치기 전 카테고리를 그대로 넘기지 않는다(${prev || '없음'}). 뺀 카테고리가 그 기록을 저장할 때마다 되살아나거나 새 값이 안 더해진다.`)
      }
      for (const c of code.matchAll(/addJobOption\([^)]*\)/g)) {
        const line = code.slice(code.lastIndexOf('\n', c.index) + 1, c.index)
        if (!/!==\s*prev\w*/.test(line)) violations.push(`${p} · ${m[1]} 가 직업이 그대로여도 addJobOption 을 부른다. 목록에서 뺀 직업이 입주자 저장마다 되살아난다.`)
      }
      for (const c of code.matchAll(/\bnoteUnits(?:Used)?\(([^\n]*)\)/g)) {
        if (!/newUnitsOnly\(/.test(c[1])) violations.push(`${p} · ${m[1]} 가 원래 쓰던 단위까지 목록에 적립한다(newUnitsOnly 없음). 뺀 단위가 저장마다 되살아난다.`)
      }
    }
  }
}

// ⓚ 목록 서버 액션은 field 검사를 거친다.
{
  const guard = bodyOf(actions, /function assertOptionField\(/)
  if (!guard || !/isOptionListField\(field\)/.test(guard) || !/throw new Error/.test(guard)) {
    violations.push(`${ACTIONS} · assertOptionField 가 정본 표(isOptionListField)로 칸 이름을 막지 않는다.`)
  }
  const isField = bodyOf(lib, /export function isOptionListField\(/)
  if (!isField || !/Object\.hasOwn\(OPTION_LIST_DEFAULTS, v\)/.test(isField)) {
    violations.push(`${LIB} · isOptionListField 가 OPTION_LIST_DEFAULTS 자기 칸(Object.hasOwn)으로 거르지 않는다. 'toString' 같은 상속 이름이 지나간다.`)
  }
  let n = 0
  for (const m of actions.matchAll(/export async function (\w+)\((field|undo)\b/g)) {
    n++
    const b = bodyOf(actions, new RegExp(`export async function ${m[1]}\\(`))
    if (!b) continue
    const code = stripComments(b)
    const at = code.search(m[2] === 'undo' ? /assertOptionField\(undo\.field\)/ : /assertOptionField\(field\)/)
    const firstUse = Math.min(...[/prisma\./, /parseOptionList\(/, /RENAME_CASCADE\[/, /getPropertyId\(/]
      .map(re => { const i = code.search(re); return i < 0 ? Infinity : i }))
    if (at < 0 || at > firstUse) violations.push(`${ACTIONS} · ${m[1]} 가 무엇을 읽거나 쓰기 전에 assertOptionField 로 칸 이름을 보지 않는다. 편집 권한만 있으면 영업장 행 아무 칸에나 쓸 수 있다.`)
  }
  if (n < 7) violations.push(`${ACTIONS} · 칸 이름을 받는 목록 서버 액션을 ${n}개만 찾았다(초기화·순서·삭제 적용취소·초기화 적용취소·건수·이름 변경·이름 변경 적용취소, 7 이상 기대).`)
}

// ⓛ 사유 목록 셋.
{
  // 사유 고르는 자리와 그 자리가 쓰는 목록. 새 자리가 사유 목록 훅(useReasonOptions)을 쓰면 여기에 적는다.
  const ASK_SITES = {
    'components/entity-modal/widgets/TenantStatusTransitions.tsx': ['cancelReasons', 'checkoutReasons', 'withholdReasons'],
    'components/entity-modal/widgets/TenantStatusHistory.tsx': ['cancelReasons', 'checkoutReasons'],
    'app/(app)/tenants/TenantClient.tsx': ['cancelReasons', 'checkoutReasons', 'withholdReasons', 'dueDayReasons', 'visitRouteOptions'],
    'app/(app)/dashboard/DashboardClient.tsx': ['withholdReasons'],
    'components/entity-modal/widgets/DepositStatusPanel.tsx': ['withholdReasons'],
    // 2차(2026-10-22). 납부일 임시 조정 사유는 수납 정보 위젯과 입주자 상세 두 자리에서 고른다.
    'components/entity-modal/widgets/DueDayTempAdjustWidget.tsx': ['dueDayReasons'],
    // 소모품 폐기 사유(폐기 기록)·무상 입수 출처(등록·수정 같은 칸), 비품 폐기 사유(폐기·분실과 교체).
    'app/(app)/inventory/InventoryClient.tsx': ['stockDisposalReasons', 'stockSourceOptions'],
    'app/(app)/inventory/assets/AssetsClient.tsx': ['assetDisposalReasons'],
    // 청소 사유(예정 등록·사유 변경). 코드 셋이 맨 앞에 서고 그 뒤가 영업장 목록이다.
    'components/cleaning/CleaningPlanForm.tsx': ['cleaningReasons'],
    'components/cleaning/CleaningRowBody.tsx': ['cleaningReasons'],
  }
  const ASK_COUNT = {
    'components/entity-modal/widgets/TenantStatusTransitions.tsx': 2, 'components/entity-modal/widgets/TenantStatusHistory.tsx': 1,
    'app/(app)/tenants/TenantClient.tsx': 4, 'app/(app)/dashboard/DashboardClient.tsx': 1, 'components/entity-modal/widgets/DepositStatusPanel.tsx': 1,
    'components/entity-modal/widgets/DueDayTempAdjustWidget.tsx': 1,
    'app/(app)/inventory/InventoryClient.tsx': 3, 'app/(app)/inventory/assets/AssetsClient.tsx': 2,
    'components/cleaning/CleaningPlanForm.tsx': 1, 'components/cleaning/CleaningRowBody.tsx': 1,
  }
  for (const p of SOURCES) {
    const code = stripComments(readFileSync(p, 'utf8'))
    const at = i => code.slice(0, i).split('\n').length
    for (const m of code.matchAll(/\b(reasonsForStatus|CANCEL_REASONS|CHECKOUT_REASONS|WITHHOLD_REASONS|buildWithholdReason|buildReason|parseReason)\b/g)) {
      violations.push(`${p}:${at(m.index)} · 옛 사유 상수·규약 ${m[1]} 가 되살아났다. 목록은 영업장 설정(parseOptionList)이고 '기타' 규약은 lib/reasonLists 한 벌이다.`)
    }
    if (p !== 'lib/reasonLists.ts') {
      for (const m of code.matchAll(/`기타 · \$\{/g)) violations.push(`${p}:${at(m.index)} · '기타 · 글' 을 손으로 만든다. lib/reasonLists otherReason 한 벌을 쓴다.`)
    }
    if (/\buseReasonOptions\(/.test(code) && p !== 'components/ui/useReasonOptions.ts' && !ASK_SITES[p]) {
      violations.push(`${p} · 사유 목록을 읽는데 이 그물의 ASK_SITES 에 안 적혔다. 고르는 칸이 addMode="ask" 인지, 분류 관리 카드가 있는지 보고 적는다.`)
    }
  }
  for (const [p, fields] of Object.entries(ASK_SITES)) {
    const code = stripComments(readFileSync(p, 'utf8'))
    const n = (code.match(/<CategorySelect addMode="ask"/g) ?? []).length
    if (n < ASK_COUNT[p]) violations.push(`${p} · 사유 고르는 칸이 CategorySelect addMode="ask" 로 ${n}곳이다(${ASK_COUNT[p]} 기대). 맨 select 로 그리면 '목록에 추가' 가 빠지고 목록 밖 저장 글자가 빈 칸으로 뜬다.`)
    if (/<select[^>]*value=\{(withholdReason|transReason|recReason|depoWithholdReason|cancelReasonVal|reason|sel)\}/.test(code)) violations.push(`${p} · 사유를 맨 select 로 고른다. CategorySelect addMode="ask" 를 쓴다.`)
    for (const f of fields) if (!cardFields.has(f)) violations.push(`${p} · 사유 칸이 '목록 관리는 환경설정 > 분류 관리' 라고 말하는데 ${f} 카드가 없다.`)
  }
  // 고르는 칸의 정본 모양: 체크 기본 꺼짐, '기타(직접 입력)' 맨 끝, 목록 밖 저장 글자는 그 글자 그대로 한 줄, 저장 글자 숨은 칸.
  {
    const cs = stripComments(readFileSync('components/ui/CategorySelect.tsx', 'utf8'))
    const ask = cs.slice(cs.indexOf("if (addMode === 'ask')"), cs.indexOf('const isInOptions'))
    if (!/const \[ownAdd, setOwnAdd\] = useState\(addMode === 'auto'\)/.test(cs)) violations.push(`components/ui/CategorySelect.tsx · '목록에 추가' 체크의 기본이 사유(ask) 꺼짐·저절로 쌓던 목록(auto) 켜짐이 아니다(운영자 결정 2).`)
    if (!/reasonPickOf\(value, options\)/.test(ask) || !/pick\.kind === 'legacy' && <option value=\{pick\.value\}>\{getLabel\(pick\.value\)\}/.test(ask)) violations.push(`components/ui/CategorySelect.tsx · ask 칸이 저장 글자를 reasonPickOf 로 읽지 않거나 목록 밖 글자를 그대로 세우지 않는다. 뺀 항목·옛 이름이 빈 칸으로 뜨고 저장하면 지워진다.`)
    // 목록 항목 덩이(items)의 맨 끝이 '기타(직접 입력)' 이고, 그 덩이가 select 의 맨 끝에 선다(묶음 optgroup 으로 싸도 끝이다, 2026-10-22 2차).
    // 보이는 글자는 getLabel(기본 값 그대로), 값은 저장 글자다(청소 사유 코드를 고정 라벨로 보여 준다).
    if (!/options\.map\(o => <option key=\{o\} value=\{o\}>\{getLabel\(o\)\}<\/option>\)\}\s*<option value="__custom__">기타\(직접 입력\)<\/option>\s*<\/>/.test(ask)
      || !/getLabel = \(v: string\) => v,/.test(cs)
      || !/\{groupLabel \? <optgroup label=\{groupLabel\}>\{items\}<\/optgroup> : items\}\s*<\/select>/.test(ask)) violations.push(`components/ui/CategorySelect.tsx · ask 칸의 '기타(직접 입력)' 이 목록 맨 끝 고정 항목이 아니다.`)
    if (!/onChange\(otherReason\(/.test(ask)) violations.push(`components/ui/CategorySelect.tsx · ask 칸의 직접 입력이 lib/reasonLists otherReason 으로 저장 글자를 만들지 않는다.`)
    if ((ask.match(/name && <input type="hidden" name=\{name\} value=\{value\} \/>/g) ?? []).length < 2) violations.push(`components/ui/CategorySelect.tsx · ask 칸이 FormData 에 저장 글자를 싣지 않는다(입력칸 글만 실리면 '기타 · ' 가 빠진다).`)
  }
  // 사유를 저장하는 서버 경로는 영업장 목록으로 다시 재고(reasonForSave), 기록이 선 뒤에 목록에 더한다(commit).
  const SAVE_PATHS = [
    ['app/(app)/tenants/actions.ts', 'updateTenant'], ['app/(app)/tenants/actions.ts', 'applyStatusTransition'],
    ['app/(app)/tenants/actions.ts', 'recordDepositReturn'], ['app/(app)/rooms/actions.ts', 'updateStatusLogReason'],
    ['app/(app)/rooms/actions.ts', 'setDueDayOverride'],
    ['app/(app)/inventory/actions.ts', 'createStockDisposal'], ['app/(app)/inventory/actions.ts', 'createStockAddition'],
    ['app/(app)/inventory/actions.ts', 'updateStockAddition'], ['app/(app)/inventory/assets/actions.ts', 'disposeAssets'],
    ['app/(app)/inventory/assets/actions.ts', 'assignAggregateToTarget'],
    ['app/(app)/room-manage/cleaningActions.ts', 'createCleaning'], ['app/(app)/room-manage/cleaningActions.ts', 'changeCleaningReason'],
  ]
  // 방문 경로(2차). 계약을 만드는 두 자리와 고치는 자리가 모두 visitRouteForSave(목록으로 다시 재기)를 거치고 기록 뒤에 목록에 더한다.
  // 폼 글자를 그대로 적는 길(visitRoute || null)이 되살아나면 목록 밖 글이 맨 글자로 남는다.
  {
    const ta = stripComments(readFileSync('app/(app)/tenants/actions.ts', 'utf8'))
    for (const fn of ['addTenant', 'addLeaseToTenant', 'updateTenant']) {
      const b = bodyOf(ta, new RegExp(`export async function ${fn}\\(`)) ?? ''
      if (!/visitRouteForSave\(propertyId, formData/.test(b) || !/\.commit\(\)/.test(b)) violations.push(`app/(app)/tenants/actions.ts · ${fn} 가 방문 경로를 영업장 목록으로 다시 재지(visitRouteForSave) 않거나 목록 추가를 기록 뒤로 미루지 않는다.`)
    }
    if (!/visitRouteForSave\(propertyId, formData, currentLease\.visitRoute\)/.test(ta)) violations.push(`app/(app)/tenants/actions.ts · 입주자 수정이 지금 방문 경로(prev)를 넘기지 않는다. 종전 자유 입력 경로에 기타 · 가 붙는다.`)
    if (/visitRoute: visitRoute \|\| null|formData\.get\('visitRoute'\) as string\b(?! \| null)/.test(ta)) violations.push(`app/(app)/tenants/actions.ts · 방문 경로를 폼 글자 그대로 적는 길이 되살아났다.`)
    const vr = bodyOf(ta, /async function visitRouteForSave\(/) ?? ''
    if (!/reasonForSave\(propertyId, 'visitRouteOptions', formData\.get\('visitRoute'\) as string \| null, \{\s*addToList: formData\.get\('visitRouteAddToList'\) === '1', prev,/.test(vr)) violations.push(`app/(app)/tenants/actions.ts · visitRouteForSave 가 방문 경로 목록·체크(visitRouteAddToList)·지금 값으로 재지 않는다.`)
  }
  for (const [p, fn] of SAVE_PATHS) {
    const b = bodyOf(readFileSync(p, 'utf8'), new RegExp(`export async function ${fn}\\(`))
    if (!b) { violations.push(`${p} · ${fn} 를 못 찾았다.`); continue }
    const code = stripComments(b)
    if (!/reasonForSave\(/.test(code) || !/\.commit\(\)/.test(code)) violations.push(`${p} · ${fn} 가 사유를 영업장 목록으로 다시 재지(reasonForSave) 않거나 목록 추가를 기록 뒤로 미루지(commit) 않는다. 목록 밖 글이 목록 항목인 척 남는다.`)
  }
  // 퇴실 예정에서 퇴실로 갈 때 이어받은 사유는 지금 값이다(목록에서 뺐어도 '기타 · ' 를 안 붙인다, 독립 검수 R1).
  {
    const ta = readFileSync('app/(app)/tenants/actions.ts', 'utf8')
    for (const fn of ['updateTenant', 'applyStatusTransition']) {
      const b = stripComments(bodyOf(ta, new RegExp(`export async function ${fn}\\(`)) ?? '')
      if (!/const reasonPrev = [^\n]*'CHECKED_OUT'[^\n]*'CHECKOUT_PENDING'[\s\S]{0,40}latestCheckoutReasonFor\(prisma, /.test(b) || !/prev: reasonPrev \}/.test(b)) {
        violations.push(`app/(app)/tenants/actions.ts · ${fn} 가 퇴실 예정에서 퇴실로 갈 때 이어받은 사유를 지금 값(prev)으로 넘기지 않는다. 목록에서 뺀 사유가 '기타 · ' 로 바뀐다.`)
      }
    }
  }
  // 상태 이력 사유 되돌리기는 서명 토큰으로만(독립 검수 N1). 화면이 보낸 글을 재지 않고 쓰는 길(restore)이 없다.
  {
    const ra = readFileSync('app/(app)/rooms/actions.ts', 'utf8')
    const u = stripComments(bodyOf(ra, /export async function undoStatusLogReason\(/) ?? '')
    if (!/verifyUndoBody\(STATUS_LOG_REASON_UNDO_DOMAIN, propertyId, /.test(u) || !/reason: body\.next \}/.test(u)) violations.push(`app/(app)/rooms/actions.ts · undoStatusLogReason 가 서명(verifyUndoBody)과 지금 값(next) 대조로 막지 않는다. 아무 글이나 사유로 남길 수 있다.`)
    if (/\brestore\b/.test(stripComments(bodyOf(ra, /export async function updateStatusLogReason\(/) ?? ''))) violations.push(`app/(app)/rooms/actions.ts · updateStatusLogReason 에 재지 않고 쓰는 길(restore)이 되살아났다.`)
  }
  // 목록을 고치는 다른 입구도 '기타'·시스템 라벨을 막는다(독립 검수 N2). 순서 저장은 지금 목록과 같은 이름 집합만.
  {
    const RES = {
      reorderOptions: [/reservedOptionNameError\(field, v\)/, /!sameNameSet\(items, now\)/],
      restoreOption: [/reservedOptionNameError\(field, r\.name\)/],
      undoResetOptions: [/reservedOptionNameError\(field, v\)/],
      // 새 이름 쪽도 본다. 빠지면 위조 표가 청소 코드·시스템 라벨 행을 옛 이름 글자로 바꾼다(2차 독립 검수 B1).
      undoRenameOption: [/reservedOptionNameError\(field, oldValue\)/, /reservedOptionNameError\(field, newValue\)/],
    }
    for (const [fn, res] of Object.entries(RES)) {
      const b = stripComments(bodyOf(actions, new RegExp(`export async function ${fn}\\(`)) ?? '')
      for (const re of res) if (!re.test(b)) violations.push(`${ACTIONS} · ${fn} 가 사유 목록에 '기타'·시스템 라벨을 넣는 것을 막지 않는다(${re.source.replace(/\\/g, '').slice(0, 40)} 없음).`)
    }
  }
  // 목록 추가는 원자적으로(영업장 행 잠금 뒤 읽고 쓰기, 독립 검수 N4).
  {
    const rs = stripComments(readFileSync('lib/reasonListSave.ts', 'utf8'))
    if (!/prisma\.\$transaction\(async tx => \{\s*await tx\.\$queryRaw`SELECT 1 FROM "properties" WHERE "id" = \$\{propertyId\}::uuid FOR UPDATE`/.test(rs)) violations.push(`lib/reasonListSave.ts · 목록 추가가 영업장 행을 잠그지 않고 읽고 쓴다. 두 저장이 동시에 더하면 한쪽이 지워진다.`)
  }
  {
    const b = bodyOf(readFileSync('app/(app)/rooms/actions.ts', 'utf8'), /export async function updateStatusLogReason\(/)
    if (b && !/reasonForSave\([^)]*prev: row\.reason \}\)/.test(stripComments(b))) violations.push(`app/(app)/rooms/actions.ts · 상태 이력 사유 수정이 지금 값(prev)을 넘기지 않는다. 목록에서 뺀 사유를 그대로 저장해도 '기타 · ' 가 붙는다.`)
  }
  // 이어받기 판정은 시스템 라벨 집합으로 한다. 목록으로 재면 영업장마다 답이 갈린다.
  {
    const cr = stripComments(readFileSync('lib/checkoutReason.ts', 'utf8'))
    if (!/isSystemStatusReason\(/.test(cr) || /parseOptionList|OPTION_LIST_DEFAULTS/.test(cr)) violations.push(`lib/checkoutReason.ts · 퇴실 사유 이어받기가 시스템 라벨 집합(isSystemStatusReason)으로 거르지 않고 목록으로 잰다.`)
  }
  // 이름 변경: 상태 이력은 toStatus 로 나누고, 미반환은 미반환 기록만(부가수익 상세 문장은 그때의 기록).
  {
    if (!/cancelReasons:\s*\[\{ model: 'tenantStatusLog', column: 'reason', statuses: REASON_FIELD_STATUSES\.cancelReasons \}\]/.test(actions)
      || !/checkoutReasons:\s*\[\{ model: 'tenantStatusLog', column: 'reason', statuses: REASON_FIELD_STATUSES\.checkoutReasons, selfStatuses: REASON_FIELD_SELF_STATUSES\.checkoutReasons \}\]/.test(actions)) {
      violations.push(`${ACTIONS} · RENAME_CASCADE 의 취소·퇴실 사유가 상태 이력을 toStatus(REASON_FIELD_STATUSES)로 나누지 않는다. 같은 글자의 다른 사유까지 바뀐다.`)
    }
    if (!/withholdReasons:\s*\[\{ model: 'depositRefund', column: 'reason' \}\]/.test(actions)) violations.push(`${ACTIONS} · RENAME_CASCADE 의 미반환 사유가 미반환 기록(DepositRefund.reason) 하나만 따라가지 않는다.`)
    const w = bodyOf(lib, /export function optionRenameWhere\(/)
    if (!w || !/else if \(t\.statuses\) where\.toStatus = \{ in: \[\.\.\.t\.statuses\] \}/.test(w)) violations.push(`${LIB} · optionRenameWhere 가 statuses 를 toStatus 조건으로 싣지 않는다.`)
    // '그날 바꾸기' 행(거주중 그대로 + 퇴실 사유)도 퇴실 사유 이름 변경이 따라간다(독립 검수 N3).
    if (!w || !/where\.OR = \[\{ toStatus: \{ in: \[\.\.\.t\.statuses\] \} \}, \.\.\.t\.selfStatuses\.map\(s => \(\{ fromStatus: s, toStatus: s \}\)\)\]/.test(w)) violations.push(`${LIB} · optionRenameWhere 가 상태가 안 바뀐 행(selfStatuses)을 고르지 않는다. 퇴실 예정 '그날 바꾸기' 행의 사유가 이름 변경에서 빠진다.`)
  }
  // 목록에 못 넣는 이름은 손 추가·이름 변경·화면 추가가 같은 문으로 막는다.
  {
    for (const fn of ['addReasonOption', 'renameOption']) {
      const b = bodyOf(actions, new RegExp(`(?:export )?async function ${fn}\\(`))
      if (!b || !/reservedOptionNameError\(field, (name|newValue)\)/.test(stripComments(b))) violations.push(`${ACTIONS} · ${fn} 가 '기타'·시스템 라벨을 목록에 넣는 것을 막지(reservedOptionNameError) 않는다.`)
    }
    // 화면은 추가 칸·이름 편집 칸에서 같은 함수로 인라인으로 막는다(중복과 같은 자리·모양, 등록·저장 버튼 끔, 독립 검수).
    const osb = stripComments(bodyOf(form, /function OptionSection\(/) ?? '')
    if (!/const addError = isDuplicate \? '이미 존재하는 항목입니다\.' : \(trimmed !== '' \? reservedOptionNameError\(field, trimmed\) : null\)/.test(osb)
      || !/disabled=\{isAdding \|\| !trimmed \|\| !!addError\}/.test(osb) || !/\?\? \(editName !== '' && editName !== editingItem \? reservedOptionNameError\(field, editName\) : null\)/.test(osb)) {
      violations.push(`${FORM} · OptionSection 이 '기타'·시스템 라벨을 추가·이름 편집 칸에서 인라인으로 막지 않는다. 눌러 보고서야 거절당한다.`)
    }
  }
}

// ⓜ 카드 행이 좁은 폭·큰 글자에서 넘치지 않는다(2026-10-22 실측: 320·360px x 125% 에서 수정·삭제·초기화가 카드 밖으로 나갔다).
// 행과 머리는 꺾이고(flex-wrap), 라벨은 최소 4rem(6rem 이면 360px 100% 에서도 행이 전부 두 줄로 꺾였다), 라벨 뒤 묶음은 ml-auto 로 다음 줄 오른쪽에 서며, 등록 칸은 min-w-0 이다.
{
  const code = stripComments(os ?? '')
  const NEED = [
    [/<div key=\{item\} className=\{`flex flex-wrap items-center gap-2 /, '행 flex-wrap'],
    [/className="flex-1 min-w-\[4rem\] basis-\[4rem\] /, '라벨 최소 4rem'],
    [/<div className="ml-auto flex items-center gap-2 shrink-0">/, '라벨 뒤 묶음 ml-auto'],
    [/<div className="flex flex-wrap items-start justify-between gap-x-2 gap-y-1 mb-1">/, '머리 flex-wrap'],
    [/className=\{`flex-1 min-w-0 bg-\[var\(--canvas\)\] border rounded-sm px-3 py-2\.5/, '등록 칸 min-w-0'],
  ]
  for (const [re, what] of NEED) if (!re.test(code)) violations.push(`${FORM} · OptionSection ${what} 가 빠졌다. 320·360px x 글자 125% 에서 단추가 카드 밖으로 나간다.`)
}

// ⓝ 2차 목록 여섯(2026-10-22 운영자 승인 '추천대로'): 기타 규약 칸·이름 변경 범위·칸 이름으로 한 벌인 저장 검증·묶음 머리·카드 손놀림.
{
  const SECOND = ['dueDayReasons', 'cleaningReasons', 'stockDisposalReasons', 'stockSourceOptions', 'assetDisposalReasons', 'visitRouteOptions']
  // 정본 기본값의 항목 수(글자 배열로 적힌 칸만). 못 읽으면 -1.
  const OPTION_LIST_DEFAULTS_LEN = f => {
    const m = (defaultsBlock?.[1] ?? '').match(new RegExp(`^\\s{2}${f}:\\s*(\\[[^\\n]*\\])`, 'm'))
    return m ? [...m[1].matchAll(/'([^']+)'/g)].length : -1
  }
  const reasonBlock = lib.match(/export const REASON_LIST_FIELDS = \[([\s\S]*?)\] as const/)?.[1] ?? ''
  for (const f of SECOND) {
    if (!reasonBlock.includes(`'${f}'`)) violations.push(`${LIB} · ${f} 가 기타 규약 칸(REASON_LIST_FIELDS)에 없다. 서버가 목록 밖 글을 맨 글자로 남기고 '기타'·코드 꼴 이름이 목록에 들어간다.`)
  }
  // 이름 변경이 따라가는 기록. 재고 기록 둘은 propertyId 가 없어 추적 품목으로 거른다(via: 'trackedItem'). 빼면 실행 오류이거나 남의 영업장 기록까지 바뀐다.
  const CASCADE = {
    dueDayReasons: /dueDayReasons:\s*\[\{ model: 'leaseTerm', column: 'overrideDueDayReason' \}\]/,
    visitRouteOptions: /visitRouteOptions:\s*\[\{ model: 'leaseTerm', column: 'visitRoute' \}\]/,
    cleaningReasons: /cleaningReasons:\s*\[\{ model: 'roomCleaning', column: 'reason' \}\]/,
    stockDisposalReasons: /stockDisposalReasons:\s*\[\{ model: 'stockDisposal', column: 'reason', via: 'trackedItem' \}\]/,
    stockSourceOptions: /stockSourceOptions:\s*\[\{ model: 'stockAddition', column: 'source', via: 'trackedItem' \}\]/,
    assetDisposalReasons: /assetDisposalReasons:\s*\[\{ model: 'expense', column: 'disposalReason' \}\]/,
  }
  for (const [f, re] of Object.entries(CASCADE)) {
    if (!re.test(actions)) violations.push(`${ACTIONS} · RENAME_CASCADE.${f} 가 그 목록을 쓰는 기록 칸(영업장 범위 포함)을 그대로 쥐지 않는다.`)
  }
  const w = bodyOf(lib, /export function optionRenameWhere\(/)
  if (!w || !/t\.via === 'trackedItem'\s*\?\s*\{ trackedItem: \{ propertyId \}, \[t\.column\]: value \}/.test(w)) {
    violations.push(`${LIB} · optionRenameWhere 가 추적 품목(trackedItem)으로 영업장을 거르는 갈래를 잃었다. 재고 기록 이름 변경이 남의 영업장까지 간다.`)
  }
  // 저장 검증과 지금 목록은 칸 이름으로 한 벌(REASON_LIST_SELECT)이다. 세 칸만 손으로 적은 select 가 되살아나면 2차 칸이 늘 기본값으로 읽힌다.
  const rs = stripComments(readFileSync('lib/reasonListSave.ts', 'utf8'))
  if (!/export const REASON_LIST_SELECT = \{/.test(rs) || !/satisfies Record<ReasonListField, true>/.test(rs) || !/select: REASON_LIST_SELECT \}\)/.test(rs)) {
    violations.push(`lib/reasonListSave.ts · reasonForSave 가 칸 이름으로 고르는 한 벌(REASON_LIST_SELECT, ReasonListField 전부)을 안 쓴다.`)
  }
  if (/select: \{ cancelReasons: true, checkoutReasons: true, withholdReasons: true \}/.test(rs + stripComments(actions))) {
    violations.push(`사유 칸 셋만 손으로 고르는 select 가 되살아났다. 2차 칸을 못 읽는다. REASON_LIST_SELECT 를 쓴다.`)
  }
  if (!/select: REASON_LIST_SELECT/.test(bodyOf(actions, /async function reasonListNow\(/) ?? '')) violations.push(`${ACTIONS} · reasonListNow 가 REASON_LIST_SELECT 로 읽지 않는다.`)
  // 묶음 머리 다섯이 이 차례로 서고, 카드는 제 묶음 아래에 선다(가이드 §22 분류 관리 묶음 머리).
  const GROUPS = {
    '호실': ['roomTypeOptions', 'roomTierOptions', 'windowTypeOptions', 'directionOptions'],
    '입주자': ['jobOptions', 'visitRouteOptions', 'cancelReasons', 'checkoutReasons', 'requestCategories'],
    '돈': ['discountReasons', 'dueDayReasons', 'withholdReasons', 'incomeCategories', 'expenseCategories', 'paymentMethods', 'channelOptions'],
    '청소·작업': ['cleaningReasons', 'workKindOptions'],
    '재고·비품': ['stockDisposalReasons', 'stockSourceOptions', 'assetDisposalReasons', 'qtyUnitOptions', 'specUnitOptions'],
  }
  const tab = form.slice(form.indexOf("{tab === 'options' && ("), form.indexOf("{tab === 'pricing' && ("))
  const heads = [...tab.matchAll(/<OptionGroupHead title="([^"]+)" \/>/g)].map(m => ({ title: m[1], at: m.index }))
  if (heads.map(h => h.title).join('|') !== Object.keys(GROUPS).join('|')) {
    violations.push(`${FORM} · 분류 관리 묶음 머리가 '${Object.keys(GROUPS).join(' / ')}' 차례가 아니다(지금 '${heads.map(h => h.title).join(' / ')}').`)
  }
  const want = Object.entries(GROUPS).flatMap(([g, fs]) => fs.map(f => [f, g]))
  for (const m of tab.matchAll(/<OptionSection[\s\S]*?\n\s*field="(\w+)"/g)) {
    const head = heads.filter(h => h.at < m.index).at(-1)?.title
    const g = Object.fromEntries(want)[m[1]]
    if (head !== g) violations.push(`${FORM} · ${m[1]} 카드가 '${g ?? '(묶음 표에 없음)'}' 묶음이 아니라 '${head ?? '(머리 앞)'}' 아래에 선다.`)
  }
  if (want.length !== FIELDS.length) violations.push(`scripts/check-option-lists.mjs · ⓝ 묶음 표가 목록 ${FIELDS.length}칸 중 ${want.length}칸만 적었다. 새 목록은 묶음을 정해 여기 적는다.`)
  // 카드 제목은 h3, 묶음 머리는 h2 다(제목 차례).
  if (os && !/<h3 className="min-w-0 text-sm font-semibold text-\[var\(--warm-dark\)\]">\{title\}<\/h3>/.test(os)) violations.push(`${FORM} · OptionSection 카드 제목이 h3 이 아니다. 묶음 머리(h2) 아래 제목 차례가 깨진다.`)
  // 2차 고르는 자리 배선. 서버는 지금 값(prev)과 '목록에 추가' 체크를 받아 영업장 목록으로 다시 재고(reasonForSave) 기록 뒤에 목록에 더한다(commit).
  // 화면은 저장 글자를 다듬지 않고 보낸다(끝 공백을 걷으면 글 없는 '기타 · ' 가 '기타 ·' 가 돼 '기타 · 기타 ·' 로 남는다).
  const WIRING2 = [
    ['app/(app)/rooms/actions.ts', /reasonForSave\(propertyId, 'dueDayReasons', reason, \{ addToList: opts\.addToList === true, prev: lease\.overrideDueDayReason \}\)/, '납부일 임시 조정 저장이 지금 사유(prev)와 체크를 넘겨 다시 재지 않는다'],
    ['components/entity-modal/widgets/DueDayTempAdjustWidget.tsx', /setDueDayOverride\(leaseTermId, overrideMonth, val, reason \|\| undefined, \{ addToList: reasonToList \}\)/, '수납 정보 납부일 임시 조정이 체크를 안 넘기거나 사유를 다듬어 보낸다'],
    ['app/(app)/tenants/TenantClient.tsx', /setDueDayOverride\(leaseId, targetMonth, val, reason, \{ addToList \}\)/, '입주자 상세 납부일 임시 조정이 체크를 안 넘긴다'],
    // 재고·비품. 무상 입수 수정은 지금 출처(prev)로 재서 종전 자유 입력 글자('522호 이경호님')를 그대로 둔다. 메모는 사유가 아니라 메모 그대로다.
    ['app/(app)/inventory/actions.ts', /reasonForSave\(propertyId, 'stockSourceOptions', data\.source, \{ addToList: data\.addSourceToList === true, prev: a\.source \}\)/, '무상 입수 수정이 지금 출처(prev)를 넘겨 다시 재지 않는다(옛 자유 입력 출처에 기타 · 가 붙는다)'],
    ['app/(app)/inventory/actions.ts', /reasonForSave\(propertyId, 'stockDisposalReasons', data\.reason, \{ addToList: data\.addReasonToList === true \}\)[\s\S]{0,400}memo: data\.memo \|\| null/, '소모품 폐기가 사유를 다시 재지 않거나 메모를 사유 규약에 태운다'],
    ['app/(app)/inventory/assets/actions.ts', /disposedAt: when, disposalReason: reasonSave\.reason/, '비품 폐기가 다시 잰 사유를 쓰지 않는다'],
    ['app/(app)/inventory/assets/actions.ts', /disposalReason: replaceReason\?\.reason \?\? null/, '비품 교체가 다시 잰 사유를 쓰지 않는다'],
    ['app/(app)/inventory/InventoryClient.tsx', /addSourceToList: sourceToList/, '무상 입수 등록·수정이 체크를 넘기지 않는다'],
    ['app/(app)/inventory/InventoryClient.tsx', /addReasonToList: reasonToList/, '폐기 기록이 체크를 넘기지 않는다'],
    ['app/(app)/inventory/assets/AssetsClient.tsx', /\{ addReasonToList: dispose\.toList \}/, '비품 폐기·분실이 체크를 넘기지 않는다'],
    ['app/(app)/inventory/assets/AssetsClient.tsx', /groupLabel="교체 · 같은 수량만큼 폐기로 기록"/, '비품 교체 칸이 교체 묶음(optgroup)을 잃었다'],
    // 청소 사유. 서버가 다시 재고(종전에는 화면 글자를 그대로 적었다), 사유 변경은 지금 값(prev)으로 잰다. 부담 표식 판정 줄은 입력 그대로 본다.
    ['app/(app)/room-manage/cleaningActions.ts', /reasonForSave\(propertyId, 'cleaningReasons', input\.reason, \{ addToList: input\.addReasonToList === true \}\)[\s\S]{0,300}reason: reasonSave\.reason,/, '청소 예정 등록이 사유를 다시 재지 않는다'],
    ['app/(app)/room-manage/cleaningActions.ts', /if \(cur\.fromCleaningFund && input\.reason !== 'CHECKOUT'\) \{[\s\S]{0,300}reasonForSave\(propertyId, 'cleaningReasons', input\.reason, \{ addToList: input\.addToList === true, prev: cur\.reason \}\)/, '청소 사유 변경이 부담 표식 판정 뒤 지금 값(prev)으로 다시 재지 않는다'],
    // 고르는 칸: 코드 셋 맨 앞 + 영업장 목록, 보이는 글자는 라벨 함수 한 벌. 코랄 채움 칩(§03 위반)은 걷었다.
    ['components/cleaning/CleaningPlanForm.tsx', /options=\{reasonOptions\} getLabel=\{cleaningReasonLabel\}/, '청소 예정 폼 사유 칸이 코드 셋·목록을 라벨 함수로 보여 주지 않는다'],
    ['components/cleaning/CleaningPlanForm.tsx', /const reasonOptions = \[\.\.\.CLEANING_REASON_CODES, \.\.\.listedReasons\]/, '청소 예정 폼 사유 칸이 코드 셋을 맨 앞에 두지 않는다'],
    ['components/cleaning/CleaningRowBody.tsx', /options=\{\[\.\.\.CLEANING_REASON_CODES, \.\.\.listedReasons\]\} getLabel=\{cleaningReasonLabel\}/, '청소 사유 변경 칸이 예정 폼과 같은 칸이 아니다'],
    ['components/cleaning/CleaningRowBody.tsx', /\{cleaningReasonLabel\(r\.reason\)\}/, '청소 행이 사유를 라벨 함수로 읽지 않는다(목록 이름·기타 · 글이 빈 칸으로 선다)'],
    ['lib/moveCalendarData.ts', /const label = cleaningReasonLabel\(reason\)/, '캘린더가 청소 사유를 라벨 함수로 읽지 않는다'],
    // 사유 칸 접근 이름·포커스·높이(2차 독립 검수). 맨 select·글자칸이 CategorySelect 로 바뀌며 이름(label htmlFor·aria-label·placeholder)이 사라졌다.
    ['components/ui/CategorySelect.tsx', /(?:[\s\S]*?id=\{id\} aria-label=\{ariaLabel\}){4}/, 'CategorySelect 가 접근 이름(id·ariaLabel)을 고르는 칸·직접 입력 칸 넷 모두에 걸지 않는다'],
    ['components/ui/CategorySelect.tsx', /autoFocus=\{customMode\}/, "auto 칸이 목록 밖 값으로 열려도 커서를 끌어와 모바일 키보드를 띄운다('기타(직접 입력)' 을 방금 골랐을 때만 둔다)"],
    ['components/work/RoomWorkPlanForm.tsx', /htmlFor=\{`\$\{uid\}-kind`\}>작업 종류<\/label>[\s\S]{0,80}id=\{`\$\{uid\}-kind`\} ariaLabel=\{dense \? '작업 종류' : undefined\}/, '작업 예정 폼 종류 칸이 라벨(htmlFor)·dense 이름을 잃었다'],
    ['components/cleaning/CleaningPlanForm.tsx', /htmlFor=\{`\$\{uid\}-reason`\}>사유<\/label>[\s\S]{0,400}id=\{`\$\{uid\}-reason`\} ariaLabel=\{dense \? '청소 사유' : undefined\}/, '청소 예정 폼 사유 칸이 라벨(htmlFor)·dense 이름을 잃었다'],
    ['components/cleaning/CleaningRowBody.tsx', /ariaLabel="청소 사유"/, '청소 사유 변경 칸이 접근 이름을 잃었다'],
    ['components/entity-modal/widgets/DueDayTempAdjustWidget.tsx', /ariaLabel="납부일 조정 사유"[\s\S]{0,300}className="w-full h-\[calc\(2rem\+2px\)\]/, '수납 정보 납부일 사유 칸이 접근 이름이나 옆 칸과 같은 높이를 잃었다'],
    ['app/(app)/tenants/TenantClient.tsx', /ariaLabel="납부일 조정 사유"[\s\S]{0,800}className="w-full h-\[calc\(2rem\+2px\)\]/, '입주자 상세 납부일 사유 칸이 접근 이름이나 옆 칸과 같은 높이를 잃었다'],
    ['app/(app)/tenants/TenantClient.tsx', /<div className="col-span-2 space-y-1\.5 min-w-0">\s*<label htmlFor=\{`visitRoute-\$\{formUid\}`\}[\s\S]{0,300}id=\{`visitRoute-\$\{formUid\}`\}/, '방문 경로 칸이 전폭(col-span-2)·라벨(htmlFor)을 잃었다(반폭이면 직접 입력 칸이 67px 로 준다)'],
    ['app/(app)/inventory/InventoryClient.tsx', /ariaLabel="출처"/, '무상 입수 수정 출처 칸이 접근 이름을 잃었다'],
    ['app/(app)/inventory/InventoryClient.tsx', /<label htmlFor=\{reasonFieldId\}[^>]*>사유<\/label>\s*<CategorySelect [^\n]*id=\{reasonFieldId\}/, '소모품 폐기 사유 칸이 라벨(htmlFor)을 잃었다'],
    ['app/(app)/inventory/InventoryClient.tsx', /<label htmlFor=\{sourceFieldId\}[^>]*>출처<\/label>\s*<CategorySelect [^\n]*id=\{sourceFieldId\}/, '무상 입수 등록 출처 칸이 라벨(htmlFor)을 잃었다'],
    // dense 칸 포커스 링은 --tc-text(§12). 빠지면 '기타' 를 고른 순간 브라우저 기본 파란 링이 선다.
    ['components/cleaning/CleaningPlanForm.tsx', /\? 'w-full [^']*px-2 py-1 text-xs text-\[var\(--warm-dark\)\] outline-none focus:ring-2 focus:ring-\[var\(--tc-text\)\]\/30'/, '청소 예정 폼 dense 칸의 포커스 링이 --tc-text 가 아니다'],
    ['components/work/RoomWorkPlanForm.tsx', /\? 'w-full [^']*px-2 py-1 text-xs text-\[var\(--warm-dark\)\] outline-none focus:ring-2 focus:ring-\[var\(--tc-text\)\]\/30'/, '작업 예정 폼 dense 칸의 포커스 링이 --tc-text 가 아니다'],
    ['components/cleaning/CleaningRowBody.tsx', /dense="xs"[\s\S]{0,300}text-xs text-\[var\(--warm-dark\)\] outline-none focus:ring-2 focus:ring-\[var\(--tc-text\)\]\/30" \/>/, '청소 사유 변경 칸의 포커스 링이 --tc-text 가 아니다'],
    // 손대지 않은 사유 저장은 닫기만 한다("'기타' → '기타'" 토스트 방지). 등록 폼은 목록을 읽는 동안 칸과 저장을 잠근다('기록 안 함' 깜빡임).
    ['components/cleaning/CleaningRowBody.tsx', /if \(cleaningReasonLabel\(reasonVal\) === cleaningReasonLabel\(r\.reason\) && !willAdd\) \{ setReasonOpen\(false\); return \}/, '청소 사유를 안 바꾸고 저장해도 바꿨다고 말한다'],
    ['app/(app)/inventory/InventoryClient.tsx', /emptyLabel=\{reasonList \? '기록 안 함' : ''\} disabled=\{!reasonList\}[\s\S]*disabled=\{pending \|\| !reasonList\}/, "폐기 등록 폼이 목록을 읽는 동안 '기록 안 함' 을 세우거나 저장을 안 잠근다"],
    ['app/(app)/inventory/InventoryClient.tsx', /emptyLabel=\{sourceList \? '기록 안 함' : ''\} disabled=\{!sourceList\}[\s\S]*disabled=\{pending \|\| !sourceList\}/, "무상 입수 등록 폼이 목록을 읽는 동안 '기록 안 함' 을 세우거나 저장을 안 잠근다"],
  ]
  // 비품 사유 칸(교체·폐기)을 바깥 label 로 싸지 않는다. '기타' 의 체크박스 label 이 그 안에 중첩된다(HTML 위반, 2차 독립 검수).
  if (/<label className="block">(?:(?!<\/label>)[\s\S])*<CategorySelect/.test(stripComments(readFileSync('app/(app)/inventory/assets/AssetsClient.tsx', 'utf8')))) {
    violations.push(`app/(app)/inventory/assets/AssetsClient.tsx · 사유 칸(CategorySelect)을 바깥 label 로 싼다. '기타' 의 체크박스 label 이 중첩된다. 바깥은 div, 질문은 label htmlFor 로 둔다.`)
  }
  // 청소 사유 라벨은 한 벌이다(cleaningConstants cleaningReasonLabel). 라벨 표를 사유 값으로 바로 찾는 자리가 되살아나면 목록 이름·'기타 · 글'
  // 사유가 undefined 로 서거나 '기타' 로 접힌다. 코랄 채움 사유 칩(라디오 그룹 '청소 사유')도 되살아나지 않는다(§03).
  for (const p of SOURCES) {
    if (p === 'app/(app)/room-manage/cleaningConstants.ts') continue
    const code = stripComments(readFileSync(p, 'utf8'))
    if (/CLEANING_REASON_LABEL\[/.test(code)) violations.push(`${p} · 청소 사유 라벨 표를 값으로 바로 찾는다. cleaningReasonLabel 한 벌을 쓴다.`)
    if (/aria-label="청소 사유"/.test(code)) violations.push(`${p} · 청소 사유를 칩(라디오 그룹)으로 고른다. 코랄 채움 선택 칩은 §03 위반이고 목록이 붙으면 칩이 접힌다. CategorySelect 를 쓴다.`)
  }
  for (const [p, re, what] of WIRING2) if (!re.test(stripComments(readFileSync(p, 'utf8')))) violations.push(`${p} · ${what}.`)
  // 저절로 쌓는 목록의 새 자리(작업 종류·부가수익·지출 카테고리 넷). 값은 맨 글자(autoOptionForSave)이고, 끄면 안 더하고,
  // 고치는 기록의 지금 값과 같으면 안 더한다(목록에서 뺀 카테고리가 저장마다 되살아나지 않는다). 더하기는 기록이 선 뒤(commit)다.
  // 지금 값도 값과 같은 정규화를 거쳐 견준다(2차 독립 검수 D5, 공백이 불규칙한 인식 결과).
  {
    const rs2 = stripComments(readFileSync('lib/reasonListSave.ts', 'utf8'))
    const auto = bodyOf(rs2, /export async function autoOptionForSave\(/) ?? ''
    if (!/resolveCategoryForSave\(parseOptionList\(field, p\?\.\[field\]\), raw\)/.test(auto)
      || !/const prev = opts\.prev \? normalizeCategoryInput\(opts\.prev\) : null/.test(auto)
      || !/opts\.addToList !== false && nextList && value && value !== prev \?/.test(auto)) {
      violations.push(`lib/reasonListSave.ts · autoOptionForSave 가 목록 표기 맞춤·체크 끔·지금 값 비교 중 하나를 잃었다. 뺀 카테고리가 되살아나거나 끈 체크에도 목록에 쌓인다.`)
    }
    const AUTO_WIRING = [
      ['app/(app)/room-manage/workActions.ts', /autoOptionForSave\(propertyId, 'workKindOptions', input\.kind, \{ addToList: input\.addKindToList \}\)[\s\S]*?prisma\.roomWork\.create[\s\S]*?await kindSave\.commit\(\)/, '작업 예정 등록이 종류를 맨 글자 규약으로 재고 기록 뒤에 목록에 더하지 않는다'],
      ['components/work/RoomWorkPlanForm.tsx', /addKindToList: kindToList/, '작업 예정 폼이 체크를 넘기지 않는다'],
      ['app/(app)/finance/actions.ts', /autoOptionForSave\(propertyId, 'incomeCategories', formData\.get\('category'\) as string, \{ addToList: formData\.get\('categoryAddToList'\) === '1' \}\)/, '부가수익 등록이 체크 칸이 실린 저장만 목록에 더하지 않는다(수납 과납분처럼 칸 없는 저장까지 쌓인다)'],
      ['app/(app)/finance/actions.ts', /autoOptionForSave\(propertyId, 'incomeCategories', formData\.get\('category'\) as string, \{ addToList: formData\.get\('categoryAddToList'\) === '1', prev: prevCategory \}\)/, '부가수익 수정이 지금 카테고리(prev)와 견주지 않는다'],
      ['app/(app)/finance/actions.ts', /autoOptionForSave\(propertyId, 'expenseCategories', data\.category, \{ addToList: opts\?\.addCategoryToList \}\)/, '지출 일괄 수정이 카테고리를 맨 글자 규약으로 재지 않는다'],
      ['app/(app)/settings/actions.ts', /autoOptionForSave\(propertyId, 'expenseCategories', rawCategory, \{ addToList: addCategoryToList, prev \}\)/, '고정 지출 수정이 지금 카테고리(prev)와 견주지 않는다'],
      ['app/(app)/dashboard/pendingReceipt.ts', /autoOptionForSave\(propertyId, 'expenseCategories', final\.category, \{ addToList: final\.addCategoryToList, prev: row\.inferredCategory \}\)/, '홈 승인이 인식이 뽑은 카테고리 그대로를 목록에 더한다(prev 없음)'],
      ['components/dashboard/PendingReceiptSection.tsx', /savedValue=\{row\.inferredCategory \?\? ''\}/, '홈 승인 칸이 인식한 카테고리 그대로에도 체크를 세운다'],
    ]
    for (const [p, re, what] of AUTO_WIRING) if (!re.test(stripComments(readFileSync(p, 'utf8')))) violations.push(`${p} · ${what}.`)
    // 맨 select 로 카테고리를 고르는 자리가 남지 않는다(목록 밖 값이 첫 항목으로 바뀌는 잠복 버그, 부가수익 수정 폼). 필터 칸은 '전체' 가 있어 예외다.
    for (const [p, re] of [
      ['app/(app)/rooms/IncomeSection.tsx', /<select name="category"/],
      ['app/(app)/finance/FinanceClient.tsx', /<select value=\{(recMgmtForm\.category|category)\} onChange/],
      ['app/(app)/settings/SettingsForm.tsx', /<select value=\{recForm\.category\}/],
      ['components/work/RoomWorkPlanForm.tsx', /<select id=\{`\$\{uid\}-kind`\}/],
    ]) if (re.test(stripComments(readFileSync(p, 'utf8')))) violations.push(`${p} · 카테고리·종류를 맨 select 로 고른다. 목록 밖 값이 첫 항목으로 보이고 저장하면 바뀐다. CategorySelect addMode="auto" 를 쓴다.`)
  }
  for (const [p, re] of [['app/(app)/tenants/TenantClient.tsx', /overrideReason\.trim\(\)/], ['components/entity-modal/widgets/DueDayTempAdjustWidget.tsx', /reason\.trim\(\)/]]) {
    if (re.test(stripComments(readFileSync(p, 'utf8')))) violations.push(`${p} · 납부일 임시 조정 사유 저장 글자를 화면이 다듬는다. 글 없는 '기타 · ' 가 '기타 · 기타 ·' 로 남는다.`)
  }
  // 2차 카드 손놀림은 형제 카드와 같은 손 핸들러다(추가 정규화는 ⓘ, 삭제 확인창 꼴은 check-undo-verb, 확인창 기본값은 ⓓ 가 본다).
  // 초기화는 기본값이 있는 칸에만 선다. 기본값이 없는 칸의 초기화는 곧 전부 삭제다(쇼핑몰 카드와 같다).
  for (const f of SECOND) {
    const block = tab.match(new RegExp(`<OptionSection(?:(?!\\/>)[\\s\\S])*?field="${f}"(?:(?!\\/>)[\\s\\S])*?\\/>`))?.[0] ?? ''
    if (!block) { violations.push(`${FORM} · ${f} 카드를 못 찾았다.`); continue }
    const hasReset = /\bonReset=\{/.test(block)
    if (hasReset !== OPTION_LIST_DEFAULTS_LEN(f) > 0) violations.push(`${FORM} · ${f} 카드의 초기화가 기본값 유무와 어긋난다(기본값 ${OPTION_LIST_DEFAULTS_LEN(f)}개, 초기화 ${hasReset ? '있음' : '없음'}).`)
  }
}

console.log(`[분류 목록 정합] 축 ⓐ 조회 · ⓑ 초기화 · ⓒ 이름 변경 기본값 · ⓓ 확인창 · ⓔ 할인 사유 영업장 범위 · ⓕ 설정 카드 · ⓖ 적용취소 · ⓗ 보호 이름 · ⓘ 정규화 · ⓙ 새 값만 자동 추가 · ⓚ field 검사 · ⓛ 사유 목록 · ⓜ 카드 행 넘침 · ⓝ 2차 목록·묶음 머리 / 목록 ${FIELDS.length} · 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  기본값은 lib/optionLists 한 벌이고, 이름 변경은 영업장 범위·보호 이름·바뀐 행 id 로만, 적용취소는 지금 서버 목록 위에서 한다.')
  process.exit(1)
}
