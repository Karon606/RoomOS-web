'use client'

// 입주자별 발급 서류 이력 — 접기·펼치기. 펼칠 때 납부 확인서·보증금 영수증·실거주 확인서를
// 시간순으로 모아 보여 준다(운영자 2026-09-03 — "각종 발급서류가 모여있는 리스트").
//
// **열람 전용이다.** 보내기는 서류 시트가, 계약서 관리는 바로 위 계약서 파일 패널이, 삭제·다시
// 작성은 전역 발급 이력 목록이 이미 갖고 있다. 파괴 액션을 넷째 자리에 복제하면 확인 문구와
// 적용취소 동선이 갈라진다(패널 판정). 여기 없는 능력은 정확히 하나 "이 사람의 과거 발급본
// 열람"뿐이었고, 그것만 채운다.
//
// 접힘·지연 조회 문법은 PaymentHistoryAll 정본 그대로다. 새 인터랙션을 만들지 않는다.
import { useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { fmtDateDot } from '@/lib/fmtDate'
import { DOC_HISTORY_LABEL, docHistoryNote } from '@/lib/docHistory'
import { getTenantDocHistory } from '@/app/(app)/tenants/docHistory'

type Data = Awaited<ReturnType<typeof getTenantDocHistory>>

export function TenantDocHistory({ tenantId }: { tenantId: string }) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<Data | null>(null)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (!next || data) return
    setLoading(true)
    try { setData(await getTenantDocHistory(tenantId)) } finally { setLoading(false) }
  }

  return (
    <div className="rounded-xl border border-[var(--warm-border)] bg-[var(--cream)]">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-3 py-2.5 text-sm font-semibold text-[var(--warm-dark)]"
      >
        <span>
          발급 서류 이력
          {/* 건수는 조회 후에만 붙인다 — 접힌 채로 세려면 열림 시점에 count 를 따로 쳐야 한다. */}
          {data && <span className="ml-1 text-[0.6875rem] font-medium text-[var(--warm-muted)]">{data.rows.length}건</span>}
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-[var(--warm-muted)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
      </button>

      {open && (
        <div className="px-3 pb-3">
          {loading ? (
            <SkeletonRows rows={3} className="py-1" />
          ) : !data || data.rows.length === 0 ? (
            <p className="text-xs text-[var(--warm-muted)] py-3 text-center">발급한 서류가 없습니다.</p>
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]">
              {data.rows.map(r => {
                const note = docHistoryNote(
                  { ...r, issuedAt: new Date(r.issuedAt), leaseTermId: null },
                  { showRoom: data.showRoom },
                )
                return (
                  <li key={r.id} className="flex items-center gap-2 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-[var(--warm-dark)] truncate">{DOC_HISTORY_LABEL[r.docType]}</p>
                      <p className="num text-[0.65625rem] text-[var(--warm-muted)] mt-0.5 break-keep">
                        {fmtDateDot(r.issuedAt)} 발급{note ? ` · ${note}` : ''}
                      </p>
                    </div>
                    <ViewDocButton driveFileId={r.driveFileId} from="tenant" tenantId={tenantId} className="shrink-0" />
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
