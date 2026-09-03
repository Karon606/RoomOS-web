// 미반환 보증금 기타수익의 날짜를 정산일 축(= 퇴실일)으로 맞추는 백필. 기본은 예행이다.
//
// 왜 필요한가. 네 경로 중 둘(입주자 수정 폼·보증금 카드)이 기본값 '오늘'을 넘겨 왔다. 오늘은
// 정산일도 퇴실일도 아닌 **클릭한 날**이고, 그 값이 그대로 ExtraIncome.date 가 되어 귀속월을
// 정했다. 생성 경로는 2026-09-03 에 고쳤고 이 스크립트가 지나간 행을 맞춘다.
//
// 대상. payMethod = '보유 보증금' 인 ExtraIncome 과 짝 DepositRefund 중, date 가 그 계약의
// moveOutDate 와 다른 행. 예약 취소 몰취(위약금)는 취소일 축이라 **제외**한다 — 그 거래에는
// 퇴실일이라는 개념이 없다.
//
// 실행: node --env-file=.env.local scripts/backfill-deposit-income-date.mjs        (예행)
//       node --env-file=.env.local scripts/backfill-deposit-income-date.mjs --apply (적용)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFileSync } from 'node:fs'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')
const DEPOSIT_SOURCED = '보유 보증금'
const PENALTY = '위약금'
const ymd = d => new Date(d.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10)

const rows = await prisma.extraIncome.findMany({
  where: { payMethod: DEPOSIT_SOURCED, category: { not: PENALTY }, leaseTermId: { not: null } },
  select: { id: true, date: true, amount: true, category: true, detail: true, leaseTermId: true },
})

const plan = []
for (const r of rows) {
  const lease = await prisma.leaseTerm.findUnique({
    where: { id: r.leaseTermId },
    select: { moveOutDate: true, room: { select: { roomNo: true } }, tenant: { select: { name: true } } },
  })
  if (!lease?.moveOutDate) continue          // 퇴실일을 모르면 맞출 근거가 없다
  const from = ymd(r.date), to = ymd(lease.moveOutDate)
  if (from === to) continue
  plan.push({
    id: r.id, from, to, amount: r.amount, category: r.category,
    who: `${lease.room?.roomNo ?? '-'} ${lease.tenant?.name ?? ''}`.trim(),
    monthMoves: from.slice(0, 7) !== to.slice(0, 7),
  })
}

// 짝 DepositRefund 도 같은 날짜를 쓴다 — 한쪽만 옮기면 정산 기록과 매출이 갈린다.
const refundPlan = []
for (const p of plan) {
  const inc = rows.find(r => r.id === p.id)
  const rf = await prisma.depositRefund.findFirst({
    where: { leaseTermId: inc.leaseTermId, date: new Date(`${p.from}T00:00:00.000Z`) },
    select: { id: true },
  })
  if (rf) refundPlan.push({ id: rf.id, from: p.from, to: p.to })
}

const moves = plan.filter(p => p.monthMoves)
console.log(`대상 후보 ${rows.length}건 · 날짜가 어긋난 행 ${plan.length}건(짝 정산 기록 ${refundPlan.length}건)`)
console.log(`  달이 바뀌는 행 ${moves.length}건 — 월 매출 숫자가 실제로 움직인다`)
for (const p of plan) {
  console.log(`  ${p.monthMoves ? '[달 이동]' : '        '} ${p.who} · [${p.category}] ${p.amount.toLocaleString()}원 · ${p.from} -> ${p.to}`)
}

if (!APPLY) { console.log('\n예행입니다. 적용하려면 --apply 를 붙이세요.'); await prisma.$disconnect(); process.exit(0) }
if (plan.length === 0) { console.log('\n바꿀 행이 없습니다.'); await prisma.$disconnect(); process.exit(0) }

// 되돌릴 근거를 먼저 남긴다 — 적용 전 상태가 파일로 없으면 이 스크립트에 적용취소가 없는 셈이다.
const undo = `scripts/.backfill-deposit-income-date-undo-${Date.now()}.json`
writeFileSync(undo, JSON.stringify({ income: plan, refunds: refundPlan }, null, 2))
console.log(`\n되돌림 근거: ${undo}`)

let n = 0
for (const p of plan) {
  await prisma.extraIncome.update({ where: { id: p.id }, data: { date: new Date(`${p.to}T00:00:00.000Z`) } })
  n++
}
let m = 0
for (const p of refundPlan) {
  await prisma.depositRefund.update({ where: { id: p.id }, data: { date: new Date(`${p.to}T00:00:00.000Z`) } })
  m++
}
console.log(`적용 완료 — 기타수익 ${n}건 · 정산 기록 ${m}건`)
await prisma.$disconnect()
