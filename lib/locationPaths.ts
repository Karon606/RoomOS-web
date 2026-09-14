// 보관 위치 표기 경로 색인 정본(순수) — 행 목록을 트리로 엮어 id → pathName·DFS 랭크·역조회를 준다.
// 쿼리 0, DB 접근 0, Prisma 타입 의존 0. 조회(로더)는 app/(app)/inventory/locationPaths.ts 가 맡는다.
//
// 왜 lib 로 내렸나(독립 검수 2026-09-14). 색인이 로더와 한 파일에 있으면 prisma 를 물고 있어
// 순수 테스트가 못 붙는다. 그 사이 `pathName: id => byId.get(id)?.row.name` 한 줄로 되돌려도
// 화면 축 그물(check-location-name-axis)은 '.pathName 을 읽는가' 만 보므로 전부 초록인 채
// 열세 자리가 평면 이름으로 돌아간다. 색인 자체를 보는 진리표가 필요하다(scripts/test-location-paths.ts).
import { buildTree, flattenDfs, subtreeIds, type LocationRow, type LocationFlatRow } from './locationTree'

// DFS 랭크를 못 찾은 위치(이 영업장 밖·삭제분)는 맨 뒤로 — 순서에서 조용히 앞에 끼지 않게.
export const NO_RANK = Number.MAX_SAFE_INTEGER

export type LocationPathIndex = {
  rows: LocationFlatRow[]                                  // DFS 순(화면 순서 그대로)
  pathName: (id: string) => string | undefined
  rank: (id: string) => number                             // DFS 랭크. 미등록은 NO_RANK
  byPathName: (pathName: string) => LocationFlatRow | undefined  // 유일할 때만. 중복이면 undefined
  byName: (name: string) => LocationFlatRow | undefined    // 이름이 유일할 때만. 중복이면 undefined
}

/** 행 목록(조회 결과)을 표기 경로 색인으로. 순수 — 쿼리 0. */
export function indexLocations(rows: readonly LocationRow[]): LocationPathIndex {
  const flat = flattenDfs(buildTree(rows))
  const byId = new Map(flat.map((r, i) => [r.id, { row: r, rank: i }]))
  const unique = (hits: LocationFlatRow[]) => (hits.length === 1 ? hits[0] : undefined)
  return {
    rows: flat,
    pathName: id => byId.get(id)?.row.pathName,
    rank: id => byId.get(id)?.rank ?? NO_RANK,
    // 중복이면 undefined — byName 과 같은 규칙이다. 역조회가 둘 중 아무거나 찍으면
    // 비품 배정 이력이 엉뚱한 위치로 돌아간다(표시 오염이 아니라 데이터 오염).
    byPathName: p => unique(flat.filter(r => r.pathName === p)),
    byName: n => unique(flat.filter(r => r.name === n)),
  }
}

// 새로 만드는 노드를 임시로 얹을 때 쓰는 자리표 id. 위치 id 는 Prisma cuid 라 이 글자와 겹치지 않는다.
const DRAFT_ID = '__draft__'

/**
 * 이 영업장 안에서 **전체 이름(pathName)이 겹치는가**. 겹치면 그 pathName, 아니면 null.
 *
 * 형제 이름 유일(siblingNameTaken)은 같은 부모 안에서만 본다. 그래서 루트 `4층 김치냉장고 상단`
 * (오늘의 평면 데이터)과 트리 `4층 김치냉장고` 아래 `상단` 은 둘 다 통과하고 pathName 이 글자까지
 * 같아진다 — 이관 과도기에 실제로 생기는 모양이다. 화면에는 같은 칩이 둘 뜨고, 비품 이력
 * 역조회(byPathName)는 중복이라 아무것도 못 찍는다. 영업장 전체에서 한 번 더 봐야 하는 이유다.
 *
 * id 가 null 이면 생성, 아니면 그 노드의 이동·이름 바꾸기다. 이동은 **서브트리 자손의 새 pathName
 * 까지** 본다 — 부모가 바뀌면 자손 경로가 통째로 바뀌므로 옮긴 노드만 봐서는 반쪽이다.
 */
export function conflictingPathName(
  rows: readonly LocationRow[],
  id: string | null,
  parentId: string | null,
  name: string,
): string | null {
  const trimmed = name.trim()
  if (trimmed === '') return null
  // 바뀌는 쪽 = 자기 자신 + 자손 전부(이동해도 서브트리 구성은 그대로다).
  const changed = new Set(id === null ? [DRAFT_ID] : subtreeIds(rows, id))
  const next: LocationRow[] = rows.map(r => (r.id === id ? { ...r, parentId, name: trimmed } : r))
  if (id === null) next.push({ id: DRAFT_ID, parentId, name: trimmed, sortOrder: NO_RANK })
  const idx = indexLocations(next)
  const others = new Set(idx.rows.filter(r => !changed.has(r.id)).map(r => r.pathName))
  for (const r of idx.rows) {
    if (!changed.has(r.id)) continue
    if (others.has(r.pathName)) return r.pathName
  }
  return null
}
