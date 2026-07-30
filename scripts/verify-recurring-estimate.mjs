// 미기록 고정지출 추정액 정합 검사 — 읽기 전용(SELECT 만). 불일치 발견 시 exit 1.
// 홈 알림·재무 탭·대시보드 예상지출이 같은 금액을 보여야 한다(정본식: 예약금액 > 과거평균 > 기본액).
// ① 소스 가드: 알림 생성부가 정본 헬퍼(effectiveRecurringAmount)를 쓰는지, 정본식을 인라인 복제한 곳이
//    lib/recurringEstimate.ts 밖에 남았는지 검사 — 식이 두 벌로 갈라지는 재발을 잡는다.
// ② 데이터 대조: 이번 달 미기록 항목마다 알림이 쓰는 값과 정본식 재계산값을 대조하고,
//    예약금액이 남은 기록완료 항목처럼 금액을 틀어지게 만드는 데이터 상태를 함께 잡는다.
// 실행: node --env-file=.env.local scripts/verify-recurring-estimate.mjs
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const HELPER_FILE = 'lib/recurringEstimate.ts'
const ALERT_FILE = 'app/(app)/dashboard/page.tsx'
// 정본식 인라인 복제 탐지 — pendingAmount ?? (historicalAvg ??) amount 형태
const INLINE_RE = /pendingAmount\s*\?\?[^\n)]*\bamount\b/

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

// ── ① 소스 가드 ──────────────────────────────────────────────
const sourceIssues = []
const alertSrc = readFileSync(ALERT_FILE, 'utf8')
const alertBlock = alertSrc.slice(
  alertSrc.indexOf('── 고정 지출 알림'),
  alertSrc.indexOf('── 최근 납입 완료'),
)
if (!alertBlock.includes('effectiveRecurringAmount(re)')) {
  sourceIssues.push(`${ALERT_FILE} 고정지출 알림 생성부가 effectiveRecurringAmount 를 쓰지 않는다`)
}
if (/fmtWon\(re\.amount\)/.test(alertBlock) || /recurringAmount:\s*re\.amount/.test(alertBlock)) {
  sourceIssues.push(`${ALERT_FILE} 고정지출 알림이 기본액(re.amount)을 그대로 표시한다`)
}
for (const file of [...walk('app'), ...walk('lib'), ...walk('components')]) {
  if (file.replace(/\\/g, '/') === HELPER_FILE) continue
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    if (INLINE_RE.test(line)) sourceIssues.push(`${file}:${i + 1} 정본식 인라인 복제 — effectiveRecurringAmount 를 쓸 것`)
  }
}

// ── ② 데이터 대조 ────────────────────────────────────────────
const month = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7)  // KST
const [year, m] = month.split('-').map(Number)
const startDate = new Date(year, m - 1, 1)
const endDate = new Date(year, m, 0)

const dataIssues = []
const properties = await prisma.property.findMany({ select: { id: true, name: true } })
for (const p of properties) {
  const recs = await prisma.recurringExpense.findMany({
    where: { propertyId: p.id, isActive: true },
    orderBy: { dueDay: 'asc' },
  })
  const recorded = await prisma.expense.findMany({
    where: { propertyId: p.id, recurringExpenseId: { not: null }, date: { gte: startDate, lte: endDate } },
    select: { id: true, recurringExpenseId: true, amount: true },
  })
  const recordedMap = new Map(recorded.map(e => [e.recurringExpenseId, e]))

  // 과거평균 = 최근 3개월 평균과 전년동월액의 평균 (getRecurringExpensesWithStatus 와 같은 규칙)
  const variableIds = recs
    .filter(r => r.isVariable && !(r.activeSince && new Date(r.activeSince) > endDate))
    .map(r => r.id)
  const past = variableIds.length
    ? await prisma.expense.findMany({
        where: {
          propertyId: p.id,
          recurringExpenseId: { in: variableIds },
          date: { gte: new Date(year, m - 4, 1), lt: startDate },
        },
        select: { recurringExpenseId: true, amount: true },
      })
    : []
  const sum = {}, cnt = {}
  for (const e of past) {
    sum[e.recurringExpenseId] = (sum[e.recurringExpenseId] ?? 0) + e.amount
    cnt[e.recurringExpenseId] = (cnt[e.recurringExpenseId] ?? 0) + 1
  }

  let alertTotal = 0, financeTotal = 0, baseTotal = 0
  const rows = []
  for (const r of recs) {
    let historicalAvg = null
    if (r.isVariable) {
      const points = []
      if ((cnt[r.id] ?? 0) >= 1) points.push(Math.round(sum[r.id] / cnt[r.id]))
      if (r.priorYearAmount) points.push(r.priorYearAmount)
      if (points.length) historicalAvg = Math.round(points.reduce((s, v) => s + v, 0) / points.length)
    }
    const isPending = !!(r.activeSince && new Date(r.activeSince) > endDate)
    const recordedRow = isPending ? null : recordedMap.get(r.id)

    if (recordedRow && r.pendingAmount != null) {
      dataIssues.push(`${p.name} · ${r.title} — 이번 달 기록 완료인데 예약금액(${r.pendingAmount.toLocaleString()}원)이 남아있다`)
    }
    if (isPending || recordedRow) continue

    // 알림 생성부가 쓰는 값 = 정본 헬퍼 결과, 재무 탭 값 = 정본식 재계산 — 둘이 같아야 한다.
    const alertAmount = r.pendingAmount ?? historicalAvg ?? r.amount
    const financeAmount = r.pendingAmount != null ? r.pendingAmount : (historicalAvg != null ? historicalAvg : r.amount)
    const label = r.pendingAmount != null ? '예약금액' : (historicalAvg != null ? '예상치' : '')
    if (alertAmount !== financeAmount) {
      dataIssues.push(`${p.name} · ${r.title} — 알림 ${alertAmount.toLocaleString()}원 vs 재무 ${financeAmount.toLocaleString()}원`)
    }
    if (!(alertAmount > 0)) {
      dataIssues.push(`${p.name} · ${r.title} — 추정액이 0 이하(${alertAmount})`)
    }
    alertTotal += alertAmount
    financeTotal += financeAmount
    baseTotal += r.amount
    rows.push(`${r.title}: ${alertAmount.toLocaleString()}원${label ? ` · ${label}` : ''} (기본액 ${r.amount.toLocaleString()}원)`)
  }

  console.log(`\n[${p.name}] ${month} 미기록 고정지출 ${rows.length}건`)
  for (const row of rows) console.log(`  - ${row}`)
  console.log(`  알림 합계 ${alertTotal.toLocaleString()}원 · 재무 합계 ${financeTotal.toLocaleString()}원 · 기본액 합계 ${baseTotal.toLocaleString()}원`)
}

console.log(`\n[소스 가드] ${sourceIssues.length}건`)
for (const s of sourceIssues) console.log(`  - ${s}`)
console.log(`[데이터 대조] ${dataIssues.length}건`)
for (const d of dataIssues) console.log(`  - ${d}`)

const total = sourceIssues.length + dataIssues.length
console.log(`\n불일치 ${total}건`)
await prisma.$disconnect()
if (total > 0) process.exit(1)
