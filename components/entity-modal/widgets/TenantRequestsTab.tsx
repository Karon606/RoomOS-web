'use client'

// 고객 요청·컴플레인 CRUD. 자체 fetch (getTenantRequests).
// 등록(생성) + 완료 처리 + 완료 적용취소 + 삭제 + 처리 이력 펼침/접힘.

import { useEffect, useState, useTransition } from 'react'
import { fmtMD as fmtDate } from '@/lib/fmtDate'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  createTenantRequest, resolveTenantRequest, unresolveTenantRequest, deleteTenantRequest, getTenantRequests,
} from '@/app/(app)/tenants/actions'
import { pushToast } from '@/lib/saveStatus'
import { RotateCcw } from '@/components/doc/FieldOverrideListModal'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { kstYmdStr } from '@/lib/kstDate'
import { Section } from './Section'
import CategorySelect from '@/components/ui/CategorySelect'

type Request = Awaited<ReturnType<typeof getTenantRequests>>['requests'][number]


export function TenantRequestsTab({ tenantId }: { tenantId: string }) {
  const [requests, setRequests] = useState<Request[] | null>(null)
  // 카테고리 목록은 설정에서 관리 — 요청 목록과 같은 왕복으로 실려 온다.
  const [categories, setCategories] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  const [newContent, setNewContent] = useState('')
  // 쓰다 만 글이 있으면 셸에 알린다 — 배경을 탭해도 그냥 안 닫히고 확인창을 거친다(§12).
  // 아이폰에서 키보드를 내리려고 칸 밖을 누르는 것이 관습이라 실수로 닿기 쉬운 자리였다.
  // 렌더 중 조정 — effect 에서 setState 를 부르지 않는다는 이 저장소의 규칙을 따른다.
  // markDirty 는 '비었나 아닌가'가 바뀔 때만 상태를 쓰므로 글자마다 다시 그려지지 않는다.
  const { markDirty } = useEntityModal()
  const contentDirty = newContent.trim().length > 0
  const [syncedDirty, setSyncedDirty] = useState(false)
  if (syncedDirty !== contentDirty) {
    setSyncedDirty(contentDirty)
    markDirty('tenant-request', contentDirty)
  }
  useEffect(() => () => markDirty('tenant-request', false), [markDirty])
  const [newReqDate, setNewReqDate] = useState(kstYmdStr())
  const [newTargetDate, setNewTargetDate] = useState('')
  // 카테고리·긴급 — /requests 등록 모달과 동일 항목(여기서만 빠져 미분류가 쌓이던 누락 봉합, 2026-07-27)
  const [newCategory, setNewCategory] = useState('')
  const [newUrgent, setNewUrgent] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  // 등록 폼은 접어 둔다 — 이 면은 '뭘 요청했나'를 보러 여는 자리이고 등록은 가끔이다.
  const [showNewForm, setShowNewForm] = useState(false)

  const reload = async () => {
    const res = await getTenantRequests(tenantId)
    setRequests(res.requests); setCategories(res.categories)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [tenantId])

  const handleCreate = () => {
    if (!newContent.trim()) return
    startTransition(async () => {
      await createTenantRequest({ tenantId, content: newContent, requestDate: newReqDate, targetDate: newTargetDate || null, category: newCategory || null, isUrgent: newUrgent })
      setNewContent(''); setNewTargetDate(''); setNewReqDate(kstYmdStr()); setNewCategory(''); setNewUrgent(false)
      await reload()
    })
  }
  // 되돌리기는 새 액션을 세우지 않고 /requests 와 같은 unresolveTenantRequest 하나를 쓴다.
  // resolvedAt 만 null 이 되고 처리 메모는 남으므로, 다시 완료해도 적어 둔 메모가 그대로다.
  const handleUnresolve = (id: string) => {
    startTransition(async () => {
      const res = await unresolveTenantRequest(id)
      if (!res.ok) { pushToast('error', res.error); return }
      // 버튼이 '적용취소'니 결과도 같은 동사여야 한다 — 형제 DueDayPermanentChangeWidget 과 같은 문법.
      pushToast('info', '완료를 적용취소했습니다 · 미처리로 복귀')
      await reload()
    })
  }
  const handleResolve = (id: string) => {
    startTransition(async () => {
      const res = await resolveTenantRequest(id)
      // 조용한 실패 금지 — 종전에는 결과를 안 보고 목록만 다시 읽어, 권한이 없으면 아무 일도
      // 안 일어난 것처럼 보였다.
      if (!res.ok) { pushToast('error', res.error); return }
      // §16 진입점 1 — 토스트 액션(액션이 붙으면 pushToast 가 6초 TOAST_DUR_ACTION 을 고른다).
      const opts: { action: { label: string; run: () => void }; detail?: string } = {
        action: { label: '적용취소', run: () => handleUnresolve(id) },
      }
      pushToast('success', '완료로 처리했습니다', opts)
      await reload()
    })
  }
  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 요청을 삭제할까요?', level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => { await deleteTenantRequest(id); await reload() })
  }

  if (requests === null) {
    return <Section title="요청·컴플레인"><SkeletonRows rows={2} className="py-1" /></Section>
  }
  const unresolved = requests.filter(r => !r.resolvedAt)
  const resolved   = requests.filter(r =>  r.resolvedAt)

  return (
    <Section title="요청·컴플레인">
      <div className="space-y-4">
        {/* 새 요청 등록 — **접어 둔다.** 이 면을 여는 대부분의 이유는 '이 사람이 뭘 요청했나'를
            보는 것이고, 등록은 가끔이다. 펼쳐 두면 폼 여섯 칸이 목록을 화면 밖으로 밀어낸다.
            형제 위젯(RoomRequests·처리 이력)이 이미 같은 문법으로 접혀 있어 손놀림도 같다. */}
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
          <button type="button" onClick={() => setShowNewForm(v => !v)}
            className="w-full text-xs font-semibold flex items-center justify-between gap-1"
            style={{ color: 'var(--warm-mid)' }} aria-expanded={showNewForm}>
            새 요청 등록
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showNewForm ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showNewForm && (<>
          {/* 카테고리 + 요청일 — /requests 등록 모달과 같은 구성·순서·라벨(조밀 문법만 유지) */}
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="min-w-0">
              <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>카테고리</label>
              <CategorySelect
                value={newCategory} onChange={setNewCategory}
                options={categories} emptyLabel="카테고리 없음" showAddHint closeIconSize={12}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-[0.6875rem] text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
            </div>
            <div className="min-w-0">
              <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>요청일</label>
              <DatePicker value={newReqDate} onChange={setNewReqDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-[0.6875rem] text-[var(--warm-dark)] min-w-0" />
            </div>
          </div>
          {/* 목표 처리일 + 긴급 */}
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="min-w-0">
              <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>목표 처리일 (선택)</label>
              <DatePicker value={newTargetDate} onChange={setNewTargetDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-[0.6875rem] text-[var(--warm-dark)] min-w-0" />
            </div>
            <div className="min-w-0 flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newUrgent} onChange={e => setNewUrgent(e.target.checked)}
                  className="w-4 h-4 accent-[var(--coral)]" />
                <span className="text-[0.65625rem] font-medium" style={{ color: 'var(--warm-mid)' }}>긴급</span>
              </label>
            </div>
          </div>
          {/* 내용 */}
          <div className="min-w-0">
            <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>내용</label>
            <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={3} placeholder="요청 내용을 입력하세요"
              className="w-full text-sm rounded-sm px-3 py-2 resize-none"
              style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)', outline: 'none' }} />
          </div>
          <Btn onClick={handleCreate} disabled={pending || !newContent.trim()} variant="primary" size="md" fullWidth>
            {pending ? '등록 중…' : '등록'}
          </Btn>
          </>)}
        </div>

        {/* 미처리 목록 */}
        {unresolved.length === 0 ? (
          <p className="text-xs text-center py-4" style={{ color: 'var(--warm-muted)' }}>미처리 요청 없음</p>
        ) : (
          <div className="space-y-2">
            {unresolved.map(r => (
              <div key={r.id} className="rounded-xl p-4 space-y-3" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>
                    <span>요청 {fmtDate(r.requestDate)}</span>
                    {r.targetDate && <span className="font-medium" style={{ color: 'var(--warning-fg)' }}>목표 {fmtDate(r.targetDate)}</span>}
                  </div>
                  <button onClick={() => handleDelete(r.id)} disabled={pending}
                    className="shrink-0 w-6 h-6 flex items-center justify-center rounded-md transition-colors disabled:opacity-40"
                    style={{ color: 'var(--warm-muted)' }} title="삭제">
                    <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M1 3h12M4 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M5.5 6v5M8.5 6v5M2 3l.8 9a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L12 3" />
                    </svg>
                  </button>
                </div>
                <p className="text-sm leading-snug" style={{ color: 'var(--warm-dark)' }}>{r.content}</p>
                <button onClick={() => handleResolve(r.id)} disabled={pending}
                  className="w-full py-2 text-xs font-semibold rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                  style={{ background: 'var(--success-bg)', color: 'var(--success-fg)', border: '1.5px solid var(--success-ring)' }}>
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M2 6l3 3 5-5" /></svg>
                  완료로 처리하기
                </button>
              </div>
            ))}
          </div>
        )}

        {/* 처리 이력 (펼침) */}
        {resolved.length > 0 && (
          <div>
            <button onClick={() => setShowHistory(v => !v)}
              className="text-xs font-medium flex items-center gap-1"
              style={{ color: 'var(--warm-muted)' }}>
              처리된 이력 {resolved.length}건 <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showHistory ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
            </button>
            {showHistory && (
              <div className="mt-2 space-y-2">
                {resolved.map(r => (
                  <div key={r.id} className="rounded-xl p-3 opacity-60" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
                    {/* 44px Btn 이 들어오면서 이 행의 정렬·넘침 규칙이 바뀐다. items-start 면 10.5px
                        메타가 버튼 윗변에 붙고, 왼쪽에 flex-wrap·min-w-0 이 없으면 360px 폰에서
                        삭제 아이콘이 카드 밖으로 밀린다(칸 넘침 신고와 같은 클래스). */}
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 min-w-0 text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>
                        <span className="font-medium text-[var(--success-fg)]">완료</span>
                        <span>{fmtDate(r.resolvedAt)}</span>
                        <span>·</span>
                        <span>요청 {fmtDate(r.requestDate)}</span>
                      </div>
                      {/* §16 진입점 2 원위치 — 토스트가 사라진 뒤에도 되돌릴 자리가 있어야 한다.
                          삭제와 나란히 서므로 '적용취소' 단독으로는 무엇을 취소하는지 갈린다
                          (삭제 취소로 읽힌다). §16 "모호하면 명사 보강"에 따라 명사를 붙인다. */}
                      <div className="shrink-0 flex items-center gap-1">
                        <Btn variant="subtle" size="sm" disabled={pending} onClick={() => handleUnresolve(r.id)}>
                          <RotateCcw />
                          완료 적용취소
                        </Btn>
                        {/* 히트만 44px 로 키운다(§10) — 아이콘 11px 과 조밀한 이력 행 여백은 그대로 두려고
                            음수 마진으로 자리를 되돌린다. 옆 Btn 이 44px 이라 여기만 20px 이면 손끝이 갈린다. */}
                        <button onClick={() => handleDelete(r.id)} disabled={pending}
                          className="shrink-0 w-11 h-11 -my-3 -mr-2 flex items-center justify-center rounded transition-colors disabled:opacity-40"
                          style={{ color: 'var(--warm-muted)' }} title="삭제">
                          <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 3h12M4 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M5.5 6v5M8.5 6v5M2 3l.8 9a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L12 3" />
                          </svg>
                        </button>
                      </div>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--warm-mid)' }}>{r.content}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Section>
  )
}
