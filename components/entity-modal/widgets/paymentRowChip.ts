// 수납 행 줄2 칩 모양 정본. 수납 내역(PaymentRecordList)의 월분 칩과 납입일 변경 조정 묶음(DueDayAdjustList)이 같은 글자를 쓴다
//
// 두 목록이 한 화면에 위아래로 서므로 칩 모양이 갈리면 바로 이질감이 된다(2026-10-21 운영자 요청 '통일감').
// 모양은 형제 칩(보증금·양도인·월분)과 같은 10.5px semibold r-sm 이다(가이드 §11). 색은 §04 트라이어드만 쓴다.

export const PAY_CHIP_CLS = 'text-[0.65625rem] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap'

export const PAY_CHIP_TONE = {
  /** 월분 칩 기본(지연·선납이 아닌 귀속월). */
  month: 'bg-[var(--cream-2)] text-[var(--warm-mid)]',
  success: 'bg-[var(--success-bg)] text-[var(--success-fg)]',
  neutral: 'bg-[var(--neutral-bg)] text-[var(--neutral-fg)]',
  warning: 'bg-[var(--warning-bg)] text-[var(--warning-fg)]',
  info: 'bg-[var(--info-bg)] text-[var(--info-fg)]',
} as const
