// 수납 관리 수납 상태 정렬(lib/roomsStatusSort) 진리표 + 배지 분기·정렬이 같은 함수를 부르는지 정적 검사. 실행 npx tsx scripts/test-rooms-status-sort.ts
//
// 고정하는 것(신고 db65cce9, 2026-10-19 운영자 '추천대로' 승인).
//   · 묶음은 배지에서 파생: 미납(연체·미납·납부일·납부일 전·지난달분 유예) / 납부 예정(이번 달분 유예 포함) / 완납,
//     꼬리 퇴실 예정(완납이면서 그 달 퇴실) / 청구 없음 / 입실 예약. 보조 배지(단기 퇴실 예정·퇴실 완료·비거주)는 주 배지를 따른다.
//   · 기본(desc): 미납 기한 오래된 순, 납부 예정 nextDueDate 가까운 순, 완납 그 달 몫 받은 날 오래된 순.
//     반대(asc): 본 묶음 셋을 묶음 순서와 묶음 안 키 모두 뒤집는다. 꼬리는 방향과 무관하게 맨 아래 고정.
//   · 동률은 방향과 무관하게 호실 오름차순, 키 없는 행은 양방향 모두 묶음 끝.
//   · 같은 호실 행은 붙어 있고(서버 순서 그대로), 방의 묶음은 가장 급한 행을 따르며 키도 그 행에서 읽는다.
//   · 소스: 카드·표 배지 쌍둥이와 정렬·완납 칩이 paymentBadgeKind 를 부른다, 옛 분기 조건이 남지 않았다,
//     viewMonthPaidAt 은 서버가 이미 읽은 기록에서만 만들고 돈 계산에 안 쓴다, 저장 키·기본 방향·라벨 띄어쓰기.
import fs from 'node:fs'
import path from 'node:path'
import {
  paymentBadgeKind, paymentStatusGroup, sortRowsByPaymentStatus, statusSortKey, statusGroupOrderText,
  STATUS_GROUP_LABEL, getDueInfo, type PaymentStatusRow, type StatusGroup,
  paidSubText, noBillBadgeSub, checkedOutSub, type BadgeSubRow,
} from '../lib/roomsStatusSort'

let pass = 0
const fails: string[] = []
function eq(name: string, got: unknown, want: unknown) {
  const a = JSON.stringify(got), b = JSON.stringify(want)
  if (a === b) { pass++; return }
  fails.push(`${name}: 기대 ${b} / 실제 ${a}`)
}
function ok(name: string, cond: boolean, detail = '') {
  if (cond) { pass++; return }
  fails.push(`${name}${detail ? `: ${detail}` : ''}`)
}

const TODAY = '2026-10-19'
type Row = PaymentStatusRow & { id: string }
let seq = 0
function R(roomNo: string, p: Partial<Row> = {}): Row {
  seq++
  return {
    id: p.id ?? `${roomNo}#${seq}`, roomId: p.roomId ?? `room-${roomNo}`, roomNo,
    status: 'ACTIVE', isPaid: true, dueDay: '5', overrideDueDay: null, overrideDueDayMonth: null,
    firstUnpaidMonth: null, nextDueDate: null, nextDueAmount: 0, noBillReason: null,
    expectedMoveOut: null, moveInDate: null, viewMonthPaidAt: null, ...p,
  }
}
const unpaid = (roomNo: string, dueDay: string, firstUnpaidMonth = '2026-10', p: Partial<Row> = {}) =>
  R(roomNo, { isPaid: false, dueDay, firstUnpaidMonth, ...p })
const awaiting = (roomNo: string, nextDueDate: string, p: Partial<Row> = {}) =>
  R(roomNo, { nextDueDate, nextDueAmount: 400000, dueDay: String(Number(nextDueDate.slice(8))), ...p })
const paid = (roomNo: string, viewMonthPaidAt: string | null, p: Partial<Row> = {}) => R(roomNo, { viewMonthPaidAt, ...p })

function run(rows: Row[], reversed: boolean, targetMonth = '2026-10') {
  return sortRowsByPaymentStatus(rows, { reversed, targetMonth, today: TODAY })
}
const order = (rows: Row[], reversed: boolean, targetMonth = '2026-10') => run(rows, reversed, targetMonth).rows.map(r => r.id)
const shuffle = <T,>(xs: T[], seed: number): T[] => {
  const a = [...xs]; let s = seed
  for (let i = a.length - 1; i > 0; i--) { s = (s * 1103515245 + 12345) % 2147483648; const j = s % (i + 1); [a[i], a[j]] = [a[j], a[i]] }
  return a
}

