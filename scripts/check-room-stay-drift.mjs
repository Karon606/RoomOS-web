// RoomStay(거주 구간 이력) 드리프트 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
// 진실은 LeaseTerm.roomId 이고 RoomStay 는 파생 이력이라, 둘이 어긋나면 기록 지점이 빠진 것이다.
// 정방향 3종: ① 활성 lease 의 roomId 와 열린 구간의 roomId 불일치 ② 한 lease 에 열린 구간 2개 이상
//            ③ 호실 있는 활성 lease 인데 열린 구간이 없음.
// 역방향 3종(자격 위반, 2026-07-28 오더 — 박의균 신고): ④ 비자격 상태 lease 의 열린 구간
//            ⑤ 문의·투어·예약 단계 lease 에 구간 존재 ⑥ 열린 구간의 startDate 가 미래.
// 날짜 정합 1종(2026-08-07 오더 — 507호 신헌석 사건): ⑦ 입주 구간의 startDate 가 lease.moveInDate 와 불일치.
// 호실 일정(2026-08-26): ① 은 '아직 안 옮긴 줄'에 있을 때만 예외다. 이사는 사람이 확인해야
// 기록되므로 옮길 날이 지나도 옛 방에 있는 것이 정상이고, 그 늦음은 주의 축이 따로 센다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })


// 열린 구간(현재 거주 중)이어야 하는 상태 — lib/roomStay.ts STAY_ELIGIBLE_STATUSES·백필과 같은 정의를 쓴다.
const OPEN_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']
// 점유 전 단계 — 이 상태의 lease 는 구간이 하나라도 있으면 위반(입주한 적 없는 사람).
const PRE_OCCUPANCY_STATUSES = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED']

