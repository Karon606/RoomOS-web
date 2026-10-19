// 수납 관리 수납 상태 배지의 분기 판정과 그 배지에서 파생한 묶음 정렬의 정본(카드·표 배지와 정렬이 같은 함수를 부른다)
//
// 신고 db65cce9(2026-10-19, 운영자 '추천대로' 승인). 원문은 "수납상태는 미납(오래된 순), 납부예정(납부일정 순),
// 완납(납부 오래된 순)이고 그 반대는 완납(최근납부순), 납부예정(예정일에서 가장 먼 순), 미납(최근미납순)".
// 종전 정렬은 배지와 따로 묶음을 정해(청구 없음·입실 예약이 미납과 납부 예정 사이에 섰다) 반대를 눌러도 묶음 순서가
// 그대로였고, 완납은 실제 납부일이 아니라 약정일 순이었다. 그래서 묶음을 **배지에서 파생**한다. 배지가 어떤 말을
// 할지 정하는 분기를 여기 한 벌로 두고, 카드·표 배지 쌍둥이와 정렬과 완납 칩이 모두 paymentBadgeKind 를 부른다.
//
// 규칙
//   · 본 묶음은 미납·납부 예정·완납. 기본(화면 저장값 desc)은 그 순서, 반대는 묶음 순서와 묶음 안 키를 모두 뒤집는다.
//   · 꼬리(퇴실 예정·청구 없음·입실 예약)는 방향과 무관하게 맨 아래 고정이다.
//   · 동률은 방향과 무관하게 호실 오름차순(localeCompare ko numeric), 키가 없는 행은 양방향 모두 묶음 끝.
//   · 같은 호실 행은 붙여 둔다(2026-08-11 결정). 방의 묶음은 가장 급한 행을 따르고 정렬 키도 그 행에서 읽는다.
import { kstDaysUntil, kstYmdStr } from './kstDate'
import { fmtMD } from './fmtDate'
import { checkoutSubText, checkoutDateLabel, isShortTermCheckoutDue } from './leaseStatus'

/** 판정에 쓰는 행 칸. 수납 관리 행(RoomsClient RoomStatus)의 부분집합이다. */
export type PaymentStatusRow = {
  roomId: string
  roomNo: string
  status: string | null
  isPaid: boolean
  dueDay: string | null
  overrideDueDay: string | null
  overrideDueDayMonth: string | null
  firstUnpaidMonth: string | null
  nextDueDate: string | null
  nextDueAmount: number
  noBillReason?: string | null
  expectedMoveOut: string | null
  moveInDate: string | null
  viewMonthPaidAt?: string | null
}

type DueFields = Pick<PaymentStatusRow, 'dueDay' | 'overrideDueDay' | 'overrideDueDayMonth' | 'firstUnpaidMonth'>

// 약정일(또는 조정일)을 그 달의 'YYYY-MM-DD' 로. 전체 날짜형('2026-08-09')은 그대로, 말일은 그 달 마지막 날.
// Date.UTC 는 로컬 생성자와 같은 자릿수 넘침 규칙을 쓴다(2월 31일 -> 3월 3일). 종전 동작 유지.
function dueYmdOf(dueDay: string | null, month: string): string | null {
  if (!dueDay) return null
  if (dueDay.includes('-')) return dueDay.slice(0, 10)
  const [yyyy, mm] = month.split('-').map(Number)
  const dayNum = dueDay.includes('말') ? new Date(yyyy, mm, 0).getDate() : parseInt(dueDay)
  if (isNaN(dayNum)) return null
  return new Date(Date.UTC(yyyy, mm - 1, dayNum)).toISOString().slice(0, 10)
}

