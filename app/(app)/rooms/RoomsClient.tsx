'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import MonthSelector from '@/components/layout/MonthSelector'
import { formatPhone } from '@/lib/formatPhone'
import { useUrlState } from '@/lib/useUrlState'
import { useLongPress } from '@/lib/useLongPress'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { InfoHint } from '@/components/ui/InfoHint'
import { SortSelect } from '@/components/ui/SortSelect'
import { RoomCard } from '@/components/ui/RoomCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { SearchBar } from '@/components/ui/SearchBar'
import { IncomeSection, type Income, type LeaseOption } from './IncomeSection'
import { DepositSection } from './DepositSection'
import type { DepositPerTenant, DepositLedgerEntry } from '@/app/(app)/finance/actions'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { fmtKorMoney, fmtWon, fmtNoBillCovered } from '@/lib/fmtMoney'
import { MoneyEquation, expectedRevenueTerms, paidRevenueTerms } from '@/components/ui/MoneyEquation'
import { DisplayFieldsMenu } from '@/components/ui/DisplayFieldsMenu'
import { Modal } from '@/components/ui/Modal'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { dueDayBucketOf, DUE_DAY_BUCKET_OPTIONS, type DueDayBucket } from '@/lib/dueDayBucket'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { CashReceiptTab } from '@/components/rooms/CashReceiptTab'

type CashReceiptCandidate = {
  leaseTermId: string; tenantId: string; roomNo: string; tenantName: string
  payYmd: string; payMethod: string; amount: number; deposit: number; cleaning: number
}
type CashReceiptIssued = {
  roomNo: string; tenantName: string; amount: number
  issuedYmd: string; payYmd: string; payMethod: string | null
}
import { pushToast } from '@/lib/saveStatus'
import { kstYmdStr, kstDaysUntil } from '@/lib/kstDate'
import { checkoutSubText, isShortTermCheckoutDue } from '@/lib/leaseStatus'
import { batchRecordRentPayment, batchDeletePayments } from './actions'
import { StatusBadge, statusTipColor, statusRowTint, type BadgeTone } from '@/components/ui/StatusBadge'
import { fmtRoomNo } from '@/lib/roomNo'

// 뷰 전환 탭(v2.0 §25) — URL ?tab= 값과 같은 문자열이다. 홈 KPI 딥링크가 이 값으로 들어온다.
type ViewTabId = 'rooms' | 'income' | 'deposit' | 'receipt'

type RoomStatus = {
  roomId: string
  roomNo: string
  type: string | null
  floor: string | null
  windowType: string | null
  direction: string | null
  isVacant: boolean
  tenantId: string | null
  tenantName: string | null
  contact: string | null
  status: string | null
  expected: number
  dueDay: string | null
  // 단기 계약 — 입주월 1회 전액 청구라 반복 납부일 표기가 성립하지 않는다(표시 가드 전용).
  isShortTerm: boolean
  currentPaid: number
  carryOver: number
  cashReceiptIssued?: boolean   // 이달 현금영수증 발행분 존재(표시 메타)
  totalPaid: number
  balance: number
  isPaid: boolean
  leaseTermId: string | null
  depositAmount: number
  cleaningFee: number
  accumulatedUnpaid: number
  isFutureMonth: boolean
  baseRent: number
  prevTenantName: string | null
  prevContact: string | null
  overrideDueDay: string | null
  overrideDueDayMonth: string | null
  overrideDueDayReason: string | null
  moveInDate: string | null
  prevPaidThisMonth: boolean
  firstUnpaidMonth: string | null
  isReservationConfirmed: boolean
  latePaidAt: string | null
  lastPayDate: string | null
  nextDueDate: string | null
  nextDueAmount: number
  expectedMoveOut: string | null
  // 이 달 청구가 없는 이유 — 서버 판정(rooms/actions.ts). 표시 전용, 집계·정렬·필터 무관.
  noBillReason?: 'shortTermPrepaid' | 'checkoutNoBilling' | null
  noBillCoveredAmount?: number | null
  noBillCoveredDate?: string | null
  noBillCoveredMonth?: string | null
}

// ── 열 설정 ──────────────────────────────────────────────────────

type ColKey = 'type' | 'windowType' | 'contact' | 'depositAmount' | 'expected' | 'totalPaid' | 'balance' | 'dueDay' | 'cashReceipt' | 'status'

// defaultOn — 데스크탑 표 + 모바일 카드 공통 정책. 모바일 카드에서 항상 보이던 '타입'을
// colVis 토글 대상에 편입하면서 default true 로 변경 (회귀 방지, 2026-06-01).
const COL_DEFS: { key: ColKey; label: string; defaultOn: boolean }[] = [
  { key: 'type',          label: '타입',     defaultOn: true  },
  { key: 'windowType',    label: '창문',     defaultOn: false },
  { key: 'contact',       label: '연락처',   defaultOn: true  },
  { key: 'depositAmount', label: '보증금',   defaultOn: false },
  { key: 'expected',      label: '월 이용료', defaultOn: true  },
  { key: 'totalPaid',     label: '총납부액', defaultOn: true  },
  { key: 'balance',       label: '잔액',     defaultOn: true  },
  { key: 'dueDay',        label: '납부일',   defaultOn: true  },
  { key: 'cashReceipt',   label: '현금영수증', defaultOn: true },   // 리스트에서 발행 여부 바로 확인(운영자 지시 2026-07-14)
  { key: 'status',        label: '수납 상태', defaultOn: true  },
]

const DEFAULT_VIS = Object.fromEntries(
  COL_DEFS.map(c => [c.key, c.defaultOn])
) as Record<ColKey, boolean>

// ── 공실 열 설정 ──────────────────────────────────────────────────

type VacantColKey = 'type' | 'windowType' | 'direction' | 'floor' | 'baseRent' | 'prevTenantName' | 'prevContact'
type VacantSortKey = 'roomNo' | 'type' | 'windowType' | 'baseRent' | 'prevTenantName'

const VACANT_COL_DEFS: { key: VacantColKey; label: string; defaultOn: boolean }[] = [
  { key: 'type',          label: '타입',       defaultOn: true  },
  { key: 'windowType',    label: '창문',       defaultOn: true  },
  { key: 'direction',     label: '방향',       defaultOn: true  },
  { key: 'floor',         label: '층',         defaultOn: false },
  { key: 'baseRent',      label: '기본 월이용료', defaultOn: true  },
  { key: 'prevTenantName', label: '직전 입주자', defaultOn: false },
  { key: 'prevContact',   label: '직전 연락처', defaultOn: false },
]

const DEFAULT_VACANT_VIS = Object.fromEntries(
  VACANT_COL_DEFS.map(c => [c.key, c.defaultOn])
) as Record<VacantColKey, boolean>

const COL_WIDTHS_KEY = 'stayeum_rooms_col_widths'
const FILTER_KEY   = 'stayeum_rooms_filter'
const SORTKEY_KEY  = 'stayeum_rooms_sortkey'
const SORTDIR_KEY  = 'stayeum_rooms_sortdir'
const FILTER_VALUES = ['all', 'unpaid', 'checkout', 'awaiting', 'paid', 'adjusted', 'vacant'] as const
type RoomFilter = typeof FILTER_VALUES[number]

const DEFAULT_WIDTHS: Record<string, number> = {
  roomNo: 80, tenantName: 140,
  contact: 130, type: 80, windowType: 80,
  depositAmount: 100, expected: 110, totalPaid: 110,
  balance: 100, dueDay: 110, status: 130,
}

function loadColWidths(): Record<string, number> | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = localStorage.getItem(COL_WIDTHS_KEY)
    return raw ? JSON.parse(raw) : null
  } catch { return null }
}

const WINDOW_LABEL: Record<string, string> = {
  OUTER: '외창',
  INNER: '내창',
}

// 납부일 경과/잔여일 계산
// 오늘은 반드시 KST 기준(kstDaysUntil)이어야 한다 — new Date() 로 재면 서버(UTC)와 기기(KST)가
// KST 00~09시에 하루 다른 경과일을 내고, 그 숫자가 뱃지 문구로 렌더돼 하이드레이션이 갈린다.
function getDueInfo(dueDay: string | null, targetMonth: string): { days: number; overdue: boolean } | null {
  if (!dueDay) return null
  // 다음달 지정 전체 날짜 (YYYY-MM-DD)
  if (dueDay.includes('-')) {
    const diff = -kstDaysUntil(dueDay)
    return { days: Math.abs(diff), overdue: diff > 0 }
  }
  const [yyyy, mm] = targetMonth.split('-').map(Number)
  const dayNum = dueDay.includes('말')
    ? new Date(yyyy, mm, 0).getDate()
    : parseInt(dueDay)
  if (isNaN(dayNum)) return null
  // Date.UTC 는 로컬 생성자와 같은 자릿수 넘침 규칙을 쓴다(2월 31일 -> 3월 3일). 종전 동작 유지.
  const due  = new Date(Date.UTC(yyyy, mm - 1, dayNum)).toISOString().slice(0, 10)
  const diff = -kstDaysUntil(due)
  return { days: Math.abs(diff), overdue: diff > 0 }
}

function getEffectiveDueInfo(room: RoomStatus, targetMonth: string): ReturnType<typeof getDueInfo> {
  // 누적 미납자는 첫 미납월의 dueDay 기준으로 경과일 표시.
  // override는 그 override가 지정된 월(overrideDueDayMonth)에만 적용 — 미납월이
  // 그 달이면 어느 화면에서 보든 override를 사용해야 함.
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  const isOverrideActive = room.overrideDueDayMonth === dueMonth && !!room.overrideDueDay
  const effectiveDay = isOverrideActive ? room.overrideDueDay : room.dueDay
  return getDueInfo(effectiveDay, dueMonth)
}

// 납부일 셀 표기 — 임시조정이 그 달(미납월 우선)에 걸려 있으면 조정된 날짜를 보여준다.
// 종전에는 다른 달로 미룬 조정(전체 날짜형)일 때 서버가 원래 dueDay 를 내려보내, 화면이 '매월 말일'로
// 되돌아가 조정이 반영되지 않은 것처럼 보였다(405호 심원재, 운영자 지적 2026-08-01).
// 표기 문법은 DueDayTempAdjustWidget 의 fmtOvr 와 같다.
// 단기는 입주월 1회 전액 청구라 반복 납부일이 없다 — 목록·표의 납부일 자리는 비운다.
// (503호 송호준이 '청구 없음 · 입주월에 전액 납부'와 '매월 28일'을 동시에 달던 모순, 운영자 신고 2026-08-06)
function dueDayCellText(room: RoomStatus, targetMonth: string): string | null {
  if (room.isShortTerm) return null
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  const ovr = room.overrideDueDayMonth === dueMonth ? room.overrideDueDay : null
  if (ovr) {
    if (ovr.includes('-')) {
      const d = new Date(ovr + 'T00:00:00')
      return `${d.getMonth() + 1}월 ${d.getDate()}일 (조정)`
    }
    return ovr.includes('말') ? '말일 (조정)' : `${ovr}일 (조정)`
  }
  if (!room.dueDay) return null
  return room.dueDay === '말일' ? '매월 말일' : `매월 ${room.dueDay}일`
}

// 미납 배지 문구 — 납부일 당일은 아직 늦은 게 아니라 '납부일'로 표기한다(운영자 지시 2026-08-01).
// 톤은 unpaid 를 유지한다 — 오늘 받아야 할 건이라 시야에서 사라지면 안 된다. 계산·집계는 손대지 않고 표시만 바꾼다.
// days: 납부일로부터 경과일(0=오늘). 7일 초과면 연체.
// 미납 뱃지 라벨 — days 는 **절댓값**이라 방향(overdue)을 함께 봐야 한다.
// 405호 심원재가 7월분 납부 기한을 8/7 로 유예받았는데 8/2 에 '미납 5일 초과'로 뜬 것이 발단이다
// (운영자 지적 2026-08-02). 실제로는 5일 '남은' 상태다.
//
// 발생 범위는 좁다. 서버가 **당월은 납부일이 지나야** isPaid=false 로 내리므로(actions.ts:447),
// 월초 정상 납부 예정자는 애초에 이 분기에 안 들어오고 isAwaiting('납부 예정')으로 간다.
// 이 오표기는 **과거월 미납을 미래 날짜로 유예한 계약**에서만 난다. 실측 1건(405호).
//
// 라벨을 '납부 예정'으로 하지 않은 이유: 그 말은 isAwaiting 분기가 이미 쓰고 tone 도 다르며
// (await/Blue vs unpaid/Amber), 상단 필터 '납부 예정 N실'은 isPaid=true 만 세므로
// 그 라벨을 달아도 그 필터로 못 찾는다. 정렬 그룹도 미납(0)에 남는다.
//
// '납부 유예'는 여기서 빼고 호출부로 올렸다(2026-08-02). 어제는 이 분기에서만 붙였는데,
// 그러면 405호(미납 분기)만 유예로 보이고 516호(납부 예정 분기)는 그냥 '납부 예정'으로 남아
// 같은 사정이 화면에서 다른 말을 한다 — 운영자 지적 "일관성이 없어".
// 유예 판정은 isDeferredNow 정본이 하고, 이 함수는 유예가 아닌 경우만 맡는다.
function unpaidBadgeLabel(days: number | null | undefined, overdue?: boolean): '납부일' | '납부일 전' | '미납' | '연체' {
  if (days == null) return '미납'
  if (days === 0) return '납부일'
  if (!overdue) return '납부일 전'   // 기한 전인데 유예도 아님(앞당긴 조정 등). '미납 · 5일 남음'은 자기모순이다
  return days > 7 ? '연체' : '미납'
}

