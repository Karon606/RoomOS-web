// 분할 복제가 빠뜨린 칸을 같은 묶음 원행에서만 되살리는 판정 정본(순수). 백필 스크립트와 DB 그물이 같은 함수를 쓴다.
//
// 왜 (2026-10-20, 신고 a0636f36 재무 패널 맥락). 한 구매 행을 쪼개는 자리 넷 중 소모품 부분 수령(inventory/actions
// confirmReceipt)은 손으로 쓴 복제 목록이었고, 비품 분할 셋도 2026-09-16 정본(cloneExpenseScalars)이 서기 전에는 그랬다.
// 그 목록이 사업자번호·브랜드·제품명·서술 규격·단가 기준·시공/자재 표식을 빠뜨려, 쪼개져 나온 조각에서만 그 칸이 비었다.
//
// 근거가 있는 것만 되살린다.
//   · 같은 allocationGroupId 묶음 안에서만 본다. 쪼개진 조각은 원행의 묶음 id 를 물려받거나 새로 받아 원행과 함께 쓴다.
//   · 원행은 묶음에서 가장 먼저 만들어진 저장 한 번(첫 행과 SAME_SAVE_MS 안에 생긴 행들)이다. 방별 분배는 한 저장에서
//     여러 행이 함께 생긴다(대방도배사 실측, 몇 ms 차이). 그 행들끼리 칸 값이 갈리면 어느 쪽이 원래 값인지 모르므로 그 칸은
//     건너뛴다. 같은 저장에서 생긴 행은 조각이 아니다(쪼개기는 수령·옮기기·폐기 때 따로 일어난다).
//   · 그 저장보다 나중에 생긴 조각이고, 같은 구매(품명·카테고리·날짜·구매처가 같다)일 때만이다.
//   · 원행에 값이 있고 조각이 비었을 때만 채운다. 조각에 다른 값이 있으면 안 덮는다. 원행이 비었는데 조각에만
//     값이 있으면 운영자가 그 조각에 나중에 적은 것이라 퍼뜨리지 않는다(시공/자재 표식이 그 모양이다, 실측).
//   · 칸이 생기기 전에 만들어진 원행의 값은 나중에 적힌 것이라 유실 근거가 없다(FIELD_RECORDED_SINCE, 독립 검수 2026-10-20).
//     장판 원행(05-29~07-01)의 단가 기준 'qty' 가 그 모양이다. 칸(unitBasis·specText)은 2026-07-03 6c0d1cf2 에 생겼다.
//     knowledge/domain-unit-basis '없는 기록을 지어내지 않는다'.
// 'use server' 파일이 아니다. 스크립트(tsx)와 진리표가 함께 읽는다.

export const CLONE_LOSS_FIELDS = ['vendorBizNo', 'brand', 'productName', 'specText', 'unitBasis', 'costKind'] as const
export type CloneLossField = typeof CLONE_LOSS_FIELDS[number]

export type CloneLossRow = {
  id: string
  allocationGroupId: string | null
  createdAt: Date
  itemLabel: string | null
  category: string
  /** 'YYYY-MM-DD'. 같은 구매인지 가르는 데만 쓴다. */
  date: string
  vendor: string | null
} & Record<CloneLossField, string | null>

export type CloneRestore = { id: string; groupId: string; originId: string; field: CloneLossField; value: string }

const same = (a: string | null, b: string | null) => (a?.trim() || null) === (b?.trim() || null)

/**
 * 칸이 생긴 시각. 원행이 이보다 먼저 만들어졌으면 그 칸 값은 만들 때 적힌 것이 아니므로 되살리지 않는다.
 * 사업자번호(07-23)·브랜드·제품명(08-27)·시공/자재(08-27)는 독립 검수가 유지를 판정했다(IKEA·콰이디 실측 5칸). 표에 없는 칸은 제한하지 않는다.
 */
export const FIELD_RECORDED_SINCE: Partial<Record<CloneLossField, Date>> = {
  unitBasis: new Date('2026-07-03T19:49:06+09:00'),
  specText: new Date('2026-07-03T19:49:06+09:00'),
}

/** 한 저장에서 함께 생긴 행으로 보는 간격. 배열 트랜잭션 한 번은 ms 단위로 끝나고, 쪼개기는 사람이 따로 누른 뒤다. */
export const SAME_SAVE_MS = 2000

/** 되살릴 칸 목록. 행 순서와 무관하게 같은 답을 낸다. */
export function planCloneFieldRestore(rows: readonly CloneLossRow[]): CloneRestore[] {
  const groups = new Map<string, CloneLossRow[]>()
  for (const r of rows) {
    if (!r.allocationGroupId) continue
    const arr = groups.get(r.allocationGroupId)
    if (arr) arr.push(r); else groups.set(r.allocationGroupId, [r])
  }
  const out: CloneRestore[] = []
  for (const [groupId, members] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (members.length < 2) continue
    const first = Math.min(...members.map(m => m.createdAt.getTime()))
    const batch = members.filter(m => m.createdAt.getTime() - first < SAME_SAVE_MS)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    const origin = batch[0]
    // 같은 저장의 행들이 모두 같은 구매여야 원행으로 믿는다.
    if (!batch.every(m => same(m.itemLabel, origin.itemLabel) && m.category === origin.category && m.date === origin.date && same(m.vendor, origin.vendor))) continue
    const pieces = members
      .filter(m => m.createdAt.getTime() - first >= SAME_SAVE_MS)
      .filter(m => same(m.itemLabel, origin.itemLabel) && m.category === origin.category && m.date === origin.date && same(m.vendor, origin.vendor))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    for (const f of CLONE_LOSS_FIELDS) {
      const vals = new Set(batch.map(m => m[f]?.trim() || null))
      if (vals.size !== 1) continue   // 같은 저장의 행끼리 갈렸다. 원래 값을 모른다.
      const v = origin[f]
      if (v == null || v.trim() === '') continue
      const since = FIELD_RECORDED_SINCE[f]
      if (since && origin.createdAt < since) continue   // 칸이 생기기 전 원행: 값이 나중에 적혔다
      for (const p of pieces) {
        if (p[f] == null || p[f]!.trim() === '') out.push({ id: p.id, groupId, originId: origin.id, field: f, value: v })
      }
    }
  }
  return out
}
