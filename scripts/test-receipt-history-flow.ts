// 영수증 규격 표기 기억 통합 회귀. 지난 기록 맞추기 도우미 → 실제 지출 저장 → 비품 카드 묶음을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-receipt-history-flow.ts
//
// 왜 통합인가(2026-10-27 운영자 승인, 영수증 규격 표기 기억 1단계). 판정 진리표(test-spec-notation)는 순수 함수만 본다.
// 영수증으로 들어온 '183cm, 1.8T' 가 지난 기록 '폭 183cm · 두께 1.8T' 로 맞춰져 **저장된 뒤 비품 카드가 하나로 묶이는지**,
// 저장이 세부스펙 사전(ItemSpecOption)을 더 늘리지 않는지, 남의 영업장 기록을 안 읽는지는 실제 쓰기를 돌려야 보인다.
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
  const assets = await import('@/app/(app)/inventory/assets/actions')
  const iv = await import('@/lib/itemVariants')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }
  void directSql; void J

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const HUB = (await prisma.storageLocation.create({ data: { propertyId: P1, name: '415호 창고', isHub: true } })).id as string
  const L = '원목무늬 장판'
  const OLD = '폭 183cm · 두께 1.8T', OCR = '183cm, 1.8T'
  // 지난 기록 — 5~8월 표기 셋(창고에 받아 둔 여분), 남의 영업장엔 영수증 표기로만 다섯
  for (let i = 0; i < 3; i++) {
    await prisma.expense.create({ data: { propertyId: P1, date: new Date(`2026-0${5 + i}-29T00:00:00Z`), amount: 52000, category: '수선유지비', itemLabel: L, specText: OLD, qtyValue: 4, qtyUnit: 'm', unitBasis: 'qty', receivedAt: new Date(`2026-0${5 + i}-29T00:00:00Z`), storedLocationId: HUB } })
  }
  for (let i = 0; i < 5; i++) {
    await prisma.expense.create({ data: { propertyId: P2, date: new Date('2026-09-01T00:00:00Z'), amount: 1000, category: '수선유지비', itemLabel: L, specText: OCR, qtyValue: 1, qtyUnit: 'm' } })
  }
  await prisma.itemSpecOption.create({ data: { propertyId: P1, itemLabel: L, label: OLD } })
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const save = async (specText: string) => {
    const items = JSON.stringify([{ label: L, specValue: '', specUnit: '', specText, qtyValue: '4.2', qtyUnit: 'm', amount: 54600, unitBasis: 'qty' }])
    const r = await fin.addExpense(fd({ date: '2026-10-20', payMethod: '계좌이체', vendor: '장판세상', amount: '54600', category: '수선유지비', itemLabel: L, specText, qtyValue: '4.2', qtyUnit: 'm', itemsJson: items }))
    if (!r.ok) throw new Error('저장 실패 ' + JSON.stringify(r))
    // 받아서 같은 창고에 둔다(수령 배정 화면이 하는 일 — 카드 키의 보관 위치 칸을 맞춘다)
    await prisma.expense.updateMany({ where: { propertyId: P1, itemLabel: L, receivedAt: null }, data: { receivedAt: new Date('2026-10-21T00:00:00Z'), storedLocationId: HUB } })
  }
  const cards = async () => (await assets.getDurableItems()).unassigned.filter(c => c.itemLabel === L).map(c => [c.specText, c.count])

  // ── 1. 도우미가 영수증 표기를 지난 기록 표기로 맞춘다(제 영업장 기록만 읽는다) ─────────────────────
  const [rec] = await iv.reconcileOcrItemsWithHistory(P1, [{ label: L, specText: OCR, qtyValue: '4.2', qtyUnit: 'm', amount: 54600 }])
  eq('영수증 표기가 지난 기록 표기로 맞춰진다', [rec.specText, rec.specNote?.kind], [OLD, 'aligned'])
  eq('맞춘 흔적이 영수증 원문을 쥔다', rec.specNote?.kind === 'aligned' ? rec.specNote.receipt.specText : null, OCR)
  const [again] = await iv.reconcileOcrItemsWithHistory(P1, [rec])
  eq('이미 맞춘 품목은 다시 맞추지 않는다(원문 보존)', again.specNote, rec.specNote)
  const [other] = await iv.reconcileOcrItemsWithHistory(P2, [{ label: L, specText: OLD }])
  eq('남의 영업장은 그 영업장 기록으로만 맞춘다', [other.specText, other.specNote?.kind], [OCR, 'aligned'])

  // ── 2. 맞춘 값으로 저장하면 비품 카드 하나, 사전은 그대로 ─────────────────────────────────────
  const dictBefore = await prisma.itemSpecOption.count({ where: { propertyId: P1 } })
  await save(rec.specText ?? '')
  eq('저장 뒤 같은 창고의 장판은 카드 하나다', await cards(), [[OLD, 4]])
  eq('저장이 세부스펙 사전을 늘리지 않는다', await prisma.itemSpecOption.count({ where: { propertyId: P1 } }), dictBefore)
  const units = await fin.getLastItemUnits(L)
  eq('세부스펙 칩은 장부 파생이고 사전과 같은 표기는 한 번만', units?.specOptions, [OLD])

  // ── 3. 대조군 — 영수증 표기 그대로 저장하면 카드가 갈린다(이 그물이 지키는 것) ───────────────────
  await save(OCR)
  eq('대조군: 맞추지 않은 표기는 카드 둘', (await cards()).length, 2)
  const [after] = await iv.reconcileOcrItemsWithHistory(P1, [{ label: L, specText: OCR }])
  eq('갈린 뒤에도 많이 쓴 표기로 맞춘다', after.specText, OLD)
  eq('칩은 동치 표기를 한 칩으로 접는다', (await fin.getLastItemUnits(L))?.specOptions, [OLD])

  // ── 4. 규격 없는 영수증 + 지난 기록 변형 하나 = 채움, 둘 이상 = 수만 ─────────────────────────────
  await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-10-18T00:00:00Z'), amount: 15000, category: '수선유지비', itemLabel: '슬라이드바 거치대', specValue: 750, specUnit: 'mm', qtyValue: 1, qtyUnit: '개' } })
  for (let i = 0; i < 2; i++) await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-07-01T00:00:00Z'), amount: 15000, category: '수선유지비', itemLabel: '슬라이드바 거치대', qtyValue: 1, qtyUnit: '개' } })
  const [fill] = await iv.reconcileOcrItemsWithHistory(P1, [{ label: '슬라이드바 거치대' }])
  eq('규격 없는 영수증 + 숫자 규격 변형 하나 = 채우지 않고 제안(돈의 축)', [fill.specValue, fill.specNote?.kind, fill.specNote?.kind === 'offer' ? fill.specNote.spec.specValue : null], [undefined, 'offer', '750'])
  for (const c of ['싱글/그레이', '싱글/퍼플']) await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 20000, category: '수선유지비', itemLabel: '매트리스 커버 (방수)', specText: c, qtyValue: 1, qtyUnit: '개' } })
  const [choose] = await iv.reconcileOcrItemsWithHistory(P1, [{ label: '매트리스 커버 (방수)' }])
  eq('변형 둘이면 채우지 않고 수만 넘긴다', [choose.specText, choose.specNote], [undefined, { kind: 'choose', count: 2 }])
  const [green] = await iv.reconcileOcrItemsWithHistory(P1, [{ label: '매트리스 커버 (방수)', specText: '싱글/그린' }])
  eq('색이 다르면 맞추지 않는다(이전 표기와 다름)', [green.specText, green.specNote?.kind], ['싱글/그린', 'differs'])

  // ── 5. 지난 기록 변형 목록(이력 제안 패널) ─────────────────────────────────────────────────
  {
    const v = await fin.getItemVariants(['매트리스 커버 (방수)', '원목무늬 장판'])
    const cover = v.filter(x => x.itemLabel === '매트리스 커버 (방수)').map(x => x.specText).sort()
    eq('커버는 색상마다 변형 하나', cover, ['싱글/그레이', '싱글/퍼플'])
    const floor = v.filter(x => x.itemLabel === L)
    eq('표기만 다른 장판은 변형 하나, 대표 표기는 많이 쓴 쪽', [floor.length, floor[0]?.specText, floor[0]?.count], [1, OLD, 5])
    eq('변형은 원문 조합을 모두 쥔다(저장 게이트 판정용)', floor[0]?.raws.map(r => r.specText).sort(), [OCR, OLD].sort())
    eq('단가는 그 변형 유상 최신 행의 금액 ÷ 기준수량(개당 기록이면 수량만)', [floor[0]?.unitPrice, floor[0]?.basisUnit], [13000, 'm'])
    g.__CR_FLOW_PID = P2
    eq('남의 영업장 변형은 안 보인다', (await fin.getItemVariants(['매트리스 커버 (방수)'])).length, 0)
    g.__CR_FLOW_PID = P1
  }

  // ── 6. 규격별 나누기 개명은 적용취소가 남는다(D5, splitTrackedItemLabel) ────────────────────────
  {
    const card = await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '마대', trackUnit: 'qty', qtyUnit: '장' } })
    const e1 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-01T00:00:00Z'), amount: 5000, category: '소모품비', itemLabel: '마대', specValue: 20, specUnit: 'L', qtyValue: 10, qtyUnit: '장' } })
    const e2 = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-02T00:00:00Z'), amount: 5000, category: '소모품비', itemLabel: '마대', specValue: 20, specUnit: 'L', qtyValue: 10, qtyUnit: null } })
    const other = await prisma.expense.create({ data: { propertyId: P1, date: new Date('2026-09-02T00:00:00Z'), amount: 5000, category: '부식비', itemLabel: '마대', qtyValue: 1, qtyUnit: '개' } })
    const aliasBefore = await prisma.itemNameAlias.count({ where: { propertyId: P1 } })
    const r = await fin.splitTrackedItemLabel(card.id, '마대 20L')
    eq('나누기 개명 성공 + 기록', [r.ok, r.ok ? r.renamedExpenses : -1], [true, 2])
    const lbl = async (id: string) => (await prisma.expense.findUnique({ where: { id } }))?.itemLabel
    eq('같은 카테고리 지출(단위 느슨 일치)만 개명', [await lbl(e1.id), await lbl(e2.id), await lbl(other.id)], ['마대 20L', '마대 20L', '마대'])
    eq('카드도 개명', (await prisma.trackedItem.findUnique({ where: { id: card.id } }))?.label, '마대 20L')
    eq('별칭을 만들지 않는다', await prisma.itemNameAlias.count({ where: { propertyId: P1 } }), aliasBefore)
    eq('목록이 규격별 나누기로 말한다', (await fin.getItemNameMergeRuns()).find(x => r.ok && x.id === r.runId)?.kind, 'split')
    eq('적용취소 성공', (await fin.undoItemNameMerge(r.ok ? r.runId : '')).ok, true)
    eq('적용취소가 지출·카드 이름을 되돌린다', [await lbl(e1.id), await lbl(e2.id), (await prisma.trackedItem.findUnique({ where: { id: card.id } }))?.label], ['마대', '마대', '마대'])
    await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '마대 20L', trackUnit: 'qty' } })
    eq('같은 이름 카드가 있으면 거부(무변경)', [(await fin.splitTrackedItemLabel(card.id, '마대 20L')).ok, await lbl(e1.id)], [false, '마대'])
    g.__CR_FLOW_PID = P2
    eq('남의 영업장 카드는 못 찾는다', (await fin.splitTrackedItemLabel(card.id, '마대 X')).ok, false)
    g.__CR_FLOW_PID = P1
  }

  console.log(`[영수증 지난 기록 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
