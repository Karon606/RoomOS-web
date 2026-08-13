'use client'

import Link from 'next/link'
import { fmtDateDot } from '@/lib/fmtDate'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { useState, useTransition, useEffect, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { Btn } from '@/components/ui/Btn'
import { StayQuoteModal } from '@/components/StayQuoteModal'
import { Loading } from '@/components/ui/Loading'
import MonthSelector from '@/components/layout/MonthSelector'
import { getTrendData, type TrendRange, type TrendPoint } from './actions'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import nextDynamic from 'next/dynamic'
// 추이 차트(recharts)는 지연 로드 — 홈 첫 페인트 번들에서 차트 라이브러리 제외
const TrendChart = nextDynamic(() => import('./TrendChart'), {
  ssr: false,
  loading: () => (
    <div className="h-44 flex items-center justify-center">
      <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
    </div>
  ),
})
import { CHART_COLORS, expenseCategoryColor, GENDER_COLORS, STATUS_COLORS, CONCEPT_COLORS } from '@/lib/chartColors'
import { fmtKorMoney, fmtManShort, fmtOfferRentAhead, fmtWon } from '@/lib/fmtMoney'
import { MoneyEquation, expectedRevenueTerms, paidRevenueTerms, operatingProfitTerms, expectedExpenseTerms, hasRevenueBridge, type EquationTerm } from '@/components/ui/MoneyEquation'
import { withheldDestinationLabel } from '@/lib/depositComposition'
import { getTenantQuickInfo } from '@/app/(app)/rooms/actions'
import { getRecurringExpensesWithStatus, getFinancialAccounts, type RecurringExpenseWithStatus } from '@/app/(app)/finance/actions'
import { RecurringExpenseRecordModal, type RecModalAccount } from '@/app/(app)/finance/RecurringExpenseRecordModal'
import { confirmReservationToActive, checkoutTenant, checkoutWithDepositRefund } from '@/app/(app)/tenants/actions'
import { setRoomShowOnSite } from '@/app/(app)/room-manage/actions'
import { kstMonthStr, kstYmdStr } from '@/lib/kstDate'
import { WITHHOLD_REASONS, buildWithholdReason } from '@/lib/depositWithholdReasons'
import { DatePicker } from '@/components/ui/DatePicker'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { UnpaidSmsModal, type UnpaidSmsTarget } from '@/components/UnpaidSmsModal'
import { ALERT_URGENT_WITHIN_DAYS, ALERT_URGENT_CATEGORY_DAYS } from '@/lib/appConfig'
import { availableFromLabel, checkoutDateLabel, moveInDateLabel } from '@/lib/leaseStatus'
import { fmtRoomNo } from '@/lib/roomNo'
import { DonutChart } from '@/components/ui/DonutChart'
import { InfoHint } from '@/components/ui/InfoHint'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

// ── 타입 ────────────────────────────────────────────────────────

export type DashboardData = {
  // 시작 체크리스트 — 3단계(호실·입주자·첫 수납) 모두 완료면 null
  onboarding:        { hasRooms: boolean; hasTenants: boolean; hasPayments: boolean } | null
  totalRevenue:      number
  paidRevenue:       number
  extraRevenue:      number
  projectedRevenue:  number     // 이번 달 입주자 모두 납부 완료 가정 (CHECKOUT_PENDING 제외)
  projectedRecurringExpense: number  // 이번 달 미발생 고정지출 합
  expenseTiers: { immovable: number; variable: number; savable: number }  // 지출 통제가능성 3단계(고정정액/고정변동/수시)
  lastMonthExpense:  number     // 지난달 실제 지출 합계 (예상 지출 비교용)
  lastYearExpense:   number     // 전년동월 실제 지출 합계 (예상 지출 비교용)
  projectedNetProfit: number    // 예상 매출 - totalExpense - 예상 고정지출
  totalExpense:      number
  netProfit:         number
  totalDeposit:      number
  depositReceived:   number     // 보유 보증금 중 실수취(보증금 명목 + 청소비 명목이 채운 몫)
  depositByCleaning: number     // 보유 보증금 중 입실 청소비가 채운 몫(포함형 영업장, 2026-08-10)
  depositUnrecorded: number     // 보유 보증금 중 미기록(전 원장 등 계약상만)
  reserveBalance:    number
  reserveMonthly:    { deposit: number; withdraw: number }
  operatingCashAvailable: number  // = netProfit - 이 달 매출에서 적립된 예비비
  reserveAccrualFromThisMonth: number
  paidCount:         number
  unpaidCount:       number
  upcomingCount:     number
  awaitingCount:     number
  paymentRate:       number
  pendingCount:      number
  pendingRevenue:    number     // 수납 예정 = 예상매출 − 수납완료 (손익 정합용)
  unpaidAmount:      number
  overdueAmount:     number
  upcomingAmount:    number
  totalExpected:     number
  // ── KPI 등식 캡션의 항 (2026-08-12) ──
  // 카드가 자기 식을 만들지 않도록 서버가 쓴 값을 그대로 받는다.
  billedThisMonth:      number   // 이 달 청구 합 — totalExpected 에서 퇴실 귀속·예약 확정을 뺀 몫
  collectedThisMonth:   number   // 실수납 등식의 첫 항('수납') — 퇴실 귀속·부가수익을 뺀 이용료 수납분
  reservedExpected:     number   // 예약 확정자의 그 달 전액
  checkedOutRecognized: number   // 퇴실 완료자의 그 달 귀속 인식분
  // 아직 오지 않은 달인가 — 서버(KST)가 판정한다. 수납 관리와 같은 달에 캡션이 뜨고 사라져야
  // 두 화면을 오가며 대조할 때 한쪽만 비는 일이 없다(rooms/page.tsx 와 같은 문법).
  isFutureMonth:        boolean
  // 지출 카테고리 분해 — amount = recorded + pending, percent 의 분모는 expectedExpense.
  // pending 은 그 달 미기록 고정 지출 추정분이고 과거월엔 서버가 0으로 보낸다(isPastMonth 가드).
  // top·recordedCount·pendingItems 는 조각을 눌렀을 때 펼치는 드릴다운용 — 서버가 이미 읽은
  // expenses·recurringWithStatus 에서 추린 것이라 클릭에 새 왕복이 없다.
  categoryBreakdown: {
    category: string; amount: number; recorded: number; pending: number; percent: number
    top: { date: string; amount: number; label: string }[]
    recordedCount: number
    pendingItems: { title: string; amount: number }[]
  }[]
  // 영업장 설정의 지출 카테고리 등록 순서 — 도넛·범례 색이 이 순서로 고정된다(금액 순위 아님).
  expenseCategoryOrder: string[]
  // 방 속성 세그먼트 — 이 달 청구액을 방 속성으로 나눈 것. 축마다 Σ amount === billedThisMonth 다.
  // parts 는 원값(OUTER·스탠다드·'4')이고 라벨은 화면이 붙인다 — 서버에 창문 라벨 사본을 또 두지 않기 위해서다.
  // absorb = 방이 없거나 속성이 빈 흡수 칸. 계약 0이면 안 그린다(그려도 0원 줄이라 읽을 것이 없다).
  // leasedRooms 는 **방 수**, leases 는 계약 수다 — 418호처럼 한 방에 둘이면 2건이 1실이다.
  roomSegments: {
    axis: string
    rows: {
      parts: { field: 'window' | 'tier' | 'floor'; value: string | null }[]
      absorb: boolean; unassigned: boolean
      rooms: number; leasedRooms: number; leases: number; amount: number; percent: number
    }[]
  }[]
  // 미수 에이징 — 귀속월 그대로의 버킷(30일·60일 같은 상대 버킷이 아니다). 도래·미회수분만이라
  // Σ amount === overdueAmount(누적 미납)다. count 는 그 달에 미회수분이 있는 계약 수이고,
  // 한 계약이 여러 달 밀려 있으면 여러 버킷에 서므로 그 합은 unpaidCount 보다 클 수 있다.
  agingBuckets: { month: string; amount: number; count: number }[]
  trend:             { month: string; revenue: number; expense: number; profit: number }[]
  totalRooms:        number
  vacantRooms:       number
  excludedRooms:     number   // 공실 집계 제외(창고·사무실, lib/vacancy 정본) — 공실에도 입실에도 안 넣음
  occupiedRooms:     number
  statusCounts:      { active: number; reserved: number; checkout: number; nonResident: number; waitingTour: number }
  totalTenants:      number
  genderDist:        { label: string; count: number; percent: number }[]
  nationalityDist:   { label: string; count: number; percent: number }[]
  jobDist:           { label: string; count: number; percent: number }[]
  // occupants = 타일에 세울 사람 — 거주 먼저 입주일 순, 그다음 입실 예약. 선택·순서는 lib/leaseStatus 정본.
  // availability = 사람 아래 세울 입주 가능 블락(from = 사슬 끝 입주 가능일, rent = 그 달 제시가). 서버 판정이고
  // 클라이언트는 재판정하지 않는다 — occupants 는 이미 잘린 집합이라 여기서 다시 세면 5인 이상 방에서 틀린다.
  // ahead / offerRentAhead = 그 자리가 보여 주는 달 뒤에 걸린 미반영 가격변경(lib/billing 정본). 판정도 서버 몫이다
  // — 여기서 scheduledRent 를 다시 읽으면 rentUpdateDate 의 달을 서버·기기가 다르게 뽑아 하이드레이션이 갈린다.
  rooms:             { id: string; roomNo: string; isVacant: boolean; vacancyExcluded: boolean; tenantName: string | null; tenantId: string | null; tenantStatus: string | null; occupants: { leaseId: string; tenantId: string; displayName: string; status: string; amount: number; payStatus: 'paid' | 'awaiting' | 'unpaid'; daysOverdue: number | null; moveInDate: string | null; expectedMoveOut: string | null }[]; occupantsMore: number; availability: { from: string; rent: number; ahead: { month: string; rent: number } | null } | null; offerRentAhead: { month: string; rent: number } | null; nonResidentName: string | null; nonResidentId: string | null; nonResidentAmount: number | null; type: string | null; tier: string | null; floor: string | null; windowType: string | null; direction: string | null; areaPyeong: number | null; areaM2: number | null; baseRent: number; offerRent: number }[]
  nonResidentItems:  { roomNo: string; tenantId: string; displayName: string; rentAmount: number; payStatus: 'paid' | 'awaiting' | 'unpaid'; daysOverdue: number | null }[]
  alerts:            { category?: 'unpaid' | 'contact' | 'upcoming' | 'moveout' | 'movein' | 'tour' | 'wish' | 'request' | 'recurring' | 'inventory'; text: string; link: string; dotColor: string; timeLabel: string; tenantId?: string; detail?: string; exactDate?: string; recurringExpenseId?: string; recurringAmount?: number; recurringDueDate?: string; recurringCategory?: string; recurringPayMethod?: string; recurringIsVariable?: boolean; wishCandidates?: { tenantId: string; tenantName: string; rank: number; matchedBy: 'rooms' | 'conditions'; caption: string }[]; wishRoomNo?: string; wishExcludedCount?: number; reservationDueLeaseId?: string; reservationDueRoomNo?: string | null; moveOutLeaseId?: string; moveOutDepositAmount?: number; moveOutCleaningFee?: number; moveOutCompositionLabel?: string | null; moveOutTenantName?: string; sortKey?: number; leaseTermId?: string; roomId?: string | null }[]
  expectedExpense:   number
  hasExpenseHistory: boolean
  activity:          { text: string; timeLabel: string; dotColor: string; link: string; tenantId: string; tenantName: string; roomNo: string; amount: number; badgeLabel?: string; badgeTone?: 'prepay' | 'late' }[]
  unpaidLeases:      { roomNo: string; tenantName: string; tenantId: string; leaseId: string; daysOverdue: number | null; deferredDue?: string | null; unpaidAmount: number; monthsOverdue: number }[]
  unpaidRoomNosForView: string[]
  // 소개 페이지 공개 후보 — 공실·사진 있고 미공개인 방
  publishCandidates:   { id: string; roomNo: string; tier: string | null; baseRent: number; thumbUrl: string | null }[]
  // 소개 페이지 철회 후보 — 입주 중인데 공개 상태인 방
  unpublishCandidates: { id: string; roomNo: string; tier: string | null; baseRent: number; thumbUrl: string | null }[]
}

// ── 레이블 ──────────────────────────────────────────────────────

const DASH_WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const DASH_DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
// RESERVED 라벨 '입실 예약' 통일 — 수납·호실관리·고객관리·lib/statusColors 와 동일 용어 (e1b81629)
const DASH_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '입실 예약', CHECKOUT_PENDING: '퇴실 예정',
}

// 방 현황 타일 글자 — 3슬롯(이름·금액·일정) 공통. 색은 슬롯이 아니라 밴드가 정하고 글자는 중립 잉크다.
// 밴드마다 색 글자를 쓰던 시절엔 타일 46개가 저마다 다른 색으로 말해 무엇이 급한지가 안 보였다.
const CELL_NAME  = { fontSize: '0.65625rem', fontWeight: 500, lineHeight: 1.2 } as const
const CELL_MONEY = { fontSize: '0.65625rem', fontWeight: 600, lineHeight: 1.2 } as const
// 일정줄은 색이 아니라 무게로 물러난다 — 밴드 잉크를 그대로 물려받는다(금액 600 · 이름 500 · 일정 400).
// --ink-3 을 박아 두던 시절엔 색 밴드 위에서 4.3~4.5 까지 떨어졌다. 틴트를 묽게 하는 대신 글자를
// 밴드와 같은 잉크로 올려 대비를 벌고, 색은 배경 한 채널만 쓰게 둔다.
const CELL_SUB   = { fontSize: '0.65625rem', fontWeight: 400, lineHeight: 1.2 } as const
// 연체 밴드의 금액·일정줄은 무게로만 강조한다. §18 '연체 카드: 호실번호·금액 --tc' 는 표면이 중립일 때
// 글자가 상태를 지는 문법이고, 여기서는 표면이 이미 짙은 테라코타라 같은 붉음을 글자에 또 얹으면
// 대비가 무너진다(라이트 3.00:1 · 다크 4.04:1, 둘 다 AA 미달). 붉음은 표면 몫으로 한 번만 쓰고
// 글자는 다른 밴드와 같은 --ink-2 를 물려받는다. Bold 는 §03 OVERDUE 의 남은 절반이다.
const CELL_MONEY_OVERDUE = { ...CELL_MONEY, fontWeight: 700 } as const
const CELL_SUB_OVERDUE = { ...CELL_SUB, fontWeight: 600 } as const
// 호실번호 헤더 띠 — 밴드 밖 상단 소블럭(§19 표 헤더 문법). 방 이름이 밴드에서 빠져야
// 2인 방 두 밴드가 이름·금액·일정 3슬롯으로 완전 대칭이 된다.
const CELL_HEAD  = { background: 'var(--canvas)', color: 'var(--ink)', fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1.2 } as const
// 빈 슬롯 — 날짜 없는 방도 자리는 지킨다(46타일 높이 균일).
const NBSP = '\u00A0'
// 이름은 자르지 않는다. 종전엔 공백으로 쪼개 두 번째 토큰만 세웠는데(2026-04-29 도입, b193d55 에서
// 사람 단위 타일로 이식), 그 규칙은 '성 이름' 두 토큰짜리 한국식 표기를 가정한 것이라 다중 토큰
// 이름에서 무너졌다 — 502호 '응우옌 티 타오 아인'이 '티'가 됐고(Thị 는 베트남 여성 이름의 중간
// 표지라 사람을 특정하지 못한다), 'Jihan Ismam'은 성이 이름 자리에 섰다. 넘치면 앞머리부터
// 보이도록 CSS 말줄임에 맡긴다 — 짧게 부르고 싶으면 고객 정보의 별칭이 그 자리다(lib/displayName).

// 사람이 있으면 색이 있고, 없으면 없다(운영자 오더 2026-08-11).
//   완납 초록 · 납부 예정과 입실 예약 파랑 · 미납 붉음 · 연체(7일 초과) 같은 붉음 더 짙게 · 공실 무색.
// 색은 배경 틴트 한 채널만 쓴다. 글자는 중립 잉크로 두고, 연체 하나만 §18 정본대로 금액·상태어에 색을 얹는다.
// 밴드마다 색 글자를 쓰던 시안 A 는 이름·금액·일정이 저마다 다른 색으로 말해 조잡했다.
type BandTone = 'none' | 'paid' | 'await' | 'unpaid' | 'overdue'
// 농도는 밴드 표면 티어(--band-*, §03)에서 온다. 칩·배지용 --status-*-bg 를 그대로 쓰던 시절엔
// 다섯 밴드가 라이트에서 최소 ΔE76 3.23 까지 붙어 "무슨 색인지 구분이 안 된다"는 신고를 받았다.
// hue 는 정본 그대로고 알파 단계만 다르다 — 자세한 근거는 globals.css 밴드 표면 5종 주석에 있다.
const BAND_BG: Record<BandTone, string> = {
  // 공실 — 사람이 없으니 색도 없다. 카드 베이스(--card-vacant-bg)를 그대로 물어
  // 라이트 #F5EDE0 · 다크 #261C14, 이 티어에서 유일하게 값이 안 바뀐 밴드다.
  none:    'var(--band-vacant-bg)',
  paid:    'var(--band-paid-bg)',      // §03 PAID 올리브
  await:   'var(--band-await-bg)',     // §03 AWAIT 인디고 — 납부 예정·입실 예약 공용
  unpaid:  'var(--band-unpaid-bg)',    // 붉은 계열 옅은 단계(운영자 2026-08-11 "미납이나 연체는 붉은색")
  overdue: 'var(--band-overdue-bg)',   // §03 OVERDUE — 같은 계열 짙은 단계
}
// 잉크는 밴드 다섯 종 모두 --ink-2 다. 종전엔 무색 밴드만 --ink-3 로 한 단계 물렸는데,
// 그 글자가 hover 에서 2.95:1 까지 떨어져 판독이 안 됐다. 위계는 색이 아니라 밴드 배경이 진다.
// opacity 를 곱하지 않는다 — 틴트 위에서 대비가 무너진다(타일 hover 도 같은 이유로 .room-tile
// 윤곽으로 바꿨다). 새 표면 위 최저 대비는 라이트 6.52 · 다크 7.25 로 전 조합 AA 통과다.
const bandStyle = (tone: BandTone) => ({
  background: BAND_BG[tone],
  color:      'var(--ink-2)',
})
// 한 사람의 색 — 예약자는 아직 안 들어왔으니 납부 여부를 묻지 않는다(입실 예약도 '예정').
// 미납 중 7일 초과만 연체로 부른다(§03·§24) — 그 경과일은 미수납 위젯 배지가 쓰는 값 그대로다.
const personTone = (p: { status: string; payStatus: 'paid' | 'awaiting' | 'unpaid'; daysOverdue: number | null }): BandTone =>
  p.status === 'RESERVED' ? 'await'
    : p.payStatus === 'unpaid' ? ((p.daysOverdue ?? 0) >= 7 ? 'overdue' : 'unpaid')
      : p.payStatus === 'awaiting' ? 'await'
        : 'paid'

// ── 재무/통계 상수 ───────────────────────────────────────────────

const GENDER_LABEL: Record<string, string> = { MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '미기재' }
const DIST_COLORS = [...CHART_COLORS].slice(0, 6)
const TREND_RANGES: { key: TrendRange; label: string }[] = [
  { key: 'daily',     label: '일간' },
  { key: 'weekly',    label: '주간' },
  { key: 'monthly',   label: '월간' },
  { key: 'quarterly', label: '분기' },
  { key: 'biannual',  label: '반년' },
  { key: 'annual',    label: '연간' },
  { key: 'all',       label: '전체' },
]
const UNPAID_LIMIT    = 5
const ACTIVITY_LIMIT  = 5
const ALERTS_LIMIT    = 3
const DIVIDER_COLOR   = 'rgba(200,160,120,0.12)'

function hexToRgba(hex: string, alpha: number) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return `rgba(${r},${g},${b},${alpha})`
}

// ── 미수납 days 표시 ────────────────────────────────────────────

// deferredDue 가 있으면 기한을 미뤄준 건이다. 수납관리는 이미 '납부 유예' 뱃지를 다는데
// 여기서 'D-5' 로만 보이면 왜 안 급한지가 안 보인다 — 같은 사정은 같은 말로(2026-08-02).
function daysLabel(daysOverdue: number | null, deferredDue?: string | null): { text: string; color: string } {
  // 칩이 이미 '납부 유예'라고 말하므로 여기서는 날짜만. 색도 칩과 같은 계열로 맞춘다.
  if (deferredDue) return { text: `${deferredDue}까지${daysOverdue != null && daysOverdue < 0 ? ` · ${Math.abs(daysOverdue)}일 남음` : ''}`, color: 'var(--info-fg)' }
  if (daysOverdue == null) return { text: '—', color: 'var(--warm-muted)' }
  if (daysOverdue > 0)  return { text: `${daysOverdue}일 경과`, color: 'var(--tc)' }
  if (daysOverdue === 0) return { text: '오늘 납부일', color: 'var(--viz-4)' }
  return { text: `D${daysOverdue} (${Math.abs(daysOverdue)}일 남음)`, color: 'var(--viz-4)' }
}

// ── 알림 상세 팝업 ───────────────────────────────────────────────

type AlertItem = DashboardData['alerts'][number]

