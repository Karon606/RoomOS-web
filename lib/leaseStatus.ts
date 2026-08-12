// LeaseStatus 의미 분류 + 매출 인식 헬퍼.
//
// 배경 (2026-05-31):
//   status 필터링이 50+ 곳에 산재해, 같은 의도("매출 인식 대상")인데 곳마다 다른 status
//   조합을 쓰던 패턴 버그가 두 번 발생했음 (totalExpected / totalRevenue 가 CHECKED_OUT
//   단기·중도퇴실 lease 의 그 달 매출을 놓침). 이 모듈은 의미별로 status 조합을 상수화
//   하고, 매출 인식 lease 추출을 한 곳에서 처리하기 위한 단일 진실 출처.
//
// 적용 정책:
//   1) 매출/청구 인식 = BILLABLE_STATUSES (ACTIVE/CHECKOUT_PENDING/NON_RESIDENT)
//      + CHECKED_OUT 중 targetMonth 귀속 paymentRecord 가 있는 lease (단기·중도퇴실)
//   2) "현재 거주" = CURRENT_OCCUPANCY_STATUSES (ACTIVE/CHECKOUT_PENDING) — 호실 점유 의미
//   3) "고객 관리 표시 대상" = TENANT_LIST_STATUSES — 투어·예약·비거주 포함 전 단계
//
// 점진적 마이그레이션을 가정: 신규 코드는 이 모듈을 쓰고, 기존 코드는 같은 정책이 필요
// 한 곳부터 차차 교체. 사이드이펙트 위험 때문에 일괄 교체는 하지 않음.

import type { LeaseStatus } from '@prisma/client'
import type { PrismaDb } from '@/lib/prisma'
import {
  billForLeaseMonth, isAfterMoveOutMonth, isCheckoutNoBillingMonthFor, monthOfDate, resolveDueDateForMonth,
  type BillingLeaseFields,
} from './billing'
import { fmtDateDot } from './fmtDate'
import { kstDaysUntil } from './kstDate'

/**
 * 매출/청구 인식 대상 lease.
 * 정상 거주 + 퇴실 예정 (그 달은 청구) + 비거주(호실 안 살지만 임대료 계약 유지).
 * CHECKED_OUT 단기·중도퇴실의 매출은 별도로 paymentRecord 기반 추가 인식.
 */
export const BILLABLE_STATUSES: LeaseStatus[] = ['ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT']

/**
 * "현재 그 호실에 거주 중" — 호실 점유율, 공실 카운터 등에 사용.
 * NON_RESIDENT 는 본인 호실 거주 안 함, RESERVED 는 아직 입주 안 함.
 */
export const CURRENT_OCCUPANCY_STATUSES: LeaseStatus[] = ['ACTIVE', 'CHECKOUT_PENDING']

/**
 * 방을 대표하는 계약 — 실제로 그 방에 사는 사람이 먼저다. 없으면 예약자, 그마저 없으면 첫 계약.
 *
 * 화면마다 자기 방식으로 고르다가 같은 방이 화면마다 다른 사람을 가리켰다. 호실 카드는
 * 'NON_RESIDENT 가 아닌 첫 계약'을 골랐는데 getRooms 의 status asc 는 enum 선언 순서라
 * RESERVED 가 ACTIVE 보다 앞이었고, 프리즘 호실 면은 'createdAt desc 첫 계약'이라 최근에 만든
 * 예약을 골랐다. 그래서 503호는 카드에 송호준(퇴실 예정), 눌러 연 모달에 Arafat(예약)이 떴다.
 * 정렬이 아니라 의미로 고르고, 그 의미를 여기 한 곳에만 둔다.
 *
 * 마지막 폴백(leases[0])은 호출 측이 넘긴 집합에 달렸다 — 비거주까지 넘기면 비거주가,
 * 점유 계약만 넘기면 없음이 된다. 넘기는 집합이 곧 그 화면의 정의다.
 *
 * 예약이 둘 이상이면 입주 예정일이 이른 쪽이 주 계약이다(404호 8/15·9/1). moveInDate 를 안 넘기는
 * 호출부는 종전대로 배열 순서를 따른다.
 */
export function primaryRoomLease<T extends { status: string; moveInDate?: Date | string | null }>(
  leases: T[],
): T | undefined {
  const residing: string[] = CURRENT_OCCUPANCY_STATUSES
  return leases.find(l => residing.includes(l.status))
    ?? sortByMoveIn(leases.filter(l => l.status === 'RESERVED'))[0]
    ?? leases[0]
}

