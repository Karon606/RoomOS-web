// 환경설정 분류 목록(콤마 칸)의 기본값과 해석 정본. 조회·초기화·이름 변경·확인창이 이 한 벌을 읽는다.
//
// 종전에는 기본값이 세 자리에 따로 있었다. 조회 함수의 상수, 초기화의 FIELD_DEFAULTS, 확인창 문구다.
// 결제 수단은 조회 4종·초기화 12종·확인창 4종으로 이미 갈려 있었다. 이름 변경은 칸이 비었을 때
// 기본값 대신 빈 목록을 읽어 아무것도 안 바꾸고 성공 토스트만 띄웠다(운영 영업장의 결제 수단·창문
// 유형이 그 상태였다, 신고 78bb0141 패널 2026-10-13).
// 기본값이 필요한 자리는 전부 여기서 읽는다. **두 벌을 만들지 마라.**
//
// 이 파일은 'use server' 가 아니다. 서버 액션 파일은 상수를 내보낼 수 없고, 확인창(클라이언트)도
// 같은 값을 읽어야 한다.

import { DEFAULT_SPEC_UNITS, DEFAULT_QTY_UNITS, parseUnitOptions, normalizeUnitInput } from '@/lib/unitOptions'
import { REQUEST_CATEGORIES, parseRequestCategories } from '@/lib/requestCategories'
import { PAYMENT_METHODS, CARD_LIKE_METHODS } from '@/lib/paymentMethods'
import { CLEANING_FEE_CATEGORY, DEPOSIT_SOURCED_PAY_METHOD, FORFEIT_CATEGORY, PENALTY_CATEGORY, OVERPAY_INCOME_CATEGORY } from '@/lib/incomeCategories'
import { CLEANING_EXPENSE_CATEGORY, WORK_EXPENSE_CATEGORY, CLEANING_REASON_CODES, cleaningReasonLabel } from '@/app/(app)/room-manage/cleaningConstants'
import { DEFAULT_INVENTORY_CATEGORIES } from '@/app/(app)/inventory/constants'
import { normalizeCategoryInput } from '@/lib/categoryInput'
import { CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON } from '@/lib/depositWithholdReasons'
import { SYSTEM_STATUS_REASONS } from '@/lib/statusReasons'

export type OptionListField =
  | 'roomTypeOptions' | 'roomTierOptions' | 'windowTypeOptions' | 'directionOptions'
  | 'incomeCategories' | 'expenseCategories' | 'paymentMethods' | 'requestCategories'
  | 'workKindOptions' | 'specUnitOptions' | 'qtyUnitOptions' | 'discountReasons' | 'jobOptions' | 'channelOptions'
  | 'cancelReasons' | 'checkoutReasons' | 'withholdReasons'
  | 'dueDayReasons' | 'cleaningReasons' | 'stockDisposalReasons' | 'stockSourceOptions' | 'assetDisposalReasons' | 'visitRouteOptions'

