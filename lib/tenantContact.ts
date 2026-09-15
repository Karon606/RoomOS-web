// 입주자의 대표 전화번호를 고르는 정본 — 서류에 찍히는 번호와 문자가 갈 번호가 같은 규칙을 쓴다.
//
// 왜 정본이 필요한가. 같은 물음("이 사람의 전화번호")에 답하는 자리가 화면·서류·문자·내보내기에
// 흩어져 있고, 그 답이 자리마다 달랐다. 실제로 쓰이던 규칙이 셋이었다.
//   · `isPrimary && !isEmergency` 다음 `!isEmergency` 아무거나 — 계약서·실거주 확인서
//   · `contactType: 'PHONE'` 중 먼저 만든 것 — 문자 수신자 넷
//   · `isPrimary` 아무거나(비상 포함) — 목록·내보내기
// 세 규칙이 같은 사람에게 서로 다른 번호를 답한다. 종이에 찍힌 번호로 연락이 안 되거나,
// 문자가 비상 연락처(본인이 아닌 사람)에게 가는 길이 그 사이에서 열린다.
//
// **본국 번호가 급소다.** 외국인 입주자는 본국 번호(`isHomeCountry`)를 주 연락처로 등록해 두는
// 일이 있는데, 옛 규칙 중 하나는 그것을 그대로 골랐다. 서류에는 +998 번호가 찍히고 문자는
// 어디로도 안 간다. 그래서 본국 번호는 **국내 번호가 하나도 없을 때의 마지막 폴백**이다.
//
// **비상 연락처는 어떤 갈래로도 안 잡는다.** 그 번호의 주인은 입주자가 아니다.
//
// 진리표는 scripts/test-tenant-phone.ts 가 쥔다. 규칙을 고치면 거기서 먼저 빨강이 나야 한다.

/** 고르는 데 필요한 최소 모양 — TenantContact 의 일곱 칸. */
export type TenantPhoneContact = {
  /**
   * createdAt 동률의 2차 정렬키. 한 트랜잭션에서 여러 연락처를 만들면 `now()` 가 같은 값으로
   * 박혀(실제로 입주자 등록 폼이 본인·비상·본국을 한 번에 넣는다) createdAt 만으로는 순서가
   * 안 정해진다. 그러면 같은 사람에게 화면마다 다른 번호가 답으로 나올 수 있다.
   */
  id: string
  contactType: string
  contactValue: string
  isPrimary: boolean
  isEmergency: boolean
  isHomeCountry: boolean
  createdAt: Date
}

/** 전화로 치는 연락 수단 — 기본값. 문자 갈래는 `['PHONE']` 만 넘긴다(유선으로는 문자가 안 간다). */
export const PHONE_CONTACT_KINDS = ['PHONE', 'LANDLINE'] as const

/**
 * 이 사람에게 연락할 번호 하나. 없으면 null.
 *
 * 순서는 다섯이다.
 *   ① 주 연락처(비상 아님 · 본국 아님 · kinds 안)
 *   ② 그 밖의 국내 번호 중 먼저 만든 것(비상 아님 · 본국 아님 · kinds 안)
 *   ③ 본국 번호 중 **주 연락처**(비상 아님 · kinds 안) — 국내 번호가 하나도 없을 때만
 *   ④ 그 밖의 본국 번호 중 먼저 만든 것
 *   ⑤ null
 *
 * ③이 ④보다 먼저인 이유는 ①과 ②의 관계와 같다 — **운영자가 손으로 고른 것이 만든 순서보다 세다.**
 * 본국 번호가 둘인 사람(옛 번호를 안 지우고 새 번호를 추가)에게 주 연락처 표시가 붙어 있으면
 * 그것이 지금 닿는 번호다. 폴백 안에서만 순서가 갈리므로 국내 번호가 있는 사람은 영향이 없다.
 *
 * **인자 배열은 제자리에서 정렬하지 않는다.** 같은 배열을 화면이 다른 용도로 또 쓰는 자리가 있다.
 * 호출부의 orderBy 가 무엇이든 답이 같아야 하므로 여기서 createdAt 오름차순(동률은 id)을 다시 세운다.
 */
