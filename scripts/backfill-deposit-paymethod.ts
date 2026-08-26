// 보증금 수납 줄의 수단 채우기 — 운영자 확인분(2026-08-26).
//   예행: npx tsx --env-file=.env.local scripts/backfill-deposit-paymethod.ts
//   적용: npx tsx --env-file=.env.local scripts/backfill-deposit-paymethod.ts --apply
//
// 왜 비어 있었나. 보증금을 '받았다'고 기록하는 자리가 오래 확인창뿐이었고, ConfirmDialog 에는
// 입력 칸이 없어 입금일과 수단을 물을 방법 자체가 없었다. 그래서 '오늘'과 '기타'가 박힌 줄이
// 쌓였다(knowledge/deposit-entry-paths). 생성 경로는 이미 미니폼으로 바뀌었고 이건 그 백필이다.
//
// 값은 운영자 확인이다 — "모두 계좌이체야". 418호만 날짜도 함께 고친다(아래 주석).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const APPLY = process.argv.includes('--apply')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }) })

// 418호 서민준 — 입주는 1/2 인데 보증금 수납일이 2/2 로 한 달 뒤에 박혀 있었다. 이미 퇴실했고
// 이전 원장 운영분이라 정확한 날은 남아 있지 않다. 운영자 판단으로 입주일에 맞춘다(2026-08-26).
// 추정이라는 사실을 메모에 남긴다 — 나중에 "왜 1/2 인가"에 답할 수 있어야 한다.
const DATE_FIX = {
  id: '193795d3-02fa-4183-b890-39446c4c1a41',
  to: '2026-01-02',
  memo: '보증금 수납(받음 기록) · 수납일은 입주일 기준 추정(이전 원장 운영분, 운영자 확인 2026-08-26)',
}

async function main() {
  const rows = await prisma.paymentRecord.findMany({
    where: { deletedAt: null, isDeposit: true, OR: [{ payMethod: null }, { payMethod: '기타' }] },
    orderBy: [{ payDate: 'asc' }],
    select: {
      id: true, payDate: true, payMethod: true, memo: true,
      leaseTerm: { select: { tenant: { select: { name: true } }, room: { select: { roomNo: true } } } },
    },
  })

  for (const r of rows) {
    const who = `${r.leaseTerm?.room?.roomNo ?? '?'}호 ${r.leaseTerm?.tenant?.name ?? ''}`
    const dateFix = r.id === DATE_FIX.id
    console.log(
      `${who.padEnd(20)} 수단 ${(r.payMethod ?? '(없음)').padEnd(5)} -> 계좌이체`
      + (dateFix ? ` · 수납일 ${r.payDate.toISOString().slice(0, 10)} -> ${DATE_FIX.to}` : ''),
    )
    if (!APPLY) continue
    await prisma.paymentRecord.update({
      where: { id: r.id },
      data: {
        payMethod: '계좌이체',
        ...(dateFix ? { payDate: new Date(`${DATE_FIX.to}T00:00:00.000Z`), memo: DATE_FIX.memo } : {}),
      },
    })
  }

  console.log(`\n${APPLY ? '적용' : '예행'} — 보증금 줄 ${rows.length}건`)
  if (!APPLY && rows.length > 0) console.log('적용하려면 --apply 를 붙여 다시 실행하세요.')
  await prisma.$disconnect()
}

main()
