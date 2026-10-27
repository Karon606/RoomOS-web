// 할인 사유·분류 목록 회귀 · 실행: npx tsx scripts/test-discount-reasons.ts
//
// 고정하는 것(신고 78bb0141, 2026-10-13, 독립 검수 반영).
//   · **정규화** · 쉼표는 저장 구분자라 지운다. 목록 13종 모두 같은 정본(normalizeOptionName)을 거쳐야
//     목록 글자와 기록 글자(RentDiscount.memo·Tenant.job 등)가 같아 이름 변경이 그 기록을 따라간다.
//   · **이름 변경은 영업장 범위** · RentDiscount 에는 propertyId 가 없다. 계약(leaseTerm)으로 거른다.
//   · **빈 칸 기본값** · 칸이 null 이면 조회·이름 변경·초기화가 같은 기본값을 읽는다.
//   · **보호 이름** · 코드가 글자로 판정하는 이름(결제 수단·창문 원값·청소비·재고 기본 카테고리)과 코드가 그 글자로
//     기록을 만드는 이름(보증금 몰취·위약금·기타 임대수입·청소용역비·수선유지비)은 바꿀 수 없다. 결제 수단 글자를
//     비교하는 자리나, 기록을 만드는 코드가 카테고리·결제 수단을 글자로 적는 자리가 새로 생기면 그 글자가 보호 집합에
//     있어야 한다(2026-10-13 운영자 승인 범위).
//   · **적용취소는 지금 서버 목록 위에서** · 빼기 둘을 거꾸로 무르기·빼고 더한 뒤 무르기·그사이 다른 화면이
//     쌓은 값, 세 경우에 아무것도 안 사라진다. 초기화 적용취소도 그 뒤 생긴 항목을 잃지 않는다.
//   · **사유는 라벨** · 금액 계산은 memo 를 안 읽는다(돈 무변경의 근거).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { normalizeCategoryInput } from '../lib/categoryInput'
import {
  OPTION_LIST_DEFAULTS, PROTECTED_OPTION_NAMES, parseOptionList, optionRenameWhere, normalizeOptionName,
  protectedOptionReason, protectedRenameError, insertOptionAt, mergeResetUndo, isOptionListField, windowTypeCode, type OptionListField,
  optionListAfterRename, optionListAfterRenameUndo, optionListAfterRestore, optionListAfterResetUndo, renameUndoPlan,
} from '../lib/optionLists'
import { REQUEST_CATEGORIES } from '../lib/requestCategories'
import { DEFAULT_SPEC_UNITS, DEFAULT_QTY_UNITS } from '../lib/unitOptions'
import { PAYMENT_METHODS, CARD_LIKE_METHODS } from '../lib/paymentMethods'
import { CLEANING_FEE_CATEGORY, DEPOSIT_SOURCED_PAY_METHOD, FORFEIT_CATEGORY, PENALTY_CATEGORY, OVERPAY_INCOME_CATEGORY } from '../lib/incomeCategories'
import { CLEANING_EXPENSE_CATEGORY, WORK_EXPENSE_CATEGORY } from '../app/(app)/room-manage/cleaningConstants'
import { DEFAULT_INVENTORY_CATEGORIES } from '../app/(app)/inventory/constants'
import { discountForMonth, discountLabel } from '../lib/rentDiscount'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 정규화 ─────────────────────────────────────────────────────────
eq('쉼표가 든 사유는 한 줄로 남는다', normalizeCategoryInput('입실자, 소개'), '입실자 소개')
eq('연속 공백은 한 칸', normalizeCategoryInput('  입실자   소개 '), '입실자 소개')
eq('쉼표뿐이면 빈 값', normalizeCategoryInput(','), '')
eq('null 은 빈 값', normalizeCategoryInput(null), '')
const fields = Object.keys(OPTION_LIST_DEFAULTS) as OptionListField[]
for (const f of fields) {
  // 목록 13종 모두 쉼표를 지운다. 종전에는 할인 사유만 지워 직업 '프로그래머, 개발' 이 두 줄이 됐다.
  eq(`${f} 이름 정규화는 쉼표를 지운다`, normalizeOptionName(f, ' 가나, 다라 ').includes(','), false)
}
eq('직업도 쉼표를 공백으로', normalizeOptionName('jobOptions', '프로그래머, 개발'), '프로그래머 개발')
eq('결제 수단도 공백을 접는다', normalizeOptionName('paymentMethods', '  법인   카드 '), '법인 카드')
eq('단위는 단위 정본을 쓴다(글자 없는 표기는 빈 값)', normalizeOptionName('specUnitOptions', '-'), '')
eq('단위 쉼표도 공백으로', normalizeOptionName('qtyUnitOptions', '박,스'), '박 스')

