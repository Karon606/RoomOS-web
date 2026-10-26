// 갚을 것이 아닌데 미정산으로 남은 지출을 정산완료로 돌리는 정리 스크립트. 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (신고 2f0f9f4c, 운영자 승인 2026-10-26). 신용카드 주문의 착불 배송비 행을 계좌이체로 고쳤는데 수정 경로가 배송비 행의
// 정산상태를 판정 없이 지켜 미정산이 남았고, 카드 정산 화면에 저축예금으로 낸 배송비가 떴다. 저장 경로는 정본
// lib/settleStatus(배송비 행도 같은 규칙, 갚을 것이 아니면 언제나 정산완료)로 고쳤다. 이 스크립트는 이미 남은 행만 정리하고,
// 새로 생기는 것은 데이터 그물 scripts/check-settle-status-drift.ts(verify:db)가 잡는다. 판정은 두 곳 모두 isDeferredRow 하나다.
// 2026-10-26 조회 기준 대상은 1건(id 48708907…, 착불 배송비 6,000원 계좌이체)이다.
//
// 바꾸는 것은 settleStatus 한 칸뿐이다. 돈·날짜·결제수단은 안 건드린다(정산상태는 표시 플래그다).
// 적용은 행마다 지금 상태를 다시 확인하고(CAS: 미정산·결제수단·배송비 여부가 예행 때와 같을 때만) 쓴다.
// 되돌림도 같다(정산완료·결제수단이 적용 때와 같을 때만 미정산으로).
//
// 실행: npx tsx --env-file=.env.local scripts/fix-noncredit-unsettled.ts [--property <영업장 id>] [--apply | --revert <undo.json>]
import fs from 'node:fs'
import path from 'node:path'
import prisma from '../lib/prisma'
import { isDeferredRow } from '../lib/settleStatus'

type UndoRow = { id: string; propertyId: string; payMethod: string | null; isShipping: boolean; shippingType: string | null }
type UndoFile = { kind: 'fix-noncredit-unsettled'; appliedAt: string; rows: UndoRow[] }

const argValue = (flag: string) => {
  const i = process.argv.indexOf(flag)
  return i > 0 ? process.argv[i + 1] : undefined
}

async function revert(file: string) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as UndoFile
  if (snap.kind !== 'fix-noncredit-unsettled' || !Array.isArray(snap.rows)) throw new Error('이 스크립트의 되돌림 파일이 아니다')
  let done = 0
  const skipped: string[] = []
  for (const r of snap.rows) {
    const res = await prisma.expense.updateMany({
      where: { id: r.id, propertyId: r.propertyId, settleStatus: 'SETTLED', payMethod: r.payMethod, isShipping: r.isShipping },
      data: { settleStatus: 'UNSETTLED' },
    })
    if (res.count === 1) done++
    else skipped.push(r.id.slice(0, 8))
  }
  console.log(`되돌림: 미정산으로 ${done}건${skipped.length ? ` · 그 사이 바뀌어 건너뜀 ${skipped.length}건(${skipped.join(', ')})` : ''}`)
}

async function main() {
  const revertFile = argValue('--revert')
  if (revertFile) return revert(revertFile)

  const propertyId = argValue('--property')
  const rows = await prisma.expense.findMany({
    where: { settleStatus: 'UNSETTLED', ...(propertyId ? { propertyId } : {}) },
    select: { id: true, propertyId: true, date: true, amount: true, payMethod: true, financeName: true, isShipping: true, detail: true, order: { select: { shippingType: true } } },
    orderBy: { date: 'asc' },
  })
  const targets = rows.filter(r => !isDeferredRow({ payMethod: r.payMethod, isShipping: r.isShipping, shippingType: r.order?.shippingType ?? null }))
  console.log(`미정산 ${rows.length}건 중 갚을 것이 아닌 행 ${targets.length}건${propertyId ? ` (영업장 ${propertyId.slice(0, 8)})` : ' (전 영업장)'}`)
  for (const r of targets) {
    console.log(`  - ${r.id.slice(0, 8)} 영업장 ${r.propertyId.slice(0, 8)} ${r.date.toISOString().slice(0, 10)} ${r.amount}원 ${r.payMethod ?? '-'} ${r.financeName ?? ''}${r.isShipping ? ` · 배송비(${r.order?.shippingType ?? '결제구분 없음'})` : ''} ${r.detail ?? ''} · 미정산 -> 정산완료`)
  }
  if (targets.length === 0) return
  if (!process.argv.includes('--apply')) { console.log('예행만 했다. 적용은 --apply'); return }

  const applied: UndoRow[] = []
  const skipped: string[] = []
  await prisma.$transaction(async tx => {
    for (const r of targets) {
      // CAS. 예행 뒤 결제수단이 신용카드로 바뀌었거나 이미 정산됐으면 쓰지 않는다. 배송비 결제구분도 다시 본다.
      const now = await tx.expense.findFirst({ where: { id: r.id, propertyId: r.propertyId }, select: { order: { select: { shippingType: true } } } })
      const shippingType = now?.order?.shippingType ?? null
      if (!now || isDeferredRow({ payMethod: r.payMethod, isShipping: r.isShipping, shippingType })) { skipped.push(r.id.slice(0, 8)); continue }
      const res = await tx.expense.updateMany({
        where: { id: r.id, propertyId: r.propertyId, settleStatus: 'UNSETTLED', payMethod: r.payMethod, isShipping: r.isShipping },
        data: { settleStatus: 'SETTLED' },
      })
      if (res.count === 1) applied.push({ id: r.id, propertyId: r.propertyId, payMethod: r.payMethod, isShipping: r.isShipping, shippingType })
      else skipped.push(r.id.slice(0, 8))
    }
  })
  if (applied.length === 0) { console.log(`적용한 행이 없다(그 사이 바뀜 ${skipped.length}건)`); return }
  // 저장소 루트 기준 절대 경로(scripts/ 아래). 어느 폴더에서 돌려도 같은 자리에 쓰고, 되돌림 명령을 그대로 붙여 쓸 수 있다.
  const file = path.resolve(path.dirname(path.resolve(process.argv[1])), `.fix-noncredit-unsettled-undo-${Date.now()}.json`)
  const undo: UndoFile = { kind: 'fix-noncredit-unsettled', appliedAt: new Date().toISOString(), rows: applied }
  // 되돌림 파일은 실제로 바꾼 행만 담는다(건너뛴 행을 담으면 되돌림이 남이 정산한 행까지 미정산으로 돌린다).
  // 그래서 쓰기 뒤에 적는다. 파일을 못 쓰면 같은 내용을 화면에 남겨 손으로 옮길 수 있게 한다.
  try { fs.writeFileSync(file, JSON.stringify(undo, null, 2)) } catch (e) {
    console.error(`되돌림 파일을 못 썼다(${(e as Error).message}). 아래 내용을 ${file} 로 저장해 --revert 에 쓴다.`)
    console.error(JSON.stringify(undo))
  }
  console.log(`적용했다: 정산완료 ${applied.length}건${skipped.length ? ` · 그 사이 바뀌어 건너뜀 ${skipped.length}건(${skipped.join(', ')})` : ''}`)
  console.log(`되돌리기: npx tsx --env-file=.env.local scripts/fix-noncredit-unsettled.ts --revert '${file}'`)
}

main().finally(() => prisma.$disconnect())
