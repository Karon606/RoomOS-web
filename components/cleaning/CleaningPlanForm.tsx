'use client'

// 청소 예정 등록 폼 정본 — 방 상세 패널(인라인)과 호실 관리 '청소' 뷰(모달)가 같은 칸을 쓴다.
//
// 두 화면이 각자 폼을 그리면 사유 목록·예정일 기본값·메모 유무가 갈리고, 갈린 순간 같은 기능이
// 화면마다 다른 것을 묻는다. 다른 것은 둘뿐이다 — 목록에서는 어느 방인지 먼저 고르고(방 상세는
// 이미 그 방이다), 위젯 안에서는 칸을 촘촘하게 쓴다(dense).

import { useEffect, useId, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { DatePicker } from '@/components/ui/DatePicker'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import { createCleaning, getRecentCleaningPerformers } from '@/app/(app)/room-manage/cleaningActions'
import {
  CLEANING_PERFORMER_LABEL, CLEANING_REASON_LABEL,
  type CleaningPerformer, type CleaningReason,
} from '@/app/(app)/room-manage/cleaningConstants'
import { fmtRoomNo } from '@/lib/roomNo'
import CategorySelect from '@/components/ui/CategorySelect'

// 배타 선택 칩의 포커스 링 — §09 'focus-visible 링 전 컴포넌트 필수'. 이 파일이 다른 자리에서
// 이미 쓰던 문법을 상수로 올려 세 자리가 같은 링을 쓰게 한다.
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--tc-text)]'