// 쉼표는 지우지 않고 공백으로 바꾼다. 지우면 두 낱말이 붙는다(3차 검수).
eq('쉼표로 붙여 적은 두 낱말은 공백으로 떨어진다', normalizeCategoryInput('학생,아르바이트'), '학생 아르바이트')
eq('쉼표가 겹쳐도 한 칸', normalizeCategoryInput('a,,b'), 'a b')
eq('끝 쉼표는 사라진다', normalizeCategoryInput('ml,'), 'ml')
// 운영 DB 에 쉼표 든 값은 할인 메모 1건뿐이고(2026-10-13 읽기 전용 조회) 쉼표 뒤가 공백이라 종전 규칙과 결과가 같다.
const MEMO_WITH_COMMA = '508호 정정(2만→1만, 2026-07-01)'
eq('운영 할인 메모 1건은 종전과 같은 결과', normalizeCategoryInput(MEMO_WITH_COMMA), MEMO_WITH_COMMA.replace(/,/g, '').replace(/\s+/g, ' ').trim())
// 창문 유형은 화면 이름을 원값으로 접는다. 접지 않으면 '외창' 이 원값 OUTER 옆에 두 줄로 서고 보호가 뚫린다(3차 검수).
eq('창문 화면 이름은 원값으로', ['외창', ' 내창 ', 'WINDOW', 'NO_WINDOW'].map(v => normalizeOptionName('windowTypeOptions', v)), ['OUTER', 'INNER', 'OUTER', 'INNER'])
eq('창문 원값은 그대로', ['OUTER', 'INNER'].map(v => normalizeOptionName('windowTypeOptions', v)), ['OUTER', 'INNER'])
eq('창문 새 이름은 그대로', normalizeOptionName('windowTypeOptions', '복층창'), '복층창')
eq('다른 목록은 창문 표로 접지 않는다', normalizeOptionName('roomTypeOptions', '외창'), '외창')
eq('창문 표에 없는 글자는 null(상속 이름 포함)', ['외창2', 'toString', ''].map(windowTypeCode), [null, null, null])
eq('다른 이름을 외창으로 바꾸는 것은 보호 이름으로 막힌다',
  protectedRenameError('windowTypeOptions', '복층창', normalizeOptionName('windowTypeOptions', '외창')) !== null, true)
eq('외창을 더하면 원값 OUTER 와 같은 이름(중복)', parseOptionList('windowTypeOptions', null).includes(normalizeOptionName('windowTypeOptions', '외창')), true)

// ── 이름 변경 조건: 영업장 범위 ───────────────────────────────────
const discWhere = optionRenameWhere({ model: 'rentDiscount', column: 'memo', via: 'leaseTerm' }, 'P1', '프로모션')
eq('할인 사유는 계약으로 영업장을 거른다', discWhere, { leaseTerm: { propertyId: 'P1' }, memo: '프로모션' })
eq('할인 사유 조건에 맨 propertyId 가 없다(RentDiscount 에 없는 칸)', 'propertyId' in discWhere, false)
eq('입주자 직업은 propertyId 로 거른다',
  optionRenameWhere({ model: 'tenant', column: 'job' }, 'P1', '학생'), { propertyId: 'P1', job: '학생' })
eq('소프트삭제 모델은 삭제분까지 센다(deletedAt 명시)',
  'deletedAt' in optionRenameWhere({ model: 'paymentRecord', column: 'payMethod' }, 'P1', '현금'), true)
eq('보통 모델은 deletedAt 을 안 붙인다',
  'deletedAt' in optionRenameWhere({ model: 'room', column: 'type' }, 'P1', '원룸'), false)

