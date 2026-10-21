// 504호 계약에 이용 기간 시작일 '1'(납부일만 옮김)을 넣는 일회성 정정. 예행 기본, --apply 적용, --revert <undo.json> 되돌림
//
// 왜(운영자 2026-10-21). "504호는 입실일이 1일이지만 납입일만 매달 6일, 나중 퇴실일은 말일이 되어도 괜찮으니 그런 옵션도 넣어줘."
// 지금 504호는 납부일 칸 하나가 '6' 이라 이용 기간이 6일~다음 달 5일로 잡힌다(퇴실 정산·첫 달 규칙·무청구가 6일 기준).
// 합의는 기간 1일~말일, 납부일 6일이다. 그래서 cycleDay='1' 만 넣고 dueDay '6' 은 그대로 둔다(기한·미납 경과일은 6일 기준 유지).
//
// 하는 일.
//   ① lease_terms."cycleDay" = '1' (계약 7977970b). 조정 행·수납·납부일은 손대지 않는다(돈은 안 움직인다).
//   ② 합의 메모를 입주자 메모 칸(tenants.memo)에 한 줄 덧붙인다. 계약에는 메모 칸이 없고, 입주자 메모는 상세에서 바로 보이는 자리다.
//      지금 메모가 있으면 그 뒤에 줄을 바꿔 붙인다. 되돌리기는 메모를 적용 전 글자 그대로 돌린다.
//
// 안전장치. 칸(cycleDay)이 운영 DB 에 없으면(prisma/migrate_lease_cycle_day.sql 미적용) 적용을 거부한다(예행은 칸을 비었다고 보고 보여 준다).
// 지금 상태가 승인 때 본 모양(ACTIVE · 504호 · dueDay '6' · cycleDay 없음 · 살아 있는 납입일 변경 조정 행 없음)이 아니면 멈춘다.
// 예행은 READ ONLY 트랜잭션이라 쓰기가 구조로 막힌다. 적용·되돌리기는 Serializable 한 트랜잭션이고 행을 잠근 뒤 다시 확인한다.
// 되돌리기는 칸과 메모를 따로 본다. 기간 칸이 적용 직후 값('1')이면 되돌린다(그 사이 앱에서 기간을 바꿨으면 칸은 멈춘다).
// 메모는 적용 직후 글자 그대로일 때만 되돌리고, 그 사이 운영자가 고쳤으면 그대로 둔다(고친 글을 지우지 않는다).
// 딸린 계약(parentLeaseTermId = 504)이 있으면 적용을 멈춘다. 2026-10-21 운영 0건이라 지금은 걸리지 않는다.
// 있으면 앱의 납입일 변경(납부일만 옮김)이 전파·적용취소까지 함께 하므로 그 길로 처리한다(이 스크립트가 전파를 손으로 베끼지 않는다).
//
// 실행: npx tsx --env-file=.env.local scripts/fix-504-cycle-day.ts [--apply | --revert <scripts/.fix-504-cycle-day-undo-*.json>]
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { billForLeaseMonth, firstMonthDueYmd, isCheckoutNoBillingMonthFor, resolveDueDateForMonth } from '../lib/billing'
import { settlementPeriodFor } from '../lib/settlementPeriod'
import { calcCheckoutProration } from '../lib/prorate'
import { cycleDayOf } from '../lib/dueDay'
import { dueDayAdjustsFrom } from '../lib/dueDayAdjust'
import { kstYmdStr } from '../lib/kstDate'

const LEASE_ID = '7977970b-abc5-4404-b9ef-678499a78485'
const ROOM_NO = '504'
const NEXT_CYCLE = '1'
const memoLine = (ymd: string) => `[${ymd}] 납부일 매월 6일 · 이용 기간 매월 1일~말일 합의(납부일만 옮김). 기간 끝(말일)에 퇴실하면 추가 금액 없음.`
const won = (n: number) => `${n.toLocaleString('en-US')}원`

type Undo = {
  leaseTermId: string; tenantId: string
  before: { cycleDay: string | null; tenantMemo: string | null }
  after: { cycleDay: string; tenantMemo: string }
  appliedAt: string
}

const argv = process.argv.slice(2)
const mode = argv.includes('--apply') ? 'apply' : argv.includes('--revert') ? 'revert' : 'dry'

async function hasColumn(c: Client): Promise<boolean> {
  const r = await c.query(`select 1 from information_schema.columns where table_name = 'lease_terms' and column_name = 'cycleDay'`)
  return r.rowCount! > 0
}

