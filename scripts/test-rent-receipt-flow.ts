// 납부 확인서 여러 달 발급·적용취소·퇴실자 통합 회귀. 실제 서버 본체를 메모리 PGlite 위에서 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.rent-receipt-flow.json scripts/test-rent-receipt-flow.ts
//
// 왜 통합인가(신고 2026-10-19 납부영수증 여러 달). 진리표(test-rent-receipt-months)는 순수 함수만 본다. 묶음이 한 트랜잭션인지,
// 발행번호가 차례로 붙는지, 적용취소가 표를 **바이트까지** 되돌리는지, 반쪽이 바뀐 묶음을 거절하는지, 남의 영업장 id 로는
// 아무것도 못 하는지, 퇴실 완료 계약이 실입금 달만 내는지는 실제 쓰기를 돌려야 보인다.
// 대역·운영 DB 차단은 현금영수증 하네스와 같은 판이다(scripts/tsconfig.rent-receipt-flow.json, Drive 는 메모리 대역).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 57000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
// 서명 키가 있어야 서명 대조까지 실제로 돈다(키가 없으면 개발 모드는 구조 검사만 한다).
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x4e).toString('base64')

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
  const actions = await import('@/app/rent-receipt/[tenantId]/actions')
  const { issueRentReceiptBatch } = await import('@/app/rent-receipt/[tenantId]/issueBatch')
  const issue = await import('@/lib/rentReceiptIssue')
  const listActions = await import('@/app/(app)/rent-receipts/actions')
  const bundleActions = await import('@/app/(app)/tenants/docBundle')
  const { RENT_RECEIPT_UNDO_STALE, RENT_RECEIPT_UNDO_INVALID } = await import('@/lib/rentReceiptMonths')
  const { kstYmdStr } = await import('@/lib/kstDate')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string; __RR_DRIVE?: Map<string, { trashed: boolean }>; __RR_DRIVE_FAIL_AT?: number; __RR_DRIVE_N?: number }
  const today = kstYmdStr()

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)
  let roomSeq = 400
  async function lease(pid: string, status: 'ACTIVE' | 'CHECKED_OUT' = 'ACTIVE', isShortTerm = false) {
    const t = await prisma.tenant.create({ data: { name: '홍길동', propertyId: pid } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: pid } })
    const l = await prisma.leaseTerm.create({
      data: { tenantId: t.id, propertyId: pid, roomId: room.id, rentAmount: 150000, dueDay: '21', moveInDate: day('2026-04-21'), status, isShortTerm },
    })
    return { id: l.id as string, tenantId: t.id as string }
  }
  let seq = 0
  async function rec(l: { id: string; tenantId: string }, pid: string, o: { month: string; amount: number; pay: string; adjust?: boolean; memo?: string }) {
    await prisma.paymentRecord.create({
      data: {
        leaseTermId: l.id, tenantId: l.tenantId, propertyId: pid, targetMonth: o.month,
        expectedAmount: 150000, actualAmount: o.amount, payDate: day(o.pay), payMethod: '계좌이체',
        seqNo: ++seq, isBillingAdjust: !!o.adjust, memo: o.memo ?? null,
      },
    })
  }
  // 표 전체의 바이트(전 칼럼). 적용취소 뒤 '살아 있는 행'이 발급 전과 같은지 본다.
  const table = async () => (await prisma.rentReceiptFile.findMany({ orderBy: { id: 'asc' } }))
    .map((r: Record<string, unknown>) => JSON.stringify(r))
  const alive = async () => (await prisma.rentReceiptFile.findMany({ where: { deletedAt: null }, orderBy: { id: 'asc' } }))
    .map((r: Record<string, unknown>) => JSON.stringify(r))

  // ── 준비: 423호 꼴 ─────────────────────────────────────────────────
  g.__CR_FLOW_PID = P1
  const A = await lease(P1)
  await rec(A, P1, { month: '2026-06', amount: 150000, pay: '2026-06-21', adjust: true })            // 조정 전표 = 실입금 아님
  await rec(A, P1, { month: '2026-07', amount: 100000, pay: '2026-07-15' })
  await rec(A, P1, { month: '2026-08', amount: 50000, pay: '2026-08-25' })
  await rec(A, P1, { month: '2026-08', amount: 100000, pay: '2026-09-18' })                          // 8월분 최종 납부 9/18
  await rec(A, P1, { month: '2026-09', amount: 150000, pay: '2026-09-18' })
  await rec(A, P1, { month: '2026-10', amount: 130000, pay: '2026-10-01', memo: '[납입일변경] 21일→1일' }) // 납입일 변경 조정 = 실입금 아님
  const OUT = await lease(P1, 'CHECKED_OUT')
  await rec(OUT, P1, { month: '2026-05', amount: 150000, pay: '2026-05-20' })
  const SHORT = await lease(P1, 'ACTIVE', true)
  g.__CR_FLOW_PID = P2
  const B = await lease(P2)
  await rec(B, P2, { month: '2026-09', amount: 150000, pay: '2026-09-21' })
  g.__CR_FLOW_PID = P1

  // ── 1. 고를 수 있는 달·발행일 기본값(실데이터 경로) ─────────────────────
  const d8 = await actions.getRentReceiptData(A.tenantId, '2026-08', 'rent', A.id)
  eq('고를 수 있는 달은 실입금 달만(조정 전표·납입일 조정 제외)', d8?.issuable.map(m => [m.month, m.amount, m.lastPayDate]),
    [['2026-09', 150000, '2026-09-18'], ['2026-08', 150000, '2026-09-18'], ['2026-07', 100000, '2026-07-15']])
  eq('8월분 발행일 기본값 = 그 달 몫 마지막 입금일', d8?.defaultIssueDate, '2026-09-18')
  const d6 = await actions.getRentReceiptData(A.tenantId, '2026-06', 'rent', A.id)
  eq('실입금 없는 달 발행일 기본값 = 오늘', d6?.defaultIssueDate, today)
  const dShort = await actions.getRentReceiptData(SHORT.tenantId, undefined, 'rent', SHORT.id)
  eq('단기는 여러 달 목록이 비어 있다', dShort?.issuable, [])
  const dDep = await actions.getRentReceiptData(A.tenantId, undefined, 'deposit', A.id)
  eq('보증금 영수증 발행일 기본값 = 오늘, 목록 없음', [dDep?.defaultIssueDate, dDep?.issuable], [today, []])

  // ── 2. 여러 달 발급 ────────────────────────────────────────────────
  const before = await table()
  const picks = [{ month: '2026-07', issueDate: '2026-07-15' }, { month: '2026-08', issueDate: '2026-09-18' }, { month: '2026-09', issueDate: '2026-09-18' }]
  const r1 = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks })
  eq('묶음 발급 성공', r1.ok, true)
  if (!r1.ok) throw new Error(r1.error)
  eq('달마다 한 장 · 귀속월 · 발행일', r1.files.map(f => [f.targetMonth, f.issuedAt.slice(0, 10)]),
    [['2026-07', '2026-07-15'], ['2026-08', '2026-09-18'], ['2026-09', '2026-09-18']])
  eq('발행번호가 차례로 붙는다', r1.files.map(f => f.receiptNo), ['20260715-001', '20260918-002', '20260918-003'])
  const rows1 = await prisma.rentReceiptFile.findMany({ where: { id: { in: r1.files.map(f => f.id) } } })
  eq('발급본은 그 계약·rent·지목 계약', rows1.map((r: { leaseTermId: string | null; kind: string; tenantId: string }) => [r.leaseTermId, r.kind, r.tenantId]),
    rows1.map(() => [A.id, 'rent', A.tenantId]))
  eq('Drive 에 세 장 올라감', [...(g.__RR_DRIVE?.values() ?? [])].filter(f => !f.trashed).length, 3)
  eq('적용취소 토큰은 서명이 붙어 있다', typeof r1.undo?.sig, 'string')
  const d8b = await actions.getRentReceiptData(A.tenantId, '2026-08', 'rent', A.id)
  eq('목록이 발급본이 있는 달을 안다', d8b?.issuable.map(m => !!m.issuedAt), [true, true, true])

  // ── 3. 서류 시트 최신 판정(귀속월) ───────────────────────────────────
  // 9월분을 먼저 늦은 발행일로 냈어도, 뒤에 7월분을 더 늦은 발행일로 내면 발행일 최신은 7월분이다. 시트는 9월분을 세워야 한다.
  const late = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: [{ month: '2026-07', issueDate: today }] })
  const bundle = await bundleActions.getTenantDocBundle(A.tenantId)
  const rentRow = bundle?.groups.find(gp => gp.leaseTermId === A.id)?.rows.find(r => r.docType === 'rent')
  const nineDrive = r1.files.find(f => f.targetMonth === '2026-09')?.driveFileId
  eq('시트 최신 = 귀속월이 가장 늦은 장(9월분)', rentRow?.driveFileId, nineDrive)
  eq('시트 행 보조줄에 귀속월', rentRow?.note?.startsWith('2026년 9월분'), true)
  eq("시트 행 '여러 달 작성'", rentRow?.writeMany, true)
  if (late.ok && late.undo) eq('늦게 낸 7월분 적용취소', (await actions.undoRentReceiptIssue(J(late.undo))).ok, true)

  // ── 4. 묶음 적용취소 = 바이트 동일 ──────────────────────────────────
  const u1 = await actions.undoRentReceiptIssue(J(r1.undo))
  eq('묶음 적용취소 성공', u1, { ok: true, count: 3 })
  eq('살아 있는 행 바이트 = 발급 전 표', await alive(), before)
  const created = await prisma.rentReceiptFile.findMany({ where: { id: { in: r1.files.map(f => f.id) } } })
  eq('만든 행은 지운 표시로만 남는다(번호 보존)', created.map((r: { deletedAt: Date | null }) => !!r.deletedAt), [true, true, true])
  eq('Drive 세 장 휴지통', r1.files.map(f => g.__RR_DRIVE?.get(f.driveFileId)?.trashed), [true, true, true])
  eq('같은 토큰 두 번째 = 거절(STALE)', await actions.undoRentReceiptIssue(J(r1.undo)), { ok: false, error: RENT_RECEIPT_UNDO_STALE })

  // ── 5. CAS: 반쪽이 바뀐 묶음은 한 장도 안 되돌린다 ─────────────────────
  const r2 = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks.slice(1) })
  if (!r2.ok) throw new Error(r2.error)
  eq('지운 번호를 다시 쓰지 않는다', r2.files.map(f => f.receiptNo), ['20260918-005', '20260918-006'])
  await listActions.deleteRentReceiptFile(r2.files[0].id)
  eq('한 장이 지워진 묶음 적용취소 = 거절', await actions.undoRentReceiptIssue(J(r2.undo)), { ok: false, error: RENT_RECEIPT_UNDO_STALE })
  const keep = await prisma.rentReceiptFile.findUnique({ where: { id: r2.files[1].id } })
  eq('나머지 한 장은 그대로 살아 있다', keep?.deletedAt, null)
  await listActions.restoreRentReceiptFile(r2.files[0].id)
  eq('복구 뒤 같은 토큰 = 통과(모양이 그대로)', (await actions.undoRentReceiptIssue(J(r2.undo))).ok, true)

  // ── 5-2. CAS: 지워진 게 아니라 **바뀐** 행이 섞인 묶음도 한 장도 안 되돌린다(검수 2026-10-20) ──────────
  const r2b = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks.slice(1) })
  if (!r2b.ok) throw new Error(r2b.error)
  await prisma.rentReceiptFile.update({ where: { id: r2b.files[1].id }, data: { nameStyle: 'en' } })   // 그 사이 다른 쓰기가 한 칸을 바꿨다
  eq('바뀐 행이 섞인 묶음 적용취소 = 거절', await actions.undoRentReceiptIssue(J(r2b.undo)), { ok: false, error: RENT_RECEIPT_UNDO_STALE })
  eq('바뀐 묶음은 두 장 다 살아 있다', (await prisma.rentReceiptFile.findMany({ where: { id: { in: r2b.files.map(f => f.id) } } })).map((r: { deletedAt: Date | null }) => r.deletedAt), [null, null])
  await prisma.rentReceiptFile.update({ where: { id: r2b.files[1].id }, data: { nameStyle: null } })
  eq('모양을 되돌리면 같은 토큰 = 통과', (await actions.undoRentReceiptIssue(J(r2b.undo))).ok, true)

  // ── 5-3. 멱등: 같은 요청 id 가 다시 오면(응답 유실 뒤 재클릭) 새로 안 만든다 ───────────────────
  const rid = randomUUID()
  const q1 = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks.slice(2), requestId: rid })
  const countAfter1 = await prisma.rentReceiptFile.count()
  const q2 = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks.slice(2), requestId: rid })
  eq('같은 요청 id 재전송 = 같은 장', [q1.ok && q1.files.map(f => f.id), await prisma.rentReceiptFile.count()], [q2.ok && q2.files.map(f => f.id), countAfter1])
  if (q1.ok) eq('재전송 장 적용취소', (await actions.undoRentReceiptIssue(J(q1.undo))).ok, true)

  // ── 5-4. 동시 발급: 같은 영업장 두 묶음이 겹쳐도 번호가 안 겹치고 둘 다 성공한다(영업장 줄 세우기) ──────────
  const [c1, c2] = await Promise.all([
    issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks }),
    issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks.slice(1) }),
  ])
  const nos = [...(c1.ok ? c1.files : []), ...(c2.ok ? c2.files : [])].map(f => f.receiptNo)
  eq('동시 묶음 둘 다 성공 · 번호 다섯 장 모두 다름', [c1.ok, c2.ok, new Set(nos).size], [true, true, 5])
  if (c1.ok) await actions.undoRentReceiptIssue(J(c1.undo))
  if (c2.ok) await actions.undoRentReceiptIssue(J(c2.undo))
  eq('번호 충돌(P2002) 문장', issue.rentReceiptIssueErrorMessage({ code: 'P2002' }), '발행번호가 다른 발급과 겹쳐 발급하지 않았습니다. 잠시 후 다시 발급해 주세요.')
  eq('다른 오류는 문장 없음', issue.rentReceiptIssueErrorMessage(new Error('x')), null)

  // ── 6. 위조·남의 영업장 ──────────────────────────────────────────
  const r3 = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: [picks[2]] })
  if (!r3.ok || !r3.undo) throw new Error('r3')
  const forged = J(r3.undo); forged.rows[0].fileName = 'x.pdf'
  eq('토큰 칸을 고치면 서명 불일치 = 거절', await actions.undoRentReceiptIssue(forged), { ok: false, error: RENT_RECEIPT_UNDO_INVALID })
  eq('모양이 틀린 토큰 = 거절', await actions.undoRentReceiptIssue({ v: 1, rows: [] }), { ok: false, error: RENT_RECEIPT_UNDO_INVALID })
  g.__CR_FLOW_PID = P2
  eq('남의 영업장에서 같은 토큰 = 거절', await actions.undoRentReceiptIssue(J(r3.undo)), { ok: false, error: RENT_RECEIPT_UNDO_INVALID })
  g.__CR_FLOW_PID = P1
  eq('남의 영업장 사람 = 거절', (await issueRentReceiptBatch(P1, { tenantId: B.tenantId, leaseTermId: B.id, months: [{ month: '2026-09', issueDate: '2026-09-21' }] })).ok, false)
  eq('내 사람 + 남의 계약 = 거절', (await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: B.id, months: [{ month: '2026-09', issueDate: '2026-09-21' }] })).ok, false)
  eq('r3 는 그대로', (await prisma.rentReceiptFile.findUnique({ where: { id: r3.files[0].id } }))?.deletedAt, null)
  eq('r3 적용취소', (await actions.undoRentReceiptIssue(J(r3.undo))).ok, true)

  // ── 7. 요청 검사 ───────────────────────────────────────────────
  const bad = async (months: { month: string; issueDate: string }[]) => {
    const r = await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months })
    return r.ok ? 'ok' : r.status
  }
  eq('실입금 없는 달(조정 전표만) = 400', await bad([{ month: '2026-06', issueDate: '2026-06-21' }]), 400)
  eq('납입일 조정 행만 있는 달 = 400', await bad([{ month: '2026-10', issueDate: '2026-10-01' }]), 400)
  eq('같은 달 두 번 = 400', await bad([picks[0], picks[0]]), 400)
  eq('미래 발행일 = 400', await bad([{ month: '2026-09', issueDate: '2999-01-01' }]), 400)
  eq('입금일보다 앞선 발행일 = 400', await bad([{ month: '2026-08', issueDate: '2026-08-21' }]), 400)
  eq('빈 묶음 = 400', await bad([]), 400)
  eq('단기 계약 묶음 = 400', (await issueRentReceiptBatch(P1, { tenantId: SHORT.tenantId, leaseTermId: SHORT.id, months: [picks[0]] })).ok, false)
  eq('검사에서 떨어지면 아무것도 안 쓴다', await alive(), before)

  // ── 8. 한 장이라도 실패하면 전부 되감는다 ──────────────────────────────
  g.__RR_DRIVE_FAIL_AT = (g.__RR_DRIVE_N ?? 0) + 2
  let threw = false
  try { await issueRentReceiptBatch(P1, { tenantId: A.tenantId, leaseTermId: A.id, months: picks }) } catch { threw = true }
  g.__RR_DRIVE_FAIL_AT = undefined
  eq('둘째 업로드 실패 = 던진다', threw, true)
  eq('실패한 묶음은 행을 하나도 안 남긴다', await alive(), before)
  eq('먼저 올린 한 장은 휴지통', [...(g.__RR_DRIVE?.values() ?? [])].filter(f => !f.trashed).length, 0)

  // ── 9. 한 장 발급(정본 경로 그대로) + 적용취소 ──────────────────────────
  const loaded = await issue.loadRentReceiptIssueContext(P1)
  if (!loaded.ok) throw new Error('ctx')
  const up: string[] = []
  const [one] = await prisma.$transaction(tx => issue.issueRentReceiptsInTx(tx, loaded.ctx, [{
    tenantId: A.tenantId, tenantName: '홍길동', leaseTermId: A.id, nameStyle: null, targetMonth: '2026-09',
    fields: { issueDate: '2026-09-18', name: '홍길동', room: '401호', period: '', targetMonth: '2026년 9월분', amount: '150,000', payDate: '', payMethod: '', note: '', recipientName: '' },
  }], up, issue.receiptRequestTag(undefined)))
  const oneUndo = issue.signRentReceiptUndo(P1, [one])
  eq('한 장 발급 적용취소', (await actions.undoRentReceiptIssue(J(oneUndo))).ok, true)
  eq('한 장 적용취소 뒤 바이트 = 발급 전', await alive(), before)

  // ── 10. 퇴실 완료 계약 ───────────────────────────────────────────
  const dOut = await actions.getRentReceiptData(OUT.tenantId, undefined, 'rent', null)
  eq('퇴실자: 계약을 고른다', dOut?.leaseTermId, OUT.id)
  eq('퇴실자: 달을 안 주면 마지막 실입금 달', dOut?.anchorMonth, '2026-05')
  eq('퇴실자: 고를 수 있는 달', dOut?.issuable.map(m => m.month), ['2026-05'])
  const dOutDep = await actions.getRentReceiptData(OUT.tenantId, undefined, 'deposit', null)
  eq('퇴실자 보증금 영수증은 계약을 안 잡는다', dOutDep?.leaseTermId, null)
  const rOut = await issueRentReceiptBatch(P1, { tenantId: OUT.tenantId, leaseTermId: OUT.id, months: [{ month: '2026-05', issueDate: '2026-05-20' }] })
  eq('퇴실자 묶음 발급', rOut.ok, true)
  eq('퇴실자 실입금 없는 달 = 400', (await issueRentReceiptBatch(P1, { tenantId: OUT.tenantId, leaseTermId: OUT.id, months: [{ month: '2026-06', issueDate: '2026-06-20' }] })).ok, false)
  const outBundle = await bundleActions.getTenantDocBundle(OUT.tenantId)
  const outGroup = outBundle?.groups.find(gp => gp.leaseTermId === OUT.id)
  eq('퇴실자 시트: 퇴실 계약 그룹 = 납부 확인서 한 행', outGroup?.rows.map(r => [r.docType, r.writeMany ?? null, r.canWriteNew ?? null]), [['rent', true, null]])
  eq('퇴실자 시트: 중립 그룹에 같은 종이를 또 세우지 않는다', outBundle?.groups.some(gp => gp.kind === 'other' && gp.rows.some(r => r.docType === 'rent')), false)
  g.__CR_FLOW_PID = P2
  eq('남의 영업장에서 퇴실자 조회 = 없음', await actions.getRentReceiptData(OUT.tenantId, undefined, 'rent', OUT.id), null)
  eq('남의 영업장에서 퇴실자 묶음 = 거절', (await issueRentReceiptBatch(P2, { tenantId: OUT.tenantId, leaseTermId: OUT.id, months: [{ month: '2026-05', issueDate: '2026-05-20' }] })).ok, false)
  g.__CR_FLOW_PID = P1

  // ── 11. 전역 발급 이력 '다시 작성'이 귀속월을 안다 ───────────────────────
  const list = await listActions.getAllRentReceiptFiles()
  eq('이력 행에 귀속월', list.find(r => rOut.ok && r.id === rOut.files[0].id)?.targetMonth, '2026-05')

  await server.stop()
  await pg.close()
  console.log(`[납부 확인서 흐름] ${pass} 통과 / ${fail} 실패`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(1) })
