'use client'

import { InfoHint } from '@/components/ui/InfoHint'
import { useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { STATUS_LABEL } from '@/lib/statusColors'
import { deleteResidenceCertFile, type ResidenceCertListRow, type IssuableTenant } from './actions'
import { ShareDocButton } from '@/components/ui/ShareDocButton'
import { SearchBar } from '@/components/ui/SearchBar'

const fmtRoomNo = (no: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')
const fmtDate = (d: Date | string) => {
  const t = new Date(d)
  return `${t.getFullYear()}.${String(t.getMonth() + 1).padStart(2, '0')}.${String(t.getDate()).padStart(2, '0')}`
}

export default function ResidenceCertClient({ files, tenants }: { files: ResidenceCertListRow[]; tenants: IssuableTenant[] }) {
  const router = useRouter()
  const entityModal = useEntityModal()
  const [tenantQuery, setTenantQuery] = useState('')
  const [fileQuery, setFileQuery] = useState('')
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const tenantRows = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(t =>
      t.tenantName.toLowerCase().includes(q) || (t.roomNo ?? '').toLowerCase().includes(q))
  }, [tenants, tenantQuery])

  const fileRows = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    if (!q) return files
    return files.filter(c =>
      c.tenantName.toLowerCase().includes(q) ||
      c.fileName.toLowerCase().includes(q) ||
      (c.roomNo ?? '').toLowerCase().includes(q))
  }, [files, fileQuery])

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name}님의 이 실거주 확인서를 삭제할까요?`, message: 'Google Drive 원본도 함께 삭제됩니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteResidenceCertFile(id)
      setDeletingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '실거주 확인서 삭제됨')
      router.refresh()
    })
  }

  return (
    <div className="space-y-5 px-4 sm:px-6 py-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">실거주 확인서
          <InfoHint title="실거주 확인서란?">거주중 입실자를 선택해 발급하면 영업장 주소·면적·임대료·도장이 자동으로 채워집니다. 발급한 PDF는 아래 이력에 보관됩니다.</InfoHint>
        </h1>
      </div>

      {/* 새 확인서 발급 — 거주중 입실자 선택 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">새 확인서 발급</h2>
        <SearchBar value={tenantQuery} onChange={setTenantQuery} placeholder="이름·호실로 입실자 찾기" />
        {tenants.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-4 text-center">거주중인 입실자가 없습니다.</p>
        ) : tenantRows.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] px-1 py-2">조건에 맞는 입실자가 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tenantRows.map(t => (
              <li key={t.tenantId}>
                <Link
                  href={`/residence-cert/${t.tenantId}`}
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

      {/* 발급 이력 */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">발급 이력 <span className="text-[var(--warm-muted)] font-normal">{files.length}건</span></h2>
        {files.length > 0 && (
          <SearchBar value={fileQuery} onChange={setFileQuery} placeholder="이름·호실·파일명 검색" />
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
                    <button
                      type="button"
                      onClick={() => entityModal.open({ kind: 'tenant', tenantId: c.tenantId })}
                      className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] transition-colors">
                      {c.roomNo ? `${fmtRoomNo(c.roomNo)} · ` : ''}{c.tenantName}
                    </button>
                    {c.status && <span className="text-[0.5625rem] text-[var(--warm-muted)]">{STATUS_LABEL[c.status] ?? c.status}</span>}
                  </div>
                  <p className="text-[0.6875rem] text-[var(--warm-muted)] truncate mt-0.5">{c.fileName}</p>
                  <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">{fmtDate(c.issuedAt)} 발급</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <a href={c.viewUrl} target="_blank" rel="noreferrer"
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                    보기
                  </a>
                  <ShareDocButton driveFileId={c.driveFileId} fileName={`${c.tenantName}_실거주확인서.pdf`}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors disabled:opacity-50" />
                  <Link href={`/residence-cert/${c.tenantId}`}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                    재발급
                  </Link>
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
