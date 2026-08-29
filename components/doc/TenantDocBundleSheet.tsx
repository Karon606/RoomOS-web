'use client'

// 입주자 서류 묶음 보내기 — 한 사람의 보관 서류를 계약 축으로 세워 공유 시트 **한 번**으로 보낸다.
//
// 종전에는 서류 종류마다 목록 화면을 따로 열어 한 사람의 네 가지 종이를 네 번에 걸쳐 보냈다.
// 여기서 모으되 규칙은 그 네 화면 정본 그대로다 — 행 문법(보기 primary), 선택 체크박스(§22 22px r7),
// 하단 알약(DocMultiShareBar), 준비 큐·파일명(lib/useDocShare). 이 화면은 조립만 한다.
//
// 2단계에서 '보낼 곳'이 하나 늘었다(신고 44501308). 기기는 종전 공유 시트 그대로고, 메일은
// 서버가 Drive 에서 PDF 를 모아 한 통으로 보낸다. 메일 줄은 **메일 기능이 켜져 있을 때만** 선다 —
// 키가 없으면 이 화면은 1단계와 픽셀이 같다. 받는 주소는 저장된 이 사람의 주소 하나뿐이고
// 여기서 고칠 수 없다. 오타 한 글자가 곧 남의 사서함에 신원번호를 배달하는 길이라서다.
//
// 메일은 여기서 바로 나가지 않는다 — '메일 쓰기'가 확인 화면(TenantDocMailComposeSheet)을 열고,
// 제목·본문·답장 주소·첨부·미리보기를 모두 확인한 뒤에야 발송된다(운영자 요구 2026-08-25).
//
// **아무것도 발급하지 않는다.** 미발급 칸은 체크할 수 없고 '작성'이 기존 왕복(from=tenant)으로 보낸다.
// 발행번호 원장과 서명이 걸려 있어 자동 발급은 금지다(패널 확정, 신고 44501308).

