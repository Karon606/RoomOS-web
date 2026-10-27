// 작업 이력 한 건 수정(작업·청소·점검·작업에 걸린 지출 한 줄)의 적용취소 토큰 모양 정본(순수). 서명·적용은 room-manage 액션이 한다.
//
// 왜 (2026-10-27 운영자 지적·승인 계획 2단계). 한 건 수정 Modal 의 저장 토스트 [적용취소] 는 "저장 직전 모습 전체" 로 돌아가야 한다.
// 값으로 되돌리면 그사이 다른 화면이 바꾼 값까지 덮는다. 그래서 **쓰기 전·쓴 직후** 를 칸마다 쥐고, 지금이 '쓴 직후' 그대로일 때만
// 전부 되돌린다(전부 아니면 안 함, lib/expenseFieldUndo 와 같은 문법). 함께 고친 지출 한 줄도 같은 토큰에 싣는다.
// 수정이 지출을 새로 만들었으면(비용 0 에서 금액을 적은 완료 건) 그 지출의 쓰기 전은 null 이고, 되돌림은 그 지출을 지운다.
// 토큰은 화면을 거쳐 돌아오므로 서버가 서명(signUndoBody, 용도 라벨 ROOM_RECORD_EDIT_UNDO_DOMAIN)으로 위조를 막고 여기 parse 가 모양을 다시 본다.

export const ROOM_RECORD_EDIT_UNDO_DOMAIN = 'room-record-edit-v1'

/** 기록 한 건의 칸 스냅샷. 값은 글자·수·참거짓·null 뿐이다(날짜는 'YYYY-MM-DD'). 종류마다 칸이 다르다. */
export type RecordSnap = Record<string, string | number | boolean | null>

/** 함께 고친 지출 한 줄의 칸 스냅샷. id 와 아래 칸들. */
// updatedAt 은 되돌림 전 '쓴 직후' 대조와 조건부 쓰기에만 쓴다(되돌릴 때 쓰는 칸이 아니다, 독립 검수 권고 3).
export const EXPENSE_SNAP_FIELDS = ['date', 'amount', 'vendor', 'detail', 'itemLabel', 'payMethod', 'financialAccountId', 'financeName', 'settleStatus', 'updatedAt'] as const
export type ExpenseSnapField = typeof EXPENSE_SNAP_FIELDS[number]
export type ExpenseSnap = { id: string } & { [K in ExpenseSnapField]: string | number | null }

export type RoomRecordEditKind = 'work' | 'cleaning' | 'inspection' | 'work-expense'
export const ROOM_RECORD_EDIT_KINDS: readonly RoomRecordEditKind[] = ['work', 'cleaning', 'inspection', 'work-expense']

/** 종류마다 기록 스냅샷에 실리는 칸. 이 밖의 칸이 실려 오면 위조로 본다. 지출 한 줄 수정(work-expense)은 기록 칸이 없다. */
export const RECORD_SNAP_FIELDS: Record<RoomRecordEditKind, readonly string[]> = {
  work: ['kind', 'scheduledDate', 'doneDate', 'performer', 'performerName', 'memo', 'estimateAmount'],
  cleaning: ['reason', 'scheduledDate', 'doneDate', 'performer', 'performerName', 'memo', 'expenseId', 'fromCleaningFund', 'leaseTermId'],
  inspection: ['scheduledDate', 'memo'],
  'work-expense': [],
}

export type RoomRecordEditUndo = {
  v: 1
  kind: RoomRecordEditKind
  /** 기록 id(작업·청소·점검). 지출 한 줄 수정이면 그 지출이 걸린 작업 id. */
  id: string
  before: RecordSnap
  after: RecordSnap
  /** 함께 고친 지출. before 가 null 이면 이 수정이 만든 지출이다(되돌림은 지운다). */
  expense?: { before: ExpenseSnap | null; after: ExpenseSnap }
  sig?: string
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const isScalar = (v: unknown): v is string | number | boolean | null => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

/** 키 순서를 고정한 글자. 같은 내용이면 같은 글자다(서명 본문). */
function sortedSnap(s: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.keys(s).sort().map(k => [k, s[k]]))
}
export function canonicalRoomRecordEditUndo(u: Omit<RoomRecordEditUndo, 'sig'>): string {
  return JSON.stringify({
    v: 1, kind: u.kind, id: u.id,
    before: sortedSnap(u.before), after: sortedSnap(u.after),
    ...(u.expense ? { expense: { before: u.expense.before ? sortedSnap(u.expense.before) : null, after: sortedSnap(u.expense.after) } } : {}),
  })
}