// 호실 수납 상태 → 배지/팁 톤. 수납(미납·연체)이 비거주보다 우선 —
// 비거주여도 미납이면 미납/연체 색으로 표시(회색으로 묻히지 않도록).
function roomStatusTone(room: RoomStatus, targetMonth: string): BadgeTone {
  if (room.status === 'RESERVED') return 'movein'
  if (!room.isPaid) {
    const info = getEffectiveDueInfo(room, targetMonth)
    return info && info.overdue && info.days > 7 ? 'overdue' : 'unpaid'
  }
  if (room.status === 'NON_RESIDENT') return 'info'
  const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
  if (room.status === 'CHECKOUT_PENDING' && !!checkoutMonth && checkoutMonth <= targetMonth) return 'exit'
  if (room.nextDueDate && room.nextDueAmount > 0) return 'await'
  return 'paid'
}

// 미납 미수액 — 이번 달 미수(이월 미수 + 당월 미수). 카드 잔액 표시와 동일한 계산을 공용화(표시·복사용, §4 재계산 없음).
function getTotalUnpaid(room: RoomStatus): number {
  const carryUnpaid = room.carryOver < 0 ? -room.carryOver : 0
  const viewUnpaid  = (!room.isPaid && room.carryOver === 0 && !room.nextDueDate && room.balance < 0)
    ? -room.balance : 0
  return carryUnpaid + viewUnpaid
}

// 독촉 문구 — 미납 방/세입자/대상월/미수액을 채운 표준 안내. 멀티테넌트 공용(지점·세입자 하드코딩 금지).
// 납부 기한을 미뤄준 상태인가 — 유예 판정 정본.
//
// 뱃지·독촉·홈 위젯이 각자 판정하면 화면마다 다른 말을 한다. 한 곳에서만 정한다.
// 조건 넷을 모두 만족해야 유예다.
//   ① 임시조정이 그 미납월에 걸려 있다  ② 원래 납부일보다 **뒤로** 미룬 것이다
//   ③ 그 날짜가 아직 안 지났다          ④ 아직 낼 게 남아 있다
// ②가 없으면 앞당긴 조정까지 유예가 되고, ④가 없으면 이미 다 낸 사람에게 유예 표시가 샌다.
function isDeferredNow(room: RoomStatus, targetMonth: string): boolean {
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  if (room.isPaid && !(room.nextDueDate && room.nextDueAmount > 0)) return false   // ④ 낼 게 없으면 유예가 아니다
  if (!room.overrideDueDay || room.overrideDueDayMonth !== dueMonth) return false
  const eff = getDueInfo(room.overrideDueDay, dueMonth)
  const base = getDueInfo(room.dueDay, dueMonth)
  if (!eff || !base) return false
  if (eff.overdue) return false                      // 조정일도 이미 지남 — 유예가 아니라 연체
  const effSigned = eff.overdue ? eff.days : -eff.days
  const baseSigned = base.overdue ? base.days : -base.days
  return effSigned < baseSigned                       // 원래보다 뒤로 미룬 경우만
}

// 유예된 기한을 'M월 D일' 로 — 독촉 문구·보조 텍스트 공용
function deferredDueLabel(room: RoomStatus, targetMonth: string): string | null {
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  const raw = room.overrideDueDayMonth === dueMonth ? room.overrideDueDay : null
  if (!raw) return null
  if (raw.includes('-')) {
    const d = new Date(raw + 'T00:00:00')
    return `${d.getMonth() + 1}월 ${d.getDate()}일`
  }
  const [y, m] = dueMonth.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const day = raw.includes('말') ? last : Math.min(parseInt(raw, 10), last)
  return `${m}월 ${day}일`
}

// 청구 없는 달 — '0원 · 완납'이 안 낸 사람처럼 읽히던 것을 사실대로 바꾼다(운영자 지적 2026-08-02).
// 이유는 서버가 내려보낸다(noBillReason). 여기서 다시 판정하지 않는다.
// 뱃지 클러스터에 '퇴실'이 세 번 나오던 것을 한 절로 합쳤다([청구 없음][퇴실 예정] + 보조줄).
function noBillSubText(room: RoomStatus): string {
  if (room.noBillReason === 'shortTermPrepaid') return '입주월에 전액 납부'
  const md = room.expectedMoveOut ? `${Number(room.expectedMoveOut.slice(5, 7))}/${Number(room.expectedMoveOut.slice(8))}` : null
  return md ? `${md} 퇴실까지 납부됨` : '퇴실일까지 납부됨'
}

// 캡션은 lib/fmtMoney 의 fmtNoBillCovered 정본을 쓴다(네 화면 공용).
function noBillCoveredText(room: RoomStatus): string | null {
  return fmtNoBillCovered({ month: room.noBillCoveredMonth, date: room.noBillCoveredDate, amount: room.noBillCoveredAmount })
}

// 유효 납부일을 'M/D' 로 — 뱃지 보조줄 전용 짧은 표기.
// 독촉 문자는 문장체라 'M월 D일'(deferredDueLabel)을 쓰고, 뱃지는 형제 문구(퇴실 '8/2')와 맞춰 슬래시형을 쓴다.
function effDueShort(room: RoomStatus, targetMonth: string): string | null {
  const dueMonth = room.firstUnpaidMonth ?? targetMonth
  const raw = (room.overrideDueDayMonth === dueMonth && room.overrideDueDay) ? room.overrideDueDay : room.dueDay
  if (!raw) return null
  if (raw.includes('-')) {
    const d = new Date(raw + 'T00:00:00')
    return `${d.getMonth() + 1}/${d.getDate()}`
  }
  const [y, m] = dueMonth.split('-').map(Number)
  const last = new Date(y, m, 0).getDate()
  const day = raw.includes('말') ? last : Math.min(parseInt(raw, 10), last)
  if (isNaN(day)) return null
  return `${m}/${day}`
}

// 미납·유예 뱃지 보조줄 정본 — 카드와 표가 같은 문장을 쓰게 한다(쌍둥이 구조라 한쪽만 고치면 또 어긋난다).
//
// 절은 최대 두 개다. 셋을 넣으면 360px 뷰포트 카드에서 넘친다(웹디자이너 지적 2026-08-02).
// StatusBadge 의 sub 는 whitespace-nowrap 이라 줄바꿈으로 흡수되지 않고 호실 쪽을 밀어낸다.
// 그래서 퇴실 정보가 붙는 경우 '남은 일수'를 뺀다 — 퇴실일이 더 급한 정보다.
//
// 유예는 대상월을 앞에 붙인다. 405호(지난달분을 미룸)와 516호(이번달분을 미룸)가 같은 라벨을 다는데
// 밀린 정도가 다르기 때문이다. 라벨로는 구분이 안 되니 보조줄이 그 차이를 진다.
function unpaidSubText(
  room: RoomStatus, targetMonth: string,
  info: { days: number; overdue: boolean } | null, deferred: boolean, exitSub: string | null,
): string | undefined {
  const parts: string[] = []
  const short = effDueShort(room, targetMonth)
  if (deferred) {
    // 대상월 접두는 대상월과 유예 날짜의 달이 **다를 때만** 정보를 준다.
    // 같은 달인데 붙이면 '8월분 8/12까지'로 월이 두 번 나온다(516호 유형).
    const mon = Number((room.firstUnpaidMonth ?? targetMonth).slice(5))
    const sameMonth = !!short && Number(short.split('/')[0]) === mon
    parts.push(short ? (sameMonth ? `${short}까지` : `${mon}월분 ${short}까지`) : `${mon}월분 유예`)
    if (!exitSub && info && !info.overdue) parts.push(info.days === 0 ? '오늘' : `${info.days}일 남음`)
  } else if (info && info.days !== 0) {
    if (info.overdue) parts.push(`${info.days}일 초과`)
    else {
      if (short) parts.push(`${short}까지`)
      if (!exitSub) parts.push(`${info.days}일 남음`)
    }
  }
  if (exitSub) parts.push(exitSub)
  return parts.join(' · ') || undefined
}

// 독촉 문구 — 기한을 미뤄준 사람에게 '확인되지 않았습니다'가 나가면 안 된다(운영자 지적 2026-08-02).
// 405호는 8/7 까지 미뤄줬는데 8/2 에 독촉 문구가 복사됐다. 표시가 아니라 **실제 발송 사고**다.
// 유예 중이면 독촉이 아니라 기한 안내로 문구를 바꾼다.
function buildReminderText(room: RoomStatus, targetMonth: string, unpaid: number): string {
  const monLabel = Number((room.firstUnpaidMonth ?? targetMonth).slice(5))
  const head = `안녕하세요. ${room.roomNo}호 ${room.tenantName ?? ''}님,`
  const due = isDeferredNow(room, targetMonth) ? deferredDueLabel(room, targetMonth) : null
  if (due) {
    return `${head} ${monLabel}월분 이용료 ${fmtWon(unpaid)}은 ${due}까지 납부해 주시기로 했습니다. 기한 내 납부 부탁드립니다.`
  }
  return `${head} ${monLabel}월분 이용료 ${fmtWon(unpaid)}이 아직 확인되지 않았습니다. 확인 부탁드립니다.`
}

// ── 정렬 ─────────────────────────────────────────────────────────

type SortKey = 'roomNo' | 'type' | 'windowType' | 'tenantName' | 'contact'
             | 'depositAmount' | 'expected' | 'totalPaid' | 'balance' | 'status' | 'dueDay' | 'cashReceipt'
type SortDir = 'asc' | 'desc'
const SORTKEY_VALUES: SortKey[] = ['roomNo', 'type', 'windowType', 'tenantName', 'contact', 'depositAmount', 'expected', 'totalPaid', 'balance', 'status', 'dueDay', 'cashReceipt']

function getDueSortValue(room: RoomStatus, targetMonth: string): number {
  const info = getEffectiveDueInfo(room, targetMonth)
  if (!info) return 0
  return info.overdue ? info.days : -info.days
}

function getEffectiveDueDayNum(room: RoomStatus, targetMonth: string): number {
  const isOverrideActive = room.overrideDueDayMonth === targetMonth && !!room.overrideDueDay
  const effectiveDay = isOverrideActive ? room.overrideDueDay : room.dueDay
  if (!effectiveDay) return 99
  if (effectiveDay.includes('-')) return parseInt(effectiveDay.split('-')[2]) || 99
  if (effectiveDay.includes('말')) return 32
  const d = parseInt(effectiveDay)
  return isNaN(d) ? 99 : d
}

function getSortValue(room: RoomStatus, key: SortKey, targetMonth: string): string | number {
  switch (key) {
    case 'roomNo':        return room.roomNo
    case 'type':          return room.type ?? ''
    case 'windowType':    return room.windowType ?? ''
    case 'tenantName':    return room.tenantName ?? ''
    case 'contact':       return room.contact ?? ''
    case 'depositAmount': return room.depositAmount
    case 'expected':      return room.expected
    case 'totalPaid':     return room.totalPaid
    case 'balance':       return room.balance
    case 'status':        return getDueSortValue(room, targetMonth)
    case 'dueDay':        return getEffectiveDueDayNum(room, targetMonth)
    case 'cashReceipt':   return room.cashReceiptIssued ? 0 : 1   // 발행 먼저
    default:              return ''
  }
}

// ── 컴포넌트 ─────────────────────────────────────────────────────

