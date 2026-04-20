'use client'

import { useState, useTransition, useEffect } from 'react'
import { MoneyDisplay } from '@/components/ui/MoneyDisplay'
import { analyzeDashboardWithGemini, getTrendData, type TrendRange, type TrendPoint } from './actions'

// ── 타입 ────────────────────────────────────────────────────────

type Dist = { label: string; count: number; percent: number }

export type DashboardData = {
  totalRevenue:      number   // 이달 수입 (수납 + 부가수입)
  paidRevenue:       number   // 이달 순수 수납액 (이용료만)
  totalExpense:      number
  netProfit:         number
  totalDeposit:      number
  paidCount:         number
  unpaidCount:       number
  categoryBreakdown: { category: string; amount: number; percent: number }[]
  trend:             { month: string; revenue: number; expense: number; profit: number }[]
  totalRooms:        number
  vacantRooms:       number
  occupiedRooms:     number
  statusCounts:      { active: number; reserved: number; checkout: number; nonResident: number }
  totalTenants:      number
  genderDist:        Dist[]
  nationalityDist:   Dist[]
  jobDist:           Dist[]
}

// ── 상수 ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  관리비:   '#6366f1',
  수선유지: '#f97316',
  세금:     '#ef4444',
  인건비:   '#a855f7',
  소모품:   '#22c55e',
  기타:     '#6b7280',
}
const FALLBACK_COLORS = ['#6366f1','#f97316','#ef4444','#a855f7','#22c55e','#6b7280','#3b82f6','#eab308']

// ── 도넛 차트 ───────────────────────────────────────────────────

function DonutChart({
  segments,
  centerLabel,
  centerSub,
  size = 140,
  strokeWidth = 22,
}: {
  segments:    { value: number; color: string }[]
  centerLabel?: string
  centerSub?:   string
  size?:        number
  strokeWidth?: number
}) {
  const r   = (size - strokeWidth) / 2
  const cx  = size / 2
  const cy  = size / 2
  const C   = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + seg.value, 0)

  let cumulativeAngle = -90

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      {total === 0 ? (
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="#1f2937" strokeWidth={strokeWidth} />
      ) : (
        segments.filter(s => s.value > 0).map((seg, i) => {
          const pct        = seg.value / total
          const dashLength = pct * C
          const angle      = cumulativeAngle
          cumulativeAngle += pct * 360
          return (
            <circle
              key={i}
              cx={cx} cy={cy} r={r}
              fill="none"
              stroke={seg.color}
              strokeWidth={strokeWidth}
              strokeDasharray={`${dashLength} ${C - dashLength}`}
              transform={`rotate(${angle}, ${cx}, ${cy})`}
            />
          )
        })
      )}
      {centerLabel && (
        <text x={cx} y={cy + 6} textAnchor="middle" fontSize="15" fontWeight="700" fill="white">
          {centerLabel}
        </text>
      )}
      {centerSub && (
        <text x={cx} y={cy + 22} textAnchor="middle" fontSize="10" fill="#9ca3af">
          {centerSub}
        </text>
      )}
    </svg>
  )
}

// ── 공용 서브 컴포넌트 ──────────────────────────────────────────

function StatCard({ label, value, sub, color }: {
  label: string; value: React.ReactNode; sub: string; color: string
}) {
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
      <p className="text-xs text-gray-500 font-medium">{label}</p>
      <p className={`text-xl font-bold mt-1.5 ${color}`}>{value}</p>
      <p className="text-xs text-gray-600 mt-1">{sub}</p>
    </div>
  )
}

