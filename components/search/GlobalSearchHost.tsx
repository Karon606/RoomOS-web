'use client'
// 전역 통합 검색 오버레이 — 헤더 돋보기·Cmd+K로 열리고, 결과를 유형별 그룹으로 표시.
// 자동 라우팅 없음: 모호 질의('415')는 호실·입주자 그룹이 나란히 떠서 해소. 입주자·호실은 정본 Prism 모달로 착지.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { bindGlobalSearch, getRecentSearches, addRecentSearch, clearRecentSearches } from '@/lib/globalSearch'
import { normalizeSearchQuery } from '@/lib/searchQuery'
import { globalSearch, type GlobalSearchResult, type SearchHit, type SearchGroupType } from '@/app/(app)/search/actions'
import { useNavRouter } from '@/lib/useNavRouter'

// 그룹 아이콘 — 하단 네비(BottomNav)와 동일 모티프 재사용(익숙한 형태로 유형 식별)
const GROUP_ICON: Record<SearchGroupType, ReactNode> = {
  room:    (<><path d="M5 21V5.5a1.5 1.5 0 0 1 1.5-1.5h11A1.5 1.5 0 0 1 19 5.5V21" /><path d="M3.5 21h17" /><circle cx="15.3" cy="12.5" r="1" /></>),
  tenant:  (<><circle cx="12" cy="8" r="3.5" /><path d="M5.5 20a6.5 6.5 0 0 1 13 0" /></>),
  expense: (<><path d="M7 3.5 4 6.5l3 3" /><path d="M4 6.5h10.5A5.5 5.5 0 0 1 20 12" /><path d="M17 20.5l3-3-3-3" /><path d="M20 17.5H9.5A5.5 5.5 0 0 1 4 12" /></>),
  item:    (<><rect x="3.5" y="9.5" width="8" height="7.5" rx="1.2" /><rect x="12.5" y="9.5" width="8" height="7.5" rx="1.2" /><rect x="8" y="3.5" width="8" height="6" rx="1.2" /></>),
  request: (<><rect x="4" y="4" width="16" height="12" rx="3" /><path d="M9 16v3.5L12.5 16" /></>),
  doc:     (<><path d="M7 3.5h7l4 4V20a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1z" /><path d="M14 3.5V8h4.5" /><path d="M9.5 13h5M9.5 16.5h5" /></>),
}
const BADGE_STYLE: Record<string, { bg: string; fg: string }> = {
  success: { bg: 'var(--success-bg)', fg: 'var(--success-fg)' },
  warning: { bg: 'var(--warning-bg)', fg: 'var(--warning-fg)' },
  danger:  { bg: 'var(--danger-bg)',  fg: 'var(--danger-fg)' },
  info:    { bg: 'var(--info-bg)',    fg: 'var(--info-fg)' },
  neutral: { bg: 'var(--cream-2)',    fg: 'var(--warm-mid)' },
}

// 응답 캐시 — 영업장 키 격리, 최근 20개
const cache = new Map<string, GlobalSearchResult>()

