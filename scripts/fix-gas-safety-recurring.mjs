// 가스안전검사를 재고에서 빼고 6개월 주기 고정지출로 세운다 (2026-08-31 운영자 지시).
//
// 왜. 검사는 용역이라 재고에 남을 물건이 아닌데 자산 화면의 배정 대기에 떠 있었다
// (excludeFromInventory 가 안 켜져 있었다). 그리고 연 2회 도는 일인데 고정지출에 없어서
// 다음 회차를 앱이 모른다.
//
// 기준 달은 실제 지출 달(8월)이다. 그러면 다음 도래는 2027-02 이고, 그때 실제로 기록한 달로
// 기준이 다시 옮겨간다(recordRecurringExpense 의 유연 재기준).
//
// 예행: node --env-file=.env.local scripts/fix-gas-safety-recurring.mjs
// 적용: node --env-file=.env.local scripts/fix-gas-safety-recurring.mjs --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const TITLE = '가스안전검사'

const exp = await prisma.expense.findFirst({
  where: { itemLabel: TITLE },
  select: { id: true, propertyId: true, date: true, amount: true, category: true, vendor: true, payMethod: true,
            excludeFromInventory: true, recurringExpenseId: true },
  orderBy: { date: 'desc' },
})
if (!exp) { console.log('대상 지출이 없다.'); await prisma.$disconnect(); process.exit(0) }

const ymd = new Date(exp.date).toISOString().slice(0, 10)
const anchor = Number(ymd.slice(5, 7))
const day = Number(ymd.slice(8, 10))

const existing = await prisma.recurringExpense.findFirst({
  where: { propertyId: exp.propertyId, title: TITLE },
  select: { id: true, intervalMonths: true, anchorMonth: true },
})

console.log(`지출: ${ymd} · ${exp.amount.toLocaleString()}원 · ${exp.category} · ${exp.vendor ?? '-'}`)
console.log(`  재고 제외: ${exp.excludeFromInventory ? '이미 켜짐' : '꺼짐 → 켠다'}`)
console.log(`  고정지출 연결: ${exp.recurringExpenseId ? '이미 있음' : '없음 → 잇는다'}`)
console.log(`고정지출: ${existing ? `이미 있음 (${existing.intervalMonths}개월, 기준 ${existing.anchorMonth ?? '-'}월)` : `없음 → 만든다 (6개월 주기, 기준 ${anchor}월, 납부일 ${day}일)`}`)

if (apply) {
  const rec = existing ?? await prisma.recurringExpense.create({
    data: {
      propertyId: exp.propertyId, title: TITLE, amount: exp.amount, category: exp.category,
      dueDay: day, intervalMonths: 6, anchorMonth: anchor,
      payMethod: exp.payMethod, vendor: exp.vendor,
      // 이번 지출이 그 항목의 첫 회차다 — 활성 시작을 그 달로 두어야 이전 달이 미기록으로 안 뜬다.
      activeSince: new Date(`${ymd.slice(0, 7)}-01T00:00:00.000Z`),
    },
    select: { id: true },
  })
  await prisma.expense.update({
    where: { id: exp.id },
    // 검사는 용역이라 재고 대상이 아니다. 그리고 이 지출이 그 고정지출의 첫 기록이 된다.
    data: { excludeFromInventory: true, recurringExpenseId: rec.id },
  })
  console.log('\n적용함.')
} else {
  console.log('\n예행 — 적용하려면 --apply')
}
await prisma.$disconnect()
