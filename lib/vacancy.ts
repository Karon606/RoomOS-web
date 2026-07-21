// 공실 집계 정의 정본(오류신고 9d844226) — 화면마다 공실 수가 갈라지지 않게 '집계 제외'를 한 곳에서 정의.
// 집계 제외 방 = 비거주 계약(NON_RESIDENT) 점유 + nonResidentVacant=false (창고·사무실 등).
//   설정 위치: 호실관리 편집의 '비거주 점유 시 공실로 표시하지 않음' 체크박스. 해제하면 즉시 집계 복귀(undo).
// 제외 방은 공실에도 입실에도 넣지 않는다(입실 = 전체 − 공실 − 제외, 운영자 결정 2026-07-21).
// 스키마 변경 없음 — 2026-07-06 도입된 Room.nonResidentVacant 재활용.

// Prisma where 조각 — 집계 제외 방. 공실 카운트는 { isVacant: true, NOT: vacancyExcludedWhere },
// 제외 수 카운트는 { isVacant: true, ...vacancyExcludedWhere }.
export const vacancyExcludedWhere = {
  nonResidentVacant: false,
  leaseTerms: { some: { status: 'NON_RESIDENT' as const } },
}

// 이미 로드된 방 객체용 술어 — leaseTerms 조회에 NON_RESIDENT 가 포함된 결과에 사용.
export function isVacancyExcluded(room: { nonResidentVacant: boolean }, occupiedByNonResident: boolean): boolean {
  return occupiedByNonResident && !room.nonResidentVacant
}
