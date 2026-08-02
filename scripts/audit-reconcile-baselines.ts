// 과거 재고 보정(isReconcile) 기준선이 부풀려 저장됐는지 소급 점검 (운영자 지시 2026-08-03).
//
// 보정 폼이 구매 경계를 점검 날짜(자정)로 잡아, 그 점검이 이미 반영한 같은 날 수령을 한 번 더
// 더한 값을 미리 채웠다. 운영자가 그대로 저장하면 그 값이 새 기준선으로 박히고
// 차이가 소모로도 안 잡혀 오차가 장부에 영구 편입된다. 코드는 봉합했고 이 스크립트는 과거를 본다.
//
// 판정 — 각 보정 점검에 대해, 그 직전 기준선의 '날짜 자정 ~ 생성 시각' 구간에 수령된 구매가 있으면
// 프리필이 그만큼 부풀어 있었을 수 있다. **확정이 아니라 후보다.** 운영자가 실제로 얼마를 셌는지는
// 앱이 알 수 없으므로 자동 정정하지 않는다.
//
// 실행: npx tsx --env-file=.env.local scripts/audit-reconcile-baselines.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const recons = await prisma.stockCheck.findMany({
    where: { isReconcile: true },
    orderBy: { date: 'asc' },
    select: {
      id: true, date: true, createdAt: true, remainingQty: true, memo: true,
      trackedItem: { select: { id: true, label: true, category: true, specUnit: true, trackUnit: true } },
    },
  })
  console.log(`보정 점검 ${recons.length}건 확인\n`)
  let suspect = 0
  for (const r of recons) {
    const it = r.trackedItem
    const prev = await prisma.stockCheck.findFirst({
      where: { trackedItemId: it.id, OR: [{ date: { lt: r.date } }, { date: r.date, createdAt: { lt: r.createdAt } }] },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      select: { date: true, createdAt: true, remainingQty: true },
    })
    if (!prev) continue
    const dayStart = new Date(Date.UTC(prev.date.getUTCFullYear(), prev.date.getUTCMonth(), prev.date.getUTCDate()))
    const gap = await prisma.expense.findMany({
      where: {
        category: it.category, itemLabel: it.label, excludeFromInventory: false,
        receivedAt: { gt: dayStart, lte: prev.createdAt },
      },
      select: { qtyValue: true, specValue: true, receivedAt: true, amount: true },
    })
    if (!gap.length) continue
    const inflated = gap.reduce((s, e) => s + (e.qtyValue ?? 0) * (it.trackUnit === 'qty' ? 1 : (e.specValue ?? 1)), 0)
    // 프리필을 **그대로 저장했는지**가 판정 기준이다. 구간에 구매가 있다는 것만으로는 부족하다 —
    // 운영자가 프리필을 무시하고 실측값을 직접 입력했으면 오염이 아니다.
    // 저장값이 (직전 잔량 + 부풀림) 과 같으면 프리필을 그대로 받은 것으로 본다.
    const prefill = prev.remainingQty + inflated
    if (Math.abs(r.remainingQty - prefill) > 0.001) {
      console.log(`  ${it.label} ${r.date.toISOString().slice(0, 10)} — 프리필 ${prefill} 이었는데 ${r.remainingQty} 로 저장. 직접 입력했다(정상)`)
      continue
    }
    suspect++
    console.log(`  ${it.label}  보정 ${r.date.toISOString().slice(0, 10)} 저장값 ${r.remainingQty}${it.specUnit ?? ''}`)
    console.log(`     직전 기준선 ${prev.date.toISOString().slice(0, 10)} 잔량 ${prev.remainingQty} · 그 구간 수령 ${gap.length}건`)
    console.log(`     프리필이 최대 +${inflated} 만큼 부풀었을 수 있다 (그대로 저장했다면 실제는 ${r.remainingQty - inflated})`)
    console.log(`     메모: ${r.memo ?? '없음'}`)
  }
  console.log(`\n의심 보정 ${suspect}건 / 전체 ${recons.length}건`)
  if (suspect === 0) console.log('부풀린 값으로 저장된 보정은 없다.')
  else console.log('실제로 얼마를 셌는지는 앱이 알 수 없다. 운영자 확인 후 새 점검으로 정정할 것(기존 기록은 손대지 않는다).')
  await prisma.$disconnect()
}
void main()
