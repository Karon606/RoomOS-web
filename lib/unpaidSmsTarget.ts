// 미납 독촉 문자 대상 판정 정본(순수 함수) — 서버 getTenantUnpaidTarget 과 홈 미수납 위젯이 함께 쓴다.
//
// 납부일이 1일 이상 지난 미납만 독촉 대상이다. 유예 중(daysOverdue 음수)·납부일 전·오늘 도래·
// 경과일 미상(null)은 대상이 아니다. 2026-08-02 405호 사건(유예해 준 사람에게 독촉 문구)의 클래스를
// 막는 규칙이라, 이 판정을 자리마다 다시 쓰지 않는다(감지망 scripts/check-unpaid-sms-gate.mjs).
export function isUnpaidSmsTarget(l: { unpaidAmount: number; daysOverdue: number | null }): boolean {
  return l.unpaidAmount > 0 && (l.daysOverdue ?? -1) >= 1
}
