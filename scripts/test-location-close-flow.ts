// 보관 위치 닫기 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 화면 호출 순서 그대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-location-close-flow.ts
//
// 왜 통합인가(2026-10-28 운영자 승인 '보관 위치 닫기'). 숨김·이관·창고 승격이 한 트랜잭션인지, 총량이 그대로인지,
// 적용취소가 행을 바이트까지 되돌리는지, 이관 점검 위에 점검이 얹히면 적용취소를 거부하는지, 다른 영업장 id 로는 아무것도
// 못 바꾸는지는 실제 쓰기를 돌려야 보인다. 대역·운영 DB 차단은 현금영수증 하네스와 같은 판이다(스키마는 그때그때 뽑는다).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 56000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const inv = await import('@/app/(app)/inventory/actions')
  const { computeInventoryOverview } = await import('@/app/(app)/inventory/overview')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  const loc = async (pid: string, name: string, sortOrder: number, isHub = false, parentId: string | null = null) =>
    (await prisma.storageLocation.create({ data: { propertyId: pid, name, sortOrder, isHub, parentId } })).id as string
  const L415 = await loc(P1, '4층 415호 창고', 0, true)
  const L603 = await loc(P1, '603호 창고', 1)
  const LKIT = await loc(P1, '4층 주방', 2)
  const LOFF = await loc(P1, '4층 사무실', 3)
  const item = async (label: string, hubLocationId: string | null, links: string[]) => {
    const id = (await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label, specUnit: 'kg', qtyUnit: '포', trackUnit: 'spec', hubLocationId } })).id as string
    await prisma.trackedItemLocation.createMany({ data: links.map(l => ({ trackedItemId: id, storageLocationId: l })) })
    return id
  }
  const check = async (itemId: string, rows: [string, number][]) => prisma.stockCheck.create({
    data: {
      trackedItemId: itemId, date: new Date('2026-10-27T00:00:00.000Z'), remainingQty: rows.reduce((s, [, q]) => s + q, 0),
      locationBreakdown: { create: rows.map(([storageLocationId, remainingQty]) => ({ storageLocationId, remainingQty })) },
    },
  })
  // 행 바이트 — 품목·링크·점검(위치 행 포함). @updatedAt 칸은 쓰기마다 바뀌는 시각이라 상태가 아니다.
  const bytes = async (itemId: string) => JSON.stringify({
    item: await prisma.trackedItem.findUnique({ where: { id: itemId } }).then((r: Record<string, unknown> | null) => { if (!r) return null; const { updatedAt: _u, ...rest } = r; void _u; return rest }),
    links: await prisma.trackedItemLocation.findMany({ where: { trackedItemId: itemId }, orderBy: { storageLocationId: 'asc' } }),
    checks: await prisma.stockCheck.findMany({ where: { trackedItemId: itemId }, orderBy: { id: 'asc' }, include: { locationBreakdown: { orderBy: { storageLocationId: 'asc' } } } }),
  })
  const totalOf = async (itemId: string) => (await computeInventoryOverview(P1)).find((r: { id: string }) => r.id === itemId)?.currentStock ?? null
  const rowOf = async (itemId: string) => (await computeInventoryOverview(P1)).find((r: { id: string }) => r.id === itemId)!

  // ── H 품목 하나의 위치 숨김(1단계) ──────────────────────────────────────────
  // 쌀: hubLocationId null 이라 영업장 기본 창고 415 를 따른다. 415 20 · 603 5 · 주방 4 = 29.
  const RICE = await item('쌀', null, [L415, L603, LKIT])
  await check(RICE, [[L415, 20], [L603, 5], [LKIT, 4]])
  {
    const before = await bytes(RICE)
    eq('H1 재고 있으면 옮길 곳 필수', (await inv.closeItemLocation({ trackedItemId: RICE, storageLocationId: L415 })).ok, false)
    eq('H1 거부는 아무것도 안 바꾼다', await bytes(RICE), before)
    eq('H1b 열린 링크가 아닌 곳으로는 못 옮긴다', (await inv.closeItemLocation({ trackedItemId: RICE, storageLocationId: L415, moveToLocationId: LOFF })).ok, false)

    const r = await inv.closeItemLocation({ trackedItemId: RICE, storageLocationId: L415, moveToLocationId: L603 })
    if (!r.ok) throw new Error(r.error)
    eq('H2 옮긴 양과 간 곳', r.moved, { qty: 20, toPathName: '603호 창고' })
    eq('H2 숨김 시각이 섰다', !!(await prisma.trackedItemLocation.findFirst({ where: { trackedItemId: RICE, storageLocationId: L415 } }))?.closedAt, true)
    eq('H2 총량 그대로 29', await totalOf(RICE), 29)
    const last = await prisma.stockCheck.findFirst({ where: { trackedItemId: RICE }, orderBy: [{ date: 'desc' }, { createdAt: 'desc' }], include: { locationBreakdown: true } })
    eq('H2 이관 점검 행: 415 0 · 603 25 · 주방 4', Object.fromEntries((last?.locationBreakdown ?? []).map((b: { storageLocationId: string; remainingQty: number }) => [b.storageLocationId === L415 ? '415' : b.storageLocationId === L603 ? '603' : 'kit', b.remainingQty])), { '415': 0, '603': 25, kit: 4 })
    eq('H2 이관 메모', last?.memo, '위치 숨김: 4층 415호 창고에서 603호 창고로 20 이관')
    // 603 은 영업장 기본 창고가 아니므로 명시한다(결정 7).
    eq('H3 새 창고 603 명시', (await prisma.trackedItem.findUnique({ where: { id: RICE } }))?.hubLocationId, L603)
    const row = await rowOf(RICE)
    eq('H3 화면 술어: 415 는 숨긴 빈 위치', row.hiddenLocationIds, [L415])
    eq('H3 화면 창고도 603', row.locations.find((l: { isHub: boolean }) => l.isHub)?.id, L603)
    eq('H4 숨긴 위치 캡션 재료', await inv.getHiddenLocationMoves(RICE), { ok: true, moves: [{ locationId: L415, qty: 20, toPathName: '603호 창고' }] })

    const u = await inv.undoCloseItemLocation(J(r.undo!))
    eq('H5 적용취소 ok', u, { ok: true })
    eq('H5 적용취소 바이트 동일', await bytes(RICE), before)
    eq('H5 총량 그대로 29', await totalOf(RICE), 29)
  }
  // 이관 점검 위에 같은 날 위치 점검이 머지되면(행이 늘거나 보충 마커가 생긴다) 적용취소가 얹힌 실측을 지우지 않는다.
  {
    const r = await inv.closeItemLocation({ trackedItemId: RICE, storageLocationId: L415, moveToLocationId: L603 })
    if (!r.ok) throw new Error(r.error)
    const tid = r.undo!.transferCheckId!
    await prisma.stockCheckLocation.updateMany({ where: { stockCheckId: tid, storageLocationId: LKIT }, data: { restockedQty: 2 } })
    const mid = await bytes(RICE)
    eq('H6 얹힌 점검이 있으면 적용취소 거부', await inv.undoCloseItemLocation(J(r.undo!)), { ok: false, error: '숨긴 뒤 재고 점검이 있어 되돌릴 수 없습니다.' })
    eq('H6 거부는 아무것도 안 바꾼다', await bytes(RICE), mid)
    // 정리: 마커를 되돌리고 적용취소(다음 케이스가 깨끗한 판에서 시작한다).
    await prisma.stockCheckLocation.updateMany({ where: { stockCheckId: tid, storageLocationId: LKIT }, data: { restockedQty: null } })
    eq('H6 마커가 걷히면 적용취소 ok', await inv.undoCloseItemLocation(J(r.undo!)), { ok: true })
  }
  // 이관 뒤에 이 품목의 다른 점검(같은 날 절대값 점검)이 서면 적용취소는 거부한다(독립 검수 권고 3). 이관을 지우면 그 점검의
  // 기준선이 바뀌어 '숨기기 전으로 복귀' 가 거짓이 된다.
  {
    const r = await inv.closeItemLocation({ trackedItemId: RICE, storageLocationId: L415, moveToLocationId: L603 })
    if (!r.ok) throw new Error(r.error)
    const later = await prisma.stockCheck.create({ data: { trackedItemId: RICE, date: new Date(`${new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)}T00:00:00.000Z`), remainingQty: 28, locationBreakdown: { create: [{ storageLocationId: L603, remainingQty: 24 }, { storageLocationId: LKIT, remainingQty: 4 }, { storageLocationId: L415, remainingQty: 0 }] } } })
    const mid = await bytes(RICE)
    eq('H6b 뒤에 절대값 점검이 서면 적용취소 거부', await inv.undoCloseItemLocation(J(r.undo!)), { ok: false, error: '숨긴 뒤 재고 점검이 있어 되돌릴 수 없습니다.' })
    eq('H6b 거부는 아무것도 안 바꾼다', await bytes(RICE), mid)
    await prisma.stockCheck.delete({ where: { id: later.id } })
    eq('H6b 그 점검이 걷히면 적용취소 ok', await inv.undoCloseItemLocation(J(r.undo!)), { ok: true })
  }
  // 새 창고가 영업장 기본 창고면 hubLocationId 를 null 로 둔다(기본 창고를 따라가는 품목으로 돌아간다).
  {
    const RAMEN = await item('라면', LOFF, [LOFF, L415])
    await check(RAMEN, [[LOFF, 10], [L415, 30]])
    const r = await inv.closeItemLocation({ trackedItemId: RAMEN, storageLocationId: LOFF, moveToLocationId: L415 })
    if (!r.ok) throw new Error(r.error)
    eq('H7 새 창고가 기본 창고면 null', (await prisma.trackedItem.findUnique({ where: { id: RAMEN } }))?.hubLocationId, null)
    eq('H7 화면 창고는 415(기본 창고 폴백)', (await rowOf(RAMEN)).locations.find((l: { isHub: boolean }) => l.isHub)?.id, L415)
    eq('H7 총량 그대로 40', await totalOf(RAMEN), 40)
    eq('H8 마지막 열린 위치는 못 숨긴다', (await inv.closeItemLocation({ trackedItemId: RAMEN, storageLocationId: L415 })).ok, false)
    const u = await inv.undoCloseItemLocation(J(r.undo!))
    eq('H7 적용취소로 사무실 명시 창고 원복', [u.ok, (await prisma.trackedItem.findUnique({ where: { id: RAMEN } }))?.hubLocationId], [true, LOFF])
  }
  // 재고 0 인 위치 숨김은 이관이 없고, 다시 표시(reopen)는 이관을 지우지 않는다.
  {
    const SOAP = await item('주방세제', null, [L415, LKIT])
    await check(SOAP, [[L415, 0], [LKIT, 3]])
    const r = await inv.closeItemLocation({ trackedItemId: SOAP, storageLocationId: LKIT })
    eq('H9 재고 있는 주방은 옮길 곳 없이 못 숨긴다', r.ok, false)
    const r2 = await inv.closeItemLocation({ trackedItemId: SOAP, storageLocationId: L415 })
    if (!r2.ok) throw new Error(r2.error)
    eq('H9 빈 위치 숨김은 이관 없음', [r2.moved, r2.undo?.transferCheckId, r2.undo?.transferExpect], [null, null, null])
    eq('H9 창고(415) 숨김이면 주방이 명시 창고', (await prisma.trackedItem.findUnique({ where: { id: SOAP } }))?.hubLocationId, LKIT)
    eq('H9 이관 없는 숨김 캡션 재료 없음', await inv.getHiddenLocationMoves(SOAP), { ok: true, moves: [] })
  }
  // 다른 영업장 사용자로는 아무것도 못 바꾼다.
  {
    const before = await bytes(RICE)
    g.__CR_FLOW_PID = P2
    eq('H10 남의 영업장 품목 숨김 거부', (await inv.closeItemLocation({ trackedItemId: RICE, storageLocationId: L415, moveToLocationId: L603 })).ok, false)
    eq('H10 남의 영업장 숨김 적용취소 거부', (await inv.undoCloseItemLocation({ trackedItemId: RICE, storageLocationId: L415, transferCheckId: null, transferExpect: null, hubLocationIdBefore: null, hubChanged: false })).ok, false)
    eq('H10 남의 영업장 캡션 읽기 거부', (await inv.getHiddenLocationMoves(RICE)).ok, false)
    g.__CR_FLOW_PID = P1
    eq('H10 아무것도 안 바뀜', await bytes(RICE), before)
  }

  console.log(`[보관 위치 닫기 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
