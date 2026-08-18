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
// 확인창(overlapOccupancy)과 같은 선이다. 퇴실 예정일이 없는 계약은 무기한이라 그 뒤 전부와 겹친다.
//
// 이 축은 2026-08-19 겹침 판정 개정으로 둘을 뺀다(운영자 확정).
//   · **당일 회전** — 앞이 나가는 그날 뒤가 들어오고 겹침이 그 하루뿐이면 정상 운영이다.
//     종전에는 이것이 위반으로 서서, 정상인 방이 매일 감지망에 이름을 올렸다.
//   · **확인된 겹침** — 운영자가 의도된 것으로 확인한 구간(LeaseOverlapAck)은 위반이 아니다.
//     단 확인은 **구간 스냅샷**이라, 지금 겹침이 그 구간을 하루라도 넘으면 다시 위반이다.
//     겹침이 사라졌는데 남아 있는 확인은 위반이 아니라 정보 줄로만 말한다(청소 대상이지 사고가 아니다).
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
//
// 축 ④ 한 사람이 거주 계약(ACTIVE·CHECKOUT_PENDING)을 2건 이상 들고 있는 경우.
//
// 왜 이게 사고인가 — 1인 다호실은 **비거주 부계약만 허용**이 현 운영 전제다(운영자 확정
// 2026-08-13: 601호는 김상혁의 두 번째 계약이되 NON_RESIDENT·창고다). 한 사람에게 거주 계약이
// 둘이면 그 사람이 두 방에 동시에 산다는 뜻이고, 그러면 메인 계약 선택(primaryTenantLease)이
// 배열 순서에 의존하게 되어 같은 사람이 화면마다 다른 계약으로 보인다 — 방 축이 2026-06 에
// 겪은 그 사고의 사람 축 판본이다. 수납 행 순서(roomLeaseRowOrder)와 주 계약이 갈리는 구간도
// 정확히 여기다(test-lease-primary 가 그 경계를 잠근다).
//
// 운영이 실제로 2실 거주를 하기로 하면 이 축은 오탐이 된다. 그때는 규칙을 바꾸는 것이 아니라
// **기준선을 갱신**한다(BASELINE_TWO_RESIDENCES) — 지금 기준선은 0 이다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// 방을 잡고 있는 계약 — app/(app)/room-manage/RoomManageClient.tsx OCCUPYING_STATUSES 와 같은 정의.
const OCCUPYING_STATUSES = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING']

// lib/vacancy.ts isVacancyExcluded 와 같은 정의 — 방 설정 하나(거주용이 아닌 방).
const isVacancyExcluded = (nonResidentVacant) => !nonResidentVacant

// 거주 계약 — lib/leaseStatus 의 CURRENT_OCCUPANCY_STATUSES 와 같은 정의.
const CURRENT_OCCUPANCY_STATUSES = ['ACTIVE', 'CHECKOUT_PENDING']
// 한 사람이 거주 계약 둘을 정당하게 들고 있는 인원 수. 오늘 0 명이다.
const BASELINE_TWO_RESIDENCES = 0

// ── 겹침 판정 사본 ──────────────────────────────────────────────
// lib/roomAssignment.ts 의 occupancyOverlapSpan · isSameDayTurnover 와 **같은 식**이다.
// 이 스크립트는 .mjs 라 TS 정본을 import 하지 못해 사본을 든다. 저쪽 주석도 여기를 가리킨다 —
// 한쪽만 고치면 감지망과 앱이 서로 다른 답을 말하기 시작하므로 반드시 함께 고친다.
const overlapSpan = (a, b) => {
  const overlaps = (!a.moveOut || !b.moveIn || a.moveOut >= b.moveIn)
    && (!b.moveOut || !a.moveIn || b.moveOut >= a.moveIn)
  if (!overlaps) return null
  const later = (x, y) => (x && y ? (x > y ? x : y) : (x ?? y))
  const earlier = (x, y) => (x && y ? (x < y ? x : y) : (x ?? y))
  return { from: later(a.moveIn, b.moveIn), to: earlier(a.moveOut, b.moveOut) }
}
const sameDayTurnover = (a, b) => {
  const s = overlapSpan(a, b)
  if (!s || !s.from || !s.to || s.from !== s.to) return false
  const day = s.from
  const turns = (front, back) => front.moveOut === day && back.moveIn === day && (front.moveIn === null || front.moveIn < day)
  return turns(a, b) || turns(b, a)
}
/** 두 계약 id 로 만드는 확인 색인 키 — 앞뒤 순서를 묻지 않는다(날짜가 밀리면 순서가 바뀐다). */
const pairKey = (x, y) => (x < y ? `${x}|${y}` : `${y}|${x}`)

