// 희망 매칭 정합 감지 — 읽기 전용. 발견 시 exit 1(수정은 하지 않는다).
//
// 매칭은 두 축이 맞물려 돌아간다. 방 축(어느 방이 언제 비는가)과 사람 축(그 날짜에 맞는가).
// 둘 중 하나가 조용히 어긋나면 알림은 계속 뜬다 — 틀린 방을, 틀린 사람에게. 화면은 아무 말도
// 안 하므로 눈으로는 못 잡는다. 세 축으로 그 어긋남만 본다.
//
//   1) 방 집합 차 — 매칭이 쓰는 방 축(계약 사실)과 공실 플래그(Room.isVacant)가 다른 방을 가리킨다.
//      매칭은 "이 방 지금 비어 있다"고 알리는데 공실 카운터는 그 방을 안 세거나, 그 반대다.
//   2) 게이트 누락 — 희망 호실을 적어 둔 사람인데 그 방이 방 축에 아예 없다(무기한 점유가 얹혀
//      언제 비는지 모르는 방). 게이트가 물을 날짜가 없어 후보로도 제외자로도 안 잡히고 조용히 사라진다.
//      제외 notice 조차 못 붙는 유일한 구멍이다.
//   3) 거짓 표시 — 게이트가 읽지 않는 자리에 moveInFlexible 이 남아 있다(희망일 없음 / 리드 3상태 아님).
//      상세 모달이 '가능'·'불가'를 말하는데 매칭은 그 값을 안 본다 — 화면이 사실 아닌 것을 말하는 상태다.
//
// 1·3은 폼·서버 경로로는 만들 수 없다(방 축은 계약에서 파생하고, 조절 여부는 희망일이 있을 때만
// 예약·투어 단계에서 그려진다). 걸리면 손수 고친 데이터이거나 코드가 어긋난 것이다.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })

// lib/leaseStatus 의 OCCUPYING_STATUSES · lib/wishMatch 의 WISH_LEAD_STATUSES 와 같은 정의.
const OCCUPYING_STATUSES = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING']
const LEAD_STATUSES = ['WAITING_TOUR', 'TOUR_DONE', 'RESERVED']

const ymd = d => d == null ? null : new Date(d).toISOString().slice(0, 10)

