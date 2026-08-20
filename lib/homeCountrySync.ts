// 국적을 따라 전화 국가를 옮길지 가르는 규칙 정본 — 본국 연락처 칸이 쓴다(신고 aed91367).
//
// 규칙을 컴포넌트 밖으로 뽑은 이유는 하나다. 여기서 무너지는 방식이 조용하기 때문이다 —
// 운영자가 손으로 고친 나라가 국적을 만지는 순간 되돌아가도 화면은 아무 말도 하지 않고,
// 저장된 뒤에야 다른 나라 번호가 된다. 회귀 케이스가 이 함수 하나만 통과하면 그 길이 잠긴다.
//
// 판정 축은 넷이다.
//   1. 국적이 매핑에 없거나 비어 있으면 아무것도 안 한다(next 부재). 틀린 나라를 심는 것보다
//      종전 값을 그대로 두는 것이 낫다 — 목록에 없는 이름은 옛 자유입력분뿐이다.
//   2. 국적이 그대로면 안 한다. 마운트 시점 값은 이미 기본값이 반영하고 있다.
//   3. 운영자가 국가를 손으로 고른 뒤에는 어떤 자동 채움도 덮지 않는다. 신고 6f264a8f 가
//      세운 규칙과 같은 문법이다(FinanceClient 의 userPickedCategoryRef).
//   4. 번호가 이미 적혀 있으면 안 한다. 국가가 바뀌면 재포맷이 같은 숫자를 새 나라 번호로
//      다시 읽어(+81 이 +84 가 된다) 저장값이 조용히 다른 번호가 된다.

export type HomeCountrySyncInput = {
  /** 국적에서 얻은 ISO 코드. 매핑에 없으면 undefined. */
  next: string | undefined
  /** 직전에 반영한 국적 코드. 이것과 같으면 국적이 안 바뀐 것이다. */
  prev: string | undefined
  /** 전화번호 칸에 적힌 것이 있는가. */
  hasNumber: boolean
  /** 운영자가 국가 셀렉트를 손으로 고른 적이 있는가. */
  userPicked: boolean
}

export function shouldSyncPhoneCountry(input: HomeCountrySyncInput): boolean {
  const { next, prev, hasNumber, userPicked } = input
  if (!next) return false
  if (next === prev) return false
  if (userPicked) return false
  if (hasNumber) return false
  return true
}
