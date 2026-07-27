// 미처리 오류신고 조회 (읽기 전용) — 세션 시작 시 Claude 가 실행해 open 건을 운영자에게 보고.
// 사용: node --env-file=.env.local scripts/check-error-reports.mjs
//   해결 후 표시: node --env-file=.env.local scripts/check-error-reports.mjs done <id>
//             또는: ... dismiss <id>
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const [, , cmd, id] = process.argv

if (cmd === 'done' || cmd === 'dismiss') {
  if (!id) { console.error('id 필요'); process.exit(1) }
  // 목록이 8자 접두어로 표시되므로 접두어도 받는다 — 유일 매칭일 때만 갱신
  const candidates = await prisma.errorReport.findMany({ where: { status: 'open' }, select: { id: true } })
  const matched = candidates.filter(r => r.id.startsWith(id))
  if (matched.length !== 1) {
    console.error(matched.length === 0 ? `open 상태에서 '${id}'로 시작하는 신고 없음` : `'${id}' 접두어가 ${matched.length}건과 일치 — 더 길게 입력`)
    await prisma.$disconnect()
    process.exit(1)
  }
  await prisma.errorReport.update({ where: { id: matched[0].id }, data: { status: cmd === 'done' ? 'done' : 'dismissed' } })
  console.log(`${matched[0].id.slice(0, 8)} → ${cmd === 'done' ? 'done' : 'dismissed'}`)
  await prisma.$disconnect()
  process.exit(0)
}

const open = await prisma.errorReport.findMany({
  where: { status: 'open' },
  orderBy: { createdAt: 'desc' },
  take: 30,
})
if (open.length === 0) {
  console.log('미처리 오류신고 없음 (open 0건)')
} else {
  console.log(`⚠️ 미처리 오류신고 ${open.length}건:\n`)
  for (const r of open) {
    console.log(`── [${r.id.slice(0, 8)}] ${r.createdAt.toISOString()}  ${r.userEmail ?? ''}`)
    console.log(`   화면: ${r.url ?? '—'}`)
    if (r.errorText) console.log(`   에러: ${r.errorText}`)
    if (r.userNote) console.log(`   메모: ${r.userNote}`)
    if (Array.isArray(r.imageFileIds) && r.imageFileIds.length > 0) {
      console.log(`   첨부: ${r.imageFileIds.length}장`)
      for (const id of r.imageFileIds) console.log(`     https://drive.google.com/file/d/${id}/view`)
    }
    if (Array.isArray(r.breadcrumbs)) {
      const tail = r.breadcrumbs.slice(-6).map(c => `[${c.type}]${c.detail}`).join(' → ')
      console.log(`   자취: ${tail}`)
    }
    console.log('')
  }
}
await prisma.$disconnect()