async function main() {
  const rooms = await prisma.room.findMany({
    orderBy: { roomNo: 'asc' },
    select: {
      roomNo: true,
      nonResidentVacant: true,
      property: { select: { name: true } },
      leaseTerms: {
        where: { status: { in: [...OCCUPYING_STATUSES, 'NON_RESIDENT'] } },
        select: { id: true, status: true, moveInDate: true, expectedMoveOut: true, tenant: { select: { name: true } } },
      },
    },
  })

  // 유효한 확인(해제분 제외) — 축 ②가 위반에서 뺄 근거다.
  const acks = await prisma.leaseOverlapAck.findMany({
    where: { deletedAt: null },
    select: { id: true, frontLeaseTermId: true, backLeaseTermId: true, overlapFrom: true, overlapTo: true },
  })
  const acksByPair = new Map()
  for (const k of acks) {
    const key = pairKey(k.frontLeaseTermId, k.backLeaseTermId)
    acksByPair.set(key, [...(acksByPair.get(key) ?? []), k])
  }
  /** 지금 겹치고 있는 쌍의 확인 id — 여기 없는 확인은 겹침이 사라진 잔존분이다. */
  const liveAckIds = new Set()
  let ackedPairs = 0

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

    // ── 축 ② — 두 구간이 실제로 포개지는 쌍이 하나라도 있는가.
    // 당일 회전은 빼고, 확인된 겹침도 뺀다(확인 구간을 넘으면 다시 위반이다).
    const pair = []
    for (let i = 0; i < occ.length; i++) {
      for (let j = i + 1; j < occ.length; j++) {
        const a = occ[i], b = occ[j]
        // 입주일이 없으면 이미 시작된 점유로, 퇴실 예정일이 없으면 무기한으로 읽는다.
        const sa = { moveIn: ymd(a.moveInDate), moveOut: ymd(a.expectedMoveOut) }
        const sb = { moveIn: ymd(b.moveInDate), moveOut: ymd(b.expectedMoveOut) }
        const span = overlapSpan(sa, sb)
        if (!span) continue
        if (sameDayTurnover(sa, sb)) continue
        const hit = (acksByPair.get(pairKey(a.id, b.id)) ?? []).find(k =>
          span.from && span.to && span.from >= k.overlapFrom && span.to <= k.overlapTo)
        for (const k of acksByPair.get(pairKey(a.id, b.id)) ?? []) liveAckIds.add(k.id)
        if (hit) { ackedPairs++; continue }
        pair.push(`${label(a)} <> ${label(b)}`)
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

  // ── 축 ④ — 사람 축. 방이 아니라 사람을 단위로 센다.
  const people = await prisma.tenant.findMany({
    select: {
      name: true,
      property: { select: { name: true } },
      leaseTerms: {
        where: { status: { in: CURRENT_OCCUPANCY_STATUSES } },
        select: { status: true, moveInDate: true, expectedMoveOut: true, room: { select: { roomNo: true } } },
      },
    },
  })
  const axis4 = []
  for (const t of people) {
    if (t.leaseTerms.length < 2) continue
    axis4.push({
      property: t.property?.name ?? '?',
      // 이 축의 주어는 방이 아니라 사람이다 — 행 머리를 그대로 쓴다('호'를 붙이지 않는다).
      subject: t.name,
      detail: t.leaseTerms.map(l => `${l.room?.roomNo ?? '호실 미지정'}/${l.status}/${ymd(l.moveInDate) ?? '미정'}~${ymd(l.expectedMoveOut) ?? '무기한'}`).join(' | '),
    })
  }

  const report = (title, rows, fix) => {
    if (rows.length === 0) return 0
    console.error(`[입주 가능 정합] ${title} — 위반 ${rows.length}건`)
    for (const v of rows) console.error(`  ${v.property} ${v.subject ?? `${v.roomNo}호`}: ${v.detail}`)
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
  if (axis4.length > BASELINE_TWO_RESIDENCES) {
    bad += report('한 사람이 거주 계약을 2건 이상 들고 있다(다호실은 비거주 부계약만 허용)', axis4,
      '한쪽을 비거주(창고·사무실 명의)로 바꾸거나 종료한다. 2실 거주가 실제 운영 방침이 되면 이 스크립트의 BASELINE_TWO_RESIDENCES 를 갱신한다.')
  }

  // 겹침이 사라졌는데 남아 있는 확인 — 위반이 아니다. 날짜를 옮겨 겹침을 푼 정상 처리의 흔적이고,
  // 그 계약들이 다시 겹치면 그때 다시 유효해진다. 사실만 한 줄로 적어 둔다.
  const staleAcks = acks.filter(k => !liveAckIds.has(k.id))
  if (staleAcks.length > 0) {
    console.log(`[입주 가능 정합] 겹침이 사라진 확인 ${staleAcks.length}건 — 위반 아님(다시 겹치면 그때 유효해진다).`)
  }

  await prisma.$disconnect()
  if (bad > 0) process.exit(1)
  console.log(`[입주 가능 정합] 방 ${rooms.length}개 · 입주자 ${people.length}명 검사 / 위반 0건 · 확인된 겹침 ${ackedPairs}건 (축 4종, 2실 거주 기준선 ${BASELINE_TWO_RESIDENCES})`)
}

main()
