// 결산 보고서 화면과 종이가 함께 읽는 정본. 산정 기준 문장과 연도 파서.
//
// 산정 기준 문장. 화면(ReportClient)과 종이(lib/reportPrintHtml)가 같은 줄을 읽는다. 두 벌로 두면
// 한쪽만 고쳐져 기준 설명이 갈린다. 숫자를 만드는 규칙은 app/(app)/report/actions.ts 의
// getAnnualReport 이고, 여기는 그 규칙을 사람에게 말하는 문장이다.
//
// 연도 파서. 화면(page.tsx)과 PDF 라우트가 같은 함수로 연도를 읽는다. 종전 화면은 '2026a' 를
// parseInt 로 2026 보고서를 그리면서 연도 문자열은 '2026a' 그대로 넘겨, 그 값으로 PDF 를 부르면
// 라우트가 거절했다.
// 순수 모듈이다(서버 전용 모듈을 들이지 않는다). 클라이언트 번들에 함께 실린다.

export const REPORT_BASIS_NOTES: readonly string[] = [
  '청구액. 그 달 발생한 이용료 청구액이며 할인, 일할계산, 예약 인상을 반영합니다.',
  '수납액. 받은 이용료를 해당 월 몫(귀속월)으로 배부하며 월 이용료를 상한으로 합니다. 보증금과 양도인 정산분은 제외합니다.',
  '미수 증감. 전월 대비 월말 미수 잔액의 변화입니다. 선납 초과분이나 예약, 취소 계약의 수취액이 있는 달에는 청구액에서 수납액을 뺀 값과 정확히 일치하지 않을 수 있습니다.',
  '월말 미수 잔액. 그 월말까지 받았어야 할 이용료 중 아직 회수되지 않은 채권 잔액입니다. 청구액은 할인과 일할계산을 반영합니다.',
  '운영이익. 세금, 감가상각비, 대출이자 반영 전 금액입니다.',
  '보증금. 돌려드릴 돈이므로 수익에 포함하지 않습니다. 취소된 계약의 수취액은 수납액에 포함하지 않으며 부가수익으로 등록해 관리합니다.',
]

/** 네 자리 연도만 받는다. 아니면 null. */
export function parseReportYear(raw: string | null | undefined): string | null {
  return raw && /^\d{4}$/.test(raw) ? raw : null
}

/**
 * 보고서를 그리고 종이로 뽑아도 되는 연도인가. 기록이 있는 연도(getAvailableYears, 화면 연도 선택과 같은 출처)와
 * 올해다. 올해는 기록이 아직 없어도 받는다(기본 화면의 연도라 그 종이가 막히면 안 된다).
 * 화면(page.tsx)과 PDF 라우트가 같은 판정을 쓴다. 갈리면 화면은 빈 과거 연도를 그리는데 종이는 400 이 난다.
 */
export function isReportYearAllowed(year: string, availableYears: readonly string[], thisYear: string): boolean {
  return year === thisYear || availableYears.includes(year)
}