export const OPTION_LIST_DEFAULTS: Record<OptionListField, readonly string[]> = {
  roomTypeOptions:   ['원룸', '미니룸'],
  roomTierOptions:   ['스탠다드', '실속형'],
  windowTypeOptions: ['OUTER', 'INNER'],
  directionOptions:  ['북향', '북동향', '동향', '남동향', '남향', '남서향', '서향', '북서향'],
  // '기타' 는 2026-10-22 2차에 뺐다. 고르는 칸 맨 끝 '기타(직접 입력)' 과 두 줄이 된다(요청 카테고리와 같은 결정).
  // 칸이 빈(null) 새 영업장만 바뀐다. 목록을 저장해 둔 영업장(운영 영업장은 '기타' 포함)은 그대로다.
  incomeCategories:  ['건조기', '세탁기', '자판기', '이자수익'],
  expenseCategories: ['부식비', '소모품비', '폐기물 처리비', '수선유지비', '공과금', '마케팅/광고비', '인건비', '청소용역비', '관리비', '임대료', '통신/렌탈/보험료', '세금/수수료', '보증금 반환'],
  // 4종이다(2026-10-13 운영자 승인으로 확정). 칸이 빈 영업장의 드롭다운이 처음부터 보여 준 것이 4종이고
  // 확인창도 4종이라 말했다. 초기화만 12종을 썼다(c535a4e2 가 FIELD_DEFAULTS 한 자리만 늘렸다). 그 12종의
  // 나머지 여덟은 선불 서비스 이름이고, 재무에서 선불 계정을 등록하면 지출 폼의 결제 수단 고르기에 저절로 붙는다
  // (finance/RecurringExpenseRecordModal effectivePayMethods). 이 줄을 고치면 조회·초기화·확인창이 같이 바뀐다.
  paymentMethods:    ['계좌이체', '신용카드', '체크카드', '현금'],
  requestCategories: REQUEST_CATEGORIES,
  workKindOptions:   ['도배', '장판'],
  specUnitOptions:   DEFAULT_SPEC_UNITS,
  qtyUnitOptions:    DEFAULT_QTY_UNITS,
  // 칸이 빈 영업장(새 영업장)만 이 값을 본다. 이미 목록을 저장한 영업장은 '입실자 소개' 가 저절로
  // 생기지 않는다. 운영자가 분류 관리 탭에서 직접 더한다(신고 78bb0141, 기존 목록 불변).
  discountReasons:   ['프로모션', '양곡지원', '공공요금', '에너지바우처', '입실자 소개'],
  jobOptions:        ['직장인', '학생', '고시생', '취업준비생', '대학원생', '프리랜서', '자영업자', '아르바이트', '무직', '의료인', '교사 / 강사', '군인', '공무원', '연구원', '운전기사', '기술직', '서비스직', '건설업', '요식업', '예술 / 창작'],
  // 쇼핑몰(지출의 Expense.channel 이 고르는 이름, 2026-10-19 운영자 승인). **기본값이 없다.** 쇼핑몰 이름을 코드에 박지 않는다
  // (멀티테넌트). 지출 저장에서 처음 보는 이름이 저절로 쌓인다(finance/actions resolveChannelForSave).
  channelOptions:    [],
  // 사유 목록 셋(2026-10-22 운영자 승인). 종전 코드 상수(lib/statusReasons·lib/depositWithholdReasons)에서 '기타'만 뺀 것이다.
  // '기타'는 목록 항목이 아니다. 고르는 자리 맨 끝에 늘 붙고 그 저장 규약은 lib/reasonLists 가 쥔다(목록에 넣지 못한다).
  // 퇴실 사유 뒤쪽 셋(계약 위반·요금 미납·무단 퇴실)은 내보낸 퇴실이다(2026-08-31, 통계에서 갈라져야 한다).
  cancelReasons:     ['변심', '가격부담', '호실 사이즈', '다른 곳으로 결정', '연락 두절', '일정 변경'],
  checkoutReasons:   ['계약 만료', '직장·학교 이동', '더 넓은 곳으로', 'LH선정', '가격 부담', '시설·환경 불만', '개인 사정', '계약 위반', '요금 미납', '무단 퇴실'],
  // 미반환 사유. '미납 충당' 은 일부러 없다(세법상 임대수입이라 몰취로 분류하면 틀린다, lib/depositWithholdReasons 머리말).
  withholdReasons:   [CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON, '원상복구비', '계약 위반'],
  // 2차 목록 여섯(2026-10-22 운영자 승인). 사유 목록 셋과 같은 '기타' 규약이다(lib/reasonLists). 백필 없음.
  // 납부일 임시 조정 사유·청소 사유는 기본값이 없다. 운영 영업장의 임시 조정 사유는 '급여 지연' 류가 손으로 적혀 있고
  // (2026-10-22 실측 18건 중 열 갈래), 청소는 앱 코드 셋(아래 FIXED_OPTION_VALUES)이 늘 맨 앞에 서기 때문이다.
  dueDayReasons:        [],
  cleaningReasons:      [],
  // 소모품 폐기 사유·무상 입수 출처는 종전 고르는 칸의 낱말에서 '기타' 만 뺀 것이다. 종전 저장 글자 '유통기한' 은
  // 이번부터 목록 이름 '유통기한 경과' 로 선다(운영 폐기 기록 0건, 2026-10-22).
  stockDisposalReasons: ['상함·부패', '유통기한 경과', '파손'],
  stockSourceOptions:   ['무상', '기증', '이월'],
  // 비품 폐기 사유. 종전 화면 상수(inventory/assets DISPOSAL_REASONS)에서 '기타' 만 뺐다. 운영자가 쓰는 말 그대로다.
  assetDisposalReasons: ['시공 중 철거', '파손', '분실', '노후·고장으로 교체'],
  visitRouteOptions:    ['인터넷 검색', '지도 앱', '지인 소개', '간판', '직접 방문'],
}

