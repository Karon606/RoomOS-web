'use client'

import Link from 'next/link'
import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { Btn } from '@/components/ui/Btn'
import { Loading } from '@/components/ui/Loading'
import { DatePicker } from '@/components/ui/DatePicker'
import MonthSelector from '@/components/layout/MonthSelector'
import { getTrendData, type TrendRange, type TrendPoint } from './actions'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { PendingReceiptSection } from '@/components/dashboard/PendingReceiptSection'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Modal } from '@/components/ui/Modal'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { CHART_COLORS, chartColor, GENDER_COLORS, STATUS_COLORS, CONCEPT_COLORS } from '@/lib/chartColors'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { getTenantLeaseForDashboard, getPaymentsByLease, savePayment, saveDepositPayment, updatePayment, deletePayment, getTenantQuickInfo } from '@/app/(app)/rooms/actions'
import { recordRecurringExpense } from '@/app/(app)/finance/actions'
import { confirmReservationToActive, checkoutTenant, checkoutWithDepositRefund } from '@/app/(app)/tenants/actions'
import { kstYmdStr, kstMonthStr } from '@/lib/kstDate'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { ALERT_URGENT_WITHIN_DAYS, ALERT_URGENT_CATEGORY_DAYS } from '@/lib/appConfig'

const fmtRoomNo = (no: string | null | undefined) =>
  no ? (/^\d+$/.test(no) ? `${no}호` : no) : '—'

// ── 타입 ────────────────────────────────────────────────────────

export type DashboardData = {
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
  depositRecorded:   number     // 보유 보증금 중 실수납(입금기록 있음)
  depositUnrecorded: number     // 보유 보증금 중 미기록(전 원장 등 계약상만)
  reserveBalance:    number
  reserveMonthly:    { deposit: number; withdraw: number }
  operatingCashAvailable: number  // = netProfit - 이 달 매출에서 적립된 예비비
  reserveAccrualFromThisMonth: number
  paidCount:         number
  unpaidCount:       number
  upcomingCount:     number
  pendingCount:      number
  pendingRevenue:    number     // 수납 예정 = 예상매출 − 수납완료 (손익 정합용)
  unpaidAmount:      number
  overdueAmount:     number
  upcomingAmount:    number
  totalExpected:     number
  categoryBreakdown: { category: string; amount: number; percent: number }[]
  trend:             { month: string; revenue: number; expense: number; profit: number }[]
  totalRooms:        number
  vacantRooms:       number
  occupiedRooms:     number
  statusCounts:      { active: number; reserved: number; checkout: number; nonResident: number; waitingTour: number }
  totalTenants:      number
  genderDist:        { label: string; count: number; percent: number }[]
  nationalityDist:   { label: string; count: number; percent: number }[]
  jobDist:           { label: string; count: number; percent: number }[]
  rooms:             { id: string; roomNo: string; isVacant: boolean; tenantName: string | null; tenantId: string | null; tenantStatus: string | null; nonResidentName: string | null; nonResidentId: string | null; type: string | null; tier: string | null; floor: string | null; windowType: string | null; direction: string | null; areaPyeong: number | null; areaM2: number | null; baseRent: number; scheduledRent: number | null; rentUpdateDate: string | null }[]
  nonResidentItems:  { roomNo: string; tenantId: string; tenantName: string; rentAmount: number; payStatus: 'paid' | 'awaiting' | 'unpaid' }[]
  alerts:            { category?: 'unpaid' | 'upcoming' | 'moveout' | 'movein' | 'tour' | 'wish' | 'request' | 'recurring' | 'inventory'; text: string; link: string; dotColor: string; timeLabel: string; tenantId?: string; detail?: string; exactDate?: string; recurringExpenseId?: string; recurringAmount?: number; recurringDueDate?: string; recurringCategory?: string; recurringPayMethod?: string; recurringIsVariable?: boolean; recurringHistoricalAvg?: number; wishCandidates?: { tenantId: string; tenantName: string; rank: number; matchedBy: 'rooms' | 'conditions' }[]; wishRoomNo?: string; reservationDueLeaseId?: string; reservationDueRoomNo?: string | null; moveOutLeaseId?: string; moveOutDepositAmount?: number; moveOutCleaningFee?: number; moveOutTenantName?: string; sortKey?: number; leaseTermId?: string; roomId?: string | null }[]
  expectedExpense:   number
  hasExpenseHistory: boolean
  activity:          { text: string; timeLabel: string; dotColor: string; link: string; tenantId: string; tenantName: string; roomNo: string; amount: number }[]
  unpaidLeases:      { roomNo: string; tenantName: string; tenantId: string; leaseId: string; daysOverdue: number | null; unpaidAmount: number; monthsOverdue: number }[]
  unpaidRoomNosForView: string[]
  awaitingRoomNosForView: string[]
}

// ── 레이블 ──────────────────────────────────────────────────────

const DASH_WINDOW_LABEL: Record<string, string> = { OUTER: '외창', INNER: '내창' }
const DASH_DIR_LABEL: Record<string, string> = {
  NORTH: '북향', NORTH_EAST: '북동향', EAST: '동향', SOUTH_EAST: '남동향',
  SOUTH: '남향', SOUTH_WEST: '남서향', WEST: '서향', NORTH_WEST: '북서향',
}
// RESERVED 라벨 '예약' 통일 — 수납·호실관리·고객관리·lib/statusColors 와 동일 용어
const DASH_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정',
}

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

function daysLabel(daysOverdue: number | null): { text: string; color: string } {
  if (daysOverdue == null) return { text: '—', color: 'var(--warm-muted)' }
  if (daysOverdue > 0)  return { text: `${daysOverdue}일 경과`, color: 'var(--tc)' }
  if (daysOverdue === 0) return { text: '오늘 납부일', color: 'var(--viz-4)' }
  return { text: `D${daysOverdue} (${Math.abs(daysOverdue)}일 남음)`, color: 'var(--viz-4)' }
}

// ── 알림 상세 팝업 ───────────────────────────────────────────────

type AlertItem = DashboardData['alerts'][number]

function CheckoutRefundModal({
  tenantName, depositAmount, cleaningFee, pending, onClose, onConfirm,
}: {
  tenantName: string
  depositAmount: number
  cleaningFee: number
  pending: boolean
  onClose: () => void
  onConfirm: (refundAmount: number) => void
}) {
  // 환불 가능 최대 = 보증금 - 청소비 (청소비 0이면 보증금 전액)
  const maxRefund = Math.max(0, depositAmount - cleaningFee)
  const [refund, setRefund] = useState(maxRefund)
  const unreturned = depositAmount - refund
  const exceedsMax = refund > maxRefund

  return (
    <Modal open onClose={onClose} z={260} width="sm" title="보증금 환불" subtitle={`${tenantName}님 퇴실 정산`}
      dirty={refund !== maxRefund}
      footer={
        <div className="flex gap-2">
          <button onClick={onClose} disabled={pending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            취소
          </button>
          <button
            onClick={() => onConfirm(refund)}
            disabled={pending || exceedsMax}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: 'var(--viz-4)', color: 'white' }}>
            {pending ? '처리 중...' : '퇴실 처리'}
          </button>
        </div>
      }>
        <div className="px-5 py-4 space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="bg-[var(--canvas)] rounded-lg px-3 py-2">
              <p style={{ color: 'var(--warm-muted)' }}>보증금</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: 'var(--warm-dark)' }}>
                {depositAmount.toLocaleString()}원
              </p>
            </div>
            <div className="bg-[var(--canvas)] rounded-lg px-3 py-2">
              <p style={{ color: 'var(--warm-muted)' }}>청소비 차감</p>
              <p className="text-sm font-semibold mt-0.5" style={{ color: cleaningFee > 0 ? 'var(--tc)' : 'var(--warm-mid)' }}>
                {cleaningFee > 0 ? `-${cleaningFee.toLocaleString()}원` : '없음'}
              </p>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>
              환불 금액 (최대 {maxRefund.toLocaleString()}원)
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={refund.toLocaleString()}
              onChange={e => {
                const n = Number(e.target.value.replace(/[^0-9]/g, ''))
                setRefund(isNaN(n) ? 0 : n)
              }}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
            />
            {exceedsMax && (
              <p className="text-[0.6875rem] text-[var(--danger-fg)]">환불 금액은 최대 {maxRefund.toLocaleString()}원입니다.</p>
            )}
          </div>

          <div className="rounded-lg px-3 py-2.5 text-xs space-y-1" style={{ background: 'rgba(244,98,58,0.08)', color: 'var(--warm-dark)' }}>
            <div className="flex justify-between">
              <span style={{ color: 'var(--warm-muted)' }}>환불</span>
              <span className="font-medium">{refund.toLocaleString()}원</span>
            </div>
            {unreturned > 0 && (
              <div className="flex justify-between">
                <span style={{ color: 'var(--warm-muted)' }}>부가수익 귀속 (보증금)</span>
                <span className="font-medium">{unreturned.toLocaleString()}원</span>
              </div>
            )}
            <p className="text-[0.625rem] pt-1" style={{ color: 'var(--warm-muted)' }}>
              미환불분은 부가수익 카테고리 &apos;보증금&apos; · 입금수단 &apos;보유 보증금&apos;으로 자동 등록됩니다.
            </p>
          </div>
        </div>
    </Modal>
  )
}

