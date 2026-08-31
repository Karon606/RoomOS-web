// 퇴실 처리 폼의 '퇴실일' 기본값 정본 — 세 경로가 같은 날짜를 제안한다.
//
// **미리 적어 둔 퇴실 예정일이 기본이다** (운영자 확정 2026-08-31). 그날이 지나도 오늘로
// 바뀌지 않는다. 9월 10일에 처리하더라도 칸에 8월 31일이 있으면 8월 31일에 퇴실한 것이다.
//
// 종전에는 항상 오늘이었다(2026-07-28 오더). 그래서 하루 늦게 처리하면 안 고친 사람에게
// 하루가 더 붙었다. 이 칸의 날짜가 일할 정산·환불·거주 구간 마감·보증금 반환일의 기준이라
// 기본값 하나가 돈을 움직인다.
//
// 사람이 고치면 그 날짜가 실제 퇴실일이다. 9월 1일로 고치면 하루 더 산 것이라 더 받고,
// 8월 30일로 고치면 하루 일찍 나간 것이라 그만큼 돌려준다. 기본값은 제안일 뿐 확인은 사람이 한다.
export function defaultCheckoutYmd(expectedMoveOut: string | Date | null | undefined, todayYmd: string): string {
  if (!expectedMoveOut) return todayYmd
  const ymd = typeof expectedMoveOut === 'string'
    ? expectedMoveOut.slice(0, 10)
    : new Date(expectedMoveOut).toISOString().slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(ymd) ? ymd : todayYmd
}