/**
 * 고르는 칸 맨 앞에 늘 서는 앱 고정 값(저장 값). 설정 목록에 들지 않아 빼거나 이름을 바꿀 수 없다.
 * 청소 사유 코드 셋이다. 라벨은 cleaningConstants CLEANING_REASON_LABEL, 표시는 그 라벨 함수 한 벌이다.
 */
export const FIXED_OPTION_VALUES: Partial<Record<OptionListField, readonly string[]>> = {
  cleaningReasons: CLEANING_REASON_CODES,
}
/** 서버가 그대로 받는 옛 고정 값. 새로 고르지는 못하고, 옛 화면이 보내거나 옛 기록을 그대로 저장할 때만 지난다. */
export const LEGACY_FIXED_VALUES: Partial<Record<OptionListField, readonly string[]>> = {
  cleaningReasons: ['OTHER'],
}

/**
 * 이 값이 목록 칸 이름인가. 목록 서버 액션은 칸 이름을 화면에서 받아 `{ [field]: … }` 로 영업장 행에
 * 쓴다. 타입은 실행 중에 아무것도 막지 않으므로, 이 검사가 없으면 편집 권한만 있으면 영업장 행의 아무
 * 칸(공개 주소·단기 정책 따위)에나 글자를 쓸 수 있다(독립 검수 2026-10-13). 정본 표에 있는 칸만 받는다.
 */
export function isOptionListField(v: unknown): v is OptionListField {
  return typeof v === 'string' && Object.hasOwn(OPTION_LIST_DEFAULTS, v)
}

/**
 * 저장된 칸을 목록으로 읽는다. 조회 함수와 이름 변경이 반드시 같은 답을 내야 한다.
 *
 * 칸이 null(한 번도 안 고침)이면 기본값이다. 빈 문자열(운영자가 전부 뺌)은 빈 목록으로 남는다.
 * 다 뺐는데 기본값이 되살아나면 뺀 것이 무른 것이 된다. 단 요청 카테고리와 단위는 종전부터 빈
 * 목록도 기본값으로 읽었다. 그 계약은 그대로 둔다(각 정본 함수가 쥐고 있다).
 */
export function parseOptionList(field: OptionListField, raw: string | null | undefined): string[] {
  if (field === 'requestCategories') return parseRequestCategories(raw)
  if (field === 'specUnitOptions') return parseUnitOptions(raw, DEFAULT_SPEC_UNITS)
  if (field === 'qtyUnitOptions') return parseUnitOptions(raw, DEFAULT_QTY_UNITS)
  return (raw ?? OPTION_LIST_DEFAULTS[field].join(',')).split(',').map(s => s.trim()).filter(Boolean)
}

/**
 * 창문 유형의 다른 표기를 원값으로 접는 표. 엑셀 가져오기(import·preview)와 목록 이름 정규화가 이 한 표를 쓴다.
 * 종전에는 가져오기 두 경로에 표가 따로 있었고 미리보기 쪽에는 WINDOW·NO_WINDOW 가 없었다.
 */
const WINDOW_TYPE_CODES: Readonly<Record<string, string>> = {
  '외창': 'OUTER', '내창': 'INNER',
  OUTER: 'OUTER', INNER: 'INNER',
  WINDOW: 'OUTER', NO_WINDOW: 'INNER',
}

/** 창문 유형 표기의 원값(OUTER·INNER). 표에 없는 글자면 null. */
export function windowTypeCode(raw: string): string | null {
  return Object.hasOwn(WINDOW_TYPE_CODES, raw) ? WINDOW_TYPE_CODES[raw] : null
}

/**
 * 목록에 들어갈 이름의 정규화 정본. 손 추가·자동 추가·이름 변경·삭제 적용취소가 모두 이것을 거친다.
 *
 * 쉼표는 저장 구분자라 공백으로 바꾼다(normalizeCategoryInput). 남기면 '입실자, 소개' 가 목록에서 두 줄로
 * 쪼개지고, 그 글자를 쓰는 기록(할인 사유·입주자 직업 등)과 목록 글자가 갈려 이름 변경이 그 기록을 못 따라간다.
 * 종전에는 할인 사유만 이 정규화를 거쳤다(독립 검수 2026-10-13). 단위는 단위 정본(normalizeUnitInput,
 * 글자 없는 표기를 거르고 같은 정규화를 한다)을 쓴다.
 *
 * 창문 유형은 화면 이름(외창·내창)을 원값(OUTER·INNER)으로 접는다. 화면은 원값을 외창·내창으로 보여 주므로,
 * '외창' 을 따로 더하거나 다른 이름을 '외창' 으로 바꾸면 같은 이름이 두 줄로 서고 원값 보호가 뚫린다(3차 검수).
 * 접고 나면 더하기는 중복으로, 바꾸기는 보호 이름으로 막힌다.
 */