// ── 0. 옮긴 판정 함수의 종전 동작(경과일·말일·자릿수 넘침) ──
eq('getDueInfo 말일', getDueInfo('말일', '2026-09', TODAY), { days: 19, overdue: true })
eq('getDueInfo 전체 날짜', getDueInfo('2026-10-25', '2026-09', TODAY), { days: 6, overdue: false })
eq('getDueInfo 당일', getDueInfo('19', '2026-10', TODAY), { days: 0, overdue: false })
eq('getDueInfo 2월 31일 넘침(3/3)', getDueInfo('31', '2026-02', '2026-03-03'), { days: 0, overdue: false })
eq('getDueInfo 빈 납부일', getDueInfo(null, '2026-10', TODAY), null)

// ── 1. 미납 셋 양방향 ──
{
  const a = unpaid('409', '8', '2026-10', { id: '409' }), b = unpaid('501', '18', '2026-10', { id: '501' }), c = unpaid('406', '19', '2026-10', { id: '406' })
  eq('미납 셋 기본(오래된 순)', order([c, a, b], false), ['409', '501', '406'])
  eq('미납 셋 반대(최근 미납 순)', order([c, a, b], true), ['406', '501', '409'])
  eq('미납 배지 종류', [a, b, c].map(r => paymentBadgeKind(r, '2026-10', TODAY)), ['unpaid', 'unpaid', 'unpaid'])
}

// ── 2. 지난달분 납부 유예는 미납 묶음, 키는 유예 날짜 ──
{
  const deferred = unpaid('405', '말일', '2026-09', { id: '405', overrideDueDay: '2026-10-25', overrideDueDayMonth: '2026-09' })
  eq('지난달분 유예 종류', paymentBadgeKind(deferred, '2026-10', TODAY), 'deferredUnpaid')
  eq('지난달분 유예 묶음', paymentStatusGroup(deferred, '2026-10', TODAY), 'unpaid')
  eq('지난달분 유예 키', statusSortKey(deferred, 'unpaid', '2026-10'), '2026-10-25')
  const today = unpaid('406', '19', '2026-10', { id: '406' })
  eq('유예는 미납 묶음 끝(기본)', order([deferred, today], false), ['406', '405'])
  eq('유예는 미납 묶음 앞(반대)', order([deferred, today], true), ['405', '406'])
}

// ── 3. 여러 달 밀림: 첫 미납월 약정일이 키 ──
{
  const old = unpaid('523', '20', '2026-08', { id: '523' }), cur = unpaid('409', '8', '2026-10', { id: '409' })
  eq('여러 달 밀림 키', statusSortKey(old, 'unpaid', '2026-10'), '2026-08-20')
  eq('여러 달 밀림이 맨 위', order([cur, old], false), ['523', '409'])
  eq('조정은 첫 미납월에 걸릴 때만', statusSortKey(unpaid('410', '20', '2026-08', { overrideDueDay: '5', overrideDueDayMonth: '2026-10' }), 'unpaid', '2026-10'), '2026-08-20')
  eq('첫 미납월 조정 반영', statusSortKey(unpaid('410', '20', '2026-08', { overrideDueDay: '25', overrideDueDayMonth: '2026-08' }), 'unpaid', '2026-10'), '2026-08-25')
}

// ── 4. 납부 예정 동률은 양방향 모두 호실 오름차순 ──
{
  const rows = [awaiting('520', '2026-10-20', { id: '520' }), awaiting('516', '2026-10-20', { id: '516' }), awaiting('521', '2026-10-22', { id: '521' }),
    awaiting('511', '2026-10-20', { id: '511' }), awaiting('515', '2026-10-20', { id: '515' }), awaiting('418', '2026-10-22', { id: '418' })]
  eq('납부 예정 기본(가까운 순, 동률 호실 오름)', order(rows, false), ['511', '515', '516', '520', '418', '521'])
  eq('납부 예정 반대(먼 순, 동률 호실 오름)', order(rows, true), ['418', '521', '511', '515', '516', '520'])
  eq('호실 숫자 비교(9 < 10)', order([awaiting('1001', '2026-10-20', { id: '1001' }), awaiting('901', '2026-10-20', { id: '901' })], false), ['901', '1001'])
}

// ── 5. 이번 달분 유예는 납부 예정 묶음, 키는 서버가 준 조정일(nextDueDate) ──
{
  const d = awaiting('417', '2026-10-29', { id: '417', dueDay: '9', overrideDueDay: '29', overrideDueDayMonth: '2026-10' })
  eq('이번 달분 유예 종류', paymentBadgeKind(d, '2026-10', TODAY), 'deferredAwait')
  eq('이번 달분 유예 묶음', paymentStatusGroup(d, '2026-10', TODAY), 'awaiting')
  eq('이번 달분 유예 키', statusSortKey(d, 'awaiting', '2026-10'), '2026-10-29')
  eq('이번 달분 유예 자리', order([d, awaiting('523', '2026-10-31', { id: '523' }), awaiting('407', '2026-10-27', { id: '407' })], false), ['407', '417', '523'])
}

