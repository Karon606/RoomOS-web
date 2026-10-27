'use client'

// 방 점검 행 한 줄의 표시와 조작 정본 — 방 상세 작업 이력과 호실 관리 '작업' 목록이 이 한 벌을 함께 쓴다(2026-10-27, 신고 2911c217).
//
// 문법은 형제 청소 행(components/cleaning/CleaningRowBody)과 같다. 상태 배지(StatusBadge) · 단계 이름 · 날짜(fmtDateDot) ·
// 행 동작(RowActionBtn) · 그 줄에서 여는 인라인 완료 폼(완료일을 묻는다, 확인 좌 · 취소 우) · 모든 쓰기 뒤 토스트 [적용취소](§16).
// 바깥 껍데기(li 의 배경·패딩·구분선)는 부르는 쪽이 정한다.
//
// 항목은 펼칠 때 읽는다. 항목 체크는 단일 값 즉시 저장이다(§27.1). 체크 상자는 22px r7 정본(§22)을 '항목 완료 체크' 로 쓰고
// 누르는 자리는 44px 이다. 이 화면에는 선택 모드가 없어 선택 체크와 한 화면에 서지 않는다(가이드 §22 범위 확장 조건).
// 확인 말고 '문제'(NG, 메모)와 '해당 없음'(NA)은 항목 아래 행 동작이다. 검수 미통과는 넷째 상태가 아니라 문제 항목 수로 말한다.

import { useEffect, useState, useTransition } from 'react'
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
import { withParticle } from '@/lib/koParticle'
import {
  getInspectionItems, setInspectionItemResult, addInspectionItem, removeInspectionItem, restoreInspectionItem,
  completeInspection, reopenInspection, skipInspection, deleteInspection, restoreInspection,
} from '@/app/(app)/room-manage/inspectionActions'
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

// 항목 결과 토스트 문장. 확인을 풀면 '미확인' 이다(취소가 아니다. 취소는 §27.5 대로 무변경 버튼의 말이다).
const RESULT_TOAST: Record<InspectionItemResult, string> = {
  OK: '확인', NG: '문제로 표시', NA: '해당 없음으로 표시', PENDING: '미확인으로 표시',
}

