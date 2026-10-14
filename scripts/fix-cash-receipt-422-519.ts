// 현금영수증 발행 줄 두 건(422호 재발행 금액·519호 홈택스 취소)을 운영자 확인 사실로 맞추는 일회성 정정. 예행 기본, --apply 적용, --undo <파일> 되돌림
//
// 왜 (생애주기 정비 4단계, 운영자 승인 2026-10-13 "추천대로 진행해줘"). 생성 경로는 1단계(c11d5886..960b5705)가
// 봉합했고, 백필 재실행은 scripts/backfill-cash-receipt.ts 가 거부한다. 남은 것은 그 전에 생긴 두 줄의 값이다.
//   422호 정금순 2026-10-06 계좌이체 키. 운영자 사실은 '10/12 410,000원 한 장 재발행'이다(기존 420,000원 발행은
//     홈택스에서 취소, 10,000원은 입주자에게 돌려줌). 앱 줄은 지운 10,000원 선납까지 든 420,000원이다.
//     살아 있는 줄 amount 420,000 을 410,000 으로. 발행일(2026-10-11T15:00Z = KST 10/12)·구성은 그대로.
//     도장은 이미 10/12 라 안 건드리고, 맞는지만 확인한다.
//   519호 임형진 2026-07-18 계좌이체 470,000원. 7월에 홈택스에서 취소한 건인데 2026-08-24 백필이 지워진 수납에서
//     살아 있는 줄로 되살려 7월 합계에 남았다(점검은 '환불 대기'로 읽어 영구 미검출). 줄을 소프트삭제하고 memo 에
//     근거를 남긴다. 그 키의 수납이 전부 지워져 있는지 확인한다.
// 바뀌는 월 합계(운영자 승인 숫자). 7월 5,660,000원 14건 대 5,190,000원 13건, 10월 4,030,000원 대 4,020,000원.
// 예행은 그 숫자를 지금 DB 로 다시 세서 보여 준다(10월은 그 뒤 새 발행이 있으면 함께 움직인다).
//
// 대상은 id 가 아니라 조건(영업장 이름·호실·입주자·입금일·수단·금액)으로 찾고, 단계마다 정확히 1건이 아니면 멈춘다.
// 쓰기는 한 트랜잭션이고 같은 키를 만지는 앱 조작과 키 잠금으로 줄 세운다. 쓰기 직전 지금 값이 예행의 '전' 값과
// 같은지 다시 보고 다르면 아무것도 안 쓴다. 되돌리기는 지금 값이 '후' 값과 같을 때만 '전' 값으로 돌린다.
// 예행은 READ ONLY 트랜잭션 안에서 읽어 쓰기가 구조로 막힌다. 예행 끝에 '정리 뒤 점검 결과'를 같은 판정
// (lib/cashReceiptAudit)으로 보여 준다. 적용 뒤에는 점검(check-cash-receipt-orphan)의 KNOWN_BORN_DEAD 를 비운다
// (안 비우면 '기준선이 낡았다'로 운다. 그것이 의도다).
// 재발 감지는 scripts/check-cash-receipt-orphan.ts (바)·(자)·(카).
//
// 실행: npx tsx --env-file=.env.local scripts/fix-cash-receipt-422-519.ts [--apply | --undo <undo.json>]
import fs from 'node:fs'
import { PrismaClient, type Prisma } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { cashReceiptKey, cashReceiptMonth, isCashReceiptEligible, summarizeCashReceiptKey } from '../lib/cashReceipt'
import { crCoveredRent } from '../lib/cashReceiptCopy'
import { auditCashReceipts, type CashReceiptAuditReport } from '../lib/cashReceiptAudit'
import { kstDateTimeToUtc, kstMonthKey, kstMonthTsRange, kstYmdStr, ymdToDbDate } from '../lib/kstDate'
import { loadCashReceiptAuditData, type CashReceiptAuditData } from './cash-receipt-audit-data'

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })
type Tx = Prisma.TransactionClient

const PROPERTY_NAME = '더스테이원룸텔 제기역점'
type Target =
  & { tag: string; roomNo: string; tenantName: string; payYmd: string; payMethod: string; amount: number }
  & ({ kind: 'reissue'; toAmount: number; issuedAt: string } | { kind: 'cancel'; memo: string })
