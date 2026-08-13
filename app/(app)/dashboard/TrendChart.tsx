'use client'

// 홈 추이 차트 — recharts를 이 파일에만 격리해 next/dynamic으로 지연 로드.
// (홈 첫 페인트 번들에서 차트 라이브러리 제외 — 데이터·표현은 DashboardClient 시절과 동일)
//
// 색은 개념 단위로 §24 를 따르되 §19 페어 토큰을 쓴다.
//   수입 var(--tc-text) · 지출 var(--ink-s)(= CONCEPT_COLORS.expense).
//   --coral·--ink-m·--neutral-fg 를 쓰지 않는 이유: 라이트에서는 전부 같은 픽셀이지만 다크에서
//   갈린다. --coral 은 안 밝아져 크림 카드 위 2.78:1 이고(그 70% 층은 1.97:1), 지출은 범례가
//   --ink-m(#93816F)·막대가 --neutral-fg(#C7B5A2)라 같은 시리즈가 두 색이었다.
//
// 적층(게이지)은 막대 모드 전용이다. 면적 모드(일간·주간)는 납부일 축이라 '그 달 예정'이라는
// 개념 자체가 성립하지 않는다.
import {
  AreaChart, Area, BarChart, Bar, Cell,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts'

export type TrendChartPoint = {
  label: string
  revenue: number
  expense: number
  // 적층 옅은 층(만원) — 조회월 막대에만 값이 있고 나머지는 0이다. 0이면 recharts 가 안 그린다.
  revenuePending?: number
  expensePending?: number
}

// 실적 위에 얹는 옅은 층 — 지출 카테고리 도넛의 예정 틴트와 **같은 문법**이다(같은 hue 70%).
// 그래서 이 화면에서 '옅다'는 어디서나 같은 뜻이 된다: 아직 장부에 안 오른 몫.
const pendingTint = (color: string) => `color-mix(in srgb, ${color} 70%, transparent)`
const REV = 'var(--tc-text)'
const EXP = 'var(--ink-s)'

const TOOLTIP_STYLE = {
  background: 'var(--cream)', border: '1px solid var(--warm-border)',
  color: 'var(--warm-dark)', borderRadius: 8, fontSize: '0.75rem',
} as const

/**
 * 적층 막대의 툴팁 — 층마다 한 줄과 스택 합계 한 줄.
 *
 * 합계는 층별 만원 값을 더해서 만든다. 원 단위로 따로 반올림한 두 값을 더하면 표시 합계가
 * 막대 높이와 1만원 어긋나는 달이 생긴다 — 부르는 쪽이 옅은 층을 '반올림한 합 빼기 반올림한
 * 실적'으로 만들어 두므로, 여기서 더한 값이 곧 그 달 원 단위 합의 반올림이다.
 */
function StackTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { dataKey?: string | number; name?: string; value?: number }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const at = (k: string) => payload.find(p => p.dataKey === k)?.value ?? 0
  const rows: { name: string; value: number; strong?: boolean }[] = []
  rows.push({ name: '실수납', value: at('revenue') })
  if (at('revenuePending') > 0) {
    rows.push({ name: '이 달 미수납', value: at('revenuePending') })
    rows.push({ name: '예상 수입', value: at('revenue') + at('revenuePending'), strong: true })
  }
  rows.push({ name: '기록된 지출', value: at('expense') })
  if (at('expensePending') > 0) {
    rows.push({ name: '고정 지출 (예정)', value: at('expensePending') })
    rows.push({ name: '예상 지출', value: at('expense') + at('expensePending'), strong: true })
  }
  return (
    <div style={{ ...TOOLTIP_STYLE, padding: '8px 10px' }}>
      <p style={{ marginBottom: 4, color: 'var(--warm-muted)' }}>{label}</p>
      {rows.map((r, i) => (
        <p key={i} style={{ display: 'flex', gap: 12, justifyContent: 'space-between', fontWeight: r.strong ? 600 : 400 }}>
          <span>{r.name}</span><span className="num">{r.value.toLocaleString()}만원</span>
        </p>
      ))}
    </div>
  )
}