/** 입주 예정일 오름차순(미정은 뒤) — '먼저 들어올 사람' 순서. 원본 배열은 건드리지 않는다. */
function sortByMoveIn<T extends { moveInDate?: Date | string | null }>(leases: T[]): T[] {
  const key = (l: T) => l.moveInDate ? new Date(l.moveInDate).getTime() : Number.MAX_SAFE_INTEGER
  return [...leases].sort((a, b) => key(a) - key(b))
}

/**
 * 그 방에 잡혀 있는 다음 입실 예약 — 주 계약이 아닌 RESERVED 중 입주 예정일이 가장 이른 계약.
 *
 * 호실 카드(RoomManageClient)와 프리즘 호실 면(getRoomDetail)이 같은 문장을 각자 들고 있었다.
 * 홈 방 현황이 세 번째 사본을 쓰면 primaryRoomLease 때와 똑같은 길을 간다 — 규칙을 여기 하나로 둔다.
 *
 * 날짜로 고르는 이유: 한 방에 예약이 둘 이상 걸릴 수 있다(무기한 예약만 차단하고 퇴실일이 잡힌
 * 예약은 이어 붙인다 — 2026-08-10 배정 연동). 404호가 8/15·9/1 두 건이다. 배열 순서에 맡기면
 * '다음'이 9/1 로 뒤집힌다. 주 계약 선택(primaryRoomLease)도 같은 순서를 쓴다.
 */
export function nextRoomReservation<T extends { id: string; status: string; moveInDate?: Date | string | null }>(
  leases: T[],
  primary?: { id: string } | null,
): T | undefined {
  return roomReservationQueue(leases, primary)[0]
}

/**
 * 그 방에 잡혀 있는 입실 예약 전부 — 입주 예정일 오름차순. nextRoomReservation 의 복수형이다.
 *
 * 홈 방 현황 타일이 '다음 한 명'이 아니라 '줄 서 있는 사람들'을 세우면서 필요해졌다(2026-08-11).
 * 순서 문장을 호출부가 다시 쓰면 primaryRoomLease 때와 같은 사본이 늘어나므로 여기서 한 번만 정한다.
 */
export function roomReservationQueue<T extends { id: string; status: string; moveInDate?: Date | string | null }>(
  leases: T[],
  primary?: { id: string } | null,
): T[] {
  return sortByMoveIn(leases.filter(l => l.status === 'RESERVED' && l.id !== primary?.id))
}

/**
 * 그 방을 이미 누가 잡았다 — 거주 중 + 아직 안 들어온 예약.
 * "지금 사람이 있는가"(CURRENT_OCCUPANCY_STATUSES)와 다르다. 방을 새로 줄 수 있는지 물을 땐 이쪽이다.
 */
export const OCCUPYING_STATUSES: LeaseStatus[] = ['RESERVED', 'ACTIVE', 'CHECKOUT_PENDING']

/**
 * 한 방의 계약을 수납 행 순서로 세운다 — 거주(거주중·퇴실 예정) 먼저, 그다음 입실 예약,
 * 마지막이 비거주(창고·사무실). 각 층 안에서는 입주 예정일이 이른 순이다.
 *
 * 종전 수납 관리는 방마다 대표 계약 하나(+비거주 하나)만 행으로 만들었다. 한 방에 계약이 둘이면
 * 나머지 하나가 화면에서 통째로 사라졌고, 그 계약의 그 달 청구액도 같이 사라져 홈 예상 수입과
 * 수납 화면 청구 합이 갈렸다(2026-08-11 실측: 402호 황인정 329,000 · 503호 송호준 420,000).
 * 대표 선택이 정렬 없는 조회 순서에 달려 있어 어느 쪽이 사라지는지도 비결정적이었다.
 * 방이 아니라 계약이 청구의 단위다 — 한 방에 계약이 둘이면 행도 둘이다(418호가 이미 그 선례다).
 *
 * 순서를 여기 두는 이유는 primaryRoomLease 와 같다. 호출부가 각자 정렬하면 같은 방이 화면마다
 * 다른 순서로 뜬다. 비거주를 뒤로 미는 것은 종전 순서(거주 먼저, 비거주 다음)를 그대로 지키기 위함이다.
 *
 * 층을 나누는 이유(디자인 패널 2026-08-11). 순수 입주 예정일 순이면 입주 예정일이 이미 지난 예약이
 * 나중에 들어온 거주자보다 위로 올라간다. 이 화면의 질문은 '지금 누구에게 받아야 하나'라 지금 사는
 * 사람이 먼저다. 층 위계를 primaryRoomLease 와 같게 맞춰 두면 '첫 행 = 주 계약'이 항상 참이 되어
 * 두 규칙이 서로를 검증한다. 402호는 8/2 거주와 8/17 예약이라 날짜 순으로도 같은 결과지만,
 * 규칙이 그것을 보장하지는 않았다.
 */
