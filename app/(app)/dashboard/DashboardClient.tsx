'use client'

import Link from 'next/link'
import { useState, useTransition, useEffect } from 'react'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { analyzeDashboardWithGemini, getTrendData, type TrendRange, type TrendPoint } from './actions'

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
  rooms:             { roomNo: string; isVacant: boolean; tenantName: string | null; tenantStatus: string | null; type: string | null; windowType: string | null; direction: string | null; areaPyeong: number | null; areaM2: number | null; baseRent: number }[]
  alerts:            { text: string; link: string; dotColor: string; timeLabel: string; tenantId?: string }[]
  activity:          { text: string; timeLabel: string; dotColor: string; link: string }[]
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
const UNPAID_LIMIT = 5

// ── 미수납 days 표시 ────────────────────────────────────────────

function daysLabel(daysOverdue: number | null): { text: string; color: string } {
  if (daysOverdue == null) return { text: '—', color: 'var(--warm-muted)' }
  if (daysOverdue > 0)  return { text: `${daysOverdue}일 초과`, color: '#ef4444' }
  if (daysOverdue === 0) return { text: '오늘 납부일', color: '#f97316' }
  return { text: `D${daysOverdue}`, color: '#eab308' }  // e.g. D-5
}

// ── 알림 스트립 (항상 표시) ──────────────────────────────────────

