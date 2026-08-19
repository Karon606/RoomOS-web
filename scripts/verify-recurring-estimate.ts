// 미기록 고정지출 추정액 정합 검사 — 읽기 전용(SELECT 만). 불일치 발견 시 exit 1.
// 홈 알림·재무 탭·대시보드 예상지출이 같은 금액·같은 라벨을 보여야 한다.
// 정본식: 예약금액 > 비변동 항목의 계약액(기본액) > 작년 같은 달 실적 > 최근 3개월 평균 > 기본액.
//
// ① 소스 가드: 알림 생성부가 정본 헬퍼(effectiveRecurringAmount)를 쓰는지, 정본식이나 라벨을
//    lib/recurringEstimate.ts 밖에서 손으로 다시 쓴 곳이 없는지 검사 — 식이 두 벌로 갈라지는 재발을 잡는다.
// ② 데이터 대조: **앱이 실제로 쓰는 함수**(computeRecurringExpensesWithStatus · effectiveRecurringAmount)를
//    그대로 불러 이번 달 현황을 뽑는다. 스크립트가 산식을 복제하면 정본이 바뀔 때 옛 규칙으로 채점하게 된다.
// 실행: npx tsx --env-file=.env.local scripts/verify-recurring-estimate.ts
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import prisma from '../lib/prisma'
import { computeRecurringExpensesWithStatus } from '../app/(app)/finance/recurringStatus'
import { effectiveRecurringAmount, recurringAmountLabel, recurringEstimate } from '../lib/recurringEstimate'
import { kstMonthStr } from '../lib/kstDate'

const HELPER_FILE = 'lib/recurringEstimate.ts'
const ALERT_FILE = 'app/(app)/dashboard/page.tsx'
const FINANCE_FILE = 'app/(app)/finance/FinanceClient.tsx'
// 정본식을 손으로 다시 쓴 자리 — 사다리의 두 항이 한 줄에서 ?? 로 이어지면 복제다.
const INLINE_RES = [
  /\bpendingAmount\b[^\n]*\?\?[^\n]*\b(priorYearActual|recentAvg|amount)\b/,
  /\bpriorYearActual\b[^\n]*\?\?[^\n]*\b(recentAvg|amount)\b/,
]

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name.startsWith('.')) continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

// ── ① 소스 가드 ──────────────────────────────────────────────
const sourceIssues: string[] = []
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
// 재무 탭 예정 행의 라벨이 다시 항목 성격(isVariable)에 걸리면, 예약금액이 잡힌 달에도 '예상치'가 뜬다.
for (const [i, line] of readFileSync(FINANCE_FILE, 'utf8').split('\n').entries()) {
  if (/isVariable\s*&&[^\n]*예상치/.test(line)) {
    sourceIssues.push(`${FINANCE_FILE}:${i + 1} 예정 행 라벨이 isVariable 에 걸려 있다 — recurringAmountLabel 을 쓸 것`)
  }
}
for (const file of [...walk('app'), ...walk('lib'), ...walk('components')]) {
  if (file.replace(/\\/g, '/') === HELPER_FILE) continue
  for (const [i, line] of readFileSync(file, 'utf8').split('\n').entries()) {
    if (INLINE_RES.some(re => re.test(line))) {
      sourceIssues.push(`${file}:${i + 1} 정본식 인라인 복제 — effectiveRecurringAmount 를 쓸 것`)
    }
  }
}

// ── ② 데이터 대조 ────────────────────────────────────────────
async function main() {
  const month = kstMonthStr()
  const dataIssues: string[] = []
  const properties = await prisma.property.findMany({ select: { id: true, name: true } })
  for (const p of properties) {
    const rows = await computeRecurringExpensesWithStatus(p.id, month)

    let total = 0, baseTotal = 0
    const lines: string[] = []
    for (const r of rows) {
      if (r.recordedExpenseId && r.pendingAmount != null) {
        dataIssues.push(`${p.name} · ${r.title} — 이번 달 기록 완료인데 예약금액(${r.pendingAmount.toLocaleString()}원)이 남아있다`)
      }
      if (r.isPending || r.recordedExpenseId) continue

      const amount = effectiveRecurringAmount(r)
      const label = recurringAmountLabel(r)
      const { basis } = recurringEstimate(r)
      // 라벨은 금액이 나온 항을 가리켜야 한다 — 둘이 갈라지면 추정치가 확정 금액처럼 읽힌다.
      if (basis === 'pending' && amount !== r.pendingAmount) {
        dataIssues.push(`${p.name} · ${r.title} — 예약금액 채택인데 금액이 다르다`)
      }
      if (basis === 'priorYear' && amount !== r.priorYearActual) {
        dataIssues.push(`${p.name} · ${r.title} — 작년 같은 달 채택인데 금액이 다르다`)
      }
      if (basis === 'recentAvg' && amount !== r.recentAvg) {
        dataIssues.push(`${p.name} · ${r.title} — 3개월 평균 채택인데 금액이 다르다`)
      }
      if (!(amount > 0)) {
        dataIssues.push(`${p.name} · ${r.title} — 추정액이 0 이하(${amount})`)
      }
      total += amount
      baseTotal += r.amount
      lines.push(`${r.title}: ${amount.toLocaleString()}원${label ? ` · ${label}` : ''} (기본액 ${r.amount.toLocaleString()}원)`)
    }

    console.log(`\n[${p.name}] ${month} 미기록 고정지출 ${lines.length}건`)
    for (const line of lines) console.log(`  - ${line}`)
    console.log(`  추정 합계 ${total.toLocaleString()}원 · 기본액 합계 ${baseTotal.toLocaleString()}원`)
  }

  console.log(`\n[소스 가드] ${sourceIssues.length}건`)
  for (const s of sourceIssues) console.log(`  - ${s}`)
  console.log(`[데이터 대조] ${dataIssues.length}건`)
  for (const d of dataIssues) console.log(`  - ${d}`)

  const totalIssues = sourceIssues.length + dataIssues.length
  console.log(`\n불일치 ${totalIssues}건`)
  await prisma.$disconnect()
  if (totalIssues > 0) process.exit(1)
}

main()
