// 지출 글자 칸(쇼핑몰·구매처·사업자번호) 일괄 변경의 적용취소 토큰 모양 정본(순수). 서명·적용은 finance/actions 가 한다.
//
// 왜 (2026-10-19 운영자 승인, 신고 a0636f36 허점 막기). 구매처 이름 변경·합치기·비우기, 사업자번호 소급, 쇼핑몰 지정은
// 여러 지출을 한 번에 고치는데 되돌릴 길이 없었다(재무 패널). 값으로 되돌리면 원래부터 새 값이던 행까지 옛 값이 된다.
// 그래서 **그때 바뀐 행 id 와 칸별 전후 값**을 쥔다. 되돌림은 지금 그 칸이 '쓴 직후' 값 그대로일 때만 한다(전부 아니면 안 함).
// 토큰은 화면을 거쳐 돌아오므로 서버가 서명(signUndoBody, 용도 라벨 domain)으로 위조를 막고, 여기 parse 가 모양을 다시 본다.

export const EXPENSE_FIELD_UNDO_FIELDS = ['channel', 'vendor', 'vendorBizNo'] as const
export type ExpenseFieldUndoField = typeof EXPENSE_FIELD_UNDO_FIELDS[number]

/** 용도 라벨. 서명 domain 이 라벨마다 달라 한 용도의 토큰을 다른 용도로 못 쓴다. */
export const EXPENSE_FIELD_UNDO_KINDS = {
  'channel-order': 'expense-channel-order-v1',      // 수정 폼 '주문 전체에 적용'
  'bizno-backfill': 'expense-bizno-backfill-v1',    // 사업자번호 소급
  'vendor-rename': 'expense-vendor-rename-v1',      // 구매처 이름 변경·합치기·비우기
  'vendor-to-channel': 'expense-vendor-to-channel-v1', // 구매처를 쇼핑몰로 옮기기
  'vendor-set-channel': 'expense-vendor-set-channel-v1', // 이 구매처 지출 전부에 쇼핑몰 지정(같은 주문 함께 적용 포함)
  'recurring-vendor-backfill': 'expense-recurring-vendor-backfill-v1', // 고정지출 기본 구매처를 그 항목의 과거 빈 구매처에 채우기(신고 5fa9cf43)
} as const
export type ExpenseFieldUndoKind = keyof typeof EXPENSE_FIELD_UNDO_KINDS

export type ExpenseFieldChange = { field: ExpenseFieldUndoField; before: string | null; after: string | null }
/** 고정지출 항목(RecurringExpense) 구매처 한 칸의 전후. 구매처 이름 변경·합치기·비우기가 항목까지 따라갈 때만 실린다(신고 5fa9cf43 결정 F). */
export type RecurringVendorChange = { id: string; before: string | null; after: string | null }
export type ExpenseFieldUndo = {
  v: 1
  kind: ExpenseFieldUndoKind
  rows: { id: string; changes: ExpenseFieldChange[] }[]
  /** 함께 바뀐 고정지출 항목 구매처. 없으면 키 자체가 없다(옛 토큰과 서명 본문이 같다). */
  recurring?: RecurringVendorChange[]
  sig?: string
}

