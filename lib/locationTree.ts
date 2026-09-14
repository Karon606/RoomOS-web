// 보관 위치 트리 정본 — 평면 행 목록을 부모·자식으로 엮고, 표기 경로·깊이·순환·형제 이름을
// 판정하는 순수 함수. 쿼리 0, DB 접근 0, Prisma 타입 의존 0.
//
// 트리는 표시·그룹핑 층일 뿐이다. 허브·잔량·숨김·박제·전파 다섯 기제는 전부 storageLocationId
// 집합 위에서 돌고 그 집합은 트리와 무관하게 평면이다 — 이 파일은 그 집합을 건드리지 않는다.
//
// 지키는 불변식 셋(재고는 잎에만, 이 아니다 — 모든 노드가 자기 재고를 가진다).
//   1. 순환 없음        — 자기 자신·자손 아래로 옮길 수 없다(wouldCycle).
//   2. 깊이 상한 4      — 루트가 1단계, MAX_DEPTH 를 넘는 자리는 거부한다(depthOf).
//   3. 형제 이름 유일   — 같은 부모(루트는 parentId null 끼리) 아래 같은 이름은 없다(siblingNameTaken).
//
// 표기는 조상 이름을 **공백으로** 이어 붙인다. `4층 김치냉장고` 아래 `상단` 이면
// `4층 김치냉장고 상단` — 오늘의 평면 이름과 글자가 같다. 트리를 안 만든 영업장은 픽셀 하나
// 안 바뀌고, 만든 영업장도 보던 문자열 그대로다. 구조는 트리 화면이 들여쓰기로 말한다.
//
// 함수는 전부 행 목록을 첫 인자로 받는다 — 호출부가 쥔 것이 언제나 행 목록이고,
// 숨은 상태가 없어야 순수가 성립한다(lib/stockLedger 와 같은 결).

// 깊이 상한. 루트가 1단계이므로 `4층 주방 > 김치냉장고 > 상단 > 앞칸` 까지 허용이고 그 아래는 거부다.
export const MAX_DEPTH = 4

// 입력 행 — Prisma 모델이 아니라 이 네 필드만이 계약이다.
export type LocationRow = {
  id: string
  parentId: string | null
  name: string
  sortOrder: number
}

export type LocationNode = LocationRow & { children: LocationNode[] }

export type LocationTree = {
  roots: LocationNode[]
  // parentId 가 가리키는 부모가 입력에 없는 행 — 루트로 올려 살린다(조용히 사라지면 재고가 화면에서 증발한다).
  orphanIds: string[]
  // 저장된 데이터가 이미 순환일 때 그 고리에 묶인 행 — 역시 루트로 끊어내 살리고 보고한다.
  cycleIds: string[]
}

// 표기 경로 한 행 — flattenDfs 의 출력.
export type LocationFlatRow = LocationRow & { depth: number; pathName: string }

const bySort = (a: LocationRow, b: LocationRow) =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name) || a.id.localeCompare(b.id)

/**
 * 평면 행을 트리로 엮는다. 형제는 sortOrder 순(같으면 이름·id 순으로 안정 정렬).
 * 부모를 못 찾는 행(고아)과 순환에 묶인 행은 루트로 올리고 id 를 함께 돌려준다 — 한 행도 잃지 않는다.
 */
export function buildTree(rows: readonly LocationRow[]): LocationTree {
  const byId = new Map<string, LocationNode>()
  for (const r of rows) {
    byId.set(r.id, { id: r.id, parentId: r.parentId, name: r.name, sortOrder: r.sortOrder, children: [] })
  }

  const orphanIds: string[] = []
  const roots: LocationNode[] = []
  for (const node of byId.values()) {
    if (node.parentId === null) { roots.push(node); continue }
    const parent = byId.get(node.parentId)
    if (!parent) { orphanIds.push(node.id); roots.push(node); continue }
    parent.children.push(node)
  }

  // 루트에서 못 닿는 행 = 순환 고리. 고리마다 한 행씩 루트로 끊어 올려 전부 살린다.
  const cycleIds: string[] = []
  const reached = new Set<string>()
  const walk = (n: LocationNode) => { reached.add(n.id); for (const c of n.children) walk(c) }
  for (const r of roots) walk(r)
  for (const node of byId.values()) {
    if (reached.has(node.id)) continue
    cycleIds.push(node.id)
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) parent.children = parent.children.filter(c => c.id !== node.id)
    roots.push(node)
    walk(node)
  }

  roots.sort(bySort)
  for (const node of byId.values()) node.children.sort(bySort)
  return { roots, orphanIds, cycleIds }
}

