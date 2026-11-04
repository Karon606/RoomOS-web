// 계약 정보 '월 이용료' 칸의 '할인 후' 금액 진리표와 엔진 항등식. 실행: npx tsx scripts/test-rent-view.ts
//
// 운영자 승인 '추천대로'(2026-11-04). 정본 lib/rentView 는 엔진 조각(effectiveBaseRent·discountForMonth·discountedRent)만 묶는다.
// 이 표는 두 가지를 고정한다.
//   ① 줄을 세우는 조건. 이번 달 할인이 실제로 걸리고(discount > 0) 그 달 기준액이 주 값(계약 금액)과 같을 때만(순수 할인).
//   ② 줄이 서면 그 값은 그 달 엔진 요율(viewExpectedForMonth 의 비일할 달 값)과 원 단위로 같다.
// 금액 스코프 없는 역할의 null 은 서버 몫이라 통합 테스트(test-action-property-scope-flow)가 본다.
import { monthlyRentView, rentViewMonth, rentAfterDiscountLine, rentAfterDiscountFor, type RentViewLease } from '../lib/rentView'
import { effectiveBaseRent, billForLeaseMonth } from '../lib/billing'
import { discountedRent, type RentDiscountInput } from '../lib/rentDiscount'
import { viewExpectedForMonth } from '../lib/roomMonth'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.log(`  실패 ${name}\n    기대 ${e}\n    실제 ${a}`)
}

type L = RentViewLease & { isShortTerm?: boolean; cycleDay?: string | null }
const P = (value: number, startMonth: string | null = null, endMonth: string | null = null): RentDiscountInput =>
  ({ discountType: 'amount', value, scope: 'permanent', startMonth, endMonth })
const T = (value: number, startMonth: string | null, endMonth: string | null = null): RentDiscountInput =>
  ({ discountType: 'amount', value, scope: 'temporary', startMonth, endMonth })
const PCT = (value: number): RentDiscountInput => ({ discountType: 'percent', value, scope: 'permanent' })
const lease = (o: Partial<L> = {}): L => ({ status: 'ACTIVE', rentAmount: 470000, dueDay: '10', moveInDate: '2026-03-10', discounts: [], room: null, ...o })

const NOW = '2026-11'

// 엔진 항등식. 줄을 세우든 안 세우든 view 는 엔진 값과 같아야 하고, 줄이 서면 그 값은 그 달 요율이다.
function identity(name: string, l: L, today: string) {
  const mon = rentViewMonth(l, today)
  if (!mon) return
  const view = monthlyRentView(l, mon)
  const base = effectiveBaseRent(l, mon)
  eq(`${name} · 항등 base`, view.base, base)
  eq(`${name} · 항등 net = discountedRent(base)`, view.net, discountedRent(l.discounts, mon, base))
  eq(`${name} · 항등 net = base - discount`, view.net, Math.max(0, view.base - view.discount))
  const prorated = l.checkoutProratedAmount != null && l.checkoutProratedMonth === mon
  const engine = viewExpectedForMonth({ ...l, cycleDay: l.cycleDay ?? null, discounts: (l.discounts ?? []).map(d => ({ ...d, startMonth: d.startMonth ?? null, endMonth: d.endMonth ?? null })) }, mon)
  if (!prorated) eq(`${name} · 항등 net = viewExpectedForMonth`, view.net, engine)
  const line = rentAfterDiscountLine(l.rentAmount, view)
  if (line != null) {
    eq(`${name} · 줄 값은 할인이 걸린 달에만`, view.discount > 0, true)
    eq(`${name} · 줄 값은 주 값보다 작다`, line < l.rentAmount, true)
    eq(`${name} · 줄 값 = 계약 금액 - 할인(가격 변경 미포함)`, line, Math.max(0, l.rentAmount - view.discount))
    if (!prorated) eq(`${name} · 줄 값 = 엔진 요율`, line, engine)
  }
}

function row(name: string, l: L, expected: number | null, today = NOW) {
  eq(name, rentAfterDiscountFor(l, today), expected)
  identity(name, l, today)
}

