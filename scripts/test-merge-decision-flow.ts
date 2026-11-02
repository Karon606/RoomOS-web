// 병합 확인·재고 시드·세탁조크리너 정정 스크립트 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-merge-decision-flow.ts
//
// 왜 통합인가(신고 573b2e06, 2026-11-02). 붙은 구매를 시드가 옮기지 않는지, 병합 결정이 한 트랜잭션인지(하나라도 어긋나면
// 아무것도 안 바뀌는지), '새 품목으로 등록' 적용취소가 행을 되돌리고 그 뒤 기록이 있으면 거부하는지, 정정 스크립트가
// 적용·되돌림·거부를 지키는지는 실제 쓰기를 돌려야 보인다. 대역·운영 DB 차단은 현금영수증 하네스와 같은 판이다.
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
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))

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
  const fix = await import('./fix-washer-cleaner-split-1101')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }
  const quiet = () => {}

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  const exp = async (pid: string, label: string, o: Record<string, unknown> = {}) => (await prisma.expense.create({
    data: { propertyId: pid, date: new Date('2026-10-20T00:00:00Z'), amount: 5000, category: '소모품비', itemLabel: label, qtyValue: 1, qtyUnit: '개', ...o },
  })).id as string
  const card = async (pid: string, label: string, o: Record<string, unknown> = {}) => (await prisma.trackedItem.create({
    data: { propertyId: pid, category: '소모품비', label, specUnit: '개', qtyUnit: '개', trackUnit: 'spec', ...o },
  })).id as string
  const labelOf = async (id: string) => (await prisma.expense.findUnique({ where: { id } }))?.itemLabel ?? null
  const stockOf = async (id: string) => (await computeInventoryOverview(P1)).find((r: { id: string }) => r.id === id)?.currentStock ?? null
  // 영업장 상태 바이트(@updatedAt 빼고)
  const strip = (rows: Record<string, unknown>[]) => rows.map(r => { const { updatedAt: _u, ...rest } = r; void _u; return rest })
  const bytes = async (pid: string) => JSON.stringify({
    cards: strip(await prisma.trackedItem.findMany({ where: { propertyId: pid }, orderBy: { id: 'asc' } })),
    exps: strip(await prisma.expense.findMany({ where: { propertyId: pid }, orderBy: { id: 'asc' }, select: { id: true, itemLabel: true, updatedAt: true } })),
    rules: strip(await prisma.trackedItemMergeRule.findMany({ where: { propertyId: pid }, orderBy: { id: 'asc' } })),
    checks: await prisma.stockCheck.findMany({ where: { trackedItem: { propertyId: pid } }, orderBy: { id: 'asc' } }),
    undos: await prisma.trackedItemMergeUndo.count({ where: { propertyId: pid } }),
  })

  // ── M1 세탁조 재현: 붙은 5월 구매는 시드가 옮기지 않는다 ──────────────────────────────
  const WASH = await card(P1, '세탁조크리너')
  const MAY = await exp(P1, '세탁조크리너', { date: new Date('2026-05-31T00:00:00Z'), qtyValue: 6, specValue: 1, specUnit: '개', receivedAt: new Date('2026-05-31T00:00:00Z') })
  await prisma.stockCheck.create({ data: { trackedItemId: WASH, date: new Date('2026-06-02T00:00:00Z'), remainingQty: 5 } })
  {
    const NOV = await exp(P1, '세탁조크리너', { qtyValue: 10, specValue: 450, specUnit: 'ml' })
    const s = await inv.seedTrackedItemsFromExpenses(['세탁조크리너'])
    eq('M1 붙은 구매 둘 다 이름 그대로', [await labelOf(MAY), await labelOf(NOV)], ['세탁조크리너', '세탁조크리너'])
    eq('M1 새 카드·결정 대기 없음', [s.ok && s.created, s.ok && s.decisions.length], [0, 0])
    await prisma.expense.delete({ where: { id: NOV } })
  }
  // 붙지 않는 450ml(단위 '병')은 결정 대기로, 5월 구매는 그대로
  const BOTTLE = await exp(P1, '세탁조크리너', { qtyValue: 10, qtyUnit: '병', specValue: 450, specUnit: 'ml', amount: 28200, vendor: '쿠팡', brand: '홈스타', receivedAt: new Date('2026-11-02T04:50:00Z') })
  {
    const d = (await inv.getPendingMergeDecisions()).find(x => x.expenseIds.includes(BOTTLE))
    eq('M1b 450ml 병은 결정 대기, 이름은 규격만 꼬리', d?.newLabel, '세탁조크리너 450ml')
    eq('M1b 결정 줄에 근거(날짜·구매처·금액·브랜드·원래 이름)', d && { date: d.rows[0].date.slice(0, 10), vendor: d.rows[0].vendor, amount: d.rows[0].amount, brand: d.rows[0].brand, from: d.rows[0].fromLabel }, { date: '2026-10-20', vendor: '쿠팡', amount: 28200, brand: '홈스타', from: '세탁조크리너' })
    eq('M1b 5월 구매는 결정 대기에 없다', (await inv.getPendingMergeDecisions()).some(x => x.expenseIds.includes(MAY)), false)
    eq('M1b 결정 대기를 읽어도 아무것도 안 바뀜', await labelOf(MAY), '세탁조크리너')
  }

  // ── M2 원자성: 한 지출이라도 이름이 바뀌었으면 아무것도 안 바뀐다 ─────────────────────
  const d1 = (await inv.getPendingMergeDecisions()).find(x => x.expenseIds.includes(BOTTLE))!
  {
    const before = await bytes(P1)
    const r = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: [{ id: BOTTLE, fromLabel: '딴 이름' }], specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'new', declinedItemIds: [WASH] } })
    eq('M2 이름이 다르면 거부', r.ok, false)
    eq('M2 거부는 아무것도 안 바꾼다', await bytes(P1), before)
    const r2 = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: [{ id: MAY, fromLabel: '세탁조크리너' }], specUnit: d1.specUnit, qtyUnit: '개', choice: { kind: 'new' } })
    eq('M2b 카드에 붙은 구매는 거부', r2.ok ? 'ok' : r2.error, '이미 품목에 붙어 있는 구매가 섞여 있습니다. 화면을 새로고침한 뒤 다시 골라 주세요.')
    eq('M2b 거부는 아무것도 안 바꾼다', await bytes(P1), before)
  }

  // ── M3 '새 품목으로 등록'과 적용취소 ─────────────────────────────────────────────
  {
    const before = await bytes(P1)
    const r = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'new', declinedItemIds: d1.candidates.map(c => c.itemId) } })
    if (!r.ok) throw new Error(r.error)
    const nc = await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: '세탁조크리너 450ml' } })
    eq('M3 새 카드·이름 이전', [!!nc, await labelOf(BOTTLE)], [true, '세탁조크리너 450ml'])
    eq('M3 받은 구매가 첫 점검(앵커)으로 앉아 잔량이 선다', nc && await stockOf(nc.id), 4500)
    eq('M3 거절 규칙', (await prisma.trackedItemMergeRule.findMany({ where: { propertyId: P1 } })).map(x => [x.kind, x.sourceLabel]), [['MUTE', '세탁조크리너 450ml']])
    eq('M3 적용취소 목록에 NEW', (await inv.getMergeUndos()).map(u => u.kind), ['NEW'])
    eq('M3 적용취소 ok', await inv.unmergeTrackedItem(r.undoId!), { ok: true })
    eq('M3 적용취소 바이트 동일', await bytes(P1), before)
    // 그 뒤 점검이 있으면 거부
    const r2 = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'new', declinedItemIds: [WASH] } })
    if (!r2.ok) throw new Error(r2.error)
    const nc2 = (await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: '세탁조크리너 450ml' } }))!
    await new Promise(res => setTimeout(res, 5))
    const later = await prisma.stockCheck.create({ data: { trackedItemId: nc2.id, date: new Date('2026-11-03T00:00:00Z'), remainingQty: 4000 } })
    const mid = await bytes(P1)
    eq('M3b 등록 뒤 점검이 있으면 적용취소 거부', await inv.unmergeTrackedItem(r2.undoId!), { ok: false, error: '그 뒤 이 품목에 재고 점검·입수·폐기 기록이 있어 되돌릴 수 없습니다.' })
    eq('M3b 거부는 아무것도 안 바꾼다', await bytes(P1), mid)
    await prisma.stockCheck.delete({ where: { id: later.id } })
    eq('M3c 점검을 지우면 적용취소 ok', await inv.unmergeTrackedItem(r2.undoId!), { ok: true })
    eq('M3c 바이트 동일', await bytes(P1), before)
  }

  // ── M4 합치기와 적용취소: 지출은 원래 이름으로(결정 대기로 돌아간다) ─────────────────────
  {
    const before = await bytes(P1)
    const r = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'merge', targetItemId: WASH } })
    if (!r.ok) throw new Error(r.error)
    eq('M4 합친 구매는 대상 카드 이름', await labelOf(BOTTLE), '세탁조크리너')
    eq('M4 대상 카드는 단위 무시로', (await prisma.trackedItem.findUnique({ where: { id: WASH } }))?.qtyUnit, null)
    eq('M4 적용취소 ok', await inv.unmergeTrackedItem(r.undoId!), { ok: true })
    eq('M4 원래 이름(세탁조크리너)·단위·규칙 그대로', await bytes(P1), before)
    eq('M4 다시 결정 대기', (await inv.getPendingMergeDecisions()).some(x => x.expenseIds.includes(BOTTLE)), true)
  }

  // ── M5 450ml 거절이 있어도 530ml 은 자동 카드가 아니라 결정 대기 ─────────────────────
  {
    const r = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'new', declinedItemIds: [WASH] } })
    if (!r.ok) throw new Error(r.error)
    const E530 = await exp(P1, '세탁조크리너', { qtyValue: 6, qtyUnit: '병', specValue: 530, specUnit: 'ml' })
    const s = await inv.seedTrackedItemsFromExpenses(['세탁조크리너'])
    eq('M5 530ml 카드는 자동으로 안 선다', await prisma.trackedItem.count({ where: { propertyId: P1, label: '세탁조크리너 530ml' } }), 0)
    eq('M5 530ml 은 결정 대기(후보에 원래 카드)', s.ok && s.decisions.find(x => x.expenseIds.includes(E530))?.candidates.map(c => c.itemId).includes(WASH), true)
    await prisma.expense.delete({ where: { id: E530 } })
    eq('M5 정리: 적용취소', (await inv.unmergeTrackedItem(r.undoId!)).ok, true)
  }

  // ── M6 다른 영업장 ────────────────────────────────────────────────────────
  {
    const theirCard = await card(P2, '남의 카드')
    const theirExp = await exp(P2, '남의 이름')
    const b1 = await bytes(P1), b2 = await bytes(P2)
    const r = await inv.applyMergeDecision({ category: '소모품비', newLabel: '남의 카드', expenses: [{ id: theirExp, fromLabel: '남의 이름' }], choice: { kind: 'merge', targetItemId: theirCard } })
    eq('M6 남의 지출은 거부', r.ok, false)
    const r2 = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'new', declinedItemIds: [theirCard] } })
    eq('M6 남의 카드를 거절 대상으로 주면 거부', r2.ok, false)
    eq('M6 두 영업장 모두 무변경', [await bytes(P1) === b1, await bytes(P2) === b2], [true, true])
  }

  // ── M8 같은 결정을 두 번 적용하면 둘째는 거부(CAS) ─────────────────────────────────
  {
    const r = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'merge', targetItemId: WASH } })
    if (!r.ok) throw new Error(r.error)
    const mid = await bytes(P1)
    const again = await inv.applyMergeDecision({ category: d1.category, newLabel: d1.newLabel, expenses: d1.rows.map(x => ({ id: x.id, fromLabel: x.fromLabel })), specUnit: d1.specUnit, qtyUnit: d1.qtyUnit, choice: { kind: 'merge', targetItemId: WASH } })
    eq('M8 두 번째 적용은 거부', again.ok, false)
    eq('M8 거부는 아무것도 안 바꾼다', await bytes(P1), mid)
    eq('M8 정리: 적용취소', (await inv.unmergeTrackedItem(r.undoId!)).ok, true)
  }

  // ── M9 시드가 새 카드를 세우면 받은 몫이 첫 점검으로 ────────────────────────────────
  {
    const id = await exp(P1, '고무장갑', { qtyValue: 3, qtyUnit: '켤레', receivedAt: new Date('2026-10-21T00:00:00Z') })
    await inv.seedTrackedItemsFromExpenses(['고무장갑'])
    const c = await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: '고무장갑' } })
    eq('M9 새 카드 잔량 3', c && await stockOf(c.id), 3)
    eq('M9 앵커는 그 구매에 묶인다', (await prisma.stockCheck.findFirst({ where: { trackedItemId: c!.id } }))?.sourceExpenseId, id)
  }

  // ── M7 정정 스크립트(운영 실측 값으로 세운 판) ──────────────────────────────────────
  {
    const PID = fix.PROPERTY, I = fix.IDS, B = fix.BEFORE
    await prisma.property.create({ data: { id: PID, name: '정정 판', ownerId: OWNER } })
    const hubTop = (await prisma.storageLocation.create({ data: { propertyId: PID, name: '4층', sortOrder: 0 } })).id
    await prisma.storageLocation.create({ data: { id: I.office, propertyId: PID, name: '사무실', sortOrder: 4, parentId: hubTop } })
    await prisma.trackedItem.create({ data: { id: I.card87, propertyId: PID, category: '소모품비', label: '세탁조크리너', specUnit: '개', qtyUnit: '개', trackUnit: 'spec', hubLocationId: I.office, isArchived: true, createdAt: new Date('2026-05-31T12:26:18.310Z'), updatedAt: new Date(B.card87.updatedAt) } })
    await prisma.trackedItemLocation.create({ data: { trackedItemId: I.card87, storageLocationId: I.office } })
    await prisma.stockCheck.create({ data: { trackedItemId: I.card87, date: new Date('2026-10-16T00:00:00Z'), remainingQty: 0, createdAt: new Date('2026-10-16T06:09:51.610Z'), locationBreakdown: { create: [{ storageLocationId: I.office, remainingQty: 0, carried: false }] } } })
    await prisma.trackedItem.create({ data: { id: I.card33, propertyId: PID, category: '소모품비', label: fix.SPLIT_LABEL, specUnit: '개', qtyUnit: '개', trackUnit: 'spec', createdAt: new Date('2026-11-01T09:21:10.342Z'), updatedAt: new Date('2026-11-01T09:21:10.342Z') } })
    await prisma.trackedItem.create({ data: { id: I.cardBf, propertyId: PID, category: '소모품비', label: B.cardBf.label, specUnit: 'ml', qtyUnit: '개', trackUnit: 'spec', createdAt: new Date('2026-11-01T09:21:11.072Z'), updatedAt: new Date(B.cardBf.updatedAt) } })
    await prisma.expense.create({ data: { id: I.fe71, propertyId: PID, date: new Date('2026-05-31T00:00:00Z'), amount: 12990, category: '소모품비', itemLabel: fix.SPLIT_LABEL, qtyValue: 6, qtyUnit: '개', specValue: 1, specUnit: '개', vendor: '코스트코 코리아 상봉점', detail: '[세탁조크리너] 530ml x 6팩', receivedAt: new Date('2026-05-31T00:00:00Z'), updatedAt: new Date(B.fe71.updatedAt) } })
    await prisma.expense.create({ data: { id: I.exp5f, propertyId: PID, date: new Date('2026-11-01T00:00:00Z'), amount: 28200, category: '소모품비', itemLabel: B.exp5f.itemLabel, qtyValue: 10, qtyUnit: '개', specValue: 450, specUnit: 'ml', brand: '홈스타', productName: '퍼펙트 세탁조 클리너', receivedAt: new Date('2026-11-02T04:50:02.119Z'), updatedAt: new Date(B.exp5f.updatedAt) } })
    await prisma.stockCheck.create({ data: { id: I.check81, trackedItemId: I.cardBf, date: new Date('2026-11-02T00:00:00Z'), remainingQty: 4500, memo: B.check81.memo, sourceExpenseId: I.exp5f, createdAt: new Date('2026-11-02T04:50:02.146Z') } })
    await prisma.trackedItemMergeRule.create({ data: { id: I.mute, propertyId: PID, category: '소모품비', sourceLabel: B.cardBf.label, normLabel: '세탁조크리너', targetItemId: I.card87, kind: 'MUTE', createdAt: new Date('2026-11-01T09:21:10.404Z'), updatedAt: new Date(B.mute.updatedAt) } })

    const full = async () => JSON.stringify({
      cards: await prisma.trackedItem.findMany({ where: { propertyId: PID }, orderBy: { id: 'asc' } }),
      exps: await prisma.expense.findMany({ where: { propertyId: PID }, orderBy: { id: 'asc' } }),
      rules: await prisma.trackedItemMergeRule.findMany({ where: { propertyId: PID }, orderBy: { id: 'asc' } }),
      links: await prisma.trackedItemLocation.findMany({ where: { trackedItem: { propertyId: PID } }, orderBy: { trackedItemId: 'asc' } }),
      checks: await prisma.stockCheck.findMany({ where: { trackedItem: { propertyId: PID } }, orderBy: { id: 'asc' } }),
    })
    const before = await full()
    const dry = await fix.runWasherFix(prisma as never, false, quiet)
    eq('M7 예행 ok·무변경', [dry.ok, await full() === before], [true, true])
    const ap = await fix.runWasherFix(prisma as never, true, quiet)
    if (!ap.ok) throw new Error(ap.error)
    g.__CR_FLOW_PID = PID
    const rows = await computeInventoryOverview(PID)
    eq('M7 원래 카드에 5월 구매가 돌아와 숨김 해제', [await labelOf(I.fe71), (await prisma.trackedItem.findUnique({ where: { id: I.card87 } }))?.isArchived], ['세탁조크리너', false])
    eq('M7 450ml 카드 이름·개수·위치·창고', await prisma.trackedItem.findUnique({ where: { id: I.cardBf }, select: { label: true, trackUnit: true, hubLocationId: true } }), { label: '세탁조크리너 450ml', trackUnit: 'qty', hubLocationId: I.office })
    eq('M7 450ml 잔량 10개', rows.find((r: { id: string }) => r.id === I.cardBf)?.currentStock, 10)
    eq('M7 빈 카드·거절 규칙 삭제', [await prisma.trackedItem.count({ where: { id: I.card33 } }), await prisma.trackedItemMergeRule.count({ where: { id: I.mute } })], [0, 0])
    eq('M7 다시 적용하면 거부(CAS)', (await fix.runWasherFix(prisma as never, true, quiet)).ok, false)
    eq('M7 되돌림 ok', await fix.revertWasherFix(prisma as never, J(ap.undo!), quiet), { ok: true })
    eq('M7 되돌림 바이트 동일', await full(), before)
    // 적용 뒤 점검이 생기면 되돌림 거부
    const ap2 = await fix.runWasherFix(prisma as never, true, quiet)
    if (!ap2.ok) throw new Error(ap2.error)
    await new Promise(res => setTimeout(res, 5))
    await prisma.stockCheck.create({ data: { trackedItemId: I.card87, date: new Date('2026-11-03T00:00:00Z'), remainingQty: 6 } })
    const mid = await full()
    eq('M7b 적용 뒤 점검이 있으면 되돌림 거부', (await fix.revertWasherFix(prisma as never, J(ap2.undo!), quiet)).ok, false)
    eq('M7b 거부는 아무것도 안 바꾼다', await full(), mid)
    g.__CR_FLOW_PID = P1
  }

  console.log(`[병합 확인·시드 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
