// 고아 재고 카드 감사(신고 f3866bca '옥상 폐기물처리'). 기본은 읽기 전용 목록이고 verify:db 에서 '실패' 0건이 정상이다.
//
// 빈 카드 = 숨기지 않은 카드인데 재고에 들어가는 구매(재고 제외·배송비 행 빼고)가 0 이고 점검·입수·폐기·위치 연결·점검 임시저장도 0.
// 둘로 나눠 보여 준다.
//   실패: 그 품명으로 적힌 지출 흔적(재고 제외·배송비·다른 카테고리)이 있고 운영자가 손질한 칸이 없는 카드. 앱 정본
//          trackedItemSnapshot.retireTrackedItemIfOrphan 이 지금 지울 카드와 같은 판정이다. 생성 경로는 2026-10-26 에 정리를 붙였다.
//   참고: 흔적이 전혀 없는 빈 카드(같은 카테고리 안 품명 변경으로 남은 고아일 수도, 손으로 만든 새 품목일 수도 있다)와,
//          흔적은 있지만 손질한 칸(구매 링크·발주 메모·메모·알림 임계값이 기본 7 아님)이 있는 카드. 실패로 세지 않는다.
//          사용자 순서(sortOrder)는 손질로 안 본다. 끌어 저장하면 그 카테고리 전 카드에 붙는다(재검수 B-1).
//          판단 근거로 생성 시각·경과 일수·같은 카테고리의 비슷한 이름 카드를 함께 적는다(독립 검수 B1·R5, 2026-10-27).
// 손질 판정은 앱 정본 trackedItemSnapshot.cardHandTouched 와 같은 네 칸이다(바꾸면 함께).
//
// 사용(운영 DB 는 읽기만 하는 목록이 기본):
//   node --env-file=.env.local scripts/check-tracked-orphans.mjs [--property <영업장 id>] [--label <이름> ...]
//   node --env-file=.env.local scripts/check-tracked-orphans.mjs --fix --property <영업장 id> --id <카드 id> [--id ...]
//        운영자가 id 로 고른 카드만 지운다(실패·참고 어느 쪽이든 빈 카드 조건은 다시 확인한다). 스냅샷 파일을 먼저 쓴다.
//   node --env-file=.env.local scripts/check-tracked-orphans.mjs --undo <파일>     그 파일의 카드를 같은 id 로 되살림
// --label 과 --fix 는 --property 없이는 받지 않는다(여러 영업장에 같은 이름이 있을 수 있다).
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const argv = process.argv.slice(2)
const many = flag => argv.flatMap((a, i) => (a === flag && argv[i + 1] && !argv[i + 1].startsWith('--') ? [argv[i + 1]] : []))
const FIX = argv.includes('--fix')
const undoIdx = argv.indexOf('--undo')
const PROPERTY = many('--property')[0] ?? null
const LABELS = many('--label')
const IDS = many('--id')
if ((LABELS.length || FIX) && !PROPERTY) {
  console.error('--label·--fix 는 --property <영업장 id> 와 함께 줄 것(여러 영업장에 같은 이름이 있을 수 있다).')
  process.exit(2)
}
if (FIX && IDS.length === 0) {
  console.error('--fix 는 지울 카드를 --id <카드 id> 로 하나 이상 고를 것(목록에서 운영자가 확인한 카드만 지운다).')
  process.exit(2)
}

// 되돌림 파일은 실행 위치와 상관없이 저장소 루트의 scripts/ 아래 절대 경로로 쓴다(재검수 6).
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const DEFAULT_ALERT_THRESHOLD_DAYS = 7
// 앱 정본 includedExpenseWhere 와 같은 조건(재고에 들어가는 구매만)
const included = (propertyId, category, label) => ({ propertyId, category, itemLabel: label, excludeFromInventory: false, isShipping: false })
const noRecords = { stockChecks: { none: {} }, additions: { none: {} }, disposals: { none: {} }, locations: { none: {} }, checkDrafts: { none: {} } }
// 앱 정본 cardHandTouched 와 같은 네 칸
const filled = v => !!v && v.trim() !== ''
const touchedFields = c => [
  filled(c.purchaseUrl) && '구매 링크', filled(c.reorderMemo) && '발주 메모', filled(c.memo) && '메모',
  c.alertThresholdDays !== DEFAULT_ALERT_THRESHOLD_DAYS && `임계값 ${c.alertThresholdDays}일`,
].filter(Boolean)
// 비슷한 이름. 앱 normalizeLabel 처럼 괄호·숫자(단위)·공백·구분자를 걷은 꼴이 같은가, 한쪽이 다른 쪽을 품는가
const norm = s => s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/\d+(\.\d+)?\s*(l|ml|g|kg|m|매|개|롤|포|포대|팩|박스|개입|구|호)?/g, ' ').replace(/[\s\-_.,/]+/g, '')
const similar = (a, b) => { const x = norm(a), y = norm(b); return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 2 && (x.includes(y) || y.includes(x)))) }
const DAY = 86400000

