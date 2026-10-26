// 결산 보고서(연간)를 A4 가로 종이로 뽑는 self-contained HTML. 아이폰 홈화면 앱의 인쇄 운반로다.
//
// 왜 있나(신고 2e41ddb1). 결산 보고서의 [인쇄]는 window.print() 하나였고, 아이폰 홈화면 앱
// (display: standalone)에서는 그 호출이 아무 일도 하지 않는다. 그 환경의 유일한 인쇄 운반로는
// 공유 시트의 [프린트]이고(lib/useDocPrint), 시트에 넘길 PDF 바이트가 이 종이다.
// 데스크톱·안드로이드·아이폰 사파리는 종전 그대로 화면을 window.print() 로 찍는다.
//
// **숫자는 화면과 같은 정본에서 온다.** 라우트가 getAnnualReport(화면이 받는 그 AnnualSummary)를
// 그대로 넘기고, 여기서는 아무것도 다시 계산하지 않는다. 행별 파생값(전년 대비·미수 증감)도
// ReportClient 와 같은 식이다. 산정 기준 문장은 lib/reportShared 한 벌을 함께 읽는다.
//
// 외부 참조가 0 건이다(글꼴은 data URL). 헤드리스 크로미움은 쿠키가 없고 네트워크를 믿을 수 없다.
// 그 사실은 scripts/check-print-selfcontained.ts 축 1-d 가 지킨다.
//
// 조판(v2.0 §26.2). 브랜딩 ON 이다(2026-10-26 운영자 결정). 로고 머리띠·사업자정보·꼬리말·워드마크·
// 쪽 번호 꼬리말은 계약서와 같은 공용 조각(lib/printBrandHtml)을 그대로 쓰고 여기서 새로 그리지 않는다.
// 본문 먹1색, 색은 헤더 룰과 음수 금액(--p-tc)뿐이다. 라운드·그림자·막대 그림이 없다(흑백 안전).
// 표가 9칸이라 세로 170mm 에 안 들어가 A4 가로로 세운다. 표는 라벨 10pt · 값 10.5pt(§26 표 기준)이고
// 넘치면 다음 장으로 이어진다(행 안은 안 쪼개고 머리줄은 장마다 다시 선다).
// 순수 함수다. DB 도 fs 도 네트워크도 없다. 글꼴·로고 바이트는 라우트가 data URL 로 넘긴다.

import type { AnnualSummary, MonthlyRow } from '@/app/(app)/report/actions'
import { fmtWon } from '@/lib/fmtMoney'
import { PRINT_HEX } from '@/lib/printTokens'   // v2.0 §26 인쇄 토큰 단일 출처
import { REPORT_BASIS_NOTES } from '@/lib/reportShared'
import {
  printBrandHeaderHtml, printBrandFootBizHtml, type PrintBrandSource,
  PRINT_BRAND_HEADER_CSS, PRINT_BRAND_FOOTER_CSS, PRINT_WORDMARK_CSS, PRINT_WORDMARK_HTML,
} from '@/lib/printBrandHtml'

export type ReportPrintOptions = {
  /** 머리띠·꼬리말 재료(현재 영업장 사업자정보·전화·로고 data URL). 계약서와 같은 모양이다. */
  brand: PrintBrandSource
  /** 'YYYY-MM'. 이 달보다 뒤인 달은 미수 증감을 세지 않는다(화면 unpaidDelta 와 같은 경계). */
  todayMonth: string
  /** 출력일 문장. 화면 인쇄의 '출력일'과 같은 포맷터(fmtDateKor)로 라우트가 만든다. */
  printedOn: string
  /** Pretendard 가변 woff2 base64. @sparticuz 크로미움에는 한글 글꼴이 없다. */
  pretendardBase64: string
}

