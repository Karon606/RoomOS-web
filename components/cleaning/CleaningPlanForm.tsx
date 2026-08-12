'use client'

// 청소 예정 등록 폼 정본 — 방 상세 패널(인라인)과 호실 관리 '청소' 뷰(모달)가 같은 칸을 쓴다.
//
// 두 화면이 각자 폼을 그리면 사유 목록·예정일 기본값·메모 유무가 갈리고, 갈린 순간 같은 기능이
// 화면마다 다른 것을 묻는다. 다른 것은 둘뿐이다 — 목록에서는 어느 방인지 먼저 고르고(방 상세는
// 이미 그 방이다), 위젯 안에서는 칸을 촘촘하게 쓴다(dense).

import { useId, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { createCleaning } from '@/app/(app)/room-manage/cleaningActions'
import { CLEANING_REASON_LABEL, type CleaningReason } from '@/app/(app)/room-manage/cleaningConstants'
import { fmtRoomNo } from '@/lib/roomNo'

const REASONS: CleaningReason[] = ['CHECKOUT', 'AFTER_WORK', 'DURING_STAY', 'OTHER']

export function CleaningPlanForm({
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
  // 첫 방을 미리 골라 두지 않는다 — 고른 적 없는 방에 예정이 붙는 오등록이 조용히 성립한다.
  const [pickedRoom, setPickedRoom] = useState('')
  const [reason, setReason] = useState<CleaningReason>('CHECKOUT')
  const [scheduled, setScheduled] = useState(kstYmdStr())
  // 사유 메모. '기타'를 고르면 라벨만으로는 무슨 청소인지 알 수 없어 설명할 자리가 필요하다.
  const [memo, setMemo] = useState('')
  const [pending, startTransition] = useTransition()

  const targetRoomId = roomId ?? pickedRoom
  const inputCls = dense
    ? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]'
    : 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]'
  const labelCls = dense
    ? 'text-xs text-[var(--ink-s)]'
    : 'text-xs font-medium text-[var(--warm-mid)]'

  const submit = () => {
    if (!targetRoomId) { pushToast('error', '호실을 골라 주세요.'); return }
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await createCleaning({ roomId: targetRoomId, reason, scheduledDate: scheduled, memo })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '청소 예정 등록됨')
        onDone()
      } finally { release() }
    })
  }

  return (
    <div className={dense ? 'space-y-2' : 'space-y-4'}>
      {rooms && (
        <div className="space-y-1.5">
          <label className={labelCls} htmlFor={`${uid}-room`}>호실</label>
          <select id={`${uid}-room`} value={pickedRoom} onChange={e => setPickedRoom(e.target.value)}
            className={inputCls}>
            <option value="">호실 선택</option>
            {rooms.map(rm => <option key={rm.id} value={rm.id}>{fmtRoomNo(rm.roomNo)}</option>)}
          </select>
        </div>
      )}

      <div className={dense ? '' : 'space-y-1.5'}>
        {!dense && <p className={labelCls}>사유</p>}
        <div className="flex gap-1.5 flex-wrap">
          {REASONS.map(v => (
            <button key={v} type="button" onClick={() => setReason(v)}
              className={`rounded-lg ${dense ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}`}
              style={reason === v
                ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
              {CLEANING_REASON_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      <div className={dense ? 'flex items-center gap-2 text-xs text-[var(--ink-s)]' : 'space-y-1.5'}>
        {dense ? '예정일' : <p className={labelCls}>예정일</p>}
        {/* 정본 DatePicker 사용 — 네이티브 date 입력은 앱 캘린더 문법과 어긋난다(운영자 지적 2026-08-06). */}
        <DatePicker value={scheduled} onChange={setScheduled} className={dense ? 'text-xs' : undefined} />
      </div>

      {/* 사유 메모 — '기타'는 라벨만으로 뜻이 안 서고, 나머지 사유도 "왜 지금" 이 남아야 나중에 목록을 읽을 수 있다. */}
      <div className={dense ? '' : 'space-y-1.5'}>
        {!dense && <label className={labelCls} htmlFor={`${uid}-memo`}>사유 메모 (선택)</label>}
        <input id={`${uid}-memo`} type="text" value={memo} onChange={e => setMemo(e.target.value)}
          placeholder="사유 메모 (선택)" className={inputCls} />
      </div>

      <div className={dense ? 'flex gap-2' : 'flex gap-2 pt-2'}>
        {dense ? (
          <>
            <Btn variant="primary" size="sm" disabled={pending} onClick={submit}>등록</Btn>
            <Btn variant="secondary" size="sm" onClick={onCancel}>취소</Btn>
          </>
        ) : (
          <>
            <Btn variant="secondary" onClick={onCancel} fullWidth>취소</Btn>
            <Btn variant="primary" disabled={pending} onClick={submit} fullWidth>
              {pending ? '저장 중…' : '등록'}
            </Btn>
          </>
        )}
      </div>
    </div>
  )
}
