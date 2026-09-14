// 보관 위치 계층화(트리) 1단계 — storage_locations 에 자기참조 "parentId" 를 얹는 비파괴 DDL.
//
// 무엇을 하나.
//   · 컬럼 "parentId" uuid NULL (자기 테이블 FK, ON DELETE SET NULL) 하나를 더한다. 기존 14행은 전부 NULL(=루트).
//   · 형제 이름 유일 규칙을 (propertyId, name) 에서 (propertyId, parentId, name) 으로 옮긴다.
//   · Postgres 유니크는 NULL 을 서로 다르게 보므로 루트끼리의 이름 중복은 부분 유니크 인덱스
//     (WHERE "parentId" IS NULL) 로 따로 막는다. 이 인덱스는 Prisma 스키마 밖에 산다 — db push 를 돌리면 사라진다.
//   · 인덱스 (propertyId, parentId, sortOrder) 를 더한다.
//
// 무엇을 안 하나 — 데이터 이동 0행. 허브·잔량·숨김·박제·전파는 전부 storageLocationId 단위로 돌고
//   그 집합은 트리와 무관하게 평면이라 무접촉이다. 트리는 표시·그룹핑 층일 뿐이다.
//
// 실행. 기본은 예행(읽기만)이다.
//   node --env-file=.env.local scripts/migrate-location-tree.mjs            예행 — 지문 저장 + 요약 출력
//   node --env-file=.env.local scripts/migrate-location-tree.mjs --apply    적용 — 한 트랜잭션, 끝나고 지문 재대조
//   node --env-file=.env.local scripts/migrate-location-tree.mjs --revert   되돌리기 — pathName 을 name 에 되쓰고 컬럼 제거
//
// 적용취소(--revert)의 의미. 트리를 쓰던 영업장은 자손 이름이 전체 경로로 평탄화된다
//   (`4층 김치냉장고` 아래 `상단` 은 `4층 김치냉장고 상단`). 공백 결합이라 오늘 평면 이름과 글자가 같다.
//   평탄화한 이름이 영업장 안에서 겹치면 종전 유니크를 못 세우므로 **아무것도 하지 않고 충돌 목록만 출력**한다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const FINGERPRINT_PATH = '/private/tmp/claude-501/-Users-gimgeon-uuimacbookpro-Library-Mobile-Documents-com-apple-CloudDocs-stayeum-Code/b5db17a2-b767-47e6-9096-8df6c49cfc0c/scratchpad/location-tree-fingerprint.json'

// 종전/신규 인덱스 이름 — Prisma 기본 명명 규칙 그대로.
// **전부 인덱스다, 제약이 아니다.** Prisma 의 @@unique 는 UNIQUE INDEX 로 내려온다(pg_constraint 에 없다).
// 첫 --apply 가 DROP CONSTRAINT 로 짜여 안전장치에 걸려 멈췄다(2026-09-14) — 실체를 pg_indexes 로 확인했다.
const OLD_UNIQUE = 'storage_locations_propertyId_name_key'
const NEW_UNIQUE = 'storage_locations_propertyId_parentId_name_key'
const ROOT_UNIQUE = 'storage_locations_propertyId_name_root_key'
const TREE_INDEX = 'storage_locations_propertyId_parentId_sortOrder_idx'

