// 도장 이미지의 공개 읽기 권한 회수 (D페이즈 2026-08-03).
//
// 서류 PDF 는 잠갔는데 그 위에 찍히는 도장 원본은 공개 읽기라 아무나 받아 위조 계약서·확인서에
// 얹을 수 있었다. 표시는 driveImageDataUrl 로 바이트를 직접 심는 방식으로 바꿨다 —
// 로그인 화면, 비로그인 서명 페이지, 쿠키 없는 헤드리스 PDF 렌더까지 한 방식으로 덮인다.
// 생성 경로(finalizeStamp)는 코드로 막았다. 여기는 이미 붙은 권한을 걷는다.
//
// 로고(영업장·앱)와 호실 사진은 대상이 아니다 — 공개 갤러리·랜딩에서 실제로 쓰는 공개 자산이다.
//
// 실행: npx tsx --env-file=.env.local scripts/revoke-stamp-public-access.ts [--apply]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { revokeDrivePublicAccess } from '@/lib/google-drive'

const apply = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const props = await prisma.property.findMany({ select: { name: true, stampDriveFileId: true } })
  const targets = props.filter(p => p.stampDriveFileId)

  console.log(`영업장 ${props.length}곳 · 도장 보유 ${targets.length}곳`)
  if (targets.length === 0) { await prisma.$disconnect(); return }
  if (!apply) { console.log('\n실제 회수: --apply'); await prisma.$disconnect(); return }

  let removed = 0, failed = 0
  for (const p of targets) {
    try {
      if (await revokeDrivePublicAccess(p.stampDriveFileId!)) { removed++; console.log(`  회수 ${p.name} 도장`) }
    } catch (e) { failed++; console.log(`  실패 ${p.name} — ${(e as Error).message}`) }
  }
  console.log(`\n공개 권한 회수 ${removed}건 · 실패 ${failed}건 · 원래 비공개 ${targets.length - removed - failed}건`)
  await prisma.$disconnect()
}

void main()
