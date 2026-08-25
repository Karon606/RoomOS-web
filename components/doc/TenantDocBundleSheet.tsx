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
import { canShareFiles } from '@/lib/shareFile'
import { prewarmPdfToPng } from '@/lib/pdfToPng'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'
import { docFromQuery } from '@/lib/docNav'
import { pushToast } from '@/lib/saveStatus'
import { STATUS_LABEL } from '@/lib/statusColors'
import { getTenantDocBundle, type TenantDocBundleMail } from '@/app/(app)/tenants/docBundle'
import { TenantDocMailComposeSheet } from '@/components/doc/TenantDocMailComposeSheet'
import {
  DOC_TYPE_FILE_LABEL, DOC_TYPE_TITLE,
  type DocBundleGroup, type DocBundleRow, type TenantDocBundle,
} from '@/lib/docBundle'

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋(형제 3화면과 같은 숫자)

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
  const [bundle, setBundle] = useState<(TenantDocBundle & { mail: TenantDocBundleMail }) | null>(null)
  const [failed, setFailed] = useState(false)
  // 이 기기가 파일 공유 시트를 열 수 있는가. 못 열면 '기기'는 선택지가 아니다 — 1단계가 진입점
  // 자체를 숨겼던 이유가 그것이다. 메일이 켜진 뒤로는 그 기기에서도 이 화면이 할 일이 있다.
  // 서버 렌더와 첫 그림을 맞추려고 마운트 뒤에 잰다(형제 EntityModal 과 같은 문법).
  const [shareSupported, setShareSupported] = useState(true)
  useEffect(() => { setShareSupported(canShareFiles()) }, [])
  // 보낼 곳 — 기기(공유 시트) · 메일. 기본은 기기다. 1단계에 이미 있던 흐름이 기본값을 잃으면 안 된다.
  const [dest, setDest] = useState<'device' | 'mail'>('device')
  const [mode, setMode] = useState<'png' | 'pdf'>('png')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [composeOpen, setComposeOpen] = useState(false)

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
    if (!row.driveFileId) return
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(row.key)) next.delete(row.key)
      else {
        if (next.size >= MAX_SHARE) { pushToast('info', `한 번에 최대 ${MAX_SHARE}건까지 보낼 수 있습니다.`); return prev }
        next.add(row.key)
      }
      return next
    })
  }

  // 선택 항목을 표시 순서대로 — 첨부 순서·파일명 충돌 판정에 그대로 쓰인다.
  const shareEntries: DocShareEntry[] = rows
    .filter(r => r.driveFileId && selected.has(r.key))
    .map(r => ({
      id: r.driveFileId as string,
      personName: bundle?.tenantName ?? '',
      docLabel: FILE_LABEL[r.docType],
      dateStr: fmtDateDot(r.issuedAt),
      fetchBytes: fetchDocBytes(r.driveFileId as string),
    }))
  const share = useDocShare(shareEntries, mode)

  const mailOn = !!bundle?.mail.enabled
  const mailTo = bundle?.mail.to ?? null
  // 고를 수 있는 곳만 남긴다 — 메일이 안 켜졌으면 기기뿐이고, 공유가 안 되는 기기(PC·인앱
  // 브라우저)에서는 메일뿐이다. 둘 중 하나뿐이면 컨트롤을 세우지 않는다. 무엇과 무엇을 가르는지가
  // 없는 스위치라서다(그룹이 하나면 머리를 안 세우는 것과 같은 규칙).
  // 이 세 갈래를 한 줄로 줄이면 '메일이 꺼졌는데 메일 탭'이 열린다(실측에서 실제로 열렸다).
  const effDest: 'device' | 'mail' = !mailOn ? 'device' : !shareSupported ? 'mail' : dest
  const showDestPicker = mailOn && shareSupported
  const overLimit = effDest === 'device' && selected.size > 0 && share.fileCount > MAX_SHARE
  const groups = bundle?.groups ?? []

  // 계약이 하나뿐이면 그룹 제목을 세우지 않는다 — 무엇과 무엇을 가르는지가 없는 머리다.
  const showGroupTitles = groups.length > 1

  return (
    <Modal open onClose={onClose} z={260} width="md"
      title={bundle ? `서류 보내기 · ${bundle.tenantName}` : '서류 보내기'}>
      <div className="space-y-3">
        {/* 보낼 곳 — 메일이 켜져 있을 때만 선다. 안 켜져 있으면 아래 형식 줄 하나로 1단계와 같다. */}
        {showDestPicker && (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-[var(--warm-muted)]">보낼 곳</p>
            <SegmentedControl<'device' | 'mail'>
              size="sm"
              ariaLabel="보낼 곳"
              value={dest}
              onChange={setDest}
              // '기기'는 이 저장소에 없는 단독 명사다 — 늘 '기기에 저장'·'이 기기 알림'처럼 수식을 단다.
              // 여기서 열리는 것은 저장이 아니라 공유 시트(문자·메신저·저장이 그 안에 다 있다)라
              // '기기에 저장'으로 부르면 거짓이 된다. '공유'는 어휘 정본상 금지어다.
              options={[{ value: 'device', label: '이 기기' }, { value: 'mail', label: '메일' }]}
            />
          </div>
        )}

        {/* 줄 높이를 미리 잡아 둔다. 형식 컨트롤이 메일 탭에서 통째로 사라지면 남는 것이 문단 하나(16px)라
            줄이 30px 에서 16px 로 주저앉고 아래 목록 전체가 14px 뛴다. 30px 은 SegmentedControl size sm 의
            실제 높이다(세그먼트 24 + 트랙 패딩 4 + 보더 2). 탭 접미 자리 예약(ViewTabs)과 같은 수법이다. */}
        <div className="flex min-h-[30px] items-center justify-between gap-2">
          <p className="text-xs text-[var(--warm-muted)]">보낼 서류를 고르세요</p>
          {/* 형식은 기기로 보낼 때만 고른다. 메일은 발급본 PDF 를 그대로 첨부한다 —
              사진 변환은 브라우저에서만 되고, 메일에 넣을 이유도 없다. */}
          {effDest === 'device' && (
            <SegmentedControl<'png' | 'pdf'>
              size="sm"
              ariaLabel="보낼 형식"
              value={mode}
              onChange={setMode}
              options={[{ value: 'png', label: '사진' }, { value: 'pdf', label: 'PDF' }]}
            />
          )}
        </div>

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
            사진은 한 번에 {MAX_SHARE}장까지 보낼 수 있습니다. 몇 건을 빼거나 PDF 로 보내세요.
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
                  selected={selected.has(r.key)} onToggle={() => toggle(r)} />
              ))}
            </ul>
          </div>
        ))}

        {/* 하단 알약은 모달 안 선택 모드 축(§22 aboveModal) — 형제 3화면과 같은 셸이다.
            메일은 변환 큐가 없어(서버가 발급본 PDF 를 그대로 싣는다) 준비 상태 표시가 없다.
            그래서 DocMultiShareBar 를 억지로 재사용하지 않고 같은 셸(SelectionPillBar)만 공유한다. */}
        {selected.size > 0 && effDest === 'device' && (
          <DocMultiShareBar
            aboveModal
            count={selected.size}
            done={share.done}
            failedCount={share.failedCount}
            mode={mode}
            sendLabel={mode === 'png' ? '사진 보내기' : 'PDF 보내기'}
            totalBytes={share.totalBytes}
            fileCount={share.fileCount}
            onSend={share.send}
            onClose={() => setSelected(new Set())}
          />
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
function DocRow({ row, tenantId, selected, onToggle }: {
  row: DocBundleRow
  tenantId: string
  selected: boolean
  onToggle: () => void
}) {
  const issued = !!row.driveFileId
  return (
    <li
      onClick={issued ? onToggle : undefined}
      // 형제 목록 화면은 액션이 넷이라 좁은 폭에서 아래 줄로 내리지만, 여기는 행마다 버튼이 하나라
      // 내리면 320px 에서 한 화면에 세 행밖에 안 들어간다. 한 줄을 유지한다(실측 잘림 0).
      className={[
        // 행 표면은 --cream 이다. --canvas 는 §03 이 정한 **페이지 배경** 토큰이라 그 위에서는
        // 보조줄 대비가 라이트 4.11:1 로 §28 하한에 못 미치고, 다크에서는 --canvas 가 #000 이라
        // --cream 패널 안에 검은 구멍이 뚫린다. 이 주석이 근거로 삼던 계약서 파일 칸
        // (ContractFilesPanel)이 같은 숫자로 이미 옮겨 갔는데 이 시트만 안 따라왔다(디자이너 패스).
        // 선택 표시는 §22 .sel 그대로 테두리 + 링이고, 미발급은 잠긴 체크박스·회색 문구가 말한다.
        'flex items-center gap-2 rounded-xl border bg-[var(--cream)] p-3 transition-colors',
        issued ? 'cursor-pointer select-none' : '',
        selected ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]' : 'border-[var(--warm-border)]',
      ].join(' ')}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        {/* §22 InventoryCard 정본 체크박스(22px r7). 미발급 칸은 고를 것이 없어 잠근다. */}
        <span className={[
          'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border transition-colors',
          !issued
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
              ? `${fmtDateDot(row.issuedAt)} ${row.docType === 'contract' ? '서명' : '발급'}`
              : '아직 만든 서류가 없습니다'}
          </p>
          {row.note && <p className="mt-0.5 text-[0.65625rem] text-[var(--warm-muted)]">{row.note}</p>}
        </div>
      </div>
      {/* 버튼은 행 선택을 가로채지 않는다 — 체크는 행 전체, 이동은 버튼 */}
      <div className="flex shrink-0 items-center justify-end gap-1.5" onClick={e => e.stopPropagation()}>
        {issued
          ? <ViewDocButton driveFileId={row.driveFileId as string} from="tenant" tenantId={tenantId} />
          : <BtnLink href={writeHref(row, tenantId)} variant="secondary" size="sm">작성</BtnLink>}
      </div>
    </li>
  )
}
