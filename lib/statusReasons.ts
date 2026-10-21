// 상태 전환 사유 선택지 정본 — 입실 취소·퇴실 공용 (신고 ad517231, 운영자 오더 2026-08-03).
//
// 원래 입실 취소 사유만 lib/cancelReasons 에 있었다. 퇴실 사유를 받기로 하면서
// 같은 build/parse 를 한 벌 더 만들면 '기타 · <내용>' 규약이 두 곳에서 갈린다 — 이 저장소의 고질 결함이다.
// 목록만 둘이고 규약은 하나다.
//
// 저장 위치는 TenantStatusLog.reason 이다. 화면 표시는 고객 카드의 상태 이력 위젯.

// 목록은 영업장 설정에 있다(2026-10-22 운영자 승인). 입실 취소 사유는 Property.cancelReasons, 퇴실 사유는
// Property.checkoutReasons 이고 기본값은 lib/optionLists OPTION_LIST_DEFAULTS 한 벌이다(종전 상수에서 '기타'만 뺐다).
// '기타'는 목록에 없다. 고르는 자리 맨 끝에 늘 붙는 항목이고 저장 규약('기타 · <내용>')은 lib/reasonLists 가 쥔다.
// 목록 내력(운영자 지시 2026-07-27·2026-08-03, 'LH선정' 2026-08-15·08-31, 내보낸 퇴실 셋 2026-08-31)은 knowledge/domain-reasons 에 있다.

/** 이 전이에서 사유를 받는다면 그 목록 칸 이름, 안 받으면 null. 받는 곳과 고칠 수 있는 곳이 어긋나지 않게 한 곳에서 정한다. */
export function reasonFieldForStatus(toStatus: string): 'cancelReasons' | 'checkoutReasons' | null {
  if (toStatus === 'CANCELLED') return 'cancelReasons'
  if (toStatus === 'CHECKOUT_PENDING' || toStatus === 'CHECKED_OUT') return 'checkoutReasons'
  return null
}

/** 사유 목록 칸마다 그 사유가 남는 상태 이력의 toStatus. 이름 변경이 이 상태의 행만 따라간다(취소 사유와 퇴실 사유가 같은 칸에 산다). */
export const REASON_FIELD_STATUSES = {
  cancelReasons: ['CANCELLED'],
  checkoutReasons: ['CHECKOUT_PENDING', 'CHECKED_OUT'],
} as const

/**
 * 시스템이 상태 이력 사유 칸(TenantStatusLog.reason)에 스스로 적는 라벨 전수. 운영자가 고른 사유가 아니다.
 *
 * 종전에는 퇴실 사유 이어받기(lib/checkoutReason)가 '정본 목록에 있는가' 로 이 라벨을 걸렀다. 목록이 영업장마다
 * 달라지면 그 판정이 영업장마다 갈리므로, 거꾸로 '시스템 라벨이 아닌가' 로 본다. 그래서 라벨을 적는 자리는
 * 전부 이 상수를 쓴다(상태 이력 쓰기에 글자를 바로 적으면 scripts/test-reason-lists 가 붉게 선다). 사유 목록 이름으로도 못 쓴다.
 */
export const AUTO_CHECKOUT_SHORT_REASON = '단기 자동 전환'
export const AUTO_CHECKOUT_MONTH_REASON = '퇴실 한 달 전 자동 전환'
export const AUTO_CHECKOUT_UNDO_REASON = '자동 전환 되돌림'
export const SHORT_STAY_EXTEND_REASON = '단기 연장'
export const CHECKOUT_REVERT_REASON = '퇴실 적용취소'
/** 단기 연장·감액 적용취소 행의 라벨. */
export const shortStayUndoReason = (kind: 'extend' | 'decrease') => kind === 'decrease' ? '단기 감액 적용취소' : '단기 연장 적용취소'
export const SYSTEM_STATUS_REASONS: readonly string[] = [
  AUTO_CHECKOUT_SHORT_REASON, AUTO_CHECKOUT_MONTH_REASON, AUTO_CHECKOUT_UNDO_REASON, SHORT_STAY_EXTEND_REASON, CHECKOUT_REVERT_REASON,
  shortStayUndoReason('extend'), shortStayUndoReason('decrease'),
]
export function isSystemStatusReason(reason: string | null | undefined): boolean {
  return SYSTEM_STATUS_REASONS.includes((reason ?? '').trim())
}

/** 사유 입력 칸 라벨. 사유를 받지 않는 전이면 null —
 *  '단기 연장' 같은 시스템 라벨에 "퇴실 사유:" 를 붙이면 퇴실이 취소된 행에 퇴실 사유라고 적히게 된다. */
export function reasonLabel(toStatus: string): string | null {
  if (toStatus === 'CANCELLED') return '취소 사유'
  if (toStatus === 'CHECKOUT_PENDING' || toStatus === 'CHECKED_OUT') return '퇴실 사유'
  return null
}

/**
 * '...을' / '...를' — 받침이 있으면 '을'.
 *
 * 서류 이름이 '계약서'(받침 없음)·'보증금 영수증'(ㅇ)으로 갈려서 하나로 박으면 "계약서을"이
 * 그대로 입주자에게 나간다(디자이너 패스 2026-08-26). 메일 문안은 변수를 조사 앞에서 빼는
 * 방식으로 피했는데, 문자는 무엇을 보내는지 이름으로 말해야 해서 조사가 필요하다.
 */
export function withEulReul(word: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return `${word}를`   // 한글 음절이 아니면 '를'
  return (code - 0xAC00) % 28 === 0 ? `${word}를` : `${word}을`
}

/** 받침(종성)이 있는가 — 한글 음절이 아니면 '없음'으로 본다('3m'·'2EA' 같은 단위). */
function hasJongseong(word: string): boolean {
  const code = word.trim().slice(-1).charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return false
  return (code - 0xAC00) % 28 !== 0
}

/** '...는' / '...은' — 조사만. 값이 굵은 글씨 안에 들어 있어 조사만 따로 붙여야 할 때 쓴다.
 *  재고 수량 단위(qtyUnit)는 자유 입력이라 '개'·'장'·'롤'·'m'이 섞인다 — 손으로 박으면 '3장는'이 나간다. */
export const eunNeunOf = (word: string): string => (hasJongseong(word) ? '은' : '는')
/** '...가' / '...이' — 조사만. 같은 이유로 수량 뒤에 손으로 박으면 '3롤가'가 나간다. */
export const iGaOf = (word: string): string => (hasJongseong(word) ? '이' : '가')
/** 값 + '는/은' 한 덩이. */
export const withEunNeun = (word: string): string => `${word}${eunNeunOf(word)}`

/** '...으로' / '...로' — 받침이 없거나 ㄹ 받침이면 '로'.
 *  상태 라벨이 '퇴실'(ㄹ)·'문의'(받침 없음)·'거주중'(ㅇ)로 갈려서 붙여 쓰면 '퇴실으로'가 된다. */
export function withRo(word: string): string {
  const last = word.trim().slice(-1)
  const code = last.charCodeAt(0)
  if (code < 0xAC00 || code > 0xD7A3) return `${word}로`   // 한글 음절이 아니면 그대로
  const jong = (code - 0xAC00) % 28
  return jong === 0 || jong === 8 ? `${word}로` : `${word}으로`   // 8 = ㄹ
}
