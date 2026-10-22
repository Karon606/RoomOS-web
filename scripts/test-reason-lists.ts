// 사유 목록(입실 취소·퇴실·보증금 미반환) 진리표 · 실행: npx tsx scripts/test-reason-lists.ts
//
// 고정하는 것(2026-10-22 운영자 승인).
//   · 저장 규약 · '기타' 직접 입력은 '기타 · 글', 체크하면 맨 글자 + 목록 추가, 목록 밖 맨 글자는 '기타 · 글'(서버 검증).
//     고치는 기록의 지금 값 그대로면(뺀 항목·옛 이름) 그대로. 보호 이름(청소비·인수 승계 보증금)은 목록에서 빠져도 그대로.
//   · 수정 화면 해석 · 목록 항목 / '기타 · 글' / 둘 다 아닌 글자(그대로 보여 줌).
//   · 목록에 못 넣는 이름 · '기타'·'기타 · …'·시스템 라벨.
//   · 이름 변경 범위 · 상태 이력은 영업장 + toStatus 로 나누고 '기타 · 글' 은 안 바뀐다. 미반환은 미반환 기록만.
//   · 기본값 · 종전 코드 상수에서 '기타' 만 뺀 것(목록이 한 글자도 안 바뀐다).
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import {
  OPTION_LIST_DEFAULTS, PROTECTED_OPTION_NAMES, parseOptionList, optionRenameWhere, reservedOptionNameError, protectedRenameError,
  isReasonListField, REASON_LIST_FIELDS, FIXED_OPTION_VALUES, LEGACY_FIXED_VALUES,
} from '../lib/optionLists'
import { CLEANING_REASON_CODES, cleaningReasonLabel } from '../app/(app)/room-manage/cleaningConstants'
import { planReasonSave, reasonPickOf, otherReason, otherReasonText, OTHER_REASON_PREFIX } from '../lib/reasonLists'
import { REASON_FIELD_STATUSES, REASON_FIELD_SELF_STATUSES, SYSTEM_STATUS_REASONS, reasonFieldForStatus, isSystemStatusReason } from '../lib/statusReasons'
import { CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON } from '../lib/depositWithholdReasons'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fails.push(`${name}: 기대 ${JSON.stringify(want)} / 실제 ${JSON.stringify(got)}`)
}

// ── 기본값: 종전 상수에서 '기타' 만 뺐다 ─────────────────────────────
// 종전 lib/statusReasons CANCEL_REASONS·CHECKOUT_REASONS, lib/depositWithholdReasons WITHHOLD_REASONS(2026-10-21 main).
const OLD_CANCEL = ['변심', '가격부담', '호실 사이즈', '다른 곳으로 결정', '연락 두절', '일정 변경', '기타']
const OLD_CHECKOUT = ['계약 만료', '직장·학교 이동', '더 넓은 곳으로', 'LH선정', '가격 부담', '시설·환경 불만', '개인 사정', '계약 위반', '요금 미납', '무단 퇴실', '기타']
const OLD_WITHHOLD = ['인수 승계 보증금', '청소비', '원상복구비', '계약 위반', '기타']
eq('입실 취소 기본값 = 종전 상수 - 기타', parseOptionList('cancelReasons', null), OLD_CANCEL.filter(v => v !== '기타'))
eq('퇴실 기본값 = 종전 상수 - 기타', parseOptionList('checkoutReasons', null), OLD_CHECKOUT.filter(v => v !== '기타'))
eq('미반환 기본값 = 종전 상수 - 기타', parseOptionList('withholdReasons', null), OLD_WITHHOLD.filter(v => v !== '기타'))
for (const f of REASON_LIST_FIELDS) {
  eq(`${f} 기본값에 '기타' 가 없다(고르는 칸 맨 끝 고정 항목)`, OPTION_LIST_DEFAULTS[f].includes('기타'), false)
  eq(`${f} 기본값은 전부 목록에 넣을 수 있는 이름`, OPTION_LIST_DEFAULTS[f].map(v => reservedOptionNameError(f, v)), OPTION_LIST_DEFAULTS[f].map(() => null))
  eq(`${f} 는 사유 목록 칸`, isReasonListField(f), true)
  eq(`${f} 다 빼면 빈 목록(되살아나지 않는다)`, parseOptionList(f, ''), [])
}
eq('할인 사유는 사유 목록 칸이 아니다(기타 규약 밖)', isReasonListField('discountReasons'), false)
eq('미반환 보호 이름은 코드 상수 둘', PROTECTED_OPTION_NAMES.withholdReasons?.names, [CARRIED_OVER_WITHHOLD_REASON, CLEANING_WITHHOLD_REASON])
eq('청소비 이름 변경은 막힌다', protectedRenameError('withholdReasons', '청소비', '청소 비용') !== null, true)
eq('다른 사유를 청소비로 바꾸기도 막힌다', protectedRenameError('withholdReasons', '원상복구비', '청소비') !== null, true)
eq('원상복구비 이름 변경은 된다', protectedRenameError('withholdReasons', '원상복구비', '원상 복구비'), null)
eq('취소·퇴실 사유에는 보호 이름이 없다', [PROTECTED_OPTION_NAMES.cancelReasons, PROTECTED_OPTION_NAMES.checkoutReasons], [undefined, undefined])

