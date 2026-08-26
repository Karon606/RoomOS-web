// 계약서 용도 번복 정합 감지망 — 실행: npx tsx --env-file=.env.local scripts/check-contract-purpose-log.ts
//
// 왜 있나(2026-08-26 규약 개정). 발급 시점 증거(issuePurpose)를 불변으로 두고 '현재 용도'를
// purposeOverride 가 따로 들게 했다. 두 값과 이력(purposeLog)이 갈리면 화면은 그럴듯하게
// 그려지는데 근거가 사라진다 — 분쟁에서 "언제 누가 무엇으로 바꿨나"를 못 답하게 되는 것이
// 이 기능의 유일한 실패 모드다. 그래서 쓰기 경로가 로그를 놓친 흔적을 여기서 잡는다.
//
// 축 여섯. 앞 넷은 위반(자동 기계의 자기모순)이고, 뒤 둘은 주의다.
//   ⓐ purposeOverride 가 있는데 로그의 마지막 to 와 다르다 — 로그를 안 쌓은 쓰기 경로가 있다.
//   ⓑ purposeOverride 값이 화이트리스트 밖이다 — 정규화를 건너뛴 쓰기가 있다.
//   ⓒ 로그가 있는데 override 도 null 이고 발급값과도 어긋난다 — 되돌림이 반쪽만 적용됐다.
//   ⓓ auto 항목의 sourceFileId 가 없거나, 실존하지 않거나, 다른 계약을 가리킨다
//      — 자동 보관 전환이 근거를 못 대는 상태다. 그 근거가 사라지면 되돌릴 대상을 찾지 못하고
//        "일방적으로 강등했다"와 "새 계약서가 생겨 물러났다"를 분쟁에서 가를 수 없다.
//
// 주의(정당한 경로로도 도달한다 — 적용취소·삭제·이 기능 이전 데이터). 세기만 하고 막지 않는다.
//   ⓔ 한 계약에 살아 있는 유효 실계약이 2부 이상 — 어느 종이가 계약인지 앱이 두 답을 갖는다.
//   ⓕ 보관용만 남고 유효 실계약이 0부 — 대표가 비었다.
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import {
  CONTRACT_PURPOSES, contractPurposeOf, parsePurposeLog, withEffectivePurpose,
  ARCHIVED_CONTRACT_PURPOSE,
} from '../lib/contractPurpose'
import { isRepresentativeCandidate } from '../lib/contractCurrentIssue'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

async function main() {
  const violations: string[] = []
  // 전수를 한 번 읽는다 — ⓓ 는 가리키는 대상이 실존하는지 봐야 하고, ⓔⓕ 는 계약 단위 셈이다.
  const all = await prisma.contractFile.findMany({
    where: { deletedAt: null },
    select: {
      id: true, contractNo: true, fileName: true, tenantId: true, leaseTermId: true,
      driveFileId: true, createdAt: true, voidedAt: true,
      issuePurpose: true, purposeOverride: true, purposeLog: true,
    },
  })
  const byId = new Map(all.map(r => [r.id, r]))
  const rows = all.filter(r => r.purposeOverride != null || r.purposeLog != null)

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

    // ⓓ 자동 전환은 근거를 대야 한다 — 무엇이 밀어냈는지.
    for (const e of log) {
      if (e.cause !== 'auto') continue
      if (!e.sourceFileId) {
        violations.push(`[${name}] 자동 보관 전환에 밀어낸 계약서가 안 적혔다 — 되돌릴 대상을 찾을 수 없다`)
        continue
      }
      const src = byId.get(e.sourceFileId)
      if (!src) {
        violations.push(`[${name}] 자동 보관 전환이 없는 계약서(${e.sourceFileId.slice(0, 8)})를 가리킨다`)
      } else if (src.tenantId !== r.tenantId || (src.leaseTermId ?? null) !== (r.leaseTermId ?? null)) {
        violations.push(`[${name}] 자동 보관 전환이 다른 계약의 계약서를 가리킨다`)
      }
    }
  }

  // ⓔⓕ 계약 단위 — 파일이 붙은 것만 센다(번호만 예약된 행은 어느 판정에도 안 잡힌다).
  const notes: string[] = []
  const groups = new Map<string, typeof all>()
  for (const r of all) {
    if (!r.driveFileId || !r.leaseTermId) continue
    const g = groups.get(r.leaseTermId) ?? []
    g.push(r)
    groups.set(r.leaseTermId, g)
  }
  for (const [leaseTermId, files] of groups) {
    const live = files.map(withEffectivePurpose).filter(isRepresentativeCandidate)
    const label = files[0]?.contractNo ?? leaseTermId.slice(0, 8)
    if (live.length > 1) {
      notes.push(`[${label}] 살아 있는 실계약이 ${live.length}부다 — 어느 종이가 계약인지 두 답이 있다`)
    } else if (live.length === 0 && files.some(f => contractPurposeOf(f.purposeOverride ?? f.issuePurpose) === ARCHIVED_CONTRACT_PURPOSE)) {
      notes.push(`[${label}] 보관용만 남고 실계약이 없다 — 대표가 비었다`)
    }
  }

  console.log(`\n[계약서 용도 번복] 번복 이력 있는 발급본 ${rows.length}건 / 위반 ${violations.length}건`)
  for (const v of violations) console.log('  - ' + v)
  if (notes.length > 0) {
    console.log(`\n[계약서 대표 자리] 주의 ${notes.length}건 (막지 않는다 — 적용취소·삭제로도 도달한다)`)
    for (const n of notes) console.log('  - ' + n)
  }
  await prisma.$disconnect()
  if (violations.length > 0) process.exit(1)
}

main()
