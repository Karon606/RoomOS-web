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
import {
  issueContractShareLink, getContractShareState,
  closeContractShareLink, reopenContractShareLink,
  type ContractShareLinkInfo,
} from '@/app/(app)/tenants/contractShare'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { ShareDocButton } from '@/components/ui/ShareDocButton'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

// 원격 서명 링크 상태 배지 — 활성(남은 시간)/서명 완료/만료/닫힘/잠김
function shareBadge(link: ContractShareLinkInfo): { label: string; active: boolean } {
  if (link.lockedAt) return { label: '링크 잠김 (생년월일 5회 오류)', active: false }
  if (link.closedAt) return { label: '링크 닫힘', active: false }
  const remainMs = new Date(link.expiresAt).getTime() - Date.now()
  if (remainMs <= 0) return { label: '링크 만료', active: false }
  const remain = remainMs >= 60 * 60 * 1000
    ? `${Math.floor(remainMs / (60 * 60 * 1000))}시간 남음`
    : `${Math.max(1, Math.floor(remainMs / (60 * 1000)))}분 남음`
  if (link.signedAt) return { label: `서명 완료 · ${remain}`, active: true }
  return { label: `서명 대기 · ${remain}`, active: true }
}

export function ContractFilesPanel({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
  const [files, setFiles]   = useState<ContractFileRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  // 원격 서명 링크 상태 (최신 링크 1건 + 문자 발송용 연락처·영업장명)
  const [share, setShare] = useState<{ link: ContractShareLinkInfo | null; phone: string | null; propertyName: string } | null>(null)
  const [sharePending, setSharePending] = useState(false)

  const reload = async () => {
    setLoading(true)
    try { setFiles(await getContractFiles(tenantId)) }
    finally { setLoading(false) }
  }
  const reloadShare = async () => {
    const res = await getContractShareState(tenantId)
    if (res.ok) setShare({ link: res.link, phone: res.phone, propertyName: res.propertyName })
  }
  useEffect(() => { reload(); reloadShare() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // sms: 링크 조립 — NoticeSmsModal 과 동일한 기기 분기(애플은 sms://open?addresses=, 그 외 sms:번호)
  const openSms = (url: string, phone: string, propertyName: string) => {
    const body = `[${propertyName}] 입실 계약서입니다. 아래 링크에서 계약 내용을 확인하고 서명해 주세요. 확인을 위해 본인 생년월일 입력이 필요합니다. 링크는 24시간 뒤 만료됩니다. ${url}`
    const num = phone.replace(/[^0-9+]/g, '')
    const enc = encodeURIComponent(body)
    const isApple = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
    window.location.href = isApple ? `sms://open?addresses=${num}&body=${enc}` : `sms:${num}?body=${enc}`
  }

  // 보내기 — 활성 링크가 있으면 재사용(다시 보내기), 없으면 새로 발급 후 메시지 앱으로 이동
  const handleShareSend = async () => {
    if (sharePending) return
    setSharePending(true)
    const release = trackSave()
    try {
      const res = await issueContractShareLink(tenantId)
      if (!res.ok) { pushToast('error', res.error); return }
      await reloadShare()
      if (!res.phone) { pushToast('error', '주 연락처가 없어 문자를 보낼 수 없습니다. 고객 정보에서 연락처를 먼저 등록해 주세요.'); return }
      openSms(res.link.url, res.phone, res.propertyName)
    } finally { release(); setSharePending(false) }
  }

  // 링크 닫기 — 적용취소(다시 열기)는 만료 전만 가능
  const handleShareClose = async () => {
    const link = share?.link
    if (!link) return
    if (!(await confirmDialog({ title: '이 서명 링크를 닫을까요?', message: '입주자가 더 이상 링크를 열 수 없게 됩니다. 만료 전에는 적용취소로 다시 열 수 있습니다.', level: 'caution', confirmLabel: '닫기' }))) return
    const release = trackSave()
    try {
      const res = await closeContractShareLink(link.id)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '링크 닫힘', { action: { label: '적용취소', run: () => { void reopenContractShareLink(link.id).then(r => { if (r.ok) reloadShare(); else pushToast('error', r.error) }) } } })
      await reloadShare()
    } finally { release() }
  }

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

  const shareLink = share?.link ?? null
  const badge = shareLink ? shareBadge(shareLink) : null

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 -mt-1 flex-wrap">
        <a href={`/contract/${tenantId}`} target="_blank" rel="noreferrer"
          className="px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
          출력 / 서명 받기
        </a>
        <button type="button" onClick={handleShareSend} disabled={sharePending}
          className="px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors disabled:opacity-60">
          {sharePending ? '발급 중…' : badge?.active ? '다시 보내기' : '계약서 보내기'}
        </button>
        <label className={`px-2.5 py-1 text-[0.6875rem] font-medium rounded-lg cursor-pointer transition-colors ${uploading ? 'opacity-60' : 'bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)]'}`}>
          {uploading ? '업로드 중…' : '스캔 본 첨부'}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      {badge && (
        <div className="flex items-center gap-2">
          <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded font-medium ${badge.active ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
            {badge.label}
          </span>
          {badge.active && (
            <button type="button" onClick={handleShareClose} className="text-[0.6875rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)]">
              링크 닫기
            </button>
          )}
        </div>
      )}
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