function CheckoutRefundModal({
  tenantName, depositAmount, cleaningFee, compositionLabel, pending, onClose, onConfirm,
}: {
  tenantName: string
  depositAmount: number
  cleaningFee: number
  /** '받은 보증금 30,000 + 청소비 20,000 / 계약 50,000' — 청소비가 보증금 몫을 채운 계약만(정본 문법) */
  compositionLabel: string | null
  pending: boolean
  onClose: () => void
  onConfirm: (refundAmount: number, moveOutDate: string, reason: string) => void
}) {
  // 환불 가능 최대 = 보증금 - 청소비 (청소비 0이면 보증금 전액)
  const maxRefund = Math.max(0, depositAmount - cleaningFee)
  const [refund, setRefund] = useState(maxRefund)
  // 실제 퇴실일 — 정본 미니폼(상태 전환 위젯)과 같은 규칙: 기본 오늘, 뒤늦은 처리만 고친다(2026-07-28 오더).
  const [moveOutDate, setMoveOutDate] = useState(kstYmdStr())
  // 미환불 사유 — 종전에는 이 경로에 전달 수단 자체가 없어 홈에서 퇴실하면 사유가 항상 비었다.
  const [reason, setReason] = useState(cleaningFee > 0 ? '청소비' : '')
  const [formError, setFormError] = useState('')
  const [reasonEtc, setReasonEtc] = useState('')
  const unreturned = depositAmount - refund
  const exceedsMax = refund > maxRefund

  return (
    <Modal open onClose={onClose} z={260} width="sm"
      title={depositAmount > 0 ? '보증금 환불' : '퇴실 처리'} subtitle={`${tenantName}님 퇴실 정산`}
      dirty={refund !== maxRefund || moveOutDate !== kstYmdStr() || reason !== '' || reasonEtc !== ''}
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} disabled={pending}
            className="flex-1 py-2.5 rounded-lg text-sm font-medium border transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            취소
          </button>
          <button
            onClick={() => {
              const r = buildWithholdReason(reason, reasonEtc)
              // 오류를 부모 상태에 넣으면 이 창(z=260) 아래 모달에 그려져 안 보인다. 여기서 인라인으로 띄운다.
              if (depositAmount - refund > 0 && !r) { setFormError('미환불 사유를 선택해 주세요.'); return }
              setFormError(''); onConfirm(refund, moveOutDate, r)
            }}
            disabled={pending || exceedsMax || !moveOutDate}
            className="flex-1 py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--viz-4)', color: 'var(--on-solid)' }}>
            {pending ? '처리 중…' : '퇴실 처리'}
          </button>
        </div>
      }>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>퇴실일</label>
            <DatePicker value={moveOutDate} onChange={setMoveOutDate}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)]" />
          </div>

          {depositAmount > 0 && (<>
          {/* 청소비가 보증금 몫을 채운 계약은 구성을 병기한다 — 세 정산 폼이 같은 한 줄을 쓴다. */}
          {compositionLabel && (
            <p className="text-[0.65625rem] break-keep" style={{ color: 'var(--warm-mid)' }}>{compositionLabel}</p>
          )}
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-[var(--canvas)] rounded-lg px-3 py-2">
              <p style={{ color: 'var(--warm-muted)' }}>보증금</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--warm-dark)' }}>
                {fmtWon(depositAmount)}
              </p>
            </div>
            <div className="bg-[var(--canvas)] rounded-lg px-3 py-2">
              <p style={{ color: 'var(--warm-muted)' }}>청소비 차감</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: cleaningFee > 0 ? 'var(--tc)' : 'var(--warm-mid)' }}>
                {cleaningFee > 0 ? `-${fmtWon(cleaningFee)}` : '없음'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium block" style={{ color: 'var(--warm-mid)' }}>
              보증금 환불 (최대 {fmtWon(maxRefund)})
            </label>
            {/* 상태 전환 미니폼과 같은 세그먼트 문법. 이 경로에는 '환불 안 함' 선택지가 아예 없었다. */}
            <div className="grid grid-cols-2 gap-1.5">
              {([['refund', '환불함'], ['none', '환불 안 함']] as const).map(([k, label]) => {
                const on = k === 'none' ? refund === 0 : refund !== 0
                return (
                  <button key={k} type="button" onClick={() => setRefund(k === 'none' ? 0 : maxRefund)}
                    className={`min-h-[36px] text-xs font-medium rounded-lg border transition-colors ${
                      on ? 'border-[var(--tc)] bg-[var(--cream)] text-[var(--warm-dark)]'
                         : 'border-[var(--warm-border)] text-[var(--warm-mid)] hover:bg-[var(--warm-border)]/40'
                    }`}>{label}</button>
                )
              })}
            </div>
            <MoneyInput value={refund} onChange={setRefund} placeholder="0원" />
            {exceedsMax && (
              <p className="text-[0.6875rem] text-[var(--danger-fg)]">환불 금액은 최대 {fmtWon(maxRefund)}입니다.</p>
            )}
            {formError && <p className="text-[0.6875rem] text-[var(--danger-fg)]">{formError}</p>}
            {unreturned > 0 && (
              <div className="space-y-1.5 pt-0.5">
                <label className="text-xs font-medium block" style={{ color: 'var(--warm-mid)' }}>미환불 사유 <span className="font-normal opacity-60">(필수)</span></label>
                <select value={reason} onChange={e => setReason(e.target.value)}
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                  <option value="">선택하세요</option>
                  {WITHHOLD_REASONS.map(r => <option key={r} value={r}>{r}</option>)}
                </select>
                {reason === '기타' && (
                  <input type="text" value={reasonEtc} onChange={e => setReasonEtc(e.target.value)}
                    placeholder="사유를 직접 입력하세요"
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                )}
              </div>
            )}
          </div>

          <div className="rounded-lg px-3 py-2.5 text-xs space-y-1" style={{ background: 'color-mix(in srgb, var(--coral) 8%, transparent)', color: 'var(--warm-dark)' }}>
            <div className="flex justify-between">
              <span style={{ color: 'var(--warm-muted)' }}>환불</span>
              <span className="font-medium">{fmtWon(refund)}</span>
            </div>
            {unreturned > 0 && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--warm-muted)' }}>부가수익 귀속</span>
                <span className="font-medium">{fmtWon(unreturned)}</span>
              </div>
            )}
            <p className="text-[0.65625rem] pt-1" style={{ color: 'var(--warm-muted)' }}>
              미환불분은 {withheldDestinationLabel(Math.max(0, unreturned), cleaningFee, fmtWon)} 입금수단 &apos;보유 보증금&apos;으로 자동 등록됩니다.
            </p>
          </div>
          </>)}

          {depositAmount === 0 && (
            <p className="text-xs leading-relaxed" style={{ color: 'var(--warm-muted)' }}>호실이 공실로 전환됩니다.</p>
          )}
        </div>
    </Modal>
  )
}

// 날짜 게이트로 후보에서 빠진 사람 수 — 목록에는 없지만 그 방을 기다리던 사람들이다.
// 운영자가 그분들에게 "이번 방은 어렵다"고 연락할 수 있게 수를 남긴다(운영자 오더 2026-08-11).
function ExcludedByDateCaption({ count }: { count?: number }) {
  if (!count) return null
  return (
    <p className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>
      입주 희망일이 맞지 않아 제외 {count}명. 고객 목록 카드에 사유가 표시됩니다.
    </p>
  )
}