// ── 빈 칸 기본값: 조회와 이름 변경이 같은 답 ───────────────────────
for (const f of fields) {
  eq(`${f} 칸이 null 이면 기본값`, parseOptionList(f, null), [...OPTION_LIST_DEFAULTS[f]])
  eq(`${f} 기본값에 쉼표 든 항목 없음`, OPTION_LIST_DEFAULTS[f].some(v => v.includes(',')), false)
  eq(`${f} 기본값에 중복 없음`, new Set(OPTION_LIST_DEFAULTS[f]).size, OPTION_LIST_DEFAULTS[f].length)
}
eq('목록 스물일곱이 전부 정본에 있다(쇼핑몰 2026-10-19, 사유 셋·2차 여섯 2026-10-22, 방 점검 넷 2026-10-27 포함)', fields.length, 27)
eq('점검 제외 품목은 기본값이 없다(품명을 코드에 박지 않는다)', parseOptionList('inspectionExcludedItems', null), [])
eq('점검 항목 목록은 다 빼면 빈 목록으로 남는다', parseOptionList('moveinInspectionItems', ''), [])
eq('쇼핑몰 목록은 기본값이 없다(쇼핑몰 이름을 코드에 박지 않는다)', parseOptionList('channelOptions', null), [])
eq('쇼핑몰 이름의 쉼표는 공백으로', normalizeOptionName('channelOptions', '쿠팡, 로켓'), '쿠팡 로켓')
eq('다 뺀 할인 사유는 빈 목록으로 남는다', parseOptionList('discountReasons', ''), [])
eq('다 뺀 결제 수단도 빈 목록', parseOptionList('paymentMethods', ''), [])
eq('요청 카테고리는 빈 값이 기본 4종(종전 계약, 기타는 2026-10-22 뺐다)', parseOptionList('requestCategories', ''), [...REQUEST_CATEGORIES])
eq("요청 카테고리 기본값에 '기타' 가 없다('기타(직접 입력)' 과 두 줄)", (REQUEST_CATEGORIES as readonly string[]).includes('기타'), false)
eq('규격 단위는 빈 값이 기본값(종전 계약)', parseOptionList('specUnitOptions', ''), [...DEFAULT_SPEC_UNITS])
eq('수량 단위는 빈 값이 기본값(종전 계약)', parseOptionList('qtyUnitOptions', ''), [...DEFAULT_QTY_UNITS])
eq('저장 칸은 앞뒤 공백·빈 칸을 턴다', parseOptionList('discountReasons', '프로모션, 양곡지원 ,,누수'), ['프로모션', '양곡지원', '누수'])
eq('신규 영업장 할인 사유에 입실자 소개', OPTION_LIST_DEFAULTS.discountReasons.includes('입실자 소개'), true)
// 결제 수단 기본값은 4종으로 못박았다(조회·확인창이 보여 온 값). 바꾸면 칸이 빈 영업장 드롭다운이 바뀐다.
eq('결제 수단 기본값 4종', OPTION_LIST_DEFAULTS.paymentMethods, ['계좌이체', '신용카드', '체크카드', '현금'])

// ── 보호 이름: 코드가 글자로 판정하는 이름은 못 바꾼다 ─────────────
const payNames = PROTECTED_OPTION_NAMES.paymentMethods?.names ?? []
for (const n of [...PAYMENT_METHODS, ...CARD_LIKE_METHODS, DEPOSIT_SOURCED_PAY_METHOD, '체크카드']) {
  eq(`결제 수단 '${n}' 은 보호`, payNames.includes(n), true)
}
eq('결제 수단 기본 4종은 전부 보호(운영 영업장은 칸이 비어 이 4종이 목록이다)',
  OPTION_LIST_DEFAULTS.paymentMethods.every(n => protectedOptionReason('paymentMethods', n) !== null), true)
eq('직접 더한 결제 수단은 바꿀 수 있다', protectedOptionReason('paymentMethods', '서울페이'), null)
eq('창문 원값 OUTER·INNER 는 보호', ['OUTER', 'INNER'].map(n => protectedOptionReason('windowTypeOptions', n) !== null), [true, true])
eq('부가수익 청소비는 보호(환불 한도를 정하는 글자)', protectedOptionReason('incomeCategories', CLEANING_FEE_CATEGORY) !== null, true)
eq('재고 기본 카테고리는 보호', DEFAULT_INVENTORY_CATEGORIES.every(c => protectedOptionReason('expenseCategories', c.cat) !== null), true)
// 코드가 이 글자로 기록을 만드는 이름. 바꾸면 지난 기록만 새 이름이 되고 다음 기록은 옛 이름으로 생겨 갈린다.
eq('청소·작업 완료가 만드는 지출 카테고리는 보호',
  [CLEANING_EXPENSE_CATEGORY, WORK_EXPENSE_CATEGORY].map(n => protectedOptionReason('expenseCategories', n) !== null), [true, true])
eq('퇴실 정산·예약 취소·수납 과납분이 만드는 부가수익 카테고리는 보호',
  [FORFEIT_CATEGORY, PENALTY_CATEGORY, OVERPAY_INCOME_CATEGORY].map(n => protectedOptionReason('incomeCategories', n) !== null), [true, true, true])