// 납부일 경과/잔여일 계산
// 오늘은 반드시 KST 기준(kstDaysUntil)이어야 한다. new Date() 로 재면 서버(UTC)와 기기(KST)가
// KST 00~09시에 하루 다른 경과일을 내고, 그 숫자가 뱃지 문구로 렌더돼 하이드레이션이 갈린다.
export function getDueInfo(dueDay: string | null, targetMonth: string, today: string = kstYmdStr()): { days: number; overdue: boolean } | null {
  const due = dueYmdOf(dueDay, targetMonth)
  if (!due) return null
  const diff = -kstDaysUntil(due, today)
  return { days: Math.abs(diff), overdue: diff > 0 }
}

// 누적 미납자는 첫 미납월의 dueDay 기준으로 경과일 표시.
// override는 그 override가 지정된 월(overrideDueDayMonth)에만 적용한다. 미납월이
// 그 달이면 어느 화면에서 보든 override를 사용해야 함.
function effectiveDueDayOf(room: DueFields, targetMonth: string): { day: string | null; month: string } {
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  const isOverrideActive = room.overrideDueDayMonth === dueMonth && !!room.overrideDueDay
  return { day: isOverrideActive ? room.overrideDueDay : room.dueDay, month: dueMonth }
}
export function getEffectiveDueInfo(room: DueFields, targetMonth: string, today: string = kstYmdStr()): ReturnType<typeof getDueInfo> {
  const { day, month } = effectiveDueDayOf(room, targetMonth)
  return getDueInfo(day, month, today)
}

// 납부 기한을 미뤄준 상태인가. 유예 판정 정본이다.
//
// 뱃지·독촉·홈 위젯이 각자 판정하면 화면마다 다른 말을 한다. 한 곳에서만 정한다.
// 조건 넷을 모두 만족해야 유예다.
//   ① 임시조정이 그 미납월에 걸려 있다  ② 원래 납부일보다 **뒤로** 미룬 것이다
//   ③ 그 날짜가 아직 안 지났다          ④ 아직 낼 게 남아 있다
// ②가 없으면 앞당긴 조정까지 유예가 되고, ④가 없으면 이미 다 낸 사람에게 유예 표시가 샌다.
export function isDeferredNow(
  room: DueFields & Pick<PaymentStatusRow, 'isPaid' | 'nextDueDate' | 'nextDueAmount'>,
  targetMonth: string, today: string = kstYmdStr(),
): boolean {
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  if (room.isPaid && !(room.nextDueDate && room.nextDueAmount > 0)) return false   // ④ 낼 게 없으면 유예가 아니다
  if (!room.overrideDueDay || room.overrideDueDayMonth !== dueMonth) return false
  const eff = getDueInfo(room.overrideDueDay, dueMonth, today)
  const base = getDueInfo(room.dueDay, dueMonth, today)
  if (!eff || !base) return false
  if (eff.overdue) return false                      // 조정일도 이미 지남. 유예가 아니라 연체
  const effSigned = eff.overdue ? eff.days : -eff.days
  const baseSigned = base.overdue ? base.days : -base.days
  return effSigned < baseSigned                       // 원래보다 뒤로 미룬 경우만
}

