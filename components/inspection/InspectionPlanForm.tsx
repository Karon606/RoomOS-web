'use client'

// 방 점검 손수 등록 폼 — 방 상세 작업 이력(인라인)과 호실 관리 '작업' 뷰(모달)가 같은 칸을 쓴다(2026-10-27, 신고 2911c217).
//
// 점검은 퇴실·청소 완료가 저절로 만든다. 이 폼은 그 길을 안 지난 방(배포 전에 이미 빈 방, 손으로 한 번 더 보고 싶은 방)을 위한 문이다.
// 형제 청소 예정 폼(CleaningPlanForm)과 같은 문법이다. 방을 미리 골라 두지 않고(오등록 방지), 단계는 고르는 칸이고,
// 예정일은 정본 DatePicker 다. 항목은 그때의 영업장 목록(분류 관리)에서 베껴 온다. 등록 토스트 [적용취소] 는 그 점검의 삭제다.

import { useId, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtRoomNo } from '@/lib/roomNo'
import { createInspection, deleteInspection } from '@/app/(app)/room-manage/inspectionActions'
import { INSPECTION_STAGES, INSPECTION_STAGE_LABEL, type InspectionStage } from '@/app/(app)/room-manage/inspectionConstants'

export function InspectionPlanForm({
  roomId, rooms, dense = false, onDone, onCancel,
}: {
  /** 방이 정해진 자리(방 상세). rooms 와 둘 중 하나만 준다. */
  roomId?: string
  /** 방을 골라야 하는 자리(영업장 교차 목록). */
  rooms?: { id: string; roomNo: string }[]
  dense?: boolean
  onDone: () => void
  onCancel: () => void
}) {
  const uid = useId()
  const [pickedRoom, setPickedRoom] = useState('')
  // 손수 등록이 가장 많이 쓰일 자리는 이미 빈 방의 입실 전 점검이다(승인 계획). 바꿀 수 있다.
  const [stage, setStage] = useState<InspectionStage>('BEFORE_MOVEIN')
  const [scheduled, setScheduled] = useState(kstYmdStr())
  const [pending, startTransition] = useTransition()
  const targetRoomId = roomId ?? pickedRoom

  const inputCls = dense
    ? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30'
    : 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30'
  const labelCls = dense ? 'text-xs text-[var(--ink-s)]' : 'text-xs font-medium text-[var(--warm-mid)]'
  const dateFieldCls = dense
    ? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/30 flex-1 min-w-0'
    : 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/30'

  const submit = () => {
    if (!targetRoomId) { pushToast('error', '호실을 골라 주세요.'); return }
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await createInspection({ roomId: targetRoomId, stage, scheduledDate: scheduled })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', `${INSPECTION_STAGE_LABEL[stage]} 등록됨 · ${res.itemCount}항목`, {
          action: { label: '적용취소', run: () => { void deleteInspection(res.id).then(d => {
            if (d.ok) { pushToast('info', '등록을 적용취소했습니다'); onDone() }
            else pushToast('error', d.error)
          }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } },
        })
        onDone()
      } finally { release() }
    })
  }

  return (
    <div className={dense ? 'space-y-2' : 'space-y-4'}>
      {rooms && (
        <div className="space-y-1.5">
          <label className={labelCls} htmlFor={`${uid}-room`}>호실</label>
          <select id={`${uid}-room`} value={pickedRoom} onChange={e => setPickedRoom(e.target.value)} className={inputCls}>
            <option value="">호실 선택</option>
            {rooms.map(rm => <option key={rm.id} value={rm.id}>{fmtRoomNo(rm.roomNo)}</option>)}
          </select>
        </div>
      )}
      <div className={dense ? 'flex items-center gap-2' : 'space-y-1.5'}>
        <label className={dense ? `${labelCls} shrink-0` : labelCls} htmlFor={`${uid}-stage`}>단계</label>
        <select id={`${uid}-stage`} value={stage} onChange={e => setStage(e.target.value as InspectionStage)} className={inputCls}>
          {INSPECTION_STAGES.map(s => <option key={s} value={s}>{INSPECTION_STAGE_LABEL[s]}</option>)}
        </select>
      </div>
      <div className={dense ? 'flex items-center gap-2 text-xs text-[var(--ink-s)]' : 'space-y-1.5'}>
        {dense ? '예정일' : <p className={labelCls}>예정일</p>}
        <DatePicker value={scheduled} onChange={setScheduled} className={dateFieldCls} />
      </div>
      <p className={dense ? 'text-[0.65625rem] text-[var(--warm-muted)] break-keep' : 'text-xs text-[var(--warm-muted)] break-keep'}>
        항목은 환경설정 &gt; 분류 관리의 점검 항목 목록에서 가져옵니다.
      </p>
      <div className={dense ? 'flex gap-2' : 'flex gap-2 pt-2'}>
        {dense ? (
          <>
            <Btn variant="primary" size="sm" disabled={pending} onClick={submit}>등록</Btn>
            <Btn variant="secondary" size="sm" onClick={onCancel}>취소</Btn>
          </>
        ) : (
          <>
            <Btn variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
            <Btn variant="primary" disabled={pending} onClick={submit} fullWidth>{pending ? '저장 중…' : '등록'}</Btn>
          </>
        )}
      </div>
    </div>
  )
}
