// 결제수단 빈 지출에 운영자가 확인한 결제수단을 채우는 백필(예행 기본, --apply 조건부 쓰기, --revert 되돌림). 2026-10-27 승인 계획 결정 4.
//
// 왜. 작업·청소 완료가 지출을 만들 때 결제수단을 안 적던 시절의 행이 남아 있다(운영 실측 결제수단 빈 지출 9건: 청소 5, 수선유지비 4 중 작업 2).
// 1단계(완료 폼이 결제수단을 묻는다) 배포 뒤 운영자에게 목록(날짜·업체·금액)을 보여 실제 수단을 확인받고, 그 답을 이 스크립트로 채운다.
// 앱이 수단을 짐작해 채우지 않는다(데이터 땜빵 금지). 값은 운영자 답 그대로다.
//
// 정산상태는 정산완료(SETTLED)로 고정한다. 아홉 건 모두 이미 정산완료이고 이미 빠져나간 돈이다. 신용카드로 채워도 미정산으로 되살리면
// 카드 정산 화면에 다시 올라가 이중 정산을 부른다(lib/settleStatus 머리말의 그 사고).
//
//   목록(예행):  npx tsx --env-file=.env.local scripts/backfill-expense-paymethod.ts
//   계획 확인:   npx tsx --env-file=.env.local scripts/backfill-expense-paymethod.ts --map=<답 파일.json>
//   적용:        npx tsx --env-file=.env.local scripts/backfill-expense-paymethod.ts --map=<답 파일.json> --apply --log=<기록 파일.json>
//   되돌림:      npx tsx --env-file=.env.local scripts/backfill-expense-paymethod.ts --revert --log=<기록 파일.json>
//
// 답 파일 모양: [{ "id": "<지출 id>", "payMethod": "계좌이체", "financialAccountId": "<결제 계정 id 또는 null>" }]
// 지출 id 는 목록 모드가 찍는다. 답 파일·기록 파일은 저장소 밖에 둔다(공개 저장소).
//
// 쓰기는 한 트랜잭션이고 조건부다. 적용은 지금도 결제수단이 비어 있는 행만, 되돌림은 지금도 적용한 값 그대로인 행만 고친다.
// 한 건이라도 어긋나면 전부 안 쓴다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const arg = (k: string) => process.argv.find(a => a.startsWith(`--${k}=`))?.slice(k.length + 3) ?? null
const APPLY = process.argv.includes('--apply')
const REVERT = process.argv.includes('--revert')
const MAP = arg('map')
const LOG = arg('log')
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Answer = { id: string; payMethod: string; financialAccountId: string | null }
type PaySnap = { payMethod: string | null; financialAccountId: string | null; financeName: string | null; settleStatus: 'SETTLED' | 'UNSETTLED' }
type LogRow = { id: string; before: PaySnap; after: PaySnap }

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })
const ymd = (d: Date) => d.toISOString().slice(0, 10)
const accName = (a: { brand: string; alias: string | null }) => (a.alias ? `${a.brand} (${a.alias})` : a.brand)

function readAnswers(path: string): Answer[] {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!Array.isArray(raw) || raw.length === 0) throw new Error('답 파일이 비었거나 배열이 아니다')
  const seen = new Set<string>()
  return raw.map((r, i) => {
    const o = r as Record<string, unknown>
    if (typeof o.id !== 'string' || !UUID.test(o.id) || seen.has(o.id)) throw new Error(`답 ${i + 1}번째의 id 가 올바르지 않거나 겹친다`)
    if (typeof o.payMethod !== 'string' || !o.payMethod.trim()) throw new Error(`답 ${i + 1}번째의 payMethod 가 비었다`)
    const acc = o.financialAccountId ?? null
    if (acc !== null && (typeof acc !== 'string' || !UUID.test(acc))) throw new Error(`답 ${i + 1}번째의 financialAccountId 가 올바르지 않다`)
    seen.add(o.id)
    return { id: o.id, payMethod: o.payMethod.trim(), financialAccountId: acc as string | null }
  })
}

