'use client'

import { useEffect, useMemo, useState, useTransition } from 'react'
import { docFileLabel } from '@/lib/docBundle'
import { InfoHint } from '@/components/ui/InfoHint'
import MonthSelector from '@/components/layout/MonthSelector'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
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
import { deleteRentReceiptFile, restoreRentReceiptFile, type RentReceiptListRow, type IssuableTenant } from './actions'
import { SendDocButton } from '@/components/ui/SendDocButton'
import { SearchBar } from '@/components/ui/SearchBar'
import { SegmentedControl } from '@/components/ui/SegmentedControl'
import { ViewTabs } from '@/components/ui/ViewTabs'
import { Btn, btnClass } from '@/components/ui/Btn'
import { ViewDocButton } from '@/components/ui/ViewDocButton'
import { PrintDocButton } from '@/components/ui/PrintDocButton'
import { fetchDocBytes } from '@/lib/docBytes'
import { DocMultiShareBar } from '@/components/ui/DocMultiShareBar'
import { useDocShare, type DocShareEntry } from '@/lib/useDocShare'
import { useLongPress } from '@/lib/useLongPress'
import { canShareFiles } from '@/lib/shareFile'
import { prewarmPdfToPng } from '@/lib/pdfToPng'
import { fmtRoomNo } from '@/lib/roomNo'

