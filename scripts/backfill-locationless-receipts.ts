// 위치 없는 카드의 수령분을 장부에 앉히는 백필 (2026-08-05, 신고 408b4396).
//
// 보관 위치가 0개인 카드는 수령 확인을 눌러도 자동 점검이 안 생겨 **잔량이 영원히 null** 이었다.
// 특수마대 5개가 수령 완료인데 화면에 아무것도 안 잡힌 것이 그것이고, 실측으로 9장 중 8장이
// "지출 1건·수령 완료·점검 0" 동일 증상이었다. 생성 경로는 confirmReceipt 에서 고쳤고(무위치도
// 점검 생성), 이 스크립트는 이미 지나간 수령분에 첫 점검(앵커)을 만들어 준다.
//
// 대상 — **활성 카드 · 점검 0 · 입수 0 · 폐기 0 · 수령된 구매 있음.** 위치 유무는 안 본다.
// 위치가 있어도 점검이 전무하면 잔량이 null 이라 증상이 같다(재활용봉투 3종·종량제 20L 실측).
// 총량만 가진 점검은 위치 있는 카드에도 안전하다 — 다음 위치 점검 때 기존 전환 코드가 총량을 허브로 보존한다.
// 점검이나 입수·폐기가 하나라도 있으면 건드리지 않는다. 그 경우의 잔량 산식은 overview 정본이
// 이미 계산하고 있고, 여기서 흉내내면 산식이 두 벌이 된다. 조건에 안 맞으면 명단만 내고 넘어간다.
//
// 소모 미반영으로 과대일 수 있으나 그것은 수령 후 미점검 품목 전체가 공유하는 통상 가정이고,
// 점검이 정정 수단이다. null 보다 정직하다(도메인 전문가 판정).
//
// 멱등 — 앵커의 sourceExpenseId 를 가장 최근 수령 지출로 삼는다. 그 id 의 점검이 이미 있으면 건너뛴다.
// 그 지출의 수령을 취소하면 이 앵커도 기존 undo 계약대로 함께 지워진다.
import { writeFileSync } from 'fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { specMultiplier } from '../lib/units'

const APPLY = process.argv.includes('--apply')

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const snapshot: { at: string; checks: unknown[] } = { at: new Date().toISOString(), checks: [] }

  const cards = await prisma.trackedItem.findMany({
    where: { isArchived: false },
    select: {
      id: true, propertyId: true, category: true, label: true,
      trackUnit: true, specUnit: true, qtyUnit: true,
      _count: { select: { locations: true, stockChecks: true, additions: true, disposals: true } },
    },
  })

  let planned = 0
  const skipped: string[] = []
  for (const c of cards) {
    if (c._count.stockChecks > 0 || c._count.additions > 0 || c._count.disposals > 0) {
      if (c._count.stockChecks === 0) skipped.push(`${c.label} (입수·폐기 이력 있어 건너뜀)`)
      continue
    }
    // 수령된 구매 — sumPurchases 정본과 같은 조건(느슨 단위 매칭 포함)
    const purchases = await prisma.expense.findMany({
      where: {
        propertyId: c.propertyId, category: c.category, itemLabel: c.label,
        NOT: { receivedAt: null }, excludeFromInventory: false, isShipping: false,
        ...(c.qtyUnit ? { OR: [{ qtyUnit: null }, { qtyUnit: c.qtyUnit }] } : {}),
      },
      select: { id: true, qtyValue: true, specValue: true, specUnit: true, receivedAt: true },
      orderBy: { receivedAt: 'desc' },
    })
    if (!purchases.length) continue

    const useSpec = c.trackUnit !== 'qty' && !!(c.specUnit && c.specUnit.trim())
    const total = purchases.reduce((s, r) => {
      const q = r.qtyValue ?? 0
      if (!useSpec) return s + q
      const spec = specMultiplier(r.specValue, r.specUnit, c.specUnit)
      return spec != null ? s + q * spec : s + q
    }, 0)
    if (total <= 0) continue

    const anchor = purchases[0]   // 가장 최근 수령분이 앵커의 근거
    const exists = await prisma.stockCheck.findFirst({ where: { sourceExpenseId: anchor.id }, select: { id: true } })
    if (exists) { skipped.push(`${c.label} (이미 앵커 있음)`); continue }

    planned++
    const unit = useSpec ? (c.specUnit ?? '') : (c.qtyUnit ?? '')
    console.log(`[앵커] "${c.label}" 수령 ${purchases.length}건 합 ${total}${unit} · 기준일 ${anchor.receivedAt!.toISOString().slice(0, 10)}${APPLY ? '' : ' (미리보기)'}`)
    if (!APPLY) continue
    const row = await prisma.stockCheck.create({
      data: {
        trackedItemId: c.id,
        date: anchor.receivedAt!,
        remainingQty: total,
        memo: `[수령 자동·백필] 수령 ${purchases.length}건 합산`,
        sourceExpenseId: anchor.id,
      },
      select: { id: true },
    })
    snapshot.checks.push({ id: row.id, trackedItemId: c.id, label: c.label })
  }

  if (skipped.length) {
    console.log(`\n건너뜀 ${skipped.length}건`)
    for (const x of skipped) console.log('  - ' + x)
  }
  if (!APPLY) { console.log(`\n대상 ${planned}건. --apply 를 붙이면 실제로 씁니다.`); await prisma.$disconnect(); return }
  const f = `backfill-locationless-receipts-undo-${Date.now()}.json`
  writeFileSync(f, JSON.stringify(snapshot, null, 2))
  console.log(`\n적용 ${planned}건 · 되돌리기 스냅샷 ${f} (점검 id 목록 — 지우면 원상복구)`)
  await prisma.$disconnect()
}

main()
