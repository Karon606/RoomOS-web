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
// 소스 가드도 둘이 붙었다(2026-08-20, 청소 1단계). 이 둘은 DB 를 안 보고 **조립의 모양**을
//   지킨다 — 작업(청소)이 bars·events·firstChangeDay·공백 계산 어디에도 못 섞이는지.
//   부분 문자열 검사로는 못 잡는다("works" 라는 글자가 파일 어딘가에 있는지는 아무것도 안
//   말한다). 괄호 깊이를 세어 블록을 잘라 내고 그 안만 본다. 주석은 먼저 걷는다 — 설명하려고
//   적은 낱말이 위반으로 잡히면 그물이 주석을 못 쓰게 만든다.
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

/** 주석을 걷는다 — 설명하려고 적은 낱말이 위반으로 잡히면 그물이 주석을 못 쓰게 만든다. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^[ \t]*\/\/.*$/gm, ' ')
}

/**
 * marker 뒤 첫 여는 괄호부터 **짝이 맞는 자리까지** 잘라 낸다.
 *
 * 부분 문자열로는 블록의 끝을 못 찾는다. 끝을 못 찾으면 검사 범위가 파일 끝까지 번져
 * 무엇을 봐도 통과하거나 무엇을 봐도 걸린다 — 둘 다 그물이 아니다.
 */
function blockAfter(src: string, marker: string, open = '{', close = '}'): string {
  const at = src.indexOf(marker)
  if (at < 0) return ''
  const start = src.indexOf(open, at)
  if (start < 0) return ''
  let depth = 0
  for (let i = start; i < src.length; i++) {
    if (src[i] === open) depth++
    else if (src[i] === close) { depth--; if (depth === 0) return src.slice(start, i + 1) }
  }
  return ''
}

/** 작업 쪽 식별자 — 이 낱말이 거주 계산 블록 안에 있으면 그것이 곧 섞인 것이다. */
const WORK_IDENTS = ['works', 'rowWorks', 'worksInRange', 'packWorkLanes', 'MoveWork']
const mentionsWork = (block: string): string[] =>
  WORK_IDENTS.filter(id => new RegExp(`\\b${id}\\b`).test(block))

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

  // ── 소스 축 4 ── 공백 캡션·레인·충돌 판정이 **막대만** 본다.
  //
  //   섞이면 무엇이 깨지는가. 하루짜리 청소가 covered 에 들어가면 8일 공실이 3일·4일 두
  //   구간으로 쪼개져 'N일 공실'이 통째로 거짓이 된다. packLanes 에 들어가면 청소 하나가
  //   그 방 행 높이를 한 단 늘린다. 충돌 루프에 들어가면 거주와 청소가 겹쳤다고 빨간 밴드가
  //   서고, 운영자가 [겹침 확인]을 누르는 순간 그 거짓이 LeaseOverlapAck 으로 굳는다.
  {
    const code = stripComments(asm)
    const rowBody = blockAfter(code, 'for (const g of perRoom.values())')
    if (!rowBody) {
      violations.push('[소스] 행 루프를 못 찾았다 — 아래 네 축이 아무것도 안 보고 통과했을 수 있다')
    } else {
      // 공백의 씨앗은 covered 한 줄뿐이고, 그 줄은 bars 만 훑어야 한다.
      const coveredLines = rowBody.split('\n').filter(l => l.includes('covered.add('))
      if (coveredLines.length !== 1 || !/for \(const b of bars\)/.test(coveredLines[0])) {
        violations.push(`[소스] 공백 계산이 막대 아닌 것을 훑는다(covered.add 줄 ${coveredLines.length}개) — 'N일 공실'이 거짓이 된다`)
      }
      const conflictLoop = blockAfter(rowBody, 'for (let i = 0; i < holding.length; i++)')
      if (!conflictLoop) {
        violations.push('[소스] 충돌 이중 루프를 못 찾았다')
      } else {
        const hit = mentionsWork(conflictLoop)
        if (hit.length > 0) violations.push(`[소스] 충돌 판정이 작업을 본다(${hit.join(',')}) — 거주와 청소가 겹쳤다고 빨간 밴드가 선다`)
      }
    }
    const laneFn = blockAfter(code, 'function packLanes(')
    const laneHit = mentionsWork(laneFn)
    if (!laneFn) violations.push('[소스] packLanes 본문을 못 찾았다')
    else if (laneHit.length > 0) violations.push(`[소스] 거주 레인 팩이 작업을 본다(${laneHit.join(',')}) — 하루짜리 청소가 행 높이를 한 단 늘린다`)
  }

  // ── 소스 축 5 ── 사건(events)·첫 변동일에 작업이 안 섞인다.
  //
  //   events 는 홈 '이달 입퇴실 N건'과 호실 관리 탭 접미 N 이 함께 딛는 한 벌이다. 청소가
  //   거기 섞이면 두 화면의 숫자가 같이 부풀고, 그 수를 보고 광고·청소·계약 준비를 건다.
  {
    const code = stripComments(asm)
    const lines = code.split('\n')
    let at = 0
    let pushes = 0
    for (;;) {
      const i = code.indexOf('events.push(', at)
      if (i < 0) break
      pushes++
      at = i + 1
      const arg = blockAfter(code.slice(i), 'events.push(', '(', ')')
      if (!/\bbarId:/.test(arg)) {
        violations.push('[소스] events 에 막대에서 안 나온 항목이 실린다 — 홈 이달 입퇴실 건수가 부푼다')
      }
      const hit = mentionsWork(arg)
      if (hit.length > 0) violations.push(`[소스] events 에 작업이 섞인다(${hit.join(',')})`)
    }
    if (pushes === 0) violations.push('[소스] events.push 를 하나도 못 찾았다 — 이 축이 아무것도 안 보고 통과했다')

    const changeLine = lines.find(l => l.includes('const changeDays ='))
    if (!changeLine || !/=\s*bars\.flatMap\(/.test(changeLine)) {
      violations.push('[소스] 첫 변동일의 씨앗이 막대가 아니다 — 청소가 행 정렬 키를 흔든다')
    }
    // 타입 선언에도 같은 낱말이 있으므로 **행을 만드는 자리**로 범위를 좁힌다.
    const pushArg = blockAfter(blockAfter(code, 'for (const g of perRoom.values())'), 'rows.push(', '(', ')')
    const firstChangeLine = pushArg.split('\n').find(l => l.includes('firstChangeDay:'))
    if (!firstChangeLine || !firstChangeLine.includes('changeDays')) {
      violations.push('[소스] firstChangeDay 가 changeDays 아닌 것에서 나온다')
    }

    // 작업을 만드는 블록은 거주 쪽 어느 배열도 안 건드려야 한다(반대 방향 가드).
    const workBlock = blockAfter(code, 'const works: MoveWork[] = rowWorks', '(', ')')
    if (!workBlock) {
      violations.push('[소스] 작업 배열을 만드는 블록을 못 찾았다')
    } else {
      const leaks = ['events', 'covered', 'firstChangeDay', 'overlapDays'].filter(id => new RegExp(`\\b${id}\\b`).test(workBlock))
      if (leaks.length > 0) violations.push(`[소스] 작업 조립이 거주 쪽 배열을 건드린다(${leaks.join(',')})`)
    }
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
