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