export function normalizeOptionName(field: OptionListField, raw: string | null | undefined): string {
  if (field === 'specUnitOptions' || field === 'qtyUnitOptions') return normalizeUnitInput(raw) ?? ''
  const name = normalizeCategoryInput(raw)
  if (field === 'windowTypeOptions') return windowTypeCode(name) ?? name
  return name
}

/**
 * 이름을 바꿀 수 없는 항목. 앱 코드가 이 글자와 같은지로 판정하거나, 이 글자로 기록을 스스로 만든다.
 *
 * 이름 변경은 목록과 함께 그 글자를 쓰는 기록까지 바꾼다(RENAME_CASCADE). 그런데 코드가 '신용카드'
 * 와 같은지로 카드 매출·현금영수증 대상·정산 상태를 가르면, 이름을 바꾸는 순간 그 기록들이 판정에서
 * 조용히 빠진다. 운영 영업장은 결제 수단 칸이 비어(null) 있어 종전에는 이름 변경이 무시됐는데, 위
 * parseOptionList 로 고친 뒤로는 수납 기록·계약까지 실제로 바뀐다(계좌이체 606행·신용카드 411행·
 * 현금 31행, 독립 검수 2026-10-13). 그래서 이름 변경 입구에서 막는다.
 * 코드가 이 글자로 기록을 만드는 이름도 같다. 바꾸면 지난 기록만 새 이름이 되고 다음 기록은 옛 이름으로 생겨,
 * 한 가지 돈이 두 이름으로 갈리고 옛 이름은 목록 밖에 선다(2026-10-13 운영자 승인으로 범위에 넣었다).
 * 삭제·초기화는 막지 않는다. 목록에서만 빠지고 기록은 그대로이며 판정은 코드 상수를 본다.
 *
 * 항목마다 결과 문장(effect)을 둔다. 서버 오류와 화면 카드 안내가 이 한 문장을 읽는다. 그 문장은 '이 이름만
 * 그렇게 쓰인다' 는 결과를 말하고, 다른 이름을 새로 추가해 쓰라고 권하지 않는다. 판정이 글자에 묶여 있어
 * '삼성카드' 를 추가해 쓰면 카드 정산·미정산에서 빠지고, '식료품비' 로 적은 지출은 재고에 안 잡힌다(2차 검수).
 * 낱말은 운영자 말로 쓴다(판정·값 대신 수납 기록·카드 정산·이름, 가져오기 대신 엑셀 가져오기).
 *
 * 이름은 코드 상수에서 끌어온다. 여기에 글자를 새로 적으면 판정 자리와 두 벌이 된다.
 *   · 결제 수단: 수납 어휘(PAYMENT_METHODS, 수납 폼 선택지와 수납 기록이 이 글자로 맞물린다)·카드 계열
 *     (CARD_LIKE_METHODS, 카드 매출·현금영수증 대상·환불 세무 고지)·보증금 표식(DEPOSIT_SOURCED_PAY_METHOD).
 *     '체크카드' 만 상수가 없다. 카드 정산 조회(finance/actions)와 지출·고정 지출 폼의 카드 선택 칸이 글자로 비교한다.
 *   · 창문 유형: 원값 OUTER·INNER. 화면 라벨 지도(OUTER 를 외창으로)와 가져오기 매핑(외창을 OUTER 로)이 이 값을 읽는다.
 *   · 부가수익: 청소비(CLEANING_FEE_CATEGORY). CLEANING_FEE_RECEIVED_WHERE 가 이 글자로 입실 때 받은 청소비를 세고 그 합이
 *     퇴실 환불 한도를 정한다. 예약금 분해 수납과 퇴실 정산이 이 글자로 부가수익을 만든다. 보증금 몰취(FORFEIT_CATEGORY)는
 *     퇴실 정산이, 위약금(PENALTY_CATEGORY)은 예약 취소가, 기타 임대수입(OVERPAY_INCOME_CATEGORY)은 수납 과납분 처리가
 *     이 글자로 부가수익을 만든다(몰취·위약금은 목록에 없으면 저절로 더한다).
 *   · 지출: 재고 기본 카테고리(DEFAULT_INVENTORY_CATEGORIES). 재고 카테고리를 따로 정하지 않은 영업장은 재고가
 *     이 글자로 지출을 묶는다(운영 영업장이 그 상태다). 폐기물 처리비는 품목 추적 단위도 가른다. 청소용역비
 *     (CLEANING_EXPENSE_CATEGORY)·수선유지비(WORK_EXPENSE_CATEGORY)는 청소·작업 완료가 이 글자로 지출을 만든다.
 *   · 막지 않는 것: 공과금·관리비·임대료·세금/수수료·보증금 반환. 코드가 글자로 보기는 하지만(세부 항목 면제·영수증
 *     인식 제외) 돈 계산과 무관하고 기록을 만들지 않는다(2026-10-13 운영자 승인).
 * 결제 수단 글자를 비교하는 자리, 기록을 만드는 코드가 카테고리·결제 수단을 글자로 적는 자리가 이 목록 밖에 새로 생기면
 * scripts/test-discount-reasons 가 붉게 선다.
 */
