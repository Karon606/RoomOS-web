// 요청·컴플레인의 호실 스냅샷(TenantRequest.roomNoSnapshot) 백필 — 컬럼 추가 이전 데이터만 대상.
// 생성 경로(createTenantRequest·updateTenantRequest·엑셀 임포트)는 이미 lib/requestRoomSnapshot 으로 수정 배포됨.
// 규칙: 활성 계약(ACTIVE·RESERVED·CHECKOUT_PENDING)의 호실 → 없으면(퇴실) 최신 계약 호실로 best-effort.
// 공용부 요청(tenantId null)은 스냅샷 대상이 아니므로 건너뛴다. 드라이런 기본, 적용은 --apply.
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
const APPLY = process.argv.includes('--apply')

const ACTIVE = ['ACTIVE', 'RESERVED', 'CHECKOUT_PENDING']

async function roomNoOf(tenantId) {
  const active = await prisma.leaseTerm.findFirst({
    where: { tenantId, status: { in: ACTIVE } },
    orderBy: { status: 'asc' },
    select: { room: { select: { roomNo: true } } },
  })
  if (active?.room?.roomNo) return { roomNo: active.room.roomNo, basis: '활성' }

  // 퇴실자 — 등록 당시 호실을 알 길이 없으니 마지막으로 살던 방으로 채운다(근사값).
  const latest = await prisma.leaseTerm.findFirst({
    where: { tenantId },
    orderBy: [{ moveInDate: 'desc' }, { createdAt: 'desc' }],
    select: { room: { select: { roomNo: true } } },
  })
  if (latest?.room?.roomNo) return { roomNo: latest.room.roomNo, basis: '최신(퇴실)' }
  return null
}

async function main() {
  const requests = await prisma.tenantRequest.findMany({
    where: { deletedAt: null, roomNoSnapshot: null, tenantId: { not: null } },
    orderBy: { requestDate: 'asc' },
    select: { id: true, tenantId: true, requestDate: true, tenant: { select: { name: true } } },
  })

  const cache = new Map()
  let filled = 0, missing = 0

  for (const r of requests) {
    if (!cache.has(r.tenantId)) cache.set(r.tenantId, await roomNoOf(r.tenantId))
    const hit = cache.get(r.tenantId)
    const ymd = new Date(r.requestDate).toISOString().slice(0, 10)
    if (!hit) {
      missing++
      console.log(`[스킵] ${ymd} ${r.tenant?.name ?? '?'}: 배정된 호실 계약 없음`)
      continue
    }
    filled++
    console.log(`${ymd} ${r.tenant?.name ?? '?'}: → ${hit.roomNo}호 (${hit.basis})`)
    if (!APPLY) continue
    await prisma.tenantRequest.update({ where: { id: r.id }, data: { roomNoSnapshot: hit.roomNo } })
  }

  console.log(`\n대상 ${requests.length}건 · 채움 ${filled}건 · 호실 미상 ${missing}건${APPLY ? ' (적용됨)' : ' (드라이런 — 적용은 --apply)'}`)
}

main()
  .catch(e => { console.error(e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
