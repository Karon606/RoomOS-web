// 전역 통합 검색 열기 신호(모듈 pub/sub, lib/saveStatus pushToast 패턴) + 최근 검색 기록(영업장별 격리)

let listener: (() => void) | null = null

/** 헤더 돋보기 버튼 등 어디서든 검색 오버레이를 연다. */
export function openGlobalSearch() { listener?.() }

/** GlobalSearchHost 전용 — 열기 신호 구독. */
export function bindGlobalSearch(cb: () => void): () => void {
  listener = cb
  return () => { if (listener === cb) listener = null }
}

// ── 최근 검색 기록 — 결과를 실제 클릭했을 때만 저장, 영업장별 키 격리 ──
const RECENT_MAX = 8
const recentKey = (propertyId: string) => `stayeum-search-recent:${propertyId}`

export function getRecentSearches(propertyId: string | null): string[] {
  if (!propertyId || typeof window === 'undefined') return []
  try {
    const v = JSON.parse(localStorage.getItem(recentKey(propertyId)) ?? '[]')
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string').slice(0, RECENT_MAX) : []
  } catch { return [] }
}

export function addRecentSearch(propertyId: string | null, q: string) {
  if (!propertyId || !q.trim()) return
  try {
    const cur = getRecentSearches(propertyId).filter(s => s !== q)
    localStorage.setItem(recentKey(propertyId), JSON.stringify([q, ...cur].slice(0, RECENT_MAX)))
  } catch { /* 저장 실패 무시 */ }
}

export function clearRecentSearches(propertyId: string | null) {
  if (!propertyId) return
  try { localStorage.removeItem(recentKey(propertyId)) } catch { /* 무시 */ }
}
