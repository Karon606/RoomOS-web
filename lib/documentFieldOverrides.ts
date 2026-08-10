// 발급 서류 표시값 오버라이드 — 화이트리스트 파싱·검증·병합 정본(수납·청구 산식과 무접점).
//
// 운영자가 실거주 확인서에서 손으로 고친 값이 어디에도 남지 않아 발급할 때마다 같은 수정을
// 반복해야 했다. 한 번 빠뜨리면 전과 다른 서류가 관청에 나간다. 그래서 고친 값을 저장한다.
//
// 계약서 칸(LeaseTerm.contractFieldOverrides)을 나눠 쓰지 않는다. 세 서류는 서로 다른 사실을
// 말한다 — 계약서=약정 정가, 납부확인서=실수납, 실거주확인서=거주 사실 + 운영자 재량
// (운영자 결정 2026-08-08). 값을 공유하면 한 서류를 고칠 때 다른 서류가 따라 움직인다.
// 저장은 DocumentFieldOverride 의 서류별 **행**이고, 이 파일이 그 값의 유일한 진입점이다.
//
// 문법은 lib/contractFieldOverrides 와 같다 — 자동값(파생) 위에 존재하는 키만 덮고,
// 자동값과 같아진 키는 저장에서 뺀다. 낡은 값이 쌓이지 않게 하는 1차 방어다.

import { tenantResidenceAddress } from '@/lib/tenantAddress'
import {
  type DocNameStyle, DEFAULT_DOC_NAME_STYLE, asDocNameStyle,
} from '@/lib/documentName'

/** 표시값 저장을 연 서류. 납부확인서·보증금영수증은 계약 단위로 저장할 값이 없어 아직 없다. */
export const DOC_TYPES = ['RESIDENCE_CERT'] as const
export type DocOverrideType = (typeof DOC_TYPES)[number]

/**
 * 실거주 확인서에서 저장을 연 6개 표시 필드. 전부 optional 이고, 없는 키는 자동값이 그대로 쓰인다.
 *
 * nameStyle 은 2026-08-11 에 붙었다. 성명은 '인적사항 — 저장 안 함'으로 분류돼 있었는데
 * (2026-08-08 4층 분류), 그 결정은 **이름 값을 서류 칸에 베끼는 것**을 막으려던 것이다. 여기 담는
 * 것은 값이 아니라 '등록된 두 이름 중 어느 쪽을 찍는가'라 낡을 수가 없다 — 고객 정보에서 철자를
 * 고치면 다음 발급에 그대로 따라온다. 성명 칸 자체는 여전히 저장 대상이 아니고, 손으로 고친 이름은
 * 그 발급에만 쓰인다.
 */
export type ResidenceCertOverrides = {
  siteAddress?: string
  tenantAddress?: string
  periodText?: string
  rentAmount?: number
  depositAmount?: number
  nameStyle?: DocNameStyle
}

export type ResidenceCertOverrideKey = keyof ResidenceCertOverrides

/** 저장 요청 패치 — null 또는 빈 문자열이면 그 키를 지운다(필드 단위 적용취소). */
export type ResidenceCertOverridePatch = Partial<Record<ResidenceCertOverrideKey, string | number | null>>

export const RESIDENCE_CERT_KEYS: readonly ResidenceCertOverrideKey[] = [
  'siteAddress', 'tenantAddress', 'periodText', 'rentAmount', 'depositAmount', 'nameStyle',
]

/** 화면·감지망이 함께 쓰는 사람 말 이름. 두 곳에서 따로 지으면 같은 칸이 다르게 불린다. */
export const RESIDENCE_CERT_FIELD_LABEL: Record<ResidenceCertOverrideKey, string> = {
  siteAddress: '소재지',
  tenantAddress: '임차인 주소',
  periodText: '거주 기간',
  rentAmount: '임대료',
  depositAmount: '보증금',
  nameStyle: '성명 표기',
}

/** 검증에 걸린 키를 운영자에게 설명하는 문구. 화면이 "저장 안 됨"만 말하면 이유를 끝내 못 알려준다. */
export const RESIDENCE_CERT_FIELD_ERROR: Record<ResidenceCertOverrideKey, string> = {
  siteAddress: '소재지는 120자 이내로 입력해 주세요.',
  tenantAddress: '임차인 주소는 120자 이내로 입력해 주세요.',
  periodText: '거주 기간은 60자 이내로 입력해 주세요.',
  rentAmount: '임대료는 0원 이상 1억원 이하의 숫자로 입력해 주세요.',
  depositAmount: '보증금은 0원 이상 1억원 이하의 숫자로 입력해 주세요.',
  nameStyle: '성명 표기는 한글, 영문 중에서 골라 주세요.',
}

const AMOUNT_MAX = 100_000_000
const ADDRESS_MAX = 120
const PERIOD_MAX = 60

const asAmount = (v: unknown): number | undefined => {
  if (typeof v !== 'number' || !Number.isInteger(v)) return undefined
  if (v < 0 || v > AMOUNT_MAX) return undefined
  return v
}

const asText = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t && t.length <= max ? t : undefined
}

/** 저장된 JSON 을 읽어 화이트리스트 키만, 타입·범위를 통과한 것만 남긴다. 불량 키는 버린다. */
export function parseResidenceCertOverrides(json: unknown): ResidenceCertOverrides {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return {}
  const src = json as Record<string, unknown>
  const out: ResidenceCertOverrides = {}
  const site = asText(src.siteAddress, ADDRESS_MAX); if (site !== undefined) out.siteAddress = site
  const addr = asText(src.tenantAddress, ADDRESS_MAX); if (addr !== undefined) out.tenantAddress = addr
  const period = asText(src.periodText, PERIOD_MAX); if (period !== undefined) out.periodText = period
  const rent = asAmount(src.rentAmount); if (rent !== undefined) out.rentAmount = rent
  const dep = asAmount(src.depositAmount); if (dep !== undefined) out.depositAmount = dep
  const ns = asDocNameStyle(src.nameStyle); if (ns !== undefined) out.nameStyle = ns
  return out
}

