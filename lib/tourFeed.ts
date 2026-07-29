// 구독 캘린더 투어 이벤트 표시 판정 — 피드 라우트와 검증 스크립트가 같은 함수를 쓴다(신고 ba74b5cd).
// 규칙: 투어 날짜가 있으면 상태 불문 표시("누가 언제 왔다"의 기록, 운영자 정의 2026-07-28). 예외는 둘뿐 —
// ① 투어 전 취소(WAITING_TOUR발 CANCELLED): 하려다 안 한 투어라 제외
// ② 취소 고객의 아직 안 온 투어: 안 올 예정이라 제외. 당일은 온 것으로 취급(엄격 부등호).
// 포함 목록(날짜 갈래 OR)이 아니라 제외 목록 — 갈래 경계 구멍 클래스가 없다(송호준 당일 전환 신고의 봉합).
export function shouldShowTourEvent(p: {
  status: string
  tourYmd: string                 // 투어일 'YYYY-MM-DD'
  lastCancelFrom: string | null   // 최근 CANCELLED 전이의 fromStatus (전이 로그 없으면 null)
  todayYmd: string                // KST 오늘 'YYYY-MM-DD'
}): boolean {
  if (p.status !== 'CANCELLED') return true
  if (p.lastCancelFrom === 'WAITING_TOUR') return false
  return p.tourYmd <= p.todayYmd
}
