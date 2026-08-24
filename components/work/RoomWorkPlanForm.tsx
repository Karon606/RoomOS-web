'use client'

// 작업 예정 등록 폼 정본 — 방 상세 위젯(인라인)과 호실 관리 '작업' 뷰(모달)가 같은 칸을 쓴다.
//
// components/cleaning/CleaningPlanForm 을 거울로 삼았다. 그 파일을 파라미터로 넓히지 않은 것은
// 청소가 청소비·부담 표식·지출 경로에 물려 있어 접점을 늘리면 회귀 범위가 그만큼 커지기 때문이다.
// 대신 껍데기 문법(dense·inputCls·dateFieldCls·radiogroup 칩·Btn)은 그대로 베꼈다 —
// 두 폼이 나란히 서는 자리가 있으므로 손놀림이 갈리면 안 된다.
//
// 다른 것 둘. 사유 4종 대신 **환경설정에서 만든 종류 목록**을 고르고, 받은 청소비 부담 표식이 없다.

import { useEffect, useId, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { createRoomWork } from '@/app/(app)/room-manage/workActions'
import { getWorkKindOptions } from '@/app/(app)/settings/actions'
import {
  CLEANING_PERFORMER_LABEL, type CleaningPerformer,
} from '@/app/(app)/room-manage/cleaningConstants'
import { fmtRoomNo } from '@/lib/roomNo'

// 형제 폼과 같은 링. §09 'focus-visible 링 전 컴포넌트 필수'.
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]'

/** 담당은 **선택**이라 '미정'이 먼저 서고 기본값이다. 빈 문자열이 곧 '아직 안 정함'이다. */
const PLANNED_PERFORMERS: (CleaningPerformer | '')[] = ['', 'SELF', 'VENDOR', 'THIRD_PARTY']

export function RoomWorkPlanForm({
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
  const [kinds, setKinds] = useState<string[]>([])
  // 첫 종류를 미리 골라 두지 않는다 — 형제 폼이 방을 미리 안 고르는 것과 같은 이유다.
  // 고른 적 없는 종류로 기록이 서면 그 거짓이 캘린더에 그대로 선다.
  const [kind, setKind] = useState('')
  const [pickedRoom, setPickedRoom] = useState('')
  const [scheduled, setScheduled] = useState(kstYmdStr())
  const [performer, setPerformer] = useState<CleaningPerformer | ''>('')
  const [memo, setMemo] = useState('')
  const [pending, startTransition] = useTransition()

  useEffect(() => { getWorkKindOptions().then(setKinds).catch(console.error) }, [])

  const targetRoomId = roomId ?? pickedRoom
  const inputCls = dense
    ? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]'
    : 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--coral)]/30 placeholder:text-[var(--warm-muted)]'
  const labelCls = dense
    ? 'text-xs text-[var(--ink-s)]'
    : 'text-xs font-medium text-[var(--warm-mid)]'
  // 형제 폼과 같은 껍데기·같은 이유(오류신고 c2ab5b83). 트리거가 button 이라 :focus 를 걸면
  // 손가락으로 눌러 연 달력이 닫힌 뒤에도 링이 남는다.
  const dateFieldCls =
    'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--coral)]/30'

  const submit = () => {
    if (!targetRoomId) { pushToast('error', '호실을 골라 주세요.'); return }
    if (!kind) { pushToast('error', '작업 종류를 골라 주세요.'); return }
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await createRoomWork({
          roomId: targetRoomId, kind, scheduledDate: scheduled,
          performer: performer || null, memo,
        })
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '작업 예정 등록됨')
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

      {/* 종류 — 개수를 앱이 모르므로(운영자가 추가한다) 형제 폼의 고정 칩 대신 select 를 쓴다.
          칩은 4종 고정이라 성립했다. 목록이 길어지면 칩이 여러 줄로 접혀 폼이 통째로 흔들린다.
          목록이 비면 그 사실을 말한다 — 빈 select 를 내밀면 왜 못 고르는지 화면이 안 말한다. */}
      <div className={dense ? '' : 'space-y-1.5'}>
        {!dense && <label className={labelCls} htmlFor={`${uid}-kind`}>작업 종류</label>}
        {kinds.length === 0 ? (
          <p className="text-xs text-[var(--warm-muted)]">
            환경설정 &gt; 분류 관리 &gt; 작업 종류 관리에서 종류를 먼저 만들어 주세요.
          </p>
        ) : (
          <select id={`${uid}-kind`} value={kind} onChange={e => setKind(e.target.value)} className={inputCls}>
            <option value="">종류 선택</option>
            {kinds.map(k => <option key={k} value={k}>{k}</option>)}
          </select>
        )}
      </div>

      <div className={dense ? 'flex items-center gap-2 text-xs text-[var(--ink-s)]' : 'space-y-1.5'}>
        {dense ? '예정일' : <p className={labelCls}>예정일</p>}
        {/* 정본 DatePicker — 네이티브 date 는 앱 캘린더 문법과 어긋난다(운영자 지적 2026-08-06).
            dense 는 가로 flex 행이라 flex-1 min-w-0 이 함께 필요하다(형제 폼과 같은 이유). */}
        <DatePicker value={scheduled} onChange={setScheduled}
          className={dense ? `${inputCls} flex-1 min-w-0` : dateFieldCls} />
      </div>

      <div className={dense ? '' : 'space-y-1.5'}>
        {!dense && <p className={labelCls}>담당 (선택)</p>}
        {/* '미정'은 고른 값이 아니라 값의 부재다. 채움은 실제로 고른 셋에만 준다(형제 폼과 같다). */}
        <div role="radiogroup" aria-label="작업 담당" className="flex gap-1.5 flex-wrap">
          {PLANNED_PERFORMERS.map(v => (
            <button key={v || 'none'} type="button" role="radio" aria-checked={performer === v}
              onClick={() => setPerformer(v)}
              className={`rounded-lg ${FOCUS_RING} ${dense ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}`}
              style={performer === v && v !== ''
                ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
              {v ? CLEANING_PERFORMER_LABEL[v] : '미정'}
            </button>
          ))}
        </div>
      </div>

      <div className={dense ? '' : 'space-y-1.5'}>
        {!dense && <label className={labelCls} htmlFor={`${uid}-memo`}>메모 (선택)</label>}
        <input id={`${uid}-memo`} type="text" value={memo} onChange={e => setMemo(e.target.value)}
          placeholder="메모 (선택)" className={inputCls} />
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
