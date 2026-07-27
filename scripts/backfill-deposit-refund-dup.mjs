// 남태우 보증금 환불 중복 쌍 정리 + 남는 건 사유 라벨 갱신 — 신고 13438ec9 백필.
// 생성 경로(recordDepositReturn 멱등 가드)는 코드로 봉합됨. 이 스크립트는 가드 이전에 생긴 중복만 정정한다.
// 삭제는 undoDepositReturn 과 동일 문법(id 지정 쌍 삭제). 드라이런 기본, 적용은 --apply.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

// 중복 쌍(뒤에 생성된 것)과 남는 쌍 — 2026-07-24 11:34/11:35 실측(65초 간격 재저장)
const DELETE_REFUND_ID = '33a4d71e-936e-4473-b76f-fb0fe9f17c52'
const DELETE_EXTRA_ID = 'af85ccfe-0c5a-4e62-bd14-91b37a7b7e70'
const KEEP_REFUND_ID = '20d27a34-d7af-4f66-b849-2f946fe87ec9'
const KEEP_EXTRA_ID = '7c913657-835d-4ccb-b080-a1a26e24349f'

async function main() {
  const delRefund = await prisma.depositRefund.findUnique({ where: { id: DELETE_REFUND_ID }, select: { id: true, returnedAmount: true } })
  const delExtra = await prisma.extraIncome.findUnique({ where: { id: DELETE_EXTRA_ID }, select: { id: true, amount: true, detail: true } })
  const keepExtra = await prisma.extraIncome.findUnique({ where: { id: KEEP_EXTRA_ID }, select: { id: true, detail: true } })
  if (!delRefund && !delExtra) { console.log('중복 쌍 없음 — 이미 정리됨'); await prisma.$disconnect(); return }

  console.log('삭제 대상:', JSON.stringify({ refund: delRefund, extra: delExtra }))
  console.log('라벨 갱신 대상:', JSON.stringify(keepExtra), '→ 남태우 퇴실 · 청소비')
  if (APPLY) {
    await prisma.$transaction([
      prisma.depositRefund.deleteMany({ where: { id: DELETE_REFUND_ID } }),
      prisma.extraIncome.deleteMany({ where: { id: DELETE_EXTRA_ID } }),
      // 남는 쌍 — 차감 20,000 = 청소비와 일치(실측)라 사유 라벨로 갱신(운영자 승인)
      prisma.depositRefund.update({ where: { id: KEEP_REFUND_ID }, data: { reason: '청소비' } }),
      prisma.extraIncome.update({ where: { id: KEEP_EXTRA_ID }, data: { detail: '남태우 퇴실 · 청소비' } }),
    ])
    console.log('적용 완료')
  } else {
    console.log('드라이런 종료 — 적용하려면 --apply')
  }
  await prisma.$disconnect()
}
main()