// ── 상태 → 목록 칸 ──────────────────────────────────────────────
eq('상태별 사유 목록 칸', ['CANCELLED', 'CHECKOUT_PENDING', 'CHECKED_OUT', 'ACTIVE', 'RESERVED'].map(reasonFieldForStatus),
  ['cancelReasons', 'checkoutReasons', 'checkoutReasons', null, null])
eq('목록 칸의 상태 집합은 상태→칸과 같다',
  Object.entries(REASON_FIELD_STATUSES).every(([f, sts]) => sts.every(s => reasonFieldForStatus(s) === f)), true)

// ── 저장 규약(서버 검증) ─────────────────────────────────────────
const C = parseOptionList('cancelReasons', null)
const K = parseOptionList('checkoutReasons', null)
const W = parseOptionList('withholdReasons', null)
type Row = [string, Parameters<typeof planReasonSave>[0], readonly string[], string | null, { addToList?: boolean; prev?: string | null }, { reason: string | null; add: string | null }]
const TABLE: Row[] = [
  ['빈 값은 기록 안 함', 'cancelReasons', C, '', {}, { reason: null, add: null }],
  ['공백뿐이어도 기록 안 함', 'cancelReasons', C, '   ', {}, { reason: null, add: null }],
  ['목록 항목은 그대로', 'cancelReasons', C, '변심', {}, { reason: '변심', add: null }],
  ['앞뒤 공백은 걷는다', 'cancelReasons', C, '  변심 ', {}, { reason: '변심', add: null }],
  ["'기타' 만 고르면 '기타'", 'cancelReasons', C, '기타', {}, { reason: '기타', add: null }],
  ["'기타 · ' (글 없음)은 '기타'", 'cancelReasons', C, '기타 · ', {}, { reason: '기타', add: null }],
  ["글이 공백뿐이고 체크해도 '기타'", 'cancelReasons', C, '기타 ·    ', { addToList: true }, { reason: '기타', add: null }],
  ["체크 안 하면 '기타 · 글'", 'cancelReasons', C, '기타 · 공실 없음', {}, { reason: '기타 · 공실 없음', add: null }],
  ['체크하면 맨 글자 + 목록 추가', 'cancelReasons', C, '기타 · 공실 없음', { addToList: true }, { reason: '공실 없음', add: '공실 없음' }],
  ['글 앞뒤 공백은 걷는다', 'cancelReasons', C, '기타 ·  공실 없음  ', {}, { reason: '기타 · 공실 없음', add: null }],
  ["목록 밖 맨 글자(옛 화면·위조)는 '기타 · 글'", 'cancelReasons', C, '공실 없음', {}, { reason: '기타 · 공실 없음', add: null }],
  ['목록 밖 맨 글자도 체크하면 목록 추가', 'cancelReasons', C, '공실 없음', { addToList: true }, { reason: '공실 없음', add: '공실 없음' }],
  ['직접 입력 글이 목록 이름과 같으면 그 항목', 'cancelReasons', C, '기타 · 변심', {}, { reason: '변심', add: null }],
  ['직접 입력 글이 목록 이름과 같으면 체크해도 안 더한다', 'cancelReasons', C, '기타 · 변심', { addToList: true }, { reason: '변심', add: null }],
  ["'기타' 를 목록에 넣으려 하면 '기타 · 기타' 로 남고 안 더한다", 'cancelReasons', C, '기타 · 기타', { addToList: true }, { reason: '기타 · 기타', add: null }],
  ['시스템 라벨은 목록에 못 넣는다', 'checkoutReasons', K, '기타 · 단기 자동 전환', { addToList: true }, { reason: '기타 · 단기 자동 전환', add: null }],
  ['화면이 시스템 라벨을 맨 글자로 보내도 사유가 시스템 라벨인 척 남지 않는다', 'checkoutReasons', K, '단기 자동 전환', {}, { reason: '기타 · 단기 자동 전환', add: null }],
  ['체크하면 쉼표는 목록 정규화로(목록 글자와 기록 글자가 같다)', 'cancelReasons', C, '기타 · 공실, 없음', { addToList: true }, { reason: '공실 없음', add: '공실 없음' }],
  ['체크 안 한 글의 쉼표는 그대로(목록 이름이 아니다)', 'cancelReasons', C, '기타 · 공실, 없음', {}, { reason: '기타 · 공실, 없음', add: null }],
  ['지금 값 그대로면 목록 밖이어도 그대로(뺀 항목·옛 이름)', 'withholdReasons', W, '키값', { prev: '키값' }, { reason: '키값', add: null }],
  ["지금 값과 다르면 목록 밖 맨 글자는 '기타 · 글'", 'withholdReasons', W, '키값', { prev: '청소비' }, { reason: '기타 · 키값', add: null }],
  ['지금 값 그대로면 시스템 라벨도 그대로(이력 수정 화면을 열고 그냥 저장)', 'checkoutReasons', K, '단기 자동 전환', { prev: '단기 자동 전환' }, { reason: '단기 자동 전환', add: null }],
  ['보호 이름은 목록에서 빠져도 그대로(앱이 미리 고른다)', 'withholdReasons', ['원상복구비'], '청소비', {}, { reason: '청소비', add: null }],
  ['인수 승계 보증금도', 'withholdReasons', [], CARRIED_OVER_WITHHOLD_REASON, {}, { reason: CARRIED_OVER_WITHHOLD_REASON, add: null }],
  ['영업장이 더한 이름은 그 영업장 목록에서 그대로', 'cancelReasons', [...C, '공실 없음'], '공실 없음', {}, { reason: '공실 없음', add: null }],
  ['남의 영업장 목록에 없는 이름은 기타로', 'cancelReasons', C, '공실 없음', {}, { reason: '기타 · 공실 없음', add: null }],
  ['취소 사유 목록의 이름이 퇴실 목록에는 없다(칸마다 잰다)', 'checkoutReasons', K, '변심', {}, { reason: '기타 · 변심', add: null }],
]
for (const [name, field, list, raw, opts, want] of TABLE) eq(`저장 · ${name}`, planReasonSave(field, list, raw, opts), want)
eq('저장 규약 표가 스물을 넘는다', TABLE.length >= 20, true)

