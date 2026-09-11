// 품목 빠른선택 칩의 유형 분리 규칙 정본 — 한 질의로 받은 양쪽 유형 행을 가른다.
//
// 물품과 서비스·무형은 칩 목록이 완전히 갈린다(운영자 확정 2026-07-08). 그 분리는 그대로 둔다.
// 다만 종전 질의는 where 로 한쪽만 걸러 와서, 반대편에 이력이 있다는 사실을 화면이 알 길이 없었다.
// 9/5 '옥상 폐기물처리'(서비스)를 다음날 물품 폼에서 찾지 못한 신고가 그 자리다.
// 질의를 늘리지 않고 그 사실만 얻으려고, groupBy 키에 유형을 더해 받은 행을 여기서 가른다.
export type QuickPickTypedRow = {
  itemLabel: string | null
  excludeFromInventory: boolean
  _count: { _all: number }
  _max: { date: Date | null }
}

/**
 * service=true 면 excludeFromInventory:true 가 '같은 유형'이다(재고 제외 = 서비스·무형).
 * same 은 입력 순서를 그대로 둔다 — 순위는 호출부의 rank 가 정한다.
 * otherTypeCount 는 행 수가 아니라 지출 건수 합이다. 화면 문안이 '{n}건' 이라고 말한다.
 */
export function splitQuickPickRows(
  rows: QuickPickTypedRow[], service: boolean,
): { same: QuickPickTypedRow[]; otherTypeCount: number } {
  const same: QuickPickTypedRow[] = []
  let otherTypeCount = 0
  for (const r of rows) {
    if (r.excludeFromInventory === service) same.push(r)
    else otherTypeCount += r._count._all
  }
  return { same, otherTypeCount }
}
