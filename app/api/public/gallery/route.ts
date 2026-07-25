// 공개 소개 페이지 갤러리 데이터 — slug 로 영업장을 찾아 '사이트 공개' 켠 방 사진을 baseRent 등급별로 묶어 반환(무인증).
import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/prisma'
import { buildDriveImageUrl, buildDriveThumbnailUrl } from '@/lib/google-drive'

// 등급 카드는 baseRent(월요금)로 1:1 식별 — 같은 요금의 방 사진을 한 그룹으로 합친다.
// 노출 대상은 showOnSite=true + 사진 1장 이상(운영자가 공개 의도한 것만). 방 번호 노출은 운영자 확인됨.

type GalleryPhoto = { url: string; thumb: string; roomNo: string }
type GalleryGroup = { rent: number; photos: GalleryPhoto[] }

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('slug')?.trim()
  if (!slug) return json({ groups: [] })

  const property = await prisma.property.findUnique({
    where: { publicSlug: slug },
    select: { id: true },
  })
  if (!property) return json({ groups: [] })

  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id, showOnSite: true, photos: { some: {} } },
    select: {
      roomNo: true,
      baseRent: true,
      photos: {
        orderBy: { sortOrder: 'asc' },
        select: { driveFileId: true, storageUrl: true },
      },
    },
    orderBy: { roomNo: 'asc' },
  })

  // baseRent 로 그룹핑, 방 순서·사진 순서 유지
  const byRent = new Map<number, GalleryPhoto[]>()
  for (const room of rooms) {
    let list = byRent.get(room.baseRent)
    if (!list) { list = []; byRent.set(room.baseRent, list) }
    for (const p of room.photos) {
      const url = p.driveFileId ? buildDriveImageUrl(p.driveFileId, 1600) : p.storageUrl
      const thumb = p.driveFileId ? buildDriveThumbnailUrl(p.driveFileId, 400) : p.storageUrl
      list.push({ url, thumb, roomNo: room.roomNo })
    }
  }

  const groups: GalleryGroup[] = [...byRent.entries()].map(([rent, photos]) => ({ rent, photos }))

  return json({ groups })
}

function json(body: unknown) {
  return NextResponse.json(body, {
    headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' },
  })
}
