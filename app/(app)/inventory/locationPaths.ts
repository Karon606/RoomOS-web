// 보관 위치 표기 경로 로더 — 영업장 위치 전체를 한 번 읽어 색인(lib/locationPaths)으로 준다.
// 'use server' 아님(클라이언트 비노출). 화면에 찍는 위치 이름은 전부 여기서 나온 pathName 이고,
// 트리를 안 만든 영업장은 pathName 이 name 과 글자가 같아 한 픽셀도 안 바뀐다.
//
// 왜 한 자리인가. 위치 이름을 읽는 자리가 재고·비품 양쪽에 스무 곳이 넘는다. 각자 조회하면
// 어느 하나가 평면 name 에 남아 `4층 김치냉장고 상단` 이 어떤 화면에선 `상단` 으로 떠 같은
// 위치가 두 이름으로 보인다. 조회도 한 번으로 묶어 화면당 왕복을 늘리지 않는다.
//
// 색인·유일 검사(순수)는 lib/locationPaths 에 산다 — prisma 를 물지 않아야 진리표
// (scripts/test-location-paths.ts)가 붙는다. 여기서는 조회만 하고 그대로 다시 내보낸다.
import prisma from '@/lib/prisma'
import { indexLocations, type LocationPathIndex } from '@/lib/locationPaths'

export { indexLocations, conflictingPathName, NO_RANK } from '@/lib/locationPaths'
export type { LocationPathIndex } from '@/lib/locationPaths'

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
