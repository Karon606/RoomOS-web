// 공개 소개 페이지 등급 카드에 '대표 썸네일'을 index.html 에 직접 심는다 — 페이지와 사진이 함께 로드되게(초기 지연 제거).
// _gallery.js 는 페이지 로드 후 API 로 사진을 붙여 대표가 늦게 뜨는데, 그 사이 방문자가 스크롤로 지나칠 수 있다.
// 사진을 바꾼 뒤 이 스크립트를 한 번 돌리면 대표 썸네일이 HTML 에 반영된다. 대표 = 등급별 첫 방(roomNo)의 첫 공개·비360 사진.
// 사용: node --env-file=.env.local scripts/publish-gallery-thumbs.mjs [slug]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync, writeFileSync } from 'fs'
import path from 'path'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const SLUG = process.argv[2] || 'thestayjegi'

// lib/google-drive.buildDriveThumbnailUrl 과 동일 규약(CORS 안전 썸네일)
function driveThumb(fileId, px) { return `https://drive.google.com/thumbnail?id=${fileId}&sz=w${px}` }

async function main() {
  const property = await prisma.property.findUnique({ where: { publicSlug: SLUG }, select: { id: true } })
  if (!property) { console.log('영업장 없음:', SLUG); return }

  const rooms = await prisma.room.findMany({
    where: { propertyId: property.id, showOnSite: true, photos: { some: { showOnSite: true } } },
    select: {
      baseRent: true, roomNo: true,
      photos: { where: { showOnSite: true }, orderBy: { sortOrder: 'asc' }, select: { driveFileId: true, storageUrl: true, is360: true } },
    },
    orderBy: { roomNo: 'asc' },
  })

  // 등급(baseRent)별 대표 = 첫 방의 첫 공개·비360 사진(공개 API 의 firstThumb 규칙과 동일)
  const byRent = new Map()
  for (const room of rooms) {
    if (byRent.has(room.baseRent)) continue
    const firstFlat = room.photos.find(p => !p.is360)
    if (!firstFlat) continue
    byRent.set(room.baseRent, firstFlat.driveFileId ? driveThumb(firstFlat.driveFileId, 400) : firstFlat.storageUrl)
  }

  const htmlPath = path.join(process.cwd(), 'public/members', SLUG, 'index.html')
  let html = readFileSync(htmlPath, 'utf8')

  // 각 room-card[data-rent] 의 room-photo 박스를 대표 img 로 치환(대표 없으면 hidden 유지 = _gallery.js 가 처리)
  let injected = 0
  html = html.replace(
    /(<article class="room-card[^"]*"[^>]*data-rent="(\d+)"[^>]*>[\s\S]*?)<div class="room-photo"[^>]*>[\s\S]*?<\/div>/g,
    (_m, prefix, rent) => {
      const thumb = byRent.get(Number(rent))
      if (!thumb) return prefix + '<div class="room-photo" hidden></div>'
      injected++
      // fetchpriority=high + eager: 첫 화면 대표는 지연 로드하지 않고 페이지와 함께 요청
      return prefix + `<div class="room-photo"><img class="room-photo-thumb" src="${thumb}" alt="" loading="eager" fetchpriority="high"></div>`
    }
  )

  writeFileSync(htmlPath, html)
  console.log(`대표 썸네일 주입 완료: ${injected}개 등급 (${SLUG})`)
  await prisma.$disconnect()
}
main()
