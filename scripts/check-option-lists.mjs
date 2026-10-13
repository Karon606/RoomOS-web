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
//   ⓕ '관리는 설정에서' 가 사실이다: showAddHint 를 쓰는 목록마다 분류 관리 탭에 그 카드가 있다. 추가 힌트는
//      저장하면 실제로 더해질 때(직접 입력·기록에 저장된 값과 다른 새 값)만 선다.
//   ⓖ 적용취소가 모든 카드에 같고 지금 서버 목록 위에서 돈다: 빼기는 restoreOption(그 이름 하나를 뺄 때의
//      자리에), 초기화는 undoResetOptions(서버가 쥐어 준 직전 목록에), 이름 변경은 바뀐 행 id 로. 서버 액션의
//      목록 계산은 lib/optionLists 순수 함수(표는 test-discount-reasons)이고 액션은 그 함수를 저장된 칸 그대로
//      넘겨 부른다. 이름 변경은 바뀐 행 id 를 적용취소 표에 싣고, 되돌릴 조건은 renameUndoPlan 이 서버 표로 만든다.
//      화면은 실패 응답을 보기 전에 목록을 덮지 않고, 바뀐 것이 없으면 '원래 자리로 복귀' 라고 하지 않는다.
//   ⓗ 보호 이름: 이름 변경 입구(renameOption)·그 적용취소(undoRenameOption)와 화면(runRename·OptionSection)이
//      protectedRenameError · protectedOptionReason 한 벌로 막는다. 결제 수단 보호 집합은 판정 상수에서 끌어온다.
//      이름 편집은 보호 이름·이미 있는 이름을 인라인으로 막고, 서버가 받아 준 뒤에만 그 행일 때만 편집 칸을 닫는다.
//   ⓘ 정규화: 목록에 이름을 넣는 길(손 추가·이름 변경·적용취소, 그리고 다른 파일의 자동 추가)이 전부
//      정본 정규화(normalizeOptionName 또는 resolveCategoryForSave·resolveUnitForSave)를 거친다. 그 글자를
//      쓰는 기록(할인 사유 memo·입주자 직업, 엑셀 가져오기 포함)도 같은 정규화로 저장한다. 창문 유형 표기는
//      설정과 엑셀 가져오기가 한 표(windowTypeCode)로 원값에 접는다.
//   ⓙ 자동 추가는 새로 적은 값만: 기존 기록을 고치는 update 함수는 이전 값을 넘겨 견준다. 뺀 항목이
//      그 기록을 다시 저장할 때마다 되살아나지 않는다.
//   ⓚ 목록 서버 액션은 field 검사를 거친다: 칸 이름을 받아 `{ [field]: … }` 로 쓰는 액션은 무엇을 읽거나
//      쓰기 전에 assertOptionField 로 정본 표의 칸인지 본다. 없으면 편집 권한으로 영업장 행 아무 칸에나 쓴다.
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

