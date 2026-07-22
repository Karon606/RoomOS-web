// 대방도배사 벽지도배 21건 결제수단 정정(운영자 비상 신고 2026-07-23) — 신용카드 하나카드(MG+ S) 오입력을
// 실제 결제한 신한은행 저축예금 계좌이체로. 전건 미정산(UNSETTLED)이라 카드 정산 배치 미간섭 확인됨.
// 기본 드라이런. 적용: node --env-file=.env.local scripts/fix-daebang-paymethod.mjs --apply
// 되돌리기: 아래 스냅샷 값으로 원복(payMethod 신용카드·financeName 하나카드 (MG+ S)·financialAccountId 원값·UNSETTLED).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

const SHINHAN_ID = 'e3736d9e-922b-4aae-8a38-6285fc075346'   // 신한은행 저축예금 (운영자 지정)
const NEW_FINANCE_NAME = '신한은행 (저축예금)'               // 기존 계좌이체 행 표기 관례와 동일

async function main() {
  const rows = await prisma.expense.findMany({
    where: {
      date: new Date('2026-07-07'), category: '수선유지비', vendor: { contains: '대방' },
      payMethod: '신용카드', settleStatus: 'UNSETTLED',
    },
    select: { id: true, amount: true, payMethod: true, financeName: true, financialAccountId: true, settleStatus: true },
  })
  if (rows.length === 0) { console.log('대상 없음(이미 정정됐거나 조건 불일치) — 할 일 없음.'); await prisma.$disconnect(); return }
  console.log(`대상 ${rows.length}건, 합계 ${rows.reduce((s, r) => s + r.amount, 0).toLocaleString()}원`)
  console.log('스냅샷(되돌리기용):', JSON.stringify(rows.map(r => ({ id: r.id, financeName: r.financeName, financialAccountId: r.financialAccountId }))))
  console.log(`계획: payMethod 계좌이체, financeName ${NEW_FINANCE_NAME}, 계좌 ${SHINHAN_ID.slice(0, 8)}, SETTLED`)
  if (rows.length !== 21) console.log(`주의: 기대 21건과 다름(${rows.length}건) — 계속 진행하되 확인 요망`)

  if (!APPLY) { console.log('드라이런 종료 — 적용하려면 --apply'); await prisma.$disconnect(); return }

  const res = await prisma.expense.updateMany({
    where: { id: { in: rows.map(r => r.id) } },
    data: { payMethod: '계좌이체', financeName: NEW_FINANCE_NAME, financialAccountId: SHINHAN_ID, settleStatus: 'SETTLED' },
  })
  console.log(`적용 완료: ${res.count}건`)
  await prisma.$disconnect()
}
main()
