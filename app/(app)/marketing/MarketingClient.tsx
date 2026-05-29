'use client'

import Link from 'next/link'
import { useState, useTransition } from 'react'
import { getMarketingStats, type MarketingStats, type MarketingRange } from './actions'

const fmt = (n: number) => n.toLocaleString('ko-KR')

const RANGES: { key: MarketingRange; label: string; granularity: string }[] = [
  { key: 'today', label: '오늘',  granularity: '시간별' },
  { key: '7d',    label: '7일',   granularity: '일별' },
  { key: '30d',   label: '30일',  granularity: '일별' },
  { key: '90d',   label: '90일',  granularity: '일별' },
  { key: '1y',    label: '1년',   granularity: '월별' },
]

export default function MarketingClient({ initialStats }: { initialStats: MarketingStats }) {
  const [stats, setStats] = useState<MarketingStats>(initialStats)
  const [range, setRange] = useState<MarketingRange>(initialStats.range)
  const [pending, startTransition] = useTransition()

  const handleRange = (r: MarketingRange) => {
    if (r === range) return
    setRange(r)
    startTransition(async () => {
      const fresh = await getMarketingStats(r)
      setStats(fresh)
    })
  }

  if (!stats.publicSlug) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>마케팅</h1>
        <div className="rounded-xl p-6 text-sm space-y-3"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}>
          <p className="font-semibold">공개 페이지 슬러그가 설정되지 않았어요.</p>
          <p style={{ color: 'var(--warm-muted)' }}>
            환경설정 → 기본정보에서 <strong>공개 페이지 슬러그</strong>를 입력하시면 영업장의 공개 랜딩 페이지
            트래픽(페이지뷰·유입·UTM)을 여기서 보실 수 있어요.
          </p>
          <Link href="/settings"
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--persimmon)', color: '#fff' }}>
            환경설정으로 이동
          </Link>
        </div>
      </div>
    )
  }

  const trendMax = Math.max(1, ...stats.trend.map(d => d.views))
  const hourMax  = Math.max(1, ...stats.hourly.map(h => h.count))
  const devTotal = stats.devices.mobile + stats.devices.desktop || 1
  const currentRangeMeta = RANGES.find(r => r.key === range) ?? RANGES[2]

  return (
    <div className="space-y-4" style={{ opacity: pending ? 0.6 : 1, transition: 'opacity 150ms' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--ink)' }}>마케팅</h1>
          {stats.publicUrl && (
            <a href={stats.publicUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs hover:underline" style={{ color: 'var(--persimmon-d)' }}>
              {stats.publicUrl} ↗
            </a>
          )}
        </div>
        {stats.botCount > 0 && (
          <span className="text-[11px]" style={{ color: 'var(--warm-muted)' }}>
            봇 {fmt(stats.botCount)}건 제외
          </span>
        )}
      </div>

      {/* 범위 선택 */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {RANGES.map(r => {
          const active = r.key === range
          return (
            <button
              key={r.key}
              type="button"
              onClick={() => handleRange(r.key)}
              disabled={pending}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors disabled:opacity-50"
              style={{
                background: active ? 'var(--persimmon)' : 'var(--cream)',
                color: active ? '#fff' : 'var(--warm-mid)',
                border: '1px solid ' + (active ? 'var(--persimmon)' : 'var(--warm-border)'),
                fontWeight: active ? 600 : 500,
              }}>
              {r.label}
            </button>
          )
        })}
        <span className="text-[11px] ml-2" style={{ color: 'var(--warm-muted)' }}>
          {currentRangeMeta.granularity}
        </span>
      </div>

      {/* 누적 4 카드 (범위 무관, 참고용) */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: '오늘',    v: stats.totals.today },
          { label: '최근 7일', v: stats.totals.week },
          { label: '최근 30일',v: stats.totals.month },
          { label: '누적',    v: stats.totals.allTime },
        ].map((c, i) => (
          <div key={i} className="rounded-xl p-4"
            style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
            <p className="text-[11px]" style={{ color: 'var(--warm-muted)' }}>{c.label}</p>
            <p className="text-lg font-bold mt-1 tabular-nums" style={{ color: 'var(--ink-2)' }}>{fmt(c.v)}</p>
          </div>
        ))}
      </div>

      {/* 범위 내 강조 카드 (총뷰 + 유니크 방문자) */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl p-4"
          style={{ background: 'var(--persimmon)', color: '#fff' }}>
          <p className="text-[11px] opacity-80">선택 범위 페이지뷰</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{fmt(stats.rangeViews)}</p>
        </div>
        <div className="rounded-xl p-4"
          style={{ background: 'var(--ink-2)', color: 'var(--sand)' }}>
          <p className="text-[11px] opacity-80">유니크 방문자 (추정)</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{fmt(stats.rangeVisitors)}</p>
        </div>
      </div>

      {/* 트렌드 차트 (자동 세분도) */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          추이 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>({currentRangeMeta.label} · {currentRangeMeta.granularity})</span>
        </p>
        {stats.trend.length === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: 'var(--warm-muted)' }}>데이터 없음</p>
        ) : (
          <>
            <div className="flex items-end gap-[3px] h-28">
              {stats.trend.map((d, i) => {
                const h = (d.views / trendMax) * 100
                return (
                  <div key={i} className="flex-1 flex flex-col justify-end items-center"
                    title={`${d.label}: ${d.views}뷰 · ${d.visitors}명`}>
                    <div className="w-full rounded-t-sm"
                      style={{ height: `${Math.max(2, h)}%`, background: 'var(--persimmon)' }} />
                  </div>
                )
              })}
            </div>
            <div className="flex justify-between text-[10px] mt-1.5" style={{ color: 'var(--warm-muted)' }}>
              <span>{stats.trend[0]?.label}</span>
              {stats.trend.length > 2 && (
                <span>{stats.trend[Math.floor(stats.trend.length / 2)]?.label}</span>
              )}
              <span>{stats.trend[stats.trend.length - 1]?.label}</span>
            </div>
          </>
        )}
      </div>

      {/* 유입 출처 + 디바이스 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>유입 출처 Top 8</p>
          {stats.referrers.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>아직 데이터 없음</p>
          ) : (
            <ul className="space-y-1.5">
              {stats.referrers.map((r, i) => (
                <li key={i}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-xs truncate" style={{ color: 'var(--warm-dark)' }}>{r.host}</span>
                    <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>
                      {fmt(r.count)} · {r.percent}%
                    </span>
                  </div>
                  <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
                    <div className="h-full rounded-full" style={{ width: `${r.percent}%`, background: 'var(--persimmon)' }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>디바이스</p>
          {devTotal === 1 && stats.devices.mobile === 0 && stats.devices.desktop === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>아직 데이터 없음</p>
          ) : (
            <div className="space-y-3">
              {[
                { label: '모바일', count: stats.devices.mobile },
                { label: '데스크탑/태블릿', count: stats.devices.desktop },
              ].map((d, i) => {
                const pct = Math.round((d.count / devTotal) * 100)
                return (
                  <div key={i}>
                    <div className="flex items-baseline justify-between mb-1">
                      <span className="text-xs" style={{ color: 'var(--warm-dark)' }}>{d.label}</span>
                      <span className="text-[11px] tabular-nums" style={{ color: 'var(--warm-muted)' }}>
                        {fmt(d.count)} · {pct}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
                      <div className="h-full rounded-full"
                        style={{ width: `${pct}%`, background: i === 0 ? 'var(--persimmon)' : 'var(--camel)' }} />
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* 시간대(0-23) */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          시간대 분포 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>(KST 0-23시 누적)</span>
        </p>
        <div className="flex items-end gap-[2px] h-20">
          {stats.hourly.map((h, i) => {
            const height = (h.count / hourMax) * 100
            return (
              <div key={i} className="flex-1 flex flex-col justify-end" title={`${h.hour}시: ${h.count}뷰`}>
                <div className="w-full rounded-t-sm"
                  style={{ height: `${Math.max(2, height)}%`, background: 'var(--camel)' }} />
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] mt-1.5" style={{ color: 'var(--warm-muted)' }}>
          <span>0시</span>
          <span>6시</span>
          <span>12시</span>
          <span>18시</span>
          <span>23시</span>
        </div>
      </div>

      {/* UTM 캠페인 */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          UTM 캠페인 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>(?utm_source=... 가 있을 때만)</span>
        </p>
        {stats.campaigns.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>UTM 파라미터가 붙은 방문이 아직 없어요</p>
        ) : (
          <ul className="space-y-1.5">
            {stats.campaigns.map((c, i) => (
              <li key={i} className="flex items-baseline justify-between gap-2">
                <span className="text-xs truncate" style={{ color: 'var(--warm-dark)' }}>
                  <strong>{c.source}</strong> · {c.medium}{c.campaign !== '-' && ` · ${c.campaign}`}
                </span>
                <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>
                  {fmt(c.count)}건
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
