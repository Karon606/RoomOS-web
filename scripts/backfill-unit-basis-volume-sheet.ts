// 봉투류(부피 규격 + 매·장 수량)의 단가 기준을 '개당'으로 적어 둔다 — 운영자 승인 백필(2026-09-17).
//
//   예행   npx tsx --env-file=.env.local scripts/backfill-unit-basis-volume-sheet.ts
//   적용   npx tsx --env-file=.env.local scripts/backfill-unit-basis-volume-sheet.ts --apply
//   원복   npx tsx --env-file=.env.local scripts/backfill-unit-basis-volume-sheet.ts --revert <snapshot.json>
//
// 왜(신고 73c18e13). 종량제봉투 50L 20매 25,000원은 **1매 1,250원**이지 리터당 25원이 아니다
// (운영자 지적 2026-08-05). 생성 경로는 같은 회차에서 고쳤고(lib/unitBasis 정본 + 다섯 자리 배선),
// 이 스크립트는 그 전에 생긴 행의 **기록을 채운다.** 고친 코드만으로도 화면은 이미 개당으로 읽히지만
// (기록이 없으면 정본 규칙이 답한다), 장부에 답이 남아 있는 편이 낫다 — 다음 구매의 프리필이
// '이전에 어떻게 저장했는지'를 물을 때 규칙이 아니라 기록으로 답하게 된다.
//
// **돈은 한 톨도 안 움직인다.** amount·qtyValue·specValue·specUnit·qtyUnit 는 손대지 않는다.
// 재고 환산(lib/units 의 specMultiplier)은 specValue·specUnit·품목 단위로만 계산하고 unitBasis 를
// 아예 보지 않는다 — 이 백필로 재고 수량이 바뀔 경로가 구조적으로 없다(2026-09-17 확인).
//
// 대상: 규격 단위가 부피이고 수량 단위가 매·장인 행(정본 isVolumeSizeLabel) 중 unitBasis 가
// 'qty' 가 아닌 것. 이미 'qty' 면 건너뛴다(멱등). 멀티테넌트 — 전 영업장을 같은 규칙으로 본다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync, writeFileSync } from 'node:fs'
import { isVolumeSizeLabel } from '../lib/units'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
const APPLY = process.argv.includes('--apply')
const REVERT_AT = process.argv.indexOf('--revert')

type Snap = { id: string; unitBasis: string | null }

async function revert(file: string) {
  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snap[]
  for (const s of snap) {
    await prisma.expense.update({ where: { id: s.id }, data: { unitBasis: s.unitBasis } })
  }
  console.log(`되돌림 ${snap.length}행`)
}

async function main() {
  if (REVERT_AT >= 0) {
    const file = process.argv[REVERT_AT + 1]
    if (!file) throw new Error('--revert 뒤에 스냅샷 파일 경로를 달아라.')
    await revert(file)
    await prisma.$disconnect()
    return
  }

  const rows = await prisma.expense.findMany({
    select: {
      id: true, date: true, itemLabel: true, amount: true,
      specValue: true, specUnit: true, qtyValue: true, qtyUnit: true, unitBasis: true,
    },
    orderBy: { date: 'asc' },
  })
  const sized = rows.filter(r => isVolumeSizeLabel(r.specUnit, r.qtyUnit))
  const targets = sized.filter(r => r.unitBasis !== 'qty')

  console.log(`\n지출 ${rows.length}행 / 부피 규격 + 매·장 수량 ${sized.length}행 / 고칠 행 ${targets.length}건`
    + `${sized.length !== targets.length ? ` (이미 개당 ${sized.length - targets.length}건 제외)` : ''}`)

  const byLabel = new Map<string, number>()
  for (const r of targets) byLabel.set(r.itemLabel ?? '(품명 없음)', (byLabel.get(r.itemLabel ?? '(품명 없음)') ?? 0) + 1)
  for (const [label, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${label}: ${n}건`)

  console.log('\n--- 한 건씩 (금액·수량·규격 불변, 기준만) ---')
  for (const r of targets) {
    const q = Number(r.qtyValue) || 1
    const spec = Number(r.specValue) || 1
    const before = Math.round(r.amount / (q * spec))
    const after = Math.round(r.amount / q)
    console.log(`  ${r.date.toISOString().slice(0, 10)} [${r.itemLabel}] ${r.specValue}${r.specUnit} x ${r.qtyValue}${r.qtyUnit}`
      + ` ${r.amount.toLocaleString()}원 · 기준 ${r.unitBasis ?? '미기록'} -> qty`
      + ` · 표시 단가 ${before.toLocaleString()}원/${r.specUnit} -> ${after.toLocaleString()}원/${r.qtyUnit}`)
  }

  if (!APPLY) {
    console.log(`\n예행이다 — 쓰지 않았다. 적용하려면 --apply 를 붙인다.`)
    await prisma.$disconnect()
    return
  }
  if (targets.length === 0) {
    console.log('\n고칠 행이 없다(이미 멱등).')
    await prisma.$disconnect()
    return
  }

  const snap: Snap[] = targets.map(r => ({ id: r.id, unitBasis: r.unitBasis }))
  const file = `backfill-unit-basis-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
  writeFileSync(file, JSON.stringify(snap, null, 2))
  console.log(`\n되돌리기 스냅샷 ${file} (${snap.length}행)`)

  await prisma.expense.updateMany({ where: { id: { in: targets.map(r => r.id) } }, data: { unitBasis: 'qty' } })
  console.log(`${targets.length}건 적용 완료.`)

  const left = await prisma.expense.findMany({
    select: { id: true, specUnit: true, qtyUnit: true, unitBasis: true },
  }).then(rs => rs.filter(r => isVolumeSizeLabel(r.specUnit, r.qtyUnit) && r.unitBasis !== 'qty'))
  console.log(`적용 뒤 남은 대상 ${left.length}건 (0 이어야 한다)`)
  await prisma.$disconnect()
}
main()