const TARGETS: Target[] = [
  {
    tag: '422호 정금순', roomNo: '422', tenantName: '정금순', payYmd: '2026-10-06', payMethod: '계좌이체', amount: 420000,
    kind: 'reissue', toAmount: 410000, issuedAt: '2026-10-11T15:00:00.000Z',
  },
  {
    tag: '519호 임형진', roomNo: '519', tenantName: '임형진', payYmd: '2026-07-18', payMethod: '계좌이체', amount: 470000,
    kind: 'cancel', memo: '2026-07 홈택스 취소(운영자 확인 2026-10-13). 수납은 2026-07-20 환불로 지워졌고 2026-08-24 백필이 지워진 수납에서 이 줄을 만들었다',
  },
]

/** 줄에서 이 정정이 보고 바꾸는 칸. 날짜는 ISO 문자열이다. */
type Snap = { amount: number; issuedAt: string; inclDeposit: boolean; inclCleaning: boolean; inclRent: boolean; memo: string | null; deletedAt: string | null }
type Row = { tag: string; id: string; propertyId: string; leaseTermId: string; payYmd: string; payMethod: string | null; before: Snap; after: Snap }

const SNAP_SELECT = { amount: true, issuedAt: true, inclDeposit: true, inclCleaning: true, inclRent: true, memo: true, deletedAt: true } as const
const snapOf = (r: { amount: number; issuedAt: Date; inclDeposit: boolean; inclCleaning: boolean; inclRent: boolean; memo: string | null; deletedAt: Date | null }): Snap => ({
  amount: r.amount, issuedAt: r.issuedAt.toISOString(), inclDeposit: r.inclDeposit, inclCleaning: r.inclCleaning, inclRent: r.inclRent,
  memo: r.memo, deletedAt: r.deletedAt ? r.deletedAt.toISOString() : null,
})
const sameSnap = (a: Snap, b: Snap) => JSON.stringify(a) === JSON.stringify(b)
const won = (n: number) => `${n.toLocaleString()}원`
const one = <T>(rows: T[], what: string): T => {
  if (rows.length !== 1) throw new Error(`${what} ${rows.length}건이다. 정확히 1건이 아니라 멈춘다`)
  return rows[0]
}

/**
 * 앱 엔진의 키 잠금(app/(app)/rooms/cashReceiptLine.ts lockCrKeys)과 같은 잠금 번호를 잡는다. 엔진 모듈은
 * lib/pii 의 'server-only' 를 거쳐 스크립트에서 못 불러 같은 식을 여기 둔다. 엔진의 키 문자열 모양을 바꾸면 여기도 바꾼다.
 */
async function lockKeys(tx: Tx, rows: Pick<Row, 'leaseTermId' | 'payYmd' | 'payMethod'>[]) {
  const keys = [...new Set(rows.map(r => `cash-receipt|${cashReceiptKey({ leaseTermId: r.leaseTermId, payDate: ymdToDbDate(r.payYmd), payMethod: r.payMethod })}`))]
  const nums = await tx.$queryRaw<{ h: number }[]>`SELECT DISTINCT hashtext(k) AS h FROM unnest(${keys}::text[]) AS k ORDER BY h`
  for (const { h } of nums) await tx.$executeRaw`SELECT pg_advisory_xact_lock(${h}::int)`
}

