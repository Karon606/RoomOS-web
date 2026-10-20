// 513호 납입일 변경 조정 행(부호가 뒤집힌 +130,000)을 추가납부 −130,000 으로 되돌리고 현금 150,000원 수납을 FIFO 로 기록하는 일회성 정정. 예행 기본, --apply 적용, --revert <파일> 되돌림
//
// 왜(신고 df82ce57, 2026-10-20). 10-20 02:20 납부일 9일에서 20일 변경이 조정 행 −128,333 을 만들었고, 02:54 운영자가
// −130,000 으로 고치려다 일반 수정 폼이 부호를 지워 +130,000·완납·수단 '' 이 됐다. 생성 경로는 이번 묶음이 막았다
// (updatePayment 가 조정 행을 거절, 조정 행 전용 문, 감사 규칙 9 가 재발을 잡는다). 남은 것은 이 한 행의 값과 그날 받은 현금이다.
//
// 운영자 사실(2026-10-20 답). 그날 현금 200,000원을 받았고 그중 50,000원은 이미 보증금으로 기록했다. 남은 150,000원은
// 일할 협의 130,000원 + 선납 20,000원이다. 일할은 규칙값 128,333원이 아니라 130,000원으로 협의했다.
// 기본값이 그 숫자다. 다르면 인자로 바꾼다(--agreed 130000 --cash 150000 --pay-date 2026-10-20 --method 현금).
//
// 하는 일.
//   ① 조정 행 87cda0c6 을 −{협의}원 · 메모 '…일할 128,333원, 협의 130,000원 (추가납부)' · 수단 null 로(조정 행 규칙, lib/dueDayAdjust).
//      현금영수증 도장은 지금 없음을 확인만 하고 안 건드린다. 납부일·귀속월·회차는 그대로다.
//   ② 현금 {cash}원을 앱 수납 등록(savePayment)과 같은 FIFO 로 나눠 기록한다. 가장 오래된 미수월부터 그 달 청구까지 채우고
//      남는 돈은 다음 달 선납이다. 기본값이면 10월 130,000원 + 11월 20,000원('2026년 10월분 채우고 남은 금액').
//   ③ 손댄 달의 완납 표시(isPaid)를 앱 재계산(recalculatePayments)과 같은 식으로 다시 매긴다.
// 504호(계약 7977970b)는 손대지 않는다(운영자 확인 중).
//
// 안전장치. 대상은 id 로 찾되 영업장·호실·지금 값(+130,000·메모 글자·수단 '')이 신고 그대로인지 확인하고, 하나라도 다르면 멈춘다.
// 예행은 READ ONLY 트랜잭션이라 쓰기가 구조로 막힌다. 적용·되돌리기는 Serializable 한 트랜잭션이고 쓰기 직전 다시 확인한다.
// 되돌리기는 지금 값이 적용 직후 값과 같을 때만 적용 전으로 돌린다(그 사이 앱에서 고쳤으면 멈춘다). 만든 수납에 현금영수증
// 도장이 있거나 그 키에 살아 있는 발행 줄이 있으면 멈춘다(지우면 줄이 고아가 된다). 만든 수납은 앱처럼 소프트삭제한다.
//
// 실행: npx tsx --env-file=.env.local scripts/fix-dueday-adjust-513.ts [--agreed N] [--cash N] [--pay-date YYYY-MM-DD] [--method 현금] [--apply | --revert <undo.json>]
import fs from 'node:fs'
import { randomUUID } from 'node:crypto'
import { PrismaClient, Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { billForLeaseMonth, isAfterMoveOutMonth, resolveDueDateForMonth } from '../lib/billing'
import { attachDueDayAdjustsOne, buildDueDayAdjustMemo, dueDayAdjustSignMismatch, parseDueDayAdjustMemo } from '../lib/dueDayAdjust'
import { kstYmdStr, ymdToDbDate } from '../lib/kstDate'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
type Tx = Prisma.TransactionClient

const LEASE_ID = '71af473e-3969-4f50-87fe-20e658f65a91'
const ADJ_ID = '87cda0c6-b677-47fb-8f63-bafaffb32935'
const ROOM_NO = '513'
// 신고 시점 값. 이것과 다르면 멈춘다.
const BROKEN = { actualAmount: 130000, memo: '[납입일변경] 9일→20 변경, 일할 128,333원 (추가납부)', payMethod: '', targetMonth: '2026-10' }

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}
const AGREED = Number(arg('--agreed', '130000'))
const CASH = Number(arg('--cash', '150000'))
const PAY_YMD = arg('--pay-date', '2026-10-20')
const METHOD = arg('--method', '현금')
const won = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toLocaleString('en-US')}원`
const nextMonth = (m: string) => { const [y, mm] = m.split('-').map(Number); const d = new Date(Date.UTC(y, mm, 1)); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}` }
const monthOf = (d: Date) => kstYmdStr(d).slice(0, 7)