async function list() {
  const cleaningIds = new Set((await prisma.roomCleaning.findMany({ where: { expenseId: { not: null } }, select: { expenseId: true } })).map(c => c.expenseId as string))
  const rows = await prisma.expense.findMany({
    where: { payMethod: null },
    orderBy: [{ date: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, date: true, amount: true, category: true, vendor: true, roomWorkId: true, settleStatus: true, room: { select: { roomNo: true } }, property: { select: { name: true } } },
  })
  for (const r of rows) {
    const link = r.roomWorkId ? '작업' : cleaningIds.has(r.id) ? '청소' : '연결 없음'
    console.log(`${r.id}  ${r.property.name} · ${r.room?.roomNo ?? '-'}호 · ${ymd(r.date)} · ${r.amount.toLocaleString('ko-KR')}원 · ${r.category} · ${r.vendor ?? '(업체 없음)'} · ${link} · ${r.settleStatus}`)
  }
  console.log(`\n결제수단 빈 지출 ${rows.length}건. 운영자 답을 답 파일로 적어 --map 으로 계획을 확인한다(쓰기 없음).`)
}

async function plan(answers: Answer[]) {
  const out: LogRow[] = []
  for (const a of answers) {
    const e = await prisma.expense.findFirst({ where: { id: a.id }, select: { propertyId: true, payMethod: true, financialAccountId: true, financeName: true, settleStatus: true, date: true, amount: true, vendor: true } })
    if (!e) throw new Error(`지출 ${a.id} 가 없다`)
    if (e.payMethod !== null) throw new Error(`지출 ${a.id} 는 이미 결제수단이 있다(${e.payMethod}). 답 파일을 다시 확인할 것`)
    let financeName: string | null = null
    if (a.financialAccountId) {
      const acc = await prisma.financialAccount.findFirst({ where: { id: a.financialAccountId, propertyId: e.propertyId }, select: { brand: true, alias: true } })
      if (!acc) throw new Error(`지출 ${a.id} 의 결제 계정이 그 영업장 것이 아니다`)
      financeName = accName(acc)
    }
    const before: PaySnap = { payMethod: null, financialAccountId: e.financialAccountId, financeName: e.financeName, settleStatus: e.settleStatus }
    const after: PaySnap = { payMethod: a.payMethod, financialAccountId: a.financialAccountId, financeName, settleStatus: 'SETTLED' }
    console.log(`${ymd(e.date)} · ${e.amount.toLocaleString('ko-KR')}원 · ${e.vendor ?? '(업체 없음)'}  결제수단 (없음) → ${a.payMethod}${financeName ? ` · ${financeName}` : ''} · 정산완료`)
    out.push({ id: a.id, before, after })
  }
  return out
}

async function apply(rows: LogRow[], logPath: string) {
  if (existsSync(logPath)) throw new Error(`기록 파일 ${logPath} 가 이미 있다. 덮어쓰지 않는다`)
  await prisma.$transaction(async tx => {
    for (const r of rows) {
      const res = await tx.expense.updateMany({ where: { id: r.id, payMethod: null }, data: r.after })
      if (res.count !== 1) throw new Error(`지출 ${r.id} 가 그사이 바뀌었다. 전부 안 쓴다`)
    }
  })
  writeFileSync(logPath, JSON.stringify(rows, null, 2))
  console.log(`\n적용 ${rows.length}건. 되돌림 기록 ${logPath}`)
}

async function revert(logPath: string) {
  const rows = JSON.parse(readFileSync(logPath, 'utf8')) as LogRow[]
  if (!Array.isArray(rows) || rows.some(r => typeof r?.id !== 'string' || !UUID.test(r.id) || !r.after || !r.before)) throw new Error('기록 파일 모양이 올바르지 않다')
  await prisma.$transaction(async tx => {
    for (const r of rows) {
      const res = await tx.expense.updateMany({
        where: { id: r.id, payMethod: r.after.payMethod, financialAccountId: r.after.financialAccountId, financeName: r.after.financeName, settleStatus: r.after.settleStatus },
        data: r.before,
      })
      if (res.count !== 1) throw new Error(`지출 ${r.id} 가 적용 뒤 다시 바뀌었다. 전부 안 되돌린다`)
    }
  })
  console.log(`되돌림 ${rows.length}건`)
}

async function main() {
  if (REVERT) {
    if (!LOG) throw new Error('--revert 는 --log=<기록 파일> 이 필요하다')
    await revert(LOG)
    return
  }
  if (!MAP) { await list(); return }
  const rows = await plan(readAnswers(MAP))
  if (!APPLY) { console.log(`\n예행 ${rows.length}건. 적용하려면 --apply --log=<기록 파일> 을 붙인다.`); return }
  if (!LOG) throw new Error('--apply 는 --log=<기록 파일> 이 필요하다(되돌림에 쓴다)')
  await apply(rows, LOG)
}

main()
  .catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
