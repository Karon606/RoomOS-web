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
  const rm = await import('@/app/(app)/room-manage/actions')
  const sched = await import('@/lib/scheduledRent')
  const engine = await import('@/app/(app)/rooms/paymentEngine')
  const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다
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

  // ── 방 저장 공통 ───────────────────────────────────────────────────────────
  const roomForm = async (roomId: string, o: { baseRent: number; nr: number | null; pick?: Record<string, string[]>; expect?: Record<string, string> }) => {
    const r = (await prisma.room.findUnique({ where: { id: roomId } }))!
    return fd({
      id: roomId, roomNo: r.roomNo, type: '', tier: '', baseRent: String(o.baseRent), memo: '',
      nonResidentEnabled: o.nr == null ? '0' : '1', ...(o.nr == null ? {} : { nonResidentRent: String(o.nr) }),
      ...(o.pick ? { rentSyncLeaseIds: JSON.stringify(o.pick) } : {}), ...(o.expect ? { rentSyncExpect: JSON.stringify(o.expect) } : {}),
    })
  }
  const roomRents = async (id: string) => { const r = await prisma.room.findUnique({ where: { id }, select: { baseRent: true, nonResidentRent: true } }); return [r?.baseRent, r?.nonResidentRent] }

  // ── ④ 비거주 이용료 변경 + 고른 계약만 적용(사건의 뒤 절반) ─────────────────────────────
  await prisma.leaseTerm.update({ where: { id: L1 }, data: { roomId: R602.id, rentAmount: 30000 } })   // 사건 뒤 모습: 602호 비거주 3만 원
  const T4 = await tenantIn(P1, '박둘')
  const L4 = await leaseIn(P1, T4, R602.id, 'NON_RESIDENT', 20000)
  const pv4 = await rm.previewRoomRentSync(R602.id, { baseRent: 30000, nonResidentRent: 150000 })
  eq('④ 미리보기: 비거주 이용료가 없던 방이라 따라갈 계약 없음, 다른 계약 둘', pv4.ok ? [pv4.nonResident?.prevRent, pv4.nonResident?.followers.length, pv4.nonResident?.differing.map(d => [d.name, d.rentAmount])] : pv4.error,
    [null, 0, [['홍은주', 30000], ['박둘', 20000]]])
  const exp4 = pv4.ok ? Object.fromEntries(pv4.nonResident!.differing.map(d => [d.id, d.updatedAt])) : {}
  const up4 = await rm.updateRoom(await roomForm(R602.id, { baseRent: 30000, nr: 150000, pick: { nonResident: [L1] }, expect: { [L1]: exp4[L1] } }))
  eq('④ 저장 ok, 방 비거주 15만 원, 고른 홍은주만 15만 원, 박둘 그대로', [up4.ok ? true : up4.error, await roomRents(R602.id), await rentOf(L1), await rentOf(L4)], [true, [30000, 150000], 150000, 20000])
  eq('④ 토스트 재료: 이름·전후 금액', up4.ok ? up4.sync : null, { roomNo: '602', nonResident: { next: 150000, leases: [{ name: '홍은주', from: 30000, to: 150000 }] } })
  eq('④ 적용취소 토큰이 서명돼 나온다', up4.ok && !!up4.undo?.sig, true)

  // ── ⑤ 적용취소는 방 값과 계약 금액을 함께 되돌리고, 그사이 바뀌면 거부 ──────────────────────
  const undo4 = up4.ok ? up4.undo! : null
  eq('⑤ 위조 토큰 거부', (await rm.undoRoomRentSync({ ...J(undo4), leases: [{ id: L1, before: 1, after: 150000 }] })).ok, false)
  const u5 = await rm.undoRoomRentSync(J(undo4))
  eq('⑤ 적용취소: 방 비거주 이용료 비움, 계약 3만 원', [u5.ok ? u5.leases : u5.error, await roomRents(R602.id), await rentOf(L1), await rentOf(L4)], [[{ from: 150000, to: 30000 }], [30000, null], 30000, 20000])
  eq('⑤ 같은 토큰 두 번은 거부(이미 되돌림)', (await rm.undoRoomRentSync(J(undo4))).ok, false)
  const up5 = await rm.updateRoom(await roomForm(R602.id, { baseRent: 30000, nr: 150000, pick: { nonResident: [L1] } }))
  await prisma.leaseTerm.update({ where: { id: L1 }, data: { rentAmount: 140000 } })   // 그사이 다른 화면이 고침
  const u5b = await rm.undoRoomRentSync(J(up5.ok ? up5.undo : null))
  eq('⑤ 그사이 계약이 바뀌면 전부 거부(방도 그대로)', [u5b.ok, await roomRents(R602.id), await rentOf(L1)], [false, [30000, 150000], 140000])

  // ── ⑥ 확인창 뒤 계약이 바뀌었으면(updatedAt) 방 저장까지 롤백 ─────────────────────────────
  const R606 = await roomIn(P1, '606', 400000, 100000)
  const T6 = await tenantIn(P1, '최협의')
  const L6 = await leaseIn(P1, T6, R606.id, 'ACTIVE', 380000)
  const pv6 = await rm.previewRoomRentSync(R606.id, { baseRent: 420000, nonResidentRent: 100000 })
  const at6 = pv6.ok ? pv6.resident.differing[0].updatedAt : ''
  await new Promise(r => setTimeout(r, 5))
  await prisma.leaseTerm.update({ where: { id: L6 }, data: { depositAmount: 1 } })
  const up6 = await rm.updateRoom(await roomForm(R606.id, { baseRent: 420000, nr: 100000, pick: { resident: [L6] }, expect: { [L6]: at6 } }))
  eq('⑥ STALE 거부, 방 40만 원 그대로, 계약 그대로', [up6.ok ? true : up6.error, await roomRents(R606.id), await rentOf(L6)],
    ['창을 연 뒤 다른 곳에서 계약 이용료가 바뀌었습니다. 창을 닫고 다시 열어 주세요.', [400000, 100000], 380000])

  // ── ⑦ 남의 영업장 계약 id 를 섞으면 무변경 ───────────────────────────────────────────
  const RX = await roomIn(P2, '901', 400000)
  const TX = await tenantIn(P2, '남의입주')
  const LX = await leaseIn(P2, TX, RX.id, 'ACTIVE', 300000)
  const up7 = await rm.updateRoom(await roomForm(R606.id, { baseRent: 420000, nr: 100000, pick: { resident: [L6, LX] } }))
  eq('⑦ 거부, 방·내 계약·남의 계약 모두 그대로', [up7.ok, await roomRents(R606.id), await rentOf(L6), await rentOf(LX)], [false, [400000, 100000], 380000, 300000])
  eq('⑦ 남의 방 미리보기는 닫힌다', (await rm.previewRoomRentSync(RX.id, {})).ok, false)
  // 거주 축: 옛 기준가 그대로인 계약은 묻지 않고 따라가고, 협의가는 '호실만 저장' 이면 그대로
  const T7 = await tenantIn(P1, '정기준')
  const L7 = await leaseIn(P1, T7, R606.id, 'RESERVED', 400000)
  const up7b = await rm.updateRoom(await roomForm(R606.id, { baseRent: 420000, nr: 100000 }))
  eq('⑦ 호실만 저장: 기준가 그대로이던 계약만 따라감, 협의가 그대로', [up7b.ok, await rentOf(L7), await rentOf(L6), up7b.ok ? up7b.sync?.resident?.leases.map(l => l.name) : null], [true, 420000, 380000, ['정기준']])
  const up7c = await rm.updateRoom(await roomForm(R606.id, { baseRent: 420000, nr: 100000, pick: { resident: [L6] } }))
  eq('⑦ 값 그대로 두고 계약에 적용(호실 수정 폼 한 줄): 협의가도 42만 원', [up7c.ok, await rentOf(L6)], [true, 420000])

  // ── ⑧ 예약 인상 도래는 두 축 전 계약(협의가 포함) 그대로 ─────────────────────────────────
  const R608 = await roomIn(P1, '608', 500000, 100000)
  await prisma.room.update({ where: { id: R608.id }, data: { scheduledRent: 520000, rentUpdateDate: new Date('2026-01-01T00:00:00Z'), nonResidentScheduled: 120000, nonResidentRentDate: new Date('2026-01-01T00:00:00Z') } })
  const l8 = [
    await leaseIn(P1, await tenantIn(P1, '팔가'), R608.id, 'ACTIVE', 500000),
    await leaseIn(P1, await tenantIn(P1, '팔나'), R608.id, 'CHECKOUT_PENDING', 450000),
    await leaseIn(P1, await tenantIn(P1, '팔다'), R608.id, 'NON_RESIDENT', 100000),
    await leaseIn(P1, await tenantIn(P1, '팔라'), R608.id, 'NON_RESIDENT', 90000),
  ]
  await sched.applyScheduledRentsFor(P1)
  eq('⑧ 도래: 방 52만·12만, 거주 둘 52만(협의가 포함), 비거주 둘 12만', [await roomRents(R608.id), ...(await Promise.all(l8.map(rentOf)))], [[520000, 120000], 520000, 520000, 120000, 120000])
  await prisma.room.update({ where: { id: R608.id }, data: { scheduledRent: 530000, rentUpdateDate: new Date('2027-01-01T00:00:00Z') } })
  await prisma.leaseTerm.update({ where: { id: l8[1] }, data: { rentAmount: 470000 } })
  const now8 = await rm.applyScheduledRentNow(R608.id)
  eq('⑧ 즉시 적용도 거주 전 계약(협의가 포함)', [now8.ok, await rentOf(l8[0]), await rentOf(l8[1]), await rentOf(l8[2])], [true, 530000, 530000, 120000])
  eq('⑧ 즉시 적용 적용취소 그대로', [(await rm.undoApplyScheduledRent(J(now8.ok ? now8.undo : null)!)).ok, await rentOf(l8[0]), await rentOf(l8[1])], [true, 520000, 470000])

  // ── ⑨ 일괄 편집은 같은 함수: 기준가 그대로만 따라가고 협의가는 skipped ───────────────────────
  const R609 = await roomIn(P1, '609', 400000)
  const l9a = await leaseIn(P1, await tenantIn(P1, '구가'), R609.id, 'ACTIVE', 400000)
  const l9b = await leaseIn(P1, await tenantIn(P1, '구나'), R609.id, 'RESERVED', 380000)
  const b9 = await rm.batchUpdateRooms([R609.id], { baseRent: 410000 })
  eq('⑨ 일괄: 따라감 1·협의가 1건 skipped', [b9.ok, b9.ok ? b9.skippedNegotiated : null, await rentOf(l9a), await rentOf(l9b)], [true, 1, 410000, 380000])
  eq('⑨ 일괄 적용취소 그대로', [(await rm.undoBatchUpdateRooms(J(b9.ok ? b9.undo : null)!)).ok, await rentOf(l9a), (await roomRents(R609.id))[0]], [true, 400000, 400000])

  // ── ⑩ 선납 달 락은 그대로, 기록 없는 다음 달부터 새 금액 ─────────────────────────────────
  const R610 = await roomIn(P1, '610', 30000, null)
  const T10 = await tenantIn(P1, '선납')
  const L10 = await leaseIn(P1, T10, R610.id, 'NON_RESIDENT', 30000, { moveInDate: new Date('2026-08-01T00:00:00Z') })
  await prisma.paymentRecord.create({ data: { propertyId: P1, leaseTermId: L10, tenantId: T10, targetMonth: '2026-11', expectedAmount: 30000, actualAmount: 30000, isPaid: true, payDate: new Date('2026-10-20T00:00:00Z') } })
  const up10 = await rm.updateRoom(await roomForm(R610.id, { baseRent: 30000, nr: 150000, pick: { nonResident: [L10] } }))
  const lockBefore = await prisma.paymentRecord.findMany({ where: { leaseTermId: L10 }, select: { expectedAmount: true } })
  eq('⑩ 저장 ok, 계약 15만 원, 11월 락 3만 원 불변', [up10.ok, await rentOf(L10), lockBefore.map(r => r.expectedAmount)], [true, 150000, [30000]])
  eq('⑩ 11월(선납) 청구 3만 원, 12월 청구 15만 원', [await engine.serverBillForMonth(L10, '2026-11', 0), await engine.serverBillForMonth(L10, '2026-12', 0)], [30000, 150000])

  // ── ⑪ 독립 검수 B1: 이용료 칸을 비우고 저장해도 그 칸을 쓰던 계약은 0원이 되지 않는다 ───────────────────────
  const R611 = await roomIn(P1, '611', 400000, 150000)
  const l11r = await leaseIn(P1, await tenantIn(P1, '십일거'), R611.id, 'ACTIVE', 400000)
  const l11n = await leaseIn(P1, await tenantIn(P1, '십일비'), R611.id, 'NON_RESIDENT', 150000)
  const l11s = await leaseIn(P1, await tenantIn(P1, '십일단'), R611.id, 'RESERVED', 400000, { isShortTerm: true })
  {
    const pv = await rm.previewRoomRentSync(R611.id, { baseRent: 0, nonResidentRent: 0 })
    eq('⑪ 미리보기: 빈 칸(0원)은 따라갈 계약·물을 계약 없음', pv.ok ? [pv.resident.followers.length, pv.resident.differing.length, pv.nonResident?.followers.length, pv.nonResident?.differing.length] : pv.error, [0, 0, 0, 0])
    const f = await roomForm(R611.id, { baseRent: 0, nr: 0 })
    f.set('baseRent', ''); f.set('nonResidentRent', '')
    const up = await rm.updateRoom(f)
    eq('⑪ 빈 칸 저장: 계약 셋 모두 그대로', [up.ok, await rentOf(l11r), await rentOf(l11n), await rentOf(l11s), up.ok ? up.sync ?? null : null], [true, 400000, 150000, 400000, null])
    await prisma.room.update({ where: { id: R611.id }, data: { baseRent: 400000, nonResidentRent: 150000 } })
  }
  // 권고 2: 호실 수정 followers 는 단기 계약을 빼고(체류 전체 사용료), 일괄 편집은 종전대로 넣는다.
  {
    const up = await rm.updateRoom(await roomForm(R611.id, { baseRent: 410000, nr: 150000 }))
    eq('⑪ 호실 수정: 기준가 그대로인 거주 계약만 따라가고 단기는 그대로', [up.ok, await rentOf(l11r), await rentOf(l11s)], [true, 410000, 400000])
    // 권고 3: 적용 뒤 그 계약에 수납 기록(락)이 새로 생겼으면 적용취소를 거부한다.
    await prisma.paymentRecord.create({ data: { propertyId: P1, leaseTermId: l11r, tenantId: (await prisma.leaseTerm.findUnique({ where: { id: l11r } }))!.tenantId, targetMonth: '2026-12', expectedAmount: 410000, actualAmount: 410000, payDate: new Date(), payMethod: '계좌이체' } })
    const u = await rm.undoRoomRentSync(J(up.ok ? up.undo : null))
    eq('⑪ 새 수납 기록 뒤 적용취소 거부(방·계약 그대로)', [u.ok ? true : u.error, await roomRents(R611.id), await rentOf(l11r)],
      ['그사이 이 계약에 새 금액으로 수납 기록이 생겨 되돌리지 않았습니다. 수납 내역에서 지금 상태를 확인해 주세요.', [410000, 150000], 410000])
  }
  // 권고 4: 기록 없는 지난 달 수(입주 2026-08, 8월 기록만 있음 → 9월부터 이번 달 앞까지)
  {
    await prisma.paymentRecord.create({ data: { propertyId: P1, leaseTermId: l11n, tenantId: (await prisma.leaseTerm.findUnique({ where: { id: l11n } }))!.tenantId, targetMonth: '2026-08', expectedAmount: 150000, actualAmount: 150000, payDate: new Date('2026-08-01T00:00:00Z'), payMethod: '계좌이체' } })
    await prisma.leaseTerm.update({ where: { id: l11n }, data: { rentAmount: 140000 } })   // 협의가로 만들어 '물을 계약' 이 되게
    const pv = await rm.previewRoomRentSync(R611.id, { baseRent: 410000, nonResidentRent: 160000 })
    const { kstMonthStr } = await import('@/lib/kstDate')
    const [cy, cm] = kstMonthStr().split('-').map(Number)
    const want = Math.max(0, (cy - 2026) * 12 + cm - 8 - 1)
    eq('⑪ 미리보기: 기록 없는 지난 달 수(확인창이 미리 말한다)', pv.ok ? pv.nonResident?.differing.find(d => d.id === l11n)?.unrecordedPastMonths : pv.error, want)
  }

  console.log(`[방 이용료 계약 동기화 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