const MAX_SHARE = 10   // 브라우저 다중 공유 하드 리밋
export default function RentReceiptsClient({ files, tenants, month, kind = 'rent' }: { files: RentReceiptListRow[]; tenants: IssuableTenant[]; month?: string; kind?: 'rent' | 'deposit' }) {
  // 서류 종류 — 보증금은 귀속 월이 없어 월 쿼리를 넘기지 않는다(신고 d68220bd)
  const isDeposit = kind === 'deposit'
  const docLabel = isDeposit ? '보증금 영수증' : '입실료 납부 확인서'
  // 선택한 달을 발급 화면으로 넘겨 그 달 주기로 자동값이 채워지게 한다(이번 달이면 쿼리 없음).
  const monthQuery = isDeposit ? '?kind=deposit' : (month ? `?month=${month}` : '')
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

  // 이력도 종류별로 갈린다 — 안 그러면 탭이 화면 절반에만 걸리는 반쪽 전환이 된다(디자이너 지적).
  // 분류 정본은 RentReceiptFile.kind 컬럼(기본 'rent' — 도입 전 발급분은 전부 입실료 확인서).
  const kindFiles = useMemo(() => files.filter(c => c.kind === kind), [files, kind])

  // 발급 이력 상태 필터 옵션 — 실제 존재하는 입주자 상태만(현재 종류 안에서)
  const statusCounts = useMemo(() => {
    const m: Record<string, number> = {}
    for (const c of kindFiles) if (c.status) m[c.status] = (m[c.status] ?? 0) + 1
    return m
  }, [kindFiles])

  const tenantRows = useMemo(() => {
    const q = tenantQuery.trim().toLowerCase()
    if (!q) return tenants
    return tenants.filter(t => t.tenantName.toLowerCase().includes(q) || (t.roomNo ?? '').toLowerCase().includes(q))
  }, [tenants, tenantQuery])

  const fileRows = useMemo(() => {
    const q = fileQuery.trim().toLowerCase()
    return kindFiles.filter(c =>
      (!fileStatus || c.status === fileStatus) &&
      (!q || c.tenantName.toLowerCase().includes(q) || c.fileName.toLowerCase().includes(q) || (c.roomNo ?? '').toLowerCase().includes(q))
    )
  }, [kindFiles, fileQuery, fileStatus])

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmDialog({ title: `${name}님의 이 ${docLabel}를 삭제할까요?`, message: 'Google Drive 원본은 휴지통으로 이동하며, 삭제 직후 적용취소로 되살릴 수 있습니다.', level: 'danger', confirmLabel: '삭제' }))) return
    setDeletingId(id)
    startTransition(async () => {
      const res = await deleteRentReceiptFile(id)
      setDeletingId(null)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `${docLabel} 삭제됨`, { action: { label: '적용취소', run: () => { void restoreRentReceiptFile(id).then(r => { if (r.ok) router.refresh(); else pushToast('error', r.error) }) } } })
      router.refresh()
    })
  }

  // 선택 항목을 표시 순서대로 — 첨부 순서·파일명 충돌 판정에 그대로 쓰인다.
  const shareEntries: DocShareEntry[] = fileRows
    .filter(c => selected.has(c.id))
    .map(c => ({
      id: c.driveFileId,
      personName: c.tenantName,
      docLabel: isDeposit ? '보증금영수증' : '입실료납부확인서',
      dateStr: fmtDate(c.issuedAt),
      fetchBytes: fetchDocBytes(c.driveFileId),
    }))
  const share = useDocShare(shareEntries, 'png')

  return (
    <div className="space-y-5">
      {/* 헤더 — 제목+뷰탭 좌측, 월 선택 우측(수납 관리와 동일 문법 §25).
          보증금은 귀속 월이 없어 월 선택을 비활성 자리표시로 둔다(사라지면 헤더가 출렁인다). */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="text-xl font-bold text-[var(--warm-dark)]">납부 확인서 · 영수증
            <InfoHint title="어떤 서류인가요?">
              입실료 납부 확인서는 입실자(비거주 계약 포함)의 그 달 이용료 납부 사실을, 보증금 영수증은 계약 보증금의 수령 사실을 증명합니다.
              입실자를 선택하면 이름·호실·거주기간·금액·수령인·도장이 자동으로 채워집니다.
              금액은 실제 받은 기록에서 가져오므로, 받지 않은 돈이 서류에 적히지 않습니다.
              발급한 PDF는 아래 이력과 연결된 Google Drive에 보관됩니다.
            </InfoHint>
          </h1>
          <ViewTabs ariaLabel="서류 종류" activeId={kind}
            tabs={[
              { id: 'rent',    label: '입실료', href: '/rent-receipts' },
              { id: 'deposit', label: '보증금', href: '/rent-receipts?kind=deposit' },
            ]} />
        </div>
        {isDeposit
          ? <span className="text-xs text-[var(--warm-muted)]">보증금은 월과 무관합니다</span>
          : <MonthSelector />}
      </div>

      <section className="space-y-2">
        <h2 className="text-sm font-semibold text-[var(--warm-dark)]">새 {docLabel} 발급</h2>
        <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">
          {isDeposit ? '입주 예정자도 발급할 수 있습니다. 실제 받은 보증금이 채워집니다' : '발급된 PDF는 연결된 Google Drive에 저장됩니다'}
        </p>
        <div className="sticky top-0 z-10 -mt-2 py-2 bg-[var(--canvas)]">
        <SearchBar value={tenantQuery} onChange={setTenantQuery} placeholder="이름·호실로 입실자 찾기" />
        </div>
        {tenants.length === 0 ? (
          <EmptyState title="발급 대상 입실자가 없습니다" />
        ) : tenantRows.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)] px-1 py-2">조건에 맞는 입실자가 없습니다.</p>
        ) : (
          <ul className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {tenantRows.map(t => (
              <li key={t.tenantId}>
                <a href={`/rent-receipt/${t.tenantId}${monthQuery}`}
                  className="flex items-center justify-between gap-1 bg-[var(--cream)] border border-[var(--warm-border)] rounded-xl px-3 py-2.5 hover:border-[var(--coral)] hover:bg-[var(--coral)]/5 transition-colors">
                  <span className="min-w-0 flex items-center gap-1.5">
                    <span className="min-w-0 truncate text-sm font-medium text-[var(--warm-dark)]">
                      {t.roomNo ? `${fmtRoomNo(t.roomNo)} · ` : ''}{t.tenantName}
                    </span>
                    {/* 상태 배지 — 비거주·퇴실 예정만. 정본 StatusBadge, 실거주 확인서 목록과 동일 톤 */}
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

      <section className="space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-[var(--warm-dark)]">발급 이력 <span className="text-[var(--warm-muted)] font-normal">{kindFiles.length}건</span></h2>
          {/* 다중 '보내기' 선택 — 파일 공유 지원 기기에서만 노출 */}
          {canShare && kindFiles.length > 0 && (
            <Btn type="button" variant="secondary" size="sm"
              onClick={() => selectMode ? exitSelectMode() : enterSelectMode()}>
              {selectMode ? '선택 취소' : '선택'}
            </Btn>
          )}
        </div>
        {kindFiles.length > 0 && (
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
              { value: '', label: `전체 ${kindFiles.length}` },
              ...Object.keys(statusCounts).map(s => ({ value: s, label: `${STATUS_LABEL[s] ?? s} ${statusCounts[s]}` })),
            ]}
          />
        )}
        {fileRows.length === 0 ? (
          <EmptyState
            title={kindFiles.length === 0 ? `발급한 ${docLabel}가 아직 없습니다` : `조건에 맞는 ${docLabel}가 없습니다`}
            description={kindFiles.length === 0 ? '위에서 입실자를 선택해 발급하면 여기에 모입니다.' : '검색어를 조정해 보세요.'}
          />
        ) : (
          <ul className="space-y-2">
            {fileRows.map(c => {
              const sel = selected.has(c.id)
              // '다시 작성'이 여는 URL — 종류와 계약을 그 행에서 가져온다.
              const reissueQuery = [
                c.kind === 'deposit' ? 'kind=deposit' : '',
                c.leaseTermId ? `leaseTermId=${encodeURIComponent(c.leaseTermId)}` : '',
              ].filter(Boolean).join('&')
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
                        <button type="button" onClick={() => entityModal.open({ kind: 'tenant', tenantId: c.tenantId })}
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
                  <ViewDocButton driveFileId={c.driveFileId} from="rent-receipts" />
                  {/* 보내기 = 사진/PDF 형식 선택 후 전달(일부 문자 앱 PDF 첨부 불가, 운영자 확인 2026-07-22).
                      조건 없이 띄운다 — 기기마다 행이 달라지면 학습이 안 되고, 데스크톱도 다운로드 폴백이 있다. */}
                  <SendDocButton getPdfBytes={fetchDocBytes(c.driveFileId)} fileName={`${c.docName}_${docFileLabel(isDeposit ? 'deposit' : 'rent', c.nameStyle ?? 'ko')}`}
                    className={btnClass('secondary', 'sm')} />
                  {/* 인쇄 = §30 이 등재한 여섯 번째 동사. 종전에는 뷰어 안에만 있었다(신고 71753b36).
                      파일명은 탭이 아니라 그 행의 종류를 따른다 — '다시 작성'과 같은 이유다. */}
                  <PrintDocButton driveFileId={c.driveFileId} from="rent-receipts"
                    fileName={`${c.docName}_${docFileLabel(c.kind === 'deposit' ? 'deposit' : 'rent', c.nameStyle ?? 'ko')}`} />
                  {/* '다시 작성'은 그 행의 종류를 그대로 따른다 — 탭이 아니라 행 기준(보증금 행에서 입실료 폼이
                      열리면 엉뚱한 금액이 자동 채워져 잘못된 서류가 발급된다).
                      종전 라벨 '재발급'은 아무것도 발급하지 않고 작성 화면만 열어 오해를 샀다(2026-08-01 용어 정리). */}
                  {/* 계약도 그 행을 따른다(?leaseTermId=) — 601호 창고 몫 확인서를 다시 열었는데
                      509호 거주 계약이 채워지면 종이와 기록이 갈린다. 계약이 끊긴 옛 발급본은
                      지목 없이 종전 추론으로 연다(무회귀). */}
                  <a href={`/rent-receipt/${c.tenantId}${reissueQuery ? `?${reissueQuery}` : ''}`}
                    className={btnClass('secondary', 'sm')}>다시 작성</a>
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
