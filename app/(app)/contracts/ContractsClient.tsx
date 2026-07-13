'use client'

import { useMemo, useState, useTransition } from 'react'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { STATUS_LABEL } from '@/lib/statusColors'
import { deleteContractFile, restoreContractFile } from '@/app/(app)/tenants/actions'
import type { ContractListRow } from './actions'
import { ShareDocButton } from '@/components/ui/ShareDocButton'
import { SearchBar } from '@/components/ui/SearchBar'

const fmtRoomNo = (no: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

const SOURCE_LABEL: Record<string, string> = { GENERATED: '앱 서명', UPLOADED: '스캔 업로드' }

// 퇴실 그룹: 퇴실 완료 + 입실 취소. 연결 계약이 없는(status null) 파일은 거주중 쪽에 둔다.
const isDeparted = (status: string | null) => status === 'CHECKED_OUT' || status === 'CANCELLED'

export default function ContractsClient({ contracts }: { contracts: ContractListRow[] }) {
  const router = useRouter()
  const entityModal = useEntityModal()
  const searchParams = useSearchParams()
  // 전역 통합 검색 ?q= 딥링크 시딩
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [residency, setResidency] = useState<'current' | 'departed' | 'all'>('current')
  const [source, setSource] = useState<'all' | 'GENERATED' | 'UPLOADED'>('all')
  const [sort, setSort] = useState<'latest' | 'tenant'>('latest')
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const departedCount = useMemo(() => contracts.filter(c => isDeparted(c.status)).length, [contracts])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = contracts.filter(c => {
      if (residency !== 'all' && (residency === 'departed') !== isDeparted(c.status)) return false
      if (source !== 'all' && c.source !== source) return false
      if (!q) return true
      return (
        c.tenantName.toLowerCase().includes(q) ||
        c.fileName.toLowerCase().includes(q) ||
        (c.roomNo ?? '').toLowerCase().includes(q)
      )
    })
    list = [...list].sort((a, b) =>
      sort === 'latest'
        ? new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime()
        : a.tenantName.localeCompare(b.tenantName, 'ko') || (a.roomNo ?? '').localeCompare(b.roomNo ?? '', 'ko', { numeric: true }),
    )
    return list
  }, [contracts, query, residency, source, sort])

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name}님의 이 계약서 파일을 삭제할까요?`, message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteContractFile(id)
      setDeletingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '계약서 삭제됨', { action: { label: '적용취소', run: () => { void restoreContractFile(id).then(r => { if (r.ok) router.refresh(); else pushToast('error', r.error) }) } } })
      router.refresh()
    })
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">계약서</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">여기는 모아보기 화면입니다. 새 계약서 작성·서명·스캔 업로드는 입주자 관리에서 입주자를 눌러 진행하세요. 거주중 {contracts.length - departedCount}건 · 퇴실 {departedCount}건.</p>
        </div>
        <div className="sticky top-0 z-10 -my-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={query} onChange={setQuery} placeholder="이름·호실·파일명 검색" />
        </div>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl
            size="sm"
            ariaLabel="거주 상태 필터"
            value={residency}
            onChange={setResidency}
            options={[
              { value: 'current', label: `거주중 ${contracts.length - departedCount}` },
              { value: 'departed', label: `퇴실 ${departedCount}` },
              { value: 'all', label: `전체 ${contracts.length}` },
            ]}
          />
          <SegmentedControl
            size="sm"
            ariaLabel="출처 필터"
            value={source}
            onChange={setSource}
            options={[
              { value: 'all', label: '전체' },
              { value: 'GENERATED', label: '앱 서명' },
              { value: 'UPLOADED', label: '스캔' },
            ]}
          />
          <SegmentedControl
            size="sm"
            ariaLabel="정렬"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'latest', label: '최신순' },
              { value: 'tenant', label: '입실자별' },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={contracts.length === 0 ? '계약서가 아직 없습니다' : '조건에 맞는 계약서가 없습니다'}
          description={contracts.length === 0 ? '고객 상세에서 계약서를 서명·출력하거나 스캔본을 업로드하면 여기에 모입니다.' : '검색어나 필터를 조정해 보세요.'}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map(c => (
            <li key={c.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-3.5 flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => entityModal.open({ kind: 'tenant', tenantId: c.tenantId })}
                    className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] transition-colors">
                    {c.roomNo ? `${fmtRoomNo(c.roomNo)} · ` : ''}{c.tenantName}
                  </button>
                  <span className={`text-[0.65625rem] font-medium px-1.5 py-0.5 rounded-full ${
                    c.source === 'GENERATED'
                      ? 'bg-[var(--coral)]/10 text-[var(--coral)]'
                      : 'bg-[var(--canvas)] text-[var(--warm-mid)] ring-1 ring-[var(--warm-border)]'
                  }`}>{SOURCE_LABEL[c.source]}</span>
                  {c.status && <span className="text-[0.65625rem] text-[var(--warm-muted)]">{STATUS_LABEL[c.status] ?? c.status}</span>}
                </div>
                <p className="text-[0.6875rem] text-[var(--warm-muted)] truncate mt-0.5">{c.fileName}</p>
                <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{fmtDate(c.signedAt)} 서명</p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <a href={c.viewUrl} target="_blank" rel="noreferrer"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                  보기
                </a>
                <ShareDocButton driveFileId={c.driveFileId} fileName={`${c.tenantName}_계약서.pdf`}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors disabled:opacity-50" />
                <button type="button" onClick={() => handleDelete(c.id, c.tenantName)} disabled={pending && deletingId === c.id}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg text-[var(--danger-fg)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] disabled:opacity-40 transition-colors">
                  {pending && deletingId === c.id ? '삭제 중…' : '삭제'}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
