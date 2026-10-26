// 고아 재고 카드 정리 통합 회귀(신고 f3866bca). 실제 서버 액션을 메모리 PGlite 위에서 화면 호출 순서대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-tracked-orphan-flow.ts
//
// 왜 통합인가(2026-10-26 운영자 승인). 카드를 고아로 만드는 쓰기는 다섯이다(재고 제외·지출 삭제·받기 전 품명 변경·카테고리 '지출만'·
// 다품목으로 나누며 원래 줄 빼기). 정리가 그 쓰기와 한 트랜잭션인지, 기록이 하나라도 있는 카드는 그대로인지, 적용취소가 같은 id 로
// 되살리는지는 실제 쓰기를 돌려야 보인다. 대역·운영 DB 차단은 기타수익 하네스(scripts/test-income-recurring-scope-flow.ts)와 같은 판이다.
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
  // 외래키는 빼되(부모 없는 대역 행을 만든다) 카드를 지울 때 함께 지워지는 사슬(위치 연결·임시저장)은 살린다.
  const KEEP = /ALTER TABLE "(stock_check_drafts|tracked_item_locations)" ADD CONSTRAINT/
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s) || KEEP.test(s)).join(';\n')
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
  const inv = await import('@/app/(app)/inventory/actions')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const LOC = (await prisma.storageLocation.create({ data: { propertyId: P1, name: '창고', isHub: true } })).id as string

  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const card = async (label: string, category = '소모품비', pid = P1) =>
    (await prisma.trackedItem.create({ data: { propertyId: pid, category, label, trackUnit: 'qty', qtyUnit: '개' } })).id as string
  const exp = async (label: string, o: Record<string, unknown> = {}) => (await prisma.expense.create({
    data: { propertyId: P1, date: new Date('2026-10-20T00:00:00Z'), amount: 5000, category: '소모품비', itemLabel: label, qtyValue: 1, qtyUnit: '개', ...o },
  })).id as string
  const has = async (id: string) => (await prisma.trackedItem.count({ where: { id } })) === 1
  // 카드 바이트(updatedAt 만 뺀다). 되살린 카드가 지우기 전과 같은 행인가
  const cardRow = async (id: string) => { const r = await prisma.trackedItem.findUnique({ where: { id } }) as Record<string, unknown> | null; if (r) delete r.updatedAt; return JSON.stringify(r) }
  const edit = (id: string, o: Record<string, string>) => fd({ id, date: '2026-10-20', amount: '5000', category: '소모품비', payMethod: '계좌이체', ...o })

  // ── 0. 품목 삭제 판정. 재고 제외 지출만 있는 카드는 지울 수 있다(옥상 폐기물처리) ──────────────────
  {
    const id = await card('옥상 폐기물처리', '폐기물 처리비')
    await exp('옥상 폐기물처리', { category: '폐기물 처리비', excludeFromInventory: true })
    await exp('옥상 폐기물처리', { category: '폐기물 처리비', excludeFromInventory: true })
    eq('삭제 판정: 재고 제외 지출만 있으면 메뉴에 선다', (await inv.getInventoryDetail(id))?.deletable, true)
    const r = await inv.deleteTrackedItemIfEmpty(id)
    eq('삭제 판정: 재고 제외 지출만 있으면 지워진다', [r.ok, await has(id)], [true, false])
    const keep = await card('살아 있는 카드')
    await exp('살아 있는 카드')
    eq('삭제 판정 대조: 재고 구매가 있으면 거부', (await inv.deleteTrackedItemIfEmpty(keep)).ok, false)
  }

  // ── 1. 재고 제외 ──────────────────────────────────────────────────────────
  {
    const id = await card('제외 고아')
    const e = await exp('제외 고아')
    const before = await cardRow(id)
    const r = await inv.excludeExpenseFromInventory(e)
    eq('제외: 마지막 재고 구매를 빼면 카드 정리', [r.ok, r.ok && r.retiredCard?.item.id === id, await has(id)], [true, true, false])
    // 화면 순서: 제외의 적용취소가 카드를 먼저 되살리고 다시 포함한다
    eq('제외 적용취소: 카드 되살림', await inv.undoDeleteTrackedItem(J(r.ok ? r.retiredCard! : null!)), { ok: true })
    eq('제외 적용취소: 다시 포함', (await inv.includeExpenseInInventory(e)).ok, true)
    eq('제외 적용취소: 같은 id·같은 행', [await has(id), await cardRow(id)], [true, before])
    eq('제외 적용취소: 시드가 카드를 하나 더 만들지 않는다', await prisma.trackedItem.count({ where: { propertyId: P1, label: '제외 고아' } }), 1)

    const kept = await card('제외 기록 있음')
    const e2 = await exp('제외 기록 있음')
    await prisma.stockCheck.create({ data: { trackedItemId: kept, date: new Date('2026-10-21T00:00:00Z'), remainingQty: 1 } })
    const r2 = await inv.excludeExpenseFromInventory(e2)
    eq('제외 대조: 점검이 있는 카드는 그대로', [r2.ok, r2.ok && !r2.retiredCard, await has(kept)], [true, true, true])

    const linked = await card('제외 위치 연결')
    const e3 = await exp('제외 위치 연결')
    await prisma.trackedItemLocation.create({ data: { trackedItemId: linked, storageLocationId: LOC } })
    eq('제외 대조: 위치 연결이 있는 카드는 그대로', [(await inv.excludeExpenseFromInventory(e3)).ok, await has(linked)], [true, true])

    const hidden = (await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '제외 숨김', isArchived: true } })).id as string
    const e4 = await exp('제외 숨김')
    eq('제외 대조: 숨긴 카드는 그대로(시드가 되살리지 않게 남긴 표식)', [(await inv.excludeExpenseFromInventory(e4)).ok, await has(hidden)], [true, true])

    const twin = await card('제외 다른 구매')
    const e5 = await exp('제외 다른 구매'); await exp('제외 다른 구매')
    eq('제외 대조: 같은 품명 재고 구매가 남으면 그대로', [(await inv.excludeExpenseFromInventory(e5)).ok, await has(twin)], [true, true])

    // 다시 포함은 카드가 없으면 증분 시드로 세운다(정리된 뒤 적용취소 말고 다시 포함한 경우)
    const gone = await card('포함 시드')
    const e6 = await exp('포함 시드')
    await inv.excludeExpenseFromInventory(e6)
    eq('포함 시드: 제외로 정리됨', await has(gone), false)
    await inv.includeExpenseInInventory(e6)
    eq('포함 시드: 다시 포함하면 카드가 선다', await prisma.trackedItem.count({ where: { propertyId: P1, category: '소모품비', label: '포함 시드' } }), 1)
  }

  // ── 2. 지출 삭제 ──────────────────────────────────────────────────────────
  {
    const id = await card('삭제 고아')
    const e = await exp('삭제 고아')
    const before = await cardRow(id)
    const r = await fin.deleteExpense(e)
    eq('삭제: 마지막 재고 구매를 지우면 카드 정리', [r.ok, r.ok && r.retiredCard?.item.id === id, await has(id)], [true, true, false])
    eq('삭제 적용취소: 카드 먼저', await inv.undoDeleteTrackedItem(J(r.ok ? r.retiredCard! : null!)), { ok: true })
    eq('삭제 적용취소: 지출 복원', await fin.undoDeleteExpense(J(r.ok ? r.undo : null!)), { ok: true })
    eq('삭제 적용취소: 같은 id·같은 행', [await has(id), await cardRow(id)], [true, before])

    const kept = await card('삭제 입수 있음')
    const e2 = await exp('삭제 입수 있음')
    await prisma.stockAddition.create({ data: { trackedItemId: kept, date: new Date("2026-10-21T00:00:00Z"), addedQty: 1 } })
    const r2 = await fin.deleteExpense(e2)
    eq('삭제 대조: 입수가 있는 카드는 그대로', [r2.ok, r2.ok && !r2.retiredCard, await has(kept)], [true, true, true])

    const drafted = await card('삭제 임시저장')
    const e3 = await exp('삭제 임시저장')
    await prisma.stockCheckDraft.create({ data: { trackedItemId: drafted, data: {} } })
    eq('삭제 대조: 점검 임시저장이 있는 카드는 그대로', [(await fin.deleteExpense(e3)).ok, await has(drafted)], [true, true])
  }

  // ── 3. 받기 전 품명 변경 ──────────────────────────────────────────────────────
  {
    const oldId = await card('품명 옛것')
    const newId = await card('품명 새것')
    await exp('품명 새것')
    const e = await exp('품명 옛것')
    const r = await fin.updateExpense(edit(e, { itemLabel: '품명 새것', qtyValue: '1', qtyUnit: '개' }))
    eq('품명 변경: 새 이름 카드가 이미 있어 개명이 안 되면 옛 카드 정리', [r.ok, r.ok && r.retiredCard?.item.id === oldId, await has(oldId), await has(newId)], [true, true, false, true])
    eq('품명 변경 적용취소: 같은 id 로 되살림', [await inv.undoDeleteTrackedItem(J(r.ok ? r.retiredCard! : null!)), await has(oldId)], [{ ok: true }, true])

    const renamed = await card('개명 옛것')
    const e2 = await exp('개명 옛것')
    const r2 = await fin.updateExpense(edit(e2, { itemLabel: '개명 새것', qtyValue: '1', qtyUnit: '개' }))
    const after = await prisma.trackedItem.findUnique({ where: { id: renamed } })
    eq('품명 변경 대조: 새 이름 카드가 없으면 카드째 개명(정리 없음)', [r2.ok, r2.ok && !r2.retiredCard, after?.label], [true, true, '개명 새것'])

    const kept = await card('품명 폐기 있음')
    await card('품명 폐기 새것')
    const e3 = await exp('품명 폐기 있음')
    await prisma.stockDisposal.create({ data: { trackedItemId: kept, date: new Date("2026-10-21T00:00:00Z"), disposedQty: 1 } })
    const r3 = await fin.updateExpense(edit(e3, { itemLabel: '품명 폐기 새것', qtyValue: '1', qtyUnit: '개' }))
    eq('품명 변경 대조: 폐기가 있는 카드는 그대로', [r3.ok, r3.ok && !r3.retiredCard, await has(kept)], [true, true, true])
  }

  // ── 4. 카테고리 변경 '지출만'. 옛 카드는 지출 수정이 서명해 돌려준 토큰(저장 전 카테고리·품명)으로 찾는다 ─────────────
  const INVALID = '지출 정보가 최신이 아닙니다. 새로고침 후 다시 시도해 주세요.'
  {
    const id = await card('카테고리 고아', '소모품비')
    const e = await exp('카테고리 고아')
    const saved = await fin.updateExpense(edit(e, { category: '부식비' }))
    eq('카테고리 저장: 서명된 이동 토큰(저장 전·뒤 값)', saved.ok && saved.categoryMove ? [saved.categoryMove.fromCategory, saved.categoryMove.fromLabel, saved.categoryMove.toCategory, saved.categoryMove.toLabel, typeof saved.categoryMove.sig] : null, ['소모품비', '카테고리 고아', '부식비', '카테고리 고아', 'string'])
    eq('카테고리: 저장만으로는 옛 카드를 안 지운다(같이 변경 답을 기다린다)', await has(id), true)
    const mv = saved.ok ? J(saved.categoryMove!) : null!
    eq("카테고리 '지출만': 위조 토큰(옛 품명 바꿔치기) 거부", await inv.retireCardAfterExpenseCategoryChange({ ...mv, fromLabel: '살아 있는 카드' }), { ok: false, error: INVALID })
    eq("카테고리 '지출만': 위조 토큰 뒤 무변경", [await has(id), await prisma.trackedItem.count({ where: { propertyId: P1, label: '살아 있는 카드' } })], [true, 1])
    const r = await inv.retireCardAfterExpenseCategoryChange(mv)
    eq("카테고리 '지출만': 옛 카테고리 카드 정리", [r.ok, r.ok && r.retiredCard?.item.id === id, await has(id)], [true, true, false])
    eq("카테고리 '지출만' 적용취소: 같은 id", [await inv.undoDeleteTrackedItem(J(r.ok ? r.retiredCard! : null!)), await has(id)], [{ ok: true }, true])
    // 그 사이 카테고리를 다시 바꿨으면 손대지 않는다(토큰의 저장 뒤 카테고리와 지금이 다르다)
    await fin.updateExpense(edit(e, { category: '폐기물 처리비' }))
    eq("카테고리 '지출만': 그 사이 다시 바꾼 지출이면 최신 아님으로 거부·무변경", [await inv.retireCardAfterExpenseCategoryChange(mv), await has(id)], [{ ok: false, error: INVALID }, true])
    eq('카테고리를 안 바꾼 저장은 토큰이 없다', ((r2 => r2.ok && !r2.categoryMove)(await fin.updateExpense(edit(e, { category: '폐기물 처리비', memo: '메모만' })))), true)

    // B2. 카테고리와 품명을 함께 바꾸고 '지출만'. 종전에는 새 품명으로 옛 카드를 찾다 못 찾았다.
    const both = await card('함께 옛 품명', '소모품비')
    const e2 = await exp('함께 옛 품명')
    const s2 = await fin.updateExpense(edit(e2, { category: '부식비', itemLabel: '함께 새 품명', qtyValue: '1', qtyUnit: '개' }))
    eq('카테고리+품명 저장: 토큰이 옛 품명과 새 품명을 함께 싣는다', s2.ok && s2.categoryMove ? [s2.categoryMove.fromLabel, s2.categoryMove.toLabel] : null, ['함께 옛 품명', '함께 새 품명'])
    const r2 = await inv.retireCardAfterExpenseCategoryChange(J(s2.ok ? s2.categoryMove! : null!))
    eq("카테고리+품명 '지출만': 옛 카드(옛 카테고리·옛 품명) 정리", [r2.ok, r2.ok && r2.retiredCard?.item.id === both, await has(both)], [true, true, false])

    // '같이 변경'. 옛 카드를 새 카테고리로 옮기며 이름도 새 품명으로 맞춘다(같은 id)
    const moving = await card('같이 옛 품명', '소모품비')
    const e3 = await exp('같이 옛 품명')
    const s3 = await fin.updateExpense(edit(e3, { category: '부식비', itemLabel: '같이 새 품명', qtyValue: '1', qtyUnit: '개' }))
    const m3 = s3.ok ? s3.categoryMove! : null!
    const y3 = await inv.syncTrackedItemCategory(J(m3))
    const c3 = await prisma.trackedItem.findUnique({ where: { id: moving } })
    eq("카테고리+품명 '같이 변경': 같은 카드가 새 카테고리·새 품명으로", [y3.ok && y3.moved, c3?.category, c3?.label], [true, '부식비', '같이 새 품명'])

    const kept = await card('카테고리 점검 있음', '소모품비')
    const e4 = await exp('카테고리 점검 있음')
    await prisma.stockCheck.create({ data: { trackedItemId: kept, date: new Date('2026-10-21T00:00:00Z'), remainingQty: 2 } })
    const s4 = await fin.updateExpense(edit(e4, { category: '부식비' }))
    const r4 = await inv.retireCardAfterExpenseCategoryChange(J(s4.ok ? s4.categoryMove! : null!))
    eq("카테고리 '지출만' 대조: 점검이 있는 카드는 그대로", [r4.ok, r4.ok && !r4.retiredCard, await has(kept)], [true, true, true])

    // 남의 영업장 토큰(그 영업장 세션에서 받은 것)은 이 영업장에서 못 쓴다
    const theirCard = await card('남의 카드', '소모품비', P2)
    const theirs = (await prisma.expense.create({ data: { propertyId: P2, date: new Date('2026-10-20T00:00:00Z'), amount: 5000, category: '소모품비', itemLabel: '남의 카드', qtyValue: 1, qtyUnit: '개' } })).id as string
    g.__CR_FLOW_PID = P2
    const st = await fin.updateExpense(edit(theirs, { category: '부식비' }))
    g.__CR_FLOW_PID = P1
    eq("카테고리 '지출만': 남의 영업장 토큰은 거부", await inv.retireCardAfterExpenseCategoryChange(J(st.ok ? st.categoryMove! : null!)), { ok: false, error: INVALID })
    eq("카테고리 '지출만': 남의 영업장 카드 무변경", await has(theirCard), true)

    // 손질한 카드(구매 링크·임계값 등)는 자동 정리하지 않는다(R5)
    const touched = (await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '손질 카드', purchaseUrl: 'https://example.com/x' } })).id as string
    const e5 = await exp('손질 카드')
    const s5 = await fin.updateExpense(edit(e5, { category: '부식비' }))
    const r5 = await inv.retireCardAfterExpenseCategoryChange(J(s5.ok ? s5.categoryMove! : null!))
    eq("카테고리 '지출만' 대조: 손질한 카드는 그대로(R5)", [r5.ok, r5.ok && !r5.retiredCard, await has(touched)], [true, true, true])
    const thr = (await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '임계값 카드', alertThresholdDays: 9 } })).id as string
    const e6 = await exp('임계값 카드')
    eq('제외 대조: 임계값을 바꾼 카드는 그대로(R5)', [(await inv.excludeExpenseFromInventory(e6)).ok, await has(thr)], [true, true])
    // 사용자 순서(sortOrder)는 손질 신호가 아니다. 끌어 저장하면 카테고리 전 카드에 붙는다(재검수 B-1). 정리되고 적용취소가 순서까지 되살린다.
    const ord = (await prisma.trackedItem.create({ data: { propertyId: P1, category: '소모품비', label: '순서만 있는 카드', sortOrder: 4 } })).id as string
    const e7 = await exp('순서만 있는 카드')
    const x7 = await inv.excludeExpenseFromInventory(e7)
    eq('제외: 사용자 순서만 있는 카드는 정리한다(B-1)', [x7.ok && x7.retiredCard?.item.id === ord, await has(ord)], [true, false])
    await inv.undoDeleteTrackedItem(J(x7.ok ? x7.retiredCard! : null!))
    eq('제외 적용취소: 순서까지 되살린다', (await prisma.trackedItem.findUnique({ where: { id: ord } }))?.sortOrder, 4)

    // 서명 키가 없으면(운영 설정 누락) 토큰은 서명 없이 나가고 물음은 뜬다. '지출만'은 카드를 안 건드리고 '같이 변경'은 돈다(재검수 5).
    const KEY = process.env.STAYEUM_PII_KEY
    delete process.env.STAYEUM_PII_KEY
    try {
      const nk = await card('키 없음 카드', '소모품비')
      const e8 = await exp('키 없음 카드')
      const s8 = await fin.updateExpense(edit(e8, { category: '부식비' }))
      eq('키 없음: 토큰은 서명 없이 나간다(물음은 뜬다)', s8.ok && s8.categoryMove ? [s8.categoryMove.fromLabel, s8.categoryMove.sig ?? null] : null, ['키 없음 카드', null])
      eq("키 없음: '지출만'은 카드를 안 건드린다", [await inv.retireCardAfterExpenseCategoryChange(J(s8.ok ? s8.categoryMove! : null!)), await has(nk)], [{ ok: true }, true])
      const y8 = await inv.syncTrackedItemCategory(J(s8.ok ? s8.categoryMove! : null!))
      eq("키 없음: '같이 변경'은 돈다", [y8.ok && y8.moved, (await prisma.trackedItem.findUnique({ where: { id: nk } }))?.category], [true, '부식비'])
    } finally { process.env.STAYEUM_PII_KEY = KEY }
    // 키가 있는데 서명이 빠진 토큰(날값 직접 호출)은 둘 다 거부한다(재검수 1)
    const raw = await card('날값 카드', '소모품비')
    const e9 = await exp('날값 카드')
    const s9 = await fin.updateExpense(edit(e9, { category: '부식비' }))
    const bare = { ...(s9.ok ? J(s9.categoryMove!) : null!) }; delete bare.sig
    eq("날값: '같이 변경' 거부", await inv.syncTrackedItemCategory(bare), { ok: false, error: INVALID })
    eq("날값: '지출만' 거부", await inv.retireCardAfterExpenseCategoryChange(bare), { ok: false, error: INVALID })
    eq('날값: 카드 무변경', [(await prisma.trackedItem.findUnique({ where: { id: raw } }))?.category], ['소모품비'])
  }

  // ── 4b. '같이 변경' 의 두 구멍(독립 검수 R8 b·d) ────────────────────────────────────
  {
    // b. 옮길 자리에 같은 이름 카드가 있으면 지출은 그 카드로 붙고, 고아가 된 옛 카드는 정리한다
    const old = await card('충돌 품목', '소모품비')
    const there = await card('충돌 품목', '부식비')
    const e = await exp('충돌 품목')
    const s1 = await fin.updateExpense(edit(e, { category: '부식비' }))
    const m = s1.ok ? s1.categoryMove! : null!
    const y = await inv.syncTrackedItemCategory(J(m))
    eq("'같이 변경' 충돌: 옛 카드가 고아면 정리(적용취소 토큰)", [y.ok, y.ok && y.retiredCard?.item.id === old, await has(old), await has(there)], [true, true, false, true])
    const kept = await card('충돌 기록', '소모품비')
    await card('충돌 기록', '부식비')
    const e2 = await exp('충돌 기록')
    await prisma.stockCheck.create({ data: { trackedItemId: kept, date: new Date('2026-10-21T00:00:00Z'), remainingQty: 1 } })
    const s2 = await fin.updateExpense(edit(e2, { category: '부식비' }))
    const m2 = s2.ok ? s2.categoryMove! : null!
    eq("'같이 변경' 충돌 대조: 기록이 있으면 종전대로 병합 안내", [(await inv.syncTrackedItemCategory(J(m2))).ok, await has(kept)], [false, true])

    // d. 비추적 대상(수선유지비)인데 옛 카테고리에 같은 품명의 다른 재고 구매가 남았으면 카드를 지우지 않는다
    const shared = await card('공유 품목', '소모품비')
    const e3 = await exp('공유 품목'); await exp('공유 품목')
    const s3 = await fin.updateExpense(edit(e3, { category: '수선유지비' }))
    const m3 = s3.ok ? s3.categoryMove! : null!
    const y3 = await inv.syncTrackedItemCategory(J(m3))
    eq("'같이 변경' 비추적: 다른 재고 구매가 남으면 카드 그대로(kept)", [y3.ok && y3.kept, y3.ok && y3.retired, await has(shared)], [true, undefined, true])
    const alone = await card('혼자 품목', '소모품비')
    const e4 = await exp('혼자 품목')
    const s4 = await fin.updateExpense(edit(e4, { category: '수선유지비' }))
    const m4 = s4.ok ? s4.categoryMove! : null!
    const y4 = await inv.syncTrackedItemCategory(J(m4))
    eq("'같이 변경' 비추적 대조: 남은 구매가 없으면 종전대로 정리", [y4.ok && y4.retired, await has(alone)], ['deleted', false])
  }

  // ── 4d. '같이 변경' 추적 분기에 같은 품명의 다른 재고 구매가 남았을 때(재검수 권고 2, 운영자 결정 대기 추천안) ───────────
  {
    const old = await card('나눔 품목', '소모품비')
    await prisma.trackedItem.update({ where: { id: old }, data: { specUnit: 'L', trackUnit: 'spec' } })
    const e = await exp('나눔 품목'); await exp('나눔 품목')
    const s1 = await fin.updateExpense(edit(e, { category: '부식비' }))
    const y = await inv.syncTrackedItemCategory(J(s1.ok ? s1.categoryMove! : null!))
    const made = await prisma.trackedItem.findFirst({ where: { propertyId: P1, category: '부식비', label: '나눔 품목' } })
    const oldRow = await prisma.trackedItem.findUnique({ where: { id: old } })
    eq('갈라 만들기: 옛 카드는 옛 카테고리·옛 이름 그대로', [oldRow?.category, oldRow?.label], ['소모품비', '나눔 품목'])
    eq('갈라 만들기: 새 카테고리에 카드를 새로 만들고 단위를 잇는다', [y.ok && y.moved, y.ok && !!y.split, !!made, made?.specUnit, made?.trackUnit], [false, true, true, 'L', 'spec'])
    eq('갈라 만들기: 위조 토큰(다른 카드 id) 거부', await inv.undoSplitCardMove({ ...(y.ok ? J(y.split!) : null!), cardId: old }), { ok: false, error: '적용취소 정보가 유효하지 않습니다.' })
    eq('갈라 만들기 적용취소: 새 카드만 지운다', [await inv.undoSplitCardMove(J(y.ok ? y.split! : null!)), await has(made!.id), await has(old)], [{ ok: true }, false, true])
    // 같은 이름 카드가 새 카테고리에 이미 있으면 만들지 않고 그대로 둔다
    const old2 = await card('나눔 있음', '소모품비'); const there = await card('나눔 있음', '부식비')
    const e2 = await exp('나눔 있음'); await exp('나눔 있음')
    const s2 = await fin.updateExpense(edit(e2, { category: '부식비' }))
    const y2 = await inv.syncTrackedItemCategory(J(s2.ok ? s2.categoryMove! : null!))
    eq('갈라 만들기 대조: 새 카테고리에 같은 이름 카드가 있으면 kept', [y2.ok && y2.kept, await has(old2), await has(there), await prisma.trackedItem.count({ where: { propertyId: P1, label: '나눔 있음' } })], [true, true, true, 2])
  }

  // ── 4c. 품명 통합(mergeItemNames) 충돌 분기(R8 a)와 엑셀 가져오기 교체(R6) ───────────────────────
  {
    const oldId = await card('통합 옛이름')
    const canonId = await card('통합 대표')
    await exp('통합 옛이름'); await exp('통합 대표')
    eq('품명 통합 저장', await fin.mergeItemNames('통합 대표', ['통합 옛이름']), { ok: true })
    eq('품명 통합 충돌: 대표 카드가 있어 개명 못 한 옛 카드는 고아라 정리', [await has(oldId), await has(canonId)], [false, true])
    const run = await prisma.itemNameMergeRun.findFirst({ where: { propertyId: P1, canonical: '통합 대표' }, orderBy: { createdAt: 'desc' } })
    eq('품명 통합 적용취소', await fin.undoItemNameMerge(run!.id), { ok: true })
    eq('품명 통합 적용취소: 옛 카드 같은 id·지출도 옛 이름', [await has(oldId), await prisma.expense.count({ where: { propertyId: P1, itemLabel: '통합 옛이름' } })], [true, 1])

    const imp = await card('가져오기 교체')
    const e = await exp('가져오기 교체')
    const d = await fin.deleteExpense(e, { keepOrphanCard: true })
    eq('가져오기 교체(keepOrphanCard): 적용취소 길이 없으니 카드를 안 지운다(R6)', [d.ok, d.ok && !d.retiredCard, await has(imp)], [true, true, true])
  }

  // ── 5. 다품목으로 나누며 원래 품목 줄 빼기 ─────────────────────────────────────────
  {
    const id = await card('다품목 옛것')
    const e = await exp('다품목 옛것')
    const itemsJson = JSON.stringify([
      { label: '다품목 갑', qtyValue: '1', qtyUnit: '개', amount: 3000 },
      { label: '다품목 을', qtyValue: '1', qtyUnit: '개', amount: 2000 },
    ])
    const r = await fin.updateExpense(edit(e, { itemsJson }))
    eq('다품목: 원래 줄을 빼고 나누면 옛 카드 정리', [r.ok, r.ok && r.retiredCard?.item.id === id, await has(id)], [true, true, false])
    eq('다품목 적용취소: 같은 id', [await inv.undoDeleteTrackedItem(J(r.ok ? r.retiredCard! : null!)), await has(id)], [{ ok: true }, true])

    const kept = await card('다품목 남김')
    const e2 = await exp('다품목 남김')
    const keepJson = JSON.stringify([
      { label: '다품목 병', qtyValue: '1', qtyUnit: '개', amount: 3000 },
      { label: '다품목 남김', qtyValue: '1', qtyUnit: '개', amount: 2000 },
    ])
    const r2 = await fin.updateExpense(edit(e2, { itemsJson: keepJson }))
    eq('다품목 대조: 원래 품명이 다른 줄로 남으면 그대로', [r2.ok, r2.ok && !r2.retiredCard, await has(kept)], [true, true, true])
  }

  console.log(`[고아 재고 카드 정리 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