// 막지 않는 다섯(운영자 결정 2026-10-13). 세부 항목 면제·영수증 인식 제외만 바뀌고 돈 계산과 무관하다.
eq('공과금·관리비·임대료·세금/수수료·보증금 반환은 바꿀 수 있다',
  ['공과금', '관리비', '임대료', '세금/수수료', '보증금 반환'].map(n => protectedOptionReason('expenseCategories', n)), [null, null, null, null, null])
eq('지출 보호 이름은 다섯(재고 셋 + 청소·작업 둘)', PROTECTED_OPTION_NAMES.expenseCategories?.names.length, 5)
eq('부가수익 보호 이름은 넷(청소비·보증금 몰취·위약금·기타 임대수입)', PROTECTED_OPTION_NAMES.incomeCategories?.names.length, 4)
eq('미반환 사유 청소비·인수 승계 보증금은 보호(퇴실 정산이 이 글자로 청소비를 나누고 미리 고른다)',
  ['청소비', '인수 승계 보증금', '원상복구비'].map(n => protectedOptionReason('withholdReasons', n) !== null), [true, true, false])
eq('할인 사유·직업에는 보호 이름이 없다',
  [protectedOptionReason('discountReasons', '프로모션'), protectedOptionReason('jobOptions', '학생')], [null, null])
eq('보호 이름에서 바꾸기는 막는다',
  protectedRenameError('paymentMethods', '신용카드', '카드'), '이 이름은 바꿀 수 없습니다. 수납 기록과 카드 정산은 이 이름으로만 결제 수단을 알아봅니다.')
eq('보호 이름으로 바꾸기도 막는다(그 기록이 판정 안으로 들어온다)',
  protectedRenameError('paymentMethods', '법인카드', '신용카드'), '다른 항목을 이 이름으로 바꿀 수 없습니다. 수납 기록과 카드 정산은 이 이름으로만 결제 수단을 알아봅니다.')
eq('보호와 무관한 이름 변경은 통과', protectedRenameError('paymentMethods', '서울페이', '서울Pay'), null)
// 결과 문장은 판정 밖 우회로를 권하지 않는다. 판정이 글자에 묶여 있어 새 이름을 추가해 쓰면 카드 정산·재고에서
// 빠진다(2차 검수). 운영자 말로 쓰고(판정·값 금지), 서버 오류와 카드 안내가 이 한 문장을 읽는다.
for (const [f, p] of Object.entries(PROTECTED_OPTION_NAMES)) {
  eq(`${f} 결과 문장이 새 이름 추가를 권하지 않는다`, /추가해 쓰|새로 추가해|다른 이름을 쓰/.test(p!.effect), false)
  eq(`${f} 결과 문장은 운영자 말로 쓴다(판정·값 금지)`, /판정|값/.test(p!.effect), false)
  eq(`${f} 결과 문장은 마침표로 끝나는 완결 문장`, p!.effect.endsWith('다.'), true)
  eq(`${f} 서버 오류가 결과 문장을 그대로 싣는다`, protectedRenameError(f as OptionListField, p!.names[0], 'x')?.endsWith(p!.effect), true)
}

// 결제 수단 글자를 비교하는 자리 전수 · 그 글자가 보호 집합 밖이면 이름 변경 한 번에 판정이 조용히 틀어진다.
// 'all' 은 화면 필터의 '전체' 표식이라 결제 수단이 아니다.
const NOT_PAY_METHOD = new Set(['all'])
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}
const payCompares: string[] = []
for (const file of [...walk('app'), ...walk('components'), ...walk('lib')]) {
  const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  const found: string[] = []
  for (const m of code.matchAll(/\b\w*[Mm]ethod\w*\)?\s*[!=]==\s*'([^']+)'/g)) found.push(m[1])
  for (const m of code.matchAll(/'([^']+)'\s*[!=]==\s*[\w.?]*[Mm]ethod\b/g)) found.push(m[1])
  for (const m of code.matchAll(/\w*[Mm]ethods?\w*\.includes\(\s*'([^']+)'\s*\)/g)) found.push(m[1])
  for (const m of code.matchAll(/[Mm]ethod\s*:\s*\{\s*(?:in|notIn)\s*:\s*\[([^\]]*)\]/g)) {
    for (const lit of m[1].matchAll(/'([^']+)'/g)) found.push(lit[1])
  }
  for (const lit of found) {
    if (NOT_PAY_METHOD.has(lit)) continue
    payCompares.push(lit)
    if (!payNames.includes(lit)) {
      fails.push(`${file} · 결제 수단 '${lit}' 을 글자로 비교하는데 보호 이름(lib/optionLists PROTECTED_OPTION_NAMES.paymentMethods)에 없다. 설정에서 이 이름을 바꾸면 그 판정이 조용히 틀어진다.`)
    }
  }
}
eq('결제 수단 글자 비교 자리를 찾았다(그물이 살아 있다)', payCompares.length > 10, true)