export function InspectionRowBody({
  row: r, canEdit, deleted = false, showActions = true, autoOpen = false, onOpenRoom, onChanged,
}: {
  row: InspectionRow
  canEdit: boolean
  /** 삭제된 행 — 복원만 할 수 있다. */
  deleted?: boolean
  /**
   * 관리 동작(안 하기로·상태 적용취소·삭제·항목 삭제)을 세울 것인가. 기본 true(목록 화면). 방 모달은 편집 모드에서만 켠다
   * (형제 청소 행과 같은 규칙). **예정 점검의 '점검하기'·'점검 완료' 와 항목 체크는 이 값과 무관하게 선다.**
   */
  showActions?: boolean
  /** 처음부터 항목을 펼친다(퇴실·청소 완료 토스트의 '열기' 로 들어온 자리). */
  autoOpen?: boolean
  /** 호실번호 버튼 — 영업장 교차 목록에서만 선다. */
  onOpenRoom?: (roomId: string) => void
  onChanged: () => void
}) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<InspectionItemRow[] | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [doneOpen, setDoneOpen] = useState(false)
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  const [newLabel, setNewLabel] = useState('')
  // 항목 편집 — 켜야 항목 삭제·손수 더하기가 선다. 체크 줄마다 삭제가 상시로 서면 겨눈 체크 옆을 스쳐 눌린다
  // (방 모달 작업 이력의 '편집' 과 같은 판단, 운영자 지적 2026-08-27). 기억하지 않는다.
  const [itemEdit, setItemEdit] = useState(false)
  // 문제 메모를 고치는 항목 하나. 같은 자리에 인라인 칸이 선다.
  const [noteFor, setNoteFor] = useState<string | null>(null)
  const [noteVal, setNoteVal] = useState('')
  const [pending, startTransition] = useTransition()

  const editable = canEdit && !deleted && r.status === 'PLANNED'
  const stage = INSPECTION_STAGE_LABEL[r.stage]
  // 진행 수는 항목을 들고 있으면 그것으로, 아니면 서버가 센 수로 말한다(같은 규칙: 결과를 고른 항목).
  const checked = items ? countChecked(items) : r.checked
  const total = items ? items.length : r.total
  const ng = items ? items.filter(i => i.result === 'NG').length : r.ng

  const loadItems = () => {
    setLoadFailed(false)
    getInspectionItems(r.id).then(setItems).catch(() => { setItems([]); setLoadFailed(true) })
  }
  const toggleOpen = () => {
    if (!open && items === null) loadItems()
    setOpen(o => !o)
  }
  useEffect(() => {
    if (autoOpen) { setOpen(true); if (items === null) loadItems() }
    // 들어온 순간 한 번만 연다. items 를 의존성에 넣으면 접어도 다시 열린다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoOpen])

  type Res = { ok: true } | { ok: false; error: string }
  // 쓰기 공통부 — 실패는 토스트, 성공은 결과 토스트(+적용취소)와 부모 갱신.
  const run = <T extends Res>(fn: () => Promise<T>, okMsg: string | ((res: Extract<T, { ok: true }>) => string), after?: (res: Extract<T, { ok: true }>) => void, action?: (res: Extract<T, { ok: true }>) => ToastAction) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        const okRes = res as Extract<T, { ok: true }>
        after?.(okRes)
        pushToast('success', typeof okMsg === 'function' ? okMsg(okRes) : okMsg, action ? { action: action(okRes) } : undefined)
        onChanged()
      } finally { release() }
    })
  // 토스트 적용취소 — 되돌리는 쓰기를 부르고 사실대로 알린다.
  const undo = (fn: () => Promise<Res>, message: string, after?: () => void): ToastAction => ({
    label: '적용취소',
    run: () => { void fn().then(res => {
      if (res.ok) { after?.(); pushToast('info', message); onChanged() }
      else pushToast('error', res.error)
    }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
  })
  const replaceItem = (it: InspectionItemRow) => setItems(prev => prev ? prev.map(x => x.id === it.id ? it : x) : prev)

  const setResult = (it: InspectionItemRow, result: InspectionItemResult, note?: string | null) =>
    run(() => setInspectionItemResult({ itemId: it.id, result, ...(note !== undefined ? { note } : {}) }),
      res => note !== undefined && result === it.result ? `'${it.label}' 메모 저장됨` : `'${it.label}' ${RESULT_TOAST[res.item.result]}`,
      res => replaceItem(res.item),
      res => undo(async () => {
        const back = await setInspectionItemResult({ itemId: it.id, result: res.prev.result, note: res.prev.note, restoreCheckedAt: res.prev.checkedAt })
        if (back.ok) replaceItem(back.item)
        return back
      }, `'${it.label}' 표시를 적용취소했습니다`))

  const addItem = () => {
    const label = newLabel.trim()
    if (!label) return
    run(() => addInspectionItem({ inspectionId: r.id, label }), res => `'${res.item.label}' 항목 추가됨`,
      res => { setItems(prev => prev ? [...prev, res.item] : prev); setNewLabel('') },
      res => undo(() => removeInspectionItem(res.item.id), `'${res.item.label}' 추가를 적용취소했습니다`,
        () => setItems(prev => prev ? prev.filter(x => x.id !== res.item.id) : prev)))
  }

  const removeItem = (it: InspectionItemRow) =>
    run(() => removeInspectionItem(it.id), `'${it.label}' 항목 삭제됨`,
      () => setItems(prev => prev ? prev.filter(x => x.id !== it.id) : prev),
      res => ({
        label: '적용취소',
        run: () => { void restoreInspectionItem(res.snapshot).then(back => {
          if (!back.ok) { pushToast('error', back.error); return }
          setItems(prev => prev ? [...prev, back.item].sort((a, b) => a.sortOrder - b.sortOrder) : prev)
          pushToast('info', `'${it.label}' 항목을 되살렸습니다`); onChanged()
        }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
      }))

  const submitDone = async () => {
    const left = total - checked
    // 확인 안 한 항목이 있어도 막지 않는다. 그 항목은 미확인으로 남는다는 것만 한 번 묻는다.
    if (left > 0 && !(await confirmDialog({
      title: `확인 안 한 항목이 ${left}개 있습니다`,
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
        {total > 0 && <span className="text-xs text-[var(--warm-muted)] num">{inspectionProgressText(checked, total)}</span>}
        {ng > 0 && <span className="text-xs font-medium text-[var(--warning-fg)] num">미통과 {ng}항목</span>}
      </div>
      {r.memo && <p className={`mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-words${deleted ? ' opacity-60' : ''}`}>{r.memo}</p>}

      {/* 항목 — 펼쳤을 때만. 첫 조회는 뼈대(§17). */}
      {open && (
        <div className="mt-2 rounded-lg border border-[var(--warm-border)] bg-[var(--canvas)] px-2.5 py-1.5">
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
                return (
                  <li key={it.id} className="flex items-start gap-1 py-1.5">
                    {/* 22px r7 체크(§22) · 누르는 자리 44px. 확인이면 채운다(선택 모드 체크와 같은 색). */}
                    <button type="button" role="checkbox" aria-checked={ok} aria-label={`${it.label} 확인`}
                      disabled={!editable || pending}
                      onClick={() => setResult(it, ok ? 'PENDING' : 'OK')}
                      className="-my-[11px] -ml-[11px] grid min-h-[44px] min-w-[44px] shrink-0 place-items-center disabled:cursor-default focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-[9px] focus-visible:outline-[var(--tc-text)]">
                      <span className={[
                        'grid h-[22px] w-[22px] place-items-center rounded-[7px] border transition-colors',
                        ok ? 'border-[var(--coral)] bg-[var(--coral)] text-[var(--on-solid)]' : 'border-[var(--warm-border)] bg-[var(--cream)] text-transparent',
                        !editable && !ok ? 'opacity-60' : '',
                      ].join(' ')} aria-hidden>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12l5 5L19 7" /></svg>
                      </span>
                    </button>
                    <div className="min-w-0 flex-1 pt-0.5">
                      <p className={`text-xs break-keep ${it.result === 'NA' ? 'text-[var(--warm-muted)]' : 'text-[var(--warm-dark)]'}`}>
                        {it.label}
                        {it.source === 'ASSET' && <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">비품</span>}
                      </p>
                      {(it.result === 'NG' || it.result === 'NA') && (
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
                          <StatusBadge tone={it.result === 'NG' ? 'unpaid' : 'info'}>{it.result === 'NG' ? '문제' : '해당 없음'}</StatusBadge>
                        </p>
                      )}
                      {it.note && noteFor !== it.id && (
                        <p className="mt-0.5 text-[0.65625rem] text-[var(--warm-muted)] break-words">{it.note}</p>
                      )}
                      {noteFor === it.id ? (
                        <div className="mt-1.5 space-y-1.5">
                          <input type="text" value={noteVal} onChange={e => setNoteVal(e.target.value)} maxLength={500}
                            placeholder="무엇이 문제인지 (선택)" aria-label={`${it.label} 문제 메모`} className={`w-full ${DENSE_INPUT_CLS}`} />
                          <div className="flex gap-2">
                            <Btn variant="primary" size="sm" disabled={pending}
                              onClick={() => { setResult(it, 'NG', noteVal); setNoteFor(null) }}>저장</Btn>
                            <Btn variant="secondary" size="sm" onClick={() => setNoteFor(null)}>취소</Btn>
                          </div>
                        </div>
                      ) : editable && (
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {it.result !== 'NG' ? (
                            <RowActionBtn tone="neutral" disabled={pending}
                              onClick={() => { setResult(it, 'NG'); setNoteVal(it.note ?? ''); setNoteFor(it.id) }}>문제</RowActionBtn>
                          ) : (
                            <RowActionBtn tone="neutral" disabled={pending}
                              onClick={() => { setNoteVal(it.note ?? ''); setNoteFor(it.id) }}>메모</RowActionBtn>
                          )}
                          {it.result !== 'NA' && (
                            <RowActionBtn tone="neutral" disabled={pending} onClick={() => setResult(it, 'NA')}>해당 없음</RowActionBtn>
                          )}
                          {itemEdit && (
                            <RowActionBtn tone="danger" disabled={pending} className="ml-auto" onClick={() => removeItem(it)}>삭제</RowActionBtn>
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
              항목 편집을 켜야 선다. 토글은 목록 아래 오른쪽이다(방 모달 작업 이력의 '편집' 자리와 같다). */}
          {editable && items !== null && !loadFailed && (
            <div className="mt-1.5 space-y-2 border-t border-[var(--warm-border)]/60 pt-2">
              {itemEdit && (
                <div className="flex items-center gap-2">
                  <input type="text" value={newLabel} onChange={e => setNewLabel(e.target.value)} maxLength={INSPECTION_LABEL_MAX}
                    onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addItem() } }}
                    placeholder="항목 더하기 (예: 공유기)" aria-label="점검 항목 더하기" className={DENSE_INPUT_CLS} />
                  <Btn variant="secondary" size="sm" disabled={pending || !newLabel.trim()} onClick={addItem}>추가</Btn>
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
          <RowActionBtn tone="neutral" expanded={open} onClick={toggleOpen}>{open ? '항목 접기' : '항목 보기'}</RowActionBtn>
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
            {open ? '항목 접기' : r.status === 'PLANNED' ? '점검하기' : '항목 보기'}
          </RowActionBtn>
          {r.status === 'PLANNED' && (
            <RowActionBtn tone="accent" disabled={pending} onClick={() => { setDoneDate(kstYmdStr()); setDoneOpen(true) }}>점검 완료</RowActionBtn>
          )}
          {showActions && (<>
            {r.status === 'PLANNED' && (
              <RowActionBtn tone="neutral" disabled={pending}
                onClick={async () => {
                  if (!(await confirmDialog({ title: `이 ${withParticle(stage, '을/를')} 안 하기로 할까요?`, message: "기록은 남고 상태만 바뀝니다. 같은 자리의 '안 함 적용취소'로 되돌릴 수 있습니다.", confirmLabel: '안 하기로', level: 'caution' }))) return
                  run(() => skipInspection(r.id), '안 하기로 표시됨', undefined,
                    () => undo(() => reopenInspection(r.id), '안 함을 적용취소했습니다 · 예정으로 복귀'))
                }}>
                안 하기로
              </RowActionBtn>
            )}
            {r.status !== 'PLANNED' && (
              <RowActionBtn tone="accent" disabled={pending}
                onClick={() => {
                  const what = r.status === 'DONE' ? '완료' : '안 함'
                  run(() => reopenInspection(r.id), `${what} 적용취소됨`)
                }}>
                {r.status === 'DONE' ? '완료 적용취소' : '안 함 적용취소'}
              </RowActionBtn>
            )}
            <RowActionBtn tone="danger" disabled={pending} className="ml-auto"
              onClick={async () => {
                if (!(await confirmDialog({ title: `이 ${stage} 기록을 삭제할까요?`, message: '기록이 목록에서 사라집니다. 체크한 항목은 함께 보관되어 복원하면 돌아옵니다.', confirmLabel: '삭제', level: 'danger' }))) return
                run(() => deleteInspection(r.id), '삭제됨', undefined,
                  () => undo(() => restoreInspection(r.id), '점검 기록을 복원했습니다'))
              }}>
              삭제
            </RowActionBtn>
          </>)}
        </div>
      )}
    </>
  )
}