// ── 6·7·8. 완납: 선납 9/30 맨 앞, 402형(다음 달 선납과 무관하게 그 달 몫 받은 날), 날짜 없는 완납은 끝 ──
{
  const rows = [paid('518', '2026-10-02', { id: '518' }), paid('402', '2026-10-10', { id: '402' }), paid('420', '2026-09-30', { id: '420' }),
    paid('408', '2026-10-09', { id: '408' }), paid('517', '2026-10-12', { id: '517' }), paid('412', null, { id: '412' }), paid('401', null, { id: '401' })]
  eq('완납 기본(선납 9/30 맨 앞, 날짜 없음 끝)', order(rows, false), ['420', '518', '408', '402', '517', '401', '412'])
  eq('완납 반대(최근 납부 순, 날짜 없음 그래도 끝)', order(rows, true), ['517', '402', '408', '518', '420', '401', '412'])
  // 402호 11월 보기: 10/14 에 받은 11월분이 그 달 몫 받은 날이다. 다른 완납은 아직 날짜가 없다.
  const nov = [paid('402', '2026-10-14', { id: '402' }), paid('401', null, { id: '401' }), paid('403', null, { id: '403' })]
  eq('402형 다음 달(11월) 선납이 맨 앞', order(nov, false, '2026-11'), ['402', '401', '403'])
}

// ── 9. 청구 없음은 꼬리 ──
{
  const noBill = R('522', { id: '522', status: 'CHECKOUT_PENDING', noBillReason: 'checkoutNoBilling', expectedMoveOut: '2026-10-17' })
  eq('청구 없음 종류', paymentBadgeKind(noBill, '2026-10', TODAY), 'noBill')
  const rows = [noBill, unpaid('409', '8', '2026-10', { id: '409' }), paid('420', '2026-09-30', { id: '420' }), awaiting('511', '2026-10-20', { id: '511' })]
  eq('청구 없음 꼬리(기본)', order(rows, false), ['409', '511', '420', '522'])
  eq('청구 없음 꼬리(반대)', order(rows, true), ['420', '511', '409', '522'])
}