function parseSnap(raw: unknown, fields: readonly string[]): RecordSnap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  const keys = Object.keys(o)
  if (keys.length !== fields.length || !keys.every(k => fields.includes(k))) return null
  const out: RecordSnap = {}
  for (const k of fields) { if (!isScalar(o[k])) return null; out[k] = o[k] as RecordSnap[string] }
  return out
}
function parseExpenseSnap(raw: unknown): ExpenseSnap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const o = raw as Record<string, unknown>
  if (typeof o.id !== 'string' || !UUID.test(o.id)) return null
  const rest = parseSnap(Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'id')), EXPENSE_SNAP_FIELDS)
  if (!rest) return null
  return { id: o.id, ...rest } as ExpenseSnap
}

/** 화면에서 돌아온 토큰의 모양 검사. 어긋나면 null(아무것도 안 고친다). */
export function parseRoomRecordEditUndo(raw: unknown): RoomRecordEditUndo | null {
  if (!raw || typeof raw !== 'object') return null
  const u = raw as Record<string, unknown>
  if (u.v !== 1 || typeof u.kind !== 'string' || !(ROOM_RECORD_EDIT_KINDS as readonly string[]).includes(u.kind)) return null
  if (typeof u.id !== 'string' || !UUID.test(u.id)) return null
  const kind = u.kind as RoomRecordEditKind
  const before = parseSnap(u.before, RECORD_SNAP_FIELDS[kind])
  const after = parseSnap(u.after, RECORD_SNAP_FIELDS[kind])
  if (!before || !after) return null
  let expense: RoomRecordEditUndo['expense']
  if (u.expense !== undefined) {
    if (!u.expense || typeof u.expense !== 'object') return null
    const e = u.expense as Record<string, unknown>
    const eAfter = parseExpenseSnap(e.after)
    const eBefore = e.before === null ? null : parseExpenseSnap(e.before)
    if (!eAfter || (e.before !== null && !eBefore) || (eBefore && eBefore.id !== eAfter.id)) return null
    expense = { before: eBefore, after: eAfter }
  }
  // 지출 한 줄 수정은 지출이 꼭 실린다. 그 밖은 바뀐 것이 하나는 있어야 한다.
  if (kind === 'work-expense' && !expense) return null
  return { v: 1, kind, id: u.id, before, after, ...(expense ? { expense } : {}), ...(typeof u.sig === 'string' ? { sig: u.sig } : {}) }
}

/** 지금 칸들이 스냅샷과 칸마다 같은가(되돌림 전 '쓴 직후' 대조). */
export function snapMatches(now: Record<string, unknown>, snap: Record<string, unknown>): boolean {
  return Object.keys(snap).every(k => (now[k] ?? null) === (snap[k] ?? null))
}

/** 화면에 갈 말. */
export const ROOM_RECORD_EDIT_UNDO_INVALID = '적용취소 정보가 올바르지 않습니다. 새로고침 후 다시 확인해 주세요.'
export const ROOM_RECORD_EDIT_UNDO_CONFLICT = '그사이 이 기록이나 걸린 지출이 다시 바뀌어 되돌리지 않았습니다. 지금 모습을 확인해 주세요.'
/** 수정 폼을 연 뒤 다른 곳에서 그 기록이 바뀌었을 때(조건부 쓰기). */
export const ROOM_RECORD_STALE = '창을 연 뒤 다른 곳에서 이 기록이 바뀌었습니다. 창을 닫고 다시 열어 주세요.'
