// 계약서 발급물 표시값 오버라이드 — 화이트리스트 파싱·검증·병합 정본(수납·청구 산식과 무접점).
//
// 관 제출용처럼 실계약과 다른 표시값이 필요한 계약서가 있다. 그렇다고 LeaseTerm 의 원천 컬럼
// (rentAmount·depositAmount·cleaningFee·dueDay·moveInDate·expectedMoveOut·registrationStatus·방 배정)을
// 고치면 청구·수납·정산이 통째로 따라 움직인다. 그래서 표시값만 따로 담는 sparse JSON 을 두고
// **계약서 렌더 경로에서만** 덮어쓴다. 존재하는 키만 덮으므로 나머지는 언제나 자동값이다.
//
// 이 파일이 유일한 진입점이다. 화면·PDF 발급·서명 링크 스냅샷이 같은 함수를 부르므로
// 종이와 스냅샷이 갈릴 수 없다.

import {
  type DocNameStyle, DEFAULT_DOC_NAME_STYLE, asDocNameStyle,
} from '@/lib/documentName'

export type RegistrationStatusLabel = '신고' | '미신고' | '면제'

/**
 * 오버라이드 가능한 9개 표시 필드. 전부 optional 이고, 없는 키는 자동값이 그대로 쓰인다.
 *
 * nameStyle 만 성격이 다르다 — 나머지 여덟은 '자동값 대신 이 값을 찍어라'(값 복사)인데
 * 이것은 '등록된 두 이름 중 이쪽을 찍어라'(표기 선택)다. 값을 베끼지 않으므로 고객 정보에서
 * 이름을 고치면 서류도 따라 고쳐진다. 그럼에도 같은 칸에 담는 이유는 잠금·되돌리기·서명 링크
 * 스냅샷·감지망이 전부 이 칸에 이미 걸려 있어서다. 자리를 새로 파면 그 넷을 손으로 다시 잇게 된다.
 */
export type ContractFieldOverrides = {
  rentAmount?: number
  depositAmount?: number
  cleaningFee?: number
  moveInDate?: string          // YYYY-MM-DD
  expectedMoveOut?: string     // YYYY-MM-DD
  dueDay?: string              // '14' | '말'
  roomNo?: string
  registrationStatus?: RegistrationStatusLabel
  nameStyle?: DocNameStyle     // 성명 표기 — 'ko'(기본) | 'en' | 'native'
}

export type ContractFieldOverrideKey = keyof ContractFieldOverrides

/** 저장 요청 패치 — null 또는 빈 문자열이면 그 키를 지운다(필드 단위 적용취소). */
export type ContractFieldOverridePatch = Partial<Record<ContractFieldOverrideKey, string | number | null>>

export const CONTRACT_FIELD_KEYS: readonly ContractFieldOverrideKey[] = [
  'rentAmount', 'depositAmount', 'cleaningFee',
  'moveInDate', 'expectedMoveOut', 'dueDay', 'roomNo', 'registrationStatus', 'nameStyle',
]

/** 검증에 걸린 키를 운영자에게 설명하는 문구. 화면이 "저장 안 됨"만 말하면 이유를 끝내 못 알려준다. */
export const CONTRACT_FIELD_ERROR: Record<ContractFieldOverrideKey, string> = {
  rentAmount: '입실료는 0원 이상 1억원 이하의 숫자로 입력해 주세요.',
  depositAmount: '보증금은 0원 이상 1억원 이하의 숫자로 입력해 주세요.',
  cleaningFee: '청소비는 0원 이상 1억원 이하의 숫자로 입력해 주세요.',
  moveInDate: '입실일 날짜 형식이 올바르지 않습니다.',
  expectedMoveOut: '퇴실 예정일 날짜 형식이 올바르지 않습니다.',
  dueDay: '매월 납부일은 1부터 31 사이의 숫자 또는 말 로 입력해 주세요.',
  roomNo: '호실은 20자 이내로 입력해 주세요.',
  registrationStatus: '전입신고는 신고, 미신고, 면제 중에서 골라 주세요.',
  nameStyle: '성명 표기는 한글, 영문, 현지 중에서 골라 주세요.',
}

const AMOUNT_MAX = 100_000_000
const ROOM_NO_MAX = 20
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DUE_DAY_RE = /^(말일?|([1-9]|[12]\d|3[01]))$/

const asAmount = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined
  if (v < 0 || v > AMOUNT_MAX) return undefined
  return v
}

