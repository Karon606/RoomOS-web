// 같은 날 연속 위치 점검이 뒤집은 실측 표식과 지운 보충 마커를 되돌린다 — 기본은 예행, --apply 로 쓴다.
//
// 왜 있나(2026-09-14). applyLocationCheck 가 비점검 행에 carried:true 를 무조건 찍어, 4층 주방을
// 점검한 뒤 5층 주방을 점검하면 4층의 실측 표식(false)이 이월(true)로 뒤집혔다. 생성 경로는
// 6d4eb246 이 고쳤고, 이 스크립트는 그 전에 생긴 행을 되돌린다. 값은 한 글자도 안 바꾼다.
//
// 되돌리는 것 둘.
//   (1) 표식 — memo 가 `위치별 점검 (X)` 인 점검에서 위치 X 의 행이 carried=true 면 false 로.
//       memo 는 createStockCheck(첫 저장)에서만 박히므로 X = 먼저 잰 위치 = 실측이다. 구조적으로
//       건전하다. `restockedQty > 0` 같은 휴리스틱은 보충 없이 잰 위치를 못 가려 쓰지 않는다.
//       X 는 위치 트리(2026-09-14) 뒤로 전체 경로 이름(pathName)이다. 트리 전에 박힌 memo 는 평면
//       이름인데 그때는 전부 루트라 pathName 과 같다. 옮겨진 뒤라 안 맞으면 이름이 유일할 때만 폴백.
//   (2) 마커 — 같은 점검에서 나중에 잰 위치(carried=false)를 운영자가 전=후로 다시 저장하면
//       "같은 위치 재점검은 마지막 값으로 덮어씀" 한계로 보충 마커가 사라진다. 허브 차감은 이미
//       실제로 일어났으므로 마커 = 직전 허브 − 지금 허브 − 다른 행의 마커 합 으로 역산한다.
//       운영자가 역산 복원을 승인했다(2026-09-14). 역산값이 양수이고 그 점검에 마커 없는
//       carried=false 비허브 행이 **정확히 하나**일 때만 쓴다. 둘 이상이면 어느 쪽인지 못 가리므로
//       안 쓰고 보고만 한다.
//
// **박제·다른 날짜·다른 영업장은 안 건드린다.** 인자로 받은 날짜의 점검만 본다.
//
// 실행:
//   예행   npx tsx --env-file=.env.local scripts/backfill-check-carried-flip.ts 2026-09-14
//   적용   npx tsx --env-file=.env.local scripts/backfill-check-carried-flip.ts 2026-09-14 --apply
//   되돌림 npx tsx --env-file=.env.local scripts/backfill-check-carried-flip.ts --revert <snapshot.json>
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { readFileSync, writeFileSync } from 'node:fs'
import { buildTree, flattenDfs } from '../lib/locationTree'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DIRECT_URL }) })
const APPLY = process.argv.includes('--apply')
const REVERT_AT = process.argv.indexOf('--revert')
const EPS = 0.001

type Snap = { id: string; carried: boolean | null; restockedQty: number | null }

async function revert(file: string) {
  const snap = JSON.parse(readFileSync(file, 'utf8')) as Snap[]
  for (const s of snap) {
    await prisma.stockCheckLocation.update({ where: { id: s.id }, data: { carried: s.carried, restockedQty: s.restockedQty } })
  }
  console.log(`되돌림 ${snap.length}행`)
}

