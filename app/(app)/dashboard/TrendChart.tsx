'use client'

// 홈 추이 차트 — recharts를 이 파일에만 격리해 next/dynamic으로 지연 로드.
// (홈 첫 페인트 번들에서 차트 라이브러리 제외 — 데이터·표현은 DashboardClient 시절과 동일)
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

export type TrendChartPoint = { label: string; revenue: number; expense: number }

export default function TrendChart({ mode, data }: { mode: 'area' | 'bar'; data: TrendChartPoint[] }) {
  return mode === 'area' ? (
    /* ── 일간·주간: Area Chart ── */
    <ResponsiveContainer width="100%" height={176}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
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
        <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--ink) 8%, transparent)" vertical={false} />
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
      <BarChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--ink) 8%, transparent)" vertical={false} />
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
  )
}
