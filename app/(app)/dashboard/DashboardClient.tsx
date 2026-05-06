'use client'

import Link from 'next/link'
import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'
import { getTrendData, type TrendRange, type TrendPoint } from './actions'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'
import { CHART_COLORS, chartColor, GENDER_COLORS, STATUS_COLORS } from '@/lib/chartColors'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { getTenantLeaseForDashboard, getPaymentsByLease, savePayment, saveDepositPayment, updatePayment, deletePayment, getTenantQuickInfo } from '@/app/(app)/rooms/actions'
import { recordRecurringExpense } from '@/app/(app)/finance/actions'
import { confirmReservationToActive, checkoutTenant, checkoutWithDepositRefund } from '@/app/(app)/tenants/actions'
import { kstYmdStr, kstMonthStr } from '@/lib/kstDate'

// ── 타입 ────────────────────────────────────────────────────────

export type DashboardData = {
  totalRevenue:      number
  paidRevenue:       number
  extraRevenue:      number
  totalExpense:      number
  netProfit:         number
  totalDeposit:      number
  reserveBalance:    number
  reserveMonthly:    { deposit: number; withdraw: number }
  paidCount:         number
  unpaidCount:       number
  upcomingCount:     number
  pendingCount:      number
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
  rooms:             { roomNo: string; isVacant: boolean; tenantName: string | null; tenantId: string | null; tenantStatus: string | null; type: string | null; windowType: string | null; direction: string | null; areaPyeong: number | null; areaM2: number | null; baseRent: number; scheduledRent: number | null; rentUpdateDate: string | null }[]
  alerts:            { category?: 'unpaid' | 'upcoming' | 'moveout' | 'movein' | 'tour' | 'wish' | 'request' | 'recurring' | 'inventory'; text: string; link: string; dotColor: string; timeLabel: string; tenantId?: string; detail?: string; exactDate?: string; recurringExpenseId?: string; recurringAmount?: number; recurringDueDate?: string; recurringCategory?: string; recurringPayMethod?: string; recurringIsVariable?: boolean; recurringHistoricalAvg?: number; wishCandidates?: { tenantId: string; tenantName: string; rank: number; matchedBy: 'rooms' | 'conditions' }[]; wishRoomNo?: string; reservationDueLeaseId?: string; reservationDueRoomNo?: string | null; moveOutLeaseId?: string; moveOutDepositAmount?: number; moveOutCleaningFee?: number; moveOutTenantName?: string; sortKey?: number }[]
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
const DASH_STATUS_LABEL: Record<string, string> = {
  ACTIVE: '거주중', RESERVED: '입실 예정', CHECKOUT_PENDING: '퇴실 예정',
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
  if (daysOverdue > 0)  return { text: `${daysOverdue}일 경과`, color: '#ef4444' }
  if (daysOverdue === 0) return { text: '오늘 납부일', color: '#f97316' }
  return { text: `D${daysOverdue} (${Math.abs(daysOverdue)}일 남음)`, color: '#eab308' }
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
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b" style={{ borderColor: DIVIDER_COLOR }}>
          <p className="text-base font-bold" style={{ color: 'var(--warm-dark)' }}>보증금 환불</p>
          <p className="text-xs mt-1" style={{ color: 'var(--warm-muted)' }}>{tenantName}님 퇴실 정산</p>
        </div>

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
              <p className="text-sm font-semibold mt-0.5" style={{ color: cleaningFee > 0 ? '#dc2626' : 'var(--warm-mid)' }}>
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
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors"
            />
            {exceedsMax && (
              <p className="text-[11px] text-red-500">환불 금액은 최대 {maxRefund.toLocaleString()}원입니다.</p>
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
            <p className="text-[10px] pt-1" style={{ color: 'var(--warm-muted)' }}>
              미환불분은 부가수익 카테고리 &apos;보증금&apos; · 입금수단 &apos;보유 보증금&apos;으로 자동 등록됩니다.
            </p>
          </div>
        </div>

        <div className="px-5 pb-5 pt-1 flex gap-2">
          <button onClick={onClose} disabled={pending}
            className="flex-1 py-2.5 rounded-xl text-sm font-medium border transition-opacity hover:opacity-70 disabled:opacity-50"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            취소
          </button>
          <button
            onClick={() => onConfirm(refund)}
            disabled={pending || exceedsMax}
            className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
            style={{ background: '#eab308', color: 'white' }}>
            {pending ? '처리 중...' : '퇴실 처리'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AlertDetailModal({ alert, onClose, onOpenPayment, onStartRecord }: {
  alert: AlertItem
  onClose: () => void
  onOpenPayment: (id: string) => void
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
    if (!confirm('퇴실 처리하시겠습니까? 호실이 공실로 전환됩니다.')) return
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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-start justify-between px-5 py-4 border-b" style={{ borderColor: DIVIDER_COLOR }}>
          <div className="flex items-center gap-3 flex-1 min-w-0">
            <div className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-bold"
              style={{ background: avatarBg, fontSize: 14, color: alert.dotColor }}>
              {initial}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold leading-snug" style={{ color: '#5a4a3a' }}>{alert.text}</p>
              <span className="inline-block mt-1.5 text-[10px] font-semibold rounded-full px-2 py-0.5"
                style={{ background: hexToRgba(alert.dotColor, 0.12), color: alert.dotColor }}>
                {alert.timeLabel}{alert.exactDate ? ` · ${alert.exactDate}` : ''}
              </span>
            </div>
          </div>
          <button onClick={onClose} aria-label="닫기" className="ml-3 shrink-0 w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>

        {/* 후보 리스트 (희망 호실/조건 매칭 그룹) */}
        {alert.wishCandidates && alert.wishCandidates.length > 0 ? (
          <div className="px-5 py-4 space-y-2" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
            <p className="text-[11px] font-semibold" style={{ color: 'var(--warm-muted)' }}>
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
                  <span className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[11px] font-bold"
                    style={{ background: c.rank === 1 ? 'rgba(34,197,94,0.18)' : 'var(--canvas)', color: c.rank === 1 ? '#16a34a' : 'var(--warm-mid)' }}>
                    {c.rank}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold truncate" style={{ color: 'var(--warm-dark)' }}>{c.tenantName}님</p>
                    <p className="text-[10px] mt-0.5" style={{ color: 'var(--warm-muted)' }}>
                      {c.matchedBy === 'conditions' ? '조건 매칭' : '호실 지정'}
                    </p>
                  </div>
                  <span style={{ color: 'var(--warm-muted)', fontSize: 14 }}>›</span>
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
            <p className="text-xs text-red-500 bg-red-500/10 px-3 py-2 rounded-lg">{confirmError}</p>
          )}
          {reservationDueLeaseId && (
            <button
              onClick={handleConfirmActive}
              disabled={confirmPending}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: '#22c55e', color: 'white' }}>
              {confirmPending ? '처리 중...' : '거주중으로 변경'}
            </button>
          )}
          {moveOutLeaseId && (
            <button
              onClick={handleCheckout}
              disabled={confirmPending}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-60"
              style={{ background: '#eab308', color: 'white' }}>
              {confirmPending ? '처리 중...' : '퇴실 처리'}
            </button>
          )}
          {isRecurring && (
            <button
              onClick={() => { onStartRecord(alert); onClose() }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--coral)', color: 'white' }}>
              지출 기록하기
            </button>
          )}
          {alert.tenantId && !isRecurring && !reservationDueLeaseId && !moveOutLeaseId && (
            <button
              onClick={() => { onOpenPayment(alert.tenantId!); onClose() }}
              className="w-full py-2.5 rounded-xl text-sm font-medium transition-opacity hover:opacity-80"
              style={{ background: 'var(--coral)', color: 'white' }}>
              수납 관리 보기
            </button>
          )}
          <Link href={alert.link} onClick={onClose}
            className="block w-full text-center text-xs font-medium py-2 rounded-xl border transition-opacity hover:opacity-70"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            {isRecurring ? '지출/기타 수익에서 보기 →' : alert.wishCandidates && alert.wishCandidates.length > 0 ? '호실 관리로 이동 →' : '입주자 관리에서 보기 →'}
          </Link>
        </div>
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
    </div>
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

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: DIVIDER_COLOR }}>
          <p className="text-sm font-bold" style={{ color: 'var(--warm-dark)' }}>지출 등록</p>
          <button onClick={onClose} aria-label="닫기" className="w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>

        {done ? (
          <div className="px-5 py-10 text-center">
            <p className="text-sm font-semibold text-green-600">✅ 지출이 기록되었습니다</p>
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
                    <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}
                      title="과거 동일 항목 결제 기록의 평균">
                      과거 평균 {fmtKorMoney(alert.recurringHistoricalAvg)}
                    </span>
                  )}
                </div>
                <input type="text" inputMode="numeric"
                  value={amount ? amount.toLocaleString() : ''}
                  onChange={e => setAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                  placeholder="0원"
                  className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
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
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>

            {/* 결제 수단 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>결제수단</label>
              <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                <option value="">선택 안 함</option>
                {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>

            {/* 메모 */}
            <div className="space-y-1.5">
              <label className="text-xs font-medium" style={{ color: 'var(--warm-mid)' }}>메모</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                placeholder="메모 (선택)"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>

            {error && <p className="text-xs text-red-500">{error}</p>}

            {/* 버튼 */}
            <div className="flex gap-2 pt-1">
              <button onClick={onClose}
                className="flex-1 py-2.5 rounded-xl text-sm border transition-colors"
                style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
                취소
              </button>
              <button onClick={handleSubmit} disabled={pending || !amount || !date}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80 disabled:opacity-50"
                style={{ background: 'var(--coral)', color: 'white' }}>
                {pending ? '저장 중…' : '저장'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 알림 스트립 — 카테고리별 그룹핑 (iOS 알림센터 스타일) ────────────

type AlertCat = 'unpaid' | 'upcoming' | 'moveout' | 'movein' | 'tour' | 'wish' | 'request' | 'recurring' | 'inventory' | 'other'
const CATEGORY_ORDER: AlertCat[] = ['unpaid', 'upcoming', 'moveout', 'movein', 'tour', 'wish', 'request', 'recurring', 'inventory', 'other']
const CATEGORY_META: Record<AlertCat, { label: string; color: string }> = {
  unpaid:    { label: '누적 미수',    color: '#dc2626' },
  upcoming:  { label: '납부 예정',    color: '#d4a847' },
  moveout:   { label: '퇴실 예정',    color: '#eab308' },
  movein:    { label: '입실 희망',    color: '#3b82f6' },
  tour:      { label: '투어 예정',    color: '#a855f7' },
  wish:      { label: '희망 호실/조건 매칭', color: '#22c55e' },
  request:   { label: '요청·컴플레인',color: '#f4623a' },
  recurring: { label: '고정 지출',    color: '#6366f1' },
  inventory: { label: '재고 부족',    color: '#d4a847' },
  other:     { label: '기타',         color: '#94a3b8' },
}
const COLLAPSE_THRESHOLD = 3   // 이 개수 초과면 기본 접힘

function AlertsStrip({ alerts, onOpenAlert }: {
  alerts: DashboardData['alerts']
  onOpenAlert: (alert: AlertItem) => void
}) {
  // 카테고리별 그룹 — sortKey 있으면 그 순으로 (납부예정: 가까운 순, 누적미수: 오래된 순)
  const groups = (() => {
    const map = new Map<AlertCat, typeof alerts>()
    for (const a of alerts) {
      const cat = (a.category ?? 'other') as AlertCat
      const arr = map.get(cat) ?? []
      arr.push(a)
      map.set(cat, arr)
    }
    for (const arr of map.values()) {
      const hasSortKey = arr.some(a => typeof a.sortKey === 'number')
      if (hasSortKey) arr.sort((a, b) => (a.sortKey ?? 0) - (b.sortKey ?? 0))
    }
    return CATEGORY_ORDER
      .map(cat => ({ cat, items: map.get(cat) ?? [] }))
      .filter(g => g.items.length > 0)
  })()

  // 각 카테고리 펼침 상태 — 항목 N개 이하는 기본 펼침, 초과면 접힘
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {}
    for (const g of groups) init[g.cat] = g.items.length <= COLLAPSE_THRESHOLD
    return init
  })

  if (alerts.length === 0) return null

  return (
    <div className="rounded-xl flex flex-col" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0" style={{ borderColor: DIVIDER_COLOR }}>
        <div className="flex items-center gap-2">
          <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>알림</h3>
          <span className="rounded-full text-[9px] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>미처리</span>
        </div>
        <span className="rounded-full text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>
          {alerts.length}건
        </span>
      </div>

      {groups.map((g, gi) => {
        const meta = CATEGORY_META[g.cat]
        const isOpen = expanded[g.cat] ?? false
        return (
          <div key={g.cat} style={{ borderBottom: gi < groups.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
            {/* 카테고리 헤더 */}
            <button
              type="button"
              onClick={() => setExpanded(prev => ({ ...prev, [g.cat]: !isOpen }))}
              className="w-full flex items-center gap-2 px-5 py-2.5 hover:opacity-80 transition-opacity"
              style={{ background: 'rgba(0,0,0,0.015)' }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: meta.color }} />
              <span className="text-[11px] font-semibold flex-1 text-left" style={{ color: '#5a4a3a' }}>
                {meta.label}
              </span>
              <span className="text-[10px] font-medium" style={{ color: 'var(--warm-muted)' }}>
                {g.items.length}건
              </span>
              <span className="text-[var(--warm-muted)] text-xs ml-1" style={{ transform: isOpen ? 'rotate(90deg)' : 'rotate(0)', transition: 'transform 150ms' }}>›</span>
            </button>

            {/* 항목 리스트 */}
            {isOpen && (
              <div>
                {g.items.map((item, i) => (
                  <div key={i} style={{ borderTop: i === 0 ? `1px solid ${DIVIDER_COLOR}` : 'none', borderBottom: i < g.items.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
                    <button
                      className="w-full text-left hover:opacity-70 active:opacity-50 transition-opacity"
                      onClick={() => onOpenAlert(item)}
                    >
                      <div className="flex items-center gap-3 px-5 py-3">
                        <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                          style={{ background: hexToRgba(item.dotColor, 0.12), fontSize: 11, color: item.dotColor }}>
                          {item.text.slice(0, 1)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color: '#5a4a3a' }}>{item.text}</p>
                          <p className="text-[10px] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>
                            {item.timeLabel}{item.exactDate ? ` · ${item.exactDate}` : ''}
                          </p>
                        </div>
                        <span style={{ color: 'var(--warm-muted)', fontSize: 14 }}>›</span>
                      </div>
                    </button>
                  </div>
                ))}
              </div>
            )}
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
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e8ddd2" strokeWidth={strokeWidth} />
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
      {centerLabel && <text x={cx} y={cy + 6} textAnchor="middle" fontSize="15" fontWeight="700" fill="#5a4a3a">{centerLabel}</text>}
      {centerSub && <text x={cx} y={cy + 22} textAnchor="middle" fontSize="10" fill="#a89888">{centerSub}</text>}
    </svg>
  )
}

// ── 공용 컴포넌트 ───────────────────────────────────────────────

function StatCard({ label, value, sub, colorStyle }: {
  label: string; value: React.ReactNode; sub: string; colorStyle?: React.CSSProperties
}) {
  return (
    <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
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
  const paymentSegments = [
    { value: data.paidCount,   color: '#f4623a' },
    { value: data.unpaidCount, color: '#e8ddd2' },
  ]
  const paymentRate = (data.paidCount + data.unpaidCount) > 0
    ? Math.round((data.paidCount / (data.paidCount + data.unpaidCount)) * 100)
    : 0

  return (
    <div className="space-y-5">
      {/* ── 세부 재무 요약 ── */}
      <div className="rounded-xl overflow-hidden" style={{ border: '1px solid var(--warm-border)' }}>
        <div className="grid grid-cols-5 divide-x" style={{ borderColor: 'var(--warm-border)', background: 'var(--cream)' }}>
          {[
            { label: '수납액 (귀속)', value: data.paidRevenue,  color: 'var(--coral)' },
            { label: '기타수익', value: data.extraRevenue, color: '#f97316' },
            { label: '지출',     value: data.totalExpense, color: '#ef4444' },
            { label: '순수익',   value: data.netProfit,    color: data.netProfit >= 0 ? '#22c55e' : '#ef4444' },
            { label: '보유 보증금', value: data.totalDeposit, color: '#a855f7' },
          ].map((item, i) => (
            <div key={i} className="px-4 py-3 text-center" style={{ borderColor: 'var(--warm-border)' }}>
              <p className="text-[10.5px] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>{item.label}</p>
              <p className="text-sm font-bold" style={{ color: item.color }}>
                <MoneyDisplay amount={Math.abs(item.value)} prefix={item.value < 0 ? '-' : ''} />
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* ── 추이 ── */}
      <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-mid)' }}>추이</h3>
          <div className="flex gap-4 text-xs" style={{ color: 'var(--warm-muted)' }}>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: 'var(--coral)' }} />수입</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: '#64748b' }} />지출</span>
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
                  <stop offset="5%"  stopColor="#64748b" stopOpacity={0.14} />
                  <stop offset="95%" stopColor="#64748b" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a89888' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => v === 0 ? '0' : `${v}만`} tick={{ fontSize: 10, fill: '#a89888' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e8ddd2', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [`${Number(v).toLocaleString()}만원`, String(name)]}
              />
              <Area type="monotone" dataKey="revenue" name="수입" stroke="var(--coral)" strokeWidth={2} fill="url(#gradRev)" dot={false} activeDot={{ r: 4, fill: 'var(--coral)' }} />
              <Area type="monotone" dataKey="expense" name="지출" stroke="#64748b" strokeWidth={1.5} strokeDasharray="4 2" fill="url(#gradExp)" dot={false} activeDot={{ r: 4, fill: '#64748b' }} />
            </AreaChart>
          </ResponsiveContainer>
        ) : (
          /* ── 월간 이상: Grouped Bar Chart ── */
          <ResponsiveContainer width="100%" height={176}>
            <BarChart data={chartData} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barCategoryGap="28%">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(0,0,0,0.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#a89888' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
              <YAxis tickFormatter={v => v === 0 ? '0' : `${v}만`} tick={{ fontSize: 10, fill: '#a89888' }} axisLine={false} tickLine={false} width={52} />
              <Tooltip
                contentStyle={{ background: '#fff', border: '1px solid #e8ddd2', borderRadius: 8, fontSize: 12 }}
                formatter={(v, name) => [`${Number(v).toLocaleString()}만원`, String(name)]}
              />
              <Bar dataKey="revenue" name="수입" fill="var(--coral)" radius={[3, 3, 0, 0]} maxBarSize={28} />
              <Bar dataKey="expense" name="지출" fill="#64748b"       radius={[3, 3, 0, 0]} maxBarSize={28} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
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

        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>수납 현황</h3>
          <div className="flex items-center gap-5">
            <div className="shrink-0">
              <DonutChart segments={paymentSegments} centerLabel={`${paymentRate}%`} centerSub="수납률" />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: '#f4623a' }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>완납</span>
                <span className="text-sm font-semibold" style={{ color: '#f4623a' }}>{data.paidCount}건</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: '#c4b5a5' }} />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>미납</span>
                <span className="text-sm font-semibold" style={{ color: 'var(--warm-mid)' }}>{data.unpaidCount}건</span>
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
  const occupancySegments = [{ value: data.occupiedRooms, color: '#f4623a' }, { value: data.vacantRooms, color: '#e8ddd2' }]
  const statusSegments = [
    { value: data.statusCounts.active,      color: STATUS_COLORS.active },
    { value: data.statusCounts.reserved,    color: STATUS_COLORS.reserved },
    { value: data.statusCounts.checkout,    color: STATUS_COLORS.checkout },
    { value: data.statusCounts.nonResident, color: STATUS_COLORS.nonResident },
  ]
  const genderSegments = data.genderDist.map(d => ({ value: d.count, color: GENDER_COLORS[d.label] ?? '#a89888' }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <StatCard label={`전체 입주자 (현재 계약 기준)`} value={`${data.totalTenants}명`} sub="" />
        <StatCard label="거주중"    value={`${data.statusCounts.active}명`}      sub=""  colorStyle={{ color: STATUS_COLORS.active }} />
        <StatCard label="입실 예정" value={`${data.statusCounts.reserved}명`}    sub=""  colorStyle={{ color: STATUS_COLORS.reserved }} />
        <StatCard label="퇴실 예정" value={`${data.statusCounts.checkout}명`}    sub=""  colorStyle={{ color: STATUS_COLORS.checkout }} />
        <StatCard label="비거주자"  value={`${data.statusCounts.nonResident}명`} sub=""  colorStyle={{ color: STATUS_COLORS.nonResident }} />
        <StatCard label="투어 대기" value={`${data.statusCounts.waitingTour}명`} sub=""  colorStyle={{ color: '#a855f7' }} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>호실 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={occupancySegments} centerLabel={`${occupancyRate}%`} centerSub="입주율" />
            <div className="space-y-2.5 flex-1">
              {[{ label: '거주중', val: `${data.occupiedRooms}실`, dot: '#f4623a' }, { label: '공실', val: `${data.vacantRooms}실`, dot: '#e8ddd2' }, { label: '전체', val: `${data.totalRooms}실`, dot: '' }].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  {r.dot ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.dot }} /> : <span className="w-2 h-2 shrink-0" />}
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{r.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--warm-dark)' }}>{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>상태별 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={statusSegments} centerLabel={`${statusTotal}명`} centerSub="입주자" />
            <div className="space-y-2.5 flex-1">
              {[{ label: '거주중', count: data.statusCounts.active, color: STATUS_COLORS.active }, { label: '입실 예정', count: data.statusCounts.reserved, color: STATUS_COLORS.reserved }, { label: '퇴실 예정', count: data.statusCounts.checkout, color: STATUS_COLORS.checkout }].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{s.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--warm-dark)' }}>{s.count}명</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>성별 분포</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={genderSegments} centerLabel={`${data.totalTenants}명`} centerSub="전체" />
            <div className="space-y-2.5 flex-1">
              {data.genderDist.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GENDER_COLORS[d.label] ?? '#a89888' }} />
                  <span className="text-xs flex-1" style={{ color: 'var(--warm-mid)' }}>{GENDER_LABEL[d.label] ?? d.label}</span>
                  <span className="text-xs font-semibold" style={{ color: 'var(--warm-dark)' }}>{d.count}명</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <h3 className="text-sm font-semibold mb-4" style={{ color: 'var(--warm-mid)' }}>국적 분포</h3>
          <DistList items={data.nationalityDist} colors={DIST_COLORS} />
        </div>
        <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
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
      <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
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
              : '✦ AI 분석하기'}
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
        {error && <p className="text-red-500 text-sm py-4 text-center">{error}</p>}
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
      const l = await getTenantLeaseForDashboard(tenantId)
      if (cancelled) return
      setLease(l)
      if (l) {
        setPayAmount(l.rentAmount)
        const { records, acquisitionDate: acq } = await getPaymentsByLease(l.id, targetMonth)
        if (cancelled) return
        setPayHistory(records as DashPayRecord[])
        setAcquisitionDate(acq ? new Date(acq) : null)
      }
      setLoading(false)
    })()
    return () => { cancelled = true }
  }, [tenantId, targetMonth])

  if (!lease && !loading) {
    return (
      <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
        <div className="bg-[var(--cream)] rounded-2xl p-6 text-center" onClick={e => e.stopPropagation()}>
          <p className="text-sm text-[var(--warm-muted)]">활성 계약을 찾을 수 없습니다.</p>
          <button onClick={onClose} className="mt-3 text-sm font-medium" style={{ color: 'var(--coral)' }}>닫기</button>
        </div>
      </div>
    )
  }

  const isPreAcq = (p: DashPayRecord) => !!(acquisitionDate && new Date(p.payDate) < acquisitionDate)
  const depositRecords = payHistory.filter(p => p.isDeposit)
  const regularRecords = payHistory.filter(p => !p.isDeposit && !p.memo?.startsWith('[납입일변경]'))
  const adjRecords = payHistory.filter(p => p.memo?.startsWith('[납입일변경]'))
  const prevOwnerPaid = regularRecords.filter(isPreAcq).reduce((s, p) => s + p.actualAmount, 0)
  const regularPaid = regularRecords.reduce((s, p) => s + p.actualAmount, 0) - prevOwnerPaid
  const adjNet = adjRecords.reduce((s, p) => s + p.actualAmount, 0)
  const balance = lease ? regularPaid + adjNet - lease.rentAmount : 0

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
        setShowForm(false)
        setIsDepositMode(false)
        await reload(lease)
        onPaymentDone?.()
      } catch (err: unknown) { setError((err as Error).message) }
    })
  }

  const handleDelete = (id: string) => {
    if (!confirm('이 수납 기록을 삭제하시겠습니까?')) return
    startTransition(async () => {
      await deletePayment(id)
      await reload(lease)
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

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl w-full max-w-md flex flex-col max-h-[88vh]"
        onClick={e => e.stopPropagation()}>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--warm-border)] shrink-0">
          {loading ? (
            <div className="h-5 w-32 bg-[var(--sand)] rounded animate-pulse" />
          ) : (
            <div>
              <h2 className="text-base font-bold text-[var(--warm-dark)]">
                {lease?.room?.roomNo ? `${lease.room.roomNo}호 — ` : ''}{lease?.tenant.name}
              </h2>
              <p className="text-xs text-[var(--warm-muted)] mt-0.5">
                {targetMonth} · 예정 {lease?.rentAmount.toLocaleString()}원
              </p>
            </div>
          )}
          <button onClick={onClose} aria-label="닫기" className="ml-4 w-9 h-9 flex items-center justify-center rounded-lg text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:bg-[var(--canvas)] text-xl leading-none transition-colors">✕</button>
        </div>

        {/* 본문 */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="w-6 h-6 border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <div className="p-6 space-y-5">
              {error && <p className="text-xs text-red-500 bg-red-50 rounded-xl px-3 py-2">{error}</p>}

              {/* 수납 현황 */}
              <div className="grid grid-cols-3 gap-2">
                {[
                  { label: '예정 금액', value: `${lease!.rentAmount.toLocaleString()}원`, color: 'var(--warm-dark)' },
                  { label: '납부 금액', value: `${regularPaid.toLocaleString()}원`, color: regularPaid >= lease!.rentAmount ? '#16a34a' : 'var(--warm-dark)' },
                  { label: balance >= 0 ? '과입금' : '미납', value: `${Math.abs(balance).toLocaleString()}원`, color: balance >= 0 ? '#16a34a' : '#ef4444' },
                ].map(item => (
                  <div key={item.label} className="rounded-xl p-3 text-center" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                    <p className="text-[10px] text-[var(--warm-muted)] mb-1">{item.label}</p>
                    <p className="text-xs font-bold" style={{ color: item.color }}>{item.value}</p>
                  </div>
                ))}
              </div>

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
                      <div className="bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 space-y-2">
                        <p className="text-xs font-semibold text-amber-700">양도인 수납 — 납부일 직접 입력</p>
                        <div className="flex gap-2 items-center">
                          <div className="flex-1">
                            <DatePicker value={autoPayDate} onChange={setAutoPayDate}
                              className="bg-[var(--canvas)] border border-amber-200 rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                          </div>
                          <button onClick={handleSaveAutoPay} disabled={isPending || !autoPayDate}
                            className="px-3 py-1.5 text-xs font-semibold text-white bg-amber-500 hover:bg-amber-600 rounded-lg transition-colors disabled:opacity-50">저장</button>
                          <button onClick={() => setEditingAutoPay(false)}
                            className="px-3 py-1.5 text-xs text-amber-600 rounded-lg border border-amber-200 hover:bg-amber-100 transition-colors">취소</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
                        <div>
                          <p className="text-xs font-semibold text-amber-700">양도인 수납</p>
                          <button onClick={() => { setAutoPayDate(getAutoDefault()); setEditingAutoPay(true) }}
                            className="text-[10px] text-amber-600 mt-0.5 hover:underline text-left">
                            {getDueDateStr()} 납부 (자동) · <span className="underline">날짜 수정</span>
                          </button>
                        </div>
                        <p className="text-xs font-semibold text-amber-700">{lease!.rentAmount.toLocaleString()}원</p>
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
                    <div className="flex items-center justify-between bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                      <p className="text-xs text-amber-700">양도인 귀속</p>
                      <p className="text-xs font-semibold text-amber-700">{prevOwnerPaid.toLocaleString()}원</p>
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
                <form onSubmit={handleSave} className="space-y-3 rounded-2xl border border-[var(--warm-border)] p-4" style={{ background: 'var(--canvas)' }}>
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
                      <p className="text-[10px] text-[var(--warm-muted)]">금액</p>
                      <input type="text" inputMode="numeric"
                        value={payAmount.toLocaleString()}
                        onChange={e => setPayAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--warm-muted)]">납부일</p>
                      <DatePicker value={payDate} onChange={setPayDate}
                        className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--warm-muted)]">납부방법</p>
                      <select name="payMethod"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors">
                        <option value="">선택 안 함</option>
                        {paymentMethods.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="space-y-1">
                      <p className="text-[10px] text-[var(--warm-muted)]">메모</p>
                      <input name="memo" type="text"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
                    </div>
                  </div>
                  {isDepositMode && payAmount > lease!.depositAmount && (
                    <p className="text-[10px] text-[var(--coral)]">
                      초과금 {(payAmount - lease!.depositAmount).toLocaleString()}원 → {targetMonth} 이용료 처리
                    </p>
                  )}
                  <div className="flex gap-2">
                    <button type="button" onClick={() => { setShowForm(false); setIsDepositMode(false) }}
                      className="flex-1 py-2.5 rounded-xl border text-sm text-[var(--warm-mid)] transition-colors"
                      style={{ borderColor: 'var(--warm-border)' }}>취소</button>
                    <button type="submit" disabled={isPending}
                      className="flex-1 py-2.5 rounded-xl bg-[var(--coral)] text-white text-sm font-medium transition-colors disabled:opacity-50">
                      {isPending ? '저장 중…' : '저장'}
                    </button>
                  </div>
                </form>
              ) : (
                <button onClick={() => setShowForm(true)}
                  className="w-full py-3 rounded-2xl text-sm font-medium transition-colors"
                  style={{ background: 'var(--coral)', color: 'white' }}>
                  + 수납 입력
                </button>
              )}
            </div>
          )}
        </div>

        {/* 하단 — 바로가기 버튼 */}
        {!loading && lease && (
          <div className="px-6 py-3 border-t shrink-0 flex gap-2" style={{ borderColor: 'var(--warm-border)' }}>
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
        )}
      </div>
    </div>
  )
}

