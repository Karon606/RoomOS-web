'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn } from '@/components/ui/Btn'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { STATUS_LABEL } from '@/lib/statusColors'
import { deleteContractFile, restoreContractFile } from '@/app/(app)/tenants/actions'
import type { ContractListRow } from './actions'
import { ShareDocButton } from '@/components/ui/ShareDocButton'
import { SearchBar } from '@/components/ui/SearchBar'
import { DocMultiShareBar } from '@/components/ui/DocMultiShareBar'
import { useDocShare, type DocShareEntry } from '@/lib/useDocShare'
import { useLongPress } from '@/lib/useLongPress'
import { canShareFiles } from '@/lib/shareFile'

const fmtRoomNo = (no: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋
const fetchDocBytes = (driveFileId: string) => async () => {
  const res = await fetch(`/api/doc-file?id=${encodeURIComponent(driveFileId)}`)
  if (!res.ok) throw new Error('서류를 불러오지 못했습니다.')
  return res.arrayBuffer()
}

const SOURCE_LABEL: Record<string, string> = { GENERATED: '앱 서명', UPLOADED: '스캔 업로드' }

// 퇴실 그룹: 퇴실 완료 + 입실 취소. 연결 계약이 없는(status null) 파일은 거주중 쪽에 둔다.
const isDeparted = (status: string | null) => status === 'CHECKED_OUT' || status === 'CANCELLED'

export default function ContractsClient({ contracts }: { contracts: ContractListRow[] }) {
  const router = useRouter()
  const entityModal = useEntityModal()
  const searchParams = useSearchParams()
  // 전역 통합 검색 ?q= 딥링크 시딩
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [residency, setResidency] = useState<'current' | 'departed' | 'all'>('current')
  const [source, setSource] = useState<'all' | 'GENERATED' | 'UPLOADED'>('all')
  const [sort, setSort] = useState<'latest' | 'tenant'>('latest')
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 다중 'PDF 보내기' 선택 모드 — 읽기 액션이라 STAFF 도 가능(canEdit 에 묶지 않음).
  // 계약서는 PDF 원본으로만 전송한다. PNG 변환 절대 금지 — pdfToPng 는 1페이지만 그려
  // 다페이지 계약서의 뒷장(환불조항·서명면)이 유실되기 때문(mode='pdf' 강제).
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [canShare, setCanShare] = useState(false)
  // 마운트 후 1회 판정 — SSR 은 기기 공유 지원 여부를 알 수 없어 의도된 setState(연쇄 렌더 아님)
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setCanShare(canShareFiles()) }, [])
  const longPress = useLongPress()

  const toggleSelect = (id: string) => setSelected(prev => {
    const next = new Set(prev)
    if (next.has(id)) next.delete(id)
    else {
      if (next.size >= MAX_SHARE) { pushToast('info', `한 번에 최대 ${MAX_SHARE}건까지 보낼 수 있습니다.`); return prev }
      next.add(id)
    }
    return next
  })
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  const departedCount = useMemo(() => contracts.filter(c => isDeparted(c.status)).length, [contracts])

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = contracts.filter(c => {
      if (residency !== 'all' && (residency === 'departed') !== isDeparted(c.status)) return false
      if (source !== 'all' && c.source !== source) return false
      if (!q) return true
      return (
        c.tenantName.toLowerCase().includes(q) ||
        c.fileName.toLowerCase().includes(q) ||
        (c.roomNo ?? '').toLowerCase().includes(q)
      )
    })
    list = [...list].sort((a, b) =>
      sort === 'latest'
        ? new Date(b.signedAt).getTime() - new Date(a.signedAt).getTime()
        : a.tenantName.localeCompare(b.tenantName, 'ko') || (a.roomNo ?? '').localeCompare(b.roomNo ?? '', 'ko', { numeric: true }),
    )
    return list
  }, [contracts, query, residency, source, sort])

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name}님의 이 계약서 파일을 삭제할까요?`, message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteContractFile(id)
      setDeletingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '계약서 삭제됨', { action: { label: '적용취소', run: () => { void restoreContractFile(id).then(r => { if (r.ok) router.refresh(); else pushToast('error', r.error) }) } } })
      router.refresh()
    })
  }

  // 선택 항목을 표시 순서대로 — 첨부 순서·파일명 충돌 판정에 그대로 쓰인다.
  // 이 목록은 이미 저장된 최종 계약서 파일만 담는다(초안·미서명 행 구분 없음) — 전체 행 전송 허용.
  const shareEntries: DocShareEntry[] = rows
    .filter(c => selected.has(c.id))
    .map(c => ({
      id: c.driveFileId,
      personName: c.tenantName,
      docLabel: '계약서',
      dateStr: fmtDate(c.signedAt),
      fetchBytes: fetchDocBytes(c.driveFileId),
    }))
  const share = useDocShare(shareEntries, 'pdf')

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <div>
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">계약서</h1>
          <p className="text-xs text-[var(--warm-muted)] mt-0.5">여기는 모아보기 화면입니다. 새 계약서 작성·서명·스캔 업로드는 입주자 관리에서 입주자를 눌러 진행하세요. 거주중 {contracts.length - departedCount}건 · 퇴실 {departedCount}건.</p>
        </div>
        <div className="sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={query} onChange={setQuery} placeholder="이름·호실·파일명 검색" />
        </div>
        <div className="flex flex-wrap gap-2">
          <SegmentedControl
            size="sm"
            ariaLabel="거주 상태 필터"
            value={residency}
            onChange={setResidency}
            options={[
              { value: 'current', label: `거주중 ${contracts.length - departedCount}` },
              { value: 'departed', label: `퇴실 ${departedCount}` },
              { value: 'all', label: `전체 ${contracts.length}` },
            ]}
          />
          <SegmentedControl
            size="sm"
            ariaLabel="출처 필터"
            value={source}
            onChange={setSource}
            options={[
              { value: 'all', label: '전체' },
              { value: 'GENERATED', label: '앱 서명' },
              { value: 'UPLOADED', label: '스캔' },
            ]}
          />
          <SegmentedControl
            size="sm"
            ariaLabel="정렬"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'latest', label: '최신순' },
              { value: 'tenant', label: '입실자별' },
            ]}
          />
          {/* 다중 'PDF 보내기' 선택 — 파일 공유 지원 기기에서만 노출 */}
          {canShare && contracts.length > 0 && (
            <Btn type="button" variant="secondary" size="sm" className="ml-auto"
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
          )}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title={contracts.length === 0 ? '계약서가 아직 없습니다' : '조건에 맞는 계약서가 없습니다'}
          description={contracts.length === 0 ? '고객 상세에서 계약서를 서명·출력하거나 스캔본을 업로드하면 여기에 모입니다.' : '검색어나 필터를 조정해 보세요.'}
        />
      ) : (
        <ul className="space-y-2">
          {rows.map(c => {
            const sel = selected.has(c.id)
            return (
            <li key={c.id}
              onClick={selectMode ? () => toggleSelect(c.id) : undefined}
              {...(!selectMode ? longPress(() => { setSelectMode(true); toggleSelect(c.id) }) : {})}
              className={[
                'bg-[var(--cream)] border rounded-xl p-3.5 flex items-center gap-3 transition-colors',
                selectMode ? 'cursor-pointer select-none' : '',
                selectMode && sel ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]' : 'border-[var(--warm-border)]',
              ].join(' ')}>
              {/* 선택 모드 좌측 체크박스 — §22 InventoryCard 정본(22px r7) */}
              {selectMode && (
                <span className={[
                  'mt-0.5 grid h-[22px] w-[22px] shrink-0 place-items-center rounded-[7px] border transition-colors',
                  sel ? 'border-[var(--coral)] bg-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)] text-transparent',
                ].join(' ')} aria-hidden>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                </span>
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  {selectMode ? (
                    <span className="text-sm font-semibold text-[var(--warm-dark)]">{c.roomNo ? `${fmtRoomNo(c.roomNo)} · ` : ''}{c.tenantName}</span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => entityModal.open({ kind: 'tenant', tenantId: c.tenantId })}
                      className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] transition-colors">
                      {c.roomNo ? `${fmtRoomNo(c.roomNo)} · ` : ''}{c.tenantName}
                    </button>
                  )}
                  <span className={`text-[0.65625rem] font-medium px-1.5 py-0.5 rounded-full ${
                    c.source === 'GENERATED'
                      ? 'bg-[var(--coral)]/10 text-[var(--coral)]'
                      : 'bg-[var(--canvas)] text-[var(--warm-mid)] ring-1 ring-[var(--warm-border)]'
                  }`}>{SOURCE_LABEL[c.source]}</span>
                  {c.status && <span className="text-[0.65625rem] text-[var(--warm-muted)]">{STATUS_LABEL[c.status] ?? c.status}</span>}
                </div>
                <p className="text-[0.6875rem] text-[var(--warm-muted)] truncate mt-0.5">{c.fileName}</p>
                <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{fmtDate(c.signedAt)} 서명</p>
              </div>
              {/* 선택 모드에선 개별 액션 숨김 — 하단 바로 일괄 전송 */}
              {!selectMode && (
              <div className="flex items-center gap-1.5 shrink-0">
                {/* 보내기 = 단건 전달(다운로드 폴백 있음). 파일 전송 지원 기기에서만 노출.
                    라벨은 ShareDocButton 기본값을 쓴다 — label prop 으로 덮으면 화면마다 이름이 갈린다. */}
                {canShare && (
                  <ShareDocButton driveFileId={c.driveFileId} fileName={`${c.tenantName}_계약서.pdf`}
                    className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors disabled:opacity-50" />
                )}
                <a href={c.viewUrl} target="_blank" rel="noreferrer"
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-[var(--canvas)] border border-[var(--warm-border)] text-[var(--warm-dark)] hover:bg-[var(--warm-border)] transition-colors">
                  원본 보기
                </a>
                <button type="button" onClick={() => handleDelete(c.id, c.tenantName)} disabled={pending && deletingId === c.id}
                  className="px-2 py-1.5 text-xs font-medium rounded-lg text-[var(--danger-fg)] hover:text-[var(--danger-fg)] hover:bg-[var(--danger-bg)] disabled:opacity-40 transition-colors">
                  {pending && deletingId === c.id ? '삭제 중…' : '삭제'}
                </button>
              </div>
              )}
            </li>
            )
          })}
        </ul>
      )}

      {/* 다중 'PDF 보내기' 하단 바 — §22 SelectionPillBar 셸(DocMultiShareBar). PNG 변환 금지(다페이지 유실) */}
      {selectMode && selected.size > 0 && (
        <DocMultiShareBar
          count={selected.size}
          done={share.done}
          failedCount={share.failedCount}
          mode="pdf"
          sendLabel="PDF 보내기"
          totalBytes={share.totalBytes}
          onSend={share.send}
          onClose={exitSelectMode}
        />
      )}
    </div>
  )
}