// ── 수정 화면 해석(저장 글자 → 칸) ─────────────────────────────────
eq('빈 값', reasonPickOf('', C), { kind: 'empty' })
eq('null', reasonPickOf(null, C), { kind: 'empty' })
eq('목록 항목', reasonPickOf('변심', C), { kind: 'option', value: '변심' })
eq("'기타'", reasonPickOf('기타', C), { kind: 'other', text: '' })
eq("'기타 · 글'", reasonPickOf('기타 · 공실 없음', C), { kind: 'other', text: '공실 없음' })
eq('뺀 항목·옛 이름은 그 글자 그대로', reasonPickOf('키값', W), { kind: 'legacy', value: '키값' })
eq('목록에서 뺀 항목도 그대로', reasonPickOf('변심', C.filter(v => v !== '변심')), { kind: 'legacy', value: '변심' })
eq('시스템 라벨 행은 그 글자 그대로', reasonPickOf('단기 자동 전환', K), { kind: 'legacy', value: '단기 자동 전환' })
for (const t of ['', '공실 없음', ' 앞 공백', '기타', '기타 · 겹침']) {
  eq(`직접 입력 글은 칸으로 되읽힌다('${t}')`, otherReasonText(otherReason(t)), t)
}
eq("직접 입력 글이 없으면 '기타'", otherReason(''), '기타')
eq('직접 입력 글은 접두어 한 벌', otherReason('x'), `${OTHER_REASON_PREFIX}x`)
eq('직접 입력이 아닌 글자', [otherReasonText('변심'), otherReasonText(''), otherReasonText(null)], [null, null, null])

