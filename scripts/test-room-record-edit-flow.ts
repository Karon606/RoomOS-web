// 작업 이력 결제수단·한 건 수정 통합 회귀. 실제 작업·청소·점검 서버 액션을 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.reason-flow.json scripts/test-room-record-edit-flow.ts
//
// 왜 통합인가(2026-10-27 운영자 지적·승인 계획 1·2단계). 완료가 만드는 지출의 결제수단·정산상태, 한 건 수정이 기록과 걸린 지출을 한 트랜잭션에서
// 고치는지, 적용취소가 저장 직전 모습 전체로 돌아가고 그사이 바뀌면 거부하는지, 남의 영업장 id 로는 한 바이트도 못 바꾸는지는 쓰기를 돌려야 보인다.
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
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다

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
  const work = await import('@/app/(app)/room-manage/workActions')
  const cleaning = await import('@/app/(app)/room-manage/cleaningActions')
  const insp = await import('@/app/(app)/room-manage/inspectionActions')
  const edit = await import('@/app/(app)/room-manage/recordEditActions')
  const payOpts = await import('@/app/(app)/room-manage/workPayActions')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER, paymentMethods: '현금,계좌이체,신용카드' } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  g.__CR_FLOW_PID = P1
  const CARD = (await prisma.financialAccount.create({ data: { propertyId: P1, type: 'CREDIT_CARD', brand: '하나카드', alias: '업무' } })).id
  const BANK = (await prisma.financialAccount.create({ data: { propertyId: P1, type: 'BANK_ACCOUNT', brand: '국민은행', alias: null } })).id
  const CARD2 = (await prisma.financialAccount.create({ data: { propertyId: P2, type: 'CREDIT_CARD', brand: '남의카드', alias: null } })).id
  const roomIn = async (pid: string, roomNo: string) => (await prisma.room.create({ data: { propertyId: pid, roomNo, baseRent: 300000, isVacant: true } })).id as string
  const R1 = await roomIn(P1, '501'), R2 = await roomIn(P1, '502'), R3 = await roomIn(P1, '503'), RX = await roomIn(P2, '601')
  const exp = (id: string) => prisma.expense.findUnique({ where: { id } })
  const expOfWork = (workId: string) => prisma.expense.findMany({ where: { roomWorkId: workId }, orderBy: { createdAt: 'asc' } })
  const updatedAt = async (table: 'roomWork' | 'roomCleaning' | 'roomInspection', id: string) =>
    ((await (prisma[table] as unknown as { findUnique: (a: unknown) => Promise<{ updatedAt: Date } | null> }).findUnique({ where: { id } }))!.updatedAt).toISOString()

  // ── 1. 결제수단 기본값 차례와 완료의 결제수단·정산상태 ─────────────────────────
  // 카테고리 직전도 업체 직전도 없으면 영업장 목록 첫 값(현금).
  const opt0 = await payOpts.getWorkPayOptions('cleaning', ['고시클린'])
  eq('목록 첫 값이 업체도 카테고리도 모를 때의 기본값', [opt0.fallback.payMethod, opt0.byVendor['고시클린'] ?? null], ['현금', null])
  eq('선택지는 영업장 목록 그대로, 계정은 그 영업장 것만', [opt0.methods, opt0.accounts.map(a => a.brand)], [['현금', '계좌이체', '신용카드'], ['하나카드', '국민은행']])

  const C1 = (await prisma.roomCleaning.create({ data: { propertyId: P1, roomId: R1, reason: 'DURING_STAY', status: 'PLANNED' } })).id
  const cc1 = await cleaning.completeCleaning({ id: C1, doneDate: '2026-10-20', performer: 'VENDOR', performerName: '고시클린', cost: 20000, payMethod: '신용카드', financialAccountId: CARD })
  const c1 = await prisma.roomCleaning.findUnique({ where: { id: C1 } })
  const e1 = await exp(c1!.expenseId!)
  eq('청소 완료: 신용카드 지출은 미정산·카드·표시명은 계정에서', [cc1.ok, e1?.payMethod, e1?.financialAccountId, e1?.financeName, e1?.settleStatus], [true, '신용카드', CARD, '하나카드 (업무)', 'UNSETTLED'])
  const opt1 = await payOpts.getWorkPayOptions('cleaning', ['고시클린', '다른청소'])
  eq('같은 업체 직전 지출의 결제수단이 기본값', [opt1.byVendor['고시클린']?.payMethod, opt1.byVendor['고시클린']?.financialAccountId, opt1.byVendor['다른청소'] ?? null], ['신용카드', CARD, null])
  eq('같은 카테고리 직전이 업체를 모를 때의 기본값', opt1.fallback.payMethod, '신용카드')

  // 값 없이 온 완료는 규칙으로 채운다(같은 카테고리 직전 = 신용카드). null 을 남기지 않는다.
  const C2 = (await prisma.roomCleaning.create({ data: { propertyId: P1, roomId: R2, reason: 'CHECKOUT', status: 'PLANNED' } })).id
  await cleaning.completeCleaning({ id: C2, doneDate: '2026-10-20', performer: 'VENDOR', performerName: '새업체', cost: 30000 })
  const e2 = await exp((await prisma.roomCleaning.findUnique({ where: { id: C2 } }))!.expenseId!)
  eq('결제수단 없이 온 완료도 규칙으로 채운다(같은 카테고리 직전, 계정까지)', [e2?.payMethod, e2?.financeName, e2?.settleStatus], ['신용카드', '하나카드 (업무)', 'UNSETTLED'])
  eq('남의 영업장 결제 계정은 거부', (await cleaning.completeCleaning({ id: C2, doneDate: '2026-10-20', performer: 'VENDOR', cost: 30000, payMethod: '신용카드', financialAccountId: CARD2 })).ok, false)
  eq('id 꼴이 아닌 결제 계정도 거부(DB 원문 없이)', await cleaning.completeCleaning({ id: C2, doneDate: '2026-10-20', performer: 'VENDOR', cost: 30000, payMethod: '신용카드', financialAccountId: 'x' }), { ok: false, error: '결제 계정을 찾을 수 없습니다.' })

  // 작업 완료(새 지출) — 계좌이체면 정산완료.
  const W1 = (await prisma.roomWork.create({ data: { propertyId: P1, roomId: R1, kind: '도배', status: 'PLANNED' } })).id
  const wc = await work.completeRoomWork({ id: W1, doneDate: '2026-10-04', performer: 'VENDOR', performerName: '대방도배사', cost: 150000, mode: 'create', payMethod: '계좌이체', financialAccountId: BANK })
  const we = await expOfWork(W1)
  eq('작업 완료: 시공 지출 하나, 계좌이체 정산완료', [wc.ok, we.length, we[0]?.itemLabel, we[0]?.payMethod, we[0]?.financeName, we[0]?.settleStatus], [true, 1, '도배 시공', '계좌이체', '국민은행', 'SETTLED'])

  // ── 2. 작업 한 건 수정: 지출 1건 유지·종류 따라 품목명·결제수단 정본·적용취소 ─────────
  const wu = await work.updateRoomWork({
    id: W1, expectedUpdatedAt: await updatedAt('roomWork', W1), date: '2026-10-05', kind: '장판', performer: 'VENDOR', performerName: '대방장판',
    memo: '  돌출부 포함 ', cost: 170000, payMethod: '신용카드', financialAccountId: CARD,
  })
  const w1 = await prisma.roomWork.findUnique({ where: { id: W1 } })
  const we2 = await expOfWork(W1)
  eq('작업 수정 통과·기록 칸', [wu.ok, w1?.kind, w1?.doneDate?.toISOString().slice(0, 10), w1?.performerName, w1?.memo], [true, '장판', '2026-10-05', '대방장판', '돌출부 포함'])
  eq('수정해도 지출은 1건, 금액·업체·품목명·내역이 따라간다', [we2.length, we2[0]?.amount, we2[0]?.vendor, we2[0]?.itemLabel, we2[0]?.detail], [1, 170000, '대방장판', '장판 시공', '501호 장판 · 대방장판'])
  eq('지출 날짜는 안 옮긴다(작업 날짜와 다른 축)', we2[0]?.date.toISOString().slice(0, 10), '2026-10-04')
  eq('계좌이체에서 신용카드로 바꾸면 미정산(고치는 경로 정본)', [we2[0]?.payMethod, we2[0]?.financeName, we2[0]?.settleStatus], ['신용카드', '하나카드 (업무)', 'UNSETTLED'])
  eq('연 뒤 바뀐 기록은 거부(조건부 쓰기)', (await work.updateRoomWork({ id: W1, expectedUpdatedAt: '2026-01-01T00:00:00.000Z', date: '2026-10-05', kind: '장판', performer: 'VENDOR' })).ok, false)
  eq('미래 완료일 거부', (await work.updateRoomWork({ id: W1, expectedUpdatedAt: await updatedAt('roomWork', W1), date: '2099-01-01', kind: '장판', performer: 'VENDOR' })).ok, false)
  eq('걸린 1건을 0원으로는 안 바꾼다', (await work.updateRoomWork({ id: W1, expectedUpdatedAt: await updatedAt('roomWork', W1), date: '2026-10-05', kind: '장판', performer: 'VENDOR', cost: 0 })).ok, false)

  const undoW = wu.ok ? wu.undo : null
  eq('적용취소 토큰이 서명돼 나온다', !!undoW?.sig, true)
  // 위조 — 쓰기 전 값을 바꿔 보내면 서명이 안 맞는다.
  eq('위조 토큰 거부', (await edit.undoRoomRecordEdit({ ...J(undoW), before: { ...J(undoW)!.before, memo: '위조' } })).ok, false)
  eq('적용취소: 저장 직전 모습 전체로', (await edit.undoRoomRecordEdit(J(undoW))).ok, true)
  const w1b = await prisma.roomWork.findUnique({ where: { id: W1 } })
  const we3 = await expOfWork(W1)
  eq('작업 칸이 돌아온다', [w1b?.kind, w1b?.doneDate?.toISOString().slice(0, 10), w1b?.performerName, w1b?.memo], ['도배', '2026-10-04', '대방도배사', null])
  eq('지출 칸도 돌아온다(정산상태 포함)', [we3.length, we3[0]?.amount, we3[0]?.vendor, we3[0]?.itemLabel, we3[0]?.payMethod, we3[0]?.settleStatus], [1, 150000, '대방도배사', '도배 시공', '계좌이체', 'SETTLED'])
  eq('두 번째 적용취소는 거부(지금이 쓴 직후가 아니다)', (await edit.undoRoomRecordEdit(J(undoW))).ok, false)

  // 그사이 바뀌면 거부 — 수정 뒤 지출 금액이 다른 곳에서 바뀌었다.
  const wu2 = await work.updateRoomWork({ id: W1, expectedUpdatedAt: await updatedAt('roomWork', W1), date: '2026-10-04', kind: '도배', performer: 'VENDOR', performerName: '대방도배사', cost: 160000, payMethod: '계좌이체', financialAccountId: BANK })
  await prisma.expense.update({ where: { id: we3[0].id }, data: { amount: 161000 } })
  eq('그사이 지출이 바뀌면 적용취소 거부', (await edit.undoRoomRecordEdit(J(wu2.ok ? wu2.undo : null))).ok, false)
  eq('거부된 적용취소는 기록을 안 건드린다', (await prisma.roomWork.findUnique({ where: { id: W1 } }))?.kind, '도배')

  // 여러 건 걸린 작업 — 금액 폼 거부, 줄마다 고치기는 그 작업 범위.
  const W2 = (await prisma.roomWork.create({ data: { propertyId: P1, roomId: R2, kind: '실리콘', status: 'DONE', doneDate: new Date('2026-10-10T00:00:00Z'), performer: 'VENDOR' } })).id
  const m1 = (await prisma.expense.create({ data: { propertyId: P1, roomId: R2, roomWorkId: W2, date: new Date('2026-10-10T00:00:00Z'), amount: 50000, category: '수선유지비', itemLabel: '실리콘 시공', payMethod: '현금' } })).id
  await prisma.expense.create({ data: { propertyId: P1, roomId: R2, roomWorkId: W2, date: new Date('2026-10-01T00:00:00Z'), amount: 8000, category: '수선유지비', itemLabel: '실리콘', payMethod: '현금' } })
  eq('여러 건 걸린 작업은 금액 폼 거부', (await work.updateRoomWork({ id: W2, expectedUpdatedAt: await updatedAt('roomWork', W2), date: '2026-10-10', kind: '실리콘', performer: 'VENDOR', cost: 60000 })).ok, false)
  eq('금액 없이는 여러 건 걸린 작업도 고친다', (await work.updateRoomWork({ id: W2, expectedUpdatedAt: await updatedAt('roomWork', W2), date: '2026-10-11', kind: '실리콘', performer: 'VENDOR', memo: '욕실' })).ok, true)
  const ue = await work.updateWorkExpense({ workId: W2, expenseId: m1, amount: 55000, vendor: '글로벌코킹' })
  eq('줄마다 고치기', [ue.ok, (await exp(m1))?.amount, (await exp(m1))?.vendor], [true, 55000, '글로벌코킹'])
  eq('다른 작업의 지출은 그 작업 문으로 못 고친다', (await work.updateWorkExpense({ workId: W1, expenseId: m1, amount: 1 })).ok, false)
  eq('줄 고치기 적용취소', (await edit.undoRoomRecordEdit(J(ue.ok ? ue.undo : null))).ok, true)
  eq('줄 금액·업체가 돌아온다', [(await exp(m1))?.amount, (await exp(m1))?.vendor], [50000, null])

  // 걸린 지출이 없던 완료 작업에 시공비를 적으면 새로 만들고, 적용취소는 그 지출을 지운다.
  const W3 = (await prisma.roomWork.create({ data: { propertyId: P1, roomId: R3, kind: '도배', status: 'DONE', doneDate: new Date('2026-10-12T00:00:00Z'), performer: 'SELF' } })).id
  const wu3 = await work.updateRoomWork({ id: W3, expectedUpdatedAt: await updatedAt('roomWork', W3), date: '2026-10-12', kind: '도배', performer: 'VENDOR', performerName: '대방도배사', cost: 90000, payMethod: '현금' })
  const w3e = await expOfWork(W3)
  eq('0건 완료 작업에 시공비 → 시공 지출 하나', [wu3.ok, w3e.length, w3e[0]?.payMethod, w3e[0]?.settleStatus, w3e[0]?.costKind], [true, 1, '현금', 'SETTLED', 'LABOR'])
  eq('만든 지출 적용취소 → 지출을 지운다', [(await edit.undoRoomRecordEdit(J(wu3.ok ? wu3.undo : null))).ok, (await expOfWork(W3)).length, (await prisma.roomWork.findUnique({ where: { id: W3 } }))?.performer], [true, 0, 'SELF'])
  // 같은 날 걸릴 만한 미연결 시공 지출이 있으면 새로 안 만든다(두 벌 방지).
  await prisma.expense.create({ data: { propertyId: P1, roomId: R3, date: new Date('2026-10-12T00:00:00Z'), amount: 90000, category: '수선유지비', itemLabel: '도배 시공', payMethod: '현금' } })
  eq('같은 날 미연결 시공 지출이 있으면 거부', (await work.updateRoomWork({ id: W3, expectedUpdatedAt: await updatedAt('roomWork', W3), date: '2026-10-12', kind: '도배', performer: 'VENDOR', cost: 90000 })).ok, false)
  // 예정 작업에는 시공비를 안 받는다.
  const W4 = (await prisma.roomWork.create({ data: { propertyId: P1, roomId: R3, kind: '장판', status: 'PLANNED' } })).id
  eq('예정 작업에 시공비 거부', (await work.updateRoomWork({ id: W4, expectedUpdatedAt: await updatedAt('roomWork', W4), date: null, kind: '장판', performer: null, cost: 1000 })).ok, false)
  const wu4 = await work.updateRoomWork({ id: W4, expectedUpdatedAt: await updatedAt('roomWork', W4), date: '2026-11-03', kind: '장판', performer: 'SELF', performerName: '안 보이는 이름' })
  const w4 = await prisma.roomWork.findUnique({ where: { id: W4 } })
  eq('예정 작업: 예정일·담당, 직접이면 이름 안 남김', [wu4.ok, w4?.scheduledDate?.toISOString().slice(0, 10), w4?.performer, w4?.performerName], [true, '2026-11-03', 'SELF', null])
  // 지출 없는 수정도 그사이 기록이 바뀌면 적용취소를 거부한다(기록 칸 '쓴 직후' 대조).
  await prisma.roomWork.update({ where: { id: W4 }, data: { memo: '다른 화면에서 고침' } })
  eq('그사이 기록이 바뀌면 적용취소 거부(지출 없는 수정)', [(await edit.undoRoomRecordEdit(J(wu4.ok ? wu4.undo : null))).ok, (await prisma.roomWork.findUnique({ where: { id: W4 } }))?.scheduledDate?.toISOString().slice(0, 10)], [false, '2026-11-03'])

  // ── 3. 청소 한 건 수정: 날짜가 지출 date 를 데려간다·부담 표식 가드·연결 끊기와 되살림 ─────
  const LT = (await prisma.leaseTerm.create({ data: { propertyId: P1, tenantId: (await prisma.tenant.create({ data: { propertyId: P1, name: '가' } })).id, roomId: R2, status: 'CHECKED_OUT', rentAmount: 300000, depositAmount: 0, dueDay: '1', moveInDate: new Date('2026-09-01T00:00:00Z'), moveOutDate: new Date('2026-10-19T00:00:00Z') } })).id
  const cu1 = await cleaning.updateCleaning({
    id: C2, expectedUpdatedAt: await updatedAt('roomCleaning', C2), date: '2026-10-18', reason: 'CHECKOUT', performer: 'VENDOR', performerName: '새업체',
    cost: 35000, payMethod: '신용카드', financialAccountId: CARD, fromCleaningFund: true, memo: '창틀 포함',
  })
  const c2 = await prisma.roomCleaning.findUnique({ where: { id: C2 } })
  const e2b = await exp(c2!.expenseId!)
  eq('청소 수정 통과·부담 표식과 귀속 계약', [cu1.ok, c2?.doneDate?.toISOString().slice(0, 10), c2?.fromCleaningFund, c2?.leaseTermId, c2?.memo], [true, '2026-10-18', true, LT, '창틀 포함'])
  eq('청소 날짜 변경이 지출 date 를 데려간다·금액·카드', [e2b?.date.toISOString().slice(0, 10), e2b?.amount, e2b?.financeName, e2b?.settleStatus], ['2026-10-18', 35000, '하나카드 (업무)', 'UNSETTLED'])
  eq('부담 표식 건은 표식을 함께 안 끄면 퇴실 청소 밖으로 못 간다', (await cleaning.updateCleaning({ id: C2, expectedUpdatedAt: await updatedAt('roomCleaning', C2), date: '2026-10-18', reason: 'AFTER_WORK', performer: 'VENDOR', cost: 35000 })).ok, false)
  const cu2 = await cleaning.updateCleaning({ id: C2, expectedUpdatedAt: await updatedAt('roomCleaning', C2), date: '2026-10-18', reason: 'AFTER_WORK', performer: 'VENDOR', performerName: '새업체', cost: 35000, payMethod: '신용카드', financialAccountId: CARD, fromCleaningFund: false })
  eq('표식을 함께 끄면 바꾼다', [cu2.ok, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.fromCleaningFund, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.reason], [true, false, 'AFTER_WORK'])
  eq('적용취소로 사유·표식이 돌아온다', [(await edit.undoRoomRecordEdit(J(cu2.ok ? cu2.undo : null))).ok, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.reason, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.fromCleaningFund], [true, 'CHECKOUT', true])
  eq('앞 수정도 적용취소(날짜·지출·표식 전부)', (await edit.undoRoomRecordEdit(J(cu1.ok ? cu1.undo : null))).ok, true)
  const c2c = await prisma.roomCleaning.findUnique({ where: { id: C2 } })
  const e2c = await exp(c2c!.expenseId!)
  eq('청소 칸 복원', [c2c?.doneDate?.toISOString().slice(0, 10), c2c?.fromCleaningFund, c2c?.leaseTermId, c2c?.memo], ['2026-10-20', false, null, null])
  eq('지출 칸 복원', [e2c?.date.toISOString().slice(0, 10), e2c?.amount, e2c?.financeName, e2c?.payMethod, e2c?.memo ?? null], ['2026-10-20', 30000, '하나카드 (업무)', '신용카드', null])
  // 비용 0 — 연결만 끊고, 적용취소가 다시 잇는다. 그사이 지출이 지워졌으면 안 잇는다.
  const linked = c2c!.expenseId!
  const cu3 = await cleaning.updateCleaning({ id: C2, expectedUpdatedAt: await updatedAt('roomCleaning', C2), date: '2026-10-20', reason: 'CHECKOUT', performer: 'VENDOR', cost: 0 })
  eq('비용 0 은 연결만 끊는다(지출은 남는다)', [cu3.ok, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.expenseId ?? null, !!(await exp(linked))], [true, null, true])
  eq('끊은 연결 적용취소', [(await edit.undoRoomRecordEdit(J(cu3.ok ? cu3.undo : null))).ok, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.expenseId], [true, linked])
  const cu4 = await cleaning.updateCleaning({ id: C2, expectedUpdatedAt: await updatedAt('roomCleaning', C2), date: '2026-10-20', reason: 'CHECKOUT', performer: 'VENDOR', cost: 0 })
  await prisma.expense.delete({ where: { id: linked } })
  eq('지워진 지출로는 연결을 되살리지 않는다', [(await edit.undoRoomRecordEdit(J(cu4.ok ? cu4.undo : null))).ok, (await prisma.roomCleaning.findUnique({ where: { id: C2 } }))?.expenseId ?? null], [false, null])
  // 예정 청소는 예정일·사유·메모만.
  const C3 = (await prisma.roomCleaning.create({ data: { propertyId: P1, roomId: R3, reason: 'CHECKOUT', status: 'PLANNED' } })).id
  const cu5 = await cleaning.updateCleaning({ id: C3, expectedUpdatedAt: await updatedAt('roomCleaning', C3), date: null, reason: '방역', addReasonToList: false, memo: '예약' })
  const c3 = await prisma.roomCleaning.findUnique({ where: { id: C3 } })
  eq('예정 청소: 예정일 비우기·목록 밖 사유는 기타 · 글', [cu5.ok, c3?.scheduledDate, c3?.reason, c3?.memo], [true, null, '기타 · 방역', '예약'])

  // ── 4. 점검 한 건 수정: 예정은 날짜·메모, 끝낸 점검은 메모만 ───────────────────────
  const made = await insp.createInspection({ roomId: R3, stage: 'BEFORE_MOVEIN' })
  const I1 = made.ok ? made.id : ''
  const iu = await insp.updateInspection({ id: I1, expectedUpdatedAt: await updatedAt('roomInspection', I1), scheduledDate: '2026-11-01', memo: '신발장' })
  eq('예정 점검: 예정일·메모', [iu.ok, (await prisma.roomInspection.findUnique({ where: { id: I1 } }))?.scheduledDate?.toISOString().slice(0, 10)], [true, '2026-11-01'])
  eq('점검 수정 적용취소', [(await edit.undoRoomRecordEdit(J(iu.ok ? iu.undo : null))).ok, (await prisma.roomInspection.findUnique({ where: { id: I1 } }))?.scheduledDate ?? null, (await prisma.roomInspection.findUnique({ where: { id: I1 } }))?.memo ?? null], [true, null, null])
  await insp.completeInspection({ id: I1, doneDate: '2026-10-20' })
  eq('끝낸 점검은 날짜를 못 고친다(잠금)', (await insp.updateInspection({ id: I1, expectedUpdatedAt: await updatedAt('roomInspection', I1), scheduledDate: '2026-11-02', memo: null })).ok, false)
  eq('끝낸 점검도 메모는 고친다', (await insp.updateInspection({ id: I1, expectedUpdatedAt: await updatedAt('roomInspection', I1), memo: '확인 완료' })).ok, true)

  // ── 4b. 견적(3단계): 지출을 안 만들고, 합계에 안 들고, 완료 적용취소에도 남고, 수정 적용취소가 되돌린다 ─────
  const expCount = async () => prisma.expense.count({ where: { propertyId: P1 } })
  const expSum = async () => (await prisma.expense.aggregate({ where: { propertyId: P1 }, _sum: { amount: true } }))._sum.amount
  const [n0, s0] = [await expCount(), await expSum()]
  const ce = await work.createRoomWork({ roomId: R2, kind: '도배', scheduledDate: '2026-11-10', estimateAmount: 150000 })
  const WE = ce.ok ? ce.id : ''
  eq('견적을 적은 예정 등록은 지출을 안 만든다', [(await prisma.roomWork.findUnique({ where: { id: WE } }))?.estimateAmount, await expCount(), await expSum()], [150000, n0, s0])
  eq('0·음수 견적은 견적 없음', [(await work.createRoomWork({ roomId: R2, kind: '장판', estimateAmount: -5 })).ok, (await prisma.roomWork.findFirst({ where: { roomId: R2, kind: '장판' } }))?.estimateAmount ?? null], [true, null])
  eq('목록 행이 견적을 싣는다', (await work.listRoomWorks(R2)).find(w => w.id === WE)?.estimateAmount, 150000)
  const eu = await work.updateRoomWork({ id: WE, expectedUpdatedAt: await updatedAt('roomWork', WE), date: '2026-11-10', kind: '도배', performer: null, estimateAmount: 170000 })
  eq('수정 폼이 견적을 고친다(지출 무변경)', [eu.ok, (await prisma.roomWork.findUnique({ where: { id: WE } }))?.estimateAmount, await expCount()], [true, 170000, n0])
  eq('견적 수정 적용취소', [(await edit.undoRoomRecordEdit(J(eu.ok ? eu.undo : null))).ok, (await prisma.roomWork.findUnique({ where: { id: WE } }))?.estimateAmount], [true, 150000])
  await work.completeRoomWork({ id: WE, doneDate: '2026-10-20', performer: 'VENDOR', cost: 160000, mode: 'create', payMethod: '현금' })
  eq('완료 지출 금액은 견적이 아니라 적은 시공비', [(await expOfWork(WE)).map(e => e.amount), (await prisma.roomWork.findUnique({ where: { id: WE } }))?.estimateAmount], [[160000], 150000])
  await work.reopenRoomWork(WE)
  eq('완료 적용취소에도 견적은 남는다', (await prisma.roomWork.findUnique({ where: { id: WE } }))?.estimateAmount, 150000)
  eq('견적을 안 실은 수정은 견적을 그대로 둔다', [(await work.updateRoomWork({ id: WE, expectedUpdatedAt: await updatedAt('roomWork', WE), date: '2026-11-11', kind: '도배', performer: null })).ok, (await prisma.roomWork.findUnique({ where: { id: WE } }))?.estimateAmount], [true, 150000])

  // ── 5. 남의 영업장 ─────────────────────────────────────────────────────────
  g.__CR_FLOW_PID = P2
  const WX = (await prisma.roomWork.create({ data: { propertyId: P2, roomId: RX, kind: '도배', status: 'PLANNED' } })).id
  const CX = (await prisma.roomCleaning.create({ data: { propertyId: P2, roomId: RX, reason: 'CHECKOUT', status: 'PLANNED' } })).id
  const tokenFromP2 = await work.updateRoomWork({ id: WX, expectedUpdatedAt: await updatedAt('roomWork', WX), date: '2026-11-01', kind: '도배', performer: null })
  g.__CR_FLOW_PID = P1
  const snapP2 = async () => JSON.stringify({ w: await prisma.roomWork.findMany({ where: { propertyId: P2 }, orderBy: { id: 'asc' } }), c: await prisma.roomCleaning.findMany({ where: { propertyId: P2 }, orderBy: { id: 'asc' } }) })
  const beforeP2 = await snapP2()
  eq('남의 작업 수정 거절', (await work.updateRoomWork({ id: WX, expectedUpdatedAt: await updatedAt('roomWork', WX), date: '2026-11-02', kind: '침입', performer: null })).ok, false)
  eq('남의 청소 수정 거절', (await cleaning.updateCleaning({ id: CX, expectedUpdatedAt: await updatedAt('roomCleaning', CX), date: null, reason: 'AFTER_WORK' })).ok, false)
  eq('남의 영업장 토큰으로 적용취소 거절', (await edit.undoRoomRecordEdit(J(tokenFromP2.ok ? tokenFromP2.undo : null))).ok, false)
  eq('남의 영업장 바이트 무변경', await snapP2(), beforeP2)

  console.log(`[작업 이력 한 건 수정 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
