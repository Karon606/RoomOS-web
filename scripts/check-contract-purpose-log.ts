// 계약서 용도 번복 정합 감지망 — 실행: npx tsx --env-file=.env.local scripts/check-contract-purpose-log.ts
//
// 왜 있나(2026-08-26 규약 개정). 발급 시점 증거(issuePurpose)를 불변으로 두고 '현재 용도'를
// purposeOverride 가 따로 들게 했다. 두 값과 이력(purposeLog)이 갈리면 화면은 그럴듯하게
// 그려지는데 근거가 사라진다 — 분쟁에서 "언제 누가 무엇으로 바꿨나"를 못 답하게 되는 것이
// 이 기능의 유일한 실패 모드다. 그래서 쓰기 경로가 로그를 놓친 흔적을 여기서 잡는다.
//
// 축 셋.
//   ⓐ purposeOverride 가 있는데 로그의 마지막 to 와 다르다 — 로그를 안 쌓은 쓰기 경로가 있다.
//   ⓑ purposeOverride 값이 화이트리스트 밖이다 — 정규화를 건너뛴 쓰기가 있다.
//   ⓒ 로그가 있는데 override 도 null 이고 발급값과도 어긋난다 — 되돌림이 반쪽만 적용됐다.
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { CONTRACT_PURPOSES, contractPurposeOf, parsePurposeLog } from '../lib/contractPurpose'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  const violations: string[] = []
  const rows = await prisma.contractFile.findMany({
    where: { OR: [{ purposeOverride: { not: null } }, { purposeLog: { not: Prisma.DbNull } }] },
    select: {
      id: true, contractNo: true, fileName: true,
      issuePurpose: true, purposeOverride: true, purposeLog: true,
    },
  })

  for (const r of rows) {
    const name = r.contractNo ?? r.fileName ?? r.id.slice(0, 8)
    const log = parsePurposeLog(r.purposeLog)

    // ⓑ 화이트리스트 — 판정 입력이라 임의 문자열이 들어오면 대표본 판정이 무너진다.
    if (r.purposeOverride != null && !(CONTRACT_PURPOSES as readonly string[]).includes(r.purposeOverride)) {
      violations.push(`[${name}] 현재 용도가 목록 밖 값이다(${r.purposeOverride}) — 정규화를 건너뛴 쓰기가 있다`)
      continue
    }

    const effective = contractPurposeOf(r.purposeOverride ?? r.issuePurpose)
    const last = log[log.length - 1]

    // ⓐ 로그의 종착지와 지금 값이 같아야 한다.
    if (r.purposeOverride != null && (!last || last.to !== effective)) {
      violations.push(`[${name}] 현재 용도 ${effective} 인데 이력의 마지막은 ${last ? last.to : '없음'} — 쓰기 경로가 이력을 놓쳤다`)
      continue
    }

    // ⓒ 번복을 되돌려 override 가 null 이 됐다면 지금 값은 발급 시점 값과 같아야 한다.
    if (r.purposeOverride == null && log.length > 0) {
      const issued = contractPurposeOf(r.issuePurpose)
      if (last && last.to !== issued) {
        violations.push(`[${name}] 번복이 지워졌는데 이력의 마지막(${last.to})이 발급값(${issued})과 다르다 — 되돌림이 반쪽만 적용됐다`)
      }
    }
  }

  console.log(`\n[계약서 용도 번복] 번복 이력 있는 발급본 ${rows.length}건 / 위반 ${violations.length}건`)
  for (const v of violations) console.log('  - ' + v)
  await prisma.$disconnect()
  if (violations.length > 0) process.exit(1)
}

main()
