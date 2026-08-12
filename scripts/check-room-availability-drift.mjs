// 입주 가능 판정 드리프트 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
//
// 축 ① 퇴실 예정일이 잡힌 예약이 걸린 방인데, 같은 방의 다른 점유 계약은 무기한이라 '입주 가능'에서 빠지는 방.
//
// 왜 이게 사고인가 — 예약자는 "그 방이 며칠에 빈다"를 믿고 날짜를 잡은 사람이다.
// 그런데 실제로 그 방을 비워 줄 사람의 퇴실 예정일이 없으면, 그 약속을 받쳐 주는 사실이
// 화면 어디에도 없다. 호실 관리 '입주 가능'은 이 방을 (옳게) 빼지만, 예약은 그대로 남아
// 조용히 지켜지지 않을 약속이 된다.
//
// 오탐 방지 — 무기한 계약이라도 그 **입주일이 예약 퇴실일보다 뒤**면 정상이다. 예약자가
// 먼저 쓰고 완전히 나간 다음에 무기한 입주가 시작되는 사슬(404호 조성훈 8/15~8/31 뒤
// 박정후 9/1 무기한, 2026-08-11 유령 퇴실일 정정으로 처음 등장)은 아무 약속도 깨지 않는다.
// 위반은 예약 기간이 무기한 점유와 실제로 겹칠 때만이다 — 그 예약은 비워 줄 사람의
// 퇴실 예정일 없이 잡힌 약속이라 조용히 지켜지지 않는다.
//
// 축 ② 같은 방에 체류 구간이 실제로 겹치는 거주·예약 계약 2건 이상 = 이중 점유.
//
// 왜 이게 사고인가 — 한 방에 두 사람이 같은 날 들어가 있다. 종전에는 이 사실을 세는 축이
// 감지망 어디에도 없었다. 축 ①은 '무기한 위에 얹힌 날짜 잡힌 예약'만 보므로, 양쪽 다 날짜가
// 있는 겹침(8/1~8/31 거주 + 8/15~9/30 예약)은 그대로 통과했다.
//
// 오탐 방지 — 한 방에 계약이 둘 이상 있는 것 자체는 정상이다(402·404·503호). 이어 붙은
// 구간은 겹치지 않는다. 위반은 두 구간이 실제로 포개질 때만이다 — 판정식은 addTenant 폼의
// 확인창(overlapOccupancy)과 같은 선이고, 같은 날 퇴실·입주는 겹침으로 센다.
// 퇴실 예정일이 없는 계약은 무기한이라 그 뒤 전부와 겹친다.
//
// 축 ③ 공실 집계 제외 방(창고·사무실)에 거주·예약 계약이 들어가 있는 방.
//
// 왜 이게 사고인가 — 415호(최은옥)·사무실(이원빈)은 명의만 있는 방이라 점유 계약이 0건이다.
// 그래서 addTenant·updateTenant 가드가 전부 통과시켰고, 거기에 입주자를 저장하면 명의자와
// 이중 점유가 된다(2026-08-11 봉합). 봉합은 두 쓰기 경로에 걸었고, 이 축은 그 봉합이 뚫렸을 때
// 또는 다른 경로가 생겼을 때 잡는 자리다. 방 설정만 뒤집혀도(거주자가 있는 방을 창고로 표시)
// 홈·리포트 공실 수에서 사람이 사는 방이 빠지므로 같은 축에서 잡는다.
//
// 오탐 방지 — 418호처럼 방 설정이 '공실로 세라'(nonResidentVacant=true)인 거주·비거주 동거는
// 정상이다. 판정은 lib/vacancy 의 집계 제외 술어 그대로다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// 방을 잡고 있는 계약 — app/(app)/room-manage/RoomManageClient.tsx OCCUPYING_STATUSES 와 같은 정의.
const OCCUPYING_STATUSES = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING']

// lib/vacancy.ts isVacancyExcluded 와 같은 정의 — 방 설정 하나(세를 놓지 않는 방).
const isVacancyExcluded = (nonResidentVacant) => !nonResidentVacant

