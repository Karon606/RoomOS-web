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
import { docFileLabel } from '@/lib/docBundle'
import { asDocNameStyle } from '@/lib/documentName'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { SectionHeader } from '@/components/ui/inventory/SectionHeader'
import { IssuedContractSheet } from '@/components/doc/IssuedContractSheet'
import {
  getContractFiles, deleteContractFile, restoreContractFile, changeContractPurpose, getDeletedContractFiles,
  createContractScanUploadSession, finalizeContractScan,
  type ContractFileRow,
} from '@/app/(app)/tenants/actions'
import { restoreContractVersion, getIssuePurposeContext } from '@/app/contract/[tenantId]/actions'
import { issuedNextStepMessage } from '@/lib/contractLockMessage'
import { currentIssueIds, issueGroupKey as canonIssueGroupKey } from '@/lib/contractCurrentIssue'
import {
  contractPurposeLabel, contractPurposeOf, CONTRACT_PURPOSES, DEFAULT_CONTRACT_PURPOSE,
  type ContractPurpose,
} from '@/lib/contractPurpose'
import {
  issueContractShareLink, getContractShareState,
  closeContractShareLink, reopenContractShareLink,
  type ContractShareLinkInfo,
} from '@/app/(app)/tenants/contractShare'
import { uploadFileToDriveSession } from '@/lib/driveUpload'
import { SendDocButton } from '@/components/ui/SendDocButton'
import { fetchDocBytes } from '@/lib/docBytes'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { Modal } from '@/components/ui/Modal'
import { fmtDateDot } from '@/lib/fmtDate'
import { Btn, BtnLink, btnClass } from '@/components/ui/Btn'
import { fmtRoomNo } from '@/lib/roomNo'
import { trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog, choiceDialog } from '@/components/ui/ConfirmDialog'
import { subscribeContractFiles } from '@/lib/contractFilesBus'
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
const issueGroupKey = (f: { id: string; leaseTermId: string | null }) => canonIssueGroupKey(f)

