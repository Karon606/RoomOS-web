// 보관 위치 표기 경로 정본 — 영업장 위치 전체를 lib/locationTree 로 엮어 id → pathName·DFS 랭크를 준다.
// 'use server' 아님(클라이언트 비노출). 화면에 찍는 위치 이름은 전부 여기서 나온 pathName 이고,
// 트리를 안 만든 영업장은 pathName 이 name 과 글자가 같아 한 픽셀도 안 바뀐다.
//
// 왜 한 자리인가. 위치 이름을 읽는 자리가 재고·비품 양쪽에 스무 곳이 넘는다. 각자 조회하면
// 어느 하나가 평면 name 에 남아 `4층 김치냉장고 상단` 이 어떤 화면에선 `상단` 으로 떠 같은
// 위치가 두 이름으로 보인다. 조회도 한 번으로 묶어 화면당 왕복을 늘리지 않는다.
import prisma from '@/lib/prisma'
import { buildTree, flattenDfs, type LocationRow, type LocationFlatRow } from '@/lib/locationTree'

// DFS 랭크를 못 찾은 위치(이 영업장 밖·삭제분)는 맨 뒤로 — 순서에서 조용히 앞에 끼지 않게.
const NO_RANK = Number.MAX_SAFE_INTEGER

export type LocationPathIndex = {
  rows: LocationFlatRow[]                                  // DFS 순(화면 순서 그대로)
  pathName: (id: string) => string | undefined
  rank: (id: string) => number                             // DFS 랭크. 미등록은 NO_RANK
  byPathName: (pathName: string) => LocationFlatRow | undefined
  byName: (name: string) => LocationFlatRow | undefined    // 이름이 유일할 때만. 중복이면 undefined
}

/** 행 목록(조회 결과)을 표기 경로 색인으로. 순수 — 쿼리 0. */
export function indexLocations(rows: readonly LocationRow[]): LocationPathIndex {
  const flat = flattenDfs(buildTree(rows))
  const byId = new Map(flat.map((r, i) => [r.id, { row: r, rank: i }]))
  return {
    rows: flat,
    pathName: id => byId.get(id)?.row.pathName,
    rank: id => byId.get(id)?.rank ?? NO_RANK,
    byPathName: p => flat.find(r => r.pathName === p),
    byName: n => {
      const hits = flat.filter(r => r.name === n)
      return hits.length === 1 ? hits[0] : undefined
    },
  }
}

// 트리를 엮는 데 필요한 네 칸. 호출부가 isHub 를 더 쓰면 select 를 펼쳐 쓰고 이 상수는 참고만 한다.
export const LOCATION_TREE_SELECT = { id: true, parentId: true, name: true, sortOrder: true } as const

/** 이 영업장 위치 전체를 한 번 읽어 색인으로. 쿼리 1. */
export async function loadLocationPaths(propertyId: string): Promise<LocationPathIndex> {
  const rows = await prisma.storageLocation.findMany({
    where: { propertyId },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: LOCATION_TREE_SELECT,
  })
  return indexLocations(rows)
}