// 카드 머리 안내는 '‘이름 고정’ 항목은 바꿀 수 없습니다.' 뒤에 effect 를 붙인다. 기본 글자 320·360·412px 에서 두 줄을
// 넘지 않게 짧게 쓴다(2026-10-13 실측, 넷 다 두 줄. 부가수익·지출 문장은 이름이 늘어난 뒤 운영 목록 그대로 다시 쟀다).
// 결제 수단 문장은 카드만 말하지 않는다. 보호 이름 일곱 중 카드는 신용카드·결제선생·체크카드뿐이고 계좌이체·현금도
// 같은 문장 아래 선다(3차 검수). 한 칸에 까닭이 둘(재고가 묶는 이름·청소가 만드는 이름)이어도 문장은 칸마다 하나다.
// 카드 머리는 한 번만 적고, 서버 오류도 같은 문장을 읽는다.
export const PROTECTED_OPTION_NAMES: Partial<Record<OptionListField, { names: readonly string[]; effect: string }>> = {
  paymentMethods: {
    names: Array.from(new Set([...PAYMENT_METHODS, ...CARD_LIKE_METHODS, DEPOSIT_SOURCED_PAY_METHOD, '체크카드'])),
    effect: '수납 기록과 카드 정산은 이 이름으로만 결제 수단을 알아봅니다.',
  },
  windowTypeOptions: {
    names: OPTION_LIST_DEFAULTS.windowTypeOptions,
    effect: '호실 정보와 엑셀 가져오기는 이 이름만 외창·내창으로 읽습니다.',
  },
  incomeCategories: {
    names: [CLEANING_FEE_CATEGORY, FORFEIT_CATEGORY, PENALTY_CATEGORY, OVERPAY_INCOME_CATEGORY],
    effect: '수납과 퇴실·예약 취소가 이 이름으로 부가수익을 만들고 셉니다.',
  },
  expenseCategories: {
    names: [...DEFAULT_INVENTORY_CATEGORIES.map(c => c.cat), CLEANING_EXPENSE_CATEGORY, WORK_EXPENSE_CATEGORY],
    effect: '재고 관리와 청소·작업 기록이 이 이름으로 지출을 묶고 만듭니다.',
  },
  // 미반환 사유 둘(2026-10-22). '청소비' 는 퇴실 정산이 이 글자로 몰취를 청소비와 나누고 청소비 잔고를 센다
  // (tenants/actions recordDepositReturn·cleaningActions). '인수 승계 보증금' 은 인수 전 입주자 퇴실에서 앱이 미리 고른다.
  // 결과 문장은 320px 기본 글자에서 카드 머리 안내가 두 줄을 넘지 않게 짧게 쓴다(2026-10-22 실측).
  withholdReasons: {
    names: [CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON],
    effect: '퇴실 정산이 이 이름으로 청소비를 가르고 인수 사유를 고릅니다.',
  },
}

/** 이 이름을 바꿀 수 없으면 그 결과 문장(effect, 완결 문장), 바꿀 수 있으면 null. 화면과 서버가 같은 함수를 쓴다. */
export function protectedOptionReason(field: OptionListField, name: string): string | null {
  const p = PROTECTED_OPTION_NAMES[field]
  return p && p.names.includes(name) ? p.effect : null
}

/**
 * 이 이름 변경을 막는 까닭(완결 문장), 막을 것이 없으면 null. 서버 입구(renameOption)와 화면이 같은 문장을 쓴다.
 *
 * 보호 이름을 다른 이름으로 바꾸면 그 이름을 쓰던 기록이 판정에서 조용히 빠지고, 다른 이름을 보호
 * 이름으로 바꾸면 그 기록이 판정 안으로 조용히 들어온다(카드 매출·현금영수증 대상이 그 자리에서 바뀐다).
 */
