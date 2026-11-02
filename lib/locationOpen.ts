// 보관 위치 '열림' 판정 정본: 위치 사용 중지(StorageLocation.closedAt)와 품목별 숨김(TrackedItemLocation.closedAt) 두 축을 한 곳에서 본다.
import { subtreeIds, type LocationRow } from '@/lib/locationTree'
//
// 왜 정본이 따로 서는가(2026-10-28 운영자 승인 '보관 위치 닫기' 2단계). 닫힘이 두 층이 됐다. 품목 하나가 그 위치를 숨긴 것
// (링크의 closedAt)과 위치 자체를 창고로 더 안 쓰는 것(위치의 closedAt). 고르는 자리·허브 리졸버·쓰기 거부가 저마다 한쪽만
// 보면 사용 중지한 창고가 미지정 입수의 귀속처가 되거나(허브 폴백) 옮기기 목적지로 다시 뜬다. 그래서 열린 링크의 뜻을 여기
// 한 줄로 두고, Prisma 조건 사본은 app/(app)/inventory/openLink.ts 한 곳에만 둔다. 진리표는 scripts/test-location-open.ts.
//
// 남는 자리(이력)는 이 판정을 쓰지 않는다. 지난 점검·이관·입수 줄, 위치 관리 목록, pathName 색인은 닫힌 위치도 그대로 센다.

type Closable = { closedAt?: Date | string | null }

/** 위치 자체가 사용 중인가. */
export function isOpenLocation(loc: Closable): boolean {
  return loc.closedAt == null
}

/** 품목-위치 링크가 열려 있는가 = 품목이 숨기지 않았고 위치도 사용 중이다. */
export function isOpenLink(link: Closable, loc: Closable): boolean {
  return link.closedAt == null && loc.closedAt == null
}

export type ClosableRow = LocationRow & { closedAt?: Date | string | null; isHub?: boolean }

/** 사용 중지할 때 함께 닫는 id. 그 위치와 자손 중 아직 열린 것(결정 5). 이미 닫힌 자손의 날짜는 덮지 않는다. */
export function closeTargetIds(rows: readonly ClosableRow[], id: string): string[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  return subtreeIds(rows, id).filter(s => isOpenLocation(byId.get(s) ?? {}))
}

/** 다시 사용할 수 있는가. 조상이 전부 열려 있어야 한다(결정 5). 닫힌 조상이 있으면 그 id. */
export function closedAncestorOf(rows: readonly ClosableRow[], id: string): string | null {
  const byId = new Map(rows.map(r => [r.id, r]))
  const seen = new Set<string>()
  let cur = byId.get(id)?.parentId ?? null
  while (cur && !seen.has(cur)) {
    seen.add(cur)
    const p = byId.get(cur)
    if (!p) return null
    if (!isOpenLocation(p)) return p.id
    cur = p.parentId
  }
  return null
}

/**
 * 사용 중지에 새 기본 창고가 필요한가, 고른 값이 쓸 수 있는가(결정 4).
 * 닫는 서브트리 안에 영업장 기본 창고가 있으면 필수이고, 새 기본 창고는 열린 위치이면서 닫는 서브트리 밖이어야 한다.
 */
export function newDefaultProblem(
  rows: readonly ClosableRow[], closingIds: readonly string[], newDefaultId: string | null,
): 'required' | 'invalid' | null {
  const closing = new Set(closingIds)
  const needs = rows.some(r => r.isHub && closing.has(r.id))
  if (!newDefaultId) return needs ? 'required' : null
  const target = rows.find(r => r.id === newDefaultId)
  if (!target || !isOpenLocation(target) || closing.has(newDefaultId)) return 'invalid'
  return null
}

/** 사용 중지 창의 목적지 기본값. 새 기본 창고, 없으면 지금 기본 창고(열려 있고 닫는 서브트리 밖일 때), 그것도 없으면 빈 값. */
export function defaultDestinationId(
  rows: readonly ClosableRow[], closingIds: readonly string[], newDefaultId: string | null,
): string {
  if (newDefaultId) return newDefaultId
  const closing = new Set(closingIds)
  const hub = rows.find(r => r.isHub && isOpenLocation(r) && !closing.has(r.id))
  return hub?.id ?? ''
}

// 사용 중지한 위치를 고른 쓰기의 거부 문장(§27.8 ⑤ 두 마디). 서버 쓰기 자리 전부와 화면 이유 캡션이 이 한 벌을 쓴다.
export const LOCATION_CLOSED_DENIED = '사용 중지한 위치라서 고를 수 없습니다. 보관 위치 관리에서 다시 사용하면 됩니다.'
// 사용 중지한 위치 아래로 넣는 쓰기(아래 칸 추가·옮기기·끌어 놓기)의 거부 문장.
export const PARENT_CLOSED_DENIED = '사용 중지한 위치 아래에는 넣을 수 없습니다. 보관 위치 관리에서 상위 위치를 다시 사용하면 됩니다.'
