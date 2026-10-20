// 지출 일괄 편집 적용취소 토큰 모양 정본(순수). 허용 칸 목록·서명 본문·'쓴 직후' 검사. 서명·적용은 finance/actions 가 한다.
//
// 왜 (2026-10-20 재검수). 일괄 편집 적용취소는 화면이 돌려준 fields 를 그대로 updateMany 했다. 화면을 거친 값이라 아무 칸이나
// 실어 보낼 수 있었고(mass-assignment), 그사이 다른 사람이 고친 행도 옛 값으로 덮었다. '함께 적용'(같은 주문 형제 행)까지
// 이 토큰을 타게 되면서 범위가 넓어졌다. 그래서 허용 칸만 받고, 서버 서명(용도 라벨 domain)을 보고, 지금 칸이 전부
// 쓴 직후 값(after)일 때만 한 트랜잭션에서 되돌린다(하나라도 바뀌었으면 아무것도 안 고친다).

/** 일괄 편집이 쓰는 칸. 이 밖의 칸은 토큰에 있어도 무시가 아니라 거부한다. */
export const BATCH_UNDO_FIELDS = [
  'payMethod', 'financialAccountId', 'financeName', 'settleStatus',
  'date', 'targetMonth', 'category', 'detail', 'memo', 'vendor', 'vendorBizNo', 'channel',
] as const
export type BatchUndoField = typeof BATCH_UNDO_FIELDS[number]

/** 서명 용도 라벨(현금영수증·글자 칸 토큰과 다른 domain). */
export const BATCH_EXPENSES_UNDO_DOMAIN = 'expense-batch-update-v1'

export type BatchUndoValue = string | number | null
export type BatchExpensesUndo = {
  v: 1
  // fields = 쓰기 전 값(되돌릴 값), after = 쓴 직후 값(지금 이 값일 때만 되돌린다). 같은 칸 묶음이다.
  rows: { id: string; fields: Record<string, BatchUndoValue>; after: Record<string, BatchUndoValue> }[]
  sig?: string
}

/** DB 값을 토큰 값으로(날짜는 ISO 글자). 화면을 거쳐 돌아와도 같은 글자다. */
export function undoValue(v: unknown): BatchUndoValue {
  if (v instanceof Date) return v.toISOString()
  if (v === undefined || v === null) return null
  if (typeof v === 'string' || typeof v === 'number') return v
  return String(v)
}

/** 서명할 본문. 행·칸 순서를 고정한다. */
export function canonicalBatchExpensesUndo(u: Omit<BatchExpensesUndo, 'sig'>): string {
  const pick = (o: Record<string, BatchUndoValue>) => Object.keys(o).sort().map(k => [k, o[k]])
  return JSON.stringify({ v: u.v, rows: [...u.rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => [r.id, pick(r.fields), pick(r.after)]) })
}

/** 화면에서 돌아온 토큰의 모양 검사. 허용 밖 칸·fields 와 after 의 칸이 다르면 null. */
export function parseBatchExpensesUndo(raw: unknown): BatchExpensesUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || !Array.isArray(u.rows) || u.rows.length === 0 || u.rows.length > 2000) return null
  const okVal = (x: unknown) => x === null || typeof x === 'string' || typeof x === 'number'
  const rows: BatchExpensesUndo['rows'] = []
  const seen = new Set<string>()
  for (const r of u.rows as unknown[]) {
    if (!r || typeof r !== 'object') return null
    const { id, fields, after } = r as Record<string, unknown>
    if (typeof id !== 'string' || !id || seen.has(id)) return null
    seen.add(id)
    if (!fields || typeof fields !== 'object' || !after || typeof after !== 'object') return null
    const fk = Object.keys(fields).sort(), ak = Object.keys(after).sort()
    if (fk.length === 0 || fk.join() !== ak.join()) return null
    if (!fk.every(k => (BATCH_UNDO_FIELDS as readonly string[]).includes(k))) return null
    const f = fields as Record<string, unknown>, a = after as Record<string, unknown>
    if (!fk.every(k => okVal(f[k]) && okVal(a[k]))) return null
    rows.push({ id, fields: f as Record<string, BatchUndoValue>, after: a as Record<string, BatchUndoValue> })
  }
  if (u.sig !== undefined && typeof u.sig !== 'string') return null
  return { v: 1, rows, ...(typeof u.sig === 'string' ? { sig: u.sig } : {}) }
}

/**
 * 되돌릴 쓰기 목록. 지금 행이 하나라도 없거나 칸이 쓴 직후 값과 다르면 null(전부 아니면 안 함).
 * now 는 행 id 별 지금 칸 값(DB 그대로)이다.
 */
export function planBatchExpensesUndo(u: BatchExpensesUndo, now: Map<string, Record<string, unknown>>): { id: string; data: Record<string, BatchUndoValue> }[] | null {
  const out: { id: string; data: Record<string, BatchUndoValue> }[] = []
  for (const r of u.rows) {
    const cur = now.get(r.id)
    if (!cur) return null
    for (const k of Object.keys(r.after)) if (undoValue(cur[k]) !== r.after[k]) return null
    out.push({ id: r.id, data: r.fields })
  }
  return out
}