// ── 기록을 만드는 코드가 목록 이름을 글자로 적는 자리 전수 ──────────
// 지출·부가수익·수납 기록을 만드는 코드가 카테고리·결제 수단을 글자(또는 글자 상수)로 적으면 그 이름은 보호 이름이어야
// 한다. 설정에서 바꾸면 지난 기록만 새 이름이 되고 다음 기록은 옛 이름으로 생겨, 한 돈이 두 이름으로 갈리고 옛 이름은
// 목록 밖에 선다(2026-10-13 운영자 승인). 보는 자리는 셋이다. 기록 만들기 호출 덩어리(expense·extraIncome·paymentRecord
// 의 create·createMany·upsert)의 category·payMethod 칸, 폼 데이터의 set('category'|'payMethod', …), 카테고리 이름 상수
// (…CATEGORY… = '글자', 덩어리 밖 배열로 엮여 들어가는 퇴실 정산 parts 같은 자리). 변수로만 흘러드는 글자(무상 비품의
// 빈 카테고리 폴백 '비품' 따위)는 이 그물 밖이다.
// 보호하지 않는 글자는 까닭과 함께 아래 표에 적는다. 표에 없는 새 글자가 생기면 붉게 선다.
const NOT_PROTECTED_WRITES: Record<string, string> = {
  '양도인 정산': '양도인 정산 수납(rooms/actions)의 결제 수단 표식. 결제 수단 목록 항목이 아니다(기본값에 없고 저절로 더하지 않는다, 운영 결제 수단 칸 null)',
  '예약금 몰취': '예약 취소 위약금 부가수익(tenants/actions)의 결제 수단 표식. 결제 수단 목록 항목이 아니다(기본값에 없고 저절로 더하지 않는다)',
  '관리비': '고정 지출 폼이 처음 채워 두는 값(DEFAULT_RECURRING_CATEGORY)이라 기록을 스스로 만들지 않는다. 운영자 결정으로 막지 않는다(2026-10-13)',
  '보증금': '옛 몰취 이름(FORFEIT_CATEGORY_LEGACY). 지금 코드는 이 글자로 기록을 만들지 않는다',
}
const incNames = PROTECTED_OPTION_NAMES.incomeCategories?.names ?? []
const expNames = PROTECTED_OPTION_NAMES.expenseCategories?.names ?? []
// 주석을 걷되 줄 수는 지킨다(위반 행 번호가 원본과 맞아야 한다).
const stripKeepLines = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:])\/\/[^\n]*/g, '$1')
const codeOf = new Map([...walk('app'), ...walk('components'), ...walk('lib')].map(f => [f, stripKeepLines(readFileSync(f, 'utf8'))] as const))
// 글자 상수 지도(대문자 이름 = '글자'). 같은 이름이 여러 파일에 있으면 값을 다 본다.
const constVals = new Map<string, string[]>()
for (const code of codeOf.values()) {
  for (const m of code.matchAll(/\bconst ([A-Z][A-Z0-9_]+)\s*(?::[^=\n]*)?=\s*'([^']+)'/g)) constVals.set(m[1], [...(constVals.get(m[1]) ?? []), m[2]])
}
// 별칭으로 들여온 상수(import { OVERPAY_INCOME_CATEGORY as EXTRA_INCOME_CATEGORY })도 원래 글자로 읽는다.
for (const code of codeOf.values()) {
  for (const m of code.matchAll(/\b([A-Z][A-Z0-9_]+) as ([A-Z][A-Z0-9_]+)\b/g)) {
    if (constVals.has(m[1])) constVals.set(m[2], [...(constVals.get(m[2]) ?? []), ...constVals.get(m[1])!])
  }
}
// model 은 생성 덩어리에서만 안다. 지출에 부가수익 보호 이름('청소비')을 적어도 합집합으로 보면 통과하던 미탐(독립 검수 2026-10-13)이라 모델별 목록으로 판정한다.
type Written = { file: string; line: number; kind: 'category' | 'payMethod'; value: string; model?: 'expense' | 'extraIncome' | 'paymentRecord' }
const written: Written[] = []
const valuesIn = (rawExpr: string, file: string, line: number, kind: Written['kind'], model?: Written['model']) => {
  const expr = rawExpr.replace(/\[[^\]]*\]/g, '')   // row['입금수단'] 같은 열쇠 글자는 값이 아니다
  for (const m of expr.matchAll(/'([^']+)'/g)) written.push({ file, line, kind, value: m[1], model })
  for (const m of expr.matchAll(/\b([A-Z][A-Z0-9_]{3,})\b/g)) {
    const vals = constVals.get(m[1])
    if (!vals) { fails.push(`${file}:${line} · ${kind} 에 적는 상수 ${m[1]} 의 글자를 못 읽었다(이 그물은 const 이름 = '글자' 꼴을 읽는다).`); continue }
    for (const v of vals) written.push({ file, line, kind, value: v, model })
  }
}
for (const [file, code] of codeOf) {
  const lineAt = (i: number) => code.slice(0, i).split('\n').length
  for (const m of code.matchAll(/\b(expense|extraIncome|paymentRecord)\.(create|createMany|upsert)\(/g)) {
    let depth = 0, j = m.index + m[0].length - 1
    for (; j < code.length; j++) { if (code[j] === '(') depth++; else if (code[j] === ')' && --depth === 0) break }
    const blk = code.slice(m.index, j + 1)
    for (const f of blk.matchAll(/\b(category|payMethod)\s*:\s*([^,\n}]*)/g)) valuesIn(f[2], file, lineAt(m.index + f.index), f[1] as Written['kind'], m[1] as Written['model'])
  }
  for (const f of code.matchAll(/\.set\('(category|payMethod)',\s*([^)\n]*)\)/g)) valuesIn(f[2], file, lineAt(f.index), f[1] as Written['kind'])
  for (const m of code.matchAll(/\bconst ([A-Z0-9_]*CATEGORY[A-Z0-9_]*)\s*(?::[^=\n]*)?=\s*'([^']+)'/g)) {
    written.push({ file, line: lineAt(m.index), kind: 'category', value: m[2] })
  }
}
for (const w of written) {
  const catNames = w.model === 'expense' ? expNames : w.model === 'extraIncome' ? incNames : [...incNames, ...expNames]
  const ok = w.kind === 'payMethod' ? payNames.includes(w.value) : catNames.includes(w.value)
  if (!ok && !Object.hasOwn(NOT_PROTECTED_WRITES, w.value)) {
    fails.push(`${w.file}:${w.line} · 기록을 만드는 코드가 ${w.kind === 'payMethod' ? '결제 수단' : '카테고리'} '${w.value}' 을 글자로 적는데 보호 이름(lib/optionLists PROTECTED_OPTION_NAMES)에 없다. 설정에서 이 이름을 바꾸면 지난 기록과 다음 기록이 두 이름으로 갈린다. 상수로 보호 이름에 더하거나, 보호하지 않을 까닭을 NOT_PROTECTED_WRITES 에 적는다.`)
  }
}
eq('기록을 만드는 코드의 글자 이름을 찾았다(그물이 살아 있다)', written.length > 15, true)
for (const n of [CLEANING_EXPENSE_CATEGORY, WORK_EXPENSE_CATEGORY, FORFEIT_CATEGORY, PENALTY_CATEGORY, OVERPAY_INCOME_CATEGORY, CLEANING_FEE_CATEGORY, DEPOSIT_SOURCED_PAY_METHOD]) {
  eq(`코드가 만드는 '${n}' 자리를 그물이 본다`, written.some(w => w.value === n), true)
}

