'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { fmtDateDot as fmtDate, fmtMD } from '@/lib/fmtDate'
import { useRouter, useSearchParams } from 'next/navigation'
import { Btn, BtnLink, btnClass } from '@/components/ui/Btn'
import { SectionHeader } from '@/components/ui/inventory/SectionHeader'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { fetchDocBytes } from '@/lib/docBytes'
import { EmptyState } from '@/components/ui/EmptyState'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { STATUS_LABEL } from '@/lib/statusColors'
import { deleteContractFile, restoreContractFile } from '@/app/(app)/tenants/actions'
import type { ContractListRow, PendingIssueRow } from './actions'
import { SendDocButton } from '@/components/ui/SendDocButton'
import { SearchBar } from '@/components/ui/SearchBar'
import { DocMultiShareBar } from '@/components/ui/DocMultiShareBar'
import { useDocShare, type DocShareEntry } from '@/lib/useDocShare'
import { useLongPress } from '@/lib/useLongPress'
import { canShareFiles } from '@/lib/shareFile'

const fmtRoomNo = (no: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋
const SOURCE_LABEL: Record<string, string> = { GENERATED: '앱 서명', UPLOADED: '스캔 업로드' }

// 퇴실 그룹: 퇴실 완료 + 입실 취소. 연결 계약이 없는(status null) 파일은 거주중 쪽에 둔다.
const isDeparted = (status: string | null) => status === 'CHECKED_OUT' || status === 'CANCELLED'

// pending prop 은 pendingIssues 로 받는다 — 아래 useTransition 의 pending 과 이름이 겹친다.
export default function ContractsClient({ contracts, pending: pendingIssues }: { contracts: ContractListRow[]; pending: PendingIssueRow[] }) {
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
  // 다건 전송은 PDF 원본으로만 한다(mode='pdf' 강제). 단건 '보내기'는 2026-08-01 부터 사진도
  // 되지만(pdfToPngBlobs 로 전 페이지), 다건 큐(lib/docShareQueue)는 아직 1페이지 함수를 쓴다.
  // 여기를 png 로 열려면 큐의 Map<string, Blob> 을 배열로 넓혀야 하고 그러면 영수증 다건 경로까지
  // 건드린다. 그 전까지는 PDF 고정이 안전하다 — 뒷장(환불조항·서명면)이 유실되기 때문.
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

  // 발급 대기 행은 파일이 아니라 '아직 파일이 없는 계약'이다. 그래서 검색어(이름·호실)에만 반응한다.
  // 출처 필터는 앱 서명·스캔이라는 파일의 속성이라 대기 행이 답할 수 없고, 발급 대기는 언제나 거주중이라
  // 퇴실 보기에 낄 자리가 없으며, 선택 모드는 보낼 파일이 있는 행만 담아야 해 절대 섞이면 안 된다.
  const pendingRows = useMemo(() => {
    if (source !== 'all' || residency === 'departed' || selectMode) return []
    const q = query.trim().toLowerCase()
    if (!q) return pendingIssues
    return pendingIssues.filter(p =>
      p.tenantName.toLowerCase().includes(q) || (p.roomNo ?? '').toLowerCase().includes(q),
    )
  }, [pendingIssues, query, residency, source, selectMode])
  const pendingHidden = pendingIssues.length - pendingRows.length

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
        {/* 스코프 밖 안내(§27.6) — 지금 보기에서 빠진 발급 대기가 있다는 사실만 알리고 자동 해제는 안 한다.
            선택 모드에선 감춘다. 그때는 대기 행이 스코프 밖이 아니라 아예 대상이 아니고, 복원해도
            여전히 안 나와 누를 수 없는 버튼이 되기 때문이다. */}
        {pendingHidden > 0 && !selectMode && (
          <button type="button" onClick={() => { setSource('all'); setResidency('current') }}
            className="text-xs text-[var(--warm-muted)] hover:text-[var(--coral)] transition-colors">
            발급 대기에 <span className="font-semibold text-[var(--warm-dark)]">{pendingHidden}건</span> 더 있음 · 전체에서 보기 ›
          </button>
        )}
      </div>

      {/* 발급 대기 — 서명은 들어왔는데 계약서 파일이 아직 없는 계약. 파일 목록에는 존재할 수 없는 행이라
          여기서 따로 세운다. 이게 없어서 서명 완료 계약이 화면에서 통째로 사라졌다(오류신고 d41eea8c). */}
      {pendingRows.length > 0 && (
        <div>
          <SectionHeader
            first
            name={<>발급 대기 <span className="text-[0.6875rem] font-medium text-[var(--coral)]">서명 완료</span></>}
            count={`${pendingRows.length}건`}
          />
          <p className="text-[0.6875rem] text-[var(--warm-muted)] pb-2">서명은 받았고 계약서 파일이 아직 없습니다. 발급을 누르면 서명 당시 내용으로 계약서 화면이 열립니다.</p>
          <ul className="space-y-2">
            {pendingRows.map(p => (
              <li key={p.linkId}
                className="bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl p-3.5 flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => entityModal.open({ kind: 'tenant', tenantId: p.tenantId })}
                    className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--coral)] transition-colors">
                    {p.roomNo ? `${fmtRoomNo(p.roomNo)} · ` : ''}{p.tenantName}
                  </button>
                  <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{fmtMD(p.signedAt)} 서명{p.submitted ? ' · 제출 완료' : ''}</p>
                </div>
                {/* 보기·보내기·삭제는 두지 않는다 — 아직 대상 파일이 없어 셋 다 거짓 약속이 된다. */}
                <BtnLink href={`/contract/${p.tenantId}?share=${p.linkId}`} variant="primary" size="sm" className="shrink-0">
                  발급
                </BtnLink>
              </li>
            ))}
          </ul>
        </div>
      )}

      {rows.length === 0 && pendingRows.length === 0 ? (
        <EmptyState
          title={contracts.length === 0 ? '계약서가 아직 없습니다' : '조건에 맞는 계약서가 없습니다'}
          description={contracts.length === 0 ? '고객 정보에서 계약서를 작성해 서명받거나 스캔본을 올리면 여기에 모입니다.' : '검색어나 필터를 조정해 보세요.'}
        />
      ) : (
        <div>
        {/* 대기 섹션이 떠 있을 때만 본 목록에 이름표를 붙인다. 대기 0건이면 지금 화면과 픽셀 동일하다. */}
        {pendingRows.length > 0 && <SectionHeader name="보관된 계약서" count={`${rows.length}건`} />}
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
                {/* 보기 = 앱 안 PDF 뷰어(인쇄·저장·확대가 여기서 다 된다). §22 solid 는 이 하나.
                    종전 '원본 보기'는 구글 드라이브로 나가 앱을 벗어났다. */}
                <ViewDocButton driveFileId={c.driveFileId} from="contracts" />
                {/* 보내기는 조건 없이 띄운다 — 형제 2화면과 같게. canShare 로 숨기면 기기마다 행이 달라져
                    학습이 안 되고, 데스크톱에서도 다운로드 폴백과 안내 토스트가 있어 실패하지 않는다. */}
                <SendDocButton getPdfBytes={fetchDocBytes(c.driveFileId)} fileName={`${c.tenantName}_계약서`}
                  className={btnClass('secondary', 'sm')} />
                <Btn variant="ghost" size="sm" onClick={() => handleDelete(c.id, c.tenantName)}
                  disabled={pending && deletingId === c.id} className="text-[var(--danger-fg)]">
                  {pending && deletingId === c.id ? '삭제 중…' : '삭제'}
                </Btn>
              </div>
              )}
            </li>
            )
          })}
        </ul>
        </div>
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
