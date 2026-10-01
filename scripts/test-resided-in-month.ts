// 그 달 거주 판정(residedInMonth)·체류 끝·청구 끝 경계 회귀 테스트 — 실행: npx tsx scripts/test-resided-in-month.ts
//
// 신고 70addd65(2026-10-01, 513호). 9/30 퇴실·10/1 처리된 계약이 9월 홈·수납 관리에서 사라졌다 —
// 화면이 '오늘의 status' 로 사람을 골랐기 때문이다. 과거 달의 사람은 그 달의 날짜가 정한다.
// 여기서 고정하는 것: 말일 퇴실·1일 퇴실/입주 경계, 예정일만 있는 계약, 비거주·예약·취소·투어,
// 끝 없는 퇴실 계약, 체류 끝(실제 ?? 예정)과 청구 끝(예정 ?? 실제)의 순서, roomLeaseRowOrder 옵션.

import { leaseBillingEnd, leaseStayEnd, residedInMonth, roomLeaseRowOrder } from '../lib/leaseStatus'

let pass = 0
let fail = 0
function eq(name: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a === e) { pass++; return }
  fail++
  console.error(`FAIL ${name}\n  기대: ${e}\n  실제: ${a}`)
}

type L = { status: string; moveInDate?: string | Date | null; moveOutDate?: string | Date | null; expectedMoveOut?: string | Date | null }
const cases: { name: string; l: L; month: string; expect: boolean }[] = [
  // 513호 그대로 — 말일 퇴실은 그 달의 거주자다. 다음 달에는 아니다.
  { name: '말일 퇴실 · 그 달', l: { status: 'CHECKED_OUT', moveInDate: '2023-06-23', moveOutDate: '2026-09-30', expectedMoveOut: '2026-09-30' }, month: '2026-09', expect: true },
  { name: '말일 퇴실 · 다음 달', l: { status: 'CHECKED_OUT', moveInDate: '2023-06-23', moveOutDate: '2026-09-30', expectedMoveOut: '2026-09-30' }, month: '2026-10', expect: false },
  { name: '말일 퇴실 · 입주 전 달', l: { status: 'CHECKED_OUT', moveInDate: '2023-06-23', moveOutDate: '2026-09-30', expectedMoveOut: '2026-09-30' }, month: '2023-05', expect: false },
  // @db.Date(UTC 자정) 값으로 와도 같은 답 — 실행 환경 시간대가 섞이면 안 된다.
  { name: 'Date 객체 · 말일 퇴실', l: { status: 'CHECKED_OUT', moveInDate: new Date('2023-06-23T00:00:00Z'), moveOutDate: new Date('2026-09-30T00:00:00Z') }, month: '2026-09', expect: true },
  { name: 'Date 객체 · 다음 달', l: { status: 'CHECKED_OUT', moveInDate: new Date('2023-06-23T00:00:00Z'), moveOutDate: new Date('2026-09-30T00:00:00Z') }, month: '2026-10', expect: false },
  // 1일 경계 — 1일 퇴실도 그 달에 하루 살았고, 1일 입주는 그 달부터다.
  { name: '1일 퇴실 · 그 달', l: { status: 'CHECKED_OUT', moveInDate: '2026-08-10', moveOutDate: '2026-09-01' }, month: '2026-09', expect: true },
  { name: '1일 입주 · 그 달', l: { status: 'ACTIVE', moveInDate: '2026-09-01' }, month: '2026-09', expect: true },
  { name: '1일 입주 · 전달', l: { status: 'ACTIVE', moveInDate: '2026-09-01' }, month: '2026-08', expect: false },
  // 실제 퇴실일 없이 예정일만 — 진행 중 계약의 끝은 예정일이다.
  { name: '예정일만 · 그 달', l: { status: 'CHECKOUT_PENDING', moveInDate: '2026-01-01', expectedMoveOut: '2026-09-15' }, month: '2026-09', expect: true },
  { name: '예정일만 · 다음 달', l: { status: 'CHECKOUT_PENDING', moveInDate: '2026-01-01', expectedMoveOut: '2026-09-15' }, month: '2026-10', expect: false },
  { name: '퇴실 완료 · 예정일만', l: { status: 'CHECKED_OUT', moveInDate: '2026-01-01', expectedMoveOut: '2026-09-15' }, month: '2026-09', expect: true },
  // 체류 끝은 실제 퇴실일이 먼저 — 일찍 나간 사람은 실제로 나간 달까지다.
  { name: '조기 퇴실 · 예정 달은 아님', l: { status: 'CHECKED_OUT', moveInDate: '2026-01-01', moveOutDate: '2026-08-20', expectedMoveOut: '2026-09-30' }, month: '2026-09', expect: false },
  // 끝이 없는 퇴실 계약은 기록이 빠진 것 — 모든 달에 서게 두지 않는다.
  { name: '끝 없는 퇴실 계약', l: { status: 'CHECKED_OUT', moveInDate: '2026-01-01' }, month: '2026-09', expect: false },
  // 진행 중 계약은 끝이 미정이면 계속 산다.
  { name: '무기한 거주', l: { status: 'ACTIVE', moveInDate: '2025-01-01' }, month: '2026-09', expect: true },
  { name: '입주일 미정 거주', l: { status: 'ACTIVE', moveInDate: null }, month: '2026-09', expect: true },
  // 비거주 — 종전 청구 게이트(billableInTargetMonth)와 같게 입주월 게이트를 받는다.
  { name: '비거주 · 입주 후', l: { status: 'NON_RESIDENT', moveInDate: '2026-05-11' }, month: '2026-09', expect: true },
  { name: '비거주 · 입주 전 달', l: { status: 'NON_RESIDENT', moveInDate: '2026-05-11' }, month: '2026-04', expect: false },
  { name: '비거주 · 날짜 없음', l: { status: 'NON_RESIDENT' }, month: '2026-09', expect: true },
  // 예약 — 입주월 게이트 그대로(getReservedFullMonthRevenueByMonths 종전 규칙).
  { name: '예약 · 입주월', l: { status: 'RESERVED', moveInDate: '2026-10-05' }, month: '2026-10', expect: true },
  { name: '예약 · 입주 전 달', l: { status: 'RESERVED', moveInDate: '2026-10-05' }, month: '2026-09', expect: false },
  { name: '예약 · 퇴실 예정 다음 달', l: { status: 'RESERVED', moveInDate: '2026-10-05', expectedMoveOut: '2026-10-20' }, month: '2026-11', expect: false },
  // 방에 들어온 적이 없는 단계는 날짜와 무관하게 아니다.
  { name: '취소', l: { status: 'CANCELLED', moveInDate: '2026-10-01' }, month: '2026-10', expect: false },
  { name: '투어 대기', l: { status: 'WAITING_TOUR', moveInDate: '2026-10-01' }, month: '2026-10', expect: false },
  { name: '투어 완료', l: { status: 'TOUR_DONE', moveInDate: '2026-10-01' }, month: '2026-10', expect: false },
]
for (const c of cases) eq(c.name, residedInMonth(c.l, c.month), c.expect)