// ── 적용취소: 지금 서버 목록 위에서 한 이름만 ─────────────────────
// 서버 목록 흉내. 빼기는 거르기, 더하기는 끝에 붙이기, 빼기 적용취소는 insertOptionAt(뺄 때 자리).
{
  // (가) [A,B,C] 에서 A 빼고 C 빼고, 먼저 뜬 토스트(A)부터 적용취소.
  let server = ['A', 'B', 'C']
  const idxA = server.indexOf('A'); server = server.filter(v => v !== 'A')
  const idxC = server.indexOf('C'); server = server.filter(v => v !== 'C')
  server = insertOptionAt(server, 'A', idxA)
  eq('(가) 첫 적용취소는 A 만 살린다(C 는 아직 빠져 있다)', server, ['A', 'B'])
  server = insertOptionAt(server, 'C', idxC)
  eq('(가) 두 번째 적용취소 뒤 셋 다 있다(A 가 다시 지워지지 않는다)', [...server].sort(), ['A', 'B', 'C'])
  // 토스트 차례대로(나중 것부터) 무르면 자리까지 그대로다.
  let s2 = ['A', 'B', 'C']
  const i1 = s2.indexOf('A'); s2 = s2.filter(v => v !== 'A')
  const i2 = s2.indexOf('C'); s2 = s2.filter(v => v !== 'C')
  s2 = insertOptionAt(insertOptionAt(s2, 'C', i2), 'A', i1)
  eq('(가) 나중 것부터 무르면 원래 순서', s2, ['A', 'B', 'C'])
}
{
  // (나) B 를 빼고 곧바로 D 를 더한 뒤 6초 안에 적용취소.
  let server = ['A', 'B', 'C']
  const idx = server.indexOf('B'); server = server.filter(v => v !== 'B')
  server = [...server, 'D']
  server = insertOptionAt(server, 'B', idx)
  eq('(나) 방금 더한 D 가 안 사라진다', server, ['A', 'B', 'C', 'D'])
}
{
  // (다) 화면은 [A,B,C] 를 들고 있는데 그사이 다른 화면이 E 를 쌓았다.
  let server = ['A', 'B', 'C', 'E']
  const clientIdx = ['A', 'B', 'C'].indexOf('B')
  server = server.filter(v => v !== 'B')
  server = insertOptionAt(server, 'B', clientIdx)
  eq('(다) 다른 화면이 쌓은 E 가 안 지워진다', server, ['A', 'B', 'C', 'E'])
}
eq('이미 다시 들어와 있으면 그대로(두 번 눌러도 한 줄)', insertOptionAt(['A', 'B'], 'B', 0), ['A', 'B'])
eq('자리는 지금 목록 길이로 자른다', insertOptionAt(['A'], 'Z', 9), ['A', 'Z'])
eq('빈 이름은 안 넣는다', insertOptionAt(['A'], '', 0), ['A'])
{
  // 초기화 적용취소 · 직전 서버 목록 + 초기화 뒤 새로 생긴 항목.
  const before = ['A', 'B', 'C']
  const defaults = ['X', 'Y']
  eq('초기화 뒤 더한 D 를 잃지 않는다', mergeResetUndo(before, defaults, ['X', 'Y', 'D']), ['A', 'B', 'C', 'D'])
  eq('초기화 뒤 다른 화면이 쌓은 E 도 잃지 않는다', mergeResetUndo(before, defaults, ['X', 'E']), ['A', 'B', 'C', 'E'])
  eq('초기화가 넣은 기본값은 걷힌다', mergeResetUndo(before, defaults, ['X', 'Y']), ['A', 'B', 'C'])
  eq('직전 목록에도 있던 기본값은 남는다', mergeResetUndo(['A', 'X'], defaults, ['X', 'Y']), ['A', 'X'])
  eq('두 번 눌러도 같다', mergeResetUndo(before, defaults, mergeResetUndo(before, defaults, ['X', 'Y', 'D'])), ['A', 'B', 'C', 'D'])
}