type Rec = { id: string; targetMonth: string; actualAmount: number; expectedAmount: number; isPrevOwner: boolean; payDate: Date; seqNo: number; isPaid: boolean }
type NewRec = { id: string; targetMonth: string; expectedAmount: number; actualAmount: number; memo: string | null; seqNo: number }
type Plan = {
  propertyId: string; tenantId: string
  adjAfter: { actualAmount: number; memo: string; payMethod: null }
  /** 조정 행이 지워져 있었으면 그 시각(되살리고, 되돌리기 때 다시 지운다). 살아 있었으면 null. */
  adjDeletedAt: string | null
  creates: NewRec[]
  isPaid: { id: string; before: boolean; after: boolean }[]
  months: { month: string; bill: number; paidBefore: number; paidAfter: number }[]
  nextDue: { ymd: string | null; owed: number; month: string }
  depositCash: number
}

async function plan(tx: Tx): Promise<Plan> {
  if (!Number.isInteger(AGREED) || AGREED <= 0) throw new Error(`협의 금액 ${AGREED} 이 1원 이상의 정수가 아니라 멈춘다`)
  if (!Number.isInteger(CASH) || CASH <= 0) throw new Error(`현금 ${CASH} 이 1원 이상의 정수가 아니라 멈춘다`)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(PAY_YMD)) throw new Error(`납부일 ${PAY_YMD} 모양이 아니라 멈춘다`)
  // 조정 행은 청구 엔진의 입력이다(입주달 첫 달 규칙, lib/dueDayAdjust 정본). 엔진은 빠뜨리면 멈춘다.
  const lease = await attachDueDayAdjustsOne(tx as never, await tx.leaseTerm.findFirst({
    where: { id: LEASE_ID },
    select: {
      id: true, propertyId: true, tenantId: true, status: true, rentAmount: true, dueDay: true, moveInDate: true, expectedMoveOut: true, isShortTerm: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { roomNo: true, scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
    },
  }))
  if (!lease || lease.room?.roomNo !== ROOM_NO) throw new Error('대상 계약이 513호가 아니라 멈춘다')
  if (lease.dueDay !== '20') throw new Error(`납부일이 '20' 이 아니라(${lease.dueDay}) 멈춘다`)
  if (AGREED > lease.rentAmount) throw new Error(`협의 금액이 이용료(${won(lease.rentAmount)})보다 커서 멈춘다`)
  // 2026-10-20 22:47 운영자가 옛 화면에서 이 행을 지웠다(소프트삭제, 그래서 받을 돈까지 사라졌다). 지워진 상태도 받아 되살린다.
  const adj = await tx.paymentRecord.findFirst({
    where: { id: ADJ_ID, leaseTermId: LEASE_ID, propertyId: lease.propertyId },
    select: {
      actualAmount: true, memo: true, payMethod: true, targetMonth: true, isDeposit: true, isBillingAdjust: true, cashReceiptIssuedAt: true,
      deletedAt: true, expectedAmount: true, isPrevOwner: true, payDate: true, seqNo: true, isPaid: true,
    },
  })
  if (!adj) throw new Error('조정 행이 없어 멈춘다')
  const same = adj.actualAmount === BROKEN.actualAmount && adj.memo === BROKEN.memo && adj.payMethod === BROKEN.payMethod
    && adj.targetMonth === BROKEN.targetMonth && !adj.isDeposit && !adj.isBillingAdjust && adj.cashReceiptIssuedAt === null
  if (!same) throw new Error(`조정 행 값이 신고 시점과 다르다(${won(adj.actualAmount)} · ${adj.memo} · 수단 ${JSON.stringify(adj.payMethod)}). 이미 고쳤거나 그 사이 바뀌어 멈춘다`)
  const parsed = parseDueDayAdjustMemo(adj.memo)
  if (!parsed) throw new Error('조정 메모를 읽을 수 없어 멈춘다')
  const adjAfter = { actualAmount: -AGREED, memo: buildDueDayAdjustMemo({ ...parsed, agreedAmount: AGREED, kind: 'extra', note: '' }), payMethod: null }
  if (dueDayAdjustSignMismatch(adjAfter)) throw new Error('정정 뒤에도 메모 방향과 부호가 어긋나 멈춘다')

  // 그날 같은 수단으로 받은 보증금(운영자 사실: 200,000 중 50,000).
  const deposits = await tx.paymentRecord.findMany({
    where: { leaseTermId: LEASE_ID, isDeposit: true, deletedAt: null, payDate: ymdToDbDate(PAY_YMD), payMethod: METHOD },
    select: { actualAmount: true },
  })
  const depositCash = deposits.reduce((s, r) => s + r.actualAmount, 0)

  // 정정 뒤 모습으로 이용료 행을 들고 FIFO 를 앱(savePayment·findFirstUnpaidMonth)과 같은 식으로 돈다.
  const live = await tx.paymentRecord.findMany({
    where: { leaseTermId: LEASE_ID, isDeposit: false, deletedAt: null },
    select: { id: true, targetMonth: true, actualAmount: true, expectedAmount: true, isPrevOwner: true, payDate: true, seqNo: true, isPaid: true },
  })
  if (live.some(r => r.isPrevOwner)) throw new Error('양도인 몫 행이 있어 이 스크립트의 FIFO 가정(인수 뒤 입주) 밖이라 멈춘다')
  // 지워진 조정 행은 live 에 없다. 되살린 모습으로 sim 에 넣고, before(지금 장부)에는 넣지 않는다.
  const adjRec: Rec = { id: ADJ_ID, targetMonth: adj.targetMonth, actualAmount: adjAfter.actualAmount, expectedAmount: adj.expectedAmount, isPrevOwner: adj.isPrevOwner, payDate: adj.payDate, seqNo: adj.seqNo, isPaid: adj.isPaid }
  const sim: Rec[] = adj.deletedAt
    ? [...live, adjRec]
    : live.map(r => (r.id === ADJ_ID ? { ...r, actualAmount: adjAfter.actualAmount } : r))
  const before: Rec[] = live
  const billOf = (rows: Rec[], ms: string) => {
    const locked = rows.filter(r => r.targetMonth === ms && !r.isPrevOwner).reduce((mx, r) => Math.max(mx, r.expectedAmount), 0)
    return billForLeaseMonth(lease, ms, locked > 0 ? locked : null)
  }
  const paidOf = (rows: Rec[], ms: string) => rows.filter(r => r.targetMonth === ms).reduce((s, r) => s + r.actualAmount, 0)
  const viewMonth = PAY_YMD.slice(0, 7)
  const firstMonth = lease.moveInDate ? monthOf(lease.moveInDate) : viewMonth
  let start = viewMonth
  for (let ms = firstMonth; ms <= viewMonth; ms = nextMonth(ms)) {
    if (isAfterMoveOutMonth(lease.expectedMoveOut, ms)) continue
    if (paidOf(sim, ms) < billOf(sim, ms)) { start = ms; break }
  }
  const creates: NewRec[] = []
  const seqCount = async (ms: string) => tx.paymentRecord.count({ where: { leaseTermId: LEASE_ID, targetMonth: ms } })   // 지운 행도 센다(앱 채번과 같다)
  let remaining = CASH, cur = start, isOriginal = true, prev = start, prevFilled = false, guard = 24
  while (remaining > 0 && guard-- > 0) {
    const bill = billOf(sim, cur)
    const portion = Math.min(remaining, Math.max(0, bill - paidOf(sim, cur)))
    if (portion > 0 || (isOriginal && remaining === 0)) {
      const py = Number(prev.slice(0, 4)), pm = Number(prev.slice(5))
      const memo = isOriginal ? null : (prevFilled ? `${py}년 ${pm}월분 채우고 남은 금액` : `${py}년 ${pm}월분까지 완납 · 미리 낸 금액`)
      const rec: NewRec = { id: randomUUID(), targetMonth: cur, expectedAmount: bill, actualAmount: portion, memo, seqNo: (await seqCount(cur)) + 1 }
      creates.push(rec)
      sim.push({ id: rec.id, targetMonth: cur, actualAmount: portion, expectedAmount: bill, isPrevOwner: false, payDate: ymdToDbDate(PAY_YMD), seqNo: rec.seqNo, isPaid: false })
    }
    remaining -= portion
    prev = cur; prevFilled = portion > 0; isOriginal = false
    if (remaining <= 0) break
    cur = nextMonth(cur)
  }
  if (remaining > 0) throw new Error('FIFO 가 금액을 다 나누지 못해 멈춘다')

  // 완납 표시 재계산(앱 recalculatePayments 와 같은 누적식, 같은 날은 회차 순).
  const touched = [...new Set([BROKEN.targetMonth, ...creates.map(c => c.targetMonth)])]
  const isPaid: Plan['isPaid'] = []
  for (const ms of touched) {
    const bill = billOf(sim, ms)
    let cum = 0
    for (const r of sim.filter(x => x.targetMonth === ms).sort((a, b) => a.payDate.getTime() - b.payDate.getTime() || a.seqNo - b.seqNo)) {
      cum += r.actualAmount
      const was = r.id === ADJ_ID ? adj.isPaid : (before.find(b => b.id === r.id)?.isPaid ?? false)
      isPaid.push({ id: r.id, before: was, after: cum >= bill })
    }
  }
  const months = touched.map(ms => ({ month: ms, bill: billOf(sim, ms), paidBefore: paidOf(before, ms), paidAfter: paidOf(sim, ms) }))
  const last = touched[touched.length - 1]
  const due = resolveDueDateForMonth(lease.dueDay, last)
  const nextDue = { month: last, ymd: due ? `${due.getFullYear()}-${String(due.getMonth() + 1).padStart(2, '0')}-${String(due.getDate()).padStart(2, '0')}` : null, owed: Math.max(0, billOf(sim, last) - paidOf(sim, last)) }
  return { propertyId: lease.propertyId, tenantId: lease.tenantId, adjAfter, adjDeletedAt: adj.deletedAt?.toISOString() ?? null, creates, isPaid, months, nextDue, depositCash }
}

