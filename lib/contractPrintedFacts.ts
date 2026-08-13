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
    /**
     * 외국인등록번호 축의 **이미 안전해진** 값. `900101-*******#<hmac8>` 모양이고 평문이 아니다.
     *
     * 여기서 마스킹·지문을 만들지 않는 이유가 둘이다. 하나, 지문 키가 lib/pii 에 있고 그 모듈은
     * 'server-only' 라 이 파일이 부르면 발급 상세 시트(클라이언트)가 통째로 빌드에서 깨진다.
     * 둘, 부르는 쪽이 값을 만들어 넣게 해 두면 **평문을 넣을 길 자체가 이 축에 없다.**
     * 등록번호가 없는 사람은 null 이다(축이 아예 없는 undefined 와 구분된다).
     */
    foreignRegNoFact?: string | null
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
  /**
   * 이 계약에 딸린 계약들(합본 계약서의 종속 호실 행). 종이에 찍히는 값이므로 축이 있어야 한다 —
   * 601호 창고의 호실이나 임료가 서명 뒤에 바뀌면 그 종이는 이미 사실과 다른 종이다.
   *
   * **없거나 비면 축 자체가 없는 것(undefined)으로 남는다.** 기존 발급본 2건은 이 칸을 모르므로,
   * 빈 배열을 `[]` 로 박으면 옛 박제(축 없음)와 지금(빈 배열)이 달라져 전건이 드리프트로 뜬다.
   */
  subLeases?: { roomNo: string | null; rentAmount: number }[] | null
  template?: unknown
}

/** 축 순서 — 발급 상세 시트가 이 순서로 표를 그린다(종이의 위에서 아래 순서). */
export const PRINTED_FACT_KEYS = [
  'tenant.name', 'tenant.birthdate', 'tenant.foreignRegNo', 'tenant.gender', 'tenant.primaryPhone',
  'tenant.smoking', 'tenant.emergencyContacts',
  'lease.roomNo', 'lease.moveInDate', 'lease.expectedMoveOut',
  'lease.rentAmount', 'lease.depositAmount', 'lease.cleaningFee',
  'lease.dueDay', 'lease.registrationStatus',
  'lease.subLeases',
  'template',
] as const

export type PrintedFactKey = (typeof PRINTED_FACT_KEYS)[number]

/** 사람이 읽는 축 이름 — 계약서 정보표의 라벨을 그대로 쓴다. */
export const PRINTED_FACT_LABEL: Record<PrintedFactKey, string> = {
  'tenant.name': '성명',
  'tenant.birthdate': '생년월일',
  'tenant.foreignRegNo': '외국인등록번호',
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
  'lease.subLeases': '추가 호실',
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
    // 이미 마스킹 + 지문으로 굳은 값만 지나간다. 평문이 이 축에 들어오는 길은 없다(위 타입 주석).
    'tenant.foreignRegNo': t?.foreignRegNoFact,
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
    // 종속 호실은 배열이라 통비교 — 호실이 바뀌어도, 임료가 바뀌어도, 한 줄이 늘거나 줄어도 잡힌다.
    // 비면 undefined 다(축 없음). 기존 박제 2건과 종속 없는 계약 전건이 여기서 무변동이어야 한다.
    // 축에 담는 것은 종이에 찍히는 두 값뿐이다. 계약 id 까지 담으면 방·금액이 그대로인데도
    // 계약을 지웠다 다시 만든 것만으로 드리프트가 뜬다.
    'lease.subLeases': d.subLeases?.length
      ? JSON.stringify(d.subLeases.map(s => ({ roomNo: s.roomNo, rentAmount: s.rentAmount })))
      : undefined,
    template: d.template ? JSON.stringify(d.template) : undefined,
  }
}
