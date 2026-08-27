// 작업 기록과 그 지출이 서로를 잃어버리는 것을 잡는 감지망 — 읽기 전용, 위반 시 exit 1.
//
// 왜 필요한가
//   Expense.roomWorkId 는 관계라 작업을 지워도 SetNull 로 끊긴다(청소의 uuid 칸과 다르다).
//   그래서 (가) 끊긴 링크는 안 생긴다. 대신 다른 두 가지가 조용히 쌓인다.
//     (가) 작업이 가리키는 방과 지출이 걸린 방이 다르다 — 백필이나 손수정이 어긋난 것이다.
//     (나) 방에 걸린 **시공비**인데 어떤 작업도 안 가리킨다 — **고아 지출**이다.
//          2026-08-25 백필 전에는 87건이 전부 이 상태였다. 백필만 하고 만드는 경로를 안 두면
//          그 다음 날부터 다시 쌓인다(그것이 이 그물이 막는 것이다).
//          **자재비는 고아가 아니다.** 작업 이력은 시공 이력이고 자재 값은 '이 방에 든 지출'에서
//          본다(운영자 확정 2026-08-27 — "작업이력에는 세부 자재 비용이 필요하지는 않는듯 해").
//          그때 자재 연결 34건을 떼면서 이 그물을 같이 안 고쳐 장판·몰딩이 45건 발화했다.
//     (다) 작업의 종류가 환경설정 목록에 없다 — 이름을 바꿨는데 캐스케이드가 안 걸린 것이다.
//          지운 것은 정상이다(지나간 기록은 남는다). 그래서 **경고로만** 알린다.
//
// 실행: node --env-file=.env.local scripts/check-room-work-link.mjs
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

// 카테고리는 정본에서 읽는다 — 문자열을 복제하면 정본을 고쳐도 그물만 옛 이름을 보고 0건을 낸다.
const CANON = 'app/(app)/room-manage/workActions.ts'
const CATEGORY = (readFileSync(CANON, 'utf8').match(/WORK_EXPENSE_CATEGORY\s*=\s*'([^']+)'/) ?? [])[1]
if (!CATEGORY) {
  console.error(`[작업 지출] ${CANON} 에서 WORK_EXPENSE_CATEGORY 를 못 읽었다 — 검사가 통째로 건너뛰어졌다. 감지망을 고쳐야 한다.`)
  process.exit(1)
}

// 작업성 지출인지 — 카테고리만으로는 넓다(수선유지비에는 전등·수도도 있다).
// 종류 이름이 품목·상세에 있는 것만 본다. 종류 목록은 영업장마다 다르므로 DB 에서 읽는다.
const mentionsKind = (e, kinds) => {
  const hay = `${e.itemLabel ?? ''} ${e.detail ?? ''}`
  return kinds.some(k => k && hay.includes(k))
}

// 시공비인지 — 판정은 lib/roomWorkCost.ts 가 정본이다. 여기 정규식을 손으로 베끼면
// 정본에 말을 더한 날 그물만 옛 말을 보고 엉뚱한 건을 고아라고 한다.
const COST_CANON = 'lib/roomWorkCost.ts'
const LABOR_SRC = (readFileSync(COST_CANON, 'utf8').match(/^const LABOR_RE = \/(.+)\/$/m) ?? [])[1]
if (!LABOR_SRC) {
  console.error(`[작업 지출] ${COST_CANON} 에서 LABOR_RE 를 못 읽었다 — 검사가 통째로 건너뛰어졌다. 감지망을 고쳐야 한다.`)
  process.exit(1)
}
const LABOR_RE = new RegExp(LABOR_SRC)
const isLabor = e => {
  if (e.costKind === 'LABOR') return true
  if (e.costKind === 'MATERIAL') return false
  return LABOR_RE.test(`${e.itemLabel ?? ''} ${e.detail ?? ''}`)
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

const violations = []
const notes = []

const props = await prisma.property.findMany({ select: { id: true, workKindOptions: true } })
const kindsByProp = new Map(props.map(p => [
  p.id,
  (p.workKindOptions ?? '도배,장판').split(',').map(s => s.trim()).filter(Boolean),
]))

const works = await prisma.roomWork.findMany({
  where: { deletedAt: null },
  select: { id: true, propertyId: true, roomId: true, kind: true, doneDate: true, room: { select: { roomNo: true } } },
})
const expenses = await prisma.expense.findMany({
  where: { category: CATEGORY },
  select: { id: true, propertyId: true, roomId: true, roomWorkId: true, itemLabel: true, detail: true, date: true, amount: true, costKind: true },
})

// (가) 작업과 지출의 방이 어긋난다
const workById = new Map(works.map(w => [w.id, w]))
for (const e of expenses) {
  if (!e.roomWorkId) continue
  const w = workById.get(e.roomWorkId)
  if (!w) continue   // 소프트삭제된 작업에 걸린 지출 — 되살리면 다시 이어진다. 위반 아님.
  if (e.roomId && w.roomId && e.roomId !== w.roomId) {
    violations.push(`[작업 지출] 지출(${e.date.toISOString().slice(0, 10)} ${e.amount.toLocaleString()}원)이 걸린 방과 그 작업(${w.room.roomNo}호 ${w.kind})의 방이 다르다`)
  }
}

// (나) 고아 지출 — 종류 이름이 든 **시공비**인데 작업에 안 걸렸다
let orphan = 0
for (const e of expenses) {
  if (e.roomWorkId) continue
  const kinds = kindsByProp.get(e.propertyId) ?? []
  if (!mentionsKind(e, kinds)) continue
  if (!isLabor(e)) continue   // 자재비는 작업에 안 건다 — 위 (나) 주석 참조.
  // 방이 없으면 어느 작업인지 앱이 알 수 없다 — 이을 대상이 아니라 위반이 아니다.
  if (!e.roomId) { notes.push(`방이 없어 이을 수 없는 지출 ${e.date.toISOString().slice(0, 10)} ${e.amount.toLocaleString()}원`); continue }
  orphan += 1
  violations.push(`[작업 지출] 고아 지출 — ${e.date.toISOString().slice(0, 10)} ${e.amount.toLocaleString()}원 (${(e.itemLabel ?? e.detail ?? '').slice(0, 24)}) 이 어떤 작업 기록에도 안 걸렸다`)
}

// (다) 목록에 없는 종류 — 경고만
for (const w of works) {
  const kinds = kindsByProp.get(w.propertyId) ?? []
  if (!kinds.includes(w.kind)) {
    notes.push(`목록에 없는 종류 '${w.kind}' (${w.room.roomNo}호) — 지운 종류면 정상이고, 이름을 바꿨다면 캐스케이드를 확인할 것`)
  }
}

console.log(`[작업 지출] 작업 ${works.length}건 · ${CATEGORY} 지출 ${expenses.length}건 검사 / 위반 ${violations.length}건`)
for (const n of notes.slice(0, 10)) console.log(`  참고 — ${n}`)
if (notes.length > 10) console.log(`  참고 ${notes.length - 10}건 더`)
if (violations.length > 0) {
  console.error('')
  for (const v of violations.slice(0, 20)) console.error(`  - ${v}`)
  if (violations.length > 20) console.error(`  ... 외 ${violations.length - 20}건`)
  console.error('')
  console.error('  작업 완료 폼이 지출을 만들고 걸어야 한다. 이미 쌓인 것은 scripts/backfill-room-works.ts 로 잇는다.')
}
await prisma.$disconnect()
process.exit(violations.length > 0 ? 1 : 0)
