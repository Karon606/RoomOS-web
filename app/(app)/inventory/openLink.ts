// 열린 보관 위치·열린 품목 링크의 Prisma 조건 정본(판정 정본 lib/locationOpen isOpenLink 의 쿼리 사본, 여기 한 곳뿐).
//
// 'use server' 아님. 상수만 담는다. 허브 리졸버(ledgerShift)·재고 액션·비품 후보가 위치 후보를 고를 때 이 조건을 쓴다.
// 사용 중지한 위치(StorageLocation.closedAt)와 품목이 숨긴 위치(TrackedItemLocation.closedAt)를 함께 거른다.
// 감지망 scripts/check-location-actions-wiring.mjs ⓚ 가 쓰는 자리를 본다.

/** 사용 중인 위치. StorageLocation where 에 펼친다. */
export const OPEN_LOCATION_WHERE = { closedAt: null } as const

/** 열린 품목 링크 = 품목이 안 숨겼고 위치도 사용 중. TrackedItemLocation where 에 펼친다. */
export const OPEN_LINK_WHERE = { closedAt: null, storageLocation: { closedAt: null } } as const
