'use client'

// 계약서 파일 관리 — 작성·서명 진입 + 서명 요청 문자 + 스캔본 올리기 + 목록 표시·삭제.
// TenantClient 에서 이주(2026-05-30): 셸의 고객 면과 페이지 자체 팝업 양쪽에서 재사용.
//
// 용어는 서류 정본 동사 5개를 따른다(2026-08-01 운영자 지적 후 정리).
//   발급 = 공식본을 만들어 보관·이력에 남김 · 보내기 = 만들어진 서류를 입주자에게 전달
//   저장 = 내 기기에 파일로 · 보기 = 열람만 · 작성 = 입력 화면 진입
// 종전 '출력 / 서명 받기'는 인쇄를 하지 않아 오해를 샀고, '계약서 보내기'는 서류가 아니라 서명 요청
// 링크가 나가는 동작이라 목적어를 붙여 '서명 요청 보내기'로 바꿨다. 스캔본 올리기는 앱 안으로 들어오는
// 유일한 방향이라 다섯 동사 밖 예외로 둔다.

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
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { Btn, BtnLink, btnClass } from '@/components/ui/Btn'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

// 원격 서명 링크 상태 배지 — 활성(남은 시간)/서명 완료/만료/닫힘/잠김
// closable: 닫기(=서명 완료 알림 해제) 가능 여부. 만료·잠김이어도 닫혀 있지만 않으면 닫을 수 있어야 한다 —
// 종전에는 active(만료 전)일 때만 닫기 버튼이 떠서, 만료된 링크는 '계약서 발급 필요' 알림을
// 끌 방법이 사라졌다(503호 송호준: 서명 완료·링크 만료·발급 전 상태로 알림 영구 잔존).
function shareBadge(link: ContractShareLinkInfo): { label: string; active: boolean; closable: boolean } {
  if (link.lockedAt) return { label: '링크 잠김 (생년월일 5회 오류)', active: false, closable: !link.closedAt }
  if (link.closedAt) return { label: '링크 닫힘', active: false, closable: false }
  const remainMs = new Date(link.expiresAt).getTime() - Date.now()
  if (remainMs <= 0) return { label: '링크 만료', active: false, closable: true }
  const remain = remainMs >= 60 * 60 * 1000
    ? `${Math.floor(remainMs / (60 * 60 * 1000))}시간 남음`
    : `${Math.max(1, Math.floor(remainMs / (60 * 1000)))}분 남음`
  if (link.signedAt) return { label: `서명 완료 · ${remain}`, active: true, closable: true }
  return { label: `서명 대기 · ${remain}`, active: true, closable: true }
}

// hideSignRequest: 수정 폼에서만 true. 서명 요청 링크는 발급 시점의 DB 값으로 templateSnapshot 을
// 굳히므로(schema.prisma:1431), 호실·임대료를 고치는 중에 보내면 저장 전 옛 값으로 스냅샷이 나간다.
// 배지와 닫기는 이 플래그와 무관하게 항상 렌더한다 — 알림 해제 경로가 사라지면 503호 건이 재발한다.
export function ContractFilesPanel({ tenantId, tenantName, hideSignRequest = false }: {
  tenantId: string
  tenantName: string
  hideSignRequest?: boolean
}) {
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

  // 서명 요청 보내기 — 활성 링크가 있으면 재사용(다시 보내기), 없으면 새로 만든 뒤 메시지 앱으로 이동
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
    const stillActive = new Date(link.expiresAt).getTime() > Date.now() && !link.lockedAt
    if (!(await confirmDialog({
      title: stillActive ? '이 서명 링크를 닫을까요?' : '이 건의 알림을 해제할까요?',
      message: stillActive
        ? '입주자가 더 이상 링크를 열 수 없게 됩니다. 만료 전에는 적용취소로 다시 열 수 있습니다.'
        : '이미 만료된 링크라 입주자 접근에는 변화가 없습니다. 홈의 "원격 서명 완료 · 계약서 발급 필요" 알림만 사라집니다. 정식 계약서를 발급하면 이 알림은 자동으로 사라집니다.',
      level: 'caution', confirmLabel: stillActive ? '닫기' : '알림 해제',
    }))) return
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
      pushToast('success', '스캔본 등록됨')
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
      {/* §22 — 액션 행에 solid 는 하나. 이 패널의 유일한 생산 동작인 '계약서 작성·서명'이 주 버튼이고
          서명 요청은 대안 경로(secondary), 스캔본 올리기는 예외 보정(ghost)이다. 셋이 같은 무게로
          서 있으면 어디서 시작하는지 화면이 알려주지 않는다(운영자가 헷갈린 자리). */}
      <div className="flex items-center gap-2 -mt-1 flex-wrap">
        <BtnLink href={`/contract/${tenantId}`} target="_blank" rel="noreferrer" variant="primary" size="sm">
          계약서 작성·서명
        </BtnLink>
        {!hideSignRequest && (
          <Btn variant="secondary" size="sm" onClick={handleShareSend} disabled={sharePending}>
            {sharePending ? '준비 중…' : badge?.active ? '서명 요청 다시 보내기' : '서명 요청 보내기'}
          </Btn>
        )}
        {/* 파일 input 을 감싸는 label 이라 Btn 을 쓸 수 없다 — 토큰은 btnClass 로 공유한다 */}
        <label className={btnClass('ghost', 'sm', `cursor-pointer ${uploading ? 'opacity-60' : ''}`)}>
          {uploading ? '올리는 중…' : '스캔본 올리기'}
          <input type="file" accept="application/pdf,image/*" className="hidden" onChange={handleUpload} disabled={uploading} />
        </label>
      </div>
      {badge && (
        <div className="flex items-center gap-2">
          <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded font-medium ${badge.active ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
            {badge.label}
          </span>
          {badge.closable && (
            <button type="button" onClick={handleShareClose} className="text-[0.6875rem] text-[var(--danger-fg)] hover:text-[var(--danger-fg)]">
              {badge.active ? '링크 닫기' : '알림 해제'}
            </button>
          )}
        </div>
      )}
      {loading && <SkeletonRows rows={2} />}
      {!loading && files && files.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)]">등록된 계약서가 없습니다. 계약서를 작성해 서명을 받거나 스캔본을 올리세요.</p>
      )}
      {!loading && files && files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map(f => {
            const dt = new Date(f.signedAt)
            const dateLabel = `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
            return (
              // 파일명은 더 이상 링크를 겸하지 않는다 — 링크처럼 보이지 않는 텍스트가 말없이 구글 드라이브로
              // 나가던 구조가 '앱에서 인쇄가 안 된다'의 절반이었다. 열람은 '보기'가 전담한다(§22 solid 1개).
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)]">
                <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded font-medium ${f.source === 'GENERATED' ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
                  {f.source === 'GENERATED' ? '서명' : '스캔'}
                </span>
                <span className="flex-1 min-w-0 text-xs text-[var(--warm-dark)] truncate">
                  {tenantName} · {dateLabel}
                </span>
                <ViewDocButton driveFileId={f.driveFileId} />
                <ShareDocButton driveFileId={f.driveFileId} fileName={`${tenantName}_계약서_${dateLabel}.pdf`}
                  className={btnClass('secondary', 'sm')} />
                <Btn variant="ghost" size="sm" onClick={() => handleDelete(f.id)}
                  className="text-[var(--danger-fg)]">
                  삭제
                </Btn>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
