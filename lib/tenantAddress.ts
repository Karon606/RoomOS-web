// 서류에 인쇄되는 호실 표기·입주자 실거주 주소 조립 정본(순수 함수 — 서버·클라이언트 공용).
//
// 고시원은 입주자에게 별도 주소가 없다. 실거주 주소 = 영업장 주소 + 방번호가 도메인 사실이고,
// 방번호를 뺀 실거주 확인서를 제출했다가 관청에서 연락을 받았다(2026-08-08). 병기는 취향이 아니라
// 서류 유효성 요건이다. 서류마다 제 방식으로 조립하면 또 갈리므로 조립은 여기 한 곳에서만 한다.

/** 호실 표기 — 숫자만이면 '호'를 붙이고, 글자가 섞이면(예: 사무실) 그대로 쓴다. */
export function roomLabel(roomNo: string | null | undefined): string {
  if (!roomNo) return ''
  const t = roomNo.trim()
  return /^\d+$/.test(t) ? `${t}호` : t
}

/**
 * 입주자 실거주 주소 = 영업장 주소 + 방번호.
 * 방이 배정되지 않은 계약(비거주·호실 미지정)은 병기할 방번호가 없어 영업장 주소만 돌려준다.
 * 영업장 주소가 비어 있으면 방번호만 돌려준다 — 어느 쪽도 빈 조각을 붙여 공백을 만들지 않는다.
 */
export function tenantResidenceAddress(
  propertyAddress: string | null | undefined,
  roomNo: string | null | undefined,
): string {
  const base = (propertyAddress ?? '').trim()
  const room = roomLabel(roomNo)
  if (!base) return room
  if (!room) return base
  return `${base} ${room}`
}
