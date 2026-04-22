'use client'

import { useState, useTransition, useEffect } from 'react'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { analyzeDashboardWithGemini, getTrendData, type TrendRange, type TrendPoint } from '../dashboard/actions'
import type { DashboardData } from '../dashboard/DashboardClient'

// ── 상수 ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  관리비:   '#f4623a',
  수선유지: '#f97316',
  세금:     '#ef4444',
  인건비:   '#a855f7',
  소모품:   '#22c55e',
  기타:     '#a89888',
}
const FALLBACK_COLORS = ['#f4623a','#f97316','#ef4444','#a855f7','#22c55e','#a89888','#3b82f6','#eab308']

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

// ── 공용 컴포넌트 ──────────────────────────────────────────────

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

// ── 재무현황 탭 ─────────────────────────────────────────────────

const TREND_RANGES: { key: TrendRange; label: string }[] = [
  { key: 'daily',     label: '일간' },
  { key: 'weekly',    label: '주간' },
  { key: 'monthly',   label: '월간' },
  { key: 'quarterly', label: '분기' },
  { key: 'biannual',  label: '반년' },
  { key: 'annual',    label: '연간' },
  { key: 'all',       label: '전체' },
]

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
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="이달 수입"   value={<MoneyDisplay amount={data.totalRevenue} />} sub="납부액+기타수익"  colorStyle={{ color: 'var(--coral)' }} />
        <StatCard label="이달 지출"   value={<MoneyDisplay amount={data.totalExpense} />} sub="이달 지출 합계"  colorStyle={{ color: '#ef4444' }} />
        <StatCard label="순수익"      value={<MoneyDisplay amount={Math.abs(data.netProfit)} prefix={data.netProfit < 0 ? '-' : ''} />} sub="수입 − 지출" colorStyle={{ color: data.netProfit >= 0 ? '#22c55e' : '#ef4444' }} />
        <StatCard label="보유 보증금" value={<MoneyDisplay amount={data.totalDeposit} />} sub="현재 계약 기준"  colorStyle={{ color: '#a855f7' }} />
      </div>

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

// ── 입주자 통계 탭 ──────────────────────────────────────────────

const GENDER_LABEL: Record<string, string> = { MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '미기재' }
const GENDER_COLOR: Record<string, string> = { MALE: '#3b82f6', FEMALE: '#ec4899', OTHER: '#a855f7', UNKNOWN: '#a89888' }
const DIST_COLORS = ['#f4623a', '#22c55e', '#f97316', '#a855f7', '#eab308', '#a89888']

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

// ── 메인 ────────────────────────────────────────────────────────

export default function StatsClient({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
  const [tab, setTab] = useState<'finance' | 'tenants' | 'ai'>('finance')

  return (
    <div className="space-y-5">
      <div className="flex gap-2 sticky top-0 z-10 pb-1 pt-0.5" style={{ background: 'var(--canvas)' }}>
        {([
          { key: 'finance', label: '재무현황' },
          { key: 'tenants', label: '입주자 통계' },
          { key: 'ai',      label: '✦ AI 분석' },
        ] as const).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className="px-4 py-2 text-sm font-medium rounded-xl transition-colors"
            style={tab === t.key
              ? { background: 'var(--coral)', color: '#fff' }
              : { background: 'var(--cream)', color: 'var(--warm-mid)', border: '1px solid var(--warm-border)' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'finance' && <FinanceTab data={data} targetMonth={targetMonth} />}
      {tab === 'tenants' && <TenantsTab data={data} />}
      {tab === 'ai'      && <AiTab data={data} targetMonth={targetMonth} />}
    </div>
  )
}
