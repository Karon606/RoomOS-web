'use client'

import { InfoHint } from '@/components/ui/InfoHint'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { useEffect, useMemo, useState, useTransition } from 'react'
// 서류 화면으로는 **전체 페이지 이동**으로 들어간다(next/link 아님).
// 라우트 layout 의 확대 허용 viewport 가 새 문서 파싱 시점에 확실히 적용되게 하려는 것이다.
// 서류 라우트는 (app) 밖이라 소프트 내비를 해도 셸을 통째로 다시 세우므로 잃는 것이 사실상 없다.
//
// 주의 — 이 선언이 확대를 주는 것은 데스크톱뿐이다. 아이폰 홈화면 앱은 선언을 존중하지만 표시 모드
// 자체가 사용자 확대를 안 주고, 사파리·안드로이드는 접근성 때문에 확대 금지를 아예 무시해 원래 확대된다.
// 확대의 정본은 뷰어(/doc)의 자체 확대다. knowledge/mobile-scroll-viewport.md 의 표시 모드 절 참조.
import { useRouter, useSearchParams } from 'next/navigation'
import { EmptyState } from '@/components/ui/EmptyState'
import { useEntityModal } from '@/components/entity-modal/EntityModal'
import { pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { STATUS_LABEL } from '@/lib/statusColors'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { deleteResidenceCertFile, restoreResidenceCertFile, type ResidenceCertListRow, type IssuableTenant } from './actions'
import { SendDocButton } from '@/components/ui/SendDocButton'
import { SearchBar } from '@/components/ui/SearchBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { Btn, btnClass } from '@/components/ui/Btn'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { fetchDocBytes } from '@/lib/docBytes'
import { DocMultiShareBar } from '@/components/ui/DocMultiShareBar'
import { useDocShare, type DocShareEntry } from '@/lib/useDocShare'
import { useLongPress } from '@/lib/useLongPress'
import { canShareFiles } from '@/lib/shareFile'
import { prewarmPdfToPng } from '@/lib/pdfToPng'

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋
const fmtRoomNo = (no: string | null) => (no ? (/^\d+$/.test(no) ? `${no}호` : no) : '')

export default function ResidenceCertClient({ files, tenants }: { files: ResidenceCertListRow[]; tenants: IssuableTenant[] }) {
  const router = useRouter()
  const entityModal = useEntityModal()
  const [tenantQuery, setTenantQuery] = useState('')
  const searchParams = useSearchParams()
  // 전역 통합 검색 ?q= 딥링크 시딩(발급 이력 파일 검색)
  const [fileQuery, setFileQuery] = useState(() => searchParams.get('q') ?? '')
  const [fileStatus, setFileStatus] = useState('')
  const [pending, startTransition] = useTransition()
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // 다중 '보내기' 선택 모드 — 읽기 액션이라 STAFF 도 가능(canEdit 에 묶지 않음).
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  // 파일 공유 미지원(인앱 브라우저·데스크톱)이면 '보내기'·선택 진입을 숨긴다. 마운트 후 판정(SSR 불가).
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
  const enterSelectMode = () => { prewarmPdfToPng(); setSelectMode(true) }
  const exitSelectMode = () => { setSelectMode(false); setSelected(new Set()) }

  const tenantRows = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(t =>
      t.tenantName.toLowerCase().includes(q) || (t.roomNo ?? '').toLowerCase().includes(q))
  }, [tenants, tenantQuery])

  // 발급 이력 상태 필터 옵션 — 실제 존재하는 입주자 상태만
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of files) if (c.status) m[c.status] = (m[c.status] ?? 0) + 1
    return m
  }, [files])

  const fileRows = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    return files.filter(c =>
      (!fileStatus || c.status === fileStatus) &&
      (!q ||
        c.tenantName.toLowerCase().includes(q) ||
        c.fileName.toLowerCase().includes(q) ||
        (c.roomNo ?? '').toLowerCase().includes(q))
    )
  }, [files, fileQuery, fileStatus])

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name}님의 이 실거주 확인서를 삭제할까요?`, message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteResidenceCertFile(id)
      setDeletingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '실거주 확인서 삭제됨', { action: { label: '적용취소', run: () => { void restoreResidenceCertFile(id).then(r => { if (r.ok) router.refresh(); else pushToast('error', r.error) }) } } })
      router.refresh()
    })
  }

  // 선택 항목을 표시 순서대로 — 첨부 순서·파일명 충돌 판정에 그대로 쓰인다.
  const shareEntries: DocShareEntry[] = fileRows
    .filter(c => selected.has(c.id))
    .map(c => ({
      id: c.driveFileId,
      personName: c.tenantName,
      docLabel: '실거주확인서',
      dateStr: fmtDate(c.issuedAt),
      fetchBytes: fetchDocBytes(c.driveFileId),
    }))
  const share = useDocShare(shareEntries, 'png')

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-[var(--warm-dark)]">실거주 확인서
          <InfoHint title="실거주 확인서란?">거주중·퇴실 예정·비거주 계약의 입실자를 선택해 발급하면 영업장 주소·면적·임대료·도장이 자동으로 채워집니다. 발급한 PDF는 아래 이력과 연결된 Google Drive에 보관됩니다.</InfoHint>
        </h1>
      </div>

      {/* 새 확인서 작성 — 거주중 입실자 선택(발급은 작성 화면의 확정 버튼에서) */}
      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">새 확인서 작성</h2>
        <div className="sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={tenantQuery} onChange={setTenantQuery} placeholder="이름·호실로 입실자 찾기" />
        </div>
        {tenants.length === 0 ? (
          <EmptyState title="거주중인 입실자가 없습니다" />
        ) : tenantRows.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] px-1 py-2">조건에 맞는 입실자가 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tenantRows.map(t => (
              <li key={t.tenantId}>
                <a
                  href={`/residence-cert/${t.tenantId}`}
                  className="flex items-center justify-between gap-1 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 hover:border-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">
                  <span className="min-w-0 flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--warm-dark)]">
                      {t.roomNo ? `${fmtRoomNo(t.roomNo)} · ` : ''}{t.tenantName}
                    </span>
                    {/* 상태 배지 — 비거주·퇴실 예정만(신고 ace54135). 정본 StatusBadge, /rooms 선례와 동일 톤 */}
                    {t.status === 'NON_RESIDENT' && <StatusBadge tone="info" className="shrink-0">비거주</StatusBadge>}
                    {t.status === 'CHECKOUT_PENDING' && <StatusBadge tone="exit" className="shrink-0">퇴실 예정</StatusBadge>}
                  </span>
                  <span className="text-[var(--coral)] text-xs shrink-0">발급 ›</span>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 발급 이력 */}
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)]">발급 이력 <span className="text-[var(--warm-muted)] font-normal">{files.length}건</span></h2>
          {/* 다중 '보내기' 선택 — 파일 공유 지원 기기에서만 노출 */}
          {canShare && files.length > 0 && (
            <Btn type="button" variant="secondary" size="sm"
              onClick={() => selectMode ? exitSelectMode() : enterSelectMode()}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
          )}
        </div>
        {files.length > 0 && (
          <div className="sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
            <SearchBar value={fileQuery} onChange={setFileQuery} placeholder="이름·호실·파일명 검색" />
          </div>
        )}
        {Object.keys(statusCounts).length >= 2 && (
          <SegmentedControl<string>
            size="sm"
            scroll
            ariaLabel="발급 이력 상태 필터"
            value={fileStatus}
            onChange={setFileStatus}
            options={[
              { value: '', label: `전체 ${files.length}` },
              ...Object.keys(statusCounts).map(s => ({ value: s, label: `${STATUS_LABEL[s] ?? s} ${statusCounts[s]}` })),
            ]}
          />
        )}
        {fileRows.length === 0 ? (
          <EmptyState
            title={files.length === 0 ? '발급한 확인서가 아직 없습니다' : '조건에 맞는 확인서가 없습니다'}
            description={files.length === 0 ? '위에서 입실자를 선택해 발급하면 여기에 모입니다.' : '검색어를 조정해 보세요.'}
          />
        ) : (
          <ul className="space-y-2">
            {fileRows.map(c => {
              const sel = selected.has(c.id)
              return (
              <li key={c.id}
                onClick={selectMode ? () => toggleSelect(c.id) : undefined}
                {...(!selectMode ? longPress(() => { enterSelectMode(); toggleSelect(c.id) }) : {})}
                className={[
                  'bg-[var(--cream)] border rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3 transition-colors',
                  selectMode ? 'cursor-pointer select-none' : '',
                  selectMode && sel ? 'border-[var(--coral)] ring-2 ring-[var(--coral)]/[0.16]' : 'border-[var(--warm-border)]',
                ].join(' ')}>
                <div className="min-w-0 flex-1 flex items-start gap-2.5">
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
                      {c.status && <span className="text-[0.65625rem] text-[var(--warm-muted)]">{STATUS_LABEL[c.status] ?? c.status}</span>}
                    </div>
                    <p className="text-[0.6875rem] text-[var(--warm-muted)] truncate mt-0.5">{c.fileName}</p>
                    <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">{fmtDate(c.issuedAt)} 발급</p>
                  </div>
                </div>
                {/* 선택 모드에선 개별 액션 숨김 — 하단 바로 일괄 전송 */}
                {!selectMode && (
                <div className="flex items-center gap-1.5 flex-wrap sm:shrink-0 sm:justify-end">
                  {/* 보기 = 앱 안 PDF 뷰어(인쇄·저장·확대가 여기서 다 된다). §22 solid 는 이 하나.
                      종전 '원본 보기'는 구글 드라이브로 나가 앱을 벗어났다. */}
                  <ViewDocButton driveFileId={c.driveFileId} from="residence-certs" />
                  {/* 보내기 = 사진/PDF 형식 선택 후 전달(일부 문자 앱 PDF 첨부 불가, 운영자 확인 2026-07-22).
                      조건 없이 띄운다 — 기기마다 행이 달라지면 학습이 안 되고, 데스크톱도 다운로드 폴백이 있다. */}
                  <SendDocButton getPdfBytes={fetchDocBytes(c.driveFileId)} fileName={`${c.tenantName}_실거주확인서`}
                    className={btnClass('secondary', 'sm')} />
                  <a href={`/residence-cert/${c.tenantId}`} className={btnClass('secondary', 'sm')}>
                    다시 작성
                  </a>
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
        )}
      </section>

      {/* 다중 '보내기' 하단 바 — §22 SelectionPillBar 셸(DocMultiShareBar) */}
      {selectMode && selected.size > 0 && (
        <DocMultiShareBar
          count={selected.size}
          done={share.done}
          failedCount={share.failedCount}
          mode="png"
          sendLabel="사진 보내기"
          onSend={share.send}
          onClose={exitSelectMode}
        />
      )}
    </div>
  )
}
