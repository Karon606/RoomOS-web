// 9/16 5층 공용 화장실에 '고압호스 40cm 2개'로 잘못 배정한 것을 '60cm 2개'로 바로잡는 일회성 정정. 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (2026-10-10, 운영자 확인). 오류신고 3e861137 후속. 40cm 는 6/2 쿠팡에서 4개 12,760원(개당 3,190원)을 산 기록이
// 맞고, 9/16 누수 수리 때 5층 공용 화장실에 실제로 단 것은 60cm 2개였다(운영자 실물 확인). 그런데 앱에는
// 40cm 2개 배정으로 남아 40cm 여분이 2개, 60cm 여분이 25개로 보였다(실물 40cm 4개).
//
// 앱이 하는 두 동작을 그대로 따라 한다 — 손으로 다른 모양을 만들지 않는다.
//   ① 배정 이력 되돌리기(revertAssignmentLog) — 40cm 2개를 미배정으로 돌리고 그 이력 행을 지운다.
//      미배정 복귀라 같은 구매 묶음을 접는다(mergeUnassignedGroup): 6/2 원행 하나가 4개 12,760원이 된다.
//   ② 배정(assignAggregateToTarget, 배정일 2026-09-16) — 미배정 60cm 에서 2개를 선입선출로 5층 공용 화장실에.
//      7/20 1개 행은 통째로, 9/11 24개 행은 1개를 떼어(금액 비례 2,250원) 같은 묶음 id 로 나눈다(buildSplitOps).
//      이력 한 줄을 남긴다(원래 9/16 이력의 기록 시각을 그대로 써 이력 순서가 안 흔들린다).
// 생성 경로(배정 화면)는 정상이라 고칠 코드가 없다 — 운영자가 규격을 잘못 고른 한 건이다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-hose-0916-spec.ts [--apply | --revert <undo.json>]
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import prisma from '../lib/prisma'
import { buildAssetDetail } from '../app/(app)/inventory/assets/aggregate'

const PROPERTY = 'c74fd998-23cb-4c3c-8e56-9df32ecbcdcf'
const LABEL = '고압호스'
const LOC = 'c98c06fb-299f-4b08-848c-ba5605922867'        // 공용 화장실(5층)
const H40_KEEP = 'e8119538-436e-47fb-b17d-042fab926d5e'   // 40cm 6/2 원행(미배정 2개)
const H40_LOC = '6b2755d7-caa2-4ddc-b140-2571e3e802c5'    // 40cm 9/16 분할 행(5층 2개)
const H40_GROUP = 'a9011b08-7e33-415a-a06e-42d347585c10'
const OLD_LOG = '714169bc-2d10-4cf8-a053-62ecca851f80'    // 9/16 미배정 → 5층 공용 화장실 40cm 2개
const H60_A = 'ca1aa48f-d12d-4af5-9eb0-84730ac64445'      // 60cm 7/20 미배정 1개 2,250
const H60_B = 'a97f303c-7b56-4ef4-8455-6949f9cb006a'      // 60cm 9/11 미배정 24개 54,000
const ASSIGNED_AT = new Date('2026-09-16')

type Snap = Record<string, unknown>
const NOW_FIELDS = ['id', 'createdAt', 'updatedAt'] as const

function fail(msg: string): never { throw new Error(`멈춤: ${msg}`) }

