'use client'

// 계약서 파일 관리 — 작성·서명 진입 + 서명 요청 문자 + 스캔본 올리기 + 목록 표시·삭제.
// TenantClient 에서 이주(2026-05-30): 셸의 입주자 면과 페이지 자체 팝업 양쪽에서 재사용.
//
// 용어는 서류 정본 동사 5개를 따른다(2026-08-01 운영자 지적 후 정리).
//   발급 = 공식본을 만들어 보관·이력에 남김 · 보내기 = 만들어진 서류를 입주자에게 전달
//   저장 = 내 기기에 파일로 · 보기 = 열람만 · 작성 = 입력 화면 진입
// 종전 '출력 / 서명 받기'는 인쇄를 하지 않아 오해를 샀고, '계약서 보내기'는 서류가 아니라 서명 요청
// 링크가 나가는 동작이라 목적어를 붙여 '서명 요청 보내기'로 바꿨다. 스캔본 올리기는 앱 안으로 들어오는
// 유일한 방향이라 다섯 동사 밖 예외로 둔다.

import { useEffect, useMemo, useState } from 'react'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { SectionHeader } from '@/components/ui/inventory/SectionHeader'
import { IssuedContractSheet } from '@/components/doc/IssuedContractSheet'
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
import { SendDocButton } from '@/components/ui/SendDocButton'
import { fetchDocBytes } from '@/lib/docBytes'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { Btn, BtnLink, btnClass } from '@/components/ui/Btn'
import { fmtRoomNo } from '@/lib/roomNo'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { confirmForeignRegNoLink } from '@/lib/foreignRegNoConfirm'
import { blockSmsIfStaging } from '@/lib/smsHref'

// 원격 서명 링크 상태 배지 — 활성(남은 시간)/서명 완료/만료/닫힘/잠김
// closable: 닫기(=서명 완료 알림 해제) 가능 여부. 만료·잠김이어도 닫혀 있지만 않으면 닫을 수 있어야 한다 —
// 종전에는 active(만료 전)일 때만 닫기 버튼이 떠서, 만료된 링크는 '계약서 발급 필요' 알림을
// 끌 방법이 사라졌다(503호 송호준: 서명 완료·링크 만료·발급 전 상태로 알림 영구 잔존).
function shareBadge(link: ContractShareLinkInfo): { label: string; active: boolean; closable: boolean } {
  // 횟수를 적지 않는다 — 한도가 계약서마다 다르다(외국인등록번호가 실린 계약은 3회, 그 외 5회).
  if (link.lockedAt) return { label: '링크 잠김 (생년월일 오류 한도 초과)', active: false, closable: !link.closedAt }
  // 제출 판정이 닫힘보다 먼저다. 제출은 서버가 이미 막는데(getActiveLink) 배지가 그걸 모르면
  // 죽은 링크를 '서명 완료 · 남은 시간'으로 표시해 운영자가 살아 있는 줄 안다(2026-08-02 조사).
  // 닫힘을 먼저 보면 제출 건이 그냥 '링크 닫힘'으로만 떠 정보가 줄어든다.
  if (link.submittedAt) return { label: '제출 완료 · 링크 닫힘', active: false, closable: false }
  if (link.closedAt) return { label: '링크 닫힘', active: false, closable: false }
  const remainMs = new Date(link.expiresAt).getTime() - Date.now()
  if (remainMs <= 0) return { label: '링크 만료', active: false, closable: true }
  const remain = remainMs >= 60 * 60 * 1000
    ? `${Math.floor(remainMs / (60 * 60 * 1000))}시간 남음`
    : `${Math.max(1, Math.floor(remainMs / (60 * 1000)))}분 남음`
  if (link.signedAt) return { label: `서명 완료 · ${remain}`, active: true, closable: true }
  return { label: `서명 대기 · ${remain}`, active: true, closable: true }
}

// 같은 계약의 발급본을 묶는 키. leaseTermId 가 없는 파일(연결이 끊긴 구본·스캔본)은 자기 자신이 한
// 그룹이다 — 무엇의 다른 버전인지 앱이 말할 수 없는데 묶으면 거짓말이 된다. 사람이 아니라 계약이
// 기준인 이유는 한 사람이 계약을 둘 가질 수 있고, 그 둘은 서로의 버전이 아니기 때문이다.
const issueGroupKey = (f: { id: string; leaseTermId: string | null }) => f.leaseTermId ?? `single:${f.id}`

