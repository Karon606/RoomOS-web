'use client'

import Link from 'next/link'
import { useState, useTransition, useEffect } from 'react'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { DatePicker } from '@/components/ui/DatePicker'
import { analyzeDashboardWithGemini, getTrendData, type TrendRange, type TrendPoint } from './actions'
import { getTenantLeaseForDashboard, getPaymentsByLease, savePayment, saveDepositPayment, updatePayment, deletePayment } from '@/app/(app)/rooms/actions'
import { recordRecurringExpense } from '@/app/(app)/finance/actions'

// ── 타입 ────────────────────────────────────────────────────────

export type DashboardData = {
  totalRevenue:      number
  paidRevenue:       number
  extraRevenue:      number
  totalExpense:      number
  netProfit:         number
  totalDeposit:      number
  paidCount:         number
  unpaidCount:       number
  unpaidAmount:      number
  totalExpected:     number
  categoryBreakdown: { category: string; amount: number; percent: number }[]
  trend:             { month: string; revenue: number; expense: number; profit: number }[]
  totalRooms:        number
  vacantRooms:       number
  occupiedRooms:     number
  statusCounts:      { active: number; reserved: number; checkout: number; nonResident: number }
  totalTenants:      number
  genderDist:        { label: string; count: number; percent: number }[]
  nationalityDist:   { label: string; count: number; percent: number }[]
  jobDist:           { label: string; count: number; percent: number }[]
  rooms:             { roomNo: string; isVacant: boolean; tenantName: string | null; tenantStatus: string | null; type: string | null; windowType: string | null; direction: string | null; areaPyeong: number | null; areaM2: number | null; baseRent: number; scheduledRent: number | null; rentUpdateDate: string | null }[]
  alerts:            { text: string; link: string; dotColor: string; timeLabel: string; tenantId?: string; detail?: string; exactDate?: string; recurringExpenseId?: string; recurringAmount?: number; recurringDueDate?: string; recurringCategory?: string; recurringPayMethod?: string; recurringIsVariable?: boolean; recurringHistoricalAvg?: number }[]
  expectedExpense:   number
  activity:          { text: string; timeLabel: string; dotColor: string; link: string; tenantId: string; tenantName: string; roomNo: string; amount: number }[]
  unpaidLeases:      { roomNo: string; tenantName: string; tenantId: string; leaseId: string; daysOverdue: number | null; unpaidAmount: number }[]
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

const CATEGORY_COLORS: Record<string, string> = {
  관리비:   '#f4623a',
  수선유지: '#f97316',
  세금:     '#ef4444',
  인건비:   '#a855f7',
  소모품:   '#22c55e',
  기타:     '#a89888',
}
const FALLBACK_COLORS = ['#f4623a','#f97316','#ef4444','#a855f7','#22c55e','#a89888','#3b82f6','#eab308']
const GENDER_LABEL: Record<string, string> = { MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '미기재' }
const GENDER_COLOR: Record<string, string>  = { MALE: '#3b82f6', FEMALE: '#ec4899', OTHER: '#a855f7', UNKNOWN: '#a89888' }
const DIST_COLORS = ['#f4623a', '#22c55e', '#f97316', '#a855f7', '#eab308', '#a89888']
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
  if (daysOverdue > 0)  return { text: `${daysOverdue}일 초과`, color: '#ef4444' }
  if (daysOverdue === 0) return { text: '오늘 납부일', color: '#f97316' }
  return { text: `D${daysOverdue}`, color: '#eab308' }  // e.g. D-5
}

// ── 알림 상세 팝업 ───────────────────────────────────────────────

type AlertItem = DashboardData['alerts'][number]

