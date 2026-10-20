// 분할 복제가 빠뜨린 칸(사업자번호·브랜드·제품명·서술 규격·단가 기준·시공/자재 표식)을 같은 묶음 원행에서만 되살리는 일회성 정정. 예행 기본, --apply 적용, --revert <undo.json> 되돌림.
//
// 왜 (2026-10-20, 신고 a0636f36 재무 패널 실측). 소모품 부분 수령(confirmReceipt)의 손 복제 목록과 2026-09-16 이전 비품
// 분할 목록이 칸을 빠뜨려, 쪼개져 나온 조각에서만 그 칸이 비었다(IKEA 매트리스 커버 3행 중 2행, 유한회사 콰이디 흡음패널
// 2행 중 1행 등). 생성 경로는 같은 커밋에서 정본(app/(app)/inventory/expenseClone)으로 고쳤고, 재발은
// scripts/check-clone-field-loss 가 본다. 이 스크립트는 이미 빠진 행만 채운다.
//
// 무엇을 하나. 판정 정본 lib/cloneFieldLoss planCloneFieldRestore 가 고른 (행, 칸) 만 쓴다. 같은 allocationGroupId 묶음의
// 원행(가장 먼저 만들어진 행 하나)에 값이 있고, 같은 구매(품명·카테고리·날짜·구매처)인 뒤 조각이 비었을 때만이다.
// 쓰기는 칸이 아직 비어 있을 때만 한다(조건부 갱신). 예행과 적용 사이에 누가 그 칸을 채웠으면 건너뛴다.
// 무엇을 안 하나. 금액·수량·날짜·자리 칸은 안 건드린다(돈·재고 계산 불변). 원행이 비고 조각에만 값이 있으면 안 퍼뜨린다.
//
// 되돌리기 파일(scripts/.fix-clone-field-loss-undo-<ts>.json)에는 실제로 쓴 (행, 칸, 값)만 담는다. 되돌림은 지금 그 칸이
// 그 값 그대로일 때만 비운다(그사이 운영자가 고쳤으면 건너뛴다). 파일은 커밋하지 않는다(.gitignore 의 scripts/.fix-*-undo-*.json).
//
// 실행 방법.
//   예행    npx tsx --env-file=.env.local scripts/fix-clone-field-loss.ts
//   적용    npx tsx --env-file=.env.local scripts/fix-clone-field-loss.ts --apply
//   되돌림  npx tsx --env-file=.env.local scripts/fix-clone-field-loss.ts --revert scripts/.fix-clone-field-loss-undo-<ts>.json
import fs from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { planCloneFieldRestore, CLONE_LOSS_FIELDS, type CloneLossField } from '../lib/cloneFieldLoss'

const APPLY = process.argv.includes('--apply')
const REVERT_IDX = process.argv.indexOf('--revert')

type UndoFile = { v: 1; kind: 'clone-field-loss'; at: string; rows: { id: string; field: CloneLossField; value: string }[] }

const isField = (f: unknown): f is CloneLossField => typeof f === 'string' && (CLONE_LOSS_FIELDS as readonly string[]).includes(f)
const ymd = (d: Date) => d.toISOString().slice(0, 10)

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  try {
    if (REVERT_IDX >= 0) {
      const file = process.argv[REVERT_IDX + 1]
      if (!file) throw new Error('되돌리기 파일 경로가 없습니다.')
      const undo = JSON.parse(fs.readFileSync(file, 'utf8')) as UndoFile
      if (undo?.v !== 1 || undo.kind !== 'clone-field-loss' || !Array.isArray(undo.rows)) throw new Error('되돌리기 파일 형식이 아닙니다.')
      let done = 0, skipped = 0
      await prisma.$transaction(async tx => {
        for (const r of undo.rows) {
          if (!isField(r.field) || typeof r.id !== 'string' || typeof r.value !== 'string') { skipped++; continue }
          const res = await tx.expense.updateMany({ where: { id: r.id, [r.field]: r.value }, data: { [r.field]: null } })
          if (res.count === 1) done++; else skipped++
        }
      }, { isolationLevel: 'Serializable' })
      console.log(`[되돌림] 비움 ${done}칸 · 그사이 바뀌어 건너뜀 ${skipped}칸`)
      return
    }

    const rows = await prisma.expense.findMany({
      where: { allocationGroupId: { not: null } },
      select: {
        id: true, propertyId: true, allocationGroupId: true, createdAt: true, itemLabel: true, category: true, date: true, vendor: true,
        vendorBizNo: true, brand: true, productName: true, specText: true, unitBasis: true, costKind: true, amount: true, detail: true,
      },
      orderBy: { createdAt: 'asc' },
    })
    const props = new Map((await prisma.property.findMany({ select: { id: true, name: true } })).map(p => [p.id, p.name]))
    const byId = new Map(rows.map(r => [r.id, r]))
    const plan = planCloneFieldRestore(rows.map(r => ({ ...r, date: ymd(r.date) })))

    const byField = new Map<string, number>()
    for (const p of plan) byField.set(p.field, (byField.get(p.field) ?? 0) + 1)
    console.log(`[분할 복제 유실 복구] ${APPLY ? '적용' : '예행'} · 대상 ${plan.length}칸 · 행 ${new Set(plan.map(p => p.id)).size}개 · 묶음 ${new Set(plan.map(p => p.groupId)).size}개`)
    console.log(`  칸별 ${[...byField.entries()].map(([f, n]) => `${f} ${n}`).join(' · ') || '없음'}`)
    for (const gid of [...new Set(plan.map(p => p.groupId))]) {
      const items = plan.filter(p => p.groupId === gid)
      const o = byId.get(items[0].originId)!
      console.log(`  [${props.get(o.propertyId) ?? o.propertyId.slice(0, 8)}] 묶음 ${gid.slice(0, 8)} · ${o.vendor ?? '구매처 없음'} · ${o.itemLabel ?? '품명 없음'} (${ymd(o.date)}) 원행 ${o.id.slice(0, 8)}`)
      for (const id of [...new Set(items.map(p => p.id))]) {
        const r = byId.get(id)!
        const fields = items.filter(p => p.id === id).map(p => `${p.field}=${p.value}`).join(', ')
        console.log(`    조각 ${id.slice(0, 8)} ${r.amount.toLocaleString()}원 · ${fields}`)
      }
    }
    if (!APPLY) { console.log('  예행이라 쓰지 않았습니다. 적용은 --apply.'); return }
    if (plan.length === 0) { console.log('  쓸 칸이 없습니다.'); return }

    const written: UndoFile['rows'] = []
    let skipped = 0
    await prisma.$transaction(async tx => {
      for (const p of plan) {
        // 칸이 아직 비어 있을 때만 쓴다(예행 뒤 누가 채웠으면 건너뛴다).
        const res = await tx.expense.updateMany({ where: { id: p.id, [p.field]: null }, data: { [p.field]: p.value } })
        if (res.count === 1) written.push({ id: p.id, field: p.field, value: p.value }); else skipped++
      }
    }, { isolationLevel: 'Serializable' })
    const file = `scripts/.fix-clone-field-loss-undo-${new Date().toISOString().replace(/[:.]/g, '-')}.json`
    const undo: UndoFile = { v: 1, kind: 'clone-field-loss', at: new Date().toISOString(), rows: written }
    fs.writeFileSync(file, JSON.stringify(undo, null, 2))
    console.log(`  채움 ${written.length}칸 · 그사이 채워져 건너뜀 ${skipped}칸 · 되돌리기 파일 ${file}`)
  } finally {
    await prisma.$disconnect()
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exit(1) })