/**
 * 트리를 깊이우선으로 펼쳐 화면 순서 그대로 돌려준다. depth 는 루트가 1,
 * pathName 은 조상 이름을 공백으로 이은 표기(루트는 name 그대로).
 */
export function flattenDfs(tree: LocationTree): LocationFlatRow[] {
  const out: LocationFlatRow[] = []
  const walk = (node: LocationNode, depth: number, prefix: string) => {
    const pathName = prefix ? `${prefix} ${node.name}` : node.name
    out.push({ id: node.id, parentId: node.parentId, name: node.name, sortOrder: node.sortOrder, depth, pathName })
    for (const c of node.children) walk(c, depth + 1, pathName)
  }
  for (const r of tree.roots) walk(r, 1, '')
  return out
}

/** 자기 자신을 포함한 서브트리의 id 집합. 없는 id 면 빈 배열. */
export function subtreeIds(rows: readonly LocationRow[], id: string): string[] {
  if (!rows.some(r => r.id === id)) return []
  const childrenOf = new Map<string, string[]>()
  for (const r of rows) {
    if (r.parentId === null) continue
    const list = childrenOf.get(r.parentId)
    if (list) list.push(r.id)
    else childrenOf.set(r.parentId, [r.id])
  }
  const out: string[] = []
  const seen = new Set<string>()
  const stack = [id]
  while (stack.length > 0) {
    const cur = stack.pop() as string
    if (seen.has(cur)) continue
    seen.add(cur)
    out.push(cur)
    for (const c of childrenOf.get(cur) ?? []) stack.push(c)
  }
  return out
}

/** id 를 newParentId 아래로 옮기면 순환이 되는가. 자기 자신·자기 자손이 부모가 되는 경우가 전부다. */
export function wouldCycle(rows: readonly LocationRow[], id: string, newParentId: string | null): boolean {
  if (newParentId === null) return false
  if (newParentId === id) return true
  return subtreeIds(rows, id).includes(newParentId)
}

/**
 * 루트가 1인 깊이. 없는 id 거나 조상 사슬이 끊기면 0.
 * 순환에 묶인 id 도 0 — 깊이를 셀 수 없는 자리이므로 호출부가 MAX_DEPTH 검사로 막게 한다.
 */
export function depthOf(rows: readonly LocationRow[], id: string): number {
  const byId = new Map(rows.map(r => [r.id, r]))
  let cur = byId.get(id)
  if (!cur) return 0
  let depth = 1
  const seen = new Set<string>([id])
  while (cur.parentId !== null) {
    const parent = byId.get(cur.parentId)
    if (!parent || seen.has(parent.id)) return 0
    seen.add(parent.id)
    cur = parent
    depth++
  }
  return depth
}

/**
 * 같은 부모 아래 같은 이름이 이미 있는가. parentId null 이면 루트 형제끼리 본다
 * (Postgres 유니크는 NULL 을 서로 다르게 보므로 DB 쪽은 부분 유니크 인덱스가 맡고, 여기가 1차 검사다).
 * 앞뒤 공백은 떼고 비교한다 — 표기가 공백 결합이라 `상단` 과 `상단 ` 이 화면에서 구분되지 않는다.
 */
export function siblingNameTaken(
  rows: readonly LocationRow[],
  parentId: string | null,
  name: string,
  exceptId?: string,
): boolean {
  const target = name.trim()
  if (target === '') return false
  return rows.some(r => r.parentId === parentId && r.id !== exceptId && r.name.trim() === target)
}

/**
 * 옮길 때의 '앞부분 떼기' 제안. `4층 김치냉장고 상단` 을 `4층 김치냉장고` 아래로 넣으면 `상단`.
 * 접두가 안 맞거나 떼면 빈 이름이 되면 원래 이름을 그대로 돌려준다(제안 없음 = 원본).
 */
export function stripPrefixSuggestion(childName: string, parentPathName: string): string {
  const prefix = parentPathName.trim()
  if (prefix === '') return childName
  const child = childName.trim()
  if (!child.startsWith(`${prefix} `)) return childName
  const rest = child.slice(prefix.length).trim()
  return rest === '' ? childName : rest
}
