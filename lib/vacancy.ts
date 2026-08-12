// 공실 집계 정의 정본(오류신고 9d844226) — 화면마다 공실 수가 갈라지지 않게 '집계 제외'를 한 곳에서 정의.
// 집계 제외 방 = 방 설정 nonResidentVacant=false (창고·사무실 등 세를 놓지 않는 방).
//   설정 위치: 호실관리 편집의 '공실 집계에서 제외' 체크박스. 해제하면 즉시 집계 복귀(undo).
// 제외 방은 공실에도 입실에도 넣지 않는다(입실 = 전체 − 공실 − 제외, 운영자 결정 2026-07-21).
// 스키마 변경 없음 — 2026-07-06 도입된 Room.nonResidentVacant 재활용.
//
// 왜 비거주 계약 점유를 조건에서 뺐나 (2026-08-13, 1인 다호실 시공 1단계).
//   종전 정의는 'nonResidentVacant=false **그리고** NON_RESIDENT 계약이 있는 방'이었다. 415호·사무실은
//   명의자가 있어 둘 다 참이었지만, 옥탑 창고 601~604 처럼 **계약이 아직·영영 없는 창고**는 플래그를
//   내려도 제외가 안 됐다. 세를 놓지 않는 방이 공실 수를 올리면 공실률이 거짓이 된다.
//   '이 방이 세를 놓는 방인가'는 방 자체의 사실이지 누가 명의를 걸었는지에 달린 사실이 아니다 —
//   그래서 조건에서 계약을 뺀다. 실데이터 영향 0: 플래그가 내려간 방(415·사무실)은 이미 둘 다 참이었다.
//   418호처럼 '공실로 세라'(nonResidentVacant=true)인 거주·비거주 동거 방은 종전대로 제외되지 않는다.

// Prisma where 조각 — 집계 제외 방. 공실 카운트는 { isVacant: true, NOT: vacancyExcludedWhere },
// 제외 수 카운트는 { isVacant: true, ...vacancyExcludedWhere }.
export const vacancyExcludedWhere = {
  nonResidentVacant: false,
}

// 이미 로드된 방 객체용 술어 — 같은 판정을 메모리에서.
export function isVacancyExcluded(room: { nonResidentVacant: boolean }): boolean {
  return !room.nonResidentVacant
}