// 목적 표기 — 실계약이면 null 이라 아무것도 안 그린다(lib/contractPurpose 정본).
const purposeLabel = (f: { issuePurpose: string | null }) => contractPurposeLabel(f.issuePurpose)

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
  // 여러 판본 만들기 토글 — 안내 문구가 가리킬 길이 하나인지 둘인지 가른다.
  // 게이트가 아니라 문구용이다(진짜 게이트는 서버가 다시 본다). 못 읽으면 꺼진 것으로 본다.
  const [multiVersion, setMultiVersion] = useState(false)
  // 용도를 바꾸려고 연 파일. 창은 3지선다(실계약·제출용·번역본)다.
  const [purposeFile, setPurposeFile] = useState<{ id: string; issuePurpose: string | null; leaseTermId: string | null } | null>(null)
  const [sharePending, setSharePending] = useState(false)
  const [restoring, setRestoring] = useState(false)
  // 발급 상세 시트 — 계약번호를 눌러 연다. 읽기 전용이라 목록 상태를 건드리지 않는다.
  const [detailId, setDetailId] = useState<string | null>(null)

  const reload = async () => {
    setLoading(true)
    try {
      setFiles(await getContractFiles(tenantId))
      // 삭제본은 같은 왕복에서 함께 읽는다 — 따로 부르면 복구 직후 두 목록이 잠시 갈린다.
      setDeletedFiles(await getDeletedContractFiles(tenantId).catch(() => []))
    }
    finally { setLoading(false) }
  }
  const reloadShare = async () => {
    const res = await getContractShareState(tenantId)
    if (res.ok) setShare({ link: res.link, phone: res.phone, propertyName: res.propertyName, needsIssue: res.needsIssue, hasForeignRegNo: res.hasForeignRegNo })
    // 실패해도 null 로 두지 않는다 — stage 가 판정을 못 해 주 버튼도 안내도 없는 회색 화면으로 굳는다
    else { setShare({ link: null, phone: null, propertyName: '', needsIssue: false, hasForeignRegNo: false }); pushToast('error', res.error) }
  }
  // 토글은 영업장 값이라 입주자가 바뀌어도 같지만, 이 패널이 뜨는 시점에 한 번은 읽어야 한다.
  // 실패하면 꺼진 것으로 둔다 — 없는 버튼을 가리키는 안내보다 한 길만 말하는 안내가 낫다.
  const reloadMultiVersion = async () => {
    const res = await getIssuePurposeContext(tenantId, leaseTermId ?? null)
    setMultiVersion(res.ok && res.multiVersion)
  }
  useEffect(() => { reload(); reloadShare(); reloadMultiVersion() }, [tenantId]) // eslint-disable-line react-hooks/exhaustive-deps
  // 목록 밖에서 용도가 바뀌면 다시 읽는다 — 발급 토스트의 적용취소가 그 자리다(§27.1).
  useEffect(() => subscribeContractFiles(() => { void reload() }), []) // eslint-disable-line react-hooks/exhaustive-deps

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
    // 이 계약에 실계약이 이미 있으면 **올리기 전에** 묻는다. 업로드가 끝난 뒤에 물으면 취소가
    // Drive 파일 삭제라는 실 동작을 부르고(§27.5 취소 무해), 수 초 기다린 끝에 불쑥 뜬 창은
    // 반사적으로 눌린다. 그 반사 탭이 419호 사고(옛 스캔본이 대표를 뺏음)의 재료다.
    // 기본은 보관용 등록이다 — 성급한 확정이 기존 계약서를 밀어내지 않는 쪽이 안전하다.
    let decision: 'real' | 'archived' | undefined
    // **서버와 같은 계약만 센다.** 사람 전체에서 세면 지난 계약의 실계약 때문에 없는 충돌로
    // 창이 뜨고, 그 창이 적는 부수도 서버가 실제로 밀어낼 수와 다르다(§14 건수는 실데이터).
    const liveReal = (files ?? []).filter(f =>
      !f.voidedAt && !purposeLabel(f) && (f.leaseTermId ?? null) === (leaseTermId ?? null)).length
    if (liveReal > 0) {
      const pick = await choiceDialog({
        title: '이 스캔본을 어떤 계약서로 올릴까요?',
        message: `이 계약에는 실계약 계약서가 이미 ${liveReal}부 있습니다. 실계약으로 올리면 기존 실계약 ${liveReal}부는 보관용으로 바뀌고, 보관용으로 올리면 기존 계약서가 실계약으로 남습니다.`,
        level: 'caution',
        confirmLabel: '보관용 등록',
        altLabel: '실계약 등록',
      })
      if (pick !== 'confirm' && pick !== 'alt') return
      decision = pick === 'confirm' ? 'archived' : 'real'
    }
    setUploading(true)
    const release = trackSave()
    try {
      const session = await createContractScanUploadSession({
        tenantId, fileName: file.name, mimeType: file.type || 'application/octet-stream', fileSize: file.size,
        origin: window.location.origin,
      })
      if (!session.ok) { pushToast('error', session.error); return }
      const driveFileId = await uploadFileToDriveSession(session.uploadUrl, file)
      const fin = await finalizeContractScan({ tenantId, driveFileId, fileName: file.name, decision })
      if (!fin.ok) { pushToast('error', fin.error); return }
      // 화면이 낡아 못 물었을 때의 그물 — 서버가 안전한 쪽(보관용)으로 넣고 여기서 되묻는다.
      let promoted = false
      if (fin.needsDecision) {
        const promote = await confirmDialog({
          title: '이 스캔본을 실계약으로 올릴까요?',
          message: '이 계약에는 실계약 계약서가 이미 있어서 스캔본을 보관용으로 등록했습니다. 실계약으로 바꾸면 기존 실계약이 보관용으로 바뀝니다.',
          level: 'caution', confirmLabel: '실계약으로',
        })
        if (promote) {
          const r = await changeContractPurpose(fin.id, DEFAULT_CONTRACT_PURPOSE)
          if (r.ok) promoted = true
          else pushToast('error', r.error)
        }
      }
      const archived = fin.archivedCount ?? 0
      pushToast('success', '스캔본 등록됨',
        archived > 0 ? { detail: `기존 실계약 ${archived}부는 보관용으로 바뀜` }
        : promoted ? { detail: '이 스캔본이 실계약이 됐습니다. 되돌리려면 각 계약서의 용도에서 바꾸세요.' }
        : undefined)
      await reload()
    } catch (err) {
      pushToast('error', (err as Error).message ?? '업로드 실패')
    } finally { release(); setUploading(false) }
  }

  // 용도 바꾸기 — 방향에 따라 무게가 다르다(설계 승인 2026-08-26).
  //   · 파생에서 실계약으로(승격) = caution. 이번 419 사고의 정정 경로다.
  //   · 실계약에서 파생으로(강등) = danger. 원 규약이 막던 방향이라 서버가 마지막 실계약이면 거부한다.
  // 성공 토스트에 적용취소를 단다(§16) — 되돌리기는 새 변경이 아니라 직전 값 복원이라 게이트를 안 탄다.
  const handleChangePurpose = async (to: ContractPurpose) => {
    const f = purposeFile
    if (!f) return
    const from = contractPurposeOf(f.issuePurpose)
    setPurposeFile(null)
    if (from === to) return
    const demote = from === DEFAULT_CONTRACT_PURPOSE && to !== DEFAULT_CONTRACT_PURPOSE
    const ok = await confirmDialog({
      title: `이 계약서를 '${to}' 으로 바꿀까요?`,
      message: demote
        ? '실계약 계약서를 다른 용도로 내립니다. 이 계약의 대표 계약서 자리가 비게 되고, 서류 보내기에서 실계약 계약서가 없다고 표시됩니다. 발급할 때 무엇으로 만들었는지는 기록에 그대로 남습니다.'
        : '이 계약서를 실제 계약서로 취급합니다. 발급할 때 무엇으로 만들었는지는 기록에 그대로 남고, 바꾼 이력도 함께 남습니다.',
      level: demote ? 'danger' : 'caution',
      // danger 는 irreversibleNote 를 무조건 찍는데(ConfirmDialog 정본) 기본 문구가 '되돌릴 수
      // 없습니다'다. 이 동작은 바로 다음 토스트에서 되돌릴 수 있어 그 문장이 거짓이 된다(§16).
      irreversibleNote: demote
        ? '발급할 때의 용도는 기록에 그대로 남습니다.'
        : undefined,
      confirmLabel: '바꾸기',
    })
    if (!ok) return
    const res = await changeContractPurpose(f.id, to)
    if (!res.ok) { pushToast('error', res.error); return }
    reload()
    pushToast('success', `용도를 '${to}' 으로 바꿨습니다`, {
      action: {
        label: '적용취소',
        run: () => {
          void changeContractPurpose(f.id, from, { undo: true }).then(r => {
            if (r.ok) reload(); else pushToast('error', r.error)
          })
        },
      },
    })
  }

  // 되살리기 — 삭제의 역이라 확인창 없이 바로 한다(§27.4 비파괴). 실패만 말한다.
  const handleRestoreFile = async (id: string) => {
    const res = await restoreContractFile(id)
    if (!res.ok) { pushToast('error', res.error); return }
    await reload()
    pushToast('success', '삭제를 되돌렸습니다')
  }

  const handleDelete = async (id: string) => {
    // 같은 계약에 여러 부가 있으면 무엇이 남는지 먼저 말한다. 한 부만 지웠는데 계약서가 통째로
    // 사라진 줄 알고 다시 발급하면 번호만 하나 더 늘어난다.
    // 세는 것은 **화면에 남는 부수**다. 접힌 폐기본까지 세면 아무것도 안 보이는데
    // "N부는 남습니다" 라고 말하게 된다. 지우는 대상이 폐기본이면 자기 자신은 애초에 안 세어진다.
    const target = files?.find(f => f.id === id)
    const key = target ? issueGroupKey(target) : ''
    const siblings = target
      ? Math.max(0, (liveGroupCount.get(key) ?? 0) - (target.voidedAt ? 0 : 1))
      : 0
    if (!(await confirmDialog({
      title: '이 계약서 파일을 삭제할까요?',
      message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.'
        + (siblings > 0 ? ` 다른 발급본 ${siblings}부는 남습니다.` : '')
        // 삭제를 '폐기'로 오해한 것이 신고 63cd1049 의 출발점이다. 삭제는 파일만 정리하고
        // 서명 잠금은 손대지 않는다 — 그 사실을 누르기 전에 말한다.
        + ' 삭제는 파일만 정리합니다. 서명이 남아 있으면 계약서는 여전히 잠겨 있으니,'
        + " 내용을 바꿔 다시 작성하려면 계약서 화면에서 '이 계약서 폐기' 를 눌러 주세요."
        // 이 발급으로 물러난 부가 있으면 그 사실을 말한다. 뒤에 창을 하나 더 세우면 확인 연쇄가
        // 되고(§14), 삭제 토스트의 액션 자리는 삭제 자체의 적용취소가 이미 쓰고 있다.
        + ' 이 계약서를 만들며 보관용으로 바뀐 계약서는 자동으로 돌아오지 않습니다. 각 계약서의'
        + " '용도' 에서 되돌릴 수 있습니다.",
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

  // 폐기 적용취소 — 서버 정본(restoreContractVersion)이 폐기 직전 상태를 통째로 되돌린다.
  // 그 사이 새 서명이 들어왔으면 서버가 거부한다. 그때 버튼을 감추지 않고 이유를 말하는 쪽을 택했다 —
  // 잠긴 컨트롤을 없애면 왜 없는지 아무도 모른다(ContractView 툴바가 쓰는 것과 같은 원칙).
  const handleRestoreVersion = async (leaseTermId: string) => {
    if (restoring) return
    setRestoring(true)
    const release = trackSave()
    try {
      const res = await restoreContractVersion(leaseTermId, 'void')
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '폐기를 되돌렸습니다.')
      await reload()
      await reloadShare()
    } finally { release(); setRestoring(false) }
  }

  // 같은 계약의 발급본이 몇 부인가 — 다중 버전 표시(머리·계약번호 줄·[현재])는 전부 이 값이 2 이상일
  // 때만 켠다. 지금 40계약이 1부뿐이고, 그 화면은 종전과 같은 골격이어야 한다.
  const groupCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of files ?? []) m.set(issueGroupKey(f), (m.get(issueGroupKey(f)) ?? 0) + 1)
    return m
  }, [files])
  const hasMultiIssue = [...groupCount.values()].some(v => v > 1)
  // 목록은 폐기본을 기본으로 접는다(운영자 결정 2026-08-20) — **숨김이지 삭제가 아니다.**
  // 세는 일은 여전히 전량(files)으로 한다. 접힌 행까지 세어야 [현재]·계약번호 줄·삭제 안내가
  // 종전과 같은 답을 낸다(보이는 것만 세면 형제가 가려졌을 때 화면이 거짓말을 한다).
  // hidden 은 토글이 꺼진 영업장의 파생 판본이다 — 서버가 표시만 접으라고 표시해 준 행이라
  // 화면 어느 목록에도 세우지 않는다(폐기본과 달리 펼치는 길도 두지 않는다. 토글을 켜면 돌아온다).
  const liveFiles = useMemo(() => (files ?? []).filter(f => !f.voidedAt && !f.hidden), [files])
  const voidedFiles = useMemo(() => (files ?? []).filter(f => f.voidedAt && !f.hidden), [files])
  const [showVoided, setShowVoided] = useState(false)
  // 삭제한 계약서 — 삭제 직후 토스트가 사라지면 되살릴 길이 없던 자리(§16). 419호가 그 사고였다.
  const [deletedFiles, setDeletedFiles] = useState<{ id: string; fileName: string; contractNo: string | null; signedAt: Date; deletedAt: Date }[]>([])
  const [showDeleted, setShowDeleted] = useState(false)
  // 삭제 안내의 '다른 발급본 N부' 는 **화면에 남는 부수**를 말해야 한다. 접힌 폐기본까지 세면
  // 아무것도 안 보이는데 "N부는 남습니다" 라고 하는 상태가 된다.
  const liveGroupCount = useMemo(() => {
    const m = new Map<string, number>()
    for (const f of liveFiles) m.set(issueGroupKey(f), (m.get(issueGroupKey(f)) ?? 0) + 1)
    return m
  }, [liveFiles])
  // 용도 창을 연 계약서 말고, 같은 계약에 살아 있는 실계약이 몇 부인가 — 승격 캡션이 이 값으로
  // 말을 가른다. 실계약이 둘이 되면 대표는 최신 발급본이라 승격한 부가 아니다.
  const otherLiveReal = useMemo(() => {
    if (!purposeFile) return 0
    return liveFiles.filter(f =>
      f.id !== purposeFile.id
      && (f.leaseTermId ?? null) === purposeFile.leaseTermId
      && !f.voidedAt
      && !purposeLabel(f)).length
  }, [liveFiles, purposeFile])
  // 폐기를 되돌릴 대상 계약 — 폐기는 파일 하나가 아니라 **버전 하나**를 옮기는 일이라
  // 되돌리기도 계약 단위다(restoreContractVersion). 행마다 달면 3부일 때 세 번 누를 수 있는
  // 것처럼 보이지만 실제로는 한 번의 동작이다.
  const voidedLeaseIds = useMemo(
    () => [...new Set(voidedFiles.map(f => f.leaseTermId).filter((v): v is string => !!v))],
    [voidedFiles],
  )
  // 그룹별 대표 1부 — 판정은 정본 하나다(lib/contractCurrentIssue). 실계약이 고정 대표이고,
  // 실계약이 여럿일 때만 createdAt 이 동률을 가른다. 여기서 손으로 다시 세면 형제 화면·서류
  // 보내기와 서로 다른 종이를 '현재' 라고 부르게 된다.
  const currentIds = useMemo(() => new Set(currentIssueIds(files ?? []).values()), [files])

  const shareLink = share?.link ?? null
  const badge = shareLink ? shareBadge(shareLink) : null
  // 서명본으로 열 것인가 — signedAt(과거 사실)만으로는 부족하다. 서명을 지운 뒤에도 그 값은 남아서
  // 깨끗한 계약이 옛 스냅샷 화면에 영구히 갇혔다(502호 2026-08-10). 지금 서명이 있어야 서명본이다.
  const signedViewLinkId = shareLink?.signedAt && shareLink.signatureLive ? shareLink.id : null

  // 계약서 진행 단계 — 지금 할 일 하나만 주 버튼으로. 로딩 중에는 판정하지 않는다(색이 튀지 않게).
  //   S0 없음        : 계약서를 만드는 것부터
  //   S1 서명 대기   : 입주자가 아직 안 눌렀다 — 다시 보내기가 다음 수. 만료·잠김도 같은 계열이다
  //   S2 서명 받음   : 발급이 다음 수
  //   S3 보관됨      : 목록이 주인공이라 주 버튼 강조는 내리되, 안내는 남긴다(침묵 금지)
  //
  // 라벨은 단계와 무관하게 '계약서 작성·서명' 으로 고정한다. S2 에서 '계약서 발급' 으로 바꿔봤다가
  // 되돌렸다 — 그 링크는 입력 화면으로 가고 발급은 거기서 한 단계 더 들어가야 일어난다. 이 파일이
  // 정한 동사 정의(작성 = 입력 화면 진입 / 발급 = 공식본 생성·보관)를 라벨이 스스로 어기는 셈이고,
  // 누르면 발급될 줄 알았다가 폼이 나오는 배신이 된다. 단계 구분은 안내 문구가 한다(디자이너 패스).
  const stage: { primary: 'write' | 'issue' | 'resend' | null; hint: string | null } = (() => {
    // 조회 실패(share === null)여도 화면이 회색으로 굳지 않게 S0 으로 떨어뜨린다
    if (loading) return { primary: null, hint: null }
    if (share?.needsIssue) {
      // 서명본 문이 서 있으면 그것이 다음 수다. 서명이 지워져 그 문이 없으면 작성으로 되돌린다.
      return { primary: signedViewLinkId ? 'issue' : 'write', hint: '원격 서명을 받았습니다. 이제 계약서를 발급하면 됩니다.' }
    }
    // 폐기본은 '갖춰진 계약서'로 세지 않는다 — 전부 폐기된 계약의 다음 할 일은 다시 작성이고,
    // 그때 주 버튼이 사라지면 폐기하고 나서 무엇을 해야 하는지 화면이 말하지 않는다(신고 63cd1049).
    // 목록의 '등록된 계약서가 없습니다' 문구는 files.length 를 보므로 여기 변화에 흔들리지 않는다.
    //
    // S3 에서 주 버튼을 내리는 것은 그대로 두되 **안내는 반드시 남긴다**. 종전에는 hint 까지 함께
    // 비어 주 버튼 강조도 문구도 없는 상태가 됐고, 그 침묵이 501호 "계약서 작성·서명이 없다"의
    // 절반이었다(나머지 절반은 아래 라벨 교체였다, 2026-08-19 (11)).
    if ((files ?? []).some(f => !f.voidedAt)) {
      return {
        primary: null,
        hint: issuedNextStepMessage(multiVersion),
      }
    }
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
        {/* 한 컨트롤이 라벨과 목적지를 함께 갈아치우던 것을 둘로 쪼갠다.
            종전에는 서명본이 있으면 라벨이 '서명본 계약서 발급' 으로 바뀌고 href 도 ?share= 로
            옮겨 갔다. 작성으로 가는 문이 화면에서 통째로 사라진 셈이라 운영자는 "계약서
            작성·서명이 없다" 고 신고했다(501호 2026-08-19).
            라벨만 고정하고 href 만 가르는 것으로는 부족하다 — ?share= 가 여는 화면은 **서명 시점
            박제**이고 스스로 "지금 계약을 고치거나 서명을 다시 받으려면 일반 화면에서 하세요" 라고
            말한다(ContractView.tsx:941). 그 문으로 보내면서 '작성' 이라 부르면 배신의 방향만 바뀐다.
            그래서 작성 문은 항상 같은 자리에 같은 이름으로 서고, 서명본 발급은 있을 때만 옆에 선다. */}
        <BtnLink href={`/contract/${tenantId}`}
          variant={stage.primary === 'write' ? 'primary' : 'secondary'} size="sm">
          계약서 작성·서명
        </BtnLink>
        {signedViewLinkId && (
          <BtnLink href={`/contract/${tenantId}?share=${signedViewLinkId}`}
            variant={stage.primary === 'issue' ? 'primary' : 'secondary'} size="sm">
            서명본 계약서 발급
          </BtnLink>
        )}
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
      {/* 빈 판정은 **화면에 서는 목록**으로 한다. files.length 로 재면 폐기본만 남은 계약이
          '없습니다' 도 못 띄우고 빈 자리만 그린다(폐기본은 아래 접힘 칸으로 내려갔다). */}
      {!loading && files && liveFiles.length === 0 && (
        <p className="text-xs text-[var(--warm-muted)]">
          {stage.hint ? '등록된 계약서가 없습니다.' : '등록된 계약서가 없습니다. 계약서를 작성해 서명을 받거나 스캔본을 올리세요.'}
        </p>
      )}
      {/* 같은 계약에 2부 이상일 때만 머리를 세운다. 1부뿐인 계약에서는 이 줄이 없어 종전 골격 그대로다. */}
      {!loading && liveFiles.length > 0 && hasMultiIssue && (
        <SectionHeader first name="등록된 계약서" count={`${liveFiles.length}부`} />
      )}
      {!loading && liveFiles.length > 0 && (
        <ul className="space-y-1.5">
          {liveFiles.map(f => {
            const dt = new Date(f.signedAt)
            const dateLabel = `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
            // 식별 줄은 '어느 부인지 불러야 할 때'에만 띄운다 — 같은 계약에 2부 이상일 때.
            // 1부뿐이면 부를 일이 없어 줄을 세우지 않는다(40계약이 종전 골격 그대로다).
            const needsName = (groupCount.get(issueGroupKey(f)) ?? 1) > 1
            return (
              // 파일명은 더 이상 링크를 겸하지 않는다 — 링크처럼 보이지 않는 텍스트가 말없이 구글 드라이브로
              // 나가던 구조가 '앱에서 인쇄가 안 된다'의 절반이었다. 열람은 '보기'가 전담한다(§22 solid 1개).
              // 행 표면은 --cream 이다. 종전 --canvas 는 §03 이 정한 **페이지 배경** 토큰이라
              // 그 위에서는 배지·보조줄 대비가 통째로 내려앉았다(라이트 [현재] 4.16 · 보조줄 4.11 로
              // 둘 다 AA 미달). 형제 화면(/contracts)과 같은 모달 안 형제 칸들이 이미 --cream 이다.
              // 액션을 모바일에서 아래 줄로 내리는 것도 형제 정본을 따른다 — 한 줄을 고집하다
              // 이름 칸이 100px 대로 눌린 신고가 이미 있었다(71753b36, ContractsClient:301).
              <li key={f.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--cream)] border border-[var(--warm-border)]">
                <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                  {/* 어휘는 §용어 정본을 따른다(docs/document-screens-spec.md) — '서명 / 스캔' 은 사전에 없는 말이었다. */}
                  <span className={`text-[0.65625rem] px-1.5 py-0.5 rounded-sm font-medium ${f.source === 'GENERATED' ? 'bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]' : 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-1 ring-[var(--warning-ring)]'}`}>
                    {f.source === 'GENERATED' ? '앱 발급본' : '스캔본'}
                  </span>
                  {/* 지위 배지 — §11 트라이어드(-bg + -fg + inset ring) + pill 반경.
                      종전 coral 10% + ring 없음은 다크에서 3.03:1 이었다(--coral 은 다크 재정의가 없다). */}
                  {/* 배지를 띄울지는 표시 정책이다 — 1부뿐이면 비교 대상이 없어 세우지 않는다.
                      판정 자체(currentIds)는 부수를 안 본다. 서류 보내기가 1부짜리 계약의 대표도 물어보기 때문이다. */}
                  {needsName && currentIds.has(f.id) && (
                    <span className="text-[0.65625rem] px-1.5 py-0.5 rounded-sm font-medium bg-[var(--success-bg)] text-[var(--success-fg)] ring-1 ring-[var(--success-ring)]">현재</span>
                  )}
                  <div className="flex-1 min-w-0 basis-full sm:basis-auto">
                    <span className="block text-xs text-[var(--warm-dark)] truncate">
                      {tenantName} · {dateLabel}
                    </span>
                    {/* 계약번호가 곧 이 발급본의 이름이다. 눌러 발급 기록을 연다(§30 행 액션 4개는 그대로).
                        번호가 없는 구본·스캔본은 형제 화면(/contracts)과 같은 규칙으로 파일명을 남긴다 —
                        2부가 나란히 서면 둘 다 "이름 · 날짜" 라 이 줄이 없으면 어느 것을 지우는지 알 수 없다. */}
                    {(needsName || purposeLabel(f)) && (
                      <p className="mt-0.5 flex max-w-full items-baseline gap-1 truncate text-[0.6875rem] text-[var(--warm-muted)]">
                        {f.contractNo ? (
                          <button type="button" onClick={() => setDetailId(f.id)}
                            className="max-w-full truncate hover:text-[var(--coral)] transition-colors">
                            계약번호 {f.contractNo}
                          </button>
                        ) : (
                          <span className="max-w-full truncate">{f.fileName}</span>
                        )}
                        {/* 목적은 배지가 아니라 보조줄이다 — 배지 슬롯은 출처와 지위로 이미 둘이고,
                            §11 상한이 2개다. 실계약은 아예 안 적는다(기본값이 대다수 행에 붙으면 소음). */}
                        {purposeLabel(f) && <span className="shrink-0">· {purposeLabel(f)}</span>}
                      </p>
                    )}
                  </div>
                </div>
                {/* 액션이 넷이라 한 줄을 고집하면 320px 에서 '내보내기'가 글자 중간에서 꺾인다 —
                    형제 화면이 같은 4액션에서 이미 겪고 풀어 둔 클래스다(신고 71753b36). */}
                <div className="flex items-center gap-1.5 flex-wrap sm:shrink-0 sm:justify-end">
                  <ViewDocButton driveFileId={f.driveFileId} from="tenant" tenantId={tenantId} />
                  <SendDocButton getPdfBytes={fetchDocBytes(f.driveFileId)} fileName={`${tenantName}_${docFileLabel('contract', asDocNameStyle(f.nameStyle) ?? 'ko')}_${dateLabel}`}
                    className={btnClass('secondary', 'sm')} />
                  {/* 용도 바꾸기 — 여러 판본 만들기가 켜진 영업장만. 꺼져 있으면 파생 개념 자체가 없다.
                      발급 때 잘못 고른 목적을 되돌리는 유일한 문이다(2026-08-26 규약 개정). */}
                  {multiVersion && (
                    <Btn variant="ghost" size="sm"
                      onClick={() => setPurposeFile({ id: f.id, issuePurpose: f.issuePurpose, leaseTermId: f.leaseTermId ?? null })}>용도</Btn>
                  )}
                  <Btn variant="ghost" size="sm" onClick={() => handleDelete(f.id)}
                    className="text-[var(--danger-fg)]">
                    삭제
                  </Btn>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      {/* 삭제한 계약서 — 폐기 칸과 같은 접힘 문법이지만 다른 사실이다(폐기는 효력 상실, 삭제는 파일 정리).
          삭제 직후 토스트가 사라진 뒤에도 되살릴 길이 여기 남는다(§16). 0부면 줄 자체를 안 그린다. */}
      {!loading && deletedFiles.length > 0 && (
        <div className="pt-1">
          <button type="button" onClick={() => setShowDeleted(v => !v)}
            className="-my-2 min-h-[44px] text-xs font-medium text-[var(--warm-muted)] inline-flex items-center gap-1">
            {showDeleted ? '삭제한 계약서 숨기기' : `삭제한 계약서 ${deletedFiles.length}부 보기`}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showDeleted ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showDeleted && (
            <>
              <p className="mt-2 text-[0.6875rem] leading-relaxed text-[var(--warm-muted)]">
                삭제한 계약서입니다. 원본은 Google Drive 휴지통에 있고 삭제한 날부터 30일이 지나면 영구 삭제됩니다. 그 전에는 여기서 되살릴 수 있습니다.
              </p>
              <ul className="mt-2 space-y-1.5">
                {deletedFiles.map(f => {
                  const left = 30 - Math.floor((Date.now() - new Date(f.deletedAt).getTime()) / 86400000)
                  return (
                    // 행을 흐리게 하지 않는다 — 이 줄이 담은 '복구 가능 N일 남음'이 이 칸의
                    // 유일한 결정 정보라, opacity 로 muted 티어와 겹치면 §28 대비 하한에 걸린다.
                    <li key={f.id} className="flex flex-col gap-2 rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] px-2.5 py-1.5 sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <span className="block truncate text-xs text-[var(--warm-dark)]">
                          {f.contractNo ? `계약번호 ${f.contractNo}` : f.fileName}
                        </span>
                        <span className="mt-0.5 block text-[0.6875rem] text-[var(--warm-mid)]">
                          {fmtDateDot(f.deletedAt)} 삭제{left > 0 ? ` · 복구 가능 ${left}일 남음` : ' · 영구 삭제되었을 수 있습니다'}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* 라벨은 §16 정본 '적용취소' 한 벌이다 — 형제(폐기 적용취소)와 같은 문형으로 맞춘다. */}
                        <Btn variant="secondary" size="sm" onClick={() => void handleRestoreFile(f.id)}>삭제 적용취소</Btn>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}

      {/* 용도 고르기 — 지금 값에 표시가 선다. '보관용'이 늘어 넷이 됐다(발급으로는 못 고르고
          여기서만 오간다 — 새 실계약에 밀려난 부를 되돌리는 자리가 여기다). */}
      {purposeFile && (
        <Modal open onClose={() => setPurposeFile(null)} z={280} width="sm" title="이 계약서의 용도">
          <div className="space-y-2">
            <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
              발급할 때 고른 용도는 기록에 그대로 남고, 여기서 바꾼 사실도 함께 남습니다. 실계약으로 바꾸면 이 계약의 대표 계약서가 됩니다.
            </p>
            <ul className="space-y-1.5">
              {CONTRACT_PURPOSES.map(pp => {
                const on = contractPurposeOf(purposeFile.issuePurpose) === pp
                return (
                  <li key={pp}>
                    <button type="button" onClick={() => void handleChangePurpose(pp)}
                      className={[
                        'flex w-full items-center gap-2.5 rounded-xl border bg-[var(--cream)] p-3 text-left transition-colors',
                        on ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]' : 'border-[var(--warm-border)]',
                      ].join(' ')}>
                      <span className={[
                        'grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border transition-colors',
                        on ? 'border-[var(--coral)] bg-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)] text-transparent',
                      ].join(' ')} aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-[var(--warm-dark)]">{pp}</span>
                        {pp === DEFAULT_CONTRACT_PURPOSE && (
                          <span className="mt-0.5 block text-[0.65625rem] text-[var(--warm-muted)]">
                            {/* 다른 실계약이 살아 있으면 대표는 최신 발급본이라 이 부가 아니다.
                                단정하면 그 경로에서 화면이 거짓말을 한다(디자이너 패스). */}
                            {otherLiveReal > 0
                              ? `실계약이 ${otherLiveReal + 1}부가 됩니다. 대표는 가장 최근 발급본입니다`
                              : '이 계약의 대표 계약서가 됩니다'}
                          </span>
                        )}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        </Modal>
      )}

      {/* 폐기한 계약서 — 접힘 칸(형제 정본: 같은 모달의 TenantWishRooms '더 보기'와 같은 문법).
          지운 것이 아니라 접어 둔 것이라, 토스트가 사라진 뒤에도 적용취소가 여기 남는다(§16).
          폐기본이 0부면 이 줄 자체를 안 그린다 — 지금 대부분의 계약이 그렇고 화면은 종전 그대로다. */}
      {!loading && voidedFiles.length > 0 && (
        <div className="pt-1">
          {/* -my-2 min-h-[44px] 는 보이는 크기를 그대로 두고 히트만 넓히는 정본 수법(RowActionBtn). */}
          <button type="button" onClick={() => setShowVoided(v => !v)}
            className="-my-2 min-h-[44px] text-xs font-medium text-[var(--warm-muted)] inline-flex items-center gap-1">
            {showVoided ? '폐기한 계약서 숨기기' : `폐기한 계약서 ${voidedFiles.length}부 보기`}
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 transition-transform ${showVoided ? 'rotate-180' : ''}`} aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
          </button>
          {showVoided && (
            <>
              {/* 주어는 '이 계약서'다. '이 계약'이라고 쓰면 계약 자체가 없어진 것으로 읽힌다 —
                  입주자는 여전히 그 방에 살고 이용료를 낸다(계약 실무 검토 2026-08-20). */}
              <p className="mt-2 text-[0.6875rem] text-[var(--warm-muted)] leading-relaxed">
                폐기한 계약서는 계약 문서로서 효력이 없습니다. 발급 기록과 원본 파일은 증거로 그대로 보관되며, 이미 밖으로 나간 종이가 있으면 회수하거나 정정본을 다시 전달해 주세요.
              </p>
              <ul className="mt-2 space-y-1.5">
                {voidedFiles.map(f => {
                  const dt = new Date(f.signedAt)
                  const dateLabel = `${dt.getFullYear()}.${String(dt.getMonth()+1).padStart(2,'0')}.${String(dt.getDate()).padStart(2,'0')}`
                  return (
                    <li key={f.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--cream)] border border-[var(--warm-border)] opacity-55">
                      <div className="min-w-0 flex-1 flex items-center gap-1.5 flex-wrap">
                        {/* 지위 배지는 슬롯 하나의 배타값이다 — 폐기된 종이는 '현재' 도 '구버전' 도 아니다.
                            danger 트라이어드를 쓰는 것은 §04 의 무효 계열이고, 회색 계열과 색으로 갈린다. */}
                        <span className="text-[0.65625rem] px-1.5 py-0.5 rounded-sm font-medium bg-[var(--danger-bg)] text-[var(--danger-fg)] ring-1 ring-[var(--danger-ring)]">폐기됨</span>
                        <div className="flex-1 min-w-0 basis-full sm:basis-auto">
                          <span className="block text-xs text-[var(--warm-dark)] truncate line-through">
                            {tenantName} · {dateLabel}
                          </span>
                          {f.contractNo ? (
                            <button type="button" onClick={() => setDetailId(f.id)}
                              className="mt-0.5 block max-w-full truncate text-[0.6875rem] text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">
                              계약번호 {f.contractNo}
                            </button>
                          ) : (
                            <p className="mt-0.5 truncate text-[0.6875rem] text-[var(--warm-muted)]">{f.fileName}</p>
                          )}
                        </div>
                      </div>
                      {/* 보내기는 두지 않는다 — 효력 없는 종이를 내보내는 길을 열어두면 안 된다.
                          열람과 파일 정리는 남긴다(§30 행 액션 상한 안이다). */}
                      <div className="flex items-center gap-2 shrink-0">
                        <ViewDocButton driveFileId={f.driveFileId} from="tenant" tenantId={tenantId} />
                        <Btn variant="ghost" size="sm" onClick={() => handleDelete(f.id)}
                          className="text-[var(--danger-fg)]">
                          삭제
                        </Btn>
                      </div>
                    </li>
                  )
                })}
              </ul>
              {voidedLeaseIds.map(id => (
                // 히트영역만 44px 로 넓힌다 — 보이는 크기는 그대로 두는 정본 수법(RowActionBtn).
                <button key={id} type="button" onClick={() => handleRestoreVersion(id)} disabled={restoring}
                  className="mt-2 -my-1 min-h-[44px] inline-flex items-center text-xs font-medium text-[var(--coral)] disabled:opacity-60">
                  {restoring ? '되돌리는 중…' : '폐기 적용취소'}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {detailId && <IssuedContractSheet fileId={detailId} onClose={() => setDetailId(null)} />}
    </div>
  )
}