function print(p: Plan) {
  console.log(`대상: 513호 계약 ${LEASE_ID.slice(0, 8)} · 조정 행 ${ADJ_ID.slice(0, 8)}`)
  console.log(`① 조정 행: ${won(BROKEN.actualAmount)} · 수단 ''${p.adjDeletedAt ? ` · 지워짐(${p.adjDeletedAt})` : ''} → ${won(p.adjAfter.actualAmount)} · 수단 없음${p.adjDeletedAt ? ' · 되살림' : ''} (추가로 받을 금액 ${won(-p.adjAfter.actualAmount)})`)
  console.log(`   메모: ${BROKEN.memo}`)
  console.log(`      → ${p.adjAfter.memo}`)
  console.log(`② 현금 ${won(CASH)} · ${METHOD} · 납부일 ${PAY_YMD} · 귀속월 자동(FIFO)`)
  for (const c of p.creates) console.log(`   ${c.targetMonth} ${c.seqNo}회차 ${won(c.actualAmount)} · 청구 ${won(c.expectedAmount)}${c.memo ? ` · 메모 '${c.memo}'` : ''}`)
  console.log(`   같은 날 ${METHOD} 보증금 기록 ${won(p.depositCash)} · 그날 받은 ${METHOD} 합 ${won(p.depositCash + CASH)}`)
  console.log('③ 정정 뒤 달별')
  for (const m of p.months) {
    const state = m.paidAfter >= m.bill ? (m.paidAfter > m.bill ? `완납 · 넘침 ${won(m.paidAfter - m.bill)}` : '완납') : m.paidAfter > 0 ? `일부 · 남은 ${won(m.bill - m.paidAfter)}` : '미납'
    console.log(`   ${m.month} 청구 ${won(m.bill)} · 수납 합 ${won(m.paidBefore)} → ${won(m.paidAfter)} · ${state}`)
  }
  console.log(`   ${p.nextDue.month} 선납 ${won(p.months[p.months.length - 1].paidAfter)} · ${p.nextDue.ymd ?? '?'} 낼 돈 ${won(p.nextDue.owed)}`)
  const flips = p.isPaid.filter(x => x.before !== x.after && !p.creates.some(c => c.id === x.id))
  console.log(`   완납 표시 바뀌는 기존 행 ${flips.length}건${flips.length ? ` (${flips.map(f => `${f.id.slice(0, 8)} ${f.before}→${f.after}`).join(', ')})` : ''}`)
}