// 미납 배지 문구. 납부일 당일은 아직 늦은 게 아니라 '납부일'로 표기한다(운영자 지시 2026-08-01).
// 톤은 unpaid 를 유지한다. 오늘 받아야 할 건이라 시야에서 사라지면 안 된다. 계산·집계는 손대지 않고 표시만 바꾼다.
// days: 납부일로부터 경과일(0=오늘). 7일 초과면 연체.
// days 는 **절댓값**이라 방향(overdue)을 함께 봐야 한다. 405호 심원재가 7월분 납부 기한을 8/7 로 유예받았는데
// 8/2 에 '미납 5일 초과'로 뜬 것이 발단이다(운영자 지적 2026-08-02). 실제로는 5일 '남은' 상태다.
//
// 발생 범위는 좁다. 서버가 **당월은 납부일이 지나야** isPaid=false 로 내리므로(rooms/actions.ts),
// 월초 정상 납부 예정자는 애초에 이 분기에 안 들어오고 '납부 예정'으로 간다.
// 이 오표기는 **과거월 미납을 미래 날짜로 유예한 계약**에서만 난다. 실측 1건(405호).
//
// 라벨을 '납부 예정'으로 하지 않은 이유: 그 말은 납부 예정 분기가 이미 쓰고 tone 도 다르며
// (await/Blue vs unpaid/Amber), 상단 필터 '납부 예정 N실'은 isPaid=true 만 세므로
// 그 라벨을 달아도 그 필터로 못 찾는다. 정렬 묶음도 미납에 남는다.
//
// '납부 유예'는 여기서 빼고 호출부로 올렸다(2026-08-02). 이 분기에서만 붙이면 405호(미납 분기)만 유예로
// 보이고 516호(납부 예정 분기)는 그냥 '납부 예정'으로 남아 같은 사정이 화면에서 다른 말을 한다(운영자 지적
// "일관성이 없어"). 유예 판정은 isDeferredNow 정본이 하고, 이 함수는 유예가 아닌 경우만 맡는다.
export function unpaidBadgeLabel(days: number | null | undefined, overdue?: boolean): '납부일' | '납부일 전' | '미납' | '연체' {
  if (days == null) return '미납'
  if (days === 0) return '납부일'
  if (!overdue) return '납부일 전'   // 기한 전인데 유예도 아님(앞당긴 조정 등). '미납 · 5일 남음'은 자기모순이다
  return days > 7 ? '연체' : '미납'
}

/**
 * 수납 상태 배지가 어느 분기의 말을 하는가. 카드·표 배지 쌍둥이가 이 값으로 갈라 그리고, 정렬 묶음도 이 값에서 나온다.
 * 순서가 곧 규칙이다(앞의 분기가 이긴다). 보조 배지(퇴실 예정·퇴실 완료·비거주)는 이 값을 바꾸지 않는다.
 *   reserved        입실 예약·예약 확정
 *   deferredUnpaid  납부 유예(지난달분을 미룸, 미납 분기)
 *   unpaid          미납·연체·납부일·납부일 전
 *   noBill          청구 없음(이월 미수가 있으면 미납이 먼저다)
 *   checkout        퇴실 예정(완납이면서 그 달 퇴실, 퇴실 예정 상태)
 *   deferredAwait   납부 유예(이번 달분을 미룸, 납부 예정 분기)
 *   awaiting        납부 예정
 *   paid            완납(단기 퇴실 예정·퇴실 완료가 보조 배지로 붙어도 완납)
 */
export type PaymentBadgeKind = 'reserved' | 'deferredUnpaid' | 'unpaid' | 'noBill' | 'checkout' | 'deferredAwait' | 'awaiting' | 'paid'

export function paymentBadgeKind(room: PaymentStatusRow, targetMonth: string, today: string = kstYmdStr()): PaymentBadgeKind {
  if (room.status === 'RESERVED') return 'reserved'
  if (!room.isPaid) return isDeferredNow(room, targetMonth, today) ? 'deferredUnpaid' : 'unpaid'
  if (room.noBillReason) return 'noBill'
  // 퇴실 예정 배지는 expectedMoveOut 이 조회 달 안(또는 그 이전)일 때만
  const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
  if (room.status === 'CHECKOUT_PENDING' && !!checkoutMonth && checkoutMonth <= targetMonth) return 'checkout'
  if (room.nextDueDate && room.nextDueAmount > 0) return isDeferredNow(room, targetMonth, today) ? 'deferredAwait' : 'awaiting'
  return 'paid'
}

/** 정렬 묶음. 본 묶음 셋(미납·납부 예정·완납)과 꼬리 셋(퇴실 예정·청구 없음·입실 예약). */
export type StatusGroup = 'unpaid' | 'awaiting' | 'paid' | 'checkout' | 'noBill' | 'reserved'

