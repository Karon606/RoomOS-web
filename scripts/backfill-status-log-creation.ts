// 등록 로그 44건 정정 — 거짓 fromStatus 와 빠진 leaseTermId (신고 ad517231, 운영자 승인 2026-08-03).
//
// 무엇이 잘못돼 있나
//   addTenant 가 상태 로그를 만들 때 `fromStatus: 'RESERVED'` 를 하드코딩했다.
//   실제 생성 상태와 무관하게 거짓 전이가 쌓였고, leaseTermId 도 안 채웠다.
//   그래서
//     - 상태 이력을 보여주면 "예약에서 문의로" 같은 있지도 않은 전이가 보인다
//     - 계약 단위로 묶으면 이 사람들 이력이 통째로 사라진다(취소 27건 중 4건이 여기 걸린다)
//     - **어제 전이표를 넓힐 때 이 유령 데이터가 근거에 섞였다.**
//       RESERVED -> WAITING_TOUR 를 19건으로 보고 표를 넓혔는데 실전이는 4건이었다.
//       (표 자체는 그대로 서도 된다 — 생성 로그를 걷어내도 실전이가 0이 되는 것은
//        RESERVED -> RESERVED 하나뿐이고 canTransition 은 from === to 를 항상 허용한다.)
//
// 지문
//   등록 로그는 `leaseTermId IS NULL AND changedById IS NULL` 로 정확히 구분된다.
//   다른 create 경로는 전부 둘 중 하나 이상을 채운다(checkoutTenant·크론은 changedById 만 비운다).
//
// 무엇을 하나
//   leaseTermId <- 그 고객의 계약 (계약이 **정확히 하나일 때만**)
//   fromStatus  <- toStatus  (등록은 전이가 아니다)
//
//   계약이 둘 이상인 고객은 어느 계약의 등록인지 특정할 수 없어 **건너뛴다.** 추정해서 넣지 않는다.
//   지금은 90명 전원이 계약 1개라 전건 처리되지만, 나중에 재입주가 생기면 그때 남은 것은 그냥 둔다.
//
// 생성 경로는 addTenant 에서 이미 고쳤다. 이 스크립트는 이미 쌓인 것을 정정한다.
//
// 실행:   npx tsx --env-file=.env.local scripts/backfill-status-log-creation.ts [--apply]
// 되돌리기: --revert --apply  (원본을 그대로 복원한다)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')
const SNAP = 'scripts/.backfill-status-log-creation.json'

type Snap = { id: string; fromStatus: string; leaseTermId: string | null }[]

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

  if (revert) {
    if (!existsSync(SNAP)) { console.log('되돌릴 스냅샷이 없습니다.'); await prisma.$disconnect(); return }
    const snap = JSON.parse(readFileSync(SNAP, 'utf8')) as Snap
    console.log(`되돌리기 대상 ${snap.length}건`)
    if (!apply) { console.log('실제 반영: --revert --apply'); await prisma.$disconnect(); return }
    for (const r of snap) {
      await prisma.tenantStatusLog.update({
        where: { id: r.id },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { fromStatus: r.fromStatus as any, leaseTermId: r.leaseTermId },
      })
    }
    console.log(`${snap.length}건 원복 완료`)
    await prisma.$disconnect(); return
  }

  const rows = await prisma.tenantStatusLog.findMany({
    where: { leaseTermId: null, changedById: null },
    select: { id: true, tenantId: true, fromStatus: true, toStatus: true, leaseTermId: true, tenant: { select: { name: true } } },
  })
  console.log(`등록 로그 후보 ${rows.length}건 (leaseTermId·changedById 둘 다 없음)`)

  const leases = await prisma.leaseTerm.findMany({
    where: { tenantId: { in: rows.map(r => r.tenantId) } },
    select: { id: true, tenantId: true },
  })
  const byTenant = new Map<string, string[]>()
  for (const l of leases) byTenant.set(l.tenantId, [...(byTenant.get(l.tenantId) ?? []), l.id])

  const edits: { id: string; leaseTermId: string; fromStatus: string }[] = []
  const skipped: string[] = []
  for (const r of rows) {
    const ids = byTenant.get(r.tenantId) ?? []
    if (ids.length !== 1) { skipped.push(`${r.tenant.name} (계약 ${ids.length}개 — 어느 등록인지 특정 불가)`); continue }
    edits.push({ id: r.id, leaseTermId: ids[0], fromStatus: r.toStatus })
  }

  const fromChanged = rows.filter(r => r.fromStatus !== r.toStatus).length
  console.log(`  정정 대상 ${edits.length}건 · 건너뜀 ${skipped.length}건`)
  console.log(`  그중 fromStatus 가 실제와 달랐던 것 ${fromChanged}건 (거짓 전이)`)
  for (const s of skipped) console.log(`    건너뜀 — ${s}`)
  if (edits.length === 0) { console.log('바꿀 것이 없습니다.'); await prisma.$disconnect(); return }
  if (!apply) { console.log('\n실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  // 원본을 먼저 남긴다 — 되돌릴 수 없는 변경은 만들지 않는다
  const snap: Snap = rows.filter(r => edits.some(e => e.id === r.id))
    .map(r => ({ id: r.id, fromStatus: r.fromStatus, leaseTermId: r.leaseTermId }))
  writeFileSync(SNAP, JSON.stringify(snap, null, 2))

  for (const e of edits) {
    await prisma.tenantStatusLog.update({
      where: { id: e.id },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: { leaseTermId: e.leaseTermId, fromStatus: e.fromStatus as any },
    })
  }
  const left = await prisma.tenantStatusLog.count({ where: { leaseTermId: null } })
  console.log(`\n${edits.length}건 정정 완료. 원본은 ${SNAP} 에 남겼다.`)
  console.log(`leaseTermId 없는 로그 남은 것 ${left}건`)
  await prisma.$disconnect()
}

void main()