/** 조건으로 대상 줄을 찾고 사실을 확인해 바꿀 행을 만든다. 하나라도 어긋나면 던진다. */
async function plan(tx: Tx, deletedAt: Date, log: (s: string) => void = console.log): Promise<{ rows: Row[]; propertyId: string; cutoffTs: Date | null }> {
  const prop = one(await tx.property.findMany({
    where: { name: PROPERTY_NAME }, select: { id: true, acquisitionDate: true, prevOwnerCutoffDate: true },
  }), `영업장 '${PROPERTY_NAME}'`)
  const cutoff = prop.prevOwnerCutoffDate ?? prop.acquisitionDate ?? null
  const cutoffTs = cutoff ? kstDateTimeToUtc(cutoff.toISOString().slice(0, 10)) : null
  const rows: Row[] = []
  for (const t of TARGETS) {
    const lease = one(await tx.leaseTerm.findMany({
      where: { propertyId: prop.id, room: { roomNo: t.roomNo }, tenant: { name: t.tenantName } }, select: { id: true },
    }), `${t.tag} 계약`)
    const payDate = ymdToDbDate(t.payYmd)
    const keyWhere = { propertyId: prop.id, leaseTermId: lease.id, payDate, payMethod: t.payMethod }
    const line = one(await tx.cashReceipt.findMany({
      where: { ...keyWhere, deletedAt: null }, select: { id: true, ...SNAP_SELECT },
    }), `${t.tag} ${t.payYmd} ${t.payMethod} 살아 있는 발행 줄`)
    if (line.amount !== t.amount) throw new Error(`${t.tag} 줄 금액이 ${won(line.amount)}이다(기대 ${won(t.amount)}). 예상한 상태가 아니라 멈춘다`)
    // 확장 없는 클라이언트라 지워진 수납까지 나온다. 조정 전표는 받은 돈이 아니라 뺀다.
    const records = await tx.paymentRecord.findMany({
      where: { ...keyWhere, isBillingAdjust: false },
      select: { id: true, isDeposit: true, actualAmount: true, cashReceiptIssuedAt: true, deletedAt: true },
    })
    const before = snapOf(line)
    let after: Snap
    if (t.kind === 'reissue') {
      if (before.issuedAt !== t.issuedAt) throw new Error(`${t.tag} 발행일이 ${before.issuedAt} 이다(기대 ${t.issuedAt}, KST ${kstYmdStr(new Date(t.issuedAt))}). 멈춘다`)
      if (!before.inclRent || before.inclDeposit || before.inclCleaning) throw new Error(`${t.tag} 줄 구성이 이용료만이 아니다. 멈춘다`)
      const live = records.filter(r => !r.deletedAt)
      const parts = summarizeCashReceiptKey(live)
      const covered = crCoveredRent(parts)
      if (covered !== t.toAmount) throw new Error(`${t.tag} 도장 찍힌 이용료 몫이 ${won(covered)}이다(기대 ${won(t.toAmount)}). 멈춘다`)
      if (parts.stampedRentRows !== parts.rentRows) throw new Error(`${t.tag} 이용료 행 ${parts.rentRows}건 중 도장 ${parts.stampedRentRows}건이다. 멈춘다`)
      const off = live.filter(r => r.cashReceiptIssuedAt && r.cashReceiptIssuedAt.toISOString() !== before.issuedAt)
      if (off.length > 0) throw new Error(`${t.tag} 도장 ${off.length}건이 줄 발행일과 다르다. 멈춘다`)
      log(`  ${t.tag}: 살아 있는 수납 ${live.length}건(이용료 ${won(parts.rent)}) · 도장 ${parts.stampedRentRows}건 전부 발행일 KST ${kstYmdStr(line.issuedAt)} 와 같다(도장은 안 건드린다)`)
      after = { ...before, amount: t.toAmount }
    } else {
      if (records.length === 0 || records.some(r => !r.deletedAt)) {
        throw new Error(`${t.tag} 그 키의 수납 ${records.length}건 중 살아 있는 것이 ${records.filter(r => !r.deletedAt).length}건이다. 기여 수납이 전부 지워진 상태가 아니라 멈춘다`)
      }
      if (before.memo) throw new Error(`${t.tag} 줄에 이미 메모가 있다("${before.memo}"). 덮지 않고 멈춘다`)
      log(`  ${t.tag}: 그 키의 수납 ${records.length}건 전부 지워져 있다(${records.map(r => `${won(r.actualAmount)} 삭제 ${r.deletedAt!.toISOString()}`).join(', ')})`)
      after = { ...before, deletedAt: deletedAt.toISOString(), memo: t.memo }
    }
    rows.push({ tag: t.tag, id: line.id, propertyId: prop.id, leaseTermId: lease.id, payYmd: t.payYmd, payMethod: t.payMethod, before, after })
  }
  return { rows, propertyId: prop.id, cutoffTs }
}

/** 달의 현금영수증 합계. getMonthPaymentAggregates(rooms/actions.ts)와 같은 거름이다(영업장·살아 있는 줄·컷오프·카드 봉인·발행일 KST 달). */
function monthTotal(lines: { amount: number; issuedAt: Date; payMethod: string | null }[], month: string, cutoffTs: Date | null) {
  const win = kstMonthTsRange(month)
  const from = cutoffTs && cutoffTs > win.gte ? cutoffTs : win.gte
  let sum = 0, n = 0
  for (const l of lines) {
    if (l.issuedAt < from || l.issuedAt >= win.lt) continue
    if (!isCashReceiptEligible(l.payMethod) || cashReceiptMonth(l) !== month) continue
    sum += l.amount; n += 1
  }
  return { sum, n }
}