import { useEffect, useMemo, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { EmptyState } from '@/components/ui/EmptyState'
import { SectionHeader } from '@/components/ui/inventory/SectionHeader'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { DocMultiShareBar } from '@/components/ui/DocMultiShareBar'
import { SelectionPillBar, PillButton } from '@/components/ui/inventory/SelectionPillBar'
import { BtnLink } from '@/components/ui/Btn'
import { useDocShare, type DocShareEntry } from '@/lib/useDocShare'
import { fetchDocBytes } from '@/lib/docBytes'
import { canShareFiles, photoSaveNeedsShareSheet } from '@/lib/shareFile'
import { prewarmPdfToPng } from '@/lib/pdfToPng'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'
import { docFromQuery } from '@/lib/docNav'
import { pushToast } from '@/lib/saveStatus'
import { withEulReul } from '@/lib/statusReasons'
import { STATUS_LABEL } from '@/lib/statusColors'
import { getTenantDocBundle, type TenantDocBundleMail, type TenantDocBundleSms } from '@/app/(app)/tenants/docBundle'
import { TenantDocMailComposeSheet } from '@/components/doc/TenantDocMailComposeSheet'
import { TenantDocSmsComposeSheet } from '@/components/doc/TenantDocSmsComposeSheet'
import {
  DOC_TYPE_FILE_LABEL, DOC_TYPE_TITLE,
  type DocBundleGroup, type DocBundleRow, type TenantDocBundle,
} from '@/lib/docBundle'
import { DEFAULT_CONTRACT_PURPOSE } from '@/lib/contractPurpose'

/** 행이 지금 보낼 파일 — 고른 판본이 있으면 그것, 없으면 대표본. 선택 키도 여기서 나온다. */
function pickedOf(row: DocBundleRow, picked: Record<string, string>) {
  const id = picked[row.key]
  const v = id ? row.versions?.find(x => x.contractFileId === id) : undefined
  return {
    driveFileId: v?.driveFileId ?? row.driveFileId,
    issuedAt: v?.at ?? row.issuedAt,
    // 판본을 명시로 고른 행만 키에 접미가 붙는다(대표본은 종전 키 그대로).
    key: v ? `${row.key}#${v.contractFileId}` : row.key,
    // purposeLabel 은 실계약에서 null 이다(정본) — note 가 있으면 '실계약'이 통째로 사라지므로
    // 여기서 기본값을 먼저 세운다. '스캔본'만 남으면 그 말이 출처 배지와 겹쳐 뜻이 흐려진다.
    label: v ? [v.purposeLabel ?? DEFAULT_CONTRACT_PURPOSE, v.note].filter(Boolean).join(' · ') : null,
  }
}

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋(형제 3화면과 같은 숫자)

/** 내보낼 곳 넷 — 저장(내 기기) · 공유(OS 창) · 문자 · 메일. */
type Dest = 'save' | 'share' | 'sms' | 'mail'

// 화면 이름과 파일명은 다르다 — 파일명은 형제 3화면이 이미 쓰고 있는 문자열 그대로여야
// 같은 서류가 어디서 나가든 같은 이름으로 도착한다. 두 벌 다 규칙 정본(lib/docBundle)에 있다 —
// 메일 경로도 같은 이름을 써야 해서, 여기 사본을 두면 한쪽만 고쳐진 채로 두 이름이 돌아다닌다.
const TITLE = DOC_TYPE_TITLE
const FILE_LABEL = DOC_TYPE_FILE_LABEL

// 그룹 머리 — '509호 계약' · '601호 계약 (비거주자)'. 거주중은 꼬리를 안 단다(그것이 기본값이라
// 붙이면 모든 머리가 길어지기만 한다). 상태 이름은 목록 화면과 같은 STATUS_LABEL 정본이다.
function groupName(g: DocBundleGroup): string {
  if (g.kind === 'other') return '그 밖의 보관본'
  const room = `${fmtRoomNo(g.roomNo, '호실 미지정')} 계약`
  if (!g.status || g.status === 'ACTIVE') return room
  return `${room} (${STATUS_LABEL[g.status] ?? g.status})`
}

/** 미발급 칸을 채우러 가는 문 — 목적지·질의문자열은 프리즘 하단 행이 쓰던 것과 같은 왕복 문법이다. */
function writeHref(row: DocBundleRow, tenantId: string): string {
  const named = row.leaseTermId ? `leaseTermId=${encodeURIComponent(row.leaseTermId)}` : ''
  if (row.docType === 'contract') {
    return `/contract/${tenantId}${docFromQuery('tenant', tenantId)}${named ? `&${named}` : ''}`
  }
  if (row.docType === 'residence') {
    return `/residence-cert/${tenantId}${docFromQuery('tenant', tenantId)}${named ? `&${named}` : ''}`
  }
  const kind = row.docType === 'deposit' ? 'kind=deposit&' : ''
  return `/rent-receipt/${tenantId}?${kind}${named ? `${named}&` : ''}from=tenant&tenantId=${encodeURIComponent(tenantId)}`
}

export function TenantDocBundleSheet({ tenantId, preselectLeaseTermId, onClose }: {
  tenantId: string
  /** 수납 면에서 열었으면 그 면이 보고 있던 계약 — 그 계약 분을 기본 체크한다. */
  preselectLeaseTermId?: string | null
  onClose: () => void
}) {
  const [bundle, setBundle] = useState<(TenantDocBundle & { mail: TenantDocBundleMail; sms: TenantDocBundleSms }) | null>(null)
  const [failed, setFailed] = useState(false)
  // 이 기기가 파일 공유 시트를 열 수 있는가. 못 열면 '기기'는 선택지가 아니다 — 1단계가 진입점
  // 자체를 숨겼던 이유가 그것이다. 메일이 켜진 뒤로는 그 기기에서도 이 화면이 할 일이 있다.
  // 서버 렌더와 첫 그림을 맞추려고 마운트 뒤에 잰다(형제 EntityModal 과 같은 문법).
  const [shareSupported, setShareSupported] = useState(true)
  useEffect(() => { setShareSupported(canShareFiles()) }, [])
  // 보낼 곳 — 기기(공유 시트) · 메일. 기본은 기기다. 1단계에 이미 있던 흐름이 기본값을 잃으면 안 된다.
  // 갈래 셋. 저장(내 기기) · 보내기(공유 시트로 카톡·문자 등) · 메일(앱이 직접 발송).
  // 종전 '이 기기' 하나가 저장과 보내기를 겸해 이름과 동작이 어긋났다(운영자 지적 2026-08-26).
  // 기본은 'share' 다 — 종전 첫 화면 동작과 같아야 한다(무회귀).
  const [dest, setDest] = useState<Dest>('share')
  const [mode, setMode] = useState<'png' | 'pdf'>('png')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 행마다 고른 계약서 판본(행 키 -> contractFileId). 비어 있으면 대표본이다 —
  // **아무것도 안 고르면 종전과 같은 종이가 나간다**(419호 봉합의 무회귀 계약).
  const [pickedVersion, setPickedVersion] = useState<Record<string, string>>({})
  // 판본 고르는 창을 띄운 행.
  const [versionRow, setVersionRow] = useState<DocBundleRow | null>(null)
  const [composeOpen, setComposeOpen] = useState(false)
  const [smsOpen, setSmsOpen] = useState(false)

  // 이 화면은 통째로 선택 모드다 — 열리자마자 변환기를 데운다(첫 탭의 제스처 만료 방어).
  useEffect(() => { prewarmPdfToPng() }, [])

  useEffect(() => {
    let alive = true
    void getTenantDocBundle(tenantId)
      .then(b => {
        if (!alive) return
        if (!b) { setFailed(true); return }
        setBundle(b)
        // 지목하고 들어온 계약의 보관본만 미리 체크한다. 없으면 아무것도 안 고른다 —
        // 사람 단위 진입에서 전부 체크하면 누른 적 없는 종이가 딸려 나간다.
        if (preselectLeaseTermId) {
          const pre = b.groups
            .filter(g => g.leaseTermId === preselectLeaseTermId)
            .flatMap(g => g.rows).filter(r => r.driveFileId).slice(0, MAX_SHARE)
          if (pre.length > 0) setSelected(new Set(pre.map(r => r.key)))
        }
      })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [tenantId, preselectLeaseTermId])

  const rows = useMemo(() => (bundle?.groups ?? []).flatMap(g => g.rows), [bundle])
  const hasAnyRow = rows.length > 0

  const toggle = (row: DocBundleRow) => {
    const cur = pickedOf(row, pickedVersion)
    // 대표본이 없고 판본만 있는 행(419호처럼 제출용만 남은 계약)은 무엇을 보내는지 먼저 정해야 한다.
    // 고르면 그 자리에서 체크가 확정되고, 취소하면 무변경이다(§27.5).
    if (!cur.driveFileId) {
      if (row.versions && row.versions.length > 0) setVersionRow(row)
      return
    }
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(cur.key)) next.delete(cur.key)
      else {
        if (next.size >= MAX_SHARE) { pushToast('info', `한 번에 최대 ${MAX_SHARE}건까지 보낼 수 있습니다.`); return prev }
        next.add(cur.key)
      }
      return next
    })
  }

  // 선택 항목을 표시 순서대로 — 첨부 순서·파일명 충돌 판정에 그대로 쓰인다.
  // 기기 경로도 같은 선택을 쓴다 — 메일만 고치면 공유 시트에서 또 다른 판본이 나간다.
  const shareEntries: DocShareEntry[] = rows
    .map(r => ({ r, p: pickedOf(r, pickedVersion) }))
    .filter(({ p }) => p.driveFileId && selected.has(p.key))
    .map(({ r, p }) => ({
      id: p.driveFileId as string,
      personName: bundle?.tenantName ?? '',
      docLabel: p.label && p.label !== '실계약' && r.versions
        ? `${FILE_LABEL[r.docType]}(${r.versions.find(v => v.contractFileId === pickedVersion[r.key])?.purposeLabel ?? ''})`
          .replace('()', '')
        : FILE_LABEL[r.docType],
      dateStr: fmtDateDot(p.issuedAt),
      fetchBytes: fetchDocBytes(p.driveFileId as string),
    }))
  const mailOn = !!bundle?.mail.enabled
  const mailTo = bundle?.mail.to ?? null
  const smsTo = bundle?.sms.to ?? null
  // 고를 수 있는 곳만 남긴다 — 메일이 안 켜졌으면 그 탭을 세우지 않는다(실측에서 '메일이
  // 꺼졌는데 메일 탭'이 열렸다). 저장은 공유 시트가 없어도 되고(다운로드 폴백), 문자도
  // 기기를 가리지 않는다(서버가 보내지 않으니 켤 키가 없다 — 형제 문자 모달 셋과 같은 전례).
  //
  // '공유'는 2026-08-01 에 금지어로 정리했던 말이다. 그때 근거는 "'보내기'와 같은 동작인데
  // 이름만 둘"이었는데, 문자·메일이 각자 갈래로 서면서 그 중복이 사라졌다. 남은 갈래는 OS
  // 공유 창을 여는 일 하나뿐이라 그 이름이 가장 정확하다(운영자 요구 2026-08-26).
  const destOptions: { value: Dest; label: string }[] = [
    { value: 'save', label: '저장' },
    ...(shareSupported ? [{ value: 'share' as const, label: '공유' }] : []),
    // 문자는 폰에서만 선다. 데스크톱은 sms: 를 열 앱이 없어 멀쩡한 갈래 옆에 죽은 갈래가 된다.
    // 판정은 공유 가능 여부를 대신 쓴다 — 이 앱이 폰인지 아는 유일한 실측 신호다.
    ...(shareSupported ? [{ value: 'sms' as const, label: '문자' }] : []),
    ...(mailOn ? [{ value: 'mail' as const, label: '메일' }] : []),
  ]
  const effDest: Dest = destOptions.some(o => o.value === dest)
    ? dest
    : (shareSupported ? 'share' : mailOn ? 'mail' : 'save')
  const showDestPicker = destOptions.length > 1
  const isFileDest = effDest === 'save' || effDest === 'share'
  // 문자 갈래는 사진 고정이다 — 문자앱의 첨부가 사진첩에서 고르는 구조라 PDF 는 길이 더 길다.
  // 형식 토글도 그래서 안 세운다. 준비 큐는 하나뿐이라 여기서 정한 형식이 곧 저장될 형식이다.
  const effMode: 'png' | 'pdf' = effDest === 'sms' ? 'png' : mode

  // 공유 시트에 함께 넘길 본문 — 받는 앱이 채워진 채로 열리는지 보는 실험이다(2026-08-26).
  // 파일이 함께 있으면 텍스트를 버리는 앱이 많아 될지 안 될지는 실기로만 안다. 무시되면
  // 종전과 같은 결과(파일만 첨부)라 잃는 것이 없다. 문구는 메일과 같은 축으로 짧게 짓는다 —
  // 문자·메신저는 짧은 매체라 메일 본문을 그대로 옮기면 길다.
  const docTitles = useMemo(
    () => rows.filter(r => selected.has(pickedOf(r, pickedVersion).key)).map(r => TITLE[r.docType]),
    [rows, selected, pickedVersion],
  )
  const shareText = useMemo(() => {
    if (docTitles.length === 0) return undefined
    // 조사는 붙여 쓴다 — '계약서'는 받침이 없고 '보증금 영수증'은 있어서 하나로 박으면
    // "계약서을"이 그대로 클립보드에 복사돼 운영자가 붙여넣는다(문자 문안과 같은 봉합).
    return `${bundle?.tenantName ?? ''} 님, 요청하신 ${withEulReul(docTitles.join(', '))} 보내 드립니다.`
  }, [docTitles, bundle?.tenantName])
  const share = useDocShare(shareEntries, effMode, shareText)
  // 문자 갈래도 결국 같은 저장 경로를 타므로 같은 하드 리밋에 걸린다 — 오히려 사진 고정이라
  // 제일 쉽게 넘는다. 종전에는 그 갈래에만 안내가 없어 아무 말 없이 실패했다(디자이너 패스).
  const overLimit = effDest !== 'mail' && selected.size > 0 && share.fileCount > MAX_SHARE
  // 아이폰은 저장도 공유 창을 거친다 — OS 가 정한 것이라 피할 수 없다. 누르기 전에 말한다.
  const saveNeedsSheet = effDest === 'save' && photoSaveNeedsShareSheet() && shareSupported
  const groups = bundle?.groups ?? []

  // 계약이 하나뿐이면 그룹 제목을 세우지 않는다 — 무엇과 무엇을 가르는지가 없는 머리다.
  const showGroupTitles = groups.length > 1

  // 제목이 '서류 보내기'가 아닌 이유. 이 시트는 보관본을 보내기만 하던 자리였는데, 프리즘 하단의
  // 발급 버튼 셋을 여기로 접으면서(2026-08-29) 미발급 행의 '작성'이 유일한 발급 문이 됐다.
  // 문 라벨이 '서류'인데 목적지가 '서류 보내기'면, 발급하러 온 사람이 잘못 왔다고 읽고 되돌아 나간다.
  return (
    <Modal open onClose={onClose} z={260} width="md"
      title={bundle ? `서류 · ${bundle.tenantName}` : '서류'}>
      <div className="space-y-3">
        {/* 내보낼 곳 — 저장·공유·문자·메일. '내보내기'는 문서를 앱 밖으로 빼내는 모든 길의
            상위어라 넷을 다 덮고, OS 창을 여는 갈래는 그 창의 이름 그대로 '공유'다. */}
        {showDestPicker && (
          // 갈래가 넷이 되면서 320px 에서 라벨 넷과 캡션이 한 줄을 다툰다. 캡션을 지우는 대신
          // 아랫줄로 흘린다(360px 이상은 픽셀 무변경). 값이 이 줄의 용건이라 캡션이 양보한다.
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
            <p className="text-xs text-[var(--warm-muted)]">내보낼 곳</p>
            <SegmentedControl<Dest>
              size="sm"
              className="ml-auto"
              ariaLabel="내보낼 곳"
              value={effDest}
              onChange={setDest}
              options={destOptions}
            />
          </div>
        )}

        {/* 줄 높이를 미리 잡아 둔다. 형식 컨트롤이 메일 탭에서 통째로 사라지면 남는 것이 문단 하나(16px)라
            줄이 30px 에서 16px 로 주저앉고 아래 목록 전체가 14px 뛴다. 30px 은 SegmentedControl size sm 의
            실제 높이다(세그먼트 24 + 트랙 패딩 4 + 보더 2). 탭 접미 자리 예약(ViewTabs)과 같은 수법이다. */}
        <div className="flex min-h-[30px] items-center justify-between gap-2">
          <p className="text-xs text-[var(--warm-muted)]">내보낼 서류를 고르세요</p>
          {/* 형식은 파일로 나가는 두 갈래(저장·보내기)에서 고른다. 메일은 발급본 PDF 를 그대로
              첨부한다 — 사진 변환은 브라우저에서만 되고, 메일에 넣을 이유도 없다. */}
          {isFileDest && (
            <SegmentedControl<'png' | 'pdf'>
              size="sm"
              ariaLabel="내보낼 형식"
              value={mode}
              onChange={setMode}
              options={[{ value: 'png', label: '사진' }, { value: 'pdf', label: 'PDF' }]}
            />
          )}
        </div>

        {/* 아이폰 저장은 OS 가 공유 창을 강제한다 — 눌러서 창이 뜬 뒤에 알면 "왜 또 공유창이지"가
            된다(단건 내보내기가 같은 이유로 고르기 전에 알린다). 안드로이드·PC 는 조용히 받으므로
            이 줄이 안 선다. 표면·라벨 토큰은 아래 받는 사람 상자와 같은 문법이다. */}
        {saveNeedsSheet && (
          <p className="rounded-lg bg-[var(--cream-soft)] px-3 py-2 text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
            {mode === 'png'
              ? '저장을 누르면 공유 창이 열립니다. 공유 창에서 [이미지 저장]을 누르면 사진첩에 저장됩니다.'
              : '저장을 누르면 공유 창이 열립니다. 공유 창에서 [파일에 저장]을 누르면 원하는 위치에 저장됩니다.'}
          </p>
        )}

        {/* 받는 사람 — 고칠 수 없는 표시다. 번호를 바꾸려면 입주자 정보에서 고치고 다시 연다.
            메일 상자와 한 벌이다(같은 표면·같은 라벨 토큰). 두 갈래가 같은 질문에 답하기 때문이다. */}
        {effDest === 'sms' && (
          smsTo ? (
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.65625rem] text-[var(--warm-mid)]">받는 사람</p>
              <p className="mt-0.5 text-sm text-[var(--warm-dark)]">
                {bundle?.tenantName} · <span className="tabular-nums">{smsTo}</span>
              </p>
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
              이 입주자의 전화번호가 없습니다. 입주자 정보에 번호를 넣고 다시 열어 주세요.
            </p>
          )
        )}

        {/* 받는 사람 — 고칠 수 없는 표시다. 주소를 바꾸려면 입주자 정보에서 고치고 다시 연다. */}
        {effDest === 'mail' && (
          mailTo ? (
            // 라벨은 --warm-mid 다. --warm-muted 는 이 표면(--cream-soft)의 다크에서 4.46:1 로 §28
            // 하한에 못 미친다(사업자등록증 '미등록' 글자가 같은 숫자로 걸려 이미 한 번 올라갔다).
            // 라이트에서는 두 토큰이 같은 값이라 픽셀이 안 바뀐다. 값은 14px — 비가역 발송 직전에
            // 눈으로 대조하는 값이라 프리즘 읽기 전용 행(Item)과 같은 크기로 세운다.
            <div className="rounded-lg bg-[var(--cream-soft)] px-3 py-2">
              <p className="text-[0.65625rem] text-[var(--warm-mid)]">받는 사람</p>
              <p className="mt-0.5 break-all text-sm text-[var(--warm-dark)]">{mailTo}</p>
            </div>
          ) : (
            <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
              이 입주자의 메일 주소가 없습니다. 입주자 정보에 주소를 넣고 다시 열어 주세요.
            </p>
          )
        )}

        {/* 장수 초과 안내 — 알약에는 '사진 N장' 만 들어간다(320px 폭 한계). 어떻게 하면 되는지는
            자리가 있는 여기서 말한다. 사진은 페이지마다 한 장이라 계약서가 섞이면 금세 넘는다. */}
        {overLimit && (
          <p className="rounded-lg bg-[var(--warning-bg)] px-3 py-2 text-[0.6875rem] text-[var(--warning-fg)]">
            {effDest === 'sms'
              ? `사진은 한 번에 ${MAX_SHARE}장까지 저장할 수 있습니다. 서류를 몇 건 빼 주세요.`
              : effDest === 'save'
                ? `사진은 한 번에 ${MAX_SHARE}장까지 저장할 수 있습니다. 몇 건을 빼거나 PDF 로 저장하세요.`
                : `사진은 한 번에 ${MAX_SHARE}장까지 보낼 수 있습니다. 몇 건을 빼거나 PDF 로 보내세요.`}
          </p>
        )}

        {!bundle && !failed && <SkeletonRows rows={4} />}
        {failed && <p className="text-xs text-[var(--danger-fg)]">서류 목록을 불러오지 못했습니다.</p>}
        {bundle && !hasAnyRow && (
          <EmptyState title="보낼 서류가 없습니다" description="계약이 진행되면 여기에 서류 칸이 생깁니다." />
        )}

        {groups.map(g => (
          <div key={g.leaseTermId ?? 'other'}>
            {showGroupTitles && <SectionHeader first={g === groups[0]} name={groupName(g)} />}
            <ul className="space-y-1.5">
              {g.rows.map(r => (
                <DocRow key={r.key} row={r} tenantId={tenantId}
                  picked={pickedOf(r, pickedVersion)}
                  selected={selected.has(pickedOf(r, pickedVersion).key)}
                  onToggle={() => toggle(r)}
                  onChangeVersion={() => setVersionRow(r)} />
              ))}
            </ul>
          </div>
        ))}

        {/* 하단 알약은 모달 안 선택 모드 축(§22 aboveModal) — 형제 3화면과 같은 셸이다.
            메일은 변환 큐가 없어(서버가 발급본 PDF 를 그대로 싣는다) 준비 상태 표시가 없다.
            그래서 DocMultiShareBar 를 억지로 재사용하지 않고 같은 셸(SelectionPillBar)만 공유한다. */}
        {selected.size > 0 && isFileDest && (
          <DocMultiShareBar
            aboveModal
            count={selected.size}
            done={share.done}
            failedCount={share.failedCount}
            mode={mode}
            // 목적지가 이름을 정한다 — 저장은 내 기기, 보내기는 상대에게(§ 어휘 정본).
            sendLabel={effDest === 'save'
              ? (mode === 'png' ? '사진 저장' : 'PDF 저장')
              : (mode === 'png' ? '사진 공유' : 'PDF 공유')}
            totalBytes={share.totalBytes}
            fileCount={share.fileCount}
            onSend={effDest === 'save' ? share.save : share.send}
            onClose={() => setSelected(new Set())}
          />
        )}
        {selected.size > 0 && effDest === 'sms' && (
          <SelectionPillBar aboveModal count={selected.size} unit="건" onClose={() => setSelected(new Set())}>
            {/* 메일과 같은 이유로 '보내기'가 아니라 '쓰기'다 — 누르는 순간 나가는 버튼이 아니다.
                번호 없음은 위 안내 줄이 이미 말한다. */}
            <PillButton primary disabled={!smsTo} onClick={() => setSmsOpen(true)}>
              문자 쓰기
            </PillButton>
          </SelectionPillBar>
        )}
        {selected.size > 0 && effDest === 'mail' && (
          <SelectionPillBar aboveModal count={selected.size} unit="건" onClose={() => setSelected(new Set())}>
            {/* 버튼은 발송이 아니라 확인 화면 열기다 — 그래서 '보내기'가 아니라 '쓰기'다(누르는 순간
                나가는 버튼이 아니라는 것을 이름이 말해야 한다). §22 는 불가능한 액션을 숨기라고
                하지만 여기서 숨기면 알약에 건수와 닫기만 남아 '왜 못 보내는지'를 말할 자리가
                사라진다. 주소 없음은 위 안내 줄이 이미 말한다. */}
            <PillButton primary disabled={!mailTo} onClick={() => setComposeOpen(true)}>
              메일 쓰기
            </PillButton>
          </SelectionPillBar>
        )}
        {versionRow && (
          <ContractVersionPicker
            row={versionRow}
            pickedId={pickedVersion[versionRow.key] ?? null}
            onClose={() => setVersionRow(null)}
            onPick={v => {
              const row = versionRow
              setVersionRow(null)
              setPickedVersion(prev => {
                const next = { ...prev }
                if (v.representative) delete next[row.key]   // 대표본은 기본값이라 표식을 지운다
                else next[row.key] = v.contractFileId
                return next
              })
              // 판본이 바뀌면 키가 바뀐다 — 옛 키를 걷고 새 키로 체크를 옮긴다(선택이 사라지지 않게).
              setSelected(prev => {
                const next = new Set(prev)
                const oldKey = pickedOf(row, pickedVersion).key
                const had = next.has(oldKey) || next.has(row.key)
                next.delete(oldKey); next.delete(row.key)
                const newKey = v.representative ? row.key : `${row.key}#${v.contractFileId}`
                if (had || next.size < MAX_SHARE) next.add(newKey)
                return next
              })
            }}
          />
        )}
        {smsOpen && smsTo && bundle && (
          <TenantDocSmsComposeSheet
            tenantId={tenantId}
            tenantName={bundle.tenantName}
            propertyName={bundle.sms.propertyName}
            phone={smsTo}
            docTitles={docTitles}
            share={share}
            onClose={() => setSmsOpen(false)}
          />
        )}
        {composeOpen && (
          <TenantDocMailComposeSheet
            tenantId={tenantId}
            keys={[...selected]}
            onClose={() => setComposeOpen(false)}
            onSent={count => {
              setComposeOpen(false)
              setSelected(new Set())
              pushToast('success', `서류 ${count}건을 메일로 보냈습니다`)
            }}
          />
        )}
      </div>
    </Modal>
  )
}

