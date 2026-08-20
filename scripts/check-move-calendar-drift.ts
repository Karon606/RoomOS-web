// 입퇴실 캘린더 표시 정합 감지(읽기 전용) — 화면이 그린 것과 DB 에 있는 거주 구간을 맞댄다.
//
// 왜 이 그물이 새로 필요한가 (신고 2026-08-20, 김태란 506호에서 508호로 이사).
//   기존 check-room-stay-drift 7축은 **데이터가 규약대로인가**만 묻는다. 김태란 데이터는 옳았고
//   7축은 전부 통과했다. 그런데 캘린더는 계약의 roomId 한 칸만 읽어 옛 방에 0칸, 새 방에 최초
//   입주일부터 통째로 그리고 있었다. 즉 **표시와 데이터를 맞대는 그물이 하나도 없었다.**
//   이 파일이 그 자리다.
//
// 그물이 사본을 들지 않는 것이 이 축의 성립 조건이다. 화면과 **같은 조회**(lib/moveCalendarData
//   fetchMoveLeases)와 **같은 조립**(lib/moveCalendar buildMoveRange)을 그대로 부른다. 조회를
//   여기서 다시 적으면 조회가 바뀔 때 그물만 옛 규칙에 남아 통과를 말한다.
//
// 축 셋.
//   A 이사한 계약 — 계약의 roomId 가 가장 이른 구간의 방과 다른 건. **위반이 아니라 모집단**이다.
//     아래 B·C 가 지켜보는 대상이 이것뿐이라, 조용히 늘면 B·C 의 0 이 '덮었다'인지 '안 봤다'인지
//     구분이 안 된다. 그래서 기준선으로 래칫한다(check-room-availability-drift 축 ④와 같은 문법).
//   B 공실 오칠 — 캘린더가 비었다고 칠한 날에 그 방의 **마감된** 구간이 실재하는 건. 마감 조건이
//     핵심이다. 열린 구간까지 보면 NON_RESIDENT(창고·사무실 명의) 구간이 오탐으로 섞인다 —
//     그 상태는 캘린더 대상이 아닌 것이 설계다.
//   C 계약 출처 복귀 — 거주 막대의 id 가 실재하는 구간 id 이고 그 구간의 방·시작과 맞는가.
//     막대가 다시 계약에서 나오기 시작하면(id 가 계약 id 가 된다) 이 축이 곧바로 발화한다.
//
// 실행: npx tsx --env-file=.env.local scripts/check-move-calendar-drift.ts
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { kstYmdStr } from '@/lib/kstDate'
import { buildMoveRange } from '@/lib/moveCalendar'
import { MOVE_LEASE_STATUSES, dbYmd, fetchMoveLeases } from '@/lib/moveCalendarData'

/** 오늘의 이사한 계약 수(2026-08-20 실측 1건 — 김태란 506호에서 508호로).
 *  늘어난 것이 사실이면 이 수를 갱신하되, 그때 축 B·C 의 0 건을 반드시 다시 확인한다. */
const BASELINE_MOVED_LEASES = 1

