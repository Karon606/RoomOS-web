// 지출 귀속월(Expense.targetMonth) 데이터 그물 — 읽기 전용(SELECT 만). 위반 시 exit 1, 경고는 통과.
//
// 2026-10-03 운영자 승인 2안부터 지출 결산 전체가 귀속월 축이다(knowledge/domain-expense-target-month).
// 비NULL 건수는 정상적으로 늘어나는 값이라 래칫으로 묶지 않는다. 대신 이 셋을 본다.
//   ① 표현 하나: 값이 있으면 'YYYY-MM' 이고 date 의 달과 달라야 한다(같으면 NULL 로 접는 게 정본,
//      lib/expenseTargetMonth targetMonthForSave). 어긋나면 위반 — 저장 경로 하나가 접기를 건너뛴 것이다.
//   ② Σ 항등: 영업장·달마다 쿼리 조각(targetMonthWhere)으로 센 합 == 메모리 정본(expenseTargetMonth)으로 센 합,
//      그리고 영업장 전체에서 귀속월 축 합 == date 축 합(달만 옮겨질 뿐 돈이 생기거나 사라지지 않는다).
//   ③ 먼 달 경고: |귀속월 − date 의 달| > 1 이면 경고(폼은 날짜 달 ±1 만 고르게 한다 — 그보다 멀면 오입력 의심).
// 실행: npx tsx --env-file=.env.local scripts/check-expense-target-month-drift.ts
import prisma from '../lib/prisma'
import { dbDateMonthKey } from '../lib/kstDate'
import { expenseTargetMonth, isMonthKey, targetMonthWhere } from '../lib/expenseTargetMonth'

const monthIdx = (m: string) => Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1

async function main() {
  const rows = await prisma.expense.findMany({ select: { id: true, propertyId: true, date: true, targetMonth: true, amount: true } })
  const issues: string[] = []
  const warns: string[] = []

  // ① 표현 하나
  for (const r of rows) {
    if (r.targetMonth == null) continue
    if (!isMonthKey(r.targetMonth)) { issues.push(`${r.id.slice(0, 8)} — 귀속월 형식 아님 '${r.targetMonth}'`); continue }
    const dm = dbDateMonthKey(r.date)
    if (r.targetMonth === dm) issues.push(`${r.id.slice(0, 8)} — 귀속월이 날짜의 달(${dm})과 같은데 NULL 로 접히지 않았다`)
    else if (Math.abs(monthIdx(r.targetMonth) - monthIdx(dm)) > 1) warns.push(`${r.id.slice(0, 8)} — 날짜 ${dm} · 귀속월 ${r.targetMonth} (한 달보다 멀다)`)
  }

  // ② Σ 항등
  const byProp = new Map<string, typeof rows>()
  for (const r of rows) byProp.set(r.propertyId, [...(byProp.get(r.propertyId) ?? []), r])
  for (const [propertyId, list] of byProp) {
    const byTarget = new Map<string, number>()
    let sumDate = 0
    for (const r of list) {
      const m = expenseTargetMonth(r)
      byTarget.set(m, (byTarget.get(m) ?? 0) + r.amount)
      sumDate += r.amount
    }
    const sumTarget = [...byTarget.values()].reduce((s, v) => s + v, 0)
    if (sumTarget !== sumDate) issues.push(`${propertyId.slice(0, 8)} — 귀속월 축 합 ${sumTarget} ≠ date 축 합 ${sumDate}`)
    // 달은 두 축의 합집합 — 귀속월이 date 창 밖인 달(선납·지연)도 쿼리가 같은 답을 내야 한다.
    const months = new Set<string>([...byTarget.keys(), ...list.map(r => dbDateMonthKey(r.date))])
    for (const m of months) {
      const agg = await prisma.expense.aggregate({ where: { propertyId, ...targetMonthWhere(m) }, _sum: { amount: true } })
      const q = agg._sum.amount ?? 0
      const mem = byTarget.get(m) ?? 0
      if (q !== mem) issues.push(`${propertyId.slice(0, 8)} ${m} — 쿼리 조각 합 ${q} ≠ 정본 합 ${mem}`)
    }
  }

  const nonNull = rows.filter(r => r.targetMonth != null).length
  for (const w of warns) console.warn(`  경고: ${w}`)
  if (issues.length > 0) {
    console.error(`[지출 귀속월 데이터] 위반 ${issues.length}건 (지출 ${rows.length} · 귀속월 지정 ${nonNull})`)
    for (const i of issues) console.error(`  - ${i}`)
    process.exit(1)
  }
  console.log(`[지출 귀속월 데이터] 표현·Σ 항등 통과 (지출 ${rows.length} · 귀속월 지정 ${nonNull} · 먼 달 경고 ${warns.length})`)
}

main().finally(() => prisma.$disconnect())
