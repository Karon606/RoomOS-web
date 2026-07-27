'use client'

import { useState, useTransition, useMemo } from 'react'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  resolveTenantRequest,
  unresolveTenantRequest,
  deleteTenantRequest,
  restoreTenantRequest,
  createTenantRequest,
  updateTenantRequest,
  getActiveTenantsForRequests,
  type getAllRequestsForProperty,
} from '@/app/(app)/tenants/actions'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { DatePicker } from '@/components/ui/DatePicker'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { SearchBar } from '@/components/ui/SearchBar'
import { EmptyState } from '@/components/ui/EmptyState'
import { kstYmdStr } from '@/lib/kstDate'
import MonthSelector from '@/components/layout/MonthSelector'

type Request = Awaited<ReturnType<typeof getAllRequestsForProperty>>[number]
type ActiveTenant = Awaited<ReturnType<typeof getActiveTenantsForRequests>>[number]

// 기본 5종만 고정색 — 운영자가 추가한 이름이나 목록에서 지워진 값은 아래 NEUTRAL_COLOR(기타와 동일 톤).
const CATEGORY_COLORS: Record<string, { bg: string; fg: string; ring: string }> = {
  시설: { bg: 'bg-[var(--warning-bg)]',  fg: 'text-[var(--warning-fg)]',  ring: 'ring-[var(--warning-ring)]'  },
  소음: { bg: 'bg-[var(--danger-bg)]',   fg: 'text-[var(--danger-fg)]',   ring: 'ring-[var(--danger-ring)]'   },
  청결: { bg: 'bg-[var(--reserve-bg)]',   fg: 'text-[var(--reserve-fg)]',   ring: 'ring-[var(--reserve-ring)]'   },
  편의: { bg: 'bg-[var(--deposit-bg)]', fg: 'text-[var(--deposit-fg)]', ring: 'ring-[var(--deposit-ring)]' },
  기타: { bg: 'bg-[var(--neutral-bg)]',  fg: 'text-[var(--neutral-fg)]',  ring: 'ring-[var(--neutral-ring)]'  },
}

const NEUTRAL_COLOR = CATEGORY_COLORS['기타']