function Row({ label, value, color }: { label: string; value: React.ReactNode; color: string }) {
  return (
    <div className="flex justify-between items-center">
      <span className="text-sm text-gray-400">{label}</span>
      <span className={`text-sm font-semibold ${color}`}>{value}</span>
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
      {/* 주요 지표 */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="이달 수입"  value={<MoneyDisplay amount={data.totalRevenue} />} sub="납부액+기타수익"  color="text-indigo-400" />
        <StatCard label="이달 지출"  value={<MoneyDisplay amount={data.totalExpense} />} sub="이달 지출 합계" color="text-red-400" />
        <StatCard label="순수익"     value={<MoneyDisplay amount={Math.abs(data.netProfit)} prefix={data.netProfit < 0 ? '-' : ''} />} sub="수입 − 지출" color={data.netProfit >= 0 ? 'text-green-400' : 'text-red-400'} />
        <StatCard label="보유 보증금" value={<MoneyDisplay amount={data.totalDeposit} />} sub="현재 계약 기준" color="text-purple-400" />
      </div>

      {/* 추이 바 차트 */}
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <h3 className="text-sm font-semibold text-gray-400">추이</h3>
          <div className="flex gap-4 text-xs text-gray-500">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#6366f1' }} />수입
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block" style={{ background: '#ef4444' }} />지출
            </span>
          </div>
        </div>

        {/* 기간 선택 버튼 */}
        <div className="flex gap-1 mb-4 flex-wrap">
          {TREND_RANGES.map(r => (
            <button
              key={r.key}
              onClick={() => setTrendRange(r.key)}
              disabled={trendPending}
              className={`px-2.5 py-1 text-xs rounded-lg transition-colors font-medium disabled:opacity-50
                ${trendRange === r.key
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:text-white'}`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {trendPending ? (
          <div className="h-36 flex items-center justify-center">
            <div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <div
              className="flex items-end gap-1"
              style={{ minWidth: trendPoints.length > 14 ? `${trendPoints.length * 36}px` : undefined }}
            >
              {trendPoints.map((t, i) => {
                const isLast = i === trendPoints.length - 1
                const revPct = Math.round((t.revenue / trendMax) * 100)
                const expPct = Math.round((t.expense / trendMax) * 100)
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 min-w-0" style={{ minWidth: trendPoints.length > 14 ? '28px' : undefined }}>
                    <p className={`text-xs font-medium whitespace-nowrap ${t.profit >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {t.profit !== 0 ? `${t.profit >= 0 ? '+' : ''}${Math.round(t.profit / 10000)}만` : ''}
                    </p>
                    <div className="w-full flex items-end gap-0.5 h-28">
                      <div className="flex-1 rounded-t-sm"
                        style={{ background: '#6366f1', opacity: isLast ? 1 : 0.5, height: `${revPct}%`, minHeight: t.revenue > 0 ? '2px' : '0' }} />
                      <div className="flex-1 rounded-t-sm"
                        style={{ background: '#ef4444', opacity: isLast ? 1 : 0.5, height: `${expPct}%`, minHeight: t.expense > 0 ? '2px' : '0' }} />
                    </div>
                    <p className={`text-xs truncate w-full text-center ${isLast ? 'text-white font-medium' : 'text-gray-600'}`}>
                      {t.label}
                    </p>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 지출 카테고리 + 수납현황 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">

        {/* 지출 카테고리 도넛 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">지출 카테고리</h3>
          {data.categoryBreakdown.length === 0 ? (
            <p className="text-sm text-gray-600 py-6 text-center">이달 지출 없음</p>
          ) : (
            <div className="flex items-center gap-5">
              <div className="shrink-0">
                <DonutChart
                  segments={categorySegments}
                  centerLabel={`${data.totalExpense > 0 ? Math.round(data.totalExpense / 10000) : 0}만`}
                  centerSub="총 지출"
                />
              </div>
              <div className="flex-1 space-y-2.5 min-w-0">
                {data.categoryBreakdown.map((c, i) => (
                  <div key={i} className="flex items-center gap-2 min-w-0">
                    <span
                      className="w-2.5 h-2.5 rounded-full shrink-0"
                      style={{ background: CATEGORY_COLORS[c.category] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length] }}
                    />
                    <span className="text-xs text-gray-400 truncate flex-1">{c.category}</span>
                    <span className="text-xs text-gray-300 shrink-0">{c.percent}%</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 수납률 도넛 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">수납 현황</h3>
          <div className="flex items-center gap-5">
            <div className="shrink-0">
              <DonutChart
                segments={paymentSegments}
                centerLabel={`${paymentRate}%`}
                centerSub="수납률"
              />
            </div>
            <div className="flex-1 space-y-3">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-green-500" />
                <span className="text-sm text-gray-400 flex-1">완납</span>
                <span className="text-sm font-semibold text-green-400">{data.paidCount}건</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0 bg-red-500" />
                <span className="text-sm text-gray-400 flex-1">미납</span>
                <span className="text-sm font-semibold text-red-400">{data.unpaidCount}건</span>
              </div>
              <div className="pt-2 border-t border-gray-800">
                <Row label="이달 수납액" value={<MoneyDisplay amount={data.paidRevenue} />} color="text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 입주자 통계 탭 ──────────────────────────────────────────────

const GENDER_LABEL: Record<string, string> = {
  MALE: '남성', FEMALE: '여성', OTHER: '기타', UNKNOWN: '미기재',
}
const GENDER_COLOR: Record<string, string> = {
  MALE: '#3b82f6', FEMALE: '#ec4899', OTHER: '#a855f7', UNKNOWN: '#6b7280',
}
const DIST_COLORS = ['#6366f1', '#22c55e', '#f97316', '#a855f7', '#eab308', '#6b7280']

function DistList({ items, colors }: { items: { label: string; count: number; percent: number }[]; colors: string[] }) {
  if (items.length === 0) return <p className="text-sm text-gray-600 py-4 text-center">데이터 없음</p>
  return (
    <div className="space-y-2.5">
      {items.map((item, i) => (
        <div key={i}>
          <div className="flex justify-between text-xs mb-1">
            <span className="text-gray-300 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full inline-block shrink-0" style={{ background: colors[i % colors.length] }} />
              {item.label}
            </span>
            <span className="text-gray-500">{item.count}명 ({item.percent}%)</span>
          </div>
          <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
            <div className="h-full rounded-full" style={{ width: `${item.percent}%`, background: colors[i % colors.length] }} />
          </div>
        </div>
      ))}
    </div>
  )
}

function TenantsTab({ data }: { data: DashboardData }) {
  const occupancyRate = data.totalRooms > 0
    ? Math.round((data.occupiedRooms / data.totalRooms) * 100)
    : 0

  const statusTotal = data.statusCounts.active + data.statusCounts.reserved + data.statusCounts.checkout + data.statusCounts.nonResident

  const occupancySegments = [
    { value: data.occupiedRooms, color: '#6366f1' },
    { value: data.vacantRooms,   color: '#1f2937' },
  ]
  const statusSegments = [
    { value: data.statusCounts.active,      color: '#22c55e' },
    { value: data.statusCounts.reserved,    color: '#3b82f6' },
    { value: data.statusCounts.checkout,    color: '#eab308' },
    { value: data.statusCounts.nonResident, color: '#f59e0b' },
  ]
  const genderSegments = data.genderDist.map(d => ({
    value: d.count,
    color: GENDER_COLOR[d.label] ?? '#6b7280',
  }))

  return (
    <div className="space-y-5">

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard label="전체 입주자"  value={`${data.totalTenants}명`}                     sub="현재 계약 기준"  color="text-white" />
        <StatCard label="거주중"       value={`${data.statusCounts.active}명`}               sub="ACTIVE"         color="text-green-400" />
        <StatCard label="입실 예정"    value={`${data.statusCounts.reserved}명`}             sub="RESERVED"       color="text-blue-400" />
        <StatCard label="퇴실 예정"    value={`${data.statusCounts.checkout}명`}             sub="CHECKOUT"       color="text-yellow-400" />
        <StatCard label="비거주자"     value={`${data.statusCounts.nonResident}명`}          sub="NON_RESIDENT"   color="text-amber-400" />
      </div>

      {/* 도넛 3개 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* 입주율 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">호실 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={occupancySegments} centerLabel={`${occupancyRate}%`} centerSub="입주율" />
            <div className="space-y-2.5 flex-1">
              {[
                { label: '입주중', val: `${data.occupiedRooms}실`, dot: '#6366f1' },
                { label: '공실',   val: `${data.vacantRooms}실`,   dot: '#374151' },
                { label: '전체',   val: `${data.totalRooms}실`,    dot: '' },
              ].map(r => (
                <div key={r.label} className="flex items-center gap-2">
                  {r.dot
                    ? <span className="w-2 h-2 rounded-full shrink-0" style={{ background: r.dot }} />
                    : <span className="w-2 h-2 shrink-0" />}
                  <span className="text-xs text-gray-400 flex-1">{r.label}</span>
                  <span className="text-xs font-semibold text-white">{r.val}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 상태별 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">상태별 현황</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={statusSegments} centerLabel={`${statusTotal}명`} centerSub="입주자" />
            <div className="space-y-2.5 flex-1">
              {[
                { label: '거주중',    count: data.statusCounts.active,   color: '#22c55e' },
                { label: '입실 예정', count: data.statusCounts.reserved, color: '#3b82f6' },
                { label: '퇴실 예정', count: data.statusCounts.checkout, color: '#eab308' },
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-xs text-gray-400 flex-1">{s.label}</span>
                  <span className="text-xs font-semibold text-white">{s.count}명</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 성별 */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">성별 분포</h3>
          <div className="flex items-center gap-4">
            <DonutChart
              segments={genderSegments}
              centerLabel={`${data.totalTenants}명`}
              centerSub="전체"
            />
            <div className="space-y-2.5 flex-1">
              {data.genderDist.map((d, i) => (
                <div key={i} className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full shrink-0" style={{ background: GENDER_COLOR[d.label] ?? '#6b7280' }} />
                  <span className="text-xs text-gray-400 flex-1">{GENDER_LABEL[d.label] ?? d.label}</span>
                  <span className="text-xs font-semibold text-white">{d.count}명</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 국적 / 직업 분포 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">국적 분포</h3>
          <DistList items={data.nationalityDist} colors={DIST_COLORS} />
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
          <h3 className="text-sm font-semibold text-gray-400 mb-4">직업 분포</h3>
          <DistList items={data.jobDist} colors={DIST_COLORS} />
        </div>
      </div>

    </div>
  )
}

// ── 메인 클라이언트 컴포넌트 ────────────────────────────────────

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
      <div className="bg-gray-900 border border-gray-800 rounded-2xl p-5">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-white">Gemini AI 재무 분석</h3>
            <p className="text-xs text-gray-500 mt-0.5">{targetMonth} 운영 데이터 기반 AI 분석</p>
          </div>
          <button
            onClick={handleAnalyze}
            disabled={isPending}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-sm font-medium rounded-xl transition-colors">
            {isPending
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />분석 중...</>
              : '✦ AI 분석하기'}
          </button>
        </div>

        {!aiText && !isPending && !error && (
          <div className="text-center py-10 text-gray-600 text-sm">
            버튼을 눌러 이달 재무 현황 AI 분석을 시작하세요
          </div>
        )}

        {isPending && (
          <div className="flex items-center gap-3 py-8 justify-center text-indigo-400 text-sm">
            <span className="w-4 h-4 border-2 border-indigo-400/30 border-t-indigo-400 rounded-full animate-spin" />
            Gemini가 재무 데이터를 분석하고 있습니다...
          </div>
        )}

        {error && (
          <p className="text-red-400 text-sm py-4 text-center">{error}</p>
        )}

        {aiText && !isPending && (
          <div className="bg-indigo-950/30 border border-indigo-900/40 rounded-xl p-4">
            <div className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">
              {aiText}
            </div>
            <button
              onClick={handleAnalyze}
              className="mt-3 text-xs text-indigo-400 hover:text-indigo-300 transition-colors">
              ↻ 다시 분석
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function DashboardClient({ data, targetMonth }: { data: DashboardData; targetMonth: string }) {
  const [tab, setTab] = useState<'finance' | 'tenants' | 'ai'>('finance')

  return (
    <div className="space-y-5">
      {/* 탭 */}
      <div className="flex gap-2 sticky top-0 z-10 pb-1 pt-0.5 bg-gray-950">
        {([
          { key: 'finance',  label: '재무현황' },
          { key: 'tenants',  label: '입주자 통계' },
          { key: 'ai',       label: '✦ AI 분석' },
        ] as const).map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-xl transition-colors ${
              tab === t.key
                ? t.key === 'ai' ? 'bg-indigo-700 text-white' : 'bg-indigo-600 text-white'
                : 'bg-gray-800 text-gray-400 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* 탭 내용 */}
      {tab === 'finance' && <FinanceTab data={data} targetMonth={targetMonth} />}
      {tab === 'tenants' && <TenantsTab data={data} />}
      {tab === 'ai'      && <AiTab data={data} targetMonth={targetMonth} />}
    </div>
  )
}
