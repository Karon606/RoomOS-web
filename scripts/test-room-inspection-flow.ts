// 방 점검(퇴실 점검·청소 검수·입실 전 점검) 통합 회귀. 실제 퇴실·청소·점검 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.reason-flow.json scripts/test-room-inspection-flow.ts
// 관문 대역은 사유 하네스 것을 쓴다(사용자 id 가 uuid 라 상태 전환이 이력 행을 만든다, scripts/reason-flow-access-stub).
//
// 왜 통합인가(2026-10-27, 신고 2911c217). 점검은 퇴실·청소 완료가 저절로 만들고, 그 처리를 무르면 걷고, 다시 처리하면 되살린다.
// 그 생애가 맞는지(중복 퇴실에 하나만 열린다, 끝낸 점검은 남는다, 다시 퇴실하면 체크가 돌아온다), 비품 품명이 승인 규칙대로만
// 들어가는지, 목록 이름 변경이 이미 만든 항목을 안 바꾸는지, 남의 영업장 id 로는 한 바이트도 못 바꾸는지는 쓰기를 돌려야 보인다.
// 순수 함수(lib/roomInspectionSeed) 진리표도 머리에서 함께 돈다.
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { seedInspectionItems, isInspectableAsset } from '../lib/roomInspectionSeed'

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
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