function AlertDetailModal({ alert, onClose, onOpenPayment, onStartRecord }: {
  alert: AlertItem
  onClose: () => void
  onOpenPayment: (id: string) => void
  onStartRecord: (alert: AlertItem) => void
}) {
  const initial = alert.text.slice(0, 1)
  const avatarBg = hexToRgba(alert.dotColor, 0.15)
  const isRecurring = !!alert.recurringExpenseId

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
          <button onClick={onClose} className="ml-3 shrink-0 text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
        </div>

        {/* 상세 내용 */}
        {alert.detail && (
          <div className="px-5 py-4" style={{ borderBottom: isRecurring || alert.tenantId ? `1px solid ${DIVIDER_COLOR}` : undefined }}>
            <p className="text-sm whitespace-pre-line leading-relaxed" style={{ color: 'var(--warm-dark)' }}>{alert.detail}</p>
          </div>
        )}

        {/* 하단 버튼 */}
        <div className="px-5 pb-5 pt-4 space-y-2">
          {isRecurring && (
            <button
              onClick={() => { onStartRecord(alert); onClose() }}
              className="w-full py-2.5 rounded-xl text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ background: 'var(--coral)', color: 'white' }}>
              지출 기록하기
            </button>
          )}
          {alert.tenantId && !isRecurring && (
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
            {isRecurring ? '지출/기타 수익에서 보기 →' : '입주자 관리에서 보기 →'}
          </Link>
        </div>
      </div>
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
  const [date, setDate]           = useState(alert.recurringDueDate ?? new Date().toISOString().slice(0, 10))
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
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none">✕</button>
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
                    <span className="text-[10px] rounded-full px-1.5 py-0.5" style={{ background: 'rgba(99,102,241,0.1)', color: '#6366f1' }}>
                      평균 {Math.round(alert.recurringHistoricalAvg / 10000).toLocaleString()}만원
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

// ── 알림 스트립 (항상 표시) ──────────────────────────────────────

function AlertsStrip({ alerts, onOpenAlert }: {
  alerts: DashboardData['alerts']
  onOpenAlert: (alert: AlertItem) => void
}) {
  const [expanded, setExpanded] = useState(false)
  if (alerts.length === 0) return null
  const visible = expanded ? alerts : alerts.slice(0, ALERTS_LIMIT)
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
      <div>
        {visible.map((item, i) => (
          <div key={i} style={{ borderBottom: i < visible.length - 1 ? `1px solid ${DIVIDER_COLOR}` : 'none' }}>
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
      {alerts.length > ALERTS_LIMIT && (
        <button
          onClick={() => setExpanded(v => !v)}
          className="w-full py-2.5 text-xs font-medium border-t flex items-center justify-center gap-1 hover:opacity-70 transition-opacity"
          style={{ borderColor: DIVIDER_COLOR, color: 'var(--warm-muted)' }}
        >
          {expanded
            ? <>접기 ↑</>
            : <>더보기 <span style={{ color: 'var(--coral)' }}>+{alerts.length - ALERTS_LIMIT}</span> ↓</>}
        </button>
      )}
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

  const trendMax = Math.max(...trendPoints.flatMap(t => [t.revenue, t.expense]), 1)
  const categorySegments = data.categoryBreakdown.map((c, i) => ({
    value: c.amount,
    color: CATEGORY_COLORS[c.category] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
  }))
  const paymentSegments = [
    { value: data.paidCount,   color: '#22c55e' },
    { value: data.unpaidCount, color: '#ef4444' },
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
            { label: '수납액',   value: data.paidRevenue,  color: 'var(--coral)' },
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
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: 'var(--coral)' }} />수입</span>
            <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }} />지출</span>
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
          <div className="h-36 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div className="flex items-end gap-1" style={{ minWidth: trendPoints.length > 14 ? `${trendPoints.length * 36}px` : undefined }}>
              {trendPoints.map((t, i) => {
                const isLast = i === trendPoints.length - 1
                const revPct = Math.round((t.revenue / trendMax) * 100)
                const expPct = Math.round((t.expense / trendMax) * 100)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" style={{ minWidth: trendPoints.length > 14 ? '28px' : undefined }}>
                    <p className="text-xs font-medium whitespace-nowrap" style={{ color: t.profit >= 0 ? '#22c55e' : '#ef4444' }}>
                      {t.profit !== 0 ? `${t.profit >= 0 ? '+' : ''}${Math.round(t.profit / 10000)}만` : ''}
                    </p>
                    <div className="w-full flex items-end gap-0.5 h-28">
                      <div className="flex-1 rounded-t-sm" style={{ background: 'var(--coral)', opacity: isLast ? 1 : 0.5, height: `${revPct}%`, minHeight: t.revenue > 0 ? '2px' : '0' }} />
                      <div className="flex-1 rounded-t-sm" style={{ background: '#ef4444', opacity: isLast ? 1 : 0.5, height: `${expPct}%`, minHeight: t.expense > 0 ? '2px' : '0' }} />
                    </div>
                    <p className="text-xs truncate w-full text-center" style={{ color: isLast ? 'var(--warm-dark)' : 'var(--warm-muted)', fontWeight: isLast ? 600 : 400 }}>
                      {t.label}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
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
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: CATEGORY_COLORS[c.category] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }} />
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
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-green-500" />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>완납</span>
                <span className="text-sm font-semibold text-green-500">{data.paidCount}건</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-red-500" />
                <span className="text-sm flex-1" style={{ color: 'var(--warm-mid)' }}>미납</span>
                <span className="text-sm font-semibold text-red-500">{data.unpaidCount}건</span>
              </div>
              <div className="pt-2" style={{ borderTop: '1px solid var(--warm-border)' }}>
                <Row label="이달 수납액" value={<MoneyDisplay amount={data.paidRevenue} />} />
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
    { value: data.statusCounts.active,      color: '#22c55e' },
    { value: data.statusCounts.reserved,    color: '#3b82f6' },
    { value: data.statusCounts.checkout,    color: '#eab308' },
    { value: data.statusCounts.nonResident, color: '#f59e0b' },
  ]
  const genderSegments = data.genderDist.map(d => ({ value: d.count, color: GENDER_COLOR[d.label] ?? '#a89888' }))

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="전체 입주자"  value={`${data.totalTenants}명`}               sub="현재 계약 기준" />
        <StatCard label="거주중"       value={`${data.statusCounts.active}명`}         sub="ACTIVE"        colorStyle={{ color: '#22c55e' }} />
        <StatCard label="입실 예정"    value={`${data.statusCounts.reserved}명`}       sub="RESERVED"      colorStyle={{ color: '#3b82f6' }} />
        <StatCard label="퇴실 예정"    value={`${data.statusCounts.checkout}명`}       sub="CHECKOUT"      colorStyle={{ color: '#eab308' }} />
        <StatCard label="비거주자"     value={`${data.statusCounts.nonResident}명`}    sub="NON_RESIDENT"  colorStyle={{ color: '#f59e0b' }} />
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
              {[{ label: '거주중', count: data.statusCounts.active, color: '#22c55e' }, { label: '입실 예정', count: data.statusCounts.reserved, color: '#3b82f6' }, { label: '퇴실 예정', count: data.statusCounts.checkout, color: '#eab308' }].map(s => (
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
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GENDER_COLOR[d.label] ?? '#a89888' }} />
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
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState('')

  const handleAnalyze = () => {
    setError('')
    startTransition(async () => {
      try {
        const result = await analyzeDashboardWithGemini(data, targetMonth)
        setAiText(result)
      } catch (e) {
        setError((e as Error).message)
      }
    })
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold" style={{ color: 'var(--warm-dark)' }}>Gemini AI 재무 분석</h3>
            <p className="text-xs mt-0.5" style={{ color: 'var(--warm-muted)' }}>{targetMonth} 운영 데이터 기반 AI 분석</p>
          </div>
          <button onClick={handleAnalyze} disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-xl transition-colors disabled:opacity-60"
            style={{ background: 'var(--coral)' }}>
            {isPending
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />분석 중...</>
              : '✦ AI 분석하기'}
          </button>
        </div>
        {!aiText && !isPending && !error && (
          <div className="text-center py-10 text-sm" style={{ color: 'var(--warm-muted)' }}>버튼을 눌러 이달 재무 현황 AI 분석을 시작하세요</div>
        )}
        {isPending && (
          <div className="flex items-center gap-3 py-8 justify-center text-sm" style={{ color: 'var(--coral)' }}>
            <span className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: 'var(--coral)', borderTopColor: 'transparent' }} />
            Gemini가 재무 데이터를 분석하고 있습니다...
          </div>
        )}
        {error && <p className="text-red-500 text-sm py-4 text-center">{error}</p>}
        {aiText && !isPending && (
          <div className="rounded-xl p-4" style={{ background: 'var(--coral-pale)', border: '1px solid rgba(244,98,58,0.2)' }}>
            <div className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: 'var(--warm-dark)' }}>{aiText}</div>
            <button onClick={handleAnalyze} className="mt-3 text-xs" style={{ color: 'var(--coral)' }}>↻ 다시 분석</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ── 입주자 수납 팝업 (대시보드용) ────────────────────────────────

type DashLease = Awaited<ReturnType<typeof getTenantLeaseForDashboard>>
type DashPayRecord = { id: string; seqNo: number; actualAmount: number; payDate: Date; payMethod: string | null; memo: string | null; isDeposit: boolean }

function DashboardTenantModal({ tenantId, targetMonth, onClose }: {
  tenantId: string
  targetMonth: string
  onClose: () => void
}) {
  const [lease, setLease] = useState<DashLease>(null)
  const [payHistory, setPayHistory] = useState<DashPayRecord[]>([])
  const [acquisitionDate, setAcquisitionDate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [payAmount, setPayAmount] = useState(0)
  const [payDate, setPayDate] = useState(new Date().toISOString().slice(0, 10))
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
    setEditDate(new Date(p.payDate).toISOString().slice(0, 10))
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
          <button onClick={onClose} className="text-[var(--warm-muted)] hover:text-[var(--warm-dark)] text-xl leading-none ml-4">✕</button>
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
                      <input name="payMethod" type="text" placeholder="계좌이체, 현금…"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
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

        {/* 하단 — 입주자 관리에서 보기 */}
        {!loading && lease && (
          <div className="px-6 py-3 border-t shrink-0" style={{ borderColor: 'var(--warm-border)' }}>
            <Link href={`/tenants?tenantId=${lease.tenant.id}&tab=info`}
              onClick={onClose}
              className="block w-full text-center text-xs font-medium py-2 rounded-xl border transition-colors"
              style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
              입주자 관리에서 보기 →
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
          <button onClick={() => onEdit(p)} className="text-[10px] font-medium px-2 py-1 rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>수정</button>
          <button onClick={() => onDelete(p.id)} className="text-[10px] font-medium px-2 py-1 rounded-lg border border-red-200 text-red-500 transition-colors">삭제</button>
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
        <button onClick={onCancel} className="text-xs px-3 py-1.5 rounded-lg border transition-colors" style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>취소</button>
        <button onClick={onSave} disabled={isPending} className="text-xs text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50" style={{ background: 'var(--coral)' }}>저장</button>
      </div>
    </div>
  )
}

// ── 방 상세 팝업 ─────────────────────────────────────────────────

function RoomDetailPopup({ room, onClose }: { room: DashboardData['rooms'][number]; onClose: () => void }) {
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
        <div className="px-5 pb-4">
          <Link href={`/room-manage`}
            className="block w-full text-center text-xs font-medium py-2 rounded-xl border transition-colors"
            style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
            호실 관리에서 보기 →
          </Link>
        </div>
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
  const [tab, setTab]                             = useState<Tab>('overview')
  const [selectedRoom, setSelectedRoom]           = useState<DashboardData['rooms'][number] | null>(null)
  const [dashTenantId, setDashTenantId]           = useState<string | null>(null)
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

      {/* ── KPI 카드 ────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3.5">

        {/* 이달 수입 */}
        <div className="rounded-xl" style={{ background: 'var(--coral)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'rgba(255,252,247,0.6)', marginBottom: 8 }}>
            이달 수입
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#fff', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {Math.round(data.totalRevenue / 10000).toLocaleString()}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'rgba(255,252,247,0.6)', marginLeft: 2 }}>만</small>
          </p>
          <p style={{ fontSize: 11, color: 'rgba(255,252,247,0.55)' }}>
            {revChange != null && (
              <em style={{ fontStyle: 'normal', color: '#fbbf24', marginRight: 3 }}>
                {revChange >= 0 ? '+' : ''}{revChange}%
              </em>
            )}
            수납액+기타수익
          </p>
        </div>

        {/* 입실 현황 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            입실 현황
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#5a4a3a', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {data.occupiedRooms}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)' }}> / {data.totalRooms}</small>
          </p>
          <p style={{ fontSize: 11, color: 'var(--warm-muted)' }}>
            공실 <em style={{ fontStyle: 'normal', color: 'var(--coral)' }}>{data.vacantRooms}개</em>
          </p>
        </div>

        {/* 이번 달 지출 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            이번 달 지출
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, color: '#5a4a3a', letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6 }}>
            {Math.round(data.totalExpense / 10000).toLocaleString()}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>만</small>
          </p>
          <p style={{ fontSize: 11, color: 'var(--warm-muted)' }}>이달 지출 합계</p>
        </div>

        {/* 미납 금액 */}
        <div className="rounded-xl" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', padding: '18px 20px' }}>
          <p style={{ fontSize: '10.5px', fontWeight: 500, letterSpacing: '0.02em', textTransform: 'uppercase', color: 'var(--warm-muted)', marginBottom: 8 }}>
            미납 금액
          </p>
          <p style={{ fontSize: 26, fontWeight: 700, letterSpacing: '-0.03em', lineHeight: 1, marginBottom: 6, color: data.unpaidCount > 0 ? '#ef4444' : '#5a4a3a' }}>
            {Math.round(data.unpaidAmount / 10000).toLocaleString()}
            <small style={{ fontSize: 13, fontWeight: 400, color: 'var(--warm-muted)', marginLeft: 2 }}>만</small>
          </p>
          <p style={{ fontSize: 11, color: 'var(--warm-muted)' }}>
            <em style={{ fontStyle: 'normal', color: data.unpaidCount > 0 ? 'var(--coral)' : 'var(--warm-muted)' }}>{data.unpaidCount}명</em> 미납
          </p>
        </div>
      </div>

      {/* ── 알림 스트립 (항상 표시) ─────────────────────────────── */}
      <AlertsStrip alerts={data.alerts} onOpenAlert={setSelectedAlert} />

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
                        <div className="grid gap-[6px]" style={{ gridTemplateColumns: 'repeat(5, minmax(0, 1fr))' }}>
                          {data.rooms.map(r => {
                            const rentMan = r.baseRent > 0 ? `${Math.round(r.baseRent / 10000)}만` : null
                            return (
                              <div
                                key={r.roomNo}
                                onClick={() => setSelectedRoom(r)}
                                className="rounded-[8px] flex flex-col items-center justify-center px-1 py-2.5 gap-[4px] cursor-pointer transition-opacity hover:opacity-75 overflow-hidden"
                                style={r.isVacant
                                  ? { background: 'rgba(200,160,120,0.12)', color: 'var(--warm-muted)' }
                                  : { background: 'rgba(244,98,58,0.09)', color: 'var(--coral)' }}
                              >
                                <span className="truncate w-full text-center font-bold" style={{ fontSize: 12 }}>{r.roomNo}호</span>
                                <span style={{ fontSize: 10, fontWeight: 500 }}>{r.isVacant ? '공실' : '입실'}</span>
                                {rentMan && <span style={{ fontSize: 10, fontWeight: 600, opacity: 0.8 }}>{rentMan}</span>}
                              </div>
                            )
                          })}
                        </div>
                        <div className="flex gap-3.5 mt-3 shrink-0">
                          <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(244,98,58,0.25)' }} />입실
                          </div>
                          <div className="flex items-center gap-[5px]" style={{ fontSize: 10, color: 'var(--warm-muted)' }}>
                            <span className="inline-block w-[7px] h-[7px] rounded-[2px]" style={{ background: 'rgba(200,160,120,0.25)' }} />공실
                          </div>
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
                          {parseInt(targetMonth.slice(5))}월 예상 순이익 {data.totalExpected > 0 || data.expectedExpense > 0
                            ? `${Math.round((data.totalExpected - data.expectedExpense) / 10000).toLocaleString()}만원`
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
                          {Math.round(data.totalExpected / 10000).toLocaleString()}만원
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(200,160,120,0.15)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{ width: `${data.totalExpected > 0 ? Math.min(100, Math.round((data.paidRevenue / data.totalExpected) * 100)) : 0}%`, background: 'var(--coral)' }} />
                      </div>
                      <div className="space-y-1.5 pt-0.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'var(--coral)' }} />
                            <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>수납 완료</span>
                            <span className="rounded-full px-1.5 py-0.5" style={{ fontSize: 9, fontWeight: 600, background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>{data.paidCount}건</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--coral)' }}>
                            {Math.round(data.paidRevenue / 10000).toLocaleString()}만원
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: 'rgba(200,160,120,0.4)' }} />
                            <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>미수납</span>
                            {data.unpaidCount > 0 && (
                              <span className="rounded-full px-1.5 py-0.5" style={{ fontSize: 9, fontWeight: 600, background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>{data.unpaidCount}건</span>
                            )}
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: data.unpaidAmount > 0 ? '#ef4444' : 'var(--warm-muted)' }}>
                            {data.unpaidAmount > 0 ? `-${Math.round(data.unpaidAmount / 10000).toLocaleString()}만원` : '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* 구분선 */}
                    <div style={{ borderTop: `1px solid ${DIVIDER_COLOR}` }} />

                    {/* ── 지출 섹션 ── */}
                    <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>예상 지출</span>
                        <span style={{ fontSize: 11, fontWeight: 600, color: '#5a4a3a' }}>
                          {Math.round(data.expectedExpense / 10000).toLocaleString()}만원
                        </span>
                      </div>
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'rgba(239,68,68,0.08)' }}>
                        <div className="h-full rounded-full transition-all duration-700"
                          style={{
                            width: `${data.expectedExpense > 0 ? Math.min(100, Math.round((data.totalExpense / data.expectedExpense) * 100)) : 0}%`,
                            background: data.totalExpense > data.expectedExpense ? '#ef4444' : '#f97316',
                          }} />
                      </div>
                      <div className="space-y-1.5 pt-0.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: '#f97316' }} />
                            <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>실제 지출</span>
                          </div>
                          <span style={{ fontSize: 12, fontWeight: 600, color: data.totalExpense > data.expectedExpense ? '#ef4444' : '#f97316' }}>
                            {Math.round(data.totalExpense / 10000).toLocaleString()}만원
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span style={{ fontSize: 11, color: 'var(--warm-muted)' }}>
                            {data.totalExpense <= data.expectedExpense ? '절감 예상' : '초과'}
                          </span>
                          <span style={{ fontSize: 12, fontWeight: 600, color: data.totalExpense <= data.expectedExpense ? '#16a34a' : '#ef4444' }}>
                            {data.expectedExpense > 0
                              ? `${data.totalExpense <= data.expectedExpense ? '-' : '+'}${Math.round(Math.abs(data.expectedExpense - data.totalExpense) / 10000).toLocaleString()}만원`
                              : '—'}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                </div>{/* /좌측 */}

                {/* 우측: 이달 미수납 + 납입 완료 (하나의 연결된 카드) */}
                <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>

                  {/* 이달 미수납 */}
                  <div>
                    <div className="flex items-center justify-between px-5 pt-4 pb-3" style={{ borderBottom: `1px solid ${DIVIDER_COLOR}` }}>
                      <div className="flex items-center gap-2">
                        <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>이달 미수납</h3>
                        <span className="rounded-full text-[9px] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>오늘 기준</span>
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
                                  <p className="text-xs font-semibold truncate" style={{ color: '#5a4a3a' }}>{l.roomNo}호 {l.tenantName}</p>
                                  <p className="text-[10px] font-medium mt-0.5" style={{ color: dl.color }}>{dl.text}</p>
                                </div>
                                <span className="rounded-full shrink-0 text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                                  {Math.round(l.unpaidAmount / 10000)}만원
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
                        <span className="rounded-full text-[9px] font-semibold px-1.5 py-0.5" style={{ background: 'var(--canvas)', color: 'var(--warm-muted)' }}>최근 30일</span>
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
                                {Math.round(item.amount / 10000)}만원
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

      {selectedRoom && <RoomDetailPopup room={selectedRoom} onClose={() => setSelectedRoom(null)} />}
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
          onClose={() => setDashTenantId(null)}
        />
      )}
    </div>
  )
}