export function roomLeaseRowOrder<T extends { status: string; moveInDate?: Date | string | null }>(
  leases: T[],
): T[] {
  const residing: string[] = CURRENT_OCCUPANCY_STATUSES
  return [
    ...sortByMoveIn(leases.filter(l => residing.includes(l.status))),
    ...sortByMoveIn(leases.filter(l => l.status === 'RESERVED')),
    ...sortByMoveIn(leases.filter(l => l.status === 'NON_RESIDENT')),
  ]
}

/**
 * 방이 언제 비는가 — 지금(now) / 그 날부터(soon) / 모른다(null).
 *
 *   점유 계약 없음   → 지금 입주 가능(비거주만 있는 방은 방 설정 nonResidentVacant 를 그대로 따른다)
 *   전부 퇴실일 있음 → 곧 입주 가능(입주 가능일 = 마지막 퇴실일 다음 날)
 *   하나라도 무기한  → 모른다(null)
 *
 * 호실 관리 '입주 가능' 칩이 쓰던 판정을 여기로 올렸다(2026-08-11). 홈 매칭 알림이 자기 방 축
 * (isVacant + 퇴실 예정 방)을 따로 들고 있어서 같은 방을 두 화면이 다르게 세고 있었다 — 409·404호처럼
 * 퇴실일이 잡힌 예약이 걸린 방은 호실 관리에선 '입주 가능'인데 매칭에선 아예 없는 방이었다.
 * 칩이 아니라 방 단위 사실로 묻는 이유는 2026-08-10 기록 그대로다: 한 방에 계약이 둘이면
 * 주 계약 하나로 분류하는 순간 나머지 사실이 사라진다.
 *
 * 월 창은 보지 않고 날짜만 본다 — CHECKOUT_PENDING 과 ACTIVE 단기가 같은 자격인 이유다.
 * expectedMoveOut 은 'YYYY-MM-DD' 문자열이거나 @db.Date(UTC 자정)다. 둘 다 UTC 로 읽어 기기 시간대를 배제한다.
 */
