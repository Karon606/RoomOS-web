// 현금영수증 발행 줄 점검 판정(lib/cashReceiptAudit) 회귀 테스트. 축마다 위반을 주입해 우는지, 깨끗한 재료에 침묵하는지 본다. 실패 시 exit 1.
// 실행: npx tsx scripts/test-cash-receipt-audit.ts
//
// 왜 DB 사본이 아니라 판정 함수인가(2026-10-14, 생애주기 정비 3단계). 운영 DB 에는 쓰지 않는다. 축이 정말 우는지는
// 재료를 손으로 만들어 판정에 넣어 보는 것이 가장 정확하다. 점검 스크립트(check-cash-receipt-orphan)는 이 판정을
// 부르기만 하므로, 여기서 축이 울면 점검도 운다.
//
// KST 경계를 반드시 건다. 발행일·도장은 타임스탬프(KST 자정을 UTC 로 저장)라 UTC 날짜부로 비교하면 (사)가
// 하루 어긋난 도장을 놓치거나 같은 날을 다르다고 운다.
import {
  auditCashReceipts, isBornDeadLine, stampDateMismatches, hasCashReceiptIntentMemo, CASH_RECEIPT_REFUND_PENDING_WARN_DAYS,
  type AuditLine, type AuditRecord, type CashReceiptAuditInput,
} from '../lib/cashReceiptAudit'