function AlertDetailModal({ alert, onClose, onOpenPayment, onStartRecord }: {
  alert: AlertItem
  onClose: () => void
  onOpenPayment: (alert: AlertItem) => void
  onStartRecord: (alert: AlertItem) => void
}) {
  const router = useRouter()
  const initial = alert.text.slice(0, 1)
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

  const handleConfirmActive = async () => {
    if (!reservationDueLeaseId || confirmPending) return
    setConfirmPending(true); setConfirmError('')
    const res = await confirmReservationToActive(reservationDueLeaseId)
    if (!res.ok) { setConfirmError(res.error); setConfirmPending(false); return }
    router.refresh()
    onClose()
  }

  const handleCheckout = async () => {
    if (!moveOutLeaseId || !alert.tenantId || confirmPending) return
    // 보증금이 있으면 환불 모달 띄우기
    if (moveOutDeposit > 0) {
      setRefundModalOpen(true)
      return
    }
    // 보증금 없는 경우 바로 처리
    if (!(await confirmDialog({ title: '퇴실 처리할까요?', message: '호실이 공실로 전환됩니다.', level: 'caution', confirmLabel: '퇴실 처리' }))) return
    setConfirmPending(true); setConfirmError('')
    const res = await checkoutTenant(moveOutLeaseId, alert.tenantId)
    if (!res.ok) { setConfirmError(res.error); setConfirmPending(false); return }
    router.refresh()
    onClose()
  }

  const handleRefundConfirm = async (refundAmount: number) => {
    if (!moveOutLeaseId || !alert.tenantId || confirmPending) return
    setConfirmPending(true); setConfirmError('')
    const res = await checkoutWithDepositRefund({
      leaseTermId:  moveOutLeaseId,
      tenantId:     alert.tenantId,
      refundAmount,
    })
    if (!res.ok) { setConfirmError(res.error); setConfirmPending(false); return }
    setRefundModalOpen(false)
    router.refresh()
    onClose()
  }

  return (
    <Modal open onClose={onClose} width="sm"
      title={
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold"
            style={{ background: avatarBg, fontSize: '0.875rem', color: alert.dotColor }}>
            {initial}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold leading-snug" style={{ color: 'var(--ink-2)' }}>{alert.text}</p>
            <span className="inline-block mt-1.5 text-[0.625rem] font-semibold rounded-full px-2 py-0.5"
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
              {alert.wishRoomNo ? `${alert.wishRoomNo}호 매칭 후보` : '매칭 후보'} · {alert.wishCandidates.length}명 (등록 순)
            </p>
            <div className="space-y-1.5">
              {alert.wishCandidates.map(c => (
                <Link
                  key={c.tenantId}
                  href={`/tenants?tenantId=${c.tenantId}`}
                  onClick={onClose}
                  className="flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors hover:bg-[var(--canvas)]"
                  style={{ borderColor: 'var(--warm-border)' }}
                >
                  <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[0.6875rem] font-bold"
                    style={{ background: c.rank === 1 ? 'var(--success-bg)' : 'var(--canvas)', color: c.rank === 1 ? 'var(--success)' : 'var(--warm-mid)' }}>
                    {c.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--warm-dark)' }}>{c.tenantName}님</p>
                    <p className="text-[0.625rem] mt-0.5" style={{ color: 'var(--warm-muted)' }}>
                      {c.matchedBy === 'conditions' ? '조건 매칭' : '호실 지정'}
                    </p>
                  </div>
                  <span style={{ color: 'var(--warm-muted)', fontSize: '0.875rem' }}>›</span>
                </Link>
              ))}
            </div>
          </div>
        ) : (
          alert.detail && (
            <div className="px-5 py-4" style={{ borderBottom: isRecurring || alert.tenantId ? `1px solid ${DIVIDER_COLOR}` : undefined }}>
              <p className="text-sm whitespace-pre-line leading-relaxed" style={{ color: 'var(--warm-dark)' }}>{alert.detail}</p>
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
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: 'var(--success)', color: 'white' }}>
              {confirmPending ? '처리 중...' : '거주중으로 변경'}
            </button>
          )}
          {moveOutLeaseId && (
            <button
              onClick={handleCheckout}
              disabled={confirmPending}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: 'var(--viz-4)', color: 'white' }}>
              {confirmPending ? '처리 중...' : '퇴실 처리'}
            </button>
          )}
          {isRecurring && (
            <Btn
              onClick={() => { onStartRecord(alert); onClose() }}
              variant="primary" size="md" fullWidth className="font-semibold">
              지출 기록하기
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
            className="block w-full text-center text-xs font-medium py-2 rounded-xl border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            {isRecurring ? '지출/기타 수익에서 보기 →'
              : alert.category === 'inventory' ? '재고 관리에서 보기 →'
              : alert.category === 'request' ? '요청·컴플레인에서 보기 →'
              : alert.wishCandidates && alert.wishCandidates.length > 0 ? '호실 관리로 이동 →'
              : '입주자 관리에서 보기 →'}
          </Link>
        </div>
      {refundModalOpen && (
        <CheckoutRefundModal
          tenantName={moveOutTenantName}
          depositAmount={moveOutDeposit}
          cleaningFee={moveOutCleaning}
          pending={confirmPending}
          onClose={() => { if (!confirmPending) setRefundModalOpen(false) }}
          onConfirm={handleRefundConfirm}
        />
      )}
    </Modal>
  )
}

// ── 고정 지출 기록 폼 모달 ────────────────────────────────────────