const escape = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** 0 은 '—'. 음수는 fmtWon 이 U+2212 를 붙이고 §26 대로 --p-tc 로 칠한다. */
function won(n: number): string {
  if (n === 0) return '—'
  return n < 0 ? `<span class="neg">${fmtWon(n)}</span>` : fmtWon(n)
}

/** 부호가 뜻인 값(운영이익·전년 대비). 양수에 + 를 붙이고 음수는 --p-tc 다. */
function signedWon(n: number): string {
  if (n === 0) return '—'
  return n > 0 ? `+${fmtWon(n)}` : `<span class="neg">${fmtWon(n)}</span>`
}

/**
 * 미수 증감 전용. 부호만 붙이고 색은 안 칠한다(§26.2 예외). 미수는 줄어드는 쪽이 좋은 소식이라
 * '음수 = --p-tc' 규칙을 그대로 쓰면 미수 감소가 경고색이 된다(화면 deltaBadge 는 증가 warning · 감소 success).
 * 종이는 먹1색이 원칙이라 화면의 초록·주황을 옮기지 않고 무채색으로 둔다.
 */
function plainSignedWon(n: number): string {
  if (n === 0) return '—'
  return n > 0 ? `+${fmtWon(n)}` : fmtWon(n)
}

const monthLabel = (month: string) => `${Number(month.slice(5))}월`

function fontFace(b64: string): string {
  return `@font-face{font-family:'Pretendard';font-weight:45 920;font-style:normal;font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2-variations');}`
}

