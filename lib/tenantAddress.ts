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

// 주소 꼬리의 층 표기 — '4,5층' '4~5층' ', 4~5층' '지하1층' 'B1층'. 방번호를 붙일 때만 걷는다.
// 영업장 주소는 층까지가 소재지지만, 거기에 호를 이으면 '4~5층 418호'가 된다(운영자 지적
// 2026-09-07 — 층과 호가 겹쳐 이상한 주소). 마지막 토큰일 때만 본다 — 중간의 층 표기는
// 건물명 일부일 수 있어 손대지 않는다.
const FLOOR_TAIL_RE = /[\s,]*(?:지하\s*\d+|[Bb]\d+|\d+(?:\s*[~\-,.]\s*\d+)?)\s*층$/

/**
 * 입주자 실거주 주소 = 영업장 주소 + 방번호. 주소 끝의 층 표기는 방번호가 그 자리를 대신하므로
 * 걷어낸다(위 FLOOR_TAIL_RE). 방이 배정되지 않은 계약(비거주·호실 미지정)은 병기할 방번호가
 * 없어 영업장 주소를 **층 표기까지 그대로** 돌려준다 — 층은 호가 없을 때의 유효한 소재 표기다.
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
  return `${base.replace(FLOOR_TAIL_RE, '').trim()} ${room}`
}
