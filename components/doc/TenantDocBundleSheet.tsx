'use client'

// 입주자 서류 묶음 보내기 — 한 사람의 보관 서류를 계약 축으로 세워 공유 시트 **한 번**으로 보낸다.
//
// 종전에는 서류 종류마다 목록 화면을 따로 열어 한 사람의 네 가지 종이를 네 번에 걸쳐 보냈다.
// 여기서 모으되 규칙은 그 네 화면 정본 그대로다 — 행 문법(보기 primary), 선택 체크박스(§22 22px r7),
// 하단 알약(DocMultiShareBar), 준비 큐·파일명(lib/useDocShare). 이 화면은 조립만 한다.
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
import { BtnLink } from '@/components/ui/Btn'
import { useDocShare, type DocShareEntry } from '@/lib/useDocShare'
import { fetchDocBytes } from '@/lib/docBytes'
import { prewarmPdfToPng } from '@/lib/pdfToPng'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'
import { docFromQuery } from '@/lib/docNav'
import { pushToast } from '@/lib/saveStatus'
import { STATUS_LABEL } from '@/lib/statusColors'
import { getTenantDocBundle, type DocBundleGroup, type DocBundleRow, type TenantDocBundle } from '@/app/(app)/tenants/docBundle'

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋(형제 3화면과 같은 숫자)

// 화면 이름과 파일명은 다르다 — 파일명은 형제 3화면이 이미 쓰고 있는 문자열 그대로여야
// 같은 서류가 어디서 나가든 같은 이름으로 도착한다.
const TITLE: Record<DocBundleRow['docType'], string> = {
  contract: '계약서',
  rent: '입실료 납부 확인서',
  deposit: '보증금 영수증',
  residence: '실거주 확인서',
}
const FILE_LABEL: Record<DocBundleRow['docType'], string> = {
  contract: '계약서',
  rent: '입실료납부확인서',
  deposit: '보증금영수증',
  residence: '실거주확인서',
}

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
  const [bundle, setBundle] = useState<TenantDocBundle | null>(null)
  const [failed, setFailed] = useState(false)
  const [mode, setMode] = useState<'png' | 'pdf'>('png')
  const [selected, setSelected] = useState<Set<string>>(new Set())

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

  const groups = bundle?.groups ?? []
  // 계약이 하나뿐이면 그룹 제목을 세우지 않는다 — 무엇과 무엇을 가르는지가 없는 머리다.
  const showGroupTitles = groups.length > 1

  return (
    <Modal open onClose={onClose} z={260} width="md"
      title={bundle ? `서류 보내기 · ${bundle.tenantName}` : '서류 보내기'}>
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--warm-muted)]">보낼 서류를 고르세요</p>
          <SegmentedControl<'png' | 'pdf'>
            size="sm"
            ariaLabel="보낼 형식"
            value={mode}
            onChange={setMode}
            options={[{ value: 'png', label: '사진' }, { value: 'pdf', label: 'PDF' }]}
          />
        </div>

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

        {/* 하단 알약은 모달 안 선택 모드 축(§22 aboveModal) — 형제 3화면과 같은 셸이다 */}
        {selected.size > 0 && (
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
      className={[
        'flex flex-col sm:flex-row sm:items-center gap-2 rounded-xl border p-3 transition-colors',
        issued ? 'cursor-pointer select-none bg-[var(--cream)]' : 'bg-[var(--canvas)]',
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
      <div className="flex shrink-0 items-center gap-1.5 sm:justify-end" onClick={e => e.stopPropagation()}>
        {issued
          ? <ViewDocButton driveFileId={row.driveFileId as string} from="tenant" tenantId={tenantId} />
          : <BtnLink href={writeHref(row, tenantId)} variant="secondary" size="sm">작성</BtnLink>}
      </div>
    </li>
  )
}
