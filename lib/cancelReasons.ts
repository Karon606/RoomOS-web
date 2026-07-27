// 입실 취소 사유 선택지 정본 — 상태전환 미니폼(TenantStatusTransitions)과 수정 폼(TenantClient)이 공유.
// '기타'는 자유 입력을 붙여 '기타 · <내용>' 으로 저장한다(운영자 지시 2026-07-27).
export const CANCEL_REASONS = ['변심', '가격부담', '호실 사이즈', '다른 곳으로 결정', '연락 두절', '일정 변경', '기타'] as const

// 선택값 + 기타 자유 입력 → 저장할 사유 문자열('' = 기록 안 함)
export function buildCancelReason(selected: string, etcText: string): string {
  if (!selected) return ''
  if (selected !== '기타') return selected
  const t = etcText.trim()
  return t ? `기타 · ${t}` : '기타'
}
