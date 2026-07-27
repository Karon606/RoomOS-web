// 즉석 입력 카테고리의 정규화·목록 병합 순수함수 — 요청·컴플레인과 지출 저장 흐름이 공유.

/** 입력값 정규화 — 콤마 제거(저장 구분자) + 연속 공백 1칸 축약 + 앞뒤 공백 제거. */
export function normalizeCategoryInput(raw: string | null | undefined): string {
  return (raw ?? '').replace(/,/g, '').replace(/\s+/g, ' ').trim()
}

/** 대소문자·공백 무시 비교로 기존 목록과 대조 — 일치하면 기존 정본 값, 없으면 null. */
export function matchExistingCategory(list: string[], name: string): string | null {
  const key = name.replace(/\s+/g, '').toLowerCase()
  return list.find(c => c.replace(/\s+/g, '').toLowerCase() === key) ?? null
}

/**
 * 저장 시 쓸 카테고리 값과 갱신할 목록을 계산한다.
 * value  = 실제 저장할 값(기존과 일치하면 기존 정본 값, 빈 값이면 null).
 * nextList = 설정에 새로 써야 할 목록(추가가 없으면 null).
 */
export function resolveCategoryForSave(
  list: string[],
  raw: string | null | undefined,
): { value: string | null; nextList: string[] | null } {
  const name = normalizeCategoryInput(raw)
  if (!name) return { value: null, nextList: null }
  const existing = matchExistingCategory(list, name)
  if (existing) return { value: existing, nextList: null }
  return { value: name, nextList: [...list, name] }
}