// ── 할인 유무와 기간 ──
row('할인 없음', lease(), null)
row('영구 할인, 시작·끝 없음(510호 꼴)', lease({ discounts: [P(30000)] }), 440000)
row('영구 할인, 시작월이 미래', lease({ discounts: [P(30000, '2026-12')] }), null)
row('영구 할인, 끝월이 지난달(중단됨)', lease({ discounts: [P(30000, null, '2026-10')] }), null)
row('영구 할인, 이번 달이 끝월', lease({ discounts: [P(30000, '2026-01', '2026-11')] }), 440000)
row('기간 한정, 시작 전', lease({ discounts: [T(30000, '2026-12', '2027-02')] }), null)
row('기간 한정, 진행 중', lease({ discounts: [T(30000, '2026-10', '2026-12')] }), 440000)
row('기간 한정, 끝난 뒤(10월에 끝난 프로모션)', lease({ discounts: [T(30000, '2026-08', '2026-10')] }), null)
row('기간 한정, 시작월 없음(엔진과 같이 미적용)', lease({ discounts: [T(30000, null, '2026-12')] }), null)
row('기간 한정, 연도 경계 진행 중', lease({ discounts: [T(30000, '2026-12', '2027-02')] }), 440000, '2027-01')
row('비율 3% 반올림(455,555 의 3% = 13,666.65)', lease({ rentAmount: 455555, discounts: [PCT(3)] }), 441888)
row('두 건 중첩(3만 + 1만)', lease({ discounts: [P(30000), T(10000, '2026-11', '2026-11')] }), 430000)
row('두 건 중 하나만 이번 달', lease({ discounts: [P(30000), T(10000, '2026-09', '2026-09')] }), 440000)
row('할인 합계가 기준액 이상(상한, 0원)', lease({ discounts: [P(500000)] }), 0)

// ── 예약 가격 변경(기준액이 계약 금액과 갈라지는 틈). 줄은 순수 할인일 때만 ──
const room = (scheduledRent: number, rentUpdateDate: string) => ({ scheduledRent, rentUpdateDate })
row('인상 예약 전(12월 적용), 이번 달은 계약 금액 기준', lease({ discounts: [P(30000)], room: room(500000, '2026-12-01') }), 440000)
row('인상 적용월 이후, 할인 후 = 계약 금액이면 줄 없음(47만 / 할인 후 47만 모순 방지)', lease({ discounts: [P(30000)], room: room(500000, '2026-11-01') }), null)
row('인상 적용월 이후, 할인 후가 계약 금액보다 크면 줄 없음', lease({ discounts: [P(30000)], room: room(600000, '2026-11-01') }), null)
row('인상 적용월 이후, 할인 후가 계약 금액보다 작아도 가격 변경이 섞여 줄 없음', lease({ discounts: [P(30000)], room: room(480000, '2026-11-01') }), null)
row('인상 적용월 이후, 할인 없음', lease({ room: room(500000, '2026-11-01') }), null)
row('인하 적용월 이후, 할인 없음(기준액만 낮아도 할인 줄이 아니다)', lease({ room: room(450000, '2026-10-01') }), null)
row('인하 적용월 이후, 할인 있음(할인 후 42만이 5만 할인으로 읽히는 꼴, 줄 없음)', lease({ discounts: [P(30000)], room: room(450000, '2026-10-01') }), null)
row('인하 적용 달, 적용일 전이라도 달 단위라 줄 없음', lease({ discounts: [P(30000)], room: room(450000, '2026-11-25') }), null)

// ── 비거주 ──
row('비거주, 거주 인상 예약은 무시하고 계약 금액 기준', lease({ status: 'NON_RESIDENT', rentAmount: 100000, discounts: [P(10000)], room: room(500000, '2026-10-01') }), 90000)
row('비거주, 비거주 인상 이후 줄 없음',
  lease({ status: 'NON_RESIDENT', rentAmount: 100000, discounts: [P(10000)], room: { nonResidentScheduled: 120000, nonResidentRentDate: '2026-10-01' } }), null)
row('비거주, 비거주 인하 이후 줄 없음', lease({ status: 'NON_RESIDENT', rentAmount: 100000, discounts: [P(10000)], room: { nonResidentScheduled: 80000, nonResidentRentDate: '2026-10-01' } }), null)

