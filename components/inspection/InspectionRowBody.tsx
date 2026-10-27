'use client'

// 방 점검 행 한 줄의 표시와 조작 정본 — 방 상세 작업 이력과 호실 관리 '작업' 목록이 이 한 벌을 함께 쓴다(2026-10-27, 신고 2911c217).
//
// 문법은 형제 청소 행(components/cleaning/CleaningRowBody)과 같다. 상태 배지(StatusBadge) · 단계 이름 · 날짜(fmtDateDot) ·
// 행 동작(RowActionBtn) · 그 줄에서 여는 인라인 완료 폼(완료일을 묻는다, 확인 좌 · 취소 우).
// 바깥 껍데기(li 의 배경·패딩·구분선)는 부르는 쪽이 정한다.
//
// 쓰기는 두 무게다(독립 검수 R1, 운영자 결정 ④).
//   · 항목 판정(확인·문제·해당 없음)은 켜고 끄는 토글이다. 토스트 없이 바로 저장하고, 다시 누르면 되돌아가는 것이 적용취소다.
//     행이 든 항목만 고치고 화면 전체를 다시 그리지 않는다. 잠금도 그 항목 하나뿐이라 연달아 체크할 수 있다.
//   · 점검 완료·복원·항목 삭제·손수 더하기는 토스트 [적용취소](§16)가 있다. 점검 상태 쓰기만 부모를 다시 읽는다.
//   · 예정일·메모 고치기와 안 하기로·상태 적용취소·삭제는 [수정] 이 여는 한 건 수정 Modal(InspectionEditModal, 2026-10-27)이 맡는다.
// 체크 상자는 22px r7 정본(§22 '항목 완료 체크')이고 누르는 자리는 44px 다. 판정 셋이 모두 상자에 보인다(확인 = 코랄 채움 + 체크,
// 문제 = warning 틴트 + 가로줄, 해당 없음 = 중립 틴트 + 가로줄). 진행 '점검 N/M' 의 N 이 곧 채워진 상자 수다.
// 같은 판정을 배지·상자·토글로 세 번 말하지 않는다(디자이너 재검수). 상자 + 눌린 토글 칩 + (문제면) 메모가 전부다.
// 토글 칩은 형제 '긴급만' 필터 칩 문법이다(RequestsClient). 켜짐은 의미색 트라이어드(문제 = warning, 해당 없음 = neutral), 꺼짐은 테두리 + --seg-ink-off.
// 꺼짐 바탕만 투명이다. '긴급만' 은 페이지 면(--canvas) 위라 바탕이 --canvas 인데, 이 칩은 카드 안에 서서 --canvas 를 쓰면 다크에서 검은 알약이 된다.
// '문제' 의 색 뜻은 warning(amber) 하나다(상자·칩·미통과 캡션).

import { useEffect, useRef, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { DatePicker } from '@/components/ui/DatePicker'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { pushToast, trackSave, type ToastAction } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtDateDot } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'
import {
  getInspectionItems, setInspectionItemResult, addInspectionItem, removeInspectionItem, restoreInspectionItem,
  completeInspection, reopenInspection, deleteInspection, restoreInspection,
} from '@/app/(app)/room-manage/inspectionActions'
import { InspectionEditModal } from '@/components/inspection/InspectionEditModal'
import {
  INSPECTION_STAGE_LABEL, INSPECTION_STATUS_LABEL, INSPECTION_LABEL_MAX, inspectionProgressText, countChecked,
  type InspectionRow, type InspectionItemRow, type InspectionStatus, type InspectionItemResult,
} from '@/app/(app)/room-manage/inspectionConstants'

// 날짜 칸·글자 칸 껍데기 — 형제 청소 행과 같은 값이다(오류신고 c2ab5b83 의 처방 그대로).
const DENSE_DATE_CLS =
  'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]'
const DENSE_INPUT_CLS =
  'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30'

// 청소 행과 같은 톤 셋이다(완료=paid · 안 함=info · 예정=await). 새 톤을 만들지 않는다.
export const inspectionTone = (s: InspectionStatus): BadgeTone =>
  (s === 'DONE' ? 'paid' : s === 'SKIPPED' ? 'info' : 'await')

