// 계약 이용료와 방 이용료가 어긋난 사고 신호 감지(읽기 전용). 기준선 밖 새 건이 생기면 exit 1.
//
// 왜(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 입주자 수정 폼이 비거주 15만 원 계약을 602호(기본 3만, 비거주 이용료 없음)로
// 옮기며 칸을 기본 이용료 3만 원으로 덮었고, 호실 수정은 비거주 이용료를 15만 원으로 정해도 계약을 따라가게 하지 않았다. 폼(lib/leaseRentAutofill)과
// 방 저장(lib/roomRentSync)을 고쳤으니, 같은 모양이 데이터에 새로 생기면 생성 경로가 다시 샌 것이다. 협의가 자체는 정상이라 협의가를 잡지 않고
// 사고의 모양 둘만 본다.
//   (a) 비거주 계약인데 계약 이용료가 방 기본 이용료와 같고, 방 비거주 이용료가 비었거나 그 금액과 다르다(사건 앞 절반의 모양).
//   (b) 계약 이용료가 최근 3개월 중 가장 늦은 락(그 달 수납 기록 expectedAmount 최대)과 다르고, 그 락이 지금 방의 그 축 기준가와 같다
//       (방 값은 바뀌었는데 계약이 안 따라갔거나 잘못 따라간 모양).
// 단기 계약은 rentAmount 가 체류 전체 사용료라 보지 않는다. 그 밖의 운영 판단(사람이 정한 협의가)은 기준선에 이름을 적어 둔다.
// 기준선은 래칫이다. 줄면 이 표를 줄이라고 알리고, 기준선 밖 건이 생기면 실패다. 데이터를 고치지 않는다(땜빵 금지, 고칠지는 운영자가 정한다).
//
// 실행: npx tsx --env-file=.env.local scripts/check-lease-rent-drift.ts
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { kstMonthStr } from '@/lib/kstDate'

/** 기준선(계약 id 와 신호). 2026-10-28 운영 DB 읽기 전용 조회 결과. */
const BASELINE: Record<string, 'a' | 'b'> = {
  // 사건 당사자. 602호 홍은주 비거주 3만 원(602호 비거주 이용료 15만 원). 고칠지는 운영자가 정한다. 배포 뒤 호실 수정 폼 비거주 이용료 칸 아래
  // '계약 1건이 이 금액과 다릅니다 · 계약에 적용' 을 눌러 저장하면 기록 없는 달부터 15만 원이 되고 이 줄은 풀린다(적용취소 가능).
  '6a4cb349-365a-4aa8-b6e1-f15e8d437ac7': 'a',
}

const RESIDENT = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING'] as const

function prevMonths(cur: string, n: number): string[] {
  const [y, m] = cur.split('-').map(Number)
  const out: string[] = []
  for (let i = 0; i < n; i++) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1))
    out.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`)
  }
  return out
}

async function main() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
  const months = prevMonths(kstMonthStr(), 3)
  const leases = await prisma.leaseTerm.findMany({
    where: { isShortTerm: false, roomId: { not: null }, status: { in: [...RESIDENT, 'NON_RESIDENT'] } },
    select: {
      id: true, propertyId: true, status: true, rentAmount: true,
      tenant: { select: { name: true } },
      room: { select: { roomNo: true, baseRent: true, nonResidentRent: true, propertyId: true } },
    },
  })
  const locks = await prisma.paymentRecord.groupBy({
    by: ['leaseTermId', 'targetMonth'],
    where: { leaseTermId: { in: leases.map(l => l.id) }, targetMonth: { in: months }, isDeposit: false, isPrevOwner: false, deletedAt: null },
    _max: { expectedAmount: true },
  })
  const lockOf = new Map<string, { month: string; amount: number }>()
  for (const r of locks) {
    const amt = r._max.expectedAmount ?? 0
    if (amt <= 0) continue
    const cur = lockOf.get(r.leaseTermId)
    if (!cur || r.targetMonth > cur.month) lockOf.set(r.leaseTermId, { month: r.targetMonth, amount: amt })
  }

  const hits: { id: string; sig: 'a' | 'b'; text: string }[] = []
  let crossProperty = 0
  for (const l of leases) {
    const room = l.room!
    if (room.propertyId !== l.propertyId) crossProperty++
    const won = (n: number | null) => (n == null ? '없음' : `${n.toLocaleString('ko-KR')}원`)
    const who = `${room.roomNo}호 ${l.tenant?.name ?? ''}(${l.id.slice(0, 8)})`
    const isNR = l.status === 'NON_RESIDENT'
    if (isNR && l.rentAmount > 0 && l.rentAmount === room.baseRent && room.nonResidentRent !== l.rentAmount) {
      hits.push({ id: l.id, sig: 'a', text: `(a) ${who} 비거주 계약 ${won(l.rentAmount)} = 기본 이용료, 비거주 이용료 ${won(room.nonResidentRent)}` })
      continue
    }
    const lock = lockOf.get(l.id)
    const std = isNR ? room.nonResidentRent : room.baseRent
    if (lock && std != null && lock.amount !== l.rentAmount && lock.amount === std) {
      hits.push({ id: l.id, sig: 'b', text: `(b) ${who} 계약 ${won(l.rentAmount)}, ${lock.month} 락 ${won(lock.amount)} = 방 ${isNR ? '비거주' : '기본'} 이용료` })
    }
  }
  await prisma.$disconnect()

  const fresh = hits.filter(h => BASELINE[h.id] !== h.sig)
  const gone = Object.keys(BASELINE).filter(id => !hits.some(h => h.id === id))
  for (const h of hits) console.log(`  ${BASELINE[h.id] === h.sig ? '기준선' : '새 건'} ${h.text}`)
  if (crossProperty > 0) console.log(`  참고: 계약과 방의 영업장이 다른 행 ${crossProperty}건(이 그물의 판정 밖, 정합 감사 대상)`)
  if (gone.length) console.log(`  기준선 ${gone.length}건이 풀렸다. BASELINE 에서 지운다: ${gone.join(', ')}`)
  console.log(`[계약 이용료 어긋남] 대상 ${leases.length}건 · 최근 락 ${months.join('·')} · 신호 ${hits.length}건(기준선 ${hits.length - fresh.length}) / 새 건 ${fresh.length}건`)
  if (fresh.length > 0) process.exit(1)
}

main().catch(e => { console.error(e); process.exit(2) })
