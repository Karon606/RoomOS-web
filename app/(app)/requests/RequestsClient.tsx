'use client'

import { useState, useTransition, useMemo } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import {
  resolveTenantRequest,
  deleteTenantRequest,
  createTenantRequest,
  getActiveTenantsForRequests,
  type getAllRequestsForProperty,
} from '@/app/(app)/tenants/actions'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { DatePicker } from '@/components/ui/DatePicker'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'

type Request = Awaited<ReturnType<typeof getAllRequestsForProperty>>[number]
type ActiveTenant = Awaited<ReturnType<typeof getActiveTenantsForRequests>>[number]

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

export default function RequestsClient({
  initialRequests,
  activeTenants,
}: {
  initialRequests: Request[]
  activeTenants: ActiveTenant[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  const [filterStatus,   setFilterStatus]   = useState<'all' | 'unresolved' | 'resolved'>('unresolved')
  const [filterCategory, setFilterCategory] = useState<'all' | Category>('all')
  const [filterUrgent,   setFilterUrgent]   = useState(false)
  const [search,         setSearch]         = useState('')

  const [resolvingId,   setResolvingId]   = useState<string | null>(null)
  const [resolvingMemo, setResolvingMemo] = useState('')

  // 등록 폼 상태
  const [showAddForm,   setShowAddForm]   = useState(false)
  const [addSubject,    setAddSubject]    = useState<'common' | string>('common') // 'common' or tenantId
  const [addCommonPlace, setAddCommonPlace] = useState('')
  const [addContent,    setAddContent]    = useState('')
  const [addCategory,   setAddCategory]  = useState<string>('')
  const [addUrgent,     setAddUrgent]    = useState(false)
  const [addReqDate,    setAddReqDate]   = useState(kstYmdStr())
  const [addTargetDate, setAddTargetDate] = useState('')

  const filtered = useMemo(() => initialRequests.filter(r => {
    if (filterStatus === 'unresolved' && r.resolvedAt) return false
    if (filterStatus === 'resolved'   && !r.resolvedAt) return false
    if (filterCategory !== 'all' && r.category !== filterCategory) return false
    if (filterUrgent && !r.isUrgent) return false
    if (search.trim()) {
      const q   = search.trim().toLowerCase()
      const hay = `${r.tenant?.name ?? ''} ${r.commonPlace ?? ''} ${r.content} ${r.resolutionMemo ?? ''} ${r.category ?? ''}`.toLowerCase()
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

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 요청을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
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

  const handleAdd = () => {
    if (!addContent.trim()) { pushToast('error', '내용을 입력해주세요.'); return }
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await createTenantRequest({
          tenantId:    addSubject === 'common' ? null : addSubject,
          content:     addContent,
          requestDate: addReqDate,
          targetDate:  addTargetDate || null,
          category:    addCategory || null,
          isUrgent:    addUrgent,
          commonPlace: addSubject === 'common' ? (addCommonPlace || null) : null,
        })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '요청 등록됨')
        setShowAddForm(false)
        setAddSubject('common')
        setAddCommonPlace('')
        setAddContent('')
        setAddCategory('')
        setAddUrgent(false)
        setAddReqDate(kstYmdStr())
        setAddTargetDate('')
        router.refresh()
      } finally { release() }
    })
  }

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
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="입주자/내용 검색..."
            className="text-sm px-3 py-2 rounded-sm bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] outline-none focus:border-[var(--coral)] min-w-[180px]"
          />
          <button
            onClick={() => setShowAddForm(v => !v)}
            className={`px-4 py-2 text-sm font-semibold rounded-xl transition-colors ${
              showAddForm
                ? 'bg-[var(--warm-border)] text-[var(--warm-mid)]'
                : 'bg-[var(--coral)] text-white hover:opacity-90'
            }`}
          >
            {showAddForm ? '취소' : '+ 요청 등록'}
          </button>
        </div>
      </div>

      {/* 등록 폼 */}
      {showAddForm && (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-[var(--warm-dark)]">새 요청 등록</p>

          {/* 대상 선택 */}
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">대상</label>
            <select
              value={addSubject}
              onChange={e => setAddSubject(e.target.value)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
            >
              <option value="common">공용 (특정 입주자 없음)</option>
              {activeTenants.map(t => {
                const roomNo = t.leaseTerms[0]?.room?.roomNo
                return (
                  <option key={t.id} value={t.id}>
                    {t.name}{roomNo ? ` · ${roomNo}호` : ''}
                  </option>
                )
              })}
            </select>
          </div>

          {/* 공용 선택 시 위치 입력 */}
          {addSubject === 'common' && (
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">위치 / 장소 (선택)</label>
              <input
                type="text"
                value={addCommonPlace}
                onChange={e => setAddCommonPlace(e.target.value)}
                placeholder="예: 공용 주방, 1층 화장실, 엘리베이터 등"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-400 outline-none focus:border-[var(--coral)]"
              />
            </div>
          )}

          {/* 카테고리 + 긴급 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">카테고리</label>
              <select
                value={addCategory}
                onChange={e => setAddCategory(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
              >
                <option value="">카테고리 없음</option>
                {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">요청일</label>
              <DatePicker value={addReqDate} onChange={setAddReqDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
          </div>

          {/* 목표일 + 긴급 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">목표 처리일 (선택)</label>
              <DatePicker value={addTargetDate} onChange={setAddTargetDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addUrgent}
                  onChange={e => setAddUrgent(e.target.checked)}
                  className="w-4 h-4 accent-[var(--coral)]"
                />
                <span className="text-xs text-[var(--warm-mid)]">긴급</span>
              </label>
            </div>
          </div>

          {/* 내용 */}
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">내용</label>
            <textarea
              value={addContent}
              onChange={e => setAddContent(e.target.value)}
              rows={3}
              placeholder="요청 내용을 입력하세요"
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-400 outline-none focus:border-[var(--coral)] resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Btn
              variant="secondary"
              size="sm"
              className="flex-1"
              onClick={() => setShowAddForm(false)}
            >
              취소
            </Btn>
            <Btn
              variant="primary"
              size="sm"
              className="flex-1 font-semibold"
              onClick={handleAdd}
              disabled={pending || !addContent.trim()}
            >
              {pending ? '저장 중...' : '저장'}
            </Btn>
          </div>
        </div>
      )}

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          ariaLabel="처리 상태"
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: 'unresolved', label: '미처리' },
            { value: 'all',        label: '전체' },
            { value: 'resolved',   label: '처리됨' },
          ]}
        />

        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />

        <span className="text-xs font-medium text-[var(--warm-muted)]">카테고리</span>
        <button
          onClick={() => setFilterCategory('all')}
          className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
            filterCategory === 'all'
              ? 'bg-[var(--ink-2)] text-white'
              : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)]'
          }`}
        >
          전체
        </button>
        {CATEGORIES.map(cat => {
          const c      = CATEGORY_COLORS[cat]
          const active = filterCategory === cat
          return (
            <button
              key={cat}
              onClick={() => setFilterCategory(active ? 'all' : cat)}
              className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
                active
                  ? `${c.bg} ${c.fg} ring-1 ${c.ring}`
                  : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)]'
              }`}
            >
              {cat}
            </button>
          )
        })}

        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />

        <button
          onClick={() => setFilterUrgent(v => !v)}
          className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-colors ${
            filterUrgent
              ? 'bg-[var(--coral)] text-white'
              : 'text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)]'
          }`}
        >
          긴급만
        </button>
      </div>

      {/* 리스트 */}
      {filtered.length === 0 ? (
        <div className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-10 text-center text-sm text-[var(--warm-muted)]">
          조건에 맞는 요청이 없습니다.
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map(r => {
            const c        = r.category ? CATEGORY_COLORS[r.category] : null
            const roomNo   = r.tenant?.leaseTerms[0]?.room?.roomNo
            const resolved = !!r.resolvedAt
            const isCommon = !r.tenantId
            return (
              <li
                key={r.id}
                className={`rounded-xl p-4 border border-[var(--warm-border)] ${
                  resolved ? 'opacity-60 bg-[var(--canvas)]' : 'bg-[var(--cream)]'
                }`}
              >
                {/* 메타 행 */}
                <div className="flex items-center gap-2 flex-wrap mb-2">
                  {r.isUrgent && !resolved && (
                    <span className="text-[0.625rem] px-2 py-0.5 rounded-full font-semibold bg-red-50 text-red-600 ring-1 ring-red-200">
                      긴급
                    </span>
                  )}
                  {c && (
                    <span className={`text-[0.625rem] px-2 py-0.5 rounded-full font-medium ring-1 ${c.bg} ${c.fg} ${c.ring}`}>
                      {r.category}
                    </span>
                  )}
                  {resolved && (
                    <span className="text-[0.625rem] px-2 py-0.5 rounded-full font-medium bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200">
                      완료
                    </span>
                  )}
                  {isCommon ? (
                    <span className="text-xs font-semibold text-[var(--warm-dark)]">
                      공용{r.commonPlace ? ` · ${r.commonPlace}` : ''}
                    </span>
                  ) : (
                    <Link
                      href={`/tenants?tenantId=${r.tenantId}&tab=requests`}
                      className="text-xs font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)]"
                    >
                      {r.tenant?.name ?? '입주자 미상'}{roomNo && ` · ${roomNo}호`}
                    </Link>
                  )}
                  <span className="text-[0.625rem] text-[var(--warm-muted)]">요청 {fmtDate(r.requestDate)}</span>
                  {r.targetDate && !resolved && (
                    <span className="text-[0.625rem] font-medium text-amber-600">목표 {fmtDate(r.targetDate)}</span>
                  )}
                  {resolved && (
                    <span className="text-[0.625rem] text-emerald-600">완료 {fmtDate(r.resolvedAt)}</span>
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