const asDate = (v: unknown): string | undefined => {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return undefined
  // 2026-02-31 같은 없는 날짜를 정규식은 통과시킨다. 실제 날짜인지 되돌려 확인한다.
  const d = new Date(`${v}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return undefined
  return v
}

const asDueDay = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  // 형식을 여기서 막는다. 아무 문자열이나 통과시키면 계약서에 '매월 NaN일' 이 인쇄된다.
  return DUE_DAY_RE.test(t) ? t : undefined
}

const asRoomNo = (v: unknown): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t && t.length <= ROOM_NO_MAX ? t : undefined
}

const asRegistration = (v: unknown): RegistrationStatusLabel | undefined =>
  v === '신고' || v === '미신고' || v === '면제' ? v : undefined

/** 저장된 JSON 을 읽어 화이트리스트 키만, 타입·범위를 통과한 것만 남긴다. 불량 키는 버린다. */
export function parseContractFieldOverrides(json: unknown): ContractFieldOverrides {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const src = json as Record<string, unknown>
  const out: ContractFieldOverrides = {}
  const rent = asAmount(src.rentAmount); if (rent !== undefined) out.rentAmount = rent
  const dep = asAmount(src.depositAmount); if (dep !== undefined) out.depositAmount = dep
  const cln = asAmount(src.cleaningFee); if (cln !== undefined) out.cleaningFee = cln
  const mi = asDate(src.moveInDate); if (mi !== undefined) out.moveInDate = mi
  const mo = asDate(src.expectedMoveOut); if (mo !== undefined) out.expectedMoveOut = mo
  const due = asDueDay(src.dueDay); if (due !== undefined) out.dueDay = due
  const room = asRoomNo(src.roomNo); if (room !== undefined) out.roomNo = room
  const reg = asRegistration(src.registrationStatus); if (reg !== undefined) out.registrationStatus = reg
  const ns = asDocNameStyle(src.nameStyle); if (ns !== undefined) out.nameStyle = ns
  return out
}

/** 계약서에 인쇄되는 lease 표시값 9종. 자동값(파생)과 병합값이 같은 모양이라 서로 갈릴 수 없다. */
export type ContractLeaseFields = {
  moveInDate: string | null
  expectedMoveOut: string | null
  rentAmount: number
  depositAmount: number
  cleaningFee: number
  dueDay: string | null
  roomNo: string | null
  registrationStatus: RegistrationStatusLabel
  // 성명 표기는 사람(Tenant)의 값이 아니라 **이 계약서를 어떻게 찍을지**의 선택이라 계약에 달린다.
  // 같은 사람도 관 제출용 계약서는 영문, 보관용은 한글일 수 있다.
  nameStyle: DocNameStyle
}

const REGISTRATION_LABEL: Record<string, RegistrationStatusLabel> = {
  REGISTERED: '신고', NOT_REPORTED: '미신고', EXEMPTED: '면제',
}

/** 계약서 표시값의 원천이 되는 LeaseTerm 행(방 조인 포함). */
export type ContractLeaseRow = {
  moveInDate: Date | null
  expectedMoveOut: Date | null
  rentAmount: number
  depositAmount: number
  cleaningFee: number
  dueDay: string | null
  registrationStatus: string
  room?: { roomNo: string } | null
  contractFieldOverrides?: unknown
}

/** 오버라이드를 뺀 자동값. 정규화(자동값과 같은 키 제거)의 기준이기도 하다. */
export function deriveContractLeaseFields(lease: ContractLeaseRow): ContractLeaseFields {
  return {
    moveInDate: lease.moveInDate ? new Date(lease.moveInDate).toISOString().slice(0, 10) : null,
    expectedMoveOut: lease.expectedMoveOut ? new Date(lease.expectedMoveOut).toISOString().slice(0, 10) : null,
    rentAmount: lease.rentAmount,
    depositAmount: lease.depositAmount,
    cleaningFee: lease.cleaningFee,
    dueDay: lease.dueDay,
    roomNo: lease.room?.roomNo ?? null,
    registrationStatus: REGISTRATION_LABEL[lease.registrationStatus] ?? '미신고',
    nameStyle: DEFAULT_DOC_NAME_STYLE,
  }
}

/** 자동값 위에 존재하는 오버라이드 키만 덮어 반환. */
export function mergeContractLeaseFields(base: ContractLeaseFields, json: unknown): ContractLeaseFields {
  return { ...base, ...parseContractFieldOverrides(json) }
}

/** 계약서 렌더가 쓸 최종 표시값 — 파생 + 병합을 한 번에. 렌더 경로는 전부 이 함수를 쓴다. */
export function contractLeaseFields(lease: ContractLeaseRow): ContractLeaseFields {
  return mergeContractLeaseFields(deriveContractLeaseFields(lease), lease.contractFieldOverrides)
}

/**
 * 저장 패치를 기존 오버라이드에 얹어 정규화한다.
 *   - null·빈 문자열 키는 제거(필드 단위 적용취소)
 *   - 자동값과 같아진 키도 제거(오버라이드로 남길 이유가 없다)
 *   - 검증에 걸린 키는 invalidKeys 로 돌려준다 — 조용히 버리면 운영자는 저장된 줄 안다
 *   - 남은 키가 없으면 null (컬럼을 비운다)
 */
export function normalizeContractFieldOverrides(
  stored: unknown,
  patch: ContractFieldOverridePatch,
  auto: ContractLeaseFields,
): { value: ContractFieldOverrides | null; invalidKeys: ContractFieldOverrideKey[] } {
  const next: Record<string, unknown> = { ...parseContractFieldOverrides(stored) }
  const invalidKeys: ContractFieldOverrideKey[] = []

  for (const key of CONTRACT_FIELD_KEYS) {
    if (!(key in patch)) continue
    const raw = patch[key]
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      delete next[key]
      continue
    }
    next[key] = raw
  }

  const parsed = parseContractFieldOverrides(next) as Record<string, unknown>
  // 패치로 값을 넣으려 했는데 파싱에서 사라졌다면 검증에 걸린 것이다.
  for (const key of CONTRACT_FIELD_KEYS) {
    if (!(key in patch)) continue
    if (next[key] !== undefined && parsed[key] === undefined) invalidKeys.push(key)
  }
  if (invalidKeys.length) return { value: null, invalidKeys }

  const autoMap = auto as unknown as Record<string, unknown>
  for (const key of CONTRACT_FIELD_KEYS) {
    if (parsed[key] !== undefined && parsed[key] === autoMap[key]) delete parsed[key]
  }
  const value = parsed as ContractFieldOverrides
  return { value: Object.keys(value).length ? value : null, invalidKeys: [] }
}
