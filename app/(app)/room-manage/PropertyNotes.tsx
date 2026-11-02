'use client'

// 영업장 관리 메모 창. 목록 Modal 과 추가·수정 Modal(형제로 띄운다), 호실 관리 헤더 '관리 메모' 가 연다
//
// 신고 d1e5fecc, 2026-11-02 운영자 승인 설계 그대로.
//   · 목록: 장마다 제목(13px/700) + 본문(줄바꿈 그대로, 자르지 않는다) + 분류(§11 메타 칩). 쓰기 권한이면 장마다 [수정] RowActionBtn,
//     맨 아래 '+ 메모 추가'. 빈 상태는 EmptyState. 열람은 STAFF 도 한다(쓰기 버튼만 숨김).
//   · 수정: §27.1 한 건 수정 RecordEditShell(sm Modal), 삭제는 발끝 `관리` 메뉴. 추가는 같은 칸의 sm Modal.
//   · 적용취소(§16): 추가는 토스트로 지움, 수정은 저장 직전 모습으로, 삭제는 소프트삭제 되살림. 셋 다 서버 조건부 쓰기라 그사이 바뀌면 거부한다.
//   · 노랑 메모지·핀·틴트 원 아이콘 금지(디자인 비주얼 정체성), Room.memo('메모')와 이름을 겹치지 않는다.
// 겹쳐 띄울 Modal 은 목록 Modal 의 자식이 아니라 형제다(scripts/check-no-nested-overlay.mjs). 목록은 z 200, 추가·수정은 z 260.