const REASONS: CleaningReason[] = ['CHECKOUT', 'AFTER_WORK', 'DURING_STAY', 'OTHER']
/** 담당은 **선택**이라 '미정'이 먼저 서고 기본값이다. 빈 문자열이 곧 '아직 안 정함'이다. */
const PLANNED_PERFORMERS: (CleaningPerformer | '')[] = ['', 'SELF', 'VENDOR', 'THIRD_PARTY']

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
  // 담당은 미리 고르지 않는다. 완료 폼은 '업체'를 기본으로 두지만(대개 맡긴다) 그것은 **일어난
  // 일**을 적는 자리다. 계획 단계에서 기본값을 박으면 아직 안 정한 것이 '업체로 정함'으로
  // 저장되고, 그 거짓이 캘린더 요약 줄에 그대로 선다.
  const [plannedPerformer, setPlannedPerformer] = useState<CleaningPerformer | ''>('')
  // 맡길 업체·사람 — 형제 작업 등록 폼과 같은 칸이다(운영자 지적 2026-08-28).
  const [performerName, setPerformerName] = useState('')
  const [recentPerformers, setRecentPerformers] = useState<string[]>([])
  // 사유 메모. '기타'를 고르면 라벨만으로는 무슨 청소인지 알 수 없어 설명할 자리가 필요하다.
  const [memo, setMemo] = useState('')
  const [pending, startTransition] = useTransition()
  // 추천 목록은 실패를 삼킨다 — 편의값 하나 때문에 등록 폼이 안 서면 안 된다.
  useEffect(() => { getRecentCleaningPerformers().then(setRecentPerformers).catch(() => {}) }, [])

  const targetRoomId = roomId ?? pickedRoom
  const inputCls = dense
    ? 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]'
    : 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30 placeholder:text-[var(--warm-muted)]'
  const labelCls = dense
    ? 'text-xs text-[var(--ink-s)]'
    : 'text-xs font-medium text-[var(--warm-mid)]'
  // 예정일 칸 껍데기 — 비dense 자리 전용(오류신고 c2ab5b83). 정본 DatePicker 의 트리거 기본
  // 클래스는 `w-full text-left truncate` 뿐이라 껍데기를 안 넘기면 맨글자로 그려진다. 게다가
  // 글자 크기 클래스도 없어 body 16px 을 상속했다 — 형제 select·textarea 는 14px/42px 이었다.
  //
  // 위 `inputCls` 를 그대로 못 쓰는 이유는 focus 접두 하나다. 트리거가 button 이라 `:focus` 를
  // 걸면 손가락으로 눌러 연 달력이 닫힌 뒤에도 링이 남는다(CheckoutCleaningDateField 가 같은
  // 이유로 같은 처방을 쓴다). `inputCls` 자체를 고치지 않는 것은 그 상수를 함께 쓰는 호실
  // select 때문이다 — 거기서는 마우스 클릭에도 링이 서야 한다. 나머지 값은 `inputCls` 와 같다.
  const dateFieldCls =
    'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/30'

  const submit = () => {
    if (!targetRoomId) { pushToast('error', '호실을 골라 주세요.'); return }
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await createCleaning({
          roomId: targetRoomId, reason, scheduledDate: scheduled,
          plannedPerformer: plannedPerformer || null, performerName, memo,
        })
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
        {/* 배타 선택이라 소리로도 '고른 것' 이 들려야 한다 — 채움만으로는 화면 밖에 안 나간다
            (WCAG 4.1.2, 배포 전 디자이너 패스). 보더는 선택 쪽도 투명으로 둬서 고를 때마다
            오른쪽 형제가 2px 씩 밀리던 것을 없앤다. */}
        <div role="radiogroup" aria-label="청소 사유" className="flex gap-1.5 flex-wrap">
          {REASONS.map(v => (
            <button key={v} type="button" role="radio" aria-checked={reason === v} onClick={() => setReason(v)}
              className={`rounded-lg ${FOCUS_RING} ${dense ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}`}
              style={reason === v
                ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
              {CLEANING_REASON_LABEL[v]}
            </button>
          ))}
        </div>
      </div>

      <div className={dense ? 'flex items-center gap-2 text-xs text-[var(--ink-s)]' : 'space-y-1.5'}>
        {dense ? '예정일' : <p className={labelCls}>예정일</p>}
        {/* 정본 DatePicker 사용 — 네이티브 date 입력은 앱 캘린더 문법과 어긋난다(운영자 지적 2026-08-06).
            dense 는 가로 flex 행이라 `flex-1 min-w-0` 이 함께 필요하다. 기본 클래스의 `w-full` 이
            flex-basis 를 auto 로 남겨 트리거 base 가 행 폭 전체가 되고, shrink 가 base 비례로
            분배되면서 옆의 한글 라벨('예정일')이 음절 단위로 꺾인다(CleaningRowBody 와 같은 자리). */}
        <DatePicker value={scheduled} onChange={setScheduled}
          className={dense ? `${inputCls} flex-1 min-w-0` : dateFieldCls} />
      </div>

      {/* 담당 — 운영자 요구가 "누가 청소할지도 표시되고" 라 계획 단계에서 받는다(2026-08-20).
          완료 폼과 **다른 칸**에 저장된다(plannedPerformer) — 한 칸이면 완료 적용취소가
          계획까지 지운다. 이름 칸은 여기 없다: 계획 단계에서 정하는 것은 누가 하느냐지
          어느 업체냐가 아니고, 업체 이름은 완료할 때 실제로 맡긴 곳을 적는다. */}
      <div className={dense ? '' : 'space-y-1.5'}>
        {!dense && <p className={labelCls}>담당 (선택)</p>}
        {/* '미정' 은 고른 값이 아니라 값의 부재다. 코랄로 칠하면 폼을 열자마자 화면에서 가장 강한
            것이 '아직 안 정함' 이 되고, 저장값이 null 인 사실과도 갈린다(서버는 그 함정을 이미
            피해 기본값을 안 박는다). 채움은 실제로 고른 셋에만 준다 — 소리로는 aria-checked 가
            '미정' 상태도 그대로 말한다. */}
        <div role="radiogroup" aria-label="청소 담당" className="flex gap-1.5 flex-wrap">
          {PLANNED_PERFORMERS.map(v => (
            <button key={v || 'none'} type="button" role="radio" aria-checked={plannedPerformer === v}
              onClick={() => setPlannedPerformer(v)}
              className={`rounded-lg ${FOCUS_RING} ${dense ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}`}
              style={plannedPerformer === v && v !== ''
                ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
              {v ? CLEANING_PERFORMER_LABEL[v] : '미정'}
            </button>
          ))}
        </div>
        {/* 맡긴 경우에만 이름을 묻는다 — 형제 작업 등록 폼과 같은 규칙·같은 컨트롤이다. */}
        {plannedPerformer && plannedPerformer !== 'SELF' && (
          <div className="mt-1.5">
            {recentPerformers.length > 0 ? (
              <CategorySelect
                value={performerName} onChange={setPerformerName}
                options={recentPerformers} emptyLabel="업체·사람 이름 (선택)"
                placeholder="업체·사람 이름" closeIconSize={dense ? 12 : 14}
                className={inputCls} />
            ) : (
              <input type="text" value={performerName} onChange={e => setPerformerName(e.target.value)}
                placeholder="업체·사람 이름 (선택)" className={inputCls} />
            )}
          </div>
        )}
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