// 판정마다 상자 모양. 모양은 하나(22px r7)이고 채움과 표시만 다르다. 문제·해당 없음의 뜻은 아래 틴트 배지가 글자로 말한다.
const BOX_CLS: Record<InspectionItemResult, string> = {
  OK: 'border-[var(--coral)] bg-[var(--coral)] text-[var(--on-solid)]',
  NG: 'border-[var(--warning-fg)] bg-[var(--warning-bg)] text-[var(--warning-fg)]',
  NA: 'border-[var(--warm-border)] bg-[var(--neutral-bg)] text-[var(--warm-muted)]',
  PENDING: 'border-[var(--warm-border)] bg-[var(--cream)] text-transparent',
}

// 토글 칩 — 누르는 자리 44px(RowActionBtn 과 같은 수), 보이는 칩은 '긴급만' 필터 칩과 같은 꼴. aria-pressed 로 켜짐을 말한다.
const CHIP_HIT = '-my-2 min-h-[44px] inline-flex items-center focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--tc-text)] disabled:opacity-50'
const CHIP_ON: Record<'warning' | 'neutral', string> = {
  warning: 'bg-[var(--warning-bg)] text-[var(--warning-fg)] ring-[var(--warning-ring)]',
  neutral: 'bg-[var(--neutral-bg)] text-[var(--warm-dark)] ring-[var(--warm-border)]',
}
function ToggleChip({ on, tone, disabled, onClick, children }: {
  on: boolean; tone: 'warning' | 'neutral'; disabled?: boolean; onClick: () => void; children: React.ReactNode
}) {
  return (
    <button type="button" aria-pressed={on} disabled={disabled} onClick={onClick} className={CHIP_HIT}>
      <span className={`text-[0.65625rem] font-medium px-2.5 py-1 rounded-sm ring-1 transition-colors ${on
        ? CHIP_ON[tone]
        : 'bg-transparent ring-[var(--warm-border)] text-[var(--seg-ink-off)] hover:text-[var(--warm-dark)]'}`}>
        {children}
      </span>
    </button>
  )
}