async function main() {
  if (REVERT_AT >= 0) {
    await revert(process.argv[REVERT_AT + 1])
    await prisma.$disconnect()
    return
  }
  const dateArg = process.argv.find(a => /^\d{4}-\d{2}-\d{2}$/.test(a))
  if (!dateArg) throw new Error('날짜(YYYY-MM-DD)를 인자로 달아라.')
  const date = new Date(`${dateArg}T00:00:00Z`)

  const checks = await prisma.stockCheck.findMany({
    where: { date, memo: { startsWith: '위치별 점검 (' } },
    include: {
      trackedItem: { select: { label: true, hubLocationId: true } },
      locationBreakdown: { include: { storageLocation: { select: { name: true, isHub: true } } } },
    },
    orderBy: { createdAt: 'asc' },
  })
  console.log(`${dateArg} 위치별 점검 ${checks.length}건 · ${APPLY ? '적용' : '예행'}\n`)
  // memo 의 X 를 되찾는 축은 pathName 이다. 위치 전체를 한 번 읽어 id 별 경로 이름을 만든다.
  const locRows = await prisma.storageLocation.findMany({ select: { id: true, parentId: true, name: true, sortOrder: true } })
  const pathById = new Map(flattenDfs(buildTree(locRows)).map(r => [r.id, r.pathName]))
  const pathOf = (l: { storageLocationId: string; storageLocation: { name: string } }) =>
    pathById.get(l.storageLocationId) ?? l.storageLocation.name

  const snap: Snap[] = []
  const flags: { id: string; label: string; loc: string }[] = []
  const markers: { id: string; label: string; loc: string; qty: number }[] = []
  const notes: string[] = []

  for (const c of checks) {
    const m = /^위치별 점검 \((.+)\)$/.exec(c.memo ?? '')
    if (!m) continue
    const firstName = m[1]
    const isHub = (l: (typeof c.locationBreakdown)[number]) =>
      l.storageLocation.isHub || l.storageLocationId === c.trackedItem.hubLocationId

    // (1) 표식 — 먼저 잰 위치
    let first = c.locationBreakdown.find(l => pathOf(l) === firstName)
    if (!first) {
      const byName = c.locationBreakdown.filter(l => l.storageLocation.name === firstName)
      if (byName.length === 1) first = byName[0]
    }
    if (!first) { notes.push(`${c.trackedItem.label}: memo 위치 '${firstName}' 행이 없다`); continue }
    if (first.carried === true) {
      flags.push({ id: first.id, label: c.trackedItem.label, loc: firstName })
      snap.push({ id: first.id, carried: first.carried, restockedQty: first.restockedQty })
    }

    // (2) 마커 — 직전 점검의 허브와 견준다
    const hub = c.locationBreakdown.find(isHub)
    if (!hub) continue
    const prev = await prisma.stockCheck.findFirst({
      where: { trackedItemId: c.trackedItemId, createdAt: { lt: c.createdAt } },
      orderBy: { createdAt: 'desc' },
      include: { locationBreakdown: true },
    })
    const prevHub = prev?.locationBreakdown.find(l => l.storageLocationId === hub.storageLocationId)
    if (!prevHub) continue
    const otherMarkers = c.locationBreakdown
      .filter(l => !isHub(l) && l.id !== first.id && (l.restockedQty ?? 0) > 0)
      .reduce((a, l) => a + (l.restockedQty ?? 0), 0)
    const firstMarker = (first.restockedQty ?? 0) > 0 ? (first.restockedQty ?? 0) : 0
    // 부동소수 잡음(0.5000000000000001)을 걷는다 — 마커는 사람이 적은 수라 소수 셋째 자리면 충분하다.
    const delta = Math.round((prevHub.remainingQty - hub.remainingQty - otherMarkers - firstMarker) * 1000) / 1000
    if (delta <= EPS) continue
    // 마커 없는 나중 실측 행(carried=false, 비허브, 첫 위치 아님)이 정확히 하나여야 쓴다.
    const cands = c.locationBreakdown.filter(l => !isHub(l) && l.id !== first.id && l.carried === false && (l.restockedQty ?? 0) === 0)
    if (cands.length !== 1) {
      notes.push(`${c.trackedItem.label}: 허브가 ${delta} 줄었는데 마커 없는 실측 행이 ${cands.length}개라 역산 불가 — 손대지 않는다`)
      continue
    }
    const t = cands[0]
    markers.push({ id: t.id, label: c.trackedItem.label, loc: pathOf(t), qty: delta })
    snap.push({ id: t.id, carried: t.carried, restockedQty: t.restockedQty })
  }

  console.log(`[표식 복원] ${flags.length}행`)
  for (const f of flags) console.log(`   ${f.label.padEnd(12)} ${f.loc}  carried true → false`)
  console.log(`\n[마커 역산] ${markers.length}행`)
  for (const k of markers) console.log(`   ${k.label.padEnd(12)} ${k.loc}  restockedQty null → ${k.qty}`)
  if (notes.length) { console.log('\n[주의]'); for (const n of notes) console.log('   -', n) }

  if (!APPLY) { console.log('\n예행이다. 쓰려면 --apply 를 달아라.'); await prisma.$disconnect(); return }

  const out = `scratch-backfill-carried-${dateArg}-${Date.now()}.json`
  writeFileSync(out, JSON.stringify(snap, null, 2))
  for (const f of flags) await prisma.stockCheckLocation.update({ where: { id: f.id }, data: { carried: false } })
  for (const k of markers) await prisma.stockCheckLocation.update({ where: { id: k.id }, data: { restockedQty: k.qty } })
  console.log(`\n적용 ${flags.length + markers.length}행 · 되돌림 스냅숏 ${out}`)
  await prisma.$disconnect()
}

main()