// ── 목록 서버 액션의 목록 계산(순수 함수 표) ───────────────────────
// 서버 액션은 저장된 칸(raw)을 읽어 이 함수에 넘기고 결과를 쓰기만 한다(배선은 check-option-lists ⓖ).
eq('이름 변경은 그 자리에서 이름만 바뀐다', optionListAfterRename(['A', 'B', 'C'], 'B', 'X'), ['A', 'X', 'C'])
eq('이름 변경 적용취소는 새 이름 자리에 옛 이름', optionListAfterRenameUndo('roomTypeOptions', 'A,X,C', 'B', 'X'), { next: ['A', 'B', 'C'], changed: true })
eq('그사이 옛 이름이 다시 생겼으면 새 이름만 뺀다', optionListAfterRenameUndo('roomTypeOptions', 'A,X,B', 'B', 'X'), { next: ['A', 'B'], changed: true })
eq('그사이 새 이름이 사라졌으면 목록은 그대로(바뀐 것 없음)', optionListAfterRenameUndo('roomTypeOptions', 'A,C', 'B', 'X'), { next: ['A', 'C'], changed: false })
eq('이름 변경 적용취소도 빈 칸은 기본값으로 읽는다', optionListAfterRenameUndo('paymentMethods', null, '카드', '신용카드').changed, true)
eq('빼기 적용취소는 지금 저장된 목록에 끼운다', optionListAfterRestore('roomTypeOptions', 'A,C', 'B', 1), { next: ['A', 'B', 'C'], changed: true, name: 'B' })
eq('빼기 적용취소: 그사이 더한 항목을 지킨다', optionListAfterRestore('roomTypeOptions', 'A,C,D', 'B', 1).next, ['A', 'B', 'C', 'D'])
eq('빼기 적용취소: 빈 칸은 기본값 위에서', optionListAfterRestore('roomTypeOptions', null, '복층', 1).next, ['원룸', '복층', '미니룸'])
eq('빼기 적용취소: 이미 있으면 그대로(바뀐 것 없음)', optionListAfterRestore('roomTypeOptions', 'A,B', 'B', 0), { next: ['A', 'B'], changed: false, name: 'B' })
eq('빼기 적용취소: 쉼표는 지운 이름으로 넣는다', optionListAfterRestore('jobOptions', 'A', '가, 나', 0).next, ['가 나', 'A'])
eq('빼기 적용취소: 정규화 뒤 빈 이름은 안 넣고 이름이 비었다고 알린다', optionListAfterRestore('jobOptions', 'A', ' , ', 0), { next: ['A'], changed: false, name: '' })
eq('초기화 적용취소는 지금 저장된 목록의 새 항목을 지킨다', optionListAfterResetUndo('roomTypeOptions', '원룸,미니룸,D', ['A', 'B']), ['A', 'B', 'D'])
eq('초기화 적용취소: 직전 목록도 정규화를 거친다', optionListAfterResetUndo('roomTypeOptions', '원룸,미니룸', ['가, 나']), ['가 나'])
{
  // 이름 변경 적용취소가 고칠 행. 서버 표의 칸으로, 지금 적힌 새 이름과 그때 바뀐 id 로 고른다.
  const cascade = [
    { model: 'rentDiscount', column: 'memo', via: 'leaseTerm' as const },
    { model: 'tenant', column: 'job' },
  ]
  const undo = { oldValue: '소개', newValue: '입실자 소개', rows: [
    { model: 'rentDiscount', column: 'memo', ids: ['d1', 'd2'] },
    { model: 'tenant', column: 'job', ids: [] },
  ] }
  const plan = renameUndoPlan(cascade, undo, 'P1')
  eq('적용취소는 지금 적힌 새 이름과 그때 바뀐 id 로 고른다(영업장 범위 포함)', plan,
    [{ model: 'rentDiscount', column: 'memo', where: { leaseTerm: { propertyId: 'P1' }, memo: '입실자 소개', id: { in: ['d1', 'd2'] } } }])
  eq('바뀐 id 가 없는 칸은 건너뛴다', plan?.length, 1)
  eq('연쇄 대상이 아닌 모델·칸이 섞이면 아무것도 안 고친다',
    renameUndoPlan(cascade, { ...undo, rows: [{ model: 'property', column: 'publicSlug', ids: ['P1'] }] }, 'P1'), null)
  // 화면이 범위를 정할 수 없다. 표의 모델·칸이 같으면 서버 표의 via 를 쓴다.
  const forged = renameUndoPlan(cascade, { ...undo, rows: [{ model: 'rentDiscount', column: 'memo', ids: ['d1'], via: undefined } as never] }, 'P1')
  eq('영업장 범위는 서버 표에서', forged?.[0]?.where.leaseTerm, { propertyId: 'P1' })
}

