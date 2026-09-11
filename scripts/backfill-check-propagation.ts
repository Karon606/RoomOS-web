// 이미 고쳐진 점검의 뒤 점검을 뒤늦게 따라가게 하는 백필 — 예행 기본, --apply 로 적용.
//
// 왜 (2026-09-11 김치). 운영자가 9/10 점검을 고쳐(4층 상단 4·하단 6) 창고 몫을 나눠 적었는데,
// 그때의 updateStockCheck 은 뒤 점검을 아예 안 봤다. 그래서 9/11 점검이 여전히 옛 배분을 들고 있다.
// 이제 화면은 저장 전에 묻고 함께 옮기지만(previewStockCheckPropagation), **이미 벌어진 한 건**은
// 스스로 안 낫는다. 이 스크립트가 그 한 건을 같은 계산으로 되돌려 놓는다.
//
// 손으로 값을 박지 않는다. 계획은 화면·서버와 **같은 정본**(lib/stockLedger planCheckPropagation)이
// 만들고, 적용도 **같은 적용 함수**(ledgerShift applyShiftRows)를 탄다. 여기서만 다른 것은
// '수정 전 값'을 어떻게 얻느냐 하나다.
//
// ── 수정 전 값의 재구성(휴리스틱, 이 스크립트 전용) ────────────────────────
// 그 수정은 위치별 잔량을 통째로 다시 써서 옛 값이 DB 에 남아 있지 않다. 그래서 이렇게 세운다.
//   ① 수정 전 그 점검이 갖고 있던 **위치 집합** = 뒤 점검이 지금 갖고 있는 위치 집합.
//      (뒤 점검은 그 값들을 이월로 물려받았으므로 자리 목록이 곧 사본이다.)
//   ② 그 위치들의 값 = 수정 후 값 그대로 — 이번 수정이 건드리지 않은 자리로 본다.
//   ③ 집합 밖으로 새로 생긴 행들의 합은 **허브가 갖고 있었다** — 총량 보존.
//      (위치별 점검에서 허브 칸은 파생값이고 차액을 흡수하는 자리다.)
// 가정이므로 예행 출력에 그대로 찍는다. 숫자가 장부와 다르면 적용하지 말고 되짚을 것.
//
// 실행: npx tsx --env-file=.env.local scripts/backfill-check-propagation.ts <checkId> [--apply]
//       npx tsx --env-file=.env.local scripts/backfill-check-propagation.ts --revert <스냅샷.json>
import { writeFileSync, readFileSync } from 'node:fs'
import prisma from '../lib/prisma'
import {
  buildCheckPropagationPlan, applyShiftRows, revertShiftRows,
  resolveItemHubLocationId, type LedgerShiftUndo,
} from '../app/(app)/inventory/ledgerShift'

const argv = process.argv.slice(2)
const APPLY = argv.includes('--apply')
const revertAt = argv.indexOf('--revert')
const checkId = argv.find(a => !a.startsWith('--'))

async function revert(file: string) {
  const undo = JSON.parse(readFileSync(file, 'utf8')) as LedgerShiftUndo
  await prisma.$transaction(async tx => { await revertShiftRows(tx, undo) })
  console.log(`\n되돌렸다 — 점검 ${undo.checks.length}건을 전파 전 값으로 복귀.`)
  await prisma.$disconnect()
}