// 행 하나 — 발급본이 있으면 체크할 수 있고 [보기]가 열린다. 없으면 체크가 잠기고 [작성]으로 나간다.
// 계약서 판본이 여럿이거나 대표가 공석이면 보조줄 아래에 판본 줄이 하나 더 선다(419호 봉합).
function DocRow({ row, tenantId, picked, selected, onToggle, onChangeVersion }: {
  row: DocBundleRow
  tenantId: string
  picked: { driveFileId: string | null; issuedAt: string | null; key: string; label: string | null }
  selected: boolean
  onToggle: () => void
  onChangeVersion: () => void
}) {
  const issued = !!picked.driveFileId
  const versions = row.versions ?? []
  // 대표가 없어도 판본이 있으면 **고를 수 있는 행이다.** 종전에는 issued 만 보고 행 탭을 죽여,
  // 419호처럼 제출용만 남은 행이 판본 창을 못 열고 잠긴 것처럼 보였다(디자이너 패스 차단 8).
  const pickable = issued || versions.length > 0
  // 보조줄도 같은 사실을 따른다 — 판본이 있는데 '만든 서류가 없다'고 하면 거짓이다.
  // 판본 줄은 고를 것이 둘 이상이거나, 대표가 없어 무엇을 보낼지 정해야 할 때만 선다.
  // 1부짜리 계약(대다수)은 이 줄이 없어 픽셀이 종전과 같다.
  const showVersions = versions.length > 1 || (versions.length === 1 && !row.driveFileId)
  const cur = versions.find(v => v.driveFileId === picked.driveFileId)
  const curLabel = cur ? [cur.purposeLabel ?? DEFAULT_CONTRACT_PURPOSE, cur.note].filter(Boolean).join(' · ') : null
  return (
    <li
      onClick={pickable ? onToggle : undefined}
      // 형제 목록 화면은 액션이 넷이라 좁은 폭에서 아래 줄로 내리지만, 여기는 행마다 버튼이 하나라
      // 내리면 320px 에서 한 화면에 세 행밖에 안 들어간다. 한 줄을 유지한다(실측 잘림 0).
      className={[
        // 행 표면은 --cream 이다. --canvas 는 §03 이 정한 **페이지 배경** 토큰이라 그 위에서는
        // 보조줄 대비가 라이트 4.11:1 로 §28 하한에 못 미치고, 다크에서는 --canvas 가 #000 이라
        // --cream 패널 안에 검은 구멍이 뚫린다. 이 주석이 근거로 삼던 계약서 파일 칸
        // (ContractFilesPanel)이 같은 숫자로 이미 옮겨 갔는데 이 시트만 안 따라왔다(디자이너 패스).
        // 선택 표시는 §22 .sel 그대로 테두리 + 링이고, 미발급은 잠긴 체크박스·회색 문구가 말한다.
        'flex items-center gap-2 rounded-xl border bg-[var(--cream)] p-3 transition-colors',
        pickable ? 'cursor-pointer select-none' : '',
        selected ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]' : 'border-[var(--warm-border)]',
      ].join(' ')}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {/* §22 InventoryCard 정본 체크박스(22px r7). 미발급 칸은 고를 것이 없어 잠근다. */}
        <span className={[
          'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border transition-colors',
          !pickable
            ? 'border-[var(--warm-border)] bg-[var(--warm-border)]/30 text-transparent'
            : selected
              ? 'border-[var(--coral)] bg-[var(--coral)] text-[var(--on-solid)]'
              : 'border-[var(--warm-border)] text-transparent',
        ].join(' ')} aria-hidden>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--warm-dark)]">{TITLE[row.docType]}</p>
          <p className="mt-0.5 text-[0.65625rem] text-[var(--warm-muted)]">
            {issued
              ? `${fmtDateDot(picked.issuedAt)} ${row.docType === 'contract' ? '서명' : '발급'}`
              : versions.length > 0 ? '보낼 판본을 고르세요' : '아직 만든 서류가 없습니다'}
          </p>
          {row.note && <p className="mt-0.5 text-[0.65625rem] text-[var(--warm-muted)]">{row.note}</p>}
          {/* 판본 줄 — 지금 무엇이 나가는지 적고 바꿀 길을 그 자리에 둔다.
              값과 링크가 한 줄을 다투면 320px 에서 **값이** 잘린다. 값이 이 줄의 용건이라
              링크를 아랫줄로 흘리고(flex-wrap), 히트는 정본대로 -my-2 + min-h-44 로 넓힌다. */}
          {showVersions && (
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2">
              <span className="min-w-0 text-[0.65625rem] text-[var(--warm-muted)]">
                판본 · {curLabel ?? '고르지 않음'}
              </span>
              <button type="button"
                onClick={e => { e.stopPropagation(); onChangeVersion() }}
                className="-my-2 inline-flex min-h-[44px] shrink-0 items-center rounded-sm text-[0.65625rem] text-[var(--tc-text)] underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--coral)]">
                판본 바꾸기
              </button>
            </div>
          )}
        </div>
      </div>
      {/* 버튼은 행 선택을 가로채지 않는다 — 체크는 행 전체, 이동은 버튼 */}
      <div className="flex shrink-0 items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
        {issued
          ? <ViewDocButton driveFileId={picked.driveFileId as string} from="tenant" tenantId={tenantId} />
          : <BtnLink href={writeHref(row, tenantId)} variant="secondary" size="sm">작성</BtnLink>}
      </div>
    </li>
  )
}