async function survey() {
  const cards = await prisma.trackedItem.findMany({
    where: { isArchived: false, ...noRecords, ...(PROPERTY ? { propertyId: PROPERTY } : {}), ...(LABELS.length ? { label: { in: LABELS } } : {}) },
    include: { property: { select: { name: true } } },
    orderBy: [{ propertyId: 'asc' }, { category: 'asc' }, { label: 'asc' }],
  })
  const fails = [], notes = []
  for (const c of cards) {
    if ((await prisma.expense.count({ where: included(c.propertyId, c.category, c.label) })) > 0) continue
    // 차례로 센다(연결 하나로 돈다. 카드 수십 장이라 느리지 않다).
    const excluded = await prisma.expense.count({ where: { propertyId: c.propertyId, category: c.category, itemLabel: c.label, excludeFromInventory: true, isShipping: false } })
    const shipping = await prisma.expense.count({ where: { propertyId: c.propertyId, category: c.category, itemLabel: c.label, isShipping: true } })
    const otherCat = await prisma.expense.count({ where: { propertyId: c.propertyId, itemLabel: c.label, category: { not: c.category } } })
    const touched = touchedFields(c)
    const row = { c, excluded, shipping, otherCat, touched }
    if (excluded + shipping + otherCat > 0 && touched.length === 0) { fails.push(row); continue }
    const siblings = await prisma.trackedItem.findMany({ where: { propertyId: c.propertyId, category: c.category, id: { not: c.id } }, select: { label: true } })
    row.similar = siblings.map(s => s.label).filter(l => similar(l, c.label)).slice(0, 3)
    row.ageDays = Math.floor((Date.now() - c.createdAt.getTime()) / DAY)
    notes.push(row)
  }
  return { fails, notes }
}

const head = r => `[${r.c.property.name}] ${r.c.label} · ${r.c.category} (id ${r.c.id})`
const traces = r => `재고 제외 ${r.excluded} · 배송비 ${r.shipping} · 다른 카테고리 ${r.otherCat}`

// 앱 정본 trackedItemDeleteSnapshot 과 같은 모양(TrackedItemDeleteUndo). 빈 카드는 위치 연결·임시저장이 0 이라 둘은 빈 배열이다.
async function snapshot(c) {
  const rules = await prisma.trackedItemMergeRule.findMany({ where: { propertyId: c.propertyId, targetItemId: c.id } })
  return {
    item: {
      id: c.id, category: c.category, label: c.label, specUnit: c.specUnit, qtyUnit: c.qtyUnit,
      alertThresholdDays: c.alertThresholdDays, reorderMemo: c.reorderMemo, purchaseUrl: c.purchaseUrl, trackUnit: c.trackUnit,
      hubLocationId: c.hubLocationId, isArchived: c.isArchived, sortOrder: c.sortOrder, memo: c.memo, createdAt: c.createdAt.toISOString(),
    },
    locations: [],
    drafts: [],
    mergeRules: rules.map(r => ({ category: r.category, sourceLabel: r.sourceLabel, normLabel: r.normLabel, kind: r.kind })),
  }
}

async function undo(file) {
  const { snapshots } = JSON.parse(fs.readFileSync(file, 'utf8'))
  let restored = 0
  for (const { propertyId, undo: u } of snapshots) {
    const i = u.item
    const same = await prisma.trackedItem.findUnique({ where: { id: i.id }, select: { propertyId: true } })
    if (same) { console.log(`건너뜀(이미 있음): ${i.label}`); continue }
    const clash = await prisma.trackedItem.findUnique({ where: { propertyId_category_label: { propertyId, category: i.category, label: i.label } }, select: { id: true } })
    if (clash) { console.log(`건너뜀(같은 이름 카드가 새로 있음): ${i.label}`); continue }
    const hubOk = i.hubLocationId ? !!(await prisma.storageLocation.findFirst({ where: { id: i.hubLocationId, propertyId }, select: { id: true } })) : false
    await prisma.$transaction(async tx => {
      await tx.trackedItem.create({
        data: {
          id: i.id, propertyId, category: i.category, label: i.label, specUnit: i.specUnit, qtyUnit: i.qtyUnit,
          alertThresholdDays: i.alertThresholdDays, reorderMemo: i.reorderMemo, purchaseUrl: i.purchaseUrl, trackUnit: i.trackUnit,
          hubLocationId: hubOk ? i.hubLocationId : null, isArchived: i.isArchived, sortOrder: i.sortOrder, memo: i.memo, createdAt: new Date(i.createdAt),
        },
      })
      if (u.mergeRules.length) {
        await tx.trackedItemMergeRule.createMany({ data: u.mergeRules.map(r => ({ propertyId, ...r, targetItemId: i.id })), skipDuplicates: true })
      }
    })
    restored++
    console.log(`되살림: ${i.label} · ${i.category} (id ${i.id})`)
  }
  console.log(`되살림 ${restored}건`)
}