export function GlobalSearchHost({ propertyId }: { propertyId: string | null }) {
  const router = useNavRouter()   // 이동에 진행바 동반(F페이즈)
  const entityModal = useEntityModal()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [result, setResult] = useState<GlobalSearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [recents, setRecents] = useState<string[]>([])
  const seq = useRef(0)
  const inputWrapRef = useRef<HTMLDivElement>(null)

  const openSearch = useCallback(() => {
    setOpen(true)
    setRecents(getRecentSearches(propertyId))
  }, [propertyId])

  // 열기 신호 구독 + 단축키(Cmd/Ctrl+K, 입력 중 아닌 /)
  useEffect(() => bindGlobalSearch(openSearch), [openSearch])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null
      const typing = !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch() }
      else if (e.key === '/' && !typing && !open) { e.preventDefault(); openSearch() }
      else if (e.key === 'Escape' && open) setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, openSearch])

  // 열림 동안 배경 스크롤 잠금 + 인풋 포커스
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const input = inputWrapRef.current?.querySelector('input')
    input?.focus()
    return () => { document.body.style.overflow = prev }
  }, [open])

  // 영업장 전환 시 상태·캐시 격리 초기화
  useEffect(() => { setQ(''); setResult(null); cache.clear() }, [propertyId])

  // 디바운스 300ms + 시퀀스 카운터(늦은 응답 폐기) + 캐시
  useEffect(() => {
    if (!open) return
    const norm = normalizeSearchQuery(q)
    if (!norm.valid) { setResult(null); setLoading(false); return }
    const key = `${propertyId}:${norm.q}`
    const cached = cache.get(key)
    if (cached) { setResult(cached); setLoading(false); return }
    const mySeq = ++seq.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await globalSearch(norm.q)
        if (seq.current !== mySeq) return
        cache.set(key, res)
        if (cache.size > 20) { const first = cache.keys().next().value; if (first) cache.delete(first) }
        setResult(res)
      } catch { if (seq.current === mySeq) setResult({ queryKind: norm.kind, groups: [] }) }
      finally { if (seq.current === mySeq) setLoading(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [q, open, propertyId])

  const close = useCallback(() => { setOpen(false) }, [])

  const onPick = useCallback((hit: SearchHit) => {
    addRecentSearch(propertyId, q.trim())
    close()
    if (hit.action.type === 'modal') {
      entityModal.open(hit.action.kind === 'tenant'
        ? { kind: 'tenant', tenantId: hit.action.tenantId }
        : { kind: 'room', roomId: hit.action.roomId })
    } else {
      router.push(hit.action.href)
    }
  }, [propertyId, q, close, entityModal, router])

  const onMore = useCallback((href: string) => {
    addRecentSearch(propertyId, q.trim())
    close()
    router.push(href)
  }, [propertyId, q, close, router])

  if (!open) return null

  const norm = normalizeSearchQuery(q)
  const showEmptyGuide = !norm.valid
  const showNoResult = norm.valid && !loading && result !== null && result.groups.length === 0
  const blurInput = () => inputWrapRef.current?.querySelector('input')?.blur()

  return (
    <div className="fixed inset-0 z-[var(--z-modal)]">
      {/* 배경 — 모바일은 풀스크린 캔버스, md 이상은 딤 배경 + 중앙 패널 */}
      <div className="absolute inset-0 md:bg-black/70 bg-[var(--canvas)]" onClick={close} aria-hidden="true" />
      <div
        className="relative flex flex-col h-full md:h-auto md:max-w-lg md:mx-auto md:mt-[10vh] md:rounded-2xl md:shadow-lift overflow-hidden"
        style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}
        role="dialog" aria-modal="true" aria-label="통합 검색"
      >
        {/* 상단 검색 바 */}
        <div className="flex items-center gap-2 px-3 shrink-0"
          style={{ paddingTop: 'calc(0.625rem + env(safe-area-inset-top))', paddingBottom: '0.625rem', borderBottom: '1px solid var(--warm-border)', background: 'var(--cream)' }}>
          <div ref={inputWrapRef} className="flex-1"
            onKeyDown={e => {
              if (e.key === 'Enter') {
                if ((e.nativeEvent as KeyboardEvent).isComposing) return   // 한글 조합 확정 Enter 무시
                blurInput()   // 모바일 키보드 내림 — 결과는 디바운스 조회가 담당
              }
            }}>
            <SearchBar value={q} onChange={setQ} placeholder="이름·전화번호·방번호·품목 검색" />
          </div>
          <button type="button" onClick={close}
            className="shrink-0 min-h-[44px] px-2 text-sm font-medium text-[var(--warm-mid)] hover:text-[var(--warm-dark)] transition-colors">
            취소
          </button>
        </div>

        {/* 재검색 진행 바 — 기존 결과 유지(§17 갱신 정본) */}
        <div className="h-0.5 shrink-0 overflow-hidden">
          {loading && result && <div className="h-full w-1/3 rounded-full animate-pulse" style={{ background: 'var(--tc)' }} />}
        </div>

        {/* 결과 영역 */}
        <div className="flex-1 md:max-h-[60vh] overflow-y-auto overscroll-contain" onTouchMove={blurInput}
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
          {showEmptyGuide && (
            <div className="p-4 space-y-3">
              <p className="text-[0.65625rem] text-[var(--warm-muted)]">이름, 전화번호, 방번호, 품목으로 검색합니다.</p>
              {recents.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-[0.6875rem] font-semibold uppercase tracking-wide text-[var(--warm-muted)]">최근 검색</p>
                    <button type="button" onClick={() => { clearRecentSearches(propertyId); setRecents([]) }}
                      className="text-[0.65625rem] text-[var(--warm-muted)] hover:text-[var(--warm-dark)]">지우기</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {recents.map(r => (
                      <button key={r} type="button" onClick={() => setQ(r)}
                        className="px-2.5 py-1.5 text-xs rounded-full border transition-colors min-h-[32px]"
                        style={{ background: 'var(--cream)', borderColor: 'var(--warm-border)', color: 'var(--warm-dark)' }}>
                        {r}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {norm.valid && loading && !result && (
            <div className="p-4 space-y-2">
              {[0, 1, 2].map(i => (
                <div key={i} className="h-11 rounded-xl animate-pulse" style={{ background: 'var(--cream-2)' }} />
              ))}
            </div>
          )}

          {showNoResult && (
            <div className="p-4">
              <EmptyState title="검색 결과가 없습니다" description={`'${norm.q}'에 해당하는 입주자·호실·지출·재고가 없습니다.`} />
            </div>
          )}

          {norm.valid && result && result.groups.map(g => (
            <div key={g.type} className="pt-3">
              <div className="flex items-center gap-1.5 px-4 pb-1.5">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"
                  strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ color: 'var(--warm-muted)' }}>
                  {GROUP_ICON[g.type]}
                </svg>
                <span className="text-[0.6875rem] font-semibold uppercase tracking-wide" style={{ color: 'var(--warm-muted)' }}>{g.label}</span>
              </div>
              <ul>
                {g.hits.map(h => (
                  <li key={h.id}>
                    <button type="button" onClick={() => onPick(h)}
                      className="w-full min-h-[44px] px-4 py-2 flex items-center gap-2 text-left transition-colors hover:bg-[var(--cream)] active:bg-[var(--cream-2)]">
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold truncate tnum" style={{ color: 'var(--warm-dark)' }}>{h.title}</span>
                        {h.caption && <span className="block text-xs truncate mt-0.5" style={{ color: 'var(--warm-muted)' }}>{h.caption}</span>}
                      </span>
                      {h.right && <span className="shrink-0 text-xs tnum" style={{ color: 'var(--warm-mid)' }}>{h.right}</span>}
                      {h.badge && (
                        <span className="shrink-0 text-[0.65625rem] font-semibold rounded-full px-2 py-0.5"
                          style={{ background: BADGE_STYLE[h.badge.tone].bg, color: BADGE_STYLE[h.badge.tone].fg }}>
                          {h.badge.label}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {g.hasMore && (
                <button type="button" onClick={() => onMore(g.moreHref)}
                  className="w-full px-4 py-2 text-left text-[0.78125rem] transition-colors hover:bg-[var(--cream)]"
                  style={{ color: 'var(--coral)' }}>
                  {g.label}에서 더 보기 ›
                </button>
              )}
            </div>
          ))}
        </div>

        {/* 스코프 고지 */}
        <div className="shrink-0 px-4 py-2" style={{ borderTop: '1px solid var(--warm-border)', background: 'var(--cream)' }}>
          <p className="text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>검색은 현재 영업장의 전체 기간 기준입니다.</p>
        </div>
      </div>
    </div>
  )
}