export function protectedRenameError(field: OptionListField, oldValue: string, newValue: string): string | null {
  const from = protectedOptionReason(field, oldValue)
  if (from) return `이 이름은 바꿀 수 없습니다. ${from}`
  const to = protectedOptionReason(field, newValue)
  if (to) return `다른 항목을 이 이름으로 바꿀 수 없습니다. ${to}`
  return null
}

/**
 * '기타' 규약을 쓰는 목록(사유·출처·경로). 고르는 자리 맨 끝에 '기타' 가 늘 붙고, 목록에 없는 글은 '기타 · 글' 로 남는다
 * (lib/reasonLists). 뜻을 모아 세는 목록이라 '목록에 추가' 체크는 기본 꺼짐이다(CategorySelect addMode 'ask').
 * 이름 자체가 값인 카테고리·종류(지출·부가수익 카테고리·작업 종류·직업·할인 사유·요청 카테고리)는 여기 없다(addMode 'auto').
 */
export const REASON_LIST_FIELDS = [
  'cancelReasons', 'checkoutReasons', 'withholdReasons',
  'dueDayReasons', 'cleaningReasons', 'stockDisposalReasons', 'stockSourceOptions', 'assetDisposalReasons', 'visitRouteOptions',
] as const
/** 상태 이력·퇴실 정산의 사유 셋(1차). 시스템 라벨('단기 자동 전환' 따위)을 목록에 못 넣는 칸이다. */
const STATUS_REASON_FIELDS: readonly OptionListField[] = ['cancelReasons', 'checkoutReasons', 'withholdReasons']
export type ReasonListField = typeof REASON_LIST_FIELDS[number]
export function isReasonListField(f: OptionListField): f is ReasonListField {
  return (REASON_LIST_FIELDS as readonly string[]).includes(f)
}

/**
 * 이 이름을 목록에 넣을 수 없는 까닭(완결 문장), 넣을 수 있으면 null. 손 추가·자동 추가·이름 변경이 같은 문을 지난다.
 *
 * 사유 목록에는 '기타' 와 '기타 · …' 꼴, 시스템 라벨('단기 자동 전환' 따위)을 못 넣는다. '기타' 는 고르는 자리가 늘 맨 끝에
 * 붙이는 항목이라 목록에 또 서면 두 줄이 되고, '기타 · …' 는 직접 입력의 저장 규약과 겹쳐 목록 항목인지 직접 입력인지
 * 가를 수 없다. 시스템 라벨을 목록에 넣으면 퇴실 사유 이어받기가 운영자가 고른 사유를 시스템 라벨로 읽고 건너뛴다.
 *
 * 청소 사유 목록에는 앱 코드 꼴(영문 대문자·숫자·밑줄, 'CHECKOUT' 따위)과 고정 라벨 셋(퇴실 청소·공사·도배 후·입실 중 요청)을
 * 못 넣는다. 저장 칸 하나(RoomCleaning.reason)에 코드와 글자가 함께 살아 코드 꼴 이름은 코드로 읽히고, 고정 라벨과 같은 글자는
 * 화면에서 앱 사유와 똑같이 보이는데 받은 청소비 부담·자동 퇴실 청소 판정('CHECKOUT')에서는 빠진다(2026-10-22 2차).
 */
export function reservedOptionNameError(field: OptionListField, name: string): string | null {
  if (!isReasonListField(field)) return null
  const v = name.trim()
  if (v === '기타' || /^기타\s*·/.test(v)) return "'기타'는 목록 맨 끝에 늘 있는 항목이라 따로 넣지 않습니다."
  if (STATUS_REASON_FIELDS.includes(field) && SYSTEM_STATUS_REASONS.includes(v)) return '앱이 상태 이력에 스스로 적는 이름이라 사유로 쓸 수 없습니다.'
  if (field === 'cleaningReasons') {
    if (/^[A-Z][A-Z0-9_]*$/.test(v)) return '영문 대문자 이름은 앱이 쓰는 청소 사유 코드와 겹쳐 쓸 수 없습니다.'
    if (CLEANING_REASON_CODES.some(c => cleaningReasonLabel(c) === v)) return '앱이 쓰는 청소 사유라 목록 맨 앞에 늘 있습니다.'
  }
  return null
}

