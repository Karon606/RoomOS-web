// 비품 전환(F1·F3) 통합 회귀. 실제 재무 저장·적용취소를 메모리 PGlite 위에서 화면 호출 순서 그대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-durable-convert-flow.ts
//
// 왜 통합인가(2026-10-15 계획서 비품-전환-배정 2단계). 판정 진리표(test-durable-convert)는 순수 함수만 본다. 전환과
// 카드 정리·자동 점검 걷기·배정·이력이 한 트랜잭션인지, 적용취소가 지출 행과 재고 원장을 **바이트까지** 되돌리는지,
// 금액 합이 그대로인지, 남의 영업장·다른 용도 토큰을 못 쓰는지는 실제 쓰기를 돌려야 보인다.
// 대역·운영 DB 차단은 1단계 하네스(scripts/test-asset-receipt-flow.ts)와 같은 판이다.
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

  const prisma = (await import('@/lib/prisma')).default
  const fin = await import('@/app/(app)/finance/actions')
  const inv = await import('@/app/(app)/inventory/actions')
  const assets = await import('@/app/(app)/inventory/assets/actions')
  const cp = await import('@/app/(app)/inventory/assets/conversionPlan')
  const rc = await import('@/app/(app)/inventory/receiptCancel')
  const crl = await import('@/app/(app)/rooms/cashReceiptLine')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  const room = async (pid: string, no: string) => (await prisma.room.create({ data: { roomNo: no, propertyId: pid } })).id as string
  const R519 = await room(P1, '519'), R520 = await room(P1, '520')
  await room(P2, '999')
  g.__CR_FLOW_PID = P1
  const HUB = (await prisma.storageLocation.create({ data: { propertyId: P1, name: '창고', isHub: true } })).id as string
  // 비품 이력 하나(대상 카테고리 = 그 영업장 비품 최빈)
  await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-08-07T00:00:00Z'), amount: 133000, category: '수선유지비', itemLabel: '미니냉장고', qtyValue: 1, qtyUnit: '개', roomId: R520, receivedAt: new Date('2026-08-07T00:00:00Z') } })

  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const items = (list: { label: string; amount: number; qty?: string; alloc?: { roomId: string; qty: string }[] }[]) =>
    JSON.stringify(list.map(i => ({ label: i.label, qtyValue: i.qty ?? '1', qtyUnit: '개', amount: i.amount, ...(i.alloc ? { allocations: i.alloc } : {}) })))
  const base = { date: '2026-10-13', payMethod: '계좌이체', vendor: '쿠팡(주)' }
  // 행 바이트. 생성 시각·갱신 시각·id 를 뺀 것(두 행 비교)과, updatedAt 만 뺀 것(같은 행 전후 비교)
  const strip = (r: Record<string, unknown>, keys: string[]) => { const o = { ...r }; for (const k of keys) delete o[k]; return JSON.stringify(o) }
  const rowsOf = async (label: string) => prisma.expense.findMany({ where: { propertyId: P1, itemLabel: label }, orderBy: [{ amount: 'desc' }, { roomId: 'asc' }] })
  const shape = async (label: string) => (await rowsOf(label)).map((r: Record<string, unknown>) => strip(r, ['id', 'createdAt', 'updatedAt', 'allocationGroupId', 'orderId']))
  const exact = async (id: string) => strip((await prisma.expense.findUnique({ where: { id } })) as Record<string, unknown>, ['updatedAt'])
  const cardShape = async (label: string) => (await prisma.trackedItem.findMany({ where: { propertyId: P1, label } })).map((c: Record<string, unknown>) => strip(c, ['id', 'createdAt', 'updatedAt']))
  const cardExact = async (label: string) => (await prisma.trackedItem.findMany({ where: { propertyId: P1, label } })).map((c: Record<string, unknown>) => strip(c, ['updatedAt']))
  const ledger = async (itemIds: string[]) => JSON.stringify([
    await prisma.stockCheck.findMany({ where: { trackedItemId: { in: itemIds } }, orderBy: { id: 'asc' } }),
    await prisma.stockCheckLocation.findMany({ where: { stockCheck: { trackedItemId: { in: itemIds } } }, orderBy: { id: 'asc' } }),
    await prisma.trackedItemLocation.findMany({ where: { trackedItemId: { in: itemIds } }, orderBy: { storageLocationId: 'asc' } }),
  ])
  const amountSum = async () => (await prisma.expense.aggregate({ where: { propertyId: P1 }, _sum: { amount: true } }))._sum.amount ?? 0
  const logs = async (label: string) => (await prisma.assetAssignmentLog.findMany({ where: { propertyId: P1, itemLabel: label }, orderBy: { createdAt: 'asc' } }))
    .map((l: { fromKind: string; fromLabel: string | null; toKind: string; toLabel: string | null; qty: number | null; assignedAt: Date | null }) => [l.fromKind, l.fromLabel, l.toKind, l.toLabel, l.qty, l.assignedAt?.toISOString().slice(0, 10) ?? null])
  // 장부 축 1(check-item-category-split '갈림'): 같은 이름이 소모품 쪽과 비품 쪽에 같이 있나
  const split = async (label: string) => {
    const rows = await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: label, isShipping: false }, select: { category: true } })
    const tracked = ['부식비', '소모품비', '폐기물 처리비']
    return rows.some((r: { category: string }) => tracked.includes(r.category)) && rows.some((r: { category: string }) => !tracked.includes(r.category))
  }

  // ── F1 등록 단일(냉장고). 그대로 저장한 쌍둥이와 바이트 비교 ──────────────────────────────
  {
    const L = '갈란츠 미니 1도어 냉장고', LT = '쌍둥이 소형 냉장고'
    const sum0 = await amountSum()
    const plain = await fin.addExpense(fd({ ...base, amount: '133000', category: '소모품비', roomId: R519, targetRoomId: '', itemLabel: LT, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: LT, amount: 133000 }]) }))
    eq('F1 등록 쌍둥이(그대로 저장) ok', plain.ok, true)
    const r = await fin.addExpense(fd({ ...base, amount: '133000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemLabel: L, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: L, amount: 133000 }]) }))
    if (!r.ok) throw new Error(r.error)
    const row = (await rowsOf(L))[0]
    eq('F1 등록: 비품 카테고리·대상 호실은 배정 예정 호실로', [row.category, row.roomId, row.targetRoomId === R519, row.receivedAt], ['수선유지비', null, true, null])
    eq('F1 등록: 비품 카테고리에서는 카드 자동 생성이 안 돈다', await prisma.trackedItem.count({ where: { propertyId: P1, label: L } }), 0)
    eq('F1 등록: 서명된 토큰', [!!r.durableUndo, typeof r.durableUndo?.sig], [true, 'string'])
    eq('F1 금액 합: 두 건 더한 만큼만', await amountSum(), sum0 + 266000)
    const u = await fin.undoDurableConvert(J(r.durableUndo!))
    eq('F1 등록 적용취소 ok', u, { ok: true })
    const plainShape = (await shape(LT)).map(s => s.replace(JSON.stringify(LT).slice(1, -1), 'X'))
    const undoneShape = (await shape(L)).map(s => s.replace(JSON.stringify(L).slice(1, -1), 'X'))
    eq('F1 등록 적용취소: 그대로 저장한 행과 바이트 동일(소모품비·대상 호실 519호)', undoneShape, plainShape)
    eq('F1 등록 적용취소: 원래 생겼을 소모품 카드를 시드(그대로 저장과 같은 모양)', (await cardShape(L)).map(s => s.replace(JSON.stringify(L).slice(1, -1), 'X')), (await cardShape(LT)).map(s => s.replace(JSON.stringify(LT).slice(1, -1), 'X')))
    eq('F1 두 번째 적용취소는 거부(반쪽 금지)', await fin.undoDurableConvert(J(r.durableUndo!)), { ok: false, error: cp.DURABLE_CONVERT_UNDO_STALE })
    eq('F1 금액 합 불변(전환·적용취소)', await amountSum(), sum0 + 266000)
  }

  // ── F1 등록 다품목(한 품목만 호실) ──────────────────────────────────────────────
  {
    const r = await fin.addExpense(fd({ ...base, amount: '150000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemsJson: items([{ label: '다품목냉장고', amount: 130000 }, { label: '다품목멀티탭', amount: 20000 }]) }))
    if (!r.ok) throw new Error(r.error)
    const a = (await rowsOf('다품목냉장고'))[0], b = (await rowsOf('다품목멀티탭'))[0]
    eq('다품목: 둘 다 비품, 폼 호실은 둘 다 예정', [a.category, b.category, a.targetRoomId === R519, b.targetRoomId === R519, a.roomId, b.roomId], ['수선유지비', '수선유지비', true, true, null, null])
    eq('다품목: 토큰 행 둘·시드 품명 둘', [r.durableUndo?.rows.length, r.durableUndo?.seedLabels.slice().sort()], [2, ['다품목냉장고', '다품목멀티탭']])
    eq('다품목 적용취소', (await fin.undoDurableConvert(J(r.durableUndo!))).ok, true)
    const a2 = (await rowsOf('다품목냉장고'))[0], b2 = (await rowsOf('다품목멀티탭'))[0]
    eq('다품목 적용취소: 둘 다 소모품비·대상 호실·예정 비움', [a2.category, b2.category, a2.roomId === R519, b2.roomId === R519, a2.targetRoomId, b2.targetRoomId], ['소모품비', '소모품비', true, true, null, null])
    eq('다품목 적용취소: 카드 둘 시드', await prisma.trackedItem.count({ where: { propertyId: P1, label: { in: ['다품목냉장고', '다품목멀티탭'] } } }), 2)
  }

  // ── 다품목에서 함께 적은 품목에 소모품 이력이 있으면 바꾸지 않는다(검수 R6). 바꾸면 그 품명이 양쪽에 서서 장부 축 1 갈림이 생긴다
  {
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-02T00:00:00Z'), amount: 3000, category: '소모품비', itemLabel: '한계휴지', qtyValue: 1 } })
    const r = await fin.addExpense(fd({ ...base, amount: '93000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemsJson: items([{ label: '한계냉장고', amount: 90000 }, { label: '한계휴지', amount: 3000 }]) }))
    eq('R6 함께 적은 품목에 소모품 이력이 있으면 서버가 전환을 받지 않는다', r, { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('R6 거부면 아무것도 안 만들고 축 1 갈림도 없다', [await prisma.expense.count({ where: { propertyId: P1, itemLabel: '한계냉장고' } }), await split('한계휴지')], [0, false])
  }

  // ── F1 등록 방별 분배(조각마다 그 조각의 호실이 예정) ───────────────────────────────────
  {
    const sum0 = await amountSum()
    const r = await fin.addExpense(fd({ ...base, amount: '60000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: '', targetRoomId: '',
      itemsJson: items([{ label: '분배선풍기', amount: 60000, qty: '3', alloc: [{ roomId: R519, qty: '1' }, { roomId: R520, qty: '1' }] }]) }))
    if (!r.ok) throw new Error(r.error)
    const rs = await rowsOf('분배선풍기')
    eq('분배: 조각 셋(519·520·나머지), 예정 호실이 조각 호실', rs.map((x: { targetRoomId: string | null; roomId: string | null; category: string }) => [x.category, x.roomId, x.targetRoomId === R519 ? '519' : x.targetRoomId === R520 ? '520' : x.targetRoomId]).sort(), [['수선유지비', null, null], ['수선유지비', null, '519'], ['수선유지비', null, '520']])
    eq('분배: 금액 합 그대로', await amountSum(), sum0 + 60000)
    eq('분배 적용취소', (await fin.undoDurableConvert(J(r.durableUndo!))).ok, true)
    const rs2 = await rowsOf('분배선풍기')
    eq('분배 적용취소: 조각마다 대상 호실로', rs2.map((x: { roomId: string | null; targetRoomId: string | null; category: string }) => [x.category, x.roomId === R519 ? '519' : x.roomId === R520 ? '520' : x.roomId, x.targetRoomId]).sort(), [['소모품비', null, null], ['소모품비', '519', null], ['소모품비', '520', null]])
  }

  // ── F1 수정(받기 전, 호실을 적어 넣는 수정). 빈 자동 카드 정리와 적용취소 바이트 동일 ─────────────
  {
    const L = '수정냉장고', LT = '수정냉장고쌍둥이'
    for (const lab of [L, LT]) await fin.addExpense(fd({ ...base, amount: '90000', category: '소모품비', roomId: '', targetRoomId: '', itemLabel: lab, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: lab, amount: 90000 }]) }))
    const x = (await rowsOf(L))[0], t = (await rowsOf(LT))[0]
    const cardBefore = await cardExact(L)
    eq('F1 수정 준비: 등록 때 시드된 빈 카드', cardBefore.length, 1)
    const editOf = (id: string, lab: string, extra: Record<string, string>) => fd({ id, ...base, amount: '90000', roomId: R519, itemLabel: lab, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: lab, amount: 90000 }]), ...extra })
    const plain = await fin.updateExpense(editOf(t.id, LT, { category: '소모품비' }))
    eq('F1 수정 쌍둥이(그대로 저장)', plain.ok, true)
    const r = await fin.updateExpense(editOf(x.id, L, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1' }))
    if (!r.ok) throw new Error(r.error)
    const xr = await prisma.expense.findUnique({ where: { id: x.id } })
    eq('F1 수정: 비품·예정 호실 519호·빈 자동 카드 지움', [xr?.category, xr?.roomId, xr?.targetRoomId === R519, await prisma.trackedItem.count({ where: { propertyId: P1, label: L } })], ['수선유지비', null, true, 0])
    eq('F1 수정: 토큰에 지운 카드 스냅샷', r.durableUndo?.cards.length, 1)
    eq('F1 수정 적용취소', (await fin.undoDurableConvert(J(r.durableUndo!))).ok, true)
    eq('F1 수정 적용취소: 그대로 저장한 쌍둥이와 바이트 동일', (await shape(L)).map(s => s.replace(L, 'X')), (await shape(LT)).map(s => s.replace(LT, 'X')))
    eq('F1 수정 적용취소: 카드를 같은 id 로 바이트 그대로', await cardExact(L), cardBefore)
  }

  // ── F1 수정, 비지 않은 카드는 지우지 않는다(축 1 갈림 확인) ───────────────────────────────
  {
    const L = '센카드냉장고'
    await fin.addExpense(fd({ ...base, amount: '90000', category: '소모품비', roomId: '', targetRoomId: '', itemLabel: L, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: L, amount: 90000 }]) }))
    const x = (await rowsOf(L))[0]
    const card = await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: L } })
    await prisma.stockCheck.create({ data: { trackedItemId: card!.id, date: new Date('2026-10-01T00:00:00Z'), remainingQty: 0 } })
    const r = await fin.updateExpense(fd({ id: x.id, ...base, amount: '90000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, itemLabel: L, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: L, amount: 90000 }]) }))
    eq('비지 않은 카드: 전환은 된다', [r.ok, (await prisma.expense.findUnique({ where: { id: x.id } }))?.category], [true, '수선유지비'])
    eq('비지 않은 카드: 카드는 남고 토큰에 없다', [await prisma.trackedItem.count({ where: { id: card!.id } }), r.ok ? r.durableUndo?.cards.length : -1], [1, 0])
    eq('비지 않은 카드: 축 1 갈림 없음(그 품명 소모품 지출이 없다)', await split(L), false)
  }

  // ── 다품목 F1 수정은 저장 뒤 따로 한 트랜잭션에서 카드를 정리한다. 정리가 실패해도 성공으로 돌려준다(검수 권장 2, E2) ──
  // 실패로 돌려주면 화면이 폼을 그대로 두고, 다시 저장하면 품목 행이 한 벌 더 생겨 금액이 불어났다. 삭제 트리거로 실패를 만든다.
  {
    const A = '정리실패냉장고'
    await fin.addExpense(fd({ ...base, amount: '90000', category: '소모품비', roomId: '', targetRoomId: '', itemLabel: A, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: A, amount: 90000 }]) }))
    const x = (await rowsOf(A))[0]
    const card = await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: A } })
    const sum0 = await amountSum()
    await directSql(`create function flow_block_card_delete() returns trigger as $$ begin raise exception 'flow cleanup blocked'; end $$ language plpgsql;
      create trigger flow_block_card_delete before delete on tracked_items for each row execute function flow_block_card_delete();`)
    // 서버는 실패를 서버 로그에만 남긴다. 그물 출력이 어지럽지 않게 그 한 줄을 받아 둔다.
    const errLog: unknown[][] = []
    const origErr = console.error
    console.error = (...a: unknown[]) => { errLog.push(a) }
    const r = await fin.updateExpense(fd({ id: x.id, ...base, amount: '90000', roomId: R519, category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1',
      itemsJson: items([{ label: A, amount: 60000 }, { label: A + '탭', amount: 30000 }]) })).finally(() => { console.error = origErr })
    await directSql(`drop trigger flow_block_card_delete on tracked_items; drop function flow_block_card_delete();`)
    eq('E2 정리 실패는 서버 로그에 한 줄', errLog.length, 1)
    eq('E2 정리가 실패해도 저장은 성공, 토큰에 카드 없음(DB 원문을 안 낸다)', [r.ok, r.ok ? r.durableUndo?.cards.length : (r as { error: string }).error], [true, 0])
    const rows = await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: { in: [A, A + '탭'] } }, orderBy: { amount: 'desc' } })
    eq('E2 행 둘이 비품·예정 519호, 카드는 남고 금액 합 그대로', [rows.map((e: { category: string; targetRoomId: string | null }) => [e.category, e.targetRoomId === R519]), await prisma.trackedItem.count({ where: { id: card!.id } }), await amountSum()],
      [[['수선유지비', true], ['수선유지비', true]], 1, sum0])
    if (r.ok && r.durableUndo) {
      eq('E2 적용취소', (await fin.undoDurableConvert(J(r.durableUndo))).ok, true)
      const back = await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: { in: [A, A + '탭'] } } })
      eq('E2 적용취소 뒤 행 둘 소모품비·대상 호실, 금액 합 그대로', [back.map((e: { category: string; roomId: string | null }) => [e.category, e.roomId === R519]), await amountSum()], [[['소모품비', true], ['소모품비', true]], sum0])
    }
  }

  // ── F1 수정에서 같은 저장으로 품명을 바꾸고 전환한 뒤 적용취소(검수 참고 3). 그대로 저장했다면 형제 propagateItemLabelRename 이
  // 카드를 같은 id 로 개명했다. 적용취소 뒤에도 같은 끝이어야 한다(옛 품명 카드가 되살아나 새 품명 행과 갈리면 재고에서 빠진다).
  {
    const ls = await import('@/app/(app)/inventory/ledgerShift')
    const matched = async (id: string) => { const e = await prisma.expense.findUnique({ where: { id } }); return e ? !!(await ls.matchedTrackedItemForExpense(P1, e)) : null }
    const add = (lab: string) => fin.addExpense(fd({ ...base, amount: '40000', category: '소모품비', roomId: '', targetRoomId: '', itemLabel: lab, qtyValue: '1', qtyUnit: '세트', itemsJson: JSON.stringify([{ label: lab, qtyValue: '1', qtyUnit: '세트', amount: 40000 }]) }))
    const edit = (id: string, lab: string, extra: Record<string, string>) => fd({ id, ...base, amount: '40000', roomId: R519, itemLabel: lab, qtyValue: '1', qtyUnit: '세트',
      itemsJson: JSON.stringify([{ label: lab, qtyValue: '1', qtyUnit: '세트', amount: 40000 }]), ...extra })
    const cnt = (lab: string) => prisma.trackedItem.count({ where: { propertyId: P1, label: lab } })
    const O = '개명전의자', N = '개명후의자', OT = '개명전쌍둥이', NT = '개명후쌍둥이'
    await add(O); await add(OT)
    const x = (await rowsOf(O))[0], t = (await rowsOf(OT))[0]
    const cardId = (await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: O } }))!.id
    const plain = await fin.updateExpense(edit(t.id, NT, { category: '소모품비' }))
    eq('참고 3 쌍둥이: 그대로 저장한 개명은 카드째 개명', [plain.ok, await cnt(OT), await cnt(NT), await matched(t.id)], [true, 0, 1, true])
    const r = await fin.updateExpense(edit(x.id, N, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1' }))
    if (!r.ok) throw new Error(r.error)
    eq('참고 3 전환: 옛 품명 빈 카드를 지우고 토큰의 카드는 같은 id·새 품명', [await prisma.trackedItem.count({ where: { id: cardId } }), r.durableUndo?.cards.map(c => [c.item.id === cardId, c.item.label])], [0, [[true, N]]])
    eq('참고 3 적용취소', (await fin.undoDurableConvert(J(r.durableUndo!))).ok, true)
    eq('참고 3 적용취소: 같은 id 카드가 새 품명으로 서고 행과 이어진다(그대로 저장 개명과 같은 끝)',
      [(await prisma.trackedItem.findUnique({ where: { id: cardId } }))?.label, await cnt(O), await matched(x.id)], [N, 0, true])
    eq('참고 3 적용취소: 그대로 저장한 쌍둥이와 행 바이트 동일', (await shape(N)).map(s => s.replace(N, 'X')), (await shape(NT)).map(s => s.replace(NT, 'X')))
    // 새 품명 카드가 이미 있으면 형제는 개명하지 않는다(병합이 필요한 자리). 전환도 옛 품명으로 되살린다.
    // 새 품명에 소모품 구매가 있으면 전환을 묻지 않으므로(이력이 곧 기억), 구매 없이 손으로 만든 카드로 둔다.
    const O2 = '개명충돌전', N2 = '개명충돌후'
    await add(O2)
    await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: N2, qtyUnit: '세트' } })
    const y = (await rowsOf(O2))[0]
    const o2Id = (await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: O2 } }))!.id
    const n2Id = (await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: N2 } }))!.id
    const r2 = await fin.updateExpense(edit(y.id, N2, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1' }))
    if (!r2.ok) throw new Error(r2.error)
    eq('참고 3 새 품명 카드가 있으면 토큰 카드는 옛 품명', r2.durableUndo?.cards.map(c => c.item.label), [O2])
    eq('참고 3 충돌 적용취소', (await fin.undoDurableConvert(J(r2.durableUndo!))).ok, true)
    eq('참고 3 충돌 적용취소: 옛 카드는 옛 품명으로, 새 품명 카드는 그대로, 행은 새 품명 카드와 이어진다',
      [(await prisma.trackedItem.findUnique({ where: { id: o2Id } }))?.label, (await prisma.trackedItem.findUnique({ where: { id: n2Id } }))?.label, await matched(y.id)], [O2, N2, true])
    // 탐침 A(후속 검수 권장 1). 옛 품명에 다른 구매가 있어 카드를 남긴 경우. 적용취소 뒤 새 품명 행이 이을 카드가 없으면 재고 미아다.
    // 적용취소가 새 품명으로 시드해 행이 카드에 이어진다. 형제(그대로 저장 개명)는 카드와 형제 행까지 개명하므로 끝이 다르다(노트).
    const O3 = '개명남는전', N3 = '개명남는후'
    await add(O3); await add(O3)
    const z = (await rowsOf(O3))[0]
    const o3Id = (await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: O3 } }))!.id
    const r3 = await fin.updateExpense(edit(z.id, N3, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1' }))
    if (!r3.ok) throw new Error(r3.error)
    eq('탐침 A 전환: 다른 구매가 있는 옛 카드는 남고 토큰에 없음, 새 품명 시드를 싣는다', [await prisma.trackedItem.count({ where: { id: o3Id } }), r3.durableUndo?.cards.length, r3.durableUndo?.seedLabels], [1, 0, [N3]])
    eq('탐침 A 적용취소', (await fin.undoDurableConvert(J(r3.durableUndo!))).ok, true)
    eq('탐침 A 적용취소: 새 품명 행이 카드에 이어지고(미아 없음) 옛 카드와 옛 품명 구매는 그대로',
      [await matched(z.id), await cnt(N3), (await prisma.trackedItem.findUnique({ where: { id: o3Id } }))?.label, await prisma.expense.count({ where: { propertyId: P1, itemLabel: O3 } })], [true, 1, O3, 1])
  }

  // ── 다품목 저장 뒤 고정지출 기준 달 맞춤이 실패해도 성공으로 돌려준다(후속 검수 참고 4, E2 와 같은 클래스) ──────
  // 저장은 배열 트랜잭션에서 이미 끝났다. 실패로 돌려주면 다시 저장이 품목 행을 한 벌 더 만든다. 갱신 트리거로 실패를 만든다.
  {
    const A = '고정분할선반'
    const rec = await prisma.recurringExpense.create({ data: { propertyId: P1, title: '분기 선반', amount: 90000, category: '소모품비', dueDay: 1, intervalMonths: 3, anchorMonth: 1 } })
    const e = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-13T00:00:00Z'), amount: 90000, category: '소모품비', itemLabel: A, qtyValue: 1, qtyUnit: '개', recurringExpenseId: rec.id } })
    const sum0 = await amountSum()
    await directSql(`create function flow_block_rec_update() returns trigger as $$ begin raise exception 'flow anchor blocked'; end $$ language plpgsql;
      create trigger flow_block_rec_update before update on recurring_expenses for each row execute function flow_block_rec_update();`)
    const errLog: unknown[][] = []
    const origErr = console.error
    console.error = (...a: unknown[]) => { errLog.push(a) }
    const r = await fin.updateExpense(fd({ id: e.id, ...base, amount: '90000', category: '소모품비', roomId: '',
      itemsJson: items([{ label: A, amount: 60000 }, { label: A + '탭', amount: 30000 }]) })).finally(() => { console.error = origErr })
    await directSql(`drop trigger flow_block_rec_update on recurring_expenses; drop function flow_block_rec_update();`)
    eq('참고 4 기준 달 맞춤이 실패해도 저장은 성공(실패는 서버 로그 한 줄)', [r.ok, errLog.length], [true, 1])
    eq('참고 4 품목 행 둘·금액 합 그대로(다시 저장할 일이 없다)', [await prisma.expense.count({ where: { propertyId: P1, itemLabel: { in: [A, A + '탭'] } } }), await amountSum()], [2, sum0])
  }

  // ── 단일 갈래 F1 전환 저장 뒤 기준 달 맞춤이 실패해도 성공과 적용취소 토큰을 돌려준다(후속 검수 권장 2) ──────────
  // 저장과 전환은 이미 커밋됐다. 실패로 돌려주면 토큰이 사라져 전환을 되돌릴 길이 없어졌다.
  {
    const A = '고정단일냉장고'
    const rec = await prisma.recurringExpense.create({ data: { propertyId: P1, title: '분기 냉장고', amount: 90000, category: '소모품비', dueDay: 1, intervalMonths: 3, anchorMonth: 1 } })
    const e = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-13T00:00:00Z'), amount: 90000, category: '소모품비', itemLabel: A, qtyValue: 1, qtyUnit: '개', recurringExpenseId: rec.id } })
    await directSql(`create function flow_block_rec_update1() returns trigger as $$ begin raise exception 'flow anchor blocked'; end $$ language plpgsql;
      create trigger flow_block_rec_update1 before update on recurring_expenses for each row execute function flow_block_rec_update1();`)
    const errLog: unknown[][] = []
    const origErr = console.error
    console.error = (...a: unknown[]) => { errLog.push(a) }
    const r = await fin.updateExpense(fd({ id: e.id, ...base, amount: '90000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519,
      itemLabel: A, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: A, amount: 90000 }]) })).finally(() => { console.error = origErr })
    await directSql(`drop trigger flow_block_rec_update1 on recurring_expenses; drop function flow_block_rec_update1();`)
    eq('권장 2 단일 갈래 기준 달 맞춤이 실패해도 저장 성공·전환 토큰 유지(실패는 서버 로그 한 줄)', [r.ok, r.ok ? !!r.durableUndo : null, errLog.length], [true, true, 1])
    eq('권장 2 행은 비품·예정 519호', [(await prisma.expense.findUnique({ where: { id: e.id } }))?.category, (await prisma.expense.findUnique({ where: { id: e.id } }))?.targetRoomId === R519], ['수선유지비', true])
    if (r.ok && r.durableUndo) {
      eq('권장 2 그 토큰으로 전환 적용취소', (await fin.undoDurableConvert(J(r.durableUndo))).ok, true)
      eq('권장 2 적용취소 뒤 소모품비·대상 호실', [(await prisma.expense.findUnique({ where: { id: e.id } }))?.category, (await prisma.expense.findUnique({ where: { id: e.id } }))?.roomId === R519], ['소모품비', true])
    }
  }

  // ── 서버 재판정: 화면이 본 판정과 다르면 거부 ────────────────────────────────────────
  {
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 1000, category: '소모품비', itemLabel: '이력휴지', qtyValue: 1 } })
    const sum0 = await amountSum()
    eq('재판정: 소모품 이력이 있는 품명은 전환 거부', await fin.addExpense(fd({ ...base, amount: '5000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemLabel: '이력휴지', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '이력휴지', amount: 5000 }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('재판정: 대상 카테고리가 다르면 거부(하드코딩·임의 카테고리 금지)', await fin.addExpense(fd({ ...base, amount: '5000', category: '공과금', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemLabel: '새물건', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '새물건', amount: 5000 }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('재판정: 호실 없이 전환 요청 거부', await fin.addExpense(fd({ ...base, amount: '5000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: '', targetRoomId: '', itemLabel: '새물건2', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '새물건2', amount: 5000 }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('재판정: 거부면 아무것도 안 만든다', await amountSum(), sum0)
  }

  // ── F1 적용취소 CAS: 전환 뒤 비품 화면에서 받으면 되돌리지 않는다 ─────────────────────────
  {
    const L = 'CAS냉장고'
    const r = await fin.addExpense(fd({ ...base, amount: '70000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemLabel: L, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: L, amount: 70000 }]) }))
    if (!r.ok) throw new Error(r.error)
    const x = (await rowsOf(L))[0]
    eq('CAS 준비: 비품 화면에서 수령', (await assets.setAssetReceived([x.id], true)).ok, true)
    const after = await exact(x.id)
    eq('CAS: 받은 뒤 적용취소 거부', await fin.undoDurableConvert(J(r.durableUndo!)), { ok: false, error: cp.DURABLE_CONVERT_UNDO_STALE })
    eq('CAS: 거부면 무변경', await exact(x.id), after)
  }

  // ── F3 이미 받은 소모품. 자동 점검 걷기·배정·이력·적용취소 바이트 동일 ───────────────────────
  const recvFixture = async (L: string) => {
    await fin.addExpense(fd({ ...base, amount: '133000', category: '소모품비', roomId: '', targetRoomId: '', itemLabel: L, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: L, amount: 133000 }]) }))
    const x = (await rowsOf(L))[0]
    const card = await prisma.trackedItem.findFirst({ where: { propertyId: P1, label: L } })
    await prisma.trackedItem.update({ where: { id: card!.id }, data: { hubLocationId: HUB, trackUnit: 'qty', qtyUnit: '개' } })
    await prisma.trackedItemLocation.create({ data: { trackedItemId: card!.id, storageLocationId: HUB } })
    const c = await inv.confirmReceipt(x.id, HUB)
    if (!c.ok) throw new Error(c.error)
    // 냉장고처럼 KST 06:05 에 받았다(UTC 로는 전날 21:05). 배정일이 KST 날짜(10/14)여야 한다.
    await prisma.expense.update({ where: { id: x.id }, data: { receivedAt: new Date('2026-10-13T21:05:33.000Z') } })
    return { x, card: card! }
  }
  const f3Edit = (id: string, L: string, extra: Record<string, string>) => fd({ id, ...base, amount: '133000', roomId: R519, itemLabel: L, qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: L, amount: 133000 }]), ...extra })
  {
    const L = '받은냉장고', LT = '받은냉장고쌍둥이'
    const { x, card } = await recvFixture(L)
    const { x: t } = await recvFixture(LT)
    const ledger0 = await ledger([card.id])
    const card0 = await cardExact(L)
    eq('F3 준비: 수령 자동 점검 하나', await prisma.stockCheck.count({ where: { sourceExpenseId: x.id } }), 1)
    const sum0 = await amountSum()
    eq('F3 쌍둥이(그대로 저장) ok', (await fin.updateExpense(f3Edit(t.id, LT, { category: '소모품비' }))).ok, true)
    const r = await fin.updateExpense(f3Edit(x.id, L, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3' }))
    if (!r.ok) throw new Error(r.error)
    const xr = await prisma.expense.findUnique({ where: { id: x.id } })
    eq('F3: 비품·519호·배정일 = 수령일 KST(10/14)·수령 시각 유지', [xr?.category, xr?.roomId === R519, xr?.assignedAt?.toISOString().slice(0, 10), xr?.receivedAt?.toISOString()], ['수선유지비', true, '2026-10-14', '2026-10-13T21:05:33.000Z'])
    eq('F3: 수령 자동 점검을 걷었다', await prisma.stockCheck.count({ where: { sourceExpenseId: x.id } }), 0)
    eq('F3: 빈 카드 지움', await prisma.trackedItem.count({ where: { id: card.id } }), 0)
    eq('F3: 배정 이력 미배정에서 519호(수령일)', await logs(L), [['none', '미배정', 'room', '519호', 1, '2026-10-14']])
    eq('F3: 금액 합 불변', await amountSum(), sum0)
    const assetsNow = await assets.getDurableItems()
    eq('F3: 비품 화면 519호 묶음에 선다', assetsNow.rooms.find(rm => rm.roomId === R519)?.items.some(it => it.itemLabel === L), true)
    const u = await fin.undoDurableConvert(J(r.durableUndo!))
    eq('F3 적용취소 ok', u, { ok: true })
    eq('F3 적용취소: 지출 행이 그대로 저장한 쌍둥이와 바이트 동일', (await shape(L)).map(s => s.replace(L, 'X')), (await shape(LT)).map(s => s.replace(LT, 'X')))
    eq('F3 적용취소: 재고 원장(자동 점검·위치 내역·링크) 바이트 동일', await ledger([card.id]), ledger0)
    eq('F3 적용취소: 카드 같은 id 바이트 그대로', await cardExact(L), card0)
    eq('F3 적용취소: 이력 줄 지움', await logs(L), [])
    eq('F3 두 번째 적용취소 거부', (await fin.undoDurableConvert(J(r.durableUndo!))).ok, false)
  }

  // ── F3 이후 점검이 수령분을 삼켰다. 조정 없이 거부, 함께 조정이면 빼고, 적용취소로 원장 바이트 동일 ───────
  {
    const L = '점검냉장고'
    const { x, card } = await recvFixture(L)
    // 수령 뒤 운영자가 센 점검(1개, 냉장고 포함)
    const later = await prisma.stockCheck.create({ data: { trackedItemId: card.id, date: new Date('2026-10-14T00:00:00Z'), createdAt: new Date(Date.now() + 60000), remainingQty: 1,
      locationBreakdown: { create: [{ storageLocationId: HUB, remainingQty: 1, carried: false }] } } })
    const ledger0 = await ledger([card.id])
    const before = await exact(x.id)
    eq('F3 이후 점검: 미리보기가 조정 필요와 그 수를 준다', (await fin.getDurableConvertFacts({ labels: [L], expenseId: x.id })).facts.receipt, { blocked: null, needsAdjust: true, adjustChecks: 1 })
    const r0 = await fin.updateExpense(f3Edit(x.id, L, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3' }))
    eq('F3 이후 점검: 함께 조정 없이 오면 정본 수령 취소가 거부', r0, { ok: false, error: rc.RECEIPT_CANCEL_LATER })
    eq('F3 이후 점검: 거부면 무변경', [await exact(x.id), await ledger([card.id])], [before, ledger0])
    const r = await fin.updateExpense(f3Edit(x.id, L, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3', convertAdjust: '1' }))
    if (!r.ok) throw new Error(r.error)
    eq('F3 함께 조정: 이후 점검에서 수령분을 뺐다', (await prisma.stockCheck.findUnique({ where: { id: later.id } }))?.remainingQty, 0)
    eq('F3 함께 조정: 카드는 남는다(센 점검이 있다)', await prisma.trackedItem.count({ where: { id: card.id } }), 1)
    eq('F3 함께 조정: 축 1 갈림 없음', await split(L), false)
    eq('F3 함께 조정 적용취소', (await fin.undoDurableConvert(J(r.durableUndo!))).ok, true)
    eq('F3 함께 조정 적용취소: 원장 바이트 동일', await ledger([card.id]), ledger0)
    // 전환만 되돌린다. 같은 저장에서 적어 넣은 호실(519호, 이 수정의 발동 까닭)은 남는다
    eq('F3 함께 조정 적용취소: 행은 호실을 적은 수정만 남고 바이트 동일', await exact(x.id), JSON.stringify({ ...JSON.parse(before), roomId: R519 }))
  }

  // ── F3 손으로 센 점검이 자동 점검에 합쳐졌다. 막고 아무것도 안 바꾼다 ──────────────────────
  {
    const L = '합친냉장고'
    const { x, card } = await recvFixture(L)
    await prisma.stockCheckLocation.updateMany({ where: { stockCheck: { sourceExpenseId: x.id } }, data: { restockedQty: 1 } })
    const before = [await exact(x.id), await ledger([card.id])]
    eq('F3 합친 실측: 미리보기가 막힘(merged)', (await fin.getDurableConvertFacts({ labels: [L], expenseId: x.id })).facts.receipt, { blocked: 'merged', needsAdjust: false, adjustChecks: 0 })
    eq('F3 합친 실측: 서버도 같은 판정으로 거부', await fin.updateExpense(f3Edit(x.id, L, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3' })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('F3 합친 실측: 정본 수령 취소도 같은 까닭으로 막는다', (await rc.planReceiptCancel(x.id, P1)), { ok: false, error: rc.RECEIPT_CANCEL_MERGED })
    eq('F3 합친 실측: 무변경(합치지 않는다)', [await exact(x.id), await ledger([card.id])], before)
  }

  // ── 검수 R1·R3·R5 F3 경계(X1·X2·X2b·X3·X8) ─────────────────────────────────────────
  {
    // X1 받은 소모품 + 한 방 분배. 저장 경로가 분배 갈래라 F3 가 성립하지 않는다(판정도 묻지 않음, 서버도 거부)
    const { x } = await recvFixture('엑스원정수기')
    const its = [{ label: '엑스원정수기', allocations: [{ roomId: R519, qty: '1' }], qtyValue: '1', qtyUnit: '개' }]
    const { facts } = await fin.getDurableConvertFacts({ labels: ['엑스원정수기'], expenseId: x.id })
    const orig = { category: '소모품비', roomIds: [], facets: cp.itemFacets({ label: '엑스원정수기', qtyValue: 1, qtyUnit: '개' }) }
    eq('R1 X1 한 방 분배는 판정이 묻지 않는다', cp.conversionPlan({ category: '소모품비', items: cp.convertItemsFrom(its, null), received: true, original: orig }, facts).kind, 'none')
    eq('R1 X1 서버도 거부', await fin.updateExpense(fd({ id: x.id, ...base, amount: '133000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3', roomId: '', itemLabel: '엑스원정수기', qtyValue: '1', qtyUnit: '개',
      itemsJson: items([{ label: '엑스원정수기', amount: 133000, alloc: [{ roomId: R519, qty: '1' }] }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
  }
  {
    // X2·X2b 같은 저장에서 수량·품명을 바꾸면 F3 를 받지 않는다(바꾼 원장 델타로 되살리면 어긋난다)
    const { x, card } = await recvFixture('엑스투제습기')
    const before = [await exact(x.id), await ledger([card.id])]
    eq('R3 X2 수량을 바꾼 F3 거부', await fin.updateExpense(fd({ id: x.id, ...base, amount: '133000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3', roomId: R519, itemLabel: '엑스투제습기', qtyValue: '2', qtyUnit: '개', itemsJson: items([{ label: '엑스투제습기', amount: 133000, qty: '2' }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('R3 X2b 품명을 바꾼 F3 거부', await fin.updateExpense(fd({ id: x.id, ...base, amount: '133000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3', roomId: R519, itemLabel: '엑스투오븐', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: '엑스투오븐', amount: 133000 }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('R3 거부면 무변경', [await exact(x.id), await ledger([card.id])], before)
  }
  {
    // X3 F3 뒤 비품 화면에서 수량을 바꾸면 적용취소가 막힌다(되살린 자동 점검이 바뀐 수량과 어긋난다)
    const { x, card } = await recvFixture('엑스쓰리가습기')
    const r = await fin.updateExpense(f3Edit(x.id, '엑스쓰리가습기', { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3' }))
    if (!r.ok || !r.durableUndo) throw new Error('X3 준비 실패')
    eq('R3 X3 비품 화면에서 수량 3', (await assets.setAssetRowQty(x.id, 3)).ok, true)
    const after = [await exact(x.id), await ledger([card.id])]
    eq('R3 X3 수량이 바뀐 뒤 적용취소 거부', await fin.undoDurableConvert(J(r.durableUndo)), { ok: false, error: cp.DURABLE_CONVERT_UNDO_STALE })
    eq('R3 X3 거부면 무변경', [await exact(x.id), await ledger([card.id])], after)
  }
  {
    // R5 화면이 본 종류와 서버 판정이 다르면 거부(받은 소모품에 F1 을 실어 옴)
    const { x } = await recvFixture('알파이브선풍기')
    eq('R5 종류가 다르면 거부', await fin.updateExpense(f3Edit(x.id, '알파이브선풍기', { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1' })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('R5 종류가 없으면 거부', await fin.updateExpense(f3Edit(x.id, '알파이브선풍기', { category: '수선유지비', durableFrom: '소모품비' })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
  }
  {
    // X8 매칭 카드가 없는데(단위가 갈림) 이후 점검이 있다. 미리보기는 막힘(ledger), 서버는 조정 표식이 있어도 거부, 정본도 같다
    const { x, card } = await recvFixture('엑스에잇청소기')
    await prisma.stockCheck.create({ data: { trackedItemId: card.id, date: new Date('2026-10-20T00:00:00Z'), createdAt: new Date(Date.now() + 60000), remainingQty: 1,
      locationBreakdown: { create: [{ storageLocationId: HUB, remainingQty: 1, carried: false }] } } })
    await prisma.trackedItem.update({ where: { id: card.id }, data: { qtyUnit: '대' } })
    const before = [await exact(x.id), await ledger([card.id])]
    eq('R1 X8 미리보기는 막힘(ledger)', (await fin.getDurableConvertFacts({ labels: ['엑스에잇청소기'], expenseId: x.id })).facts.receipt, { blocked: 'ledger', needsAdjust: false, adjustChecks: 0 })
    eq('R1 X8 조정 표식을 실어도 서버가 거부', await fin.updateExpense(f3Edit(x.id, '엑스에잇청소기', { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3', convertAdjust: '1' })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    eq('R1 정본 수령 취소(함께 조정)도 매칭 카드 없이 이후 점검이 있으면 거부', await inv.undoConfirmReceipt(x.id, { adjustFollowing: true }), { ok: false, error: rc.RECEIPT_CANCEL_LATER })
    eq('R1 X8 거부면 무변경(자동 점검·이후 점검 그대로)', [await exact(x.id), await ledger([card.id])], before)
  }
  {
    // R7 그 품명에 비품 이력이 있으면 그 품명의 비품 카테고리가 대상(영업장 최빈 수선유지비가 아니라)
    await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-07-01T00:00:00Z'), amount: 1000, category: '관리비', itemLabel: 'R7선반', qtyValue: 1, receivedAt: new Date('2026-07-01T00:00:00Z') } })
    eq('R7 영업장 최빈으로 실으면 거부', await fin.addExpense(fd({ ...base, amount: '30000', category: '수선유지비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemLabel: 'R7선반', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: 'R7선반', amount: 30000 }]) })), { ok: false, error: cp.DURABLE_CONVERT_STALE })
    const r = await fin.addExpense(fd({ ...base, amount: '30000', category: '관리비', durableFrom: '소모품비', durableKind: 'F1', roomId: R519, targetRoomId: '', itemLabel: 'R7선반', qtyValue: '1', qtyUnit: '개', itemsJson: items([{ label: 'R7선반', amount: 30000 }]) }))
    eq('R7 품명 이력 카테고리(관리비)로 실으면 받는다', [r.ok, (await prisma.expense.findMany({ where: { propertyId: P1, itemLabel: 'R7선반', amount: 30000 } })).map((e: { category: string; targetRoomId: string | null }) => [e.category, e.targetRoomId === R519])], [true, [['관리비', true]]])
  }

  // ── 남의 영업장·다른 용도·고친 토큰 ───────────────────────────────────────────────
  {
    const L = '토큰냉장고'
    const { x } = await recvFixture(L)
    const r = await fin.updateExpense(f3Edit(x.id, L, { category: '수선유지비', durableFrom: '소모품비', durableKind: 'F3' }))
    if (!r.ok || !r.durableUndo) throw new Error('토큰 준비 실패')
    const after = await exact(x.id)
    g.__CR_FLOW_PID = P2
    eq('MT 다른 영업장에서 적용취소 거부(서명이 영업장에 묶였다)', await fin.undoDurableConvert(J(r.durableUndo)), { ok: false, error: cp.DURABLE_CONVERT_UNDO_INVALID })
    g.__CR_FLOW_PID = P1
    eq('MT 거부면 무변경', await exact(x.id), after)
    const { sig: _s, ...body } = J(r.durableUndo); void _s
    const canon = cp.canonicalDurableConvertUndo(body as never)
    for (const dom of ['asset-receipt', 'receipt-qty-fill', 'cash-receipt']) {
      eq(`교차 용도 ${dom} 서명 거부`, await fin.undoDurableConvert({ ...body, sig: crl.signUndoBody(dom, P1, canon) as string } as never), { ok: false, error: cp.DURABLE_CONVERT_UNDO_INVALID })
    }
    eq('고친 토큰(되돌릴 카테고리 공과금) 거부', await fin.undoDurableConvert({ ...J(r.durableUndo), from: '공과금' }), { ok: false, error: cp.DURABLE_CONVERT_UNDO_INVALID })
    eq('고친 토큰(무관한 지출 id) 거부', await fin.undoDurableConvert({ ...J(r.durableUndo), placed: { ...r.durableUndo.placed!, id: randomUUID() } }), { ok: false, error: cp.DURABLE_CONVERT_UNDO_INVALID })
    eq('서명 없는 토큰 거부', await fin.undoDurableConvert({ ...body } as never), { ok: false, error: cp.DURABLE_CONVERT_UNDO_INVALID })
    eq('거부들 뒤에도 무변경', await exact(x.id), after)
    eq('대조군: 제 영업장·제 용도 토큰은 통과', (await fin.undoDurableConvert(J(r.durableUndo))).ok, true)
  }

  console.log(`[비품 전환 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
