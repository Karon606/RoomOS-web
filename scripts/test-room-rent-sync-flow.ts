// 계약 금액 자동 채움·방 이용료 저장의 계약 동기화 통합 회귀. 실제 입주자·호실 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.reason-flow.json scripts/test-room-rent-sync-flow.ts
//
// 왜 통합인가(2026-10-27 운영자 승인 '추천대로', 홍은주 602호 사건). 418호 비거주 15만 원 계약을 입주자 수정 폼으로 602호(기본 3만,
// 비거주 이용료 없음)로 옮기자 3만 원으로 저장됐고, 뒤에 602호 비거주 이용료를 15만 원으로 정해도 계약은 3만 원에 남았다.
// 폼 판정(lib/leaseRentAutofill)이 고른 값이 실제 저장까지 그대로 가는지는 쓰기를 돌려야 보인다.
// 대역·운영 DB 차단은 다른 통합 하네스(scripts/test-room-record-edit-flow.ts)와 같은 판이다.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')   // 서명 키가 있는 판(위조 거부를 실제로 본다)

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}

function schemaSql(): string {
  const bin = path.join(ROOT, 'node_modules', '.bin', 'prisma')
  const out = execFileSync(bin, ['migrate', 'diff', '--from-empty', '--to-schema', 'prisma/schema.prisma', '--script'], {
    cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DATABASE_URL: URL, DIRECT_URL: URL },
  })
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const tenants = await import('@/app/(app)/tenants/actions')
  const autofill = await import('@/lib/leaseRentAutofill')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const roomIn = async (pid: string, roomNo: string, baseRent: number, nonResidentRent: number | null = null) =>
    (await prisma.room.create({ data: { propertyId: pid, roomNo, baseRent, nonResidentRent, isVacant: true } }))
  const tenantIn = async (pid: string, name: string) => (await prisma.tenant.create({ data: { propertyId: pid, name } })).id as string
  const leaseIn = async (pid: string, tenantId: string, roomId: string, status: string, rentAmount: number, extra: Record<string, unknown> = {}) =>
    (await prisma.leaseTerm.create({ data: { propertyId: pid, tenantId, roomId, status: status as never, rentAmount, moveInDate: new Date('2026-08-01T00:00:00Z'), dueDay: '1', ...extra } })).id as string
  const rentOf = async (id: string) => (await prisma.leaseTerm.findUnique({ where: { id }, select: { rentAmount: true } }))?.rentAmount
  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  const toRentRoom = (r: { id: string; roomNo: string; baseRent: number; nonResidentRent: number | null }) => ({ id: r.id, roomNo: r.roomNo, baseRent: r.baseRent, nonResidentRent: r.nonResidentRent })

  // ── ① 비거주 15만 원을 비거주 이용료 없는 방으로 옮겨 저장해도 15만 원(사건) ─────────────────────
  const R418 = await roomIn(P1, '418', 500000, 150000)
  const R602 = await roomIn(P1, '602', 30000, null)
  const T1 = await tenantIn(P1, '홍은주')
  const L1 = await leaseIn(P1, T1, R418.id, 'NON_RESIDENT', 150000)
  {
    // 폼이 하는 일: 저장된 금액이 있으니 호실을 바꿔도 칸을 덮지 않는다.
    const pick = autofill.nextRentOnChange({ saved: autofill.savedLeaseRent({ id: L1, rentAmount: 150000 }), current: 150000, room: toRentRoom(R602), isNR: true })
    eq('① 폼 판정: 그대로', pick, { kind: 'keep' })
    const up = await tenants.updateTenant(fd({ tenantId: T1, leaseTermId: L1, name: '홍은주', status: 'NON_RESIDENT', roomId: R602.id, rentAmount: '150000', moveInDate: '2026-08-01', dueDay: '1', moveDate: '2026-10-27' }))
    eq('① 저장 ok, 계약 15만 원 유지, 사건 안내 없음', [up.ok ? true : up.error, await rentOf(L1), up.ok ? (up.notice ?? '').includes('기본 이용료와 같습니다') : null], [true, 150000, false])
    // 손으로 기본 이용료와 같은 3만 원을 적으면 저장은 되고(거부 아님) 한 번 알린다.
    const up2 = await tenants.updateTenant(fd({ tenantId: T1, leaseTermId: L1, name: '홍은주', status: 'NON_RESIDENT', roomId: R602.id, rentAmount: '30000', moveInDate: '2026-08-01', dueDay: '1' }))
    eq('① 사건 모양(비거주·비거주 이용료 없음·기본 이용료와 같음): 저장 + 안내', [up2.ok ? true : up2.error, await rentOf(L1), up2.ok ? up2.notice?.includes('602호에 비거주 이용료가 없어 이 계약 이용료 30,000원이 기본 이용료와 같습니다.') : null], [true, 30000, true])
    await prisma.leaseTerm.update({ where: { id: L1 }, data: { rentAmount: 150000 } })
  }

  // ── ② 거주 협의가 45만 원을 기본 50만 원 방으로 옮겨도 45만 원 ─────────────────────────────
  const R510 = await roomIn(P1, '510', 500000)
  const R511 = await roomIn(P1, '511', 480000)
  const T2 = await tenantIn(P1, '김협의')
  const L2 = await leaseIn(P1, T2, R511.id, 'ACTIVE', 450000)
  await prisma.room.update({ where: { id: R511.id }, data: { isVacant: false } })
  {
    const pick = autofill.nextRentOnChange({ saved: 450000, current: 450000, room: toRentRoom(R510), isNR: false })
    eq('② 폼 판정: 그대로', pick, { kind: 'keep' })
    const up = await tenants.updateTenant(fd({ tenantId: T2, leaseTermId: L2, name: '김협의', status: 'ACTIVE', roomId: R510.id, rentAmount: '450000', moveInDate: '2026-08-01', dueDay: '1', moveDate: '2026-10-27' }))
    eq('② 저장 ok, 협의가 45만 원 유지, 방은 510호', [up.ok ? true : up.error, await rentOf(L2), (await prisma.leaseTerm.findUnique({ where: { id: L2 } }))?.roomId], [true, 450000, R510.id])
  }

  // ── ③ 새 계약 빈 칸은 방 기본가로 채운다 ───────────────────────────────────────────
  {
    const R512 = await roomIn(P1, '512', 420000)
    const pick = autofill.nextRentOnChange({ saved: autofill.savedLeaseRent(null), current: undefined, room: toRentRoom(R512), isNR: false })
    eq('③ 폼 판정: 기본 이용료로 채움', pick, { kind: 'set', value: 420000 })
    const r = await tenants.addTenant(fd({ name: '새입주', status: 'ACTIVE', roomId: R512.id, rentAmount: String(pick.kind === 'set' ? pick.value : 0), moveInDate: '2026-10-27', dueDay: '27', contactType: 'PHONE', contactValue: '010-1234-5678' }))
    const lease = await prisma.leaseTerm.findFirst({ where: { propertyId: P1, roomId: R512.id } })
    eq('③ 새 계약 저장 ok, 42만 원', [r.ok ? true : r.error, lease?.rentAmount], [true, 420000])
    eq('③ 새 계약 + 비거주 이용료 없는 방은 기본 이용료로 대체하지 않는다', autofill.nextRentOnChange({ saved: null, current: undefined, room: toRentRoom(R602), isNR: true }), { kind: 'keep' })
  }


  // ── ③b 독립 검수 B2: 등록 폼에서 거주로 602호(같은 꼴 620호)를 골라 3만 원이 채워진 뒤 비거주로 바꾸면 3만 원이 남지 않는다 ──────────
  {
    const R620 = await roomIn(P1, '620', 30000, null)
    const first = autofill.nextRentOnChange({ saved: null, current: undefined, room: toRentRoom(R620), isNR: false })
    const auto = first.kind === 'set' ? first.value : undefined
    const toNR = autofill.nextRentOnChange({ saved: null, current: auto, room: toRentRoom(R620), isNR: true, autoFilled: auto })
    eq('③b 거주로 채운 3만 원, 비거주로 바꾸면 비운다', [auto, toNR], [30000, { kind: 'set', value: undefined }])
    const r = await tenants.addTenant(fd({ name: '비거주새', status: 'NON_RESIDENT', roomId: R620.id, rentAmount: toNR.kind === 'set' && toNR.value ? String(toNR.value) : '', moveInDate: '2026-10-27', dueDay: '27', contactType: 'PHONE', contactValue: '010-2222-3333' }))
    const nl = await prisma.leaseTerm.findFirst({ where: { propertyId: P1, roomId: R620.id, status: 'NON_RESIDENT', tenant: { name: '비거주새' } } })
    eq('③b 저장된 비거주 계약은 기본 이용료 3만 원이 아니다', [r.ok ? true : r.error, nl?.rentAmount], [true, 0])
    if (nl) await prisma.leaseTerm.delete({ where: { id: nl.id } })
  }

  console.log(`[방 이용료 계약 동기화 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
