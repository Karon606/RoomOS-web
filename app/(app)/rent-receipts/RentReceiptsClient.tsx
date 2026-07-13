'use client'

import { useMemo, useState, useTransition } from 'react'
import { InfoHint } from '@/components/ui/InfoHint'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { STATUS_LABEL } from '@/lib/statusColors'
import { deleteRentReceiptFile, restoreRentReceiptFile, type RentReceiptListRow, type IssuableTenant } from './actions'
import { ShareDocButton } from '@/components/ui/ShareDocButton'
import { SearchBar } from '@/components/ui/SearchBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'

const fmtRoomNo = (no: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

export default function RentReceiptsClient({ files, tenants }: { files: RentReceiptListRow[]; tenants: IssuableTenant[] }) {
  const router = useRouter()
  const entityModal = useEntityModal()
  const [tenantQuery, setTenantQuery] = useState('')
  const searchParams = useSearchParams()
  // 전역 통합 검색 ?q= 딥링크 시딩(발급 이력 파일 검색)
  const [fileQuery, setFileQuery] = useState(() => searchParams.get('q') ?? '')
  const [fileStatus, setFileStatus] = useState('')
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 발급 이력 상태 필터 옵션 — 실제 존재하는 입주자 상태만
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of files) if (c.status) m[c.status] = (m[c.status] ?? 0) + 1
    return m
  }, [files])

  const tenantRows = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(t => t.tenantName.toLowerCase().includes(q) || (t.roomNo ?? '').toLowerCase().includes(q))
  }, [tenants, tenantQuery])

  const fileRows = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    return files.filter(c =>
      (!fileStatus || c.status === fileStatus) &&
      (!q || c.tenantName.toLowerCase().includes(q) || c.fileName.toLowerCase().includes(q) || (c.roomNo ?? '').toLowerCase().includes(q))
    )
  }, [files, fileQuery, fileStatus])

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name}님의 이 입실료 납부 확인서를 삭제할까요?`, message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteRentReceiptFile(id)
      setDeletingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '입실료 납부 확인서 삭제됨', { action: { label: '적용취소', run: () => { void restoreRentReceiptFile(id).then(r => { if (r.ok) router.refresh(); else pushToast('error', r.error) }) } } })
      router.refresh()
    })
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">입실료 납부 확인서
          <InfoHint title="납부 확인서란?">거주중 입실자를 선택해 발급하면 이름·호실·거주기간·월 이용료·수령인·도장이 자동으로 채워집니다. 발급한 PDF는 아래 이력과 연결된 Google Drive에 보관됩니다.</InfoHint>
        </h1>
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">새 확인서 발급</h2>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">발급된 PDF는 연결된 Google Drive에 저장됩니다</p>
        <div className="sticky top-0 z-10 -my-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={tenantQuery} onChange={setTenantQuery} placeholder="이름·호실로 입실자 찾기" />
        </div>
        {tenants.length === 0 ? (
          <EmptyState title="거주중인 입실자가 없습니다" />
        ) : tenantRows.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] px-1 py-2">조건에 맞는 입실자가 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tenantRows.map(t => (
              <li key={t.tenantId}>
                <Link href={`/rent-receipt/${t.tenantId}`}
                  className="flex items-center justify-between gap-1 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 hover:border-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">
                  <span className="min-w-0 truncate text-sm font-medium text-[var(--warm-dark)]">
                    {t.roomNo ? `${fmtRoomNo(t.roomNo)} · ` : ''}{t.tenantName}
                  </span>
                  <span className="text-[var(--coral)] text-xs shrink-0">발급 ›</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">발급 이력 <span className="text-[var(--warm-muted)] font-normal">{files.length}건</span></h2>
        {files.length > 0 && (
          <div className="sticky top-0 z-10 -my-2 py-2 bg-[var(--canvas)]">
            <SearchBar value={fileQuery} onChange={setFileQuery} placeholder="이름·호실·파일명 검색" />
          </div>
        )}
        {Object.keys(statusCounts).length >= 2 && (
          <SegmentedControl<string>
            size="sm"
            scroll
            ariaLabel="발급 이력 상태 필터"
            value={fileStatus}
            onChange={setFileStatus}
            options={[
              { value: '', label: `전체 ${files.length}` },
              ...Object.keys(statusCounts).map(s => ({ value: s, label: `${STATUS_LABEL[s] ?? s} ${statusCounts[s]}` })),
            ]}
          />
        )}
        {fileRows.length === 0 ? (
          <EmptyState
            title={files.length === 0 ? '발급한 확인서가 아직 없습니다' : '조건에 맞는 확인서가 없습니다'}
            description={files.length === 0 ? '위에서 입실자를 선택해 발급하면 여기에 모입니다.' : '검색어를 조정해 보세요.'}
          />
        ) : (
          <ul className="space-y-2">
            {fileRows.map(c => (
              <li key={c.id} className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-3.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button type="button" onClick={() => entityModal.open({ kind: 'tenant', tenantId: c.tenantId })}
                      className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] transition-colors">
                      {c.roomNo ? `${fmtRoomNo(c.roomNo)} · ` : ''}{c.tenantName}
                    </button>
                    {c.status && <span className="text-[0.65625rem] text-[var(--warm-muted)]">{STATUS_LABEL[c.status] ?? c.status}</span>}
                  </div>
                  <p className="text-[0.6875rem] text-[var(--warm-muted)] truncate mt-0.5">{c.fileName}</p>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{fmtDate(c.issuedAt)} 발급</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a href={c.viewUrl} target="_blank" rel="noreferrer"
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">보기</a>
                  <ShareDocButton driveFileId={c.driveFileId} fileName={`${c.tenantName}_입실료확인서.pdf`}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors disabled:opacity-50" />
                  <Link href={`/rent-receipt/${c.tenantId}`}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">재발급</Link>
                  <button type="button" onClick={() => handleDelete(c.id, c.tenantName)} disabled={pending && deletingId === c.id}
                    className="px-2 py-1.5 text-xs font-medium rounded-lg text-[var(--danger-fg)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] disabled:opacity-40 transition-colors">
                    {pending && deletingId === c.id ? '삭제 중…' : '삭제'}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