// ⓕ showAddHint 를 쓰는 목록마다 설정 카드.
// 새 자리에서 showAddHint 를 쓰면 여기에 그 목록 칸을 적는다. 적지 않으면 붉게 선다.
const HINT_FIELD = {
  'app/(app)/requests/RequestsClient.tsx': 'requestCategories',
  'components/entity-modal/widgets/TenantRequestsTab.tsx': 'requestCategories',
  'app/(app)/finance/FinanceClient.tsx': 'expenseCategories',
  'components/ui/JobSelect.tsx': 'jobOptions',
  'components/entity-modal/widgets/DiscountWidget.tsx': 'discountReasons',
}
const cardFields = new Set([...form.matchAll(/<OptionSection[\s\S]*?\n\s*field="(\w+)"/g)].map(m => m[1]))
for (const p of [...walk('app', [], /\.tsx$/), ...walk('components', [], /\.tsx$/)]) {
  if (p === 'components/ui/CategorySelect.tsx') continue
  const src = readFileSync(p, 'utf8')
  if (!/\bshowAddHint\b/.test(src)) continue
  const f = HINT_FIELD[p]
  if (!f) { violations.push(`${p} · showAddHint('관리는 설정에서')를 쓰는데 어느 목록인지 이 그물에 안 적혔다. HINT_FIELD 에 적고 분류 관리 탭에 카드가 있는지 본다.`); continue }
  if (!cardFields.has(f)) violations.push(`${p} · '관리는 설정에서' 라고 말하는데 분류 관리 탭에 ${f} 카드(OptionSection)가 없다. 거짓 약속이다.`)
}
// 힌트 '저장할 때 목록에 저절로 추가' 는 실제로 더해질 때만 선다. 직접 입력을 골랐거나 기록에 저장된 값과 다른
// 새 값을 쳤을 때다(서버는 이전 값과 같으면 안 더한다). 고치는 폼은 그 기록의 값을, 새 기록 폼은 '' 를 savedValue 로
// 넘긴다(3차 검수). 지출 수정·지출 등록·입주자 직업이 그 자리다.
{
  const cs = readFileSync('components/ui/CategorySelect.tsx', 'utf8')
  if (!/showAddHint && \(customMode \|\| \(value !== '' && value !== baseline\)\)/.test(cs) || !/const baseline = savedValue \?\? initialValue/.test(cs)) {
    violations.push(`components/ui/CategorySelect.tsx · 추가 힌트가 '실제로 목록에 더해질 때'(직접 입력·저장된 값과 다른 새 값)만 서지 않는다.`)
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
    if (n < 3) violations.push(`${FORM} · OptionSection 의 [적용취소] 가 ${n}곳이다(빼기·초기화·이름 변경 셋 기대).`)
    if (/reorderOptions\(/.test(code)) violations.push(`${FORM} · OptionSection 의 적용취소가 이전 목록으로 순서 저장(reorderOptions)을 다시 부른다. 화면이 들고 있던 목록을 통째로 쓰면 그사이 더하거나 다른 화면이 쌓은 항목이 지워진다. restoreOption·undoResetOptions 를 쓴다.`)
    if (!/restoreOption\(field, item, index\)/.test(code) || !/const index = items\.indexOf\(item\)/.test(code)) violations.push(`${FORM} · 빼기 적용취소가 뺄 때의 자리(index)로 그 이름 하나만 되돌리지(restoreOption) 않는다.`)
    if (!/undoResetOptions\(field,/.test(code)) violations.push(`${FORM} · 초기화 적용취소가 서버가 쥐어 준 직전 목록(undoResetOptions)을 안 쓴다.`)
    if (!/undoRenameOption\(/.test(code)) violations.push(`${FORM} · 이름 변경 적용취소가 서버의 id 기준 되돌리기를 안 부른다.`)
    // 적용취소 결과가 실패면 화면 목록을 덮지 않는다. 실패 응답에는 목록이 없어 그대로 덮으면 카드가 빈다(3차 검수 역주입 N8).
    if (!/const undoToast = [\s\S]*?if \(!r\.ok\) \{ pushToast\('error', r\.error\); return \}\s*setItems\(\(\) => r\.items\)/.test(code)) {
      violations.push(`${FORM} · 빼기·초기화 적용취소가 실패 응답(r.ok)을 보기 전에 화면 목록을 덮는다.`)
    }
    if (!/if \(!u\.ok\) \{ pushToast\('error', u\.error\); return \}\s*setItems\(\(\) => u\.items\)/.test(code)) {
      violations.push(`${FORM} · 이름 변경 적용취소가 실패 응답(u.ok)을 보기 전에 화면 목록을 덮는다.`)
    }
    // 그사이 같은 이름이 다시 생겨 바뀐 것이 없으면 '원래 자리로 복귀' 대신 사실대로 말한다(changed).
    if (!/r\.changed === false && unchangedMessage/.test(code) || !/restoreOption\(field, item, index\), REMOVE_TOAST\.undone\(getLabel\(item\)\), ALREADY_LISTED\(getLabel\(item\)\)\)/.test(code)) {
      violations.push(`${FORM} · 빼기 적용취소가 바뀐 것이 없을 때(changed false)도 '원래 자리로 복귀' 라고 말한다.`)
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
  if (n < 7) violations.push(`${ACTIONS} · 칸 이름을 받는 목록 서버 액션을 ${n}개만 찾았다(초기화·순서·빼기 적용취소·초기화 적용취소·건수·이름 변경·이름 변경 적용취소, 7 이상 기대).`)
}

console.log(`[분류 목록 정합] 축 ⓐ 조회 · ⓑ 초기화 · ⓒ 이름 변경 기본값 · ⓓ 확인창 · ⓔ 할인 사유 영업장 범위 · ⓕ 설정 카드 · ⓖ 적용취소 · ⓗ 보호 이름 · ⓘ 정규화 · ⓙ 새 값만 자동 추가 · ⓚ field 검사 / 목록 ${FIELDS.length} · 위반 ${violations.length}건`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations) console.error(`  - ${v}`)
  console.error('')
  console.error('  기본값은 lib/optionLists 한 벌이고, 이름 변경은 영업장 범위·보호 이름·바뀐 행 id 로만, 적용취소는 지금 서버 목록 위에서 한다.')
  process.exit(1)
}