// 판본 고르기 — 같은 계약의 계약서가 여럿일 때 무엇을 보낼지 정한다.
//
// choiceDialog 를 안 쓰는 이유는 그 정본이 2~3지선다라서다(판본 수는 정해져 있지 않다).
// 행 문법은 이 시트의 서류 행과 같은 축(§22 선택 행 · 22px r7 체크)이라 새 문법이 아니다.
function ContractVersionPicker({ row, pickedId, onClose, onPick }: {
  row: DocBundleRow
  pickedId: string | null
  onClose: () => void
  onPick: (v: NonNullable<DocBundleRow['versions']>[number]) => void
}) {
  const versions = row.versions ?? []
  // 현재 선택 — 고른 것이 없으면 대표본이다(기본값).
  const currentId = pickedId ?? versions.find(v => v.representative)?.contractFileId ?? null
  return (
    <Modal open onClose={onClose} z={280} width="sm" title="어떤 계약서를 보낼까요">
      <div className="space-y-2">
        <p className="text-[0.6875rem] leading-relaxed text-[var(--warm-mid)]">
          같은 계약에 등록된 계약서입니다. 고른 판본이 메일과 기기 공유 양쪽에 쓰입니다.
        </p>
        <ul className="space-y-1.5">
          {versions.map(v => {
            const on = v.contractFileId === currentId
            const label = [v.purposeLabel ?? DEFAULT_CONTRACT_PURPOSE, v.note].filter(Boolean).join(' · ')
            return (
              <li key={v.contractFileId}>
                <button type="button" onClick={() => onPick(v)}
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
                    <span className="block truncate text-sm font-semibold text-[var(--warm-dark)]">{label}</span>
                    <span className="mt-0.5 block text-[0.65625rem] text-[var(--warm-muted)]">
                      {fmtDateDot(v.at)} 서명{v.representative ? ' · 현재 계약서' : ''}
                    </span>
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      </div>
    </Modal>
  )
}

