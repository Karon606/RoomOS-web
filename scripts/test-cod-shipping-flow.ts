// 착불 배송비 통합 회귀(등록·주문 묶기·수령 셋·없었음 닫기와 각 적용취소). 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-cod-shipping-flow.ts
//
// 왜 통합인가(신고 6ab4f868·a016642e, 2026-11-02). 배송비 행이 자기 결제수단으로 태어나는지, 착불 금액을 비우면 주문만 서는지,
// 수령 때 적은 배송비 줄이 수령과 한 트랜잭션이고 [수령 취소] 가 그 줄까지 지우는지(그 사이 바뀌면 전체 거부),
// 남의 영업장 계정을 못 잇는지는 실제 쓰기를 돌려야 보인다. 대역·운영 DB 차단은 현금영수증 하네스와 같은 판이다.
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
  const fin = await import('@/app/(app)/finance/actions')
  const sp = await import('@/app/(app)/finance/shipPayActions')
  const inv = await import('@/app/(app)/inventory/actions')
  const assets = await import('@/app/(app)/inventory/assets/actions')
  const { computeInventoryOverview } = await import('@/app/(app)/inventory/overview')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  const acc = async (pid: string, type: 'CREDIT_CARD' | 'BANK_ACCOUNT', brand: string) =>
    (await prisma.financialAccount.create({ data: { propertyId: pid, type, brand } })).id as string
  const CARD = await acc(P1, 'CREDIT_CARD', '하나카드')
  const BANK = await acc(P1, 'BANK_ACCOUNT', '신한')
  const OTHER_BANK = await acc(P2, 'BANK_ACCOUNT', '남의은행')
  g.__CR_FLOW_PID = P1

  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const items = (label: string, amount: number, qty = '1') => JSON.stringify([{ label, qtyValue: qty, qtyUnit: '개', amount }])
  const head = { date: '2026-10-28', payMethod: '신용카드', financialAccountId: CARD, financeName: '하나카드', category: '소모품비', vendor: '쿠팡' }
  const shipsOf = async (orderId: string | null) => orderId ? prisma.expense.findMany({ where: { orderId, isShipping: true } }) : []
  const rowOf = async (label: string) => (await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: label, isShipping: false }, orderBy: { createdAt: 'desc' } }))!

  // ── E1 등록: 착불 + 금액 + 기본(계좌이체·신한) ─ 배송비 행은 자기 수단, 본품은 신용카드 미정산 ─────────────
  {
    const r = await fin.addExpense(fd({ ...head, amount: '10000', itemLabel: '착불품A', qtyValue: '1', qtyUnit: '개', itemsJson: items('착불품A', 10000),
      orderShipping: '3000', orderShippingType: '착불', orderShipPayMethod: '계좌이체', orderShipAccountId: BANK }))
    eq('E1 등록 ok', r.ok, true)
    const a = await rowOf('착불품A')
    const ships = await shipsOf(a.orderId)
    eq('E1 본품 신용카드 · 미정산', [a.payMethod, a.financeName, a.settleStatus], ['신용카드', '하나카드', 'UNSETTLED'])
    eq('E1 배송비 행 계좌이체 · 신한 · 정산완료 · 3000', ships.map(s => [s.payMethod, s.financialAccountId === BANK, s.financeName, s.settleStatus, s.amount]),
      [['계좌이체', true, '신한', 'SETTLED', 3000]])
  }
  // ── E2 등록: 선불 + '같은 수단' ─ 종전처럼 본품 수단 그대로 ───────────────────────────────────────────
  {
    const r = await fin.addExpense(fd({ ...head, amount: '10000', itemLabel: '선불품', qtyValue: '1', qtyUnit: '개', itemsJson: items('선불품', 10000),
      orderShipping: '2500', orderShippingType: '선불', orderShipPayMethod: '__same__', orderShipAccountId: '' }))
    eq('E2 등록 ok', r.ok, true)
    const ships = await shipsOf((await rowOf('선불품')).orderId)
    eq('E2 배송비 행 = 본품 수단', ships.map(s => [s.payMethod, s.financialAccountId === CARD, s.settleStatus]), [['신용카드', true, 'UNSETTLED']])
  }
  // ── E3 등록: 옛 화면(배송비 수단 칸 없음) ─ 본품 수단 그대로 ──────────────────────────────────────────
  {
    const r = await fin.addExpense(fd({ ...head, amount: '10000', itemLabel: '옛화면품', qtyValue: '1', qtyUnit: '개', itemsJson: items('옛화면품', 10000),
      orderShipping: '2000', orderShippingType: '착불' }))
    eq('E3 등록 ok', r.ok, true)
    const ships = await shipsOf((await rowOf('옛화면품')).orderId)
    eq('E3 옛 화면은 본품 수단', ships.map(s => s.payMethod), ['신용카드'])
  }
  // ── E4 남의 영업장 계정·종류가 다른 계정은 거부, 아무것도 안 생긴다 ────────────────────────────────────
  {
    const before = await prisma.expense.count({ where: { propertyId: P1 } })
    const r1 = await fin.addExpense(fd({ ...head, amount: '10000', itemLabel: '거부품', qtyValue: '1', qtyUnit: '개', itemsJson: items('거부품', 10000),
      orderShipping: '3000', orderShippingType: '착불', orderShipPayMethod: '계좌이체', orderShipAccountId: OTHER_BANK }))
    const r2 = await fin.addExpense(fd({ ...head, amount: '10000', itemLabel: '거부품', qtyValue: '1', qtyUnit: '개', itemsJson: items('거부품', 10000),
      orderShipping: '3000', orderShippingType: '착불', orderShipPayMethod: '계좌이체', orderShipAccountId: CARD }))
    eq('E4 남의 계정·종류 다른 계정 거부', [r1.ok, r2.ok], [false, false])
    eq('E4 쓰기 없음', await prisma.expense.count({ where: { propertyId: P1 } }), before)
  }
  // ── E5 등록: 착불 금액 비움 ─ 품목 하나여도 주문(착불)만 서고 배송비 행은 없다(0원 행 금지) ─────────────────
  let COD_ORDER = ''
  let COD_ITEM = ''
  {
    const r = await fin.addExpense(fd({ ...head, amount: '12000', itemLabel: '착불미정', qtyValue: '2', qtyUnit: '개', itemsJson: items('착불미정', 12000, '2'),
      orderShipping: '0', orderShippingType: '착불', orderShipPayMethod: '계좌이체', orderShipAccountId: '' }))
    eq('E5 등록 ok', r.ok, true)
    const a = await rowOf('착불미정')
    COD_ORDER = a.orderId ?? ''
    COD_ITEM = a.id
    const o = a.orderId ? await prisma.expenseOrder.findUnique({ where: { id: a.orderId } }) : null
    eq('E5 단일 품목도 주문, 결제구분 착불', o?.shippingType ?? null, '착불')
    eq('E5 배송비 행 없음(0원 행 금지)', (await shipsOf(a.orderId)).length, 0)
    // getExpenses 가 배송비 줄 수를 싣는다(상세 '배송비 미기록').
    const list = await fin.getExpenses('2026-10')
    eq('E5 목록 주문에 shipCount 0', list.find(x => x.id === a.id)?.order?.shipCount ?? null, 0)
  }

  // ── R1 소모품 수령: 수령 대기에 묻는 표식, 금액 + 계좌이체로 받으면 배송비 줄이 한 트랜잭션에 ───────────────
  {
    const ov = await computeInventoryOverview(P1)
    const pend = ov.flatMap(r => r.pendingPurchases).find(p => p.id === COD_ITEM)
    eq('R1 수령 대기 표식 codAsk', [pend?.codAsk, pend?.orderId === COD_ORDER], [true, true])
    const r = await inv.confirmReceipt(COD_ITEM, undefined, undefined, undefined, { amount: 4000, payMethod: '계좌이체', accountId: BANK })
    eq('R1 수령 ok', r.ok, true)
    const ships = await shipsOf(COD_ORDER)
    eq('R1 배송비 줄 1건 · 계좌이체 · 정산완료 · 귀속월 본품 달', ships.map(s => [s.amount, s.payMethod, s.settleStatus, s.detail, s.excludeFromInventory]),
      [[4000, '계좌이체', 'SETTLED', '배송비 (착불)', true]])
    eq('R1 조각을 돌려준다', r.ok && !!r.codShipUndo && r.codShipUndo.id === ships[0]?.id, true)
    // 이미 적힌 주문은 다시 안 묻는다(서버도 거부)
    const ov2 = await computeInventoryOverview(P1)
    eq('R1 다시 묻지 않음(수령 대기에 없음)', ov2.flatMap(x => x.pendingPurchases).some(p => p.id === COD_ITEM), false)
    // R2 [수령 취소] 가 배송비 줄까지 한 트랜잭션으로
    const u = await inv.undoConfirmReceipt(COD_ITEM, r.ok && r.codShipUndo ? { codShip: r.codShipUndo } : undefined)
    eq('R2 수령 취소 ok', u.ok, true)
    eq('R2 배송비 줄도 사라짐 · 수령 대기 복귀', [(await shipsOf(COD_ORDER)).length, (await prisma.expense.findUnique({ where: { id: COD_ITEM } }))?.receivedAt ?? null], [0, null])
  }
  // ── R3 CAS: 그 사이 배송비 줄을 고치면 [수령 취소] 전체가 거부되고 수령도 남는다 ─────────────────────────
  {
    const r = await inv.confirmReceipt(COD_ITEM, undefined, undefined, undefined, { amount: 4000, payMethod: '현금', accountId: null })
    eq('R3 재수령 ok', r.ok, true)
    const ship = (await shipsOf(COD_ORDER))[0]
    eq('R3 현금 줄', [ship?.payMethod, ship?.financialAccountId ?? null], ['현금', null])
    await prisma.expense.update({ where: { id: ship.id }, data: { amount: 4500 } })
    const u = await inv.undoConfirmReceipt(COD_ITEM, r.ok && r.codShipUndo ? { codShip: r.codShipUndo } : undefined)
    eq('R3 바뀐 줄이면 거부', u.ok, false)
    eq('R3 수령·줄 그대로', [!!(await prisma.expense.findUnique({ where: { id: COD_ITEM } }))?.receivedAt, (await shipsOf(COD_ORDER)).length], [true, 1])
    // R4 토스트 뒤 수령 취소(조각 없음)는 줄을 지우지 않고 남았다고 말한다
    const u2 = await inv.undoConfirmReceipt(COD_ITEM)
    eq('R4 조각 없는 수령 취소 ok · 남았다고 말함', [u2.ok, u2.ok && u2.codShipKept === true], [true, true])
    eq('R4 줄은 남는다', (await shipsOf(COD_ORDER)).length, 1)
    await prisma.expense.deleteMany({ where: { orderId: COD_ORDER, isShipping: true } })
  }
  // ── R5 물을 주문이 아닌데 배송비가 오면 거부(아무것도 안 바뀐다) ───────────────────────────────────────
  {
    const a = await rowOf('선불품')
    const r = await inv.confirmReceipt(a.id, undefined, undefined, undefined, { amount: 1000, payMethod: '현금', accountId: null })
    eq('R5 선불 주문에 착불 배송비 거부', [r.ok, !!(await prisma.expense.findUnique({ where: { id: a.id } }))?.receivedAt], [false, false])
  }
  // ── R6 부분 수령 + 배송비 줄, 부분 수령 적용취소가 줄까지 ────────────────────────────────────────────
  {
    const r = await inv.confirmReceipt(COD_ITEM, undefined, 1, undefined, { amount: 3500, payMethod: '계좌이체', accountId: '' })
    eq('R6 부분 수령 ok · 조각 둘', [r.ok, r.ok && !!r.undo, r.ok && !!r.codShipUndo], [true, true, true])
    eq('R6 줄 1건', (await shipsOf(COD_ORDER)).length, 1)
    const u = r.ok && r.undo ? await inv.undoPartialReceipt(r.undo, r.codShipUndo ?? null) : { ok: false }
    eq('R6 부분 수령 적용취소 ok · 줄 없음', [u.ok, (await shipsOf(COD_ORDER)).length], [true, 0])
  }

  // ── C1 '없었음' 으로 닫기와 적용취소 ───────────────────────────────────────────────────────────
  {
    const c = await sp.closeCodShipping(COD_ORDER)
    eq('C1 닫기 ok · 결제구분 비움', [c.ok, (await prisma.expenseOrder.findUnique({ where: { id: COD_ORDER } }))?.shippingType ?? null], [true, null])
    eq('C1 닫힌 주문은 수령 때 안 묻는다', (await computeInventoryOverview(P1)).flatMap(x => x.pendingPurchases).find(p => p.id === COD_ITEM)?.codAsk, false)
    const u = await sp.undoCloseCodShipping(COD_ORDER)
    eq('C1 적용취소 ok · 다시 착불', [u.ok, (await prisma.expenseOrder.findUnique({ where: { id: COD_ORDER } }))?.shippingType], [true, '착불'])
    g.__CR_FLOW_PID = P2
    eq('C2 남의 영업장은 못 닫는다', (await sp.closeCodShipping(COD_ORDER)).ok, false)
    g.__CR_FLOW_PID = P1
    // 배송비 줄이 있으면 닫기 거부(CAS)
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-28T00:00:00Z'), amount: 100, category: '소모품비', orderId: COD_ORDER, isShipping: true, excludeFromInventory: true } })
    eq('C3 줄이 있으면 닫기 거부', (await sp.closeCodShipping(COD_ORDER)).ok, false)
    await prisma.expense.deleteMany({ where: { orderId: COD_ORDER, isShipping: true } })
  }

  // ── M1 주문 묶기(수정 폼): 미기록 착불에 금액을 적으면 자기 수단으로 새 줄, 적용취소가 지운다 ───────────────────
  {
    const r = await fin.attachShippingToOrder({ expenseIds: [COD_ITEM], amount: 3800, shippingType: '착불', shippingMemo: null, shipPay: { payMethod: '계좌이체', accountId: BANK } })
    eq('M1 묶기 ok · 조각(만든 줄)', [r.ok, r.ok && r.shipUndo?.ship?.created], [true, true])
    const s1 = (await shipsOf(COD_ORDER))[0]
    eq('M1 새 줄 계좌이체 정산완료', [s1?.payMethod, s1?.settleStatus, s1?.amount], ['계좌이체', 'SETTLED', 3800])
    // M2 다시 저장(같은 값)이면 조각 없음, 착불 줄 날짜는 대표 지출로 덮지 않는다
    await prisma.expense.update({ where: { id: s1.id }, data: { date: new Date('2026-11-02T00:00:00Z'), targetMonth: '2026-10' } })
    const r2 = await fin.attachShippingToOrder({ expenseIds: [COD_ITEM], amount: 3800, shippingType: '착불', shippingMemo: null, shipPay: { payMethod: '계좌이체', accountId: BANK } })
    const s2 = (await shipsOf(COD_ORDER))[0]
    eq('M2 바뀐 것 없으면 조각 없음', r2.ok && !r2.shipUndo, true)
    eq('M2 착불 줄 날짜·귀속월 지킴', [s2.date.toISOString().slice(0, 10), s2.targetMonth], ['2026-11-02', '2026-10'])
    // M3 수단을 현금으로 바꾸면 고친 줄 조각, 적용취소가 직전 값으로
    const r3 = await fin.attachShippingToOrder({ expenseIds: [COD_ITEM], amount: 3800, shippingType: '착불', shippingMemo: null, shipPay: { payMethod: '현금', accountId: null } })
    eq('M3 고친 줄 조각', r3.ok && r3.shipUndo?.ship?.created === false, true)
    eq('M3 현금으로', (await shipsOf(COD_ORDER))[0].payMethod, '현금')
    const u3 = r3.ok && r3.shipUndo ? await fin.undoAttachShipping(r3.shipUndo) : { ok: false }
    eq('M3 적용취소 ok · 계좌이체 복원', [u3.ok, (await shipsOf(COD_ORDER))[0].payMethod, (await shipsOf(COD_ORDER))[0].financialAccountId === BANK], [true, '계좌이체', true])
    // M4 그 사이 바뀌면 적용취소 거부
    const r4 = await fin.attachShippingToOrder({ expenseIds: [COD_ITEM], amount: 3900, shippingType: '착불', shippingMemo: null, shipPay: { payMethod: '계좌이체', accountId: BANK } })
    await prisma.expense.updateMany({ where: { orderId: COD_ORDER, isShipping: true }, data: { amount: 5000 } })
    const u4 = r4.ok && r4.shipUndo ? await fin.undoAttachShipping(r4.shipUndo) : { ok: true }
    eq('M4 그 사이 바뀌면 거부', u4.ok, false)
    // M5 만든 줄 적용취소는 줄을 지우고 주문 결제구분을 직전 값으로
    await prisma.expense.deleteMany({ where: { orderId: COD_ORDER, isShipping: true } })
    const r5 = await fin.attachShippingToOrder({ expenseIds: [COD_ITEM], amount: 1000, shippingType: '착불', shippingMemo: null, shipPay: { payMethod: '계좌이체', accountId: '' } })
    const u5 = r5.ok && r5.shipUndo ? await fin.undoAttachShipping(r5.shipUndo) : { ok: false }
    eq('M5 만든 줄 적용취소 · 다시 미기록', [u5.ok, (await shipsOf(COD_ORDER)).length, (await prisma.expenseOrder.findUnique({ where: { id: COD_ORDER } }))?.shippingType], [true, 0, '착불'])
    // M6 묶기에 남의 영업장 계정은 거부
    const r6 = await fin.attachShippingToOrder({ expenseIds: [COD_ITEM], amount: 1000, shippingType: '착불', shippingMemo: null, shipPay: { payMethod: '계좌이체', accountId: OTHER_BANK } })
    eq('M6 남의 계정 거부 · 줄 없음', [r6.ok, (await shipsOf(COD_ORDER)).length], [false, 0])
  }

  // ── A1 비품 수령: 수령 창 표식, 금액을 적으면 줄, 수령 적용취소가 줄까지 ─────────────────────────────────
  {
    const r = await fin.addExpense(fd({ ...head, category: '비품', amount: '50000', itemLabel: '선반', qtyValue: '1', qtyUnit: '개', itemsJson: items('선반', 50000),
      orderShipping: '', orderShippingType: '착불', orderShipPayMethod: '계좌이체', orderShipAccountId: '' }))
    eq('A1 비품 등록 ok', r.ok, true)
    const a = await rowOf('선반')
    const data = await assets.getDurableItems()
    const card = data.pending.find(it => it.ids.includes(a.id))
    eq('A1 수령 대기 카드 codAsk', card?.codAsk ?? false, true)
    const rr = await assets.setAssetReceived([a.id], true, null, { codShip: { amount: 7000, payMethod: '계좌이체', accountId: BANK } })
    eq('A1 수령 ok · 줄', [rr.ok, (await shipsOf(a.orderId)).map(s => [s.amount, s.payMethod, s.settleStatus])], [true, [[7000, '계좌이체', 'SETTLED']]])
    const u = rr.ok && rr.undo ? await assets.undoAssetReceipt(rr.undo, rr.codShipUndo ?? null) : { ok: false }
    eq('A1 수령 적용취소 ok · 줄 없음 · 수령 대기', [u.ok, (await shipsOf(a.orderId)).length, (await prisma.expense.findUnique({ where: { id: a.id } }))?.receivedAt ?? null], [true, 0, null])
    // A2 수령 대기로 돌리기(토스트 뒤)는 줄을 지우지 않고 남았다고 말한다
    const rr2 = await assets.setAssetReceived([a.id], true, null, { codShip: { amount: 7000, payMethod: '계좌이체', accountId: BANK } })
    eq('A2 재수령 ok', rr2.ok, true)
    const back = await assets.setAssetReceived([a.id], false)
    eq('A2 수령 대기로 · 남았다고 말함 · 줄 남음', [back.ok, back.ok && back.codShipKept === true, (await shipsOf(a.orderId)).length], [true, true, 1])
  }

  console.log(`[착불 배송비 통합] 통과 ${pass} / 실패 ${fail}`)
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