function DashPayRow({ p, isPreAcq, onEdit, onDelete, color }: {
  p: DashPayRecord; isPreAcq: boolean
  onEdit: (p: DashPayRecord) => void; onDelete: (id: string) => void
  color: 'purple' | 'amber' | 'default'
}) {
  const bg = color === 'purple' ? 'bg-purple-50 border border-purple-200' : color === 'amber' ? 'bg-amber-50 border border-amber-200' : 'bg-[var(--canvas)]'
  const textColor = color === 'purple' ? 'text-purple-600' : color === 'amber' ? 'text-amber-600' : 'text-[var(--warm-mid)]'
  const amountColor = color === 'purple' ? 'text-purple-700' : color === 'amber' ? 'text-amber-700' : 'text-[var(--warm-dark)]'
  const DAYS = ['일', '월', '화', '수', '목', '금', '토']
  const fmtD = (d: Date | string) => { const dt = new Date(d); return `${dt.getMonth()+1}월 ${dt.getDate()}일 (${DAYS[dt.getDay()]})` }
  return (
    <div className={`flex items-center justify-between rounded-xl px-3 py-2.5 ${bg}`}>
      <div>
        <p className={`text-xs ${textColor}`}>
          {p.seqNo}회차 · {fmtD(p.payDate)} · {p.payMethod ?? '—'}
          {color === 'purple' && <span className="ml-1.5 text-[10px] font-semibold bg-purple-200 text-purple-800 rounded px-1 py-0.5">보증금</span>}
          {isPreAcq && <span className="ml-1.5 text-[10px] font-semibold bg-amber-200 text-amber-800 rounded px-1 py-0.5">양도인</span>}
        </p>
        {p.memo && !p.isDeposit && <p className="text-xs text-[var(--coral)] mt-0.5">{p.memo}</p>}
      </div>
      <div className="flex items-center gap-2">
        <span className={`text-sm font-semibold ${amountColor}`}>{p.actualAmount.toLocaleString()}원</span>
        <div className="flex gap-1.5 ml-1">
          <button onClick={() => onEdit(p)} className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>수정</button>
          <button onClick={() => onDelete(p.id)} className="text-xs font-medium px-2.5 py-1.5 min-h-[32px] rounded-lg border border-red-200 text-red-500 transition-colors">삭제</button>
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
  const borderColor = color === 'purple' ? 'border-purple-400' : color === 'amber' ? 'border-amber-400' : 'border-[var(--coral)]'
  const bg = color === 'purple' ? 'bg-purple-50' : color === 'amber' ? 'bg-amber-50' : 'bg-[var(--canvas)]'
  return (
    <div className={`rounded-xl border ${borderColor} ${bg} px-3 py-2.5 space-y-2`}>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">금액</p>
          <input type="text" inputMode="numeric" value={editAmount.toLocaleString()} onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">납부일</p>
          <DatePicker value={editDate} onChange={setEditDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">납부방법</p>
          <input type="text" value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)} placeholder="계좌이체, 현금…"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
        </div>
        <div className="space-y-1">
          <p className="text-[10px] text-[var(--warm-muted)]">메모</p>
          <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
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

function RoomDetailPopup({ room, onClose, onOpenPayment, onOpenTenantInfo }: {
  room: DashboardData['rooms'][number]
  onClose: () => void
  onOpenPayment: (tenantId: string) => void
  onOpenTenantInfo: (tenantId: string) => void
}) {
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}>
      <div className="bg-[var(--cream)] rounded-2xl shadow-2xl w-full max-w-xs overflow-hidden"
        onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-[var(--warm-dark)]">{room.roomNo}호</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium
              ${room.isVacant ? 'bg-[var(--canvas)] text-[var(--warm-mid)]' : 'bg-[var(--coral)]/20 text-[var(--coral)]'}`}>
              {room.isVacant ? '공실' : (DASH_STATUS_LABEL[room.tenantStatus ?? ''] ?? '거주중')}
            </span>
          </div>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none">✕</button>
        </div>
        <div className="px-5 py-4 space-y-2 text-sm">
          {room.tenantName && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">입주자</span>
              <span className="font-medium text-[var(--warm-dark)]">{room.tenantName}</span>
            </div>
          )}
          {room.type && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">타입</span>
              <span className="text-[var(--warm-dark)]">{room.type}</span>
            </div>
          )}
          {room.windowType && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">창문</span>
              <span className="text-[var(--warm-dark)]">{DASH_WINDOW_LABEL[room.windowType] ?? room.windowType}</span>
            </div>
          )}
          {room.direction && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">방향</span>
              <span className="text-[var(--warm-dark)]">{DASH_DIR_LABEL[room.direction] ?? room.direction}</span>
            </div>
          )}
          {(room.areaPyeong || room.areaM2) && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">면적</span>
              <span className="text-[var(--warm-dark)]">
                {[room.areaPyeong ? `${room.areaPyeong}평` : null, room.areaM2 ? `${room.areaM2}㎡` : null].filter(Boolean).join(' / ')}
              </span>
            </div>
          )}
          <div className="flex justify-between border-t border-[var(--warm-border)] pt-2 mt-1">
            <span className="text-[var(--warm-muted)]">기본 이용료</span>
            <span className="font-semibold text-[var(--warm-dark)]">{room.baseRent.toLocaleString()}원</span>
          </div>
          {room.scheduledRent && (
            <div className="flex justify-between">
              <span className="text-[var(--warm-muted)]">예약 이용료</span>
              <span className="font-semibold" style={{ color: 'var(--coral)' }}>
                {room.scheduledRent.toLocaleString()}원
                {room.rentUpdateDate && <span className="text-[10px] font-normal ml-1 opacity-70">({room.rentUpdateDate} 적용)</span>}
              </span>
            </div>
          )}
        </div>
        {room.tenantId && (
          <div className="px-5 pb-4 flex flex-col gap-2">
            <button
              onClick={() => { onOpenPayment(room.tenantId!); onClose() }}
              className="block w-full text-center text-xs font-medium py-2 rounded-xl border transition-colors hover:bg-[var(--canvas)]"
              style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
              호실 수납 관리 →
            </button>
            <button
              onClick={() => { onOpenTenantInfo(room.tenantId!); onClose() }}
              className="block w-full text-center text-xs font-medium py-2 rounded-xl border transition-colors hover:bg-[var(--canvas)]"
              style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
              입주자 정보 보기 →
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 입주자 빠른 정보 모달 ─────────────────────────────────────────

type TenantQuickInfo = Awaited<ReturnType<typeof getTenantQuickInfo>>

const GENDER_LABEL_KO: Record<string, string> = { MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '미기재' }
const CONTACT_LABEL: Record<string, string> = { PHONE: '전화', EMAIL: '이메일', KAKAO: '카카오', OTHER: '기타' }
const LEASE_STATUS_LABEL: Record<string, string> = { ACTIVE: '거주중', RESERVED: '입실 예정', CHECKOUT_PENDING: '퇴실 예정' }

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
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--cream)] rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--warm-border)]">
          <span className="text-base font-bold text-[var(--warm-dark)]">
            {loading ? '불러오는 중…' : (info?.name ?? '입주자 정보')}
          </span>
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-lg leading-none">✕</button>
        </div>

        {loading ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--warm-muted)]">불러오는 중…</div>
        ) : !info ? (
          <div className="px-5 py-8 text-center text-sm text-[var(--warm-muted)]">입주자 정보를 찾을 수 없습니다.</div>
        ) : (
          <div className="px-5 py-4 space-y-2 text-sm max-h-[70vh] overflow-y-auto">
            {/* 기본 정보 */}
            <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-1">기본 정보</p>
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-2">연락처</p>
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
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-2">계약 정보</p>
                <div className="flex justify-between mb-1">
                  <span className="text-[var(--warm-muted)]">호실</span>
                  <span className="text-[var(--warm-dark)] font-medium">{lease.room?.roomNo}호</span>
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
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--warm-muted)] mb-1">메모</p>
                <p className="text-xs text-[var(--warm-dark)] whitespace-pre-wrap">{info.memo}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ── 메인 컴포넌트 ────────────────────────────────────────────────

type Tab = 'overview' | 'finance' | 'tenants' | 'ai'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '현황' },
  { key: 'finance',  label: '재무' },
  { key: 'tenants',  label: '입주자' },
  { key: 'ai',       label: '✦ AI 분석' },
]

export default function DashboardClient({ data, targetMonth, paymentMethods }: { data: DashboardData; targetMonth: string; paymentMethods: string[] }) {
  const router = useRouter()
  // viewMonth가 현재이면 "오늘 기준", 그 외(과거/미래)는 "○월 말일 기준"
  const isViewingRealMonth = targetMonth === kstMonthStr()
  const basisLabel = isViewingRealMonth
    ? '오늘 기준'
    : `${Number(targetMonth.slice(5))}월 말일 기준`
  const [tab, setTab]                             = useState<Tab>('overview')
  const [selectedRoom, setSelectedRoom]           = useState<DashboardData['rooms'][number] | null>(null)
  const [dashTenantId, setDashTenantId]           = useState<string | null>(null)
  const [tenantInfoId, setTenantInfoId]           = useState<string | null>(null)
  const [selectedAlert, setSelectedAlert]         = useState<AlertItem | null>(null)
  const [recordingAlert, setRecordingAlert]       = useState<AlertItem | null>(null)
  const [unpaidExpanded, setUnpaidExpanded]       = useState(false)
  const [activityExpanded, setActivityExpanded]   = useState(false)

  const prev = data.trend[data.trend.length - 2]
  const cur  = data.trend[data.trend.length - 1]
  const revChange = prev && prev.revenue > 0
    ? Math.round((cur.revenue - prev.revenue) / prev.revenue * 100)
    : null



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

      {/* ── Row 1: 알림 ─────────────────────────────────────────── */}
      <AlertsStrip alerts={data.alerts} onOpenAlert={setSelectedAlert} />

      {/* ── KPI 카드 (2×3 grid) ──────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3.5">

        {/* Row 2 Left: 당월 매출 */}
        <div className="rounded-xl" style={{ background: 'var(--coral)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(255,252,247,0.55)', marginBottom: 8 }}>
            당월 매출
            <span style={{ fontSize: 9, fontWeight: 400, letterSpacing: 0, textTransform: 'none', marginLeft: 6, color: 'rgba(255,252,247,0.5)' }}>(귀속 기준)</span>
          </p>
          <p style={{ fontSize: 22, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.totalRevenue.toLocaleString()}
            <small style={{ fontSize: 11, fontWeight: 400, color: 'rgba(255,252,247,0.5)', marginLeft: 3 }}>원</small>
          </p>
          <p style={{ fontSize: 10.5, color: 'rgba(255,252,247,0.5)', lineHeight: 1.5 }}>
            수납액+기타수익
            {revChange != null && (
              <em style={{ fontStyle: 'normal', color: '#fbbf24', marginLeft: 6 }}>{revChange >= 0 ? '+' : ''}{revChange}%</em>
            )}
          </p>
        </div>

        {/* Row 2 Right: 현재 순이익 — 전문적 다크 */}
        {(() => {
          const net = data.netProfit
          const isPos = net >= 0
          return (
            <div className="rounded-xl" style={{ background: '#1c2b3a', padding: '18px 20px' }}>
              <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'rgba(180,210,240,0.45)', marginBottom: 8 }}>
                현재 순이익
              </p>
              <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: isPos ? '#4ade80' : '#f87171' }}>
                {isPos ? '+' : ''}{net.toLocaleString()}
                <small style={{ fontSize: 11, fontWeight: 400, color: 'rgba(180,210,240,0.3)', marginLeft: 2 }}>원</small>
              </p>
              <p style={{ fontSize: 10.5, color: 'rgba(180,210,240,0.4)' }}>수납 − 실제 지출</p>
            </div>
          )
        })()}

        {/* Row 3 Left: 누적 미납 — 도래·미회수 강조, 납부 예정은 부가 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            누적 미납
          </p>
          <p style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: data.overdueAmount > 0 ? '#ef4444' : '#5a4a3a' }}>
            {data.overdueAmount.toLocaleString()}
            <small style={{ fontSize: 11, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: 10.5, color: 'var(--warm-muted)', marginBottom: data.upcomingAmount > 0 ? 4 : 0 }}>
            <em style={{ fontStyle: 'normal', color: data.unpaidCount > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>{data.unpaidCount}건</em> · 도래·미회수
          </p>
          {data.upcomingAmount > 0 && (
            <p style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
              <span style={{ color: '#1e40af', fontWeight: 500 }}>+{data.upcomingAmount.toLocaleString()}원</span> 납부 예정 ({data.upcomingCount}건)
            </p>
          )}
        </div>

        {/* Row 3 Right: 월 지출 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            월 지출
          </p>
          <p style={{ fontSize: 22, fontWeight: 700, color: '#5a4a3a', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.totalExpense.toLocaleString()}
            <small style={{ fontSize: 11, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: 10.5, color: 'var(--warm-muted)' }}>이달 지출 합계</p>
        </div>

        {/* Row 4 Left: 보유 보증금 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            보유 보증금
          </p>
          <p style={{ fontSize: 22, fontWeight: 700, color: '#7c3aed', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.totalDeposit.toLocaleString()}
            <small style={{ fontSize: 11, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: 10.5, color: 'var(--warm-muted)' }}>현재 보증금 합계</p>
        </div>

        {/* Row 4 Right: 보유 예비비 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            보유 예비비
          </p>
          <p style={{ fontSize: 22, fontWeight: 700, color: '#0d9488', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.reserveBalance.toLocaleString()}
            <small style={{ fontSize: 11, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>원</small>
          </p>
          <p style={{ fontSize: 10.5, color: 'var(--warm-muted)' }}>
            {data.reserveMonthly.deposit > 0 || data.reserveMonthly.withdraw > 0 ? (
              <>
                이달 <span style={{ color: '#10b981' }}>+{data.reserveMonthly.deposit.toLocaleString()}</span>
                {' / '}
                <span style={{ color: '#f59e0b' }}>−{data.reserveMonthly.withdraw.toLocaleString()}</span>
              </>
            ) : '이번 달 거래 없음'}
          </p>
        </div>

        {/* Row 5 Left: 입실 현황 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            입실 현황
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#5a4a3a', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.occupiedRooms}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)' }}> / {data.totalRooms}</small>
          </p>
          <p style={{ fontSize: 10.5, color: 'var(--warm-muted)' }}>
            공실 <em style={{ fontStyle: 'normal', color: 'var(--coral)' }}>{data.vacantRooms}개</em>
          </p>
        </div>
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
                  <div className="rounded-xl p-5 flex flex-col" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                    <div className="flex items-center justify-between mb-3.5 shrink-0">
                      <p style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>
                        방 현황
                        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 6 }}>{data.totalRooms}개 호실</span>
                      </p>
                      <Link href="/room-manage" style={{ fontSize: 11, color: 'var(--coral)' }}>전체 보기 →</Link>
                    </div>
                    {data.rooms.length === 0 ? (
                      <p className="text-center py-8 text-sm" style={{ color: 'var(--warm-muted)' }}>등록된 호실 없음</p>
                    ) : (
                      <>
                        {/* 범례 */}
                        <div className="flex gap-3.5 mb-3 shrink-0 flex-wrap">
                          <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(16,185,129,0.35)' }} />납부완료
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(59,130,246,0.35)' }} />납부예정
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(234,179,8,0.45)' }} />미납
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(200,160,120,0.25)' }} />공실
                          </div>
                        </div>
                        <div className="grid gap-[6px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                          {(() => {
                            // viewMonth(targetMonth) 기준 미납·납부예정 호실
                            const unpaidRooms = new Set(data.unpaidRoomNosForView)
                            const awaitingRooms = new Set(data.awaitingRoomNosForView)
                            return data.rooms.map(r => {
                              const isUnpaid = !r.isVacant && unpaidRooms.has(r.roomNo)
                              const isAwaiting = !r.isVacant && !isUnpaid && awaitingRooms.has(r.roomNo)
                              const rentMan = r.baseRent > 0 ? `${Math.round(r.baseRent / 10000)}만` : null
                              const nameParts = r.tenantName?.split(' ') ?? []
                              const displayName = r.isVacant
                                ? '공실'
                                : nameParts.length >= 2 ? nameParts[1] : (r.tenantName ?? '거주중')
                              const cellStyle = r.isVacant
                                ? { background: 'rgba(200,160,120,0.12)', color: 'var(--warm-muted)' }
                                : isUnpaid
                                  ? { background: 'rgba(234,179,8,0.18)', color: '#a16207' }
                                  : isAwaiting
                                    ? { background: 'rgba(59,130,246,0.12)', color: '#1e40af' }
                                    : { background: 'rgba(16,185,129,0.12)', color: '#047857' }
                              return (
                                <div
                                  key={r.roomNo}
                                  onClick={() => setSelectedRoom(r)}
                                  className="rounded-[8px] flex flex-col items-center justify-center px-1 py-2.5 gap-[3px] cursor-pointer transition-opacity hover:opacity-75 overflow-hidden"
                                  style={cellStyle}
                                >
                                  <span className="truncate w-full text-center font-bold" style={{ fontSize: 11 }}>{r.roomNo}호</span>
                                  <span className="truncate w-full text-center" style={{ fontSize: 10, fontWeight: 500 }}>{displayName}</span>
                                  {rentMan && <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>{rentMan}</span>}
                                </div>
                              )
                            })
                          })()}
                        </div>
                      </>
                    )}
                  </div>

                  {/* 이달 손익 현황 */}
                  <div className="rounded-xl p-5 flex flex-col gap-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>이달 손익 현황</h3>
                        <p style={{ fontSize: 11, color: 'var(--warm-muted)', marginTop: 1 }}>
                          {parseInt(targetMonth.slice(5))}월 예상 순이익 {data.netProfit + data.unpaidAmount !== 0
                            ? `${fmtKorMoney((data.netProfit + data.unpaidAmount))}`
                            : '—'}
                        </p>
                      </div>
                      <Link href={`/rooms?month=${targetMonth}`} style={{ fontSize: 11, color: 'var(--coral)' }}>수납 관리 →</Link>
                    </div>

                    {/* ── 매출 섹션 ── */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>예상 매출</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>
                          {fmtKorMoney(data.totalExpected)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(200,160,120,0.15)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${data.totalExpected > 0 ? Math.min(100, Math.round((data.paidRevenue / data.totalExpected) * 100)) : 0}%`, background: 'var(--sun)' }} />
                      </div>
                      <div className="space-y-1.5 pt-0.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--sun)' }} />
                            <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>수납 완료</span>
                            <span className="rounded-full px-1.5 py-0.5" style={{ fontSize: 9, fontWeight: 600, background: 'rgba(251,191,36,0.15)', color: 'var(--sun)' }}>{data.paidCount}건</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--sun)' }}>
                            {fmtKorMoney(data.paidRevenue)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(200,160,120,0.4)' }} />
                            <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>수납 예정</span>
                            {data.pendingCount > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ fontSize: 9, fontWeight: 600, background: data.unpaidCount > 0 ? 'rgba(239,68,68,0.1)' : 'rgba(59,130,246,0.12)', color: data.unpaidCount > 0 ? '#ef4444' : '#1e40af' }}>
                                {data.pendingCount}건{data.unpaidCount > 0 ? ` (미납 ${data.unpaidCount})` : ''}
                              </span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: data.unpaidCount > 0 ? '#ef4444' : 'var(--warm-mid)' }}>
                            {data.unpaidAmount > 0 ? `-${fmtKorMoney(data.unpaidAmount )}` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div style={{ borderTop: `1px solid ${DIVIDER_COLOR}` }} />

                    {/* ── 지출 섹션 ── */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>
                          예상 지출{!data.hasExpenseHistory ? <span style={{ fontSize: 10, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 4 }}>고정지출 기준</span> : null}
                        </span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>
                          {fmtKorMoney(data.expectedExpense)}
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(200,160,120,0.15)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${data.expectedExpense > 0 ? Math.min(100, Math.round((data.totalExpense / data.expectedExpense) * 100)) : 0}%`,
                            background: 'var(--warm-mid)',
                          }} />
                      </div>
                      <div className="space-y-1.5 pt-0.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--warm-mid)' }} />
                            <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>실제 지출</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warm-mid)' }}>
                            {fmtKorMoney(data.totalExpense)}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>
                            {data.totalExpense <= data.expectedExpense ? '절감 예상' : '초과'}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: data.totalExpense <= data.expectedExpense ? 'var(--warm-mid)' : 'var(--coral)' }}>
                            {data.expectedExpense > 0
                              ? `${data.totalExpense <= data.expectedExpense ? '-' : '+'}${fmtKorMoney(Math.abs(data.expectedExpense - data.totalExpense))}`
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div style={{ borderTop: `1px solid ${DIVIDER_COLOR}` }} />

                    {/* ── 순이익 섹션 ── */}
                    {(() => {
                      const expectedNet = data.netProfit + data.unpaidAmount
                      const currentNet  = data.netProfit
                      const pct = expectedNet > 0 ? Math.max(0, Math.min(100, Math.round((currentNet / expectedNet) * 100))) : 0
                      return (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between mb-1">
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>예상 순이익</span>
                            <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>
                              {expectedNet !== 0 ? `${fmtKorMoney(expectedNet )}` : '—'}
                            </span>
                          </div>
                          <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(244,98,58,0.1)', outline: '1px solid rgba(244,98,58,0.25)', outlineOffset: '-1px' }}>
                            <div className="h-full rounded-full transition-all duration-700"
                              style={{ width: `${pct}%`, background: 'var(--coral)' }} />
                          </div>
                          <div className="space-y-1.5 pt-0.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--coral)' }} />
                                <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>현재 순이익</span>
                              </div>
                              <span style={{ fontSize: 12, fontWeight: 600, color: currentNet >= 0 ? 'var(--coral)' : '#ef4444' }}>
                                {currentNet >= 0 ? '+' : ''}{fmtKorMoney(currentNet)}
                              </span>
                            </div>
                            <div className="flex items-center justify-between">
                              <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>달성률</span>
                              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--warm-mid)' }}>
                                {expectedNet > 0 ? `${pct.toLocaleString()}%` : '—'}
                              </span>
                            </div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>

                </div>{/* /좌측 */}

                {/* 우측: 이달 미수납 + 납입 완료 (하나의 연결된 카드) */}
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>

                  {/* 이달 미수납 */}
                  <div>
                    <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
                      <div className="flex items-center gap-2">
                        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>이달 미수납</h3>
                        <span className="rounded-full text-[9px] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{basisLabel}</span>
                      </div>
                      {data.unpaidCount > 0 && (
                        <span className="rounded-full text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>
                          {data.unpaidCount}건
                        </span>
                      )}
                    </div>
                    {sortedUnpaid.length === 0 ? (
                      <p className="text-sm text-center py-6" style={{ color: 'var(--warm-muted)' }}>이달 수납 완료 🎉</p>
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
                                  style={{ background: 'var(--sand)', fontSize: 11, color: '#c08050' }}>
                                  {l.tenantName.slice(0, 1)}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-xs font-semibold truncate flex items-center gap-1" style={{ color: '#5a4a3a' }}>
                                    {l.roomNo}호 {l.tenantName}
                                    {l.daysOverdue != null && l.daysOverdue >= 7 && (
                                      <span className="rounded-full text-[9px] font-bold px-1.5 py-0.5" style={{ background: '#dc2626', color: '#fff' }}>
                                        {l.daysOverdue}일 경과
                                      </span>
                                    )}
                                  </p>
                                  <p className="text-[10px] font-medium mt-0.5" style={{ color: dl.color }}>{dl.text}</p>
                                </div>
                                <span className="rounded-full shrink-0 text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
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
                        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>납입 완료</h3>
                        <span className="rounded-full text-[9px] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>{basisLabel}</span>
                      </div>
                      {data.activity.length > 0 && (
                        <span className="rounded-full text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>
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
                                style={{ background: 'rgba(34,197,94,0.12)', fontSize: 11, color: '#16a34a' }}>
                                {item.tenantName.slice(0, 1)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: '#5a4a3a' }}>{item.roomNo}호 {item.tenantName}</p>
                                <p className="text-[10px] font-medium mt-0.5" style={{ color: 'var(--warm-muted)' }}>{item.timeLabel}</p>
                              </div>
                              <span className="rounded-full shrink-0 text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(34,197,94,0.1)', color: '#16a34a' }}>
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
                              : <>더보기 <span style={{ color: '#16a34a' }}>+{data.activity.length - ACTIVITY_LIMIT}</span> ↓</>}
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

      {selectedRoom && (
        <RoomDetailPopup
          room={selectedRoom}
          onClose={() => setSelectedRoom(null)}
          onOpenPayment={id => { setSelectedRoom(null); setDashTenantId(id) }}
          onOpenTenantInfo={id => { setSelectedRoom(null); setTenantInfoId(id) }}
        />
      )}
      {selectedAlert && (
        <AlertDetailModal
          alert={selectedAlert}
          onClose={() => setSelectedAlert(null)}
          onOpenPayment={id => { setSelectedAlert(null); setDashTenantId(id) }}
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
