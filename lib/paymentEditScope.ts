// 수납 기록을 어느 화면에서 고칠 수 있는가 — 판정 정본.
//
// 규칙 둘.
//   · **귀속월 화면에서는 언제나** 고칠 수 있다. 편집 접점을 그 record 의 귀속월 하나로 묶는
//     것이 원칙이다 — 창을 넓혔다고 편집까지 넓히면 지난달 매출이 어디서든 바뀐다.
//   · **미래 귀속은 어느 화면에서든** 고칠 수 있다(운영자 확정 2026-08-27).
//
// 왜 미래만 예외인가. 선납은 이 사업의 원칙이라("입실료는 매월 선납") 9월 귀속 건이 8월에
// 계속 생긴다. 종전에는 그 건을 고칠 길이 **아예 없었다** — 버튼은 9월 화면에만 서는데
// 재무 화면은 미래 월로 못 간다(MonthSelector allowFuture=false). 두 잠금이 맞물려 막다른
// 길이 됐고, 운영자가 잘못 넣은 406호 건을 지울 수 없었다(실기 2026-08-27).
//
// 미래 귀속은 마감된 적도, 신고에 실린 적도, 과거 어느 합계에 들어간 적도 없다. 위 원칙이
// 지키려는 것('지난달 매출')이 성립하지 않으므로 예외가 원칙을 무르지 않는다.
//
// 미래 월 화면을 여는 쪽(allowFuture)이 아니라 이쪽인 이유는 접점이 작아서다. 그쪽은
// "재무 화면에 미래 월은 무의미"라는 판단을 뒤집고 청구·미납 표시가 미래 월에서 어떻게
// 보일지를 통째로 다시 봐야 한다.

/**
 * @param recordMonth 그 기록의 귀속월 'YYYY-MM'
 * @param viewMonth   지금 보고 있는 조회월 'YYYY-MM'
 * @param thisMonth   KST 이번 달 'YYYY-MM' (호출부가 kstMonthStr 로 넘긴다 — 서버·기기 시차로
 *                    같은 줄이 한쪽에선 고쳐지고 한쪽에선 안 고쳐지는 것을 막는다)
 */
export function canEditPaymentHere(recordMonth: string, viewMonth: string, thisMonth: string): boolean {
  return recordMonth === viewMonth || recordMonth > thisMonth
}