// ── 목록에 못 넣는 이름 ──────────────────────────────────────────
const STATUS_FIELDS = ['cancelReasons', 'checkoutReasons', 'withholdReasons'] as const
for (const f of REASON_LIST_FIELDS) {
  eq(`${f} · '기타'`, reservedOptionNameError(f, '기타') !== null, true)
  eq(`${f} · '기타 · 글'`, reservedOptionNameError(f, '기타 · 공실') !== null, true)
  eq(`${f} · '기타·글'(붙여 씀)`, reservedOptionNameError(f, '기타·공실') !== null, true)
  // 시스템 라벨은 상태 이력·퇴실 정산의 사유 셋에서만 막는다(퇴실 사유 이어받기가 그 글자를 건너뛴다). 2차 여섯에는 그 판정이 없다.
  const status = (STATUS_FIELDS as readonly string[]).includes(f)
  for (const s of SYSTEM_STATUS_REASONS) eq(`${f} · 시스템 라벨 '${s}' ${status ? '막음' : '받음'}`, reservedOptionNameError(f, s) !== null, status)
  eq(`${f} · '기타사유' 같은 보통 이름은 된다`, reservedOptionNameError(f, '기타사유'), null)
}
eq("다른 목록은 '기타' 를 막지 않는다(부가수익 기본값에 '기타' 가 있다)", reservedOptionNameError('incomeCategories', '기타'), null)
eq('시스템 라벨 판정', ['단기 자동 전환', ' 퇴실 적용취소 ', '단기 감액 적용취소', '개인 사정', null].map(isSystemStatusReason), [true, true, true, false, false])

// ── 이름 변경 범위 ──────────────────────────────────────────────
const CANCEL_T = { model: 'tenantStatusLog', column: 'reason', statuses: REASON_FIELD_STATUSES.cancelReasons }
const CHECKOUT_T = { model: 'tenantStatusLog', column: 'reason', statuses: REASON_FIELD_STATUSES.checkoutReasons }
eq('취소 사유는 영업장 + 취소 행만', optionRenameWhere(CANCEL_T, 'P1', '변심'), { propertyId: 'P1', reason: '변심', toStatus: { in: ['CANCELLED'] } })
eq('퇴실 사유는 영업장 + 퇴실 예정·퇴실 행만', optionRenameWhere(CHECKOUT_T, 'P1', '개인 사정'), { propertyId: 'P1', reason: '개인 사정', toStatus: { in: ['CHECKOUT_PENDING', 'CHECKED_OUT'] } })
eq("퇴실 사유는 '그날 바꾸기' 행(거주중 그대로)도 고른다", optionRenameWhere({ ...CHECKOUT_T, selfStatuses: REASON_FIELD_SELF_STATUSES.checkoutReasons }, 'P1', '개인 사정'),
  { propertyId: 'P1', reason: '개인 사정', OR: [{ toStatus: { in: ['CHECKOUT_PENDING', 'CHECKED_OUT'] } }, { fromStatus: 'ACTIVE', toStatus: 'ACTIVE' }] })