// ── 10. 단기 퇴실 예정(배지 완납 + [퇴실 예정])은 완납 묶음, 퇴실 예정 상태만 꼬리 ──
{
  const shortExit = paid('503', '2026-10-05', { id: '503', expectedMoveOut: '2026-10-25' })
  eq('단기 퇴실 예정 종류', paymentBadgeKind(shortExit, '2026-10', TODAY), 'paid')
  const cp = R('507', { id: '507', status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-28', viewMonthPaidAt: '2026-10-06' })
  eq('퇴실 예정 상태 종류', paymentBadgeKind(cp, '2026-10', TODAY), 'checkout')
  const cpNext = R('508', { id: '508', status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-11-15', viewMonthPaidAt: '2026-10-07' })
  eq('다음 달 퇴실 예정은 완납', paymentBadgeKind(cpNext, '2026-10', TODAY), 'paid')
  const cp2 = R('406', { id: '406c', status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-21' })
  eq('퇴실 예정 꼬리는 퇴실일 가까운 순(양방향)', [order([cp, shortExit, cpNext, cp2], false), order([cp, shortExit, cpNext, cp2], true)],
    [['503', '508', '406c', '507'], ['508', '503', '406c', '507']])
  eq('퇴실 예정 미납이면 미납', paymentBadgeKind(R('410', { status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-28', isPaid: false }), '2026-10', TODAY), 'unpaid')
  eq('이월 미수가 있으면 청구 없음보다 미납이 먼저', paymentBadgeKind(R('411', { status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-03', noBillReason: 'checkoutNoBilling', isPaid: false, firstUnpaidMonth: '2026-09' }), '2026-10', TODAY), 'unpaid')
}

// ── 11. 입실 예약은 입주일 가까운 순(양방향), 입주일 없으면 끝 ──
{
  const rows = [R('513', { id: '513', status: 'RESERVED', moveInDate: '2026-10-25' }), R('404', { id: '404', status: 'RESERVED', moveInDate: null }),
    R('519', { id: '519r', status: 'RESERVED', moveInDate: '2026-10-21' })]
  eq('입실 예약 종류', paymentBadgeKind(rows[0], '2026-10', TODAY), 'reserved')
  eq('입실 예약 기본', order(rows, false), ['519r', '513', '404'])
  eq('입실 예약 반대(꼬리라 같다)', order(rows, true), ['519r', '513', '404'])
}

// ── 12. 418형 동행: 거주 납부 예정 + 비거주 완납이면 방은 납부 예정, 서버 순서 그대로 붙는다 ──
{
  const lead = awaiting('418', '2026-10-22', { id: '418a' }), sub = paid('418', '2026-10-03', { id: '418b', status: 'NON_RESIDENT' })
  const other = paid('412', '2026-10-01', { id: '412' }), other2 = awaiting('521', '2026-10-21', { id: '521' })
  const s = run([lead, sub, other, other2], false)
  eq('418형 기본', s.rows.map(r => r.id), ['521', '418a', '418b', '412'])
  eq('418형 방 묶음', s.roomGroup.get('room-418'), 'awaiting')
  eq('418형 반대(완납 묶음으로 안 건너간다)', order([lead, sub, other, other2], true), ['412', '418a', '418b', '521'])
}

// ── 13. 대표 행 + 미납 동행: 첫 행이 완납이어도 방은 미납, 키는 미납 행에서 ──
{
  // 첫 행(완납) 약정일은 25일이라, 키를 첫 행에서 읽던 종전 결함이면 10/25 로 409(10/8) 뒤에 선다
  const first = paid('415', '2026-10-05', { id: '415a', dueDay: '25' }), late = unpaid('415', '5', '2026-09', { id: '415b' })
  const a = unpaid('523', '20', '2026-08', { id: '523' }), b = unpaid('409', '8', '2026-10', { id: '409' })
  const s = run([first, late, a, b], false)
  eq('대표 행 묶음은 미납', s.roomGroup.get('room-415'), 'unpaid')
  eq('키 출처는 미납 행(9/5): 8/20 뒤, 10/8 앞', s.rows.map(r => r.id), ['523', '415a', '415b', '409'])
  eq('반대도 같은 키', order([first, late, a, b], true), ['409', '415a', '415b', '523'])
  // 같은 묶음 행이 둘이면 기본 방향 키가 앞선 행이 대표다(방향과 무관)
  const two = [unpaid('416', '25', '2026-10', { id: '416a' }), unpaid('416', '2', '2026-10', { id: '416b' }), unpaid('409', '8', '2026-10', { id: '409' })]
  eq('같은 묶음 둘이면 더 오래된 키', order(two, false), ['416a', '416b', '409'])
  eq('같은 묶음 둘 반대', order(two, true), ['409', '416a', '416b'])
}

// ── 14. 519형: 퇴실 완료 청구 없음 + 입실 예약이면 청구 없음 꼬리, 서버 순서 그대로 ──
{
  const out = R('519', { id: '519a', status: 'CHECKED_OUT', noBillReason: 'checkoutNoBilling', expectedMoveOut: '2026-10-07' })
  const resv = R('519', { id: '519b', status: 'RESERVED', moveInDate: '2026-10-19' })
  const nb = R('522', { id: '522', status: 'CHECKOUT_PENDING', noBillReason: 'checkoutNoBilling', expectedMoveOut: '2026-10-17' })
  const cp = R('510', { id: '510', status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-30' })
  const r2 = R('404', { id: '404', status: 'RESERVED', moveInDate: '2026-10-20' })
  const s = run([nb, out, resv, r2, cp], false)
  eq('519형 순서(퇴실 예정, 청구 없음 호실순, 입실 예약)', s.rows.map(r => r.id), ['510', '519a', '519b', '522', '404'])
  eq('519형 방 묶음', s.roomGroup.get('room-519'), 'noBill')
  eq('519형 반대(꼬리는 같다)', order([nb, out, resv, r2, cp], true), ['510', '519a', '519b', '522', '404'])
  eq('퇴실 완료 완납은 완납 묶음', paymentStatusGroup(paid('513', '2026-09-28', { status: 'CHECKED_OUT', expectedMoveOut: '2026-09-30' }), '2026-09', TODAY), 'paid')
}

// ── 16. 미래 달·지난 달 ──
{
  // 11월(미래): 서버는 미래 달 행을 완납으로 내리고 nextDueDate 를 안 준다. 미리 받은 행만 날짜가 있다.
  const fut = [paid('401', null, { id: '401' }), paid('402', '2026-10-14', { id: '402' }), unpaid('409', '8', '2026-10', { id: '409' }), paid('399', null, { id: '399' })]
  eq('미래 달 기본', order(fut, false, '2026-11'), ['409', '402', '399', '401'])
  eq('미래 달 반대', order(fut, true, '2026-11'), ['402', '399', '401', '409'])
  // 9월(지난 달): 말일 약정 미납, 그 달 퇴실 예정, 그 달 퇴실 완료 완납
  const past = [unpaid('405', '말일', '2026-09', { id: '405' }), unpaid('409', '8', '2026-09', { id: '409' }),
    R('513', { id: '513', status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-09-30' }), paid('520', '2026-09-03', { id: '520', status: 'CHECKED_OUT', expectedMoveOut: '2026-09-20' })]
  eq('지난 달 기본', order(past, false, '2026-09'), ['409', '405', '520', '513'])
  eq('지난 달 반대', order(past, true, '2026-09'), ['520', '405', '409', '513'])
}

// ── 배지 보조줄 문장: 날짜에는 명사, 같은 날짜는 한 번(검수·웹디자이너 패스 2026-10-19) ──
{
  const B = (p: Partial<BadgeSubRow>): BadgeSubRow => ({ ...R('513', p as Partial<Row>), isShortTerm: false, latePaidAt: null, ...p })
  const out = { status: 'CHECKED_OUT', expectedMoveOut: '2026-10-08' }
  eq('퇴실 완료 날짜 혼자면 날짜만', checkedOutSub(B(out)), '10/8')
  eq('퇴실 완료 날짜 뒤따르면 퇴실을 단다', checkedOutSub(B(out), true), '10/8 퇴실')
  eq('퇴실 완료 아니면 절 없음', checkedOutSub(B({ status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-08' }), true), null)
  eq('완납 + 퇴실 완료', paidSubText(B({ ...out, viewMonthPaidAt: '2026-10-02' }), '2026-10'), '10/2 납부 · 10/8 퇴실')
  eq('지연납부 + 퇴실 완료', paidSubText(B({ status: 'CHECKED_OUT', expectedMoveOut: '2026-09-30', latePaidAt: '2026-09-05', viewMonthPaidAt: '2026-09-05' }), '2026-09'), '9/5 지연납부 · 9/30 퇴실')
  eq('완납 날짜 없는 퇴실 완료는 날짜만', paidSubText(B(out), '2026-10'), '10/8')
  eq('정시 완납', paidSubText(B({ viewMonthPaidAt: '2026-09-30' }), '2026-10'), '9/30 납부')
  eq('날짜 없는 완납은 보조줄 없음', paidSubText(B({}), '2026-10'), undefined)
  eq('완납 + 단기 퇴실(날짜만)', paidSubText(B({ isShortTerm: true, expectedMoveOut: '2026-10-25', viewMonthPaidAt: '2026-10-05' }), '2026-10'), '10/5 납부 · 10/25 퇴실')
  eq('청구 없음 무청구 퇴실월 + 퇴실 완료는 날짜 한 번', noBillBadgeSub(B({ ...out, expectedMoveOut: '2026-10-07', noBillReason: 'checkoutNoBilling' }), '2026-10'), '10/7 퇴실까지 납부됨')
  eq('청구 없음 단기 선납 + 퇴실 완료는 퇴실을 단다', noBillBadgeSub(B({ ...out, noBillReason: 'shortTermPrepaid' }), '2026-10'), '입주월에 전액 납부 · 10/8 퇴실')
  eq('청구 없음 퇴실 예정(무청구 퇴실월)', noBillBadgeSub(B({ status: 'CHECKOUT_PENDING', expectedMoveOut: '2026-10-17', noBillReason: 'checkoutNoBilling' }), '2026-10'), '10/17 퇴실까지 납부됨')
}

// ── 머리 문구 ──
eq('묶음 이름', STATUS_GROUP_LABEL, { unpaid: '미납', awaiting: '납부 예정', paid: '완납', checkout: '퇴실 예정', noBill: '청구 없음', reserved: '입실 예약' })
eq('순서 설명 기본', (['unpaid', 'awaiting', 'paid', 'checkout', 'noBill', 'reserved'] as StatusGroup[]).map(g => statusGroupOrderText(g, false)),
  ['오래된 순', '납부일 가까운 순', '납부 오래된 순', '퇴실일 가까운 순', '호실순', '입주일 가까운 순'])
eq('순서 설명 반대', (['unpaid', 'awaiting', 'paid', 'checkout', 'noBill', 'reserved'] as StatusGroup[]).map(g => statusGroupOrderText(g, true)),
  ['최근 미납 순', '납부일 먼 순', '최근 납부 순', '퇴실일 가까운 순', '호실순', '입주일 가까운 순'])

// ── 15. 성질: 무작위 행에서 반대의 본 묶음 = 기본 본 묶음 역순, 꼬리는 같다, 같은 호실은 붙는다 ──
{
  const BODY: StatusGroup[] = ['unpaid', 'awaiting', 'paid'], TAIL: StatusGroup[] = ['checkout', 'noBill', 'reserved']
  const days = ['2026-09-28', '2026-09-30', '2026-10-02', '2026-10-05', '2026-10-05', '2026-10-12', '2026-10-20', '2026-10-25', '2026-10-31']
  let violations = 0
  for (let it = 0; it < 300; it++) {
    let s = it * 7919 + 13
    const rnd = (n: number) => { s = (s * 1103515245 + 12345) % 2147483648; return s % n }
    const rows: Row[] = []
    const nRooms = 8 + rnd(25)
    for (let k = 0; k < nRooms; k++) {
      const roomNo = String(400 + rnd(130))
      const roomId = `room-${roomNo}-${k % 5 === 0 ? 'x' : k}`   // 같은 호실 번호의 다른 방도 섞는다
      const nRows = rnd(5) === 0 ? 2 : 1
      for (let j = 0; j < nRows; j++) {
        const t = rnd(9), d = days[rnd(days.length)], dueDay = String(1 + rnd(28))
        const base = { roomId }
        rows.push(
          t === 0 ? unpaid(roomNo, dueDay, ['2026-08', '2026-09', '2026-10'][rnd(3)], base)
          : t === 1 ? unpaid(roomNo, rnd(4) === 0 ? '' : dueDay, '2026-10', base)
          : t === 2 ? awaiting(roomNo, d, base)
          : t === 3 ? paid(roomNo, d, base)
          : t === 4 ? paid(roomNo, null, base)
          : t === 5 ? R(roomNo, { ...base, status: 'CHECKOUT_PENDING', expectedMoveOut: d.startsWith('2026-10') ? d : '2026-10-30' })
          : t === 6 ? R(roomNo, { ...base, noBillReason: 'shortTermPrepaid' })
          : t === 7 ? R(roomNo, { ...base, status: 'RESERVED', moveInDate: rnd(3) === 0 ? null : d })
          : paid(roomNo, d, { ...base, expectedMoveOut: '2026-10-26' }),   // 단기 퇴실 예정(완납)
        )
      }
    }
    const input = shuffle(rows, it)
    // 같은 방 행은 입력 순서대로 이어 붙인다(서버가 방 안 순서를 정해 준다)
    const byRoom = new Map<string, Row[]>()
    for (const r of input) byRoom.set(r.roomId, [...(byRoom.get(r.roomId) ?? []), r])
    const serverOrder = [...byRoom.values()].flat()
    const A = run(serverOrder, false), B = run(serverOrder, true)
    const blocks = (res: typeof A) => {
      const seen: { id: string; g: StatusGroup; key: string | null; roomNo: string }[] = []
      let prev = ''
      for (const r of res.rows) {
        if (r.roomId === prev) continue
        prev = r.roomId
        const g = res.roomGroup.get(r.roomId)!
        const roomRows = res.rows.filter(x => x.roomId === r.roomId)
        const best = roomRows.map(x => ({ g: paymentStatusGroup(x, '2026-10', TODAY), x })).filter(o => o.g === g)
          .map(o => statusSortKey(o.x, g, '2026-10')).sort((p, q) => (p == null ? 1 : q == null ? -1 : p < q ? -1 : p > q ? 1 : 0))[0] ?? null
        seen.push({ id: r.roomId, g, key: best, roomNo: r.roomNo })
      }
      return seen
    }
    const a = blocks(A), b = blocks(B)
    const body = (xs: typeof a) => xs.filter(x => BODY.includes(x.g))
    const tail = (xs: typeof a) => xs.filter(x => TAIL.includes(x.g))
    // 꼬리는 같다
    if (JSON.stringify(tail(a).map(x => x.id)) !== JSON.stringify(tail(b).map(x => x.id))) violations++
    // 본 묶음: 키 있는 방의 (묶음, 키) 수열이 정확히 역순이고, 같은 (묶음, 키) 안은 양쪽 모두 호실 오름차순
    const keyed = (xs: typeof a) => body(xs).filter(x => x.key != null)
    const sigA = keyed(a).map(x => `${x.g}|${x.key}`), sigB = keyed(b).map(x => `${x.g}|${x.key}`)
    if (JSON.stringify([...sigA].reverse()) !== JSON.stringify(sigB)) violations++
    for (const xs of [keyed(a), keyed(b)]) {
      for (let i = 1; i < xs.length; i++) {
        if (xs[i].g === xs[i - 1].g && xs[i].key === xs[i - 1].key && xs[i - 1].roomNo.localeCompare(xs[i].roomNo, 'ko', { numeric: true }) > 0) violations++
      }
    }
    // 키 없는 방은 양쪽 모두 자기 묶음 끝에 같은 순서로
    for (const g of BODY) {
      const ga = body(a).filter(x => x.g === g), gb = body(b).filter(x => x.g === g)
      const nullsA = ga.filter(x => x.key == null), nullsB = gb.filter(x => x.key == null)
      if (JSON.stringify(nullsA.map(x => x.id)) !== JSON.stringify(nullsB.map(x => x.id))) violations++
      if (ga.slice(ga.length - nullsA.length).some(x => x.key != null)) violations++
      if (gb.slice(gb.length - nullsB.length).some(x => x.key != null)) violations++
    }
    // 묶음 순서
    const groupsSeq = (xs: typeof a) => [...new Set(xs.map(x => x.g))]
    const okSeq = (seq: StatusGroup[], want: StatusGroup[]) => JSON.stringify(seq) === JSON.stringify(want.filter(g => seq.includes(g)))
    if (!okSeq(groupsSeq(a), [...BODY, ...TAIL])) violations++
    if (!okSeq(groupsSeq(b), [...[...BODY].reverse(), ...TAIL])) violations++
    // 같은 방 행은 붙어 있고 서버 순서 그대로, 행 수 보존
    for (const res of [A, B]) {
      if (res.rows.length !== serverOrder.length) violations++
      const firstAt = new Map<string, number>(), lastAt = new Map<string, number>()
      res.rows.forEach((r, i) => { if (!firstAt.has(r.roomId)) firstAt.set(r.roomId, i); lastAt.set(r.roomId, i) })
      for (const [id, rs] of byRoom) {
        if (lastAt.get(id)! - firstAt.get(id)! + 1 !== rs.length) violations++
        if (JSON.stringify(res.rows.slice(firstAt.get(id)!, lastAt.get(id)! + 1).map(r => r.id)) !== JSON.stringify(rs.map(r => r.id))) violations++
      }
    }
  }
  eq('무작위 300회 성질 위반', violations, 0)
}

// ── 정적: 배지 분기와 정렬 묶음이 같은 함수를 부른다 ──
{
  const root = path.resolve(__dirname, '..')
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8')
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\S\n]*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
  const rc = strip(read('app/(app)/rooms/RoomsClient.tsx'))
  const count = (s: string, needle: string) => s.split(needle).length - 1
  const cardStart = rc.indexOf('className="sm:hidden space-y-2"')
  const tableStart = rc.indexOf('<tbody>')
  const tableEnd = rc.indexOf('</tbody>')
  ok('카드 영역을 찾았다', cardStart > 0 && cardStart < tableStart)
  const card = rc.slice(cardStart, tableStart), table = rc.slice(tableStart, tableEnd)
  for (const [name, part] of [['카드', card], ['표', table]] as const) {
    ok(`${name} 배지가 paymentBadgeKind 를 부른다`, count(part, 'paymentBadgeKind(room, targetMonth)') === 1)
    for (const k of ['reserved', 'unpaid', 'deferredUnpaid', 'noBill', 'checkout', 'awaiting', 'deferredAwait']) {
      ok(`${name} 배지가 '${k}' 분기를 그린다`, part.includes(`kind === '${k}'`))
    }
    ok(`${name} 완납 보조줄이 paidSubText 정본`, part.includes('sub={paidSubText(room, targetMonth)}'))
    ok(`${name} 청구 없음 보조줄이 noBillBadgeSub 정본`, part.includes('sub={noBillBadgeSub(room, targetMonth)}'))
    ok(`${name} 퇴실 완료 날짜 절은 다른 절 뒤에서 늘 '퇴실'을 단다`, !part.includes('checkedOutSub(room)') && count(part, 'checkedOutSub(room, true)') === 3)
    ok(`${name} 옛 분기 조건이 없다(showCheckout·isAwaiting·isPaid 분기·noBillReason 분기·유예 재판정)`,
      !/showCheckout|const isAwaiting =|if \(!room\.isPaid\) \{|if \(room\.noBillReason\) \{|if \(isDeferredNow\(room, targetMonth\)\)|room\.status === 'RESERVED' \?/.test(part))
    ok(`${name} 묶음 머리를 그린다`, part.includes('statusGroupHead(idx)') && part.includes('STATUS_GROUP_LABEL[head]') && part.includes('groupOrderText(head)'))
  }
  ok('표 머리 행은 colSpan 한 칸(지출 표 날짜 머리 문법)', table.includes('colSpan={tableColCount}') && table.includes('bg-[var(--canvas)]/50 border-b border-[var(--warm-border)]'))
  ok('카드 머리는 §22 SectionHeader(숫자 없음)', /<SectionHeader first=\{idx === 0\} name=\{STATUS_GROUP_LABEL\[head\]\}\s+trailing=/.test(card) && !/<SectionHeader[^>]*count=/.test(card))
  ok('정렬은 sortRowsByPaymentStatus 정본', rc.includes("sortKey === 'status'\n    ? sortRowsByPaymentStatus(filtered, { reversed: sortDir === 'asc', targetMonth })"))
  ok('옛 정렬 묶음(statusGrpOf·roomStatusGrp·getDueSortValue)이 없다', !/statusGrpOf|roomStatusGrp|getDueSortValue/.test(rc))
  ok('완납 칩은 종전 조건에서 입실 예약만 뺀다(승인 범위, 청구 없음은 칩에 남는다)',
    rc.includes("r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r) && paymentBadgeKind(r, targetMonth) !== 'reserved'")
    && !rc.includes('statusGroupOfKind(')
    && rc.includes("if (filter === 'paid')     return isPaidRoom(r)") && rc.includes('const paidCount     = occupied.filter(isPaidRoom).length'))
  ok('칩 안내에 입실 예약은 전체에서만', rc.includes('입실 예약은 전체에서만 보입니다.'))
  ok('표 묶음 머리는 이름 바로 뒤 순서 설명, 왼쪽에 붙어 선다', /colSpan=\{tableColCount\}[^\n]*\n\s*<div className="sticky left-4 inline-flex items-center gap-2">/.test(table))
  ok('판정 함수를 화면이 따로 정의하지 않는다', !/function (getDueInfo|getEffectiveDueInfo|isDeferredNow|unpaidBadgeLabel)\b/.test(rc))
  ok('저장 키 두 개 그대로', rc.includes("const SORTKEY_KEY  = 'stayeum_rooms_sortkey'") && rc.includes("const SORTDIR_KEY  = 'stayeum_rooms_sortdir'"))
  ok('기본 정렬 수납 상태·desc 그대로', rc.includes("useState<SortKey>('status')") && rc.includes("useState<SortDir>('desc')"))
  ok('정렬 상태를 URL 에 넣지 않는다', !/useUrlState\('(sort|dir)/.test(rc))
  ok('모바일 라벨 띄어쓰기 수납 상태', rc.includes("{ value: 'status',        label: '수납 상태' }") && !rc.includes("label: '수납상태'"))
  ok('캡션 날짜는 같은 날이면 한 번만', count(rc, 'lastPayCaptionDate(room,') === 2 && !rc.includes("room.lastPayDate.slice(5).replace('-', '/')"))
  const lib = strip(read('lib/roomsStatusSort.ts'))
  ok('완납 보조줄은 납부일 + 단기 퇴실이면 퇴실 절을 날짜만(두 절 360px 규칙)',
    lib.includes("(paid ? checkoutDateLabel(room.expectedMoveOut) : checkoutSubText(room.expectedMoveOut))")
    && lib.includes("const paid = date ? `${fmtMD(date)} ${room.latePaidAt ? '지연납부' : '납부'}` : null"))
  ok('보조줄 문장을 화면이 따로 정의하지 않는다', !/function (paidSubText|noBillBadgeSub|checkedOutSub|noBillSubText|paidBadgeDate)\b/.test(rc))
  // viewMonthPaidAt 은 정렬 키와 완납 보조줄 날짜에만 쓴다. 화면의 돈 계산(미수·수납 스트립·일괄 수납 합계)에 섞이면 안 된다.
  ok('lib 에서 viewMonthPaidAt 은 타입·정렬 키·보조줄 날짜 셋뿐', count(lib, 'viewMonthPaidAt') === 3)
  ok('화면에서 viewMonthPaidAt 은 타입 선언뿐', count(rc, 'viewMonthPaidAt') === 1)
  {
    const fnBody = (src: string, name: string) => { const i = src.indexOf(`function ${name}(`); return i < 0 ? '' : src.slice(i, src.indexOf('\n}', i)) }
    const moneyLines = rc.split('\n').filter(l => /const (expectedSum|collectedSum|maxSum|batchTotal|homeExpectedSum|homeCollectedSum|billableRows|fillByRoom)\b/.test(l)).join('\n')
    const money = fnBody(rc, 'getTotalUnpaid') + moneyLines
    ok('돈 계산 함수(getTotalUnpaid·수납 스트립·일괄 합계)가 있고 찾았다', fnBody(rc, 'getTotalUnpaid').length > 0 && moneyLines.split('\n').length >= 6)
    ok('돈 계산에 viewMonthPaidAt·납부일 표시 함수가 안 섞인다', !/viewMonthPaidAt|paidBadgeDate|lastPayCaptionDate|paidSubText/.test(money))
  }
  ok('정렬이 배지 판정을 부른다', /sortRowsByPaymentStatus[\s\S]*GROUP_OF_KIND\[paymentBadgeKind\(r, targetMonth, today\)\]/.test(lib))
  ok('배지 판정 정의는 한 벌', count(lib, 'export function paymentBadgeKind(') === 1)

  const act = strip(read('app/(app)/rooms/actions.ts'))
  const block = act.match(/const viewMonthPaidAt: string \| null = \(\(\) => \{([\s\S]*?)\n    \}\)\(\)/)
  ok('viewMonthPaidAt 은 이미 읽은 기록에서', !!block && block[1].includes('for (const p of postCutoffRecords)') && !/prisma\./.test(block[1]))
  ok('viewMonthPaidAt 거름(청구 조정 제외·귀속월=조회 달·금액>0)', !!block && block[1].includes('p.isBillingAdjust') && block[1].includes('p.targetMonth !== targetMonth') && block[1].includes('p.actualAmount <= 0'))
  ok('viewMonthPaidAt 은 돈 계산에 안 쓴다(정의·반환 둘·타입 하나뿐)', count(act, 'viewMonthPaidAt') === 4)
}

console.log(`[수납 상태 정렬] 통과 ${pass} / 실패 ${fails.length}`)
for (const f of fails) console.error(`  - ${f}`)
process.exit(fails.length > 0 ? 1 : 0)