type Undo = {
  leaseTermId: string; adjId: string; propertyId: string
  adjBefore: typeof BROKEN; adjAfter: Plan['adjAfter']
  adjDeletedAt?: string | null
  created: NewRec[]; isPaid: Plan['isPaid']
  /** 만든 수납의 키(계약·입금일·수단). 되돌리기 전에 이 키에 살아 있는 발행 줄이 없는지 본다. */
  payYmd: string; method: string
}

async function revert(file: string) {
  const u = JSON.parse(fs.readFileSync(file, 'utf8')) as Undo
  await prisma.$transaction(async tx => {
    const adj = await tx.paymentRecord.findFirst({ where: { id: u.adjId, propertyId: u.propertyId, deletedAt: null }, select: { actualAmount: true, memo: true, payMethod: true } })
    if (!adj || adj.actualAmount !== u.adjAfter.actualAmount || adj.memo !== u.adjAfter.memo || adj.payMethod !== null) throw new Error('조정 행이 적용 직후 값과 달라 되돌리지 않는다')
    const rows = await tx.paymentRecord.findMany({ where: { id: { in: u.created.map(c => c.id) }, propertyId: u.propertyId }, select: { id: true, actualAmount: true, targetMonth: true, deletedAt: true, cashReceiptIssuedAt: true } })
    for (const c of u.created) {
      const r = rows.find(x => x.id === c.id)
      if (!r || r.deletedAt || r.actualAmount !== c.actualAmount || r.targetMonth !== c.targetMonth) throw new Error(`만든 수납 ${c.id.slice(0, 8)} 이 적용 직후와 달라 되돌리지 않는다`)
      // 그 사이 앱에서 현금영수증을 켰으면 발행 줄이 이 수납을 가리킨다. 지우면 줄이 고아가 된다. 앱에서 먼저 끄게 하고 멈춘다.
      if (r.cashReceiptIssuedAt) throw new Error(`만든 수납 ${c.id.slice(0, 8)} 에 현금영수증 발행 표시가 있어 되돌리지 않는다. 앱에서 발행 표시를 끈 뒤 다시 실행한다`)
    }
    const liveLine = await tx.cashReceipt.findFirst({ where: { propertyId: u.propertyId, leaseTermId: u.leaseTermId, payDate: ymdToDbDate(u.payYmd), payMethod: u.method, deletedAt: null }, select: { id: true } })
    if (liveLine) throw new Error(`그 키(${u.payYmd} · ${u.method})에 살아 있는 현금영수증 발행 줄이 있어 되돌리지 않는다. 앱에서 정리한 뒤 다시 실행한다`)
    await tx.paymentRecord.updateMany({ where: { id: u.adjId, propertyId: u.propertyId }, data: { actualAmount: u.adjBefore.actualAmount, memo: u.adjBefore.memo, payMethod: u.adjBefore.payMethod, ...(u.adjDeletedAt ? { deletedAt: new Date(u.adjDeletedAt) } : {}) } })
    // 앱의 수납 삭제·등록 적용취소와 같은 소프트삭제다(감사 흔적이 남고 회차 번호도 앱 채번과 같이 센다).
    await tx.paymentRecord.updateMany({ where: { id: { in: u.created.map(c => c.id) }, propertyId: u.propertyId, deletedAt: null }, data: { deletedAt: new Date() } })
    for (const x of u.isPaid) {
      if (u.created.some(c => c.id === x.id)) continue
      await tx.paymentRecord.updateMany({ where: { id: x.id, propertyId: u.propertyId }, data: { isPaid: x.before } })
    }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
  console.log(`되돌렸다. 조정 행 ${won(u.adjBefore.actualAmount)} · 수단 '' 로, 만든 수납 ${u.created.length}건 소프트삭제`)
}

async function main() {
  const revertIdx = process.argv.indexOf('--revert')
  if (revertIdx > 0) { await revert(process.argv[revertIdx + 1]); return }

  if (!process.argv.includes('--apply')) {
    // 예행. READ ONLY 트랜잭션 안에서 읽기만 한다.
    const p = await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      return plan(tx)
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
    print(p)
    console.log('예행만 했다. 적용은 --apply')
    return
  }

  const p0 = await prisma.$transaction(async tx => { await tx.$executeRaw`SET TRANSACTION READ ONLY`; return plan(tx) })
  const file = `scripts/.fix-dueday-adjust-513-undo-${Date.now()}.json`
  const undo: Undo = { leaseTermId: LEASE_ID, adjId: ADJ_ID, propertyId: p0.propertyId, adjBefore: BROKEN, adjAfter: p0.adjAfter, adjDeletedAt: p0.adjDeletedAt, created: p0.creates, isPaid: p0.isPaid, payYmd: PAY_YMD, method: METHOD }
  fs.writeFileSync(file, JSON.stringify(undo, null, 2))
  await prisma.$transaction(async tx => {
    const p = await plan(tx)   // 쓰기 직전 다시 확인. 예행과 다르면 멈춘다.
    if (JSON.stringify({ a: p.adjAfter, c: p.creates.map(c => [c.targetMonth, c.actualAmount, c.expectedAmount, c.memo, c.seqNo]) })
      !== JSON.stringify({ a: p0.adjAfter, c: p0.creates.map(c => [c.targetMonth, c.actualAmount, c.expectedAmount, c.memo, c.seqNo]) })) {
      throw new Error('쓰기 직전 계획이 예행과 달라 멈춘다')
    }
    const n = await tx.paymentRecord.updateMany({
      where: { id: ADJ_ID, propertyId: p0.propertyId, deletedAt: p0.adjDeletedAt ? new Date(p0.adjDeletedAt) : null, actualAmount: BROKEN.actualAmount, memo: BROKEN.memo, payMethod: BROKEN.payMethod },
      data: { ...p0.adjAfter, deletedAt: null },
    })
    if (n.count !== 1) throw new Error('조정 행을 바꾸지 못해 멈춘다')
    for (const c of p0.creates) {
      await tx.paymentRecord.create({
        data: {
          id: c.id, leaseTermId: LEASE_ID, tenantId: p0.tenantId, propertyId: p0.propertyId, targetMonth: c.targetMonth,
          expectedAmount: c.expectedAmount, actualAmount: c.actualAmount, payDate: ymdToDbDate(PAY_YMD), payMethod: METHOD,
          memo: c.memo, seqNo: c.seqNo, isPaid: false, carryOver: 0, cashReceiptIssuedAt: null,
        },
      })
    }
    for (const x of p0.isPaid) await tx.paymentRecord.updateMany({ where: { id: x.id, propertyId: p0.propertyId }, data: { isPaid: x.after } })
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 30_000 })
  print(p0)
  console.log(`적용했다. 되돌리기: npx tsx --env-file=.env.local scripts/fix-dueday-adjust-513.ts --revert ${file}`)
}

main().finally(() => prisma.$disconnect())