// ── DDL 전문 ────────────────────────────────────────────────────────────────
const DDL_APPLY = [
  `ALTER TABLE "storage_locations" ADD COLUMN "parentId" uuid NULL REFERENCES "storage_locations"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
  `DROP INDEX "${OLD_UNIQUE}"`,
  `CREATE UNIQUE INDEX "${NEW_UNIQUE}" ON "storage_locations" ("propertyId", "parentId", "name")`,
  `CREATE UNIQUE INDEX "${ROOT_UNIQUE}" ON "storage_locations" ("propertyId", "name") WHERE "parentId" IS NULL`,
  `CREATE INDEX "${TREE_INDEX}" ON "storage_locations" ("propertyId", "parentId", "sortOrder")`,
]

const DDL_REVERT_DROP = [
  `DROP INDEX IF EXISTS "${ROOT_UNIQUE}"`,
  `DROP INDEX IF EXISTS "${TREE_INDEX}"`,
  `DROP INDEX IF EXISTS "${NEW_UNIQUE}"`,
]
const DDL_REVERT_TAIL = [
  `ALTER TABLE "storage_locations" DROP COLUMN IF EXISTS "parentId"`,
  `CREATE UNIQUE INDEX "${OLD_UNIQUE}" ON "storage_locations" ("propertyId", "name")`,
]

// ── 지문 ────────────────────────────────────────────────────────────────────
// parentId 는 일부러 안 담는다 — 적용 전후로 바이트가 같아야 하는 것은 '손대지 않은 것들'이다.
const ROWS_SQL = `
  SELECT sl.id, sl."propertyId", sl.name, sl."sortOrder", sl."isHub", sl."createdAt"
  FROM "storage_locations" sl
  ORDER BY sl.id
`
// 6축 참조 건수 — 이 여섯이 위치를 가리키는 전부다(StockCheckLocation.fromLocationId 는 레거시라 따로 센다).
const REFS_SQL = `
  SELECT sl.id,
    (SELECT COUNT(*)::int FROM "stock_check_locations"   x WHERE x."storageLocationId" = sl.id) AS "stockCheckLocations",
    (SELECT COUNT(*)::int FROM "tracked_item_locations"  x WHERE x."storageLocationId" = sl.id) AS "trackedItemLocations",
    (SELECT COUNT(*)::int FROM "stock_additions"         x WHERE x."storageLocationId" = sl.id) AS "stockAdditions",
    (SELECT COUNT(*)::int FROM "stock_disposals"         x WHERE x."storageLocationId" = sl.id) AS "stockDisposals",
    (SELECT COUNT(*)::int FROM "expenses"                x WHERE x."receivedLocationId" = sl.id) AS "expenseReceived",
    (SELECT COUNT(*)::int FROM "expenses"                x WHERE x."assignedLocationId" = sl.id) AS "expenseAssigned"
  FROM "storage_locations" sl
  ORDER BY sl.id
`

const AXES = [
  'stockCheckLocations', 'trackedItemLocations', 'stockAdditions',
  'stockDisposals', 'expenseReceived', 'expenseAssigned',
]

async function fingerprint(db) {
  const rows = await db.$queryRawUnsafe(ROWS_SQL)
  const refs = await db.$queryRawUnsafe(REFS_SQL)
  const totals = {}
  for (const a of AXES) totals[a] = refs.reduce((s, r) => s + r[a], 0)
  return {
    table: 'storage_locations',
    rowCount: rows.length,
    totals,
    rows: rows.map(r => ({
      id: r.id,
      propertyId: r.propertyId,
      name: r.name,
      sortOrder: r.sortOrder,
      isHub: r.isHub,
      createdAt: r.createdAt.toISOString(),
    })),
    refs: refs.map(r => {
      const o = { id: r.id }
      for (const a of AXES) o[a] = r[a]
      return o
    }),
  }
}

const serialize = fp => JSON.stringify(fp, null, 2) + '\n'

// ── pathName — 조상 이름을 공백으로 이어 붙인다 ────────────────────────────
function pathNames(rows) {
  const byId = new Map(rows.map(r => [r.id, r]))
  const out = new Map()
  for (const r of rows) {
    const parts = []
    const seen = new Set()
    let cur = r
    while (cur) {
      if (seen.has(cur.id)) throw new Error(`순환 감지 — 위치 ${r.id} 의 조상 사슬이 ${cur.id} 에서 돈다`)
      seen.add(cur.id)
      parts.unshift(cur.name)
      cur = cur.parentId ? byId.get(cur.parentId) : null
    }
    out.set(r.id, parts.join(' '))
  }
  return out
}

// ── 예행 ────────────────────────────────────────────────────────────────────
async function dryRun() {
  const fp = await fingerprint(prisma)
  mkdirSync(dirname(FINGERPRINT_PATH), { recursive: true })
  writeFileSync(FINGERPRINT_PATH, serialize(fp), 'utf8')

  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'storage_locations' AND column_name = 'parentId'`)
  const idx = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'storage_locations' ORDER BY indexname`)
  const legacyFrom = await prisma.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS c FROM "stock_check_locations" WHERE "fromLocationId" IS NOT NULL`)

  console.log('예행(읽기만) — 보관 위치 계층화 1단계\n')
  console.log(`storage_locations ${fp.rowCount}행`)
  console.log(`"parentId" 컬럼: ${cols.length > 0 ? '있음(이미 적용됨)' : '없음(적용 전)'}`)
  console.log(`현재 인덱스: ${idx.map(i => i.indexname).join(', ')}\n`)

  console.log('6축 참조 건수(합계)')
  for (const a of AXES) console.log(`  ${a.padEnd(22)} ${fp.totals[a]}`)
  console.log(`  (참고) stock_check_locations.fromLocationId 비어있지 않음  ${legacyFrom[0].c}\n`)

  console.log('위치별 참조')
  for (const r of fp.refs) {
    const row = fp.rows.find(x => x.id === r.id)
    const sum = AXES.reduce((s, a) => s + r[a], 0)
    console.log(`  ${row.name.padEnd(16)} 합 ${String(sum).padStart(4)}  ` +
      AXES.map(a => `${a}=${r[a]}`).join(' ') + `  ${r.id}`)
  }
  console.log(`\n지문 저장 — ${FINGERPRINT_PATH}`)
  console.log('\n적용은 --apply, 되돌리기는 --revert.')
}