// 타임스탬프의 KST 월(YYYY-MM) — 월 경계는 한국시간 기준.
function kstMonthOf(d: Date | string): string {
  const t = new Date(new Date(d).getTime() + 9 * 3600000)
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`
}

export default function RequestsClient({
  initialRequests,
  activeTenants,
  targetMonth,
  categories,
}: {
  initialRequests: Request[]
  activeTenants: ActiveTenant[]
  targetMonth: string
  /** 설정 > 요청 카테고리 관리의 저장 순서 목록 */
  categories: string[]
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  // 목록에서 지워졌지만 데이터에는 남은 값(고아) — 표시·필터·집계에서 빠지면 그 요청이 조용히 증발한다.
  const orphanCategories = useMemo(() => {
    const seen: string[] = []
    for (const r of initialRequests) {
      if (r.category && !categories.includes(r.category) && !seen.includes(r.category)) seen.push(r.category)
    }
    return seen
  }, [initialRequests, categories])

  const [filterStatus,   setFilterStatus]   = useState<'all' | 'unresolved' | 'resolved'>('unresolved')
  // 'uncategorized' = 카테고리 미지정(null/빈값) 요청 — '기타'·고아 값은 명시 저장값만 담는다.
  const [filterCategory, setFilterCategory] = useState<string>('all')
  const [filterUrgent,   setFilterUrgent]   = useState(false)
  const searchParams = useSearchParams()
  // 전역 통합 검색 ?q= 딥링크 시딩
  const [search,         setSearch]         = useState(() => searchParams.get('q') ?? '')

  const [resolvingId,   setResolvingId]   = useState<string | null>(null)
  const [resolvingMemo, setResolvingMemo] = useState('')
  const [busyId,        setBusyId]        = useState<string | null>(null)   // 행별 처리 중 (전역 잠금 방지)

  // 등록 폼 상태 — editingId 가 있으면 같은 폼이 수정 모드로 동작한다.
  const [showAddForm,   setShowAddForm]   = useState(false)
  const [editingId,     setEditingId]     = useState<string | null>(null)
  const [addDirty,      setAddDirty]      = useState(false)   // v2.0 §12 — 등록 폼 입력 보호
  const [addSubject,    setAddSubject]    = useState<'common' | string>('common') // 'common' or tenantId
  const [addCommonPlace, setAddCommonPlace] = useState('')
  const [addContent,    setAddContent]    = useState('')
  const [addCategory,   setAddCategory]  = useState<string>('')
  const [addUrgent,     setAddUrgent]    = useState(false)
  const [addReqDate,    setAddReqDate]   = useState(kstYmdStr())
  const [addTargetDate, setAddTargetDate] = useState('')

  // 상태·월 스코프까지만 적용한 모집단 — 카테고리 칩 건수의 기준(카테고리 필터 적용 전).
  const scoped = useMemo(() => initialRequests.filter(r => {
    // 월 스코프: 처리됨(resolved)은 그 달에 해결된 것만. 미처리(open)는 월 무관 항상 노출(활성 큐 — 놓치지 않게).
    if (r.resolvedAt && kstMonthOf(r.resolvedAt) !== targetMonth) return false
    if (filterStatus === 'unresolved' && r.resolvedAt) return false
    if (filterStatus === 'resolved'   && !r.resolvedAt) return false
    return true
  }), [initialRequests, filterStatus, targetMonth])

  const filtered = useMemo(() => scoped.filter(r => {
    if (filterCategory === 'uncategorized') { if (r.category) return false }
    else if (filterCategory !== 'all' && r.category !== filterCategory) return false
    if (filterUrgent && !r.isUrgent) return false
    if (search.trim()) {
      const q   = search.trim().toLowerCase()
      const hay = `${r.tenant?.name ?? ''} ${r.commonPlace ?? ''} ${r.content} ${r.resolutionMemo ?? ''} ${r.category ?? ''}`.toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  }), [scoped, filterCategory, filterUrgent, search])

  // 카테고리 칩 건수 — 0건도 숨기지 않고 그대로 노출(전체 = 각 칩의 합).
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = { uncategorized: 0 }
    for (const c of categories) counts[c] = 0
    for (const c of orphanCategories) counts[c] = 0
    for (const r of scoped) {
      if (!r.category) counts.uncategorized += 1
      else if (counts[r.category] !== undefined) counts[r.category] += 1
    }
    return counts
  }, [scoped, categories, orphanCategories])

  // 등록·수정 폼의 select 목록 — 목록에서 지워진 값이 달린 요청을 수정으로 열면 그 값도 붙인다(안 그러면 저장 시 유실).
  const formCategoryOptions = useMemo(() => (
    addCategory && !categories.includes(addCategory) ? [...categories, addCategory] : categories
  ), [categories, addCategory])

  const unresolvedCount = initialRequests.filter(r => !r.resolvedAt).length
  const urgentCount     = initialRequests.filter(r => !r.resolvedAt && r.isUrgent).length
  // 처리됨은 그 달에 해결된 것만(월 스코프) — 세그먼트 건수도 동일 기준
  const resolvedCount   = initialRequests.filter(r => r.resolvedAt && kstMonthOf(r.resolvedAt) === targetMonth).length

  // 빈 상태에서 되돌릴 수 있는 필터(카테고리·긴급만·검색어) — 상태 세그먼트는 기본 큐라 초기화 대상이 아니다.
  const hasResettableFilter = filterCategory !== 'all' || filterUrgent || !!search.trim()
  const activeFilterSummary = [
    filterStatus === 'unresolved' ? '미처리' : filterStatus === 'resolved' ? '처리됨' : null,
    filterCategory === 'all' ? null : filterCategory === 'uncategorized' ? '미분류' : filterCategory,
    filterUrgent ? '긴급만' : null,
    search.trim() ? `검색 "${search.trim()}"` : null,
  ].filter(Boolean).join(' · ')

  const resetFilters = () => { setFilterCategory('all'); setFilterUrgent(false); setSearch('') }

  const handleResolve = (id: string, memo: string) => {
    setBusyId(id)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await resolveTenantRequest(id, memo)
        if (!res.ok) { pushToast('error', res.error); return }
        // 적용취소(기존 unresolve 재사용) + 과거 월 조회 중이면 증발 안내
        const opts: { action: { label: string; run: () => void }; detail?: string } = {
          action: { label: '적용취소', run: () => unresolveTenantRequest(id).then(r => { if (!r.ok) { pushToast('error', r.error); return } router.refresh() }) },
        }
        if (targetMonth !== kstMonthOf(new Date())) opts.detail = '처리됨은 이번 달에서 볼 수 있어요.'
        pushToast('success', '완료로 처리했습니다', opts)
        setResolvingId(null)
        setResolvingMemo('')
        router.refresh()
      } finally { release(); setBusyId(null) }
    })
  }

  const handleUnresolve = (id: string) => {
    setBusyId(id)
    startTransition(async () => {
      try {
        const res = await unresolveTenantRequest(id)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('info', '완료를 해제했습니다 (미완료로 복귀)')
        router.refresh()
      } finally { setBusyId(null) }
    })
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 요청을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    setBusyId(id)
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deleteTenantRequest(id)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '삭제됨', {
          action: { label: '적용취소', run: () => { void restoreTenantRequest(id).then(r => { if (r.ok) router.refresh(); else pushToast('error', r.error) }) } },
        })
        router.refresh()
      } finally { release(); setBusyId(null) }
    })
  }

  const resetForm = () => {
    setEditingId(null)
    setAddDirty(false)
    setAddSubject('common')
    setAddCommonPlace('')
    setAddContent('')
    setAddCategory('')
    setAddUrgent(false)
    setAddReqDate(kstYmdStr())
    setAddTargetDate('')
  }

  // 수정 진입 — 같은 모달에 기존 값을 프리필한다.
  const openEdit = (r: Request) => {
    setEditingId(r.id)
    setAddDirty(false)
    setAddSubject(r.tenantId ?? 'common')
    setAddCommonPlace(r.commonPlace ?? '')
    setAddContent(r.content)
    setAddCategory(r.category ?? '')
    setAddUrgent(r.isUrgent)
    setAddReqDate(kstYmdStr(new Date(r.requestDate)))
    setAddTargetDate(r.targetDate ? kstYmdStr(new Date(r.targetDate)) : '')
    setShowAddForm(true)
  }

  const handleSave = () => {
    if (!addContent.trim()) { pushToast('error', '내용을 입력해주세요.'); return }
    const payload = {
      tenantId:    addSubject === 'common' ? null : addSubject,
      content:     addContent,
      requestDate: addReqDate,
      targetDate:  addTargetDate || null,
      category:    addCategory || null,
      isUrgent:    addUrgent,
      commonPlace: addSubject === 'common' ? (addCommonPlace || null) : null,
    }
    const targetId = editingId
    startTransition(async () => {
      const release = trackSave()
      try {
        if (targetId) {
          const res = await updateTenantRequest(targetId, payload)
          if (!res.ok) { pushToast('error', res.error); return }
          // 적용취소 — 서버가 돌려준 이전 값 스냅샷으로 같은 액션을 다시 호출해 원복.
          const prev = res.prev
          pushToast('success', '요청 수정됨', {
            action: {
              label: '적용취소',
              run: () => { void updateTenantRequest(targetId, prev).then(r => {
                if (!r.ok) { pushToast('error', r.error); return }
                pushToast('info', '수정을 되돌렸습니다')
                router.refresh()
              }) },
            },
          })
        } else {
          const res = await createTenantRequest(payload)
          if (!res.ok) { pushToast('error', res.error); return }
          pushToast('success', '요청 등록됨')
        }
        setShowAddForm(false)
        resetForm()
        router.refresh()
      } finally { release() }
    })
  }

  return (
    <div className="space-y-4">
      {/* 헤더 — 제목 좌측 + 월 셀렉터 우측 끝(전 페이지 통일), 검색·등록은 아랫줄 */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">요청 · 컴플레인</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">
            미처리 {unresolvedCount}건<span className="text-[var(--warm-muted)]"> (월 무관 전체)</span>
            {urgentCount > 0 && (
              <>
                <span className="mx-1.5 text-[var(--warm-border)]">·</span>
                <span className="text-[var(--coral)] font-semibold">긴급 {urgentCount}건</span>
              </>
            )}
            <span className="mx-1.5 text-[var(--warm-border)]">·</span>
            처리됨은 <span className="text-[var(--warm-mid)]">{Number(targetMonth.slice(5))}월 해결분</span>
          </p>
        </div>
        <div className="shrink-0"><MonthSelector /></div>
      </div>
      <div className="flex items-center gap-2 sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={search} onChange={setSearch} placeholder="입주자/내용 검색" className="flex-1 min-w-[180px]" />
        <Btn variant="primary" size="md" className="shrink-0" onClick={() => { resetForm(); setShowAddForm(true) }}>
          + 요청 등록
        </Btn>
      </div>

      {/* 등록·수정 폼 — v2.0 §23 페이지 Modal (지출·고객 등록과 동일 흐름) */}
      <Modal open={showAddForm} onClose={() => { setShowAddForm(false); setAddDirty(false) }}
        title={editingId ? '요청 수정' : '새 요청 등록'} width="md" dirty={addDirty}>
        <form className="space-y-3" onSubmit={e => e.preventDefault()}
          onInput={() => requestAnimationFrame(() => setAddDirty(true))} onChange={() => setAddDirty(true)}>

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
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)]"
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
                {formCategoryOptions.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">요청일</label>
              <DatePicker value={addReqDate} onChange={setAddReqDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
          </div>

          {/* 목표일 + 긴급 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-[var(--warm-muted)]">목표 처리일 (선택)</label>
              <DatePicker value={addTargetDate} onChange={setAddTargetDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
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
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder:text-[var(--ink-m)] outline-none focus:border-[var(--coral)] resize-none"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <Btn
              variant="secondary"
              size="md"
              className="flex-1"
              onClick={() => { setShowAddForm(false); setAddDirty(false) }}
            >
              취소
            </Btn>
            <Btn
              variant="primary"
              size="md"
              className="flex-1 font-semibold"
              onClick={handleSave}
              disabled={pending || !addContent.trim()}
            >
              {pending ? '저장 중…' : '저장'}
            </Btn>
          </div>
        </form>
      </Modal>

      {/* 필터 바 */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          size="sm"
          ariaLabel="처리 상태"
          value={filterStatus}
          onChange={setFilterStatus}
          options={[
            { value: 'unresolved', label: `미처리 ${unresolvedCount}` },
            { value: 'all',        label: `전체 ${unresolvedCount + resolvedCount}` },
            { value: 'resolved',   label: `처리됨 ${resolvedCount}` },
          ]}
        />

        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />

        <span className="text-xs font-medium text-[var(--warm-muted)]">카테고리</span>
        <SegmentedControl
          size="sm"
          scroll
          ariaLabel="카테고리"
          value={filterCategory}
          onChange={setFilterCategory}
          options={[
            { value: 'all', label: `전체 ${scoped.length}` },
            ...categories.map(cat => ({ value: cat, label: `${cat} ${categoryCounts[cat]}` })),
            ...orphanCategories.map(cat => ({ value: cat, label: `${cat} ${categoryCounts[cat]}` })),
            { value: 'uncategorized', label: `미분류 ${categoryCounts.uncategorized}` },
          ]}
        />

        <span className="w-px self-stretch bg-[var(--warm-border)] mx-1" />

        <button
          onClick={() => setFilterUrgent(v => !v)}
          aria-pressed={filterUrgent}
          className={`px-2.5 py-1 text-xs font-medium rounded-full transition-colors ${
            filterUrgent
              ? 'bg-[var(--coral)] text-[var(--on-solid)]'
              : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)]'
          }`}
        >
          긴급만 {urgentCount}
        </button>
      </div>

      {/* 리스트 */}
      {filtered.length === 0 ? (
        <EmptyState
          icon={<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--warm-muted)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 5 H20 M4 12 H20 M4 19 H14" /></svg>}
          title={search.trim() ? '검색 결과가 없습니다' : '조건에 맞는 요청이 없습니다'}
          description={hasResettableFilter
            ? `적용 중인 필터: ${activeFilterSummary}`
            : (search.trim() ? '다른 검색어로 시도해 보세요.' : '필터를 바꾸거나 새 요청을 등록해 보세요.')}
          action={hasResettableFilter
            ? <Btn variant="secondary" size="sm" onClick={resetFilters}>필터 초기화</Btn>
            : undefined}
        />
      ) : (
        <ul className="space-y-2">
          {filtered.map(r => {
            // 기본 5종 밖(운영자 추가·삭제된 값)이어도 배지는 항상 렌더 — neutral 톤으로 떨어뜨린다.
            const c        = r.category ? (CATEGORY_COLORS[r.category] ?? NEUTRAL_COLOR) : null
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
                    <Badge tone="pale-red">긴급</Badge>
                  )}
                  {c && (
                    <span className={`text-[0.65625rem] px-2 py-0.5 rounded-full font-medium ring-1 ${c.bg} ${c.fg} ${c.ring}`}>
                      {r.category}
                    </span>
                  )}
                  {resolved && (
                    <Badge tone="pale-green">완료</Badge>
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
                  <span className="text-[0.65625rem] text-[var(--warm-muted)]">요청 {fmtDate(r.requestDate)}</span>
                  {r.targetDate && !resolved && (
                    <span className="text-[0.65625rem] font-medium text-[var(--warning-fg)]">목표 {fmtDate(r.targetDate)}</span>
                  )}
                  {resolved && (
                    <span className="text-[0.65625rem] text-[var(--success-fg)]">완료 {fmtDate(r.resolvedAt)}</span>
                  )}
                  {resolved && (
                    <button type="button" disabled={busyId === r.id}
                      onClick={() => handleUnresolve(r.id)}
                      className="min-h-[40px] inline-flex items-center text-xs px-2.5 py-1.5 rounded-md text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)] disabled:opacity-50 transition-colors">완료 해제</button>
                  )}
                  {resolved && (
                    <button type="button" disabled={busyId === r.id}
                      onClick={() => openEdit(r)}
                      className="min-h-[40px] inline-flex items-center text-xs px-2.5 py-1.5 rounded-md text-[var(--warm-mid)] hover:text-[var(--warm-dark)] hover:bg-[var(--cream)] disabled:opacity-50 transition-colors">수정</button>
                  )}
                </div>

                {/* 내용 */}
                <p className="text-sm text-[var(--warm-dark)] leading-snug whitespace-pre-wrap">{r.content}</p>

                {/* 처리 메모 */}
                {r.resolutionMemo && (
                  <p className="text-xs text-[var(--success-fg)] mt-2 pt-2 border-t border-[var(--success-ring)] flex gap-1.5">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0 mt-0.5"><path d="M7 4v9a3 3 0 0 0 3 3h10M15 11l5 5-5 5" /></svg>
                    <span>{r.resolutionMemo}</span>
                  </p>
                )}

                {/* 액션 */}
                {!resolved ? (
                  resolvingId === r.id ? (
                    <div className="mt-3 space-y-2 rounded-lg p-2.5 bg-[var(--success-bg)] border border-[var(--success-ring)]">
                      <textarea
                        value={resolvingMemo}
                        onChange={e => setResolvingMemo(e.target.value)}
                        rows={2}
                        autoFocus
                        placeholder="어떻게 처리했는지 짧게 (선택)"
                        className="w-full text-xs rounded-sm px-2 py-1.5 resize-none bg-[var(--cream)] border border-[var(--warm-border)] text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]"
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setResolvingId(null); setResolvingMemo('') }}
                          disabled={busyId === r.id}
                          className="flex-1 py-1.5 text-xs font-medium rounded-md bg-[var(--canvas)] text-[var(--warm-mid)] border border-[var(--warm-border)] disabled:opacity-50"
                        >
                          취소
                        </button>
                        <button
                          onClick={() => handleResolve(r.id, resolvingMemo)}
                          disabled={busyId === r.id}
                          className="flex-1 py-1.5 text-xs font-semibold rounded-md bg-[var(--success-solid)] text-[var(--on-solid)] disabled:opacity-50"
                        >
                          {busyId === r.id ? '저장 중…' : '완료로 저장'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex gap-2 mt-3 items-center">
                      <button
                        onClick={() => handleResolve(r.id, '')}
                        disabled={busyId === r.id}
                        className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)] hover:bg-[var(--success-bg)] disabled:opacity-50 inline-flex items-center gap-1"
                      >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5 12l5 5L20 6" /></svg>완료로 처리
                      </button>
                      <button
                        onClick={() => { setResolvingId(r.id); setResolvingMemo('') }}
                        disabled={busyId === r.id}
                        className="text-xs px-2 py-1.5 rounded-md text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-50"
                      >
                        메모 추가
                      </button>
                      <button
                        onClick={() => openEdit(r)}
                        disabled={busyId === r.id}
                        className="text-xs px-2 py-1.5 rounded-md text-[var(--warm-muted)] hover:text-[var(--warm-dark)] disabled:opacity-50"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => handleDelete(r.id)}
                        disabled={busyId === r.id}
                        className="ml-auto px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--danger-fg)] border border-[var(--danger-ring)] hover:bg-[var(--danger-bg)] disabled:opacity-50"
                      >
                        삭제
                      </button>
                    </div>
                  )
                ) : (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => handleDelete(r.id)}
                      disabled={busyId === r.id}
                      className="px-3 py-1.5 text-xs font-medium rounded-lg text-[var(--danger-fg)] border border-[var(--danger-ring)] hover:bg-[var(--danger-bg)] disabled:opacity-50"
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