async function main() {
  if (revertAt >= 0) {
    const file = argv[revertAt + 1]
    if (!file) { console.error('--revert 뒤에 스냅샷 파일 경로가 필요하다.'); process.exit(1) }
    return revert(file)
  }
  if (!checkId) {
    console.error('사용법: backfill-check-propagation.ts <checkId> [--apply]')
    process.exit(1)
  }

  const c = await prisma.stockCheck.findUnique({
    where: { id: checkId },
    include: { trackedItem: { select: { id: true, label: true, hubLocationId: true, propertyId: true, trackUnit: true, qtyUnit: true, specUnit: true } }, locationBreakdown: true },
  })
  if (!c) { console.error(`점검 ${checkId} 를 찾을 수 없다.`); process.exit(1) }
  const it = c.trackedItem
  const unit = (it.trackUnit === 'qty' ? it.qtyUnit : (it.specUnit ?? it.qtyUnit)) ?? ''

  const locs = await prisma.storageLocation.findMany({ where: { propertyId: it.propertyId }, select: { id: true, name: true } })
  const nameOf = new Map(locs.map(l => [l.id, l.name]))
  const nm = (id: string) => nameOf.get(id) ?? id

  // 뒤 점검 — (date, createdAt) 로 바로 다음. 이 점검의 위치 집합이 '수정 전 자리 목록'이다.
  const next = await prisma.stockCheck.findFirst({
    where: {
      trackedItemId: it.id,
      OR: [{ date: { gt: c.date } }, { AND: [{ date: c.date }, { createdAt: { gt: c.createdAt } }] }],
    },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    include: { locationBreakdown: { select: { storageLocationId: true } } },
  })
  if (!next || next.locationBreakdown.length === 0) {
    console.log('뒤 점검이 없거나 위치 내역이 없다 — 전파할 자리가 없다.')
    await prisma.$disconnect()
    return
  }
  const hubId = await resolveItemHubLocationId(it.id, it.hubLocationId, it.propertyId)
  if (!hubId) { console.error('이 품목의 허브를 정할 수 없어 수정 전 값을 세울 수 없다.'); process.exit(1) }

  const after = c.locationBreakdown.map(lb => ({ locationId: lb.storageLocationId, qty: lb.remainingQty }))
  const prevSet = new Set(next.locationBreakdown.map(lb => lb.storageLocationId))
  const outside = after.filter(a => !prevSet.has(a.locationId))
  const outsideSum = outside.reduce((s, a) => s + a.qty, 0)
  const before = after
    .filter(a => prevSet.has(a.locationId))
    .map(a => ({ locationId: a.locationId, qty: a.locationId === hubId ? a.qty + outsideSum : a.qty }))

  const q = (n: number) => `${Math.round(n * 1000) / 1000}${unit}`
  console.log(`\n[점검 전파 백필] ${it.label} · ${c.date.toISOString().slice(0, 10)} 점검 ${checkId}`)
  console.log(`  허브 = ${nm(hubId)} · 뒤 점검 = ${next.date.toISOString().slice(0, 10)} ${next.id}`)
  console.log('\n  [가정] 수정 전 값은 DB 에 없어 아래 규칙으로 세웠다.')
  console.log('    ① 수정 전 자리 목록 = 뒤 점검이 지금 가진 위치 집합')
  console.log('    ② 그 자리들의 값 = 수정 후 값 그대로(수정이 안 건드린 자리로 본다)')
  console.log(`    ③ 새로 생긴 행 ${outside.map(o => `${nm(o.locationId)} ${q(o.qty)}`).join(' · ') || '없음'} 의 합 ${q(outsideSum)} 은 허브가 갖고 있었다(총량 보존)`)
  console.log('\n  수정 전(재구성)')
  for (const b of before) console.log(`    ${nm(b.locationId)} ${q(b.qty)}`)
  console.log('  수정 후(현재 저장값)')
  for (const a of after) console.log(`    ${nm(a.locationId)} ${q(a.qty)}`)

  const plan = await buildCheckPropagationPlan(it, it.propertyId, checkId, before, after)
  if (!plan.ok) { console.error(`\n계획 실패 — ${plan.error}`); process.exit(1) }
  if (plan.rows.length === 0) {
    console.log('\n어긋난 뒤 점검이 없다 — 할 일 없음.')
    await prisma.$disconnect()
    return
  }

  console.log(`\n  [계획] 뒤 점검 ${plan.rows.length}건`)
  const mark = (c?: boolean) => c === true ? '이월' : c === false ? '실측' : '없음'
  for (const r of plan.rows) {
    const d = new Date(r.dateMs).toISOString().slice(0, 10)
    // 값이 바뀌는 행과 표식만 찍는 행을 갈라 센다 — 이미 적용된 뒤 다시 돌리면 표식만 남는다.
    const valueRows = r.locs.filter(l => l.storedQty == null || Math.abs(l.storedQty - l.nextQty) > 1e-9)
    const stampRows = r.locs.filter(l => !(l.storedQty == null || Math.abs(l.storedQty - l.nextQty) > 1e-9))
    const totalMoved = Math.abs(r.nextTotal - r.storedTotal) > 1e-9
    console.log(`    ${d} 점검 · 총 ${totalMoved ? `${q(r.storedTotal)} → ${q(r.nextTotal)}` : `${q(r.storedTotal)} 변화 없음`}`
      + ` · 값 ${valueRows.length}행 · 표식만 ${stampRows.length}행`)
    for (const l of valueRows) {
      console.log(`      · ${nm(l.locationId)} ${l.storedQty == null ? '기록 없음' : q(l.storedQty)} → ${q(l.nextQty)} · 표식 ${mark(l.carried)}`)
    }
    for (const l of stampRows) {
      const was = await prisma.stockCheckLocation.findFirst({
        where: { stockCheckId: r.checkId, storageLocationId: l.locationId }, select: { carried: true },
      })
      console.log(`      · ${nm(l.locationId)} 값 ${q(l.nextQty)} 그대로 · 표식 ${mark(was?.carried ?? null)} → ${mark(l.carried)}`)
    }
    // 적용 후 그 점검이 갖게 될 위치별 값 전체(눈으로 대조하는 자리)
    const stored = await prisma.stockCheckLocation.findMany({
      where: { stockCheckId: r.checkId }, select: { storageLocationId: true, remainingQty: true },
    })
    const final = new Map(stored.map(s => [s.storageLocationId, s.remainingQty]))
    for (const l of r.locs) final.set(l.locationId, l.nextQty)
    console.log(`      적용 후 = ${[...final.entries()].map(([id, v]) => `${nm(id)} ${q(v)}`).join(' · ')}`)
  }

  if (!APPLY) {
    console.log('\n예행이다 — 적용하려면 --apply.')
    await prisma.$disconnect()
    return
  }

  let undo: LedgerShiftUndo | null = null
  await prisma.$transaction(async tx => {
    undo = await applyShiftRows(tx, it.id, plan.rows, { markCarried: true })
  })
  const file = `/tmp/backfill-check-propagation-${checkId}-${Date.now()}.json`
  writeFileSync(file, JSON.stringify(undo, null, 2))
  console.log(`\n적용 완료. 되돌리려면 --revert ${file}`)
  await prisma.$disconnect()
}

main()
