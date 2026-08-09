// 임시 읽기 전용 조사 — 청소비·보증금 모델 실태 (실행 후 삭제)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const won = n => (n ?? 0).toLocaleString()

// ── 1. 김민정 전수 ────────────────────────────────────────────
const kim = await prisma.leaseTerm.findMany({
  where: { tenant: { name: '김민정' } },
  select: {
    id: true, status: true, isShortTerm: true, moveInDate: true, moveOutDate: true, expectedMoveOut: true,
    rentAmount: true, depositAmount: true, cleaningFee: true, propertyId: true,
    room: { select: { roomNo: true } },
    paymentRecords: { select: { id: true, seqNo: true, targetMonth: true, expectedAmount: true, actualAmount: true, payDate: true, payMethod: true, isDeposit: true, isPaid: true, isBillingAdjust: true, isPrevOwner: true, memo: true, deletedAt: true }, orderBy: [{ targetMonth: 'asc' }, { seqNo: 'asc' }] },
    extraIncomes: { select: { id: true, date: true, amount: true, category: true, detail: true, deletedAt: true } },
    depositRefunds: { select: { id: true, date: true, returnedAmount: true, withheldAmount: true, reason: true, memo: true } },
  },
})
console.log('===== 1. 김민정 계약 =====')
for (const l of kim) {
  console.log(`\nlease ${l.id.slice(0,8)} ${l.room?.roomNo ?? '-'}호 ${l.status} short=${l.isShortTerm} 입주 ${l.moveInDate?.toISOString().slice(0,10)} 퇴실예정 ${l.expectedMoveOut?.toISOString().slice(0,10) ?? '-'}`)
  console.log(`  임대료 ${won(l.rentAmount)} · 보증금 ${won(l.depositAmount)} · 청소비 ${won(l.cleaningFee)}`)
  for (const r of l.paymentRecords) {
    console.log(`   rec ${r.targetMonth} seq${r.seqNo} 실 ${String(won(r.actualAmount)).padStart(9)} 청구 ${String(won(r.expectedAmount)).padStart(9)} ${r.payDate.toISOString().slice(0,10)} ${r.isDeposit?'[보증금]':'[이용료]'}${r.isBillingAdjust?'[조정]':''}${r.isPrevOwner?'[양도인]':''} ${r.isPaid?'완납':'    '} ${r.deletedAt?'*삭제*':''} ${r.payMethod ?? ''} ${r.memo ?? ''}`)
  }
  for (const e of l.extraIncomes) console.log(`   부가수익 ${e.date.toISOString().slice(0,10)} ${won(e.amount)} [${e.category}] ${e.detail ?? ''} ${e.deletedAt?'*삭제*':''}`)
  for (const d of l.depositRefunds) console.log(`   환불 ${d.date.toISOString().slice(0,10)} 반환 ${won(d.returnedAmount)} 미반환 ${won(d.withheldAmount)} (${d.reason ?? ''})`)
}

// ── 2. 클래스 A: 청소비>0 인데 청소비 수납(ExtraIncome) 0 ────────
console.log('\n\n===== 2. 청소비 설정 계약 전수 =====')
const withFee = await prisma.leaseTerm.findMany({
  where: { cleaningFee: { gt: 0 } },
  select: {
    id: true, status: true, isShortTerm: true, depositAmount: true, cleaningFee: true, moveInDate: true,
    tenant: { select: { name: true } }, room: { select: { roomNo: true } },
    extraIncomes: { select: { amount: true, category: true } },
    depositRefunds: { select: { withheldAmount: true, reason: true, returnedAmount: true } },
    paymentRecords: { where: { isDeposit: true }, select: { actualAmount: true } },
  },
  orderBy: { moveInDate: 'asc' },
})
let a = 0, b = 0
for (const l of withFee) {
  const cin = l.extraIncomes.filter(e => e.category === '청소비').reduce((s, e) => s + e.amount, 0)
  const cwh = l.depositRefunds.filter(d => (d.reason ?? '').includes('청소비')).reduce((s, d) => s + d.withheldAmount, 0)
  const depPaid = l.paymentRecords.reduce((s, r) => s + r.actualAmount, 0)
  const settled = l.depositRefunds.length > 0
  const flag = []
  if (cin === 0 && cwh === 0) { flag.push('청소비 실현 0'); a++ }
  if (l.depositAmount > 0 && cin > 0) { flag.push('보증금+별도청소비 동시'); b++ }
  console.log(`${(l.tenant?.name ?? '?').padEnd(5)} ${String(l.room?.roomNo ?? '-').padStart(4)}호 ${l.status.padEnd(16)} short=${l.isShortTerm?'Y':'N'} 계약보증금 ${String(won(l.depositAmount)).padStart(8)} 실수납보증금 ${String(won(depPaid)).padStart(8)} 청소비 ${String(won(l.cleaningFee)).padStart(7)} 청소비수납 ${String(won(cin)).padStart(7)} 몰취 ${String(won(cwh)).padStart(7)} ${settled?'정산됨':'      '} ${flag.join(' / ')}`)
}
console.log(`\n청소비 설정 총 ${withFee.length}건 · 실현 0건 ${a} · 보증금과 별도청소비 동시 ${b}`)