// ── 0. 순수 함수 진리표 ─────────────────────────────────────────────────
{
  const row = (o: Partial<Parameters<typeof isInspectableAsset>[0]>) => ({
    id: randomUUID(), itemLabel: '의자', category: '비품', receivedAt: '2026-10-01', disposedAt: null, isShipping: false, excludeFromInventory: false, ...o,
  })
  const tracked = ['소모품비']
  eq('받고 안 버린 비품은 든다', isInspectableAsset(row({}), tracked), true)
  eq('수령 전은 빠진다', isInspectableAsset(row({ receivedAt: null }), tracked), false)
  eq('폐기한 것은 빠진다', isInspectableAsset(row({ disposedAt: '2026-10-02' }), tracked), false)
  eq('배송비 줄은 빠진다', isInspectableAsset(row({ isShipping: true }), tracked), false)
  eq('재고 제외 표시는 빠진다', isInspectableAsset(row({ excludeFromInventory: true }), tracked), false)
  eq('품명 없는 행은 빠진다', isInspectableAsset(row({ itemLabel: '  ' }), tracked), false)
  eq('추적 카테고리(소모품)는 빠진다', isInspectableAsset(row({ category: '소모품비' }), tracked), false)
  const items = seedInspectionItems({
    stage: 'CHECKOUT', template: ['벽지', ' 벽지 ', '', '의자'], excluded: ['공유기'], trackedCategories: tracked, assetStages: ['CHECKOUT'],
    assets: [row({ itemLabel: '책상' }), row({ itemLabel: '의자' }), row({ itemLabel: '공유기' }), row({ itemLabel: '책상 ' })],
  })
  eq('목록 먼저, 비품 뒤, 빈칸·중복·제외 품목은 한 번도 안 선다', items.map(i => [i.label, i.sortOrder, i.source]), [['벽지', 0, 'TEMPLATE'], ['의자', 1, 'TEMPLATE'], ['책상', 2, 'ASSET']])
  eq('비품을 안 넣는 단계는 목록만', seedInspectionItems({ stage: 'BEFORE_MOVEIN', template: ['온수'], excluded: [], trackedCategories: [], assetStages: ['CHECKOUT'], assets: [row({})] }).map(i => i.label), ['온수'])
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
  const server = new PGLiteSocketServer({ db: pg, port: PORT, host: '127.0.0.1' })
  await server.start()

  const prisma = (await import('@/lib/prisma')).default
  const tenants = await import('@/app/(app)/tenants/actions')
  const cleaning = await import('@/app/(app)/room-manage/cleaningActions')
  const insp = await import('@/app/(app)/room-manage/inspectionActions')
  const settings = await import('@/app/(app)/settings/actions')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1

  const roomIn = async (pid: string, roomNo: string) => (await prisma.room.create({ data: { propertyId: pid, roomNo, baseRent: 300000, isVacant: false } })).id as string
  const tenantIn = async (pid: string, name: string) => (await prisma.tenant.create({ data: { propertyId: pid, name } })).id as string
  const leaseIn = async (pid: string, tenantId: string, roomId: string, status: string) =>
    (await prisma.leaseTerm.create({ data: { propertyId: pid, tenantId, roomId, status: status as never, rentAmount: 300000, depositAmount: 0, dueDay: '1', moveInDate: new Date('2026-09-01T00:00:00Z') } })).id as string
  const asset = async (pid: string, roomId: string, itemLabel: string, o: Record<string, unknown> = {}) =>
    (await prisma.expense.create({ data: { propertyId: pid, roomId, date: new Date('2026-09-01T00:00:00Z'), amount: 10000, category: '비품', itemLabel, receivedAt: new Date('2026-09-02T00:00:00Z'), ...o } })).id as string
  const rowsOf = async (where: Record<string, unknown>) => prisma.roomInspection.findMany({ where, orderBy: { createdAt: 'asc' } })
  const labelsOf = async (inspectionId: string) => (await prisma.roomInspectionItem.findMany({ where: { inspectionId }, orderBy: { sortOrder: 'asc' } })).map(i => i.label)
  const snapAll = async (pid: string) => JSON.stringify({
    i: (await prisma.roomInspection.findMany({ where: { propertyId: pid }, orderBy: { id: 'asc' } })).map(r => ({ ...r, updatedAt: undefined })),
    t: (await prisma.roomInspectionItem.findMany({ where: { propertyId: pid }, orderBy: { id: 'asc' } })).map(r => ({ ...r, updatedAt: undefined })),
  })

  // ── 1. 퇴실 → 퇴실 점검 + 입실 전 점검, 비품 규칙 ────────────────────────────
  const R1 = await roomIn(P1, '501')
  const T1 = await tenantIn(P1, '가')
  const L1 = await leaseIn(P1, T1, R1, 'CHECKOUT_PENDING')
  await asset(P1, R1, '의자')
  await asset(P1, R1, '의자')                                         // 같은 품명 둘은 한 항목
  const DESK = await asset(P1, R1, '책상')
  await asset(P1, R1, '휴지', { category: '소모품비' })                // 추적 카테고리
  await asset(P1, R1, 'TV 겸용 모니터', { disposedAt: new Date('2026-09-10T00:00:00Z') })   // 생성 전 폐기
  await asset(P1, R1, '셋탑박스', { excludeFromInventory: true })
  await asset(P1, R1, '배송비', { isShipping: true })
  await asset(P1, R1, '침대', { receivedAt: null })                    // 수령 전
  await asset(P1, R1, '공유기')                                        // 제외 품목
  eq('제외 품목 추가', await settings.addInspectionExcludedItem('공유기'), { ok: true })

  const co = await tenants.checkoutTenant(L1, T1, '2026-10-20')
  eq('퇴실 처리 통과', co.ok, true)
  const live1 = await rowsOf({ propertyId: P1, leaseTermId: L1, deletedAt: null })
  eq('퇴실이 두 점검을 만든다', live1.map(r => [r.stage, r.status, r.scheduledDate?.toISOString().slice(0, 10) ?? null]), [['CHECKOUT', 'PLANNED', '2026-10-20'], ['BEFORE_MOVEIN', 'PLANNED', null]])
  const CO = live1.find(r => r.stage === 'CHECKOUT')!.id
  const MV = live1.find(r => r.stage === 'BEFORE_MOVEIN')!.id
  const coLabels = await labelsOf(CO)
  eq('퇴실 점검 = 목록 7 + 비품 2(의자·책상, 제외·폐기·소모품·배송비·수령 전·재고 제외는 빠짐)', [coLabels.length, coLabels.slice(7)], [9, ['의자', '책상']])
  eq('퇴실 처리 결과가 퇴실 점검 항목 수를 싣는다', co.ok && co.inspection, { roomId: R1, itemCount: 9 })
  eq('입실 전 점검 = 목록 9, 비품 없음', (await labelsOf(MV)).length, 9)

  // 중복 퇴실 → 열린 건 하나
  await tenants.checkoutTenant(L1, T1, '2026-10-20')
  eq('중복 퇴실에도 단계마다 열린 점검은 하나', (await rowsOf({ propertyId: P1, roomId: R1, status: 'PLANNED', deletedAt: null })).map(r => r.stage).sort(), ['BEFORE_MOVEIN', 'CHECKOUT'])

  // 생성 후 폐기 → 이름은 남는다 / 목록 이름 변경 → 항목 불변
  await prisma.expense.update({ where: { id: DESK }, data: { disposedAt: new Date('2026-10-21T00:00:00Z') } })
  eq('만든 뒤 폐기한 비품도 항목 이름은 남는다', (await labelsOf(CO)).includes('책상'), true)
  const rn = await settings.renameOption('checkoutInspectionItems', '남은 짐·쓰레기', '남은 짐')
  eq('목록 이름 변경 통과, 따라 바뀐 기록 0', rn.ok && rn.updated, 0)
  eq('이미 만든 항목은 옛 이름 그대로', (await labelsOf(CO)).includes('남은 짐·쓰레기'), true)
  eq('목록은 새 이름', (await settings.getCheckoutInspectionItems()).includes('남은 짐'), true)

  // ── 2. 항목 체크와 적용취소 ────────────────────────────────────────────────
  const mvItems = await insp.getInspectionItems(MV)
  const A = mvItems[0].id
  const s1 = await insp.setInspectionItemResult({ itemId: A, result: 'NG', note: '남의 신발 한 켤레' })
  eq('문제로 표시', s1.ok && [s1.item.result, s1.item.note, s1.prev.result], ['NG', '남의 신발 한 켤레', 'PENDING'])
  const ngAt = s1.ok ? s1.item.checkedAt : null
  const s2 = await insp.setInspectionItemResult({ itemId: A, result: 'OK' })
  eq('확인으로 바꿔도 메모는 남는다', s2.ok && [s2.item.result, s2.item.note], ['OK', '남의 신발 한 켤레'])
  if (s2.ok) await insp.setInspectionItemResult({ itemId: A, result: s2.prev.result, note: s2.prev.note, restoreCheckedAt: s2.prev.checkedAt })
  const backA = await prisma.roomInspectionItem.findUnique({ where: { id: A } })
  eq('결과 적용취소는 이전 결과·확인 시각 그대로', [backA?.result, backA?.checkedAt?.toISOString() ?? null], ['NG', ngAt])
  eq('미래 확인 시각은 안 받는다(지금으로 적는다)', await (async () => {
    const r = await insp.setInspectionItemResult({ itemId: A, result: 'NG', restoreCheckedAt: '2099-01-01T00:00:00Z' })
    return r.ok && r.item.checkedAt !== null && r.item.checkedAt < '2099'
  })(), true)
  const added = await insp.addInspectionItem({ inspectionId: MV, label: '  우편함,  정리 ' })
  eq('손수 더한 항목은 정규화돼 맨 끝', added.ok && [added.item.label, added.item.sortOrder, added.item.source], ['우편함 정리', 9, 'MANUAL'])
  const rm = await insp.removeInspectionItem(added.ok ? added.item.id : '')
  eq('항목 빼기', rm.ok, true)
  const back = rm.ok ? await insp.restoreInspectionItem(J(rm.snapshot)) : null
  eq('항목 빼기 적용취소', back?.ok && [back.item.label, back.item.sortOrder, back.item.source], ['우편함 정리', 9, 'MANUAL'])
  eq('NG 는 미통과 수로 파생된다', (await insp.getRoomInspections(R1)).find(r => r.id === MV)?.ng, 1)

  // 완료 → 항목 잠금 → 적용취소
  eq('미래 완료일은 거부', (await insp.completeInspection({ id: CO, doneDate: '2099-01-01' })).ok, false)
  eq('퇴실 점검 완료', await insp.completeInspection({ id: CO, doneDate: '2026-10-20' }), { ok: true })
  const coFirst = (await prisma.roomInspectionItem.findFirst({ where: { inspectionId: CO } }))!.id
  eq('끝낸 점검의 항목은 못 고친다', (await insp.setInspectionItemResult({ itemId: coFirst, result: 'OK' })).ok, false)
  eq('완료 적용취소', await insp.reopenInspection(CO), { ok: true })
  eq('적용취소 뒤 다시 고친다', (await insp.setInspectionItemResult({ itemId: coFirst, result: 'OK' })).ok, true)
  eq('다시 완료', await insp.completeInspection({ id: CO, doneDate: '2026-10-20' }), { ok: true })
  eq('완료일·완료자 기록', await prisma.roomInspection.findUnique({ where: { id: CO } }).then(r => [r?.doneDate?.toISOString().slice(0, 10), !!r?.doneBy]), ['2026-10-20', true])

  // ── 3. 퇴실 적용취소 → 예정은 걷히고 끝낸 것은 남는다 → 다시 퇴실하면 되살아난다 ──────
  const rev = await tenants.applyStatusTransition({ leaseTermId: L1, tenantId: T1, toStatus: 'ACTIVE' })
  eq('퇴실 적용취소 통과', rev.ok, true)
  const afterRev = await rowsOf({ propertyId: P1, leaseTermId: L1 })
  eq('예정(입실 전)은 소프트삭제, 완료(퇴실 점검)는 그대로', afterRev.map(r => [r.stage, r.status, r.deletedAt ? 'deleted' : 'live']), [['CHECKOUT', 'DONE', 'live'], ['BEFORE_MOVEIN', 'PLANNED', 'deleted']])
  const co2 = await tenants.checkoutTenant(L1, T1, '2026-10-22')
  eq('다시 퇴실 통과', co2.ok, true)
  const afterRe = await rowsOf({ propertyId: P1, leaseTermId: L1 })
  eq('다시 퇴실: 끝낸 퇴실 점검은 새로 안 만들고, 입실 전 점검은 되살린다', afterRe.map(r => [r.stage, r.status, r.deletedAt ? 'deleted' : 'live']), [['CHECKOUT', 'DONE', 'live'], ['BEFORE_MOVEIN', 'PLANNED', 'live']])
  eq('되살린 점검의 체크·메모가 돌아온다', (await prisma.roomInspectionItem.findUnique({ where: { id: A } }))?.note, '남의 신발 한 켤레')
  eq('열린 퇴실 점검이 없으면 토스트 안내도 없다', co2.ok && co2.inspection, undefined)

  // ── 4. 청소 완료 → 청소 검수, 적용취소 → 걷힘, 재완료 → 되살림 ────────────────────
  const C1 = (await prisma.roomCleaning.create({ data: { propertyId: P1, roomId: R1, reason: 'DURING_STAY', status: 'PLANNED' } })).id
  const cc = await cleaning.completeCleaning({ id: C1, doneDate: '2026-10-21', performer: 'SELF' })
  eq('청소 완료가 청소 검수(목록 10)를 만들고 알린다', cc.ok && cc.inspection && [cc.inspection.roomId, cc.inspection.itemCount], [R1, 10])
  const AC = (await rowsOf({ propertyId: P1, cleaningId: C1 }))[0]
  eq('검수 예정일은 청소 완료일', [AC.stage, AC.scheduledDate?.toISOString().slice(0, 10)], ['AFTER_CLEANING', '2026-10-21'])
  const acItem = (await insp.getInspectionItems(AC.id))[0].id
  await insp.setInspectionItemResult({ itemId: acItem, result: 'OK' })
  eq('청소 완료 적용취소', (await cleaning.reopenCleaning(C1)).ok, true)
  eq('예정 검수는 걷힌다', (await prisma.roomInspection.findUnique({ where: { id: AC.id } }))?.deletedAt !== null, true)
  const cc2 = await cleaning.completeCleaning({ id: C1, doneDate: '2026-10-21', performer: 'SELF' })
  eq('재완료가 같은 검수를 되살리고 알린다', cc2.ok && cc2.inspection?.id, AC.id)
  eq('되살린 검수의 체크 그대로', (await prisma.roomInspectionItem.findUnique({ where: { id: acItem } }))?.result, 'OK')
  eq('그 청소의 검수는 하나', (await rowsOf({ propertyId: P1, cleaningId: C1 })).length, 1)
  const cc3 = await cleaning.completeCleaning({ id: C1, doneDate: '2026-10-21', performer: 'SELF' })
  eq('열린 검수가 있으면 새로 알리지 않는다', cc3.ok && cc3.inspection, undefined)

  // ── 5. 입실 처리 → 막지 않고 알린다 ─────────────────────────────────────────
  const T2 = await tenantIn(P1, '나')
  const L2 = await leaseIn(P1, T2, R1, 'RESERVED')
  const mi = await tenants.moveInTenant(L2, T2)
  eq('입실 전 점검이 남아도 입실은 된다', [mi.ok, (await prisma.leaseTerm.findUnique({ where: { id: L2 } }))?.status], [true, 'ACTIVE'])
  eq('입실 결과가 진행을 알린다', mi.ok && mi.notice?.startsWith('입실 전 점검이 끝나지 않았습니다(확인 1/10)'), true)
  eq('열린 입실 전 점검 조회', await insp.getOpenMoveInInspection(R1), { id: MV, checked: 1, total: 10 })

  // ── 6. 손수 등록·안 함·삭제와 적용취소 ───────────────────────────────────────
  const R3 = await roomIn(P1, '502')
  const mk = await insp.createInspection({ roomId: R3, stage: 'BEFORE_MOVEIN' })
  eq('빈 방 손수 등록', mk.ok && mk.itemCount, 9)
  eq('같은 단계 열린 점검이 있으면 막는다', (await insp.createInspection({ roomId: R3, stage: 'BEFORE_MOVEIN' })).ok, false)
  const MK = mk.ok ? mk.id : ''
  eq('안 하기로', await insp.skipInspection(MK), { ok: true })
  eq('안 함 적용취소', await insp.reopenInspection(MK), { ok: true })
  eq('삭제', await insp.deleteInspection(MK), { ok: true })
  eq('삭제분은 목록에서 빠진다', (await insp.getRoomInspections(R3)).length, 0)
  eq('삭제분은 영업장 목록에 삭제됨으로 실린다', (await insp.getPropertyInspections()).some(r => r.id === MK && r.deletedAt !== null), true)
  eq('복원', await insp.restoreInspection(MK), { ok: true })
  eq('복원 뒤 항목 그대로', (await insp.getRoomInspections(R3))[0]?.total, 9)

  // ── 7. 남의 영업장 id 로는 아무것도 못 바꾼다 ─────────────────────────────────
  g.__CR_FLOW_PID = P2
  const R2 = await roomIn(P2, '601')
  const other = await insp.createInspection({ roomId: R2, stage: 'BEFORE_MOVEIN' })
  const I2 = other.ok ? other.id : ''
  const it2 = (await insp.getInspectionItems(I2))[0].id
  g.__CR_FLOW_PID = P1
  const before = await snapAll(P2)
  const GONE = { ok: false, error: '점검 기록을 찾을 수 없습니다.' }
  eq('항목 결과: 거절', await insp.setInspectionItemResult({ itemId: it2, result: 'OK' }), { ok: false, error: '점검 항목을 찾을 수 없습니다.' })
  eq('항목 빼기: 거절', (await insp.removeInspectionItem(it2)).ok, false)
  eq('항목 더하기: 거절', await insp.addInspectionItem({ inspectionId: I2, label: '침입' }), GONE)
  eq('항목 되살리기: 거절', await insp.restoreInspectionItem({ inspectionId: I2, label: '침입', sortOrder: 0, source: 'MANUAL', expenseId: null, result: 'OK', note: null, checkedAt: null }), GONE)
  eq('완료: 거절', await insp.completeInspection({ id: I2, doneDate: '2026-10-20' }), GONE)
  eq('완료 적용취소: 거절', await insp.reopenInspection(I2), GONE)
  eq('안 함: 거절', await insp.skipInspection(I2), GONE)
  eq('삭제: 거절', await insp.deleteInspection(I2), GONE)
  eq('복원: 거절', await insp.restoreInspection(I2), GONE)
  eq('손수 등록: 남의 방 거절', (await insp.createInspection({ roomId: R2, stage: 'CHECKOUT' })).ok, false)
  eq('항목 조회: 빈 목록', await insp.getInspectionItems(I2), [])
  eq('열린 입실 전 점검 조회: 없음', await insp.getOpenMoveInInspection(R2), null)
  eq('남의 영업장 점검·항목 바이트 무변경', await snapAll(P2), before)
  eq('내 영업장 목록에 남의 점검이 안 섞인다', (await insp.getPropertyInspections()).some(r => r.id === I2), false)

  console.log(`[방 점검 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