function AlertDetailModal({ alert, onClose, onOpenPayment, onStartRecord }: {
  alert: AlertItem
  onClose: () => void
  onOpenPayment: (alert: AlertItem) => void
  onStartRecord: (alert: AlertItem) => Promise<void>
}) {
  const router = useRouter()
  const avatarBg = hexToRgba(alert.dotColor, 0.15)
  const isRecurring = !!alert.recurringExpenseId
  const reservationDueLeaseId = alert.reservationDueLeaseId
  const moveOutLeaseId = alert.moveOutLeaseId
  const moveOutDeposit = alert.moveOutDepositAmount ?? 0
  const moveOutCleaning = alert.moveOutCleaningFee ?? 0
  const moveOutTenantName = alert.moveOutTenantName ?? ''
  const [confirmPending, setConfirmPending] = useState(false)
  const [confirmError, setConfirmError]     = useState('')
  const [refundModalOpen, setRefundModalOpen] = useState(false)
  // 고정지출 기록 폼은 실제 항목·계좌를 서버에서 받아 열기 때문에 버튼에 로딩 상태가 필요하다.
  const [recordPending, setRecordPending]   = useState(false)

  const handleConfirmActive = async () => {
    if (!reservationDueLeaseId || confirmPending) return
    if (!(await confirmDialog({ level: 'caution', title: '거주중으로 변경할까요?', message: '예약 상태를 실거주로 바꾸고 호실을 점유 처리합니다.', confirmLabel: '변경' }))) return
    setConfirmPending(true); setConfirmError('')
    const res = await confirmReservationToActive(reservationDueLeaseId)
    if (!res.ok) { setConfirmError(res.error); setConfirmPending(false); return }
    router.refresh()
    onClose()
  }

  // 퇴실은 보증금 유무와 무관하게 항상 미니폼(퇴실일 입력)으로 — 날짜 없는 즉시 처리 직행 폐기(2026-07-28 오더).
  const handleCheckout = () => {
    if (!moveOutLeaseId || !alert.tenantId || confirmPending) return
    setRefundModalOpen(true)
  }

  const handleRefundConfirm = async (refundAmount: number, moveOutDate: string, reason: string) => {
    if (!moveOutLeaseId || !alert.tenantId || confirmPending) return
    // 미환불이 있는데 사유가 없으면 막는다 — 돈이 움직이는 결정이라 근거가 남아야 한다.
    if (moveOutDeposit > 0 && moveOutDeposit - refundAmount > 0 && !reason) {
      setConfirmError('미환불 사유를 선택해 주세요.'); return
    }
    setConfirmPending(true); setConfirmError('')
    const res = moveOutDeposit > 0
      ? await checkoutWithDepositRefund({
          leaseTermId:  moveOutLeaseId,
          tenantId:     alert.tenantId,
          refundAmount,
          moveOutDate,
          ...(reason ? { reason } : {}),
        })
      : await checkoutTenant(moveOutLeaseId, alert.tenantId, moveOutDate)
    if (!res.ok) { setConfirmError(res.error); setConfirmPending(false); return }
    setRefundModalOpen(false)
    router.refresh()
    onClose()
  }

  return (
    <Modal open onClose={onClose} width="sm"
      // 풀블리드 — 본문이 섹션마다 자체 여백과 폭 전체 구분선을 갖는 구조라 기본 패딩을 쓰면 구분선이 안쪽으로 밀린다.
      bodyClassName=""
      title={
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0"
            style={{ background: avatarBg, color: alert.dotColor }}>
            <CategoryGlyph category={alert.category} size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--ink-2)' }}>{alert.text}</p>
            <span className="inline-block mt-1.5 text-[0.65625rem] font-semibold rounded-full px-2 py-0.5"
              style={{ background: hexToRgba(alert.dotColor, 0.12), color: alert.dotColor }}>
              {alert.timeLabel}{alert.exactDate ? ` · ${alert.exactDate}` : ''}
            </span>
          </div>
        </div>
      }>
        {/* 후보 리스트 (희망 호실/조건 매칭 그룹) */}
        {alert.wishCandidates && alert.wishCandidates.length > 0 ? (
          <div className="px-5 py-4 space-y-2" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
            <p className="text-[0.6875rem] font-semibold" style={{ color: 'var(--warm-muted)' }}>
              {alert.wishRoomNo ? `${alert.wishRoomNo}호 매칭 후보` : '매칭 후보'} · {alert.wishCandidates.length}명 (날짜·문의 순)
            </p>
            <div className="space-y-1.5">
              {alert.wishCandidates.map(c => (
                <Link
                  key={c.tenantId}
                  href={`/tenants?tenantId=${c.tenantId}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-lg border transition-colors hover:bg-[var(--canvas)]"
                  style={{ borderColor: 'var(--warm-border)' }}
                >
                  <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[0.6875rem] font-bold"
                    style={{ background: c.rank === 1 ? 'var(--success-bg)' : 'var(--canvas)', color: c.rank === 1 ? 'var(--success)' : 'var(--warm-mid)' }}>
                    {c.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--warm-dark)' }}>{c.tenantName}님</p>
                    <p className="text-[0.65625rem] mt-0.5" style={{ color: 'var(--warm-muted)' }}>
                      {c.caption}
                    </p>
                  </div>
                  <span style={{ color: 'var(--warm-muted)', fontSize: '0.875rem' }}>›</span>
                </Link>
              ))}
            </div>
            <ExcludedByDateCaption count={alert.wishExcludedCount} />
          </div>
        ) : (
          (alert.detail || alert.wishExcludedCount) && (
            <div className="px-5 py-4 space-y-2" style={{ borderBottom: isRecurring || alert.tenantId ? `1px solid ${DIVIDER_COLOR}` : undefined }}>
              {alert.detail && <p className="text-sm whitespace-pre-line leading-relaxed" style={{ color: 'var(--warm-dark)' }}>{alert.detail}</p>}
              <ExcludedByDateCaption count={alert.wishExcludedCount} />
            </div>
          )
        )}

        {/* 하단 버튼 */}
        <div className="px-5 pb-5 pt-4 space-y-2">
          {confirmError && (
            <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] px-3 py-2 rounded-lg">{confirmError}</p>
          )}
          {reservationDueLeaseId && (
            <button
              onClick={handleConfirmActive}
              disabled={confirmPending}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: 'var(--success)', color: 'var(--on-solid)' }}>
              {confirmPending ? '처리 중…' : '거주중으로 변경'}
            </button>
          )}
          {moveOutLeaseId && (
            <button
              onClick={handleCheckout}
              disabled={confirmPending}
              className="w-full py-2.5 rounded-lg text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: 'var(--viz-4)', color: 'var(--on-solid)' }}>
              {confirmPending ? '처리 중…' : '퇴실 처리'}
            </button>
          )}
          {isRecurring && (
            <Btn
              onClick={async () => {
                if (recordPending) return
                setRecordPending(true)
                await onStartRecord(alert)
                setRecordPending(false)
                onClose()
              }}
              disabled={recordPending}
              variant="primary" size="md" fullWidth className="font-semibold">
              {recordPending ? '불러오는 중…' : '지출 기록하기'}
            </Btn>
          )}
          {alert.tenantId && !isRecurring && !reservationDueLeaseId && !moveOutLeaseId && (
            <Btn
              onClick={() => { onOpenPayment(alert); onClose() }}
              variant="primary" size="md" fullWidth>
              수납 관리 보기
            </Btn>
          )}
          <Link href={alert.link} onClick={onClose}
            className="block w-full text-center text-xs font-medium py-2 rounded-lg border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            {isRecurring ? '지출 관리에서 보기 ›'
              : alert.category === 'inventory' ? '재고 관리에서 보기 ›'
              : alert.category === 'request' ? '요청·컴플레인에서 보기 ›'
              : alert.wishCandidates && alert.wishCandidates.length > 0 ? '호실 관리로 이동 ›'
              : '입주자 관리에서 보기 ›'}
          </Link>
        </div>
      {refundModalOpen && (
        <CheckoutRefundModal
          tenantName={moveOutTenantName}
          depositAmount={moveOutDeposit}
          cleaningFee={moveOutCleaning}
          compositionLabel={alert.moveOutCompositionLabel ?? null}
          pending={confirmPending}
          onClose={() => { if (!confirmPending) setRefundModalOpen(false) }}
          onConfirm={handleRefundConfirm}
        />
      )}
    </Modal>
  )
}

// ── 알림 스트립 — 카테고리별 그룹핑 (iOS 알림센터 스타일) ────────────

type AlertCat = 'unpaid' | 'contact' | 'upcoming' | 'moveout' | 'movein' | 'tour' | 'wish' | 'request' | 'recurring' | 'inventory' | 'other'
const CATEGORY_ORDER: AlertCat[] = ['unpaid', 'contact', 'upcoming', 'moveout', 'movein', 'tour', 'wish', 'request', 'recurring', 'inventory', 'other']
const CATEGORY_META: Record<AlertCat, { label: string; color: string }> = {
  unpaid:    { label: '누적 미납 (현 입주자)', color: 'var(--tc)' },
  contact:   { label: '연락할 때',    color: 'var(--coral)' },
  upcoming:  { label: '납부 예정',    color: 'var(--viz-4)' },
  moveout:   { label: '퇴실 예정',    color: 'var(--viz-4)' },
  movein:    { label: '입실 희망',    color: 'var(--camel)' },
  tour:      { label: '문의·투어',    color: 'var(--ink)' },
  wish:      { label: '희망 호실/조건 매칭', color: 'var(--success)' },
  request:   { label: '요청·컴플레인',color: 'var(--persimmon)' },
  recurring: { label: '고정 지출',    color: 'var(--viz-2)' },
  inventory: { label: '재고 부족',    color: 'var(--viz-4)' },
  other:     { label: '기타',         color: 'var(--ink-m)' },
}

// 알림 카테고리별 stroke 선 아이콘 — AlertRow·AlertDetailModal 공용(색은 currentColor로 dotColor 상속).
// 이름 첫 글자(성) 대신 유형을 형태로 표시. 색 충돌(success·inspect·info 각 2종)을 형태로 이중 부호화.
// 앱 (i)/KPI ? 아이콘과 동일 톤(viewBox 24·stroke·화살촉 없음). 전 path 24그리드 4~20 안전영역(14px 뭉갬 방지).
const CATEGORY_GLYPH_PATHS: Record<AlertCat, React.ReactNode> = {
  unpaid:    (<><rect x="5.5" y="8.5" width="13" height="7" rx="1.5" /><path d="M7.5 14.5 16.5 9.5" /></>),
  upcoming:  (<><rect x="5.5" y="6.5" width="13" height="12" rx="2" /><path d="M5.5 10.5h13" /><path d="M9 5v2.5M15 5v2.5" /></>),
  moveout:   (<><rect x="8" y="5" width="8" height="14" rx="1" /><path d="M13.5 11.5v3" /></>),
  movein:    (<><circle cx="12" cy="8" r="3" /><path d="M5.5 19a6.5 6.5 0 0 1 13 0" /></>),
  tour:      (<><path d="M12 19c3.3-4 5-6.7 5-9a5 5 0 1 0-10 0c0 2.3 1.7 5 5 9z" /><circle cx="12" cy="10" r="1.8" /></>),
  contact:   (<path d="M16.5 14.2l-1.4 1.4a1 1 0 0 1-1.1.2 12.5 12.5 0 0 1-5.8-5.8 1 1 0 0 1 .2-1.1l1.4-1.4a1 1 0 0 0 .2-1L9.3 5.6A1 1 0 0 0 8.4 5H6.2A1.2 1.2 0 0 0 5 6.3 13 13 0 0 0 17.7 19a1.2 1.2 0 0 0 1.3-1.2v-2.2a1 1 0 0 0-.6-.9l-1.9-.8a1 1 0 0 0-1 .1z" />),
  wish:      (<path d="M12 5.2 13.98 9.25 18.47 9.9 15.24 13.05 16 17.5 12 15.4 8 17.5 8.76 13.05 5.53 9.9 10.02 9.25Z" />),
  request:   (<><rect x="5" y="5" width="14" height="10" rx="3" /><path d="M9.5 15v3l3.2-3" /></>),
  recurring: (<><circle cx="12" cy="12" r="7" /><path d="M12 8v4l3.2 1.9" /></>),
  inventory: (<><rect x="6" y="8" width="12" height="10" rx="1" /><path d="M6 11h12" /><path d="M12 11v7" /></>),
  other:     (<><path d="M12 5a5 5 0 0 0-5 5c0 5-2 6-2 6h14s-2-1-2-6a5 5 0 0 0-5-5z" /><path d="M10.5 18a1.6 1.6 0 0 0 3 0" /></>),
}

function CategoryGlyph({ category, size }: { category?: AlertItem['category']; size: number }) {
  const glyph = CATEGORY_GLYPH_PATHS[(category ?? 'other') as AlertCat] ?? CATEGORY_GLYPH_PATHS.other
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {glyph}
    </svg>
  )
}

const COLLAPSE_THRESHOLD = 3   // (예정 그룹) 이 개수 이하만 기본 펼침

// timeLabel 에서 긴급도(D-N)를 도출 — 경과=음수, 오늘/임박/필요=0, N일 남음=양수, 날짜없음=큰값(긴급 아님).
// 라벨은 page.tsx dayLabel 등이 만드는 안정적 한국어. 형식이 바뀌어도 9999(긴급 아님)로 graceful 폴백.
function urgencyDaysOf(timeLabel: string): number {
  if (!timeLabel) return 9999
  if (timeLabel.includes('경과')) { const n = parseInt(timeLabel, 10); return isNaN(n) ? -1 : -n }
  if (timeLabel.includes('오늘') || timeLabel.includes('임박') || timeLabel.includes('필요')) return 0
  if (timeLabel.includes('남음')) { const n = parseInt(timeLabel, 10); return isNaN(n) ? 9999 : n }
  return 9999
}

// 알림 한 줄 — '지금 급함' 존과 '예정' 그룹에서 공유
function AlertRow({ item, onOpen }: { item: AlertItem; onOpen: (a: AlertItem) => void }) {
  return (
    <button
      className="w-full text-left hover:opacity-70 active:opacity-50 transition-opacity"
      onClick={() => onOpen(item)}
    >
      <div className="flex items-center gap-3 px-5 py-3"
        style={{ borderLeft: `3px solid ${item.dotColor}`, background: hexToRgba(item.dotColor, 0.06) }}>
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
          style={{ background: hexToRgba(item.dotColor, 0.12), color: item.dotColor }}>
          <CategoryGlyph category={item.category} size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-2)' }}>{item.text}</p>
          <p className="text-[0.65625rem] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>
            {item.timeLabel}{item.exactDate ? ` · ${item.exactDate}` : ''}
          </p>
        </div>
        <span style={{ color: 'var(--warm-muted)', fontSize: '0.875rem' }}>›</span>
      </div>
    </button>
  )
}

function AlertsStrip({ alerts, onOpenAlert }: {
  alerts: DashboardData['alerts']
  onOpenAlert: (alert: AlertItem) => void
}) {
  // 긴급도(D-N) 부여 후 '지금 급함'(경과 or 카테고리별 D-N 이내)과 '예정'으로 분리.
  // L 후속(2026-05-28): 카테고리별 임계값 — 미납은 0(도래 즉시), 퇴실/입주는 3(사전 준비), 재고는 5(발주 리드타임) 등.
  const thresholdFor = (cat: AlertItem['category']): number =>
    ALERT_URGENT_CATEGORY_DAYS[cat ?? 'other'] ?? ALERT_URGENT_WITHIN_DAYS
  const withU = alerts.map(a => ({ a, u: urgencyDaysOf(a.timeLabel), t: thresholdFor(a.category) }))
  const urgent = withU
    .filter(x => x.u <= x.t)
    .sort((x, y) => x.u - y.u)   // 가장 급한(많이 경과한) 순 — 카테고리 무관
    .map(x => x.a)
  // 카테고리 묶음 = '완전한 목록' — 긴급 항목도 그 카테고리에 함께 표시(긴급 존과 중복). 2026-07-01 사용자 요청:
  // 긴급인 퇴실예정도 '퇴실 예정' 묶음에 보여야 함. '긴급'은 가장 급한 것 하이라이트, 카테고리는 전체 목록.
  const groups = (() => {
    const map = new Map<AlertCat, { a: AlertItem; u: number }[]>()
    for (const x of withU) {
      const cat = (x.a.category ?? 'other') as AlertCat
      const arr = map.get(cat) ?? []
      arr.push(x)
      map.set(cat, arr)
    }
    for (const arr of map.values()) arr.sort((p, q) => p.u - q.u)
    return CATEGORY_ORDER
      .map(cat => ({ cat, items: (map.get(cat) ?? []).map(x => x.a) }))
      .filter(g => g.items.length > 0)
  })()

  // 예정 그룹 펼침 — 기본 접힘(급한 건 위 존에 이미 노출). 단 긴급이 하나도 없으면 옛 동작(≤3개 펼침)으로 폴백.
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of groups) init[g.cat] = urgent.length === 0 && g.items.length <= COLLAPSE_THRESHOLD
    return init
  })
  // 그룹 내 부분 펼침 (L 후속) — 그룹을 열어도 가장 급한 N개만 우선 보이고 나머지는 '+M건 더 보기' 뒤로.
  // 그룹 items 는 이미 긴급도 오름차순 정렬돼 있어 slice(0, LIMIT) = 가장 급한 N개.
  const [groupFullOpen, setGroupFullOpen] = useState<Record<string, boolean>>({})

  if (alerts.length === 0) return null

  return (
    <div className="rounded-xl flex flex-col" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0" style={{ borderColor: DIVIDER_COLOR }}>
        <div className="flex items-center gap-2">
          <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>알림</h3>
          <span className="rounded-full text-[0.65625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>미처리</span>
        </div>
        <span className="rounded-full text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'color-mix(in srgb, var(--coral) 10%, transparent)', color: 'var(--coral)' }}>
          {alerts.length}건
        </span>
      </div>

      {/* ── 지금 급함 — 카테고리 무관, 항상 펼침 ── */}
      {urgent.length > 0 && (
        <div style={{ borderBottom: groups.length > 0 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
          <div className="flex items-center gap-2 px-5 py-2.5" style={{ background: 'var(--danger-bg)' }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--tc)' }} />
            <span className="text-[0.6875rem] font-bold flex-1 text-left" style={{ color: 'var(--tc)' }}>긴급</span>
            <span className="text-[0.65625rem] font-medium" style={{ color: 'var(--warm-muted)' }}>{urgent.length}건</span>
          </div>
          <div>
            {urgent.map((item, i) => (
              <div key={`u-${i}`} style={{ borderTop: `1px solid ${DIVIDER_COLOR}` }}>
                <AlertRow item={item} onOpen={onOpenAlert} />
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── 예정 — 카테고리 그룹, 기본 접힘 (수동 토글) ── */}
      {groups.map((g, gi) => {
        const meta = CATEGORY_META[g.cat]
        const isOpen = expanded[g.cat] ?? false
        return (
          <div key={g.cat} style={{ borderBottom: gi < groups.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
            <button
              type="button"
              onClick={() => setExpanded(prev => ({ ...prev, [g.cat]: !isOpen }))}
              className="w-full flex items-center gap-2 px-5 py-2.5 hover:opacity-80 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.015)' }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
              <span className="text-[0.6875rem] font-semibold flex-1 text-left" style={{ color: 'var(--ink-2)' }}>
                {meta.label}
              </span>
              <span className="text-[0.65625rem] font-medium" style={{ color: 'var(--warm-muted)' }}>
                {g.items.length}건
              </span>
              <span className="text-[var(--warm-muted)] text-xs ml-1" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 150ms' }}>›</span>
            </button>

            {isOpen && (() => {
              const isFullOpen = groupFullOpen[g.cat] ?? false
              const hasMore = g.items.length > COLLAPSE_THRESHOLD
              const visibleItems = (hasMore && !isFullOpen) ? g.items.slice(0, COLLAPSE_THRESHOLD) : g.items
              const hiddenCount = g.items.length - visibleItems.length
              return (
                <div>
                  {visibleItems.map((item, i) => (
                    <div key={i} style={{ borderTop: i === 0 ? `1px solid ${DIVIDER_COLOR}` : 'none', borderBottom: i < visibleItems.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
                      <AlertRow item={item} onOpen={onOpenAlert} />
                    </div>
                  ))}
                  {hasMore && (
                    <button
                      type="button"
                      onClick={() => setGroupFullOpen(prev => ({ ...prev, [g.cat]: !isFullOpen }))}
                      className="w-full text-center py-2 text-[0.6875rem] font-medium hover:opacity-70 transition-opacity"
                      style={{ color: 'var(--warm-mid)', borderTop: `1px solid ${DIVIDER_COLOR}`, background: 'rgba(0,0,0,0.012)' }}
                    >
                      {isFullOpen ? '접기' : `+ ${hiddenCount}건 더 보기`}
                    </button>
                  )}
                </div>
              )
            })()}
          </div>
        )
      })}
    </div>
  )
}

// ── 도넛 차트 ───────────────────────────────────────────────────


// ── 공용 컴포넌트 ───────────────────────────────────────────────

function StatCard({ label, value, sub, colorStyle }: {
  label: string; value: React.ReactNode; sub: string; colorStyle?: React.CSSProperties
}) {
  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <p className="text-xs font-medium" style={{ color: 'var(--warm-muted)' }}>{label}</p>
      <p className="text-xl font-bold mt-1.5" style={colorStyle ?? { color: 'var(--warm-dark)' }}>{value}</p>
      <p className="text-xs mt-1" style={{ color: 'var(--warm-muted)' }}>{sub}</p>
    </div>
  )
}

function Row({ label, value, colorStyle }: { label: string; value: React.ReactNode; colorStyle?: React.CSSProperties }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm" style={{ color: 'var(--warm-mid)' }}>{label}</span>
      <span className="text-sm font-semibold" style={colorStyle ?? { color: 'var(--warm-dark)' }}>{value}</span>
    </div>
  )
}

/**
 * 등식 캡션 한 줄 — 상단 KPI 카드가 큰 숫자 아래 적는 그 줄과 크기·색·줄바꿈 규칙이 같다(§24).
 * 문장은 MoneyEquation 정본이 만들고 여기서는 자리만 준다 — 항 이름·순서를 화면이 짓지 않는다.
 */
function EqCaption({ terms }: { terms: EquationTerm[] }) {
  return (
    <p className="text-[0.65625rem] mt-1" style={{ color: 'var(--warm-muted)', lineHeight: 1.5, wordBreak: 'keep-all' }}>
      <MoneyEquation terms={terms} />
    </p>
  )
}

function DistList({ items, colors }: { items: { label: string; count: number; percent: number }[]; colors: string[] }) {
  if (items.length === 0) return <p className="text-sm py-4 text-center" style={{ color: 'var(--warm-muted)' }}>데이터 없음</p>
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-1">
            <span className="flex items-center gap-1.5" style={{ color: 'var(--warm-dark)' }}>
              <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: colors[i % colors.length] }} />
              {item.label}
            </span>
            <span style={{ color: 'var(--warm-muted)' }}>{item.count}명 ({item.percent}%)</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--warm-border)' }}>
            <div className="h-full rounded-full" style={{ width: `${item.percent}%`, background: colors[i % colors.length] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

// 방 속성 세그먼트 축 — 라벨 어법은 형제 카드 컨트롤과 같다('아이템별'·'결제수단별'·'월별').
// 교차 축 구분자는 곱셈 기호가 아니라 가운뎃점이다(§11·§22 구분자 ' · ').
const SEGMENT_AXIS_OPTIONS = [
  { value: 'windowTier', label: '창·등급별' },
  { value: 'tier',       label: '등급별' },
  { value: 'window',     label: '창별' },
  { value: 'floor',      label: '층별' },
] as const
type SegmentAxis = typeof SEGMENT_AXIS_OPTIONS[number]['value']

/**
 * 방 속성 세그먼트 카드 — 이 달 청구액을 방의 속성으로 나눈 것.
 *
 * 값은 전부 서버가 나눈 것이다(축마다 Σ amount === 이 달 청구액, 비율 분모도 서버가 한 번만
 * 나눈다). 화면은 라벨을 붙이고 순서대로 그릴 뿐이다.
 *
 * 왜 도넛이 아니라 목록·진행바인가. viz 팔레트는 여덟 색뿐인데(lib/chartColors) 창·등급 교차는
 * 그 수를 넘길 수 있어 같은 카드 안에 같은 색 두 조각이 선다. 그리고 세그먼트는 축을 바꾸면
 * 목록 자체가 바뀌는 임시 분류라, 순서대로 색을 물리면 같은 방이 '등급별'과 '층별'에서 다른
 * 색이 된다 — 지출 카테고리 색을 금액 순위에서 등록 순서로 옮기며 죽인 그 흔들림이다.
 * 이 카드가 나누는 값은 '수입' 하나뿐이라 개념색 하나면 된다.
 *
 * 바 채움이 --coral 이 아니라 §19 페어 --tc-text 인 이유: 라이트에서는 같은 #A03C2E 라 픽셀이
 * 안 바뀌고, 다크에서만 갈린다 — 트랙(--warm-border) 위 대비가 --coral 은 2.32:1(1.4.11 미달)
 * 이고 --tc-text 는 3.86:1 이다(라이트 4.31:1).
 */
function RoomSegmentCard({ data }: { data: DashboardData }) {
  const [axis, setAxis] = useState<SegmentAxis>('windowTier')
  const group = data.roomSegments.find(g => g.axis === axis) ?? data.roomSegments[0]
  // 전체 0실인 칸은 안 세운다(0인 항은 세우지 않는다는 이 탭의 규칙). 입실 0실이지만 방은 있는
  // 칸은 세운다 — 어느 속성의 방이 통째로 비었는지가 이 카드가 답해야 할 질문이다.
  const rows = (group?.rows ?? []).filter(r => r.rooms > 0 || r.leases > 0)
  const segLabel = (parts: DashboardData['roomSegments'][number]['rows'][number]['parts'], unassigned: boolean) =>
    unassigned ? '방 미배정' : parts.map(p =>
      p.value == null ? '미지정'
      : p.field === 'window' ? (DASH_WINDOW_LABEL[p.value] ?? p.value)
      : p.field === 'floor'  ? `${p.value}층`
      : p.value).join(' · ')
  return (
    <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-mid)' }}>
          방 속성별 이용료
          <InfoHint title="방 속성별 이용료">
            <p>이 달 <b>청구액</b>을 방의 속성으로 나눈 것입니다. 어느 조합이 매출을 지고 있는지, 어느 조합이 비어 있는지를 함께 봅니다.</p>
            <p className="mt-2">비율의 분모는 이 달 청구액입니다. 그래서 어느 축을 골라도 조각의 합이 그 금액과 같습니다.</p>
            <p className="mt-2"><b>전체 N실</b>은 그 속성을 가진 방 전부이고 <b>입실 M실</b>은 그중 이 달 청구가 걸린 방입니다. 방 하나에 계약이 둘이면(거주와 비거주가 함께 있는 방) 2건이 1실이라, 그럴 때만 계약 수를 함께 적습니다.</p>
            <p className="mt-2">창고·사무실처럼 공실 집계에서 빼는 방도 여기서는 셉니다. 그 방들의 비거주 이용료가 이 금액 안에 들어 있어서, 빼면 금액만 있고 방은 없는 칸이 생깁니다.</p>
          </InfoHint>
        </h3>
        <SegmentedControl
          options={SEGMENT_AXIS_OPTIONS}
          value={axis}
          onChange={setAxis}
          size="sm"
          scroll
          ariaLabel="방 속성 축"
        />
      </div>
      {rows.length === 0 ? (
        <p className="text-sm py-6 text-center" style={{ color: 'var(--warm-muted)' }}>나눌 청구가 없음</p>
      ) : (
        /* 전폭 카드에서 한 줄을 통으로 쓰면 왼쪽 이름과 오른쪽 금액이 멀어져 눈이 못 따라간다.
           두 열로 흘리면 한 행의 읽는 폭이 반폭 카드와 같아진다(위 요약 타일이 쓰는 그 문법). */
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-6 gap-y-2.5">
          {rows.map((r, i) => (
            <div key={i} className="min-w-0">
              <div className="flex items-baseline gap-2 min-w-0">
                <span className="text-xs flex-1 truncate" style={{ color: 'var(--warm-mid)' }}>{segLabel(r.parts, r.unassigned)}</span>
                <span className="text-xs shrink-0 num" style={{ color: 'var(--warm-dark)' }}><MoneyDisplay amount={r.amount} /></span>
              </div>
              {/* 비율을 1행에서 뺀 것은 폭 때문이다 — 320px 에서 이름·금액·비율을 한 줄에 두면
                  교차 축 이름이 절단 직전에 선다. 들여쓰기는 형제 범례 보조 줄과 같은 18px. */}
              <span className="block text-[0.65625rem] pl-[18px] leading-tight" style={{ color: 'var(--warm-muted)' }}>
                전체 {r.rooms}실 중 입실 {r.leasedRooms}실{r.leases > r.leasedRooms ? ` (계약 ${r.leases}건)` : ''} · {r.percent}%
              </span>
              <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: 'var(--warm-border)' }}>
                <div className="h-full rounded-full" style={{ width: `${r.percent}%`, background: 'var(--tc-text)' }} />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * 미수 에이징 — '누적 미납'을 귀속월로 가른 하위 목록.
 *
 * 새 값이 아니라 바로 위 줄의 분해다(Σ 버킷 금액 === 누적 미납). 규격은 형제 '지출 카테고리'
 * 드릴다운 목록 그대로다 — 이 탭에서 '카드 안 한 항목을 펼친 하위 목록'의 전례가 그것뿐이다.
 *
 * 월 표기는 'N월분'이다. 'YYYY-MM' 은 모바일에서 읽기 나쁘다는 판례(accrual-check)와 같은 어휘고,
 * 해가 갈리는 버킷만 연도를 붙인다(PaymentRecordList 의 'YYYY년 M월분'). 당월은 괄호 한정어.
 *
 * 색은 두 단계뿐이고 새 색이 0종이다 — 이월분은 --overdue-fg, 당월분은 --warning-fg(§03 상태 5단계의
 * 두 칸, §24 의 미납·연체 두 단계). 다만 줄에 '연체'라는 낱말은 쓰지 않는다: 귀속월 버킷은 일수
 * 판정이 아니라 이월 여부라, 납부일이 늦은 계약은 전월 귀속분도 아직 미납 단계일 수 있다.
 */
function AgingList({ buckets, targetMonth }: { buckets: DashboardData['agingBuckets']; targetMonth: string }) {
  if (buckets.length === 0) return null
  const monLabel = (m: string) => {
    const [y, mo] = m.split('-')
    const head = y === targetMonth.slice(0, 4) ? `${Number(mo)}월분` : `${Number(y)}년 ${Number(mo)}월분`
    return m === targetMonth ? `${head} (당월)` : head
  }
  // 다섯 줄까지만 편다 — 넘치면 오래된 쪽을 한 줄로 접는다(형제 목록의 '그 밖 N건'과 같은 문법).
  const MAX = 5
  const folded = buckets.length > MAX ? buckets.slice(0, buckets.length - MAX) : []
  const shown  = buckets.slice(folded.length)
  return (
    <div className="pl-3 space-y-1">
      {folded.length > 0 && (
        <div className="flex items-baseline gap-2 text-[0.6875rem] min-w-0">
          <span className="shrink-0" style={{ color: 'var(--warm-muted)' }}>그 밖 {folded.length}개월</span>
          <span className="flex-1" />
          <span className="shrink-0 num" style={{ color: 'var(--overdue-fg)' }}>
            <MoneyDisplay amount={folded.reduce((s, b) => s + b.amount, 0)} />
          </span>
        </div>
      )}
      {shown.map(b => (
        <div key={b.month} className="flex items-baseline gap-2 text-[0.6875rem] min-w-0">
          <span className="shrink-0 num" style={{ color: 'var(--warm-muted)' }}>{monLabel(b.month)}</span>
          <span className="flex-1 truncate" style={{ color: 'var(--warm-muted)' }}>{b.count}건</span>
          <span className="shrink-0 num" style={{ color: b.month === targetMonth ? 'var(--warning-fg)' : 'var(--overdue-fg)' }}>
            <MoneyDisplay amount={b.amount} />
          </span>
        </div>
      ))}
    </div>
  )
}

// ── 재무 탭 ─────────────────────────────────────────────────────

function FinanceTab({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
  const [trendRange, setTrendRange] = useState<TrendRange>('biannual')
  const [trendPoints, setTrendPoints] = useState<TrendPoint[]>(() =>
    data.trend.map(t => ({ label: `${parseInt(t.month.slice(5))}월`, revenue: t.revenue, expense: t.expense, profit: t.profit }))
  )
  const [trendPending, startTrendTransition] = useTransition()

  useEffect(() => {
    if (trendRange === 'biannual') {
      setTrendPoints(data.trend.map(t => ({ label: `${parseInt(t.month.slice(5))}월`, revenue: t.revenue, expense: t.expense, profit: t.profit })))
      return
    }
    startTrendTransition(async () => {
      const result = await getTrendData(trendRange, targetMonth)
      setTrendPoints(result)
    })
  }, [trendRange, targetMonth]) // eslint-disable-line react-hooks/exhaustive-deps

  const isAreaRange = trendRange === 'daily' || trendRange === 'weekly'
  // 만원 단위로 사전 변환 — tickFormatter에서 /10000 재연산 불필요
  const chartData = trendPoints.map(t => ({
    label: t.label,
    revenue: Math.round(t.revenue / 10000),
    expense: Math.round(t.expense / 10000),
  }))
  // 색은 그 달 금액 순위가 아니라 영업장 설정의 등록 순서가 정한다(lib/chartColors 정본).
  // 순위로 칠하던 시절엔 같은 임대료가 7월 카멜·8월 테라코타여서 두 달을 나란히 못 봤다.
  const categoryColor = (category: string) => expenseCategoryColor(category, data.expenseCategoryOrder)
  // 아직 안 낸 고정 지출은 **같은 색을 옅게** 잇는다. 별도 조각으로 떼어내지 않는다 —
  // 떼면 한 카테고리가 링 위에서 두 항목처럼 읽히고, 범례도 두 줄이 된다.
  // 옅은 꼬리는 같은 카테고리 조각의 연장이고, 진한 부분이 이미 장부에 오른 몫이다.
  // 대비 실측(라이트 크림 #fbf6ef): 원색 2.22~8.64 대 70% 1.71~4.13, ΔE76 11.3~25.1 로
  // 두 부분이 눈으로 갈린다. 다크(#1A130E)는 1.98~7.68 대 1.55~4.38, ΔE 11.8~19.1.
  const pendingTint = (color: string) => `color-mix(in srgb, ${color} 70%, transparent)`
  // 조각 순서 = 범례 순서 = 금액 큰 것부터(서버 정렬). 기록분 바로 뒤에 그 카테고리의 예정분이 붙는다.
  const categorySegments = data.categoryBreakdown.flatMap(c => {
    const base = categoryColor(c.category)
    return [
      { value: c.recorded, color: base,              id: c.category },
      { value: c.pending,  color: pendingTint(base), id: c.category },
    ]
  })
  // 조각·범례를 누르면 그 카테고리가 무엇으로 이루어졌는지 카드 안에서 바로 펼친다.
  // 같은 것을 다시 누르면 접는다 — 목록이 열린 채로 남아 카드 높이를 붙잡지 않게.
  const [openCategory, setOpenCategory] = useState<string | null>(null)
  const openCat = data.categoryBreakdown.find(c => c.category === openCategory) ?? null

  // ── 등식 문장 — 상단 KPI 카드·수납 관리와 같은 정본(MoneyEquation)이 만든다 ──────
  // 뜨고 사라지는 달도 세 화면이 같아야 한다(hasRevenueBridge · isFutureMonth 같은 술어).
  const showBridge = !data.isFutureMonth && hasRevenueBridge({
    reserved: data.reservedExpected, checkedOut: data.checkedOutRecognized, extra: data.extraRevenue,
  })
  const revenueTerms = expectedRevenueTerms({
    billed: data.billedThisMonth, reserved: data.reservedExpected,
    checkedOut: data.checkedOutRecognized, extra: data.extraRevenue,
  })
  // 첫 항은 서버가 보낸 값이다 — 화면이 paidRevenue 에서 퇴실 항을 빼서 되계산하면
  // 그 순간 캡션이 자기 식을 갖는다(billedThisMonth 를 따로 싣는 것과 같은 이유).
  const paidTerms = paidRevenueTerms({
    collected: data.collectedThisMonth, checkedOut: data.checkedOutRecognized, extra: data.extraRevenue,
  })
  // v2.0 §24 — 결제상태 차트는 개념색(완납=success·예정=info·미납=warning)
  // 세 항은 서버가 한 모집단을 배타 분할해 보낸 값이다(page.tsx paymentStatusPool). 여기서
  // 다시 나누지 않는다 — 수납률 분모를 화면이 조립하던 시절엔 같은 화면이 두 비율을 말했다.
  const paymentSegments = [
    { value: data.paidCount,     color: CONCEPT_COLORS.paid },
    { value: data.awaitingCount, color: CONCEPT_COLORS.await },
    { value: data.unpaidCount,   color: CONCEPT_COLORS.unpaid },
  ]

  return (
    <div className="space-y-5">
      {/* ── 세부 재무 요약 ── 모바일 2칸·태블릿 3칸·데스크탑 5칸 (긴 금액이 칸 넘어가지 않게) */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--warm-border)' }}>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          style={{ borderColor: 'var(--warm-border)', background: 'var(--cream)' }}
        >
          {([
            // 색은 전부 §19 페어 토큰이다. --tc·--coral 은 다크에서 안 밝아져 크림 카드(--d-card)
            // 위에서 2.78:1 로 주저앉는다 — 라이트에서는 세 토큰이 모두 #A03C2E 라 픽셀이 안 바뀌고,
            // 다크에서만 --tc-text(#C9614C 4.63:1) · --danger-fg(#E08A75 7.05:1) 로 갈라진다.
            // 바로 아래 '지출과 이익' 카드가 이미 같은 근거로 --danger-fg 를 쓰고 있었다.
            // '수납액 (귀속)' → '이용료 수납 (귀속)' (운영자 확정 2026-08-13). 바로 옆 칸이 '부가수익'인데
            // '수납액'은 둘을 합친 말로 읽혀, 두 칸의 합이 세 번째 어딘가에 있는 것처럼 보였다.
            // 이 값(paidRevenue)은 이용료 축만이고, 둘을 더한 값의 이름은 '실수납'이다(KPI 보조줄).
            { label: '이용료 수납 (귀속)', value: data.paidRevenue,  color: 'var(--tc-text)' },
            { label: '부가수익', value: data.extraRevenue, color: 'var(--viz-4)' },
            // '지출' → '기록된 지출' (2026-08-12 용어 통일). 바로 아래 예상 운영이익 등식이 빼는
            // 항과 **같은 변수**(totalExpense)인데 이름이 둘이었다. 같은 모집단은 같은 이름이다.
            { label: '기록된 지출', value: data.totalExpense, color: 'var(--tc-text)' },
            { label: '운영이익', value: data.netProfit,    color: data.netProfit >= 0 ? 'var(--success)' : 'var(--danger-fg)' },
            // 보유 보증금 = 계약 기준 총액(유지). 아래 분해로 받은 보증금/미기록(전 원장) 표시.
            //
            // 어휘 두 건을 고쳤다(2026-08-12 운영자 점검).
            //   '실수납' → '받은 보증금' — '실수납'은 수납 관리 캡션이 이용료+부가수익 축 합계
            //     (paidRevenue + extraRevenue)에 쓰는 이름이다. 같은 이름이 홈 안에서 탭만 바꾸면
            //     보증금 숫자로 바뀌던 자리다. 새 말이 아니라 depositCompositionLabel 이 이미 쓰는
            //     '받은 보증금 30,000 + 청소비 20,000 / 계약 50,000' 의 그 말이다.
            //   '청소비 몫'은 **계약 축**이다(운영자 확정 2026-08-12) — 받은 보증금 안에서 계약상
            //     청소비로 잡혀 있어 퇴실 때 반환되지 않을 몫(heldContractCleaningPortion 정본).
            //     수납 기록 축(청소비 명목 수납이 채운 몫)은 김민정형 역산 예외에서만 값이 서서
            //     "청소비 포함 보증금이 몇 명분이냐"는 정책 심상과 어긋났다(운영자 질의 2건).
            //     받은 보증금의 부분집합이라 '이 중'으로 묶는다 — 항등은 받은 + 미기록 = 총액.
            //
            // 2026-08-13 운영자 확정: 이 개념의 이름은 '보증금 안의 청소비'다. '청소비 몫'은
            //   무엇 안의 몫인지가 빠져 청소비 수익 총액으로 읽혔다. 다만 바로 앞 항이 이미
            //   '받은 보증금'이라고 말한 이 자리에서는 '이 중 청소비'로 줄인다 — '이 중'이 곧
            //   '보증금 안의'라서, 안 줄이면 한 줄에서 같은 말을 두 번 하게 된다.
            { label: '보유 보증금', value: data.totalDeposit, color: 'var(--ink)',
              sub: `받은 보증금 ${fmtKorMoney(data.depositReceived)}${data.depositByCleaning > 0 ? ` · 이 중 청소비 ${fmtKorMoney(data.depositByCleaning)}` : ''} · 미기록 ${fmtKorMoney(data.depositUnrecorded)}`,
              hint: (
                <InfoHint title="보유 보증금">
                  <p>계약서에 적힌 보증금 총액입니다. 아래 줄이 그 총액을 둘로 가릅니다.</p>
                  <p className="mt-2"><b>받은 보증금</b>은 실제로 입금받아 기록이 남은 몫이고, <b>미기록</b>은 계약서에만 있는 몫입니다(전 원장에게 승계받아 현금이 오간 적 없는 계약 등). 두 값을 더하면 보유 보증금이 됩니다.</p>
                  <p className="mt-2"><b>이 중 청소비</b>는 받은 보증금 안에 들어 있는 <b>보증금 안의 청소비</b>입니다. 청소비를 따로 받지 않고 보증금에 포함해 받는 영업장 설정에서, 계약서상 청소비로 잡혀 퇴실 때 반환하지 않을 몫입니다. 받은 보증금과 나란히 더하는 항이 아니라 그 일부입니다.</p>
                  <p className="mt-2">입실 때 청소비를 따로 받은 계약은 여기 잡히지 않습니다. 그 돈은 이미 부가수익으로 인식됩니다.</p>
                </InfoHint>
              ) },
          ] as { label: string; value: number; color: string; sub?: string; hint?: ReactNode }[]).map((item, i) => (
            <div
              key={i}
              className="px-3 py-3 text-center min-w-0"
              style={{ borderRight: '1px solid var(--warm-border)', borderBottom: '1px solid var(--warm-border)' }}
            >
              {/* 설명 버튼은 truncate 밖에 둔다 — 안에 두면 좁은 칸에서 라벨과 함께 잘려 사라진다. */}
              <p className="text-[10.5px] font-medium mb-1 flex items-center justify-center min-w-0" style={{ color: 'var(--warm-muted)' }}>
                <span className="truncate">{item.label}</span>{item.hint}
              </p>
              <p className="text-[13px] font-bold leading-tight break-all" style={{ color: item.color }}>
                <MoneyDisplay amount={Math.abs(item.value)} prefix={item.value < 0 ? '-' : ''} />
              </p>
              {item.sub && (
                <p className="text-[0.65625rem] mt-0.5 leading-tight" style={{ color: 'var(--warm-muted)' }}>{item.sub}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 분해 두 장 ── 홈 카드는 요약, 재무 탭은 전모다(운영자 2026-08-12
          "이곳이야말로 매출·이익·지출 등 모든 내용이 다 보여도 괜찮은 위치").
          여기 서는 값은 **전부 서버가 이미 보내던 정본 필드**다 — 화면이 새 집계를 만들지 않는다.
          위 요약 타일·상단 KPI 카드와 겹치는 숫자는 총계뿐이고, 새로 서는 것은 그 총계를 이루는
          항들(청구·예약 확정·퇴실 귀속·부가수익 / 기록된 지출·고정 지출 (예정) / 도래·미도래)이다.
          항 이름은 MoneyEquation 정본·수납 관리·지출 관리가 쓰는 말 그대로다(같은 이름 같은 숫자). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 수입과 미수 */}
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>수입과 미수</h3>
          {/* 0인 항은 세우지 않는다 — MoneyEquation 이 등식에서 0 항을 빼는 규칙과 같다.
              '이 달 청구액'만 값과 무관하게 선다(그 달 청구가 0원이어도 사실이다). */}
          <div className="space-y-2.5">
            <Row label="이 달 청구액" value={<MoneyDisplay amount={data.billedThisMonth} />} />
            {data.reservedExpected !== 0 && (
              <Row label="예약 확정" value={<MoneyDisplay amount={data.reservedExpected} />} />
            )}
            {data.checkedOutRecognized !== 0 && (
              <Row label="퇴실 귀속" value={<MoneyDisplay amount={data.checkedOutRecognized} />} />
            )}
            {data.extraRevenue !== 0 && (
              <Row label="부가수익" value={<MoneyDisplay amount={data.extraRevenue} />} />
            )}
          </div>
          {/* 위 항들의 합이 예상 수입이고, 그중 실제로 받은 몫이 실수납이다.
              두 이름 다 상단 KPI 카드가 쓰는 말이라 여기서 새로 짓지 않는다. */}
          {/* 등식 두 줄 — 상단 KPI 카드·수납 관리 캡션과 **같은 정본 문장**이다(MoneyEquation).
              위 목록과 같은 항을 다시 적는 것처럼 보일 수 있으나, 목록은 세로로 늘어선 값이고
              등식은 다른 화면에서 눈으로 대조할 한 줄이다 — 세 화면이 글자까지 같은 문장을 써야
              같은 숫자에 다른 설명이 붙지 않는다(2026-07/08 신뢰 사고 세 건의 형태). */}
          <div className="mt-2.5 pt-2.5 space-y-2.5" style={{ borderTop: '1px solid var(--warm-border)' }}>
            <div>
              <Row label="예상 수입" value={<MoneyDisplay amount={data.projectedRevenue} />} />
              {showBridge && <EqCaption terms={revenueTerms} />}
            </div>
            <div>
              <Row label="실수납" value={<MoneyDisplay amount={data.totalRevenue} />} colorStyle={{ color: 'var(--success-fg)' }} />
              {showBridge && <EqCaption terms={paidTerms} />}
            </div>
            {/* 예상 수입 중 아직 안 들어온 몫 — 서버가 pendingRevenue 로 보내고 있었는데 화면에
                서는 자리가 없었다. 아래 '누적 미납'은 납부일이 지난 누적 축이라 다른 값이다.
                한정어 '이 달'로 두 축을 가른다. 미래월은 아직 받을 때가 아니라 말하지 않는다
                (수납 관리가 미래월에 수납·달성률을 말하지 않기로 한 판례와 같은 결). */}
            {!data.isFutureMonth && (
              <div>
                <Row label="이 달 미수납" value={<MoneyDisplay amount={data.pendingRevenue} />} />
                {/* 서버가 음수를 0으로 눌러 보내므로(초과 수납), 눌린 달에는 등식을 적지 않는다 —
                    적으면 좌변 0에 음수 우변이 붙어 캡션 자체가 거짓말이 된다. */}
                {data.projectedRevenue >= data.totalRevenue && (
                  <EqCaption terms={[
                    { label: '예상 수입', amount: data.projectedRevenue, op: '+' },
                    { label: '실수납',   amount: data.totalRevenue,     op: '−' },
                  ]} />
                )}
              </div>
            )}
          </div>
          {/* 미수 — 상단 KPI 는 도래분(누적 미납)만 말한다. 아직 납부일이 안 온 몫이 얼마인지는
              홈 어디에도 없어서 '미납 0원'이 '받을 돈이 없다'로 읽혔다. 두 항과 합을 함께 세운다.
              모집단 한정어(현 입주자)는 KPI 카드 라벨과 같은 말로 소제목에 둔다 — 퇴실자 잔여 채권은
              여기 없고 결산 보고서 월말 미수 잔액이 그 자리다. */}
          <div className="mt-3 pt-3 space-y-2.5" style={{ borderTop: '1px solid var(--warm-border)' }}>
            <p className="text-xs font-medium" style={{ color: 'var(--warm-muted)' }}>
              미수 (현 입주자)
              <InfoHint title="미수 (현 입주자)">
                <p>아직 받지 못한 돈을 <b>납부일이 지났는지</b>로 가른 것입니다. 두 항의 합이 아래 합계입니다.</p>
                <p className="mt-2"><b>누적 미납</b>은 납부일이 이미 지났는데 안 들어온 돈입니다. 지난달 이전에 밀린 이월분도 여기 들어갑니다. 회수가 필요한 금액입니다.</p>
                <p className="mt-2"><b>납부 예정</b>은 납부일이 아직 오지 않은 정상 청구분입니다. 밀린 돈이 아니라 곧 들어올 돈입니다.</p>
                <p className="mt-2">누적 미납 아래에는 그 돈이 <b>어느 달 몫</b>인지 갈라 적습니다. 한 계약이 여러 달 밀려 있으면 그 달마다 한 번씩 서기 때문에, 월별 건수를 더한 값은 위 <b>누적 미납 N건</b>(계약 수)보다 클 수 있습니다.</p>
                <p className="mt-2">납부일이 아직 안 온 몫은 그 목록에 없습니다. 납부 예정에 있습니다.</p>
                <p className="mt-2">모집단은 현재 입주자(거주·비거주)입니다. 퇴실한 분의 남은 미납은 여기 없고, 전체 채권은 결산 보고서의 월말 미수 잔액에서 보실 수 있습니다.</p>
              </InfoHint>
            </p>
            {/* 색은 바로 아래 수납 현황 도넛 범례와 같은 개념색이다 — 같은 화면에서 '미납'과
                '수납예정'이 건수로 서 있고 여기서는 같은 개념이 금액으로 선다.
                --tc 를 쓰지 않는다: 다크에서 안 밝아져 크림 카드 위 대비가 2.78:1 로 떨어진다
                (§19 페어 토큰 --overdue-fg·--danger-fg 계열이 그 자리를 위해 있다). */}
            <Row label="누적 미납" value={<MoneyDisplay amount={data.overdueAmount} />}
              colorStyle={data.overdueAmount > 0 ? { color: CONCEPT_COLORS.unpaid } : undefined} />
            {/* 그 돈이 어느 달 몫인지 — 새 값이 아니라 바로 위 '누적 미납'을 귀속월로 가른 것이다.
                총계와 그 항이 다른 카드에 있으면 이 탭이 명문화한 원칙(총계를 이루는 항을 그 자리에
                세운다)이 깨진다. 규격은 형제 '지출 카테고리' 드릴다운 목록 그대로다. */}
            <AgingList buckets={data.agingBuckets} targetMonth={targetMonth} />
            <Row label="납부 예정" value={<MoneyDisplay amount={data.upcomingAmount} />}
              colorStyle={{ color: CONCEPT_COLORS.await }} />
            <Row label="합계" value={<MoneyDisplay amount={data.unpaidAmount} />} />
          </div>
        </div>

        {/* 지출과 이익 */}
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>지출과 이익</h3>
          {(() => {
            // 상단 KPI 예상 지출 등식이 더하는 **그 두 항**이다. 둘째 항은 추정치가 아니라
            // 실제로 더해진 금액(expectedExpense − totalExpense)이라 과거월엔 저절로 0이 되어 사라진다
            // (MoneyEquation 의 pendingRecurring 규칙과 같은 값·같은 이름).
            const pendingRecurring = data.expectedExpense - data.totalExpense
            // 음수는 --danger-fg 다. 요약 타일은 --tc 를 쓰는데 라이트에서는 같은 #A03C2E 라 픽셀이 같고,
            // 다크에서만 갈린다 — --tc 는 안 밝아져 크림 카드 위에서 2.78:1 이고 --danger-fg 는 §19 페어라 밝아진다.
            const profitColor = (n: number) => ({ color: n >= 0 ? 'var(--success)' : 'var(--danger-fg)' })
            return (
              <>
                <div className="space-y-2.5">
                  <Row label="기록된 지출" value={<MoneyDisplay amount={data.totalExpense} />} />
                  {pendingRecurring !== 0 && (
                    <Row label="고정 지출 (예정)" value={<MoneyDisplay amount={pendingRecurring} />} />
                  )}
                </div>
                <div className="mt-2.5 pt-2.5 space-y-2.5" style={{ borderTop: '1px solid var(--warm-border)' }}>
                  <Row label="예상 지출" value={<MoneyDisplay amount={data.expectedExpense} />} />
                  {!data.isFutureMonth && pendingRecurring !== 0 && (
                    <EqCaption terms={expectedExpenseTerms({ recordedExpense: data.totalExpense, pendingRecurring })} />
                  )}
                </div>
                {/* 이익 두 줄 — 왼쪽 카드의 실수납에서 기록된 지출을 뺀 것이 운영이익,
                    예상 수입에서 예상 지출을 뺀 것이 예상 운영이익이다. 색은 요약 타일 운영이익과 같다. */}
                <div className="mt-3 pt-3 space-y-2.5" style={{ borderTop: '1px solid var(--warm-border)' }}>
                  <p className="text-xs font-medium" style={{ color: 'var(--warm-muted)' }}>이익</p>
                  {/* 음수는 fmtKorMoney 가 §06 대로 U+2212 을 붙인다 — 위 타일처럼 abs + '-' 로
                      쪼개면 하이픈이 붙어 §06 을 벗어난다(타일 쪽은 기존 결함으로 별건 보고). */}
                  <Row label="운영이익" value={<MoneyDisplay amount={data.netProfit} />}
                    colorStyle={profitColor(data.netProfit)} />
                  {/* 운영이익에서 이 달 매출로 적립한 예비비를 빼야 실제로 굴릴 수 있는 돈이 나온다.
                      서버가 operatingCashAvailable 로 보내고 있었는데 화면 어디에도 서지 않아,
                      예비비를 뗀 달에도 '운영이익 = 쓸 수 있는 돈'으로 읽혔다.
                      적립이 없는 달에는 두 값이 같으므로 줄을 세우지 않는다(좌변 되풀이). */}
                  {data.reserveAccrualFromThisMonth > 0 && (
                    <div>
                      <Row label="운영 가용 자금" value={<MoneyDisplay amount={data.operatingCashAvailable} />}
                        colorStyle={profitColor(data.operatingCashAvailable)} />
                      <EqCaption terms={[
                        { label: '운영이익',        amount: data.netProfit,                  op: '+' },
                        { label: '이 달 예비비 적립', amount: data.reserveAccrualFromThisMonth, op: '−' },
                      ]} />
                    </div>
                  )}
                  <div>
                    <Row label="예상 운영이익" value={<MoneyDisplay amount={data.projectedNetProfit} />}
                      colorStyle={profitColor(data.projectedNetProfit)} />
                    {!data.isFutureMonth && (
                      <EqCaption terms={operatingProfitTerms({
                        projectedRevenue: data.projectedRevenue,
                        recordedExpense:  data.totalExpense,
                        pendingRecurring,
                      })} />
                    )}
                  </div>
                </div>
              </>
            )
          })()}
        </div>
      </div>

      {/* ── 추이 ── */}
      <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-mid)' }}>추이</h3>
            <span className="rounded-full text-[0.65625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{isAreaRange ? '납부일 기준' : '귀속월 기준'}</span>
          </div>
          {/* 막대 모드의 수입은 KPI '실수납'과 같은 정본(getPaidRevenueByMonths)이라 이름도 같게 부른다.
              면적 모드(일간·주간)는 납부일 축이라 캡이라는 개념이 없다 — 거기서 '실수납'이라 부르면
              그때 거짓이 되므로 종전 이름을 그대로 둔다. 배지가 이미 같은 조건으로 갈린다.
              지출은 KPI 타일·도넛과 같은 변수라 '기록된 지출'이다(2026-08-12 어휘 통일에서 지나친 자리). */}
          <div className="flex gap-4 text-xs" style={{ color: 'var(--warm-muted)' }}>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--coral)' }} />{isAreaRange ? '수입 (수납 기준)' : '실수납'}</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--ink-m)' }} />{isAreaRange ? '지출' : '기록된 지출'}</span>
          </div>
        </div>
        <div className="flex gap-1 mb-4 flex-wrap">
          {TREND_RANGES.map(r => (
            <button key={r.key} onClick={() => setTrendRange(r.key)} disabled={trendPending}
              className="px-2.5 py-1 text-xs rounded-lg transition-colors font-medium disabled:opacity-50"
              style={trendRange === r.key
                ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                : { background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
              {r.label}
            </button>
          ))}
        </div>
        {trendPending ? (
          <div className="h-44 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <TrendChart mode={isAreaRange ? 'area' : 'bar'} data={chartData} />
        )}
      </div>

      {/* ── 방 속성별 이용료 ── 카드 전폭이다. 반폭 카드가 지금 넷(짝수)이라 한 장을 더하면 2열
          격자에 빈 칸이 생기고, 3열은 1024px 에서 열 폭이 236px 이라 형제 카드의 도넛(140px)이
          성립하지 않는다. 세그먼트 목록은 도넛이 없어 전폭에서 빈 곳이 안 생긴다.
          자리는 시간축(추이) 다음, 구성 분해(지출 카테고리·수납 현황)의 첫 자리다 — 이 카드가
          나누는 것은 수입이고, 형제 두 장이 지출과 건수를 나눈다. */}
      <RoomSegmentCard data={data} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>
            지출 카테고리
            <InfoHint title="지출 카테고리">
              <p>이 달 <b>예상 지출</b>을 카테고리로 나눈 것입니다. 가운데 숫자가 그 합이고, 위 &apos;지출과 이익&apos;의 예상 지출과 같은 값입니다.</p>
              <p className="mt-2">조각의 <b>옅은 부분</b>은 아직 장부에 안 올라간 <b>고정 지출 (예정)</b>입니다. 임대료처럼 낼 것이 정해진 돈이라, 빼고 보면 이 달 지출 그림이 실제보다 작아집니다. 범례에 &apos;기록 · 예정&apos;으로 금액을 나눠 적었습니다.</p>
              <p className="mt-2">지난 달을 조회하면 예정분은 사라집니다. 그 달에는 추정치를 더하지 않기 때문입니다.</p>
              <p className="mt-2">조각이나 범례를 누르면 금액 큰 순으로 다섯 건까지 펼쳐집니다. 전체는 &apos;지출 관리에서 전체 보기&apos;로 이어집니다.</p>
            </InfoHint>
          </h3>
          {data.categoryBreakdown.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--warm-muted)' }}>이달 지출 없음</p>
          ) : (
            /* 좁은 폭에서는 도넛 아래로 범례를 내린다 — 320px 에서 옆 칸은 88px 밖에 안 되는데
               금액은 안 줄어들어 카테고리 이름이 세로로 압착된다(형제 '수납 현황' 카드가 같은 이유로
               금액 줄을 전폭으로 내린 그 문법). 넓은 화면에서는 종전처럼 도넛 옆에 선다. */
            <div className="flex flex-col sm:flex-row items-center gap-4 sm:gap-5">
              <div className="shrink-0">
                {/* 중앙은 도넛이 실제로 나눈 그 값이다 — 조각 합 = 기록된 지출 + 고정 지출 (예정) = 예상 지출.
                    기록분만 세던 시절에는 중앙이 '기록된 지출'이었고, 아직 안 낸 임대료가 통째로 빠져
                    8월 도넛이 청소용역비를 두 번째로 큰 지출로 그렸다(실제 46% 는 임대료). */}
                <DonutChart segments={categorySegments} centerLabel={`${data.expectedExpense > 0 ? Math.round(data.expectedExpense / 10000) : 0}만`} centerSub="예상 지출"
                  onSelect={cat => setOpenCategory(prev => prev === cat ? null : cat)} />
              </div>
              <div className="w-full sm:flex-1 space-y-1 min-w-0">
                {data.categoryBreakdown.map((c, i) => {
                  const on = openCategory === c.category
                  return (
                  /* 범례 한 줄이 곧 진입점이다 — 도넛 조각은 마우스 편의고, 키보드·보조기술은
                     이 버튼으로 같은 곳에 닿는다(§25 목록 항목 문법, 버튼 크롬 없음). */
                  <button key={i} type="button" aria-expanded={on}
                    onClick={() => setOpenCategory(prev => prev === c.category ? null : c.category)}
                    className="w-full text-left min-w-0 rounded-md px-1.5 py-1 -mx-1.5 transition-colors hover:bg-[var(--canvas)]"
                    style={on ? { background: 'var(--canvas)' } : undefined}>
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: categoryColor(c.category) }} />
                      <span className="text-xs truncate flex-1" style={{ color: 'var(--warm-mid)' }}>{c.category}</span>
                      {/* 금액 병기 — 퍼센트만 있던 시절엔 '12%'가 얼마인지 알려면 화면을 옮겨야 했다. */}
                      <span className="text-xs shrink-0 num" style={{ color: 'var(--warm-dark)' }}>{fmtKorMoney(c.amount)}</span>
                      <span className="text-xs shrink-0 w-9 text-right" style={{ color: 'var(--warm-muted)' }}>{c.percent}%</span>
                    </span>
                    {/* 옅은 꼬리가 무엇인지 글자로도 말한다. 두 몫이 다 있을 때만 나눠 적고,
                        통째로 예정인 카테고리는 '예정' 한 마디면 된다(그 조각은 전부 옅다). */}
                    {c.pending > 0 && (
                      <span className="block text-[0.65625rem] pl-[18px] leading-tight" style={{ color: 'var(--warm-muted)' }}>
                        {c.recorded > 0 ? `기록 ${fmtKorMoney(c.recorded)} · 예정 ${fmtKorMoney(c.pending)}` : '예정'}
                      </span>
                    )}
                  </button>
                  )
                })}
              </div>
            </div>
          )}
          {/* ── 드릴다운 ── 카드 전폭이다. 도넛 옆 칸에 끼우면 320px 에서 날짜·금액이 겹친다.
              목록은 서버가 실어 보낸 상위 5건이라 여는 데 왕복이 없다. */}
          {openCat && (
            <div className="mt-4 pt-3 space-y-1.5" style={{ borderTop: '1px solid var(--warm-border)' }}>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: categoryColor(openCat.category) }} />
                <p className="text-xs font-semibold flex-1 truncate" style={{ color: 'var(--warm-dark)' }}>{openCat.category}</p>
                <p className="text-xs num shrink-0" style={{ color: 'var(--warm-dark)' }}>{fmtWon(openCat.amount)}</p>
              </div>
              {openCat.top.map((r, i) => (
                <div key={i} className="flex items-baseline gap-2 text-[0.6875rem] min-w-0">
                  <span className="shrink-0 num" style={{ color: 'var(--warm-muted)' }}>{fmtDateDot(r.date)}</span>
                  <span className="truncate flex-1" style={{ color: 'var(--warm-mid)' }}>{r.label || '내역 없음'}</span>
                  <span className="shrink-0 num" style={{ color: 'var(--warm-dark)' }}>{fmtWon(r.amount)}</span>
                </div>
              ))}
              {openCat.recordedCount > openCat.top.length && (
                <p className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>
                  그 밖 {openCat.recordedCount - openCat.top.length}건
                </p>
              )}
              {/* 아직 안 낸 고정 지출은 장부에 없는 줄이라 기록분과 섞지 않는다 — 별도 줄로 세운다. */}
              {openCat.pendingItems.map((r, i) => (
                <div key={`p${i}`} className="flex items-baseline gap-2 text-[0.6875rem] min-w-0">
                  <span className="shrink-0" style={{ color: 'var(--warm-muted)' }}>예정</span>
                  <span className="truncate flex-1" style={{ color: 'var(--warm-mid)' }}>{r.title}</span>
                  <span className="shrink-0 num" style={{ color: 'var(--warm-mid)' }}>{fmtWon(r.amount)}</span>
                </div>
              ))}
              {/* 색은 --coral 이 아니라 §19 페어 토큰 --tc-text 다. 라이트에서는 같은 #A03C2E 라
                  픽셀이 안 바뀌고, 다크에서만 갈린다 — --coral 은 안 밝아져 크림 카드 위에서 2.78:1 로
                  주저앉고 --tc-text 는 4.63:1 이다(형제 '전체 보기 ›' 링크들은 아직 --coral, 별건 보고). */}
              <Link href={`/finance?tab=expense&month=${targetMonth}&cat=${encodeURIComponent(openCat.category)}`}
                className="inline-block pt-1 text-[0.6875rem]" style={{ color: 'var(--tc-text)' }}>
                지출 관리에서 전체 보기 ›
              </Link>
            </div>
          )}
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>
            수납 현황
            <InfoHint title="수납률">
              <p>가운데 <b>수납률</b>은 현재 입주자 계약 중 완납한 계약의 비율입니다. 금액이 아니라 <b>건수</b> 비율입니다.</p>
              <p className="mt-2">분모는 아래 세 항의 합입니다. 완납 · 수납예정 · 미납이 한 계약을 한 번씩만 세도록 나눈 것이라, 셋을 더하면 정확히 모집단이 됩니다.</p>
              <p className="mt-2">미납은 납부일이 지난 미회수가 하나라도 있는 계약(이월 미수 포함), 수납예정은 납부일이 아직 안 온 몫만 남은 계약, 완납은 나머지입니다.</p>
              <p className="mt-2">아래 이용료 수납 (귀속)은 같은 사람 집합이 아닙니다. 그 금액에는 퇴실한 분의 이 달 몫이 들어 있습니다.</p>
            </InfoHint>
          </h3>
          <div className="flex items-center gap-5">
            <div className="shrink-0">
              <DonutChart segments={paymentSegments} centerLabel={`${data.paymentRate}%`} centerSub="수납률" />
            </div>
            <div className="flex-1 space-y-3">
              {/* 건수 3항의 모집단은 현 입주자(거주·비거주)다. 바로 아래 수납액에는 퇴실 계약의
                  그 달 귀속분이 들어 있어 두 숫자가 같은 사람 집합이 아니다(2026-06 퇴실 귀속 381만·10건).
                  한정어는 새 말이 아니라 KPI '누적 미납 (현 입주자)'·형제 카드 '미수 (현 입주자)'가
                  이미 쓰는 그 말이고, 그 KPI 의 모집단이 여기 세 항과 같은 집합이다. */}
              <p className="text-xs font-medium" style={{ color: 'var(--warm-muted)' }}>건수 (현 입주자)</p>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONCEPT_COLORS.paid }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>완납</span>
                <span className="text-sm font-semibold" style={{ color: CONCEPT_COLORS.paid }}>{data.paidCount}건</span>
              </div>
              {data.awaitingCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONCEPT_COLORS.await }} />
                  <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>수납예정</span>
                  <span className="text-sm font-semibold" style={{ color: CONCEPT_COLORS.await }}>{data.awaitingCount}건</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONCEPT_COLORS.unpaid }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>미납</span>
                <span className="text-sm font-semibold" style={{ color: CONCEPT_COLORS.unpaid }}>{data.unpaidCount}건</span>
              </div>
            </div>
          </div>
          {/* 금액 줄은 도넛 옆 칸이 아니라 카드 전폭이다. 오른쪽 칸은 320px 에서 88px 밖에 안 되는데
              금액(whitespace-nowrap)이 안 줄어드니 라벨만 23px 로 압착돼 일곱 줄로 접혔다.
              전폭으로 내리면 어느 폭에서든 라벨이 100px 한 줄이다(실측 320px 371→267px).
              자리를 가르는 것이 뜻에도 맞다 — 위 세 항은 현 입주자 모집단이고 이 금액에는 퇴실
              계약의 그 달 귀속분이 들어 있어 같은 사람 집합이 아니다. 같은 칸에 이어 붙이면
              넷째 항처럼 읽힌다. */}
          <div className="mt-4 pt-3 space-y-2.5" style={{ borderTop: '1px solid var(--warm-border)' }}>
            {/* 위 요약 타일과 **같은 변수**(paidRevenue)라 이름도 같다 — '수납액'은 부가수익까지
                합친 말로 읽혀 옆 칸과 겹쳤다(운영자 확정 2026-08-13). 두 축을 더한 값의 이름은 '실수납'이다.
                달 한정어는 뺀다 — 이 탭이 이미 조회월 스코프이고 타일도 같은 달을 말한다. */}
            <Row label="이용료 수납 (귀속)" value={<MoneyDisplay amount={data.paidRevenue} />} />
            {/* 그 수납이 얼마 중의 얼마인지 — 위 세 항은 건수 비율(수납률)을 갖는데 금액 줄에는
                견줄 상대가 없었다. 서버가 totalExpected 로 보내던 값이 그 상대다(같은 이용료 축·
                같은 귀속 축, 부가수익 제외). 화면에 처음 서는 값이고 새 집계가 아니다. */}
            <Row label="이용료 예상 (귀속)" value={<MoneyDisplay amount={data.totalExpected} />} />
            <EqCaption terms={[
              { label: '이 달 청구액', amount: data.billedThisMonth,      op: '+' },
              ...(data.reservedExpected     !== 0 ? [{ label: '예약 확정', amount: data.reservedExpected,     op: '+' as const }] : []),
              ...(data.checkedOutRecognized !== 0 ? [{ label: '퇴실 귀속', amount: data.checkedOutRecognized, op: '+' as const }] : []),
            ]} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 입주자 탭 ───────────────────────────────────────────────────

function TenantsTab({ data }: { data: DashboardData }) {
  // 입주율 분모 = 전체 − 집계 제외(창고·사무실) — 거주중%+공실%=100 유지(신고 9d844226)
  const countedRooms = data.totalRooms - data.excludedRooms
  const occupancyRate = countedRooms > 0 ? Math.round((data.occupiedRooms / countedRooms) * 100) : 0
  const statusTotal = data.statusCounts.active + data.statusCounts.reserved + data.statusCounts.checkout + data.statusCounts.nonResident
  const occupancySegments = [{ value: data.occupiedRooms, color: 'var(--persimmon)' }, { value: data.vacantRooms, color: 'var(--cream-3)' }]
  const statusSegments = [
    { value: data.statusCounts.active,      color: STATUS_COLORS.active },
    { value: data.statusCounts.reserved,    color: STATUS_COLORS.reserved },
    { value: data.statusCounts.checkout,    color: STATUS_COLORS.checkout },
    { value: data.statusCounts.nonResident, color: STATUS_COLORS.nonResident },
  ]
  const genderSegments = data.genderDist.map(d => ({ value: d.count, color: GENDER_COLORS[d.label] ?? 'var(--ink-m)' }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label={`전체 입주자 (현재 계약 기준)`} value={`${data.totalTenants}명`} sub="" />
        <StatCard label="거주중"    value={`${data.statusCounts.active}명`}      sub=""  colorStyle={{ color: STATUS_COLORS.active }} />
        <StatCard label="입실 예약" value={`${data.statusCounts.reserved}명`}    sub=""  colorStyle={{ color: STATUS_COLORS.reserved }} />
        <StatCard label="퇴실 예정" value={`${data.statusCounts.checkout}명`}    sub=""  colorStyle={{ color: STATUS_COLORS.checkout }} />
        <StatCard label="비거주자"  value={`${data.statusCounts.nonResident}명`} sub=""  colorStyle={{ color: STATUS_COLORS.nonResident }} />
        {/* WAITING_TOUR 전체 카운트 — 투어일 없는 '문의'도 포함하므로 '문의·투어'(e1b81629) */}
        <StatCard label="문의·투어" value={`${data.statusCounts.waitingTour}명`} sub=""  colorStyle={{ color: 'var(--ink)' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>호실 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={occupancySegments} centerLabel={`${occupancyRate}%`} centerSub="입주율" />
            <div className="space-y-2.5 flex-1">
              {[
                { label: '거주중', val: `${data.occupiedRooms}실`, pct: occupancyRate, dot: 'var(--persimmon)' },
                { label: '공실', val: `${data.vacantRooms}실`, pct: countedRooms > 0 ? Math.round((data.vacantRooms / countedRooms) * 100) : 0, dot: 'var(--cream-3)' },
                ...(data.excludedRooms > 0 ? [{ label: '집계 제외', val: `${data.excludedRooms}실`, pct: null as number | null, dot: '' }] : []),
                { label: '전체', val: `${data.totalRooms}실`, pct: null, dot: '' },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  {r.dot ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.dot }} /> : <span className="w-2 h-2 shrink-0" />}
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{r.label}</span>
                  <span className="text-xs" style={{ color: 'var(--warm-dark)' }}>
                    <span className="font-semibold">{r.val}</span>
                    {r.pct !== null && <span style={{ color: 'var(--warm-muted)' }}> ({r.pct}%)</span>}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>상태별 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={statusSegments} centerLabel={`${statusTotal}명`} centerSub="입주자" />
            <div className="space-y-2.5 flex-1">
              {[
                { label: '거주중', count: data.statusCounts.active, color: STATUS_COLORS.active },
                { label: '입실 예약', count: data.statusCounts.reserved, color: STATUS_COLORS.reserved },
                { label: '퇴실 예정', count: data.statusCounts.checkout, color: STATUS_COLORS.checkout },
                // 도넛엔 비거주자 슬라이스가 있는데 범례에 빠져 중앙 합계(statusTotal)와 안 맞아 보이던 문제 — 있을 때만 추가
                ...(data.statusCounts.nonResident > 0 ? [{ label: '비거주자', count: data.statusCounts.nonResident, color: STATUS_COLORS.nonResident }] : []),
              ].map(s => {
                const pct = statusTotal > 0 ? Math.round((s.count / statusTotal) * 100) : 0
                return (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{s.label}</span>
                  <span className="text-xs" style={{ color: 'var(--warm-dark)' }}>
                    <span className="font-semibold">{s.count}명</span>
                    <span style={{ color: 'var(--warm-muted)' }}> ({pct}%)</span>
                  </span>
                </div>
                )
              })}
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>성별 분포</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={genderSegments} centerLabel={`${data.totalTenants}명`} centerSub="전체" />
            <div className="space-y-2.5 flex-1">
              {data.genderDist.map((d, i) => {
                const pct = data.totalTenants > 0 ? Math.round((d.count / data.totalTenants) * 100) : 0
                return (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GENDER_COLORS[d.label] ?? 'var(--ink-m)' }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{GENDER_LABEL[d.label] ?? d.label}</span>
                  <span className="text-xs" style={{ color: 'var(--warm-dark)' }}>
                    <span className="font-semibold">{d.count}명</span>
                    <span style={{ color: 'var(--warm-muted)' }}> ({pct}%)</span>
                  </span>
                </div>
                )
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>국적 분포</h3>
          <DistList items={data.nationalityDist} colors={DIST_COLORS} />
        </div>
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>직업 분포</h3>
          <DistList items={data.jobDist} colors={DIST_COLORS} />
        </div>
      </div>
    </div>
  )
}

// ── AI 분석 탭 ──────────────────────────────────────────────────

function AiTab({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
  const [aiText, setAiText] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleAnalyze = async () => {
    setError('')
    setAiText('')
    setIsLoading(true)
    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ data, targetMonth }),
      })

      if (!res.ok) {
        setError(res.status === 429
          ? '무료 AI 사용 한도를 초과했습니다. 잠시 후 다시 시도하거나 본인 키를 등록해 주세요.'
          : '분석에 실패했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }
      if (!res.body) {
        setError('분석 결과를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        accumulated += decoder.decode(value)
        setAiText(accumulated)
      }

      if (!accumulated.trim()) {
        setError('분석 결과를 받지 못했습니다. 잠시 후 다시 시도해주세요.')
      }

    } catch (e) {
      setError('연결 오류가 발생했습니다. 다시 시도해주세요.')
      console.error('[AI Analysis]', e)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>이달 재무 분석</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--warm-muted)' }}>{targetMonth} 운영 데이터 기반 AI 분석</p>
          </div>
          <Btn variant="primary" size="md" onClick={handleAnalyze} disabled={isLoading}>
            {isLoading
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />분석 중…</>
              : 'AI 분석하기'}
          </Btn>
        </div>
        {!aiText && !isLoading && !error && (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--warm-muted)' }}>버튼을 눌러 이달 재무 현황 AI 분석을 시작하세요</div>
        )}
        {isLoading && !aiText && (
          <div className="flex items-center gap-3 py-8 justify-center text-sm" style={{ color: 'var(--coral)' }}>
            <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
            이달 재무 현황을 분석하고 있어요
          </div>
        )}
        {error && (
          <div className="py-4 text-center space-y-3">
            <p className="text-[var(--danger-fg)] text-sm">{error}</p>
            <Btn variant="secondary" size="sm" onClick={handleAnalyze} disabled={isLoading}>다시 분석하기</Btn>
          </div>
        )}
        {aiText && (
          <div className="rounded-xl p-4" style={{ background: 'var(--coral-pale)', border: '1px solid color-mix(in srgb, var(--coral) 20%, transparent)' }}>
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--warm-dark)' }}>
              {aiText}
              {isLoading && <span className="inline-block w-1.5 h-4 bg-current opacity-70 animate-pulse ml-0.5 align-middle" />}
            </div>
            {!isLoading && <button onClick={handleAnalyze} className="mt-3 text-xs" style={{ color: 'var(--coral)' }}>다시 분석</button>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 방 상세 팝업 ─────────────────────────────────────────────────

// RoomDetailPopup 제거됨 (2026-05-29) — 대시보드 방 현황 클릭은 전역 EntityModal(Pivot)로 일원화.
// 호실/고객/수납 탭이 모든 진입점에서 동일한 라벨·위치·모양·순서 + 현재 탭만 Terracotta 강조.

// ── 입주자 빠른 정보 모달 ─────────────────────────────────────────

type TenantQuickInfo = Awaited<ReturnType<typeof getTenantQuickInfo>>

const GENDER_LABEL_KO: Record<string, string> = { MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '미기재' }
const CONTACT_LABEL: Record<string, string> = { PHONE: '전화', EMAIL: '이메일', KAKAO: '카카오', OTHER: '기타' }
const LEASE_STATUS_LABEL: Record<string, string> = { ACTIVE: '거주중', RESERVED: '입실 예약', CHECKOUT_PENDING: '퇴실 예정' }

function TenantQuickModal({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const [info, setInfo] = useState<TenantQuickInfo>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const data = await getTenantQuickInfo(tenantId)
      if (!cancelled) { setInfo(data); setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [tenantId])

  const lease = info?.leaseTerms?.[0] ?? null

  return (
    <Modal open onClose={onClose} width="sm"
      title={info?.name ?? '입주자 정보'}>
        {loading ? (
          <Loading />
        ) : !info ? (
          <div className="py-8 text-center text-sm text-[var(--warm-muted)]">입주자 정보를 찾을 수 없습니다.</div>
        ) : (
          <div className="space-y-2 text-sm">
            {/* 기본 정보 */}
            <p className="text-[0.65625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-1">기본 정보</p>
            {info.gender && (
              <div className="flex justify-between">
                <span className="text-[var(--warm-muted)]">성별</span>
                <span className="text-[var(--warm-dark)]">{GENDER_LABEL_KO[info.gender] ?? info.gender}</span>
              </div>
            )}
            {info.birthdate && (
              <div className="flex justify-between">
                <span className="text-[var(--warm-muted)]">생년월일</span>
                <span className="text-[var(--warm-dark)]">{fmtDateDot(info.birthdate)}</span>
              </div>
            )}
            {info.nationality && (
              <div className="flex justify-between">
                <span className="text-[var(--warm-muted)]">국적</span>
                <span className="text-[var(--warm-dark)]">{info.nationality}</span>
              </div>
            )}
            {info.job && (
              <div className="flex justify-between">
                <span className="text-[var(--warm-muted)]">직업</span>
                <span className="text-[var(--warm-dark)]">{info.job}</span>
              </div>
            )}

            {/* 연락처 */}
            {info.contacts.length > 0 && (
              <>
                <div className="border-t border-[var(--warm-border)] pt-2 mt-1">
                  <p className="text-[0.65625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-2">연락처</p>
                  {info.contacts.map((c, i) => (
                    <div key={i} className="flex justify-between mb-1">
                      <span className="text-[var(--warm-muted)]">{CONTACT_LABEL[c.contactType] ?? c.contactType}</span>
                      <span className="text-[var(--warm-dark)] font-medium">{c.contactValue}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* 계약 정보 */}
            {lease && (
              <div className="border-t border-[var(--warm-border)] pt-2 mt-1">
                <p className="text-[0.65625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-2">계약 정보</p>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--warm-muted)]">호실</span>
                  <span className="text-[var(--warm-dark)] font-medium">{fmtRoomNo(lease.room?.roomNo)}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--warm-muted)]">상태</span>
                  <span className="text-[var(--warm-dark)]">{LEASE_STATUS_LABEL[lease.status] ?? lease.status}</span>
                </div>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--warm-muted)]">이용료</span>
                  <span className="font-semibold text-[var(--warm-dark)]">{fmtWon(lease.rentAmount)}</span>
                </div>
                {lease.depositAmount > 0 && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">보증금</span>
                    <span className="text-[var(--warm-dark)]">{fmtWon(lease.depositAmount)}</span>
                  </div>
                )}
                {/* 단기는 입주월 1회 전액 청구라 '매월 N일'이 성립하지 않는다 — 납부일 줄을 생략한다. */}
                {lease.dueDay && !lease.isShortTerm && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">납부일</span>
                    <span className="text-[var(--warm-dark)]">매월 {lease.dueDay}일</span>
                  </div>
                )}
                {lease.moveInDate && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">입실일</span>
                    <span className="text-[var(--warm-dark)]">{fmtDateDot(lease.moveInDate)}</span>
                  </div>
                )}
                {(lease.expectedMoveOut ?? lease.moveOutDate) && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">퇴실(예정)</span>
                    <span className="text-[var(--warm-dark)]">{fmtDateDot(lease.expectedMoveOut ?? lease.moveOutDate)}</span>
                  </div>
                )}
              </div>
            )}

            {/* 메모 */}
            {info.memo && (
              <div className="border-t border-[var(--warm-border)] pt-2 mt-1">
                <p className="text-[0.65625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-1">메모</p>
                <p className="text-xs text-[var(--warm-dark)] whitespace-pre-wrap">{info.memo}</p>
              </div>
            )}
          </div>
        )}
    </Modal>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────

type Tab = 'overview' | 'finance' | 'tenants' | 'ai'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '현황' },
  { key: 'finance',  label: '재무' },
  { key: 'tenants',  label: '입주자' },
  { key: 'ai',       label: 'AI 분석' },
]

export default function DashboardClient({ data, targetMonth, paymentMethods, initialTab }: { data: DashboardData; targetMonth: string; paymentMethods: string[]; initialTab?: Tab }) {
  const router = useRouter()
  // KPI 용어 설명(사용성 감사 F3) — 라벨 옆 ? 탭
  const [kpiHelp, setKpiHelp] = useState<{ title: string; body: string[] } | null>(null)
  // body는 문단 배열 — 도움말 모달에서 줄바꿈으로 가독성 확보(운영자 지시 2026-07-13)
  const KPI_HELP = {
    projectedRevenue: { title: '예상 수입', body: [
      '이번 달 입주자 전원이 납부를 마쳤을 때의 수입입니다.',
      '퇴실 예정은 일할 정산으로, 입주 예정(예약 확정)은 전액으로 반영됩니다.',
      '막대는 지금까지 실제 수납된 금액의 달성률입니다.',
      '아직 받지 않은 금액과 부가수익도 포함됩니다.',
      '수납 관리의 이 달 청구액은 현재 입주자 청구만 집계합니다. 예약 확정, 퇴실자의 이 달 몫, 부가수익만큼 이 값이 더 큽니다.',
      '결산 보고서의 수납액은 실제 받은 돈만 집계하므로 이 값보다 작을 수 있습니다.',
    ] },
    // 카드에 등식이 붙었으므로 도움말이 같은 항을 다른 이름으로 부르면 안 된다(2026-08-12).
    projectedNetProfit: { title: '예상 운영이익', body: [
      '예상 수입에서 기록된 지출과 아직 안 빠진 고정 지출 (예정)을 뺀 월말 전망입니다.',
      '기록된 지출은 이 달 장부에 올라간 지출 전부입니다. 지출 관리의 일반 지출과 고정 지출 (기록됨)이 여기 들어갑니다.',
      '뺀 두 항을 더하면 아래 예상 지출 카드의 금액이 됩니다. 두 카드가 같은 두 숫자를 같은 이름으로 씁니다.',
      '막대는 예상 지출 중 실제로 확정된 비율입니다. 다 채워질수록 전망이 정확해집니다.',
      '아래 줄의 운영이익은 지금까지 기록된 것만으로 계산한 값이고, 맨 위 세부 재무 요약의 운영이익과 같은 숫자입니다.',
      '지난 달을 조회하면 고정 지출 (예정) 항은 사라집니다. 그 달에는 추정치를 더하지 않기 때문입니다.',
    ] },
    overdue: { title: '누적 미납 (현 입주자)', body: [
      '납부일이 지났는데 아직 받지 못한 금액의 합계입니다.',
      '지난달 이전에 밀린 금액(이월 미수)도 포함됩니다.',
      '카드를 누르면 수납 관리로 이동합니다.',
      '퇴실한 입주자의 남은 미납은 여기 포함되지 않습니다. 전체 채권은 결산 보고서의 월말 미수 잔액에서 확인하실 수 있습니다.',
    ] },
    expectedExpense: { title: '예상 지출', body: [
      '이미 쓴 지출에 아직 안 빠진 고정지출(임대료·공과금 등 예상치)을 더한 이번 달 전망입니다.',
      '숫자 아래 등식은 위 예상 운영이익 카드가 빼는 두 항과 같습니다. 기록된 지출 + 고정 지출 (예정) = 예상 지출입니다.',
      '막대와 그 아래 범례는 같은 금액을 다른 기준으로 나눈 것입니다. 줄일 수 있는 정도 순입니다.',
      '고정 지출 전체 (정액)은 매달 같은 금액, 고정 지출 전체 (변동)은 매달 다른 고정비, 수시는 그때그때 쓰는 돈입니다.',
      '범례의 고정 두 칸은 이 달 고정지출 전체 추정이라, 등식의 고정 지출 (예정)(아직 기록 안 된 몫)보다 큽니다.',
      '이번 달에는 아직 기록하지 않은 고정지출 예상치가 더해지고, 지난 달을 조회할 때는 기록된 지출만 집계합니다.',
    ] },
  }
  // viewMonth가 현재이면 "오늘 기준", 그 외(과거/미래)는 "○월 말일 기준"
  const isViewingRealMonth = targetMonth === kstMonthStr()
  const basisLabel = isViewingRealMonth
    ? '오늘 기준'
    : `${Number(targetMonth.slice(5))}월 말일 기준`
  // KPI 카드 캡션 — 현재 월은 '(이번 달)', 과거 월 조회 시 '(N월 마감)'
  const monthCaption = isViewingRealMonth
    ? '(이번 달)'
    : `(${Number(targetMonth.slice(5))}월 마감)`
  const [tab, setTab]                             = useState<Tab>(initialTab ?? 'overview')
  // 탭을 바꾸면 주소도 같이 바꾼다 — 딥링크로 그 탭에 착지하고, 다른 화면에 다녀와도(뒤로가기)
  // 보던 탭으로 돌아온다. 서버는 이 파라미터로 첫 탭을 정하므로 새로고침에도 살아남는다.
  //
  // router.replace 가 아니라 window.history 인 이유. 탭 전환은 **그리는 화면만** 바뀌고 다시 받을
  // 데이터가 없는데, router 를 태우면 홈 서버 컴포넌트가 통째로 다시 돌아 탭 하나 누를 때마다
  // 로딩 점프가 생긴다. Next 는 pushState·replaceState 를 라우터에 동기화해 주므로
  // (linking-and-navigating 문서 Native History API) 월 셀렉터의 useSearchParams 도 이 값을 본다.
  // 기본 탭에서는 파라미터를 지운다 — 지출 관리·수납 관리가 기본 탭에 ?tab= 을 안 다는 그 문법.
  const changeTab = (next: Tab) => {
    setTab(next)
    const sp = new URLSearchParams(window.location.search)
    if (next === 'overview') sp.delete('tab')
    else sp.set('tab', next)
    const qs = sp.toString()
    window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname)
  }
  // 호실 클릭 → 통합 EntityModal(Pivot) 으로 열기 (공실은 호실 탭만 활성, 고객·수납은 비활성으로 통일)
  const entityModal = useEntityModal()
  const [tenantInfoId, setTenantInfoId]           = useState<string | null>(null)
  const [selectedAlert, setSelectedAlert]         = useState<AlertItem | null>(null)
  const [quoteOpen, setQuoteOpen] = useState(false)   // 단기 입실 요금 계산(홈 헤더, 고객 관리에서 이관 2026-07-06)
  // 고정지출 기록은 지출관리와 같은 공용 모달을 쓴다 — 알림 페이로드가 아니라 서버 현황을 받아 연다.
  const [recordingRec, setRecordingRec]           = useState<RecurringExpenseWithStatus | null>(null)
  const [recAccounts, setRecAccounts]             = useState<RecModalAccount[]>([])
  // 알림은 id 만 들고 있다(SSR 페이로드 비대화 방지) — 열 때 현황·계좌를 받아 지출관리와 같은 폼을 띄운다.
  const handleStartRecord = async (alert: AlertItem) => {
    const id = alert.recurringExpenseId
    if (!id) return
    const [recs, accounts] = await Promise.all([
      getRecurringExpensesWithStatus(kstMonthStr()),
      getFinancialAccounts(),
    ])
    const rec = recs.find(r => r.id === id)
    // 스테일 알림 — 목록에서 사라졌거나 이미 이번 달 기록이 있으면 폼을 열지 않는다.
    if (!rec || rec.recordedExpenseId) {
      pushToast('info', '이미 기록된 항목입니다')
      router.refresh()
      return
    }
    setRecAccounts(accounts)
    setRecordingRec(rec)
  }
  const [unpaidExpanded, setUnpaidExpanded]       = useState(false)
  // 미납 안내 문자 — 입금확인 스텝 + 템플릿 발송 (/docs/stayeum_payment_spec.md Phase 1)
  const [smsTarget, setSmsTarget] = useState<UnpaidSmsTarget | null>(null)
  const [activityExpanded, setActivityExpanded]   = useState(false)

  // 방 현황 차원 그룹화 — 사용자가 차원을 다중·순서대로 골라 호실 카드 묶음 단위가 바뀜.
  // 디폴트 ['floor'] = 기존 동작(층별 묶음) 유지. 선택 상태는 localStorage 보존.
  type RoomDimKey = 'floor' | 'tier' | 'windowType' | 'direction' | 'type'
  const ROOM_DIMS: { key: RoomDimKey; label: string }[] = [
    { key: 'floor',      label: '층' },
    { key: 'tier',       label: '등급' },
    { key: 'windowType', label: '창문' },
    { key: 'direction',  label: '방향' },
    { key: 'type',       label: '방타입' },
  ]
  const ROOM_DIMS_STORAGE_KEY = 'stayeum-dashboard-room-dims'
  const [roomDims, setRoomDims] = useState<RoomDimKey[]>(['floor'])
  useEffect(() => {
    try {
      const raw = localStorage.getItem(ROOM_DIMS_STORAGE_KEY)
      if (raw) {
        const parsed = JSON.parse(raw) as RoomDimKey[]
        if (Array.isArray(parsed) && parsed.every(k => ROOM_DIMS.some(d => d.key === k))) {
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setRoomDims(parsed)
        }
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    try { localStorage.setItem(ROOM_DIMS_STORAGE_KEY, JSON.stringify(roomDims)) } catch { /* ignore */ }
  }, [roomDims])
  const toggleRoomDim = (key: RoomDimKey) => {
    setRoomDims(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  // 미수납 정렬: 체납 오래된 순 → 납부일 임박 순
  const sortedUnpaid = [...data.unpaidLeases].sort((a, b) => {
    const ao = a.daysOverdue ?? -999
    const bo = b.daysOverdue ?? -999
    if (ao > 0 && bo <= 0) return -1
    if (ao <= 0 && bo > 0) return  1
    return bo - ao
  })
  const visibleUnpaid = unpaidExpanded ? sortedUnpaid : sortedUnpaid.slice(0, UNPAID_LIMIT)

  // 소개 페이지 공개/철회 — showOnSite 토글 후 대시보드 갱신(정본은 room-manage 액션)
  const [siteBusy, startSiteTransition] = useTransition()
  const handleShowOnSite = (id: string, show: boolean) => {
    startSiteTransition(async () => {
      const res = await setRoomShowOnSite(id, show)
      if (res.ok) {
        pushToast('success', show ? '소개 페이지에 올렸어요' : '소개 페이지에서 내렸어요')
        router.refresh()
      } else {
        pushToast('error', res.error)
      }
    })
  }

  return (
    <div className="space-y-3.5">
      {smsTarget && <UnpaidSmsModal target={smsTarget} onClose={() => setSmsTarget(null)} />}

      {/* ── 시작 체크리스트(온보딩) — 신규 영업장: 무엇부터 할지 3단계 안내 ── */}
      {data.onboarding && (() => {
        const ob = data.onboarding
        const steps = [
          { done: ob.hasRooms,    label: '호실 등록',   desc: '운영할 방(호실)을 먼저 만들어 주세요.',   href: '/room-manage' },
          { done: ob.hasTenants,  label: '입주자 등록', desc: '입주자를 등록하고 호실에 배정합니다.',     href: '/tenants' },
          { done: ob.hasPayments, label: '첫 수납 기록', desc: '이용료를 받으면 수납 관리에 기록합니다.',  href: '/rooms' },
        ]
        const doneCount = steps.filter(s => s.done).length
        return (
          <section className="rounded-xl p-5 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
            <div>
              <h2 className="text-sm font-bold text-[var(--warm-dark)]">시작하기 <span className="text-[var(--coral)] tnum">{doneCount}/3</span></h2>
              <p className="text-xs text-[var(--warm-muted)] mt-0.5">세 단계면 운영 준비가 끝납니다. 완료된 단계는 자동으로 체크됩니다.</p>
            </div>
            <ol className="space-y-1.5">
              {steps.map((s, i) => (
                <li key={s.label}>
                  <Link href={s.href}
                    className={`flex items-center gap-3 rounded-xl border px-3.5 py-3 transition-colors ${s.done ? 'border-[var(--warm-border)] opacity-60' : 'border-[var(--coral)]/40 hover:bg-[var(--canvas)]'}`}>
                    <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-bold ${s.done ? 'bg-[var(--success-bg)] text-[var(--success-fg)]' : 'bg-[var(--coral)] text-[var(--on-solid)]'}`}>
                      {s.done
                        ? <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>
                        : i + 1}
                    </span>
                    <span className="min-w-0">
                      <span className={`block text-sm font-semibold ${s.done ? 'text-[var(--warm-muted)] line-through' : 'text-[var(--warm-dark)]'}`}>{s.label}</span>
                      {!s.done && <span className="block text-xs text-[var(--warm-muted)]">{s.desc}</span>}
                    </span>
                    {!s.done && (
                      <svg className="ml-auto shrink-0 text-[var(--coral)]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6" /></svg>
                    )}
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        )
      })()}
      {/* 온보딩 미완료 — 0원 지표 대신 안내 한 줄(신규유저 감사 #4). 3단계 완료 시 자동으로 전체 지표 표시 */}
      {data.onboarding && (
        <p className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)] px-4 py-3 text-xs text-[var(--warm-muted)]">위 3단계를 마치면 이 자리에 매출·미납·지출 지표와 알림이 채워집니다.</p>
      )}
      {!data.onboarding && (<>

      {/* ── 기간(월) 셀렉터 + 요금 계산 — 우측 정렬 ────────────────────── */}
      {/* 요금 계산: 문의 전화 시 홈에서 바로 견적(고객 관리에서 이관, 운영자 지시 2026-07-06) */}
      <div className="flex justify-end items-center gap-2">
        <Btn type="button" variant="secondary" size="md" onClick={() => setQuoteOpen(true)}>단기 요금 계산</Btn>
        <MonthSelector />
      </div>
      <StayQuoteModal open={quoteOpen} onClose={() => setQuoteOpen(false)} />

      {/* ── Row 1: 알림 ─────────────────────────────────────────── */}
      <AlertsStrip alerts={data.alerts} onOpenAlert={setSelectedAlert} />

      {/* 찍어 올리기 · 등록 대기 큐는 홈에서 제외 — 스테이음 Lab(/snap-upload)으로 이전(운영자 지시 2026-07-19).
          원래 비전(물건 사진 개수 인식 → 재고 반영)은 신뢰도 부족으로 보류, 아이디어 확정 시 Lab에서 재개. */}

      {/* KPI 용어 한 줄 설명 — 라벨 옆 ? 탭(모바일 title 힌트 대체, 사용성 감사 F3) */}
      <Modal open={!!kpiHelp} onClose={() => setKpiHelp(null)} title={kpiHelp?.title} width="xs">
        <div className="text-sm leading-relaxed text-[var(--warm-dark)] space-y-2">
          {kpiHelp?.body.map((line, i) => <p key={i}>{line}</p>)}
        </div>
      </Modal>

      {/* ── KPI 카드 (v2.0 §24 반응형: 모바일 1 → sm 3 → lg 4 — 모바일 1열 정본, 반폭 과밀 해소) ──────────── */}
      <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">

        {/* Row 2 Left: 예상 매출 + 달성도 — 고시원 특성상 유지되면 매출이 거의 안 늘어 '현재까지'보다
            '예상 매출 대비 성과(수납 달성도)'가 유효. 예상엔 퇴실예정(일할/0)·신규 예약확정(전액) 반영됨. */}
        <div className="rounded-xl" style={{ background: 'var(--coral)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--on-solid-sub)', marginBottom: 8 }}>
            예상 수입
            <span style={{ fontSize: '0.65625rem', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 6, color: 'var(--on-solid-sub)' }}>{monthCaption}</span>
            <button type="button" aria-label="설명 보기" onClick={e => { e.preventDefault(); e.stopPropagation(); setKpiHelp(KPI_HELP.projectedRevenue) }} className="inline-flex items-center justify-center align-[-2px]" style={{ marginLeft: 6, color: 'inherit', opacity: 0.6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5" /><path d="M12 7.6h.01" /></svg></button>
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--on-solid)', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4 }}>
            {data.projectedRevenue.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--on-solid-sub)', marginLeft: 3 }}>원</small>
          </p>
          {/* 등식 캡션 — 이 숫자가 어디서 왔는지 큰 숫자 바로 아래에 적는다(운영자 지시 2026-08-12).
              진행바 아래에 두면 등호의 좌변이 바로 위 '달성 93%' 로 읽혀 매달린다(디자인 패널).
              문장은 수납 관리 캡션과 같은 정본(MoneyEquation)이 만든다 — 값이 같아도 항이 갈리면 또 사고다. */}
          {!data.isFutureMonth && hasRevenueBridge({ reserved: data.reservedExpected, checkedOut: data.checkedOutRecognized, extra: data.extraRevenue }) && (
            <p style={{ fontSize: '0.65625rem', color: 'var(--on-solid-sub)', lineHeight: 1.5, wordBreak: 'keep-all', margin: 0 }}>
              <MoneyEquation terms={expectedRevenueTerms({
                billed:     data.billedThisMonth,
                reserved:   data.reservedExpected,
                checkedOut: data.checkedOutRecognized,
                extra:      data.extraRevenue,
              })} />
            </p>
          )}
          {(() => {
            const pct = data.projectedRevenue > 0 ? Math.min(100, Math.round((data.totalRevenue / data.projectedRevenue) * 100)) : 0
            return (
              <>
                <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,252,247,0.22)', overflow: 'hidden', margin: '8px 0 6px' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: '#fff', borderRadius: 3 }} />
                </div>
                {/* v2.0 §24 — 보조 1줄(달성도). 완료/예정/미납 건 상세는 수납 관리로 이동.
                    '수납+기타' → '실수납' (2026-08-12 운영자 점검). 수납 관리 캡션이 원 단위로 같은 값을
                    '실수납'이라 부르고(RoomsClient homeCollectedSum), 감지망도 그 항등을 '홈 실수납'이라는
                    이름으로 잠그고 있다. 같은 숫자에 두 이름을 두던 마지막 자리였다. */}
                <p style={{ fontSize: '0.65625rem', color: 'var(--on-solid-sub)', lineHeight: 1.5 }}>
                  실수납 {fmtWon(data.totalRevenue)} · 달성 <em style={{ fontStyle: 'normal', color: 'var(--rev-change)', fontWeight: 700 }}>{pct}%</em>
                </p>
              </>
            )
          })()}
        </div>

        {/* Row 2 Right: 예상 순이익 + 달성도 — 매출 위젯과 동일 방식(예상 큰 숫자 + 현재/예상 달성 bar).
            다크 카드 유지(순이익 구분). 예비비 이체분 있으면 운영 가용 자금 보조 표시. */}
        {(() => {
          const expectedNet = data.projectedNetProfit   // 예상 수입 − 예상 지출 (월말 전망)
          const currentNet  = data.netProfit            // 현재 장부(수납 − 실제 지출) — 지출 덜 빠져 과대평가됨
          const isPosExp = expectedNet >= 0
          // 등식의 마지막 항은 **실제로 빠진 금액**이다. 서버는 과거월에 미기록 고정지출 추정을
          // 안 더하는데(page.tsx expectedExpense 분기) 캡션이 추정치를 그대로 빼면 그 금액만큼
          // 등식이 거짓이 된다. 뺀 값을 받으면 과거월엔 저절로 0이 되어 항이 사라진다.
          // 이렇게 두면 좌변 projectedNetProfit = projectedRevenue − expectedExpense 와 항등이다.
          const profitTerms = operatingProfitTerms({
            projectedRevenue: data.projectedRevenue,
            recordedExpense:  data.totalExpense,
            pendingRecurring: data.expectedExpense - data.totalExpense,
          })
          // 순이익엔 '달성율'(현재/예상)이 안 맞음: 수납은 월초에 몰리고 지출은 月내내 빠져
          // 현재 장부가 부풀려져 100%에 박힘. 대신 '지출이 얼마나 확정됐나'(실제/예상)를 보여
          // 다 채워지면 예상치로 수렴함을 표시.
          const expenseBooked = data.expectedExpense > 0 ? Math.min(100, Math.round((data.totalExpense / data.expectedExpense) * 100)) : 100
          return (
            <div className="rounded-xl" style={{
              background: 'var(--np-card-bg)', padding: '18px 20px',
              boxShadow: 'inset 3px 0 0 var(--np-tip), inset 0 0 0 1px var(--np-card-bd)',
            }}>
              <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--np-label)', marginBottom: 8 }}>
                예상 운영이익
                <span style={{ fontSize: '0.65625rem', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 6, color: 'var(--np-cap)' }}>{monthCaption}</span>
                <button type="button" aria-label="설명 보기" onClick={e => { e.preventDefault(); e.stopPropagation(); setKpiHelp(KPI_HELP.projectedNetProfit) }} className="inline-flex items-center justify-center align-[-2px]" style={{ marginLeft: 6, color: 'inherit', opacity: 0.6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5" /><path d="M12 7.6h.01" /></svg></button>
              </p>
              <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4, color: isPosExp ? 'var(--np-pos)' : 'var(--np-neg)' }}>
                {isPosExp ? '+' : ''}{expectedNet.toLocaleString()}
                <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--np-unit)', marginLeft: 2 }}>원</small>
              </p>
              {/* 등식 캡션 — 예상 수입 카드와 같은 자리(큰 숫자 바로 아래, 진행바 위), 같은 정본.
                  항이 하나뿐이면 좌변을 되풀이할 뿐이라 줄 자체를 안 적는다. */}
              {!data.isFutureMonth && profitTerms.length > 1 && (
                <p style={{ fontSize: '0.65625rem', color: 'var(--np-cap)', lineHeight: 1.5, wordBreak: 'keep-all', margin: 0 }}>
                  <MoneyEquation terms={profitTerms} />
                </p>
              )}
              <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,252,247,0.18)', overflow: 'hidden', margin: '8px 0 6px' }}>
                <div style={{ height: '100%', width: `${expenseBooked}%`, background: 'var(--np-pos)', borderRadius: 3 }} />
              </div>
              {/* v2.0 §24 — 보조 1줄(현재 장부·지출 반영도). 남은 지출·예비비 이체 상세는 지출/부가수익으로 이동.
                  '장부 순이익' → '운영이익' (2026-08-12 용어 통일). 위 세부 재무 요약 타일의 '운영이익'과
                  **같은 변수**(netProfit)이고 결산 보고서도 같은 이름을 쓴다. '순이익'은 2026-06 전수
                  통일에서 폐기된 어휘인데 이 한 자리에 남아 있었다. 큰 숫자(예상)와의 구분은 카드 제목의
                  '예상'이 이미 한다 — 예상 수입 카드의 보조줄도 같은 자리에서 확정치를 말한다. */}
              <p style={{ fontSize: '0.65625rem', color: 'var(--np-cap)', lineHeight: 1.5 }}>
                운영이익 <em style={{ fontStyle: 'normal', color: currentNet >= 0 ? 'var(--np-pos)' : 'var(--np-neg)', fontWeight: 700 }}>{currentNet >= 0 ? '+' : ''}{fmtKorMoney(currentNet)}</em> · 지출 반영 <em style={{ fontStyle: 'normal', color: 'var(--np-pos)', fontWeight: 700 }}>{expenseBooked}%</em>
              </p>
            </div>
          )
        })()}

        {/* Row 3 Left: 누적 미납 — v2.0 §24 경고 타입(연체 시 좌 3px danger). 납부 예정 상세는 수납 관리로 */}
        <Link href="/rooms" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px',
            boxShadow: data.overdueAmount > 0 ? 'inset 3px 0 0 var(--danger-fg)' : undefined }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            누적 미납 (현 입주자)
            <button type="button" aria-label="설명 보기" onClick={e => { e.preventDefault(); e.stopPropagation(); setKpiHelp(KPI_HELP.overdue) }} className="inline-flex items-center justify-center align-[-2px]" style={{ marginLeft: 6, color: 'inherit', opacity: 0.6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5" /><path d="M12 7.6h.01" /></svg></button>
          </p>
          {/* 수치·건수는 --danger-fg 다. 미수는 §04 danger 의미이고, 이 카드가 이미 같은 토큰으로
              좌측 3px 팁을 그린다. --tc 는 다크에서 안 밝아져 크림 카드 위 2.78:1 이었다
              (--danger-fg 는 다크 #E08A75 로 7.05:1, 라이트는 #A03C2E 라 픽셀 불변). */}
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: data.overdueAmount > 0 ? 'var(--danger-fg)' : 'var(--ink-2)' }}>
            {data.overdueAmount.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>
            <em style={{ fontStyle: 'normal', color: data.unpaidCount > 0 ? 'var(--danger-fg)' : 'var(--warm-muted)' }}>{data.unpaidCount}건</em> · 도래·미회수
          </p>
        </Link>

        {/* Row 3 Right: 예상 지출 — 통제가능성 3단계 스택 막대(줄일 수 있는 정도 순).
            색(디자인 토큰): 고정(정액)=ink-2(임대료 등·못 줄임) · 고정(변동)=warm-mid(공과금 등·노력시 줄임) · 수시=coral(비고정·가장 줄이기 쉬움). */}
        <Link href="/finance?tab=expense" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            예상 지출 <span style={{ fontSize: '0.65625rem', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 4, color: 'var(--warm-muted)' }}>{monthCaption}</span>
            <button type="button" aria-label="설명 보기" onClick={e => { e.preventDefault(); e.stopPropagation(); setKpiHelp(KPI_HELP.expectedExpense) }} className="inline-flex items-center justify-center align-[-2px]" style={{ marginLeft: 6, color: 'inherit', opacity: 0.6 }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11.2v5" /><path d="M12 7.6h.01" /></svg></button>
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--ink-2)', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 4 }}>
            {data.expectedExpense.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          {/* 등식 캡션 — 위 두 카드와 같은 자리(큰 숫자 바로 아래, 진행바 위), 같은 정본(§24).
              운영이익 카드가 **빼는** 두 항을 여기서는 더한다. 종전에는 이 카드만 '고정(정액)·
              고정(변동)·수시' 라는 다른 축의 말만 써서 두 카드가 같은 돈을 다른 언어로 말했다
              (운영자 지적 2026-08-12). 항이 하나뿐인 과거월엔 좌변을 되풀이할 뿐이라 안 적는다. */}
          {(() => {
            const expTerms = expectedExpenseTerms({
              recordedExpense:  data.totalExpense,
              pendingRecurring: data.expectedExpense - data.totalExpense,
            })
            return !data.isFutureMonth && expTerms.length > 1 ? (
              <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)', lineHeight: 1.5, wordBreak: 'keep-all', margin: '0 0 2px' }}>
                <MoneyEquation terms={expTerms} />
              </p>
            ) : null
          })()}
          {(() => {
            const t = data.expenseTiers
            const tot = (t.immovable + t.variable + t.savable) || 1
            return (
              <>
                <div style={{ display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden', margin: '2px 0 5px', background: 'var(--warm-border)' }}>
                  {t.immovable > 0 && <div style={{ width: `${(t.immovable / tot) * 100}%`, background: 'var(--ink-2)' }} />}
                  {t.variable  > 0 && <div style={{ width: `${(t.variable  / tot) * 100}%`, background: 'var(--warm-mid)' }} />}
                  {t.savable   > 0 && <div style={{ width: `${(t.savable   / tot) * 100}%`, background: 'var(--coral)' }} />}
                </div>
                {/* v2.0 §24 — 보조 1줄(통제가능성 막대 범례). 정액/변동/수시 정의 설명은 (i) 도움말로 이관. 폰트 §05 최소 10.5px.
                    '고정(정액)' → '고정 지출 전체 (정액)' (2026-08-12 용어 통일). 이 두 칸은 활성 고정지출
                    **전체**의 추정액이고, 바로 위 등식의 '고정 지출 (예정)'은 그중 **아직 기록 안 된 몫**이다.
                    모집단이 다른데 앞 글자가 같아 한 카드 안에서 같은 것으로 읽혔다. */}
                <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--ink-2)' }}>●</span> 고정 지출 전체 (정액) {fmtKorMoney(t.immovable)} · <span style={{ color: 'var(--warm-mid)' }}>●</span> 고정 지출 전체 (변동) {fmtKorMoney(t.variable)} · <span style={{ color: 'var(--coral)' }}>●</span> 수시 {fmtKorMoney(t.savable)}
                </p>
              </>
            )
          })()}
        </Link>

        {/* Row 4 Left: 보유 보증금 — 2026-08-12 수납 관리로 이관(받고 돌려주는 돈이라 지출이 아니다). */}
        <Link href="/rooms?tab=deposit" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            보유 보증금
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--accent-deposit)', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.totalDeposit.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>현재 보증금 합계</p>
        </Link>

        {/* Row 4 Right: 보유 예비비 */}
        <Link href="/finance?tab=reserve" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            보유 예비비
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--accent-reserve)', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.reserveBalance.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>
            {data.reserveMonthly.deposit > 0 || data.reserveMonthly.withdraw > 0 ? (
              <>
                이달 <span style={{ color: 'var(--success)' }}>+{data.reserveMonthly.deposit.toLocaleString()}</span>
                {' / '}
                <span style={{ color: 'var(--viz-4)' }}>−{data.reserveMonthly.withdraw.toLocaleString()}</span>
              </>
            ) : '이번 달 거래 없음'}
          </p>
        </Link>

        {/* Row 5 Left: 입실 현황 */}
        <Link href="/room-manage" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            입실 현황
          </p>
          <p className="mono tnum" style={{ fontSize: '1.625rem', fontWeight: 700, color: 'var(--ink-2)', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.occupiedRooms}
            <small style={{ fontSize: '0.8125rem', fontWeight: 400, color: 'var(--warm-muted)' }}> / {data.totalRooms}</small>
          </p>
          <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>
            공실 <em style={{ fontStyle: 'normal', color: 'var(--vacant-num)' }}>{data.vacantRooms}개</em>
            {/* 집계 제외(창고·사무실) 안내 — 제외 방이 있을 때만(신고 9d844226, 문구 운영자 선택) */}
            {data.excludedRooms > 0 && <> · 집계 제외 {data.excludedRooms}실</>}
          </p>
        </Link>
      </div>

      {/* ── 탭 섹션 ─────────────────────────────────────────────── */}
      <div>
        {/* 탭 바 (필 스타일) */}
        {/* v2.0 §25 뷰 전환 탭 — 개별 필 나열(제4 변종) 폐기, 코랄 채움 정본. sticky 래퍼는 유지 */}
        <div className="sticky -top-4 md:-top-6 z-10 pb-2 pt-0.5" style={{ background: 'var(--canvas)' }}>
          <ViewTabs ariaLabel="대시보드 탭" activeId={tab}
            onChange={id => changeTab(id as (typeof TABS)[number]['key'])}
            tabs={TABS.map(t => ({ id: t.key, label: t.label }))} />
        </div>

        {/* 탭 콘텐츠 */}
        <div className="pt-3.5 space-y-3.5">

          {/* ── 현황 탭 ── */}
          {tab === 'overview' && (
            <>
              {/* 방 현황(좌) + 미수납·납입완료(우) */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5 lg:items-start">

                {/* 좌측: 방 현황 + 수납 진행 */}
                <div className="flex flex-col gap-3.5">

                  {/* 방 현황 그리드 */}
                  <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                    <div className="flex items-center justify-between shrink-0">
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>
                        방 현황
                        <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 6 }}>{data.totalRooms}개 호실</span>
                      </p>
                      <Link href="/room-manage" style={{ fontSize: '0.6875rem', color: 'var(--coral)' }}>전체 보기 ›</Link>
                    </div>
                    {data.rooms.length === 0 ? (
                      <p className="text-center py-8 text-sm" style={{ color: 'var(--warm-muted)' }}>등록된 호실 없음</p>
                    ) : (
                      <>
                        {/* 차원 칩 — 호실 카드 묶음 단위 선택 (순서대로 우선순위) */}
                        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                          <span style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>묶음</span>
                          {ROOM_DIMS.map(d => {
                            const idx = roomDims.indexOf(d.key)
                            const on = idx >= 0
                            return (
                              <button key={d.key} type="button" onClick={() => toggleRoomDim(d.key)}
                                className="px-2.5 py-1 text-[0.6875rem] rounded-md transition-colors flex items-center gap-1"
                                style={{
                                  background: on ? 'var(--persimmon)' : 'var(--canvas)',
                                  color: on ? 'var(--on-solid)' : 'var(--warm-mid)',
                                  border: '1px solid ' + (on ? 'var(--persimmon)' : 'var(--warm-border)'),
                                  fontWeight: on ? 600 : 500,
                                }}>
                                {on && roomDims.length > 1 && (
                                  <span className="inline-flex items-center justify-center min-w-4 h-4 px-1 rounded-full text-[0.65625rem] font-bold"
                                    style={{ background: 'rgba(255,255,255,0.25)' }}>
                                    {idx + 1}
                                  </span>
                                )}
                                {d.label}
                              </button>
                            )
                          })}
                          {roomDims.length > 0 && (
                            <button type="button" onClick={() => setRoomDims([])}
                              className="text-[0.65625rem] underline-offset-2 hover:underline"
                              style={{ color: 'var(--warm-muted)' }}>전체</button>
                          )}
                        </div>
                        {/* 범례 — 스와치는 타일 실제 표면색(밴드 틴트 그대로, BAND_BG 와 같은 토큰).
                            종전 스와치는 fg(짙은 글자색)라 타일 어디에도 없는 색을 견본으로 내밀었다.
                            공실 견본은 비어 보이는 게 맞다 — 무색이라는 사실이 그 방의 상태다.
                            비거주만 걸린 방(415호·사무실 유형)도 사람 없는 방이라 같은 견본을 쓴다.
                            항목을 늘리지 않고 라벨만 늘린다 — 무색 견본 하나가 이제 셋을 뜻하기 때문이다(공실·비거주·입주 가능).
                            범례는 색 사전이라 같은 색에 칸을 하나 더 내주면 색이 둘인 것처럼 읽힌다. */}
                        <div className="flex gap-3.5 shrink-0 flex-wrap items-center" style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>
                          {([
                            { tone: 'paid'    as const, label: '완납' },
                            { tone: 'await'   as const, label: '납부·입실 예정' },
                            { tone: 'unpaid'  as const, label: '미납' },
                            { tone: 'overdue' as const, label: '연체' },
                            { tone: 'none'    as const, label: '공실·비거주·입주 가능' },
                          ]).map(s => (
                            <div key={s.label} className="flex items-center gap-[5px]">
                              {/* 10% 틴트는 7px 에서 안 보인다 — 견본 크기를 키우고 테두리는 중립 헤어라인으로(상태색 아님) */}
                              <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: BAND_BG[s.tone], border: '1px solid var(--border)' }} />{s.label}
                            </div>
                          ))}
                        </div>
                        {(() => {
                            const unpaidRooms = new Set(data.unpaidRoomNosForView)
                            const getFloor = (r: typeof data.rooms[0]) => {
                              if (r.floor) return r.floor
                              const n = r.roomNo.replace(/[^0-9]/g, '')
                              return n.length >= 3 ? n.slice(0, n.length - 2) : '기타'
                            }
                            // 차원별 값 추출 + 라벨 변환
                            const UNSET = '미지정'
                            const dimValue = (r: typeof data.rooms[0], k: RoomDimKey): string => {
                              switch (k) {
                                case 'floor':      return `${getFloor(r)}층`
                                case 'tier':       return r.tier ?? UNSET
                                case 'windowType': return r.windowType ? (DASH_WINDOW_LABEL[r.windowType] ?? r.windowType) : UNSET
                                case 'direction':  return r.direction ? (DASH_DIR_LABEL[r.direction] ?? r.direction) : UNSET
                                case 'type':       return r.type ?? UNSET
                              }
                            }
                            const dimSortKey = (k: RoomDimKey, v: string): number | string => {
                              if (k === 'floor') {
                                if (v === `${UNSET}층`) return 99999
                                const n = parseInt(v.replace(/[^0-9]/g, ''), 10)
                                return isNaN(n) ? 99998 : n
                              }
                              return v === UNSET ? '~~~' + v : v // UNSET을 뒤로
                            }
                            // 그룹 키 = 선택된 차원 값들을 '|' 로 join (내부 키), 라벨 = ' · '
                            const groups = new Map<string, { label: string; values: string[]; rooms: typeof data.rooms }>()
                            for (const r of data.rooms) {
                              const values = roomDims.map(k => dimValue(r, k))
                              const key = values.join('|') || '__all__'
                              const label = values.length > 0 ? values.join(' · ') : ''
                              const g = groups.get(key)
                              if (g) g.rooms.push(r)
                              else groups.set(key, { label, values, rooms: [r] })
                            }
                            // 차원 순서대로 정렬
                            const sortedGroups = Array.from(groups.values()).sort((a, b) => {
                              for (let i = 0; i < roomDims.length; i++) {
                                const k = roomDims[i]
                                const ka = dimSortKey(k, a.values[i])
                                const kb = dimSortKey(k, b.values[i])
                                if (ka < kb) return -1
                                if (ka > kb) return 1
                              }
                              return 0
                            })
                            const renderCell = (r: typeof data.rooms[0]) => {
                              const hasNonResident = !!r.nonResidentName
                              // 사람 줄 — 사는 사람(또는 먼저 들어올 예약) + 다음 입실 예약(lib/leaseStatus 정본).
                              const people = r.isVacant ? [] : r.occupants
                              // 사람이 없을 때만 방 자체를 부른다.
                              // 거주·예약 계약이 하나도 없고 비거주 계약만 걸린 방(415호·사무실 유형)은 방의 용도만
                              // 말한다 — 점유자 이름을 세우면 그 방에 사는 사람으로 읽힌다(운영자 지적 2026-08-11).
                              // 그 사람의 호실·이름·금액·미납은 아래 '비거주자 현황' 카드가 정본 자리다.
                              // '공실'이라 부르지 않는 이유 — 이 앱에서 공실은 lib/vacancy 가 정의한 집계어이고
                              // 415호·사무실은 집계 제외다(KPI 가 "공실 0개 · 집계 제외 2실"이라 말하는 그 둘).
                              // 공실로 세라고 설정한 방(nonResidentVacant)은 종전 어휘 '공실 (비거주자)' 그대로다.
                              const roomLabel = !r.isVacant ? '거주중'
                                : r.vacancyExcluded ? '비거주'
                                : hasNonResident ? '공실 (비거주자)' : '공실'
                              // 비거주 점유 방은 그 계약의 협의가(방 기본값이면 415호가 15만을 35만으로 부른다),
                              // 나머지는 이번 달 제시가 — 아직 사람이 없으니 내놓은 값이 그 방의 금액이다.
                              // 제시가는 예약 인상을 본다(lib/billing offerRentForMonth) — baseRent 직표시이던
                              // 시절엔 인상 예약이 걸린 빈 방을 구가로 불렀다.
                              const roomAmount = r.vacancyExcluded ? (r.nonResidentAmount ?? 0) : r.offerRent
                              // 사람이 없는 타일은 무색이다. 비거주 점유를 사람 색으로 칠하던 시안 D(7408890)를
                              // 운영자가 뒤집었다 — 색까지 사람과 같으면 그 방에 누가 산다고 말하는 것과 같다.
                              // 그 사람의 수납 단계(미납·연체 D+N)는 아래 비거주자 현황 카드가 색과 함께 말한다.
                              // 방 단위 Set 은 여기 한 자리에만 남는다(사람이 있는 타일은 사람이 자기 색을 들고 온다).
                              const roomTone: BandTone = r.isVacant ? 'none'
                                : unpaidRooms.has(r.roomNo) ? 'unpaid' : 'none'
                              const roomSub = roomTone === 'unpaid' ? '미납' : NBSP
                              // 가격 예고는 제시가를 세운 자리에만 붙는다 — 사람 없는 방은 이번 달,
                              // 입주 가능 블락은 그 방이 비는 달. 사람 밴드의 금액은 방 제시가가 아니라
                              // 그 사람의 청구액(할인·일할·락인)이라 방 예약값을 얹으면 우리가 계산하지
                              // 않은 청구를 약속하게 된다. 둘은 동시에 서지 않는다(사람 유무로 갈린다).
                              const ahead = people.length === 0 ? r.offerRentAhead : (r.availability?.ahead ?? null)
                              return (
                                <div
                                  key={r.roomNo}
                                  onClick={() => entityModal.open({ kind: 'room', roomId: r.id })}
                                  className="room-tile rounded-[8px] flex flex-col cursor-pointer overflow-hidden"
                                >
                                  {/* 호실번호는 밴드 밖 공통 헤더 — 방 이름은 사람 것이 아니라 타일 것이다 */}
                                  <div className="truncate w-full text-center tnum px-1 py-[3px]" style={CELL_HEAD}>{fmtRoomNo(r.roomNo)}</div>
                                  {/* 밴드 사이 3px 은 카드 배경(--cream)이 비치는 틈 — 선도 그림자도 쓰지 않는다 */}
                                  <div className="grow flex flex-col gap-[3px]">
                                    {people.length === 0
                                      ? <div className="grow flex flex-col justify-center px-1 py-2 gap-[3px]" style={bandStyle(roomTone)}>
                                          <span className="truncate w-full text-center" style={CELL_NAME}>{roomLabel}</span>
                                          <span className="truncate w-full text-center tnum" style={CELL_MONEY}>{roomAmount > 0 ? fmtManShort(roomAmount) : NBSP}</span>
                                          <span className="truncate w-full text-center" style={CELL_SUB}>{roomSub}</span>
                                        </div>
                                      : people.map(p => {
                                          const tone = personTone(p)
                                          const isOverdue = tone === 'overdue'
                                          // 일정 슬롯은 늘 있다(빈 줄이라도) — 미납·연체는 색과 함께 말로도 한 번 더 말한다.
                                          const subLine = isOverdue ? `연체 D+${p.daysOverdue}`
                                            : tone === 'unpaid' ? '미납'
                                              : p.status === 'RESERVED' ? (moveInDateLabel(p.moveInDate) ?? DASH_STATUS_LABEL.RESERVED)
                                                : checkoutDateLabel(p.expectedMoveOut)
                                          return (
                                            // 이름·금액·일정 3슬롯 고정 — 두 사람이 서면 두 밴드가 같은 높이로 대칭이 된다.
                                            <div key={p.leaseId} className="grow flex flex-col justify-center px-1 py-2 gap-[3px]" style={bandStyle(tone)}>
                                              <span className="truncate w-full text-center" title={p.displayName} style={CELL_NAME}>{p.displayName}</span>
                                              <span className="truncate w-full text-center tnum" style={isOverdue ? CELL_MONEY_OVERDUE : CELL_MONEY}>{p.amount > 0 ? fmtManShort(p.amount) : NBSP}</span>
                                              <span className="truncate w-full text-center" style={isOverdue ? CELL_SUB_OVERDUE : CELL_SUB}>{subLine ?? NBSP}</span>
                                            </div>
                                          )
                                        })}
                                    {/* 입주 가능 블락 — 사람이 다 나간 뒤 그 방을 언제부터 얼마에 줄 수 있는가(운영자 지시 2026-08-12).
                                        사람 밴드와 같은 3슬롯이고 순서는 늘 맨 아래다. 입주 가능일은 정의상 그 방 어느 계약의
                                        퇴실일보다도 뒤라(사슬 끝 + 1일) 시간순이 어긋날 수 없다.
                                        '공실'이라 부르지 않는다 — 공실은 lib/vacancy 가 정의한 지금형 집계어이고, 이 방들은
                                        오늘 사람이 살고 있어 KPI 가 공실 0실이라 말한다. 같은 화면에서 같은 말이 두 뜻이 된다.
                                        어휘 '입주 가능'은 호실 관리 필터·카드 칩·프리즘 호실 면·매칭 알림이 이미 쓰는 정본이다.
                                        색은 사람 것이라 여기엔 없다(무색) — 사람 없는 타일과 같은 밴드다.
                                        판정은 서버 몫이다. 여기서 occupants 로 다시 세면 이미 잘린 집합을 보게 된다. */}
                                    {people.length > 0 && r.availability && (
                                      <div className="grow flex flex-col justify-center px-1 py-2 gap-[3px]" style={bandStyle('none')}>
                                        <span className="truncate w-full text-center" style={CELL_NAME}>입주 가능</span>
                                        <span className="truncate w-full text-center tnum" style={CELL_MONEY}>{r.availability.rent > 0 ? fmtManShort(r.availability.rent) : NBSP}</span>
                                        <span className="truncate w-full text-center" style={CELL_SUB}>{availableFromLabel(r.availability.from)}</span>
                                      </div>
                                    )}
                                    {/* 가격 변경 예고 꼬리 — 아직 제시가에 안 실린 예약 인상·인하를 미리 말한다(운영자 발제 2026-08-12).
                                        밴드 안이 아니라 꼬리인 이유 — 일정 슬롯은 '사람·방의 상태가 언제 바뀌는가'가 독점한다
                                        ("8/14 퇴실"·"8/17 입실"·"8/30부터"). 그 자리에 돈을 넣으면 뒤엣것도 상태 전환일로 읽히고,
                                        "8/30부터" 옆에 "9/1" 이 서면 그 날 다른 예약이 들어온다는 뜻이 된다(운영자 지적).
                                        가격은 사람 축도 밴드 축도 아닌 방 축의 사실이라 타일 부연 자리가 맞다.
                                        형태는 아래 '+N명' 꼬리 그대로다 — grow 를 주지 않아 3슬롯 대칭을 건드리지 않는다.
                                        둘은 상호배타다(사람이 넷을 채우면 서버가 availability 를 안 내린다).
                                        날짜(M/D)가 아니라 달(M월)로 적는 이유는 lib/fmtMoney fmtOfferRentAhead 주석에 있다. */}
                                    {ahead && (
                                      <div className="truncate w-full text-center tnum px-1 py-[3px]" style={{ ...bandStyle('none'), ...CELL_SUB }}>
                                        {fmtOfferRentAhead(ahead.month, ahead.rent)}
                                      </div>
                                    )}
                                    {/* 다섯 명 이상 — 넷을 세우고 남은 수만 한 줄로. 밴드가 아니라 꼬리라 grow 를 주지 않는다. */}
                                    {r.occupantsMore > 0 && (
                                      <div className="truncate w-full text-center px-1 py-[3px]" style={{ ...bandStyle('none'), ...CELL_SUB }}>
                                        +{r.occupantsMore}명
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )
                            }
                            // 차원 0개 = 한 덩어리(헤더 없이) 표시
                            if (roomDims.length === 0) {
                              return (
                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-[6px]">
                                  {data.rooms.map(r => renderCell(r))}
                                </div>
                              )
                            }
                            return sortedGroups.map(g => (
                              <div key={g.label} className="space-y-1.5">
                                <p style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--warm-muted)' }}>
                                  {g.label}
                                  <span style={{ fontWeight: 400, marginLeft: 4 }}>({g.rooms.length})</span>
                                </p>
                                <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-[6px]">
                                  {g.rooms.map(r => renderCell(r))}
                                </div>
                              </div>
                            ))
                          })()}
                      </>
                    )}
                  </div>

                  {/* 비거주자 현황 */}
                  {data.nonResidentItems.length > 0 && (
                    <div className="rounded-xl p-5 flex flex-col gap-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                      <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>
                        비거주자 현황
                        <span style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 6 }}>{data.nonResidentItems.length}명</span>
                      </p>
                      <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-[6px]">
                        {data.nonResidentItems.map(n => {
                          // 바로 위 방 현황 타일과 같은 클래스 — 헤더 띠·밴드·중립 글자·색 규칙·금액 축약·이름까지
                          // 같은 정본에서 가져온다. 종전 축약(Math.round(rentAmount/10000))은 손실형이라
                          // 329,000 을 33만으로 불렀다(§06 격자 타일 규칙으로 흡수, 32.9만).
                          const tone = personTone({ status: 'NON_RESIDENT', payStatus: n.payStatus, daysOverdue: n.daysOverdue })
                          const isOverdue = tone === 'overdue'
                          return (
                            <div
                              key={n.tenantId}
                              onClick={() => entityModal.open({ kind: 'tenant', tenantId: n.tenantId })}
                              className="room-tile rounded-[8px] flex flex-col cursor-pointer overflow-hidden"
                            >
                              <div className="truncate w-full text-center tnum px-1 py-[3px]" style={CELL_HEAD}>{fmtRoomNo(n.roomNo)}</div>
                              <div className="grow flex flex-col justify-center px-1 py-2 gap-[3px]" style={bandStyle(tone)}>
                                <span className="truncate w-full text-center" title={n.displayName} style={CELL_NAME}>{n.displayName}</span>
                                <span className="truncate w-full text-center tnum" style={isOverdue ? CELL_MONEY_OVERDUE : CELL_MONEY}>{n.rentAmount > 0 ? fmtManShort(n.rentAmount) : NBSP}</span>
                                <span className="truncate w-full text-center" style={isOverdue ? CELL_SUB_OVERDUE : CELL_SUB}>{isOverdue ? `연체 D+${n.daysOverdue}` : tone === 'unpaid' ? '미납' : NBSP}</span>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                </div>{/* /좌측 */}

                {/* 우측: 이달 미수납 + 납입 완료 (하나의 연결된 카드) */}
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>

                  {/* 이달 미수납 */}
                  <div>
                    <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
                      <div className="flex items-center gap-2">
                        <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>이달 미수납 <span style={{ fontSize: '0.65625rem', fontWeight: 400, color: 'var(--warm-muted)' }}>납부일 전 인원 포함</span></h3>
                        <span className="rounded-full text-[0.65625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{basisLabel}</span>
                      </div>
                      {data.unpaidCount > 0 && (
                        <span className="rounded-full text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'color-mix(in srgb, var(--coral) 10%, transparent)', color: 'var(--coral)' }}>
                          {data.unpaidCount}건
                        </span>
                      )}
                    </div>
                    {sortedUnpaid.length === 0 ? (
                      <p className="text-sm text-center py-6" style={{ color: 'var(--warm-muted)' }}>이달 수납 완료</p>
                    ) : (
                      <>
                        <div>
                          {visibleUnpaid.map((l, i) => {
                            const dl = daysLabel(l.daysOverdue, l.deferredDue)
                            return (
                              <div
                                key={i}
                                className="w-full flex items-center gap-3 px-5 py-3"
                                style={{ borderBottom: i < visibleUnpaid.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}
                              >
                              <button
                                onClick={() => entityModal.open({ kind: 'payment', leaseTermId: l.leaseId, tenantId: l.tenantId })}
                                className="flex-1 min-w-0 flex items-center gap-3 hover:opacity-70 active:opacity-50 transition-opacity text-left"
                              >
                                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                                  style={{ background: 'var(--cream-3)', fontSize: '0.6875rem', color: 'var(--ink-mute)' }}>
                                  {l.tenantName.slice(0, 1)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold truncate flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
                                    {fmtRoomNo(l.roomNo)} {l.tenantName}
                                    {/* v2.0 §24 — 1~6일 경과=미납(warning), 7일↑=연체 D+N(overdue). §03 OVERDUE=7일 초과 */}
                                    {/* 기한을 미뤄준 건은 수납관리가 '납부 유예'(await/Blue)로 부른다.
                                        여기만 '납부일 전'(중립 회색)으로 남으면 한 사정을 두 화면이
                                        다른 라벨·다른 색으로 부른다(웹디자이너 지적 2026-08-02). */}
                                    {l.deferredDue ? (
                                      <span className="rounded-full text-[0.65625rem] font-bold px-1.5 py-0.5" style={{ background: 'var(--badge-await-bg)', color: 'var(--badge-await-fg)' }}>
                                        납부 유예
                                      </span>
                                    ) : l.daysOverdue != null && l.daysOverdue >= 7 ? (
                                      <span className="rounded-full text-[0.65625rem] font-bold px-1.5 py-0.5" style={{ background: 'var(--badge-overdue-bg)', color: 'var(--badge-overdue-fg)' }}>
                                        연체 D+{l.daysOverdue}
                                      </span>
                                    ) : l.daysOverdue != null && l.daysOverdue >= 1 ? (
                                      <span className="rounded-full text-[0.65625rem] font-bold px-1.5 py-0.5" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}>
                                        미납
                                      </span>
                                    ) : l.daysOverdue != null && l.daysOverdue < 0 ? (
                                      <span className="rounded-full text-[0.65625rem] font-bold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>
                                        납부일 전
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="text-[0.65625rem] font-medium mt-0.5" style={{ color: dl.color }}>{dl.text}</p>
                                </div>
                              </button>
                              <div className="flex flex-col items-end gap-1 shrink-0">
                                <span className="rounded-full text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--danger-bg)', color: 'var(--tc)' }}>
                                  {fmtKorMoney(l.unpaidAmount)}
                                </span>
                                {/* 안내문자 — 입금확인 스텝을 거쳐 템플릿 발송(오발송 방지) */}
                                <button type="button"
                                  onClick={() => setSmsTarget({ leaseId: l.leaseId, tenantId: l.tenantId, tenantName: l.tenantName, roomNo: l.roomNo, unpaidAmount: l.unpaidAmount, daysOverdue: l.daysOverdue })}
                                  className="min-h-[44px] inline-flex items-center text-[0.65625rem] px-2.5 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors">
                                  안내문자
                                </button>
                              </div>
                              </div>
                            )
                          })}
                        </div>
                        {sortedUnpaid.length > UNPAID_LIMIT && (
                          <button
                            onClick={() => setUnpaidExpanded(v => !v)}
                            className="w-full py-2.5 text-xs font-medium flex items-center justify-center gap-1 hover:opacity-70 transition-opacity"
                            style={{ borderTop: `1px solid ${DIVIDER_COLOR}`, color: 'var(--warm-muted)' }}
                          >
                            {unpaidExpanded
                              ? <>접기 ↑</>
                              : <>더보기 <span style={{ color: 'var(--coral)' }}>+{sortedUnpaid.length - UNPAID_LIMIT}</span> ↓</>}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                  {/* 구분선 */}
                  <div style={{ borderTop: `2px solid ${DIVIDER_COLOR}` }} />

                  {/* 납입 완료 */}
                  <div>
                    <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
                      <div className="flex items-center gap-2">
                        <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>납입 완료</h3>
                        <span className="rounded-full text-[0.65625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{basisLabel}</span>
                      </div>
                      {data.activity.length > 0 && (
                        <span className="rounded-full text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                          {data.activity.length}건
                        </span>
                      )}
                    </div>
                    {data.activity.length === 0 ? (
                      <p className="text-sm text-center py-6" style={{ color: 'var(--warm-muted)' }}>최근 납입 내역 없음</p>
                    ) : (
                      <>
                        <div>
                          {(activityExpanded ? data.activity : data.activity.slice(0, ACTIVITY_LIMIT)).map((item, i, arr) => (
                            <button
                              key={i}
                              onClick={() => entityModal.open({ kind: 'payment', tenantId: item.tenantId })}
                              className="w-full flex items-center gap-3 px-5 py-3 hover:opacity-70 transition-opacity active:opacity-50 text-left"
                              style={{ borderBottom: i < arr.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}
                            >
                              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                                style={{ background: 'var(--success-bg)', fontSize: '0.6875rem', color: 'var(--success)' }}>
                                {item.tenantName.slice(0, 1)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-2)' }}>{fmtRoomNo(item.roomNo)} {item.tenantName}</p>
                                <p className="text-[0.65625rem] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>{item.timeLabel}</p>
                              </div>
                              {item.badgeLabel && (
                                <span className="rounded-full shrink-0 text-[0.65625rem] font-semibold px-2 py-0.5" style={item.badgeTone === 'late'
                                  ? { background: 'var(--warning-bg)', color: 'var(--warning-fg)' }
                                  : { background: 'var(--info-bg)', color: 'var(--info-fg)' }}>
                                  {item.badgeLabel}
                                </span>
                              )}
                              <span className="rounded-full shrink-0 text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
                                {fmtKorMoney(item.amount)}
                              </span>
                            </button>
                          ))}
                        </div>
                        {data.activity.length > ACTIVITY_LIMIT && (
                          <button
                            onClick={() => setActivityExpanded(v => !v)}
                            className="w-full py-2.5 text-xs font-medium flex items-center justify-center gap-1 hover:opacity-70 transition-opacity"
                            style={{ borderTop: `1px solid ${DIVIDER_COLOR}`, color: 'var(--warm-muted)' }}
                          >
                            {activityExpanded
                              ? <>접기 ↑</>
                              : <>더보기 <span style={{ color: 'var(--success)' }}>+{data.activity.length - ACTIVITY_LIMIT}</span> ↓</>}
                          </button>
                        )}
                      </>
                    )}
                  </div>

                </div>{/* /우측 */}

              </div>

              {/* ── 소개 페이지 반영 대기 — 공개 후보(공실·사진 있음) / 철회 후보(입주 중인데 공개) ── */}
              {[
                { list: data.publishCandidates,   title: '소개 페이지에 올릴 수 있는 방', show: true,  label: '공개' },
                { list: data.unpublishCandidates, title: '소개 페이지에서 내릴 수 있는 방', show: false, label: '내림' },
              ].map(card => card.list.length === 0 ? null : (
                <div key={card.title} className="rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                  <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
                    <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>{card.title}</h3>
                    <span className="rounded-full text-[0.65625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{card.list.length}건</span>
                  </div>
                  <div>
                    {card.list.map((r, i, arr) => (
                      <div key={r.id} className="flex items-center gap-3 px-5 py-3"
                        style={{ borderBottom: i < arr.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
                        <div className="w-16 h-16 shrink-0 rounded-lg overflow-hidden bg-[var(--canvas)]">
                          {r.thumbUrl ? (
                            <img src={r.thumbUrl} alt={fmtRoomNo(r.roomNo)} className="w-full h-full object-cover" />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ opacity: 0.4 }}>
                                <path d="M3 12 L12 4 L21 12 M5 10 V20 H19 V10" />
                              </svg>
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-2)' }}>{fmtRoomNo(r.roomNo)}{r.tier ? ` ${r.tier}` : ''}</p>
                          <p className="text-[0.65625rem] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>{fmtKorMoney(r.baseRent)}</p>
                        </div>
                        <button type="button" disabled={siteBusy}
                          onClick={() => handleShowOnSite(r.id, card.show)}
                          className="min-h-[44px] inline-flex items-center text-[0.65625rem] px-2.5 rounded-md border border-[var(--coral)]/45 text-[var(--coral)] hover:bg-[var(--coral)]/10 transition-colors disabled:opacity-50">
                          {card.label}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </>
          )}

          {tab === 'finance' && <FinanceTab data={data} targetMonth={targetMonth} />}
          {tab === 'tenants' && <TenantsTab data={data} />}
          {tab === 'ai'      && <AiTab data={data} targetMonth={targetMonth} />}
        </div>
      </div>

      {/* RoomDetailPopup 제거됨 — 호실 클릭은 EntityModal(Pivot)로 일원화 (호실/고객/수납 통일된 탭) */}
      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onOpenPayment={a => {
            setSelectedAlert(null)
            // 알림에서 '수납 관리 보기' → Prism 수납 face 로 통일 (Tenant·Payment 모달과 동일 셸).
            // roomNo·tenantName 은 셸이 내부에서 fetch 해 채운다.
            // leaseTermId 없으면 tenantId 로 정본이 최신 계약을 해석(getEntityLinks)
            entityModal.open({
              kind: 'payment',
              leaseTermId: a.leaseTermId ?? null,
              tenantId: a.tenantId ?? null,
              roomId: a.roomId ?? null,
            })
          }}
          onStartRecord={handleStartRecord}
        />
      )}
      {recordingRec && (
        <RecurringExpenseRecordModal
          rec={recordingRec}
          financialAccounts={recAccounts}
          paymentMethods={paymentMethods}
          onClose={() => setRecordingRec(null)}
          onDone={() => { setRecordingRec(null); pushToast('success', '지출이 기록되었습니다'); router.refresh() }}
        />
      )}
      {tenantInfoId && (
        <TenantQuickModal
          tenantId={tenantInfoId}
          onClose={() => setTenantInfoId(null)}
        />
      )}
      </>)}
    </div>
  )
}