async function main() {
  const c = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } })
  await c.connect()
  try {
    await c.query(mode === 'dry' ? 'BEGIN READ ONLY' : 'BEGIN ISOLATION LEVEL SERIALIZABLE')
    const col = await hasColumn(c)
    if (!col && mode !== 'dry') throw new Error('운영 DB 에 lease_terms."cycleDay" 칸이 없다. prisma/migrate_lease_cycle_day.sql 을 먼저 적용해야 한다')
    const lock = mode === 'dry' ? '' : ' FOR UPDATE OF l, t'
    const cur = (await c.query(
      `select l.id, l.status, l."tenantId", l."dueDay", ${col ? 'l."cycleDay"' : 'null::text as "cycleDay"'}, l."rentAmount", l."isShortTerm",
              to_char(l."moveInDate", 'YYYY-MM-DD') as "moveIn", l."checkoutProratedAmount", l."checkoutProratedMonth", r."roomNo", t.memo as "tenantMemo"
         from lease_terms l join tenants t on t.id = l."tenantId" left join rooms r on r.id = l."roomId"
        where l.id = $1${lock}`, [LEASE_ID])).rows[0]
    if (!cur) throw new Error('대상 계약이 없어 멈춘다')
    console.log(`대상: ${cur.roomNo}호 계약 ${LEASE_ID.slice(0, 8)} · 상태 ${cur.status} · 납부일 '${cur.dueDay}' · 기간 시작일 ${cur.cycleDay === null ? '없음' : `'${cur.cycleDay}'`}${col ? '' : ' (칸 없음, SQL 적용 전이라 없음으로 보고 예행)'} · 입주 ${cur.moveIn}`)

    if (mode === 'revert') {
      const file = argv[argv.indexOf('--revert') + 1]
      if (!file) throw new Error('--revert 뒤에 되돌리기 파일 경로가 없다')
      const u = JSON.parse(fs.readFileSync(file, 'utf8')) as Undo
      if (u.leaseTermId !== LEASE_ID || u.tenantId !== cur.tenantId) throw new Error('되돌리기 파일이 이 계약 것이 아니다')
      const cycleBack = cur.cycleDay === u.after.cycleDay
      const memoBack = (cur.tenantMemo ?? null) === u.after.tenantMemo
      if (!cycleBack && !memoBack) throw new Error('기간 칸과 메모가 모두 적용 직후 모양이 아니다(그 사이 바뀜). 되돌리지 않고 멈춘다')
      if (cycleBack) await c.query(`update lease_terms set "cycleDay" = $2 where id = $1`, [LEASE_ID, u.before.cycleDay])
      if (memoBack) await c.query(`update tenants set memo = $2 where id = $1`, [u.tenantId, u.before.tenantMemo])
      await c.query('COMMIT')
      console.log(`되돌림 완료: 기간 시작일 ${cycleBack ? `${u.before.cycleDay ?? '없음'} 으로` : `그대로(지금 '${cur.cycleDay ?? '없음'}', 그 사이 바뀜)`} · 입주자 메모 ${memoBack ? '적용 전 글자로' : '그대로(그 사이 고침)'}`)
      return
    }

    // 승인 때 본 모양인가
    // 조정 행은 청구 엔진의 입력이다(입주달 첫 달 규칙). 정본(dueDayAdjustsFrom)으로 고르고, 살아 있는 행이 있으면 승인 때 모양이 아니다.
    const adjRows = (await c.query(`select "targetMonth", memo, "seqNo", "deletedAt" from payment_records where "leaseTermId" = $1 and memo like '[납입일변경]%'`, [LEASE_ID])).rows
    const dueDayAdjusts = dueDayAdjustsFrom(adjRows)
    const liveAdjust = dueDayAdjusts.length
    const subs = (await c.query(`select id, status, "dueDay" from lease_terms where "parentLeaseTermId" = $1 and status in ('ACTIVE','CHECKOUT_PENDING','NON_RESIDENT')`, [LEASE_ID])).rows
    if (subs.length > 0) throw new Error(`딸린 계약 ${subs.length}건(${subs.map((x: { id: string }) => x.id.slice(0, 8)).join(', ')})이 있다. 앱의 납입일 변경(납부일만 옮김)으로 함께 처리한다. 멈춘다`)
    const okShape = cur.roomNo === ROOM_NO && cur.status === 'ACTIVE' && cur.dueDay === '6' && cur.cycleDay === null && liveAdjust === 0 && !cur.isShortTerm
    if (!okShape) throw new Error(`지금 모양이 승인 때(ACTIVE · 504호 · 납부일 '6' · 기간 시작일 없음 · 살아 있는 조정 행 0)와 다르다(조정 행 ${liveAdjust}). 멈춘다`)

    // 바뀐 뒤 모습을 엔진으로 미리 본다(락은 그 달 수납의 청구 최댓값)
    const recs = (await c.query(`select "targetMonth", max("expectedAmount")::int as locked from payment_records where "leaseTermId" = $1 and "deletedAt" is null and not "isDeposit" and not "isPrevOwner" group by 1`, [LEASE_ID])).rows as { targetMonth: string; locked: number }[]
    const lockOf = (m: string) => recs.find(r => r.targetMonth === m)?.locked || null
    const moveInDate = new Date(`${cur.moveIn}T00:00:00.000Z`)
    const base = { rentAmount: cur.rentAmount, status: cur.status, moveInDate, dueDay: cur.dueDay, checkoutProratedAmount: cur.checkoutProratedAmount, checkoutProratedMonth: cur.checkoutProratedMonth, dueDayAdjusts }
    const before = { ...base, cycleDay: null }
    const after = { ...base, cycleDay: NEXT_CYCLE }
    const today = kstYmdStr()
    const nextMemo = cur.tenantMemo ? `${cur.tenantMemo}\n${memoLine(today)}` : memoLine(today)
    console.log(`① 기간 시작일: 없음 → '${NEXT_CYCLE}' (납부일 '6' 그대로, 조정 행·수납 손대지 않음)`)
    console.log(`② 입주자 메모: ${cur.tenantMemo ? '지금 메모 뒤에 한 줄' : '비어 있어 한 줄'} → ${memoLine(today)}`)
    console.log('③ 바뀐 뒤 (지금 → 바뀐 뒤)')
    for (const m of ['2026-08', '2026-09', '2026-10', '2026-11', '2026-12']) {
      const b = billForLeaseMonth(before, m, lockOf(m)), a = billForLeaseMonth(after, m, lockOf(m))
      const p = settlementPeriodFor(after, `${m}-15`)
      const due = firstMonthDueYmd(after, m) ?? (() => { const d = resolveDueDateForMonth(after.dueDay, m)!; return `${m}-${String(d.getDate()).padStart(2, '0')}` })()
      console.log(`   ${m} 청구 ${won(b)} → ${won(a)}${lockOf(m) ? ' (수납 락)' : ''} · 기간 ${p?.startYmd}~${p?.mustLeaveYmd} · 기한 ${due}`)
    }
    for (const out of ['2026-11-03', '2026-12-15', '2026-12-31']) {
      const pb = calcCheckoutProration(cur.rentAmount, cycleDayOf(before), out, cur.moveIn)
      const pa = calcCheckoutProration(cur.rentAmount, cycleDayOf(after), out, cur.moveIn)
      const nbB = isCheckoutNoBillingMonthFor(before, out, out.slice(0, 7))
      const nbA = isCheckoutNoBillingMonthFor(after, out, out.slice(0, 7))
      const show = (x: typeof pa, nb: boolean) => (nb ? `${out.slice(0, 7)} 청구 0(무청구)` : '') + (x ? `${nb ? ' · ' : ''}${x.moveOutMonth}분 ${x.startYmd}부터 ${x.daysUsed}일 ${won(x.amount)}` : '')
      console.log(`   ${out} 퇴실: ${show(pb, nbB)} → ${show(pa, nbA)}`)
    }
    if (mode !== 'apply') { await c.query('ROLLBACK'); console.log('예행이라 아무것도 바꾸지 않았다. 적용은 --apply'); return }

    const undo: Undo = { leaseTermId: LEASE_ID, tenantId: cur.tenantId, before: { cycleDay: cur.cycleDay, tenantMemo: cur.tenantMemo ?? null }, after: { cycleDay: NEXT_CYCLE, tenantMemo: nextMemo }, appliedAt: new Date().toISOString() }
    const file = path.join(__dirname, `.fix-504-cycle-day-undo-${Date.now()}.json`)
    fs.writeFileSync(file, JSON.stringify(undo, null, 1))
    await c.query(`update lease_terms set "cycleDay" = $2 where id = $1`, [LEASE_ID, NEXT_CYCLE])
    await c.query(`update tenants set memo = $2 where id = $1`, [cur.tenantId, nextMemo])
    await c.query('COMMIT')
    console.log(`적용 완료. 되돌리기: npx tsx --env-file=.env.local scripts/fix-504-cycle-day.ts --revert ${path.relative(process.cwd(), file)}`)
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('중단:', (e as Error).message)
    process.exitCode = 1
  } finally {
    await c.end()
  }
}
main()
