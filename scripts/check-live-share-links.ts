// 아직 안 열어 본(미서명·미만료) 서명 링크가 있는지 센다 — 배포를 지우기 전 안전 확인.
//
// 왜 필요한가. 서명 링크 주소는 운영자가 그 화면을 열었을 때의 호스트로 조립된다
// (app/(app)/tenants/contractShare.ts 의 buildShareUrl 이 x-forwarded-host 를 읽는다).
// 운영자가 배포별 고유 URL 로 접속한 상태에서 링크를 만들었다면 그 주소가 문자로 나가 있고,
// 그 배포를 지우는 순간 입주자가 링크를 못 연다. 이미 서명이 끝난 링크는 볼 일을 마쳤으므로
// 지워도 무해하고, 만료된 링크도 어차피 안 열린다. **위험한 것은 아직 안 연 링크 하나뿐이다.**
//
// 실행: npx tsx --env-file=.env.local scripts/check-live-share-links.ts
// 종료 코드: 0 = 지워도 안전, 1 = 안 열어 본 링크가 있다(기다렸다가 정리할 것).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })

async function main() {
  const now = new Date()
  const live = await prisma.contractShareLink.findMany({
    where: { expiresAt: { gt: now } },
    select: { createdAt: true, expiresAt: true, signedAt: true, disposalSignedAt: true },
    orderBy: { createdAt: 'desc' },
  })
  // '안 열어 본'의 판정은 서명 유무다. 계약서든 동의서든 하나라도 서명이 있으면 그 링크는
  // 입주자가 이미 열어 제 일을 마친 것이다.
  const unopened = live.filter(l => !l.signedAt && !l.disposalSignedAt)

  console.log(`만료 전 링크 ${live.length}건 / 그중 아직 서명 전 ${unopened.length}건`)
  for (const l of live) {
    const state = l.signedAt || l.disposalSignedAt ? '서명 됨' : '**서명 전**'
    console.log(`  생성 ${l.createdAt.toISOString()} / 만료 ${l.expiresAt.toISOString()} / ${state}`)
  }

  await prisma.$disconnect()
  if (unopened.length > 0) {
    console.log('\n안 열어 본 링크가 있다. 그 링크가 배포별 URL 로 나갔다면 정리가 그것을 끊는다.')
    console.log('서명이 끝나거나 만료될 때까지 기다렸다가 정리할 것.')
    process.exit(1)
  }
  console.log('\n지워도 안전하다.')
}

main().catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