async function main() {
  const leases = await prisma.leaseTerm.findMany({
    where: { status: { in: OPEN_STATUSES }, roomId: { not: null } },
    select: {
      id: true, status: true, roomId: true, moveInDate: true,
      // 호실 일정(2026-08-26) — 일정을 쓰는 계약은 오늘의 방이 계약 방과 다른 것이 정상이다.
      roomSchedule: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true } },
      // 마감 구간까지 다 읽는다 — ⑦ 의 '최초 구간' 판정에 이사 이력이 필요하다.
      roomStays: {
        select: { id: true, roomId: true, startDate: true, endDate: true, room: { select: { roomNo: true } } },
        orderBy: { startDate: 'desc' },
      },
    },
    orderBy: { createdAt: 'asc' },
  })

  const mismatch = []
  // 주의 축 — 옮길 날이 지났는데 아직 안 옮긴 사람. 정상 경로(사람이 확인해야 기록된다)로도
  // 도달하므로 막지 않고 센다. 알림은 지나칠 수 있어도 이 줄은 못 지나친다.
  const pendingMoves = []
  const duplicated = []
  const missing = []
  const moveInMismatch = []
  for (const l of leases) {
    const who = `${l.room?.roomNo ?? '?'}호 ${l.tenant.name} [${l.status}]`
    const openStays = l.roomStays.filter(s => s.endDate === null)
    if (openStays.length === 0) { missing.push(who); continue }
    if (openStays.length > 1) {
      duplicated.push(`${who} — 열린 구간 ${openStays.length}개(${openStays.map(s => `${s.room.roomNo}호 ${s.startDate ? s.startDate.toISOString().slice(0, 10) : '시작일 미상'}`).join(', ')})`)
    }
    const open = openStays[0]
    // 호실 일정 — **아직 안 옮긴 줄에 있을 때만** 예외로 본다(lib/roomStay 자가 치유와 같은 술어).
    // 이사는 사람이 확인해야 기록되므로 옮길 날이 지나도록 옛 방에 있는 것은 정상이고, 그 늦음은
    // 아래 주의 축이 따로 센다. 조건을 '일정 어딘가의 방'으로 넓히면 진짜 드리프트가 같이 샌다.
    const todayYmd = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
    const sched = Array.isArray(l.roomSchedule) && l.roomSchedule.length >= 2 ? l.roomSchedule : []
    const openIdx = sched.findIndex(e => e && e.roomId === open.roomId)
    const waitingMove = openIdx >= 0 && openIdx < sched.length - 1 && sched[openIdx].from <= todayYmd
    if (waitingMove) {
      const next = sched[openIdx + 1]
      if (next.from <= todayYmd) {
        const late = Math.round((Date.parse(`${todayYmd}T00:00:00Z`) - Date.parse(`${next.from}T00:00:00Z`)) / 86400000)
        pendingMoves.push(`${who} — ${next.from} 에 이사 예정인데 ${late}일째 ${open.room.roomNo}호에 있다`)
      }
    }
    if (open.roomId !== l.roomId && !waitingMove) {
      mismatch.push(`${who} — 계약은 ${l.room?.roomNo ?? '?'}호, 열린 구간은 ${open.room.roomNo}호`)
    }
    // ⑦ 입주일·구간 불일치 — 열린 구간이 그 lease 의 최초 구간이면 입주 구간이라 startDate 가 입주일이어야 한다.
    // 이후 구간은 이동 구간(startDate 가 이동일)이라 대상이 아니다. lib/roomStay.ts syncMoveInStart 의
    // 2차 가드와 같은 정의를 쓴다 — 전파가 빠지면 여기서 잡힌다.
    // 호실 일정을 쓰는 계약도 **최초 구간의 시작일은 입주일**이다(일정의 첫 줄이 입주일에서
    // 시작하도록 lib/roomSchedule 이 강제한다). 그래서 이 축에는 예외가 필요 없다 —
    // 지금 열린 구간이 두 번째 이후면 아래 isFirstStay 가 이미 거짓이다.
    if (l.moveInDate && open.startDate) {
      const isFirstStay = !l.roomStays.some(s =>
        s.id !== open.id && s.startDate && s.startDate < open.startDate)
      const openYmd = open.startDate.toISOString().slice(0, 10)
      const moveInYmd = l.moveInDate.toISOString().slice(0, 10)
      if (isFirstStay && openYmd !== moveInYmd) {
        moveInMismatch.push(`${who} — 입주일 ${moveInYmd}, 구간 시작 ${openYmd}`)
      }
    }
  }

  // 역방향 — 전체 stay 를 lease 상태와 대조 (자격 없는 구간이 생기면 생성 게이트가 뚫린 것)
  const allStays = await prisma.roomStay.findMany({
    select: {
      id: true, startDate: true, endDate: true,
      room: { select: { roomNo: true } },
      leaseTerm: { select: { status: true, tenant: { select: { name: true } } } },
    },
  })
  // ⑥ 은 KST 내일까지 유예한다 — 완납 후 전날 활성화는 정상 운영이라 하루 앞선 시작일은 오탐이었다.
  // 어긋난 날짜 자체는 ⑦ 이 미래·과거 무관하게 잡으므로, ⑦ 과 세트인 것이 이 유예의 조건이다.
  const tomorrowYmd = new Date(Date.now() + 33 * 3600 * 1000).toISOString().slice(0, 10)   // KST +1일
  const openIneligible = []
  const preOccupancy = []
  const futureStart = []
  for (const s of allStays) {
    const who = `${s.room.roomNo}호 ${s.leaseTerm?.tenant?.name ?? '?'} [${s.leaseTerm?.status ?? '?'}]`
    if (s.endDate === null && s.leaseTerm && !OPEN_STATUSES.includes(s.leaseTerm.status)) openIneligible.push(who)
    if (s.leaseTerm && PRE_OCCUPANCY_STATUSES.includes(s.leaseTerm.status)) preOccupancy.push(who)
    if (s.endDate === null && s.startDate && s.startDate.toISOString().slice(0, 10) > tomorrowYmd) futureStart.push(`${who} — 시작 ${s.startDate.toISOString().slice(0, 10)}`)
  }

  const report = (title, rows) => {
    console.log(`\n[${title}] ${rows.length}건`)
    for (const r of rows) console.log(`  - ${r}`)
  }
  report('호실 불일치', mismatch)
  report('열린 구간 중복', duplicated)
  report('열린 구간 없음', missing)
  report('비자격 상태의 열린 구간', openIneligible)
  report('점유 전 단계 lease 의 구간', preOccupancy)
  report('미래 시작 열린 구간', futureStart)
  report('입주일·구간 불일치', moveInMismatch)

  const total = mismatch.length + duplicated.length + missing.length
    + openIneligible.length + preOccupancy.length + futureStart.length + moveInMismatch.length
  if (pendingMoves.length > 0) {
    console.log(`\n[이사 예정 경과] 주의 ${pendingMoves.length}건 (막지 않는다 — 확인해야 기록되는 구조다)`)
    for (const m of pendingMoves) console.log('  - ' + m)
  }

  console.log(`\n활성 계약 ${leases.length}건 · 전체 구간 ${allStays.length}건 검사 · 드리프트 ${total}건`)
  await prisma.$disconnect()
  if (total > 0) process.exit(1)
}
main()