/** 실거주 확인서에 인쇄되는 표시값 6종. 자동값(파생)과 병합값이 같은 모양이라 서로 갈릴 수 없다. */
export type ResidenceCertFieldValues = {
  siteAddress: string
  tenantAddress: string
  periodText: string
  rentAmount: number
  depositAmount: number
  nameStyle: DocNameStyle
}

/** 자동값의 원천 — 계약 행(방 조인) + 영업장 주소. */
export type ResidenceCertSource = {
  propertyAddress: string | null | undefined
  roomNo: string | null | undefined
  moveInDate: Date | null
  expectedMoveOut: Date | null
  rentAmount: number
  depositAmount: number
}

const ymd = (d: Date | null | undefined) => (d ? new Date(d).toISOString().slice(0, 10) : '')

/** 'YYYY-MM-DD' → 'YYYY. M. D' (양식에 찍히는 표기). */
export function fmtCertDate(d: string): string {
  if (!d) return ''
  const [y, m, dd] = d.split('-')
  if (!y) return d
  return `${y}. ${Number(m)}. ${Number(dd)}`
}

/**
 * 거주 기간 한 줄. 퇴실 예정일이 없으면 종료일을 비운다(운영자 결정 2026-08-08) — 종전에는
 * 오늘 날짜를 채워 발급일마다 값이 달라졌다. 시작일까지 없으면 칸을 통째로 비워 양식에 인쇄된
 * '20 . . . ~ 20 . . .' 빈칸이 그대로 보이게 둔다.
 * 화면과 저장 정규화가 이 문자열을 글자 단위로 대조하므로 조립은 여기 한 곳에서만 한다.
 */
export function residenceCertPeriodText(startYmd: string, endYmd: string): string {
  const start = fmtCertDate(startYmd)
  const end = fmtCertDate(endYmd)
  if (!start) return ''
  return end ? `${start}  ~  ${end}` : `${start}  ~`
}

/** 오버라이드를 뺀 자동값. 정규화(자동값과 같은 키 제거)의 기준이기도 하다. */
export function deriveResidenceCertFields(src: ResidenceCertSource): ResidenceCertFieldValues {
  // 소재지·임차인 주소 = 영업장 주소 + 방번호(lib/tenantAddress 정본). 두 칸의 자동값은 같지만
  // 따로 덮을 수 있어야 한다 — 건물 주소와 입주자 주소를 다르게 적어 내는 관청이 있다.
  const address = tenantResidenceAddress(src.propertyAddress, src.roomNo)
  return {
    siteAddress: address,
    tenantAddress: address,
    periodText: residenceCertPeriodText(ymd(src.moveInDate), ymd(src.expectedMoveOut)),
    rentAmount: src.rentAmount,
    depositAmount: src.depositAmount,
    // 성명 표기의 자동값은 늘 한글이다 — 계약 행에서 파생할 것이 없다.
    nameStyle: DEFAULT_DOC_NAME_STYLE,
  }
}

/** 자동값 위에 존재하는 오버라이드 키만 덮어 반환. */
export function mergeResidenceCertFields(
  base: ResidenceCertFieldValues,
  json: unknown,
): ResidenceCertFieldValues {
  return { ...base, ...parseResidenceCertOverrides(json) }
}

/**
 * 저장 패치를 기존 오버라이드에 얹어 정규화한다(계약서 선례와 같은 규칙).
 *   - null·빈 문자열 키는 제거(필드 단위 적용취소)
 *   - 자동값과 같아진 키도 제거(오버라이드로 남길 이유가 없다)
 *   - 검증에 걸린 키는 invalidKeys 로 돌려준다 — 조용히 버리면 운영자는 저장된 줄 안다
 *   - 남은 키가 없으면 null (행을 지운다)
 */
export function normalizeResidenceCertOverrides(
  stored: unknown,
  patch: ResidenceCertOverridePatch,
  auto: ResidenceCertFieldValues,
): { value: ResidenceCertOverrides | null; invalidKeys: ResidenceCertOverrideKey[] } {
  const next: Record<string, unknown> = { ...parseResidenceCertOverrides(stored) }
  const invalidKeys: ResidenceCertOverrideKey[] = []

  for (const key of RESIDENCE_CERT_KEYS) {
    if (!(key in patch)) continue
    const raw = patch[key]
    if (raw === null || raw === undefined || (typeof raw === 'string' && !raw.trim())) {
      delete next[key]
      continue
    }
    next[key] = raw
  }

  const parsed = parseResidenceCertOverrides(next) as Record<string, unknown>
  // 패치로 값을 넣으려 했는데 파싱에서 사라졌다면 검증에 걸린 것이다.
  for (const key of RESIDENCE_CERT_KEYS) {
    if (!(key in patch)) continue
    if (next[key] !== undefined && parsed[key] === undefined) invalidKeys.push(key)
  }
  if (invalidKeys.length) return { value: null, invalidKeys }

  const autoMap = auto as unknown as Record<string, unknown>
  for (const key of RESIDENCE_CERT_KEYS) {
    if (parsed[key] !== undefined && parsed[key] === autoMap[key]) delete parsed[key]
  }
  const value = parsed as ResidenceCertOverrides
  return { value: Object.keys(value).length ? value : null, invalidKeys: [] }
}