/**
 * 삭제 적용취소가 지금 서버 목록에 한 이름을 도로 넣는다. 이미 있으면(그사이 다시 더했으면) 그대로 둔다.
 *
 * 자리는 뺄 때의 위치이고 지금 목록 길이로 자른다. 바탕이 지금 목록이라 그사이 더해진 항목이 안 지워진다.
 * 종전처럼 화면이 들고 있던 이전 목록을 통째로 다시 쓰면 (가) 둘을 빼고 먼저 뜬 토스트부터 적용취소할 때
 * 뒤에 뺀 것까지 살아났다가 두 번째 적용취소가 앞의 것을 다시 지우고, (나) 빼고 곧바로 더한 항목이
 * 사라지고, (다) 그사이 다른 화면이 목록에 쌓은 값이 지워졌다(독립 검수 2026-10-13).
 */
export function insertOptionAt(list: readonly string[], name: string, index: number): string[] {
  if (!name || list.includes(name)) return [...list]
  const at = Number.isInteger(index) ? Math.min(Math.max(index, 0), list.length) : list.length
  return [...list.slice(0, at), name, ...list.slice(at)]
}

/**
 * 초기화 적용취소가 쓸 목록. 초기화 직전 서버 목록을 되살리고, 초기화 뒤 지금 목록에 새로 생긴 항목
 * (기본값에도 직전 목록에도 없던 것)은 뒤에 붙여 잃지 않는다. 기본값에서 온 항목은 초기화가 넣은 것이라 걷힌다.
 */
export function mergeResetUndo(before: readonly string[], resetTo: readonly string[], now: readonly string[]): string[] {
  const out: string[] = []
  for (const v of before) if (v && !out.includes(v)) out.push(v)
  for (const v of now) if (!resetTo.includes(v) && !out.includes(v)) out.push(v)
  return out
}

// 아래 넷은 목록 서버 액션(이름 변경·이름 변경 적용취소·삭제 적용취소·초기화 적용취소)이 쓸 목록을 정하는
// 순수 함수다. 서버 액션은 저장된 칸을 읽어 넘기고 결과를 쓰기만 한다. 목록 계산이 액션 안에 있으면 표로
// 고정할 수 없어, 지금 목록 대신 빈 목록에 끼우거나 직전 목록만 쓰는 실수가 그물에 안 걸렸다(2차 검수).
// 표는 scripts/test-discount-reasons, 액션이 이 함수를 그대로 부르는지는 scripts/check-option-lists ⓖ 가 본다.

/** 이름 변경 뒤 목록. 옛 이름 자리에 새 이름이 선다(순서 그대로). */
export function optionListAfterRename(list: readonly string[], oldValue: string, newValue: string): string[] {
  return list.map(v => v === oldValue ? newValue : v)
}

/**
 * 이름 변경 적용취소 뒤 목록. 지금 저장된 칸(raw)에서 새 이름 자리에 옛 이름을 도로 넣는다. 그사이 옛 이름이
 * 목록에 다시 생겼으면 새 이름만 뺀다(같은 이름 두 줄 금지). 목록에 새 이름이 없으면(그사이 누가 또 바꿨으면)
 * 목록은 그대로이고 changed 는 false 다.
 */
export function optionListAfterRenameUndo(field: OptionListField, raw: string | null | undefined, oldValue: string, newValue: string): { next: string[]; changed: boolean } {
  const list = parseOptionList(field, raw)
  if (!list.includes(newValue)) return { next: list, changed: false }
  const next = list.includes(oldValue) ? list.filter(v => v !== newValue) : list.map(v => v === newValue ? oldValue : v)
  return { next, changed: true }
}

/**
 * 삭제 적용취소 뒤 목록. 지금 저장된 칸(raw)을 바탕으로 그 이름 하나를 뺄 때의 자리에 넣는다(insertOptionAt).
 * name 은 실제로 넣는 이름이고, 비어 있으면 아무것도 안 넣는다. changed 는 목록이 실제로 바뀌는지다.
 */
export function optionListAfterRestore(field: OptionListField, raw: string | null | undefined, rawName: string, index: number): { next: string[]; changed: boolean; name: string } {
  const list = parseOptionList(field, raw)
  const name = normalizeOptionName(field, rawName)
  const next = insertOptionAt(list, name, index)
  return { next, changed: next.length !== list.length, name }
}

/** 초기화 적용취소 뒤 목록. 지금 저장된 칸(raw)에서 초기화 뒤 생긴 항목을 지키며 직전 목록(before)으로 간다. */
export function optionListAfterResetUndo(field: OptionListField, raw: string | null | undefined, before: readonly string[]): string[] {
  // before 는 화면을 거쳐 왔으므로 목록 이름 정규화를 다시 거친다(쉼표가 섞이면 목록이 쪼개진다).
  return mergeResetUndo(before.map(v => normalizeOptionName(field, v)), OPTION_LIST_DEFAULTS[field], parseOptionList(field, raw))
}