// ── 적용 ────────────────────────────────────────────────────────────────────
async function apply() {
  if (!existsSync(FINGERPRINT_PATH)) {
    console.error(`예행 지문이 없다 — 먼저 인자 없이 한 번 돌려라(${FINGERPRINT_PATH}).`)
    process.exit(1)
  }
  const before = readFileSync(FINGERPRINT_PATH, 'utf8')

  // 유니크는 인덱스로 산다(pg_indexes). pg_constraint 로 찾으면 항상 '없다'가 나와 안전장치가 헛돈다.
  const has = await prisma.$queryRawUnsafe(
    `SELECT indexname FROM pg_indexes WHERE tablename = 'storage_locations' AND indexname = '${OLD_UNIQUE}'`)
  if (has.length === 0) {
    const all = await prisma.$queryRawUnsafe(
      `SELECT indexname FROM pg_indexes WHERE tablename = 'storage_locations' ORDER BY indexname`)
    console.error(`종전 유니크 인덱스 "${OLD_UNIQUE}" 가 없다 — 중단한다. 현재 인덱스: ${all.map(c => c.indexname).join(', ')}`)
    process.exit(1)
  }

  await prisma.$transaction(async tx => {
    for (const sql of DDL_APPLY) {
      console.log(`  ${sql}`)
      await tx.$executeRawUnsafe(sql)
    }
    const after = serialize(await fingerprint(tx))
    if (after !== before) {
      throw new Error('적용 후 지문이 예행과 다르다 — 롤백한다. 저장된 예행 지문과 직접 대조할 것.')
    }
    console.log('\n지문 바이트 동일 — 손대지 않은 것은 그대로다.')
  }, { timeout: 30_000 })

  console.log('적용 완료 — 전 행 parentId NULL(=루트), 데이터 이동 0행.')
  console.log('다음: prisma/schema.prisma 에 parentId·parent·children·유니크·인덱스를 반영하고 generate.')
}

// ── 되돌리기 ────────────────────────────────────────────────────────────────
async function revert() {
  const cols = await prisma.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_name = 'storage_locations' AND column_name = 'parentId'`)
  if (cols.length === 0) { console.log('"parentId" 컬럼이 없다 — 이미 되돌려져 있다(멱등).'); return }

  const rows = await prisma.$queryRawUnsafe(
    `SELECT id, "propertyId", name, "parentId" FROM "storage_locations" ORDER BY id`)
  const paths = pathNames(rows)

  // 평탄화한 이름이 영업장 안에서 겹치면 종전 유니크를 못 세운다 — 아무것도 하지 않는다.
  const seen = new Map()
  const clashes = []
  for (const r of rows) {
    const key = `${r.propertyId} ${paths.get(r.id)}`
    if (seen.has(key)) clashes.push({ name: paths.get(r.id), propertyId: r.propertyId, ids: [seen.get(key), r.id] })
    else seen.set(key, r.id)
  }
  if (clashes.length > 0) {
    console.error(`되돌릴 수 없다 — 평탄화한 이름이 ${clashes.length}건 겹친다. 아무것도 하지 않았다.`)
    for (const c of clashes) console.error(`  "${c.name}" (영업장 ${c.propertyId}) — ${c.ids.join(' / ')}`)
    process.exit(1)
  }

  const moved = rows.filter(r => r.parentId !== null)
  console.log(`되돌리기 — ${rows.length}행, 그중 자손 ${moved.length}행의 이름을 전체 경로로 평탄화한다.`)
  for (const r of moved) console.log(`  "${r.name}" → "${paths.get(r.id)}"`)

  await prisma.$transaction(async tx => {
    for (const sql of DDL_REVERT_DROP) await tx.$executeRawUnsafe(sql)
    for (const r of rows) {
      await tx.$executeRaw`UPDATE "storage_locations" SET name = ${paths.get(r.id)}, "parentId" = NULL WHERE id = ${r.id}::uuid`
    }
    for (const sql of DDL_REVERT_TAIL) await tx.$executeRawUnsafe(sql)
  }, { timeout: 30_000 })

  console.log('되돌리기 완료 — 전 행 루트, 종전 유니크(propertyId, name) 복귀, 컬럼 제거.')
}

async function main() {
  if (process.argv.includes('--apply')) return apply()
  if (process.argv.includes('--revert')) return revert()
  return dryRun()
}

main().then(() => prisma.$disconnect()).catch(async e => { console.error(e); await prisma.$disconnect(); process.exit(1) })
