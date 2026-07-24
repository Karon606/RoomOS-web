'use client'

import Link from 'next/link'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useState, useTransition } from 'react'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'
import { trackSave } from '@/lib/saveStatus'
import { getMarketingStats, type MarketingStats, type MarketingRange, type MarketingBucket } from './actions'

const fmt = (n: number) => n.toLocaleString('ko-KR')

// 작은 막대 패널 공통 컴포넌트 — 채널·디바이스·OS·브라우저·국가 등에서 재사용
function BarPanel({
  title, rows, color, emptyText,
}: {
  title: string
  rows: { label: string; count: number; percent: number }[]
  color: string
  emptyText: string
}) {
  return (
    <div className="rounded-xl p-4"
      style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
      <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>{title}</p>
      {rows.length === 0 ? (
        <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>{emptyText}</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r, i) => (
            <li key={i}>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-xs truncate" style={{ color: 'var(--warm-dark)' }}>{r.label}</span>
                <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>
                  {fmt(r.count)} · {r.percent}%
                </span>
              </div>
              <div className="h-1 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
                <div className="h-full rounded-full" style={{ width: `${r.percent}%`, background: color }} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// 세그먼트 값 — 프리셋 5종 + 임의 기간('custom').
// 'custom'은 MarketingRange 유니온에 넣지 않는다(서버 rangeStart()의 exhaustive switch 보존).
type SegKey = MarketingRange | 'custom'

const RANGES: { key: MarketingRange; label: string }[] = [
  { key: 'today', label: '오늘' },
  { key: '7d',    label: '7일' },
  { key: '30d',   label: '30일' },
  { key: '90d',   label: '90일' },
  { key: '1y',    label: '1년' },
]
const SEG_OPTIONS: { value: SegKey; label: string }[] = [
  ...RANGES.map(r => ({ value: r.key as SegKey, label: r.label })),
  { value: 'custom', label: '직접 지정' },
]

const GRANULARITY: Record<MarketingBucket, string> = { hour: '시간별', day: '일별', month: '월별' }

// 'YYYY-MM-DD' 양끝 포함 일수
const spanDays = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
// 'YYYY-MM-DD' → 'M/D' (카드 제목용 축약)
const md = (s: string) => `${+s.slice(5, 7)}/${+s.slice(8, 10)}`

export default function MarketingClient({ initialStats }: { initialStats: MarketingStats }) {
  const [stats, setStats] = useState<MarketingStats>(initialStats)
  // range = 프리셋(직접 지정을 풀면 돌아갈 곳). customFrom/customTo = 임의 기간(조회창의 유일한 진실).
  const [range, setRange] = useState<MarketingRange>(initialStats.range)
  const [customFrom, setCustomFrom] = useState<string | null>(null)
  const [customTo, setCustomTo] = useState<string | null>(null)
  const [selTrend, setSelTrend] = useState<number | null>(null)
  const [selHour, setSelHour] = useState<number | null>(null)
  const [, startTransition] = useTransition()

  const isCustom = customFrom != null
  const reversed = !!customFrom && !!customTo && customFrom > customTo

  // 조회 — 진행 표시는 전역 상단 진행 바(v2.0 §17) 재사용
  const query = (r: MarketingRange, from: string | null, to: string | null) => {
    setSelTrend(null); setSelHour(null)
    const release = trackSave()
    startTransition(async () => {
      try { setStats(await getMarketingStats(r, from, to)) }
      finally { release() }
    })
  }

  // 프리셋 범위 선택 — 직접 지정 해제
  const handleRange = (r: MarketingRange) => {
    if (r === range && !customFrom) return
    setRange(r); setCustomFrom(null); setCustomTo(null)
    query(r, null, null)
  }

  const handleSeg = (v: SegKey) => {
    if (v !== 'custom') { handleRange(v); return }
    // 누른 순간엔 조회하지 않는다 — 현재 조회창으로 픽커만 시딩·펼침(화면 흔들림 방지)
    if (isCustom) return
    setCustomFrom(stats.rangeFrom); setCustomTo(stats.rangeTo)
  }

  // 시작일·종료일 — 둘 다 유효하고 역순이 아닐 때만 조회
  const handleFrom = (v: string) => {
    if (!v || v === customFrom) return
    setCustomFrom(v)
    if (customTo && v <= customTo) query(range, v, customTo)
  }
  const handleTo = (v: string) => {
    if (!v || v === customTo) return
    setCustomTo(v)
    if (customFrom && customFrom <= v) query(range, customFrom, v)
  }

  // 추이 막대 드릴다운 — 조회창을 customFrom/customTo 에 써 넣는다
  const drillTo = (from: string, to: string) => {
    setCustomFrom(from); setCustomTo(to)
    query(range, from, to)
  }

  if (!stats.publicSlug) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>방문 분석</h1>
          <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>공개 페이지 방문 분석</p>
        </div>
        <div className="rounded-xl p-6 text-sm space-y-3"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}>
          <p className="font-semibold">공개 페이지 슬러그가 설정되지 않았어요.</p>
          <p style={{ color: 'var(--warm-muted)' }}>
            환경설정 &gt; 기본정보에서 <strong>공개 페이지 슬러그</strong>를 입력하시면 영업장의 공개 랜딩 페이지
            트래픽(페이지뷰·유입·UTM)을 여기서 보실 수 있어요.
          </p>
          <Link href="/settings"
            className="inline-block px-4 py-2 rounded-lg text-sm font-medium"
            style={{ background: 'var(--persimmon)', color: 'var(--on-solid)' }}>
            환경설정으로 이동
          </Link>
        </div>
      </div>
    )
  }

  const trendMax = Math.max(1, ...stats.trend.map(d => d.views))
  const hourMax  = Math.max(1, ...stats.hourly.map(h => h.count))

  // 현재 조회창 — 서버가 되돌려준 rangeFrom/rangeTo 가 표시의 단일 진실
  const { rangeFrom: rf, rangeTo: rt } = stats
  const granularity = GRANULARITY[stats.bucket]
  const rangeCaption = rf === rt
    ? `${rf} · ${granularity}`
    : `${rf} ~ ${rt} · ${spanDays(rf, rt)}일간 · ${granularity}`
  const rangeTitle = rf === rt
    ? md(rf)
    : rf.slice(0, 4) === rt.slice(0, 4)
      ? `${md(rf)} ~ ${md(rt)}`
      : `${rf.slice(0, 4)}. ${md(rf)} ~ ${rt.slice(0, 4)}. ${md(rt)}`

  // 커스텀 기간이면 빈 문구 시제를 바꾼다 (아직 = 앞으로 쌓일 여지 / 이 기간에 = 지난 창)
  const emptyTxt = isCustom ? '이 기간에 데이터 없음' : '아직 데이터 없음'

  // 선택된 추이 막대 + 드릴다운 대상 (hour 버킷은 더 좁힐 곳이 없어 버튼 없음)
  const selBar = selTrend != null ? stats.trend[selTrend] ?? null : null
  const drill = (() => {
    if (!selBar?.date) return null
    if (stats.bucket === 'day') return { label: '이 날만 보기', from: selBar.date, to: selBar.date }
    if (stats.bucket === 'month') {
      const y = +selBar.date.slice(0, 4)
      const m = +selBar.date.slice(5, 7)
      const lastD = new Date(Date.UTC(y, m, 0)).getUTCDate()
      const last = `${selBar.date}-${String(lastD).padStart(2, '0')}`
      const today = kstYmdStr()
      return { label: '이 달만 보기', from: `${selBar.date}-01`, to: last > today ? today : last }
    }
    return null
  })()

  const fmtDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`
    const s = Math.round(ms / 1000)
    if (s < 60) return `${s}초`
    const m = Math.floor(s / 60); const rs = s % 60
    return rs === 0 ? `${m}분` : `${m}분 ${rs}초`
  }

  return (
    <div className="space-y-4">
      {/* 막대 hover·선택 단서는 막대(3~4px)가 아니라 열 전체 배경 밴드로 — focus 링도 offset 0 */}
      <style>{`
        .mk-bar { border-radius: 4px; transition: background-color 150ms; }
        .mk-bar:hover { background: color-mix(in srgb, var(--tc) 8%, transparent); }
        .mk-bar[data-sel="1"] { background: color-mix(in srgb, var(--tc) 12%, transparent); }
        .mk-bar:focus-visible { outline: 2px solid var(--coral); outline-offset: 0; }
      `}</style>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--ink)' }}>방문 분석</h1>
          <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>공개 페이지 방문 분석</p>
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

      {/* 범위 선택 — 세그먼트는 자체 한 줄(6개라 좁은 화면에서 넘침), 캡션·직접 지정은 아래 줄 */}
      <div className="space-y-2">
        <div>
          <SegmentedControl
            size="sm"
            scroll
            ariaLabel="조회 기간"
            value={(isCustom ? 'custom' : range) as SegKey}
            onChange={handleSeg}
            options={SEG_OPTIONS}
          />
        </div>
        <p className="text-[11px] num" style={{ color: 'var(--warm-muted)' }}>{rangeCaption}</p>
        {isCustom && (
          <div className="grid grid-cols-2 gap-2 max-w-md">
            <div>
              <p className="text-[0.65625rem] mb-1" style={{ color: 'var(--warm-muted)' }}>시작일</p>
              <DatePicker value={customFrom ?? ''} onChange={handleFrom}
                maxDate={customTo || kstYmdStr()}
                placeholder="시작일"
                className="truncate bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 min-h-[44px] md:min-h-[40px] text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>
            <div>
              <p className="text-[0.65625rem] mb-1" style={{ color: 'var(--warm-muted)' }}>종료일</p>
              <DatePicker value={customTo ?? ''} onChange={handleTo}
                minDate={customFrom ?? undefined} maxDate={kstYmdStr()}
                placeholder="종료일"
                className="truncate bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 min-h-[44px] md:min-h-[40px] text-xs text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] transition-colors" />
            </div>
          </div>
        )}
        {reversed && (
          <p className="text-[0.65625rem]" style={{ color: 'var(--danger-fg)' }}>시작일이 종료일보다 늦습니다</p>
        )}
      </div>

      {/* 누적 4 카드 (범위 무관, 참고용) */}
      <div>
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
        <p className="text-[11px] mt-1.5" style={{ color: 'var(--warm-muted)' }}>이 4개는 선택한 기간과 무관한 누적 수치입니다.</p>
      </div>

      {/* 범위 내 강조 카드 (총뷰 + 유니크 방문자) */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl p-4"
          style={{ background: 'var(--persimmon)', color: 'var(--on-solid)' }}>
          <p className="text-[11px] opacity-80">선택 범위 페이지뷰</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{fmt(stats.rangeViews)}</p>
        </div>
        {/* v2.0 §28: --ink-2 배경은 다크에서 크림으로 뒤집혀 밝은 글자 대비 붕괴 →
            페어 토큰 --np-card-bg(라이트 ink·다크 d-card, 양 모드 어두움)로 sand 글자 가독성 유지 */}
        <div className="rounded-xl p-4"
          style={{ background: 'var(--np-card-bg)', color: 'var(--sand)' }}>
          <p className="text-[11px] opacity-80">유니크 방문자 (추정)</p>
          <p className="text-xl font-bold mt-1 tabular-nums">{fmt(stats.rangeVisitors)}</p>
        </div>
      </div>

      {/* 트렌드 차트 (자동 세분도) */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          추이 <span className="num" style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>({rangeTitle} · {granularity})</span>
        </p>
        {stats.trend.length === 0 || stats.rangeViews === 0 ? (
          <p className="text-xs text-center py-6" style={{ color: 'var(--warm-muted)' }}>이 기간에 방문 기록이 없습니다.</p>
        ) : (
          <>
            {/* 선택 막대 상세 (모바일 탭 대응 — 데스크탑 hover 도 유지).
                버튼 유무로 높이가 튀지 않게 줄 높이를 항상 확보한다. */}
            <div className="flex items-center justify-between gap-2 mb-1.5 min-h-[44px]">
              <p className="text-[11px] min-w-0" style={{ color: 'var(--warm-mid)' }}>
                {selBar
                  ? <><strong style={{ color: 'var(--warm-dark)' }}>{selBar.label}</strong> · {fmt(selBar.views)}뷰 · {fmt(selBar.visitors)}명</>
                  : <span style={{ color: 'var(--warm-muted)' }}>막대를 탭하면 상세가 표시됩니다</span>}
              </p>
              {drill && (
                <Btn size="sm" variant="secondary" className="shrink-0"
                  onClick={() => drillTo(drill.from, drill.to)}>
                  {drill.label}
                </Btn>
              )}
            </div>
            <div className="flex items-end gap-[3px] h-28">
              {stats.trend.map((d, i) => {
                const h = (d.views / trendMax) * 100
                const sel = selTrend === i
                return (
                  <button key={i} type="button" onClick={() => setSelTrend(sel ? null : i)}
                    data-sel={sel ? '1' : '0'}
                    className="mk-bar flex-1 h-full flex flex-col justify-end items-center cursor-pointer"
                    title={`${d.label}: ${d.views}뷰 · ${d.visitors}명`}>
                    <div className="w-full rounded-t-sm transition-opacity"
                      style={{ height: `${Math.max(2, h)}%`, background: 'var(--persimmon)', opacity: selTrend == null || sel ? 1 : 0.4 }} />
                  </button>
                )
              })}
            </div>
            <div className="flex justify-between text-[0.65625rem] mt-1.5" style={{ color: 'var(--warm-muted)' }}>
              <span>{stats.trend[0]?.label}</span>
              {stats.trend.length > 2 && (
                <span>{stats.trend[Math.floor(stats.trend.length / 2)]?.label}</span>
              )}
              <span>{stats.trend[stats.trend.length - 1]?.label}</span>
            </div>
          </>
        )}
      </div>

      {/* 참여도 (평균 체류·스크롤·이탈률) */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          참여도 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>(샘플 {fmt(stats.engagement.sampleCount)}건)</span>
        </p>
        {stats.engagement.sampleCount === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>
            {isCustom
              ? '이 기간에 측정 데이터 없음'
              : '아직 측정 데이터 없음 (페이지를 닫을 때 수집되므로 첫 방문 후 5초 정도 뒤 새로고침 시 반영)'}
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>평균 체류</p>
              <p className="text-sm font-bold mt-1 tabular-nums" style={{ color: 'var(--ink-2)' }}>{fmtDuration(stats.engagement.avgDurationMs)}</p>
            </div>
            <div>
              <p className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>평균 스크롤</p>
              <p className="text-sm font-bold mt-1 tabular-nums" style={{ color: 'var(--ink-2)' }}>{stats.engagement.avgScrollPct}%</p>
            </div>
            <div>
              <p className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>이탈률 <span className="text-[0.65625rem]">(5초↓)</span></p>
              <p className="text-sm font-bold mt-1 tabular-nums" style={{ color: 'var(--ink-2)' }}>{stats.engagement.bounceRatePct}%</p>
            </div>
          </div>
        )}
      </div>

      {/* 섹션별 체류시간 — 페이지 어느 영역에 오래 머물렀나 */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-1" style={{ color: 'var(--ink-2)' }}>
          섹션별 평균 체류시간 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>(영역별, 샘플 {fmt(stats.sectionSampleCount)}건)</span>
        </p>
        <p className="text-[11px] mb-3" style={{ color: 'var(--warm-muted)' }}>방문자가 페이지의 어느 부분에서 더 오래 머물렀는지 · 화면 중앙에 머문 시간 기준</p>
        {stats.sections.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>
            {isCustom
              ? '이 기간에 측정 데이터 없음'
              : '아직 측정 데이터 없음 (공개 페이지 방문이 쌓이면 영역별로 표시됩니다)'}
          </p>
        ) : (
          <ul className="space-y-1.5">
            {(() => {
              const secMax = Math.max(1, ...stats.sections.map(s => s.avgMs))
              return stats.sections.map((s, i) => (
                <li key={s.id}>
                  <div className="flex items-baseline justify-between gap-2 mb-1">
                    <span className="text-xs truncate" style={{ color: i === 0 ? 'var(--tc-text)' : 'var(--warm-dark)', fontWeight: i === 0 ? 600 : 400 }}>
                      {s.name}{i === 0 && <span className="text-[0.65625rem] font-normal"> · 최다 체류</span>}
                    </span>
                    <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>
                      {fmtDuration(s.avgMs)} · {fmt(s.sampleCount)}명
                    </span>
                  </div>
                  <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'var(--canvas)' }}>
                    <div className="h-full rounded-full" style={{ width: `${(s.avgMs / secMax) * 100}%`, background: i === 0 ? 'var(--persimmon)' : 'var(--camel)' }} />
                  </div>
                </li>
              ))
            })()}
          </ul>
        )}
      </div>

      {/* 채널 카테고리 + 디바이스 종류 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BarPanel title="채널" rows={stats.channels.map(c => ({ label: c.category, count: c.count, percent: c.percent }))}
          color="var(--persimmon)" emptyText={emptyTxt} />
        <BarPanel title="디바이스 종류" rows={stats.deviceTypes.map(d => ({ label: d.type, count: d.count, percent: d.percent }))}
          color="var(--camel)" emptyText={emptyTxt} />
      </div>

      {/* 검색엔진·소셜 분류된 이름 + 유입 호스트 Top */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>검색엔진 · 소셜</p>
          {stats.namedSources.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>
              {isCustom ? '이 기간에 분류된 유입 없음' : '아직 분류된 유입 없음'}
            </p>
          ) : (
            <ul className="space-y-1">
              {stats.namedSources.map((s, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs truncate" style={{ color: 'var(--warm-dark)' }}>
                    {s.name} <span className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>({s.category})</span>
                  </span>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>{fmt(s.count)}건</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>유입 호스트 Top 8</p>
          {stats.referrers.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>{emptyTxt}</p>
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
      </div>

      {/* 지역 (국가 + 도시) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BarPanel title="국가 Top" rows={stats.countries.map(c => ({ label: c.country, count: c.count, percent: c.percent }))}
          color="var(--persimmon)" emptyText={emptyTxt} />
        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>도시 Top 12</p>
          {stats.cities.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>{emptyTxt}</p>
          ) : (
            <ul className="space-y-1">
              {stats.cities.map((c, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs truncate" style={{ color: 'var(--warm-dark)' }}>
                    {c.city}
                    {c.region && <span className="text-[11px]" style={{ color: 'var(--warm-mid)' }}> · {c.region}</span>}
                    {c.country && <span className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}> ({c.country})</span>}
                  </span>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>{fmt(c.count)}건</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* OS + 브라우저 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <BarPanel title="OS Top" rows={stats.oses.map(o => ({ label: o.os, count: o.count, percent: o.percent }))}
          color="var(--camel)" emptyText={emptyTxt} />
        <BarPanel title="브라우저 Top" rows={stats.browsers.map(b => ({ label: b.browser, count: b.count, percent: b.percent }))}
          color="var(--persimmon)" emptyText={emptyTxt} />
      </div>

      {/* 언어 + 화면 해상도 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>언어</p>
          {stats.languages.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>{emptyTxt}</p>
          ) : (
            <ul className="space-y-1">
              {stats.languages.map((l, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs num" style={{ color: 'var(--warm-dark)' }}>{l.language}</span>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>{fmt(l.count)}건</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-xl p-4"
          style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>화면 해상도</p>
          {stats.resolutions.length === 0 ? (
            <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>{emptyTxt}</p>
          ) : (
            <ul className="space-y-1">
              {stats.resolutions.map((r, i) => (
                <li key={i} className="flex items-baseline justify-between gap-2">
                  <span className="text-xs num" style={{ color: 'var(--warm-dark)' }}>{r.res}</span>
                  <span className="text-[11px] tabular-nums shrink-0" style={{ color: 'var(--warm-muted)' }}>{fmt(r.count)}건</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* 시간대(0-23) — 하루만 조회하면 위 추이가 이미 시간별이라 같은 차트가 된다. 그때는 숨긴다. */}
      {stats.bucket !== 'hour' && (
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          시간대 분포 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>(KST 0-23시 누적)</span>
        </p>
        <p className="text-[11px] mb-1.5 h-4" style={{ color: 'var(--warm-mid)' }}>
          {selHour != null && stats.hourly[selHour]
            ? <><strong style={{ color: 'var(--warm-dark)' }}>{stats.hourly[selHour].hour}시</strong> · {fmt(stats.hourly[selHour].count)}뷰</>
            : <span style={{ color: 'var(--warm-muted)' }}>막대를 탭하면 상세가 표시됩니다</span>}
        </p>
        <div className="flex items-end gap-[2px] h-20">
          {stats.hourly.map((h, i) => {
            const height = (h.count / hourMax) * 100
            const sel = selHour === i
            return (
              <button key={i} type="button" onClick={() => setSelHour(sel ? null : i)}
                data-sel={sel ? '1' : '0'}
                className="mk-bar flex-1 h-full flex flex-col justify-end cursor-pointer" title={`${h.hour}시: ${h.count}뷰`}>
                <div className="w-full rounded-t-sm transition-opacity"
                  style={{ height: `${Math.max(2, height)}%`, background: 'var(--camel)', opacity: selHour == null || sel ? 1 : 0.4 }} />
              </button>
            )
          })}
        </div>
        <div className="flex justify-between text-[0.65625rem] mt-1.5" style={{ color: 'var(--warm-muted)' }}>
          <span>0시</span>
          <span>6시</span>
          <span>12시</span>
          <span>18시</span>
          <span>23시</span>
        </div>
      </div>
      )}

      {/* UTM 캠페인 */}
      <div className="rounded-xl p-4"
        style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
        <p className="text-xs font-semibold mb-3" style={{ color: 'var(--ink-2)' }}>
          UTM 캠페인 <span style={{ color: 'var(--warm-muted)', fontWeight: 400 }}>(?utm_source=... 가 있을 때만)</span>
        </p>
        {stats.campaigns.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>
            {isCustom ? '이 기간에 UTM 파라미터가 붙은 방문이 없어요' : 'UTM 파라미터가 붙은 방문이 아직 없어요'}
          </p>
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
