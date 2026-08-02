// 서류 파일의 무인증 공개 링크 회수 (E페이즈 조사 2026-08-03).
//
// 무엇이 문제였나
//   계약서 스캔 업로드본에 Drive `anyone: reader` 권한이 붙어 있었다.
//   링크만 알면 로그인 없이 성명·생년월일·서명 이미지가 보인다. 무만료다.
//   앱 내부 열람은 /api/doc-file(로그인 + 영업장 소유 + 소프트삭제 검증)로 이미 잠겨 있고
//   화면 어디에서도 공개 URL 을 쓰지 않는다(ViewDocButton 은 /api/doc-file 을 연다). 즉 권한만 남은 것이다.
//   생성 경로는 코드로 막았다. 이 스크립트는 이미 붙은 권한을 걷어낸다.
//
// 대상 — ContractFile(스캔 업로드본 포함) · RentReceiptFile · ResidenceCertFile 전량.
// 소프트삭제된 것도 포함한다(권한은 삭제와 무관하게 살아 있다).
//
// 실행:   npx tsx --env-file=.env.local scripts/revoke-doc-public-links.ts [--apply]
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { revokeDrivePublicAccess } from '@/lib/google-drive'

const apply = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const [contracts, receipts, certs] = await Promise.all([
    prisma.contractFile.findMany({ select: { driveFileId: true, fileName: true, source: true } }),
    prisma.rentReceiptFile.findMany({ select: { driveFileId: true, fileName: true } }),
    prisma.residenceCertFile.findMany({ select: { driveFileId: true, fileName: true } }),
  ])
  const all = [
    ...contracts.map(f => ({ ...f, kind: `계약서(${f.source})` })),
    ...receipts.map(f => ({ ...f, kind: '영수증' })),
    ...certs.map(f => ({ ...f, kind: '거주확인서' })),
  ].filter(f => f.driveFileId)

  console.log(`서류 파일 ${all.length}건 확인\n`)
  if (!apply) { console.log('실제 회수: --apply'); await prisma.$disconnect(); return }

  let removed = 0, failed = 0
  for (const f of all) {
    try {
      if (await revokeDrivePublicAccess(f.driveFileId)) { removed++; console.log(`  회수 ${f.kind} ${f.fileName}`) }
    } catch (e) {
      failed++
      console.log(`  실패 ${f.kind} ${f.fileName} — ${(e as Error).message}`)
    }
  }
  console.log(`\n공개 권한 회수 ${removed}건 · 실패 ${failed}건 · 원래 비공개 ${all.length - removed - failed}건`)
  await prisma.$disconnect()
}

void main()
