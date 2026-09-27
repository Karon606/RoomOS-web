// 서명 이미지와 서명 시각이 짝으로 움직이는지 보는 감지망(verify:db). 읽기 전용, 위반 시 exit 1.
// 실행: npx tsx --env-file=.env.local scripts/check-signature-pairing.ts
//
// 왜 필요한가. 목록 화면(홈 알림·계약서 발급 대기)은 **서명 시각만** 읽는다. 서명 이미지가
// base64 dataURL 이라 목록마다 메가바이트가 오갔고, 2026-09-28 Supabase egress 소진의 한 축이었다.
//
// 그 최적화가 성립하는 전제가 하나다 — **이미지가 있으면 시각도 있다.** leaseSignSlots 의 판정은
// `!!(url || signedAt)` 이라, 이미지만 있고 시각이 없는 행이 생기면 목록이 "서명 없음" 이라
// 거짓말을 한다. 서명이 있는데 없다고 말하는 것은 반쪽 계약서를 발급시키는 종류의 거짓이다
// (2026-09-03 413호·506호 사고가 그 자리다).
//
// 도입 시점 실측 — 계약 129건 전수에서 어긋난 행 0건. 이 그물은 그 0 을 지킨다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const rows = await prisma.$queryRawUnsafe<Array<{ kind: string; id: string; room: string | null }>>(`
    SELECT '계약서' AS kind, lt.id::text AS id, r."roomNo" AS room
    FROM lease_terms lt LEFT JOIN rooms r ON r.id = lt."roomId"
    WHERE lt."signatureImageUrl" IS NOT NULL AND lt."signatureSignedAt" IS NULL
    UNION ALL
    SELECT '동의서', lt.id::text, r."roomNo"
    FROM lease_terms lt LEFT JOIN rooms r ON r.id = lt."roomId"
    WHERE lt."disposalSignatureImageUrl" IS NOT NULL AND lt."disposalSignatureSignedAt" IS NULL
  `)
  const total = await prisma.leaseTerm.count()
  await prisma.$disconnect()

  if (rows.length) {
    console.error(`[서명 이미지·시각 짝] 위반 ${rows.length}건 — 이미지는 있는데 시각이 없다`)
    for (const r of rows) console.error(`  ${r.kind} ${r.room ?? '방 없음'} (${r.id.slice(0, 8)})`)
    console.error('  목록 화면은 시각만 읽는다. 이 행들은 "서명 없음" 으로 보인다.')
    console.error('  서명 시각을 채우거나, 목록 쿼리가 이미지를 다시 읽도록 되돌려야 한다.')
    process.exit(1)
  }
  console.log(`[서명 이미지·시각 짝] 위반 0건 (계약 ${total}건 전수)`)
}
main()
