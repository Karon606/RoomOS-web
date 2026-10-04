// 선납 이월(lib/prepaidCarry) 회귀 + 수납 요약 카드 문구 그물 — 실행: npx tsx scripts/test-prepaid-carry.ts
//
// 고정하는 것(2026-10-05 운영자 승인, 502호 "매달 1,500원씩 더 내 이월시키는데 왜 0원이지").
//   · 502호 시나리오: 9월 out 1,500 / 10월 in 1,500·out 3,000 / 11월 in 3,000
//   · 다중 달 선납(한 번에 여러 달분), 지연납(앞 달분을 이번 달에 냄 → in/out 아님), 보증금·청구 조정 제외
//   · 항등: outByMonth(M)[M+1] === prepaidIn(M+1) 은 늘, prepaidOut(M) === prepaidIn(M+1) 은 다음 달 하나일 때만
//   · 입금월은 UTC 날짜부(@db.Date 정본) — 말일·1일 경계 record 가 옆 달로 새지 않는다
//   · 소스: 카드 머리에 '입금일 기준' 없음(발생주의 전환 뒤 거짓), 수납 목록에 '(+이월액' 없음,
//     카드 셋째 칸이 prepaidIn/prepaidOut 을 읽고 --coral 고정이 없다, 서버가 정본 함수를 지난다
import fs from 'node:fs'
import path from 'node:path'
import { prepaidCarry, type PrepaidCarryRecord } from '../lib/prepaidCarry'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}
const D = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`)   // @db.Date 저장 정본(UTC 자정)
const R = (targetMonth: string, ymd: string, actualAmount: number, extra: Partial<PrepaidCarryRecord> = {}): PrepaidCarryRecord =>
  ({ targetMonth, payDate: D(ymd), actualAmount, ...extra })

// ── 502호: 월 420,000, 매달 421,500 입금, FIFO 가 앞 달을 채우고 남은 돈을 다음 달 record 로 민다 ──
const r502: PrepaidCarryRecord[] = [
  R('2026-08', '2026-08-06', 420000),
  R('2026-09', '2026-09-06', 420000),
  R('2026-10', '2026-09-06', 1500),      // 9월 입금의 남은 몫 → 10월분
  R('2026-10', '2026-10-06', 418500),
  R('2026-11', '2026-10-06', 3000),      // 10월 입금의 남은 몫 → 11월분
]
eq('502 9월', prepaidCarry(r502, '2026-09'), { prepaidIn: 0, prepaidOut: 1500, outByMonth: { '2026-10': 1500 } })
eq('502 10월', prepaidCarry(r502, '2026-10'), { prepaidIn: 1500, prepaidOut: 3000, outByMonth: { '2026-11': 3000 } })
eq('502 11월', prepaidCarry(r502, '2026-11'), { prepaidIn: 3000, prepaidOut: 0, outByMonth: {} })
eq('502 8월(아직 넘긴 돈 없음)', prepaidCarry(r502, '2026-08'), { prepaidIn: 0, prepaidOut: 0, outByMonth: {} })

// ── 다중 달 선납: 9/1 에 10·11·12월분을 한 번에 ──
const multi: PrepaidCarryRecord[] = [
  R('2026-09', '2026-09-01', 400000),
  R('2026-10', '2026-09-01', 400000),
  R('2026-11', '2026-09-01', 400000),
  R('2026-12', '2026-09-01', 400000),
]
eq('다중 9월', prepaidCarry(multi, '2026-09'), { prepaidIn: 0, prepaidOut: 1200000, outByMonth: { '2026-10': 400000, '2026-11': 400000, '2026-12': 400000 } })
eq('다중 10월', prepaidCarry(multi, '2026-10'), { prepaidIn: 400000, prepaidOut: 800000, outByMonth: { '2026-11': 400000, '2026-12': 400000 } })
eq('다중 12월', prepaidCarry(multi, '2026-12'), { prepaidIn: 400000, prepaidOut: 0, outByMonth: {} })
// prepaidOut(M) 은 prepaidIn(M+1) 보다 M+2 이후 몫만큼 크다 — 다음 달 하나가 아니면 등호가 깨지는 게 정의다.
eq('다중 9월 out = 10월 in + 10월 out', prepaidCarry(multi, '2026-09').prepaidOut,
  prepaidCarry(multi, '2026-10').prepaidIn + prepaidCarry(multi, '2026-10').prepaidOut)

// ── 지연납: 9월분을 10/2 에 냄 → 귀속월 9월·입금월 10월. 앞 달 미수 정리라 선납 이월이 아니다 ──
const late: PrepaidCarryRecord[] = [R('2026-09', '2026-10-02', 420000), R('2026-10', '2026-10-06', 420000)]
eq('지연납 9월', prepaidCarry(late, '2026-09'), { prepaidIn: 0, prepaidOut: 0, outByMonth: {} })
eq('지연납 10월', prepaidCarry(late, '2026-10'), { prepaidIn: 0, prepaidOut: 0, outByMonth: {} })

// ── 보증금·청구 조정 전표 제외 ──
const dep: PrepaidCarryRecord[] = [
  R('2026-10', '2026-09-20', 500000, { isDeposit: true }),
  R('2026-10', '2026-09-20', 0, { isBillingAdjust: true }),
  R('2026-10', '2026-09-20', 7000, { isBillingAdjust: true }),
  R('2026-10', '2026-09-20', 2000),
]
eq('보증금·조정 제외 9월', prepaidCarry(dep, '2026-09'), { prepaidIn: 0, prepaidOut: 2000, outByMonth: { '2026-10': 2000 } })
eq('보증금·조정 제외 10월', prepaidCarry(dep, '2026-10').prepaidIn, 2000)

// ── 경계: 말일·1일. 문자열 payDate 도 같은 뜻 ──
const edge: PrepaidCarryRecord[] = [
  R('2026-11', '2026-10-31', 1000),
  { targetMonth: '2026-11', payDate: '2026-11-01T00:00:00.000Z', actualAmount: 9000 },
]
eq('경계 10월(10/31 만 out)', prepaidCarry(edge, '2026-10'), { prepaidIn: 0, prepaidOut: 1000, outByMonth: { '2026-11': 1000 } })
eq('경계 11월(11/1 은 같은 달 입금이라 in 아님)', prepaidCarry(edge, '2026-11').prepaidIn, 1000)

// ── 항등(무작위): outByMonth(M)[M+1] === prepaidIn(M+1) ──
{
  const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08']
  let seed = 7
  const rnd = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n }
  let bad = 0
  for (let trial = 0; trial < 300; trial++) {
    const recs: PrepaidCarryRecord[] = []
    for (let k = 0; k < 8; k++) {
      const t = rnd(months.length), p = rnd(months.length)
      recs.push(R(months[t], `${months[p]}-${String(1 + rnd(28)).padStart(2, '0')}`, 1000 * (1 + rnd(50)), { isDeposit: rnd(6) === 0 }))
    }
    for (let i = 0; i < months.length - 1; i++) {
      const out = prepaidCarry(recs, months[i]).outByMonth[months[i + 1]] ?? 0
      if (out !== prepaidCarry(recs, months[i + 1]).prepaidIn) bad++
    }
  }
  eq('항등 outByMonth(M)[M+1] === prepaidIn(M+1) (무작위 300회)', bad, 0)
}
// 다음 달 하나에만 걸리면 out(M) === in(M+1)
eq('502 항등 9→10', prepaidCarry(r502, '2026-09').prepaidOut, prepaidCarry(r502, '2026-10').prepaidIn)
eq('502 항등 10→11', prepaidCarry(r502, '2026-10').prepaidOut, prepaidCarry(r502, '2026-11').prepaidIn)

// ── 소스 그물 ────────────────────────────────────────────────────
const root = path.resolve(__dirname, '..')
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')
const card = read('components/entity-modal/widgets/PaymentSummaryCards.tsx')
const rooms = read('app/(app)/rooms/RoomsClient.tsx')
const actions = read('app/(app)/rooms/actions.ts')
eq("카드에 '입금일 기준' 없음", card.includes('입금일 기준'), false)
eq("카드 머리 '귀속월 기준'", card.includes('귀속월 기준'), true)
eq('카드가 prepaidIn·prepaidOut 을 읽는다', /settlement\.prepaidIn/.test(card) && /settlement\.prepaidOut/.test(card), true)
eq('카드 셋째 칸 --coral 고정 없음', card.includes('var(--coral)'), false)
eq("카드 라벨 '다음 달로'·'지난달 미수'", card.includes("'다음 달로'") && card.includes("'지난달 미수'"), true)
eq("수납 목록에 '(+이월액' 없음", rooms.includes('(+이월액'), false)
eq('서버가 정본 prepaidCarry 를 지난다', /prepaidCarry\(postCutoffRecords, targetMonth\)/.test(actions), true)
eq('서버 행 두 갈래(미래월·현재)에 prepaidIn·prepaidOut', (actions.match(/carryOver: displayCarryOver, prepaidIn, prepaidOut/g) ?? []).length, 2)

if (fails.length) {
  console.error(`test-prepaid-carry: ${fails.length}건 실패`)
  for (const f of fails) console.error('  - ' + f)
  process.exit(1)
}
console.log(`test-prepaid-carry: ${pass}건 통과`)