const GROUP_OF_KIND: Record<PaymentBadgeKind, StatusGroup> = {
  reserved: 'reserved', deferredUnpaid: 'unpaid', unpaid: 'unpaid', noBill: 'noBill',
  checkout: 'checkout', deferredAwait: 'awaiting', awaiting: 'awaiting', paid: 'paid',
}
export function statusGroupOfKind(kind: PaymentBadgeKind): StatusGroup {
  return GROUP_OF_KIND[kind]
}
export function paymentStatusGroup(room: PaymentStatusRow, targetMonth: string, today: string = kstYmdStr()): StatusGroup {
  return GROUP_OF_KIND[paymentBadgeKind(room, targetMonth, today)]
}

const BODY: StatusGroup[] = ['unpaid', 'awaiting', 'paid']          // 기본 방향 순서
const TAIL: StatusGroup[] = ['checkout', 'noBill', 'reserved']      // 방향 무관 고정
// 한 방에 행이 여럿이면 이 순서로 앞선 묶음이 그 방의 묶음이다(본 묶음이 꼬리보다 급하다).
const URGENCY: StatusGroup[] = [...BODY, ...TAIL]

export const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  unpaid: '미납', awaiting: '납부 예정', paid: '완납',
  checkout: '퇴실 예정', noBill: '청구 없음', reserved: '입실 예약',
}

/** 묶음 머리 오른쪽의 순서 설명. 꼬리는 방향과 무관하게 같은 순서라 같은 말이다. */
export function statusGroupOrderText(group: StatusGroup, reversed: boolean): string {
  switch (group) {
    case 'unpaid':   return reversed ? '최근 미납 순' : '오래된 순'
    case 'awaiting': return reversed ? '납부일 먼 순' : '납부일 가까운 순'
    case 'paid':     return reversed ? '최근 납부 순' : '납부 오래된 순'
    case 'checkout': return '퇴실일 가까운 순'
    case 'noBill':   return '호실순'
    case 'reserved': return '입주일 가까운 순'
  }
}

/**
 * 묶음 안 정렬 키('YYYY-MM-DD', 없으면 null). 기본 방향은 모두 오름차순이다.
 *   미납      첫 미납월의 약정일(그 달 조정 반영), 오래된 기한이 앞(가장 많이 밀린 사람이 맨 위)
 *   납부 예정  nextDueDate(서버가 조정일을 반영해 준 그 달 기한), 가까운 날이 앞
 *   완납      viewMonthPaidAt(그 달 몫을 받은 날), 일찍 낸 사람이 앞, 날짜가 없으면 묶음 끝
 *   퇴실 예정  퇴실 예정일 / 청구 없음 키 없음(호실순) / 입실 예약 입주일
 */
export function statusSortKey(room: PaymentStatusRow, group: StatusGroup, targetMonth: string): string | null {
  switch (group) {
    case 'unpaid': { const { day, month } = effectiveDueDayOf(room, targetMonth); return dueYmdOf(day, month) }
    case 'awaiting': return room.nextDueDate
    case 'paid':     return room.viewMonthPaidAt ?? null
    case 'checkout': return room.expectedMoveOut
    case 'noBill':   return null
    case 'reserved': return room.moveInDate
  }
}

// 키 비교. 키 없는 쪽이 뒤(방향과 무관). 둘 다 있으면 오름차순.
function cmpKeyNullLast(a: string | null, b: string | null): number {
  if (a === b) return 0
  if (a == null) return 1
  if (b == null) return -1
  return a < b ? -1 : 1
}

export type PaymentStatusSort<T> = {
  rows: T[]
  /** 방(roomId)마다 그 방이 선 묶음. 묶음 경계 머리를 그릴 때 쓴다. */
  roomGroup: Map<string, StatusGroup>
}

/**
 * 수납 상태 정렬. rows 는 서버 순서(방 안 순서 = roomLeaseRowOrder)를 그대로 받는다.
 * reversed=false 가 기본(화면 sortDir 'desc', 저장값·첫 화면 불변)이다.
 */
