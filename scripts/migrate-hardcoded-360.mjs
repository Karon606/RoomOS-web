// index.html 에 하드코딩돼 있던 360 파노라마 3장을 RoomPhoto(DB)로 이관 — 멀티테넌트 부채 청산(2026-07-25).
// 파일은 그대로 두고(로컬 동일출처라 pannellum CORS 안전) DB 에 등록만 해 하드코딩 의존을 끊는다.
// 멱등: 같은 storageUrl 이 이미 있으면 is360/showOnSite 만 보정. 드라이런 기본, 적용은 --apply.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

const SLUG = 'thestayjegi'
const PANOS = [
  { roomNo: '408', file: 'room-360-408.jpg' },
  { roomNo: '418', file: 'room-360-418.jpg' },
  { roomNo: '508', file: 'room-360-508.jpg' },
]

async function main() {
  const prop = await prisma.property.findUnique({ where: { publicSlug: SLUG }, select: { id: true } })
  if (!prop) { console.log('영업장 없음:', SLUG); return }

  for (const p of PANOS) {
    const room = await prisma.room.findFirst({ where: { propertyId: prop.id, roomNo: p.roomNo }, select: { id: true } })
    if (!room) { console.log(p.roomNo + '호 없음 — 건너뜀'); continue }
    const url = `/members/${SLUG}/images/${p.file}`
    const exists = await prisma.roomPhoto.findFirst({ where: { roomId: room.id, storageUrl: url }, select: { id: true, is360: true, showOnSite: true } })
    if (exists) {
      const needFix = !exists.is360 || !exists.showOnSite
      console.log(`${p.roomNo}호: 이미 등록됨${needFix ? ' (is360/showOnSite 보정 필요)' : ''}`)
      if (needFix && APPLY) await prisma.roomPhoto.update({ where: { id: exists.id }, data: { is360: true, showOnSite: true } })
      continue
    }
    // 기존 사진 뒤로(sortOrder max+1)
    const last = await prisma.roomPhoto.findFirst({ where: { roomId: room.id }, orderBy: { sortOrder: 'desc' }, select: { sortOrder: true } })
    const sortOrder = (last?.sortOrder ?? -1) + 1
    console.log(`${p.roomNo}호: 신규 등록 (sortOrder ${sortOrder})`)
    if (APPLY) {
      await prisma.roomPhoto.create({
        data: { roomId: room.id, storageUrl: url, driveFileId: null, fileName: p.file, is360: true, showOnSite: true, sortOrder },
      })
    }
  }
  console.log(APPLY ? '적용 완료' : '드라이런 종료 — 적용하려면 --apply')
  await prisma.$disconnect()
}
main()
