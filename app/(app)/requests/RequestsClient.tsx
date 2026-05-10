'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  resolveTenantRequest,
  deleteTenantRequest,
  type getAllRequestsForProperty,
} from '@/app/(app)/tenants/actions'
import { trackSave, pushToast } from '@/lib/saveStatus'

type Request = Awaited<ReturnType<typeof getAllRequestsForProperty>>[number]

const CATEGORIES = ['시설', '소음', '청결', '편의', '기타'] as const
type Category = (typeof CATEGORIES)[number]

const CATEGORY_COLORS: Record<string, { bg: string; fg: string; ring: string }> = {
  시설: { bg: 'bg-amber-50',  fg: 'text-amber-700',  ring: 'ring-amber-200'  },
  소음: { bg: 'bg-rose-50',   fg: 'text-rose-700',   ring: 'ring-rose-200'   },
  청결: { bg: 'bg-cyan-50',   fg: 'text-cyan-700',   ring: 'ring-cyan-200'   },
  편의: { bg: 'bg-violet-50', fg: 'text-violet-700', ring: 'ring-violet-200' },
  기타: { bg: 'bg-stone-50',  fg: 'text-stone-700',  ring: 'ring-stone-200'  },
}

const fmtDate = (d: Date | string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'

export default function RequestsClient({ initialRequests }: { initialRequests: Request[] }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [filterStatus,   setFilterStatus]   = useState<'all' | 'unresolved' | 'resolved'>('unresolved')
  const [filterCategory, setFilterCategory] = useState<'all' | Category>('all')
  const [filterUrgent,   setFilterUrgent]   = useState(false)
  const [search,         setSearch]         = useState('')

  const [resolvingId,   setResolvingId]   = useState<string | null>(null)
  const [resolvingMemo, setResolvingMemo] = useState('')

  const filtered = useMemo(() => initialRequests.filter(r => {
    if (filterStatus === 'unresolved' && r.resolvedAt) return false
    if (filterStatus === 'resolved'   && !r.resolvedAt) return false
    if (filterCategory !== 'all' && r.category !== filterCategory) return false
    if (filterUrgent && !r.isUrgent) return false
    if (search.trim()) {
      const q   = search.trim().toLowerCase()
      const hay = `${r.tenant?.name ?? ''} ${r.content} ${r.resolutionMemo ?? ''} ${r.category ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [initialRequests, filterStatus, filterCategory, filterUrgent, search])

  const unresolvedCount = initialRequests.filter(r => !r.resolvedAt).length
  const urgentCount     = initialRequests.filter(r => !r.resolvedAt && r.isUrgent).length

  const handleResolve = (id: string, memo: string) => {
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await resolveTenantRequest(id, memo)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '완료로 처리됨')
        setResolvingId(null)
        setResolvingMemo('')
        router.refresh()
      } finally { release() }
    })
  }

  const handleDelete = (id: string) => {
    if (!confirm('이 요청을 삭제하시겠습니까?\n복구할 수 없습니다.')) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteTenantRequest(id)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '삭제됨')
        router.refresh()
      } finally { release() }
    })
  }

  const filterBtn = (active: boolean, onClick: () => void, label: string, extraClass = '') => (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${extraClass} ${
        active
          ? 'bg-[var(--coral)] text-white'
          : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)] hover:text-[var(--warm-dark)]'
      }`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-4">
      {/* 헤더 */}
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">요청 · 컴플레인</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            전체 {initialRequests.length}건
            <span className="mx-1.5 text-[var(--warm-border)]">·</span>
            미처리 {unresolvedCount}건
            {urgentCount > 0 && (
              <>
                <span className="mx-1.5 text-[var(--warm-border)]">·</span>
                <span className="text-[var(--coral)] font-semibold">긴급 {urgentCount}건</span>
              </>
            )}
          </p>
        </div>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="입주자/내용 검색..."
          className="text-sm px-3 py-2 rounded-xl bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] min-w-[220px]"
        />
      </div>

      {/* 필터 바 */}
      <div className="flex flex-wrap gap-2">
        {filterBtn(filterStatus === 'unresolved', () => setFilterStatus('unresolved'), '미처리')}
        {filterBtn(filterStatus === 'all',        () => setFilterStatus('all'),        '전체')}
        {filterBtn(filterStatus === 'resolved',   () => setFilterStatus('resolved'),   '처리됨')}

        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />

        <button
          onClick={() => setFilterCategory('all')}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            filterCategory === 'all'
              ? 'bg-[var(--ink-2)] text-white'
              : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)]'
          }`}
        >
          전체 카테고리
        </button>
        {CATEGORIES.map(cat => {
          const c      = CATEGORY_COLORS[cat]
          const active = filterCategory === cat
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(active ? 'all' : cat)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ring-1 ${
                active
                  ? `${c.bg} ${c.fg} ${c.ring} ring-2`
                  : 'bg-[var(--cream)] text-[var(--warm-mid)] ring-[var(--warm-border)]'
              }`}
            >
              {cat}
            </button>
          )
        })}

        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />

        <button
          onClick={() => setFilterUrgent(v => !v)}
          className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${
            filterUrgent
              ? 'bg-[var(--coral)] text-white'
              : 'bg-[var(--cream)] text-[var(--warm-mid)] border border-[var(--warm-border)]'
          }`}
        >
          긴급만
        </button>
      </div>

      {/* 리스트 */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-2xl p-10 text-center text-sm text-[var(--warm-muted)]">
          조건에 맞는 요청이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(r => {
            const c        = r.category ? CATEGORY_COLORS[r.category] : null
            const roomNo   = r.tenant?.leaseTerms[0]?.room?.roomNo
            const resolved = !!r.resolvedAt
            return (
              <li
                key={r.id}
                className={`rounded-2xl p-4 border border-[var(--warm-border)] ${
                  resolved ? 'opacity-60 bg-[var(--canvas)]' : 'bg-[var(--cream)]'
                }`}
              >
                {/* 메타 행 */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {r.isUrgent && !resolved && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 ring-1 ring-red-200">
                      긴급
                    </span>
                  )}
                  {c && (
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ring-1 ${c.bg} ${c.fg} ${c.ring}`}>
                      {r.category}
                    </span>
                  )}
                  {resolved && (
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      완료
                    </span>
                  )}
                  <Link
                    href={`/tenants?tenantId=${r.tenantId}&tab=requests`}
                    className="text-xs font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)]"
                  >
                    {r.tenant?.name ?? '입실자 미상'}{roomNo && ` · ${roomNo}호`}
                  </Link>
                  <span className="text-[10px] text-[var(--warm-muted)]">요청 {fmtDate(r.requestDate)}</span>
                  {r.targetDate && !resolved && (
                    <span className="text-[10px] font-medium text-amber-600">목표 {fmtDate(r.targetDate)}</span>
                  )}
                  {resolved && (
                    <span className="text-[10px] text-emerald-600">완료 {fmtDate(r.resolvedAt)}</span>
                  )}
                </div>

                {/* 내용 */}
                <p className="text-sm text-[var(--warm-dark)] leading-snug whitespace-pre-wrap">{r.content}</p>

                {/* 처리 메모 */}
                {r.resolutionMemo && (
                  <p className="text-xs text-emerald-700 mt-2 pt-2 border-t border-emerald-200/40">
                    ↳ {r.resolutionMemo}
                  </p>
                )}

                {/* 액션 */}
                {!resolved ? (
                  resolvingId === r.id ? (
                    <div className="mt-3 space-y-2 rounded-lg p-2.5 bg-emerald-50/40 border border-emerald-200/50">
                      <textarea
                        value={resolvingMemo}
                        onChange={e => setResolvingMemo(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="어떻게 처리했는지 짧게 (선택)"
                        className="w-full text-xs rounded-md px-2 py-1.5 resize-none bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] outline-none"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setResolvingId(null); setResolvingMemo('') }}
                          disabled={pending}
                          className="flex-1 py-1.5 text-xs font-medium rounded-md bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)] disabled:opacity-50"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => handleResolve(r.id, resolvingMemo)}
                          disabled={pending}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-md bg-emerald-600 text-white disabled:opacity-50"
                        >
                          {pending ? '저장 중...' : '완료로 저장'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3">
                      <button
                        onClick={() => { setResolvingId(r.id); setResolvingMemo('') }}
                        disabled={pending}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100 disabled:opacity-50"
                      >
                        ✓ 완료로 처리
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={pending}
                        className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                      >
                        삭제
                      </button>
                    </div>
                  )
                ) : (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleDelete(r.id)}
                      disabled={pending}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-red-500 border border-red-200 hover:bg-red-50 disabled:opacity-50"
                    >
                      삭제
                    </button>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
