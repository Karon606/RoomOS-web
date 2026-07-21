// 라면 수령 자동점검 정정 백필(오류신고 0d6242f0) — 120g x 100개가 +12,000개로 영속된 StockCheck 를 +100개 기준으로 정정.
// 기본 드라이런. 적용: node --env-file=.env.local scripts/fix-ramen-auto-check.mjs --apply
// 되돌리기: 아래 스냅샷 출력값으로 역적용(총량 123→12023, 해당 위치 105→12005, memo +100개→+12000개).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

const CHECK_ID_PREFIX = 'a33ac0a1'   // 2026-07-21 [수령 자동] +12000개
const WRONG_ADD = 12000              // 잘못 가산된 양 (100 x 120g)
const RIGHT_ADD = 100                // 올바른 가산량 (qtyValue)
const DELTA = WRONG_ADD - RIGHT_ADD  // 11900

async function main() {
  const item = await prisma.trackedItem.findFirst({ where: { label: '라면', isArchived: false } })
  if (!item) { console.error('라면 품목 없음 — 중단'); process.exit(1) }
  const checks = (await prisma.stockCheck.findMany({
    where: { trackedItemId: item.id },
    include: { locationBreakdown: true },
  })).filter(c => c.id.startsWith(CHECK_ID_PREFIX))
  if (checks.length !== 1) {
    console.error(`점검 ${CHECK_ID_PREFIX}* 매칭 ${checks.length}건 — 중단`)
    process.exit(1)
  }
  const check = checks[0]
  console.log('현재 스냅샷(되돌리기용 보관):')
  console.log(`  StockCheck ${check.id} date=${check.date.toISOString().slice(0, 10)} remainingQty=${check.remainingQty} memo=${JSON.stringify(check.memo)}`)
  for (const lb of check.locationBreakdown) console.log(`  위치 ${lb.storageLocationId} remainingQty=${lb.remainingQty}`)

  if (check.memo === '[수령 자동] +100개') {
    console.log('이미 정정된 상태 — 할 일 없음.')
    await prisma.$disconnect()
    return
  }
  const inflated = check.locationBreakdown.find(lb => lb.remainingQty >= WRONG_ADD)
  if (check.memo !== '[수령 자동] +12000개' || !inflated) {
    console.error('기대한 원값(memo +12000개, 위치 잔량 12000 이상)이 아님 — 수동 확인 필요, 중단')
    process.exit(1)
  }
  const newTotal = check.remainingQty - DELTA
  const newLoc = inflated.remainingQty - DELTA
  console.log(`정정 계획: 총량 ${check.remainingQty} → ${newTotal}, 위치 ${inflated.storageLocationId} ${inflated.remainingQty} → ${newLoc}, memo → "[수령 자동] +100개"`)

  if (!APPLY) {
    console.log('드라이런 종료 — 적용하려면 --apply')
    await prisma.$disconnect()
    return
  }
  await prisma.$transaction([
    prisma.stockCheck.update({ where: { id: check.id }, data: { remainingQty: newTotal, memo: '[수령 자동] +100개' } }),
    prisma.stockCheckLocation.update({ where: { id: inflated.id }, data: { remainingQty: newLoc } }),
  ])
  console.log('적용 완료.')
  await prisma.$disconnect()
}
main()
