// 재활용품수거봉투 100L 지출 1건의 단위를 '매'로, 단위가 빈 폐기물 봉투 재고 카드 넷을 '매'로 채우는 일회성 정정. 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜 (2026-10-09, 운영자 승인). 한 지출에 60L·100L 두 줄을 '개'로 적었는데 저장 직전 단위 확인창이
// 60L 만 묻고 100L 은 묻지 않았다. 100L 카드의 qtyUnit 이 품목 병합 때 null('어떤 단위든 받는 카드')이
// 되어 조회에서 빠졌기 때문이다. 생성 경로는 확인창이 이력 최빈 단위로 묻게 고쳐 막았다(lib/unitMismatch).
// 같은 상태의 개수 추적 카드가 넷이고 이력은 전부 '매'라 카드 단위를 '매'로 못박는다.
// 재발 감지는 scripts/check-qty-card-unit-gap.mjs(verify:db).
//
// 실행: npx tsx --env-file=.env.local scripts/fix-bag-unit-1009.ts [--apply | --revert <undo.json>]
import fs from 'node:fs'
import prisma from '../lib/prisma'
import { cleanUnit } from '../lib/receiptOcr'

const EXPENSE_ID = '15163657-392f-42a4-871f-975501a67208'
const EXPENSE_LABEL = '재활용품수거봉투 100L'
const CATEGORY = '폐기물 처리비'
const FROM = '개'
const TO = '매'
const CARDS: { id: string; label: string }[] = [
  { id: '4ad37bfe-ea1d-42b8-8d02-d020ab358ffb', label: '재활용품수거봉투 100L' },
  { id: 'af62b8ed-d5eb-47f3-a378-6826a57ae4e2', label: '종량제쓰레기봉투 50L' },
  { id: '2f5bef3a-c32e-4e1c-bcd5-bbd3eb42d01d', label: '음식물쓰레기봉투 (5L)' },
  { id: '50cd3c33-3e29-42e8-8653-72e39b50b81e', label: '음식물쓰레기봉투 (10L)' },
]

type Row =
  | { table: 'expense'; id: string; before: { qtyUnit: string | null; detail: string | null }; after: { qtyUnit: string; detail: string } }
  | { table: 'trackedItem'; id: string; label: string; before: { qtyUnit: string | null }; after: { qtyUnit: string } }

// 다품목 지출의 detail 조립과 같은 꼴(app/(app)/finance/actions.ts addExpense 의 itemCreates).
function itemDetail(e: { itemLabel: string; specText: string | null; specValue: number | null; specUnit: string | null; qtyValue: number | null }, qtyUnit: string) {
  const spec = e.specText ? ` ${e.specText}` : e.specValue ? ` ${e.specValue}${cleanUnit(e.specUnit) ?? ''}` : ''
  const qty = e.qtyValue ? ` x ${e.qtyValue}${cleanUnit(qtyUnit) ?? ''}` : ''
  return `[${e.itemLabel}]${spec}${qty}`
}

async function revert(file: string) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as { rows: Row[] }
  // 다섯 행 모두 지금 값이 적용값과 같은지 먼저 본다. 하나라도 다르면 아무것도 되돌리지 않는다.
  for (const r of snap.rows) {
    if (r.table === 'expense') {
      const cur = await prisma.expense.findUnique({ where: { id: r.id }, select: { qtyUnit: true, detail: true } })
      if (cur?.qtyUnit !== r.after.qtyUnit || cur?.detail !== r.after.detail) throw new Error(`지출 ${r.id} 현재 값(${cur?.qtyUnit} / ${cur?.detail})이 적용값과 달라 되돌리지 않는다`)
    } else {
      const cur = await prisma.trackedItem.findUnique({ where: { id: r.id }, select: { qtyUnit: true } })
      if (cur?.qtyUnit !== r.after.qtyUnit) throw new Error(`카드 ${r.label} 현재 단위 ${cur?.qtyUnit} 이 적용값 ${r.after.qtyUnit} 과 달라 되돌리지 않는다`)
    }
  }
  await prisma.$transaction(snap.rows.map(r => r.table === 'expense'
    ? prisma.expense.update({ where: { id: r.id }, data: { qtyUnit: r.before.qtyUnit, detail: r.before.detail } })
    : prisma.trackedItem.update({ where: { id: r.id }, data: { qtyUnit: r.before.qtyUnit } })))
  for (const r of snap.rows) {
    if (r.table === 'expense') console.log(`되돌림: 지출 ${r.id.slice(0, 8)} qtyUnit ${r.after.qtyUnit} -> ${r.before.qtyUnit} · detail "${r.after.detail}" -> "${r.before.detail}"`)
    else console.log(`되돌림: 카드 ${r.label} qtyUnit ${r.after.qtyUnit} -> ${r.before.qtyUnit}`)
  }
}