async function revert(file: string) {
  const u = JSON.parse(fs.readFileSync(file, 'utf8')) as {
    before: { expenses: Snap[]; log: Snap }
    created: { expenseId: string; logId: string }
    deleted: { expenseIds: string[]; logIds: string[] }
    after: { keepQty: number; aQty: number; bQty: number }
  }
  // 지금 값이 적용값 그대로인지 먼저 본다 — 그 사이 다른 배정이 있었으면 되돌리지 않는다.
  const [keep, a, b, clone, newLog] = await Promise.all([
    prisma.expense.findUnique({ where: { id: H40_KEEP } }),
    prisma.expense.findUnique({ where: { id: H60_A } }),
    prisma.expense.findUnique({ where: { id: H60_B } }),
    prisma.expense.findUnique({ where: { id: u.created.expenseId } }),
    prisma.assetAssignmentLog.findUnique({ where: { id: u.created.logId } }),
  ])
  if (!keep || keep.qtyValue !== u.after.keepQty) fail('40cm 원행이 적용값과 다르다')
  if (!a || a.assignedLocationId !== LOC) fail('60cm 7/20 행이 5층에 있지 않다')
  if (!b || b.qtyValue !== u.after.bQty) fail('60cm 9/11 행 수량이 적용값과 다르다')
  if (!clone || clone.assignedLocationId !== LOC || clone.qtyValue !== 1) fail('떼어 낸 60cm 1개 행이 적용값과 다르다')
  if (!newLog) fail('새 이력 행이 없다')
  const restore = (s: Snap) => Object.fromEntries(Object.entries(s).filter(([k]) => !NOW_FIELDS.includes(k as typeof NOW_FIELDS[number])))
  await prisma.$transaction([
    prisma.expense.delete({ where: { id: u.created.expenseId } }),
    prisma.assetAssignmentLog.delete({ where: { id: u.created.logId } }),
    ...u.before.expenses.filter(s => !u.deleted.expenseIds.includes(s.id as string))
      .map(s => prisma.expense.update({ where: { id: s.id as string }, data: restore(s) })),
    ...u.before.expenses.filter(s => u.deleted.expenseIds.includes(s.id as string))
      .map(s => prisma.expense.create({ data: s as never })),
    prisma.assetAssignmentLog.create({ data: u.before.log as never }),
  ])
  console.log('되돌림: 40cm 2개는 다시 5층 공용 화장실, 60cm 는 미배정 25개로 돌아갔다.')
}

