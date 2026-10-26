// 결제 계정·체크리스트·요청·호실·시세 조사와 같은 클래스 쓰기의 영업장 범위 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-action-property-scope-flow.ts
//
// 왜 통합인가(2026-10-23 운영자 승인, loop.md 4번 권한). 기타수익·고정지출을 닫은 뒤(test-income-recurring-scope-flow) 같은 클래스가
// 다섯 묶음(결제 계정·체크리스트·입주자 요청·호실 관리·시세 조사)과 계약·수납·재고 적용취소에 남아 있었다. 화면 id 만으로 쓰거나,
// 폼의 연결 id 를 안 보거나, 화면 객체·토큰을 data 에 통째로 넘겼다. 정적 감지망(check-action-property-scope)은 글자만 본다.
// 남의 영업장 id 를 넣으면 실제로 거절되고 그 행이 한 바이트도 안 바뀌는지, 제 영업장 대조군은 그대로 되는지는 쓰기를 돌려야 보인다.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')

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
  // 외래키는 뺀다(부모 없는 대역 행을 만든다).
  return out.split('\n').filter(l => !l.startsWith('◇')).join('\n')
    .split(/;\s*\n/).filter(s => !/FOREIGN KEY/.test(s)).join(';\n')
}

async function main() {
  const { PGlite } = await import('@electric-sql/pglite')
  const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket')
  const pg = await PGlite.create()
  await pg.exec(schemaSql())
  // 하네스 관문 대역의 사용자 id 는 uuid 가 아니다('cr-flow-harness'). 점검 기록자 칸만 글자로 풀어 대조군이 돌게 한다(앱 스키마는 그대로).
  await pg.exec('ALTER TABLE checklist_logs ALTER COLUMN "checkedBy" TYPE text')
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const fin = await import('@/app/(app)/finance/actions')
  const checklist = await import('@/app/(app)/checklist/actions')
  const tenants = await import('@/app/(app)/tenants/actions')
  const roomManage = await import('@/app/(app)/room-manage/actions')
  const market = await import('@/app/(app)/market-analysis/actions')
  const rooms = await import('@/app/(app)/rooms/actions')
  const inventory = await import('@/app/(app)/inventory/actions')
  const { revertShiftRows } = await import('@/app/(app)/inventory/ledgerShift')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f }
  // 행 전체를 바이트로 뜬다. updatedAt 은 빈 쓰기에도 움직일 수 있어 뺀다.
  const snap = (row: unknown) => { const r = row as Record<string, unknown> | null; if (r) delete r.updatedAt; return JSON.stringify(r) }
  const thrown = async (fn: () => Promise<unknown>) => { try { await fn(); return '' } catch (e) { return (e as Error).message } }

  const tenantIn = async (pid: string, name = '가') => (await prisma.tenant.create({ data: { propertyId: pid, name } })).id as string
  const roomIn = async (pid: string, roomNo: string) => (await prisma.room.create({ data: { propertyId: pid, roomNo, baseRent: 300000 } })).id as string
  const leaseIn = async (pid: string, tenantId: string, roomId: string | null, status = 'ACTIVE') =>
    (await prisma.leaseTerm.create({ data: { propertyId: pid, tenantId, roomId, status: status as never, rentAmount: 300000, depositAmount: 50000, dueDay: '10' } })).id as string

  // ── 결제 계정 ──
  {
    const GONE = '결제 계정을 찾을 수 없습니다.'
    const account = async (pid: string, brand: string) => (await prisma.financialAccount.create({ data: { propertyId: pid, type: 'BANK_ACCOUNT', brand } })).id as string
    const row = async (id: string) => snap(await prisma.financialAccount.findUnique({ where: { id } }))
    const A1 = await account(P1, '내 은행'), A2 = await account(P2, '남 은행')
    const before = await row(A2)

    eq('계정 수정: 남의 영업장 id 거절', await fin.saveFinancialAccount(fd({ id: A2, type: 'BANK_ACCOUNT', brand: '바꿈' })), { ok: false, error: GONE })
    eq('계정 해지: 남의 영업장 id 거절', await fin.deactivateFinancialAccount(A2), { ok: false, error: GONE })
    eq('계정 삭제: 남의 영업장 id 거절', await fin.deleteFinancialAccount(A2), { ok: false, error: GONE })
    eq('계정 남의 영업장 행 무변경', await row(A2), before)

    const mineBefore = await row(A1)
    eq('계정 수정: 남의 영업장 출금 계좌 연결 거절', await fin.saveFinancialAccount(fd({ id: A1, type: 'CREDIT_CARD', brand: '내 카드', linkedAccountId: A2 })), { ok: false, error: GONE })
    eq('계정 등록: 남의 영업장 출금 계좌 연결 거절', await fin.saveFinancialAccount(fd({ type: 'CREDIT_CARD', brand: '새 카드', linkedAccountId: A2 })), { ok: false, error: GONE })
    eq('계정 연결 거절 뒤 내 계정 무변경·새 계정 없음', [await row(A1), await prisma.financialAccount.count({ where: { propertyId: P1 } })], [mineBefore, 1])

    const reserveCount = async () => prisma.reserveTransaction.count({ where: { propertyId: P1 } })
    eq('예비비 적립: 남의 영업장 연결 계좌 거절', await fin.addReserveDeposit({ amount: 1000, date: '2026-10-01', linkedAccountId: A2 }), { ok: false, error: GONE })
    eq('예비비 거절 뒤 행이 안 생긴다', await reserveCount(), 0)

    // 대조군
    eq('계정 수정: 제 영업장 통과', await fin.saveFinancialAccount(fd({ id: A1, type: 'BANK_ACCOUNT', brand: '내 은행 2' })), { ok: true })
    eq('계정 수정 반영', (await prisma.financialAccount.findUnique({ where: { id: A1 } }))?.brand, '내 은행 2')
    eq('예비비 적립: 제 영업장 계좌 통과', await fin.addReserveDeposit({ amount: 1000, date: '2026-10-01', linkedAccountId: A1 }), { ok: true })
    eq('계정 해지: 제 영업장 통과', await fin.deactivateFinancialAccount(A1), { ok: true })
    eq('계정 해지 반영', (await prisma.financialAccount.findUnique({ where: { id: A1 } }))?.isActive, false)
    const A3 = await account(P1, '지울 은행')
    eq('계정 삭제: 제 영업장 통과', await fin.deleteFinancialAccount(A3), { ok: true })
    eq('계정 삭제 반영', await prisma.financialAccount.count({ where: { id: A3 } }), 0)
  }

  // ── 체크리스트 ──
  {
    const GONE = '점검 항목을 찾을 수 없습니다.'
    const item = async (pid: string) => (await prisma.checklist.create({ data: { propertyId: pid, title: '부식 확인', intervalDays: 7 } })).id as string
    const row = async (id: string) => JSON.stringify({
      c: JSON.parse(snap(await prisma.checklist.findUnique({ where: { id } }))),
      logs: await prisma.checklistLog.findMany({ where: { checklistId: id }, orderBy: { id: 'asc' } }),
    })
    const C1 = await item(P1), C2 = await item(P2)
    const L2 = (await prisma.checklistLog.create({ data: { checklistId: C2, checkedAt: new Date('2026-10-01T00:00:00Z') } })).id as string
    await prisma.checklist.update({ where: { id: C2 }, data: { lastCheckedAt: new Date('2026-10-01T00:00:00Z') } })
    const before = await row(C2)

    eq('체크리스트 수정: 남의 영업장 거절', await checklist.updateChecklist({ id: C2, title: '바꿈', intervalDays: 3 }), { ok: false, error: GONE })
    eq('체크리스트 완료: 남의 영업장 거절', await checklist.markChecklistDone({ id: C2 }), { ok: false, error: GONE })
    eq('체크리스트 이력 삭제: 남의 영업장 거절', await checklist.deleteChecklistLog(L2), { ok: false, error: '로그를 찾을 수 없습니다.' })
    eq('체크리스트 삭제: 남의 영업장 거절', await checklist.deleteChecklist(C2), { ok: false, error: GONE })
    eq('체크리스트 남의 영업장 항목·이력 무변경', await row(C2), before)

    eq('체크리스트 수정: 제 영업장 통과', await checklist.updateChecklist({ id: C1, title: '내 항목', intervalDays: 3 }), { ok: true })
    const done = await checklist.markChecklistDone({ id: C1 })
    eq('체크리스트 완료: 제 영업장 통과', done.ok, true)
    eq('체크리스트 이력 삭제(완료 적용취소): 제 영업장 통과', (await checklist.deleteChecklistLog(done.ok ? done.logId : '')).ok, true)
    eq('체크리스트 적용취소 뒤 마지막 점검일 비움', (await prisma.checklist.findUnique({ where: { id: C1 } }))?.lastCheckedAt, null)
    eq('체크리스트 삭제: 제 영업장 통과', await checklist.deleteChecklist(C1), { ok: true })
  }

  // ── 입주자 요청 ──
  {
    const GONE = '요청을 찾을 수 없습니다.'
    const T1 = await tenantIn(P1), T2 = await tenantIn(P2)
    const req = async (pid: string, tenantId: string | null) => (await prisma.tenantRequest.create({ data: { propertyId: pid, tenantId, content: '수전 고장' } })).id as string
    const row = async (id: string) => snap(await prisma.tenantRequest.findUnique({ where: { id } }))
    const R1 = await req(P1, T1), R2 = await req(P2, T2)
    const before = await row(R2)
    const edit = { content: '바꿈', requestDate: '2026-10-01', targetDate: null }

    eq('요청 완료: 남의 영업장 거절', await tenants.resolveTenantRequest(R2, '처리'), { ok: false, error: GONE })
    eq('요청 완료 해제: 남의 영업장 거절', await tenants.unresolveTenantRequest(R2), { ok: false, error: GONE })
    eq('요청 수정: 남의 영업장 거절', await tenants.updateTenantRequest(R2, edit), { ok: false, error: GONE })
    eq('요청 삭제: 남의 영업장 거절', await tenants.deleteTenantRequest(R2), { ok: false, error: GONE })
    await prisma.tenantRequest.update({ where: { id: R2 }, data: { deletedAt: new Date('2026-10-02T00:00:00Z') } })
    const deletedBefore = await row(R2)
    eq('요청 복원: 남의 영업장 거절', await tenants.restoreTenantRequest(R2), { ok: false, error: GONE })
    eq('요청 남의 영업장 행 무변경', [await row(R2) === deletedBefore, before !== deletedBefore], [true, true])

    const n0 = await prisma.tenantRequest.count({ where: { propertyId: P1 } })
    eq('요청 등록: 남의 영업장 입주자 거절', await tenants.createTenantRequest({ ...edit, tenantId: T2 }), { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('요청 등록 거절 뒤 행이 안 생긴다', await prisma.tenantRequest.count({ where: { propertyId: P1 } }), n0)
    const mineBefore = await row(R1)
    eq('요청 수정: 남의 영업장 입주자로 바꾸기 거절', await tenants.updateTenantRequest(R1, { ...edit, tenantId: T2 }), { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('요청 수정 거절 뒤 내 요청 무변경', await row(R1), mineBefore)

    eq('요청 완료: 제 영업장 통과', await tenants.resolveTenantRequest(R1, '처리'), { ok: true })
    eq('요청 완료 해제: 제 영업장 통과', (await tenants.unresolveTenantRequest(R1)).ok, true)
    eq('요청 수정: 제 영업장 통과', (await tenants.updateTenantRequest(R1, { ...edit, tenantId: T1 })).ok, true)
    eq('요청 삭제: 제 영업장 통과', await tenants.deleteTenantRequest(R1), { ok: true })
    eq('요청 복원: 제 영업장 통과', await tenants.restoreTenantRequest(R1), { ok: true })
    eq('요청 등록: 공용부(입주자 없음) 통과', await tenants.createTenantRequest({ ...edit, tenantId: null }), { ok: true })
  }

  // ── 호실 관리 ──
  {
    const GONE = '호실을 찾을 수 없습니다.'
    const RM1 = await roomIn(P1, '101'), RM2 = await roomIn(P2, '201')
    const T2 = await tenantIn(P2, '남 입주자')
    const LE2 = await leaseIn(P2, T2, RM2, 'CHECKED_OUT')
    await prisma.paymentRecord.create({ data: { propertyId: P2, leaseTermId: LE2, tenantId: T2, targetMonth: '2026-09', expectedAmount: 300000, actualAmount: 300000, payDate: new Date('2026-09-10T00:00:00Z'), payMethod: '계좌이체' } })
    const theirs = async () => JSON.stringify({
      room: JSON.parse(snap(await prisma.room.findUnique({ where: { id: RM2 } }))),
      lease: JSON.parse(snap(await prisma.leaseTerm.findUnique({ where: { id: LE2 } }))),
      pays: await prisma.paymentRecord.count({ where: { leaseTermId: LE2 } }),
    })
    const before = await theirs()

    eq('호실 수정: 남의 영업장 거절', await roomManage.updateRoom(fd({ id: RM2, roomNo: '999', baseRent: '1' })), { ok: false, error: GONE })
    eq('호실 삭제: 남의 영업장 거절(이력 동의 안내로 새지 않음)', await roomManage.deleteRoom(RM2), { ok: false, error: GONE })
    eq('호실 강제 삭제: 남의 영업장 거절', await roomManage.deleteRoom(RM2, { force: true }), { ok: false, error: GONE })
    eq('호실 공개 토글: 남의 영업장 거절', await roomManage.setRoomShowOnSite(RM2, false), { ok: false, error: GONE })
    eq('호실 남의 영업장 방·계약·수납 무변경', await theirs(), before)

    // 일괄 편집: 허용 밖 칸(propertyId·roomNo·마스터키)이 실려도 무시된다.
    const p2Rooms = await prisma.room.count({ where: { propertyId: P2 } })
    const r = await roomManage.batchUpdateRooms([RM1], { type: '원룸', propertyId: P2, roomNo: '666', doorMasterKeyEnc: 'x', isVacant: false } as never)
    const mine = await prisma.room.findUnique({ where: { id: RM1 }, select: { propertyId: true, roomNo: true, type: true, doorMasterKeyEnc: true, isVacant: true } })
    eq('일괄 편집: 허용 칸만 반영, 주입 칸 무시', [r.ok, mine], [true, { propertyId: P1, roomNo: '101', type: '원룸', doorMasterKeyEnc: null, isVacant: true }])
    eq('일괄 편집: 남의 영업장 방 수 무변경', await prisma.room.count({ where: { propertyId: P2 } }), p2Rooms)
    eq('일괄 편집: 형이 틀린 칸은 거절', await roomManage.batchUpdateRooms([RM1], { baseRent: '1000' } as never), { ok: false, error: '일괄 수정 입력값이 올바르지 않습니다.' })
    eq('일괄 편집: 남의 영업장 방 id 는 안 바뀐다', [(await roomManage.batchUpdateRooms([RM2], { type: '바꿈' })).ok, await theirs()], [true, before])

    // 적용취소 토큰: 남의 계약 id·허용 밖 칸을 실어도 안 쓴다.
    const T1 = await tenantIn(P1, '내 입주자')
    const LE1 = await leaseIn(P1, T1, RM1)
    eq('일괄 적용취소: 통과(허용 칸만)', await roomManage.undoBatchUpdateRooms({
      rooms: [{ id: RM1, fields: { type: null, propertyId: P2, roomNo: '777' } }],
      leases: [{ id: LE2, rentAmount: 1 }, { id: LE1, rentAmount: 290000 }],
    }), { ok: true })
    eq('일괄 적용취소: 내 방 허용 칸만 되돌림', await prisma.room.findUnique({ where: { id: RM1 }, select: { propertyId: true, roomNo: true, type: true } }), { propertyId: P1, roomNo: '101', type: null })
    eq('일괄 적용취소: 내 계약은 되돌리고 남의 계약은 무변경', [(await prisma.leaseTerm.findUnique({ where: { id: LE1 } }))?.rentAmount, await theirs()], [290000, before])
    eq('예약가 적용취소: 남의 계약 임대료 무변경', [(await roomManage.undoApplyScheduledRent({
      roomId: RM1, prevBaseRent: 300000, prevScheduledRent: 0, prevRentUpdateDate: null, leases: [{ id: LE2, prevRentAmount: 2 }],
    })).ok, await theirs()], [true, before])

    // 대조군
    eq('호실 수정: 제 영업장 통과', await roomManage.updateRoom(fd({ id: RM1, roomNo: '101', baseRent: '310000' })), { ok: true })
    eq('호실 수정: 기준가와 활성 계약 임대료 동기화', [(await prisma.room.findUnique({ where: { id: RM1 } }))?.baseRent, (await prisma.leaseTerm.findUnique({ where: { id: LE1 } }))?.rentAmount], [310000, 310000])
    const RM3 = await roomIn(P1, '103')
    eq('호실 삭제: 제 영업장 빈 방 통과', await roomManage.deleteRoom(RM3), { ok: true })
    eq('호실 삭제 반영', await prisma.room.count({ where: { id: RM3 } }), 0)
  }

  // ── 시세 조사 ──
  {
    const survey = async (pid: string) => (await prisma.marketSurvey.create({ data: { propertyId: pid } })).id as string
    const comp = async (sid: string) => (await prisma.marketCompetitor.create({ data: { marketSurveyId: sid, name: '옆 고시원', address: '어딘가', roomPrices: [] } })).id as string
    const S1 = await survey(P1), S2 = await survey(P2)
    const K1 = await comp(S1), K2 = await comp(S2)
    const theirs = async () => JSON.stringify({ s: JSON.parse(snap(await prisma.marketSurvey.findUnique({ where: { id: S2 } }))), k: JSON.parse(snap(await prisma.marketCompetitor.findUnique({ where: { id: K2 } }))), n: await prisma.marketCompetitor.count({ where: { marketSurveyId: S2 } }) })
    const before = await theirs()
    const body = { name: '바꿈', address: '바꿈', roomPrices: [] }

    eq('조사 전략: 남의 영업장 거절', await market.updateSurveyStrategy(S2, '프리미엄형'), { ok: false })
    eq('경쟁업체 수정: 남의 영업장 거절', await market.updateCompetitor(K2, body), { ok: false, error: '경쟁업체를 찾을 수 없습니다.' })
    eq('경쟁업체 삭제: 남의 영업장 거절(스냅샷도 안 나감)', await market.deleteCompetitor(K2), { ok: false })
    eq('경쟁업체 추가: 남의 영업장 조사에 붙이기 거절', (await market.addCompetitor(S2, body)).error, '조사 기록을 찾을 수 없습니다.')
    eq('조사 삭제: 남의 영업장 거절', await market.deleteSurvey(S2), { ok: false })
    eq('시세 조사 남의 영업장 행 무변경', await theirs(), before)

    eq('조사 전략: 제 영업장 통과', await market.updateSurveyStrategy(S1, '시세형'), { ok: true })
    eq('경쟁업체 수정: 제 영업장 통과', await market.updateCompetitor(K1, body), { ok: true })
    const del = await market.deleteCompetitor(K1)
    eq('경쟁업체 삭제: 제 영업장 통과', [del.ok, del.snapshot?.marketSurveyId], [true, S1])
    eq('경쟁업체 삭제 적용취소(재추가): 통과', (await market.addCompetitor(S1, { ...body, ...del.snapshot! })).ok, true)
    eq('조사 삭제: 제 영업장 통과', await market.deleteSurvey(S1), { ok: true })
  }

  // ── 계약·입주자·수납(같은 클래스 sweep) ──
  {
    const T1 = await tenantIn(P1, '내 사람'), T2 = await tenantIn(P2, '남 사람')
    const RM1 = await roomIn(P1, '301'), RM2 = await roomIn(P2, '401')
    const L1 = await leaseIn(P1, T1, RM1), L2 = await leaseIn(P2, T2, RM2)
    await prisma.room.updateMany({ where: { id: { in: [RM1, RM2] } }, data: { isVacant: false } })
    const theirs = async () => JSON.stringify({
      t: JSON.parse(snap(await prisma.tenant.findUnique({ where: { id: T2 } }))),
      l: JSON.parse(snap(await prisma.leaseTerm.findUnique({ where: { id: L2 } }))),
      r: JSON.parse(snap(await prisma.room.findUnique({ where: { id: RM2 } }))),
      pays: await prisma.paymentRecord.count({ where: { leaseTermId: L2 } }),
    })
    const before = await theirs()
    const LEASE_GONE = '계약 정보를 찾을 수 없습니다.'

    eq('입주자 삭제: 남의 영업장 거절', await tenants.deleteTenant(T2, { force: true }), { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('퇴실 처리: 남의 영업장 계약 거절', await tenants.checkoutTenant(L2, T2, '2026-10-01'), { ok: false, error: LEASE_GONE })
    eq('상태 전환: 남의 영업장 계약 거절', await tenants.applyStatusTransition({ leaseTermId: L2, tenantId: T2, toStatus: 'CHECKOUT_PENDING', expectedMoveOut: '2026-12-01' }), { ok: false, error: LEASE_GONE })
    eq('퇴실 일할 해제: 남의 영업장 계약 거절', await tenants.clearCheckoutProration(L2), { ok: false, error: LEASE_GONE })
    // 남의 입주자 계약은 고르지 않아 바꿀 계약이 없다(종전에는 그 계약 보증금이 바뀌었다). 무변경은 아래 바이트 비교가 본다.
    const bt = await tenants.batchUpdateTenants([T2], { depositAmount: 1 })
    eq('일괄 편집: 남의 영업장 입주자 계약 안 고름', bt.ok ? 'ok' : bt.error, '변경할 항목이 없습니다.')
    eq('수납 저장: 남의 영업장 계약 거절', await rooms.savePayment({ leaseTermId: L2, tenantId: T2, targetMonth: '2026-10', expectedAmount: 300000, actualAmount: 300000, payDate: '2026-10-10', payMethod: '계좌이체' }),
      { ok: false, error: LEASE_GONE })
    eq('수납 저장: 내 계약 + 남의 입주자 거절', await rooms.savePayment({ leaseTermId: L1, tenantId: T2, targetMonth: '2026-10', expectedAmount: 300000, actualAmount: 300000, payDate: '2026-10-10', payMethod: '계좌이체' }),
      { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('퇴실 처리: 내 계약 + 남의 입주자 거절', await tenants.checkoutTenant(L1, T2, '2026-10-01'), { ok: false, error: '입주자를 찾을 수 없습니다.' })
    eq('계약·입주자 남의 영업장 행 무변경', await theirs(), before)
    eq('내 계약 무변경(거절 뒤)', (await prisma.leaseTerm.findUnique({ where: { id: L1 } }))?.status, 'ACTIVE')

    // 계약 추가: 폼의 호실이 남의 영업장 방이면 거절
    const leaseCount = await prisma.leaseTerm.count({ where: { tenantId: T1 } })
    eq('계약 추가: 남의 영업장 호실 거절', await tenants.addLeaseToTenant(fd({ tenantId: T1, roomId: RM2, status: 'WAITING_TOUR' })), { ok: false, error: '호실 정보를 찾을 수 없습니다.' })
    eq('계약 추가 거절 뒤 계약이 안 생기고 남의 방 무변경', [await prisma.leaseTerm.count({ where: { tenantId: T1 } }), await theirs()], [leaseCount, before])

    // 대조군
    eq('수납 저장: 제 영업장 통과', (await rooms.savePayment({ leaseTermId: L1, tenantId: T1, targetMonth: '2026-10', expectedAmount: 300000, actualAmount: 300000, payDate: '2026-10-10', payMethod: '계좌이체' })).ok, true)
    eq('퇴실 처리: 제 영업장 통과', (await tenants.checkoutTenant(L1, T1, '2026-10-01')).ok, true)
    eq('퇴실 처리 반영', (await prisma.leaseTerm.findUnique({ where: { id: L1 } }))?.status, 'CHECKED_OUT')
    const T3 = await tenantIn(P1, '지울 사람')
    eq('입주자 삭제: 제 영업장 통과', await tenants.deleteTenant(T3), { ok: true })
  }

  // ── 재고·지출 적용취소 토큰 ──
  {
    const item = async (pid: string) => (await prisma.trackedItem.create({ data: { propertyId: pid, category: '부식비', label: '쌀' } })).id as string
    const loc = async (pid: string) => (await prisma.storageLocation.create({ data: { propertyId: pid, name: '창고' } })).id as string
    const I1 = await item(P1), I2 = await item(P2)
    const LOC1 = await loc(P1), LOC2 = await loc(P2)
    const C2 = (await prisma.stockCheck.create({ data: { trackedItemId: I2, date: new Date('2026-10-01T00:00:00Z'), remainingQty: 10 } })).id as string
    const checkRow = async (id: string) => JSON.stringify(await prisma.stockCheck.findUnique({ where: { id }, include: { locationBreakdown: true } }))
    const before = await checkRow(C2)

    // 되돌리기 공용층: 남의 영업장 품목 토큰이면 던지고 점검 잔량이 그대로다(부르는 쪽이 품목을 안 봐도 닫힌다).
    eq('재고 되돌리기: 남의 영업장 품목 거절', await thrown(() => prisma.$transaction(async tx => {
      await revertShiftRows(tx, P1, { trackedItemId: I2, checks: [{ id: C2, remainingQty: 0, locs: [] }], createdLinks: [] })
    })), '다른 영업장의 기록입니다.')
    eq('재고 되돌리기 거절 뒤 남의 점검 무변경', await checkRow(C2), before)

    // 점검 삭제 적용취소: 위치 행에 남의 위치를 실으면 거절, 원천 지출이 남의 것이면 끊고 복원.
    const newCheck = randomUUID()
    eq('점검 삭제 적용취소: 남의 영업장 위치 거절', await inventory.undoDeleteStockCheck({
      id: newCheck, trackedItemId: I1, date: '2026-10-01T00:00:00.000Z', remainingQty: 3, memo: null, isReconcile: false, sourceExpenseId: null,
      locations: [{ storageLocationId: LOC2, remainingQty: 3, restockedQty: null, fromHubQty: null, fromLocationId: null }],
    }), { ok: false, error: '다른 영업장의 기록입니다.' })
    eq('점검 삭제 적용취소 거절 뒤 행이 안 생긴다', await prisma.stockCheck.count({ where: { id: newCheck } }), 0)
    const E2 = (await prisma.expense.create({ data: { propertyId: P2, date: new Date('2026-10-01T00:00:00Z'), amount: 1000, category: '부식비' } })).id as string
    eq('점검 삭제 적용취소: 제 영업장 위치 통과', await inventory.undoDeleteStockCheck({
      id: newCheck, trackedItemId: I1, date: '2026-10-01T00:00:00.000Z', remainingQty: 3, memo: null, isReconcile: false, sourceExpenseId: E2,
      locations: [{ storageLocationId: LOC1, remainingQty: 3, restockedQty: null, fromHubQty: null, fromLocationId: null, storageLocation: { create: { propertyId: P2, name: '주입' } } } as never],
    }), { ok: true })
    eq('점검 삭제 적용취소: 남의 지출은 안 잇고 주입 칸은 무시', [
      (await prisma.stockCheck.findUnique({ where: { id: newCheck } }))?.sourceExpenseId,
      await prisma.storageLocation.count({ where: { propertyId: P2 } }),
    ], [null, 1])

    // 지출 삭제 적용취소: 토큰의 관계 칸·남의 영업장 배송비 줄·남의 점검·예비비 id 는 안 쓴다.
    const R2 = (await prisma.reserveTransaction.create({ data: { propertyId: P2, type: 'DEPOSIT', amount: 1, date: new Date('2026-10-01T00:00:00Z') } })).id as string
    const reserveBefore = JSON.stringify(await prisma.reserveTransaction.findUnique({ where: { id: R2 } }))
    const expId = randomUUID()
    const expSnap = { id: expId, propertyId: P1, date: '2026-10-01T00:00:00.000Z', amount: 5000, category: '부식비', createdAt: '2026-10-01T00:00:00.000Z' }
    eq('지출 삭제 적용취소: 남의 영업장 배송비 줄 거절', await fin.undoDeleteExpense({
      expense: expSnap, order: null, shippingRows: [{ id: randomUUID(), propertyId: P2, date: '2026-10-01T00:00:00.000Z', amount: 3000, category: '배송비' }],
      freedSiblingIds: [], stockCheckIds: [], reserveTxIds: [],
    }), { ok: false, error: '다른 영업장의 기록입니다.' })
    eq('지출 삭제 적용취소 거절 뒤 행이 안 생긴다', await prisma.expense.count({ where: { id: expId } }), 0)
    eq('지출 삭제 적용취소: 관계 칸 주입·남의 id 목록은 무시하고 통과', await fin.undoDeleteExpense({
      expense: { ...expSnap, autoStockChecks: { connect: [{ id: C2 }] }, reserveSettlements: { connect: [{ id: R2 }] } },
      order: null, shippingRows: [], freedSiblingIds: [], stockCheckIds: [C2], reserveTxIds: [R2],
    }), { ok: true })
    eq('지출 삭제 적용취소 뒤 남의 점검·예비비 무변경', [await checkRow(C2), JSON.stringify(await prisma.reserveTransaction.findUnique({ where: { id: R2 } }))], [before, reserveBefore])
  }

  console.log(`[영업장 범위 2차 묶음 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
