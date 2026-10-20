// 납입일 변경 조정 행 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 화면 호출 순서대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-due-day-adjust-flow.ts
//
// 왜(신고 df82ce57, 2026-10-20). 513호 추가납부 조정 행 −128,333 을 −130,000 으로 고치려다 일반 수정 문이 부호를 지워
// +130,000·완납·수단 '' 이 됐다. 진리표(scripts/test-due-day-adjust.ts)는 판정을, 여기는 문(서버 액션)과 순서를 지킨다.
//   · 일반 수정 문은 조정 행을 거절하고 일반 행 음수·기계 키 메모를 거절한다
//   · 조정 행 전용 문은 방향+양수로 부호를 붙이고, 적용취소가 바이트 그대로 되돌린다
//   · 남의 영업장 id·토큰으로는 아무것도 못 바꾼다
//   · 조정 행은 현금영수증 켜기·후보·실입금에서 빠진다
//
// 운영 DB 에는 절대 붙지 않는다(scripts/cr-flow-prisma-stub.ts 가 하네스 주소가 아니면 거부한다).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import path from 'node:path'

const ROOT = path.resolve(__dirname, '..')
const PORT = 56000 + Math.floor(Math.random() * 900)
const URL = `postgresql://postgres:postgres@127.0.0.1:${PORT}/postgres`
process.env.CR_FLOW_DATABASE_URL = URL
process.env.DATABASE_URL = URL
process.env.DIRECT_URL = URL
// 적용취소 토큰 서명 키. 하네스 전용 값. 운영 키와 무관하다.
process.env.STAYEUM_PII_KEY = Buffer.alloc(32, 0x5d).toString('base64')

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want)
  if (g === w) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${w}\n    실제 ${g}`)
}
const J = <T>(x: T): T => JSON.parse(JSON.stringify(x))   // 화면을 거쳐 돌아오는 값처럼 직렬화한다
const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)

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
  const rooms = await import('@/app/(app)/rooms/actions')
  const tenants = await import('@/app/(app)/tenants/actions')
  const adj = await import('@/lib/dueDayAdjust')
  const crl = await import('@/app/(app)/rooms/cashReceiptLine')
  const { rentPaidWhere } = await import('@/lib/rentPaid')
  const g = globalThis as unknown as { __CR_FLOW_PID?: string }

  const P1 = randomUUID(), P2 = randomUUID(), OWNER = randomUUID()
  await prisma.property.create({ data: { id: P1, name: '하네스 1', ownerId: OWNER } })
  await prisma.property.create({ data: { id: P2, name: '하네스 2', ownerId: OWNER } })
  let roomSeq = 500
  // 513호와 같은 모양. 10/9 입주·납부일 9일·이용료 350,000.
  async function lease(pid: string) {
    const t = await prisma.tenant.create({ data: { name: '입주자', propertyId: pid } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: pid } })
    const l = await prisma.leaseTerm.create({
      data: { tenantId: t.id, propertyId: pid, roomId: room.id, rentAmount: 350000, dueDay: '9', moveInDate: day('2026-10-09'), status: 'ACTIVE' },
    })
    return { id: l.id as string, tenantId: t.id as string }
  }
  let seq = 0
  async function rec(l: { id: string; tenantId: string }, pid: string, o: { month: string; amount: number; pay: string; method?: string | null; memo?: string | null; expected?: number; isPaid?: boolean }) {
    const r = await prisma.paymentRecord.create({
      data: {
        leaseTermId: l.id, tenantId: l.tenantId, propertyId: pid, targetMonth: o.month,
        expectedAmount: o.expected ?? 350000, actualAmount: o.amount, payDate: day(o.pay), payMethod: o.method === undefined ? '계좌이체' : o.method,
        seqNo: ++seq, memo: o.memo ?? null, isPaid: o.isPaid ?? o.amount >= 350000,
      },
    })
    return r.id as string
  }
  const row = async (id: string) => {
    const r = await prisma.paymentRecord.findFirst({
      where: { id, deletedAt: undefined },
      select: { actualAmount: true, memo: true, payMethod: true, payDate: true, targetMonth: true, seqNo: true, isPaid: true, cashReceiptIssuedAt: true, deletedAt: true, expectedAmount: true },
    })
    return r ? J(r) : null
  }
  const monthPaid = async (leaseId: string, month: string) =>
    (await prisma.paymentRecord.findMany({ where: { leaseTermId: leaseId, targetMonth: month, isDeposit: false }, select: { actualAmount: true } }))
      .reduce((s: number, r: { actualAmount: number }) => s + r.actualAmount, 0)

  g.__CR_FLOW_PID = P1
  const L = await lease(P1)
  const PAID = await rec(L, P1, { month: '2026-10', amount: 350000, pay: '2026-10-07' })

  // ── S1 납입일 변경이 만든 조정 행(규칙값 그대로) ──────────────────────────
  const ch = await tenants.changeDueDay(L.id, '20', '2026-10', -128333)
  if (!ch.ok) throw new Error(ch.error)
  const ADJ = ch.undo.adjustRecordId!
  const created = await row(ADJ)
  eq('S1 조정 행 −128,333 · 메모 종전 글자 · 수단 없음', [created?.actualAmount, created?.memo, created?.payMethod], [-128333, '[납입일변경] 9일→20 변경, 일할 128,333원 (추가납부)', null])
  eq('S1 10월 수납 합 221,667(추가로 받을 128,333 이 미납으로 남는다)', await monthPaid(L.id, '2026-10'), 221667)

  // ── S2 일반 수정 문은 조정 행을 거절한다(신고 그대로의 조작) ───────────────
  const before = await row(ADJ)
  const u1 = await rooms.updatePayment(ADJ, { actualAmount: 130000, payDate: '2026-10-20', payMethod: '', memo: created!.memo!, targetMonth: '2026-10' })
  eq('S2 조정 행에 130000 저장은 거절', u1, { ok: false, error: adj.DUE_DAY_ADJUST_EDIT_ELSEWHERE })
  eq('S2 거절 뒤 행 그대로', await row(ADJ), before)
  const u2 = await rooms.updatePayment(ADJ, { actualAmount: -128333, payDate: '2026-10-20', payMethod: '', memo: '13만원 협의' })
  eq('S2 조정 행 메모 앞머리 지우기도 거절', u2, { ok: false, error: adj.DUE_DAY_ADJUST_EDIT_ELSEWHERE })
  const u3 = await rooms.updatePayment(PAID, { actualAmount: -1, payDate: '2026-10-07', payMethod: '계좌이체' })
  eq('S2 일반 행 음수 거절', u3, { ok: false, error: adj.PAYMENT_NEGATIVE_REFUSED })
  const u4 = await rooms.updatePayment(PAID, { actualAmount: 350000, payDate: '2026-10-07', payMethod: '계좌이체', memo: '[납입일변경] 1일→2 변경, 일할 1원 (과입금)' })
  eq('S2 일반 행에 기계 키 메모 거절', u4, { ok: false, error: adj.PAYMENT_PREFIX_RESERVED })
  eq('S2 일반 행 그대로', (await row(PAID))?.actualAmount, 350000)

  // ── S2b 수납 생성 문도 기계 키 메모를 거절한다(일반 수납이 조정 행이 되는 길) ─────────────
  let regErr = ''
  try { await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: '2026-10', expectedAmount: 350000, actualAmount: 1000, payDate: '2026-10-21', payMethod: '현금', memo: '[납입일변경] 1일→2 변경, 일할 1원 (과입금)' }) }
  catch (e) { regErr = (e as Error).message }
  eq('S2b 수납 등록이 기계 키 메모를 거절', regErr, adj.PAYMENT_PREFIX_RESERVED)
  eq('S2b 보증금 수납도 거절', await rooms.saveDepositPayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: '2026-10', depositAmount: 50000, rentAmount: 350000, totalPaid: 50000, payDate: '2026-10-21', payMethod: '현금', memo: '보증금 [납입일변경]' }), { ok: false, error: adj.PAYMENT_PREFIX_RESERVED })
  eq('S2b 보증금 계약 단위 수납도 거절', await rooms.saveDepositPaymentForLease({ leaseTermId: L.id, amount: 50000, payDate: '2026-10-21', payMethod: '현금', memo: '[납입일변경]' } as Parameters<typeof rooms.saveDepositPaymentForLease>[0]), { ok: false, error: adj.PAYMENT_PREFIX_RESERVED })
  eq('S2b 거절 뒤 10월 수납 합 그대로', await monthPaid(L.id, '2026-10'), 221667)

  // ── S3 현금영수증 켜기·미리보기 거절 ────────────────────────────────────
  eq('S3 조정 행 켜기 거절', await rooms.setCashReceiptIssued(ADJ, true, '2026-10-20'), { ok: false, error: adj.DUE_DAY_ADJUST_CR_REFUSED })
  eq('S3 조정 행 미리보기 거절', await rooms.previewCashReceiptOn(ADJ), { ok: false, error: adj.DUE_DAY_ADJUST_CR_REFUSED })

  // ── S4 전용 문: 추가로 받을 금액 130000 은 −130,000 ─────────────────────
  const e1 = await rooms.updateDueDayAdjust(ADJ, { direction: 'extra', amount: 130000, note: '' })
  if (!e1.ok) throw new Error(e1.error)
  const after1 = await row(ADJ)
  eq('S4 −130,000 저장 · 메모에 규칙값과 협의값', [after1?.actualAmount, after1?.memo], [-130000, '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)'])
  eq('S4 납부일·귀속월·회차 그대로', [after1?.payDate, after1?.targetMonth, after1?.seqNo], [before?.payDate, before?.targetMonth, before?.seqNo])
  eq('S4 10월 수납 합 220,000', await monthPaid(L.id, '2026-10'), 220000)
  eq('S4 적용취소 토큰이 있다(서명 키 하네스 값)', !!e1.undo?.sig, true)

  // ── S5 적용취소는 바이트 그대로, 두 번은 안 된다 ─────────────────────────
  const r1 = await rooms.undoPaymentEdit(J(e1.undo!))
  eq('S5 적용취소 ok', r1.ok, true)
  eq('S5 행이 수정 전과 바이트 동일', await row(ADJ), before)
  eq('S5 10월 수납 합 221,667 으로 복귀', await monthPaid(L.id, '2026-10'), 221667)
  const r2 = await rooms.undoPaymentEdit(J(e1.undo!))
  eq('S5 두 번째 적용취소는 거절', r2.ok, false)

  // ── S6 돌려줄 금액 · 설명 ─────────────────────────────────────────────
  const e2 = await rooms.updateDueDayAdjust(ADJ, { direction: 'refund', amount: 128333, note: '방향 정정' })
  if (!e2.ok) throw new Error(e2.error)
  eq('S6 돌려줄 금액은 양수 · 규칙값 그대로라 협의 조각 없음 · 설명만 붙음', [(await row(ADJ))?.actualAmount, (await row(ADJ))?.memo], [128333, '[납입일변경] 9일→20 변경, 일할 128,333원 (과입금) 방향 정정'])
  eq('S6 적용취소', (await rooms.undoPaymentEdit(J(e2.undo!))).ok, true)
  eq('S6 원상', await row(ADJ), before)

  // ── S7 거절 갈래 ────────────────────────────────────────────────────
  eq('S7 0원 거절', await rooms.updateDueDayAdjust(ADJ, { direction: 'extra', amount: 0, note: '' }), { ok: false, error: adj.DUE_DAY_ADJUST_AMOUNT_INVALID })
  eq('S7 자릿수 실수 거절', await rooms.updateDueDayAdjust(ADJ, { direction: 'extra', amount: 1300000, note: '' }), { ok: false, error: adj.dueDayAdjustOverCap(350000) })
  eq('S7 일반 행은 전용 문 거절', await rooms.updateDueDayAdjust(PAID, { direction: 'extra', amount: 1, note: '' }), { ok: false, error: adj.DUE_DAY_ADJUST_NOT_ADJUST })
  eq('S7 거절 뒤 원상', await row(ADJ), before)

  // ── S8 남의 영업장 ──────────────────────────────────────────────────
  const e3 = await rooms.updateDueDayAdjust(ADJ, { direction: 'extra', amount: 130000, note: '' })
  if (!e3.ok) throw new Error(e3.error)
  const mid = await row(ADJ)
  g.__CR_FLOW_PID = P2
  eq('S8 남의 영업장에서 전용 문 거절', await rooms.updateDueDayAdjust(ADJ, { direction: 'refund', amount: 1, note: '' }), { ok: false, error: '수납 기록을 찾을 수 없습니다.' })
  eq('S8 남의 영업장에서 적용취소 거절', (await rooms.undoPaymentEdit(J(e3.undo!))).ok, false)
  eq('S8 남의 영업장에서 일반 수정 문도 거절', (await rooms.updatePayment(ADJ, { actualAmount: 1, payDate: '2026-10-20', payMethod: '' })).ok, false)
  g.__CR_FLOW_PID = P1
  eq('S8 행은 그대로', await row(ADJ), mid)
  // 지어낸 토큰(금액을 +130,000 으로 바꾼 '전' 값)은 서명에서 떨어진다.
  const forged = J(e3.undo!)
  forged.before.actualAmount = 130000
  eq('S8 위조 토큰 거절', (await rooms.undoPaymentEdit(forged)).ok, false)
  // 조정 행 토큰의 '전' 메모에서 기계 키를 떼면(조정 행을 일반 행으로 만드는 뒷문) 거절.
  const stripped = J(e3.undo!)
  stripped.before.memo = '13만원 협의'
  eq('S8 기계 키를 뗀 토큰 거절', (await rooms.undoPaymentEdit(stripped)).ok, false)
  // 서명이 맞아도(키 미등록 개발 DB 는 서명 대조를 건너뛴다) 기계 키를 떼고 양수로 바꾼 '전' 값으로는 조정 행을 일반 행으로 못 돌린다.
  const resigned = crl.signPaymentEditUndo(P1, { ...J(e3.undo!), sig: undefined, before: { ...J(e3.undo!).before, memo: '13만원 협의', actualAmount: 128333 } })
  eq('S8 서명이 맞아도 기계 키를 뗀 토큰은 거절', (await rooms.undoPaymentEdit(J(resigned!))).ok, false)
  eq('S8 진짜 토큰은 통과', (await rooms.undoPaymentEdit(J(e3.undo!))).ok, true)
  eq('S8 원상', await row(ADJ), before)

  // ── S9 513호처럼 부호가 뒤집힌 행(+130,000·수단 '') 을 전용 문으로 바로잡고 적용취소 ──────────
  const L2 = await lease(P1)
  await rec(L2, P1, { month: '2026-10', amount: 350000, pay: '2026-10-07' })
  const BROKEN = await rec(L2, P1, { month: '2026-10', amount: 130000, pay: '2026-10-20', method: '', memo: '[납입일변경] 9일→20 변경, 일할 128,333원 (추가납부)', expected: 0, isPaid: true })
  const brokenBefore = await row(BROKEN)
  // 고치기 전: 부호가 뒤집힌 조정 행은 실입금·현금영수증 후보에서 빠진다(A5).
  eq('S9 실입금 판정에서 뒤집힌 조정 행 제외(정상 수납 1건만)', await prisma.paymentRecord.count({ where: { propertyId: P1, ...rentPaidWhere('2026-10', [L2.id]) } }), 1)
  const tab = await rooms.getCashReceiptTabRows('2026-10')
  eq("S9 수단 '' 조정 행은 현금영수증 후보가 아니다", tab.candidates.filter(c => c.leaseTermId === L2.id).map(c => [c.payYmd, c.payMethod, c.issuable]), [['2026-10-07', '계좌이체', 350000]])
  eq('S9 감사 축이 잡는다', adj.dueDayAdjustSignMismatch({ memo: brokenBefore!.memo, actualAmount: brokenBefore!.actualAmount }), '메모는 추가납부인데 금액이 +130,000원입니다')
  const e4 = await rooms.updateDueDayAdjust(BROKEN, { direction: 'extra', amount: 130000, note: '' })
  if (!e4.ok) throw new Error(e4.error)
  const fixed = await row(BROKEN)
  eq('S9 −130,000 · 수단 비움 · 메모 규칙+협의', [fixed?.actualAmount, fixed?.payMethod, fixed?.memo], [-130000, null, '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)'])
  eq('S9 감사 축 해소', adj.dueDayAdjustSignMismatch({ memo: fixed!.memo, actualAmount: fixed!.actualAmount }), null)
  eq('S9 10월 수납 합 220,000', await monthPaid(L2.id, '2026-10'), 220000)
  eq('S9 적용취소', (await rooms.undoPaymentEdit(J(e4.undo!))).ok, true)
  eq("S9 원상(+130,000·수단 '') 바이트 동일", await row(BROKEN), brokenBefore)
  // 부호가 뒤집힌 조정 행(양수)을 가리키는, 서명은 맞는 토큰으로 기계 키를 떼려 하면 거절(조정 행 여부는 적용취소로 못 바꾼다).
  const cur9 = { actualAmount: 130000, payYmd: '2026-10-20', payMethod: '', memo: brokenBefore!.memo, targetMonth: '2026-10', seqNo: brokenBefore!.seqNo }
  const strip9 = crl.signPaymentEditUndo(P1, { paymentId: BROKEN, before: { ...cur9, memo: '13만원 협의', actualAmount: 1 }, after: cur9, cr: { v: 1, keys: [], lines: [], stamps: [] } })
  eq('S9 서명이 맞아도 조정 행의 기계 키를 떼는 적용취소는 거절', (await rooms.undoPaymentEdit(J(strip9!))).ok, false)
  eq('S9 거절 뒤 그대로', await row(BROKEN), brokenBefore)

  console.log(`[납입일 변경 조정 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