const DAY_MS = 86400000
const addDays = (ymd: string, n: number): string => new Date(Date.parse(`${ymd}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10)

const violations: string[] = []

// ── 소스 가드 ── 이 표시 오류를 막는 두 겹이 살아 있는가 ─────────────
{
  const data = readFileSync('lib/moveCalendarData.ts', 'utf8')
  if (!/roomStays:\s*\{\s*\n\s*select:/.test(data)) {
    violations.push('[소스] 캘린더 조회가 roomStays 를 안 싣는다 — 방을 옮긴 계약이 다시 옛 방에서 사라진다')
  }
  if (!/roomStays:\s*\{\s*some:\s*\{\s*propertyId,\s*OR:/.test(data)) {
    violations.push('[소스] 조회 창 조건에 구간 경계가 없다 — 이사일만 창에 있는 계약이 통째로 빠진다')
  }
  if (!/roomStays:\s*\{\s*some:\s*\{\s*propertyId,\s*roomId:\s*\{\s*in:\s*roomIds/.test(data)) {
    violations.push('[소스] context 조회가 구간의 방을 안 본다 — 옛 방 행에 그 사람의 거주가 사라진다')
  }
  const asm = readFileSync('lib/moveCalendar.ts', 'utf8')
  if (!/function slicesOf\(/.test(asm)) {
    violations.push('[소스] 조립이 계약을 구간 조각으로 펴지 않는다 — 막대가 다시 계약 호실 한 칸에서 나온다')
  }
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const today = kstYmdStr()
  const properties = await prisma.property.findMany({ select: { id: true, name: true } })

  const moved: string[] = []
  const vacantMispaint: string[] = []
  const sourceDrift: string[] = []
  let barCount = 0
  let rowCount = 0

  for (const p of properties) {
    // ── 축 A ── 계약의 방과 가장 이른 구간의 방이 다르면 그 계약은 방을 옮겼다.
    //    시작일 없는 옛 구간이 6건 있어 '가장 이른'을 그 구간이 가로채지 않게 시작일 있는 것만 본다.
    const leases = await prisma.leaseTerm.findMany({
      where: { propertyId: p.id, roomId: { not: null }, status: { in: [...MOVE_LEASE_STATUSES] } },
      select: {
        id: true, status: true, roomId: true,
        room: { select: { roomNo: true } }, tenant: { select: { name: true } },
        roomStays: {
          select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { roomNo: true } } },
          orderBy: [{ startDate: 'asc' }, { createdAt: 'asc' }],
        },
      },
    })
    for (const l of leases) {
      const dated = l.roomStays.filter(s => s.startDate)
      if (dated.length === 0) continue
      if (dated[0].roomId === l.roomId) continue
      moved.push(`${p.name} ${l.tenant.name} [${l.status}] 계약 ${l.room?.roomNo ?? '?'}호 · 구간 ${l.roomStays.map(s => `${s.room.roomNo}호 ${dbYmd(s.startDate) ?? '시작 미상'}~${dbYmd(s.endDate) ?? '열림'}`).join(' / ')}`)
    }

    // ── 범위 ── 데이터가 있는 전 기간. 화면은 몇 달만 보지만 그물은 전부 본다.
    const marks: string[] = [today]
    for (const l of leases) for (const s of l.roomStays) {
      const a = dbYmd(s.startDate), b = dbYmd(s.endDate)
      if (a) marks.push(a)
      if (b) marks.push(b)
    }
    const bounds = await prisma.leaseTerm.findMany({
      where: { propertyId: p.id, roomId: { not: null }, status: { in: [...MOVE_LEASE_STATUSES] } },
      select: { moveInDate: true, moveOutDate: true, expectedMoveOut: true },
    })
    for (const l of bounds) for (const d of [l.moveInDate, l.moveOutDate, l.expectedMoveOut]) {
      const y = dbYmd(d)
      if (y) marks.push(y)
    }
    const from = marks.reduce((a, b) => (a < b ? a : b))
    const to = marks.reduce((a, b) => (a > b ? a : b))

    const { changed, context } = await fetchMoveLeases(prisma, p.id, from, to)
    const range = buildMoveRange({
      from, to, today, focusMonth: today.slice(0, 7),
      changed, context, beyond: null, canExtendPast: false,
    })

    // 마감된 구간만 — 열린 구간을 함께 보면 캘린더 대상이 아닌 상태(NON_RESIDENT 등)가 오탐이 된다.
    const closed = await prisma.roomStay.findMany({
      where: {
        propertyId: p.id, endDate: { not: null }, startDate: { not: null },
        leaseTerm: { status: { in: [...MOVE_LEASE_STATUSES] } },
      },
      select: {
        id: true, roomId: true, startDate: true, endDate: true,
        room: { select: { roomNo: true } },
        leaseTerm: { select: { status: true, tenant: { select: { name: true } } } },
      },
    })
    const stayById = new Map(closed.map(s => [s.id, s]))
    const allStays = await prisma.roomStay.findMany({
      where: { propertyId: p.id },
      select: { id: true, roomId: true, startDate: true },
    })
    const anyStayById = new Map(allStays.map(s => [s.id, s]))

    for (const row of range.rows) {
      rowCount++
      // ── 축 B ── 공실로 칠한 날에 마감된 구간이 실재하는가.
      for (const g of row.gaps) {
        const gapFrom = addDays(from, g.startDay - 1)
        const gapTo = addDays(from, g.endDay - 1)
        for (const s of closed) {
          if (s.roomId !== row.roomId) continue
          const sf = dbYmd(s.startDate)!, st = dbYmd(s.endDate)!
          if (st < gapFrom || sf > gapTo) continue
          vacantMispaint.push(`${p.name} ${s.room.roomNo}호 ${gapFrom}~${gapTo} 를 공실로 칠했는데 ${s.leaseTerm?.tenant?.name ?? '?'}님 구간(${sf}~${st})이 실재한다`)
        }
      }
      // ── 축 C ── 거주 막대가 실재하는 구간에서 나왔는가.
      for (const b of row.bars) {
        barCount++
        if (b.kind === 'reserved') continue   // 예약은 구간을 안 만드는 것이 설계다
        const s = anyStayById.get(b.id) ?? stayById.get(b.id)
        if (!s) {
          sourceDrift.push(`${p.name} ${row.roomNo}호 ${b.tenantName} 막대가 구간이 아니라 계약에서 나왔다(id ${b.id})`)
          continue
        }
        if (s.roomId !== row.roomId) {
          sourceDrift.push(`${p.name} ${row.roomNo}호 ${b.tenantName} 막대의 구간은 다른 방이다`)
        }
        const start = dbYmd(s.startDate)
        if (start && b.stayFrom !== start) {
          sourceDrift.push(`${p.name} ${row.roomNo}호 ${b.tenantName} 막대 시작 ${b.stayFrom ?? '없음'} 이 실제 거주 시작 ${start} 과 다르다`)
        }
      }
    }
  }

  console.log(`\n[이사한 계약] ${moved.length}건 (기준선 ${BASELINE_MOVED_LEASES})`)
  for (const m of moved) console.log(`  - ${m}`)
  if (moved.length > BASELINE_MOVED_LEASES) {
    violations.push(`[모집단] 이사한 계약이 ${moved.length}건으로 기준선 ${BASELINE_MOVED_LEASES}건을 넘었다 — 사실이면 BASELINE_MOVED_LEASES 를 갱신하되 그때 아래 두 축의 0건을 다시 확인한다`)
  }

  const report = (title: string, rows: string[]) => {
    console.log(`\n[${title}] ${rows.length}건`)
    for (const r of rows) console.log(`  - ${r}`)
  }
  report('공실 오칠', vacantMispaint)
  report('막대 출처 이탈', sourceDrift)
  violations.push(...vacantMispaint.map(v => `[공실 오칠] ${v}`))
  violations.push(...sourceDrift.map(v => `[막대 출처] ${v}`))

  console.log(`\n영업장 ${properties.length}곳 · 행 ${rowCount} · 막대 ${barCount} 검사`)
  await prisma.$disconnect()

  if (violations.length > 0) {
    console.error(`\n캘린더 표시 정합 위반 ${violations.length}건`)
    for (const v of violations) console.error(`  - ${v}`)
    process.exit(1)
  }
  console.log('캘린더 표시 정합 위반 0건')
}

main()
