// 수전 세트 수량 정정(오류신고 91b812ce, 운영자 승인 2026-07-22) — 합치기가 세트 구성(3개)을 파괴해
// 1개로 남은 행을 3개·개당 32,500원(총액 97,500 불변)으로 정정. specText '2홀 무광'은 운영자 지시로 제거
// (기존 무규격 수전 카드와 완전 통합). 관련 합치기 이력(MergeRun 8394fd2a)은 undoneAt 처리해
// 나중에 적용취소 시 '3세트=9개' 모순이 생기지 않게 한다.
// 기본 드라이런. 적용: node --env-file=.env.local scripts/fix-faucet-set.mjs --apply
// 되돌리기: 아래 스냅샷 값으로 원복(qtyValue 1·specText '2홀 무광'·detail 원문·MergeRun undoneAt null).
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })
const APPLY = process.argv.includes('--apply')

const EXPENSE_ID = '9fc254df-4a79-429f-bb36-9f9693aecd80'
const MERGE_RUN_PREFIX = '8394fd2a'
const NEW_DETAIL = '[세면대 샤워기 겸용 수전] x 3개'

async function main() {
  const e = await prisma.expense.findUnique({ where: { id: EXPENSE_ID } })
  if (!e) { console.error('지출 행 없음 — 중단'); process.exit(1) }
  console.log('현재(되돌리기용):', JSON.stringify({ itemLabel: e.itemLabel, qtyValue: e.qtyValue, qtyUnit: e.qtyUnit, specValue: e.specValue, specUnit: e.specUnit, specText: e.specText, unitBasis: e.unitBasis, detail: e.detail, amount: e.amount }))
  if (e.qtyValue === 3 && e.specText == null) { console.log('이미 정정된 상태 — 할 일 없음.'); await prisma.$disconnect(); return }
  if (e.qtyValue !== 1 || e.amount !== 97500) { console.error('기대 원값(qty 1, 97,500원) 아님 — 수동 확인 필요, 중단'); process.exit(1) }
  console.log('계획: qtyValue 1 -> 3, specText 제거, unitBasis qty, detail ->', NEW_DETAIL, '(총액 97,500 불변, 개당 32,500)')

  const runs = (await prisma.itemNameMergeRun.findMany({ where: { undoneAt: null } })).filter(r => r.id.startsWith(MERGE_RUN_PREFIX))
  console.log('합치기 이력:', runs.length === 1 ? `${runs[0].id.slice(0, 8)} undoneAt 처리 예정` : `매칭 ${runs.length}건(1건 아니면 이력은 건드리지 않음)`)

  if (!APPLY) { console.log('드라이런 종료 — 적용하려면 --apply'); await prisma.$disconnect(); return }

  await prisma.$transaction([
    prisma.expense.update({
      where: { id: EXPENSE_ID },
      data: { qtyValue: 3, specText: null, unitBasis: 'qty', detail: NEW_DETAIL },
    }),
    ...(runs.length === 1 ? [prisma.itemNameMergeRun.update({ where: { id: runs[0].id }, data: { undoneAt: new Date() } })] : []),
  ])
  console.log('적용 완료.')
  await prisma.$disconnect()
}
main()