import { Fragment, useCallback, useEffect, useId, useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { EmptyState } from '@/components/ui/EmptyState'
import { SkeletonRows } from '@/components/ui/Skeleton'
import { WhyCaption } from '@/components/ui/WhyCaption'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { RecordEditShell, withDirtyNote, type RecordManageItem } from '@/components/ui/RecordEditShell'
import { pushToast, trackSave } from '@/lib/saveStatus'
import {
  normalizeNoteInput, sameNoteInput, noteTagOptions, NOTE_TITLE_MAX, NOTE_BODY_MAX, NOTE_TAG_MAX,
  type PropertyNoteRow, type PropertyNoteInput,
} from '@/lib/propertyNote'
import {
  getPropertyNotes, createPropertyNote, undoCreatePropertyNote, updatePropertyNote, undoUpdatePropertyNote,
  deletePropertyNote, restorePropertyNote,
} from './noteActions'

export const NOTES_EMPTY_TITLE = '관리 메모가 없습니다'
export const NOTES_EMPTY_DESC = '계절마다 바꾸는 설정처럼 때가 지나면 잊는 내용을 적어 두세요.'

const LABEL_CLS = 'text-xs font-medium text-[var(--warm-mid)]'
const INPUT_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30 placeholder:text-[var(--warm-muted)]'
// §11 메타 칩 정본 값(bg --canvas · text --warm-muted · ring 1px --warm-border · r-sm · 10.5px). 재고 이력 '폐기' 칩과 같은 클래스다.
const META_CHIP = 'shrink-0 rounded-sm bg-[var(--canvas)] px-1.5 py-0.5 text-[0.65625rem] text-[var(--warm-muted)] ring-1 ring-[var(--warm-border)]'
const NET_ERROR = '처리 중 통신 오류가 발생했습니다'

type Res = { ok: true } | { ok: false; error: string }
/** 토스트 [적용취소] 한 개. 되돌린 뒤 목록을 다시 읽는다. */
const undoAction = (run: () => Promise<Res>, doneMsg: string, reload: () => void) => ({
  action: { label: '적용취소', run: () => { void run().then(r => {
    if (r.ok) { pushToast('info', doneMsg); reload() } else pushToast('error', r.error)
  }).catch(() => pushToast('error', NET_ERROR)) } },
})

/** 목록 본문. 표시만 한다(데이터·쓰기는 부르는 쪽). */
export function PropertyNotesList({ notes, canEdit, onEdit, onAdd }: {
  notes: PropertyNoteRow[]
  canEdit: boolean
  onEdit: (n: PropertyNoteRow) => void
  onAdd: () => void
}) {
  return (
    <div className="space-y-3">
      {notes.length === 0 ? (
        // 적을 수 없는 STAFF 에게 '적어 두세요' 를 시키지 않는다(독립 디자이너 패스)
        <EmptyState title={NOTES_EMPTY_TITLE} description={canEdit ? NOTES_EMPTY_DESC : undefined} />
      ) : (
        <ul className={`divide-y divide-[var(--warm-border)] ${canEdit ? 'border-b border-[var(--warm-border)]' : ''}`}>
          {notes.map(n => (
            <li key={n.id} className="py-3 first:pt-0 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-1">
                  <p className="text-[0.8125rem] font-bold text-[var(--warm-dark)] break-keep">{n.title}</p>
                  {n.tag && <span className={META_CHIP}>{n.tag}</span>}
                </div>
                {canEdit && <RowActionBtn className="shrink-0" onClick={() => onEdit(n)}>수정</RowActionBtn>}
              </div>
              {n.body && <p className="text-sm leading-relaxed text-[var(--warm-mid)] whitespace-pre-wrap break-keep [overflow-wrap:anywhere]">{n.body}</p>}
            </li>
          ))}
        </ul>
      )}
      {canEdit && <Btn variant="secondary" size="md" fullWidth onClick={onAdd}>+ 메모 추가</Btn>}
    </div>
  )
}

/** 추가·수정 폼의 칸 셋. 두 Modal 이 같은 칸을 쓴다. */
export function PropertyNoteFields({ value, onChange, tagOptions }: {
  value: PropertyNoteInput
  onChange: (v: PropertyNoteInput) => void
  tagOptions: string[]
}) {
  const uid = useId()
  return (
    <>
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-title`}>제목</label>
        <input id={`${uid}-title`} type="text" value={value.title} maxLength={NOTE_TITLE_MAX}
          onChange={e => onChange({ ...value, title: e.target.value })} placeholder="예: 겨울 보일러 온도" className={INPUT_CLS} />
      </div>
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-tag`}>분류 (선택)</label>
        <input id={`${uid}-tag`} type="text" value={value.tag ?? ''} maxLength={NOTE_TAG_MAX} list={`${uid}-tags`}
          onChange={e => onChange({ ...value, tag: e.target.value })} placeholder="예: 계절 설정" className={INPUT_CLS} />
      </div>
      {/* datalist 는 space-y 묶음 밖에 둔다. 안에 두면 마지막 자식이 되어 입력 칸 아래만 6px 더 벌어진다(독립 디자이너 패스) */}
      <datalist id={`${uid}-tags`}>{tagOptions.map(t => <option key={t} value={t} />)}</datalist>
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-body`}>본문 (선택)</label>
        <textarea id={`${uid}-body`} value={value.body} maxLength={NOTE_BODY_MAX} rows={6}
          onChange={e => onChange({ ...value, body: e.target.value })} className={`${INPUT_CLS} min-h-[80px] resize-y`} />
      </div>
    </>
  )
}

const EMPTY_INPUT: PropertyNoteInput = { title: '', body: '', tag: null }
/** 폼 값의 정리 결과(화면 dirty·저장 막힘 이유와 서버 거부가 같은 함수). */
const normOf = (v: PropertyNoteInput) => normalizeNoteInput(v)
const normSnap = (v: PropertyNoteInput): PropertyNoteInput => { const r = normOf(v); return r.ok ? r.value : { ...v } }

/** 추가 Modal. */
export function PropertyNoteAddModal({ tagOptions, onClose, onSaved }: {
  tagOptions: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const reasonId = useId()
  const [value, setValue] = useState<PropertyNoteInput>(EMPTY_INPUT)
  const [pending, setPending] = useState(false)
  const dirty = !sameNoteInput(normSnap(value), EMPTY_INPUT)
  const check = normOf(value)
  const saveReason = check.ok ? null : check.error
  const save = async () => {
    if (pending || saveReason) return
    setPending(true)
    const release = trackSave()
    try {
      const res = await createPropertyNote(value)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '관리 메모를 추가했습니다', undoAction(() => undoCreatePropertyNote(res.undo), '메모 추가를 적용취소했습니다', onSaved))
      onClose(); onSaved()
    } catch { pushToast('error', NET_ERROR) } finally { release(); setPending(false) }
  }
  return (
    <Modal open z={260} width="sm" dirty={dirty} title="관리 메모 추가" onClose={() => { if (!pending) onClose() }}
      footer={
        <div className="space-y-2">
          {saveReason && <WhyCaption id={reasonId}>{saveReason}</WhyCaption>}
          <div className="flex gap-2">
            <Btn variant="secondary" size="md" onClick={onClose} disabled={pending} className="flex-1">취소</Btn>
            <Btn variant="primary" size="md" onClick={save} disabled={pending} reason={saveReason ? reasonId : undefined} className="flex-1">
              {pending ? '저장 중…' : '저장'}
            </Btn>
          </div>
        </div>
      }>
      <div className="space-y-3">
        <PropertyNoteFields value={value} onChange={setValue} tagOptions={tagOptions} />
      </div>
    </Modal>
  )
}

/** 수정 Modal. §27.1 한 건 수정 껍데기, 삭제는 발끝 `관리`. */
export function PropertyNoteEditModal({ note, tagOptions, onClose, onChanged }: {
  note: PropertyNoteRow
  tagOptions: string[]
  onClose: () => void
  onChanged: () => void
}) {
  // 연 순간의 버전. 열린 동안 목록을 다시 읽어도 이 값으로 견준다(작업·점검 수정과 같은 규칙).
  const [openedAt] = useState(note.updatedAt)
  const initial: PropertyNoteInput = { title: note.title, body: note.body, tag: note.tag }
  const [value, setValue] = useState<PropertyNoteInput>(initial)
  const [pending, setPending] = useState(false)
  const dirty = !sameNoteInput(normSnap(value), initial)
  const check = normOf(value)
  const saveReason = check.ok ? null : check.error

  const save = async () => {
    if (pending || saveReason) return
    if (!dirty) { onClose(); return }
    setPending(true)
    const release = trackSave()
    try {
      const res = await updatePropertyNote({ id: note.id, expectedUpdatedAt: openedAt, ...value })
      if (!res.ok) { pushToast('error', res.error); return }
      const undo = res.undo
      pushToast('success', '관리 메모를 고쳤습니다', undo ? undoAction(() => undoUpdatePropertyNote(undo), '메모 수정을 적용취소했습니다', onChanged) : undefined)
      onClose(); onChanged()
    } catch { pushToast('error', NET_ERROR) } finally { release(); setPending(false) }
  }

  const manage: RecordManageItem[] = [
    { key: 'delete', label: '삭제', danger: true, onSelect: async (d: boolean) => {
      if (!(await confirmDialog({ title: `'${note.title}' 메모를 삭제할까요?`, message: withDirtyNote('목록에서 사라집니다. 삭제한 뒤 토스트의 적용취소로 되살릴 수 있습니다.', d), confirmLabel: '삭제', level: 'danger' }))) return
      const release = trackSave()
      try {
        const res = await deletePropertyNote({ id: note.id, expectedUpdatedAt: openedAt })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '관리 메모를 삭제했습니다', undoAction(() => restorePropertyNote(res.undo), '메모를 되살렸습니다', onChanged))
        onClose(); onChanged()
      } catch { pushToast('error', NET_ERROR) } finally { release() }
    } },
  ]

  return (
    <RecordEditShell title="관리 메모 수정" subtitle="" z={260} dirty={dirty} pending={pending}
      saveReason={saveReason} onSave={save} onClose={onClose} manage={manage}>
      <PropertyNoteFields value={value} onChange={setValue} tagOptions={tagOptions} />
    </RecordEditShell>
  )
}

/** 창 전체. 열 때 목록을 읽고, 쓰기 뒤마다 다시 읽는다. */
export function PropertyNotesManager({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const [notes, setNotes] = useState<PropertyNoteRow[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<PropertyNoteRow | null>(null)
  const [adding, setAdding] = useState(false)
  const load = useCallback(() => {
    getPropertyNotes().then(r => {
      if (r.ok) { setNotes(r.notes); setLoadError(null) } else setLoadError(r.error)
    }).catch(() => setLoadError(NET_ERROR))
  }, [])
  useEffect(() => { load() }, [load])
  const tagOptions = noteTagOptions(notes ?? [])
  return (
    <Fragment>
      <Modal open width="md" title="관리 메모" onClose={onClose}>
        {loadError ? (
          <div className="space-y-3">
            <p className="text-sm text-[var(--danger-fg)]">{loadError}</p>
            <Btn variant="secondary" size="md" onClick={() => { setLoadError(null); load() }}>다시 불러오기</Btn>
          </div>
        ) : notes === null ? (
          <SkeletonRows rows={3} />
        ) : (
          <PropertyNotesList notes={notes} canEdit={canEdit} onEdit={setEditing} onAdd={() => setAdding(true)} />
        )}
      </Modal>
      {adding && <PropertyNoteAddModal tagOptions={tagOptions} onClose={() => setAdding(false)} onSaved={load} />}
      {editing && <PropertyNoteEditModal key={editing.id} note={editing} tagOptions={tagOptions} onClose={() => setEditing(null)} onChanged={load} />}
    </Fragment>
  )
}