async function main() {
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx > 0) return revert(process.argv[revertIdx + 1])

  // ── 지출 1건 ──
  const e = await prisma.expense.findUnique({
    where: { id: EXPENSE_ID },
    select: { propertyId: true, date: true, category: true, detail: true, itemLabel: true, specText: true, specValue: true, specUnit: true, qtyValue: true, qtyUnit: true },
  })
  if (!e || e.itemLabel !== EXPENSE_LABEL || e.category !== CATEGORY || e.date.toISOString().slice(0, 10) !== '2026-10-09') throw new Error('대상 지출이 예상과 다르다')
  if (e.qtyUnit !== FROM) throw new Error(`지출 단위가 '${FROM}' 이 아니다(${e.qtyUnit}). 예상한 상태가 아니라 멈춘다`)
  const item = { ...e, itemLabel: e.itemLabel }
  const detailBefore = itemDetail(item, FROM)
  if (e.detail !== detailBefore) throw new Error(`detail "${e.detail}" 이 조립 꼴 "${detailBefore}" 과 달라 멈춘다`)
  const detailAfter = itemDetail(item, TO)
  const rows: Row[] = [{ table: 'expense', id: EXPENSE_ID, before: { qtyUnit: e.qtyUnit, detail: e.detail }, after: { qtyUnit: TO, detail: detailAfter } }]
  console.log(`지출 ${EXPENSE_ID.slice(0, 8)} ${e.date.toISOString().slice(0, 10)}: qtyUnit ${FROM} -> ${TO} · detail "${e.detail}" -> "${detailAfter}"`)

  // ── 재고 카드 넷 ──
  for (const want of CARDS) {
    const c = await prisma.trackedItem.findUnique({
      where: { id: want.id },
      select: { propertyId: true, category: true, label: true, qtyUnit: true, trackUnit: true, isArchived: true },
    })
    if (!c || c.label !== want.label) throw new Error(`카드 ${want.id} 의 품명이 '${want.label}' 이 아니다(${c?.label})`)
    if (c.propertyId !== e.propertyId || c.category !== CATEGORY || c.isArchived || c.trackUnit !== 'qty') throw new Error(`카드 '${c.label}' 이 같은 영업장의 활성 개수 추적 카드가 아니다`)
    if (c.qtyUnit !== null) throw new Error(`카드 '${c.label}' 의 단위가 null 이 아니다(${c.qtyUnit}). 예상한 상태가 아니라 멈춘다`)
    const hist = await prisma.expense.findMany({
      where: { propertyId: c.propertyId, category: c.category, itemLabel: c.label },
      select: { id: true, qtyUnit: true },
    })
    // 위에서 고치는 지출은 고친 뒤 값으로 센다.
    const units = hist.map(h => (h.id === EXPENSE_ID ? TO : h.qtyUnit))
    const other = units.filter(u => u !== TO)
    if (!hist.length) throw new Error(`카드 '${c.label}' 의 지출 이력이 없다`)
    if (other.length) throw new Error(`카드 '${c.label}' 의 지출 이력에 '${TO}' 아닌 단위가 있다(${other.map(u => u ?? 'null').join(', ')})`)
    rows.push({ table: 'trackedItem', id: want.id, label: c.label, before: { qtyUnit: null }, after: { qtyUnit: TO } })
    const incl = hist.some(h => h.id === EXPENSE_ID) ? '(위 정정 1건 포함)' : ''
    console.log(`카드 ${c.label}: qtyUnit null -> ${TO} · 지출 이력 ${hist.length}건 전부 '${TO}'${incl}`)
  }

  if (!process.argv.includes('--apply')) { console.log('예행만 했다. 적용은 --apply'); return }

  const file = `scripts/.fix-bag-unit-1009-undo-${Date.now()}.json`
  fs.writeFileSync(file, JSON.stringify({ rows }, null, 2))
  await prisma.$transaction(rows.map(r => r.table === 'expense'
    ? prisma.expense.update({ where: { id: r.id }, data: { qtyUnit: r.after.qtyUnit, detail: r.after.detail } })
    : prisma.trackedItem.update({ where: { id: r.id }, data: { qtyUnit: r.after.qtyUnit } })))
  console.log(`적용했다(${rows.length}행). 되돌리기: npx tsx --env-file=.env.local scripts/fix-bag-unit-1009.ts --revert ${file}`)
}

main().finally(() => prisma.$disconnect())
