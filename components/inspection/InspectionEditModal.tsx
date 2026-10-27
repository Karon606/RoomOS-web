'use client'

// 방 점검 한 건 수정 Modal — 행 [수정] 이 연다(2026-10-27 승인 계획 2단계, 가이드 §27.1).
//
// 칸은 둘이다. 예정 점검은 예정일(비울 수 있다)과 메모, 끝낸 점검(완료·안 함)은 메모만. 항목 판정은 행 안에서 그대로 한다(§22 항목 완료 체크).
// 저장은 서버 updateInspection 이고 토스트 [적용취소] 가 저장 직전 모습을 되돌린다. 관리 메뉴는 안 하기로·완료 적용취소·안 함 적용취소·삭제이고
// 확인창·토스트는 종전 행의 것 그대로다(독립 검수 R7 의 겹침 막기는 서버가 그대로 한다).

import { useId, useState } from 'react'
import { RecordEditShell, recordEditUndoAction, type RecordManageItem } from '@/components/ui/RecordEditShell'
import { DatePicker } from '@/components/ui/DatePicker'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { fmtMDDay } from '@/lib/fmtDate'
import { fmtRoomNo } from '@/lib/roomNo'
import { withParticle } from '@/lib/koParticle'
import {
  updateInspection, reopenInspection, skipInspection, deleteInspection, restoreInspection,
} from '@/app/(app)/room-manage/inspectionActions'
import { INSPECTION_STAGE_LABEL, INSPECTION_STATUS_LABEL, type InspectionRow } from '@/app/(app)/room-manage/inspectionConstants'

const LABEL_CLS = 'text-xs font-medium text-[var(--warm-mid)]'
const INPUT_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30 placeholder:text-[var(--warm-muted)]'
const DATE_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/30'

type Res = { ok: true } | { ok: false; error: string }

export function InspectionEditModal({ row: r, z, onClose, onChanged }: {
  row: InspectionRow
  z: 200 | 260
  onClose: () => void
  onChanged: () => void
}) {
  const uid = useId()
  const stage = INSPECTION_STAGE_LABEL[r.stage]
  const planned = r.status === 'PLANNED'
  const shownDate = r.status === 'DONE' ? r.doneDate : r.scheduledDate
  const [date, setDate] = useState(r.scheduledDate ?? '')
  const [memo, setMemo] = useState(r.memo ?? '')
  const [pending, setPending] = useState(false)
  const dirty = (planned && date !== (r.scheduledDate ?? '')) || memo !== (r.memo ?? '')
  const subtitle = `${fmtRoomNo(r.roomNo)} · ${shownDate ? `${INSPECTION_STATUS_LABEL[r.status]} ${fmtMDDay(shownDate)}` : '예정일 미정'}`

  const save = async () => {
    if (pending) return
    if (!dirty) { onClose(); return }
    setPending(true)
    const release = trackSave()
    try {
      const res = await updateInspection({ id: r.id, expectedUpdatedAt: r.updatedAt, ...(planned ? { scheduledDate: date || null } : {}), memo })
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `${stage} 기록을 고쳤습니다`, recordEditUndoAction(res.undo, `${stage} 기록`, onChanged))
      onClose(); onChanged()
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release(); setPending(false) }
  }

  const runManage = async (fn: () => Promise<Res>, okMsg: string, undo?: { run: () => Promise<Res>; msg: string }) => {
    const release = trackSave()
    try {
      const res = await fn()
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', okMsg, undo ? { action: { label: '적용취소', run: () => { void undo.run().then(u => {
        if (u.ok) { pushToast('info', undo.msg); onChanged() }
        else pushToast('error', u.error)
      }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } } } : undefined)
      onClose(); onChanged()
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release() }
  }
  const manage: RecordManageItem[] = [
    ...(planned ? [{ key: 'skip', label: '안 하기로', onSelect: async () => {
      if (!(await confirmDialog({ title: `이 ${withParticle(stage, '을/를')} 안 하기로 할까요?`, message: "기록은 남고 상태만 바뀝니다. 관리 메뉴의 '안 함 적용취소'로 되돌릴 수 있습니다.", confirmLabel: '안 하기로', level: 'caution' }))) return
      void runManage(() => skipInspection(r.id), '안 하기로 표시됨', { run: () => reopenInspection(r.id), msg: '안 함을 적용취소했습니다 · 예정으로 복귀' })
    } }] : [{ key: 'reopen', label: r.status === 'DONE' ? '완료 적용취소' : '안 함 적용취소', onSelect: () => {
      const what = r.status === 'DONE' ? '완료' : '안 함'
      void runManage(() => reopenInspection(r.id), `${what} 적용취소됨`)
    } }]),
    { key: 'delete', label: '삭제', danger: true, onSelect: async () => {
      if (!(await confirmDialog({ title: `이 ${stage} 기록을 삭제할까요?`, message: '기록이 목록에서 사라집니다. 체크한 항목은 함께 보관되어 복원하면 돌아옵니다.', confirmLabel: '삭제', level: 'danger' }))) return
      void runManage(() => deleteInspection(r.id), '삭제됨', { run: () => restoreInspection(r.id), msg: '점검 기록을 복원했습니다' })
    } },
  ]

  return (
    <RecordEditShell title={`${stage} 수정`} subtitle={subtitle} z={z} dirty={dirty} pending={pending}
      onSave={save} onClose={onClose} manage={manage}>
      {planned ? (
        <div className="space-y-1.5">
          <p className={LABEL_CLS}>예정일</p>
          <DatePicker value={date} onChange={setDate} className={DATE_CLS} />
        </div>
      ) : (
        <p className="text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep">
          끝낸 점검은 메모만 고칩니다. 날짜와 항목을 고치려면 관리 메뉴에서 {r.status === 'DONE' ? '완료' : '안 함'} 적용취소를 먼저 하면 됩니다.
        </p>
      )}
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-memo`}>메모 (선택)</label>
        <input id={`${uid}-memo`} type="text" value={memo} onChange={e => setMemo(e.target.value)} maxLength={500} placeholder="메모 (선택)" className={INPUT_CLS} />
      </div>
    </RecordEditShell>
  )
}
