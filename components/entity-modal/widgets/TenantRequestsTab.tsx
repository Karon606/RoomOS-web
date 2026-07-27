'use client'

// 고객 요청·컴플레인 CRUD. 자체 fetch (getTenantRequests).
// 등록(생성) + 완료 처리 + 삭제 + 처리 이력 펼침/접힘.

import { useEffect, useState, useTransition } from 'react'
import { fmtMD as fmtDate } from '@/lib/fmtDate'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  createTenantRequest, resolveTenantRequest, deleteTenantRequest, getTenantRequests,
} from '@/app/(app)/tenants/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { kstYmdStr } from '@/lib/kstDate'
import { Section } from './Section'

type Request = Awaited<ReturnType<typeof getTenantRequests>>['requests'][number]


export function TenantRequestsTab({ tenantId }: { tenantId: string }) {
  const [requests, setRequests] = useState<Request[] | null>(null)
  // 카테고리 목록은 설정에서 관리 — 요청 목록과 같은 왕복으로 실려 온다.
  const [categories, setCategories] = useState<string[]>([])
  const [pending, startTransition] = useTransition()

  const [newContent, setNewContent] = useState('')
  const [newReqDate, setNewReqDate] = useState(kstYmdStr())
  const [newTargetDate, setNewTargetDate] = useState('')
  // 카테고리·긴급 — /requests 등록 모달과 동일 항목(여기서만 빠져 미분류가 쌓이던 누락 봉합, 2026-07-27)
  const [newCategory, setNewCategory] = useState('')
  const [newUrgent, setNewUrgent] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

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
  const handleResolve = (id: string) => {
    startTransition(async () => { await resolveTenantRequest(id); await reload() })
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
        {/* 새 요청 등록 */}
        <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
          <p className="text-xs font-semibold" style={{ color: 'var(--warm-mid)' }}>새 요청 등록</p>
          <textarea value={newContent} onChange={e => setNewContent(e.target.value)} rows={3} placeholder="요청 내용을 입력하세요"
            className="w-full text-sm rounded-sm px-3 py-2 resize-none"
            style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)', outline: 'none' }} />
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="min-w-0">
              <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>요청 날짜</label>
              <DatePicker value={newReqDate} onChange={setNewReqDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-[0.6875rem] text-[var(--warm-dark)] min-w-0" />
            </div>
            <div className="min-w-0">
              <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>처리 목표일 (선택)</label>
              <DatePicker value={newTargetDate} onChange={setNewTargetDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-[0.6875rem] text-[var(--warm-dark)] min-w-0" />
            </div>
          </div>
          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 1fr' }}>
            <div className="min-w-0">
              <label className="block text-[0.65625rem] font-medium mb-1" style={{ color: 'var(--warm-muted)' }}>카테고리</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-2 text-[0.6875rem] text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                <option value="">카테고리 없음</option>
                {categories.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
            </div>
            <div className="min-w-0 flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={newUrgent} onChange={e => setNewUrgent(e.target.checked)}
                  className="w-4 h-4 accent-[var(--coral)]" />
                <span className="text-[0.65625rem] font-medium" style={{ color: 'var(--warm-mid)' }}>긴급</span>
              </label>
            </div>
          </div>
          <Btn onClick={handleCreate} disabled={pending || !newContent.trim()} variant="primary" size="md" fullWidth>
            {pending ? '등록 중…' : '등록'}
          </Btn>
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
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <div className="flex items-center gap-2 text-[0.65625rem]" style={{ color: 'var(--warm-muted)' }}>
                        <span className="font-medium text-[var(--success-fg)]">완료</span>
                        <span>{fmtDate(r.resolvedAt)}</span>
                        <span>·</span>
                        <span>요청 {fmtDate(r.requestDate)}</span>
                      </div>
                      <button onClick={() => handleDelete(r.id)} disabled={pending}
                        className="shrink-0 w-5 h-5 flex items-center justify-center rounded transition-colors disabled:opacity-40"
                        style={{ color: 'var(--warm-muted)' }} title="삭제">
                        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M1 3h12M4 3V2a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1M5.5 6v5M8.5 6v5M2 3l.8 9a1 1 0 0 0 1 .9h6.4a1 1 0 0 0 1-.9L12 3" />
                        </svg>
                      </button>
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
