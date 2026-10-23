// 기타수익·고정지출 쓰기의 영업장 범위 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-income-recurring-scope-flow.ts
//
// 왜 통합인가(2026-10-23 운영자 승인, loop.md 4번 권한). updateExtraIncome·updateRecurringExpense 와 형제 쓰기(삭제·복원·기록·
// 예약 금액·묶기 해제)가 화면에서 온 id 만으로 써서 다른 영업장 행을 바꿀 수 있었다. 정적 감지망(check-action-property-scope)은
// where 글자만 본다. 남의 영업장 id 를 넣으면 실제로 거절되고 그 행이 한 바이트도 안 바뀌는지, 제 영업장 행은 그대로 되는지는
// 실제 쓰기를 돌려야 보인다. 대역·운영 DB 차단은 비품 전환 하네스(scripts/test-durable-convert-flow.ts)와 같은 판이다.
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

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  // 외래키는 뺀다(부모 없는 대역 행을 만든다).
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

const INCOME_GONE = '수익 기록을 찾을 수 없습니다.'
const RECURRING_GONE = '고정 지출 항목을 찾을 수 없습니다.'

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const fin = await import('@/app/(app)/finance/actions')
  const settings = await import('@/app/(app)/settings/actions')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const income = async (pid: string) => (await prisma.extraIncome.create({ data: { propertyId: pid, date: new Date('2026-10-01T00:00:00Z'), amount: 5000, category: '기타 임대수입' } })).id as string
  // 소프트삭제분도 봐야 하므로 findUnique(자동필터 밖)로 행 전체를 바이트로 뜬다.
  const incomeRow = async (id: string) => JSON.stringify(await prisma.extraIncome.findUnique({ where: { id } }))
  const recurring = async (pid: string, title: string) => (await prisma.recurringExpense.create({
    data: { propertyId: pid, title, amount: 30000, category: '공과금', dueDay: 10, items: { create: [{ name: '전기', amount: 30000 }] } },
  })).id as string
  const recurringRow = async (id: string) => JSON.stringify({
    rec: await prisma.recurringExpense.findUnique({ where: { id } }),
    items: await prisma.recurringExpenseItem.findMany({ where: { recurringExpenseId: id }, orderBy: { id: 'asc' } }),
  })

  // ── 기타수익 ──
  {
    const mine = await income(P1), theirs = await income(P2)
    const before = await incomeRow(theirs)
    const edit = (id: string) => fd({ id, date: '2026-10-05', amount: '7000', category: '기타 임대수입' })

    eq('남의 영업장 수익 수정 거부', await fin.updateExtraIncome(edit(theirs)), { ok: false, error: INCOME_GONE })
    eq('남의 영업장 수익 수정 뒤 무변경', await incomeRow(theirs), before)

    let thrown = ''
    try { await fin.deleteExtraIncome(theirs) } catch (e) { thrown = (e as Error).message }
    eq('남의 영업장 수익 삭제 거부', thrown, INCOME_GONE)
    eq('남의 영업장 수익 삭제 뒤 무변경', await incomeRow(theirs), before)

    // 적용취소 경로. 남의 영업장에서 지운 행을 내 화면에서 되살릴 수 없다.
    await prisma.extraIncome.update({ where: { id: theirs }, data: { deletedAt: new Date('2026-10-02T00:00:00Z') } })
    const deletedBefore = await incomeRow(theirs)
    eq('남의 영업장 수익 복원 거부', await fin.restoreExtraIncome(theirs), { ok: false, error: INCOME_GONE })
    eq('남의 영업장 수익 복원 뒤 무변경', await incomeRow(theirs), deletedBefore)

    // 대조군: 제 영업장 행은 그대로 된다.
    eq('제 영업장 수익 수정 통과', await fin.updateExtraIncome(edit(mine)), { ok: true })
    eq('제 영업장 수익 금액 반영', (await prisma.extraIncome.findUnique({ where: { id: mine } }))?.amount, 7000)
    await fin.deleteExtraIncome(mine)
    eq('제 영업장 수익 삭제 반영', (await prisma.extraIncome.findUnique({ where: { id: mine } }))?.deletedAt != null, true)
    eq('제 영업장 수익 복원 통과', await fin.restoreExtraIncome(mine), { ok: true })
    eq('제 영업장 수익 복원 반영', (await prisma.extraIncome.findUnique({ where: { id: mine } }))?.deletedAt, null)
  }

  // ── 고정지출 ──
  {
    const mine = await recurring(P1, '내 관리비'), theirs = await recurring(P2, '남 관리비')
    const before = await recurringRow(theirs)
    const expenseCount = async () => prisma.expense.count({ where: { recurringExpenseId: theirs } })

    eq('남의 영업장 고정지출 수정 거부', await settings.updateRecurringExpense(theirs, { title: '바꿈', items: [{ name: '가스', amount: 1, isVariable: false }] }),
      { ok: false, error: RECURRING_GONE })
    eq('남의 영업장 고정지출 활성 토글 거부', await settings.updateRecurringExpense(theirs, { isActive: false }), { ok: false, error: RECURRING_GONE })
    eq('남의 영업장 고정지출 예약 금액 거부', await fin.setRecurringPendingAmount({ recurringExpenseId: theirs, amount: 1000 }), { ok: false, error: RECURRING_GONE })
    eq('남의 영업장 고정지출 예약 해제 거부', await fin.clearRecurringPendingAmount({ recurringExpenseId: theirs }), { ok: false, error: RECURRING_GONE })
    eq('남의 영업장 고정지출 기록 거부', await fin.recordRecurringExpense({ recurringExpenseId: theirs, amount: 30000, date: '2026-10-10' }),
      { ok: false, error: RECURRING_GONE })
    eq('남의 영업장 고정지출에 내 지출이 안 이어진다', await expenseCount(), 0)
    eq('남의 영업장 고정지출 묶기 해제 거부', (await settings.ungroupRecurringExpense(theirs)).ok, false)
    eq('남의 영업장 고정지출 삭제 거부', await settings.deleteRecurringExpense(theirs), { ok: false, error: RECURRING_GONE })
    eq('남의 영업장 고정지출·세부항목 무변경', await recurringRow(theirs), before)

    // 대조군: 제 영업장 항목은 그대로 된다.
    eq('제 영업장 고정지출 수정 통과', await settings.updateRecurringExpense(mine, { title: '내 관리비 2', items: [{ name: '가스', amount: 12000, isVariable: false }] }), { ok: true })
    const mineAfter = JSON.parse(await recurringRow(mine))
    eq('제 영업장 고정지출 수정 반영', [mineAfter.rec.title, mineAfter.rec.amount, mineAfter.items.map((i: { name: string }) => i.name)], ['내 관리비 2', 12000, ['가스']])
    eq('제 영업장 예약 금액 통과', await fin.setRecurringPendingAmount({ recurringExpenseId: mine, amount: 9000 }), { ok: true })
    eq('제 영업장 고정지출 기록 통과', await fin.recordRecurringExpense({ recurringExpenseId: mine, amount: 12000, date: '2026-10-10' }), { ok: true })
    eq('제 영업장 기록이 예약 금액을 푼다', (await prisma.recurringExpense.findUnique({ where: { id: mine } }))?.pendingAmount, null)
    eq('제 영업장 고정지출 삭제 통과', await settings.deleteRecurringExpense(mine), { ok: true })
    eq('제 영업장 고정지출 삭제 반영', await prisma.recurringExpense.count({ where: { id: mine } }), 0)
    eq('삭제 대조군 뒤에도 남의 항목 무변경', await recurringRow(theirs), before)
  }

  console.log(`[기타수익·고정지출 영업장 범위 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