type MonthLine = { id: string; amount: number; issuedAt: Date; payMethod: string | null }
/** 바꿀 행을 적용한 뒤의 살아 있는 줄(메모리에서만). */
function applyRows<T extends { id: string; amount: number }>(lines: T[], rows: Row[]): T[] {
  const byId = new Map(rows.map(r => [r.id, r]))
  return lines.flatMap(l => {
    const r = byId.get(l.id)
    if (!r) return [l]
    if (r.after.deletedAt) return []
    return [{ ...l, amount: r.after.amount }]
  })
}

function printMonths(rows: Row[], beforeLines: MonthLine[], afterLines: MonthLine[], cutoffTs: Date | null) {
  const months = [...new Set(rows.map(r => kstMonthKey(r.before.issuedAt)))].sort()
  for (const m of months) {
    const b = monthTotal(beforeLines, m, cutoffTs)
    const a = monthTotal(afterLines, m, cutoffTs)
    console.log(`  ${m} 현금영수증 합계(발행일 기준): ${won(b.sum)} ${b.n}건 대 ${won(a.sum)} ${a.n}건`)
  }
}

function auditLine(label: string, r: CashReceiptAuditReport) {
  const by = new Map<string, number>()
  for (const v of r.violations) by.set(v.axis, (by.get(v.axis) ?? 0) + 1)
  const axes = ['가', '나', '라', '마', '바', '사', '자', '카'].map(a => `${a} ${by.get(a) ?? 0}`).join(' · ')
  const un = r.partial.reduce((s, p) => s + p.unstampedRent, 0)
  console.log(`  ${label}: 발행 ${r.lineCount}건 · 위반 ${r.violations.length}건(${axes}) · 환불 대기 ${r.pending.length}건(30일 경과 ${r.warnings.length}건) · 정보 (아) ${r.partial.length}키 ${won(un)}`)
  for (const v of r.violations.slice(0, 10)) console.log(`    - (${v.axis}) ${v.text}`)
}

/** 정리 전·뒤 점검. 알려진 (자) 목록 없이 돌려 (자)가 1에서 0으로 가는 것을 그대로 보인다. */
function printAudit(data: CashReceiptAuditData, rows: Row[]) {
  const input = { ...data, todayYmd: kstYmdStr(), knownBornDead: {} }
  auditLine('정리 전', auditCashReceipts(input))
  auditLine('정리 뒤', auditCashReceipts({ ...input, lines: applyRows(data.lines, rows) }))
}

function printRows(rows: Row[]) {
  for (const r of rows) {
    const diff = (Object.keys(r.before) as (keyof Snap)[]).filter(k => r.before[k] !== r.after[k])
    console.log(`  ${r.tag} 줄 ${r.id} (수납일 ${r.payYmd} · ${r.payMethod} · 발행 KST ${kstYmdStr(new Date(r.before.issuedAt))})`)
    for (const k of diff) console.log(`    ${k}: ${JSON.stringify(r.before[k])} -> ${JSON.stringify(r.after[k])}`)
  }
}

async function undo(file: string) {
  const snap = JSON.parse(fs.readFileSync(file, 'utf8')) as { rows: Row[] }
  await prisma.$transaction(async tx => {
    await lockKeys(tx, snap.rows)
    // 전부 지금 값이 적용값과 같은지 먼저 본다. 하나라도 다르면 아무것도 되돌리지 않는다.
    for (const r of snap.rows) {
      const cur = await tx.cashReceipt.findFirst({ where: { id: r.id, propertyId: r.propertyId, leaseTermId: r.leaseTermId }, select: SNAP_SELECT })
      if (!cur || !sameSnap(snapOf(cur), r.after)) {
        throw new Error(`${r.tag} 줄 ${r.id} 의 지금 값이 적용값과 달라(그 사이 바뀌었다) 되돌리지 않는다. 지금 ${cur ? JSON.stringify(snapOf(cur)) : '없음'}`)
      }
    }
    for (const r of snap.rows) {
      const n = await tx.cashReceipt.updateMany({
        where: { id: r.id, propertyId: r.propertyId },
        data: { amount: r.before.amount, memo: r.before.memo, deletedAt: r.before.deletedAt ? new Date(r.before.deletedAt) : null },
      })
      if (n.count !== 1) throw new Error(`${r.tag} 되돌림이 ${n.count}건에 닿았다. 멈춘다`)
    }
  }, { timeout: 30_000 })
  for (const r of snap.rows) console.log(`되돌림: ${r.tag} 줄 ${r.id} amount ${r.after.amount} -> ${r.before.amount} · memo ${JSON.stringify(r.after.memo)} -> ${JSON.stringify(r.before.memo)} · deletedAt ${r.after.deletedAt} -> ${r.before.deletedAt}`)
}

