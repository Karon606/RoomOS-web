// 공개 소개 페이지 갤러리 데이터 — slug 로 영업장을 찾아 '사이트 공개' 켠 방 사진을 등급→호실→사진 2단으로 반환(무인증).
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { buildDriveImageUrl, buildDriveThumbnailUrl } from '@/lib/google-drive'

// 등급 카드는 baseRent(월요금)로 1:1 식별 — 같은 요금의 방을 한 그룹으로 묶되, 사진은 호실 단위로 분리해
// 시트에서 방별 행으로 보여준다(예전엔 등급 안에서 여러 방 사진이 섞여 어느 방인지 알기 어려웠다).
// 노출 대상: 방 showOnSite=true + 사진 showOnSite=true 1장 이상. 사진 단위로 공개/비공개, 360은 pano 로 분리.
// 대표 썸네일은 별도 컬럼 없이 '공개·비360 중 첫 장'으로 계산(rooms[0].photos[0]).

type GalleryPhoto = { url: string; thumb: string }
type GalleryRoom = { roomNo: string; photos: GalleryPhoto[]; pano: GalleryPhoto | null }
type GalleryGroup = { rent: number; rooms: GalleryRoom[] }

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return json({ groups: [] })

  const property = await prisma.property.findUnique({
    where: { publicSlug: slug },
    select: { id: true },
  })
  if (!property) return json({ groups: [] })

  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id, showOnSite: true, photos: { some: { showOnSite: true } } },
    select: {
      roomNo: true,
      baseRent: true,
      photos: {
        where: { showOnSite: true },
        orderBy: { sortOrder: 'asc' },
        select: { driveFileId: true, storageUrl: true, is360: true },
      },
    },
    orderBy: { roomNo: 'asc' },
  })

  // baseRent 로 그룹핑, 그룹 안에서 방 순서·방 안에서 사진 순서 유지. 360 은 pano 로 빼서 평면 목록과 분리.
  const byRent = new Map<number, GalleryRoom[]>()
  for (const room of rooms) {
    const photos: GalleryPhoto[] = []
    let pano: GalleryPhoto | null = null
    for (const p of room.photos) {
      const url = p.driveFileId ? buildDriveImageUrl(p.driveFileId, 1600) : p.storageUrl
      const thumb = p.driveFileId ? buildDriveThumbnailUrl(p.driveFileId, 400) : p.storageUrl
      if (p.is360) { if (!pano) pano = { url, thumb } }
      else photos.push({ url, thumb })
    }
    // 공개 평면사진도 pano 도 없으면(이론상 위 where 로 걸러짐) 방을 넣지 않음
    if (!photos.length && !pano) continue
    let list = byRent.get(room.baseRent)
    if (!list) { list = []; byRent.set(room.baseRent, list) }
    list.push({ roomNo: room.roomNo, photos, pano })
  }

  const groups: GalleryGroup[] = [...byRent.entries()].map(([rent, rms]) => ({ rent, rooms: rms }))

  return json({ groups })
}

function json(body: unknown) {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