// lib/leaseStatus.roomAvailability 와 같은 판정(문자 그대로 옮긴 것 — 여기가 그 규칙의 감시자다).
function roomAvailability(room) {
  const occ = room.leaseTerms.filter(l => OCCUPYING_STATUSES.includes(l.status))
  if (occ.length === 0) {
    if (!room.nonResidentVacant) return null
    return { kind: 'now' }
  }
  const outs = occ.map(l => ymd(l.expectedMoveOut))
  if (outs.some(o => o == null)) return null
  const last = outs.reduce((m, o) => (o > m ? o : m), outs[0])
  const d = new Date(`${last}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return { kind: 'soon', availableFrom: d.toISOString().slice(0, 10) }
}

async function main() {
  const rooms = await prisma.room.findMany({
    orderBy: { roomNo: 'asc' },
    select: {
      roomNo: true, isVacant: true, nonResidentVacant: true, propertyId: true,
      property: { select: { name: true } },
      leaseTerms: {
        where: { status: { in: [...OCCUPYING_STATUSES, 'NON_RESIDENT'] } },
        select: { status: true, expectedMoveOut: true, tenant: { select: { name: true } } },
      },
    },
  })
  const leases = await prisma.leaseTerm.findMany({
    where: {
      status: { in: ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING', 'WAITING_TOUR', 'TOUR_DONE', 'NON_RESIDENT', 'CHECKED_OUT', 'CANCELLED'] },
      OR: [{ wishRooms: { not: null } }, { wishConditions: { not: null } }, { moveInFlexible: { not: null } }],
    },
    select: {
      id: true, status: true, wishRooms: true, moveInDate: true, moveInFlexible: true,
      reservationConfirmedAt: true, propertyId: true,
      tenant: { select: { name: true } },
      property: { select: { name: true } },
      room: { select: { roomNo: true } },
    },
  })

  const availByKey = new Map()
  const roomAxis = []
  const gapAxis = []
  const falseAxis = []

  for (const r of rooms) {
    const av = roomAvailability(r)
    availByKey.set(`${r.propertyId}|${r.roomNo}`, av)
    // 1) 방 집합 차 — '지금 비어 있다'와 isVacant 플래그가 어긋나면 두 화면이 다른 방을 센다.
    //    공실 집계 제외 방(창고·사무실)은 두 정의가 일부러 다르므로 검사에서 뺀다(lib/vacancy 정본).
    if (!r.nonResidentVacant) continue
    const isNow = av?.kind === 'now'
    if (isNow !== r.isVacant) {
      roomAxis.push({
        property: r.property?.name ?? '?', roomNo: r.roomNo,
        detail: `isVacant=${r.isVacant} / 계약 사실=${av ? (av.kind === 'now' ? '지금 공실' : `${av.availableFrom} 입주 가능`) : '무기한 점유'}`
          + ` | ${r.leaseTerms.map(l => `${l.status}/${l.tenant?.name ?? '-'}/${ymd(l.expectedMoveOut) ?? '무기한'}`).join(' · ') || '계약 없음'}`,
      })
    }
  }

  for (const l of leases) {
    const isLead = LEAD_STATUSES.includes(l.status) && !l.reservationConfirmedAt
    // 2) 게이트 누락 — 희망 호실이 방 축에 없는 방이라 후보로도 제외자로도 안 잡힌다.
    if (isLead) {
      for (const no of (l.wishRooms ?? '').split(',').map(s => s.trim()).filter(Boolean)) {
        if (l.room?.roomNo === no) continue
        const key = `${l.propertyId}|${no}`
        if (!availByKey.has(key)) continue          // 그 영업장에 없는 호실번호는 별건(오타)
        if (availByKey.get(key) !== null) continue
        gapAxis.push({
          property: l.property?.name ?? '?', roomNo: no,
          detail: `${l.tenant.name}님(${l.status})이 희망했으나 ${no}호는 언제 비는지 모르는 방이라 후보에도 제외 명단에도 없다`,
        })
      }
    }
    // 3) 거짓 표시 — 게이트가 안 읽는 자리에 남은 조절 여부.
    if (l.moveInFlexible != null) {
      if (!isLead) {
        falseAxis.push({
          property: l.property?.name ?? '?', roomNo: l.room?.roomNo ?? '-',
          detail: `${l.tenant.name}님 · 상태 ${l.status}${l.reservationConfirmedAt ? '(예약 확정)' : ''} 인데 조절 여부=${l.moveInFlexible} 잔존 — 매칭은 이 값을 안 본다`,
        })
      } else if (!l.moveInDate) {
        falseAxis.push({
          property: l.property?.name ?? '?', roomNo: l.room?.roomNo ?? '-',
          detail: `${l.tenant.name}님 · 입주 희망일이 없는데 조절 여부=${l.moveInFlexible} — 무엇에 대한 답인지 없는 값`,
        })
      }
    }
  }

  const report = (title, rows, fix) => {
    if (rows.length === 0) return 0
    console.error(`[희망 매칭 정합] ${title} 위반 ${rows.length}건`)
    for (const v of rows) console.error(`  ${v.property} ${v.roomNo}호: ${v.detail}`)
    console.error(`  조치: ${fix}`)
    return rows.length
  }

  let bad = 0
  bad += report('방 집합 차', roomAxis, '공실 플래그와 계약 사실 중 어느 쪽이 맞는지 확인하고 틀린 쪽을 고친다.')
  bad += report('게이트 누락', gapAxis, '그 방 무기한 계약에 퇴실 예정일을 넣거나, 희망 호실에서 그 방을 뺀다.')
  bad += report('거짓 표시', falseAxis, '입주 희망일을 넣거나, 폼에서 일정 조절을 기본값으로 되돌린다.')
  if (bad > 0) process.exit(1)

  console.log(`[희망 매칭 정합] 방 ${rooms.length}개 · 희망 보유 계약 ${leases.length}건 검사 / 위반 0건`)
  await prisma.$disconnect()
}

main()