function AlertsStrip({ alerts }: { alerts: DashboardData['alerts'] }) {
  if (alerts.length === 0) return null
  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between px-4 pt-3 pb-1.5">
        <span style={{ fontSize: 12, fontWeight: 600, color: '#5a4a3a' }}>
          알림
        </span>
        <span className="rounded-full px-2 py-0.5 text-[10px] font-semibold" style={{ background: 'rgba(244,98,58,0.1)', color: 'var(--coral)' }}>
          {alerts.length}건
        </span>
      </div>
      <div className="divide-y" style={{ borderColor: 'var(--warm-border)' }}>
        {alerts.map((item, i) => (
          <Link
            key={i}
            href={item.link}
            className="flex items-center gap-3 px-4 py-2.5 hover:opacity-70 transition-opacity"
          >
            <span className="w-[6px] h-[6px] rounded-full shrink-0" style={{ background: item.dotColor }} />
            <span className="flex-1 text-xs leading-snug" style={{ color: 'var(--warm-mid)' }}>{item.text}</span>
            <span className="text-[10px] shrink-0 font-mono" style={{ color: 'var(--warm-muted)' }}>{item.timeLabel}</span>
            <span style={{ color: 'var(--warm-muted)', fontSize: 11 }}>›</span>
          </Link>
        ))}
      </div>
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
            <span className="text-[var(--warm-muted)]">기본이용료</span>
            <span className="font-semibold text-[var(--warm-dark)]">{room.baseRent.toLocaleString()}원</span>
          </div>
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

export default function DashboardClient({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
  const [tab, setTab]                             = useState<Tab>('overview')
  const [selectedRoom, setSelectedRoom]           = useState<DashboardData['rooms'][number] | null>(null)
  const [unpaidExpanded, setUnpaidExpanded]       = useState(false)

  const prev = data.trend[data.trend.length - 2]
  const cur  = data.trend[data.trend.length - 1]
  const revChange = prev && prev.revenue > 0
    ? Math.round((cur.revenue - prev.revenue) / prev.revenue * 100)
    : null

  const maxRevenue = Math.max(...data.trend.map(t => t.revenue), 1)

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
      <AlertsStrip alerts={data.alerts} />

      {/* ── 탭 섹션 ─────────────────────────────────────────────── */}
      <div>
        {/* 탭 바 (밑줄 스타일) */}
        <div className="flex border-b-2 sticky -top-4 md:-top-6 z-10 -mx-1 px-1 pb-0" style={{ borderColor: 'var(--warm-border)', background: 'var(--canvas)' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className="px-5 py-2.5 text-sm font-medium transition-colors relative whitespace-nowrap"
              style={tab === t.key
                ? { color: 'var(--coral)', borderBottom: '2px solid var(--coral)', marginBottom: '-2px' }
                : { color: 'var(--warm-muted)' }}>
              {t.label}
            </button>
          ))}
        </div>

        {/* 탭 콘텐츠 */}
        <div className="pt-3.5 space-y-3.5">

          {/* ── 현황 탭 ── */}
          {tab === 'overview' && (
            <>
              {/* 방 현황 + 미수납 현황 */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5 lg:items-start">

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

                {/* 이달 미수납 */}
                <div className="rounded-xl flex flex-col" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                  <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b shrink-0" style={{ borderColor: 'var(--warm-border)' }}>
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
                    <p className="text-sm text-center py-8" style={{ color: 'var(--warm-muted)' }}>이달 수납 완료 🎉</p>
                  ) : (
                    <>
                      <div className="divide-y" style={{ borderColor: 'var(--warm-border)' }}>
                        {visibleUnpaid.map((l, i) => {
                          const dl = daysLabel(l.daysOverdue)
                          return (
                            <Link
                              key={i}
                              href={`/tenants?tenantId=${l.tenantId}&tab=info`}
                              className="flex items-center gap-3 px-5 py-3 hover:opacity-70 transition-opacity"
                            >
                              <div
                                className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 font-bold"
                                style={{ background: 'var(--sand)', fontSize: 11, color: '#c08050' }}
                              >
                                {l.tenantName.slice(0, 1)}
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-semibold truncate" style={{ color: '#5a4a3a' }}>
                                  {l.roomNo}호 {l.tenantName}
                                </p>
                                <p className="text-[10px] font-medium mt-0.5" style={{ color: dl.color }}>
                                  {dl.text}
                                </p>
                              </div>
                              <span className="rounded-full shrink-0 text-[10px] font-semibold px-2 py-0.5" style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}>
                                {Math.round(l.unpaidAmount / 10000)}만원
                              </span>
                            </Link>
                          )
                        })}
                      </div>
                      {sortedUnpaid.length > UNPAID_LIMIT && (
                        <button
                          onClick={() => setUnpaidExpanded(v => !v)}
                          className="w-full py-2.5 text-xs font-medium border-t flex items-center justify-center gap-1 hover:opacity-70 transition-opacity"
                          style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-muted)' }}
                        >
                          {unpaidExpanded
                            ? <>접기 ↑</>
                            : <>더보기 <span style={{ color: 'var(--coral)' }}>+{sortedUnpaid.length - UNPAID_LIMIT}</span> ↓</>}
                        </button>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* 월별 수납 현황 + 최근 납입 완료 */}
              <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-3.5">

                <div className="rounded-xl p-5" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>월별 수납 현황</h3>
                    <Link href={`/finance?month=${targetMonth}`} style={{ fontSize: 11, color: 'var(--coral)' }}>리포트 →</Link>
                  </div>
                  <div className="space-y-[9px]">
                    {data.trend.map(t => {
                      const pct = Math.round((t.revenue / maxRevenue) * 100)
                      return (
                        <div key={t.month} className="flex items-center gap-2.5">
                          <span className="w-7 shrink-0 text-right" style={{ fontSize: '10.5px', color: 'var(--warm-muted)' }}>
                            {parseInt(t.month.slice(5))}월
                          </span>
                          <div className="flex-1 h-[7px] rounded-full overflow-hidden" style={{ background: 'rgba(200,160,120,0.15)' }}>
                            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--coral)', transition: 'width 0.6s ease' }} />
                          </div>
                          <span className="w-14 text-right shrink-0" style={{ fontSize: '10.5px', fontWeight: 600, color: '#5a4a3a', fontFamily: 'monospace' }}>
                            {Math.round(t.revenue / 10000).toLocaleString()}만
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className="rounded-xl flex flex-col" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', minHeight: 160 }}>
                  <div className="flex items-center justify-between px-5 pt-4 pb-2 shrink-0">
                    <h3 style={{ fontSize: 13, fontWeight: 600, color: '#5a4a3a' }}>납입 완료</h3>
                    <Link href={`/rooms?month=${targetMonth}`} style={{ fontSize: 11, color: 'var(--coral)' }}>전체 →</Link>
                  </div>
                  <div className="flex-1 overflow-y-auto px-5">
                    {data.activity.length === 0 ? (
                      <p className="text-sm text-center py-6" style={{ color: 'var(--warm-muted)' }}>최근 납입 내역 없음</p>
                    ) : (
                      data.activity.map((item, i) => (
                        <Link
                          key={i}
                          href={item.link}
                          className="flex items-start gap-2.5 py-[10px] hover:opacity-70 transition-opacity"
                          style={{ borderBottom: i < data.activity.length - 1 ? '1px solid var(--warm-border)' : 'none' }}
                        >
                          <span className="w-[7px] h-[7px] rounded-full shrink-0 mt-1" style={{ background: item.dotColor }} />
                          <span className="flex-1 leading-snug" style={{ fontSize: 12, color: 'var(--warm-mid)' }}>{item.text}</span>
                          <span className="whitespace-nowrap shrink-0" style={{ fontSize: 10, color: 'var(--warm-muted)', fontFamily: 'monospace' }}>{item.timeLabel}</span>
                        </Link>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}

          {tab === 'finance' && <FinanceTab data={data} targetMonth={targetMonth} />}
          {tab === 'tenants' && <TenantsTab data={data} />}
          {tab === 'ai'      && <AiTab data={data} targetMonth={targetMonth} />}
        </div>
      </div>

      {selectedRoom && <RoomDetailPopup room={selectedRoom} onClose={() => setSelectedRoom(null)} />}
    </div>
  )
}