// 체류 끝(실제 ?? 예정) · 청구 끝(예정 ?? 실제) — 순서가 반대인 것이 규칙이다(501호: 예정 6/30·처리 7/1).
eq('체류 끝 · 실제 퇴실일 우선', leaseStayEnd({ moveOutDate: '2026-07-01', expectedMoveOut: '2026-06-30' }), '2026-07-01')
eq('체류 끝 · 예정일만', leaseStayEnd({ expectedMoveOut: '2026-06-30' }), '2026-06-30')
eq('체류 끝 · 둘 다 없음', leaseStayEnd({}), null)
eq('청구 끝 · 예정일 우선', leaseBillingEnd({ moveOutDate: '2026-07-01', expectedMoveOut: '2026-06-30' }), '2026-06-30')
eq('청구 끝 · 예정일 없으면 실제', leaseBillingEnd({ moveOutDate: '2026-05-01', expectedMoveOut: null }), '2026-05-01')

// roomLeaseRowOrder — 옵션을 안 켜면 종전대로 퇴실을 버리고, 켜면 거주 층에 입주일 순으로 세운다.
type R = { id: string; status: string; moveInDate: string | null }
const room513: R[] = [
  { id: 'resv', status: 'RESERVED', moveInDate: '2026-10-05' },
  { id: 'out', status: 'CHECKED_OUT', moveInDate: '2023-06-23' },
]
eq('행 순서 · 옵션 없음은 퇴실 제외', roomLeaseRowOrder(room513).map(l => l.id), ['resv'])
eq('행 순서 · 513호 9월(퇴실자 먼저, 예약 다음)', roomLeaseRowOrder(room513, { checkedOutAsResiding: true }).map(l => l.id), ['out', 'resv'])
const room506: R[] = [
  { id: 'new', status: 'ACTIVE', moveInDate: '2026-09-05' },
  { id: 'out', status: 'CHECKED_OUT', moveInDate: '2026-08-10' },
  { id: 'nr', status: 'NON_RESIDENT', moveInDate: '2026-01-01' },
]
eq('행 순서 · 같은 달 퇴실자와 새 입주자는 입주일 순, 비거주 끝', roomLeaseRowOrder(room506, { checkedOutAsResiding: true }).map(l => l.id), ['out', 'new', 'nr'])

console.log(`resided-in-month: ${pass} pass, ${fail} fail`)
if (fail > 0) process.exit(1)
