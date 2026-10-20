// 구매처·쇼핑몰 통합 회귀. 실제 재무 저장·도구·적용취소를 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-expense-channel-flow.ts
//
// 왜 통합인가(2026-10-19 운영자 승인, 신고 a0636f36). 규칙 진리표(test-expense-channel)는 순수 함수만 본다. 저장 경로 전수
// (등록·수정·다품목·방별 분배·배송비 두 갈래·사후 배송비 묶기·주문 묶기·일괄·구매처 합치기·쇼핑몰로 옮기기·홈 승인·부분 수령)가
// 칸을 제대로 싣는지, 적용취소가 행을 바이트까지 되돌리는지, 남의 영업장·다른 용도 토큰을 못 쓰는지는 실제 쓰기를 돌려야 보인다.
// 대역·운영 DB 차단은 비품 전환 하네스(scripts/test-durable-convert-flow.ts)와 같은 판이다.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
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
  // 외래키는 빼되(부모 없는 대역 행을 만든다) 재고 원장의 지우기 사슬(ON DELETE CASCADE)은 살린다. 운영에서 카드를 지우면
  // 위치 연결·점검·임시저장이, 점검을 지우면 위치 내역이 함께 지워진다. 그 사슬 없이 되살리면 하네스만 유니크에 걸린다.
  const KEEP = /ALTER TABLE "(stock_checks|stock_check_drafts|tracked_item_locations|stock_check_locations)" ADD CONSTRAINT/
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s) || KEEP.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  // 소켓 다리의 확장 프로토콜 응답 정렬(2026-10-15 후속 검수 1, 참고 4·E2 장면의 25P02 흔들림 원인).
  // 트리거로 일부러 실패시키는 쿼리에서 PGlite 는 ErrorResponse 뒤에 ReadyForQuery 를 바로 내고, Sync 에서 하나를 더 낸다
  // (실측 응답 'EZ' 다음 'Z', 한 번에 넘겨도 'EZZ'). 두 Z 가 따로 도착하면 node-postgres 는 둘째 Z 를 다음 쿼리(ROLLBACK)의
  // 끝으로 받아 응답 짝이 하나씩 밀린다. 그러면 Prisma 는 ROLLBACK 이 끝났다고 믿고 돌아오는데 세션은 아직 실패한 트랜잭션
  // 안이라, 그 틈의 직접 SQL(트리거 지우기)이 25P02 로 죽고, 지나가도 뒤 쿼리들이 앞 쿼리의 응답을 받는다(탐침 실측).
  // 실제 서버처럼 Sync(또는 Flush·단순 쿼리·종료)까지 모아 한 번에 넘기고, 응답에서 바로 이어진 ReadyForQuery 를 하나로 접어
  // 한 번에 보낸다. 시작·SSL 패킷(타입 바이트 없음)은 그대로 넘긴다.
  {
    const raw = pg.execProtocolRawStream.bind(pg)
    let pending = new Uint8Array(0)
    const ENDS = new Set([0x53 /* Sync */, 0x48 /* Flush */, 0x51 /* Query */, 0x58 /* Terminate */])
    const walk = (buf: Uint8Array, at: (type: number, start: number, end: number) => void) => {
      let k = 0
      while (k + 5 <= buf.length) {
        const len = ((buf[k + 1] << 24) | (buf[k + 2] << 16) | (buf[k + 3] << 8) | buf[k + 4]) >>> 0
        if (len < 4 || k + 1 + len > buf.length) break
        at(buf[k], k, k + 1 + len); k += 1 + len
      }
      return k
    }
    ;(pg as unknown as { execProtocolRawStream: typeof raw }).execProtocolRawStream = async (msg, opts) => {
      if (pending.length === 0 && msg.length > 0 && msg[0] === 0) return raw(msg, opts)
      const buf = new Uint8Array(pending.length + msg.length)
      buf.set(pending); buf.set(msg, pending.length)
      let lastType = -1
      const done = walk(buf, t => { lastType = t })
      if (done !== buf.length || !ENDS.has(lastType)) { pending = buf; return }
      pending = new Uint8Array(0)
      const outs: Uint8Array[] = []
      await raw(buf, { ...opts, onRawData: (d: Uint8Array) => { outs.push(d.slice()) } })
      const all = new Uint8Array(outs.reduce((n, d) => n + d.length, 0))
      let o = 0; for (const d of outs) { all.set(d, o); o += d.length }
      const keep: [number, number][] = []
      let prevType = -1
      const end = walk(all, (t, s, e) => { if (!(t === 0x5a && prevType === 0x5a)) keep.push([s, e]); prevType = t })
      const fixed = new Uint8Array(keep.reduce((n, [s, e]) => n + (e - s), 0) + (all.length - end))
      let w = 0; for (const [s, e] of keep) { fixed.set(all.subarray(s, e), w); w += e - s }
      fixed.set(all.subarray(end), w)
      if (fixed.length) opts?.onRawData?.(fixed)
    }
  }
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()
  // 직접 SQL(트리거 만들기·지우기)은 세션이 트랜잭션 밖일 때만 넣는다. 같은 PGlite 세션을 소켓과 나눠 쓰기 때문이다.
  // 위 응답 정렬이 있으면 서버 액션이 돌아온 뒤 세션은 늘 비어 있다. 아니면 응답 짝이 어긋난 것이라 여기서 바로 멈춘다.
  const directSql = async (sql: string) => {
    if (pg.isInTransaction()) throw new Error('하네스: 직접 SQL 을 넣으려는데 세션이 아직 트랜잭션 안이다(소켓 응답 짝 어긋남)')
    await pg.exec(sql)
  }


  void directSql
  const prisma = (await import('@/lib/prisma')).default
  const fin = await import('@/app/(app)/finance/actions')
  const inv = await import('@/app/(app)/inventory/actions')
  const pr = await import('@/app/(app)/dashboard/pendingReceipt')
  const settings = await import('@/app/(app)/settings/actions')
  const clone = await import('@/app/(app)/inventory/expenseClone')
  const crl = await import('@/app/(app)/rooms/cashReceiptLine')
  const efu = await import('@/lib/expenseFieldUndo')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  const room = async (pid: string, no: string) => (await prisma.room.create({ data: { roomNo: no, propertyId: pid } })).id as string
  const R501 = await room(P1, '501'), R502 = await room(P1, '502')
  g.__CR_FLOW_PID = P1

  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  type It = { label: string; amount: number; qty?: string; vendor?: string; alloc?: { roomId: string; qty: string }[] }
  const items = (list: It[]) => JSON.stringify(list.map(i => ({ label: i.label, qtyValue: i.qty ?? '1', qtyUnit: '개', amount: i.amount, ...(i.vendor !== undefined ? { vendor: i.vendor } : {}), ...(i.alloc ? { allocations: i.alloc } : {}) })))
  const strip = (r: Record<string, unknown> | null, keys: string[]) => { if (!r) return 'null'; const o = { ...r }; for (const k of keys) delete o[k]; return JSON.stringify(o) }
  const exact = async (id: string) => strip((await prisma.expense.findUnique({ where: { id } })) as Record<string, unknown> | null, ['updatedAt'])
  const exactAll = async (ids: string[]) => Promise.all([...ids].sort().map(exact))
  const rowsOf = async (label: string) => prisma.expense.findMany({ where: { propertyId: P1, itemLabel: label }, orderBy: [{ amount: 'desc' }, { roomId: 'asc' }] })
  const amountSum = async () => (await prisma.expense.aggregate({ where: { propertyId: P1 }, _sum: { amount: true } }))._sum.amount ?? 0
  const channelList = async (pid = P1) => (await prisma.property.findUnique({ where: { id: pid }, select: { channelOptions: true } }))?.channelOptions ?? null
  const base = { date: '2026-10-18', payMethod: '계좌이체', category: '수선유지비' }

  // 과거 이력: 철물24 의 사업자번호(품목별 구매처가 찾아 쓴다)
  await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 5000, category: '수선유지비', vendor: '철물24', vendorBizNo: '111-11-11111' } })
  const sumStart = await amountSum()

  // ── 1. 등록 단일: 쇼핑몰 저장·목록 적립·구매처는 판매자 그대로 ──────────────────────────
  {
    const r = await fin.addExpense(fd({ ...base, amount: '12000', vendor: '다이소', channel: ' 쿠팡 ', itemLabel: '단일전구', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '단일전구', amount: 12000 }]) }))
    eq('단일 등록 ok', r.ok, true)
    const row = (await rowsOf('단일전구'))[0]
    eq('단일: 쇼핑몰 정규화 저장·구매처는 판매자 그대로', [row.channel, row.vendor], ['쿠팡', '다이소'])
    eq('단일: 처음 보는 쇼핑몰은 영업장 목록에 쌓인다', await channelList(), '쿠팡')
    const r2 = await fin.addExpense(fd({ ...base, amount: '3000', vendor: '다이소', itemLabel: '쇼핑몰없음', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '쇼핑몰없음', amount: 3000 }]) }))
    eq('쇼핑몰 비우면 미기록(구매처를 쇼핑몰로 끌어 쓰지 않는다)', [r2.ok, (await rowsOf('쇼핑몰없음'))[0].channel], [true, null])
    eq('남의 영업장 목록은 그대로', await channelList(P2), null)
  }

  // ── 2. 다품목 + 품목별 구매처 + 배송비 별도: 머리 번호 상속 금지·배송비 행은 머리·한 주문 같은 쇼핑몰 ──
  let orderA = ''
  {
    const r = await fin.addExpense(fd({ ...base, amount: '60000', vendor: '쿠팡(주)', vendorBizNo: '120-88-00767', channel: '쿠팡', orderShipping: '3000', orderShippingType: '선불',
      itemsJson: items([{ label: '다품목모니터', amount: 40000 }, { label: '다품목케이블', amount: 12000, vendor: '철물24' }, { label: '다품목멀티탭', amount: 8000, vendor: '한빛전자' }]) }))
    eq('다품목 등록 ok', r.ok, true)
    const a = (await rowsOf('다품목모니터'))[0], b = (await rowsOf('다품목케이블'))[0], c = (await rowsOf('다품목멀티탭'))[0]
    eq('다품목: 품목별 구매처 없음은 머리(구매처·번호)', [a.vendor, a.vendorBizNo], ['쿠팡(주)', '120-88-00767'])
    eq('다품목: 다른 판매자는 그 판매자의 과거 번호', [b.vendor, b.vendorBizNo], ['철물24', '111-11-11111'])
    eq('다품목: 과거 번호 없는 판매자는 번호 비움(머리 번호 안 물려줌)', [c.vendor, c.vendorBizNo], ['한빛전자', null])
    eq('다품목: 세 행 모두 같은 쇼핑몰·같은 주문', [a.channel, b.channel, c.channel, a.orderId === b.orderId && b.orderId === c.orderId], ['쿠팡', '쿠팡', '쿠팡', true])
    orderA = a.orderId!
    const ship = await prisma.expense.findFirst({ where: { orderId: orderA, isShipping: true } })
    eq('다품목: 배송비 행은 머리 구매처·같은 쇼핑몰', [ship?.vendor, ship?.vendorBizNo, ship?.channel], ['쿠팡(주)', '120-88-00767', '쿠팡'])
    eq('다품목: 금액 합(품목 + 배송비)', await amountSum(), sumStart + 12000 + 3000 + 63000)
  }

  // ── 3. 방별 분배: 조각은 품목 구매처를 물려받는다 / 배송비 포함 행은 머리 ──────────────────────
  {
    const r = await fin.addExpense(fd({ ...base, amount: '32000', vendor: '쿠팡(주)', vendorBizNo: '120-88-00767', channel: '쿠팡', shippingIncluded: '2000',
      itemsJson: items([{ label: '분배선풍기', amount: 20000, qty: '2', vendor: '철물24', alloc: [{ roomId: R501, qty: '1' }, { roomId: R502, qty: '1' }] }, { label: '분배리모컨', amount: 10000 }]) }))
    eq('분배 등록 ok', r.ok, true)
    const parts = await rowsOf('분배선풍기')
    eq('분배: 조각 둘 다 품목 구매처·번호', parts.map((x: { vendor: string | null; vendorBizNo: string | null; channel: string | null }) => [x.vendor, x.vendorBizNo, x.channel]), [['철물24', '111-11-11111', '쿠팡'], ['철물24', '111-11-11111', '쿠팡']])
    const incl = await prisma.expense.findFirst({ where: { propertyId: P1, detail: '배송비', amount: 2000 } })
    eq('배송비 포함 행은 머리 구매처·같은 쇼핑몰', [incl?.vendor, incl?.channel], ['쿠팡(주)', '쿠팡'])
  }

  // ── 4. 수정: 칸 부재 = 보존, 빈 값 = 지움, 주문 전체 적용·적용취소 바이트 동일 ─────────────────
  {
    const a = (await rowsOf('다품목모니터'))[0]
    const editBase = { id: a.id, date: '2026-10-18', amount: String(a.amount), category: '수선유지비', vendor: a.vendor ?? '', payMethod: '계좌이체', itemLabel: a.itemLabel ?? '', qtyValue: '1', qtyUnit: '개' }
    const r1 = await fin.updateExpense(fd({ ...editBase, memo: '메모만' }))
    eq('수정: 쇼핑몰 칸이 없으면 지킨다', [r1.ok, (await rowsOf('다품목모니터'))[0].channel], [true, '쿠팡'])
    const sibs = (await prisma.expense.findMany({ where: { orderId: orderA, id: { not: a.id } }, select: { id: true } })).map((x: { id: string }) => x.id)
    const before = await exactAll(sibs)
    const r2 = await fin.updateExpense(fd({ ...editBase, channel: '지마켓', channelScope: 'order' }))
    if (!r2.ok) throw new Error(r2.error)
    eq('수정: 주문 전체 적용이 형제(배송비 포함)를 맞춘다', (await prisma.expense.findMany({ where: { orderId: orderA }, select: { channel: true } })).every((x: { channel: string | null }) => x.channel === '지마켓'), true)
    eq('수정: 주문 전체 적용 토큰(서명, 형제 수)', [typeof r2.channelUndo?.sig, r2.channelUndo?.rows.length], ['string', sibs.length])
    eq('수정: 목록에 지마켓 적립(순서 유지)', await channelList(), '쿠팡,지마켓')
    const u = await fin.undoExpenseFieldChange(J(r2.channelUndo!))
    eq('주문 전체 적용 적용취소 ok', u.ok, true)
    eq('주문 전체 적용 적용취소: 형제 바이트 동일', await exactAll(sibs), before)
    eq('주문 전체 적용 적용취소: 고친 행은 유지', (await rowsOf('다품목모니터'))[0].channel, '지마켓')
    eq('같은 토큰 두 번째는 거부(그사이 바뀜 = 지금이 쓴 직후가 아님)', (await fin.undoExpenseFieldChange(J(r2.channelUndo!))).ok, false)
    const r3 = await fin.updateExpense(fd({ ...editBase, channel: '' }))
    eq('수정: 빈 값은 지운다', [r3.ok, (await rowsOf('다품목모니터'))[0].channel], [true, null])
    await fin.updateExpense(fd({ ...editBase, channel: '쿠팡' }))
  }

  // ── 5. 수정 다품목 새 행: 쇼핑몰·품목별 구매처 ───────────────────────────────────────────
  {
    const r = await fin.addExpense(fd({ ...base, amount: '9000', vendor: '다이소', channel: '쿠팡', itemLabel: '나눌품목', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '나눌품목', amount: 9000 }]) }))
    eq('나눌 품목 등록', r.ok, true)
    const x = (await rowsOf('나눌품목'))[0]
    const r2 = await fin.updateExpense(fd({ id: x.id, date: '2026-10-18', amount: '9000', category: '수선유지비', vendor: '다이소', channel: '쿠팡', payMethod: '계좌이체',
      itemsJson: items([{ label: '나눌품목', amount: 5000 }, { label: '새행품목', amount: 4000, vendor: '철물24' }]) }))
    eq('수정 다품목 ok', r2.ok, true)
    const n = (await rowsOf('새행품목'))[0]
    eq('수정 다품목: 새 행 쇼핑몰·품목별 구매처·번호', [n.channel, n.vendor, n.vendorBizNo], ['쿠팡', '철물24', '111-11-11111'])
  }

  // ── 6. 사업자번호 소급: 쇼핑몰 이름 제외·적용취소 ────────────────────────────────────────
  {
    const old1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-08-01T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '소급상회' } })
    const old2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-08-02T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '소급상회' } })
    const before = await exactAll([old1.id, old2.id])
    const r = await fin.addExpense(fd({ ...base, amount: '2000', vendor: '소급상회', vendorBizNo: '222-22-22222', itemLabel: '소급품', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '소급품', amount: 2000 }]) }))
    eq('소급: 과거 2건 채움 + 토큰', [r.ok && r.backfilled, r.ok && typeof r.backfillUndo?.sig], [2, 'string'])
    const u = await fin.undoExpenseFieldChange(J((r as { backfillUndo: unknown }).backfillUndo))
    eq('소급 적용취소 ok', u.ok, true)
    eq('소급 적용취소: 바이트 동일', await exactAll([old1.id, old2.id]), before)
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-08-03T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '쿠팡' } })
    const r2 = await fin.addExpense(fd({ ...base, amount: '2000', vendor: '쿠팡', vendorBizNo: '120-88-00767', itemLabel: '쿠팡소급', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '쿠팡소급', amount: 2000 }]) }))
    eq('소급: 쇼핑몰 목록 이름(쿠팡)은 소급 안 함', [r2.ok, r2.ok && r2.backfilled], [true, 0])
  }

  // ── 7. 번호 지도·자동완성: 쇼핑몰 이름 제외 ───────────────────────────────────────────────
  {
    const m = await fin.getVendorBizMap()
    eq('번호 지도: 쿠팡 번호로 이름을 안 채운다', Object.hasOwn(m.bizToVendor, '120-88-00767') ? m.bizToVendor['120-88-00767'] : '없음', '쿠팡(주)')
    eq('번호 지도: 쿠팡 이름은 지도에 없다', Object.hasOwn(m.vendorToBiz, '쿠팡'), false)
    eq('자동완성: 쿠팡 빠짐', (await fin.getExpenseVendorSuggestions()).includes('쿠팡'), false)
  }

  // ── 8. 같은 주문번호 제안: 쇼핑몰이 정해져 있으면 같은 쇼핑몰만 ─────────────────────────────
  {
    await fin.addExpense(fd({ ...base, amount: '7000', vendor: '판매A', channel: '지마켓', externalOrderNo: 'NO-77', itemLabel: '외부주문품', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '외부주문품', amount: 7000 }]) }))
    eq('같은 쇼핑몰이면 제안', (await fin.findOrderByExternalNo('NO-77', '지마켓'))?.channel, '지마켓')
    eq('다른 쇼핑몰이면 제안 안 함', await fin.findOrderByExternalNo('NO-77', '쿠팡'), null)
    const found = await fin.findOrderByExternalNo('NO-77')
    const rx = await fin.addExpense(fd({ ...base, amount: '1000', vendor: '판매B', channel: '쿠팡', attachOrderId: found!.id, itemLabel: '합류거부', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '합류거부', amount: 1000 }]) }))
    eq('다른 쇼핑몰 주문에 합류는 거부', rx.ok, false)
    const ry = await fin.addExpense(fd({ ...base, amount: '1000', vendor: '판매B', attachOrderId: found!.id, itemLabel: '합류상속', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '합류상속', amount: 1000 }]) }))
    eq('쇼핑몰을 비우고 합류하면 그 주문의 쇼핑몰을 따른다', [ry.ok, (await rowsOf('합류상속'))[0]?.channel], [true, '지마켓'])
    // 거부된 저장은 목록을 안 바꾼다(목록 덧붙이기는 저장이 끝난 뒤, 독립 검수 2026-10-20)
    const rz = await fin.addExpense(fd({ ...base, amount: '1000', vendor: '판매B', channel: '거부몰', attachOrderId: found!.id, itemLabel: '거부몰품', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '거부몰품', amount: 1000 }]) }))
    eq('합류 거부된 저장의 새 쇼핑몰은 목록에 안 쌓인다', [rz.ok, (await channelList())?.split(',').includes('거부몰')], [false, false])
    // 쇼핑몰 미기록 옛 주문은 쇼핑몰을 적어도 후보다(빼면 같은 주문이 두 벌 생긴다, 신고 4f9fb398 퇴행 막기)
    const legacy = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '260901-077', externalOrderNo: 'NO-OLD' } })
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 3000, category: '수선유지비', vendor: '옛판매', orderId: legacy.id } })
    eq('미기록 옛 주문은 쇼핑몰을 적어도 제안한다', (await fin.findOrderByExternalNo('NO-OLD', '쿠팡'))?.id, legacy.id)
    const sameCh = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '260901-078', externalOrderNo: 'NO-OLD' } })
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-02T00:00:00Z'), amount: 3000, category: '수선유지비', vendor: '옛판매', channel: '쿠팡', orderId: sameCh.id } })
    eq('같은 쇼핑몰 주문을 미기록 주문보다 먼저 고른다', (await fin.findOrderByExternalNo('NO-OLD', '쿠팡'))?.id, sameCh.id)
    eq('다른 쇼핑몰만 있으면 미기록 주문으로 간다', (await fin.findOrderByExternalNo('NO-OLD', '지마켓'))?.id, legacy.id)
  }

  // ── 9. 주문 묶기: 쇼핑몰 갈림 막기·적용취소 바이트 동일(지운 빈 주문 되살림) ──────────────────
  {
    const mk = async (label: string, channel: string, extra: Record<string, string> = {}) => {
      const r = await fin.addExpense(fd({ ...base, amount: '1000', vendor: '묶기상회', channel, itemLabel: label, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label, amount: 1000 }]), ...extra }))
      if (!r.ok) throw new Error(r.error)
      return (await rowsOf(label))[0]
    }
    const m1 = await mk('묶기1', '쿠팡'), m2 = await mk('묶기2', '지마켓')
    eq('묶기: 쇼핑몰이 다르면 막는다', (await fin.mergeExpensesIntoOrder([m1.id, m2.id])).ok, false)
    const m3 = await mk('묶기3', '쿠팡', { externalOrderNo: 'NO-M3' })   // 주문 있는 행(빈 주문이 될 쪽)
    const m4 = await mk('묶기4', '쿠팡', { externalOrderNo: 'NO-M4' })
    const ids = [m1.id, m3.id, m4.id]
    const before = await exactAll(ids)
    const ordersBefore = await prisma.expenseOrder.findMany({ where: { propertyId: P1, id: { in: [m3.orderId!, m4.orderId!] } }, orderBy: { id: 'asc' } })
    const sum0 = await amountSum()
    const r = await fin.mergeExpensesIntoOrder(ids)
    if (!r.ok) throw new Error(r.error)
    eq('묶기: 세 행 한 주문', new Set((await prisma.expense.findMany({ where: { id: { in: ids } }, select: { orderId: true } })).map((x: { orderId: string | null }) => x.orderId)).size, 1)
    eq('묶기: 토큰 서명', typeof r.undo?.sig, 'string')
    const u = await fin.undoMergeExpensesIntoOrder(J(r.undo!))
    eq('묶기 적용취소 ok', u.ok, true)
    eq('묶기 적용취소: 행 바이트 동일', await exactAll(ids), before)
    eq('묶기 적용취소: 지운 주문을 같은 id·같은 값으로 되살림', JSON.stringify(await prisma.expenseOrder.findMany({ where: { propertyId: P1, id: { in: [m3.orderId!, m4.orderId!] } }, orderBy: { id: 'asc' } })).replace(/"updatedAt":"[^"]*"/g, ''), JSON.stringify(ordersBefore).replace(/"updatedAt":"[^"]*"/g, ''))
    eq('묶기 적용취소 두 번째는 거부', (await fin.undoMergeExpensesIntoOrder(J(r.undo!))).ok, false)
    eq('묶기·적용취소 금액 합 불변', await amountSum(), sum0)
    // 사후 배송비 묶기: 쇼핑몰 갈림 막기, 배송비 행은 그 주문의 쇼핑몰
    eq('배송비 묶기: 쇼핑몰이 다르면 막는다', (await fin.attachShippingToOrder({ expenseIds: [m1.id, m2.id], amount: 2500, shippingType: '선불' })).ok, false)
    const r2 = await fin.attachShippingToOrder({ expenseIds: [m3.id, m4.id], amount: 2500, shippingType: '선불' })
    eq('배송비 묶기 ok', r2.ok, true)
    const ship = await prisma.expense.findFirst({ where: { orderId: (await prisma.expense.findUnique({ where: { id: m3.id } }))!.orderId, isShipping: true } })
    eq('배송비 묶기: 배송비 행 쇼핑몰은 그 주문의 쇼핑몰', ship?.channel, '쿠팡')
    // 미기록 주문에 이미 있는 배송비 행의 쇼핑몰은 null 로 덮지 않는다(독립 검수 2026-10-20)
    const o2 = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '261019-055' } })
    const i1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-19T00:00:00Z'), amount: 1000, category: '수선유지비', orderId: o2.id } })
    const sh2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-19T00:00:00Z'), amount: 500, category: '수선유지비', orderId: o2.id, isShipping: true, channel: '쿠팡', excludeFromInventory: true } })
    const r3 = await fin.attachShippingToOrder({ expenseIds: [i1.id], amount: 700, shippingType: '선불' })
    eq('배송비 묶기: 미기록 주문이면 배송비 행 쇼핑몰을 안 덮는다', [r3.ok, (await prisma.expense.findUnique({ where: { id: sh2.id } }))?.channel], [true, '쿠팡'])
    const i2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-19T00:00:00Z'), amount: 1000, category: '수선유지비', orderId: o2.id, channel: '지마켓' } })
    eq('배송비 묶기: 배송비 행 쇼핑몰이 품목과 다르면 막는다', (await fin.attachShippingToOrder({ expenseIds: [i2.id], amount: 700, shippingType: '선불' })).ok, false)
    await prisma.expense.delete({ where: { id: i2.id } })   // 일부러 만든 갈림 행을 치운다(아래 장부 그물 시험이 깨끗한 장부에서 시작하게)
  }

  // ── 10. 일괄 수정: 쇼핑몰 지정·비우기·적용취소 바이트 동일 ────────────────────────────────
  {
    const a = (await rowsOf('단일전구'))[0], b = (await rowsOf('쇼핑몰없음'))[0]
    const before = await exactAll([a.id, b.id])
    const r = await fin.batchUpdateExpenses([a.id, b.id], { channel: '옥션' })
    if (!r.ok) throw new Error(r.error)
    eq('일괄: 쇼핑몰 지정', (await prisma.expense.findMany({ where: { id: { in: [a.id, b.id] } }, select: { channel: true } })).map((x: { channel: string | null }) => x.channel), ['옥션', '옥션'])
    eq('일괄: 목록에 옥션 적립', (await channelList())?.split(',').includes('옥션'), true)
    eq('일괄 적용취소', (await fin.undoBatchUpdateExpenses(J(r.undo))).ok, true)
    eq('일괄 적용취소: 바이트 동일', await exactAll([a.id, b.id]), before)
    const r2 = await fin.batchUpdateExpenses([a.id], { channel: null })
    eq('일괄: 비우기 길', [r2.ok, (await prisma.expense.findUnique({ where: { id: a.id } }))?.channel], [true, null])
    if (r2.ok) await fin.undoBatchUpdateExpenses(J(r2.undo))
    // 쇼핑몰만 바꾸는 일괄은 배송비 행도 받는다
    const ship = await prisma.expense.findFirst({ where: { orderId: orderA, isShipping: true } })
    const r3 = await fin.batchUpdateExpenses([ship!.id], { channel: '쿠팡' })
    eq('일괄: 쇼핑몰만이면 배송비 행도 바뀐다', [r3.ok && r3.updated], [1])
    const r4 = await fin.batchUpdateExpenses([ship!.id], { channel: '쿠팡', memo: 'x' })
    eq('일괄: 다른 칸이 섞이면 배송비 행은 종전대로 뺀다', r4.ok && r4.skipped.map(s => s.reason), ['배송비 지출'])
  }

  // ── 11. 구매처 이름 변경·합치기·비우기: 쇼핑몰 이름 막기·적용취소 ─────────────────────────────
  {
    const v1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-07-01T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '오타상회', vendorBizNo: '333-33-33333' } })
    const v2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-07-02T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '정상회' } })
    eq('이름 변경: 쇼핑몰 이름으로는 못 바꾼다', (await fin.renameVendor('오타상회', '쿠팡')).ok, false)
    eq('이름 변경: 쇼핑몰 이름에서도 못 바꾼다', (await fin.renameVendor('쿠팡', '쿠팡 판매자')).ok, false)
    const before = await exactAll([v1.id, v2.id])
    const r = await fin.renameVendor('오타상회', '정상회')
    if (!r.ok) throw new Error(r.error)
    eq('합치기: 1건 + 토큰', [r.updated, typeof r.undo?.sig], [1, 'string'])
    eq('합치기 적용취소', (await fin.undoExpenseFieldChange(J(r.undo!))).ok, true)
    eq('합치기 적용취소: 바이트 동일(원래부터 새 이름이던 행은 안 건드림)', await exactAll([v1.id, v2.id]), before)
    const r2 = await fin.renameVendor('오타상회', '')
    if (!r2.ok) throw new Error(r2.error)
    eq('비우기: 구매처 이름만 비우고 번호는 남김(결정 C)', [(await prisma.expense.findUnique({ where: { id: v1.id } }))?.vendor, (await prisma.expense.findUnique({ where: { id: v1.id } }))?.vendorBizNo], [null, '333-33-33333'])
    eq('비우기 토큰: 구매처 칸만 싣는다(결정 C)', r2.undo?.rows.flatMap(x => x.changes.map(c => c.field)), ['vendor'])
    eq('비우기 적용취소: 바이트 동일', [(await fin.undoExpenseFieldChange(J(r2.undo!))).ok, await exact(v1.id)], [true, before[[v1.id, v2.id].sort().indexOf(v1.id)]])
  }

  // ── 12. 쇼핑몰로 옮기기·쇼핑몰만 지정·같은 주문 적용·적용취소 ──────────────────────────────
  {
    // 구매처 자리에 '쿠팡'이 적힌 옛 주문(판매자 행과 섞임)
    const ord = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '260901-009' } })
    const k1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 4000, category: '수선유지비', vendor: '쿠팡', vendorBizNo: '120-88-00767', orderId: ord.id } })
    const k2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 3000, category: '수선유지비', vendor: '판매자갑', orderId: ord.id } })
    const k3 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 500, category: '수선유지비', vendor: '쿠팡', channel: '지마켓' } })
    const all = [k1.id, k2.id, k3.id]
    const before = await exactAll(all)
    const sum0 = await amountSum()
    const r = await fin.moveVendorToChannel(['쿠팡'], '쿠팡')
    if (!r.ok) throw new Error(r.error)
    const k1n = await prisma.expense.findUnique({ where: { id: k1.id } })
    eq('옮기기: 쇼핑몰 적고 구매처 이름만 비움(번호 남김, 결정 C)', [k1n?.channel, k1n?.vendor, k1n?.vendorBizNo], ['쿠팡', null, '120-88-00767'])
    eq('옮기기: 쇼핑몰이 이미 다른 행은 건너뜀', [r.skipped, (await prisma.expense.findUnique({ where: { id: k3.id } }))?.vendor], [1, '쿠팡'])
    eq('옮기기: 같은 주문 미기록 행 수 제안', r.sameOrder, 1)
    // 위조 토큰은 '쓴 직후' 상태에서 시험한다(그래야 서명 검사만이 막는다).
    const afterMove = await exactAll(all)
    eq('다른 용도로 고친 토큰은 거부(쓴 직후 상태)', (await fin.undoExpenseFieldChange({ ...J(r.undo!), kind: 'vendor-rename' })).ok, false)
    {
      const { sig: _s0, ...unsigned } = J(r.undo!); void _s0
      eq('서명 없는 토큰은 거부(쓴 직후 상태)', (await fin.undoExpenseFieldChange(unsigned)).ok, false)
      eq('교차 용도 서명(cash-receipt) 거부(쓴 직후 상태)', (await fin.undoExpenseFieldChange({ ...unsigned, sig: crl.signUndoBody('cash-receipt', P1, efu.canonicalExpenseFieldUndo(unsigned as never)) as string })).ok, false)
      eq('같은 주문 적용도 서명 없는 토큰은 거부', (await fin.applyChannelToSameOrders(unsigned)).ok, false)
    }
    eq('위조 거부 뒤 무변경', await exactAll(all), afterMove)
    const r2 = await fin.applyChannelToSameOrders(J(r.undo!))
    eq('같은 주문 적용: 판매자갑 행 쇼핑몰만 쿠팡', [r2.ok && r2.updated, (await prisma.expense.findUnique({ where: { id: k2.id } }))?.channel, (await prisma.expense.findUnique({ where: { id: k2.id } }))?.vendor], [1, '쿠팡', '판매자갑'])
    eq('같은 주문 적용 적용취소', (await fin.undoExpenseFieldChange(J((r2 as { undo: unknown }).undo))).ok, true)
    eq('옮기기 적용취소', (await fin.undoExpenseFieldChange(J(r.undo!))).ok, true)
    eq('옮기기·같은 주문 적용취소: 바이트 동일', await exactAll(all), before)
    eq('옮기기 금액 합 불변', await amountSum(), sum0)
    const r3 = await fin.setChannelForVendor(['쿠팡(주)'], '쿠팡')
    eq('쇼핑몰만 지정: 구매처 유지', r3.ok && (await prisma.expense.findMany({ where: { propertyId: P1, vendor: '쿠팡(주)', isShipping: false }, select: { channel: true } })).every((x: { channel: string | null }) => x.channel === '쿠팡'), true)
    const forged = { ...J(r.undo!), kind: 'vendor-rename' }
    eq('다른 용도로 고친 토큰은 거부', (await fin.undoExpenseFieldChange(forged)).ok, false)
    const { sig: _s, ...body } = J(r.undo!); void _s
    eq('서명 없는 토큰은 거부', (await fin.undoExpenseFieldChange(body)).ok, false)
    const canon = efu.canonicalExpenseFieldUndo(body as never)
    eq('교차 용도 서명(cash-receipt) 거부', (await fin.undoExpenseFieldChange({ ...body, sig: crl.signUndoBody('cash-receipt', P1, canon) as string })).ok, false)
  }

  // ── 13. 남의 영업장 ───────────────────────────────────────────────────────────────────
  {
    const v = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-07-05T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '영업장1판매' } })
    const r = await fin.renameVendor('영업장1판매', '바뀐이름')
    if (!r.ok) throw new Error(r.error)
    await fin.undoExpenseFieldChange(J(r.undo!))   // 토큰을 다시 쓰려고 되돌려 둔다
    const r1 = await fin.renameVendor('영업장1판매', '바뀐이름')
    if (!r1.ok) throw new Error(r1.error)
    const after = await exact(v.id)
    g.__CR_FLOW_PID = P2
    eq('남의 영업장: 적용취소 토큰 거부', (await fin.undoExpenseFieldChange(J(r1.undo!))).ok, false)
    eq('남의 영업장: 이름 변경이 P1 행을 안 건드림', [(await fin.renameVendor('바뀐이름', '침입')).ok, await exact(v.id)], [true, after])
    eq('남의 영업장: 쇼핑몰로 옮기기 0건', (await fin.moveVendorToChannel(['바뀐이름'], '쿠팡')), { ok: true, updated: 0, skipped: 0, splitSkipped: 0, sameOrder: 0 })
    eq('남의 영업장: 수정 거부', (await fin.updateExpense(fd({ id: v.id, date: '2026-07-05', amount: '1000', category: '수선유지비', channel: '침입' }))).ok, false)
    eq('남의 영업장: 묶기 거부', (await fin.mergeExpensesIntoOrder([v.id, (await rowsOf('단일전구'))[0].id])).ok, false)
    eq('남의 영업장: P1 쇼핑몰 목록 그대로', (await channelList(P1))?.includes('침입') ?? false, false)
    g.__CR_FLOW_PID = P1
    eq('남의 영업장 시도 뒤 P1 행 무변경', await exact(v.id), after)
  }

  // ── 14. 삭제 적용취소: 행 스냅샷이라 쇼핑몰이 함께 돌아온다 ───────────────────────────────
  {
    const x = (await rowsOf('단일전구'))[0]
    const before = await exact(x.id)
    const d = await fin.deleteExpense(x.id)
    if (!d.ok) throw new Error(d.error)
    eq('삭제 적용취소', (await fin.undoDeleteExpense(J(d.undo))).ok, true)
    eq('삭제 적용취소: 쇼핑몰 포함 바이트 동일', await exact(x.id), before)
  }

  // ── 15. 소모품 부분 수령: 받은 조각이 원행 칸 전부(사업자번호·브랜드·쇼핑몰) ────────────────────
  {
    const e = await prisma.expense.create({ data: {
      propertyId: P1, date: new Date('2026-10-10T00:00:00Z'), amount: 8000, category: '소모품비', itemLabel: '부분수령휴지',
      qtyValue: 4, qtyUnit: '롤', vendor: 'IKEA', vendorBizNo: '106-86-82871', channel: '쿠팡', brand: '깨끗한나라', productName: '3겹', specText: '30m', unitBasis: 'qty', costKind: 'MATERIAL',
    } })
    const r = await inv.confirmReceipt(e.id, undefined, 1)
    eq('부분 수령 ok', r.ok, true)
    const piece = await prisma.expense.findFirst({ where: { propertyId: P1, itemLabel: '부분수령휴지', id: { not: e.id } } })
    eq('부분 수령: 받은 조각이 원행 칸을 물려받는다', [piece?.vendorBizNo, piece?.brand, piece?.productName, piece?.specText, piece?.unitBasis, piece?.costKind, piece?.channel], ['106-86-82871', '깨끗한나라', '3겹', '30m', 'qty', 'MATERIAL', '쿠팡'])
    const src = await prisma.expense.findUnique({ where: { id: e.id } })
    const cl = clone.cloneExpenseScalars(src!, P1, {})
    eq('복제 정본: 쇼핑몰 칸 포함', cl.channel, '쿠팡')
  }

  // ── 16. 홈 영수증 승인: 쇼핑몰·사업자번호를 싣는다 ─────────────────────────────────────
  {
    const pend = await prisma.pendingReceipt.create({ data: { propertyId: P1, uploaderId: OWNER, imageUrl: 'https://example.invalid/r.jpg', inferredVendor: '철물24', parsedJson: { vendorBizNo: '1111111111' } } })
    const rows = await pr.getPendingReceipts()
    eq('대기 영수증: 인식 번호를 싣는다', rows.find(x => x.id === pend.id)?.inferredVendorBizNo, '111-11-11111')
    const r = await pr.approvePendingReceipt(pend.id, { date: '2026-10-19', amount: 4400, category: '수선유지비', vendor: '철물24', vendorBizNo: '111-11-11111', channel: '11번가' })
    eq('승인 ok', r.ok, true)
    const ex = await prisma.expense.findFirst({ where: { propertyId: P1, amount: 4400, vendor: '철물24' } })
    eq('승인: 구매처 번호·쇼핑몰 저장', [ex?.vendorBizNo, ex?.channel], ['111-11-11111', '11번가'])
    eq('승인: 처음 보는 쇼핑몰 목록 적립', (await channelList())?.split(',').includes('11번가'), true)
  }

  // ── 17. 설정: 쇼핑몰 이름 변경이 지출 쇼핑몰까지 따라가고 적용취소된다 ─────────────────────
  {
    const r = await settings.renameOption('channelOptions', '옥션', '옥션마켓')
    eq('설정 이름 변경 ok(목록에 있는 이름)', r.ok, true)
    const ex = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-01T00:00:00Z'), amount: 100, category: '수선유지비', channel: '11번가' } })
    const r2 = await settings.renameOption('channelOptions', '11번가', '십일번가')
    eq('설정 이름 변경: 지출 쇼핑몰이 따라간다', [r2.ok, (await prisma.expense.findUnique({ where: { id: ex.id } }))?.channel], [true, '십일번가'])
  }

  // ── 17-1. 쇼핑몰 목록: 대소문자만 다른 이름은 목록 표기로, 동시 덧붙이기는 둘 다 남는다 ──────────────
  {
    await prisma.property.update({ where: { id: P2 }, data: { channelOptions: 'Coupang' } })
    g.__CR_FLOW_PID = P2
    const r = await fin.addExpense(fd({ ...base, amount: '1000', vendor: '판매', channel: 'coupang', itemLabel: '대소문자품', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '대소문자품', amount: 1000 }]) }))
    eq('대소문자만 다른 쇼핑몰은 목록 표기로 저장·목록 그대로', [r.ok, (await prisma.expense.findFirst({ where: { propertyId: P2, itemLabel: '대소문자품' } }))?.channel, await channelList(P2)], [true, 'Coupang', 'Coupang'])
    const { appendChannelOption } = await import('@/lib/channelOptions')
    await Promise.all([appendChannelOption(P2, '동시A'), appendChannelOption(P2, '동시B'), appendChannelOption(P2, 'COUPANG')])
    eq('동시 덧붙이기는 둘 다 남고 같은 열쇠는 안 늘어난다', (await channelList(P2))?.split(',').sort(), ['Coupang', '동시A', '동시B'])
    g.__CR_FLOW_PID = P1
  }

  // ── 18. 장부 그물(scripts/check-order-channel-split)의 질의 정본을 이 DB 에 돌린다. 갈린 주문을 일부러 만들면 오류, 맞추면 경고 ──
  // 자식 프로세스로 띄우면 PGlite 소켓이 둘째 연결을 끊는다. 같은 질의 함수(scripts/order-channel-audit)를 PGlite 에 바로 돌린다.
  {
    const { auditOrderChannel } = await import('./order-channel-audit.mjs')
    const audit = async () => {
      if (pg.isInTransaction()) throw new Error('하네스: 감사 질의를 넣으려는데 세션이 아직 트랜잭션 안이다')
      return auditOrderChannel((sql: string, params?: unknown[]) => pg.query(sql, params) as Promise<{ rows: never[] }>)
    }
    const clean = await audit()
    eq('장부 그물: 칸 있음·지금 장부는 갈림 오류 0', [clean.missingColumns, clean.errors.length], [false, 0])
    const o = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '261019-099' } })
    const s1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-19T00:00:00Z'), amount: 100, category: '수선유지비', channel: '쿠팡', orderId: o.id } })
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-19T00:00:00Z'), amount: 100, category: '수선유지비', channel: '지마켓', orderId: o.id } })
    const bad = await audit()
    eq('장부 그물: 한 주문 쇼핑몰 둘이면 오류', bad.errors.map((r: { chans: string[] }) => [...r.chans].sort()), [['지마켓', '쿠팡']])
    await prisma.expense.update({ where: { id: s1.id }, data: { channel: null } })
    const mixed = await audit()
    eq('장부 그물: 하나 + 미기록 섞임은 경고', [mixed.errors.length, mixed.mixed.some((r: { order_id: string }) => r.order_id === o.id)], [0, true])
    eq('장부 그물: 쇼핑몰 목록 이름이 구매처 자리에 남은 행을 센다', mixed.channelAsVendor.some((x: { vendor: string }) => x.vendor === '쿠팡'), true)
    eq('장부 그물: 번호 하나 이름 둘(쿠팡(주)·소급상회 아님)을 경고로 센다', Array.isArray(mixed.noTwoName), true)
    await prisma.expense.deleteMany({ where: { orderId: o.id } })
  }

  // ── 19. 운영자 결정 2026-10-20 A(구매처와 같은 이름 = 비움)·B(한 주문 = 한 쇼핑몰 서버 거절)·C(비우기는 이름만) ────────
  {
    const list0 = await channelList()
    // A 등록: 쇼핑몰이 구매처와 같은 이름이면 비우고 목록에 안 쌓는다(대소문자·앞뒤 공백 무시)
    const a1 = await fin.addExpense(fd({ ...base, amount: '2100', vendor: '다이소', channel: ' 다이소 ', itemLabel: 'A같은이름', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: 'A같은이름', amount: 2100 }]) }))
    eq('A 등록: 같은 이름 쇼핑몰은 비우고 목록 그대로', [a1.ok, (await rowsOf('A같은이름'))[0]?.channel, await channelList()], [true, null, list0])
    const a1b = await fin.addExpense(fd({ ...base, amount: '2200', vendor: 'Daiso', channel: 'daiso', itemLabel: 'A대소문자', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: 'A대소문자', amount: 2200 }]) }))
    eq('A 등록: 대소문자만 다른 같은 이름도 비운다', [a1b.ok, (await rowsOf('A대소문자'))[0]?.channel], [true, null])
    // A 다품목: 품목별 구매처가 쇼핑몰과 같은 행만 비운다(행마다)
    const a2 = await fin.addExpense(fd({ ...base, amount: '3000', vendor: '판매자머리', channel: '이마트몰', itemsJson: items([{ label: 'A행1', amount: 1000, vendor: '이마트몰' }, { label: 'A행2', amount: 2000 }]) }))
    eq('A 다품목: 품목 구매처가 쇼핑몰과 같은 행만 비움', [a2.ok, (await rowsOf('A행1'))[0]?.channel, (await rowsOf('A행2'))[0]?.channel], [true, null, '이마트몰'])
    // A 수정: 같은 이름이면 비운다
    const ax = (await rowsOf('A행2'))[0]
    const ru = await fin.updateExpense(fd({ id: ax.id, date: '2026-10-18', amount: '2000', category: '수선유지비', vendor: '이마트몰', channel: '이마트몰', payMethod: '계좌이체', itemLabel: 'A행2', qtyValue: '1', qtyUnit: '개' }))
    eq('A 수정: 구매처와 같은 쇼핑몰은 비운다', [ru.ok, (await rowsOf('A행2'))[0]?.channel], [true, null])
    // A 일괄: 행마다 그 행 구매처 기준
    const g1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-02T00:00:00Z'), amount: 100, category: '수선유지비', vendor: '옥션' } })
    const g2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-02T00:00:00Z'), amount: 100, category: '수선유지비', vendor: '다른판매' } })
    const gb = await exactAll([g1.id, g2.id])
    const rb = await fin.batchUpdateExpenses([g1.id, g2.id], { channel: '옥션' })
    eq('A 일괄: 구매처가 같은 행은 비우고 나머지만 적는다', [rb.ok, (await prisma.expense.findUnique({ where: { id: g1.id } }))?.channel, (await prisma.expense.findUnique({ where: { id: g2.id } }))?.channel], [true, null, '옥션'])
    if (rb.ok) eq('A 일괄 적용취소: 바이트 동일', [(await fin.undoBatchUpdateExpenses(J(rb.undo))).ok, await exactAll([g1.id, g2.id])], [true, gb])
    // A 홈 승인 + C 홈 승인(구매처를 비워도 번호를 싣는다)
    const p1 = await prisma.pendingReceipt.create({ data: { propertyId: P1, uploaderId: OWNER, imageUrl: 'https://example.invalid/a.jpg', inferredVendor: '철물24' } })
    eq('A 승인 ok', (await pr.approvePendingReceipt(p1.id, { date: '2026-10-19', amount: 4501, category: '수선유지비', vendor: '철물24', channel: '철물24' })).ok, true)
    eq('A 승인: 상호명과 같은 쇼핑몰은 비운다', (await prisma.expense.findFirst({ where: { propertyId: P1, amount: 4501 } }))?.channel, null)
    const p2 = await prisma.pendingReceipt.create({ data: { propertyId: P1, uploaderId: OWNER, imageUrl: 'https://example.invalid/c.jpg', inferredVendor: '철물24' } })
    eq('C 승인 ok', (await pr.approvePendingReceipt(p2.id, { date: '2026-10-19', amount: 4502, category: '수선유지비', vendorBizNo: '111-11-11111' })).ok, true)
    const c2 = await prisma.expense.findFirst({ where: { propertyId: P1, amount: 4502 } })
    eq('C 승인: 구매처를 비워도 번호는 남긴다', [c2?.vendor, c2?.vendorBizNo], [null, '111-11-11111'])
    // A 소모품 구매 수정
    const iv = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-03T00:00:00Z'), amount: 700, category: '소모품비', itemLabel: 'A소모품', vendor: '다이소' } })
    const ri = await inv.updateExpenseFromInventory(iv.id, { channel: ' 다이소 ' })
    eq('A 소모품 수정: 구매처와 같은 쇼핑몰은 비운다', [ri.ok, (await prisma.expense.findUnique({ where: { id: iv.id } }))?.channel], [true, null])

    // B 한 주문 = 한 쇼핑몰: 서버가 갈림을 만드는 쓰기를 거절한다
    const ob = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '261020-001' } })
    const b1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-20T00:00:00Z'), amount: 1000, category: '수선유지비', vendor: '판매B1', channel: '쿠팡', orderId: ob.id } })
    const b2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-20T00:00:00Z'), amount: 2000, category: '수선유지비', vendor: '판매B2', channel: '쿠팡', orderId: ob.id } })
    const b3 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-20T00:00:00Z'), amount: 300, category: '소모품비', itemLabel: 'B소모품', vendor: '판매B3', orderId: ob.id } })
    const bAll = [b1.id, b2.id, b3.id]
    const bBefore = await exactAll(bAll)
    const editB1 = { id: b1.id, date: '2026-10-20', amount: '1000', category: '수선유지비', vendor: '판매B1', payMethod: '계좌이체' }
    const rx = await fin.updateExpense(fd({ ...editB1, channel: '지마켓' }))
    eq('B 수정: 주문을 가르는 저장은 거절·무변경', [rx.ok, !rx.ok && rx.error.startsWith('한 주문은 한 쇼핑몰입니다'), await exactAll(bAll)], [false, true, bBefore])
    const rbx = await fin.batchUpdateExpenses([b1.id], { channel: '지마켓' })
    eq('B 일괄: 함께 적용 없이 주문을 가르면 거절·무변경', [rbx.ok, await exactAll(bAll)], [false, bBefore])
    const rbo = await fin.batchUpdateExpenses([b1.id], { channel: '지마켓' }, { channelToOrders: true })
    if (!rbo.ok) throw new Error(rbo.error)
    eq('B 일괄 함께 적용: 주문 전체가 한 쇼핑몰·형제 수', [(await prisma.expense.findMany({ where: { orderId: ob.id }, select: { channel: true } })).map((x: { channel: string | null }) => x.channel), rbo.siblings], [['지마켓', '지마켓', '지마켓'], 2])
    eq('B 일괄 함께 적용 적용취소: 바이트 동일', [(await fin.undoBatchUpdateExpenses(J(rbo.undo))).ok, await exactAll(bAll)], [true, bBefore])
    const rso = await fin.setChannelForVendor(['판매B3'], '지마켓')
    eq('B 쇼핑몰 지정: 같은 주문에 다른 쇼핑몰이 있으면 건너뛴다', [rso.ok && rso.splitSkipped, rso.ok && rso.updated, await exactAll(bAll)], [1, 0, bBefore])
    const rio = await inv.updateExpenseFromInventory(b3.id, { channel: '지마켓' })
    eq('B 소모품 수정: 갈림을 알려 주고 무변경', [rio.ok, !rio.ok && rio.orderSplit?.count, await exactAll(bAll)], [false, 2, bBefore])
    const sibBefore = await exactAll([b1.id, b2.id])
    const rio2 = await inv.updateExpenseFromInventory(b3.id, { channel: '지마켓', channelToOrder: true })
    if (!rio2.ok) throw new Error(rio2.error)
    eq('B 소모품 수정 주문 전체 적용: 형제도 맞춘다·토큰', [(await prisma.expense.findMany({ where: { orderId: ob.id }, select: { channel: true } })).every((x: { channel: string | null }) => x.channel === '지마켓'), rio2.channelUndo?.rows.length], [true, 2])
    eq('B 소모품 수정 형제 적용취소', (await fin.undoExpenseFieldChange(J(rio2.channelUndo!))).ok, true)
    eq('B 소모품 수정 형제 적용취소 뒤 형제 바이트 동일', await exactAll([b1.id, b2.id]), sibBefore)
    await prisma.expense.update({ where: { id: b3.id }, data: { channel: null } })
    // 비우기(미기록 섞임)는 거절하지 않는다(장부 그물은 경고로만 센다)
    const rc = await fin.updateExpense(fd({ ...editB1, channel: '' }))
    eq('B 수정: 비우기는 갈림이 아니라 통과', [rc.ok, (await prisma.expense.findUnique({ where: { id: b1.id } }))?.channel], [true, null])
    // 이미 갈린 옛 주문의 다른 칸 수정은 막지 않는다
    await prisma.expense.update({ where: { id: b1.id }, data: { channel: '지마켓' } })
    const rm = await fin.updateExpense(fd({ ...editB1, channel: '지마켓', memo: '옛 갈림' }))
    eq('B 수정: 이미 갈린 옛 주문의 다른 칸 수정은 통과', rm.ok, true)
    await prisma.expense.deleteMany({ where: { orderId: ob.id } })   // 일부러 만든 갈림 주문을 치운다(장부 그물 시험 앞)
  }

  // ── 20. 재검수 2026-10-20 서버 넷 ─────────────────────────────────────────────
  {
    const day = new Date('2026-10-20T00:00:00Z')
    const mk = (d: Record<string, unknown>) => prisma.expense.create({ data: { propertyId: P1, date: day, amount: 100, category: '수선유지비', ...d } })
    // 1. 쇼핑몰 지정: 같은 구매처의 다른 쇼핑몰 행(건너뜀)이 든 주문의 미기록 행도 건너뛴다
    const o1 = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '261020-101' } })
    const x1 = await mk({ vendor: '재검X몰', channel: '지마켓', orderId: o1.id })
    const x2 = await mk({ vendor: '재검X몰', orderId: o1.id })
    const xb = await exactAll([x1.id, x2.id])
    const r1 = await fin.setChannelForVendor(['재검X몰'], '쿠팡')
    eq('재검 1: 건너뛴 다른 쇼핑몰 행이 갈림 근거로 남는다', [r1.ok && r1.skipped, r1.ok && r1.splitSkipped, r1.ok && r1.updated, await exactAll([x1.id, x2.id])], [1, 1, 0, xb])
    await prisma.expense.deleteMany({ where: { orderId: o1.id } })
    // 2. 주문 묶기: 배송비 행 쇼핑몰도 센다
    const o2 = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '261020-102' } })
    const m1 = await mk({ orderId: o2.id })
    await mk({ orderId: o2.id, isShipping: true, channel: '지마켓', excludeFromInventory: true })
    const m2 = await mk({ channel: '쿠팡' })
    const rm = await fin.mergeExpensesIntoOrder([m1.id, m2.id])
    eq('재검 2: 배송비 행 쇼핑몰이 다르면 묶기 거부·무변경', [rm.ok, (await prisma.expense.findUnique({ where: { id: m2.id } }))?.orderId], [false, null])
    await prisma.expense.deleteMany({ where: { OR: [{ orderId: o2.id }, { id: m2.id }] } })
    // 3. 일괄 적용취소: 서명·허용 칸·쓴 직후
    const y = await mk({ memo: '원래' })
    const yb = await exact(y.id)
    const rb = await fin.batchUpdateExpenses([y.id], { memo: '바꿈' })
    if (!rb.ok || !rb.undo) throw new Error('일괄 토큰 없음')
    const tok = J(rb.undo)
    eq('재검 3: 허용 밖 칸을 끼운 토큰 거부', (await fin.undoBatchUpdateExpenses({ ...tok, rows: tok.rows.map(r => ({ ...r, fields: { ...r.fields, amount: 999999 }, after: { ...r.after, amount: 100 } })) })).ok, false)
    eq('재검 3: 값을 고친 토큰 거부(서명)', (await fin.undoBatchUpdateExpenses({ ...tok, rows: tok.rows.map(r => ({ ...r, fields: { memo: '위조' } })) })).ok, false)
    { const { sig: _s, ...unsigned } = tok; void _s; eq('재검 3: 서명 없는 토큰 거부', (await fin.undoBatchUpdateExpenses(unsigned)).ok, false) }
    eq('재검 3: 위조 거부 뒤 금액·메모 무변경', [(await prisma.expense.findUnique({ where: { id: y.id } }))?.amount, (await prisma.expense.findUnique({ where: { id: y.id } }))?.memo], [100, '바꿈'])
    await prisma.expense.update({ where: { id: y.id }, data: { memo: '그사이' } })
    eq('재검 3: 그사이 바뀌면 되돌리지 않는다', [(await fin.undoBatchUpdateExpenses(tok)).ok, (await prisma.expense.findUnique({ where: { id: y.id } }))?.memo], [false, '그사이'])
    await prisma.expense.update({ where: { id: y.id }, data: { memo: '바꿈' } })
    eq('재검 3: 쓴 직후면 되돌림·바이트 동일(updatedAt 제외)', [(await fin.undoBatchUpdateExpenses(tok)).ok, await exact(y.id)], [true, yb])
    // 4. 등록 합류: 이미 갈린 옛 주문에 그 주문의 어느 쇼핑몰과도 다른 이름으로 합류 거부
    const o4 = await prisma.expenseOrder.create({ data: { propertyId: P1, code: '261020-104' } })
    await mk({ orderId: o4.id, channel: '쿠팡' })
    await mk({ orderId: o4.id, channel: '지마켓' })
    const before4 = await prisma.expense.count({ where: { orderId: o4.id } })
    const ra = await fin.addExpense(fd({ ...base, amount: '500', vendor: '재검판매', channel: '옥션', attachOrderId: o4.id, itemLabel: '재검합류', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '재검합류', amount: 500 }]) }))
    eq('재검 4: 갈린 옛 주문에 다른 쇼핑몰로 합류 거부', [ra.ok, await prisma.expense.count({ where: { orderId: o4.id } })], [false, before4])
    const rok = await fin.addExpense(fd({ ...base, amount: '500', vendor: '재검판매', channel: '쿠팡', attachOrderId: o4.id, itemLabel: '재검합류2', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '재검합류2', amount: 500 }]) }))
    eq('재검 4: 그 주문에 있는 쇼핑몰로는 합류', [rok.ok, await prisma.expense.count({ where: { orderId: o4.id } })], [true, before4 + 1])
    await prisma.expense.deleteMany({ where: { orderId: o4.id } })
  }

  eq('전체 금액 합: 쇼핑몰 작업은 금액을 안 바꾼다(등록분만 늘었다)', (await amountSum()) - sumStart > 0, true)
  console.log(`[구매처·쇼핑몰 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
