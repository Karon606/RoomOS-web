// 상태 전환 사유 선택지 정본 — 입실 취소·퇴실 공용 (신고 ad517231, 운영자 오더 2026-08-03).
//
// 원래 입실 취소 사유만 lib/cancelReasons 에 있었다. 퇴실 사유를 받기로 하면서
// 같은 build/parse 를 한 벌 더 만들면 '기타 · <내용>' 규약이 두 곳에서 갈린다 — 이 저장소의 고질 결함이다.
// 목록만 둘이고 규약은 하나다.
//
// 저장 위치는 TenantStatusLog.reason 이다. 화면 표시는 고객 카드의 상태 이력 위젯.

/** 입실 취소 사유 (운영자 지시 2026-07-27) */
export const CANCEL_REASONS = ['변심', '가격부담', '호실 사이즈', '다른 곳으로 결정', '연락 두절', '일정 변경', '기타'] as const

/** 퇴실 사유 (운영자 오더 2026-08-03). 목록은 여기 한 줄만 고치면 두 입력 경로에 함께 반영된다.
 *  'LH당첨' — 공공임대 당첨으로 나가는 퇴실이 잦다는 운영자 신고(a5bfbcea, 2026-08-15).
 *  '더 넓은 곳으로' 옆에 두는 것은 둘 다 '집이 생겨 나간다'는 같은 갈래라서다. */
export const CHECKOUT_REASONS = ['계약 만료', '직장·학교 이동', '더 넓은 곳으로', 'LH당첨', '가격 부담', '시설·환경 불만', '개인 사정', '무단 퇴실', '기타'] as const

/** 선택값 + '기타' 자유 입력 -> 저장할 사유 문자열('' = 기록 안 함) */
export function buildReason(selected: string, etcText: string): string {
  if (!selected) return ''
  if (selected !== '기타') return selected
  const t = etcText.trim()
  return t ? `기타 · ${t}` : '기타'
}

/** 저장된 문자열 -> 폼 상태 복원. 수정 화면이 저장값을 다시 select 로 되돌리려면 짝이 필요하다. */
export function parseReason(stored: string | null | undefined): { selected: string; etcText: string } {
  const v = (stored ?? '').trim()
  if (!v) return { selected: '', etcText: '' }
  if (v === '기타') return { selected: '기타', etcText: '' }
  if (v.startsWith('기타 · ')) return { selected: '기타', etcText: v.slice('기타 · '.length) }
  return { selected: v, etcText: '' }
}

/** 이 전이에서 사유를 받을 것인가. 받는 곳과 고칠 수 있는 곳이 어긋나지 않게 한 곳에서 정한다. */
export function reasonsForStatus(toStatus: string): readonly string[] | null {
  if (toStatus === 'CANCELLED') return CANCEL_REASONS
  if (toStatus === 'CHECKOUT_PENDING' || toStatus === 'CHECKED_OUT') return CHECKOUT_REASONS
  return null
}

/** 사유 입력 칸 라벨. 사유를 받지 않는 전이면 null —
 *  '단기 연장' 같은 시스템 라벨에 "퇴실 사유:" 를 붙이면 퇴실이 취소된 행에 퇴실 사유라고 적히게 된다. */
export function reasonLabel(toStatus: string): string | null {
  if (toStatus === 'CANCELLED') return '취소 사유'
  if (toStatus === 'CHECKOUT_PENDING' || toStatus === 'CHECKED_OUT') return '퇴실 사유'
  return null
}

/** '...으로' / '...로' — 받침이 없거나 ㄹ 받침이면 '로'.
 *  상태 라벨이 '퇴실'(ㄹ)·'문의'(받침 없음)·'거주중'(ㅇ)로 갈려서 붙여 쓰면 '퇴실으로'가 된다. */
export function withRo(word: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return `${word}로`   // 한글 음절이 아니면 그대로
  const jong = (code - 0xAC00) % 28
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`   // 8 = ㄹ
}
