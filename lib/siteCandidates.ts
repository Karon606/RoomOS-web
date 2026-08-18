// 소개 페이지 반영 대기 모집단 정본 — 소개 페이지에 실린 것과 실제 운영이 어긋난 방을 한 곳에서 정의한다.
//
// 두 갈래다.
//   올릴 방 — 공실이고 사진이 있는데 아직 미공개(showOnSite=false). 지금 손님에게 내보일 수 있는 방이다.
//   내릴 방 — 입주 중인데 아직 공개 상태(showOnSite=true). 없는 방을 팔고 있는 셈이다.
// 둘 다 집계 제외 방(창고·사무실, lib/vacancy)은 뺀다 — 팔 수 있는 방이 아니다. 415호에 사진만 올리면
// 손님에게 내보이라고 권하던 자리다.
//
// 홈은 이 모집단의 **건수 한 줄**만 말하고, 실제로 올리고 내리는 일은 환경설정 웹사이트 탭에서 한다.
// 두 화면이 각자 where 를 쓰면 홈이 2건이라 부른 것을 탭이 3건으로 그린다 — 그래서 여기 한 벌뿐이다.
// 켜고 끄는 정본은 별개다: app/(app)/room-manage/actions.ts 의 setRoomShowOnSite(사진 0장이면 켜기 거부).

import prisma from '@/lib/prisma'
import { vacancyExcludedWhere } from '@/lib/vacancy'

/** 화면이 한 줄을 그리는 데 필요한 만큼만 — 썸네일은 정렬 첫 장 하나. */
export type SiteRoomCandidate = {
  id: string
  roomNo: string
  tier: string | null
  baseRent: number
  thumbUrl: string | null
}

export type SiteRoomCandidates = {
  publish: SiteRoomCandidate[]
  unpublish: SiteRoomCandidate[]
}

const publishWhere = (propertyId: string) => ({
  propertyId, isVacant: true, showOnSite: false, photos: { some: {} }, NOT: vacancyExcludedWhere,
})
const unpublishWhere = (propertyId: string) => ({
  propertyId, isVacant: false, showOnSite: true, NOT: vacancyExcludedWhere,
})

const candidateSelect = {
  id: true, roomNo: true, tier: true, baseRent: true,
  photos: { select: { storageUrl: true }, orderBy: { sortOrder: 'asc' }, take: 1 },
} as const

/** 목록 — 환경설정 웹사이트 탭이 방마다 한 줄씩 그린다. */
export async function listSiteRoomCandidates(propertyId: string): Promise<SiteRoomCandidates> {
  const [publish, unpublish] = await Promise.all([
    prisma.room.findMany({ where: publishWhere(propertyId),   select: candidateSelect, orderBy: { roomNo: 'asc' } }),
    prisma.room.findMany({ where: unpublishWhere(propertyId), select: candidateSelect, orderBy: { roomNo: 'asc' } }),
  ])
  const toRow = (r: (typeof publish)[number]): SiteRoomCandidate => ({
    id: r.id, roomNo: r.roomNo, tier: r.tier, baseRent: r.baseRent, thumbUrl: r.photos[0]?.storageUrl ?? null,
  })
  return { publish: publish.map(toRow), unpublish: unpublish.map(toRow) }
}

/** 건수 — 홈은 "반영 대기 N건" 한 줄만 말하므로 방 정보를 실어 올 이유가 없다. */
export async function countSiteRoomCandidates(propertyId: string): Promise<{ publish: number; unpublish: number; total: number }> {
  const [publish, unpublish] = await Promise.all([
    prisma.room.count({ where: publishWhere(propertyId) }),
    prisma.room.count({ where: unpublishWhere(propertyId) }),
  ])
  return { publish, unpublish, total: publish + unpublish }
}