// ── 단기·예약(기준 달) ──
row('단기, 입주월(9월) 기준으로 할인이 걸림', lease({ isShortTerm: true, rentAmount: 600000, moveInDate: '2026-09-15', discounts: [T(20000, '2026-09', '2026-09')] }), 580000)
row('단기, 이번 달(11월)에만 걸린 할인은 입주월 기준이라 줄 없음', lease({ isShortTerm: true, rentAmount: 600000, moveInDate: '2026-09-15', discounts: [T(20000, '2026-11', '2026-11')] }), null)
eq('단기 기준 달 = 입주월', rentViewMonth({ status: 'ACTIVE', isShortTerm: true, moveInDate: '2026-09-15' }, NOW), '2026-09')
row('예약, 입주월이 미래면 입주월 기준', lease({ status: 'RESERVED', moveInDate: '2027-01-05', discounts: [T(30000, '2027-01')] }), 440000)
row('예약, 입주월이 미래인데 할인이 이번 달에 끝남', lease({ status: 'RESERVED', moveInDate: '2027-01-05', discounts: [T(30000, '2026-11', '2026-11')] }), null)
eq('예약, 입주월이 이번 달 이전이면 이번 달', rentViewMonth({ status: 'RESERVED', moveInDate: '2026-10-01' }, NOW), NOW)
eq('퇴실 예정도 이번 달', rentViewMonth({ status: 'CHECKOUT_PENDING', moveInDate: '2026-01-01' }, NOW), NOW)
for (const s of ['WAITING_TOUR', 'TOUR_DONE', 'CANCELLED', 'CHECKED_OUT', 'INQUIRY']) {
  row(`${s} 은 줄 없음`, lease({ status: s, discounts: [P(30000)] }), null)
  eq(`${s} 기준 달 없음`, rentViewMonth({ status: s }, NOW), null)
}

// ── 요율이지 청구가 아니다(일할·락 미포함) ──
const prorated = lease({ status: 'CHECKOUT_PENDING', discounts: [P(30000)], checkoutProratedAmount: 200000, checkoutProratedMonth: '2026-11' })
row('퇴실 일할 달도 요율(일할액 아님)', prorated, 440000)
eq('퇴실 일할 달의 엔진 표시값은 일할액(대조)', viewExpectedForMonth({ ...prorated, cycleDay: null, discounts: [{ ...P(30000), startMonth: null, endMonth: null }] }, '2026-11'), 200000)
const firstMonth = lease({ moveInDate: '2026-11-20', dueDay: '10', discounts: [P(30000)] })
row('입주달(첫 달 일할 규칙)도 요율', firstMonth, 440000)
eq('입주달의 엔진 청구는 요율과 다르다(대조)', billForLeaseMonth({ ...firstMonth, cycleDay: null, dueDayAdjusts: [] }, '2026-11') !== 440000, true)

// ── 전수 그물: 계약 금액·할인·예약·상태·달을 엇갈려 항등식만 본다 ──
{
  const discs: RentDiscountInput[][] = [[], [P(30000)], [P(10000, '2026-06', '2026-12')], [T(20000, '2026-10', '2026-11')], [PCT(7)], [P(30000), PCT(5)], [P(999999)]]
  const rooms: L['room'][] = [null, room(500000, '2026-11-01'), room(450000, '2027-01-01'), { nonResidentScheduled: 150000, nonResidentRentDate: '2026-09-01' }]
  let cells = 0
  for (const status of ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT', 'RESERVED'])
    for (const rentAmount of [0, 100000, 333333, 470000])
      for (const d of discs)
        for (const r of rooms)
          for (const today of ['2026-09', '2026-11', '2027-02']) {
            identity(`전수 ${status}/${rentAmount}/${today}`, lease({ status, rentAmount, discounts: d, room: r }), today)
            cells++
          }
  eq('전수 칸 수', cells, 4 * 4 * discs.length * rooms.length * 3)
}

console.log(`[test-rent-view] 통과 ${pass} / 실패 ${fail}`)
if (fail > 0) process.exit(1)