async function main() {
  const rooms = await prisma.room.findMany({
    orderBy: { roomNo: 'asc' },
    select: {
      roomNo: true,
      nonResidentVacant: true,
      property: { select: { name: true } },
      leaseTerms: {
        where: { status: { in: [...OCCUPYING_STATUSES, 'NON_RESIDENT'] } },
        select: { status: true, moveInDate: true, expectedMoveOut: true, tenant: { select: { name: true } } },
      },
    },
  })

  const ymd = (d) => d ? new Date(d).toISOString().slice(0, 10) : null
  const label = (l) => `${l.status}/${l.tenant?.name ?? '-'}/${ymd(l.moveInDate) ?? '미정'}~${ymd(l.expectedMoveOut) ?? '무기한'}`
  const axis1 = []
  const axis2 = []
  const axis3 = []
  for (const r of rooms) {
    const occ = r.leaseTerms.filter(l => OCCUPYING_STATUSES.includes(l.status))
    const where = { property: r.property?.name ?? '?', roomNo: r.roomNo }

    // ── 축 ③ — 점유 계약 유무와 무관하게 방 단위 사실로 묻는다.
    if (isVacancyExcluded(r.nonResidentVacant) && occ.length > 0) {
      axis3.push({ ...where, detail: r.leaseTerms.map(label).join(' | ') })
    }

    if (occ.length === 0) continue

    // ── 축 ② — 두 구간이 실제로 포개지는 쌍이 하나라도 있는가. 같은 날은 겹침으로 센다.
    const pair = []
    for (let i = 0; i < occ.length; i++) {
      for (let j = i + 1; j < occ.length; j++) {
        const a = occ[i], b = occ[j]
        const aIn = ymd(a.moveInDate), aOut = ymd(a.expectedMoveOut)
        const bIn = ymd(b.moveInDate), bOut = ymd(b.expectedMoveOut)
        // 입주일이 없으면 이미 시작된 점유로, 퇴실 예정일이 없으면 무기한으로 읽는다.
        const overlaps = (!aOut || !bIn || aOut >= bIn) && (!bOut || !aIn || bOut >= aIn)
        if (overlaps) pair.push(`${label(a)} <> ${label(b)}`)
      }
    }
    if (pair.length > 0) axis2.push({ ...where, detail: pair.join(' | ') })

    // ── 축 ① — 날짜 잡힌 예약이 무기한 점유 위에 얹혀 있는가.
    const datedReservations = occ.filter(l => l.status === 'RESERVED' && l.expectedMoveOut)
    if (datedReservations.length === 0) continue
    const indefinite = occ.filter(l => !l.expectedMoveOut)
    if (indefinite.length === 0) continue
    // 예약이 무기한 점유와 겹치는가 — 예약 퇴실일이 무기한 계약의 입주일보다 앞이면 안 겹친다.
    // 무기한 계약에 입주일이 없으면 이미 시작된 점유로 보고 겹침으로 판정한다.
    const clashes = datedReservations.some(res => indefinite.some(ind => {
      const indStart = ymd(ind.moveInDate)
      return !indStart || ymd(res.expectedMoveOut) >= indStart
    }))
    if (!clashes) continue
    axis1.push({ ...where, detail: occ.map(label).join(' | ') })
  }

  const report = (title, rows, fix) => {
    if (rows.length === 0) return 0
    console.error(`[입주 가능 정합] ${title} — 위반 ${rows.length}건`)
    for (const v of rows) console.error(`  ${v.property} ${v.roomNo}호: ${v.detail}`)
    console.error(`  조치: ${fix}`)
    return rows.length
  }

  let bad = 0
  bad += report('날짜 잡힌 예약이 무기한 점유 위에 얹혀 있다', axis1,
    '무기한 계약의 퇴실 예정일을 넣거나, 그 예약을 다른 방으로 옮긴다.')
  bad += report('한 방에 체류 구간이 겹치는 계약이 둘 이상이다(이중 점유)', axis2,
    '겹치는 쪽의 입주일 또는 퇴실 예정일을 옮기거나, 한쪽을 다른 방으로 옮긴다.')
  bad += report('공실 집계 제외 방(창고·사무실)에 거주·예약 계약이 있다', axis3,
    '그 계약을 다른 방으로 옮기거나, 호실 관리 편집에서 공실 집계에서 제외를 해제한다.')

  await prisma.$disconnect()
  if (bad > 0) process.exit(1)
  console.log(`[입주 가능 정합] 방 ${rooms.length}개 검사 / 위반 0건 (축 3종)`)
}

main()
