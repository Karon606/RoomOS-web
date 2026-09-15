// 아이템별 점검 폼이 남긴 허브 행의 거짓 실측 표식을 세는 감사 — 기본은 **예행**(읽기만).
//
// 왜 필요한가. 2026-09-15 이전의 아이템별 점검 폼은 허브(창고) 칸을 '자동 차감 후' 파생값으로
// 미리 채워 놓고, 그 칸을 절대값 경로(locationQtys)로 보냈다. 서버는 폼이 직접 보낸 위치수량을
// **전부 실측 선언**으로 읽으므로(createStockCheck 의 `carried: false`), 아무도 세지 않은
// '직전 허브 − 옮김 합' 이라는 파생값이 실측 표식을 달고 장부에 박혔다.
//
// 왜 그게 문제인가. 실측(carried:false) 행은 앞 점검을 고쳐도 전파가 건드리지 않는 절대값이다
// (knowledge/domain-inventory.md '이월 행은 파생 박제, 실측 행만 절대값'). 파생값이 실측으로
// 박히면 그 위치의 전파가 거기서 영구히 멈추고, 값은 안 바뀌므로 감지망도 데이터 대조도 침묵한다.
//
// 무엇을 의심으로 보는가. 그 점검의 허브 행이 carried=false 인데 그 값이 정확히
//   직전 점검의 허브 잔량 + (그 사이 입수 − 폐기) − 그 점검의 비허브 보충 마커 합
// 인 경우다. 손으로 센 값이 우연히 이 식과 같을 수도 있으므로 **의심**이지 단정이 아니다.
// 그래서 기본이 예행이고, 적용은 별도 승인을 받는다.
//
// 실행:
//   npx tsx --env-file=.env.local scripts/audit-item-check-hub-carried.ts            (예행 — 세기만)
//   npx tsx --env-file=.env.local scripts/audit-item-check-hub-carried.ts --apply    (표식을 이월로)
//   npx tsx --env-file=.env.local scripts/audit-item-check-hub-carried.ts --revert    (마지막 적용 되돌리기)
import { writeFileSync, readFileSync, existsSync } from 'node:fs'
import prisma from '../lib/prisma'
import { resolveItemHubLocationId } from '../app/(app)/inventory/ledgerShift'

const EPS = 1e-6
const JOURNAL = 'scripts/.audit-item-check-hub-carried.json'

// 위치 패널이 남긴 점검의 memo 문형 — 그쪽 저장은 처음부터 패치 경로라 이 결함의 대상이 아니다.
const PANEL_MEMO = /^(위치별 점검 \(.+\)|전체 위치 점검)$/
// 옮기기(TransferStockModal)가 남긴 점검도 대상이 아니다 — 그쪽은 이동 기록이지 폼 입력이 아니다.
// memo 문형은 actions.transferLocationStock 이 쓰는 `이동: A → B` · `맞바꿈: A ↔ B` 다.
const TRANSFER_MEMO = /^(이동:|맞바꿈:)/

async function main() {
  const apply = process.argv.includes('--apply')
  const revert = process.argv.includes('--revert')

  if (revert) {
    if (!existsSync(JOURNAL)) { console.log('되돌릴 기록이 없습니다.'); return }
    const rows = JSON.parse(readFileSync(JOURNAL, 'utf8')) as { id: string; carried: boolean | null }[]
    for (const r of rows) {
      await prisma.stockCheckLocation.update({ where: { id: r.id }, data: { carried: r.carried } })
    }
    console.log(`되돌림 ${rows.length}건`)
    return
  }

  const items = await prisma.trackedItem.findMany({
    select: { id: true, label: true, category: true, propertyId: true, hubLocationId: true },
  })
  const suspects: { rowId: string; itemLabel: string; checkId: string; date: string; qty: number; expected: number; markerSum: number }[] = []
  let scannedChecks = 0

  for (const it of items) {
    const checks = await prisma.stockCheck.findMany({
      where: { trackedItemId: it.id },
      orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
      include: { locationBreakdown: true },
    })
    if (checks.length < 2) continue
    const hubId = await resolveItemHubLocationId(it.id, it.hubLocationId, it.propertyId)
    if (!hubId) continue

    for (let i = 1; i < checks.length; i++) {
      const c = checks[i]
      const prev = checks[i - 1]
      // 폼이 아닌 자리(패널·옮기기·수령 자동 점검)는 대상이 아니다.
      if (c.sourceExpenseId) continue
      if (c.memo && (PANEL_MEMO.test(c.memo) || TRANSFER_MEMO.test(c.memo))) continue
      const hubRow = c.locationBreakdown.find(b => b.storageLocationId === hubId)
      if (!hubRow || hubRow.carried !== false) continue
      // 옮김이 한 건도 없으면 파생값이라는 개념 자체가 없다 — 그 허브 값은 손으로 적은 값이다.
      const markerSum = c.locationBreakdown
        .filter(b => b.storageLocationId !== hubId)
        .reduce((s, b) => s + (b.restockedQty ?? 0), 0)
      if (!(markerSum > 0)) continue
      scannedChecks++

      const prevHub = prev.locationBreakdown.find(b => b.storageLocationId === hubId)?.remainingQty ?? 0
      // 직전 점검 이후 이 점검 이전의 입수 − 폐기(허브 몫). 경계는 actions.additionsSinceCheckByLocation 과 같다.
      const boundary = {
        OR: [
          { date: { gt: prev.date } },
          { AND: [{ date: { equals: prev.date } }, { createdAt: { gt: prev.createdAt } }] },
        ],
      }
      const [adds, disposals] = await Promise.all([
        prisma.stockAddition.findMany({ where: { trackedItemId: it.id, ...boundary }, select: { addedQty: true, storageLocationId: true } }),
        prisma.stockDisposal.findMany({ where: { trackedItemId: it.id, ...boundary }, select: { disposedQty: true, storageLocationId: true } }),
      ])
      let net = 0
      for (const a of adds) if ((a.storageLocationId ?? hubId) === hubId) net += a.addedQty
      for (const d of disposals) if ((d.storageLocationId ?? hubId) === hubId) net -= d.disposedQty

      const expected = Math.max(0, prevHub + net - markerSum)
      if (Math.abs(hubRow.remainingQty - expected) > EPS) continue
      suspects.push({
        rowId: hubRow.id, itemLabel: `${it.label} · ${it.category}`, checkId: c.id,
        date: c.date.toISOString().slice(0, 10), qty: hubRow.remainingQty, expected, markerSum,
      })
    }
  }

  console.log(`\n[아이템별 폼 허브 행 표식 감사] 대상 후보 ${scannedChecks}건 중 의심 ${suspects.length}건`)
  for (const s of suspects) {
    console.log(`  - ${s.date} ${s.itemLabel} · 허브 ${s.qty} (파생식 ${s.expected}, 옮김 합 ${s.markerSum}) · check ${s.checkId}`)
  }
  if (!apply) {
    console.log('\n예행입니다 — 아무것도 바꾸지 않았습니다. 적용은 --apply, 되돌리기는 --revert.')
    return
  }
  // 적용 — 되돌릴 값을 먼저 적어 두고 바꾼다(§16, 적용에는 언제나 취소가 있어야 한다).
  writeFileSync(JOURNAL, JSON.stringify(suspects.map(s => ({ id: s.rowId, carried: false })), null, 2))
  for (const s of suspects) {
    await prisma.stockCheckLocation.update({ where: { id: s.rowId }, data: { carried: true } })
  }
  console.log(`\n적용 ${suspects.length}건 — 되돌리기 기록은 ${JOURNAL}`)
}

main().finally(() => prisma.$disconnect())
