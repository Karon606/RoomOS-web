// 현금영수증 표시 정정 2건 (운영자 확인 2026-08-03).
//
// 1) 513호 민경진 2026-07-27 350,000 — 홈택스에 실제로 발행했다("민경진... 홈택스 발행했어").
//    그런데 앱에는 스탬프가 없다. 이 결제는 앞 달이 이미 완납이라 원본월 record 자체가 안 생겼고,
//    스탬프 조건이 첫 달 record 에만 걸려 있어 **찍을 대상이 아예 없었다**. 구조는 봉합했고 여기선 사실을 채운다.
//    7월 현금영수증 합계 5,190,000 -> 5,540,000.
//
// 2) 520호 김민정 2026-07-26 결제선생 172,000 — 카드 계열이라 매출전표가 증빙이다.
//    운영자 확인 "결제선생으로 결제했으니 자동으로 홈택스에 넘어갔겠지... 카드결제와 동일하니까".
//    집계는 이미 카드를 배제하지만 화면 칩에는 '현금영수증'이 떠 발행했다고 오인하게 한다. 해제한다.
//    합계 변화 없음(원래 카드라 안 잡혔다).
//
// 오병용 2026-07-31 470,000 은 **발행하지 않았다**(운영자 확인). 손대지 않는다.
// 4~6월 11건도 운영자 판단 보류라 대상이 아니다.
//
// 스탬프는 홈택스 발행 사실의 그림자다. 운영자가 확인한 건만 손댄다 — 추정 백필 금지.
//
// 실행:   npx tsx --env-file=.env.local scripts/fix-cash-receipt-flags.ts [--apply]
// 되돌리기: --revert --apply
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const apply = process.argv.includes('--apply')
const revert = process.argv.includes('--revert')

const TARGETS = [
  { name: '민경진', payDate: '2026-07-27', amount: 350_000, to: true,  why: '홈택스 발행 확인(운영자 2026-08-03)' },
  { name: '김민정', payDate: '2026-07-26', amount: 172_000, to: false, why: '결제선생(카드) — 매출전표가 증빙' },
]

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const rows: { id: string; label: string; before: boolean; after: boolean }[] = []

  for (const t of TARGETS) {
    const r = await prisma.paymentRecord.findFirst({
      where: {
        leaseTerm: { tenant: { name: t.name } },
        payDate: new Date(`${t.payDate}T00:00:00.000Z`),
        actualAmount: t.amount, isBillingAdjust: false,
      },
      select: { id: true, cashReceiptIssuedAt: true, targetMonth: true, payMethod: true },
    })
    if (!r) { console.log(`  ${t.name} ${t.payDate} ${t.amount.toLocaleString()}원 record 를 찾지 못했습니다.`); continue }
    const want = revert ? !t.to : t.to
    const now = !!r.cashReceiptIssuedAt
    rows.push({ id: r.id, label: `${t.name} ${t.payDate} ${t.amount.toLocaleString()}원 (귀속 ${r.targetMonth} · ${r.payMethod ?? '-'})`, before: now, after: want })
    console.log(`  ${t.name} ${t.payDate} ${t.amount.toLocaleString()}원`)
    console.log(`     ${now ? '발행 표시 있음' : '발행 표시 없음'} -> ${want ? '발행 표시 켬' : '발행 표시 끔'}   ${t.why}`)
  }

  if (!rows.length) { await prisma.$disconnect(); return }
  if (!apply) { console.log('\n  실제 반영: --apply · 되돌리기: --revert --apply'); await prisma.$disconnect(); return }

  for (const r of rows) {
    if (r.before === r.after) continue
    await prisma.paymentRecord.update({
      where: { id: r.id },
      data: { cashReceiptIssuedAt: r.after ? new Date() : null },
    })
  }
  console.log(`\n  반영 완료 (${rows.filter(r => r.before !== r.after).length}건 변경)`)
  await prisma.$disconnect()
}

void main()