let pass = 0, fail = 0
function eq(name: string, got: unknown, want: unknown) {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${JSON.stringify(want)}\n    실제 ${JSON.stringify(got)}`)
}

const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)     // @db.Date 저장 정본
const kst = (s: string) => new Date(`${s}+09:00`)                 // KST 시각
const L = 'lease-1'
const M = '계좌이체'

let seq = 0
function line(over: Partial<AuditLine> = {}): AuditLine {
  return {
    id: `line-${++seq}`, leaseTermId: L, payDate: day('2026-10-06'), payMethod: M,
    amount: 410000, issuedAt: kst('2026-10-12T00:00:00'), createdAt: kst('2026-10-06T10:15:00'),
    inclDeposit: false, inclCleaning: false, memo: null, ...over,
  }
}
function rec(over: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: `rec-${++seq}`, leaseTermId: L, payDate: day('2026-10-06'), payMethod: M,
    actualAmount: 410000, isDeposit: false, isBillingAdjust: false,
    cashReceiptIssuedAt: kst('2026-10-12T00:00:00'), deletedAt: null, ...over,
  }
}
function run(p: Partial<CashReceiptAuditInput>) {
  return auditCashReceipts({ lines: [], records: [], refundDeletedIds: new Set(), todayYmd: '2026-10-14', knownBornDead: {}, ...p })
}
const axes = (r: ReturnType<typeof run>) => r.violations.map(v => v.axis)

// ── 깨끗한 재료는 침묵한다 ─────────────────────────────────────
{
  const r = run({ lines: [line()], records: [rec()] })
  eq('깨끗함 위반 없음', axes(r), [])
  eq('깨끗함 경고·정보 없음', [r.warnings.length, r.partial.length, r.pending.length, r.bornDeadKnown.length], [0, 0, 0, 0])
  // 한 결제를 두 달로 쪼갠 키(422호 원래 모양). 줄 한 장이 두 행을 덮고 둘 다 도장이면 정상이다.
  const r2 = run({ lines: [line({ amount: 420000 })], records: [rec(), rec({ actualAmount: 10000 })] })
  eq('분할 결제 한 장 정상', axes(r2), [])
}

// ── (가) 유령 줄 / 환불 대기 / (차) ───────────────────────────────
{
  // 유령 줄은 살아 있는 몫이 0 이라 (바)도 함께 운다. 종전 점검부터 그랬다((바)가 비켜 가는 것은 환불 대기뿐이다).
  eq('(가) 수납 없는 줄', axes(run({ lines: [line()], records: [] })), ['가', '바'])
  // 운영자가 그냥 지운 수납은 환불 스냅샷에 없다. 유령이다.
  const gone = rec({ deletedAt: kst('2026-10-07T09:00:00') })
  eq('(가) 그냥 지운 수납', axes(run({ lines: [line()], records: [gone] })), ['가', '바'])
  // 환불이 지운 수납이면 환불 대기. 유령으로 울지 않는다.
  const refunded = rec({ deletedAt: kst('2026-10-07T09:00:00') })
  const r = run({ lines: [line()], records: [refunded], refundDeletedIds: new Set([refunded.id]) })
  eq('환불 대기는 (가) 아님', axes(r), [])
  eq('환불 대기 경과 일수(KST 날짜)', r.pending.map(p => p.ageDays), [7])
  eq('환불 대기 7일 경고 없음', r.warnings.length, 0)
  // (차) 경계. 정확히 30일은 아직, 31일부터 경고. 실패로 세지 않는다.
  const at30 = run({ lines: [line()], records: [refunded], refundDeletedIds: new Set([refunded.id]), todayYmd: '2026-11-06' })
  eq('(차) 30일은 경고 없음', [at30.pending[0]?.ageDays, at30.warnings.length], [CASH_RECEIPT_REFUND_PENDING_WARN_DAYS, 0])
  const at31 = run({ lines: [line()], records: [refunded], refundDeletedIds: new Set([refunded.id]), todayYmd: '2026-11-07' })
  eq('(차) 31일 경고', at31.warnings.map(w => w.axis), ['차'])
  eq('(차) 경고는 위반이 아니다', axes(at31), [])
  // 환불 확정이 KST 새벽(UTC 전날)이면 KST 날짜로 센다.
  const dawn = rec({ deletedAt: new Date('2026-10-06T16:30:00.000Z') })   // KST 10/7 01:30
  const rd = run({ lines: [line()], records: [dawn], refundDeletedIds: new Set([dawn.id]) })
  eq('환불 대기 KST 새벽 경계', rd.pending.map(p => p.ageDays), [7])
}

// ── (나) 빠진 줄 ─────────────────────────────────────────────
{
  eq('(나) 도장 있는데 줄 없음', axes(run({ lines: [], records: [rec()] })), ['나'])
  eq('(나) 같은 키 두 행은 한 번만', axes(run({ lines: [], records: [rec(), rec({ actualAmount: 10000 })] })), ['나'])
}

// ── (라)·(마) ───────────────────────────────────────────────
{
  const r = run({ lines: [line({ amount: 460000, inclDeposit: true })], records: [rec(), rec({ isDeposit: true, actualAmount: 50000 })] })
  eq('(라) 보증금 포함 줄', axes(r), ['라'])
  const r2 = run({ lines: [line()], records: [rec(), rec({ isDeposit: true, actualAmount: 50000 })] })
  eq('(마) 보증금 도장 줄이 안 받침', axes(r2), ['마'])
}

// ── (바) 초과 ───────────────────────────────────────────────
{
  // 422호 지금 모양. 10,000 선납을 지우고 줄은 420,000 그대로.
  const r = run({ lines: [line({ amount: 420000 })], records: [rec(), rec({ actualAmount: 10000, deletedAt: kst('2026-10-12T18:35:00') })] })
  eq('(바) 422호 형제 삭제 뒤 초과', axes(r), ['바'])
  // 일부만 도장 찍힌 키에서 줄이 안 덮인 돈까지 들었다. 키 전체 합(400,000)보다는 작아 종전 기준으로는 못 잡았다.
  const partialOver = run({
    lines: [line({ amount: 400000 })],
    records: [rec({ actualAmount: 300000 }), rec({ actualAmount: 100000, cashReceiptIssuedAt: null })],
  })
  eq('(바) 일부 도장 키 초과', axes(partialOver), ['바'])
  eq('(바) 문장이 도장 찍힌 몫을 말한다', /도장 찍힌 이용료 몫 300,000원/.test(partialOver.violations[0]?.text ?? ''), true)
  // 환불 대기는 비켜 간다.
  const refunded = rec({ deletedAt: kst('2026-10-07T09:00:00') })
  eq('(바) 환불 대기 비켜 감', axes(run({ lines: [line({ amount: 999999 })], records: [refunded], refundDeletedIds: new Set([refunded.id]) })), [])
  // 예외 몫 줄은 (라)가 말한다. (바)로 겹쳐 울지 않는다.
  eq('(바) 예외 몫 줄 비켜 감', axes(run({ lines: [line({ amount: 999999, inclCleaning: true })], records: [rec()] })), ['라'])
  // 조정 전표는 받은 돈이 아니다.
  eq('(바) 조정 전표 안 셈', axes(run({ lines: [line({ amount: 420000 })], records: [rec(), rec({ actualAmount: 10000, isBillingAdjust: true, cashReceiptIssuedAt: null })] })), ['바'])
}

// ── (사) 도장 날짜 ───────────────────────────────────────────
{
  // 줄은 KST 10/12 00:00(UTC 10/11 15:00). 도장이 KST 10/11 23:59(UTC 날짜는 같은 10/11)면 다른 날이다.
  const r = run({ lines: [line()], records: [rec({ cashReceiptIssuedAt: new Date('2026-10-11T14:59:00.000Z') })] })
  eq('(사) KST 하루 앞 도장', axes(r), ['사'])
  eq('(사) 문장이 KST 날짜를 말한다', /다른 날\(2026-10-11\)/.test(r.violations[0]?.text ?? ''), true)
  // KST 10/12 23:00(UTC 날짜는 10/12 로 줄의 UTC 날짜 10/11 과 다르다)은 같은 날이다.
  eq('(사) KST 같은 날 다른 시각', axes(run({ lines: [line()], records: [rec({ cashReceiptIssuedAt: new Date('2026-10-12T14:00:00.000Z') })] })), [])
  // 한 키에 행이 여럿이어도 키 단위로 한 줄.
  const multi = run({ lines: [line({ amount: 420000 })], records: [rec({ cashReceiptIssuedAt: kst('2026-10-06T00:00:00') }), rec({ actualAmount: 10000, cashReceiptIssuedAt: kst('2026-10-06T00:00:00') })] })
  eq('(사) 키 단위 한 줄', axes(multi), ['사'])
  // 보증금 도장은 줄이 보증금을 안 들었으면 (마)다. (사)로 겹쳐 울지 않는다.
  eq('(사) 보증금 행은 (마)가 말함', axes(run({ lines: [line()], records: [rec(), rec({ isDeposit: true, actualAmount: 50000, cashReceiptIssuedAt: kst('2026-10-01T00:00:00') })] })), ['마'])
  eq('(사) 순수 함수', stampDateMismatches({ issuedAt: kst('2026-10-12T00:00:00'), inclDeposit: false }, [
    { isDeposit: false, cashReceiptIssuedAt: kst('2026-10-12T09:00:00') },
    { isDeposit: false, cashReceiptIssuedAt: kst('2026-10-13T00:00:00') },
    { isDeposit: false, cashReceiptIssuedAt: null },
  ]), ['2026-10-13'])
}

// ── (아) 일부만 도장. 정보다 ─────────────────────────────────────
{
  const r = run({
    lines: [line({ amount: 300000 })],
    records: [rec({ actualAmount: 300000 }), rec({ actualAmount: 100000, cashReceiptIssuedAt: null }), rec({ actualAmount: 0, cashReceiptIssuedAt: null })],
  })
  eq('(아) 위반 아님', axes(r), [])
  eq('(아) 덮이지 않은 금액·건수(0원 행 제외)', r.partial.map(p => [p.unstampedRows, p.unstampedRent]), [[1, 100000]])
  // 전부 도장이거나 도장이 없으면 (아)가 아니다(도장 없는 줄은 (가)·환불 대기가 말한다).
  eq('(아) 전부 도장은 아님', run({ lines: [line()], records: [rec()] }).partial.length, 0)
  eq('(아) 도장 없는 줄은 (가)', axes(run({ lines: [line()], records: [rec({ cashReceiptIssuedAt: null })] })), ['가'])
}

// ── (자) 태어날 때부터 죽은 줄 ─────────────────────────────────────
{
  // 519호 모양. 수납은 7/20 환불로 지워졌고 줄은 8/24 백필이 만들었다. 환불 스냅샷에 있어 환불 대기로도 보인다.
  const gone = rec({ payDate: day('2026-07-18'), actualAmount: 470000, cashReceiptIssuedAt: kst('2026-07-18T19:56:44'), deletedAt: kst('2026-07-20T14:03:27') })
  const l519 = line({ payDate: day('2026-07-18'), amount: 470000, issuedAt: kst('2026-07-18T19:56:44'), createdAt: kst('2026-08-24T23:07:13') })
  const base = { lines: [l519], records: [gone], refundDeletedIds: new Set([gone.id]) }
  eq('(자) 백필이 되살린 줄', axes(run(base)), ['자'])
  eq('(자) 알려진 줄은 넘김', [axes(run({ ...base, knownBornDead: { [l519.id]: '519호' } })), run({ ...base, knownBornDead: { [l519.id]: '519호' } }).bornDeadKnown.length], [[], 1])
  // 정리 뒤(줄 소프트삭제) 알려진 목록이 남아 있으면 기준선이 낡았다고 운다.
  const stale = run({ lines: [], records: [gone], refundDeletedIds: new Set([gone.id]), knownBornDead: { [l519.id]: '519호' } })
  eq('(자) 기준선 낡음', axes(stale), ['자'])
  eq('(자) 낡음 문장', /기준선이 낡았다/.test(stale.violations[0]?.text ?? ''), true)
  // 줄이 먼저 서고 수납이 뒤에 지워졌으면 (자)가 아니다(유령 (가)이거나 환불 대기다).
  const later = line({ payDate: day('2026-07-18'), amount: 470000, createdAt: kst('2026-07-18T19:57:00') })
  eq('(자) 뒤에 지운 것은 (가)', axes(run({ lines: [later], records: [gone] })), ['가', '바'])
  eq('(자) 순수 함수 수납 없음은 아님', isBornDeadLine({ createdAt: kst('2026-08-24T00:00:00') }, []), false)
  eq('(자) 순수 함수 하나라도 살아 있으면 아님', isBornDeadLine({ createdAt: kst('2026-08-24T00:00:00') }, [
    { deletedAt: kst('2026-07-20T00:00:00'), isBillingAdjust: false }, { deletedAt: null, isBillingAdjust: false },
  ]), false)
  eq('(자) 순수 함수 조정 전표는 안 셈', isBornDeadLine({ createdAt: kst('2026-08-24T00:00:00') }, [
    { deletedAt: kst('2026-07-20T00:00:00'), isBillingAdjust: false }, { deletedAt: null, isBillingAdjust: true },
  ]), true)
}

// ── (카) 의도 없는 미달 ─────────────────────────────────────────
{
  eq('(카) 메모 없는 미달', axes(run({ lines: [line({ amount: 300000 })], records: [rec()] })), ['카'])
  eq('(카) 공백 메모는 의도 아님', axes(run({ lines: [line({ amount: 300000, memo: '  ' })], records: [rec()] })), ['카'])
  eq('(카) 메모 있으면 통과', axes(run({ lines: [line({ amount: 300000, memo: '세무사 확인 뒤 30만원만 발행' })], records: [rec()] })), [])
  // 일부만 도장 찍힌 키는 도장 찍힌 몫과 견준다. 줄이 그 몫과 같으면 덮이지 않은 돈이 있어도 미달이 아니다.
  eq('(카) 일부 도장 키는 도장 찍힌 몫 기준', axes(run({ lines: [line({ amount: 300000 })], records: [rec({ actualAmount: 300000 }), rec({ actualAmount: 100000, cashReceiptIssuedAt: null })] })), [])
  eq('(카) 일부 도장 키 미달', axes(run({ lines: [line({ amount: 250000 })], records: [rec({ actualAmount: 300000 }), rec({ actualAmount: 100000, cashReceiptIssuedAt: null })] })), ['카'])
  eq('(카) 의도 메모 판정', [hasCashReceiptIntentMemo(null), hasCashReceiptIntentMemo(''), hasCashReceiptIntentMemo(' x ')], [false, false, true])
}

// ── 축 차례 ─────────────────────────────────────────────────
{
  const r = run({
    lines: [line({ id: 'a', amount: 999999 }), line({ id: 'b', leaseTermId: 'lease-2', amount: 1 })],
    records: [rec(), rec({ leaseTermId: 'lease-2' }), rec({ leaseTermId: 'lease-3' })],
  })
  eq('축 차례 (나)·(바)·(카)', axes(r), ['나', '바', '카'])
}

console.log(`[현금영수증 점검 판정] ${pass} 통과 / ${fail} 실패`)
process.exit(fail > 0 ? 1 : 0)