export default function RoomsClient({
  roomStatus, targetMonth, isFutureMonth, myRole, incomes, incomeCategories, payAggregates,
  reservedExpected, checkedOutRecognized, prepaidReceived, leaseOptions, depositSummary, depositLedger, receiptRows, initialTab,
}: {
  roomStatus: RoomStatus[]
  targetMonth: string
  // 아직 오지 않은 달인가 — 서버(KST)가 판정해 내려준다. 클라가 오늘을 다시 구하면 하이드레이션이 갈린다.
  isFutureMonth: boolean
  myRole: string
  incomes: Income[]
  incomeCategories: string[]
  payAggregates: { cashReceiptSum: number; cashReceiptCount: number; cardSum: number; cardCount: number }
  // 홈 예상 수입과의 다리 — 이 화면 청구액엔 안 잡히고 홈에는 잡히는 항(서버 계산 정본, 표시 전용)
  reservedExpected: number
  checkedOutRecognized: number
  // 미리 받은 그 달 이용료 — 홈 실수납과 같은 정본(getPaidRevenue)의 값. 미래월 보조줄 전용.
  prepaidReceived: number
  // 부가수익 입주자 연결 선택지 — 서버 정본(getExtraIncomeLeaseOptions). 그 달 수납 행에서 파생하지 않는다.
  leaseOptions: LeaseOption[]
  // 보증금 원장 — 월 스코프가 없는 전체 조회(서버 정본 getDepositSummaryByTenant·getDepositLedger)
  depositSummary: DepositPerTenant[]
  depositLedger: DepositLedgerEntry[]
  receiptRows: { candidates: CashReceiptCandidate[]; issued: CashReceiptIssued[] }
  initialTab?: ViewTabId
}) {
  const searchParams = useSearchParams()
  const entityModal = useEntityModal()
  // 수납 / 부가수익 / 보증금 탭 — 부가수익은 /finance에서 이동(2026-07-02, 과납·보증금 몰수 등 수납 파생 수익),
  // 보증금은 2026-08-12 이동(받고 돌려주는 돈이라 지출이 아니다).
  const [viewTab, setViewTab] = useState<ViewTabId>(initialTab ?? 'rooms')
  // 하이드레이션 #418 방지(서버 기본값 + 마운트 후 복원, 오류신고 5489fac1).
  const [filter, setFilter] = useState<RoomFilter>('all')
  useEffect(() => {
    const v = localStorage.getItem(FILTER_KEY)
    if (v && (FILTER_VALUES as readonly string[]).includes(v)) setFilter(v as RoomFilter)
  }, [])
  const [floorFilter, setFloorFilter] = useState('')
  const [showFilters, setShowFilters] = useState(false)   // 검색창 옆 필터 토글(정본 §23 호실관리 패턴)
  // 패널 필터 — 순수 표시 필터. 세션 한정(localStorage 비영속)
  const [dueDayFilter, setDueDayFilter]   = useState<'' | DueDayBucket>('')
  const [rentMinFilter, setRentMinFilter] = useState<number | undefined>(undefined)
  const [rentMaxFilter, setRentMaxFilter] = useState<number | undefined>(undefined)
  const [colVis, setColVis] = useState<Record<ColKey, boolean>>(DEFAULT_VIS)
  const [vacantColVis, setVacantColVis] = useState<Record<VacantColKey, boolean>>(DEFAULT_VACANT_VIS)
  const [vacantSortKey, setVacantSortKey] = useState<VacantSortKey>('roomNo')
  const [vacantSortDir, setVacantSortDir] = useState<SortDir>('asc')
  // 하이드레이션 #418 방지(서버 기본값 + 마운트 후 복원, 오류신고 5489fac1).
  const [sortKey, setSortKey] = useState<SortKey>('status')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  useEffect(() => {
    const k = localStorage.getItem(SORTKEY_KEY)
    if (k && SORTKEY_VALUES.includes(k as SortKey)) setSortKey(k as SortKey)
    const d = localStorage.getItem(SORTDIR_KEY)
    if (d === 'asc' || d === 'desc') setSortDir(d)
  }, [])
  const [search, setSearch] = useUrlState('q', '')
  const [colWidths, setColWidths] = useState<Record<string, number>>(DEFAULT_WIDTHS)
  const colWidthsRef              = useRef<Record<string, number>>(DEFAULT_WIDTHS)

  // ── 선택 모드 + 일괄 수납 (v2.0 §23 선택모드 · v2.0 §16 적용취소) ──────────────
  const router = useRouter()
  const [selectMode, setSelectMode]   = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [batchOpen, setBatchOpen]     = useState(false)
  const [batchMethod, setBatchMethod] = useState('계좌이체')
  const [batchDate, setBatchDate]     = useState('')      // 열 때 오늘(KST)로 채움
  const [batchBusy, setBatchBusy]     = useState(false)
  const exitSelectMode = () => { setSelectMode(false); setSelectedIds(new Set()) }
  // selectedIds 는 계약(leaseTermId) 키다. 한 방에 계약이 둘이면 각각 따로 선택된다.
  const toggleSelect = (id: string) =>
    setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const isSelected = (r: RoomStatus) => r.leaseTermId != null && selectedIds.has(r.leaseTermId)
  const press = useLongPress()      // 데스크톱 행 꾹 눌러 선택 진입 (v2.0 §23 공통 제스처, 카드는 RoomCard 내장)
  // 일괄 수납 대상 — 비공실 + 미래월 아님 + 이번 달 미수(balance<0)
  const isBatchEligible = (r: RoomStatus) =>
    !r.isVacant && !r.isFutureMonth && !!r.leaseTermId && r.balance < 0

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const handleVacantSort = (key: VacantSortKey) => {
    if (vacantSortKey === key) {
      setVacantSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setVacantSortKey(key)
      setVacantSortDir('asc')
    }
  }

  // 열 설정 드롭다운 외부 클릭 닫기는 DisplayFieldsMenu가 자체 처리(v2.0 §23 통일)

  useEffect(() => {
    const savedW = loadColWidths()
    if (savedW) {
      const merged = { ...DEFAULT_WIDTHS, ...savedW }
      setColWidths(merged)
      colWidthsRef.current = merged
    }
  }, [])

  useEffect(() => { colWidthsRef.current = colWidths }, [colWidths])

  // 필터·정렬을 localStorage에 유지 (화면 이탈·재마운트 후에도 작업 맥락 보존)
  useEffect(() => { try { localStorage.setItem(FILTER_KEY, filter) } catch {} }, [filter])
  useEffect(() => { try { localStorage.setItem(SORTKEY_KEY, sortKey) } catch {} }, [sortKey])
  useEffect(() => { try { localStorage.setItem(SORTDIR_KEY, sortDir) } catch {} }, [sortDir])

  const startResize = useCallback((col: string, startX: number) => {
    const startW = colWidthsRef.current[col] ?? 100
    const onMove = (clientX: number) => {
      const newW = Math.max(50, startW + clientX - startX)
      setColWidths(prev => ({ ...prev, [col]: newW }))
    }
    const onMouseMove = (ev: MouseEvent) => onMove(ev.clientX)
    const onTouchMove = (ev: TouchEvent) => onMove(ev.touches[0].clientX)
    const onEnd = () => {
      localStorage.setItem(COL_WIDTHS_KEY, JSON.stringify(colWidthsRef.current))
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onEnd)
      document.removeEventListener('touchmove', onTouchMove)
      document.removeEventListener('touchend', onEnd)
    }
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onEnd)
    document.addEventListener('touchmove', onTouchMove, { passive: true })
    document.addEventListener('touchend', onEnd)
  }, [])

  const getRoomFloor = (r: RoomStatus) => {
    if (r.floor) return r.floor
    const n = r.roomNo.replace(/[^0-9]/g, '')
    return n.length >= 3 ? n.slice(0, n.length - 2) : ''
  }
  const allFloors = [...new Set(roomStatus.map(r => getRoomFloor(r)).filter(Boolean))].sort((a, b) => Number(a) - Number(b))

  const occupied = roomStatus.filter(r => !r.isVacant)
  const vacants  = roomStatus.filter(r => r.isVacant).sort((a, b) =>
    a.roomNo.localeCompare(b.roomNo, 'ko', { numeric: true })
  )

  const isAwaitingRoom = (r: RoomStatus) => r.isPaid && !!r.nextDueDate && r.nextDueAmount > 0
  const isCheckoutRoom = (r: RoomStatus) => {
    const ck = r.expectedMoveOut?.slice(0, 7) ?? null
    if (!r.isPaid) return false
    // 단기는 상태가 아니라 사실(퇴실 예정일)로 센다 — 자동 전환 전에도 퇴실 예정으로 보여야 한다.
    return (r.status === 'CHECKOUT_PENDING' && !!ck && ck <= targetMonth) || isShortTermCheckoutDue(r, targetMonth)
  }
  // 이 달(targetMonth)에 납부일 임시 조정이 적용된 호실
  const isAdjustedRoom = (r: RoomStatus) =>
    !!r.overrideDueDay && r.overrideDueDayMonth === targetMonth

  // 패널 필터 게이팅 — 공실 보기(localStorage 복원으로 첫 마운트부터 가능)에선 납부일·월 이용료가
  // 무의미하므로 렌더·계수에서 제외. 렌더·적용·계수·리셋이 같은 판정을 공유(유령 필터 방지).
  const panelPayFiltersValid = filter !== 'vacant'
  // 유효 납부일(override 반영, getEffectiveDueDayNum과 동일 우선순위) 문자열 — 버킷 매칭용
  const effectiveDueDayStr = (r: RoomStatus): string | null =>
    (r.overrideDueDayMonth === targetMonth && r.overrideDueDay) ? r.overrideDueDay : r.dueDay
  const activeFilterCount =
    (floorFilter ? 1 : 0) +
    (panelPayFiltersValid && dueDayFilter ? 1 : 0) +
    (panelPayFiltersValid && (rentMinFilter != null || rentMaxFilter != null) ? 1 : 0)
  const resetFilters = () => {
    setFloorFilter(''); setDueDayFilter(''); setRentMinFilter(undefined); setRentMaxFilter(undefined)
  }

  const filtered = occupied.filter(r => {
    if (floorFilter && getRoomFloor(r) !== floorFilter) return false
    // 패널 필터 — 월 이용료는 expected(그 달 청구액·일할 반영) 기준, 표시·합계와 동일 기준
    if (dueDayFilter && dueDayBucketOf(effectiveDueDayStr(r), targetMonth) !== dueDayFilter) return false
    if (rentMinFilter != null && r.expected < rentMinFilter) return false
    if (rentMaxFilter != null && r.expected > rentMaxFilter) return false
    if (filter === 'unpaid')   return !r.isPaid
    if (filter === 'checkout') return isCheckoutRoom(r)
    if (filter === 'awaiting') return isAwaitingRoom(r) && !isCheckoutRoom(r)
    if (filter === 'paid')     return r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r)
    if (filter === 'adjusted') return isAdjustedRoom(r)
    return true
  })

  // 같은 호실의 행은 어떤 정렬에서도 붙어 있어야 한다(디자인 패널 2026-08-11).
  // 행이 계약 단위가 되면서 한 방에 행이 둘일 수 있는데, 기본 정렬이 '수납 상태'라 402호 거주(미납 그룹)와
  // 입실 예약(예약 그룹)이 목록 양 끝으로 흩어진다. 그러면 같은 호실 번호가 두 군데 떠서 중복 등록으로 읽힌다.
  // 그래서 정렬은 방 단위로 하고, 방 안 순서는 서버 정본(roomLeaseRowOrder)이 준 순서를 그대로 둔다.
  // 상태 그룹만은 그 방에서 가장 급한 행을 따른다 — 한 계약이 미납이면 그 방은 미납 블록에 있어야 한다.
  const roomFirstIndex = new Map<string, number>()
  const roomLeadRow    = new Map<string, RoomStatus>()
  const roomStatusGrp  = new Map<string, number>()
  const statusGrpOf = (r: RoomStatus) => {
    if (r.isVacant) return 5
    if (!r.isPaid) return 0
    if (isCheckoutRoom(r)) return 1
    if (r.status === 'RESERVED') return 2
    if (isAwaitingRoom(r)) return 3
    return 4
  }
  filtered.forEach((r, i) => {
    if (!roomLeadRow.has(r.roomId)) { roomLeadRow.set(r.roomId, r); roomFirstIndex.set(r.roomId, i) }
    const g = statusGrpOf(r)
    if (g < (roomStatusGrp.get(r.roomId) ?? Number.MAX_SAFE_INTEGER)) roomStatusGrp.set(r.roomId, g)
  })
  const rowSeq = new Map(filtered.map((r, i) => [r.leaseTermId ?? r.roomId, i]))

  const sorted = [...filtered].sort((a, b) => {
    // 같은 방이면 서버가 정한 방 안 순서를 그대로 — 화면이 다시 정하면 화면마다 순서가 갈린다.
    if (a.roomId === b.roomId) {
      return (rowSeq.get(a.leaseTermId ?? a.roomId) ?? 0) - (rowSeq.get(b.leaseTermId ?? b.roomId) ?? 0)
    }
    // 상태 열: 미납(0)→퇴실예정(1)→예약(2)→납부예정(3)→완납(4)→공실(5) 그룹 고정
    if (sortKey === 'status') {
      const grpA = roomStatusGrp.get(a.roomId) ?? 5, grpB = roomStatusGrp.get(b.roomId) ?? 5
      if (grpA !== grpB) return grpA - grpB
    }

    const va = getSortValue(roomLeadRow.get(a.roomId) ?? a, sortKey, targetMonth)
    const vb = getSortValue(roomLeadRow.get(b.roomId) ?? b, sortKey, targetMonth)
    let cmp = 0
    if (typeof va === 'number' && typeof vb === 'number') {
      cmp = va - vb
    } else {
      cmp = String(va).localeCompare(String(vb), 'ko')
    }
    // 대표 행 값이 같은 두 방은 조회 순서(호실 오름차순)로 갈라 정렬이 흔들리지 않게 한다.
    if (cmp === 0) cmp = (roomFirstIndex.get(a.roomId) ?? 0) - (roomFirstIndex.get(b.roomId) ?? 0)
    return sortDir === 'asc' ? cmp : -cmp
  })

  const q = search.trim().toLowerCase()
  const displayed = q
    ? sorted.filter(r =>
        r.roomNo.toLowerCase().includes(q) ||
        (r.tenantName ?? '').toLowerCase().includes(q)
      )
    : sorted

  // Phase 2.4c (2026-05-30): 자체 수납 모달 제거. 카드 클릭/URL 진입 → 전역 Prism 셸 사용.
  // 셸의 PaymentBody (summary/full) 가 모든 수납 기능 in-place 처리.
  const openPayModal = (room: RoomStatus) => {
    if (!room.leaseTermId) return
    entityModal.open({
      kind: 'payment',
      leaseTermId: room.leaseTermId,
      roomId: room.roomId,
      tenantId: room.tenantId ?? undefined,
    })
  }

  // 미납 방 독촉 문구 복사 — 표준 안내를 클립보드로. 자동 발송·결제 연계 아님, UI 편의만.
  const copyReminder = async (room: RoomStatus, unpaid: number) => {
    try {
      await navigator.clipboard.writeText(buildReminderText(room, targetMonth, unpaid))
      pushToast('success', '독촉 문구를 복사했습니다')
    } catch {
      pushToast('error', '독촉 문구 복사에 실패했습니다')
    }
  }

  // 일괄 수납 — 선택된 호실 중 '대상'만, 이번 달 미수 합계
  const batchTargets = displayed.filter(r => isSelected(r) && isBatchEligible(r))
  const batchTotal   = batchTargets.reduce((s, r) => s + Math.max(0, Math.round(-r.balance)), 0)

  const openBatchPay = () => {
    setBatchDate(kstYmdStr())
    try { const m = localStorage.getItem('stayeum-last-pay-method'); if (m) setBatchMethod(m) } catch {}
    setBatchOpen(true)
  }

  const runBatchPay = async () => {
    if (batchBusy) return
    const ids = batchTargets.map(r => r.leaseTermId!)
    if (!ids.length) { setBatchOpen(false); return }
    setBatchBusy(true)
    try {
      const res = await batchRecordRentPayment({
        targetMonth, leaseTermIds: ids, payDate: batchDate || kstYmdStr(), payMethod: batchMethod,
      })
      if (!res.ok) { pushToast('error', res.error); return }
      try { localStorage.setItem('stayeum-last-pay-method', batchMethod) } catch {}
      setBatchOpen(false)
      exitSelectMode()
      const created = res.createdIds
      pushToast('success', `${res.paidRoomNos.length}개 호실 일괄 수납 완료`, {
        detail: res.skippedRoomNos.length
          ? `${res.skippedRoomNos.length}개 호실은 대상 아님(완납·미래월 등)으로 제외`
          : undefined,
        action: created.length ? {
          label: '적용취소',
          run: async () => {
            const u = await batchDeletePayments(created)
            if (u.ok) pushToast('info', '일괄 수납을 취소했습니다')
            router.refresh()
          },
        } : undefined,
      })
      router.refresh()
    } finally {
      setBatchBusy(false)
    }
  }

  // ?roomNo=xxx 딥링크 — 대시보드 등에서 넘어올 때 해당 호실 셸 자동 오픈
  useEffect(() => {
    const roomNo = searchParams.get('roomNo')
    if (!roomNo) return
    const room = roomStatus.find(r => r.roomNo === roomNo)
    if (room && !room.isFutureMonth && room.leaseTermId) {
      entityModal.open({
        kind: 'payment',
        leaseTermId: room.leaseTermId,
        roomId: room.roomId,
        tenantId: room.tenantId ?? undefined,
      })
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 요약 통계
  const unpaidCount   = occupied.filter(r => !r.isPaid).length
  const checkoutCount = occupied.filter(r => isCheckoutRoom(r)).length
  const awaitingCount = occupied.filter(r => isAwaitingRoom(r) && !isCheckoutRoom(r)).length
  const paidCount     = occupied.filter(r => r.isPaid && !isAwaitingRoom(r) && !isCheckoutRoom(r)).length
  const adjustedCount = occupied.filter(r => isAdjustedRoom(r)).length

  const thCls = 'text-left text-xs text-[var(--warm-muted)] font-medium px-4 py-3'

  function ResizableTh({ label, colKey, onClick, isActive, stickyLeft }: {
    label: string; colKey: string; onClick?: () => void; isActive?: boolean; stickyLeft?: number
  }) {
    const w = colWidths[colKey] ?? 100
    return (
      <th
        onClick={onClick}
        className={`relative text-left text-xs font-medium px-4 py-3 select-none overflow-hidden whitespace-nowrap ${
          onClick ? 'cursor-pointer transition-colors' : ''
        } ${isActive ? 'text-[var(--coral)]' : 'text-[var(--warm-muted)] hover:text-[var(--warm-dark)]'} ${
          stickyLeft !== undefined ? 'sticky z-40 bg-[var(--cream)]' : ''
        }`}
        style={{
          width: w, minWidth: w, maxWidth: w,
          ...(stickyLeft !== undefined ? { left: stickyLeft } : {}),
        }}
      >
        <span className="truncate block">{label}{isActive ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}</span>
        <div
          onMouseDown={e => { e.preventDefault(); e.stopPropagation(); startResize(colKey, e.clientX) }}
          onTouchStart={e => { e.stopPropagation(); startResize(colKey, e.touches[0].clientX) }}
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-0 bottom-0 w-[12px] cursor-col-resize group touch-none"
          style={{ userSelect: 'none' }}
        >
          <div className="absolute right-[5px] top-[20%] bottom-[20%] w-[1px] bg-[var(--warm-border)] group-hover:bg-[var(--coral)] transition-colors" />
        </div>
      </th>
    )
  }

  const SortTh = ({ label, sk }: { label: string; sk: SortKey }) => (
    <ResizableTh
      label={label}
      colKey={sk}
      onClick={() => handleSort(sk)}
      isActive={sortKey === sk}
    />
  )

  const VSortTh = ({ label, sk }: { label: string; sk: VacantSortKey }) => (
    <th onClick={() => handleVacantSort(sk)}
      className={`${thCls} cursor-pointer select-none hover:text-[var(--warm-dark)] whitespace-nowrap`}>
      {label}
      <span className="ml-1 inline-block w-3 text-center">
        {vacantSortKey === sk ? (vacantSortDir === 'asc' ? '↑' : '↓') : ''}
      </span>
    </th>
  )

  const sortedVacants = [...vacants].sort((a, b) => {
    const getVal = (r: typeof a): string | number => {
      switch (vacantSortKey) {
        case 'roomNo':         return r.roomNo
        case 'type':           return r.type ?? ''
        case 'windowType':     return r.windowType ?? ''
        case 'baseRent':       return r.baseRent
        case 'prevTenantName': return r.prevTenantName ?? ''
        default:               return ''
      }
    }
    const va = getVal(a), vb = getVal(b)
    const cmp = typeof va === 'number' && typeof vb === 'number'
      ? va - vb
      : String(va).localeCompare(String(vb), 'ko', { numeric: true })
    return vacantSortDir === 'asc' ? cmp : -cmp
  })

  // ── 상단 수납 진행 스트립 (표시 전용 — 서버가 계산한 행 값을 그대로 합산, §4 재계산 없음) ──
  // 예상 = 이 화면 행들의 그 달 청구액 합(Σ expected) → 공실 제외·무청구 퇴실월 0원·퇴실 일할이 자동 반영.
  //   단 RESERVED 행 제외 — 예약 확정자의 그 달 전액은 예상 수입에만 가산(아래 InfoHint 정본).
  //   예약 행 expected는 표시용 청구 예정액이고 잔액 0이라, 합산하면 청구·수납이 함께 부풀려진다(신고 78ea0c3d).
  // 수납 = 예상 − 이번 달 미수(행별 balance<0, 이월 미수와 구분되도록 expected로 캡).
  // 만실 기준 = 예상 + 공실·예약 방 + 청구 0원 점유 방의 기준 임대료(baseRent) — 아래 zeroBilledFill 주석 참조.
  const billableRows = occupied.filter(r => r.status !== 'RESERVED')
  const reservedRows = occupied.filter(r => r.status === 'RESERVED')
  const expectedSum  = billableRows.reduce((s, r) => s + r.expected, 0)
  const collectedSum = billableRows.reduce((s, r) => s + (r.expected - Math.min(r.expected, Math.max(0, -r.balance))), 0)
  // 만실 기준 — 청구가 0원인 점유 방도 기준가로 채운다(운영자 질문 2026-08-01, 지표 패널 절충안).
  // 종전에는 단기 비청구월·무청구 퇴실월의 방이 0원으로 들어가, 사람이 사는 방이 만실 계산에서
  // 통째로 빠졌다(8월 503·520호 = 39실 중 37실짜리 만실, 749,000원 낙차). 공실이면 기준가로
  // 채워지는데 단기가 들어차 있으면 오히려 0이 되는 역전이라 영업 판단이 거꾸로 잡힌다.
  // NON_RESIDENT(창고·사무실)는 임대 수용력이 아니라 제외한다(lib/vacancy 집계 제외 정본, 신고 9d844226).
  // expectedSum 에는 절대 넣지 않는다 — 넣으면 청구액과 수납률이 함께 부풀려진다(신고 78ea0c3d 클래스).
  //
  // 채움은 **방 단위로 한 번씩**이다(2026-08-11). 행이 계약 단위가 되면서 한 방에 행이 둘일 수 있는데
  // (402호 거주 + 입실 예약), 행마다 기준가를 채우면 같은 방이 두 번 잡힌다 — 8월 만실 기준이
  // 19,155,000 에서 20,394,000 으로 부풀었다. 만실 기준은 '방이 몇 개인가'를 묻는 수용력 참고치라
  // 계약 수로 늘어나면 안 된다. 이미 청구가 잡힌 방은 그 청구액이 곧 그 방의 몫이라 채우지 않는다.
  const billedRoomIds = new Set(billableRows.filter(r => r.expected > 0).map(r => r.roomId))
  const fillByRoom = new Map<string, number>()
  for (const r of vacants) fillByRoom.set(r.roomId, r.baseRent || 0)
  for (const r of reservedRows) if (!billedRoomIds.has(r.roomId)) fillByRoom.set(r.roomId, r.baseRent || 0)
  for (const r of billableRows) {
    if (r.expected === 0 && r.status !== 'NON_RESIDENT' && !billedRoomIds.has(r.roomId)) fillByRoom.set(r.roomId, r.baseRent || 0)
  }
  const maxSum       = expectedSum + [...fillByRoom.values()].reduce((s, v) => s + v, 0)
  const collectPct   = expectedSum > 0 ? Math.round((collectedSum / expectedSum) * 100) : 0
  const incomeSum    = incomes.reduce((s, i) => s + i.amount, 0)

  // 대시보드 '보유 보증금'과 동일 기준(거주중: ACTIVE·CHECKOUT_PENDING)으로 합계 —
  // RESERVED(입실 전) 잔고까지 합산해 두 화면의 보유 보증금이 다르게 보이던 문제.
  // 목록에는 전 상태 노출 유지(원장 성격), 합계만 기준 통일.
  const totalDepositBalance = depositSummary
    .filter(d => d.status === 'ACTIVE' || d.status === 'CHECKOUT_PENDING')
    .reduce((s, d) => s + d.balance, 0)

  // ── 홈 예상 수입과의 다리 (운영자 혼동 2회, 2026-08-07) ──
  // 두 화면 숫자가 달라 보이는 이유를 등식으로 적는다. 항의 값은 서버 정본(홈과 같은 헬퍼)이고
  // 여기서는 더하기만 한다 — 화면이 자기 식을 만들면 그 순간 또 갈린다.
  //
  // 실수납 등식에 '퇴실 귀속'이 빠져 있었다(2026-08-11). 홈 실수납은 퇴실 계약의 그 달 귀속 수납을
  // 포함하는데 여기는 안 더해서, 6월 3,800,000 · 7월 1,940,000 이 통째로 어긋났다. 예상 축이 이미
  // 같은 이름으로 더하고 있던 항이라 한쪽만 빠진 누락이었다. 두 줄이 같은 항을 같은 값으로 적는다.
  const homeExpectedSum  = expectedSum + reservedExpected + checkedOutRecognized + incomeSum
  const homeCollectedSum = collectedSum + checkedOutRecognized + incomeSum
  // 세 항이 전부 0이면 두 숫자가 같으므로 등식을 적을 이유가 없다.
  // 미래월엔 아예 안 적는다 — 홈도 미래월을 열 수 없어 대조할 상대가 없고, 좌변이 아래에서
  // 거짓으로 판정한 그 수납액을 그대로 나른다(디자인 패널 2026-08-11).
  const showHomeBridge   = !isFutureMonth && (reservedExpected !== 0 || checkedOutRecognized !== 0 || incomeSum !== 0)

  return (
    <div className="space-y-4">
      {/* 헤더 — 좌측 제목+탭(수납/부가수익), 우측 월 셀렉터(기간) */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {/* min-w-0 — 이 래퍼가 안 줄어들면 탭 트랙의 max-w-full 이 화면이 아니라 자기 내용폭에 걸려
            좌우 여백(16px) 밖으로 밀려난다. 줄여 두면 §25 규정대로 트랙 안에서 가로 스크롤한다. */}
        <div className="flex items-center gap-3 flex-wrap min-w-0">
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">수납 관리</h1>
          {/* equal 은 안 쓴다 — 탭이 셋이 되면서 가장 긴 라벨 폭 × 3 이 320~390px 대역을 넘어,
              폭이 눌린 세그먼트 밖으로 글자가 15px 삐져나왔다(실측). 형제 지출 관리(3탭)와 같이
              자연폭 + 넘치면 가로 스크롤(§25). */}
          <ViewTabs ariaLabel="수납 관리 뷰" activeId={viewTab}
            onChange={id => setViewTab(id as ViewTabId)}
            tabs={[
              { id: 'rooms',   label: '수납' },
              { id: 'income',  label: '부가수익', suffix: incomeSum > 0 ? `+${fmtKorMoney(incomeSum)}` : undefined },
              { id: 'deposit', label: '보증금',  suffix: fmtKorMoney(totalDepositBalance) },
              // 접미를 안 단다 — 미발행 건수는 '해야 할 일'이 아니고(전부 발행 대상이 아니다),
              // 탭 줄이 이미 320~390 전 대역에서 가로 스크롤 중이라 폭을 더 늘릴 이유가 없다.
              { id: 'receipt', label: '현금영수증' },
            ]} />
        </div>
        <MonthSelector />
      </div>

      {/* 부가수익 탭 — 과납분·보증금 미반환분 등 수납 파생 수익 + 일반 기타수입 */}
      {viewTab === 'income' && (
        <IncomeSection incomes={incomes} incomeCategories={incomeCategories} leaseOptions={leaseOptions} />
      )}

      {/* 보증금 탭 — 원장 성격이라 월 셀렉터와 무관하다(종전 지출 관리 탭과 같은 중립). */}
      {viewTab === 'deposit' && (
        <DepositSection summary={depositSummary} ledger={depositLedger} totalBalance={totalDepositBalance} />
      )}

      {viewTab === 'receipt' && (
        <CashReceiptTab
          candidates={receiptRows.candidates}
          issued={receiptRows.issued}
          targetMonth={targetMonth}
          issuedSum={payAggregates.cashReceiptSum}
          issuedCount={payAggregates.cashReceiptCount}
          onChanged={() => router.refresh()}
        />
      )}

      {viewTab === 'rooms' && <>
      {/* 수납 진행 스트립 — 걷은 돈/걷을 돈(%) + 만실 참고치. 예상=아래 목록 청구액 합(일할·무청구 반영) */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-4 py-3 space-y-1.5">
        <div className="flex items-baseline justify-between gap-2 flex-wrap">
          {/* 미래월은 수납액·달성률을 말하지 않는다(디자인 패널 2026-08-11).
              서버가 미래월 행의 그 달 청구를 0으로 잠그기 때문에, 수납액이 청구액과 같아져
              받지도 않은 돈이 늘 100% 완납으로 떴다(9월 15,530,000). 0%로 뒤집는 안도 기각했다 —
              같은 진행바 문법이 현재월에서 '다 밀렸다'를 뜻해서 거짓의 방향만 바뀐다.
              아직 도래하지 않은 질문에는 숫자로 답하지 않고, 청구 예정액 한 값만 세운다.
              완납색(success)도 쓰지 않는다 — 가이드 v2.0 §03·§04 에서 아직 안 받은 돈은 예정(info)이다. */}
          {isFutureMonth ? (
            <p className="text-sm text-[var(--warm-dark)]">
              <span className="text-xs text-[var(--warm-muted)]">이 달 청구 예정액 </span>
              <span className="font-semibold num">{fmtWon(expectedSum)}</span>
              <InfoHint title="이 달 청구 예정액">
                아직 오지 않은 달이라 이 화면 목록에 있는 계약들의 이번 달 이용료 청구 예정 합계만 보여줍니다.
                납부일이 도래하지 않아 수납액과 달성률은 표시하지 않습니다. 미리 받은 금액이 있으면 아래에 따로 적힙니다.
              </InfoHint>
            </p>
          ) : (
          <p className="text-sm text-[var(--warm-dark)]">
            <span className="text-xs text-[var(--warm-muted)]">수납 </span>
            <span className="font-bold text-[var(--success-fg)] num">{fmtWon(collectedSum)}</span>
            <span className="text-[var(--warm-muted)]"> / 이 달 청구액 </span>
            <span className="font-semibold num">{fmtWon(expectedSum)}</span>
            <span className="text-xs text-[var(--warm-muted)]"> ({collectPct}%)</span>
            <InfoHint title="이 달 청구액">
              이 화면 목록에 있는 계약들의 이번 달 이용료 청구 합계입니다. 일할과 무청구 퇴실월(납부일 이전 퇴실)이 반영됩니다.
              예상 수입은 여기에 예약 확정, 퇴실 귀속, 부가수익을 더한 사업 전체 전망이고 홈 화면 카드에도 같은 등식이 적힙니다.
              그런 항목이 없는 달엔 두 숫자가 같고, 있는 달엔 아래 등식 줄에 그 차이가 항목별로 적힙니다.
            </InfoHint>
          </p>
          )}
          {maxSum > expectedSum && (
            <span className="text-[0.6875rem] text-[var(--warm-muted)] num">만실 기준 {fmtWon(maxSum)}
              {/* '만실 시'에서 개명 — 예측이 아니라 정가 환산 기준선이라 '시'가 과한 약속이었다(2026-08-01).
                  종전 안내는 차액을 '공실 손실'이라 단정했는데, 예약 방 기준가가 이미 섞여 있어 그때도 거짓이었다. */}
              <InfoHint title="만실 기준">
                <span className="block">모든 방이 기준 임대료로 정상 청구된다고 가정한 참고치입니다. 할인·일할 계약은 실제 계약가로 계산하고, 공실과 예약 방, 이번 달 청구가 없는 방(단기 선납분·무청구 퇴실월)은 기준 임대료로 채웁니다. 그래서 계약 구성이 바뀌면 달마다 값이 달라집니다.</span>
                <span className="block mt-1.5">이 값에서 청구액을 뺀 차액에는 예약 방처럼 지금 팔 수 없는 방도 섞여 있습니다. 순수한 공실 손실은 아래 공실 머리글의 기준 임대료 합을 보세요.</span>
              </InfoHint>
            </span>
          )}
        </div>
        {/* 진행바는 분모가 '도래한 청구'일 때만 성립한다 — 미래월엔 게이지 자체를 두지 않는다. */}
        {!isFutureMonth && (
          <div className="h-1.5 rounded-full bg-[var(--canvas)] border border-[var(--warm-border)]/60 overflow-hidden">
            <div className="h-full rounded-full transition-[width]" style={{ width: `${Math.min(100, collectPct)}%`, background: 'var(--success-fg)' }} />
          </div>
        )}
        {/* 미리 받은 돈은 사실이므로 미래월에도 보여야 한다(knowledge/money-display-feedback §1).
            값은 홈 실수납과 같은 서버 정본(getPaidRevenue)이다 — 화면이 행 잔액으로 되계산하지 않는다. */}
        {isFutureMonth && prepaidReceived > 0 && (
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">
            미리 받은 이 달 이용료 <span className="font-semibold text-[var(--info-fg)] num">{fmtWon(prepaidReceived)}</span>
          </p>
        )}
        {/* 홈 카드와의 다리 — 두 화면 숫자가 다른 이유를 등식으로 적는다(운영자 혼동 2회, 2026-08-07).
            차이를 만드는 항이 전부 0인 달엔 줄 자체가 안 나온다.
            문장은 홈 KPI 카드와 같은 정본(MoneyEquation)이 만든다 — 값이 원 단위로 같아도
            항 구성이나 이름이 화면마다 갈리면 같은 숫자를 놓고 다른 설명을 읽게 된다(2026-08-12). */}
        {showHomeBridge && (
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">
            예상 수입 <span className="font-semibold text-[var(--warm-dark)] num">{fmtWon(homeExpectedSum)}</span>{' '}
            <MoneyEquation terms={expectedRevenueTerms({
              billed: expectedSum, reserved: reservedExpected, checkedOut: checkedOutRecognized, extra: incomeSum,
            })} />
          </p>
        )}
        {/* 실수납 줄은 퇴실 귀속이나 부가수익이 있을 때만 — 둘 다 없으면 홈 실수납과 위 수납액이 같은 값이다.
            예약 확정은 아직 받은 돈이 아니라 이 축에 들어오지 않는다(예상 축에만 있다). */}
        {showHomeBridge && (checkedOutRecognized !== 0 || incomeSum !== 0) && (
          <p className="text-[0.6875rem] text-[var(--warm-muted)]">
            실수납 <span className="font-semibold text-[var(--warm-dark)] num">{fmtWon(homeCollectedSum)}</span>{' '}
            <MoneyEquation terms={paidRevenueTerms({
              collected: collectedSum, checkedOut: checkedOutRecognized, extra: incomeSum,
            })} />
          </p>
        )}
        {/* 현금영수증·카드 합계 — 세무 대사용(오류신고 c0936f89·8b9b6c43).
            **축이 둘이라 줄도 둘이다**(2026-08-24 재판정). 현금영수증은 발행일, 카드는 입금일이다.
            한 줄에 한정어 하나('입금일 기준')를 앞세우던 종전 문법은 축이 갈린 뒤로는 거짓이 된다.
            한정어를 각 숫자의 **바로 앞**에 두는 이유는 뒤에 붙이면 좁은 폭에서 숫자와 갈라져
            다른 줄로 떨어지기 때문이다 — 그러면 어느 축이 어느 숫자의 것인지 화면이 다시 안 말한다.
            줄을 갈라 세우는 것은 위 형제 줄(예상 수입·실수납)과 같은 문법이다 — 한 줄에 한 사실.
            한정어는 **상시 텍스트**여야 한다. InfoHint(접힌 물음표) 안으로 되숨으면 목록을 손으로
            더한 값과 왜 다른지 화면이 말하지 않는 신고가 재발한다(감지망 규칙 20 이 지킨다).
            '납부일'은 쓰지 않는다. 이 화면에서 그 말은 LeaseTerm.dueDay(약정 지급일)의 이름이고
            (:103 colVis · :1018 필터 · :1121 정렬 · :1332 헤더 · 미납 배지) 그것이 곧 반대 축인
            귀속월의 앵커라, 붙이면 신고가 겪은 오해를 문자로 굳힌다. '입금일'은 PaymentSummaryCards
            와 발생주의 데이터 진단이 같은 payDate 축에 이미 쓰는 말이다. */}
        {(payAggregates.cashReceiptSum !== 0 || payAggregates.cardSum !== 0) && (
          <>
            <p className="text-[0.6875rem] text-[var(--warm-muted)]">
              발행일 기준 현금영수증 <span className="font-semibold text-[var(--warm-dark)] num">{fmtWon(payAggregates.cashReceiptSum)}</span>
              <span className="num"> ({payAggregates.cashReceiptCount}건)</span>
              <InfoHint title="현금영수증·카드 합계">
                <span className="block">현금영수증은 발행한 날이 속한 달에 잡힙니다. 홈택스 자료와 맞추기 위한 축입니다. 받은 날과 다른 날 발행해도 되고, 그때는 발행한 달 합계에 들어갑니다.</span>
                <span className="block mt-1.5">카드는 받은 날(입금일)이 속한 달에 잡힙니다. 매출전표가 결제 시점에 성립하기 때문입니다. 신용카드와 결제선생이 함께 잡히고, 카드는 매출전표가 증빙을 대신하므로 현금영수증 합계에 넣지 않아 두 값은 겹치지 않습니다.</span>
              <span className="block mt-1.5">보증금도 두 합계에 들어갑니다. 돌려줄 돈이지만 카드로 받으면 카드사에, 현금영수증을 끊었으면 국세청에 그대로 남기 때문입니다. 청구를 조정한 전표는 받은 돈이 아니라 빠집니다.</span>
                <span className="block mt-1.5">아래 목록과 위의 청구액은 귀속월 기준이라 이 두 합계와 다를 수 있습니다. 지난달 말에 받아 이번 달 이용료로 잡힌 돈이 그런 경우입니다. 한 건씩 대조하려면 환경설정 &gt; 데이터 점검 &gt; 발생주의 데이터 진단을 보세요.</span>
                <span className="block mt-1.5">한 번의 결제가 여러 달로 나뉘어 인식돼도 합계에는 결제 전액이 잡힙니다. 발행 표시를 켜고 끌 때도 그 결제의 모든 달이 함께 바뀝니다.</span>
              </InfoHint>
            </p>
            <p className="text-[0.6875rem] text-[var(--warm-muted)]">
              입금일 기준 카드 수납 <span className="font-semibold text-[var(--warm-dark)] num">{fmtWon(payAggregates.cardSum)}</span>
              <span className="num"> ({payAggregates.cardCount}건)</span>
            </p>
          </>
        )}
      </div>

      {/* 검색바 + 필터 토글 — v2.0 §23 정본(호실관리) 패턴. 스크롤 시 상단 고정 */}
      <div className="flex gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={search} onChange={setSearch} placeholder="호실 번호 또는 입주자 이름 검색" className="flex-1" />
        <button type="button" onClick={() => setShowFilters(v => !v)}
          className={`shrink-0 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors flex items-center gap-1.5 ${
            showFilters || activeFilterCount > 0
              ? 'bg-[var(--coral)] text-[var(--on-solid)]'
              : 'bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)]'
          }`}>
          필터{activeFilterCount > 0 ? ` ${activeFilterCount}` : ''}
        </button>
      </div>

      {/* 접이식 필터 패널 — §23 정본 문법. 납부일·월 이용료는 공실 보기에서 숨김 */}
      {showFilters && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            {allFloors.length > 1 && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">층</label>
                <select value={floorFilter} onChange={e => setFloorFilter(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체 층</option>
                  {allFloors.map(f => <option key={f} value={f}>{f}층</option>)}
                </select>
              </div>
            )}
            {panelPayFiltersValid && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-[var(--warm-mid)]">납부일</label>
                <select value={dueDayFilter} onChange={e => setDueDayFilter(e.target.value as '' | DueDayBucket)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                  <option value="">전체</option>
                  {DUE_DAY_BUCKET_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            )}
          </div>
          {panelPayFiltersValid && (
            <div className="space-y-1">
              <label className="text-xs font-medium text-[var(--warm-mid)]">월 이용료 범위 (원)</label>
              <div className="flex items-center gap-2">
                <MoneyInput value={rentMinFilter} onChange={v => setRentMinFilter(v && v > 0 ? v : undefined)} placeholder="최소" />
                <span className="text-[var(--warm-muted)] text-sm">~</span>
                <MoneyInput value={rentMaxFilter} onChange={v => setRentMaxFilter(v && v > 0 ? v : undefined)} placeholder="최대" />
              </div>
            </div>
          )}
          <div className="flex gap-2 pt-1">
            <Btn type="button" variant="secondary" size="sm" className="flex-1" onClick={resetFilters}>초기화</Btn>
            <Btn type="button" variant="primary" size="sm" className="flex-1" onClick={() => setShowFilters(false)}>닫기</Btn>
          </div>
        </div>
      )}

      {/* 빠른 필터 + 열 설정 */}
      <div className="flex gap-2 flex-wrap items-center">
        <SegmentedControl
          size="sm"
          scroll
          ariaLabel="수납 상태 필터"
          value={filter}
          onChange={setFilter}
          // 단위가 '실'에서 '명'으로 바뀐다(디자인 패널 2026-08-11). 칩은 필터라 숫자가 곧 그 목록의 행 수여야
          // 하는데, 행은 방이 아니라 계약 단위다. 418호(거주 + 비거주)만으로도 이미 방 수보다 컸고 402·404·503
          // 다중 계약이 들어오면 더 벌어진다. 공실만 방에만 있는 사실이라 '실'을 유지한다.
          options={[
            { value: 'all',      label: `전체 ${occupied.length}명` },
            { value: 'unpaid',   label: `미납 ${unpaidCount}명` },
            { value: 'checkout', label: `퇴실 예정 ${checkoutCount}명` },
            { value: 'awaiting', label: `납부 예정 ${awaitingCount}명` },
            { value: 'paid',     label: `완납 ${paidCount}명` },
            { value: 'adjusted', label: `임시 조정 ${adjustedCount}명` },
            { value: 'vacant',   label: `공실 ${vacants.length}실` },
          ]}
        />
        {/* 유예 뱃지는 '납부 유예'로 통일했지만 칩은 갈린다 — 지난달분 유예는 미납에, 이번달분 유예는
            납부 예정에 남는다. 집계 규칙을 바꾸면 유예해준 돈이 미수에서 사라지므로 문구로 관리한다. */}
        <InfoHint title="수납 상태 필터">
          <span className="block">뱃지가 &lsquo;납부 유예&rsquo;로 바뀐 건도 받을 돈이라 집계에 그대로 남습니다. 지난달분을 미룬 경우는 미납에, 이번 달분을 미룬 경우는 납부 예정에 들어갑니다.</span>
          <span className="block mt-1.5">이번 달 납부일을 조정한 건은 &lsquo;임시 조정&rsquo;에서 모아 볼 수 있습니다.</span>
          <span className="block mt-1.5">단기 계약은 퇴실 예정 상태로 바뀌기 전에도 포함됩니다.</span>
          <span className="block mt-1.5">숫자는 방이 아니라 계약 수입니다. 한 방에 계약이 둘이면 행도 둘이고, 같은 호실은 항상 붙여서 보입니다.</span>
        </InfoHint>

        {/* 공실 표시 · 열 설정 — flex-wrap 새 줄로 떨어져도 항상 우측 정렬되도록 ml-auto 그룹.
            (모바일에서 새 줄에 떨어졌을 때 부모가 좌측 끝에 정렬되어 드롭다운이 화면 왼쪽으로
            잘리던 문제 해결, 사용자 피드백 2026-06-01) */}
        <div className="ml-auto flex gap-2 items-center">

        {/* 선택 모드 토글 — 일괄 수납 (v2.0 §23 선택모드). 뷰어(STAFF)에겐 숨김(감사 D3, 서버 requireEdit 최종 방어) */}
        {(myRole === 'OWNER' || myRole === 'MANAGER') && (
        <Btn variant="secondary" size="md" onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
          {selectMode ? '선택 취소' : '선택'}
        </Btn>
        )}

        {/* 표시 항목 — 점유·공실 카드 항목을 버튼 하나로(운영자 지적 2026-07-06, '공실 카드 항목' 별도 버튼 제거) */}
        <DisplayFieldsMenu
          fields={COL_DEFS}
          visible={colVis as Record<string, boolean>}
          onToggle={k => setColVis(v => ({ ...v, [k as ColKey]: !v[k as ColKey] }))}
          sections={[
            {
              heading: '이 화면에 보일 정보 선택',
              fields: COL_DEFS,
              visible: colVis as Record<string, boolean>,
              onToggle: k => setColVis(v => ({ ...v, [k as ColKey]: !v[k as ColKey] })),
            },
            {
              heading: '공실 카드 항목',
              fields: VACANT_COL_DEFS,
              visible: vacantColVis as Record<string, boolean>,
              onToggle: k => setVacantColVis(v => ({ ...v, [k as VacantColKey]: !v[k as VacantColKey] })),
            },
          ]}
        />
        </div> {/* /ml-auto group */}
      </div>

      {filter !== 'vacant' && (<>
      {/* 모바일 정렬 */}
      <div className="sm:hidden">
        <SortSelect<SortKey>
          ariaLabel="호실 정렬 기준"
          value={sortKey}
          dir={sortDir}
          onChange={sk => { setSortKey(sk); setSortDir('desc') }}
          onToggleDir={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
          options={[
            { value: 'status',        label: '수납상태' },
            { value: 'roomNo',        label: '호실순' },
            { value: 'dueDay',        label: '납부일' },
            { value: 'balance',       label: '잔액' },
            { value: 'expected',      label: '이용료' },
            { value: 'totalPaid',     label: '총납부액' },
            { value: 'tenantName',    label: '입주자' },
            { value: 'depositAmount', label: '보증금' },
            { value: 'contact',       label: '연락처' },
            { value: 'type',          label: '타입' },
            { value: 'windowType',    label: '창문' },
          ]}
        />
      </div>

      {/* 수납 현황 — 모바일 카드 뷰 */}
      <div className="sm:hidden space-y-2">
        {displayed.map(room => {
          const dueInfo = !room.isPaid ? getEffectiveDueInfo(room, targetMonth) : null
          const tone = roomStatusTone(room, targetMonth)
          const totalUnpaid = getTotalUnpaid(room)
          return (
            // 한 방에 실계약과 비거주 계약이 공존하면 roomId 키가 중복돼 React 가 stale DOM 을 남기고 정렬이 고착된다(신고 7007d2c1, 418호 실증).
            <RoomCard key={room.leaseTermId ?? room.roomId}
              kind="neutral"
              tipColor={statusTipColor(tone)}
              tipBg={statusRowTint(tone)}
              selected={selectMode && isSelected(room)}
              onClick={
                selectMode
                  ? (isBatchEligible(room) ? () => toggleSelect(room.leaseTermId!) : undefined)
                  : (room.isFutureMonth ? undefined : () => openPayModal(room))
              }
              onLongPress={(!selectMode && !room.isFutureMonth) ? () => {
                setSelectMode(true)
                if (isBatchEligible(room)) toggleSelect(room.leaseTermId!)
              } : undefined}
              className={`px-4 py-3.5 ${(room.isFutureMonth || (selectMode && !isBatchEligible(room))) ? 'opacity-50' : ''}`}>
              {/* 첫 줄: 호실 + 수납상태. 표시 항목 메뉴(colVis)로 타입 ON/OFF. */}
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  {selectMode && isBatchEligible(room) && (
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-[5px] border transition-colors
                      ${isSelected(room) ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)] bg-[var(--cream)]'}`}>
                      {isSelected(room) && (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
                      )}
                    </span>
                  )}
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <span className="text-base font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(room.roomNo)}</span>
                    {colVis.type && room.type && <span className="text-xs text-[var(--warm-muted)]">{room.type}</span>}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  {room.status === 'NON_RESIDENT' && <StatusBadge tone="info">비거주</StatusBadge>}
                  {room.status === 'RESERVED' ? (() => {
                    let sub: string | undefined
                    if (room.moveInDate) {
                      const days = kstDaysUntil(room.moveInDate)
                      sub = days > 0 ? `D-${days} 입주 예정` : days === 0 ? '오늘 입주' : `입주 예정일 ${Math.abs(days)}일 경과`
                    }
                    return <StatusBadge tone="movein" sub={sub}>{room.isReservationConfirmed ? '예약 확정' : '입실 예약'}</StatusBadge>
                  })() : (() => {
                    const isAwaiting = room.isPaid && room.nextDueDate && room.nextDueAmount > 0
                    // 퇴실 예정 배지는 expectedMoveOut이 viewMonth 안(또는 그 이전)일 때만 표시
                    const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
                    const showCheckout = room.status === 'CHECKOUT_PENDING'
                      && room.isPaid && !!checkoutMonth && checkoutMonth <= targetMonth
                    // 미납 / 연체 — 7일 초과면 연체(Terracotta 솔리드), 그 외 미납(Amber)
                    if (!room.isPaid) {
                      // 라벨이 '납부일'이면 보조줄의 '오늘'은 중복이라 생략
                      const deferred = isDeferredNow(room, targetMonth)
                      // 퇴실 예정자가 미납이면 '퇴실 예정' 뱃지를 나란히 + 퇴실 D-day를 보조줄에 함께
                      const exitSub = room.status === 'CHECKOUT_PENDING' ? checkoutSubText(room.expectedMoveOut) : null
                      const sub = unpaidSubText(room, targetMonth, dueInfo, deferred, exitSub)
                      const isOverdue = !!(dueInfo && dueInfo.overdue && dueInfo.days > 7)
                      // §03 UNPAID(Amber)는 '기한 경과 1~6일' 정의라, 아직 기한 전인 건에 쓰면 정본 위반이다.
                      const beforeDue = !deferred && !!dueInfo && !dueInfo.overdue && dueInfo.days !== 0
                      return <StatusBadge tone={deferred ? 'await' : beforeDue ? 'info' : isOverdue ? 'overdue' : 'unpaid'} sub={sub}
                        secondary={exitSub ? { tone: 'exit', label: '퇴실 예정' } : undefined}>{deferred ? '납부 유예' : unpaidBadgeLabel(dueInfo?.days, dueInfo?.overdue)}</StatusBadge>
                    }
                    // 청구 없는 달 — 미납 다음, 퇴실 예정 앞. 이월 미수가 있으면 미납이 먼저여야 한다.
                    if (room.noBillReason) {
                      const exitSub = room.status === 'CHECKOUT_PENDING' ? checkoutSubText(room.expectedMoveOut) : null
                      // 단기는 퇴실 예정 상태로 바뀌기 전에도 퇴실이 눈에 보여야 한다 — 문법은 CHECKOUT_PENDING 과 동일.
                      const shortExit = isShortTermCheckoutDue(room, targetMonth) ? checkoutSubText(room.expectedMoveOut) : null
                      return <StatusBadge tone="paid" sub={[noBillSubText(room), shortExit].filter(Boolean).join(' · ')}
                        secondary={(exitSub || shortExit) ? { tone: 'exit', label: '퇴실 예정' } : undefined}>청구 없음</StatusBadge>
                    }
                    // 퇴실 예정 — Camel
                    if (showCheckout && room.expectedMoveOut) {
                      const [, mm, dd] = room.expectedMoveOut.split('-')
                      const days = kstDaysUntil(room.expectedMoveOut)
                      const sub = days > 0 ? `D-${days} (${Number(mm)}/${Number(dd)} 퇴실)` : days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 퇴실` : `${Number(mm)}/${Number(dd)} 퇴실 (${Math.abs(days)}일 경과)`
                      return <StatusBadge tone="exit" sub={sub}>퇴실 예정</StatusBadge>
                    }
                    if (showCheckout) return <StatusBadge tone="exit">퇴실 예정</StatusBadge>
                    // 납부 예정 — 알림 필요, Blue(§03 AWAIT)
                    if (isAwaiting) {
                      // 기한을 미뤄준 사람은 '납부 예정'이 아니라 '납부 유예' — 미납 분기와 같은 말을 해야 한다
                      if (isDeferredNow(room, targetMonth)) return <StatusBadge tone="await" sub={unpaidSubText(room, targetMonth, getEffectiveDueInfo(room, targetMonth), true, null)}>납부 유예</StatusBadge>
                      const [, mm, dd] = room.nextDueDate!.split('-')
                      const days = kstDaysUntil(room.nextDueDate!)
                      const sub = days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 납부일` : `D-${days} (${Number(mm)}/${Number(dd)})`
                      return <StatusBadge tone="await" sub={sub}>납부 예정</StatusBadge>
                    }
                    // 완납 — Olive 뱃지 (지연납부 이력이 있으면 sub로)
                    let lateSub: string | undefined
                    if (room.latePaidAt) {
                      const [, mm, dd] = room.latePaidAt.split('-')
                      lateSub = `${Number(mm)}/${Number(dd)} 지연납부`
                    }
                    // 단기 입주월 — 청구 없음 분기에 오기 전인 그 달에도 퇴실이 보여야 한다.
                    const shortExit = isShortTermCheckoutDue(room, targetMonth) ? checkoutSubText(room.expectedMoveOut) : null
                    return <StatusBadge tone="paid" sub={[lateSub, shortExit].filter(Boolean).join(' · ') || undefined}
                      secondary={shortExit ? { tone: 'exit', label: '퇴실 예정' } : undefined}>완납</StatusBadge>
                  })()}
                </div>
              </div>
              {/* 둘째 줄: 입주자 + 연락처(colVis.contact) */}
              <div className="flex items-baseline gap-2 mt-1 flex-wrap">
                <p className="text-sm font-medium text-[var(--warm-dark)]">{room.tenantName}</p>
                {colVis.contact && room.contact && (
                  <span className="text-[0.6875rem] text-[var(--warm-muted)]">{room.contact}</span>
                )}
              </div>
              {/* 셋째 줄: 월이용료 · 잔액/예정 · 납부일 · 보증금 · 총납부액 (colVis 토글) */}
              <div className="flex items-center gap-2.5 mt-2 text-xs text-[var(--warm-mid)] flex-wrap">
                {colVis.expected && (
                  room.noBillReason
                    ? <span className="text-[var(--warm-muted)]">청구 없음</span>
                    : <span className="font-medium text-[var(--warm-dark)]"><MoneyDisplay amount={room.expected} /></span>
                )}
                {/* 미수/선납/예정 — '잔액' 컬럼 토글로 묶음. balance 의 의미 분기는 기존 로직 그대로. */}
                {colVis.balance && (() => {
                  const carryUnpaid = room.carryOver < 0 ? -room.carryOver : 0
                  const viewUnpaid  = (!room.isPaid && room.carryOver === 0 && !room.nextDueDate && room.balance < 0)
                                       ? -room.balance : 0
                  const totalUnpaid = carryUnpaid + viewUnpaid
                  if (totalUnpaid > 0) {
                    return <span className="font-medium text-[var(--coral)]">미수 -<MoneyDisplay amount={totalUnpaid} /></span>
                  }
                  if (room.balance > 0) {
                    return <span className="text-[var(--warm-mid)]">선납 +<MoneyDisplay amount={room.balance} /></span>
                  }
                  if (room.isPaid && room.nextDueDate && room.nextDueAmount > 0) {
                    return <span className="text-[var(--warm-mid)]">예정 <MoneyDisplay amount={room.nextDueAmount} /></span>
                  }
                  return null
                })()}
                {colVis.dueDay && dueDayCellText(room, targetMonth) && (
                  <span className="text-[var(--warm-muted)]">
                    {dueDayCellText(room, targetMonth)}
                  </span>
                )}
                {colVis.cashReceipt && room.cashReceiptIssued && (
                  <span className="text-[var(--success-fg)]">현금영수증</span>
                )}
                {colVis.depositAmount && room.depositAmount > 0 && (
                  <span className="text-[var(--warm-muted)]">
                    보증금 <MoneyDisplay amount={room.depositAmount} />
                  </span>
                )}
                {colVis.totalPaid && (
                  <span className="text-[var(--warm-muted)]">
                    총납부 <MoneyDisplay amount={room.totalPaid} />
                    {/* lastPayDate 는 월 격리가 아니라 계약 전체 최신 납부일이라, 청구 없는 달에는
                        덮은 수납과 같은 날짜가 두 번 찍힌다. 같은 날이면 캡션 하나만 남긴다. */}
                    {room.lastPayDate && room.lastPayDate !== room.noBillCoveredDate && <span className="text-[var(--warm-muted)]"> · 납부 {room.lastPayDate.slice(5).replace('-', '/')}</span>}
                    {noBillCoveredText(room) && <span className="text-[var(--warm-muted)]"> · {noBillCoveredText(room)}</span>}
                  </span>
                )}
              </div>
              {/* 미납 방 보조 액션 — 독촉 문구 복사 (수납 등록 동선과 분리, 미납일 때만) */}
              {!selectMode && totalUnpaid > 0 && (
                <div className="mt-2.5 flex justify-end">
                  <Btn variant="ghost" size="sm"
                    onClick={e => { e.stopPropagation(); copyReminder(room, totalUnpaid) }}>
                    독촉 문구 복사
                  </Btn>
                </div>
              )}
            </RoomCard>
          )
        })}
        {displayed.length === 0 && (
          <EmptyState
            icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" /></svg>}
            title={search ? '검색 결과가 없습니다' : '해당하는 호실이 없습니다'}
            description={search ? '다른 검색어로 시도해 보세요.' : '필터를 바꾸면 다른 호실이 표시됩니다.'}
          />
        )}
      </div>

      {/* 수납 현황 — 데스크탑 테이블 */}
      <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-[calc(100dvh-240px)]">
          <table className="w-full" style={{
            tableLayout: 'fixed',
            minWidth: colWidths.roomNo + colWidths.tenantName +
              COL_DEFS.filter(c => colVis[c.key]).reduce((s, c) => s + (colWidths[c.key] ?? 100), 0),
          }}>
            <thead className="sticky top-0 z-30 bg-[var(--cream)]">
              <tr className="border-b border-[var(--warm-border)]">
                <ResizableTh label="호실"   colKey="roomNo"     onClick={() => handleSort('roomNo')}     isActive={sortKey === 'roomNo'}     stickyLeft={0} />
                <ResizableTh label="입주자" colKey="tenantName" onClick={() => handleSort('tenantName')} isActive={sortKey === 'tenantName'} stickyLeft={colWidths.roomNo} />
                {colVis.contact       && <SortTh label="연락처"    sk="contact" />}
                {colVis.type          && <SortTh label="타입"      sk="type" />}
                {colVis.windowType    && <SortTh label="창문"      sk="windowType" />}
                {colVis.depositAmount && <SortTh label="보증금"    sk="depositAmount" />}
                {colVis.expected      && <SortTh label="월 이용료" sk="expected" />}
                {colVis.totalPaid     && <SortTh label="총납부액"  sk="totalPaid" />}
                {colVis.balance       && <SortTh label="잔액"      sk="balance" />}
                {colVis.dueDay        && <SortTh label="납부일"    sk="dueDay" />}
                {colVis.cashReceipt   && <SortTh label="현금영수증" sk="cashReceipt" />}
                {colVis.status        && <SortTh label="수납 상태" sk="status" />}
              </tr>
            </thead>
            <tbody>
              {displayed.map(room => {
                const tone = roomStatusTone(room, targetMonth)
                const totalUnpaid = getTotalUnpaid(room)
                // 고정(sticky) 열은 가로 스크롤 대비 불투명 배경이 필요해 행의 반투명 hover·선택 배경이 가려진다.
                // 같은 결과색을 color-mix 로 재현해 호실·입주자 열도 함께 하이라이트되게 한다(행이 hover 대상일 때만).
                const rowHoverable = !(room.isFutureMonth || (selectMode && !isBatchEligible(room)))
                const stickyRowBg = selectMode && isSelected(room)
                  ? 'bg-[color-mix(in_srgb,var(--coral)_5%,var(--cream))]'
                  : rowHoverable
                    ? 'bg-[var(--cream)] group-hover:bg-[color-mix(in_srgb,var(--canvas)_40%,var(--cream))]'
                    : 'bg-[var(--cream)]'
                return (
                // 한 방에 실계약과 비거주 계약이 공존하면 roomId 키가 중복돼 React 가 stale DOM 을 남기고 정렬이 고착된다(신고 7007d2c1, 418호 실증).
                <tr key={room.leaseTermId ?? room.roomId}
                  onClick={
                    selectMode
                      ? (isBatchEligible(room) ? () => toggleSelect(room.leaseTermId!) : undefined)
                      : () => { if (!room.isFutureMonth) openPayModal(room) }
                  }
                  {...press((!selectMode && !room.isFutureMonth) ? () => {
                    setSelectMode(true)
                    if (isBatchEligible(room)) toggleSelect(room.leaseTermId!)
                  } : undefined)}
                  className={`group border-b border-[var(--warm-border)]/50 transition-colors
                    ${(room.isFutureMonth || (selectMode && !isBatchEligible(room))) ? 'opacity-50' : 'cursor-pointer hover:bg-[var(--canvas)]/40 active:bg-[var(--canvas)] active:scale-[0.995] active:opacity-80'}
                    ${selectMode && isSelected(room) ? 'bg-[var(--coral)]/5' : ''}`}>

                  {/* sticky — 호실 (식별자 v2.0 §23: 기본 ink, 연체만 coral · 선택모드 시 체크박스) */}
                  <td className={`py-4 text-sm font-bold tnum overflow-hidden sticky left-0 z-20 transition-colors ${stickyRowBg} ${selectMode ? 'px-2' : 'px-4'} ${tone === 'overdue' ? 'text-[var(--coral)]' : 'text-[var(--warm-dark)]'}`}
                    style={{ width: colWidths.roomNo, minWidth: colWidths.roomNo, maxWidth: colWidths.roomNo, borderLeft: `3px solid ${statusTipColor(tone)}` }}>
                    <span className="flex items-center gap-2 min-w-0">
                      {selectMode && isBatchEligible(room) && (
                        <span className={`grid h-4 w-4 shrink-0 place-items-center rounded-[4px] border ${isSelected(room) ? 'bg-[var(--coral)] border-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)] bg-[var(--cream)]'}`}>
                          {isSelected(room) && <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>}
                        </span>
                      )}
                      <span className="truncate">{fmtRoomNo(room.roomNo)}</span>
                    </span>
                  </td>
                  {/* sticky — 입주자 */}
                  <td className={`px-4 py-4 text-sm font-medium text-[var(--warm-dark)] overflow-hidden sticky z-20 transition-colors ${stickyRowBg}`}
                    style={{ left: colWidths.roomNo, width: colWidths.tenantName, minWidth: colWidths.tenantName, maxWidth: colWidths.tenantName }}>
                    <span className="truncate block">{room.tenantName}</span>
                  </td>

                  {colVis.contact && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)]">
                      {room.contact ? formatPhone(room.contact) : '—'}
                    </td>
                  )}

                  {colVis.type && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)]">{room.type ?? '—'}</td>
                  )}

                  {colVis.windowType && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)]">
                      {room.windowType ? (WINDOW_LABEL[room.windowType] ?? room.windowType) : '—'}
                    </td>
                  )}

                  {colVis.depositAmount && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-dark)]">
                      <MoneyDisplay amount={room.depositAmount} />
                    </td>
                  )}

                  {colVis.expected && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-dark)]">
                      {room.noBillReason
                        ? <span className="text-[var(--warm-muted)]">청구 없음</span>
                        : <MoneyDisplay amount={room.expected} />}
                    </td>
                  )}

                  {colVis.totalPaid && (
                    <td className="px-4 py-4 text-sm">
                      <span className="text-[var(--warm-dark)]"><MoneyDisplay amount={room.totalPaid} /></span>
                      {room.carryOver > 0 && (
                        <span className="text-xs text-[var(--coral)] ml-1">(+이월액 <MoneyDisplay amount={room.carryOver} />)</span>
                      )}
                      {room.lastPayDate && room.lastPayDate !== room.noBillCoveredDate && (
                        <span className="block text-[0.6875rem] text-[var(--warm-muted)] mt-0.5">납부 {room.lastPayDate.slice(5).replace('-', '/')}</span>
                      )}
                      {noBillCoveredText(room) && (
                        <span className="block text-[0.6875rem] text-[var(--warm-muted)] mt-0.5">{noBillCoveredText(room)}</span>
                      )}
                    </td>
                  )}

                  {colVis.balance && (
                    <td className="px-4 py-4 text-sm font-semibold">
                      <span className={room.balance >= 0 ? 'text-[var(--warm-mid)]' : 'text-[var(--coral)]'}>
                        {room.balance > 0
                          ? <MoneyDisplay amount={room.balance} prefix="+" />
                          : room.balance < 0
                            ? <MoneyDisplay amount={Math.abs(room.balance)} prefix="-" />
                            : '0원'}
                      </span>
                    </td>
                  )}

                  {colVis.dueDay && (
                    <td className="px-4 py-4 text-sm text-[var(--warm-mid)] whitespace-nowrap">
                      {dueDayCellText(room, targetMonth) ?? '—'}
                    </td>
                  )}

                  {colVis.cashReceipt && (
                    <td className="px-4 py-4 text-center text-sm whitespace-nowrap">
                      {room.cashReceiptIssued
                        ? <span className="text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1.5 py-0.5">발행</span>
                        : <span className="text-[var(--warm-muted)]">—</span>}
                    </td>
                  )}

                  {colVis.status && (
                    <td className="px-4 py-4">
                      <div className="flex flex-col gap-1 items-center text-center">
                        {room.status === 'NON_RESIDENT' && <StatusBadge tone="info">비거주</StatusBadge>}
                        {room.status === 'RESERVED' ? (() => {
                          let sub: string | undefined
                          if (room.moveInDate) {
                            const days = kstDaysUntil(room.moveInDate)
                            sub = days > 0 ? `D-${days} 입주 예정` : days === 0 ? '오늘 입주' : `${Math.abs(days)}일 경과`
                          }
                          return <StatusBadge tone="movein" sub={sub}>{room.isReservationConfirmed ? '예약 확정' : '입실 예약'}</StatusBadge>
                        })() : (() => {
                          const isAwaiting = room.isPaid && room.nextDueDate && room.nextDueAmount > 0
                          const checkoutMonth = room.expectedMoveOut?.slice(0, 7) ?? null
                          const showCheckout = room.status === 'CHECKOUT_PENDING'
                            && room.isPaid && !!checkoutMonth && checkoutMonth <= targetMonth
                          if (!room.isPaid) {
                            const info = getEffectiveDueInfo(room, targetMonth)
                            // 카드(위)와 같은 규칙 — days 는 절댓값이라 방향(overdue)을 함께 봐야 한다.
                            // 이 표는 카드의 쌍둥이라 한쪽만 고치면 화면마다 다른 말을 한다.
                            const deferred = isDeferredNow(room, targetMonth)
                            // 퇴실 예정자가 미납이면 '퇴실 예정' 뱃지를 나란히 + 퇴실 D-day를 보조줄에 함께
                            const exitSub = room.status === 'CHECKOUT_PENDING' ? checkoutSubText(room.expectedMoveOut) : null
                            const sub = unpaidSubText(room, targetMonth, info, deferred, exitSub)
                            const isOverdue = !!(info && info.overdue && info.days > 7)
                            const beforeDue = !deferred && !!info && !info.overdue && info.days !== 0
                            return <StatusBadge tone={deferred ? 'await' : beforeDue ? 'info' : isOverdue ? 'overdue' : 'unpaid'} sub={sub}
                              secondary={exitSub ? { tone: 'exit', label: '퇴실 예정' } : undefined}>{deferred ? '납부 유예' : unpaidBadgeLabel(info?.days, info?.overdue)}</StatusBadge>
                          }
                          if (room.noBillReason) {
                            const exitSub = room.status === 'CHECKOUT_PENDING' ? checkoutSubText(room.expectedMoveOut) : null
                            // 카드와 같은 규칙 — 단기는 자동 전환 전에도 퇴실을 보조줄에 담는다.
                            const shortExit = isShortTermCheckoutDue(room, targetMonth) ? checkoutSubText(room.expectedMoveOut) : null
                            return <StatusBadge tone="paid" sub={[noBillSubText(room), shortExit].filter(Boolean).join(' · ')}
                              secondary={(exitSub || shortExit) ? { tone: 'exit', label: '퇴실 예정' } : undefined}>청구 없음</StatusBadge>
                          }
                          if (showCheckout && room.expectedMoveOut) {
                            const [, mm, dd] = room.expectedMoveOut.split('-')
                            const days = kstDaysUntil(room.expectedMoveOut)
                            const sub = days > 0 ? `D-${days} (${Number(mm)}/${Number(dd)} 퇴실)` : days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 퇴실` : `${Number(mm)}/${Number(dd)} 퇴실 (${Math.abs(days)}일 경과)`
                            return <StatusBadge tone="exit" sub={sub}>퇴실 예정</StatusBadge>
                          }
                          if (showCheckout) return <StatusBadge tone="exit">퇴실 예정</StatusBadge>
                          if (isAwaiting) {
                            if (isDeferredNow(room, targetMonth)) return <StatusBadge tone="await" sub={unpaidSubText(room, targetMonth, getEffectiveDueInfo(room, targetMonth), true, null)}>납부 유예</StatusBadge>
                            const [, mm, dd] = room.nextDueDate!.split('-')
                            const days = kstDaysUntil(room.nextDueDate!)
                            const sub = days === 0 ? `오늘 ${Number(mm)}/${Number(dd)} 납부일` : `D-${days} (${Number(mm)}/${Number(dd)})`
                            return <StatusBadge tone="await" sub={sub}>납부 예정</StatusBadge>
                          }
                          let lateSub: string | undefined
                          if (room.latePaidAt) {
                            const [, mm, dd] = room.latePaidAt.split('-')
                            lateSub = `${Number(mm)}/${Number(dd)} 지연납부`
                          }
                          const shortExit = isShortTermCheckoutDue(room, targetMonth) ? checkoutSubText(room.expectedMoveOut) : null
                          return <StatusBadge tone="paid" sub={[lateSub, shortExit].filter(Boolean).join(' · ') || undefined}
                            secondary={shortExit ? { tone: 'exit', label: '퇴실 예정' } : undefined}>완납</StatusBadge>
                        })()}
                        {/* 미납 방 보조 액션 — 독촉 문구 복사 (수납 등록 동선과 분리, 미납일 때만) */}
                        {!selectMode && totalUnpaid > 0 && (
                          <Btn variant="ghost" size="sm"
                            onClick={e => { e.stopPropagation(); copyReminder(room, totalUnpaid) }}>
                            독촉 문구 복사
                          </Btn>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                )
              })}
            </tbody>
          </table>
      </div>
      </>)}

      {/* 공실 섹션 — 상단 상태 필터의 '공실'과 연동: 필터 선택 시 본 목록 자리에 이 섹션만 표시 */}
      {filter === 'vacant' && vacants.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)] text-center py-10">공실이 없습니다.</p>
      )}
      {vacants.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-[var(--warm-muted)]">공실 {vacants.length}실
              {/* 기준 임대료 합 — '만실 기준' 안내가 이 숫자를 가리킨다. 없으면 "직접 더하세요"가 된다(디자이너 지적).
                  방별 월 이용료는 열 설정으로 감출 수 있어 개별 금액만으로는 대체되지 않는다. */}
              <span className="ml-1.5 font-normal text-[0.6875rem] text-[var(--warm-muted)] num">
                · 기준 임대료 합 {fmtWon(vacants.reduce((s, r) => s + (r.baseRent || 0), 0))}
              </span>
            </h2>
          </div>

          {/* 공실 — 모바일 카드 (열 설정으로 고른 정보를 칩으로, 최대 4개) */}
          <div className="sm:hidden grid grid-cols-2 gap-2">
            {sortedVacants.map(room => {
              // 선택된 표시 정보 — 가격이 다른 이유(창문·방향 등)를 카드만 봐도 알 수 있게
              const chips: string[] = []
              if (vacantColVis.type && room.type) chips.push(room.type)
              if (vacantColVis.windowType && room.windowType) chips.push(WINDOW_LABEL[room.windowType] ?? room.windowType)
              if (vacantColVis.direction && room.direction) chips.push(room.direction)
              if (vacantColVis.floor && room.floor) chips.push(/^\d+$/.test(room.floor) ? `${room.floor}층` : room.floor)
              const shown = chips.slice(0, 4)   // 공간 한도 — 최대 4개
              return (
                <div key={room.roomId} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-4 py-3 space-y-1.5">
                  <span className="text-sm font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(room.roomNo)}</span>
                  {shown.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {shown.map((c, i) => (
                        <span key={i} className="text-[0.65625rem] px-1.5 py-0.5 rounded-full" style={{ background: 'var(--canvas)', color: 'var(--warm-mid)' }}>{c}</span>
                      ))}
                    </div>
                  )}
                  {vacantColVis.baseRent && (
                    <p className="text-sm font-semibold text-[var(--warm-dark)]">
                      {room.baseRent > 0 ? <MoneyDisplay amount={room.baseRent} /> : '—'}
                    </p>
                  )}
                  {vacantColVis.prevTenantName && room.prevTenantName && (
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] truncate">직전 {room.prevTenantName}</p>
                  )}
                </div>
              )
            })}
          </div>

          {/* 공실 — 데스크탑 테이블 */}
          <div className="hidden sm:block bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-auto max-h-64">
            <table className="w-full min-w-[400px]">
              <thead className="sticky top-0 z-10 bg-[var(--cream)]">
                <tr className="border-b border-[var(--warm-border)]">
                  <VSortTh label="호실" sk="roomNo" />
                  {vacantColVis.type           && <VSortTh label="타입"          sk="type" />}
                  {vacantColVis.windowType     && <VSortTh label="창문"          sk="windowType" />}
                  {vacantColVis.direction      && <th className={thCls}>방향</th>}
                  {vacantColVis.floor          && <th className={thCls}>층</th>}
                  {vacantColVis.baseRent       && <VSortTh label="기본 월이용료" sk="baseRent" />}
                  {vacantColVis.prevTenantName && <VSortTh label="직전 입주자"   sk="prevTenantName" />}
                  {vacantColVis.prevContact    && <th className={thCls}>직전 연락처</th>}
                </tr>
              </thead>
              <tbody>
                {sortedVacants.map(room => (
                  <tr key={room.roomId} className="border-b border-[var(--warm-border)]/50">
                    <td className="px-4 py-3 text-sm font-bold tnum text-[var(--warm-dark)]">{fmtRoomNo(room.roomNo)}</td>
                    {vacantColVis.type && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.type ?? '—'}</td>
                    )}
                    {vacantColVis.windowType && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">
                        {room.windowType ? (WINDOW_LABEL[room.windowType] ?? room.windowType) : '—'}
                      </td>
                    )}
                    {vacantColVis.direction && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.direction ?? '—'}</td>
                    )}
                    {vacantColVis.floor && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-muted)]">{room.floor ? (/^\d+$/.test(room.floor) ? `${room.floor}층` : room.floor) : '—'}</td>
                    )}
                    {vacantColVis.baseRent && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-dark)]">
                        {room.baseRent > 0 ? <MoneyDisplay amount={room.baseRent} /> : '—'}
                      </td>
                    )}
                    {vacantColVis.prevTenantName && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-mid)]">{room.prevTenantName ?? '—'}</td>
                    )}
                    {vacantColVis.prevContact && (
                      <td className="px-4 py-3 text-sm text-[var(--warm-mid)]">
                        {room.prevContact ? formatPhone(room.prevContact) : '—'}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* 수납 모달은 전역 Prism 셸 (EntityModal/PaymentBody) 가 담당 */}

      {/* 선택 모드 하단 바 — v2.0 §22 공용 SelectionPillBar.
          selectedIds 는 leaseTermId 집합이라 세는 단위가 방이 아니라 계약이다 — 상단 칩과 같은 단위로. */}
      {selectMode && selectedIds.size > 0 && (
        <SelectionPillBar count={selectedIds.size} unit="명" onClose={exitSelectMode}>
          <PillButton primary disabled={batchTargets.length === 0} onClick={openBatchPay}>
            일괄 수납 처리
          </PillButton>
        </SelectionPillBar>
      )}

      {/* 일괄 수납 확인 모달 — v2.0 §13 Modal · v2.0 §12 세그먼트 · v2.0 §06 금액 · v2.0 §14② 되돌리기 가능 */}
      <Modal
        open={batchOpen}
        onClose={() => { if (!batchBusy) setBatchOpen(false) }}
        title="일괄 수납 처리"
        subtitle={`${targetMonth.replace('-', '년 ') + '월'} · ${batchTargets.length}개 호실`}
        width="sm"
        footer={
          <div className="flex gap-2 justify-end">
            <Btn variant="secondary" size="md" onClick={() => setBatchOpen(false)} disabled={batchBusy}>취소</Btn>
            <Btn variant="primary" size="md" onClick={runBatchPay} disabled={batchBusy || batchTargets.length === 0}>
              {batchBusy ? '처리 중…' : '수납 처리'}
            </Btn>
          </div>
        }
      >
        <div className="space-y-4">
          {/* 미수 합계 — v2.0 §12 자동합산 강조 + v2.0 §06 금액 */}
          <div className="rounded-md bg-[var(--sand)]/40 border border-[var(--warm-border)] px-4 py-3 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--warm-mid)]">이번 달 미수 합계</span>
            <span className="text-lg font-bold tnum text-[var(--warm-dark)]"><MoneyDisplay amount={batchTotal} /></span>
          </div>

          {/* 납부일 — v2.0 §12 */}
          <div>
            <label className="block text-xs font-medium text-[var(--warm-mid)] mb-1.5">납부일</label>
            {/* 껍데기를 넘긴다(오류신고 c2ab5b83). 정본 DatePicker 의 트리거 기본 클래스는
                `w-full text-left truncate` 뿐이라 안 넘기면 맨글자로 그려지고, 글자도 body 16px 을
                상속했다. 이 모달엔 텍스트 입력 형제가 없어 지역 기준이 없으므로 §12 정본
                (CheckoutCleaningDateField 의 FIELD_CLS, 42px)을 그대로 쓴다. */}
            <DatePicker value={batchDate} onChange={setBatchDate}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:border-[var(--persimmon)] focus-visible:shadow-[0_0_0_3px_rgba(160,60,46,0.12)] transition-colors" />
          </div>

          {/* 수납 방법 — v2.0 §12 상호배타는 세그먼트 */}
          <div>
            <label className="block text-xs font-medium text-[var(--warm-mid)] mb-1.5">수납 방법</label>
            <SegmentedControl
              size="md"
              ariaLabel="수납 방법"
              value={batchMethod}
              onChange={setBatchMethod}
              options={[
                { value: '계좌이체', label: '계좌이체' },
                { value: '현금',     label: '현금' },
                { value: '신용카드', label: '신용카드' },
                { value: '결제선생', label: '결제선생' },
              ]}
            />
          </div>

          <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
            선택한 호실의 <span className="font-medium text-[var(--warm-dark)]">이번 달 미수액을 전액</span> 수납 처리합니다.
            완납·미래월 등 대상이 아닌 호실은 자동 제외됩니다. 처리 후 토스트의 <span className="font-medium text-[var(--warm-dark)]">적용취소</span>로 되돌릴 수 있습니다.
          </p>
        </div>
      </Modal>
      </>}

    </div>
  )
}