export function sortRowsByPaymentStatus<T extends PaymentStatusRow>(
  rows: readonly T[], opts: { reversed: boolean; targetMonth: string; today?: string },
): PaymentStatusSort<T> {
  const { reversed, targetMonth } = opts
  const today = opts.today ?? kstYmdStr()
  type Room = { id: string; roomNo: string; first: number; rows: T[]; group: StatusGroup; key: string | null }
  const rooms = new Map<string, Room>()
  rows.forEach((r, i) => {
    const room = rooms.get(r.roomId)
    if (room) room.rows.push(r)
    else rooms.set(r.roomId, { id: r.roomId, roomNo: r.roomNo, first: i, rows: [r], group: 'reserved', key: null })
  })
  for (const room of rooms.values()) {
    // 가장 급한 묶음의 행 중 기본 방향 키가 가장 앞선 행이 그 방을 대표한다(같으면 서버 순서 앞쪽).
    // 대표를 방향과 무관하게 고르므로 반대 방향은 기본 방향을 정확히 뒤집은 것이 된다.
    let best: { rank: number; key: string | null } | null = null
    for (const r of room.rows) {
      const g = GROUP_OF_KIND[paymentBadgeKind(r, targetMonth, today)]
      const cand = { rank: URGENCY.indexOf(g), key: statusSortKey(r, g, targetMonth) }
      if (!best || cand.rank < best.rank || (cand.rank === best.rank && cmpKeyNullLast(cand.key, best.key) < 0)) best = cand
    }
    room.group = URGENCY[best!.rank]
    room.key = best!.key
  }
  const rankOf = (g: StatusGroup): number => {
    const b = BODY.indexOf(g)
    if (b >= 0) return reversed ? BODY.length - 1 - b : b
    return BODY.length + TAIL.indexOf(g)
  }
  const sortedRooms = [...rooms.values()].sort((a, b) => {
    const ra = rankOf(a.group), rb = rankOf(b.group)
    if (ra !== rb) return ra - rb
    let c = 0
    if (a.key == null || b.key == null) c = cmpKeyNullLast(a.key, b.key)          // 키 없는 행은 양방향 모두 끝
    else { c = cmpKeyNullLast(a.key, b.key); if (reversed && BODY.includes(a.group)) c = -c }
    if (c === 0) c = a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })     // 동률은 방향 무관 호실 오름차순
    if (c === 0) c = a.first - b.first
    return c
  })
  return {
    rows: sortedRooms.flatMap(r => r.rows),
    roomGroup: new Map(sortedRooms.map(r => [r.id, r.group])),
  }
}

// ── 배지 보조줄 문장(카드·표 쌍둥이 공용 정본, 신고 db65cce9 검수 반영으로 화면에서 옮겼다) ──
// 화면 안에 두면 진리표로 못 고정해서, 같은 날짜가 두 번 서거나 날짜에 명사가 빠지는 일이 다시 나도 그물이 없다.
export type BadgeSubRow = PaymentStatusRow & { isShortTerm: boolean; latePaidAt: string | null }

// 그 달에 살다 나간 계약(신고 70addd65). 주 배지(완납·미납·청구 없음) 옆에 정본 어휘 '퇴실 완료' 배지를 나란히,
// 보조줄에는 날짜만('9/30'). 배지가 이미 '퇴실'을 말하므로 혼자 설 때 또 쓰면 중복이다.
// 톤은 퇴실 계약의 정본 중립(검색 배지 CHECKED_OUT: neutral = StatusBadge info). '퇴실 예정'(exit)과 갈라야
// 나간 사람과 나갈 사람이 같은 말이 되지 않는다.
// 단, 앞에 다른 절이 서면 날짜만으로는 무슨 날인지 안 읽힌다('10/2 납부 · 10/8'). 그때는 '10/8 퇴실'로 명사를 단다
// (checkoutDateLabel 정본, 신고 db65cce9 웹디자이너 패스). 혼자 설 때만 배지에 기대 날짜만 둔다.
export function checkedOutSub(room: BadgeSubRow, afterOther = false): string | null {
  if (room.status !== 'CHECKED_OUT' || !room.expectedMoveOut) return null
  return afterOther ? checkoutDateLabel(room.expectedMoveOut) : fmtMD(room.expectedMoveOut)
}