export function buildReportPrintHtml(summary: AnnualSummary, opts: ReportPrintOptions): string {
  const prevYear = summary.prevYear
  const prevOf = (r: MonthlyRow) => prevYear?.rows.find(p => p.month.slice(5) === r.month.slice(5))

  // 미수 증감. ReportClient 의 unpaidDelta 와 같은 식(1월은 0 대비, 미래 월은 비움).
  const unpaidDelta = (i: number): number | null => {
    const r = summary.rows[i]
    if (r.month > opts.todayMonth) return null
    const prev = i > 0 ? summary.rows[i - 1].unpaidAmount : 0
    return r.unpaidAmount - prev
  }

  // 전년 수납액 칸. 증감을 붙이는 조건은 부른 쪽이 화면과 같은 식으로 정한다(null 이면 안 붙인다).
  const prevCell = (prevAmount: number, delta: number | null) => !prevYear ? ''
    : `<td class="num"><div>${won(prevAmount)}</div>${delta === null ? '' : `<div class="sub">${signedWon(delta)}</div>`}</td>`

  const monthRows = summary.rows.map((r, i) => {
    const p = prevOf(r)
    const d = unpaidDelta(i)
    return `<tr>
      <td>${monthLabel(r.month)}</td>
      <td class="num">${won(r.billedAmount)}</td>
      <td class="num">${won(r.revenue)}</td>
      ${prevCell(p?.revenue ?? 0, p && r.revenue > 0 ? r.revenue - p.revenue : null)}
      <td class="num">${won(r.extraIncome)}</td>
      <td class="num">${won(r.expense)}</td>
      <td class="num strong">${signedWon(r.profit)}</td>
      <td class="num">${d === null ? '—' : plainSignedWon(d)}</td>
      <td class="num">${r.unpaidAmount > 0 ? won(r.unpaidAmount) : '—'}</td>
    </tr>`
  }).join('')

  const totalRow = `<tr class="total">
      <td>합계</td>
      <td class="num">${won(summary.totalBilled)}</td>
      <td class="num">${won(summary.totalRevenue)}</td>
      ${prevYear ? prevCell(prevYear.totalRevenue, prevYear.totalRevenue > 0 ? summary.totalRevenue - prevYear.totalRevenue : null) : ''}
      <td class="num">${won(summary.totalExtraIncome)}</td>
      <td class="num">${won(summary.totalExpense)}</td>
      <td class="num">${signedWon(summary.totalProfit)}</td>
      <td class="num"></td>
      <td class="num">${won(summary.endingUnpaid)}</td>
    </tr>`

  // 분기별 합계. ReportClient 의 quarters 와 같은 묶음.
  const quarters = [1, 2, 3, 4].map(q => {
    const rows = summary.rows.filter(r => Math.ceil(Number(r.month.slice(5)) / 3) === q)
    return {
      q,
      revenue: rows.reduce((s, r) => s + r.revenue, 0),
      expense: rows.reduce((s, r) => s + r.expense, 0),
      profit: rows.reduce((s, r) => s + r.profit, 0),
    }
  })
  const quarterRows = quarters.map(q => `<tr>
      <td>${q.q}분기</td><td class="num">${won(q.revenue)}</td><td class="num">${won(q.expense)}</td><td class="num strong">${signedWon(q.profit)}</td>
    </tr>`).join('')

  const categoryBlock = summary.expenseByCategory.length === 0 ? '' : `<section class="block">
      <h2>카테고리별 지출 비중 <span class="h-note">${escape(summary.year)}년 연간 합계 기준</span></h2>
      <table class="grid">
        <thead><tr><th>카테고리</th><th class="num">지출</th><th class="num">비중</th></tr></thead>
        <tbody>${summary.expenseByCategory.map(c => `<tr>
          <td>${escape(c.category)}</td><td class="num">${won(c.amount)}</td><td class="num">${c.percent}%</td>
        </tr>`).join('')}</tbody>
      </table>
    </section>`

  const kv = (label: string, value: string) => `<div class="kv"><div class="k">${label}</div><div class="v">${value}</div></div>`

  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<title>결산 보고서 ${escape(summary.year)}년</title>
<style>
  ${opts.pretendardBase64 ? fontFace(opts.pretendardBase64) : ''}
  :root{
    --p-ink:${PRINT_HEX.ink}; --p-muted:${PRINT_HEX.inkMuted}; --p-tc:${PRINT_HEX.tc};
    --p-label-bg:${PRINT_HEX.labelBg}; --p-rule:${PRINT_HEX.rule}; --p-rule-strong:${PRINT_HEX.ruleStrong};
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body {
    background: #fff; color: var(--p-ink);
    font-family: 'Pretendard', sans-serif;
    word-break: keep-all;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .neg { color: var(--p-tc); }

  .num { font-variant-numeric: tabular-nums; }

  /* 머리띠 · 꼬리말 · 워드마크. 계약서와 같은 공용 조각이다(lib/printBrandHtml). */
${PRINT_BRAND_HEADER_CSS}
${PRINT_BRAND_FOOTER_CSS}
${PRINT_WORDMARK_CSS}
  .doc-footer { margin-top: 6mm; break-inside: avoid; }

  /* 제목 20pt/700 · 부제 9pt(§26). */
  .doc-title-row { display: flex; align-items: baseline; gap: 4mm; margin-bottom: 5mm; }
  .doc-title { font-size: 20pt; font-weight: 700; letter-spacing: -.02em; line-height: 1.2; }
  .doc-sub { font-size: 9pt; color: var(--p-muted); }

  /* 합계 네 칸. 키-값 행 문법(라벨 --p-label-bg, hairline). */
  .kvs { display: grid; grid-template-columns: repeat(4, 1fr); border: 0.4pt solid var(--p-rule); margin-bottom: 6mm; }
  .kv + .kv { border-left: 0.4pt solid var(--p-rule); }
  .kv .k { background: var(--p-label-bg); font-size: 10pt; font-weight: 500; padding: 2mm 4mm; }
  .kv .v { font-size: 12pt; font-weight: 700; padding: 2.5mm 4mm; text-align: right; font-variant-numeric: tabular-nums; }

  h2 { font-size: 12pt; font-weight: 600; margin-bottom: 2mm; break-after: avoid; }
  h2 .h-note { font-size: 8.5pt; font-weight: 400; color: var(--p-muted); margin-left: 2mm; }
  /* 월별 표는 장을 넘겨도 된다(행 단위로만 안 쪼갠다, 머리줄은 장마다 다시 선다). 작은 표 둘만 통째로 넘긴다. */
  .block { margin-bottom: 6mm; }
  .pair .block { break-inside: avoid; }
  table.grid thead { display: table-header-group; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8mm; }

  /* 표. 가로 hairline 위주, 금액 우측 정렬(tnum). */
  table.grid { width: 100%; border-collapse: collapse; font-size: 10.5pt; font-variant-numeric: tabular-nums; }
  table.grid th { background: var(--p-label-bg); font-size: 10pt; font-weight: 500; text-align: left; padding: 1.8mm 2.5mm; border-bottom: 0.6pt solid var(--p-rule-strong); white-space: nowrap; }
  table.grid td { padding: 1.2mm 2.5mm; border-bottom: 0.4pt solid var(--p-rule); vertical-align: top; }
  table.grid tr { break-inside: avoid; }
  table.grid .num { text-align: right; white-space: nowrap; }
  table.grid .strong { font-weight: 600; }
  table.grid .sub { font-size: 8.5pt; color: var(--p-muted); line-height: 1.25; }
  table.grid tr.total td { font-weight: 700; border-top: 0.6pt solid var(--p-rule-strong); border-bottom: none; }

  /* 산정 기준은 줄 단위로 장을 넘겨도 된다. 마지막 장이 주석 몇 줄만 남은 빈 장이 되지 않게 한다. */
  .notes { font-size: 8.5pt; color: var(--p-muted); line-height: 1.6; }
  .notes li { break-inside: avoid; }
  .notes h2 { font-size: 9pt; font-weight: 600; color: var(--p-ink); margin-bottom: 1mm; }
  .notes ul { padding-left: 4mm; }
</style>
</head>
<body>
    ${printBrandHeaderHtml(opts.brand, `대상 연도 <span class="num">${escape(summary.year)}년</span><br>
        출력일 ${escape(opts.printedOn)}`)}

  <div class="doc-title-row">
    <div class="doc-title">결산 보고서</div>
    <div class="doc-sub">귀속월 기준 연간 수납·지출·미수 현황</div>
  </div>

  <div class="kvs">
    ${kv('총 수납액', won(summary.totalRevenue))}
    ${kv('부가수익', won(summary.totalExtraIncome))}
    ${kv('총 지출', won(summary.totalExpense))}
    ${kv('운영이익', signedWon(summary.totalProfit))}
  </div>

  <section class="block">
    <h2>월별 현황</h2>
    <table class="grid">
      <thead><tr>
        <th>월</th><th class="num">청구액</th><th class="num">수납액</th>
        ${prevYear ? '<th class="num">전년 수납액 (증감)</th>' : ''}
        <th class="num">부가수익</th><th class="num">지출</th><th class="num">운영이익</th>
        <th class="num">미수 증감</th><th class="num">월말 미수 잔액</th>
      </tr></thead>
      <tbody>${monthRows}${totalRow}</tbody>
    </table>
  </section>

  <div class="pair">
    <section class="block">
      <h2>분기별 합계</h2>
      <table class="grid">
        <thead><tr><th>분기</th><th class="num">수납액</th><th class="num">지출</th><th class="num">운영이익</th></tr></thead>
        <tbody>${quarterRows}</tbody>
      </table>
    </section>
    ${categoryBlock}
  </div>

  <div class="notes">
    <h2>산정 기준</h2>
    <ul>${REPORT_BASIS_NOTES.map(n => `<li>${escape(n)}</li>`).join('')}</ul>
  </div>

  <div class="doc-footer">
    <div class="foot-biz">${printBrandFootBizHtml(opts.brand)}</div>
    ${PRINT_WORDMARK_HTML}
  </div>
</body>
</html>`
}
