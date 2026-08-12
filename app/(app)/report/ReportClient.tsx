'use client'

import { useState, useTransition, type ReactNode } from 'react'
import { AiQuotaHint } from '@/components/ui/AiQuotaHint'
import { notifyAiQuota } from '@/lib/aiQuotaToast'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { useRouter } from 'next/navigation'
import type { AnnualSummary, ForecastSummary, PropertyDiagnostics } from './actions'
import { analyzePropertyWithGemini } from './actions'
import { Btn } from '@/components/ui/Btn'
import { InfoHint } from '@/components/ui/InfoHint'
import { fmtKorMoney, fmtWon } from '@/lib/fmtMoney'
import { fmtDateKor } from '@/lib/fmtDate'
import { kstMonthStr } from '@/lib/kstDate'
import { useNavRouter } from '@/lib/useNavRouter'

const fmt = (n: number) => n === 0 ? '—' : fmtWon(n)   // 0 특례만 로컬, 표기는 정본(감사 B4)
const fmtMan = (n: number) => n === 0 ? '—' : fmtKorMoney(n).replace(/원$/, '')

export default function ReportClient({ summary, years, forecast }: { summary: AnnualSummary; years: string[]; forecast: ForecastSummary }) {
  const router = useNavRouter()   // 이동에 진행바 동반(F페이즈)
  const [tab, setTab] = useState<'past' | 'forecast' | 'ai'>('past')
  const handleYear = (y: string) => router.push(`/report?year=${y}`)

  const maxAbs = Math.max(
    1,
    ...summary.rows.map(r => Math.max(r.revenue + r.extraIncome, r.expense))
  )

  // 미수 증감 — 이번 행 미수 잔액에서 이전 행 미수 잔액을 뺀 값(1월은 0 대비). 미래 월은 null.
  const todayMonth = kstMonthStr()
  const unpaidDelta = (i: number): number | null => {
    const r = summary.rows[i]
    if (r.month > todayMonth) return null
    const prev = i > 0 ? summary.rows[i - 1].unpaidAmount : 0
    return r.unpaidAmount - prev
  }
  // 증감 배지 — 0/미래는 '—', 양수는 warning +금액, 음수는 success −금액(fmtWon 이 U+2212).
  const deltaBadge = (d: number | null): ReactNode => {
    if (d === null || d === 0) return <span className="text-[var(--warm-muted)]">—</span>
    if (d > 0) return <span className="text-[var(--warning-fg)] font-semibold">+{fmtWon(d)}</span>
    return <span className="text-[var(--success-fg)] font-semibold">{fmtWon(d)}</span>
  }

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
    const header = ['월', '청구액', '수납액', '전년 수납액', '증감', '부가수익', '지출', '운영이익', '미수 증감', '월말 미수 잔액']
    const lines: string[][] = [header]
    summary.rows.forEach((r, i) => {
      const prev = summary.prevYear?.rows.find(p => p.month.slice(5) === r.month.slice(5))
      const delta = prev ? r.revenue - prev.revenue : ''
      const ud = unpaidDelta(i)
      lines.push([
        r.month,
        String(r.billedAmount),
        String(r.revenue),
        prev ? String(prev.revenue) : '',
        delta === '' ? '' : String(delta),
        String(r.extraIncome),
        String(r.expense),
        String(r.profit),
        ud === null ? '' : String(ud),
        String(r.unpaidAmount),
      ])
    })
    lines.push([
      '합계',
      String(summary.totalBilled),
      String(summary.totalRevenue),
      summary.prevYear ? String(summary.prevYear.totalRevenue) : '',
      summary.prevYear ? String(summary.totalRevenue - summary.prevYear.totalRevenue) : '',
      String(summary.totalExtraIncome),
      String(summary.totalExpense),
      String(summary.totalProfit),
      '',
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
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">{
            tab === 'past' ? '결산 보고서' : tab === 'forecast' ? '예상 보고서' : 'AI 영업장 진단'
          }</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            {tab === 'past'
              ? '귀속월 기준 연간 수납·지출·미수 현황'
              : tab === 'forecast'
              ? '향후 6개월 예상 청구액·지출·운영이익 · 호실 점유 일정 + 전년 동월/3개월 평균 기반'
              : 'Gemini AI가 점유율·미수·회전율·지출 구조를 분석해 영업장 단위 진단·개선 제안을 제공합니다.'}
          </p>
          {tab === 'past' && (
            <p className="hidden print:block text-[0.6875rem] text-[var(--warm-muted)] mt-1">
              대상 연도 {summary.year}년 · 출력일 <span suppressHydrationWarning>{fmtDateKor(new Date())}</span>
            </p>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {tab === 'past' && (
            <>
              <Btn type="button" variant="secondary" size="sm" className="no-print" onClick={handleExportCSV}>
                CSV 다운로드
              </Btn>
              <Btn type="button" variant="secondary" size="sm" className="no-print" onClick={handlePrint}>
                인쇄·PDF
              </Btn>
              <select
                value={summary.year}
                onChange={e => handleYear(e.target.value)}
                className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
              >
                {years.map(y => <option key={y} value={y}>{y}년</option>)}
              </select>
            </>
          )}
        </div>
      </div>

      {/* 탭 */}
      {/* v2.0 §25 뷰 전환 탭 — rounded-2xl 변종(C) 폐기, 코랄 채움 정본 + flex-1 3등분 유지 */}
      <div className="max-w-xl no-print">
        <ViewTabs ariaLabel="보고서 탭" fill activeId={tab}
          onChange={id => setTab(id as 'past' | 'forecast' | 'ai')}
          tabs={[
            { id: 'past',     label: '결산 (실적)' },
            { id: 'forecast', label: '예상 (6개월)' },
            { id: 'ai',       label: 'AI 진단' },
          ]} />
      </div>

      {tab === 'forecast' && <ForecastSection forecast={forecast} />}
      {tab === 'ai' && <AISection />}

      {tab === 'past' && <>
      {/* 합계 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="총 수납액" value={fmt(summary.totalRevenue)} accent="text-[var(--coral)]"
          hint={<InfoHint title="총 수납액">실제로 입금된 이용료를 입금일이 아니라 그 돈이 어느 달 몫인지(귀속월) 기준으로 모은 금액입니다. 아직 받지 못한 이용료는 포함되지 않으므로, 받을 예정 금액까지 포함하는 홈의 예상 수입보다 작을 수 있습니다.</InfoHint>} />
        <SummaryCard label="부가수익" value={fmt(summary.totalExtraIncome)} />
        <SummaryCard label="총 지출" value={fmt(summary.totalExpense)} />
        <SummaryCard
          label="운영이익"
          value={(summary.totalProfit >= 0 ? '+' : '-') + fmt(Math.abs(summary.totalProfit)).replace('원', '원')}
          accent={summary.totalProfit >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}
          hint={<InfoHint title="운영이익">수납액과 부가수익에서 기록된 지출을 뺀 금액입니다. 감가상각비, 대출이자, 세금을 반영하기 전이므로 회계상 당기순이익과는 다릅니다.</InfoHint>}
        />
      </div>

      {/* 분기별 합계 */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)] mb-3">분기별 합계</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {quarters.map(q => (
            <div key={q.q} className="bg-[var(--canvas)] rounded-xl p-3">
              <p className="text-xs text-[var(--warm-muted)]">{q.q}분기</p>
              <p className="text-sm font-bold mt-1 text-[var(--warm-dark)]">{fmt(q.revenue)}</p>
              <p className="text-[0.6875rem] text-[var(--warm-muted)] mt-0.5">지출 {fmt(q.expense)}</p>
              <p className={`text-[0.6875rem] mt-0.5 font-semibold ${q.profit > 0 ? 'text-[var(--success-fg)]' : q.profit < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'}`}>
                {q.profit === 0 ? '—' : (q.profit > 0 ? '+' : '-') + Math.abs(q.profit).toLocaleString() + '원'}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* 카테고리별 지출 비중 */}
      {summary.expenseByCategory.length > 0 && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4">
          <div className="flex items-baseline gap-2 mb-3">
            <h3 className="text-sm font-semibold text-[var(--warm-dark)]">카테고리별 지출 비중</h3>
            <span className="text-[0.6875rem] text-[var(--warm-muted)]">{summary.year}년 연간 합계 기준</span>
          </div>
          <div className="space-y-2">
            {summary.expenseByCategory.map(c => {
              const colors = ['var(--viz-1)', 'var(--viz-2)', 'var(--viz-3)', 'var(--viz-4)', 'var(--viz-5)', 'var(--viz-6)', 'var(--viz-7)', 'var(--viz-8)']
              const idx = summary.expenseByCategory.indexOf(c)
              const color = colors[idx % colors.length]
              return (
                <div key={c.category} className="flex items-center gap-3">
                  <span className="text-xs text-[var(--warm-dark)] w-20 shrink-0 truncate">{c.category}</span>
                  <div className="flex-1 h-5 bg-[var(--canvas)] rounded-full relative overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded-full transition-[width]"
                      style={{ width: `${c.percent}%`, background: color }}
                    />
                  </div>
                  <span className="text-xs text-[var(--warm-mid)] w-24 text-right shrink-0">
                    {fmt(c.amount)} <span className="text-[0.65625rem] text-[var(--warm-muted)]">({c.percent}%)</span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* 월별 카드 (모바일 전용) */}
      <div className="space-y-2 sm:hidden print:hidden">
        {summary.rows.map(r => {
          const incomeTotal = r.revenue + r.extraIncome
          const incomePct = (incomeTotal / maxAbs) * 100
          const expensePct = (r.expense / maxAbs) * 100
          const prevRow = summary.prevYear?.rows.find(p => p.month.slice(5) === r.month.slice(5))
          const delta = prevRow ? r.revenue - prevRow.revenue : 0
          return (
            <div key={r.month} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-[var(--warm-border)]/60">
                <span className="text-sm font-bold text-[var(--warm-dark)]">{Number(r.month.slice(5))}월</span>
                <span className={`text-sm font-semibold ${
                  r.profit > 0 ? 'text-[var(--success-fg)]' : r.profit < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'
                }`}>
                  운영이익 {r.profit === 0 ? '—' : (r.profit > 0 ? '+' : '-') + Math.abs(r.profit).toLocaleString() + '원'}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                <div className="flex justify-between"><span className="text-[var(--warm-muted)]">청구액</span><span className="text-[var(--warm-dark)]">{fmt(r.billedAmount)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--warm-muted)]">수납액</span><span className="text-[var(--warm-dark)]">{fmt(r.revenue)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--warm-muted)]">부가수익</span><span className="text-[var(--warm-mid)]">{fmt(r.extraIncome)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--warm-muted)]">지출</span><span className="text-[var(--warm-mid)]">{fmt(r.expense)}</span></div>
                <div className="flex justify-between"><span className="text-[var(--warm-muted)]">월말 미수 잔액</span><span className="text-[var(--warning-fg)]">{r.unpaidAmount > 0 ? fmt(r.unpaidAmount) : '—'}</span></div>
                {summary.prevYear && (
                  <div className="col-span-2 flex justify-between pt-1 border-t border-[var(--warm-border)]/40">
                    <span className="text-[var(--warm-muted)]">전년 수납액</span>
                    <span className="flex items-center gap-1.5">
                      <span className="text-[var(--warm-mid)]">{fmt(prevRow?.revenue ?? 0)}</span>
                      {prevRow && r.revenue > 0 && delta !== 0 && (
                        <span className={`text-[0.65625rem] font-semibold ${delta > 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
                          {(delta > 0 ? '▲' : '▼')} {fmtWon(Math.abs(delta))}
                        </span>
                      )}
                    </span>
                  </div>
                )}
              </div>
              <div className="space-y-1 pt-1">
                <div className="flex items-center gap-2">
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] w-8 shrink-0">수익</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, incomePct)}%`, minWidth: incomeTotal > 0 ? 2 : 0, background: 'var(--success-fg)' }} />
                  </div>
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] tabular-nums w-12 text-right shrink-0">{fmtMan(incomeTotal)}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] w-8 shrink-0">지출</span>
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${Math.min(100, expensePct)}%`, minWidth: r.expense > 0 ? 2 : 0, background: 'var(--coral)' }} />
                  </div>
                  <span className="text-[0.65625rem] text-[var(--warm-muted)] tabular-nums w-12 text-right shrink-0">{fmtMan(r.expense)}</span>
                </div>
              </div>
            </div>
          )
        })}
        <div className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl p-4 space-y-2">
          <div className="flex items-center justify-between pb-2 border-b border-[var(--warm-border)]/60">
            <span className="text-sm font-bold text-[var(--warm-dark)]">합계</span>
            <span className={`text-sm font-bold ${summary.totalProfit >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
              {(summary.totalProfit >= 0 ? '+' : '-') + Math.abs(summary.totalProfit).toLocaleString() + '원'}
            </span>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
            <div className="flex justify-between"><span className="text-[var(--warm-muted)]">청구액</span><span className="text-[var(--warm-dark)] font-medium">{fmt(summary.totalBilled)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--warm-muted)]">수납액</span><span className="text-[var(--warm-dark)] font-medium">{fmt(summary.totalRevenue)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--warm-muted)]">부가수익</span><span className="text-[var(--warm-mid)]">{fmt(summary.totalExtraIncome)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--warm-muted)]">지출</span><span className="text-[var(--warm-mid)]">{fmt(summary.totalExpense)}</span></div>
            <div className="flex justify-between"><span className="text-[var(--warm-muted)]">월말 미수 잔액</span><span className="text-[var(--warning-fg)]">{fmt(summary.endingUnpaid)}</span></div>
            {summary.prevYear && summary.prevYear.totalRevenue > 0 && (() => {
              const totalDelta = summary.totalRevenue - summary.prevYear.totalRevenue
              return (
                <div className="col-span-2 flex justify-between pt-1 border-t border-[var(--warm-border)]/40">
                  <span className="text-[var(--warm-muted)]">전년 수납액</span>
                  <span className="flex items-center gap-1.5">
                    <span className="text-[var(--warm-mid)]">{fmt(summary.prevYear.totalRevenue)}</span>
                    {totalDelta !== 0 && (
                      <span className={`text-[0.65625rem] font-semibold ${totalDelta > 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
                        {(totalDelta > 0 ? '▲' : '▼')} {fmtWon(Math.abs(totalDelta))}
                      </span>
                    )}
                  </span>
                </div>
              )
            })()}
          </div>
        </div>
      </div>

      {/* 월별 표 (sm 이상 / 인쇄) */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden hidden sm:block print:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--canvas)] border-b border-[var(--warm-border)]">
              <tr className="text-left text-xs text-[var(--warm-muted)]">
                <th className="px-4 py-3 font-medium">월</th>
                <th className="px-4 py-3 font-medium text-right">청구액</th>
                <th className="px-4 py-3 font-medium text-right">수납액</th>
                {summary.prevYear && <th className="px-4 py-3 font-medium text-right">전년 수납액 (Δ)</th>}
                <th className="px-4 py-3 font-medium text-right">부가수익</th>
                <th className="px-4 py-3 font-medium text-right">지출</th>
                <th className="px-4 py-3 font-medium text-right">운영이익</th>
                <th className="px-4 py-3 font-medium text-right">미수 증감</th>
                <th className="px-4 py-3 font-medium text-right">월말 미수 잔액</th>
                <th className="px-4 py-3 font-medium">시각화</th>
              </tr>
            </thead>
            <tbody>
              {summary.rows.map((r, i) => {
                const incomeTotal = r.revenue + r.extraIncome
                const incomePct = (incomeTotal / maxAbs) * 100
                const expensePct = (r.expense / maxAbs) * 100
                const prevRow = summary.prevYear?.rows.find(p => p.month.slice(5) === r.month.slice(5))
                const delta = prevRow ? r.revenue - prevRow.revenue : 0
                return (
                  <tr key={r.month} className="border-b border-[var(--warm-border)] last:border-b-0">
                    <td className="px-4 py-3 text-[var(--warm-dark)] font-medium">{Number(r.month.slice(5))}월</td>
                    <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.billedAmount)}</td>
                    <td className="px-4 py-3 text-right text-[var(--warm-dark)]">{fmt(r.revenue)}</td>
                    {summary.prevYear && (
                      <td className="px-4 py-3 text-right">
                        <div className="text-[var(--warm-mid)] text-xs">{fmt(prevRow?.revenue ?? 0)}</div>
                        {prevRow && r.revenue > 0 && (
                          <div className={`text-[0.65625rem] mt-0.5 font-semibold ${
                            delta > 0 ? 'text-[var(--success-fg)]' : delta < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'
                          }`}>
                            {delta === 0 ? '—' : (delta > 0 ? '▲' : '▼') + ' ' + Math.abs(delta).toLocaleString() + '원'}
                          </div>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.extraIncome)}</td>
                    <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(r.expense)}</td>
                    <td className={`px-4 py-3 text-right font-semibold ${
                      r.profit > 0 ? 'text-[var(--success-fg)]' : r.profit < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'
                    }`}>
                      {r.profit === 0 ? '—' : (r.profit > 0 ? '+' : '-') + Math.abs(r.profit).toLocaleString() + '원'}
                    </td>
                    <td className="px-4 py-3 text-right text-xs">{deltaBadge(unpaidDelta(i))}</td>
                    <td className="px-4 py-3 text-right text-[var(--warning-fg)]">{r.unpaidAmount > 0 ? fmt(r.unpaidAmount) : '—'}</td>
                    <td className="px-4 py-3 w-44">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, incomePct)}%`, minWidth: incomeTotal > 0 ? 2 : 0, background: 'var(--success-fg)' }} />
                          </div>
                          <span className="text-[0.65625rem] text-[var(--warm-muted)] tabular-nums w-10 text-right shrink-0">{fmtMan(incomeTotal)}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--canvas)] overflow-hidden">
                            <div className="h-full rounded-full" style={{ width: `${Math.min(100, expensePct)}%`, minWidth: r.expense > 0 ? 2 : 0, background: 'var(--coral)' }} />
                          </div>
                          <span className="text-[0.65625rem] text-[var(--warm-muted)] tabular-nums w-10 text-right shrink-0">{fmtMan(r.expense)}</span>
                        </div>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-[var(--canvas)] font-semibold">
                <td className="px-4 py-3 text-[var(--warm-dark)]">합계</td>
                <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(summary.totalBilled)}</td>
                <td className="px-4 py-3 text-right text-[var(--warm-dark)]">{fmt(summary.totalRevenue)}</td>
                {summary.prevYear && (
                  <td className="px-4 py-3 text-right">
                    <div className="text-[var(--warm-mid)] text-xs">{fmt(summary.prevYear.totalRevenue)}</div>
                    {summary.prevYear.totalRevenue > 0 && (() => {
                      const totalDelta = summary.totalRevenue - summary.prevYear.totalRevenue
                      return (
                        <div className={`text-[0.65625rem] mt-0.5 font-semibold ${
                          totalDelta > 0 ? 'text-[var(--success-fg)]' : totalDelta < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'
                        }`}>
                          {totalDelta === 0 ? '—' : (totalDelta > 0 ? '▲' : '▼') + ' ' + Math.abs(totalDelta).toLocaleString() + '원'}
                        </div>
                      )
                    })()}
                  </td>
                )}
                <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(summary.totalExtraIncome)}</td>
                <td className="px-4 py-3 text-right text-[var(--warm-mid)]">{fmt(summary.totalExpense)}</td>
                <td className={`px-4 py-3 text-right ${summary.totalProfit >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}`}>
                  {(summary.totalProfit >= 0 ? '+' : '-') + Math.abs(summary.totalProfit).toLocaleString() + '원'}
                </td>
                <td className="px-4 py-3"></td>
                <td className="px-4 py-3 text-right text-[var(--warning-fg)]">{fmt(summary.endingUnpaid)}</td>
                <td className="px-4 py-3"></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed space-y-1.5">
        <p className="font-semibold text-[var(--warm-mid)]">산정 기준</p>
        <ul className="space-y-1 list-disc pl-4">
          <li>청구액. 그 달 발생한 이용료 청구액이며 할인, 일할계산, 예약 인상을 반영합니다.</li>
          <li>수납액. 받은 이용료를 해당 월 몫(귀속월)으로 배부하며 월 이용료를 상한으로 합니다. 보증금과 양도인 정산분은 제외합니다.</li>
          <li>미수 증감. 전월 대비 월말 미수 잔액의 변화입니다. 선납 초과분이나 예약, 취소 계약의 수취액이 있는 달에는 청구액에서 수납액을 뺀 값과 정확히 일치하지 않을 수 있습니다.</li>
          <li>월말 미수 잔액. 그 월말까지 받았어야 할 이용료 중 아직 회수되지 않은 채권 잔액입니다. 청구액은 할인과 일할계산을 반영합니다.</li>
          <li>운영이익. 세금, 감가상각비, 대출이자 반영 전 금액입니다.</li>
          <li>보증금. 돌려드릴 돈이므로 수익에 포함하지 않습니다. 취소된 계약의 수취액은 수납액에 포함하지 않으며 부가수익으로 등록해 관리합니다.</li>
        </ul>
      </div>
      </>}
    </div>
  )
}

function ForecastSection({ forecast }: { forecast: ForecastSummary }) {
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <SummaryCard label="6개월 예상 청구액" value={fmt(forecast.totalRevenue)} accent="text-[var(--coral)]" />
        <SummaryCard label="6개월 예상 지출" value={fmt(forecast.totalExpense)} />
        <SummaryCard
          label="6개월 예상 운영이익"
          value={(forecast.totalProfit >= 0 ? '+' : '-') + Math.abs(forecast.totalProfit).toLocaleString() + '원'}
          accent={forecast.totalProfit >= 0 ? 'text-[var(--success-fg)]' : 'text-[var(--danger-fg)]'}
        />
      </div>
      {/* 예상 카드 (모바일 전용) */}
      <div className="space-y-2 sm:hidden print:hidden">
        {forecast.rows.map(r => (
          <div key={r.month} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-2.5">
            <div className="flex items-center justify-between pb-2 border-b border-[var(--warm-border)]/60">
              <span className="text-sm font-bold text-[var(--warm-dark)]">{r.month.slice(0, 4)}년 {Number(r.month.slice(5))}월</span>
              <span className={`text-sm font-semibold ${
                r.expectedProfit > 0 ? 'text-[var(--success-fg)]' : r.expectedProfit < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'
              }`}>
                {r.expectedProfit === 0 ? '—' : (r.expectedProfit > 0 ? '+' : '-') + Math.abs(r.expectedProfit).toLocaleString() + '원'}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
              <div className="flex justify-between"><span className="text-[var(--warm-muted)]">예상 청구액</span><span className="text-[var(--warm-dark)]">{fmt(r.expectedRevenue)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--warm-muted)]">부가수익</span><span className="text-[var(--warm-mid)]">{fmt(r.expectedExtraIncome)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--warm-muted)]">예상 지출</span><span className="text-[var(--warm-mid)]">{fmt(r.expectedExpense)}</span></div>
              <div className="flex justify-between"><span className="text-[var(--warm-muted)]">점유/공실</span><span className="text-[var(--warm-dark)]">{r.occupiedRooms} / {r.occupiedRooms + r.vacantRooms}</span></div>
            </div>
          </div>
        ))}
      </div>

      {/* 예상 표 (sm 이상 / 인쇄) */}
      <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl overflow-hidden hidden sm:block print:block">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--canvas)] border-b border-[var(--warm-border)]">
              <tr className="text-left text-xs text-[var(--warm-muted)]">
                <th className="px-4 py-3 font-medium">월</th>
                <th className="px-4 py-3 font-medium text-right">예상 청구액</th>
                <th className="px-4 py-3 font-medium text-right">부가수익</th>
                <th className="px-4 py-3 font-medium text-right">예상 지출</th>
                <th className="px-4 py-3 font-medium text-right">예상 운영이익</th>
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
                    r.expectedProfit > 0 ? 'text-[var(--success-fg)]' : r.expectedProfit < 0 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-muted)]'
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
      <p className="text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
        예상 청구액 = 호실별 점유 일정 × 임대료(예정 가격 적용일 반영). 예상 지출/부가수익 = 전년 동월 실적,
        없으면 최근 3개월 평균. 입주 예정·퇴실 예정 일정도 반영되며, 미확정 변수가 많을수록 실제 결과와 차이가 날 수 있습니다.
        여기의 예상 청구액은 이용료만 집계하며, 홈의 예상 수입은 부가수익을 포함합니다.
        {/* 동명이의 고지 — 홈에도 '예상 지출'·'예상 운영이익'이 있는데 모집단이 다르다.
            이름을 바꾸면 이 화면 안 열 헤더·CSV 까지 갈리므로 뜻을 적어 가른다(2026-08-12). */}
        {' '}같은 이름이지만 홈의 예상 지출은 이 달 기록분에 미기록 고정 지출 추정을 더한 값이고,
        여기 예상 지출은 과거 실적 기반 추정이라 서로 다른 숫자입니다. 예상 운영이익도 같습니다.
      </p>
    </div>
  )
}

function SummaryCard({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: ReactNode }) {
  return (
    <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4">
      <p className="text-xs text-[var(--warm-muted)]">{label}{hint}</p>
      <p className={`text-base font-bold mt-1 ${accent ?? 'text-[var(--warm-dark)]'}`}>{value}</p>
    </div>
  )
}

// ── AI 영업장 진단 섹션 ────────────────────────────────────────────
function AISection() {
  const [pending, startTransition] = useTransition()
  const [text, setText] = useState('')
  const [data, setData] = useState<PropertyDiagnostics | null>(null)
  const [error, setError] = useState('')

  const handleAnalyze = () => {
    setError(''); setText(''); setData(null)
    startTransition(async () => {
      const res = await analyzePropertyWithGemini()
      if (!res.ok) setError(res.error)
      else { setText(res.text); setData(res.data); void notifyAiQuota() }
    })
  }

  return (
    <div className="space-y-4">
      {!text && !pending && !error && (
        <div className="bg-[var(--cream)] border border-[var(--coral)]/30 rounded-xl p-6 text-center space-y-3">
          <p className="text-xs num text-[var(--persimmon)] tracking-wider uppercase">AI Diagnose</p>
          <p className="text-sm font-semibold text-[var(--warm-dark)]">Gemini AI 영업장 진단</p>
          <p className="text-xs text-[var(--warm-muted)] leading-relaxed">
            현재 점유율·임대료·미수율·12개월 매출 추세·지출 구조·입주자 회전율 등을 종합 분석해<br/>
            영업장의 강점·약점과 향후 30일 실행 가능한 개선안을 제안합니다.
          </p>
          <Btn variant="primary" size="lg" onClick={handleAnalyze}>진단 시작</Btn>
          <div><AiQuotaHint /></div>
        </div>
      )}

      {pending && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-6 text-center space-y-3">
          <div className="w-6 h-6 mx-auto border-2 border-[var(--coral)] border-t-transparent rounded-full animate-spin" />
          <p className="text-xs text-[var(--coral)] animate-pulse">데이터 수집 + AI 분석 중…</p>
          <p className="text-[0.65625rem] text-[var(--warm-muted)]">10~20초 소요됩니다</p>
        </div>
      )}

      {error && (
        <div className="bg-[var(--danger-bg)] border border-[var(--danger-ring)] rounded-xl p-4 space-y-2">
          <p className="text-sm font-semibold text-[var(--danger-fg)]">분석 실패</p>
          <p className="text-xs text-[var(--danger-fg)]">{error}</p>
          <Btn variant="danger" size="sm" onClick={handleAnalyze}>다시 시도</Btn>
        </div>
      )}

      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <SummaryCard label="점유율 (현재)" value={`${(data.occupancyRate * 100).toFixed(1)}%`} accent="text-[var(--success-fg)]" />
          <SummaryCard label="미수율 (최근 12개월)" value={`${(data.unpaidRate * 100).toFixed(1)}%`} accent={data.unpaidRate > 0.05 ? 'text-[var(--danger-fg)]' : 'text-[var(--warm-dark)]'} />
          <SummaryCard label="평균 거주기간 (퇴실자)" value={data.avgStayMonths != null ? `${data.avgStayMonths.toFixed(1)}개월` : '—'} />
          <SummaryCard label="퇴실 (최근 6개월)" value={`${data.turnoverPer6mo}건`} />
        </div>
      )}

      {text && (
        <div className="bg-[var(--cream)] border border-[var(--coral)]/30 rounded-xl p-5 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--coral)]">AI 진단 결과</span>
            </div>
            <Btn variant="primary" size="sm" onClick={handleAnalyze}>다시 분석</Btn>
          </div>
          <div className="text-sm text-[var(--warm-dark)] leading-relaxed whitespace-pre-wrap [&_strong]:text-[var(--coral)] [&_strong]:font-semibold"
               dangerouslySetInnerHTML={{ __html: renderMarkdown(text) }} />
        </div>
      )}
    </div>
  )
}

// 간단한 마크다운 변환 (bold + line breaks)
function renderMarkdown(text: string): string {
  return text
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br/>')
}
