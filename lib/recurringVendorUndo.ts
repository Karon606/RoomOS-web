// 고정지출 기록 모달 '이 항목의 기본 구매처로 저장'의 적용취소 토큰 모양 정본(순수). 서명·적용은 finance/actions 가 한다.
//
// 왜 (2026-10-27 운영자 승인, 신고 5fa9cf43 결정 C). 기록 모달에서 적은 구매처를 항목의 기본값으로도 저장하면
// 그 항목의 다음 기록이 모두 이 값으로 열린다. 잘못 체크했을 때 되돌릴 길이 있어야 한다(§16).
// 토큰은 항목 id 와 그때의 전후 값을 쥐고, 되돌림은 지금 항목 구매처가 '쓴 직후' 값 그대로일 때만 한다(그사이 바뀌었으면 안 한다).
// 토큰은 화면을 거쳐 돌아오므로 서버가 서명(signUndoBody, 용도 라벨 RECURRING_TEMPLATE_VENDOR_UNDO_DOMAIN)으로 위조를 막고, 여기 parse 가 모양을 다시 본다.

/** 서명 용도 라벨. 다른 토큰의 서명으로는 이 토큰을 못 쓴다. */
export const RECURRING_TEMPLATE_VENDOR_UNDO_DOMAIN = 'recurring-template-vendor-v1'

export type RecurringVendorUndo = {
  v: 1
  recurringExpenseId: string
  before: string | null
  after: string | null
  sig?: string
}

/** 서명할 본문. 키 순서를 고정해 같은 내용이면 같은 글자다. */
export function canonicalRecurringVendorUndo(u: Omit<RecurringVendorUndo, 'sig'>): string {
  return JSON.stringify({ v: 1, recurringExpenseId: u.recurringExpenseId, before: u.before, after: u.after })
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'

/** 화면에서 돌아온 토큰의 모양 검사. 어긋나면 null(아무것도 안 고친다). */
export function parseRecurringVendorUndo(raw: unknown): RecurringVendorUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || typeof u.recurringExpenseId !== 'string' || !UUID.test(u.recurringExpenseId)) return null
  if (!isStrOrNull(u.before) || !isStrOrNull(u.after) || u.before === u.after) return null
  return {
    v: 1, recurringExpenseId: u.recurringExpenseId, before: u.before, after: u.after,
    ...(typeof u.sig === 'string' ? { sig: u.sig } : {}),
  }
}