export type RoomAvailability = { kind: 'now' } | { kind: 'soon'; availableFrom: string }
export function roomAvailability(room: {
  nonResidentVacant: boolean
  leaseTerms: { status: string; expectedMoveOut: Date | string | null }[]
}): RoomAvailability | null {
  const ymd = (d: Date | string | null): string | null =>
    d == null ? null : typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10)
  const occupying: string[] = OCCUPYING_STATUSES
  const occ = room.leaseTerms.filter(l => occupying.includes(l.status))
  if (occ.length === 0) {
    // 비거주(창고·사무실)만 있는 방 — 방 설정이 공실로 보라고 할 때만 입주 가능(415호·사무실 오탐 방지).
    if (room.leaseTerms.some(l => l.status === 'NON_RESIDENT') && !room.nonResidentVacant) return null
    return { kind: 'now' }
  }
  const outs = occ.map(l => ymd(l.expectedMoveOut))
  if (outs.some(o => o == null)) return null
  const lastOut = outs.reduce((m, o) => (o! > m! ? o : m), outs[0])!
  // 'YYYY-MM-DD' 하루 더하기 — 파싱·포맷을 둘 다 UTC 로 묶어 기기 시간대가 끼어들 틈을 없앤다.
  const d = new Date(`${lastOut}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return { kind: 'soon', availableFrom: d.toISOString().slice(0, 10) }
}

/**
 * 입주 가능일 한 줄 — "2026.08.30부터". 날짜가 잡힌 방(soon)에만 값이 있고, 나머지는 null 이다.
 *
 * 'now' 에 문구를 안 주는 이유: 지금 비어 있다는 사실은 이미 상태 줄이 '공실'로 말한다. 같은 사실을
 * 두 줄로 적으면 읽는 사람이 다른 뜻을 찾는다. 'null'(무기한 계약이 걸린 방)은 애초에 모르는 값이다.
 * 날짜 표기는 fmtDateDot 정본 — 목록·표의 '2026.08.30' 문법이다.
 *
 * 조사 '부터'는 앞말에 붙여 쓴다 — 형제 availableFromLabel("8/30부터")·fmtRentApplyFrom("9월분부터")과
 * 같은 규칙이다. 종전의 "2026.08.30 부터" 는 프리즘 한 자리에서만 띄어 써 같은 사실이 화면마다
 * 다르게 적히던 자리였다(§29).
 */
export function availableFromText(availability: RoomAvailability | null | undefined): string | null {
  return availability?.kind === 'soon' ? `${fmtDateDot(availability.availableFrom)}부터` : null
}

/**
 * 고객 관리 목록 표시 대상 — 투어 단계부터 비거주까지 진행 중인 모든 단계.
 * 퇴실(CHECKED_OUT) · 취소(CANCELLED) 만 제외.
 */
export const TENANT_LIST_STATUSES: LeaseStatus[] = [
  'WAITING_TOUR', 'TOUR_DONE', 'RESERVED', 'ACTIVE', 'CHECKOUT_PENDING', 'NON_RESIDENT',
]

/**
 * 종료된 lease — 공실 방의 직전 입주자 표시, 평균 거주기간 통계 등.
 */
export const CLOSED_STATUSES: LeaseStatus[] = ['CHECKED_OUT', 'CANCELLED']

/**
 * 퇴실 예정 보조 문구 — "6/26 퇴실 D-13" / "오늘 6/26 퇴실" / "6/26 퇴실 13일 경과".
 * 수납 관리(rooms)와 호실 관리(room-manage)가 같은 문장을 쓰도록 여기서 한 번만 만든다.
 * expectedMoveOut 은 'YYYY-MM-DD' (KST 고정 문자열).
 *
 * 오늘은 kstDaysUntil(=kstYmdStr) 로 뽑는다. new Date() 로 뽑던 시절엔 서버(UTC)와 기기(KST)가
 * KST 00~09시에 하루 다른 오늘을 봐서 같은 퇴실일이 D-11 / D-10 으로 갈렸고, 그 텍스트 불일치가
 * React #418 하이드레이션 오류로 올라왔다(신고 d4bd3aa5·9c09ca50, KST 01:13 발생).
 */
export function checkoutSubText(expectedMoveOut: string | null): string | null {
  const label = checkoutDateLabel(expectedMoveOut)
  if (!label) return null
  const days = kstDaysUntil(expectedMoveOut!)
  return days > 0 ? `${label} D-${days}` : days === 0 ? `오늘 ${label}` : `${label} ${Math.abs(days)}일 경과`
}

/**
 * 날짜만 세우는 짧은 라벨 — "8/14 퇴실" / "8/17 입실". checkoutSubText 의 앞머리와 같은 문장이다.
 *
 * D-day 를 왜 떼는가 — §11 보조줄 예시("6/13 퇴실 D-3")는 목록 행처럼 폭이 넉넉한 자리의 문법이다.
 * 홈 방 현황 타일은 320px 화면에서 글자가 놓이는 폭이 68px 뿐이라 D-day 를 붙이면 10.5px 글자
 * 기준으로 잘린다. 잘린 날짜는 없는 날짜보다 나쁘므로 좁은 자리에서는 날짜만 세운다.
 */
export function checkoutDateLabel(expectedMoveOut: string | null): string | null {
  if (!expectedMoveOut) return null
  const [, mm, dd] = expectedMoveOut.split('-')
  return `${Number(mm)}/${Number(dd)} 퇴실`
}

/**
 * 입실 예정 짧은 라벨 — "8/17 입실". 퇴실 표기(checkoutDateLabel)와 대칭.
 * 명사는 '입실' — RESERVED 를 부르는 말은 수납·호실관리·고객관리가 이미 '입실 예약'으로 통일돼 있다.
 */
export function moveInDateLabel(moveInDate: string | null): string | null {
  if (!moveInDate) return null
  const [, mm, dd] = moveInDate.split('-')
  return `${Number(mm)}/${Number(dd)} 입실`
}

/**
 * 입주 가능 짧은 라벨 — "8/16부터". 퇴실·입실 라벨(checkoutDateLabel·moveInDateLabel)의 세 번째 형제다.
 *
 * 폭이 넉넉한 자리는 availableFromText("2026.08.30 부터")를 쓰고, 좁은 자리(홈 타일 밴드 68px·
 * 호실 카드 메타 칩·고객 상세 위젯)는 이쪽이다. 조사 '부터'는 앞말에 붙여 쓴다.
 * 문자열을 여기 한 번만 두는 이유는 형제 둘과 같다 — 화면마다 조립하면 같은 날짜를 다르게 적는다.
 */
export function availableFromLabel(availableFrom: string): string {
  const [, mm, dd] = availableFrom.split('-')
  return `${Number(mm)}/${Number(dd)}부터`
}

/**
 * 입주 예정 보조 문구 — "9/1 입주 예정". 퇴실 표기(checkoutSubText)와 대칭인 짧은 인라인 날짜.
 */
export function moveInSubText(moveInDate: string | null): string | null {
  if (!moveInDate) return null
  const [, mm, dd] = moveInDate.split('-')
  return `${Number(mm)}/${Number(dd)} 입주 예정`
}

/**
 * 예약 계약의 보조 문구 — "8/17 입주 예정 · 8/29 퇴실 D-18". 언제 들어오고 언제 나가는가를 한 줄로.
 *
 * 호실 카드(RoomManageClient)가 RESERVED 분기에서 만들던 문장 그대로다. 프리즘 호실 면의 예약자
 * 줄은 입주 예정일만 보여 줘서, 퇴실일까지 잡힌 예약(404호 8/15~8/31)이 카드에는 있고 모달에는
 * 없었다. 문장을 두 곳이 각자 들면 primaryRoomLease 때와 같은 길을 간다 — 여기 하나로 둔다.
 *
 * 빈 문자열을 돌려줄 수 있다(두 날짜 모두 없는 예약). 호출부가 `|| undefined` 로 받는 종전 문법을 유지한다.
 */
export function reservationSubText(lease: { moveInDate: string | null; expectedMoveOut: string | null }): string {
  return [moveInSubText(lease.moveInDate), checkoutSubText(lease.expectedMoveOut)].filter(Boolean).join(' · ')
}

/**
 * 단기 퇴실 도래 — 단기는 D-1 자동 전환 전까지 ACTIVE 로 남아 화면에 퇴실 신호가 늦게 붙는다.
 * 상태·청구·전환 크론은 그대로 두고, 사실 축(퇴실 예정일)에서 표기와 칩 포함만 파생한다.
 * 두 화면(수납 관리·호실 관리)이 같은 판정을 쓰도록 여기가 정본이다.
 */
export function isShortTermCheckoutDue(
  lease: { isShortTerm: boolean; status: string | null; expectedMoveOut: string | null },
  targetMonth: string,
): boolean {
  const ck = lease.expectedMoveOut?.slice(0, 7) ?? null
  return lease.isShortTerm && lease.status === 'ACTIVE' && !!ck && ck <= targetMonth
}

/**
 * 호실 상태 — 그 방을 한 줄로 뭐라 부를 것인가(공실·비거주·입실 예약·거주중·퇴실 예정).
 *
 * 카드(호실 관리)와 프리즘 호실 면(모달)이 각자 판정하다 갈렸다. 모달은 기준월이 없어 단기 퇴실
 * 도래를 못 물었고(402·503호는 카드 [퇴실 예정] 인데 모달은 '거주중'), 비거주를 아예 조회에서
 * 빼 415호·사무실이 모달에서만 '공실'이 됐다. 라벨을 만드는 자리를 여기 하나로 둔다.
 *
 * lease 는 primaryRoomLease 가 고른 주 계약이다(없으면 공실). 보조 문구(퇴실 D-day·입주 예정일)
 * 처럼 화면마다 다른 장식은 호출 측이 이 결과 위에 얹는다 — 라벨·뱃지·카드 종류까지가 여기 몫이다.
 */
export type RoomStatusView = {
  label: string
  kind: 'resident' | 'vacant'
  badge: { tone: 'movein' | 'exit' | 'info'; label: string } | null
}
export function roomStatusView(
  lease: { status: string; isShortTerm: boolean; expectedMoveOut: string | null } | null | undefined,
  opts: { nonResidentVacant: boolean; targetMonth: string },
): RoomStatusView {
  if (!lease)
    return { label: '공실', kind: 'vacant', badge: null }
  if (lease.status === 'NON_RESIDENT')
    return opts.nonResidentVacant
      ? { label: '공실', kind: 'vacant', badge: { tone: 'info', label: '비거주' } }
      : { label: '비거주', kind: 'resident', badge: { tone: 'info', label: '비거주' } }
  // 라벨 '입실 예약' 통일 — 수납(rooms)·고객관리·lib/statusColors 와 동일 용어 (e1b81629 재정의)
  if (lease.status === 'RESERVED')
    return { label: '입실 예약', kind: 'vacant', badge: { tone: 'movein', label: '입실 예약' } }
  if (lease.status === 'CHECKOUT_PENDING')
    return { label: '퇴실 예정', kind: 'resident', badge: { tone: 'exit', label: '퇴실 예정' } }
  // 단기 퇴실 도래 — 상태는 아직 ACTIVE 라 라벨·카드 종류는 거주중을 유지하고, 퇴실 신호만 뱃지로 얹는다.
  if (isShortTermCheckoutDue(lease, opts.targetMonth))
    return { label: '거주중', kind: 'resident', badge: { tone: 'exit', label: '퇴실 예정' } }
  return { label: '거주중', kind: 'resident', badge: null }
}

/**
 * CHECKED_OUT lease 의 그 달 귀속 paymentRecord 합계.
 * totalExpected (발생주의 청구) 의 단기·중도퇴실 보정 — rentAmount 전체가 아닌
 * 실제 정산된 금액(일할 등)이 paymentRecord 에 들어 있으므로 그대로 사용.
 */
export async function getCheckedOutRecognizedRevenue(
  prisma: PrismaDb,
  propertyId: string,
  targetMonth: string,
): Promise<number> {
  const agg = await prisma.paymentRecord.aggregate({
    where: {
      propertyId, targetMonth, isDeposit: false, isPrevOwner: false,
      leaseTerm: { status: 'CHECKED_OUT' },
    },
    _sum: { actualAmount: true },
  })
  return agg._sum.actualAmount ?? 0
}

/**
 * 그 달 실수납 매출(이용료 축) — 보증금·기타수익은 다른 축이라 여기 없다.
 *
 *   거주·비거주 계약   Σ min(그 달 귀속 수납 합, **그 달 청구액**)
 *   퇴실 계약          Σ 그 달 귀속 수납 합 (= getCheckedOutRecognizedRevenue 정본, 같은 값)
 *
 * 왜 정본으로 올렸나 (2026-08-11, 회계 패널).
 *   홈 안에서 예상 축과 실수납 축이 서로 다른 상한을 쓰고 있었다. 예상 축은 그 달 청구액
 *   (billForLeaseMonth, 락인 반영)인데, 실수납 축은 퇴실 계약에 대해 `lease.rentAmount` 로
 *   캡했다. 그런데 rentAmount 는 오늘의 가격표(가변 마스터)고 락인은 그 달의 확정 청구권
 *   (불변 기록)이다. 가변 마스터로 과거를 재계산하면 방 가격을 고치는 순간 마감한 달의
 *   숫자가 바뀐다 — 결산 재현성이 없어진다.
 *
 *   실측(제기역점): 502호 남태우는 5·6월 청구가 각각 470,000 으로 락인돼 있고 그대로 완납했는데,
 *   나중에 rentAmount 가 440,000 이 되면서 두 달 합 60,000 이 실수납에서 잘렸다. 그 결과
 *   `pendingRevenue = projectedRevenue − totalRevenue` 가 **이미 퇴실하고 완납한 사람에게서**
 *   30,000 을 미수로 세웠다. 잘린 돈은 매출도 부채도 아니게 증발한다.
 *
 *   반대로 헐겁기도 했다. 519호 임형진 6월은 실제 청구 370,000 인데 캡이 470,000, 418호 서민준
 *   6월은 실제 청구 80,000 인데 캡이 400,000 이었다. 보호장치가 아니라 보호장치라는 이름뿐이었다.
 *
 * 상한을 무엇으로 두는가 — **그 축이 인식하는 그 달 청구액**이다.
 *   거주·비거주의 인식액은 billThisMonth(양도인 귀속월 0 · 무청구 퇴실월 0 · 나머지는 락인 반영)라
 *   상한도 같은 값이다. 퇴실 계약의 인식액은 정책상 rentAmount 가 아니라 '그 달 귀속 수납 합'
 *   자체이므로(일할 정산되는 짧은 거주를 과다 인식하지 않기 위한 기존 정본), 상한도 그 값과 같다.
 *   즉 퇴실 항은 예상 축과 실수납 축이 **문자 그대로 같은 함수**를 부른다 — 두 축이 갈릴 여지가 없다.
 *   회계 패널은 퇴실 항에도 락인 캡을 걸자고 했으나(진짜 과납이 조용히 수익이 되는 것을 막자는 취지),
 *   그러면 인식 축(무캡)과 실수납 축(유캡)이 다시 갈려 같은 이름의 숫자가 화면마다 달라진다.
 *   그 취지는 캡이 아니라 감지망으로 옮겼다 — verify-money-consistency 가 '퇴실 계약의 그 달 수납이
 *   그 달 락인 청구를 넘는' 건을 직접 잡는다.
 *
 * 반환값을 쪼개 주는 이유는 수납 관리 캡션이 항별로 등식을 적기 때문이다.
 */
export type PaidRevenueBreakdown = {
  occupied: number     // 거주·비거주 계약분
  checkedOut: number   // 퇴실 계약분 (= getCheckedOutRecognizedRevenue)
  total: number
}

export async function getPaidRevenue(
  prisma: PrismaDb,
  propertyId: string,
  targetMonth: string,
): Promise<PaidRevenueBreakdown> {
  const byMonth = await getPaidRevenueByMonths(prisma, propertyId, [targetMonth])
  return byMonth.get(targetMonth) ?? { occupied: 0, checkedOut: 0, total: 0 }
}

/**
 * 여러 달을 한 번에 — 추이 그래프처럼 월이 6·12·24개인 자리를 위한 배치형. 값은 getPaidRevenue 와 같다.
 *
 * 왜 배치인가 (2026-08-12, 회계 패널). 추이 막대의 수입은 그 달 귀속 수납의 **무캡 합**이었다.
 * 홈 KPI 실수납은 그 달 청구액으로 캡한 합인데, 같은 화면 같은 달을 두 식이 말하고 있었다.
 * 오늘 실데이터로는 6개월 전부 차 0원이지만 그건 아직 과납·양도인 겹침이 없어서지 규칙이 같아서가
 * 아니다. 그래서 추이가 정본을 부르게 하고, 부르려면 월마다 5쿼리를 돌 수는 없어 여기를 배치로 연다.
 *
 * 월에 의존하는 조회는 paymentRecord 둘과 퇴실 집계 하나뿐이라 `in` 하나로 묶인다. 계약 조회와
 * 영업장 조회는 월과 무관하므로 몇 달을 물어도 그대로 한 번이다. 즉 6개월도 5쿼리, 24개월도 5쿼리다.
 *
 * getPaidRevenue 는 이 함수에 위임만 한다 — 사본을 두면 이 문제를 세 번째로 반복한다.
 */
export async function getPaidRevenueByMonths(
  prisma: PrismaDb,
  propertyId: string,
  months: string[],
): Promise<Map<string, PaidRevenueBreakdown>> {
  const out = new Map<string, PaidRevenueBreakdown>()
  if (months.length === 0) return out

  // 양도인 귀속 기준일 — 별도 설정이 없으면 인수일. 수납 화면(getRoomPaymentStatus)과 같은 기준이다.
  const property = await prisma.property.findUnique({
    where: { id: propertyId },
    select: { acquisitionDate: true, prevOwnerCutoffDate: true },
  })
  const cutoff = property?.prevOwnerCutoffDate ?? property?.acquisitionDate ?? null

  const [leases, payments, prevOwnerRows, checkedOutRows] = await Promise.all([
    prisma.leaseTerm.findMany({
      where: { propertyId, status: { in: BILLABLE_STATUSES } },
      select: {
        id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true,
        dueDay: true, overrideDueDay: true, overrideDueDayMonth: true,
        checkoutProratedAmount: true, checkoutProratedMonth: true,
        discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
        room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },
      },
    }),
    prisma.paymentRecord.findMany({
      where: {
        propertyId, targetMonth: { in: months }, isDeposit: false, isPrevOwner: false,
        ...(cutoff ? { payDate: { gte: cutoff } } : {}),
      },
      select: { targetMonth: true, leaseTermId: true, actualAmount: true, expectedAmount: true },
    }),
    // 양도인 귀속월 판정 — 보증금 record 는 월 청구 축이 아니라 제외한다(홈 allHistoricalPayments·
    // 수납 화면 allRecordsThruMonth 둘 다 isDeposit:false 로 모은 뒤 isPrevOwner 를 본다).
    prisma.paymentRecord.findMany({
      where: { propertyId, targetMonth: { in: months }, isDeposit: false, isPrevOwner: true },
      select: { targetMonth: true, leaseTermId: true },
    }),
    // 퇴실 항 — getCheckedOutRecognizedRevenue 와 같은 where 를 달별로 묶은 것뿐이다(payDate 컷오프 없음).
    prisma.paymentRecord.groupBy({
      by: ['targetMonth'],
      where: {
        propertyId, targetMonth: { in: months }, isDeposit: false, isPrevOwner: false,
        leaseTerm: { status: 'CHECKED_OUT' },
      },
      _sum: { actualAmount: true },
    }),
  ])

  const prevOwnerByMonth = new Map<string, Set<string>>()
  for (const p of prevOwnerRows) {
    let s = prevOwnerByMonth.get(p.targetMonth)
    if (!s) { s = new Set(); prevOwnerByMonth.set(p.targetMonth, s) }
    s.add(p.leaseTermId)
  }
  const paidByMonth = new Map<string, Map<string, number>>()
  const lockedByMonth = new Map<string, Map<string, number>>()
  for (const p of payments) {
    let paidByLease = paidByMonth.get(p.targetMonth)
    if (!paidByLease) { paidByLease = new Map(); paidByMonth.set(p.targetMonth, paidByLease) }
    paidByLease.set(p.leaseTermId, (paidByLease.get(p.leaseTermId) ?? 0) + p.actualAmount)
    let lockedByLease = lockedByMonth.get(p.targetMonth)
    if (!lockedByLease) { lockedByLease = new Map(); lockedByMonth.set(p.targetMonth, lockedByLease) }
    if (p.expectedAmount > (lockedByLease.get(p.leaseTermId) ?? 0)) lockedByLease.set(p.leaseTermId, p.expectedAmount)
  }
  const checkedOutByMonth = new Map(checkedOutRows.map(r => [r.targetMonth, r._sum.actualAmount ?? 0]))

  for (const targetMonth of months) {
    const prevOwnerLeases = prevOwnerByMonth.get(targetMonth) ?? new Set<string>()
    const paidByLease = paidByMonth.get(targetMonth)
    const lockedByLease = lockedByMonth.get(targetMonth)
    const checkedOut = checkedOutByMonth.get(targetMonth) ?? 0

    let occupied = 0
    for (const l of leases) {
      const paid = paidByLease?.get(l.id) ?? 0
      if (paid <= 0) continue
      // 아직 입주 전인 계약은 그 달 청구 대상이 아니다 — 예상 축·수납 화면 행과 같은 게이트.
      const moveInMonth = monthOfDate(l.moveInDate)
      if (moveInMonth && moveInMonth > targetMonth) continue
      occupied += Math.min(paid, monthBillForRevenue(l, targetMonth, {
        isPrevOwnerMonth: prevOwnerLeases.has(l.id),
        locked: lockedByLease?.get(l.id) ?? null,
      }))
    }
    out.set(targetMonth, { occupied, checkedOut, total: occupied + checkedOut })
  }
  return out
}

/**
 * 그 달 청구액(매출 인식용) — 양도인 귀속월과 무청구 퇴실월은 0, 나머지는 lib/billing 정본.
 * dashboard 의 billThisMonth 와 같은 규칙이며 수납 화면 행의 rowExpected 와도 같다.
 */
function monthBillForRevenue(
  l: BillingLeaseFields & { expectedMoveOut?: Date | string | null; dueDay?: string | null; overrideDueDay?: string | null; overrideDueDayMonth?: string | null },
  targetMonth: string,
  opts: { isPrevOwnerMonth: boolean; locked: number | null },
): number {
  if (opts.isPrevOwnerMonth) return 0
  if (isAfterMoveOutMonth(l.expectedMoveOut ?? null, targetMonth)) return 0
  const dueRaw = (l.overrideDueDayMonth === targetMonth && l.overrideDueDay) ? l.overrideDueDay : (l.dueDay ?? null)
  if (isCheckoutNoBillingMonthFor(l, l.expectedMoveOut ?? null, targetMonth, resolveDueDateForMonth(dueRaw, targetMonth))) return 0
  return billForLeaseMonth(l, targetMonth, opts.locked)
}

/**
 * 예약 확정(RESERVED) lease 의 그 달 예상 매출 — 입주 예정월이 그 달 이내면 전액(할인·예약 인상 반영).
 * (사용자 결정 2026-06-20: RESERVED 이상은 그 달 전액으로 예상 매출에 반영. 입주 후엔 ACTIVE 로 일반 청구.)
 *
 * dashboard/page.tsx 안에 갇혀 있던 계산을 문자 그대로 옮긴 것이다(2026-08-07). 수납 관리 화면이
 * 홈 예상 수입과의 차이를 등식 캡션으로 적으려면 같은 값을 같은 식으로 구해야 한다 — 한쪽이
 * 자기 식을 만드는 순간 두 화면 숫자가 다시 갈린다.
 */
export async function getReservedFullMonthRevenue(
  prisma: PrismaDb,
  propertyId: string,
  targetMonth: string,
): Promise<number> {
  const reservedLeases = await prisma.leaseTerm.findMany({
    where: { propertyId, status: 'RESERVED', rentAmount: { gt: 0 } },
    select: {
      id: true, status: true, rentAmount: true, isShortTerm: true, moveInDate: true, expectedMoveOut: true,
      checkoutProratedAmount: true, checkoutProratedMonth: true,
      discounts: { select: { discountType: true, value: true, scope: true, startMonth: true, endMonth: true } },
      room: { select: { scheduledRent: true, rentUpdateDate: true, nonResidentScheduled: true, nonResidentRentDate: true } },   // 예약 인상 — 미래월 청구 반영(거주·비거주 두 축)
    },
  })
  // 이번달(targetMonth) 청구 대상 여부 — 입주월 ≤ 대상월 ≤ 퇴실월.
  // (다음달 입주 예정인 계약이 이번달 예상매출에 잡히던 버그 방지: 507·509호 사례)
  const monthOfDate = (d: Date | string | null): string | null => {
    if (!d) return null
    const dt = new Date(d)
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}`
  }
  const billableInTargetMonth = (l: { moveInDate?: Date | string | null; expectedMoveOut?: Date | string | null }): boolean => {
    const mi = monthOfDate(l.moveInDate ?? null)
    if (mi && mi > targetMonth) return false   // 아직 입주 전
    const mo = monthOfDate(l.expectedMoveOut ?? null)
    if (mo && mo < targetMonth) return false   // 이미 퇴실
    return true
  }
  return reservedLeases
    .filter(l => billableInTargetMonth(l))
    .reduce((s, l) => s + billForLeaseMonth(l, targetMonth, null), 0)
}
