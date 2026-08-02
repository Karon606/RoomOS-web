// 오류신고 첨부 사진을 서비스 계정 자격으로 내려받는다 (D페이즈 2026-08-03).
//
// 왜 이 스크립트가 생겼나
//   전에는 신고 첨부에 Drive 공개 읽기 권한을 붙이고 check-error-reports.mjs 가 공개 URL 을 찍었다.
//   첨부는 대부분 앱 화면 스크린샷이라 다른 입주자의 성명·연락처·이용료·미납이 그대로 찍혀 있는데
//   링크만 알면 로그인 없이 무만료로 열렸다. 서류 PDF 56건 사고와 같은 클래스다.
//   공개 권한을 없앤 대신 열람 경로를 여기로 옮겼다. 자격은 .env.local 의 앱 계정을 쓴다.
//
// 사용:  npx tsx --env-file=.env.local scripts/fetch-error-report-images.ts <신고 id 접두어>
// 저장 위치는 실행 후 출력한다. 다 보고 나면 지운다 — 개인정보가 찍힌 파일이다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { downloadDriveBytes } from '@/lib/google-drive'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function main() {
  const prefix = process.argv[2]
  if (!prefix) { console.error('신고 id 접두어가 필요합니다.'); process.exit(1) }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const all = await prisma.errorReport.findMany({ select: { id: true, createdAt: true, imageFileIds: true } })
  const matched = all.filter(r => r.id.startsWith(prefix))
  if (matched.length !== 1) {
    console.error(matched.length === 0 ? `'${prefix}'로 시작하는 신고가 없습니다.` : `'${prefix}' 접두어가 ${matched.length}건과 일치합니다. 더 길게 입력하세요.`)
    await prisma.$disconnect(); process.exit(1)
  }
  const ids = Array.isArray(matched[0].imageFileIds) ? matched[0].imageFileIds as string[] : []
  if (ids.length === 0) { console.log('첨부가 없습니다.'); await prisma.$disconnect(); return }

  const dir = mkdtempSync(join(tmpdir(), `report-${matched[0].id.slice(0, 8)}-`))
  for (const [i, id] of ids.entries()) {
    const bytes = await downloadDriveBytes(id)
    const path = join(dir, `${i + 1}.png`)
    writeFileSync(path, bytes)
    console.log(`  ${path}`)
  }
  console.log(`\n${ids.length}장 내려받음. 확인 후 폴더를 지우세요 — 개인정보가 찍힌 파일입니다.`)
  await prisma.$disconnect()
}

void main()