// 청구 없는 달. '0원 · 완납'이 안 낸 사람처럼 읽히던 것을 사실대로 바꾼다(운영자 지적 2026-08-02).
// 이유는 서버가 내려보낸다(noBillReason). 여기서 다시 판정하지 않는다.
// 뱃지 클러스터에 '퇴실'이 세 번 나오던 것을 한 절로 합쳤다([청구 없음][퇴실 예정] + 보조줄).
export function noBillSubText(room: BadgeSubRow): string {
  if (room.noBillReason === 'shortTermPrepaid') return '입주월에 전액 납부'
  const md = room.expectedMoveOut ? `${Number(room.expectedMoveOut.slice(5, 7))}/${Number(room.expectedMoveOut.slice(8))}` : null
  return md ? `${md} 퇴실까지 납부됨` : '퇴실일까지 납부됨'
}

// 완납 배지가 보조줄에 적는 그 달 몫을 받은 날. 정시는 viewMonthPaidAt('M/D 납부'), 늦게 받았으면 기존 latePaidAt('M/D 지연납부').
// 완납 묶음의 정렬 키(viewMonthPaidAt)와 같은 날이라 줄을 눈으로 훑으면 순서가 읽힌다(신고 db65cce9).
export function paidBadgeDate(room: BadgeSubRow): string | null {
  return room.latePaidAt ?? room.viewMonthPaidAt ?? null
}

// 완납 배지 보조줄 정본. 카드와 표가 같은 문장을 쓴다(쌍둥이라 한쪽만 고치면 또 어긋난다).
// 절은 최대 두 개다(360px, unpaidSubText 와 같은 규칙). 단기 퇴실(거주 중 계약)과 퇴실 완료 날짜(퇴실 계약)는
// 한 행에 함께 서지 않아서 납부일을 늘 적어도 둘을 넘지 않는다.
// 납부일과 단기 퇴실이 함께 서면 퇴실 절은 날짜만 적는다('10/12 지연납부 · 10/30 퇴실'). D-day 까지 붙이면
// 320px·글자 125% 카드에서 호실 번호가 두 줄로 꺾였다(하네스 실측). 좁은 자리에서 D-day 를 떼는 것은
// checkoutDateLabel 의 문법이고, [퇴실 예정] 보조 배지가 이미 그 일을 말한다. 납부일이 없으면 종전대로 D-day 를 단다.
export function paidSubText(room: BadgeSubRow, targetMonth: string): string | undefined {
  const date = paidBadgeDate(room)
  const paid = date ? `${fmtMD(date)} ${room.latePaidAt ? '지연납부' : '납부'}` : null
  const shortExit = isShortTermCheckoutDue(room, targetMonth)
    ? (paid ? checkoutDateLabel(room.expectedMoveOut) : checkoutSubText(room.expectedMoveOut))
    : null
  return [paid, shortExit, checkedOutSub(room, !!paid)].filter(Boolean).join(' · ') || undefined
}

// 청구 없음 배지 보조줄 정본(카드·표 쌍둥이 공용). 퇴실 계약의 무청구 퇴실월은 앞 절이 이미 'M/D 퇴실까지 납부됨'으로
// 그 날을 말하므로 퇴실 날짜를 또 적지 않는다(종전 '10/7 퇴실까지 납부됨 · 10/7'). 그 밖에는 '퇴실'을 단 날짜로 잇는다.
export function noBillBadgeSub(room: BadgeSubRow, targetMonth: string): string {
  const shortExit = isShortTermCheckoutDue(room, targetMonth) ? checkoutSubText(room.expectedMoveOut) : null
  const out = room.noBillReason === 'checkoutNoBilling' ? null : checkedOutSub(room, true)
  return [noBillSubText(room), shortExit, out].filter(Boolean).join(' · ')
}