export function InspectionRowBody({
  row: r, canEdit, deleted = false, modalZ, autoOpen = false, onOpenRoom, onChanged, onItemsSettled,
}: {
  row: InspectionRow
  canEdit: boolean
  /** 삭제된 행 — 복원만 할 수 있다. */
  deleted?: boolean
  /**
   * 한 건 수정 Modal 의 층(2026-10-27). 방 모달(EntityModal) 안이면 260, 페이지(호실 관리 작업 탭)면 200.
   * 종전 '편집' 모드(showActions)는 걷었다. 행에는 [항목 펼치기]·[점검 완료](예정)·[수정] 만 상시로 서고, 안 하기로·상태 적용취소·삭제는
   * 그 Modal 발끝 `관리` 메뉴다(가이드 §27.1·§13). 항목 판정은 행 안에서 그대로다.
   */
  modalZ: 200 | 260
  /** 처음부터 항목을 펼친다(퇴실·청소 완료 토스트의 '열기' 로 들어온 자리). */
  autoOpen?: boolean
  /** 호실번호 버튼 — 영업장 교차 목록에서만 선다. */
  onOpenRoom?: (roomId: string) => void
  onChanged: () => void
  /**
   * 항목을 바꾼 뒤 행을 접거나 화면이 사라질 때 한 번(재검수 권고 5). 항목 쓰기는 화면을 다시 그리지 않으므로(R1) 수·배지가 낡는다.
   * 그 순간 onChanged 를 한 번 부르고, 방 모달처럼 부모 화면(호실 목록 카드)까지 맞춰야 하는 자리는 이 콜백으로 router.refresh 를 건다.
   */
  onItemsSettled?: () => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InspectionItemRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  const [newLabel, setNewLabel] = useState('')
  // 항목 편집 — 켜야 항목 삭제·손수 더하기가 선다. 체크 줄마다 삭제가 상시로 서면 겨눈 체크 옆을 스쳐 눌린다
  // (운영자 지적 2026-08-27 의 판단, 이 점검 한 건의 항목 안에서만 켠다). 기억하지 않는다.
  const [itemEdit, setItemEdit] = useState(false)
  // 문제 메모를 적는 항목 하나. '문제' 를 누르면 먼저 이 칸이 열리고 저장 한 번에 문제 + 메모가 함께 남는다(독립 검수 R9).
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteVal, setNoteVal] = useState('')
  // 저장 중인 항목들. 잠금은 그 항목 하나다(독립 검수 R1). 다른 항목은 그동안에도 누를 수 있다.
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [pending, startTransition] = useTransition()
  // 항목을 바꿨는가. 바꿨으면 접을 때·사라질 때 한 번 부모를 맞춘다(권고 5). 최신 콜백은 ref 로 쥔다(사라질 때 읽는다).
  const itemsDirty = useRef(false)
  const settleRef = useRef<() => void>(() => {})
  settleRef.current = () => {
    if (!itemsDirty.current) return
    itemsDirty.current = false
    onChanged()
    onItemsSettled?.()
  }
  useEffect(() => () => settleRef.current(), [])

  const editable = canEdit && !deleted && r.status === 'PLANNED'
  const stage = INSPECTION_STAGE_LABEL[r.stage]
  // 진행 수는 항목을 들고 있으면 그것으로, 아니면 서버가 센 수로 말한다(같은 규칙: 판정을 마친 항목).
  const judged = items ? countChecked(items) : r.checked
  const total = items ? items.length : r.total
  const ng = items ? items.filter(i => i.result === 'NG').length : r.ng

  const loadItems = () => {
    setLoadFailed(false)
    getInspectionItems(r.id).then(setItems).catch(() => { setItems([]); setLoadFailed(true) })
  }
  const toggleOpen = () => {
    if (!open && items === null) loadItems()
    if (open) settleRef.current()
    setOpen(o => !o)
  }
  useEffect(() => {
    if (autoOpen) { setOpen(true); if (items === null) loadItems() }
    // 들어온 순간 한 번만 연다. items 를 의존성에 넣으면 접어도 다시 열린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  type Res = { ok: true } | { ok: false; error: string }
  // 점검 상태 쓰기 공통부 — 실패는 토스트, 성공은 결과 토스트(+적용취소)와 부모 갱신.
  const run = <T extends Res>(fn: () => Promise<T>, okMsg: string, after?: (res: Extract<T, { ok: true }>) => void, action?: (res: Extract<T, { ok: true }>) => ToastAction) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        const okRes = res as Extract<T, { ok: true }>
        after?.(okRes)
        pushToast('success', okMsg, action ? { action: action(okRes) } : undefined)
        onChanged()
      } finally { release() }
    })
  // 토스트 적용취소(점검 상태 쓰기) — 되돌리는 쓰기를 부르고 사실대로 알린다.
  const undo = (fn: () => Promise<Res>, message: string): ToastAction => ({
    label: '적용취소',
    run: () => { void fn().then(res => {
      if (res.ok) { pushToast('info', message); onChanged() }
      else pushToast('error', res.error)
    }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
  })

  // 항목 쓰기 공통부 — 그 항목만 잠그고, 행이 든 항목만 고친다(부모를 다시 읽지 않는다). 실패는 토스트.
  const itemRun = async <T extends Res>(key: string, fn: () => Promise<T>, onOk: (res: Extract<T, { ok: true }>) => void) => {
    setBusy(prev => new Set(prev).add(key))
    const release = trackSave()
    try {
      const res = await fn()
      if (!res.ok) { pushToast('error', res.error); return }
      itemsDirty.current = true
      onOk(res as Extract<T, { ok: true }>)
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally {
      release()
      setBusy(prev => { const next = new Set(prev); next.delete(key); return next })
    }
  }
  const replaceItem = (it: InspectionItemRow) => setItems(prev => prev ? prev.map(x => x.id === it.id ? it : x) : prev)
  // 판정 토글 — 토스트가 없다(운영자 결정 ④). 같은 자리를 다시 누르면 미확인으로 돌아간다.
  const setResult = (it: InspectionItemRow, result: InspectionItemResult, note?: string | null) =>
    void itemRun(it.id, () => setInspectionItemResult({ itemId: it.id, result, ...(note !== undefined ? { note } : {}) }), res => replaceItem(res.item))

  // 문제 메모 저장. 문제로 켜면서 처음 적는 메모는 판정 토글이라 토스트가 없다(결정 ④). 이미 적힌 메모를 고치면 옛 글이 사라지므로
  // 토스트 [적용취소] 로 옛 글을 되살린다(재검수 권고 6a).
  const saveNote = (it: InspectionItemRow, text: string) => {
    const prevNote = it.note
    const editing = !!prevNote && prevNote !== (text.trim() || null)
    void itemRun(it.id, () => setInspectionItemResult({ itemId: it.id, result: 'NG', note: text }), res => {
      replaceItem(res.item)
      if (!editing) return
      pushToast('success', `'${it.label}' 메모를 고쳤습니다`, { action: {
        label: '적용취소',
        run: () => { void setInspectionItemResult({ itemId: it.id, result: res.item.result, note: prevNote }).then(back => {
          if (!back.ok) { pushToast('error', back.error); return }
          replaceItem(back.item); itemsDirty.current = true
          pushToast('info', `'${it.label}' 메모를 되살렸습니다`)
        }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
      } })
    })
  }

  const addItem = () => {
    const label = newLabel.trim()
    if (!label) return
    void itemRun('__add', () => addInspectionItem({ inspectionId: r.id, label }), res => {
      setItems(prev => prev ? [...prev, res.item] : prev); setNewLabel('')
      pushToast('success', `'${res.item.label}' 항목 추가됨`, { action: {
        label: '적용취소',
        run: () => { void removeInspectionItem(res.item.id).then(back => {
          if (!back.ok) { pushToast('error', back.error); return }
          setItems(prev => prev ? prev.filter(x => x.id !== res.item.id) : prev)
          pushToast('info', `'${res.item.label}' 추가를 적용취소했습니다`)
        }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
      } })
    })
  }

  const removeItem = (it: InspectionItemRow) =>
    void itemRun(it.id, () => removeInspectionItem(it.id), res => {
      setItems(prev => prev ? prev.filter(x => x.id !== it.id) : prev)
      pushToast('success', `'${it.label}' 항목 삭제됨`, { action: {
        label: '적용취소',
        run: () => { void restoreInspectionItem(res.snapshot).then(back => {
          if (!back.ok) { pushToast('error', back.error); return }
          setItems(prev => prev ? [...prev, back.item].sort((a, b) => a.sortOrder - b.sortOrder) : prev)
          pushToast('info', `'${it.label}' 항목을 되살렸습니다`)
        }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
      } })
    })

  const submitDone = async () => {
    const left = total - judged
    // 판정 안 한 항목이 있어도 막지 않는다. 그 항목은 미확인으로 남는다는 것만 한 번 묻는다.
    if (left > 0 && !(await confirmDialog({
      title: `판정 안 한 항목이 ${left}개 있습니다`,
      message: '그 항목은 미확인으로 남습니다. 완료로 기록할까요?',
      confirmLabel: '완료 기록', level: 'caution',
    }))) return
    run(() => completeInspection({ id: r.id, doneDate }), `${stage} 완료로 기록됨`, () => setDoneOpen(false),
      () => undo(() => reopenInspection(r.id), '완료를 적용취소했습니다 · 예정으로 복귀'))
  }

  return (
    <>
      <div className={`flex items-center gap-1.5 flex-wrap${deleted ? ' opacity-60' : ''}`}>
        {onOpenRoom && (
          <button type="button" onClick={() => onOpenRoom(r.roomId)}
            className="text-sm font-semibold text-[var(--warm-dark)] hover:text-[var(--tc-text)] transition-colors">
            {fmtRoomNo(r.roomNo)}
          </button>
        )}
        <StatusBadge tone={inspectionTone(r.status)}>{INSPECTION_STATUS_LABEL[r.status]}</StatusBadge>
        <span className="text-xs text-[var(--warm-dark)]">{stage}</span>
        {/* 입실 전 점검은 다음 입실 날을 아직 몰라 예정일 없이 선다. '—' 가 아니라 할 일이 날짜를 기다린다는 말이다(청소 행과 같은 판정). */}
        {r.status === 'PLANNED' && !r.scheduledDate ? (
          <span className="text-xs text-[var(--warm-muted)]">예정일 미정</span>
        ) : (
          <span className="text-xs text-[var(--warm-muted)] num">{fmtDateDot(r.status === 'DONE' ? r.doneDate : r.scheduledDate)}</span>
        )}
        {total > 0 && <span className="text-xs text-[var(--warm-muted)] num">{inspectionProgressText(judged, total)}</span>}
        {ng > 0 && <span className="text-xs font-medium text-[var(--warning-fg)] num">미통과 {ng}항목</span>}
      </div>
      {r.memo && <p className={`mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-words${deleted ? ' opacity-60' : ''}`}>{r.memo}</p>}

      {/* 항목 — 펼쳤을 때만. 첫 조회는 뼈대(§17). 면은 --cream + 테두리다. --canvas 는 페이지 배경 토큰이라 다크에서 카드 안에
          검은 구멍이 뚫린다(TenantDocBundleSheet 와 같은 판정). */}
      {open && (
        <div className="mt-2 rounded-lg border border-[var(--warm-border)] bg-[var(--cream)] px-2.5 py-1.5">
          {items === null ? (
            <SkeletonRows rows={3} className="py-1" />
          ) : loadFailed ? (
            <p className="py-1 text-xs text-[var(--danger-fg)]">점검 항목을 불러오지 못했습니다.</p>
          ) : items.length === 0 ? (
            <p className="py-1 text-xs text-[var(--warm-muted)]">항목이 없습니다.</p>
          ) : (
            <ul className="divide-y divide-[var(--warm-border)]/60">
              {items.map(it => {
                const ok = it.result === 'OK'
                const locked = !editable || busy.has(it.id)
                return (
                  <li key={it.id} className="flex items-start gap-1 py-1.5">
                    {/* 22px r7 체크(§22) · 누르는 자리 44px. 확인 토글이다(확인이면 미확인으로, 그 밖이면 확인으로). */}
                    <button type="button" role="checkbox" aria-checked={ok} aria-label={`${it.label} 확인`}
                      disabled={locked}
                      onClick={() => setResult(it, ok ? 'PENDING' : 'OK')}
                      className="-my-[11px] -ml-[11px] grid min-h-[44px] min-w-[44px] shrink-0 place-items-center disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-[9px] focus-visible:outline-[var(--tc-text)]">
                      <span className={[
                        'grid h-[22px] w-[22px] place-items-center rounded-[7px] border transition-colors',
                        BOX_CLS[it.result],
                        !editable && it.result === 'PENDING' ? 'opacity-60' : '',
                      ].join(' ')} aria-hidden>
                        {it.result === 'NG' || it.result === 'NA' ? (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="M6 12h12" /></svg>
                        ) : (
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                        )}
                      </span>
                    </button>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className={`text-xs break-keep ${it.result === 'NA' ? 'text-[var(--warm-muted)]' : 'text-[var(--warm-dark)]'}`}>
                        {it.label}
                        {it.source === 'ASSET' && <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">비품</span>}
                      </p>
                      {/* 메모는 문제일 때만 보인다. 문제를 끄면 저장된 채 숨고, 다시 문제로 켜면 돌아온다(권고 6b). */}
                      {it.result === 'NG' && it.note && noteFor !== it.id && (
                        <p className="mt-0.5 text-[0.65625rem] text-[var(--warm-muted)] break-words">{it.note}</p>
                      )}
                      {noteFor === it.id ? (
                        /* 문제 메모 — 저장 한 번이 문제 + 메모를 함께 남긴다. 취소는 아무것도 안 바꾼다(§27.5). */
                        <div className="mt-1.5 space-y-1.5">
                          <input type="text" value={noteVal} onChange={e => setNoteVal(e.target.value)} maxLength={500}
                            placeholder="무엇이 문제인지 (선택)" aria-label={`${it.label} 문제 메모`} className={`w-full ${DENSE_INPUT_CLS}`} />
                          <div className="flex gap-2">
                            <Btn variant="primary" size="sm" disabled={locked}
                              onClick={() => { saveNote(it, noteVal); setNoteFor(null) }}>저장</Btn>
                            <Btn variant="secondary" size="sm" onClick={() => setNoteFor(null)}>취소</Btn>
                          </div>
                        </div>
                      ) : editable && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {/* 문제·해당 없음은 켜고 끄는 토글이다(aria-pressed). 켜진 것을 다시 누르면 미확인으로 돌아간다. */}
                          <ToggleChip tone="warning" on={it.result === 'NG'} disabled={locked}
                            onClick={() => {
                              if (it.result === 'NG') { setResult(it, 'PENDING'); return }
                              setNoteVal(it.note ?? ''); setNoteFor(it.id)
                            }}>문제</ToggleChip>
                          {it.result === 'NG' && (
                            <RowActionBtn tone="neutral" disabled={locked}
                              onClick={() => { setNoteVal(it.note ?? ''); setNoteFor(it.id) }}>메모</RowActionBtn>
                          )}
                          <ToggleChip tone="neutral" on={it.result === 'NA'} disabled={locked}
                            onClick={() => setResult(it, it.result === 'NA' ? 'PENDING' : 'NA')}>해당 없음</ToggleChip>
                          {itemEdit && (
                            <RowActionBtn tone="danger" disabled={locked} className="ml-auto" onClick={() => removeItem(it)}>삭제</RowActionBtn>
                          )}
                        </div>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
          {/* 손수 더하기 — 목록에 없는 비품(공유기·셋탑 같은 것)을 이 점검에만 더한다. 영업장 목록은 분류 관리에서 고친다.
              항목 편집을 켜야 선다. 토글은 목록 아래 오른쪽이다. */}
          {editable && items !== null && !loadFailed && (
            <div className="mt-1.5 space-y-2 border-t border-[var(--warm-border)]/60 pt-2">
              {itemEdit && (
                <div className="flex items-center gap-2">
                  <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} maxLength={INSPECTION_LABEL_MAX}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addItem() } }}
                    placeholder="항목 더하기 (예: 공유기)" aria-label="점검 항목 더하기" className={DENSE_INPUT_CLS} />
                  <Btn variant="secondary" size="sm" disabled={busy.has('__add') || !newLabel.trim()} onClick={addItem}>추가</Btn>
                </div>
              )}
              <div className="flex justify-end">
                <Btn variant="secondary" size="sm" aria-expanded={itemEdit} onClick={() => setItemEdit(v => !v)}>{itemEdit ? '편집 완료' : '항목 편집'}</Btn>
              </div>
            </div>
          )}
        </div>
      )}

      {!canEdit && !deleted ? (
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          <RowActionBtn tone="neutral" expanded={open} onClick={toggleOpen}>{open ? '항목 접기' : '항목 펼치기'}</RowActionBtn>
        </div>
      ) : deleted ? (
        canEdit && (
          <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
            <RowActionBtn tone="accent" disabled={pending}
              onClick={() => run(() => restoreInspection(r.id), '점검 기록 복원됨', undefined,
                () => undo(() => deleteInspection(r.id), '복원을 적용취소했습니다'))}>
              복원
            </RowActionBtn>
          </div>
        )
      ) : doneOpen ? (
        /* 완료 입력 — 그 줄에서 바로 받는다. 완료일은 운영자가 고르고 미래는 고를 수 없다(lib/completionDate, 화면·서버 두 겹). */
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            완료일
            <DatePicker value={doneDate} onChange={setDoneDate} maxDate={kstYmdStr()} className={DENSE_DATE_CLS} />
          </div>
          <div className="flex gap-2">
            <Btn variant="primary" size="sm" disabled={pending || !doneDate} onClick={submitDone}>완료 기록</Btn>
            <Btn variant="secondary" size="sm" onClick={() => setDoneOpen(false)}>취소</Btn>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          <RowActionBtn tone={r.status === 'PLANNED' ? 'accent' : 'neutral'} expanded={open} onClick={toggleOpen}>
            {open ? '항목 접기' : '항목 펼치기'}
          </RowActionBtn>
          {r.status === 'PLANNED' && (
            <RowActionBtn tone="accent" disabled={pending} onClick={() => { setDoneDate(kstYmdStr()); setDoneOpen(true) }}>점검 완료</RowActionBtn>
          )}
          {/* 한 건 수정 — 예정일·메모와 관리 메뉴(안 하기로·완료/안 함 적용취소·삭제)를 그 한 건만 여는 Modal 에 모았다(2026-10-27). */}
          <RowActionBtn tone="neutral" disabled={pending} onClick={() => { setDoneOpen(false); setEditOpen(true) }}>수정</RowActionBtn>
        </div>
      )}
      {editOpen && <InspectionEditModal row={r} z={modalZ} onClose={() => setEditOpen(false)} onChanged={onChanged} />}
    </>
  )
}
