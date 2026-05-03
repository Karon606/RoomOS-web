'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AnnualSummary, ForecastSummary } from './actions'

const fmt = (n: number) => n === 0 ? '—' : n.toLocaleString('ko-KR') + '원'
const fmtMan = (n: number) => n === 0 ? '—' : `${Math.round(n / 10000).toLocaleString()}만`

export default function ReportClient({ summary, years, forecast }: { summary: AnnualSummary; years: string[]; forecast: ForecastSummary }) {
  const router = useRouter()
  const [tab, setTab] = useState<'past' | 'forecast'>('past')
  const handleYear = (y: string) => router.push(`/report?year=${y}`)

  const maxAbs = Math.max(
    1,
    ...summary.rows.map(r => Math.max(r.revenue + r.extraIncome, r.expense))
  )

  // 분기별 합계
  const quarters = [
    { q: 1, months: [1, 2, 3] },
    { q: 2, months: [4, 5, 6] },
    { q: 3, months: [7, 8, 9] },
    { q: 4, months: [10, 11, 12] },
  ].map(({ q, months }) => {
    const rows = summary.rows.filter(r => months.includes(Number(r.month.slice(5))))
    return {
      q,
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      expense: rows.reduce((s, r) => s + r.expense, 0),
      profit: rows.reduce((s, r) => s + r.profit, 0),
    }
  })

  const handleExportCSV = () => {
    const header = ['월', '매출', '전년 매출', '증감', '기타수익', '지출', '순이익', '월말 미수']
    const lines: string[][] = [header]
    for (const r of summary.rows) {
      const prev = summary.prevYear?.rows.find(p => p.month.slice(5) === r.month.slice(5))
      const delta = prev ? r.revenue - prev.revenue : ''
      lines.push([
        r.month,
        String(r.revenue),
        prev ? String(prev.revenue) : '',
        delta === '' ? '' : String(delta),
        String(r.extraIncome),
        String(r.expense),
        String(r.profit),
        String(r.unpaidAmount),
      ])
    }
    lines.push([
      '합계',
      String(summary.totalRevenue),
      summary.prevYear ? String(summary.prevYear.totalRevenue) : '',
      summary.prevYear ? String(summary.totalRevenue - summary.prevYear.totalRevenue) : '',
      String(summary.totalExtraIncome),
      String(summary.totalExpense),
      String(summary.totalProfit),
      String(summary.endingUnpaid),
    ])
    const csv = lines.map(row => row.map(c => `"${c}"`).join(',')).join('\n')
    // BOM 추가 — 엑셀 한글 인코딩 호환
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `결산보고서-${summary.year}년.csv`
    document.body.appendChild(a); a.click(); document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  const handlePrint = () => window.print()

  return (
    <div className="space-y-6 report-page">
      <div className="flex items-center justify-between flex-wrap gap-3 report-header">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">{tab === 'past' ? '결산 보고서' : '예상 보고서'}</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            {tab === 'past'
              ? '발생주의(매출 인식 월) 기준 연간 손익·미수 현황'
              : '향후 6개월 예상 매출·지출·순이익 — 호실 점유 일정 + 전년 동월/3개월 평균 기반'}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === 'past' && (
            <>
              <button
                type="button"
                onClick={handleExportCSV}
                className="px-3 py-2 text-sm font-medium rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors no-print"
              >
                CSV 다운로드
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="px-3 py-2 text-sm font-medium rounded-xl bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors no-print"
              >
                인쇄·PDF
              </button>
              <select
                value={summary.year}
                onChange={e => handleYear(e.target.value)}
                className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
              >
                {years.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* 탭 */}
      <div className="flex gap-1 bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-1 max-w-md no-print">
        {([
          { k: 'past',     label: '결산 (실적)' },
          { k: 'forecast', label: '예상 (6개월)' },
        ] as const).map(t => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={`flex-1 py-2 text-sm font-medium rounded-xl transition-colors ${
              tab === t.k
                ? 'bg-[var(--coral)] text-white'
                : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'forecast' && <ForecastSection forecast={forecast} />}

      {tab === 'past' && <>
      {/* 합계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="총 매출" value={fmt(summary.totalRevenue)} accent="text-[var(--coral)]" />
        <SummaryCard label="기타 수익" value={fmt(summary.totalExtraIncome)} />
        <SummaryCard label="총 지출" value={fmt(summary.totalExpense)} />
        <SummaryCard
          label="순이익"
          value={(summary.totalProfit >= 0 ? '+' : '-') + fmt(Math.abs(summary.totalProfit)).replace('원', '원')}
          accent={summary.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}
        />
      </div>

      {/* 분기별 합계 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)] mb-3">분기별 합계</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quarters.map(q => (
            <div key={q.q} className="bg-[var(--canvas)] rounded-xl p-3">
              <p className="text-xs text-[var(--warm-muted)]">{q.q}분기</p>
              <p className="text-sm font-bold mt-1 text-[var(--warm-dark)]">{fmt(q.revenue)}</p>
              <p className="text-[11px] text-[var(--warm-muted)] mt-0.5">지출 {fmt(q.expense)}</p>
              <p className={`text-[11px] mt-0.5 font-semibold ${q.profit > 0 ? 'text-emerald-600' : q.profit < 0 ? 'text-red-500' : 'text-[var(--warm-muted)]'}`}>
                {q.profit === 0 ? '—' : (q.profit > 0 ? '+' : '-') + Math.abs(q.profit).toLocaleString() + '원'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 카테고리별 지출 비중 */}
      {summary.expenseByCategory.length > 0 && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <h3 className="text-sm font-semibold text-[var(--warm-dark)]">카테고리별 지출 비중</h3>
            <span className="text-[11px] text-[var(--warm-muted)]">{summary.year}년 연간 합계 기준</span>
          </div>
          <div className="space-y-2">
            {summary.expenseByCategory.map(c => {
              const colors = ['#f4623a', '#eab308', '#22c55e', '#3b82f6', '#a855f7', '#06b6d4', '#ef4444', '#94a3b8']
              const idx = summary.expenseByCategory.indexOf(c)
              const color = colors[idx % colors.length]
              return (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--warm-dark)] w-20 shrink-0 truncate">{c.category}</span>
                  <div className="flex-1 h-5 bg-[var(--canvas)] rounded-full relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-all"
                      style={{ width: `${c.percent}%`, background: color }}
                    />
                  </div>
                  <span className="text-xs text-[var(--warm-mid)] w-24 text-right shrink-0">
                    {fmt(c.amount)} <span className="text-[10px] text-[var(--warm-muted)]">({c.percent}%)</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 월별 표 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--canvas)] border-b border-[var(--warm-border)]">
              <tr className="text-left text-xs text-[var(--warm-muted)]">
                <th className="px-4 py-3 font-medium">월</th>
                <th className="px-4 py-3 font-medium text-right">매출</th>
                {summary.prevYear && <th className="px-4 py-3 font-medium text-right">전년 매출 (Δ)</th>}
                <th className="px-4 py-3 font-medium text-right">기타수익</th>
                <th className="px-4 py-3 font-medium text-right">지출</th>
                <th className="px-4 py-3 font-medium text-right">순이익</th>
                <th className="px-4 py-3 font-medium text-right">월말 미수</th>
                <th className="px-4 py-3 font-medium">시각화</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map(r => {
                const incomeTotal = r.revenue + r.extraIncome
                const incomePct = (incomeTotal / maxAbs) * 100
                const expensePct = (r.expense / maxAbs) * 100
                const prevRow = summary.prevYear?.rows.find(p => p.month.slice(5) === r.month.slice(5))
                const delta = prevRow ? r.revenue - prevRow.revenue : 0
                return (
                  <tr key={r.month} className="border-b border-[var(--warm-border)] last:border-b-0">
                    <td className="px-4 py-3 text-[var(--warm-dark)] font-medium">{Number(r.month.slice(5))}월</td>
                    <td className="px-4 py-3 text-right text-[var(--warm-dark)]">{fmt(r.revenue)}</td>
                    {summary.prevYear && (
                      <td className="px-4 py-3 text-right">
                        <div className="text-[var(--warm-mid)] text-xs">{fmt(prevRow?.revenue ?? 0)}</div>
                        {prevRow && r.revenue > 0 && (
                          <div className={`text-[10px] mt-0.5 font-semibold ${
                            delta > 0 ? 'text-emerald-600' : delta < 0 ? 'text-red-500' : 'text-[var(--warm-muted)]'
                          }`}>
                            {delta === 0 ? '—' : (delta > 0 ? '▲' : '▼') + ' ' + Math.abs(delta).toLocaleString() + '원'}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.extraIncome)}</td>
                    <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.expense)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      r.profit > 0 ? 'text-emerald-600' : r.profit < 0 ? 'text-red-500' : 'text-[var(--warm-muted)]'
                    }`}>
                      {r.profit === 0 ? '—' : (r.profit > 0 ? '+' : '-') + Math.abs(r.profit).toLocaleString() + '원'}
                    </td>
                    <td className="px-4 py-3 text-right text-amber-600">{r.unpaidAmount > 0 ? fmt(r.unpaidAmount) : '—'}</td>
                    <td className="px-4 py-3 w-40">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 rounded-full bg-emerald-200" style={{ width: `${incomePct}%` }} />
                          <span className="text-[10px] text-[var(--warm-muted)]">{fmtMan(incomeTotal)}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <div className="h-1.5 rounded-full bg-rose-200" style={{ width: `${expensePct}%` }} />
                          <span className="text-[10px] text-[var(--warm-muted)]">{fmtMan(r.expense)}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-[var(--canvas)] font-semibold">
                <td className="px-4 py-3 text-[var(--warm-dark)]">합계</td>
                <td className="px-4 py-3 text-right text-[var(--warm-dark)]">{fmt(summary.totalRevenue)}</td>
                {summary.prevYear && (
                  <td className="px-4 py-3 text-right">
                    <div className="text-[var(--warm-mid)] text-xs">{fmt(summary.prevYear.totalRevenue)}</div>
                    {summary.prevYear.totalRevenue > 0 && (() => {
                      const totalDelta = summary.totalRevenue - summary.prevYear.totalRevenue
                      return (
                        <div className={`text-[10px] mt-0.5 font-semibold ${
                          totalDelta > 0 ? 'text-emerald-600' : totalDelta < 0 ? 'text-red-500' : 'text-[var(--warm-muted)]'
                        }`}>
                          {totalDelta === 0 ? '—' : (totalDelta > 0 ? '▲' : '▼') + ' ' + Math.abs(totalDelta).toLocaleString() + '원'}
                        </div>
                      )
                    })()}
                  </td>
                )}
                <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(summary.totalExtraIncome)}</td>
                <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(summary.totalExpense)}</td>
                <td className={`px-4 py-3 text-right ${summary.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {(summary.totalProfit >= 0 ? '+' : '-') + Math.abs(summary.totalProfit).toLocaleString() + '원'}
                </td>
                <td className="px-4 py-3 text-right text-amber-600">{fmt(summary.endingUnpaid)}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--warm-muted)] leading-relaxed">
        매출은 임대 서비스가 제공된 월(targetMonth) 기준으로 인식됩니다. 입금 지연이 있어도 매출은 발생월에 잡히며,
        '월말 미수'는 그 월말 시점까지 회수되지 않은 채권 누적액입니다.
      </p>
      </>}
    </div>
  )
}

function ForecastSection({ forecast }: { forecast: ForecastSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="6개월 예상 매출" value={fmt(forecast.totalRevenue)} accent="text-[var(--coral)]" />
        <SummaryCard label="6개월 예상 지출" value={fmt(forecast.totalExpense)} />
        <SummaryCard
          label="6개월 예상 순이익"
          value={(forecast.totalProfit >= 0 ? '+' : '-') + Math.abs(forecast.totalProfit).toLocaleString() + '원'}
          accent={forecast.totalProfit >= 0 ? 'text-emerald-600' : 'text-red-500'}
        />
      </div>
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--canvas)] border-b border-[var(--warm-border)]">
              <tr className="text-left text-xs text-[var(--warm-muted)]">
                <th className="px-4 py-3 font-medium">월</th>
                <th className="px-4 py-3 font-medium text-right">예상 매출</th>
                <th className="px-4 py-3 font-medium text-right">기타 수익</th>
                <th className="px-4 py-3 font-medium text-right">예상 지출</th>
                <th className="px-4 py-3 font-medium text-right">예상 순이익</th>
                <th className="px-4 py-3 font-medium text-right">점유/공실</th>
              </tr>
            </thead>
            <tbody>
              {forecast.rows.map(r => (
                <tr key={r.month} className="border-b border-[var(--warm-border)] last:border-b-0">
                  <td className="px-4 py-3 text-[var(--warm-dark)] font-medium">{r.month.slice(0, 4)}년 {Number(r.month.slice(5))}월</td>
                  <td className="px-4 py-3 text-right text-[var(--warm-dark)]">{fmt(r.expectedRevenue)}</td>
                  <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.expectedExtraIncome)}</td>
                  <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.expectedExpense)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${
                    r.expectedProfit > 0 ? 'text-emerald-600' : r.expectedProfit < 0 ? 'text-red-500' : 'text-[var(--warm-muted)]'
                  }`}>
                    {r.expectedProfit === 0 ? '—' : (r.expectedProfit > 0 ? '+' : '-') + Math.abs(r.expectedProfit).toLocaleString() + '원'}
                  </td>
                  <td className="px-4 py-3 text-right text-[var(--warm-muted)] text-xs">
                    {r.occupiedRooms} / {r.occupiedRooms + r.vacantRooms}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <p className="text-[11px] text-[var(--warm-muted)] leading-relaxed">
        예상 매출 = 호실별 점유 일정 × 임대료(예정 가격 적용일 반영). 예상 지출/기타 수익 = 전년 동월 실적,
        없으면 최근 3개월 평균. 입주 예정·퇴실 예정 일정도 반영되며, 미확정 변수가 많을수록 실제 결과와 차이가 날 수 있습니다.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-4">
      <p className="text-xs text-[var(--warm-muted)]">{label}</p>
      <p className={`text-base font-bold mt-1 ${accent ?? 'text-[var(--warm-dark)]'}`}>{value}</p>
    </div>
  )
}