/**
 * 이름 변경이 따라가는 데이터 칸 하나. via 가 있으면 그 모델에 propertyId 가 없어 관계로 영업장을 거른다.
 * statuses 가 있으면 그 상태(toStatus)의 행만 고른다. 상태 이력 사유 칸(TenantStatusLog.reason)에는 취소 사유와 퇴실 사유가
 * 함께 살아서, 퇴실 사유 '계약 위반' 을 바꾸면 같은 글자의 취소 사유까지 바뀌면 안 된다(2026-10-22).
 */
export type RenameTarget = { model: string; column: string; via?: 'leaseTerm' | 'trackedItem'; statuses?: readonly string[]; selfStatuses?: readonly string[] }

// 소프트삭제 모델. 삭제된 행의 값도 과거 표기라 함께 갱신한다. updateMany 는 익스텐션 필터 대상이
// 아니라 삭제분까지 바꾸므로, count·findMany 에도 deletedAt 을 명시해 필터를 끈다(건수 일치).
const RENAME_SOFT_DELETE_MODELS = new Set(['paymentRecord', 'extraIncome'])

/**
 * 이름 변경(과 그 적용취소)이 고칠 행의 조건. **언제나 이 영업장 안에서만** 고른다.
 *
 * RentDiscount 에는 propertyId 칸이 없다. 다른 칸처럼 { propertyId } 를 넣으면 실행 오류이고,
 * 그렇다고 빼면 같은 사유를 쓰는 다른 영업장의 할인까지 바뀐다. 그래서 계약을 타고 거른다.
 * 재고 기록 둘(StockDisposal·StockAddition)도 propertyId 가 없어 추적 품목(trackedItem)을 타고 거른다(2026-10-22 2차).
 */
export function optionRenameWhere(t: RenameTarget, propertyId: string, value: string): Record<string, unknown> {
  const where: Record<string, unknown> = t.via === 'leaseTerm'
    ? { leaseTerm: { propertyId }, [t.column]: value }
    : t.via === 'trackedItem'
    ? { trackedItem: { propertyId }, [t.column]: value }
    : { propertyId, [t.column]: value }
  // selfStatuses 는 상태가 안 바뀐 행(from === to)도 고른다. 퇴실 예정 '그날 바꾸기' 행이 그것이다(lib/statusReasons).
  if (t.statuses && t.selfStatuses) {
    where.OR = [{ toStatus: { in: [...t.statuses] } }, ...t.selfStatuses.map(s => ({ fromStatus: s, toStatus: s }))]
  } else if (t.statuses) where.toStatus = { in: [...t.statuses] }
  if (RENAME_SOFT_DELETE_MODELS.has(t.model)) where.deletedAt = undefined
  return where
}

/**
 * 이름 변경 적용취소가 되돌릴 행. 행마다 고칠 칸과 조건을 서버 표(cascade)의 칸으로 만든다.
 *
 * 적용취소 표(undo)는 화면을 거쳐 왔다. 표에 연쇄 대상이 아닌 모델·칸이 하나라도 있으면 null 이다(아무것도
 * 안 고친다). 조건은 지금 그 행에 적힌 새 이름(newValue)과 그때 바뀐 행 id 로 고르고, 영업장 범위는
 * optionRenameWhere 가 정한다. 옛 이름으로 고르면 아무 행도 안 걸리고, 화면이 보낸 모델·칸을 그대로 쓰면
 * 영업장 범위(via)를 화면이 정하게 된다(2차 검수 역주입 M12·M13).
 */
export function renameUndoPlan(
  cascade: readonly RenameTarget[],
  undo: { newValue: string; rows: readonly { model: string; column: string; ids: readonly string[] }[] },
  propertyId: string,
): { model: string; column: string; where: Record<string, unknown> }[] | null {
  const plan: { model: string; column: string; where: Record<string, unknown> }[] = []
  for (const r of undo.rows) {
    const t = cascade.find(c => c.model === r.model && c.column === r.column)
    if (!t) return null
    if (r.ids.length === 0) continue
    plan.push({ model: t.model, column: t.column, where: { ...optionRenameWhere(t, propertyId, undo.newValue), id: { in: [...r.ids] } } })
  }
  return plan
}