export default function TrendChart({ mode, data }: { mode: 'area' | 'bar'; data: TrendChartPoint[] }) {
  const stacked = data.some(d => (d.revenuePending ?? 0) > 0 || (d.expensePending ?? 0) > 0)
  return mode === 'area' ? (
    /* ── 일간·주간: Area Chart ── */
    <ResponsiveContainer width="100%" height={176}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }}>
        <defs>
          <linearGradient id="gradRev" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={REV} stopOpacity={0.18} />
            <stop offset="95%" stopColor={REV} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradExp" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={EXP} stopOpacity={0.14} />
            <stop offset="95%" stopColor={EXP} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--ink) 8%, transparent)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: '0.65625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={v => v === 0 ? '0' : `${v}만`} tick={{ fontSize: '0.65625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} width={52} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE}
          formatter={(v, name) => [`${Number(v).toLocaleString()}만원`, String(name)]}
        />
        <Area type="monotone" dataKey="revenue" name="수입" stroke={REV} strokeWidth={2} fill="url(#gradRev)" dot={false} activeDot={{ r: 4, fill: REV }} />
        <Area type="monotone" dataKey="expense" name="지출" stroke={EXP} strokeWidth={1.5} strokeDasharray="4 2" fill="url(#gradExp)" dot={false} activeDot={{ r: 4, fill: EXP }} />
      </AreaChart>
    </ResponsiveContainer>
  ) : (
    /* ── 월간 이상: Grouped Bar Chart. 조회월 막대만 게이지로 적층된다 ── */
    <ResponsiveContainer width="100%" height={176}>
      <BarChart data={data} margin={{ top: 4, right: 8, left: 4, bottom: 0 }} barCategoryGap="28%">
        <CartesianGrid strokeDasharray="3 3" stroke="color-mix(in srgb, var(--ink) 8%, transparent)" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: '0.65625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} interval="preserveStartEnd" />
        <YAxis tickFormatter={v => v === 0 ? '0' : `${v}만`} tick={{ fontSize: '0.65625rem', fill: 'var(--ink-m)' }} axisLine={false} tickLine={false} width={52} />
        {stacked ? (
          <Tooltip content={<StackTooltip />} cursor={{ fill: 'color-mix(in srgb, var(--ink) 5%, transparent)' }} />
        ) : (
          <Tooltip
            contentStyle={TOOLTIP_STYLE}
            formatter={(v, name) => [`${Number(v).toLocaleString()}만원`, String(name)]}
          />
        )}
        {/* 라운드는 그 달 값이 있는 **최상단 층**에만 준다. 두 층 모두에 주면 아래 층의 둥근
            윗변이 스택 안쪽에 파고들어 초승달 빈틈이 생기고, 그게 세 번째 층처럼 읽힌다.
            예정분이 0인 달에는 실적 층이 최상단이므로 층 고정이 아니라 달마다 판정한다. */}
        <Bar dataKey="revenue" name="실수납" stackId="rev" fill={REV} maxBarSize={28}>
          {data.map((d, i) => <Cell key={i} radius={(d.revenuePending ?? 0) > 0 ? 0 : ([3, 3, 0, 0] as unknown as number)} />)}
        </Bar>
        <Bar dataKey="revenuePending" name="이 달 미수납" stackId="rev" fill={pendingTint(REV)} radius={[3, 3, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expense" name="기록된 지출" stackId="exp" fill={EXP} maxBarSize={28}>
          {data.map((d, i) => <Cell key={i} radius={(d.expensePending ?? 0) > 0 ? 0 : ([3, 3, 0, 0] as unknown as number)} />)}
        </Bar>
        <Bar dataKey="expensePending" name="고정 지출 (예정)" stackId="exp" fill={pendingTint(EXP)} radius={[3, 3, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  )
}
