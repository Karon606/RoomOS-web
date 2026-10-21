// 납입일 변경 조정 행 통합 회귀. 실제 서버 액션을 메모리 PGlite 위에서 화면 호출 순서대로 돌린다. 실패 시 exit 1.
// 실행: npx tsx --tsconfig scripts/tsconfig.cash-receipt-flow.json scripts/test-due-day-adjust-flow.ts
//
// 왜(신고 df82ce57, 2026-10-20). 513호 추가납부 조정 행 −128,333 을 −130,000 으로 고치려다 일반 수정 문이 부호를 지워
// +130,000·완납·수단 '' 이 됐다. 진리표(scripts/test-due-day-adjust.ts)는 판정을, 여기는 문(서버 액션)과 순서를 지킨다.
//   · 일반 수정 문은 조정 행을 거절하고 일반 행 음수·기계 키 메모를 거절한다
//   · 조정 행 전용 문은 방향+양수로 부호를 붙이고, 적용취소가 바이트 그대로 되돌린다
//   · 남의 영업장 id·토큰으로는 아무것도 못 바꾼다
//   · 조정 행은 현금영수증 켜기·후보·실입금에서 빠진다
//   · 납입일 변경의 협의 금액 칸이 그 금액으로 조정 행을 만들고, 납입일 변경 적용취소가 그대로 덮는다
//   · 입주달에 납입일을 바꾼 뒤 그 달 수납을 지우고 다시 등록해도 같은 11일을 두 번 받지 않는다(S12, 운영자 승인 2026-10-20 방안 2)
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
  if (!ch.ok || !ch.undo) throw new Error('S1 변경 실패')
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
  // 던지지 않고 돌려준다(운영 빌드는 던진 문구를 가린다). 형제 문 넷과 같은 모양이다.
  eq('S2b 수납 등록이 기계 키 메모를 거절', await rooms.savePayment({ leaseTermId: L.id, tenantId: L.tenantId, targetMonth: '2026-10', expectedAmount: 350000, actualAmount: 1000, payDate: '2026-10-21', payMethod: '현금', memo: '[납입일변경] 1일→2 변경, 일할 1원 (과입금)' }), { ok: false, error: adj.PAYMENT_PREFIX_RESERVED })
  eq('S2b 보증금 받음 기록도 돌려준다', await rooms.recordDepositReceived(L.id, { amount: 50000, payDate: '2026-10-21', memo: '[납입일변경]' }), { ok: false, error: adj.PAYMENT_PREFIX_RESERVED })
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

  // ── S10 납입일 변경의 협의 금액 칸(승인 범위 C) ───────────────────────────
  const L3 = await lease(P1)
  await rec(L3, P1, { month: '2026-10', amount: 350000, pay: '2026-10-07' })
  const c1 = await tenants.changeDueDay(L3.id, '20', '2026-10', -128333, 130000)
  if (!c1.ok || !c1.undo) throw new Error('S10 변경 실패')
  const ca = await row(c1.undo.adjustRecordId!)
  eq('S10 협의 130,000 으로 조정 행 −130,000 · 메모에 규칙값과 협의값', [ca?.actualAmount, ca?.memo, ca?.payMethod], [-130000, '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 130,000원 (추가납부)', null])
  eq('S10 납부일 20 으로 바뀜', (await prisma.leaseTerm.findFirst({ where: { id: L3.id }, select: { dueDay: true } }))?.dueDay, '20')
  // 생성 뒤에 다시 고칠 수 있다(원단위 절삭은 수동, 운영자 요구 2026-10-20).
  const c2 = await rooms.updateDueDayAdjust(c1.undo.adjustRecordId!, { direction: 'extra', amount: 128330, note: '' })
  eq('S10 생성 뒤 수정도 된다(128,330)', [c2.ok, (await row(c1.undo.adjustRecordId!))?.memo], [true, '[납입일변경] 9일→20 변경, 일할 128,333원, 협의 128,330원 (추가납부)'])
  // 납입일 변경 적용취소가 협의 금액으로 만든 행까지 덮는다.
  const cu = await tenants.undoChangeDueDay(J(c1.undo))
  eq('S10 납입일 변경 적용취소 ok', cu.ok, true)
  // undoChangeDueDay 는 조정 행을 소프트삭제한다(독립 검수 2026-10-20, 종전 하드 삭제).
  const gone = await row(c1.undo.adjustRecordId!)
  eq('S10 조정 행 지워짐 · 납부일 9 로', [!!gone?.deletedAt, (await prisma.leaseTerm.findFirst({ where: { id: L3.id }, select: { dueDay: true } }))?.dueDay], [true, '9'])
  const c3 = await tenants.changeDueDay(L3.id, '20', '2026-10', -128333, 0)
  eq('S10 협의 0 거절', c3, { ok: false, error: adj.DUE_DAY_ADJUST_AMOUNT_INVALID })
  eq('S10 거절이면 납부일도 안 바뀜', (await prisma.leaseTerm.findFirst({ where: { id: L3.id }, select: { dueDay: true } }))?.dueDay, '9')
  const c4 = await tenants.changeDueDay(L3.id, '20', '2026-10', -128333, null)
  if (!c4.ok || !c4.undo) throw new Error('S10 변경 실패')
  eq('S10 협의 비우면 규칙값 그대로(종전과 같은 메모)', [(await row(c4.undo.adjustRecordId!))?.actualAmount, (await row(c4.undo.adjustRecordId!))?.memo], [-128333, '[납입일변경] 9일→20 변경, 일할 128,333원 (추가납부)'])

  // ── S11 납입일 변경 문 영업장 범위·서명 토큰·소프트삭제·완납 재계산(독립 검수 2026-10-20) ──────────
  {
    const L4 = await lease(P1)
    const PAID4 = await rec(L4, P1, { month: '2026-10', amount: 350000, pay: '2026-10-07' })
    g.__CR_FLOW_PID = P2
    eq('S11 남의 영업장 계약의 납부일 변경 거절', (await tenants.changeDueDay(L4.id, '20', '2026-10', -128333)).ok, false)
    g.__CR_FLOW_PID = P1
    eq('S11 거절 뒤 납부일 그대로', (await prisma.leaseTerm.findFirst({ where: { id: L4.id }, select: { dueDay: true } }))?.dueDay, '9')
    const c = await tenants.changeDueDay(L4.id, '20', '2026-10', -128333)
    if (!c.ok || !c.undo) throw new Error('S11 변경 실패')
    eq('S11 적용취소 토큰에 서명', typeof c.undo.sig, 'string')
    eq('S11 변경 뒤 형제 행 완납 표시 재계산(350,000 − 128,333 < 350,000 이라 조정 행 미완납)', [(await row(PAID4))?.isPaid, (await row(c.undo.adjustRecordId!))?.isPaid], [true, false])
    // 지어낸 토큰: 조정 행 id 를 다른 계약의 일반 수납으로 바꾸면 서명에서 떨어진다.
    eq('S11 조정 행 id 를 바꾼 토큰 거절', (await tenants.undoChangeDueDay({ ...J(c.undo), adjustRecordId: PAID4 })).ok, false)
    g.__CR_FLOW_PID = P2
    eq('S11 남의 영업장에서 적용취소 거절', (await tenants.undoChangeDueDay(J(c.undo))).ok, false)
    g.__CR_FLOW_PID = P1
    const u = await tenants.undoChangeDueDay(J(c.undo))
    const gone = await row(c.undo.adjustRecordId!)
    eq('S11 적용취소: 조정 행 소프트삭제 · 일반 수납 남음 · 납부일 9', [u.ok, !!gone?.deletedAt, !!(await row(PAID4)) && !(await row(PAID4))?.deletedAt, (await prisma.leaseTerm.findFirst({ where: { id: L4.id }, select: { dueDay: true } }))?.dueDay], [true, true, true, '9'])
    eq('S11 적용취소 뒤 그 달 완납 표시 재계산', (await row(PAID4))?.isPaid, true)
  }

  // ── S12 입주달 이중 셈(513 재현, 운영자 승인 2026-10-20 방안 2) ────────────────────────────
  // 10/9 입주·9일 납부·10월 350,000 수납·11월 350,000 선납. 10월에 납부일을 20일로 바꾸고(협의 130,000) 10월 수납을 지운 뒤
  // 다시 등록한다. 종전에는 락이 사라진 10월을 첫 달 규칙이 20일 기준 478,333 으로 세워 480,000 을 받아도 128,333 이 미납이었다.
  {
    const engine = await import('@/app/(app)/rooms/paymentEngine')
    const { unpaidForLease } = await import('@/lib/billing')
    const L5 = await lease(P1)
    const OCT = await rec(L5, P1, { month: '2026-10', amount: 350000, pay: '2026-10-07' })
    const NOV = await rec(L5, P1, { month: '2026-11', amount: 350000, pay: '2026-10-07' })
    const c = await tenants.changeDueDay(L5.id, '20', '2026-10', -128333, 130000)
    if (!c.ok || !c.undo) throw new Error('S12 변경 실패')
    eq('S12 락이 있는 동안 10월 청구 350,000', await engine.serverBillForMonth(L5.id, '2026-10', 0), 350000)
    const d = await rooms.deletePayment(OCT)
    eq('S12 10월 수납 삭제', d.ok, true)
    eq('S12 락이 사라져도 10월 청구 350,000(조정 행이 11일치를 센다)', await engine.serverBillForMonth(L5.id, '2026-10', 0), 350000)
    const opts = await rooms.getTargetMonthOptions(L5.id, '2026-10')
    eq('S12 귀속월 선택지 10월 청구 350,000 · 받은 돈 −130,000', opts.filter(o => o.month === '2026-10').map(o => [o.expectedAmount, o.paidAmount, o.status]), [[350000, -130000, 'unpaid']])
    const sp = await rooms.savePayment({ leaseTermId: L5.id, tenantId: L5.tenantId, targetMonth: '2026-10', expectedAmount: 350000, actualAmount: 480000, payDate: '2026-10-21', payMethod: '계좌이체', forcedTargetMonth: '2026-10' })
    eq('S12 재등록 480,000 은 10월에만 충당', sp.ok ? sp.allocations : sp.error, [{ targetMonth: '2026-10', amount: 480000 }])
    const recs = await prisma.paymentRecord.findMany({ where: { leaseTermId: L5.id }, select: { targetMonth: true, expectedAmount: true, actualAmount: true, isDeposit: true, isPrevOwner: true, isBillingAdjust: true } })
    eq('S12 재등록 행의 락 350,000(478,333 이 아니다)', recs.filter(r => r.targetMonth === '2026-10' && r.actualAmount === 480000).map(r => r.expectedAmount), [350000])
    eq('S12 미납 0(10월 350,000 = 480,000 − 130,000, 11월 선납 그대로)', unpaidForLease(recs), 0)
    eq('S12 11월 선납 행 그대로', [(await row(NOV))?.actualAmount, (await row(NOV))?.targetMonth, !!(await row(NOV))?.deletedAt], [350000, '2026-11', false])
    eq('S12 11월 청구 350,000', await engine.serverBillForMonth(L5.id, '2026-11', 0), 350000)
    // 조정 행을 지우면(납입일 변경 적용취소) 첫 달 규칙이 원천으로 돌아온다. 납부일도 9 로 돌아가 만월 그대로다.
    eq('S12 납입일 변경 적용취소', (await tenants.undoChangeDueDay(J(c.undo))).ok, true)
    eq('S12 적용취소 뒤 10월 청구 350,000(락)', await engine.serverBillForMonth(L5.id, '2026-10', 0), 350000)
  }

  // ── S13 납부일만 옮김(운영자 승인 2026-10-21, 504호 모양) ────────────────────────────────
  // 8/1 입주·납부일 1일·470,000. 납부일만 6일로 → 기간 1일 유지(cycleDay '1'), 조정 행 없음. 앞당기기 거절, 적용취소 원복,
  // 딸린 계약 전파, 폼 정규화(같은 날이면 칸 비움·기간 앞이면 거절), 그 뒤 '기간도 옮김' 은 기간 시작일 기준 일할.
  {
    const engine = await import('@/app/(app)/rooms/paymentEngine')
    const t = await prisma.tenant.create({ data: { name: '504', propertyId: P1 } })
    const room = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const sub = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const L6 = await prisma.leaseTerm.create({ data: { tenantId: t.id, propertyId: P1, roomId: room.id, rentAmount: 470000, dueDay: '1', moveInDate: day('2026-08-01'), status: 'ACTIVE' } })
    const S6 = await prisma.leaseTerm.create({ data: { tenantId: t.id, propertyId: P1, roomId: sub.id, rentAmount: 100000, dueDay: '1', moveInDate: day('2026-08-01'), status: 'NON_RESIDENT', parentLeaseTermId: L6.id } })
    const st = async (id: string) => J(await prisma.leaseTerm.findFirst({ where: { id }, select: { dueDay: true, cycleDay: true } }))
    const adjCount = async (id: string) => prisma.paymentRecord.count({ where: { leaseTermId: id, deletedAt: null, ...adj.dueDayAdjustWhere() } })
    eq('S13 납부일만 옮김에 일할 금액을 실으면 거절', (await tenants.changeDueDay(L6.id, '6', '2026-11', -78333, null, 'dueOnly')).ok, false)
    const c = await tenants.changeDueDay(L6.id, '6', '2026-11', 0, null, 'dueOnly')
    if (!c.ok || !c.undo) throw new Error('S13 변경 실패')
    eq('S13 납부일 6 · 기간 1 · 조정 행 없음', [await st(L6.id), await adjCount(L6.id)], [{ dueDay: '6', cycleDay: '1' }, 0])
    eq('S13 딸린 계약도 같이(납부일 6 · 기간 1)', await st(S6.id), { dueDay: '6', cycleDay: '1' })
    eq('S13 11월 청구 470,000', await engine.serverBillForMonth(L6.id, '2026-11', 0), 470000)
    eq('S13 적용취소 토큰에 서명·바꾸기 전 기간 칸', [typeof c.undo.sig, c.undo.prevCycleDay], ['string', null])
    eq('S13 지어낸 토큰(바꾸기 전 기간 칸 변조) 거절', (await tenants.undoChangeDueDay({ ...J(c.undo), prevCycleDay: '9' })).ok, false)
    const u = await tenants.undoChangeDueDay(J(c.undo))
    eq('S13 적용취소: 납부일 1 · 기간 칸 비움 · 딸린 계약도', [u.ok, await st(L6.id), await st(S6.id)], [true, { dueDay: '1', cycleDay: null }, { dueDay: '1', cycleDay: null }])
    const c2 = await tenants.changeDueDay(L6.id, '6', '2026-11', 0, null, 'dueOnly')
    if (!c2.ok) throw new Error('S13 재변경 실패')
    eq('S13 같은 값 다시 옮기기는 동일 안내', (await tenants.changeDueDay(L6.id, '6', '2026-11', 0, null, 'dueOnly')).ok, false)
    // 기간 20일 계약에서 납부일만 5일로(기간보다 앞) — 거절
    const T7 = await prisma.tenant.create({ data: { name: '앞당김', propertyId: P1 } })
    const R7 = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const L7 = await prisma.leaseTerm.create({ data: { tenantId: T7.id, propertyId: P1, roomId: R7.id, rentAmount: 300000, dueDay: '20', moveInDate: day('2026-08-20'), status: 'ACTIVE' } })
    const early = await tenants.changeDueDay(L7.id, '5', '2026-11', 0, null, 'dueOnly')
    eq('S13 기간보다 앞(20일 기간·납부 5일) 거절', [early.ok, early.ok ? '' : early.error, await st(L7.id)], [false, (await import('@/lib/dueDay')).dueOnlyEarlierRefused('20'), { dueDay: '20', cycleDay: null }])
    // 기간 시작과 같은 날로 돌리면 칸을 비운다
    const back = await tenants.changeDueDay(L6.id, '1', '2026-11', 0, null, 'dueOnly')
    eq('S13 기간 시작과 같은 날로 되돌리면 칸 비움', [back.ok, await st(L6.id)], [true, { dueDay: '1', cycleDay: null }])
    await tenants.changeDueDay(L6.id, '6', '2026-11', 0, null, 'dueOnly')
    // 기간도 옮김(기간 1일에서 6일) — 일할 옛 값은 기간 시작일(1일). 조정 행 메모 '1일→6', 기간 칸 비움.
    const c3 = await tenants.changeDueDay(L6.id, '6', '2026-11', -78333, null, 'cycle')
    if (!c3.ok || !c3.undo) throw new Error('S13 기간도 옮김 실패')
    eq('S13 기간도 옮김: 납부일 6 · 칸 비움 · 조정 행 메모 1일→6', [await st(L6.id), (await row(c3.undo.adjustRecordId!))?.memo], [{ dueDay: '6', cycleDay: null }, '[납입일변경] 1일→6 변경, 일할 78,333원 (추가납부)'])
    eq('S13 딸린 계약도 기간 칸 비움', await st(S6.id), { dueDay: '6', cycleDay: null })
    const u3 = await tenants.undoChangeDueDay(J(c3.undo))
    eq('S13 기간도 옮김 적용취소: 납부일 6 · 기간 1 복원 · 조정 행 지움', [u3.ok, await st(L6.id), await st(S6.id), await adjCount(L6.id)], [true, { dueDay: '6', cycleDay: '1' }, { dueDay: '6', cycleDay: '1' }, 0])
  }

  // ── S14 일괄 수정(독립 검수 2026-10-21) ─ 기간 칸 판정이 모든 쓰기 앞, 적용취소는 서명·허용 칸 ────────────────
  {
    const T = await prisma.tenant.create({ data: { name: '일괄', propertyId: P1, nationality: '한국' } })
    const R = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const L = await prisma.leaseTerm.create({ data: { tenantId: T.id, propertyId: P1, roomId: R.id, rentAmount: 300000, dueDay: '25', cycleDay: '20', moveInDate: day('2026-08-20'), status: 'ACTIVE' } })
    const st = async () => J(await prisma.leaseTerm.findFirst({ where: { id: L.id }, select: { dueDay: true, cycleDay: true } }))
    const nat = async () => (await prisma.tenant.findFirst({ where: { id: T.id }, select: { nationality: true } }))?.nationality
    const bad = await tenants.batchUpdateTenants([T.id], { nationality: '베트남', dueDay: '5' })
    eq('S14 기간 20 계약을 일괄로 납부일 5 는 거절 · 국적도 안 바뀜', [bad.ok, await nat(), await st()], [false, '한국', { dueDay: '25', cycleDay: '20' }])
    const ok = await tenants.batchUpdateTenants([T.id], { nationality: '베트남', dueDay: '20' })
    if (!ok.ok || !ok.undo) throw new Error('S14 일괄 실패')
    eq('S14 기간 시작과 같은 날이면 칸을 비움', [await nat(), await st()], ['베트남', { dueDay: '20', cycleDay: null }])
    eq('S14 적용취소 토큰 서명', typeof ok.undo.sig, 'string')
    const forged = J(ok.undo); forged.leases[0].fields.rentAmount = 1
    eq('S14 허용 밖 칸(rentAmount)을 실은 토큰 거절', (await tenants.undoBatchUpdateTenants(forged)).ok, false)
    const forged2 = J(ok.undo); forged2.leases[0].fields.dueDay = '1'
    eq('S14 값을 바꾼 토큰은 서명에서 거절', (await tenants.undoBatchUpdateTenants(forged2)).ok, false)
    const u = await tenants.undoBatchUpdateTenants(J(ok.undo))
    eq('S14 적용취소: 국적·납부일·기간 칸 원복', [u.ok, await nat(), await st()], [true, '한국', { dueDay: '25', cycleDay: '20' }])
  }

  // ── S15 기간도 옮김의 일할은 서버가 DB 값으로 다시 잰다(임시 조정이 걸린 달) ──────────────────────────
  {
    const T = await prisma.tenant.create({ data: { name: '임시', propertyId: P1 } })
    const R = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    // 납부일 1일, 11월만 임시로 10일. 화면은 임시일(10)을 지금 납부일로 읽어 10→6 을 '4일 앞당김(돌려줄 62,666)' 으로 보냈다.
    const L = await prisma.leaseTerm.create({ data: { tenantId: T.id, propertyId: P1, roomId: R.id, rentAmount: 470000, dueDay: '1', overrideDueDay: '10', overrideDueDayMonth: '2026-11', moveInDate: day('2026-08-01'), status: 'ACTIVE' } })
    const c = await tenants.changeDueDay(L.id, '6', '2026-11', 62666, null, 'cycle')
    if (!c.ok || !c.undo) throw new Error('S15 변경 실패')
    const r = await row(c.undo.adjustRecordId!)
    eq('S15 서버가 1일→6 으로 다시 잼(추가로 받을 78,333)', [r?.actualAmount, r?.memo], [-78333, '[납입일변경] 1일→6 변경, 일할 78,333원 (추가납부)'])
    eq('S15 화면 값과 달랐다는 안내', /다시 잰 78,333원/.test(c.notice ?? ''), true)
    const u = await tenants.undoChangeDueDay(J(c.undo))
    eq('S15 적용취소', u.ok, true)
    const c2 = await tenants.changeDueDay(L.id, '6', '2026-11', -78333, null, 'cycle')
    eq('S15 맞는 값을 보내면 안내 없음', c2.ok ? (c2.notice ?? '') : 'fail', '')
  }

  // ── S16 딸린 계약은 부모와 같은 납부일이면 부모의 기간 칸을 물려받는다(신규·부모 붙이는 수정) ──────────────
  {
    const dueLib = await import('@/lib/dueDay')
    const T = await prisma.tenant.create({ data: { name: '부모', propertyId: P1 } })
    const R = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const R2 = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const parent = await prisma.leaseTerm.create({ data: { tenantId: T.id, propertyId: P1, roomId: R.id, rentAmount: 470000, dueDay: '6', cycleDay: '1', moveInDate: day('2026-08-01'), status: 'ACTIVE' } })
    eq('S16 판정: 같은 납부일이면 부모 칸', await dueLib.inheritedCycleDay(prisma, parent.id, '6'), '1')
    eq('S16 판정: 다른 납부일이면 없음', await dueLib.inheritedCycleDay(prisma, parent.id, '10'), null)
    eq('S16 판정: 부모 없으면 없음', await dueLib.inheritedCycleDay(prisma, null, '6'), null)
    const fd = new FormData()
    fd.set('tenantId', T.id); fd.set('roomId', R2.id); fd.set('status', 'NON_RESIDENT'); fd.set('rentAmount', '100000')
    fd.set('dueDay', '6'); fd.set('moveInDate', '2026-08-01'); fd.set('parentLeaseTermId', parent.id)
    const add = await tenants.addLeaseToTenant(fd)
    const child = await prisma.leaseTerm.findFirst({ where: { parentLeaseTermId: parent.id }, select: { dueDay: true, cycleDay: true } })
    eq('S16 신규 딸린 계약(부모와 같음)이 기간 칸 1 을 물려받음', [add.ok ? 'ok' : add.error, J(child)], ['ok', { dueDay: '6', cycleDay: '1' }])
  }

  // ── S17 계약서 문 납부일(setDueDayForContract)도 같은 판정 ─────────────────────────────────────────
  {
    const share = await import('@/app/(app)/tenants/contractShare')
    const T = await prisma.tenant.create({ data: { name: '계약서', propertyId: P1 } })
    const R = await prisma.room.create({ data: { roomNo: `${++roomSeq}`, propertyId: P1 } })
    const L = await prisma.leaseTerm.create({ data: { tenantId: T.id, propertyId: P1, roomId: R.id, rentAmount: 300000, dueDay: '25', cycleDay: '20', moveInDate: day('2026-08-20'), status: 'ACTIVE' } })
    const st = async () => J(await prisma.leaseTerm.findFirst({ where: { id: L.id }, select: { dueDay: true, cycleDay: true } }))
    const bad = await share.setDueDayForContract(L.id, '5')
    eq('S17 기간보다 앞 거절', [bad.ok, await st()], [false, { dueDay: '25', cycleDay: '20' }])
    const same = await share.setDueDayForContract(L.id, '20')
    eq('S17 기간 시작과 같은 날이면 칸 비움', [same.ok, await st()], [true, { dueDay: '20', cycleDay: null }])
  }

  console.log(`[납입일 변경 조정 통합] 통과 ${pass} / 실패 ${fail}`)
  await prisma.$disconnect()
  await server.stop()
  await pg.close()
  process.exit(fail > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