async function main() {
  const undoIdx = process.argv.findIndex(a => a === '--undo' || a === '--revert')
  if (undoIdx > 0) {
    const file = process.argv[undoIdx + 1]
    if (!file) throw new Error('--undo 뒤에 되돌리기 파일 경로를 줄 것')
    return undo(file)
  }

  if (!process.argv.includes('--apply')) {
    // 예행. READ ONLY 트랜잭션 안에서 읽기만 한다.
    await prisma.$transaction(async tx => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`
      console.log('[예행] 대상 확인')
      const { rows, propertyId, cutoffTs } = await plan(tx, new Date())
      console.log('\n[예행] 바꿀 행(전 -> 후)')
      printRows(rows)
      const lines: MonthLine[] = await tx.cashReceipt.findMany({ where: { propertyId, deletedAt: null }, select: { id: true, amount: true, issuedAt: true, payMethod: true } })
      console.log('\n[예행] 바뀌는 월 합계(정리 전 대 정리 뒤)')
      printMonths(rows, lines, applyRows(lines, rows), cutoffTs)
      console.log('\n[예행] 점검(check-cash-receipt-orphan 과 같은 판정, 알려진 (자) 목록 없이)')
      printAudit(await loadCashReceiptAuditData(tx), rows)
    }, { timeout: 60_000 })
    console.log('\n예행만 했다. 적용은 --apply (적용 뒤 check-cash-receipt-orphan 의 KNOWN_BORN_DEAD 를 비울 것)')
    return
  }

  const file = `scripts/.fix-cash-receipt-422-519-undo-${Date.now()}.json`
  let written = false
  try {
    const out = await prisma.$transaction(async tx => {
      // 키 잠금이 먼저다. 조건 조회로 키를 알아낸 뒤 잠그고 다시 읽는다.
      const pre = await plan(tx, new Date(), () => {})
      await lockKeys(tx, pre.rows)
      const { rows, propertyId, cutoffTs } = await plan(tx, new Date())
      for (const r of rows) {
        const p = pre.rows.find(x => x.id === r.id)
        if (!p || !sameSnap(p.before, r.before)) throw new Error(`${r.tag} 잠금 사이에 줄이 바뀌었다. 멈춘다`)
      }
      const beforeLines: MonthLine[] = await tx.cashReceipt.findMany({ where: { propertyId, deletedAt: null }, select: { id: true, amount: true, issuedAt: true, payMethod: true } })
      fs.writeFileSync(file, JSON.stringify({ rows }, null, 2))
      written = true
      for (const r of rows) {
        const n = await tx.cashReceipt.updateMany({
          where: { id: r.id, propertyId: r.propertyId, amount: r.before.amount, deletedAt: null },
          data: { amount: r.after.amount, memo: r.after.memo, deletedAt: r.after.deletedAt ? new Date(r.after.deletedAt) : null },
        })
        if (n.count !== 1) throw new Error(`${r.tag} 쓰기가 ${n.count}건에 닿았다. 멈춘다`)
      }
      const afterLines: MonthLine[] = await tx.cashReceipt.findMany({ where: { propertyId, deletedAt: null }, select: { id: true, amount: true, issuedAt: true, payMethod: true } })
      return { rows, cutoffTs, beforeLines, afterLines }
    }, { timeout: 60_000 })
    console.log('[적용] 바꾼 행(전 -> 후)')
    printRows(out.rows)
    console.log('\n[적용] 월 합계(적용 전 대 적용 뒤, DB 에서 다시 셈)')
    printMonths(out.rows, out.beforeLines, out.afterLines, out.cutoffTs)
    console.log(`\n적용했다(${out.rows.length}행). 되돌리기: npx tsx --env-file=.env.local scripts/fix-cash-receipt-422-519.ts --undo ${file}`)
    console.log('다음: scripts/check-cash-receipt-orphan.ts 의 KNOWN_BORN_DEAD 를 비우고 점검을 다시 돌릴 것')
  } catch (e) {
    // 트랜잭션이 되감겼으면 되돌릴 것도 없다. 쓴 되돌리기 파일을 남기지 않는다.
    if (written) fs.rmSync(file, { force: true })
    throw e
  }
}

main().catch(e => { console.error(e instanceof Error ? e.message : e); process.exitCode = 1 }).finally(() => prisma.$disconnect())