function RecurringExpenseFormModal({ alert, paymentMethods, onClose, onDone }: {
  alert: AlertItem
  paymentMethods: string[]
  onClose: () => void
  onDone: () => void
}) {
  const suggestedAmount = alert.recurringIsVariable && alert.recurringHistoricalAvg ? alert.recurringHistoricalAvg : (alert.recurringAmount ?? 0)
  const [amount, setAmount]       = useState(suggestedAmount)
  const [date, setDate]           = useState(alert.recurringDueDate ?? kstYmdStr())
  const [payMethod, setPayMethod] = useState(alert.recurringPayMethod ?? '')
  const [detail, setDetail]       = useState('')
  const [memo, setMemo]           = useState('')
  const [pending, startTransition] = useTransition()
  const [error, setError]         = useState('')
  const [done, setDone]           = useState(false)

  const handleSubmit = () => {
    if (!alert.recurringExpenseId) return
    startTransition(async () => {
      const res = await recordRecurringExpense({
        recurringExpenseId: alert.recurringExpenseId!,
        amount,
        date,
        payMethod: payMethod || undefined,
        memo: memo || undefined,
      })
      if (res.ok) { setDone(true); setTimeout(onDone, 800) }
      else setError(res.error)
    })
  }

  // §13.2 dirty — 제안값에서 바뀌었거나 추가 입력이 있으면 닫기 확인
  const dirty = !done && (amount !== suggestedAmount || detail !== '' || memo !== '')

  return (
    <Modal open onClose={onClose} width="sm" title="지출 등록" dirty={dirty}>
        {done ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-[var(--success-fg)]">지출이 기록되었습니다</p>
          </div>
        ) : (
          <div className="px-5 py-4 space-y-3">
            {/* 날짜 + 금액 */}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>날짜 *</label>
                <DatePicker value={date} onChange={setDate}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
              </div>
              <div className="space-y-1.5">
                <div className="flex items-center gap-1.5">
                  <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>금액 *</label>
                  {alert.recurringIsVariable && alert.recurringHistoricalAvg && (
                    <span className="text-[0.625rem] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(99,102,241,0.1)', color: 'var(--viz-2)' }}
                      title="과거 동일 항목 결제 기록의 평균">
                      과거 평균 {fmtKorMoney(alert.recurringHistoricalAvg)}
                    </span>
                  )}
                </div>
                <input type="text" inputMode="numeric"
                  value={amount ? amount.toLocaleString() : ''}
                  onChange={e => setAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                  placeholder="0원"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
              </div>
            </div>

            {/* 카테고리 (읽기 전용) */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>카테고리</label>
              <div className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm"
                style={{ color: 'var(--warm-muted)' }}>
                {alert.recurringCategory ?? '—'}
              </div>
            </div>

            {/* 세부 항목 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>세부 항목</label>
              <input type="text" value={detail} onChange={e => setDetail(e.target.value)}
                placeholder="세부 내용"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>

            {/* 결제 수단 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>결제수단</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                <option value="">선택 안 함</option>
                {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* 메모 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>메모</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                placeholder="메모 (선택)"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>

            {error && <p className="text-xs text-[var(--danger-fg)]">{error}</p>}

            {/* 버튼 */}
            <div className="flex gap-2 pt-1">
              <Btn onClick={onClose} variant="secondary" size="md" className="flex-1">
                취소
              </Btn>
              <Btn onClick={handleSubmit} disabled={pending || !amount || !date}
                variant="primary" size="md" className="flex-1 font-semibold">
                {pending ? '저장 중…' : '저장'}
              </Btn>
            </div>
          </div>
        )}
    </Modal>
  )
}

// ── 알림 스트립 — 카테고리별 그룹핑 (iOS 알림센터 스타일) ────────────

type AlertCat = 'unpaid' | 'upcoming' | 'moveout' | 'movein' | 'tour' | 'wish' | 'request' | 'recurring' | 'inventory' | 'other'
const CATEGORY_ORDER: AlertCat[] = ['unpaid', 'upcoming', 'moveout', 'movein', 'tour', 'wish', 'request', 'recurring', 'inventory', 'other']
const CATEGORY_META: Record<AlertCat, { label: string; color: string }> = {
  unpaid:    { label: '누적 미수',    color: 'var(--tc)' },
  upcoming:  { label: '납부 예정',    color: 'var(--viz-4)' },
  moveout:   { label: '퇴실 예정',    color: 'var(--viz-4)' },
  movein:    { label: '입실 희망',    color: 'var(--camel)' },
  tour:      { label: '투어 예정',    color: 'var(--ink)' },
  wish:      { label: '희망 호실/조건 매칭', color: 'var(--success)' },
  request:   { label: '요청·컴플레인',color: 'var(--persimmon)' },
  recurring: { label: '고정 지출',    color: 'var(--viz-2)' },
  inventory: { label: '재고 부족',    color: 'var(--viz-4)' },
  other:     { label: '기타',         color: 'var(--ink-m)' },
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
        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
          style={{ background: hexToRgba(item.dotColor, 0.12), fontSize: '0.6875rem', color: item.dotColor }}>
          {item.text.slice(0, 1)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-2)' }}>{item.text}</p>
          <p className="text-[0.625rem] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>
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
  const restItems = withU.filter(x => x.u > x.t)

  // 예정: 긴급 존에 안 든 항목만 카테고리 그룹 (그룹 내 가까운 순)
  const groups = (() => {
    const map = new Map<AlertCat, { a: AlertItem; u: number }[]>()
    for (const x of restItems) {
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
          <span className="rounded-full text-[0.5625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>미처리</span>
        </div>
        <span className="rounded-full text-[0.625rem] font-semibold px-2 py-0.5" style={{ background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>
          {alerts.length}건
        </span>
      </div>

      {/* ── 지금 급함 — 카테고리 무관, 항상 펼침 ── */}
      {urgent.length > 0 && (
        <div style={{ borderBottom: groups.length > 0 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
          <div className="flex items-center gap-2 px-5 py-2.5" style={{ background: 'var(--danger-bg)' }}>
            <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--tc)' }} />
            <span className="text-[0.6875rem] font-bold flex-1 text-left" style={{ color: 'var(--tc)' }}>긴급</span>
            <span className="text-[0.625rem] font-medium" style={{ color: 'var(--warm-muted)' }}>{urgent.length}건</span>
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
              <span className="text-[0.625rem] font-medium" style={{ color: 'var(--warm-muted)' }}>
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

function DonutChart({
  segments, centerLabel, centerSub, size = 140, strokeWidth = 22,
}: {
  segments: { value: number; color: string }[]
  centerLabel?: string; centerSub?: string; size?: number; strokeWidth?: number
}) {
  const r = (size - strokeWidth) / 2
  const cx = size / 2; const cy = size / 2
  const C = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)
  let cumulativeAngle = -90
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--cream-3)" strokeWidth={strokeWidth} />
      ) : (
        segments.filter(s => s.value > 0).map((seg, i) => {
          const pct = seg.value / total
          const dashLength = pct * C
          const angle = cumulativeAngle
          cumulativeAngle += pct * 360
          return (
            <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${C - dashLength}`}
              transform={`rotate(${angle}, ${cx}, ${cy})`} />
          )
        })
      )}
      {centerLabel && <text x={cx} y={cy + 6} textAnchor="middle" fontSize="15" fontWeight="700" fill="var(--ink-2)">{centerLabel}</text>}
      {centerSub && <text x={cx} y={cy + 22} textAnchor="middle" fontSize="10" fill="var(--neutral-fg)">{centerSub}</text>}
    </svg>
  )
}

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
  const categorySegments = data.categoryBreakdown.map((c, i) => ({
    value: c.amount,
    color: chartColor(i),
  }))
  // §23.2 — 결제상태 차트는 개념색(완납=success·예정=info·미납=warning)
  const paymentSegments = [
    { value: data.paidCount,     color: CONCEPT_COLORS.paid },
    { value: data.upcomingCount, color: CONCEPT_COLORS.await },
    { value: data.unpaidCount,   color: CONCEPT_COLORS.unpaid },
  ]
  const paymentTotal = data.paidCount + data.upcomingCount + data.unpaidCount
  const paymentRate = paymentTotal > 0
    ? Math.round((data.paidCount / paymentTotal) * 100)
    : 0

  return (
    <div className="space-y-5">
      {/* ── 세부 재무 요약 ── 모바일 2칸·태블릿 3칸·데스크탑 5칸 (긴 금액이 칸 넘어가지 않게) */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--warm-border)' }}>
        <div
          className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
          style={{ borderColor: 'var(--warm-border)', background: 'var(--cream)' }}
        >
          {([
            { label: '수납액 (귀속)', value: data.paidRevenue,  color: 'var(--coral)' },
            { label: '기타수익', value: data.extraRevenue, color: 'var(--viz-4)' },
            { label: '지출',     value: data.totalExpense, color: 'var(--tc)' },
            { label: '순수익',   value: data.netProfit,    color: data.netProfit >= 0 ? 'var(--success)' : 'var(--tc)' },
            // 보유 보증금 = 계약 기준 총액(유지). 아래 분해로 실수납/미기록(전 원장) 표시.
            { label: '보유 보증금', value: data.totalDeposit, color: 'var(--ink)',
              sub: `실수납 ${fmtKorMoney(data.depositRecorded)} · 미기록 ${fmtKorMoney(data.depositUnrecorded)}` },
          ] as { label: string; value: number; color: string; sub?: string }[]).map((item, i) => (
            <div
              key={i}
              className="px-3 py-3 text-center min-w-0"
              style={{ borderRight: '1px solid var(--warm-border)', borderBottom: '1px solid var(--warm-border)' }}
            >
              <p className="text-[10.5px] font-medium mb-1 truncate" style={{ color: 'var(--warm-muted)' }}>{item.label}</p>
              <p className="text-[13px] font-bold leading-tight break-all" style={{ color: item.color }}>
                <MoneyDisplay amount={Math.abs(item.value)} prefix={item.value < 0 ? '-' : ''} />
              </p>
              {item.sub && (
                <p className="text-[8.5px] mt-0.5 leading-tight" style={{ color: 'var(--warm-muted)' }}>{item.sub}</p>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* ── 추이 ── */}
      <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-mid)' }}>추이</h3>
          <div className="flex gap-4 text-xs" style={{ color: 'var(--warm-muted)' }}>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--coral)' }} />수입</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--ink-m)' }} />지출</span>
          </div>
        </div>
        <div className="flex gap-1 mb-4 flex-wrap">
          {TREND_RANGES.map(r => (
            <button key={r.key} onClick={() => setTrendRange(r.key)} disabled={trendPending}
              className="px-2.5 py-1 text-xs rounded-lg transition-colors font-medium disabled:opacity-50"
              style={trendRange === r.key
                ? { background: 'var(--coral)', color: '#fff' }
                : { background: 'var(--canvas)', color: 'var(--warm-mid)' }}>
              {r.label}
            </button>
          ))}
        </div>
        {trendPending ? (
          <div className="h-44 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
          </div>
        ) : isAreaRange ? (
          /* ── 일간·주간: Area Chart ── */
          <ResponsiveContainer width="100%" height={176}>
            <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
              <defs>
                <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--coral)" stopOpacity={0.18} />
                  <stop offset="95%" stopColor="var(--coral)" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="gradExp" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="var(--neutral-fg)" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="var(--neutral-fg)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: '0.625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => v === 0 ? '0' : `${v}만`} tick={{ fontSize: '0.625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                contentStyle={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)', borderRadius: 8, fontSize: '0.75rem' }}
                formatter={(v, name) => [`${Number(v).toLocaleString()}만원`, String(name)]}
              />
              <Area type="monotone" dataKey="revenue" name="수입" stroke="var(--coral)" strokeWidth={2} fill="url(#gradRev)" dot={false} activeDot={{ r: 4, fill: 'var(--coral)' }} />
              <Area type="monotone" dataKey="expense" name="지출" stroke="var(--neutral-fg)" strokeWidth={1.5} strokeDasharray="4 2" fill="url(#gradExp)" dot={false} activeDot={{ r: 4, fill: 'var(--ink-m)' }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          /* ── 월간 이상: Grouped Bar Chart ── */
          <ResponsiveContainer width="100%" height={176}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: '0.625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => v === 0 ? '0' : `${v}만`} tick={{ fontSize: '0.625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                contentStyle={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)', borderRadius: 8, fontSize: '0.75rem' }}
                formatter={(v, name) => [`${Number(v).toLocaleString()}만원`, String(name)]}
              />
              <Bar dataKey="revenue" name="수입" fill="var(--coral)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" name="지출" fill="var(--neutral-fg)"       radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>지출 카테고리</h3>
          {data.categoryBreakdown.length === 0 ? (
            <p className="text-sm py-6 text-center" style={{ color: 'var(--warm-muted)' }}>이달 지출 없음</p>
          ) : (
            <div className="flex items-center gap-5">
              <div className="shrink-0">
                <DonutChart segments={categorySegments} centerLabel={`${data.totalExpense > 0 ? Math.round(data.totalExpense / 10000) : 0}만`} centerSub="총 지출" />
              </div>
              <div className="flex-1 space-y-2.5 min-w-0">
                {data.categoryBreakdown.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: chartColor(i) }} />
                    <span className="text-xs truncate flex-1" style={{ color: 'var(--warm-mid)' }}>{c.category}</span>
                    <span className="text-xs shrink-0" style={{ color: 'var(--warm-dark)' }}>{c.percent}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>수납 현황</h3>
          <div className="flex items-center gap-5">
            <div className="shrink-0">
              <DonutChart segments={paymentSegments} centerLabel={`${paymentRate}%`} centerSub="수납률" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONCEPT_COLORS.paid }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>완납</span>
                <span className="text-sm font-semibold" style={{ color: CONCEPT_COLORS.paid }}>{data.paidCount}건</span>
              </div>
              {data.upcomingCount > 0 && (
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONCEPT_COLORS.await }} />
                  <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>수납예정</span>
                  <span className="text-sm font-semibold" style={{ color: CONCEPT_COLORS.await }}>{data.upcomingCount}건</span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CONCEPT_COLORS.unpaid }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>미납</span>
                <span className="text-sm font-semibold" style={{ color: CONCEPT_COLORS.unpaid }}>{data.unpaidCount}건</span>
              </div>
              <div className="pt-2" style={{ borderTop: '1px solid var(--warm-border)' }}>
                <Row label="이달 수납액 (귀속)" value={<MoneyDisplay amount={data.paidRevenue} />} />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 입주자 탭 ───────────────────────────────────────────────────

function TenantsTab({ data }: { data: DashboardData }) {
  const occupancyRate = data.totalRooms > 0 ? Math.round((data.occupiedRooms / data.totalRooms) * 100) : 0
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
        <StatCard label="예약" value={`${data.statusCounts.reserved}명`}    sub=""  colorStyle={{ color: STATUS_COLORS.reserved }} />
        <StatCard label="퇴실 예정" value={`${data.statusCounts.checkout}명`}    sub=""  colorStyle={{ color: STATUS_COLORS.checkout }} />
        <StatCard label="비거주자"  value={`${data.statusCounts.nonResident}명`} sub=""  colorStyle={{ color: STATUS_COLORS.nonResident }} />
        <StatCard label="투어 대기" value={`${data.statusCounts.waitingTour}명`} sub=""  colorStyle={{ color: 'var(--ink)' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>호실 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={occupancySegments} centerLabel={`${occupancyRate}%`} centerSub="입주율" />
            <div className="space-y-2.5 flex-1">
              {[{ label: '거주중', val: `${data.occupiedRooms}실`, dot: 'var(--persimmon)' }, { label: '공실', val: `${data.vacantRooms}실`, dot: 'var(--cream-3)' }, { label: '전체', val: `${data.totalRooms}실`, dot: '' }].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  {r.dot ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.dot }} /> : <span className="w-2 h-2 shrink-0" />}
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{r.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--warm-dark)' }}>{r.val}</span>
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
              {[{ label: '거주중', count: data.statusCounts.active, color: STATUS_COLORS.active }, { label: '예약', count: data.statusCounts.reserved, color: STATUS_COLORS.reserved }, { label: '퇴실 예정', count: data.statusCounts.checkout, color: STATUS_COLORS.checkout }].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{s.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--warm-dark)' }}>{s.count}명</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>성별 분포</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={genderSegments} centerLabel={`${data.totalTenants}명`} centerSub="전체" />
            <div className="space-y-2.5 flex-1">
              {data.genderDist.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GENDER_COLORS[d.label] ?? 'var(--ink-m)' }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{GENDER_LABEL[d.label] ?? d.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--warm-dark)' }}>{d.count}명</span>
                </div>
              ))}
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
        setError(`분석 요청 실패 (${res.status}): ${await res.text().catch(() => '')}`)
        return
      }
      if (!res.body) {
        setError('스트림을 읽을 수 없습니다.')
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
            <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>Gemini AI 재무 분석</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--warm-muted)' }}>{targetMonth} 운영 데이터 기반 AI 분석</p>
          </div>
          <button onClick={handleAnalyze} disabled={isLoading}
            className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60"
            style={{ background: 'var(--coral)' }}>
            {isLoading
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />분석 중...</>
              : 'AI 분석하기'}
          </button>
        </div>
        {!aiText && !isLoading && !error && (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--warm-muted)' }}>버튼을 눌러 이달 재무 현황 AI 분석을 시작하세요</div>
        )}
        {isLoading && !aiText && (
          <div className="flex items-center gap-3 py-8 justify-center text-sm" style={{ color: 'var(--coral)' }}>
            <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
            Gemini가 재무 데이터를 분석하고 있습니다...
          </div>
        )}
        {error && <p className="text-[var(--danger-fg)] text-sm py-4 text-center">{error}</p>}
        {aiText && (
          <div className="rounded-xl p-4" style={{ background: 'var(--coral-pale)', border: '1px solid rgba(244,98,58,0.2)' }}>
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--warm-dark)' }}>
              {aiText}
              {isLoading && <span className="inline-block w-1.5 h-4 bg-current opacity-70 animate-pulse ml-0.5 align-middle" />}
            </div>
            {!isLoading && <button onClick={handleAnalyze} className="mt-3 text-xs" style={{ color: 'var(--coral)' }}>↻ 다시 분석</button>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 입주자 수납 팝업 (대시보드용) ────────────────────────────────

type DashLease = Awaited<ReturnType<typeof getTenantLeaseForDashboard>>
type DashPayRecord = { id: string; seqNo: number; actualAmount: number; payDate: Date; payMethod: string | null; memo: string | null; isDeposit: boolean }

function DashboardTenantModal({ tenantId, targetMonth, paymentMethods, onClose, onPaymentDone }: {
  tenantId: string
  targetMonth: string
  paymentMethods: string[]
  onClose: () => void
  onPaymentDone?: () => void
}) {
  const [lease, setLease] = useState<DashLease>(null)
  const [payHistory, setPayHistory] = useState<DashPayRecord[]>([])
  const [acquisitionDate, setAcquisitionDate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [payAmount, setPayAmount] = useState(0)
  const [payDate, setPayDate] = useState(kstYmdStr())
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  // 직전에 사용한 납부방법 — 연속 수납 입력 시 자동 prefill (전역 공유)
  const [lastPayMethod, setLastPayMethod] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem('stayeum-last-pay-method') ?? '') : ''
  )
  const [editAmount, setEditAmount] = useState(0)
  const [editDate, setEditDate] = useState('')
  const [editPayMethod, setEditPayMethod] = useState('')
  const [editMemo, setEditMemo] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [editingAutoPay, setEditingAutoPay] = useState(false)
  const [autoPayDate, setAutoPayDate] = useState('')

  const reload = async (l: DashLease) => {
    if (!l) return
    const { records, acquisitionDate: acq } = await getPaymentsByLease(l.id, targetMonth)
    setPayHistory(records as DashPayRecord[])
    setAcquisitionDate(acq ? new Date(acq) : null)
  }

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoading(true)
      const l = await getTenantLeaseForDashboard(tenantId, targetMonth)
      if (cancelled) return
      setLease(l)
      if (l) {
        setPayAmount(l.rentAmount)
        const { records, acquisitionDate: acq, lastPayMethod: leaseLast } = await getPaymentsByLease(l.id, targetMonth)
        if (cancelled) return
        setPayHistory(records as DashPayRecord[])
        setAcquisitionDate(acq ? new Date(acq) : null)
        // #5: 이 입주자(lease)의 최근 납부방법을 기본값으로 (전역 localStorage 대신 입주자별)
        setLastPayMethod(leaseLast ?? '')
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tenantId, targetMonth])

  if (!lease && !loading) {
    return (
      <Modal open onClose={onClose} width="xs">
        <div className="p-6 text-center">
          <p className="text-sm text-[var(--warm-muted)]">활성 계약을 찾을 수 없습니다.</p>
          <button onClick={onClose} className="mt-3 text-sm font-medium" style={{ color: 'var(--coral)' }}>닫기</button>
        </div>
      </Modal>
    )
  }

  const isPreAcq = (p: DashPayRecord) => !!(acquisitionDate && new Date(p.payDate) < acquisitionDate)
  const depositRecords = payHistory.filter(p => p.isDeposit)
  const regularRecords = payHistory.filter(p => !p.isDeposit && !p.memo?.startsWith('[납입일변경]'))
  const adjRecords = payHistory.filter(p => p.memo?.startsWith('[납입일변경]'))
  const prevOwnerPaid = regularRecords.filter(isPreAcq).reduce((s, p) => s + p.actualAmount, 0)
  const regularPaid = regularRecords.reduce((s, p) => s + p.actualAmount, 0) - prevOwnerPaid
  const adjNet = adjRecords.reduce((s, p) => s + p.actualAmount, 0)
  // viewMonth(targetMonth) 단일 정산 — 5월 입금 - 5월 청구
  const viewBalance = lease ? regularPaid + adjNet - lease.rentAmount : 0
  // 누적 잔액 = 이월(carryOver) + viewMonth 정산
  // carryOver < 0 = 이월 미수, viewBalance < 0 = 이번 달 잔액 부족
  const carryOver = lease?.carryOver ?? 0
  const balance = viewBalance + carryOver

  // 양도인 자동 완납 여부 계산
  const cutoffDate2 = lease?.property.prevOwnerCutoffDate ?? lease?.property.acquisitionDate ?? null
  const cutoffMonthStr2 = cutoffDate2
    ? `${new Date(cutoffDate2).getFullYear()}-${String(new Date(cutoffDate2).getMonth() + 1).padStart(2, '0')}`
    : null
  const cutoffDay2 = cutoffDate2 ? new Date(cutoffDate2).getDate() : 0
  const dueDayNum = lease?.dueDay ? parseInt(lease.dueDay, 10) : 0
  const isAutoPaidNoBilling = !!(
    cutoffMonthStr2 && targetMonth === cutoffMonthStr2 &&
    !isNaN(dueDayNum) && dueDayNum < cutoffDay2 &&
    regularRecords.length === 0
  )
  const getDueDateStr = () => {
    if (!lease?.dueDay) return ''
    const [y, m] = targetMonth.split('-').map(Number)
    if (lease.dueDay === '말') return `${y}년 ${m}월 ${new Date(y, m, 0).getDate()}일`
    const d = parseInt(lease.dueDay, 10)
    return isNaN(d) ? '' : `${y}년 ${m}월 ${d}일`
  }
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const fmtDate = (d: Date | string) => {
    const dt = new Date(d)
    return `${dt.getMonth() + 1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})`
  }

  const handleSave = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!lease) return
    const fd = new FormData(e.currentTarget)
    const payMethod = fd.get('payMethod') as string
    const memo = fd.get('memo') as string
    startTransition(async () => {
      const release = trackSave()
      try {
        if (isDepositMode) {
          await saveDepositPayment({
            leaseTermId: lease.id,
            tenantId,
            targetMonth,
            depositAmount: lease.depositAmount,
            rentAmount: lease.rentAmount,
            totalPaid: payAmount,
            payDate,
            payMethod,
            memo: memo || undefined,
          })
        } else {
          await savePayment({
            leaseTermId: lease.id,
            tenantId,
            targetMonth,
            expectedAmount: lease.rentAmount,
            actualAmount: payAmount,
            payDate,
            payMethod,
            memo,
          })
        }
        if (payMethod) {
          localStorage.setItem('stayeum-last-pay-method', payMethod)
          setLastPayMethod(payMethod)
        }
        setShowForm(false)
        setIsDepositMode(false)
        await reload(lease)
        onPaymentDone?.()
        pushToast('success', isDepositMode ? '보증금 수납됨' : '월세 수납됨')
      } catch (err: unknown) {
        const msg = (err as Error).message
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 수납 기록을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        await deletePayment(id)
        await reload(lease)
        pushToast('success', '수납 기록 삭제됨')
      } finally { release() }
    })
  }

  const startEdit = (p: DashPayRecord) => {
    setEditingId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    startTransition(async () => {
      const res = await updatePayment(editingId, { actualAmount: editAmount, payDate: editDate, payMethod: editPayMethod, memo: editMemo || undefined })
      if (!res.ok) { setError(res.error); return }
      setEditingId(null)
      await reload(lease)
    })
  }

  // §13.2 dirty — 수납/수정 입력이 진행 중이면 닫기 확인 (금융 입력 유실 방지)
  const formDirty = !loading && (editingId !== null || editingAutoPay)

  return (
    <Modal open onClose={onClose} width="md" dirty={formDirty}
      title={loading
        ? <div className="h-5 w-32 bg-[var(--cream-3)] rounded animate-pulse" />
        : <h2 className="text-base font-bold text-[var(--warm-dark)] truncate">
            {lease?.room?.roomNo ? `${fmtRoomNo(lease.room.roomNo)} — ` : ''}{lease?.tenant.name}
          </h2>}
      subtitle={loading ? undefined : `${targetMonth} · 예정 ${lease?.rentAmount.toLocaleString()}원`}
      footer={!loading && lease ? (
        <div className="flex gap-2">
          <Link href={`/rooms?month=${targetMonth}`}
            onClick={onClose}
            className="flex-1 text-center text-xs font-medium py-2 rounded-xl border transition-colors"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            수납 관리 →
          </Link>
          <Link href={`/tenants?tenantId=${lease.tenant.id}&tab=info`}
            onClick={onClose}
            className="flex-1 text-center text-xs font-medium py-2 rounded-xl border transition-colors"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            입주자 관리 →
          </Link>
        </div>
      ) : undefined}>
        <div>
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {error && <p className="text-xs text-[var(--danger-fg)] bg-[var(--danger-bg)] rounded-xl px-3 py-2">{error}</p>}

              {/* 수납 현황 — 누적 미수(이월 + viewMonth 도래 후 미회수) 정확히 반영 */}
              {(() => {
                // viewMonth 도래 여부: 같은 월이면 dueDay 비교, 과거면 자동 도래, 미래면 미도래
                const dueDay = lease?.dueDay ? parseInt(lease.dueDay, 10) : 0
                const [tY, tM] = targetMonth.split('-').map(Number)
                const today = new Date()
                const todayY = today.getFullYear(), todayM = today.getMonth() + 1
                let viewDuePassed: boolean
                if (tY > todayY || (tY === todayY && tM > todayM)) viewDuePassed = false
                else if (tY < todayY || (tY === todayY && tM < todayM)) viewDuePassed = true
                else {
                  if (dueDay >= 1 && dueDay <= 31) {
                    const td = new Date(tY, tM - 1, Math.min(dueDay, new Date(tY, tM, 0).getDate()))
                    td.setHours(23, 59, 59, 999)
                    viewDuePassed = today >= td
                  } else viewDuePassed = true
                }
                // 진짜 미수 = 이월 미수 + (도래 후 viewMonth 미회수만)
                const trueUnpaid = (carryOver < 0 ? -carryOver : 0)
                                 + (viewDuePassed && viewBalance < 0 ? -viewBalance : 0)
                const truePrepaid = (carryOver > 0 ? carryOver : 0)
                                  + (viewBalance > 0 ? viewBalance : 0)
                const thirdLabel = trueUnpaid > 0 ? '미수' : truePrepaid > 0 ? '선납' : '정상'
                const thirdValue = trueUnpaid > 0
                  ? `-${trueUnpaid.toLocaleString()}원`
                  : truePrepaid > 0 ? `+${truePrepaid.toLocaleString()}원` : '0원'
                const thirdColor = trueUnpaid > 0 ? 'var(--tc)' : truePrepaid > 0 ? 'var(--success)' : 'var(--warm-mid)'
                return (
                  <>
                    <div className="grid grid-cols-3 gap-2">
                      {[
                        { label: '이달 청구', value: `${lease!.rentAmount.toLocaleString()}원`, color: 'var(--warm-dark)' },
                        { label: '이달 납부', value: `${regularPaid.toLocaleString()}원`, color: regularPaid >= lease!.rentAmount ? 'var(--success)' : 'var(--warm-dark)' },
                        { label: thirdLabel, value: thirdValue, color: thirdColor },
                      ].map(item => (
                        <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                          <p className="text-[0.625rem] text-[var(--warm-muted)] mb-1">{item.label}</p>
                          <p className="text-xs font-bold mono tnum" style={{ color: item.color }}>{item.value}</p>
                        </div>
                      ))}
                    </div>
                    {/* carryOver(이월) 별도 보조 표시 — 0이 아닐 때만 */}
                    {carryOver !== 0 && (
                      <p className="text-[0.6875rem] text-[var(--warm-muted)] mt-1.5 text-center">
                        {carryOver < 0 ? (
                          <>이월 미수 <span className="text-[var(--danger-fg)] font-medium mono tnum">{Math.abs(carryOver).toLocaleString()}원</span> 포함</>
                        ) : (
                          <>이월 선납 <span className="text-[var(--success-fg)] font-medium mono tnum">{carryOver.toLocaleString()}원</span> 포함</>
                        )}
                        {!viewDuePassed && viewBalance < 0 && (
                          <span className="ml-1.5 text-[var(--warm-muted)]">(이달 청구 {Math.abs(viewBalance).toLocaleString()}원은 도래 전)</span>
                        )}
                      </p>
                    )}
                  </>
                )
              })()}

              {/* 납부 내역 */}
              {(payHistory.length > 0 || isAutoPaidNoBilling) && (
                <div className="space-y-2">
                  {isAutoPaidNoBilling && (() => {
                    const getAutoDefault = () => {
                      const [y, m] = targetMonth.split('-').map(Number)
                      const dd = lease!.dueDay
                      if (!dd) return `${targetMonth}-01`
                      if (dd === '말') return `${y}-${String(m).padStart(2,'0')}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`
                      const d = parseInt(dd, 10)
                      return isNaN(d) ? `${targetMonth}-01` : `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
                    }
                    const handleSaveAutoPay = () => {
                      if (!lease || !autoPayDate) return
                      startTransition(async () => {
                        try {
                          await savePayment({
                            leaseTermId: lease.id,
                            tenantId: lease.tenant.id,
                            targetMonth,
                            expectedAmount: lease.rentAmount,
                            actualAmount: lease.rentAmount,
                            payDate: autoPayDate,
                            payMethod: '양도인 수납',
                            memo: '양도인 귀속 수납',
                          })
                          setEditingAutoPay(false)
                          await reload(lease)
                        } catch (e) {
                          setError(e instanceof Error ? e.message : '저장 실패')
                        }
                      })
                    }
                    return editingAutoPay ? (
                      <div className="bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-sm px-3 py-2.5 space-y-2">
                        <p className="text-xs font-semibold text-[var(--info-fg)]">양도인 수납 — 납부일 직접 입력</p>
                        <div className="flex gap-2 items-center">
                          <div className="flex-1">
                            <DatePicker value={autoPayDate} onChange={setAutoPayDate}
                              className="bg-[var(--canvas)] border border-[var(--info-ring)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                          </div>
                          <button onClick={handleSaveAutoPay} disabled={isPending || !autoPayDate}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-[var(--info-solid)] hover:bg-[var(--info-solid)] rounded-lg transition-colors disabled:opacity-50">저장</button>
                          <button onClick={() => setEditingAutoPay(false)}
                            className="px-3 py-1.5 text-xs text-[var(--info-fg)] rounded-lg border border-[var(--info-ring)] hover:bg-[var(--info-bg)] transition-colors">취소</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-sm px-3 py-2.5">
                        <div>
                          <p className="text-xs font-semibold text-[var(--info-fg)]">양도인 수납</p>
                          <button onClick={() => { setAutoPayDate(getAutoDefault()); setEditingAutoPay(true) }}
                            className="text-[0.625rem] text-[var(--info-fg)] mt-0.5 hover:underline text-left">
                            {getDueDateStr()} 납부 (자동) · <span className="underline">날짜 수정</span>
                          </button>
                        </div>
                        <p className="text-xs font-semibold text-[var(--info-fg)]">{lease!.rentAmount.toLocaleString()}원</p>
                      </div>
                    )
                  })()}
                  {depositRecords.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-[var(--warm-mid)]">보증금 수납 내역</p>
                      {depositRecords.map(p => (
                        editingId === p.id ? (
                          <DashEditRow key={p.id} editAmount={editAmount} editDate={editDate} editPayMethod={editPayMethod} editMemo={editMemo}
                            setEditAmount={setEditAmount} setEditDate={setEditDate} setEditPayMethod={setEditPayMethod} setEditMemo={setEditMemo}
                            onSave={handleSaveEdit} onCancel={() => setEditingId(null)} isPending={isPending} color="purple" />
                        ) : (
                          <DashPayRow key={p.id} p={p} isPreAcq={false} onEdit={startEdit} onDelete={handleDelete} color="purple" />
                        )
                      ))}
                    </>
                  )}
                  {prevOwnerPaid > 0 && (
                    <div className="flex items-center justify-between bg-[var(--info-bg)] border border-[var(--info-ring)] rounded-xl px-3 py-2">
                      <p className="text-xs text-[var(--info-fg)]">양도인 귀속</p>
                      <p className="text-xs font-semibold text-[var(--info-fg)]">{prevOwnerPaid.toLocaleString()}원</p>
                    </div>
                  )}
                  {regularRecords.length > 0 && (
                    <>
                      <p className="text-xs font-medium text-[var(--warm-mid)]">납부 내역</p>
                      {regularRecords.map(p => (
                        editingId === p.id ? (
                          <DashEditRow key={p.id} editAmount={editAmount} editDate={editDate} editPayMethod={editPayMethod} editMemo={editMemo}
                            setEditAmount={setEditAmount} setEditDate={setEditDate} setEditPayMethod={setEditPayMethod} setEditMemo={setEditMemo}
                            onSave={handleSaveEdit} onCancel={() => setEditingId(null)} isPending={isPending} color={isPreAcq(p) ? 'amber' : 'default'} />
                        ) : (
                          <DashPayRow key={p.id} p={p} isPreAcq={isPreAcq(p)} onEdit={startEdit} onDelete={handleDelete} color={isPreAcq(p) ? 'amber' : 'default'} />
                        )
                      ))}
                    </>
                  )}
                </div>
              )}

              {/* 수납 입력 폼 */}
              {showForm ? (
                <form onSubmit={handleSave} className="space-y-3 rounded-xl border border-[var(--warm-border)] p-4" style={{ background: 'var(--canvas)' }}>
                  {lease!.depositAmount > 0 && (
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={isDepositMode} onChange={e => {
                        setIsDepositMode(e.target.checked)
                        if (e.target.checked) setPayAmount(lease!.depositAmount)
                        else setPayAmount(lease!.rentAmount)
                      }} className="accent-[var(--coral)]" />
                      <span className="text-xs font-medium text-[var(--warm-dark)]">보증금 수납 ({lease!.depositAmount.toLocaleString()}원)</span>
                    </label>
                  )}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[0.625rem] text-[var(--warm-muted)]">금액</p>
                      <input type="text" inputMode="numeric"
                        value={payAmount.toLocaleString()}
                        onChange={e => setPayAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[0.625rem] text-[var(--warm-muted)]">납부일</p>
                      <DatePicker value={payDate} onChange={setPayDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[0.625rem] text-[var(--warm-muted)]">납부방법</p>
                      {/* #5: key에 lastPayMethod 포함 — lease 최근 방법 도착 시 remount되어 기본값 반영 */}
                      <select key={`pm-${tenantId}-${lastPayMethod}`} name="payMethod" defaultValue={lastPayMethod}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                        <option value="">선택 안 함</option>
                        {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[0.625rem] text-[var(--warm-muted)]">메모</p>
                      <input name="memo" type="text"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                    </div>
                  </div>
                  {isDepositMode && payAmount > lease!.depositAmount && (
                    <p className="text-[0.625rem] text-[var(--coral)]">
                      초과금 {(payAmount - lease!.depositAmount).toLocaleString()}원 → {targetMonth} 이용료 처리
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setShowForm(false); setIsDepositMode(false) }}>취소</Btn>
                    <Btn type="submit" variant="primary" size="md" className="flex-1" disabled={isPending}>
                      {isPending ? '저장 중…' : '저장'}
                    </Btn>
                  </div>
                </form>
              ) : (
                <Btn onClick={() => setShowForm(true)} variant="primary" size="md" fullWidth>
                  + 수납 입력
                </Btn>
              )}
            </div>
          )}
        </div>
    </Modal>
  )
}

function DashPayRow({ p, isPreAcq, onEdit, onDelete, color }: {
  p: DashPayRecord; isPreAcq: boolean
  onEdit: (p: DashPayRecord) => void; onDelete: (id: string) => void
  color: 'purple' | 'amber' | 'default'
}) {
  const bg = color === 'purple' ? 'bg-[var(--deposit-bg)] border border-[var(--deposit-ring)]' : color === 'amber' ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'
  const textColor = color === 'purple' ? 'text-[var(--deposit-fg)]' : color === 'amber' ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'
  const amountColor = color === 'purple' ? 'text-[var(--deposit-fg)]' : color === 'amber' ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const fmtD = (d: Date | string) => { const dt = new Date(d); return `${dt.getMonth()+1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})` }
  return (
    <div className={`flex items-center justify-between rounded-sm px-3 py-2.5 ${bg}`}>
      <div>
        <p className={`text-xs ${textColor}`}>
          {p.seqNo}회차 · {fmtD(p.payDate)} · {p.payMethod ?? '—'}
          {color === 'purple' && <span className="ml-1.5 text-[0.625rem] font-semibold bg-[var(--deposit-bg)] text-[var(--deposit-fg)] rounded px-1 py-0.5">보증금</span>}
          {isPreAcq && <span className="ml-1.5 text-[0.625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1 py-0.5">양도인</span>}
        </p>
        {p.memo && !p.isDeposit && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${amountColor}`}>{p.actualAmount.toLocaleString()}원</span>
        <div className="flex gap-1.5 ml-1">
          <button onClick={() => onEdit(p)} className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>수정</button>
          <button onClick={() => onDelete(p.id)} className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">삭제</button>
        </div>
      </div>
    </div>
  )
}

function DashEditRow({ editAmount, editDate, editPayMethod, editMemo, setEditAmount, setEditDate, setEditPayMethod, setEditMemo, onSave, onCancel, isPending, color }: {
  editAmount: number; editDate: string; editPayMethod: string; editMemo: string
  setEditAmount: (v: number) => void; setEditDate: (v: string) => void; setEditPayMethod: (v: string) => void; setEditMemo: (v: string) => void
  onSave: () => void; onCancel: () => void; isPending: boolean; color: 'purple' | 'amber' | 'default'
}) {
  const borderColor = color === 'purple' ? 'border-[var(--deposit-ring)]' : color === 'amber' ? 'border-[var(--info-ring)]' : 'border-[var(--coral)]'
  const bg = color === 'purple' ? 'bg-[var(--deposit-bg)]' : color === 'amber' ? 'bg-[var(--info-bg)]' : 'bg-[var(--canvas)]'
  return (
    <div className={`rounded-xl border ${borderColor} ${bg} px-3 py-2.5 space-y-2`}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[0.625rem] text-[var(--warm-muted)]">금액</p>
          <input type="text" inputMode="numeric" value={editAmount.toLocaleString()} onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
        <div className="space-y-1">
          <p className="text-[0.625rem] text-[var(--warm-muted)]">납부일</p>
          <DatePicker value={editDate} onChange={setEditDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[0.625rem] text-[var(--warm-muted)]">납부방법</p>
          <input type="text" value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)} placeholder="계좌이체, 현금…"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
        <div className="space-y-1">
          <p className="text-[0.625rem] text-[var(--warm-muted)]">메모</p>
          <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="text-xs px-3 py-1.5 min-h-[36px] rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>취소</button>
        <button onClick={onSave} disabled={isPending} className="text-xs text-white px-3 py-1.5 min-h-[36px] rounded-lg transition-colors disabled:opacity-50" style={{ background: 'var(--coral)' }}>저장</button>
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
const LEASE_STATUS_LABEL: Record<string, string> = { ACTIVE: '거주중', RESERVED: '예약', CHECKOUT_PENDING: '퇴실 예정' }

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
      title={loading ? '불러오는 중…' : (info?.name ?? '입주자 정보')}>
        {loading ? (
          <Loading />
        ) : !info ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--warm-muted)]">입주자 정보를 찾을 수 없습니다.</div>
        ) : (
          <div className="px-5 py-4 space-y-2 text-sm">
            {/* 기본 정보 */}
            <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-1">기본 정보</p>
            {info.gender && (
              <div className="flex justify-between">
                <span className="text-[var(--warm-muted)]">성별</span>
                <span className="text-[var(--warm-dark)]">{GENDER_LABEL_KO[info.gender] ?? info.gender}</span>
              </div>
            )}
            {info.birthdate && (
              <div className="flex justify-between">
                <span className="text-[var(--warm-muted)]">생년월일</span>
                <span className="text-[var(--warm-dark)]">{new Date(info.birthdate).toLocaleDateString('ko-KR')}</span>
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
                  <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-2">연락처</p>
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
                <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-2">계약 정보</p>
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
                  <span className="font-semibold text-[var(--warm-dark)]">{lease.rentAmount.toLocaleString()}원</span>
                </div>
                {lease.depositAmount > 0 && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">보증금</span>
                    <span className="text-[var(--warm-dark)]">{lease.depositAmount.toLocaleString()}원</span>
                  </div>
                )}
                {lease.dueDay && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">납부일</span>
                    <span className="text-[var(--warm-dark)]">매월 {lease.dueDay}일</span>
                  </div>
                )}
                {lease.moveInDate && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">입실일</span>
                    <span className="text-[var(--warm-dark)]">{new Date(lease.moveInDate).toLocaleDateString('ko-KR')}</span>
                  </div>
                )}
                {(lease.expectedMoveOut ?? lease.moveOutDate) && (
                  <div className="flex justify-between mb-1">
                    <span className="text-[var(--warm-muted)]">퇴실(예정)</span>
                    <span className="text-[var(--warm-dark)]">{new Date((lease.expectedMoveOut ?? lease.moveOutDate)!).toLocaleDateString('ko-KR')}</span>
                  </div>
                )}
              </div>
            )}

            {/* 메모 */}
            {info.memo && (
              <div className="border-t border-[var(--warm-border)] pt-2 mt-1">
                <p className="text-[0.625rem] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-1">메모</p>
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

export default function DashboardClient({ data, targetMonth, paymentMethods }: { data: DashboardData; targetMonth: string; paymentMethods: string[] }) {
  const router = useRouter()
  // viewMonth가 현재이면 "오늘 기준", 그 외(과거/미래)는 "○월 말일 기준"
  const isViewingRealMonth = targetMonth === kstMonthStr()
  const basisLabel = isViewingRealMonth
    ? '오늘 기준'
    : `${Number(targetMonth.slice(5))}월 말일 기준`
  const [tab, setTab]                             = useState<Tab>('overview')
  // 호실 클릭 → 통합 EntityModal(Pivot) 으로 열기 (공실은 호실 탭만 활성, 고객·수납은 비활성으로 통일)
  const entityModal = useEntityModal()
  const [dashTenantId, setDashTenantId]           = useState<string | null>(null)
  const [tenantInfoId, setTenantInfoId]           = useState<string | null>(null)
  const [selectedAlert, setSelectedAlert]         = useState<AlertItem | null>(null)
  const [recordingAlert, setRecordingAlert]       = useState<AlertItem | null>(null)
  const [unpaidExpanded, setUnpaidExpanded]       = useState(false)
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

  return (
    <div className="space-y-3.5">

      {/* ── 기간(월) 셀렉터 — 우측 정렬 ────────────────────────────── */}
      <div className="flex justify-end">
        <MonthSelector />
      </div>

      {/* ── Row 1: 알림 ─────────────────────────────────────────── */}
      <AlertsStrip alerts={data.alerts} onOpenAlert={setSelectedAlert} />

      {/* ── 찍어 올리기 + 등록 대기 (영수증/물품 AI 분류) ─────────────────────────── */}
      <PendingReceiptSection />

      {/* ── KPI 카드 (§23.5 반응형: 모바일 2 → sm 3 → lg 4) ──────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3.5">

        {/* Row 2 Left: 예상 매출 + 달성도 — 고시원 특성상 유지되면 매출이 거의 안 늘어 '현재까지'보다
            '예상 매출 대비 성과(수납 달성도)'가 유효. 예상엔 퇴실예정(일할/0)·신규 예약확정(전액) 반영됨. */}
        <div className="rounded-xl" style={{ background: 'var(--coral)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(255,252,247,0.55)', marginBottom: 8 }}>
            예상 매출
            <span style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 6, color: 'rgba(255,252,247,0.5)' }}>(이번 달)</span>
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.projectedRevenue.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'rgba(255,252,247,0.5)', marginLeft: 3 }}>원</small>
          </p>
          {(() => {
            const pct = data.projectedRevenue > 0 ? Math.min(100, Math.round((data.totalRevenue / data.projectedRevenue) * 100)) : 0
            return (
              <>
                <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,252,247,0.22)', overflow: 'hidden', margin: '2px 0 6px' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: '#fff', borderRadius: 3 }} />
                </div>
                {/* §23.1 — 보조 1줄(달성도). 완료/예정/미납 건 상세는 수납 관리로 이동 */}
                <p style={{ fontSize: '0.65625rem', color: 'rgba(255,252,247,0.55)', lineHeight: 1.5 }}>
                  수납 {data.totalRevenue.toLocaleString()}원 · 달성 <em style={{ fontStyle: 'normal', color: 'var(--rev-change)', fontWeight: 700 }}>{pct}%</em>
                </p>
              </>
            )
          })()}
        </div>

        {/* Row 2 Right: 예상 순이익 + 달성도 — 매출 위젯과 동일 방식(예상 큰 숫자 + 현재/예상 달성 bar).
            다크 카드 유지(순이익 구분). 예비비 이체분 있으면 운영 가용 자금 보조 표시. */}
        {(() => {
          const expectedNet = data.projectedNetProfit   // 예상 매출 − 예상 지출 (월말 전망)
          const currentNet  = data.netProfit            // 현재 장부(수납 − 실제 지출) — 지출 덜 빠져 과대평가됨
          const isPosExp = expectedNet >= 0
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
                예상 순이익
                <span style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 6, color: 'var(--np-cap)' }}>(이번 달)</span>
              </p>
              <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: isPosExp ? 'var(--np-pos)' : 'var(--np-neg)' }}>
                {isPosExp ? '+' : ''}{expectedNet.toLocaleString()}
                <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--np-unit)', marginLeft: 2 }}>원</small>
              </p>
              <div style={{ height: 5, borderRadius: 3, background: 'rgba(255,252,247,0.18)', overflow: 'hidden', margin: '2px 0 6px' }}>
                <div style={{ height: '100%', width: `${expenseBooked}%`, background: 'var(--np-pos)', borderRadius: 3 }} />
              </div>
              {/* §23.1 — 보조 1줄(현재 장부·지출 반영도). 남은 지출·예비비 이체 상세는 지출/기타수익으로 이동 */}
              <p style={{ fontSize: '0.65625rem', color: 'var(--np-cap)', lineHeight: 1.5 }}>
                현재 장부 <em style={{ fontStyle: 'normal', color: currentNet >= 0 ? 'var(--np-pos)' : 'var(--np-neg)', fontWeight: 700 }}>{currentNet >= 0 ? '+' : ''}{fmtKorMoney(currentNet)}</em> · 지출 <em style={{ fontStyle: 'normal', color: 'var(--np-pos)', fontWeight: 700 }}>{expenseBooked}%</em> 반영
              </p>
            </div>
          )
        })()}

        {/* Row 3 Left: 누적 미납 — §23.1 경고 타입(연체 시 좌 3px danger). 납부 예정 상세는 수납 관리로 */}
        <Link href="/rooms" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px',
            boxShadow: data.overdueAmount > 0 ? 'inset 3px 0 0 var(--danger-fg)' : undefined }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            누적 미납
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: data.overdueAmount > 0 ? 'var(--tc)' : 'var(--ink-2)' }}>
            {data.overdueAmount.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: '0.65625rem', color: 'var(--warm-muted)' }}>
            <em style={{ fontStyle: 'normal', color: data.unpaidCount > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>{data.unpaidCount}건</em> · 도래·미회수
          </p>
        </Link>

        {/* Row 3 Right: 예상 지출 — 통제가능성 3단계 스택 막대(줄일 수 있는 정도 순).
            색(디자인 토큰): 고정(정액)=ink-2(임대료 등·못 줄임) · 고정(변동)=warm-mid(공과금 등·노력시 줄임) · 수시=coral(비고정·가장 줄이기 쉬움). */}
        <Link href="/finance?tab=expense" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '0.65625rem', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            예상 지출 <span style={{ fontSize: '0.5625rem', fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 4, color: 'var(--warm-muted)' }}>(이번 달)</span>
          </p>
          <p className="mono tnum" style={{ fontSize: '1.375rem', fontWeight: 700, color: 'var(--ink-2)', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.expectedExpense.toLocaleString()}
            <small style={{ fontSize: '0.6875rem', fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
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
                {/* §23.1 — 보조 1줄(통제가능성 막대 범례). 현재까지·전월/전년 추세는 지출/기타수익으로 이동 */}
                <p style={{ fontSize: '0.625rem', color: 'var(--warm-muted)', lineHeight: 1.5 }}>
                  <span style={{ color: 'var(--ink-2)' }}>●</span> 고정(정액) {fmtKorMoney(t.immovable)} · <span style={{ color: 'var(--warm-mid)' }}>●</span> 고정(변동) {fmtKorMoney(t.variable)} · <span style={{ color: 'var(--coral)' }}>●</span> 수시 {fmtKorMoney(t.savable)}
                </p>
              </>
            )
          })()}
        </Link>

        {/* Row 4 Left: 보유 보증금 */}
        <Link href="/finance?tab=deposit" className="rounded-xl block hover:opacity-90 active:opacity-75 transition-opacity" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
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
          </p>
        </Link>
      </div>

      {/* ── 탭 섹션 ─────────────────────────────────────────────── */}
      <div>
        {/* 탭 바 (필 스타일) */}
        <div className="flex gap-1.5 sticky -top-4 md:-top-6 z-10 pb-2 pt-0.5" style={{ background: 'var(--canvas)' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors whitespace-nowrap ${
                tab === t.key
                  ? 'bg-[var(--coral)] text-white'
                  : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'
              }`}>
              {t.label}
            </button>
          ))}
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
                      <Link href="/room-manage" style={{ fontSize: '0.6875rem', color: 'var(--coral)' }}>전체 보기 →</Link>
                    </div>
                    {data.rooms.length === 0 ? (
                      <p className="text-center py-8 text-sm" style={{ color: 'var(--warm-muted)' }}>등록된 호실 없음</p>
                    ) : (
                      <>
                        {/* 차원 칩 — 호실 카드 묶음 단위 선택 (순서대로 우선순위) */}
                        <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                          <span style={{ fontSize: '0.625rem', color: 'var(--warm-muted)' }}>묶음</span>
                          {ROOM_DIMS.map(d => {
                            const idx = roomDims.indexOf(d.key)
                            const on = idx >= 0
                            return (
                              <button key={d.key} type="button" onClick={() => toggleRoomDim(d.key)}
                                className="px-2.5 py-1 text-[0.6875rem] rounded-md transition-colors flex items-center gap-1"
                                style={{
                                  background: on ? 'var(--persimmon)' : 'var(--canvas)',
                                  color: on ? '#fff' : 'var(--warm-mid)',
                                  border: '1px solid ' + (on ? 'var(--persimmon)' : 'var(--warm-border)'),
                                  fontWeight: on ? 600 : 500,
                                }}>
                                {on && roomDims.length > 1 && (
                                  <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[0.5rem] font-bold"
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
                              className="text-[0.625rem] underline-offset-2 hover:underline"
                              style={{ color: 'var(--warm-muted)' }}>전체</button>
                          )}
                        </div>
                        {/* 범례 */}
                        <div className="flex gap-3.5 shrink-0 flex-wrap">
                          <div className="flex items-center gap-[5px]" style={{ fontSize: '0.625rem', color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'var(--success-fg)' }} />납부완료
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: '0.625rem', color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'var(--info-fg)' }} />납부예정
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: '0.625rem', color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'var(--warning-fg)' }} />미납
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: '0.625rem', color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(200,160,120,0.25)' }} />공실
                          </div>
                        </div>
                        {(() => {
                            const unpaidRooms = new Set(data.unpaidRoomNosForView)
                            const awaitingRooms = new Set(data.awaitingRoomNosForView)
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
                              const nonResItem = r.isVacant && hasNonResident
                                ? data.nonResidentItems.find(n => n.roomNo === r.roomNo) : null
                              const isUnpaid   = r.isVacant ? (nonResItem?.payStatus === 'unpaid') : unpaidRooms.has(r.roomNo)
                              const isAwaiting = r.isVacant ? (nonResItem?.payStatus === 'awaiting') : (!isUnpaid && awaitingRooms.has(r.roomNo))
                              const rentMan = r.baseRent > 0 ? `${Math.round(r.baseRent / 10000)}만` : null
                              const nameParts = r.tenantName?.split(' ') ?? []
                              const displayName = r.isVacant
                                ? (hasNonResident ? '공실 (비거주자)' : '공실')
                                : nameParts.length >= 2 ? nameParts[1] : (r.tenantName ?? '거주중')
                              const cellStyle = (r.isVacant && !hasNonResident)
                                ? { background: 'var(--status-vacant-bg)', color: 'var(--status-vacant-fg)' }
                                : isUnpaid
                                  ? { background: 'var(--status-unpaid-bg)', color: 'var(--status-unpaid-fg)' }
                                  : isAwaiting
                                    ? { background: 'var(--status-await-bg)', color: 'var(--status-await-fg)' }
                                    : (r.isVacant && hasNonResident)
                                      ? { background: 'var(--status-vacant-bg)', color: 'var(--status-vacant-fg)' }
                                      : { background: 'var(--status-paid-bg)', color: 'var(--status-paid-fg)' }
                              return (
                                <div
                                  key={r.roomNo}
                                  onClick={() => entityModal.open({ kind: 'room', roomId: r.id })}
                                  className="rounded-[8px] flex flex-col items-center justify-center px-1 py-2.5 gap-[3px] cursor-pointer transition-opacity hover:opacity-75 overflow-hidden"
                                  style={cellStyle}
                                >
                                  <span className="truncate w-full text-center font-bold" style={{ fontSize: '0.6875rem' }}>{fmtRoomNo(r.roomNo)}</span>
                                  <span className="truncate w-full text-center" style={{ fontSize: '0.625rem', fontWeight: 500, lineHeight: 1.2 }}>{displayName}</span>
                                  {rentMan && <span style={{ fontSize: '0.625rem', fontWeight: 600, opacity: 0.8 }}>{rentMan}</span>}
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
                          const rentMan = n.rentAmount > 0 ? `${Math.round(n.rentAmount / 10000)}만` : null
                          const nameParts = n.tenantName.split(' ')
                          const shortName = nameParts.length >= 2 ? nameParts[1] : n.tenantName
                          const cellStyle = n.payStatus === 'unpaid'
                            ? { background: 'var(--status-unpaid-bg)', color: 'var(--status-unpaid-fg)' }
                            : n.payStatus === 'awaiting'
                              ? { background: 'var(--status-await-bg)', color: 'var(--status-await-fg)' }
                              : { background: 'var(--status-paid-bg)', color: 'var(--status-paid-fg)' }
                          return (
                            <div
                              key={n.tenantId}
                              onClick={() => entityModal.open({ kind: 'tenant', tenantId: n.tenantId })}
                              className="rounded-[8px] flex flex-col items-center justify-center px-1 py-2.5 gap-[3px] cursor-pointer transition-opacity hover:opacity-75 overflow-hidden"
                              style={cellStyle}
                            >
                              <span className="truncate w-full text-center font-bold" style={{ fontSize: '0.6875rem' }}>{fmtRoomNo(n.roomNo)}</span>
                              <span className="truncate w-full text-center" style={{ fontSize: '0.625rem', fontWeight: 500 }}>{shortName}</span>
                              {rentMan && <span style={{ fontSize: '0.625rem', fontWeight: 600, opacity: 0.8 }}>{rentMan}</span>}
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
                        <h3 style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--ink-2)' }}>이달 미수납</h3>
                        <span className="rounded-full text-[0.5625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{basisLabel}</span>
                      </div>
                      {data.unpaidCount > 0 && (
                        <span className="rounded-full text-[0.625rem] font-semibold px-2 py-0.5" style={{ background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>
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
                            const dl = daysLabel(l.daysOverdue)
                            return (
                              <button
                                key={i}
                                onClick={() => setDashTenantId(l.tenantId)}
                                className="w-full flex items-center gap-3 px-5 py-3 hover:opacity-70 active:opacity-50 transition-opacity text-left"
                                style={{ borderBottom: i < visibleUnpaid.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}
                              >
                                <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                                  style={{ background: 'var(--cream-3)', fontSize: '0.6875rem', color: 'var(--ink-mute)' }}>
                                  {l.tenantName.slice(0, 1)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold truncate flex items-center gap-1" style={{ color: 'var(--ink-2)' }}>
                                    {fmtRoomNo(l.roomNo)} {l.tenantName}
                                    {/* §23.7 — 1~6일 경과=미납(warning), 7일↑=연체 D+N(overdue). §03 OVERDUE=7일 초과 */}
                                    {l.daysOverdue != null && l.daysOverdue >= 7 ? (
                                      <span className="rounded-full text-[0.5625rem] font-bold px-1.5 py-0.5" style={{ background: 'var(--badge-overdue-bg)', color: 'var(--badge-overdue-fg)' }}>
                                        연체 D+{l.daysOverdue}
                                      </span>
                                    ) : l.daysOverdue != null && l.daysOverdue >= 1 ? (
                                      <span className="rounded-full text-[0.5625rem] font-bold px-1.5 py-0.5" style={{ background: 'var(--warning-bg)', color: 'var(--warning-fg)' }}>
                                        미납
                                      </span>
                                    ) : null}
                                  </p>
                                  <p className="text-[0.625rem] font-medium mt-0.5" style={{ color: dl.color }}>{dl.text}</p>
                                </div>
                                <span className="rounded-full shrink-0 text-[0.625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--danger-bg)', color: 'var(--tc)' }}>
                                  {fmtKorMoney(l.unpaidAmount)}
                                </span>
                              </button>
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
                        <span className="rounded-full text-[0.5625rem] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{basisLabel}</span>
                      </div>
                      {data.activity.length > 0 && (
                        <span className="rounded-full text-[0.625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
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
                              onClick={() => setDashTenantId(item.tenantId)}
                              className="w-full flex items-center gap-3 px-5 py-3 hover:opacity-70 transition-opacity active:opacity-50 text-left"
                              style={{ borderBottom: i < arr.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}
                            >
                              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                                style={{ background: 'var(--success-bg)', fontSize: '0.6875rem', color: 'var(--success)' }}>
                                {item.tenantName.slice(0, 1)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: 'var(--ink-2)' }}>{fmtRoomNo(item.roomNo)} {item.tenantName}</p>
                                <p className="text-[0.625rem] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>{item.timeLabel}</p>
                              </div>
                              <span className="rounded-full shrink-0 text-[0.625rem] font-semibold px-2 py-0.5" style={{ background: 'var(--success-bg)', color: 'var(--success)' }}>
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
            if (a.leaseTermId) {
              entityModal.open({
                kind: 'payment',
                leaseTermId: a.leaseTermId,
                tenantId: a.tenantId ?? null,
                roomId: a.roomId ?? null,
              })
            } else if (a.tenantId) {
              // 안전망 — leaseTermId 가 없는 알림은 기존 DashboardTenantModal 로 fallback
              setDashTenantId(a.tenantId)
            }
          }}
          onStartRecord={alert => { setSelectedAlert(null); setRecordingAlert(alert) }}
        />
      )}
      {recordingAlert && (
        <RecurringExpenseFormModal
          alert={recordingAlert}
          paymentMethods={paymentMethods}
          onClose={() => setRecordingAlert(null)}
          onDone={() => setRecordingAlert(null)}
        />
      )}
      {dashTenantId && (
        <DashboardTenantModal
          tenantId={dashTenantId}
          targetMonth={targetMonth}
          paymentMethods={paymentMethods}
          onClose={() => setDashTenantId(null)}
          onPaymentDone={() => router.refresh()}
        />
      )}
      {tenantInfoId && (
        <TenantQuickModal
          tenantId={tenantInfoId}
          onClose={() => setTenantInfoId(null)}
        />
      )}
    </div>
  )
}