// ── 3. 클래스 B: 같은 날 같은 금액 이용료/보증금 쌍 ─────────────
console.log('\n\n===== 3. 같은 날 같은 금액 이용료·보증금 쌍 =====')
const recs = await prisma.paymentRecord.findMany({
  where: { deletedAt: null },
  select: { id: true, leaseTermId: true, targetMonth: true, actualAmount: true, payDate: true, isDeposit: true, memo: true,
    leaseTerm: { select: { tenant: { select: { name: true } }, room: { select: { roomNo: true } }, depositAmount: true, cleaningFee: true } } },
})
const byKey = new Map()
for (const r of recs) {
  const k = `${r.leaseTermId}|${r.payDate.toISOString().slice(0,10)}|${r.actualAmount}`
  if (!byKey.has(k)) byKey.set(k, [])
  byKey.get(k).push(r)
}
let c = 0
for (const [k, arr] of byKey) {
  if (arr.length < 2) continue
  const hasDep = arr.some(r => r.isDeposit), hasRent = arr.some(r => !r.isDeposit)
  if (!(hasDep && hasRent)) continue
  c++
  const l = arr[0].leaseTerm
  console.log(`${l.tenant?.name ?? '?'} ${l.room?.roomNo ?? '-'}호 ${k.split('|')[1]} ${won(arr[0].actualAmount)} x${arr.length} (계약보증금 ${won(l.depositAmount)} 청소비 ${won(l.cleaningFee)})`)
  for (const r of arr) console.log(`     ${r.targetMonth} ${r.isDeposit?'[보증금]':'[이용료]'} ${r.memo ?? ''}`)
}
console.log(`\n동일일자·동일금액 이용료/보증금 쌍 ${c}건`)

// ── 4. 보증금 실수납 > 계약 보증금 ───────────────────────────
console.log('\n\n===== 4. 보증금 실수납 vs 계약 =====')
const dep = await prisma.leaseTerm.findMany({
  where: { OR: [{ depositAmount: { gt: 0 } }, { paymentRecords: { some: { isDeposit: true } } }] },
  select: { id: true, status: true, depositAmount: true, cleaningFee: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } },
    paymentRecords: { where: { isDeposit: true, deletedAt: null }, select: { actualAmount: true } } },
})
let over = 0, short = 0
for (const l of dep) {
  const p = l.paymentRecords.reduce((s, r) => s + r.actualAmount, 0)
  if (p > l.depositAmount) { over++; console.log(`[초과] ${l.tenant?.name} ${l.room?.roomNo ?? '-'}호 ${l.status} 실수납 ${won(p)} > 계약 ${won(l.depositAmount)}`) }
  else if (p < l.depositAmount && ['ACTIVE','CHECKOUT_PENDING'].includes(l.status)) { short++; console.log(`[부족] ${l.tenant?.name} ${l.room?.roomNo ?? '-'}호 ${l.status} 실수납 ${won(p)} < 계약 ${won(l.depositAmount)} (청소비 ${won(l.cleaningFee)})`) }
}
console.log(`\n초과 ${over} · 거주중 부족 ${short}`)

// ── 5. 영업장 기본값 ──────────────────────────────────────────
console.log('\n\n===== 5. 영업장 기본값 =====')
const props = await prisma.property.findMany({ select: { id: true, name: true, defaultDeposit: true, defaultCleaningFee: true, shortStayPolicy: true, refundDeductCleaning: true, incomeCategories: true } })
for (const p of props) console.log(`${p.name}: 기본보증금 ${won(p.defaultDeposit)} · 기본청소비 ${won(p.defaultCleaningFee)} · 환불청소비차감 ${p.refundDeductCleaning} · 단기정책 ${JSON.stringify(p.shortStayPolicy)}`)

await prisma.$disconnect()