eq('미반환 사유는 영업장 + 그 글자', optionRenameWhere({ model: 'depositRefund', column: 'reason' }, 'P1', '원상복구비'), { propertyId: 'P1', reason: '원상복구비' })
{
  // 조건을 메모리 행에 대 본다(Prisma where 의 같음·in 뜻 그대로).
  type L = { id: string; propertyId: string; toStatus: string; reason: string | null }
  const rows: L[] = [
    { id: 'a', propertyId: 'P1', toStatus: 'CHECKED_OUT', reason: '계약 위반' },
    { id: 'b', propertyId: 'P1', toStatus: 'CANCELLED', reason: '계약 위반' },
    { id: 'c', propertyId: 'P2', toStatus: 'CHECKED_OUT', reason: '계약 위반' },
    { id: 'd', propertyId: 'P1', toStatus: 'CHECKOUT_PENDING', reason: '기타 · 계약 위반' },
    { id: 'e', propertyId: 'P1', toStatus: 'CHECKOUT_PENDING', reason: '계약 위반' },
    { id: 'f', propertyId: 'P1', toStatus: 'ACTIVE', reason: '계약 위반' },
  ]
  const match = (w: Record<string, unknown>) => rows.filter(r => r.propertyId === w.propertyId && r.reason === w.reason
    && (!w.toStatus || (w.toStatus as { in: string[] }).in.includes(r.toStatus))).map(r => r.id)
  eq("퇴실 사유 이름 변경은 같은 글자의 취소 사유·남의 영업장·'기타 · 글'·다른 상태를 안 건드린다", match(optionRenameWhere(CHECKOUT_T, 'P1', '계약 위반')), ['a', 'e'])
  eq('취소 사유 이름 변경은 취소 행만', match(optionRenameWhere(CANCEL_T, 'P1', '계약 위반')), ['b'])
}

