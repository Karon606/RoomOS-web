// 영업장 관리 메모(PropertyNote)의 입력 정리·검증과 화면·서버가 같이 쓰는 꼴·문장 정본
//
// 왜 한 파일인가(신고 d1e5fecc, 2026-11-02). 저장 버튼 위 이유 줄(화면)과 서버 거부가 같은 판정·같은 문장이어야 한다(가이드 §27.8 ⑤).
// 사본을 두면 화면은 통과시키는데 서버가 거부하는 날이 온다.
//
// 규칙.
//   · 제목은 꼭 적는다(앞뒤 공백을 걷고 60자까지). 목록에서 장마다 머리가 되는 줄이다.
//   · 본문은 비워도 된다(4000자까지). 줄바꿈은 그대로 두고 맨 앞뒤 공백만 걷는다. 화면은 잘라 보이지 않는다(truncate 금지).
//   · 분류는 한 개, 비우면 없음(20자까지). 화면은 §11 메타 칩으로만 그린다. 색으로 나누지 않는다.

export const NOTE_TITLE_MAX = 60
export const NOTE_BODY_MAX = 4000
export const NOTE_TAG_MAX = 20

/** 화면에 내려가는 한 장. updatedAt 은 ISO 문자열이다(수정·적용취소의 버전 비교 재료). */
export type PropertyNoteRow = {
  id: string
  title: string
  body: string
  tag: string | null
  sortOrder: number
  updatedAt: string
}

export type PropertyNoteInput = { title: string; body: string; tag: string | null }

export const NOTE_TITLE_REQUIRED = '제목을 적어 주세요.'
export const NOTE_TITLE_TOO_LONG = `제목은 ${NOTE_TITLE_MAX}자까지 적을 수 있습니다.`
export const NOTE_BODY_TOO_LONG = `본문은 ${NOTE_BODY_MAX.toLocaleString('ko-KR')}자까지 적을 수 있습니다.`
export const NOTE_TAG_TOO_LONG = `분류는 ${NOTE_TAG_MAX}자까지 적을 수 있습니다.`
/** 수정·삭제를 연 뒤 그사이 다른 곳에서 바뀌었을 때. */
export const NOTE_CHANGED = '그사이 다른 곳에서 바뀐 메모입니다. 창을 닫고 다시 열어 주세요.'
/** 적용취소 직전에 그사이 바뀌었을 때. */
export const NOTE_UNDO_CONFLICT = '그사이 메모가 바뀌어 적용취소할 수 없습니다.'
export const NOTE_NOT_FOUND = '메모를 찾을 수 없습니다.'

/** 입력 정리 + 검증. 화면의 저장 막힘 이유와 서버 거부가 이 한 함수를 본다. */
export function normalizeNoteInput(raw: { title?: unknown; body?: unknown; tag?: unknown }):
  { ok: true; value: PropertyNoteInput } | { ok: false; error: string } {
  const title = typeof raw.title === 'string' ? raw.title.trim() : ''
  const body = typeof raw.body === 'string' ? raw.body.trim() : ''
  const tagRaw = typeof raw.tag === 'string' ? raw.tag.trim() : ''
  if (!title) return { ok: false, error: NOTE_TITLE_REQUIRED }
  if (title.length > NOTE_TITLE_MAX) return { ok: false, error: NOTE_TITLE_TOO_LONG }
  if (body.length > NOTE_BODY_MAX) return { ok: false, error: NOTE_BODY_TOO_LONG }
  if (tagRaw.length > NOTE_TAG_MAX) return { ok: false, error: NOTE_TAG_TOO_LONG }
  return { ok: true, value: { title, body, tag: tagRaw || null } }
}

/** 정리한 두 입력이 같은가(수정 폼의 dirty·서버 무변경 판정). */
export function sameNoteInput(a: PropertyNoteInput, b: PropertyNoteInput): boolean {
  return a.title === b.title && a.body === b.body && a.tag === b.tag
}

/** 지금 쓰는 분류 목록(가나다순, 겹침 없음). 분류 칸 datalist 가 쓴다. */
export function noteTagOptions(rows: readonly { tag: string | null }[]): string[] {
  return [...new Set(rows.map(r => r.tag).filter((t): t is string => !!t))].sort((a, b) => a.localeCompare(b, 'ko'))
}

// ── 적용취소 토큰 ─────────────────────────────────────────────
// 서명하지 않는다. 쓰는 사람이 이미 편집 권한으로 아무 값이나 적을 수 있는 메모라 토큰 위조로 넘을 경계가 없다.
// 대신 모든 되돌림은 조건부 쓰기(CAS)다. 토큰이 기억한 버전(updatedAt·deletedAt) 그대로일 때만 쓰고, 아니면 거부한다.

/** 추가 적용취소. 만든 직후 그대로(updatedAt)인 그 한 장에 삭제 도장(소프트삭제)을 찍는다. */
export type NoteCreateUndo = { id: string; updatedAt: string }
/** 수정 적용취소. 저장 직후 그대로(afterUpdatedAt)일 때만 저장 직전 모습(before)으로. */
export type NoteEditUndo = { id: string; before: PropertyNoteInput; afterUpdatedAt: string }
/** 삭제 적용취소. 그 삭제 도장(deletedAt) 그대로일 때만 되살린다. */
export type NoteDeleteUndo = { id: string; deletedAt: string }