// ── 목록 칸 이름 검사: 서버 액션이 영업장 행의 다른 칸에 못 쓴다 ──────
eq('목록 열셋은 전부 목록 칸', fields.every(f => isOptionListField(f)), true)
eq('영업장 행의 다른 칸은 목록 칸이 아니다', ['publicSlug', 'shortStayPolicy', 'name', 'inventoryCategories'].map(isOptionListField), [false, false, false, false])
eq('상속 이름도 지나가지 않는다', ['toString', '__proto__', 'constructor'].map(isOptionListField), [false, false, false])
eq('글자가 아니면 아니다', [null, undefined, 1, {}].map(isOptionListField), [false, false, false, false])

// ── 사유는 라벨: 금액 무관 ─────────────────────────────────────────
const base = { discountType: 'amount', value: 10000, scope: 'permanent', startMonth: '2026-01', endMonth: null }
eq('사유가 있어도 할인액은 같다',
  discountForMonth([{ ...base, memo: '입실자 소개' }], '2026-10', 400000),
  discountForMonth([{ ...base, memo: null }], '2026-10', 400000))
eq('사유는 라벨 끝에 붙는다', discountLabel({ ...base, memo: '입실자 소개' }), '10,000원 할인 · 매월 · 입실자 소개')

if (fails.length) {
  console.error(`test-discount-reasons: ${fails.length}건 실패 / ${pass} 통과`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`test-discount-reasons: ${pass}건 통과 (결제 수단 글자 비교 ${payCompares.length}곳 · 기록을 만드는 글자 ${written.length}곳 검사)`)