async function fix() {
  const cards = await prisma.trackedItem.findMany({ where: { id: { in: IDS }, propertyId: PROPERTY } })
  const missing = IDS.filter(id => !cards.some(c => c.id === id))
  if (missing.length) { console.error(`이 영업장에 없는 카드 id: ${missing.join(', ')} (아무것도 안 지웠다)`); process.exitCode = 2; return }
  // 스냅샷을 먼저 파일에 쓴다. 지운 뒤에 쓰다 실패하면 되살릴 길이 없다.
  const snapshots = []
  for (const c of cards) snapshots.push({ propertyId: c.propertyId, undo: await snapshot(c) })
  const file = path.join(REPO_ROOT, 'scripts', `.fix-tracked-orphans-undo-${Date.now()}.json`)
  fs.writeFileSync(file, JSON.stringify({ snapshots }, null, 2))
  console.log(`스냅샷 ${snapshots.length}건을 ${file} 에 썼다.`)
  let done = 0
  for (const c of cards) {
    const t = touchedFields(c)
    // 지우는 순간에도 빈 카드 조건(CAS). 재고 구매·기록이 있거나 숨긴 카드면 안 지운다.
    const n = await prisma.$transaction(async tx => {
      if ((await tx.expense.count({ where: included(c.propertyId, c.category, c.label) })) > 0) return 0
      return (await tx.trackedItem.deleteMany({ where: { id: c.id, propertyId: c.propertyId, isArchived: false, updatedAt: c.updatedAt, ...noRecords } })).count
    })
    console.log(n === 1 ? `정리: ${c.label} · ${c.category}${t.length ? ` (손질한 칸 ${t.join('·')} 은 스냅샷에 있다)` : ''}` : `건너뜀(빈 카드가 아니거나 그 사이 바뀜): ${c.label}`)
    done += n
  }
  console.log(`정리 ${done}건. 되돌리기(저장소 루트에서): node --env-file=.env.local scripts/check-tracked-orphans.mjs --undo ${JSON.stringify(file)}`)
}

async function main() {
  if (undoIdx >= 0) {
    const file = argv[undoIdx + 1]
    if (!file) throw new Error('--undo 뒤에 되돌리기 파일 경로를 줄 것')
    await undo(file)
    return
  }
  if (FIX) { await fix(); return }
  const { fails, notes } = await survey()
  for (const r of fails) console.log(`실패 ${head(r)}: 재고 구매 0 · ${traces(r)} · 점검·입수·폐기·위치·임시저장 0`)
  for (const r of notes) {
    const why = [
      r.excluded + r.shipping + r.otherCat > 0 ? `흔적 ${traces(r)}` : '지출 흔적 없음',
      r.touched.length ? `손질한 칸 ${r.touched.join('·')}` : null,
      `생성 ${r.c.createdAt.toISOString().slice(0, 10)}(${r.ageDays}일 전)`,
      r.similar.length ? `같은 카테고리 비슷한 이름 ${r.similar.map(l => `'${l}'`).join(', ')}` : '비슷한 이름 카드 없음',
    ].filter(Boolean).join(' · ')
    console.log(`참고 ${head(r)}: ${why}`)
  }
  console.log(fails.length === 0
    ? `고아 재고 카드 실패 0건. 정상${notes.length ? `(참고 ${notes.length}건은 운영자 판단, 지우려면 --fix --property --id)` : ''}.`
    : `고아 재고 카드 실패 ${fails.length}건${notes.length ? ` · 참고 ${notes.length}건` : ''}. 운영자 확인 뒤 --fix --property <영업장 id> --id <카드 id>`)
  if (fails.length > 0) process.exitCode = 1
}

main()
  .catch(e => { console.error(e); process.exitCode = 2 })
  .finally(() => prisma.$disconnect())
