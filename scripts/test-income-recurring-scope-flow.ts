// 기타수익·고정지출 쓰기의 영업장 범위 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-income-recurring-scope-flow.ts
//
// 왜 통합인가(2026-10-23 운영자 승인, loop.md 4번 권한). updateExtraIncome·updateRecurringExpense 와 형제 쓰기(삭제·복원·기록·
// 예약 금액·묶기 해제)가 화면에서 온 id 만으로 써서 다른 영업장 행을 바꿀 수 있었다. 정적 감지망(check-action-property-scope)은
// where 글자만 본다. 남의 영업장 id 를 넣으면 실제로 거절되고 그 행이 한 바이트도 안 바뀌는지, 제 영업장 행은 그대로 되는지는
// 실제 쓰기를 돌려야 보인다. 대역·운영 DB 차단은 비품 전환 하네스(scripts/test-durable-convert-flow.ts)와 같은 판이다.
// 고정지출 결제 수단·거래처·메모 비우기(2026-10-23 운영자 승인)도 여기서 돈다. 비운 칸은 null 로 지우고 안 실린 칸은 그대로 둔다.
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
    eq('남의 영업장 고정지출 묶기 해제 거부', await settings.ungroupRecurringExpense(theirs), { ok: false, error: RECURRING_GONE })
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

  // ── 폼에서 받는 연결 id(결제 계정·입주자·계약). 남의 영업장 id 는 거절, 빈 값은 허용 ──
  {
    const account = async (pid: string) => (await prisma.financialAccount.create({ data: { propertyId: pid, type: 'BANK_ACCOUNT', brand: '하네스은행' } })).id as string
    const tenantIn = async (pid: string) => (await prisma.tenant.create({ data: { propertyId: pid, name: '가' } })).id as string
    const leaseOf = async (pid: string, tenantId: string) => (await prisma.leaseTerm.create({ data: { propertyId: pid, tenantId, status: 'ACTIVE' as never } })).id as string
    const A1 = await account(P1), A2 = await account(P2)
    const T1 = await tenantIn(P1), T2 = await tenantIn(P2)
    const L1 = await leaseOf(P1, T1), L2 = await leaseOf(P2, T2)
    const base = { date: '2026-10-06', amount: '3000', category: '기타 임대수입' }
    const incomeCount = async () => prisma.extraIncome.count({ where: { propertyId: P1 } })

    const n0 = await incomeCount()
    eq('수익 등록: 남의 계좌 거절', await fin.addExtraIncome(fd({ ...base, financialAccountId: A2 })), { ok: false, error: '결제 계정을 찾을 수 없습니다.' })
    eq('수익 등록: 남의 입주자 거절', await fin.addExtraIncome(fd({ ...base, tenantId: T2 })), { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('수익 등록: 남의 계약 거절', await fin.addExtraIncome(fd({ ...base, leaseTermId: L2 })), { ok: false, error: '계약 정보를 찾을 수 없습니다.' })
    eq('수익 등록: 남의 계약 + 내 입주자도 거절', await fin.addExtraIncome(fd({ ...base, leaseTermId: L2, tenantId: T1 })), { ok: false, error: '계약 정보를 찾을 수 없습니다.' })
    eq('수익 등록 거절 뒤 행이 안 생긴다', await incomeCount(), n0)

    const ok = await fin.addExtraIncome(fd({ ...base, financialAccountId: A1, leaseTermId: L1 }))
    eq('수익 등록: 제 영업장 계좌·계약 통과', ok.ok, true)
    const id = ok.ok ? ok.id : ''
    const linked = await prisma.extraIncome.findUnique({ where: { id }, select: { financialAccountId: true, tenantId: true, leaseTermId: true } })
    eq('수익 등록: 계약에서 입주자 보충', linked, { financialAccountId: A1, tenantId: T1, leaseTermId: L1 })
    eq('수익 등록: 빈 값 허용', (await fin.addExtraIncome(fd({ ...base, financialAccountId: '', leaseTermId: '', tenantId: '' }))).ok, true)

    const before = await incomeRow(id)
    const edit = (o: Record<string, string>) => fd({ id, ...base, financialAccountId: A1, leaseTermId: L1, ...o })
    eq('수익 수정: 남의 계좌 거절', await fin.updateExtraIncome(edit({ financialAccountId: A2 })), { ok: false, error: '결제 계정을 찾을 수 없습니다.' })
    eq('수익 수정: 남의 입주자 거절', await fin.updateExtraIncome(edit({ leaseTermId: '', tenantId: T2 })), { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('수익 수정: 남의 계약 거절', await fin.updateExtraIncome(edit({ leaseTermId: L2 })), { ok: false, error: '계약 정보를 찾을 수 없습니다.' })
    eq('수익 수정 거절 뒤 무변경', await incomeRow(id), before)
    eq('수익 수정: 연결 해제(빈 값) 허용', await fin.updateExtraIncome(edit({ financialAccountId: '', leaseTermId: '', tenantId: '' })), { ok: true })

    const recCount = async () => prisma.recurringExpense.count({ where: { propertyId: P1 } })
    const r0 = await recCount()
    const recBase = { title: '하네스 통신비', amount: 20000, category: '공과금', dueDay: 5 }
    eq('고정지출 등록: 남의 계좌 거절', await settings.addRecurringExpense({ ...recBase, financialAccountId: A2 }), { ok: false, error: '결제 계정을 찾을 수 없습니다.' })
    eq('고정지출 등록 거절 뒤 행이 안 생긴다', await recCount(), r0)
    const rec = await settings.addRecurringExpense({ ...recBase, financialAccountId: A1 })
    eq('고정지출 등록: 제 영업장 계좌 통과', rec.ok, true)
    const recId = rec.ok ? rec.id : ''
    const recBefore = await recurringRow(recId)
    eq('고정지출 수정: 남의 계좌 거절', await settings.updateRecurringExpense(recId, { financialAccountId: A2 }), { ok: false, error: '결제 계정을 찾을 수 없습니다.' })
    eq('고정지출 수정 거절 뒤 무변경', await recurringRow(recId), recBefore)
    eq('고정지출 수정: 계좌 지정 해제(null) 허용', await settings.updateRecurringExpense(recId, { financialAccountId: null }), { ok: true })

    const src = await recurring(P1, '묶을 원본')
    const r1 = await recCount()
    eq('고정지출 묶기: 남의 계좌 거절', await settings.groupRecurringExpenses({ title: '묶음', category: '공과금', dueDay: 5, financialAccountId: A2, sourceIds: [src] }),
      { ok: false, error: '결제 계정을 찾을 수 없습니다.' })
    eq('고정지출 묶기 거절 뒤 부모가 안 생기고 원본 활성 유지', [await recCount(), (await prisma.recurringExpense.findUnique({ where: { id: src } }))?.isActive], [r1, true])
    eq('고정지출 묶기: 제 영업장 계좌 통과', (await settings.groupRecurringExpenses({ title: '묶음', category: '공과금', dueDay: 5, financialAccountId: A1, sourceIds: [src] })).ok, true)

    // ── 독립 검수 재현 3건(2026-10-23): 화면 객체에 허용 밖 키를 실어 보낸다. 거절되거나 무시되고 행이 안 바뀐다 ──
    // 재현마다 대상을 따로 둔다. 하나가 뚫려 행이 옮겨 가도 다음 재현이 '못 찾음'으로 덮여 가려지지 않게.
    const E2 = (await prisma.expense.create({ data: { propertyId: P2, date: new Date('2026-10-01T00:00:00Z'), amount: 1000, category: '공과금' } })).id as string
    // updatedAt 은 빈 수정에도 움직이므로 뺀 나머지를 바이트로 견준다.
    const stable = async (id: string) => { const r = JSON.parse(await recurringRow(id)); delete r.rec.updatedAt; return JSON.stringify(r) }
    const p2Count = async () => prisma.recurringExpense.count({ where: { propertyId: P2 } })
    const p2Before = await p2Count()

    const t1 = await recurring(P1, '재현 1 대상'), t1Before = await stable(t1)
    await settings.updateRecurringExpense(t1, { propertyId: P2 } as never)
    eq('재현 1 수정: propertyId 주입이 무시되고 행 무변경', await stable(t1), t1Before)
    const injected = await settings.addRecurringExpense({ ...recBase, propertyId: P2 } as never)
    eq('재현 1 등록: propertyId 주입이 무시되고 제 영업장에 선다',
      [injected.ok, injected.ok ? (await prisma.recurringExpense.findUnique({ where: { id: injected.id } }))?.propertyId : null, await p2Count()], [true, P1, p2Before])

    const t2 = await recurring(P1, '재현 2 대상'), t2Before = await stable(t2)
    await settings.updateRecurringExpense(t2, { expenses: { connect: [{ id: E2 }] } } as never)
    eq('재현 2: expenses connect 가 무시되고 남의 지출이 안 붙는다', (await prisma.expense.findUnique({ where: { id: E2 } }))?.recurringExpenseId, null)
    eq('재현 2: 행 무변경', await stable(t2), t2Before)

    const t3 = await recurring(P1, '재현 3 대상'), t3Before = await stable(t3)
    await settings.updateRecurringExpense(t3, { financialAccount: { connect: { id: A2 } } } as never)
    eq('재현 3: financialAccount connect 가 무시되고 남의 계좌가 안 붙는다', await stable(t3), t3Before)
    eq('재현 3 변형: 연산 객체({ set })로 계좌를 넣으면 거절',
      await settings.updateRecurringExpense(t3, { financialAccountId: { set: A2 } } as never), { ok: false, error: '고정 지출 입력값이 올바르지 않습니다.' })
    eq('재현 3 변형 뒤 무변경', await stable(t3), t3Before)
  }

  // ── 고정지출 결제 수단·거래처·메모 비우기(2026-10-23 운영자 승인) ──
  // 두 폼이 비운 칸을 `|| undefined` 로 실어 서버가 '안 실려 옴(그대로 둠)'으로 읽었고, 한 번 적은 값을 지울 길이 없었다.
  // 비운 칸은 null 로 실어 지우고, 안 실린 칸은 그대로 둔다. 재무 폼은 2026-10-27 까지 거래처 칸이 없어 거래처를 안 실었다(지금은 칸이 있어 지금 값을 싣는다).
  {
    const three = async (id: string) => {
      const r = await prisma.recurringExpense.findUnique({ where: { id }, select: { payMethod: true, vendor: true, memo: true } })
      return [r?.payMethod, r?.vendor, r?.memo]
    }
    const full = { payMethod: '계좌이체', vendor: '한국전력', memo: '매달 10일 자동이체' }

    const c = await recurring(P1, '비우기 대상')
    eq('비우기: 세 칸 적기', await settings.updateRecurringExpense(c, full), { ok: true })
    eq('비우기: 세 칸 적힘', await three(c), ['계좌이체', '한국전력', '매달 10일 자동이체'])
    eq('비우기: 결제 수단 null', await settings.updateRecurringExpense(c, { payMethod: null }), { ok: true })
    eq('비우기: 결제 수단만 지워지고 둘은 그대로', await three(c), [null, '한국전력', '매달 10일 자동이체'])
    eq('비우기: 거래처 null', await settings.updateRecurringExpense(c, { vendor: null }), { ok: true })
    eq('비우기: 거래처만 지워지고 메모는 그대로', await three(c), [null, null, '매달 10일 자동이체'])
    eq('비우기: 메모 null', await settings.updateRecurringExpense(c, { memo: null }), { ok: true })
    eq('비우기: 세 칸 모두 지워짐', await three(c), [null, null, null])

    // 거래처를 안 싣고 결제 수단·메모를 비운 저장은 환경설정에서 적은 거래처를 지우지 않는다(부재 보존).
    // 재무 폼은 2026-10-27(신고 5fa9cf43)부터 구매처 칸이 있어 지금 값을 채워 열고 싣는다. 서버의 부재 보존은 그대로 지킨다.
    const f = await recurring(P1, '재무 폼 대상')
    await settings.updateRecurringExpense(f, full)
    eq('거래처 안 실린 저장 통과', await settings.updateRecurringExpense(f, { title: '재무 폼 대상 2', payMethod: null, memo: null, financialAccountId: null }), { ok: true })
    eq('거래처 안 실린 저장: 거래처는 그대로, 둘은 지워짐', await three(f), [null, '한국전력', null])
    eq('안 실린 칸(undefined)은 그대로 둔다', await settings.updateRecurringExpense(f, { payMethod: undefined, vendor: undefined, memo: undefined, title: '재무 폼 대상 3' }), { ok: true })
    eq('안 실린 칸 뒤 무변경', await three(f), [null, '한국전력', null])

    // 등록도 비운 칸을 null 로 받는다(두 폼이 등록·수정에 같은 객체를 넘긴다).
    const added = await settings.addRecurringExpense({ title: '비운 등록', amount: 1000, category: '공과금', dueDay: 5, payMethod: null, vendor: null, memo: null })
    eq('등록: 비운 칸 null 통과', added.ok, true)
    eq('등록: 세 칸 null', added.ok ? await three(added.id) : null, [null, null, null])

    // 화면 짝(정적). 서버가 null 을 받아도 폼이 undefined 를 실으면 다시 못 지운다.
    const { readFileSync } = await import('node:fs')
    const handler = (file: string, fn: string) => readFileSync(path.join(ROOT, file), 'utf8').match(new RegExp(`\\n  const ${fn} = \\(\\) => \\{[\\s\\S]*?\\n  \\}\\n`))?.[0] ?? ''
    const sf = handler('app/(app)/settings/SettingsForm.tsx', 'handleSaveRec')
    const ff = handler('app/(app)/finance/FinanceClient.tsx', 'handleSaveRecMgmt')
    eq('화면 짝: 환경설정 폼이 비운 결제 수단·거래처·메모를 null 로 싣는다',
      [/payMethod: recForm\.payMethod \|\| null,/.test(sf), /vendor: recForm\.vendor\.trim\(\) \|\| null,/.test(sf), /memo: recForm\.memo \|\| null,/.test(sf)], [true, true, true])
    eq('화면 짝: 재무 폼이 비운 결제 수단·구매처·메모를 null 로 싣는다(신고 5fa9cf43, 구매처 칸 신설)',
      [/payMethod: recMgmtForm\.payMethod \|\| null,/.test(ff), /vendor: recMgmtForm\.vendor\.trim\(\) \|\| null,/.test(ff), /memo: recMgmtForm\.memo \|\| null,/.test(ff)], [true, true, true])
  }

  console.log(`[기타수익·고정지출 영업장 범위 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
