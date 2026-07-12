'use client'

// 계약서 파일 관리 — 출력/서명 받기 링크 + 스캔 본 업로드 + 목록 표시·삭제.
// TenantClient 에서 이주(2026-05-30): 셸의 고객 면과 페이지 자체 팝업 양쪽에서 재사용.

import { useEffect, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  getContractFiles, deleteContractFile, restoreContractFile,
  createContractScanUploadSession, finalizeContractScan,
  type ContractFileRow,
} from '@/app/(app)/tenants/actions'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { ShareDocButton } from '@/components/ui/ShareDocButton'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

export function ContractFilesPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [files, setFiles]   = useState<ContractFileRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)

  const reload = async () => {
    setLoading(true)
    try { setFiles(await getContractFiles(tenantId)) }
    finally { setLoading(false) }
  }
  useEffect(() => { reload() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setUploading(true)
    const release = trackSave()
    try {
      const session = await createContractScanUploadSession({
        tenantId, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeContractScan({ tenantId, driveFileId, fileName: file.name })
      if (!fin.ok) { pushToast('error', fin.error); return }
      pushToast('success', '스캔 본 업로드됨')
      await reload()
    } catch (err) {
      pushToast('error', (err as Error).message ?? '업로드 실패')
    } finally { release(); setUploading(false) }
  }

  const handleDelete = async (id: string) => {
    if (!(await confirmDialog({ title: '이 계약서 파일을 삭제할까요?', message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.', level: 'danger', confirmLabel: '삭제' }))) return
    const release = trackSave()
    try {
      const res = await deleteContractFile(id)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '삭제됨', { action: { label: '적용취소', run: () => { void restoreContractFile(id).then(r => { if (r.ok) reload(); else pushToast('error', r.error) }) } } })
      await reload()
    } finally { release() }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 -mt-1">
        <a href={`/contract/${tenantId}`} target="_blank" rel="noreferrer"
          className="px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
          출력 / 서명 받기
        </a>
        <label className={`px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'opacity-60' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'}`}>
          {uploading ? '업로드 중…' : '스캔 본 첨부'}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      {loading && <SkeletonRows rows={2} />}
      {!loading && files && files.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)]">등록된 계약서가 없습니다. 출력 페이지에서 서명을 받거나 스캔 본을 첨부하세요.</p>
      )}
      {!loading && files && files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map(f => {
            const dt = new Date(f.signedAt)
            const dateLabel = `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
            return (
              <li key={f.id} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)]">
                <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded font-medium ${f.source === 'GENERATED' ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
                  {f.source === 'GENERATED' ? '서명' : '스캔'}
                </span>
                <a href={f.viewUrl} target="_blank" rel="noreferrer" className="flex-1 min-w-0 text-xs text-[var(--warm-dark)] hover:text-[var(--coral)] truncate">
                  {tenantName} · {dateLabel}
                </a>
                <ShareDocButton driveFileId={f.driveFileId} fileName={`${tenantName}_계약서_${dateLabel}.pdf`} label="공유" />
                <button onClick={() => handleDelete(f.id)} className="text-[0.6875rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)]">
                  삭제
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
