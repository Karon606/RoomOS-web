// 쪼개진 지출 조각이 원행의 사업자번호·브랜드·제품명·서술 규격·단가 기준·시공/자재 표식을 잃었는지 보는 감지망(verify:db). 읽기 전용.
// 실행: npx tsx --env-file=.env.local scripts/check-clone-field-loss.ts
//
// 왜 (2026-10-20, 신고 a0636f36 재무 패널 실측). 소모품 부분 수령이 손 복제 목록이라 받은 조각에서 사업자번호·브랜드가
// 사라졌다. 생성 경로는 정본(app/(app)/inventory/expenseClone)으로 고쳤고 소스 그물(check-asset-disposal-wiring)이 스키마와
// 대조한다. 이 그물은 장부 쪽이다. 새 쪼개는 길이 정본을 안 거치면 여기가 먼저 운다.
// 판정은 백필과 같은 정본(lib/cloneFieldLoss planCloneFieldRestore)이다. 같은 묶음 원행에 값이 있고 같은 구매의 뒤 조각이
// 비었을 때만 센다.
//   오류 · 정본화가 배포된 뒤(DEPLOYED_AT 이후) 생겼고 **생긴 뒤 손대지 않은**(updatedAt 이 createdAt 과 2초 안) 조각의 유실.
//          새 쪼개는 길이 정본을 빠져나갔다는 뜻이다. 생긴 뒤 운영자가 고친 조각은 정당한 수정일 수 있어 경고로 둔다.
//   경고 · 그 밖의 유실(배포 전 옛 코드가 만든 조각 포함). scripts/fix-clone-field-loss 로 채운다(운영자 확인 뒤, 예행 먼저).
// DEPLOYED_AT 은 배포가 끝난 뒤 그 시각으로 적는다(또는 환경 변수 CLONE_LOSS_DEPLOYED_AT). 비어 있으면 전부 경고다.
// 날짜를 미리 박으면 배포 전 운영(옛 코드)에서 생긴 조각이 오류가 되어 푸시가 막힌다(독립 검수 2026-10-20).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { planCloneFieldRestore } from '../lib/cloneFieldLoss'

// 소모품 부분 수령 복제 정본화가 운영에 배포된 시각. 배포 뒤 적는다. null 이면 오류 축을 끈다(전부 경고).
const DEPLOYED_AT: Date | null = process.env.CLONE_LOSS_DEPLOYED_AT ? new Date(process.env.CLONE_LOSS_DEPLOYED_AT) : null
// 생긴 뒤 손대지 않은 조각으로 보는 간격(쪼개는 저장 한 번 안의 시차).
const UNTOUCHED_MS = 2000

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  try {
    const rows = await prisma.expense.findMany({
      where: { allocationGroupId: { not: null } },
      select: {
        id: true, allocationGroupId: true, createdAt: true, updatedAt: true, itemLabel: true, category: true, date: true, vendor: true,
        vendorBizNo: true, brand: true, productName: true, specText: true, unitBasis: true, costKind: true,
      },
    })
    const byId = new Map(rows.map(r => [r.id, r]))
    const plan = planCloneFieldRestore(rows.map(r => ({ ...r, date: r.date.toISOString().slice(0, 10) })))
    const isFresh = (id: string) => {
      const r = byId.get(id)!
      return !!DEPLOYED_AT && !Number.isNaN(DEPLOYED_AT.getTime()) && r.createdAt >= DEPLOYED_AT && Math.abs(r.updatedAt.getTime() - r.createdAt.getTime()) < UNTOUCHED_MS
    }
    const fresh = plan.filter(p => isFresh(p.id))
    const old = plan.filter(p => !isFresh(p.id))
    console.log(`[분할 복제 유실] 오류 ${fresh.length}칸 · 경고 ${old.length}칸${DEPLOYED_AT ? '' : '(배포 시각 미기록이라 오류 축 꺼짐)'} · 묶음 ${new Set(rows.map(r => r.allocationGroupId)).size}개 검사`)
    if (old.length) console.log(`  · 조각 ${new Set(old.map(p => p.id)).size}행이 원행 칸을 잃었다(${[...new Set(old.map(p => p.field))].join('·')}). scripts/fix-clone-field-loss 예행으로 확인한 뒤 운영자 확인을 받아 --apply`)
    if (fresh.length) {
      for (const p of fresh) {
        const r = byId.get(p.id)!
        console.error(`  - 조각 ${p.id.slice(0, 8)} '${r.itemLabel ?? ''}' 이 원행 ${p.originId.slice(0, 8)} 의 ${p.field}(${p.value}) 를 잃었다. 쪼개는 길이 cloneExpenseScalars 를 안 거친다`)
      }
      process.exit(1)
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