// ── 2차 목록 여섯(2026-10-22 운영자 승인 '추천대로') ─────────────────
// 기본값은 종전 고르는 칸의 낱말에서 '기타' 만 뺀 것이고(소모품 폐기 '유통기한' 은 '유통기한 경과' 로 선다), 기본값이 없는 둘은 빈 목록이다.
eq('2차 기본값', ['dueDayReasons', 'cleaningReasons', 'stockDisposalReasons', 'stockSourceOptions', 'assetDisposalReasons', 'visitRouteOptions'].map(f => parseOptionList(f as never, null)), [
  [], [], ['상함·부패', '유통기한 경과', '파손'], ['무상', '기증', '이월'], ['시공 중 철거', '파손', '분실', '노후·고장으로 교체'],
  ['인터넷 검색', '지도 앱', '지인 소개', '간판', '직접 방문'],
])
eq('2차 여섯은 전부 기타 규약 칸', ['dueDayReasons', 'cleaningReasons', 'stockDisposalReasons', 'stockSourceOptions', 'assetDisposalReasons', 'visitRouteOptions'].every(f => isReasonListField(f as never)), true)
eq('저절로 쌓는 카테고리·종류는 기타 규약 칸이 아니다', ['workKindOptions', 'incomeCategories', 'expenseCategories', 'jobOptions', 'requestCategories', 'discountReasons'].map(f => isReasonListField(f as never)), [false, false, false, false, false, false])
// 청소 사유: 앱 코드 셋은 목록 밖 맨 앞 고정이고, 코드 꼴·고정 라벨은 목록에 못 넣는다(한 칸에 코드와 글자가 함께 산다).
eq('청소 고정 값은 코드 셋', FIXED_OPTION_VALUES.cleaningReasons, [...CLEANING_REASON_CODES])
eq('청소 옛 코드 OTHER 는 받기만 한다', LEGACY_FIXED_VALUES.cleaningReasons, ['OTHER'])
for (const n of ['CHECKOUT', 'AFTER_WORK', 'DURING_STAY', 'OTHER', 'NEW_CODE', 'X1', '퇴실 청소', '공사·도배 후', '입실 중 요청']) {
  eq(`청소 사유 목록에 못 넣는 이름 '${n}'`, reservedOptionNameError('cleaningReasons', n) !== null, true)
}
for (const n of ['방역', 'Checkout', '퇴실청소 재요청', 'A동 소독']) eq(`청소 사유 목록에 넣을 수 있는 이름 '${n}'`, reservedOptionNameError('cleaningReasons', n), null)
eq('코드 꼴 판정은 청소 목록에서만', reservedOptionNameError('visitRouteOptions', 'CHECKOUT'), null)
const CL: string[] = ['방역']
const TABLE2: Row[] = [
  ['청소 코드 그대로', 'cleaningReasons', CL, 'CHECKOUT', {}, { reason: 'CHECKOUT', add: null }],
  ['청소 코드 공사·도배 후', 'cleaningReasons', CL, 'AFTER_WORK', {}, { reason: 'AFTER_WORK', add: null }],
  ['옛 화면이 보낸 OTHER 는 그대로(이행 없음)', 'cleaningReasons', CL, 'OTHER', {}, { reason: 'OTHER', add: null }],
  ['청소 목록 항목', 'cleaningReasons', CL, '방역', {}, { reason: '방역', add: null }],
  ['직접 입력 글이 목록 이름과 같으면 그 항목', 'cleaningReasons', CL, '기타 · 방역', {}, { reason: '방역', add: null }],
  ['직접 입력 글에 코드를 적어도 코드가 되지 않는다', 'cleaningReasons', CL, '기타 · CHECKOUT', {}, { reason: '기타 · CHECKOUT', add: null }],
  ['코드 꼴은 체크해도 목록에 안 들어간다', 'cleaningReasons', CL, '기타 · NEW_CODE', { addToList: true }, { reason: '기타 · NEW_CODE', add: null }],
  ['고정 라벨 글은 체크해도 목록에 안 들어간다', 'cleaningReasons', CL, '기타 · 퇴실 청소', { addToList: true }, { reason: '기타 · 퇴실 청소', add: null }],
  ['목록 밖 맨 글자(위조 코드)는 기타 · 글', 'cleaningReasons', CL, 'FAKE_CODE', {}, { reason: '기타 · FAKE_CODE', add: null }],
  ['청소 새 사유 체크하면 목록 추가', 'cleaningReasons', CL, '기타 · 곰팡이 제거', { addToList: true }, { reason: '곰팡이 제거', add: '곰팡이 제거' }],
  ['무상 입수 출처 목록 항목', 'stockSourceOptions', OPTION_LIST_DEFAULTS.stockSourceOptions, '무상', {}, { reason: '무상', add: null }],
  ['수정 화면이 옛 자유 입력 출처를 그대로 저장', 'stockSourceOptions', OPTION_LIST_DEFAULTS.stockSourceOptions, '522호 이경호님', { prev: '522호 이경호님' }, { reason: '522호 이경호님', add: null }],
  ['새 기록이 목록 밖 출처를 맨 글자로 보내면 기타 · 글', 'stockSourceOptions', OPTION_LIST_DEFAULTS.stockSourceOptions, '522호 이경호님', {}, { reason: '기타 · 522호 이경호님', add: null }],
  ['임시 조정 사유 목록이 비어도 지금 값 그대로면 그대로', 'dueDayReasons', [], '급여 지연', { prev: '급여 지연' }, { reason: '급여 지연', add: null }],
  ['임시 조정 사유 새 글 체크하면 목록 추가', 'dueDayReasons', [], '기타 · 급여 지연', { addToList: true }, { reason: '급여 지연', add: '급여 지연' }],
  ['방문 경로 옛 자유 입력 그대로', 'visitRouteOptions', OPTION_LIST_DEFAULTS.visitRouteOptions, '네이버지도', { prev: '네이버지도' }, { reason: '네이버지도', add: null }],
  ['시스템 라벨 글자는 방문 경로 목록에 들어갈 수 있다(상태 이력 판정 밖)', 'visitRouteOptions', [], '기타 · 단기 연장', { addToList: true }, { reason: '단기 연장', add: '단기 연장' }],
  ['비품 폐기 사유 목록 항목', 'assetDisposalReasons', OPTION_LIST_DEFAULTS.assetDisposalReasons, '분실', {}, { reason: '분실', add: null }],
]
for (const [name, field, list, raw, opts, want] of TABLE2) eq(`2차 저장 · ${name}`, planReasonSave(field, list, raw, opts), want)
// 청소 사유 글자 정본(cleaningReasonLabel): 코드는 고정 라벨, 옛 OTHER 는 '기타'(이행 없음), 그 밖은 저장 글자 그대로.
eq('청소 사유 라벨', ['CHECKOUT', 'AFTER_WORK', 'DURING_STAY', 'OTHER', '방역', '기타', '기타 · 곰팡이 제거'].map(cleaningReasonLabel),
  ['퇴실 청소', '공사·도배 후', '입실 중 요청', '기타', '방역', '기타', '기타 · 곰팡이 제거'])