export function pickTenantPhone(
  contacts: readonly TenantPhoneContact[],
  kinds: readonly string[] = PHONE_CONTACT_KINDS,
): string | null {
  const byAge = [...contacts].sort((a, b) =>
    (a.createdAt.getTime() - b.createdAt.getTime()) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const callable = byAge.filter(c => !c.isEmergency && kinds.includes(c.contactType))
  const local = callable.filter(c => !c.isHomeCountry)
  const home = callable.filter(c => c.isHomeCountry)
  const hit = local.find(c => c.isPrimary) ?? local[0]
    ?? home.find(c => c.isPrimary) ?? home[0]
  return hit?.contactValue ?? null
}

// ============================================================
// 대체(비상 연락처) — 위 정본이 null 을 답한 사람에게만 열리는 두 번째 문
//
// **왜 위를 안 고치고 밑에 다는가.** 위 함수의 `!c.isEmergency` 는 "그 번호의 주인은 입주자가
// 아니다"라는 사실이고, 그것이 종이(계약서·실거주 확인서)의 규칙이다. 관청에 내는 종이에
// 남의 번호를 대신 적을 수는 없다. 그래서 축을 가른다 — **종이는 위 문, 문자는 아래 문.**
//
// 문자는 사정이 다르다. 본인 번호가 아예 없는 사람에게 미납 안내를 못 보내는 것보다, 비상
// 연락처(가족)에게 가는 편이 낫다는 것이 운영자 결정(2026-09-16)이다. 다만 **누구에게 가는지**
// 화면이 반드시 말해야 한다 — 그래서 값만 돌려주지 않고 `source`·`ownerLabel` 을 같이 묶는다.
// 호출부가 `.value` 를 꺼낼 때 그 옆에 주인이 같이 보이는 것이 이 타입의 유일한 목적이다.
// ============================================================

/** 비상 연락처의 주인을 적으려면 두 칸이 더 필요하다(TenantContact 의 emergencyName·emergencyRelation). */
export type TenantPhoneContactWithOwner = TenantPhoneContact & {
  emergencyName?: string | null
  emergencyRelation?: string | null
}

/**
 * 고른 번호 하나와 **그 번호의 주인**.
 *
 * `source: 'emergency'` 면 이 번호는 입주자 본인 것이 아니다. 문자열 하나만 돌려주면 그 사실이
 * 호출부에서 증발하고, 화면은 본인에게 보내는 줄 안다. 묶어서 돌려주는 것이 유일한 방어다.
 */
export type PickedPhone = {
  value: string
  source: 'self' | 'emergency'
  /** 비상 연락처일 때 그 번호의 주인 — '김철수(부모님)' · '김철수' · '부모님' · null(둘 다 없음). */
  ownerLabel: string | null
}

/** 비상 연락처 주인 표기 네 갈래. 이름만·관계만·둘 다·없음. */
function emergencyOwnerLabel(c: TenantPhoneContactWithOwner): string | null {
  const name = (c.emergencyName ?? '').trim()
  const relation = (c.emergencyRelation ?? '').trim()
  if (name && relation) return `${name}(${relation})`
  return name || relation || null
}

/**
 * 문자가 갈 번호 — 본인 번호가 없으면 비상 연락처로 대체한다. 없으면 null.
 *
 * 본인 갈래는 위 정본(pickTenantPhone)을 그대로 부른다. 여기서 다시 세우지 않는다 — 두 벌이면
 * 문자와 종이가 같은 사람에게 다른 본인 번호를 답하게 된다.
 * 대체 갈래의 순서 규칙도 정본과 같다 — createdAt 오름차순, 동률은 id, kinds 안.
 * (비상 연락처는 폼이 한 사람에 하나만 만들지만, 엑셀 가져오기·옛 데이터에는 둘이 있다.)
 */
export function pickTenantPhoneWithFallback(
  contacts: readonly TenantPhoneContactWithOwner[],
  kinds: readonly string[] = PHONE_CONTACT_KINDS,
): PickedPhone | null {
  const self = pickTenantPhone(contacts, kinds)
  if (self != null) return { value: self, source: 'self', ownerLabel: null }
  const byAge = [...contacts].sort((a, b) =>
    (a.createdAt.getTime() - b.createdAt.getTime()) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  const hit = byAge.find(c => c.isEmergency && kinds.includes(c.contactType))
  if (!hit) return null
  return { value: hit.contactValue, source: 'emergency', ownerLabel: emergencyOwnerLabel(hit) }
}

/**
 * 앞뒤 공백을 걷고, 그러고 나서 빈 값이면 null — 문자 갈래 넷이 쓰던 `?.trim() || null` 한 벌이다.
 * 옛 데이터에 공백이 섞인 번호가 있고 그대로 sms: 링크에 실리면 번호가 깨진다.
 */
export function trimPickedPhone(picked: PickedPhone | null): PickedPhone | null {
  const value = picked?.value.trim()
  return picked && value ? { ...picked, value } : null
}

/**
 * 예약을 확정해도 되는가 — 본인 전화번호가 없으면 문구, 있으면 null.
 *
 * **왜 문이 필요한가.** 예약 확정은 방을 잡아 두고 다른 손님을 돌려보내는 결정이다. 그 사람에게
 * 연락할 길이 본인 번호로 없으면, 입주일에 안 오는 것을 당일에야 안다. 메신저 아이디만 있는
 * 경우도 막는다(운영자 결정 2026-09-16) — 문자·전화가 안 되는 아이디는 연락 수단으로 안 센다.
 * 유선전화와 해외 번호는 통과다. 전화가 걸리는 번호이기 때문이고, 문자가 안 가는 사정은
 * 폼 안내가 따로 말한다.
 *
 * **비상 연락처는 여기서 대체가 안 된다.** 문자는 대체해도 되지만(위 함수), 방을 잡아 두는
 * 결정의 근거로 남의 번호를 세울 수는 없다.
 *
 * @param alreadyConfirmed 이미 확정된 계약이면 통과 — 소급해서 막지 않는다. 옛 데이터에는 본인
 *   번호 없이 확정된 사람이 있고, 그 사람 이름을 고치려다 저장이 막히면 문이 일을 방해한다.
 */
export function reservationConfirmPhoneDenial(input: {
  contacts: readonly TenantPhoneContact[]
  alreadyConfirmed: boolean
}): string | null {
  if (input.alreadyConfirmed) return null
  if (pickTenantPhone(input.contacts, PHONE_CONTACT_KINDS) != null) return null
  // 본인 연락처 칸에 뭔가 적혀 있는데 전화가 아닌 경우 — 카카오 아이디만 적어 둔 사람이다.
  if (input.contacts.some(c => !c.isEmergency)) {
    return `${RESERVATION_PHONE_DENIAL_PREFIX} 전화번호는 필수입니다. 지금은 메신저 연락처만 등록돼 있습니다.`
  }
  if (input.contacts.length > 0) {
    return `${RESERVATION_PHONE_DENIAL_PREFIX} 연락처는 필수입니다. 지금은 비상 연락처만 등록돼 있습니다.`
  }
  return `${RESERVATION_PHONE_DENIAL_PREFIX} 연락처는 필수입니다. 등록된 연락처가 없습니다.`
}

/**
 * 위 세 문구의 공통 머리 — **화면이 이 거부를 알아보는 표식이다.**
 *
 * 문구로 갈래를 알아보는 것은 약한 방법이지만, 여기서 문구를 만들고 여기서 머리를 내주므로
 * 둘이 갈릴 수 없다(호출부가 제 손으로 적은 문자열과 맞추던 시절의 문제는 안 생긴다).
 * 이 표식을 보고 폼은 연락처 칸으로 데려가고, 전환 창은 '입주자 정보' 액션을 단다 —
 * 두 화면 다 고칠 칸이 그 창 안에 없어서 문구만으로는 갈 곳을 모른다.
 */
export const RESERVATION_PHONE_DENIAL_PREFIX = '예약 확정 시 본인'
