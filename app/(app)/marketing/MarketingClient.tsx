'use client'

import Link from 'next/link'
import { type MarketingStats } from './actions'

const fmt = (n: number) => n.toLocaleString('ko-KR')

export default function MarketingClient({ stats }: { stats: MarketingStats }) {
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

  const dailyMax = Math.max(1, ...stats.dailyTrend.map(d => d.views))
  const hourMax  = Math.max(1, ...stats.hourly.map(h => h.count))
  const devTotal = stats.devices.mobile + stats.devices.desktop || 1

  return (
    <div className="space-y-4">
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
            봇 트래픽 {fmt(stats.botCount)}건 제외
          </span>
        )}
      </div>

      {/* 총계 */}
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

      {/* 일별 추이 (30일 막대) */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>일별 추이 (최근 30일)</p>
        <div className="flex items-end gap-[3px] h-24">
          {stats.dailyTrend.map((d, i) => {
            const h = (d.views / dailyMax) * 100
            return (
              <div key={i} className="flex-1 flex flex-col justify-end items-center" title={`${d.date}: ${d.views}뷰 · ${d.visitors}명`}>
                <div className="w-full rounded-t-sm"
                  style={{ height: `${Math.max(2, h)}%`, background: 'var(--persimmon)' }} />
              </div>
            )
          })}
        </div>
        <div className="flex justify-between text-[10px] mt-1.5" style={{ color: 'var(--warm-muted)' }}>
          <span>{stats.dailyTrend[0]?.date.slice(5)}</span>
          <span>{stats.dailyTrend[stats.dailyTrend.length - 1]?.date.slice(5)}</span>
        </div>
      </div>

      {/* 유입 출처 + 디바이스 (2칸 그리드) */}
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

      {/* 시간대(0-23) 막대 */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          시간대 (KST 0-23시 누적)
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
