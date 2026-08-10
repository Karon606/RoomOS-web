// 계약서 종이에 실제로 인쇄되는 값만 뽑은 사영(15축) — 드리프트 비교와 발급본 박제가 같은 축을 쓴다.
//
// 원래 app/(app)/tenants/contractShare.ts 안에만 있었다. 발급본 박제(ContractFile.issuedSnapshot)가
// 같은 축을 필요로 하는데 거기서 서버 액션 파일을 import 할 수는 없어, 축의 정의를 lib 로 올렸다.
// **두 벌을 만들지 마라.** 축이 갈리는 순간 "발급 때 경고가 없었는데 기록에는 다르게 남는" 상태가 된다.
//
// 값이 undefined 면 '이 데이터에 그 축이 없다'는 뜻이다(비교하는 쪽이 그 사실을 읽는다).

/** printedFacts 가 읽는 최소 모양. lib/contractData 의 ContractData 가 구조적으로 이것을 만족한다. */
export type PrintedFactsInput = {
  tenant?: {
    name?: string
    birthdate?: string | null
    gender?: string
    primaryPhone?: string | null
    smoking?: boolean
    emergencyContacts?: Array<{ name: string; phone: string; relation: string | null }>
  } | null
  lease?: {
    rentAmount?: number
    depositAmount?: number
    cleaningFee?: number
    dueDay?: string | null
    moveInDate?: string | null
    expectedMoveOut?: string | null
    roomNo?: string | null
    registrationStatus?: string
  } | null
  template?: unknown
}

/** 축 순서 — 발급 상세 시트가 이 순서로 표를 그린다(종이의 위에서 아래 순서). */
export const PRINTED_FACT_KEYS = [
  'tenant.name', 'tenant.birthdate', 'tenant.gender', 'tenant.primaryPhone',
  'tenant.smoking', 'tenant.emergencyContacts',
  'lease.roomNo', 'lease.moveInDate', 'lease.expectedMoveOut',
  'lease.rentAmount', 'lease.depositAmount', 'lease.cleaningFee',
  'lease.dueDay', 'lease.registrationStatus',
  'template',
] as const

export type PrintedFactKey = (typeof PRINTED_FACT_KEYS)[number]

/** 사람이 읽는 축 이름 — 계약서 정보표의 라벨을 그대로 쓴다. */
export const PRINTED_FACT_LABEL: Record<PrintedFactKey, string> = {
  'tenant.name': '성명',
  'tenant.birthdate': '생년월일',
  'tenant.gender': '성별',
  'tenant.primaryPhone': '연락처',
  'tenant.smoking': '흡연',
  'tenant.emergencyContacts': '비상연락망',
  'lease.roomNo': '호실',
  'lease.moveInDate': '입실일',
  'lease.expectedMoveOut': '퇴실 예정일',
  'lease.rentAmount': '입실료',
  'lease.depositAmount': '보증금',
  'lease.cleaningFee': '청소비',
  'lease.dueDay': '매월 납부일',
  'lease.registrationStatus': '전입신고',
  template: '계약서 본문',
}

/**
 * 인쇄 사실 사영. 비교할 필드를 호출부가 손으로 나열하면 축이 늘 때마다 한 곳을 잊는다 —
 * 실제로 입실자 인적사항이 통째로 빠져 있어서 서명 뒤 이름이 바뀌어도 발급 경고가 안 떴다.
 */
export function printedFacts(d: PrintedFactsInput): Record<string, unknown> {
  const t = d.tenant
  const l = d.lease
  return {
    'tenant.name': t?.name,
    'tenant.birthdate': t?.birthdate,
    'tenant.gender': t?.gender,
    'tenant.primaryPhone': t?.primaryPhone,
    'tenant.smoking': t?.smoking,
    // 비상연락망은 배열이라 통비교 — 번호가 바뀌어도, 한 줄이 늘거나 줄어도 잡힌다.
    'tenant.emergencyContacts': t?.emergencyContacts ? JSON.stringify(t.emergencyContacts) : undefined,
    'lease.rentAmount': l?.rentAmount,
    'lease.depositAmount': l?.depositAmount,
    'lease.cleaningFee': l?.cleaningFee,
    'lease.dueDay': l?.dueDay,
    'lease.moveInDate': l?.moveInDate,
    'lease.expectedMoveOut': l?.expectedMoveOut,
    'lease.roomNo': l?.roomNo,
    'lease.registrationStatus': l?.registrationStatus,
    template: d.template ? JSON.stringify(d.template) : undefined,
  }
}