/** 서명할 본문. 키 순서·행 순서를 고정해 같은 내용이면 같은 글자다. */
export function canonicalExpenseFieldUndo(u: Omit<ExpenseFieldUndo, 'sig'>): string {
  const rows = [...u.rows]
    .map(r => ({ id: r.id, changes: [...r.changes].sort((a, b) => a.field.localeCompare(b.field)).map(c => ({ field: c.field, before: c.before, after: c.after })) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  // 항목 줄은 있을 때만 본문에 넣는다. 그래야 항목을 안 건드린 토큰의 서명 본문이 종전과 한 글자도 같다.
  const recurring = (u.recurring ?? []).map(r => ({ id: r.id, before: r.before, after: r.after })).sort((a, b) => a.id.localeCompare(b.id))
  return JSON.stringify(recurring.length > 0 ? { v: 1, kind: u.kind, rows, recurring } : { v: 1, kind: u.kind, rows })
}

const isStrOrNull = (v: unknown): v is string | null => v === null || typeof v === 'string'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 화면에서 돌아온 토큰의 모양 검사. 어긋나면 null(아무것도 안 고친다). */
export function parseExpenseFieldUndo(raw: unknown): ExpenseFieldUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || typeof u.kind !== 'string' || !Object.hasOwn(EXPENSE_FIELD_UNDO_KINDS, u.kind) || !Array.isArray(u.rows)) return null
  // 항목 줄은 구매처 이름 변경(vendor-rename)에만 실린다. 다른 용도에 실려 오면 위조로 본다.
  let recurring: RecurringVendorChange[] | undefined
  if (u.recurring !== undefined) {
    if (u.kind !== 'vendor-rename' || !Array.isArray(u.recurring) || u.recurring.length === 0 || u.recurring.length > 500) return null
    recurring = []
    const seenRec = new Set<string>()
    for (const r of u.recurring as unknown[]) {
      if (!r || typeof r !== 'object') return null
      const rr = r as Record<string, unknown>
      if (typeof rr.id !== 'string' || !UUID.test(rr.id) || seenRec.has(rr.id) || !isStrOrNull(rr.before) || !isStrOrNull(rr.after) || rr.before === rr.after) return null
      seenRec.add(rr.id)
      recurring.push({ id: rr.id, before: rr.before, after: rr.after })
    }
  }
  if ((u.rows.length === 0 && !recurring) || u.rows.length > 5000) return null
  const rows: ExpenseFieldUndo['rows'] = []
  const seen = new Set<string>()
  for (const r of u.rows as unknown[]) {
    if (!r || typeof r !== 'object') return null
    const rr = r as Record<string, unknown>
    if (typeof rr.id !== 'string' || !UUID.test(rr.id) || seen.has(rr.id) || !Array.isArray(rr.changes) || rr.changes.length === 0) return null
    seen.add(rr.id)
    const changes: ExpenseFieldChange[] = []
    const fields = new Set<string>()
    for (const c of rr.changes as unknown[]) {
      if (!c || typeof c !== 'object') return null
      const cc = c as Record<string, unknown>
      if (typeof cc.field !== 'string' || !(EXPENSE_FIELD_UNDO_FIELDS as readonly string[]).includes(cc.field) || fields.has(cc.field)) return null
      if (!isStrOrNull(cc.before) || !isStrOrNull(cc.after) || cc.before === cc.after) return null
      fields.add(cc.field)
      changes.push({ field: cc.field as ExpenseFieldUndoField, before: cc.before, after: cc.after })
    }
    rows.push({ id: rr.id, changes })
  }
  return { v: 1, kind: u.kind as ExpenseFieldUndoKind, rows, ...(recurring ? { recurring } : {}), ...(typeof u.sig === 'string' ? { sig: u.sig } : {}) }
}

/**
 * 되돌림 계획. 지금 행 값(now)이 토큰의 '쓴 직후'와 칸마다 같아야 한다. 하나라도 다르거나 행이 없으면 null(전부 안 함).
 * 같으면 행마다 되돌릴 칸과 값.
 */
export function planExpenseFieldUndo(
  undo: ExpenseFieldUndo,
  now: ReadonlyMap<string, Record<ExpenseFieldUndoField, string | null>>,
): { id: string; data: Partial<Record<ExpenseFieldUndoField, string | null>> }[] | null {
  const out: { id: string; data: Partial<Record<ExpenseFieldUndoField, string | null>> }[] = []
  for (const r of undo.rows) {
    const cur = now.get(r.id)
    if (!cur) return null
    const data: Partial<Record<ExpenseFieldUndoField, string | null>> = {}
    for (const c of r.changes) {
      if ((cur[c.field] ?? null) !== c.after) return null
      data[c.field] = c.before
    }
    out.push({ id: r.id, data })
  }
  return out
}

/**
 * 항목 줄의 되돌림 계획. 지금 항목 구매처(now)가 토큰의 '쓴 직후'와 모두 같아야 한다. 하나라도 다르거나 항목이 없으면 null(전부 안 함).
 * 항목 줄이 없는 토큰은 빈 계획([])이다.
 */
export function planRecurringVendorUndo(
  undo: ExpenseFieldUndo,
  now: ReadonlyMap<string, string | null>,
): { id: string; vendor: string | null }[] | null {
  const out: { id: string; vendor: string | null }[] = []
  for (const r of undo.recurring ?? []) {
    if (!now.has(r.id) || (now.get(r.id) ?? null) !== r.after) return null
    out.push({ id: r.id, vendor: r.before })
  }
  return out
}