eq('라벨 표 상속 이름은 라벨이 아니다', ['toString', 'constructor'].map(cleaningReasonLabel), ['toString', 'constructor'])
eq('고정 라벨과 같은 글자는 목록에 못 들어가 코드 행과 화면 글자가 안 겹친다', CLEANING_REASON_CODES.every(c => reservedOptionNameError('cleaningReasons', cleaningReasonLabel(c)) !== null), true)
eq('재고 기록은 추적 품목으로 영업장을 거른다', optionRenameWhere({ model: 'stockDisposal', column: 'reason', via: 'trackedItem' }, 'P1', '파손'), { trackedItem: { propertyId: 'P1' }, reason: '파손' })
eq('무상 입수 출처도', optionRenameWhere({ model: 'stockAddition', column: 'source', via: 'trackedItem' }, 'P1', '기증'), { trackedItem: { propertyId: 'P1' }, source: '기증' })
eq('계약 칸은 영업장으로 바로', optionRenameWhere({ model: 'leaseTerm', column: 'overrideDueDayReason' }, 'P1', '급여 지연'), { propertyId: 'P1', overrideDueDayReason: '급여 지연' })

// ── 시스템 라벨을 적는 자리는 상수만 쓴다 ─────────────────────────
// 상태 이력 만들기 덩어리의 reason 칸에 글자를 바로 적으면 퇴실 사유 이어받기가 그 라벨을 운영자 사유로 읽는다.
function walk(dir: string, out: string[] = []): string[] {
  for (const n of readdirSync(dir)) {
    const p = join(dir, n)
    if (n === 'node_modules' || n.startsWith('.')) continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.tsx?$/.test(n)) out.push(p)
  }
  return out
}
let createBlocks = 0
for (const file of [...walk('app'), ...walk('lib'), ...walk('components')]) {
  const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
  for (const m of code.matchAll(/tenantStatusLog\.(create|createMany|update|updateMany)\(/g)) {
    let depth = 0, j = m.index + m[0].length - 1
    for (; j < code.length; j++) { if (code[j] === '(') depth++; else if (code[j] === ')' && --depth === 0) break }
    const blk = code.slice(m.index, j + 1)
    createBlocks++
    // reason 칸의 값 식(그 줄 끝까지)에 글자가 하나라도 있으면 잡는다. 삼항(… ? '라벨' : …)으로 감싸도 걸린다.
    for (const r of blk.matchAll(/\breason\s*:([^\n]*)/g)) {
      // 한글이 든 글자만 본다(시스템 라벨은 한글이다). 'short' 같은 비교 글자는 값이 아니다.
      if (!/(['"`])[^'"`\n]*[가-힣][^'"`\n]*\1/.test(r[1])) continue
      fails.push(`${file}:${code.slice(0, m.index + (r.index ?? 0)).split('\n').length} · 상태 이력 사유 칸에 글자를 바로 적는다. 시스템 라벨이면 lib/statusReasons 상수(SYSTEM_STATUS_REASONS)를 쓴다. 안 그러면 퇴실 사유 이어받기가 그 라벨을 운영자 사유로 읽는다.`)
    }
  }
}
eq('상태 이력 쓰기 자리를 찾았다(그물이 살아 있다)', createBlocks >= 12, true)

if (fails.length) {
  console.error(`test-reason-lists: ${fails.length}건 실패 / ${pass} 통과`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`test-reason-lists: ${pass}건 통과 (저장 규약 ${TABLE.length}줄 · 상태 이력 쓰기 ${createBlocks}곳 검사)`)