// hideSignRequest: 수정 폼에서만 true. 서명 요청 링크는 발급 시점의 DB 값으로 templateSnapshot 을
// 굳히므로(schema.prisma:1431), 호실·임대료를 고치는 중에 보내면 저장 전 옛 값으로 스냅샷이 나간다.
// 배지와 닫기는 이 플래그와 무관하게 항상 렌더한다 — 알림 해제 경로가 사라지면 503호 건이 재발한다.
export function ContractFilesPanel({ tenantId, tenantName, hideSignRequest = false, leaseTermId, extraLeases }: {
  tenantId: string
  tenantName: string
  hideSignRequest?: boolean
  // 이 칸이 그리고 있는 계약 — 화면이 고른 대표 계약이다(부계약은 아래 extraLeases 가 받는다).
  // 서명 요청이 이 값을 실어야 화면과 종이가 같은 계약을 가리킨다(2026-08-13, 다호실 마무리).
  // 종전에는 지목이 없어 서버가 제 추론으로 계약을 다시 골랐다 — 계약이 하나뿐인 사람에게는 늘
  // 같은 답이지만, 방을 둘 쓰는 사람에게는 화면이 말하는 계약과 스냅샷이 갈릴 수 있었다.
  // 안 넘기면 종전 추론 그대로다(하위 호환) — 수정 폼처럼 서명 요청이 없는 자리는 넘길 것도 없다.
  leaseTermId?: string | null
  // 이 사람의 부계약(창고·사무실 명의 등) — 있으면 그 계약의 계약서로 바로 들어가는 문을 하나씩 연다.
  // 계약이 하나뿐인 사람에게는 undefined 라 버튼 행이 종전 그대로다(2026-08-13, 1인 다호실).
  // 주 버튼(계약서 작성·서명)은 지목 없이 종전 URL 을 유지한다 — 추론이 고르는 계약이 곧 메인이다.
  extraLeases?: { id: string; roomNo: string | null }[]
}) {
  const [files, setFiles]   = useState<ContractFileRow[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  // 원격 서명 링크 상태 (최신 링크 1건 + 문자 발송용 연락처·영업장명)
  const [share, setShare] = useState<{ link: ContractShareLinkInfo | null; phone: string | null; propertyName: string; needsIssue: boolean; hasForeignRegNo: boolean } | null>(null)
  const [sharePending, setSharePending] = useState(false)
  // 발급 상세 시트 — 계약번호를 눌러 연다. 읽기 전용이라 목록 상태를 건드리지 않는다.
  const [detailId, setDetailId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try { setFiles(await getContractFiles(tenantId)) }
    finally { setLoading(false) }
  }
  const reloadShare = async () => {
    const res = await getContractShareState(tenantId)
    if (res.ok) setShare({ link: res.link, phone: res.phone, propertyName: res.propertyName, needsIssue: res.needsIssue, hasForeignRegNo: res.hasForeignRegNo })
    // 실패해도 null 로 두지 않는다 — stage 가 판정을 못 해 주 버튼도 안내도 없는 회색 화면으로 굳는다
    else { setShare({ link: null, phone: null, propertyName: '', needsIssue: false, hasForeignRegNo: false }); pushToast('error', res.error) }
  }
  useEffect(() => { reload(); reloadShare() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps

  // sms: 링크 조립 — NoticeSmsModal 과 동일한 기기 분기(애플은 sms://open?addresses=, 그 외 sms:번호)
  const openSms = (url: string, phone: string, propertyName: string) => {
    if (blockSmsIfStaging()) return
    const body = `[${propertyName}] 입실 계약서입니다. 아래 링크에서 계약 내용을 확인하고 서명해 주세요. 확인을 위해 본인 생년월일 입력이 필요합니다. 제출하시면 링크는 닫히고, 제출 전이라도 24시간 뒤 만료됩니다. ${url}`
    const num = phone.replace(/[^0-9+]/g, '')
    const enc = encodeURIComponent(body)
    const isApple = typeof navigator !== 'undefined' && /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)
    window.location.href = isApple ? `sms://open?addresses=${num}&body=${enc}` : `sms:${num}?body=${enc}`
  }

  // 서명 요청 보내기 — 활성 링크가 있으면 재사용(다시 보내기), 없으면 새로 만든 뒤 메시지 앱으로 이동
  const handleShareSend = async () => {
    if (sharePending) return
    if (!(await confirmForeignRegNoLink(share?.hasForeignRegNo))) return
    setSharePending(true)
    const release = trackSave()
    try {
      const res = await issueContractShareLink(tenantId, leaseTermId ?? null)
      if (!res.ok) { pushToast('error', res.error); return }
      await reloadShare()
      if (!res.phone) { pushToast('error', '주 연락처가 없어 문자를 보낼 수 없습니다. 입주자 정보에서 연락처를 먼저 등록해 주세요.'); return }
      openSms(res.link.url, res.phone, res.propertyName)
    } finally { release(); setSharePending(false) }
  }

  // 링크 닫기 — 적용취소(다시 열기)는 만료 전만 가능.
  // 문구는 '살아 있는 링크냐'가 아니라 '홈 알림이 실제로 떠 있느냐(needsIssue)'로 가른다.
  // 종전에는 만료이기만 하면 '알림 해제'라고 하고 없는 알림이 사라진다고 단언했다 — 서명 없이
  // 만료된 링크에는 그 알림이 애초에 없다(디자이너 지적 2026-08-01).
  const handleShareClose = async () => {
    const link = share?.link
    if (!link) return
    const clearsAlert = share?.needsIssue === true
    const stillActive = new Date(link.expiresAt).getTime() > Date.now() && !link.lockedAt
    if (!(await confirmDialog({
      title: clearsAlert ? '이 건의 알림을 해제할까요?' : '이 서명 링크를 닫을까요?',
      message: clearsAlert
        ? '홈의 "원격 서명 완료 · 계약서 발급 필요" 알림이 사라집니다. 계약서를 발급하거나 스캔본을 올리면 이 알림은 자동으로 사라집니다.'
        : stillActive
          ? '입주자가 더 이상 링크를 열 수 없게 됩니다. 만료 전에는 적용취소로 다시 열 수 있습니다.'
          : '이미 만료된 링크라 입주자 접근에는 변화가 없습니다. 목록에서 이 링크 표시만 정리됩니다.',
      level: 'caution', confirmLabel: clearsAlert ? '알림 해제' : '닫기',
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
    // 같은 계약에 여러 부가 있으면 무엇이 남는지 먼저 말한다. 한 부만 지웠는데 계약서가 통째로
    // 사라진 줄 알고 다시 발급하면 번호만 하나 더 늘어난다.
    const target = files?.find(f => f.id === id)
    const siblings = target ? (groupCount.get(issueGroupKey(target)) ?? 1) - 1 : 0
    if (!(await confirmDialog({
      title: '이 계약서 파일을 삭제할까요?',
      message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.'
        + (siblings > 0 ? ` 다른 발급본 ${siblings}부는 남습니다.` : ''),
      level: 'danger', confirmLabel: '삭제',
    }))) return
    const release = trackSave()
    try {
      const res = await deleteContractFile(id)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '삭제됨', { action: { label: '적용취소', run: () => { void restoreContractFile(id).then(r => { if (r.ok) reload(); else pushToast('error', r.error) }) } } })
      await reload()
    } finally { release() }
  }

  // 같은 계약의 발급본이 몇 부인가 — 다중 버전 표시(머리·계약번호 줄·[현재])는 전부 이 값이 2 이상일
  // 때만 켠다. 지금 40계약이 1부뿐이고, 그 화면은 종전과 같은 골격이어야 한다.
  const groupCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of files ?? []) m.set(issueGroupKey(f), (m.get(issueGroupKey(f)) ?? 0) + 1)
    return m
  }, [files])
  const hasMultiIssue = [...groupCount.values()].some(v => v > 1)
  // 그룹별 최신 1부 — createdAt 기준. signedAt 은 서명일이라 자정으로 고정돼 같은 날 두 부를 못 가르고,
  // contractNo 는 번호 도입(2026-08-03) 이전 발급본이 null 이라 정렬 자체가 안 된다.
  // 실측 황인정 2부가 정확히 그 모양이다 — signedAt 동일, 한쪽 contractNo null.
  const currentIds = useMemo(() => {
    const ids = new Set<string>()
    for (const [key, n] of groupCount) {
      if (n < 2) continue
      const newest = (files ?? []).filter(f => issueGroupKey(f) === key)
        .reduce((a, b) => (a.createdAt > b.createdAt ? a : b))
      ids.add(newest.id)
    }
    return ids
  }, [files, groupCount])

  const shareLink = share?.link ?? null
  const badge = shareLink ? shareBadge(shareLink) : null
  // 서명본으로 열 것인가 — signedAt(과거 사실)만으로는 부족하다. 서명을 지운 뒤에도 그 값은 남아서
  // 깨끗한 계약이 옛 스냅샷 화면에 영구히 갇혔다(502호 2026-08-10). 지금 서명이 있어야 서명본이다.
  const signedViewLinkId = shareLink?.signedAt && shareLink.signatureLive ? shareLink.id : null

  // 계약서 진행 단계 — 지금 할 일 하나만 주 버튼으로. 로딩 중에는 판정하지 않는다(색이 튀지 않게).
  //   S0 없음        : 계약서를 만드는 것부터
  //   S1 서명 대기   : 입주자가 아직 안 눌렀다 — 다시 보내기가 다음 수. 만료·잠김도 같은 계열이다
  //   S2 서명 받음   : 발급이 다음 수
  //   S3 보관됨      : 목록이 주인공이라 주 버튼을 두지 않는다
  //
  // 라벨은 단계와 무관하게 '계약서 작성·서명' 으로 고정한다. S2 에서 '계약서 발급' 으로 바꿔봤다가
  // 되돌렸다 — 그 링크는 입력 화면으로 가고 발급은 거기서 한 단계 더 들어가야 일어난다. 이 파일이
  // 정한 동사 정의(작성 = 입력 화면 진입 / 발급 = 공식본 생성·보관)를 라벨이 스스로 어기는 셈이고,
  // 누르면 발급될 줄 알았다가 폼이 나오는 배신이 된다. 단계 구분은 안내 문구가 한다(디자이너 패스).
  const stage: { primary: 'write' | 'resend' | null; hint: string | null } = (() => {
    // 조회 실패(share === null)여도 화면이 회색으로 굳지 않게 S0 으로 떨어뜨린다
    if (loading) return { primary: null, hint: null }
    if (share?.needsIssue) {
      return { primary: 'write', hint: '원격 서명을 받았습니다. 이제 계약서를 발급하면 됩니다.' }
    }
    if ((files?.length ?? 0) > 0) return { primary: null, hint: null }
    // 서명 전 링크가 살아 있거나 죽어 있거나 — 다음 수는 똑같이 '서명 요청 다시 보내기' 다.
    // 만료·잠김을 S0 으로 흘려보내면 방금 보냈다는 사실이 화면에서 지워진다(디자이너 지적).
    if (shareLink && !shareLink.signedAt && !shareLink.closedAt) {
      const hint = shareLink.lockedAt
        ? '생년월일 입력 오류가 한도에 닿아 링크가 잠겼습니다. 서명 요청을 다시 보내면 풀립니다.'
        : new Date(shareLink.expiresAt).getTime() <= Date.now()
          ? '서명 요청 링크가 만료됐습니다. 다시 보내 주세요.'
          : '입주자가 아직 서명하지 않았습니다.'
      // 수정 폼에는 서명 요청 버튼이 없어 안내가 막다른 길이 된다 — 그 경로에서는 문구를 걷는다
      return hideSignRequest ? { primary: 'write', hint: null } : { primary: 'resend', hint }
    }
    return { primary: 'write', hint: null }
  })()

  return (
    <div className="space-y-2">
      {/* §22 — 액션 행에 solid 는 하나. 지금 상태에서 '다음에 할 일'만 주 버튼으로 올리고 나머지는 내린다.
          상태와 무관하게 셋을 같은 무게로 세워두면 어디서 시작하는지 화면이 알려주지 않는다(운영자 지적).
          단계별 안내 문구도 여기서 함께 정한다. */}
      <div className="flex items-center gap-2 -mt-1 flex-wrap">
        {/* 원격 서명이 들어온 뒤에는 **그 시점 내용**으로 열어야 한다. 서명은 A 에 했는데
            B 짜리 계약서가 나가면 그건 입주자가 서명한 문서가 아니다(2026-08-03).
            바뀐 내용으로 받으려면 서명 요청을 다시 보내 새 링크·새 계약서를 만든다. */}
        {/* 새 창으로 열지 않는다 — 홈화면 앱(standalone)에는 주소창이 없어 돌아오면 앱 두 번째 사본이 된다.
            계약서 작성 화면에는 자체 복귀 링크가 있다(ContractView 툴바). */}
        <BtnLink href={signedViewLinkId ? `/contract/${tenantId}?share=${signedViewLinkId}` : `/contract/${tenantId}`}
          variant={stage.primary === 'write' ? 'primary' : 'secondary'} size="sm">
          {signedViewLinkId ? '서명본 계약서 발급' : '계약서 작성·서명'}
        </BtnLink>
        {/* 부계약 계약서 — 종전에는 이 문이 없어 창고 계약서를 뽑을 길 자체가 없었다.
            발급 화면이 어느 계약을 그릴지 URL 로 지목한다(?leaseTermId=). 본문 문안은 별건이다. */}
        {extraLeases?.map(l => (
          <BtnLink key={l.id} href={`/contract/${tenantId}?leaseTermId=${l.id}`} variant="ghost" size="sm">
            {fmtRoomNo(l.roomNo, '호실 미지정')} 계약서
          </BtnLink>
        ))}
        {!hideSignRequest && (
          <Btn variant={stage.primary === 'resend' ? 'primary' : 'secondary'} size="sm"
            onClick={handleShareSend} disabled={sharePending}>
            {sharePending ? '준비 중…' : badge?.active ? '서명 요청 다시 보내기' : '서명 요청 보내기'}
          </Btn>
        )}
        {/* 파일 input 을 감싸는 label 이라 Btn 을 쓸 수 없다 — 토큰은 btnClass 로 공유한다.
            스캔본 올리기도 홈 알림을 해소한다(종이 계약 운영) — 감추지 않는다. */}
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
              {share?.needsIssue ? '알림 해제' : '링크 닫기'}
            </button>
          )}
        </div>
      )}
      {/* 안내는 액션 행 아래에 둔다 — 위에 두면 로딩 후 나타나면서 버튼 행이 통째로 밀린다(§17) */}
      {stage.hint && <p className="text-xs text-[var(--warm-muted)]">{stage.hint}</p>}
      {loading && <SkeletonRows rows={2} />}
      {!loading && files && files.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)]">
          {stage.hint ? '등록된 계약서가 없습니다.' : '등록된 계약서가 없습니다. 계약서를 작성해 서명을 받거나 스캔본을 올리세요.'}
        </p>
      )}
      {/* 같은 계약에 2부 이상일 때만 머리를 세운다. 1부뿐인 계약에서는 이 줄이 없어 종전 골격 그대로다. */}
      {!loading && files && files.length > 0 && hasMultiIssue && (
        <SectionHeader first name="보관된 계약서" count={`${files.length}부`} />
      )}
      {!loading && files && files.length > 0 && (
        <ul className="space-y-1.5">
          {files.map(f => {
            const dt = new Date(f.signedAt)
            const dateLabel = `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
            // 식별 줄은 '어느 부인지 불러야 할 때'에만 띄운다 — 같은 계약에 2부 이상일 때.
            // 1부뿐이면 부를 일이 없어 줄을 세우지 않는다(40계약이 종전 골격 그대로다).
            const needsName = (groupCount.get(issueGroupKey(f)) ?? 1) > 1
            return (
              // 파일명은 더 이상 링크를 겸하지 않는다 — 링크처럼 보이지 않는 텍스트가 말없이 구글 드라이브로
              // 나가던 구조가 '앱에서 인쇄가 안 된다'의 절반이었다. 열람은 '보기'가 전담한다(§22 solid 1개).
              <li key={f.id} className="flex flex-wrap items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)]">
                {/* 어휘는 §용어 정본을 따른다(docs/document-screens-spec.md) — '서명 / 스캔' 은 사전에 없는 말이었다. */}
                <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded font-medium ${f.source === 'GENERATED' ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
                  {f.source === 'GENERATED' ? '앱 발급본' : '스캔본'}
                </span>
                {currentIds.has(f.id) && (
                  <span className="text-[0.65625rem] px-1.5 py-0.5 rounded font-medium bg-[var(--coral)]/10 text-[var(--coral)]">현재</span>
                )}
                <div className="flex-1 min-w-0">
                  <span className="block text-xs text-[var(--warm-dark)] truncate">
                    {tenantName} · {dateLabel}
                  </span>
                  {/* 계약번호가 곧 이 발급본의 이름이다. 눌러 발급 기록을 연다(§30 행 액션 4개는 그대로).
                      번호가 없는 구본·스캔본은 형제 화면(/contracts)과 같은 규칙으로 파일명을 남긴다 —
                      2부가 나란히 서면 둘 다 "이름 · 날짜" 라 이 줄이 없으면 어느 것을 지우는지 알 수 없다. */}
                  {needsName && (f.contractNo ? (
                    <button type="button" onClick={() => setDetailId(f.id)}
                      className="mt-0.5 block max-w-full truncate text-[0.6875rem] text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">
                      계약번호 {f.contractNo}
                    </button>
                  ) : (
                    <p className="mt-0.5 truncate text-[0.6875rem] text-[var(--warm-muted)]">{f.fileName}</p>
                  ))}
                </div>
                <ViewDocButton driveFileId={f.driveFileId} from="tenant" tenantId={tenantId} />
                <SendDocButton getPdfBytes={fetchDocBytes(f.driveFileId)} fileName={`${tenantName}_계약서_${dateLabel}`}
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
      {detailId && <IssuedContractSheet fileId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