async function main() {
  const ri = process.argv.indexOf('--revert')
  if (ri > 0) return revert(process.argv[ri + 1])

  // ── 전제조건 전수 ──────────────────────────────────────────────
  const h40 = await prisma.expense.findMany({ where: { propertyId: PROPERTY, itemLabel: LABEL, specValue: 40, specUnit: 'cm' } })
  if (h40.length !== 2) fail(`40cm 행이 ${h40.length}개다(2개여야 한다)`)
  const keep = h40.find(e => e.id === H40_KEEP), atLoc = h40.find(e => e.id === H40_LOC)
  if (!keep || !atLoc) fail('40cm 두 행의 id 가 예상과 다르다')
  if (keep.assignedLocationId || keep.roomId || keep.qtyValue !== 2 || keep.amount !== 6380 || keep.disposedAt) fail('40cm 원행 상태가 예상과 다르다')
  if (atLoc.assignedLocationId !== LOC || atLoc.qtyValue !== 2 || atLoc.amount !== 6380 || atLoc.disposedAt) fail('40cm 5층 행 상태가 예상과 다르다')
  if (keep.allocationGroupId !== H40_GROUP || atLoc.allocationGroupId !== H40_GROUP) fail('40cm 두 행이 같은 구매 묶음이 아니다')
  const oldLog = await prisma.assetAssignmentLog.findUnique({ where: { id: OLD_LOG } })
  if (!oldLog || oldLog.specValue !== 40 || oldLog.toKind !== 'location' || oldLog.qty !== 2) fail('9/16 40cm 배정 이력이 예상과 다르다')

  const h60free = await prisma.expense.findMany({
    where: { propertyId: PROPERTY, itemLabel: LABEL, specValue: 60, specUnit: 'cm', roomId: null, assignedLocationId: null, isCommonAsset: false, disposedAt: null },
  })
  const ids60 = h60free.map(e => e.id).sort()
  if (ids60.join() !== [H60_A, H60_B].sort().join()) fail(`미배정 60cm 행이 예상과 다르다: ${ids60.join(',')}`)
  const a = h60free.find(e => e.id === H60_A)!, b = h60free.find(e => e.id === H60_B)!
  if (a.qtyValue !== 1 || a.amount !== 2250 || !a.receivedAt) fail('60cm 7/20 행 상태가 예상과 다르다')
  if (b.qtyValue !== 24 || b.amount !== 54000 || !b.receivedAt) fail('60cm 9/11 행 상태가 예상과 다르다')
  if (a.date.getTime() > b.date.getTime()) fail('선입선출 순서가 예상과 다르다')

  // ── 바꿀 값(앱 동작과 같은 산식) ───────────────────────────────
  const keepQty = 4, keepAmt = keep.amount + atLoc.amount
  const takeFromB = 1
  const cloneAmt = Math.round(b.amount * (takeFromB / (b.qtyValue ?? 1)))
  const bQty = Math.round(((b.qtyValue ?? 1) - takeFromB) * 1000) / 1000, bAmt = b.amount - cloneAmt
  const groupB = b.allocationGroupId ?? randomUUID()
  console.log('① 40cm 배정 되돌리기')
  console.log(`   ${LABEL} 40cm 5층 공용 화장실 2개 6,380원 행을 미배정으로 돌려 6/2 원행과 합친다`)
  console.log(`   → 미배정 40cm ${keepQty}개 ${keepAmt.toLocaleString()}원 한 줄(구매 묶음 해제), 9/16 40cm 이력 삭제`)
  console.log('② 60cm 2개 5층 공용 화장실 배정(배정일 2026-09-16, 선입선출)')
  console.log(`   7/20 60cm 1개 ${a.amount.toLocaleString()}원 행 → 통째로 5층 공용 화장실`)
  console.log(`   9/11 60cm 24개 ${b.amount.toLocaleString()}원 행 → 1개 ${cloneAmt.toLocaleString()}원을 떼어 5층 공용 화장실, 남은 미배정 ${bQty}개 ${bAmt.toLocaleString()}원`)
  console.log(`   이력 한 줄: 미배정 → ${oldLog.toLabel} 60cm 2개(배정일 9/16)`)
  console.log(`   결과: 40cm 미배정 4개 · 60cm 미배정 25 → 23개 · 5층 공용 화장실 60cm 2개`)
  if (!process.argv.includes('--apply')) { console.log('예행만 했다. 적용은 --apply'); return }

  const beforeExpenses = await prisma.expense.findMany({ where: { id: { in: [H40_KEEP, H40_LOC, H60_A, H60_B] } } })
  const cloneData = (() => {
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = b
    void _id; void _c; void _u
    return {
      ...rest, amount: cloneAmt, qtyValue: takeFromB, allocationGroupId: groupB,
      detail: buildAssetDetail({ ...b, qtyValue: takeFromB }),
      roomId: null, assignedLocationId: LOC, isCommonAsset: false, assignedAt: ASSIGNED_AT,
    }
  })()
  const results = await prisma.$transaction([
    // ① 되돌리기 + 묶음 접기 — 남는 짝이 없어 묶음 id 를 푼다(mergeUnassignedGroup 의 단독 복귀).
    prisma.expense.update({ where: { id: H40_KEEP }, data: {
      qtyValue: keepQty, amount: keepAmt, allocationGroupId: null,
      detail: buildAssetDetail({ ...keep, qtyValue: keepQty }),
    } }),
    prisma.expense.delete({ where: { id: H40_LOC } }),
    prisma.assetAssignmentLog.delete({ where: { id: OLD_LOG } }),
    // ② 배정 — 7/20 행은 통째로, 9/11 행은 1개를 떼어 낸다.
    prisma.expense.update({ where: { id: H60_A }, data: { roomId: null, assignedLocationId: LOC, isCommonAsset: false, assignedAt: ASSIGNED_AT } }),
    prisma.expense.update({ where: { id: H60_B }, data: { qtyValue: bQty, amount: bAmt, allocationGroupId: groupB, detail: buildAssetDetail({ ...b, qtyValue: bQty }) } }),
    prisma.expense.create({ data: cloneData as never }),
    prisma.assetAssignmentLog.create({ data: {
      propertyId: PROPERTY, itemLabel: LABEL, specValue: 60, specUnit: 'cm', specText: null,
      fromKind: 'none', fromLabel: '미배정', toKind: 'location', toLabel: oldLog.toLabel,
      qty: 2, assignedAt: ASSIGNED_AT, createdAt: oldLog.createdAt,
    } }),
  ])
  const created = { expenseId: (results[5] as { id: string }).id, logId: (results[6] as { id: string }).id }
  const file = `scripts/.fix-hose-0916-spec-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({
    before: { expenses: beforeExpenses, log: oldLog },
    created, deleted: { expenseIds: [H40_LOC], logIds: [OLD_LOG] },
    after: { keepQty, aQty: 1, bQty },
  }, null, 2))
  console.log(`적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-hose-0916-spec.ts --revert ${file}`)
}

main().finally(() => prisma.$disconnect())
