// 임시 읽기 전용 조사 2 — 타임스탬프·클래스 전수 (실행 후 삭제)
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const won = n => (n ?? 0).toLocaleString()
const ts = d => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 19) : '-'

console.log('===== 김민정 record 타임스탬프 =====')
const l = await prisma.leaseTerm.findFirst({
  where: { tenant: { name: '김민정' } },
  select: { id: true, createdAt: true, updatedAt: true, rentAmount: true, depositAmount: true, cleaningFee: true, isShortTerm: true, shortStayExtensions: true },
})
console.log(`lease ${l.id} 생성 ${ts(l.createdAt)} 수정 ${ts(l.updatedAt)}`)
const recs = await prisma.paymentRecord.findMany({
  where: { leaseTermId: l.id }, orderBy: [{ seqNo: 'asc' }],
  select: { seqNo: true, targetMonth: true, expectedAmount: true, actualAmount: true, payDate: true, isDeposit: true, isBillingAdjust: true, isPaid: true, memo: true, createdAt: true, updatedAt: true, deletedAt: true, payMethod: true, cashReceiptIssuedAt: true },
})
for (const r of recs) {
  console.log(`seq${r.seqNo} ${r.targetMonth} ${r.isDeposit?'보증금':r.isBillingAdjust?'조정  ':'이용료'} 실 ${String(won(r.actualAmount)).padStart(8)} 청구 ${String(won(r.expectedAmount)).padStart(8)} 납 ${r.payDate.toISOString().slice(0,10)} 생성 ${ts(r.createdAt)} 수정 ${ts(r.updatedAt)} ${r.deletedAt?'삭제 '+ts(r.deletedAt):''} | ${r.memo ?? ''}`)
}
const ei = await prisma.extraIncome.findMany({ where: { leaseTermId: l.id }, select: { date: true, amount: true, category: true, detail: true, createdAt: true, updatedAt: true, deletedAt: true } })
for (const e of ei) console.log(`부가수익 ${e.date.toISOString().slice(0,10)} ${won(e.amount)} [${e.category}] 생성 ${ts(e.createdAt)} 수정 ${ts(e.updatedAt)} ${e.deletedAt?'삭제':''} | ${e.detail}`)

console.log('\n--- 김민정 라이브 집계 ---')
const live = recs.filter(r => !r.deletedAt)
const rent = live.filter(r => !r.isDeposit && !r.isBillingAdjust).reduce((s, r) => s + r.actualAmount, 0)
const dep = live.filter(r => r.isDeposit).reduce((s, r) => s + r.actualAmount, 0)
const cin = ei.filter(e => !e.deletedAt && e.category === '청소비').reduce((s, e) => s + e.amount, 0)
console.log(`이용료 ${won(rent)} · 보증금 ${won(dep)} · 청소비 부가수익 ${won(cin)} · 앱이 주장하는 수령 총액 ${won(rent + dep + cin)}`)
console.log(`계약: 임대료 ${won(l.rentAmount)} · 보증금 ${won(l.depositAmount)} · 청소비 ${won(l.cleaningFee)}`)

console.log('\n\n===== 청소비 ExtraIncome 전수 =====')
const allCi = await prisma.extraIncome.findMany({
  where: { category: '청소비' },
  select: { id: true, date: true, amount: true, detail: true, deletedAt: true, leaseTermId: true,
    leaseTerm: { select: { depositAmount: true, cleaningFee: true, status: true, isShortTerm: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
  orderBy: { date: 'asc' },
})
for (const e of allCi) console.log(`${e.date.toISOString().slice(0,10)} ${won(e.amount)} ${e.leaseTerm?.tenant?.name ?? '(계약없음)'} ${e.leaseTerm?.room?.roomNo ?? '-'}호 계약보증금 ${won(e.leaseTerm?.depositAmount)} 청소비 ${won(e.leaseTerm?.cleaningFee)} ${e.deletedAt?'*삭제*':''} | ${e.detail}`)

console.log('\n\n===== 청소비 몰취(DepositRefund reason 청소비) 전수 =====')
const dr = await prisma.depositRefund.findMany({
  select: { date: true, returnedAmount: true, withheldAmount: true, reason: true, leaseTerm: { select: { depositAmount: true, cleaningFee: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
  orderBy: { date: 'asc' },
})
for (const d of dr) console.log(`${d.date.toISOString().slice(0,10)} ${d.leaseTerm?.tenant?.name} ${d.leaseTerm?.room?.roomNo ?? '-'}호 반환 ${String(won(d.returnedAmount)).padStart(8)} 미반환 ${String(won(d.withheldAmount)).padStart(8)} (${d.reason ?? ''}) 계약보증금 ${won(d.leaseTerm?.depositAmount)} 청소비 ${won(d.leaseTerm?.cleaningFee)}`)

console.log('\n\n===== 청소비 실현(ExtraIncome) 과 보증금 동시 존재 =====')
for (const e of allCi) {
  if (e.deletedAt) continue
  if ((e.leaseTerm?.depositAmount ?? 0) > 0) console.log(`[중복 위험] ${e.leaseTerm?.tenant?.name} ${e.leaseTerm?.room?.roomNo}호 — 계약보증금 ${won(e.leaseTerm?.depositAmount)} 인데 청소비 별도수납 ${won(e.amount)}`)
}

console.log('\n\n===== 이용료 record 가 청소비만큼 부풀어 있는지(청구 vs 실납 차이 = 청소비) =====')
const suspects = await prisma.paymentRecord.findMany({
  where: { isDeposit: false, isBillingAdjust: false, deletedAt: null },
  select: { seqNo: true, targetMonth: true, expectedAmount: true, actualAmount: true, payDate: true, memo: true,
    leaseTerm: { select: { cleaningFee: true, depositAmount: true, tenant: { select: { name: true } }, room: { select: { roomNo: true } } } } },
})
let n = 0
for (const r of suspects) {
  const cf = r.leaseTerm?.cleaningFee ?? 0
  if (cf > 0 && r.actualAmount - r.expectedAmount === cf) {
    n++
    console.log(`${r.leaseTerm?.tenant?.name} ${r.leaseTerm?.room?.roomNo ?? '-'}호 ${r.targetMonth} seq${r.seqNo} 실 ${won(r.actualAmount)} − 청구 ${won(r.expectedAmount)} = 청소비 ${won(cf)} · ${r.payDate.toISOString().slice(0,10)} | ${r.memo ?? ''}`)
  }
}
console.log(`\n청소비 크기만큼 초과 수납된 이용료 record ${n}건`)

await prisma.$disconnect()
