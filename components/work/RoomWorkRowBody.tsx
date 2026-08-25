'use client'

// 작업 행의 표시·조작 — 완료 처리·적용취소·삭제·복원 (2026-08-25, 신고 b21e4e98 후속).
//
// components/cleaning/CleaningRowBody 를 거울로 삼았다. 그 파일을 재사용하지 않은 것은
// 거기에 청소 전용 조작(안 함 처리·받은 청소비 부담·잔고 조회)이 얽혀 있어, 파라미터로
// 가르면 접점이 그만큼 늘기 때문이다. 껍데기 문법과 톤은 그대로 베꼈다.
//
// 다른 것 셋. 상태가 둘뿐이고(예정·완료), 부담 표식이 없고, 비용이 **여러 지출의 합**이다
// (자재를 여러 날 나눠 사고 시공은 하루다 — Expense.roomWorkId 가 1:N 이다).

import { useState, useTransition } from 'react'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { DatePicker } from '@/components/ui/DatePicker'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast, trackSave, type ToastAction } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { kstYmdStr } from '@/lib/kstDate'
import {
  completeRoomWork, reopenRoomWork, deleteRoomWork, restoreRoomWork, rescheduleRoomWork,
  type RoomWorkRow,
} from '@/app/(app)/room-manage/workActions'
import {
  CLEANING_PERFORMER_LABEL, type CleaningPerformer,
} from '@/app/(app)/room-manage/cleaningConstants'

// 형제 행과 같은 껍데기·같은 이유(오류신고 c2ab5b83 — 안 넘기면 맨글자로 그려진다).
const DENSE_DATE_CLS =
  'flex-1 min-w-0 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]'
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--coral)]'

const PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']

/** 톤은 기존 정본만 쓴다. 완료=paid(끝난 것) · 예정=await(기다리는 것). '안 함'은 작업에 없다. */
const workTone = (s: 'PLANNED' | 'DONE'): BadgeTone => (s === 'DONE' ? 'paid' : 'await')

export function RoomWorkRowBody({
  row: r, canEdit, deleted = false, onChanged,
}: {
  row: RoomWorkRow
  canEdit: boolean
  /** 삭제된 행 — 복원만 할 수 있다. */
  deleted?: boolean
  onChanged: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [doneOpen, setDoneOpen] = useState(false)
  const [doneDate, setDoneDate] = useState(kstYmdStr())
  const [performer, setPerformer] = useState<CleaningPerformer>('VENDOR')
  const [performerName, setPerformerName] = useState('')
  const [cost, setCost] = useState(0)
  // 날짜 변경 — 청소 행과 같은 문법(오류신고 2026-08-25, 예정 건에 이 문이 아예 없었다).
  const [reschedOpen, setReschedOpen] = useState(false)
  const [reschedDate, setReschedDate] = useState('')

  const run = (
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    okMsg: string,
    action?: ToastAction,
  ) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', okMsg, action ? { action } : undefined)
        onChanged()
      } finally { release() }
    })

  const shownDate = r.status === 'DONE' ? r.doneDate : r.scheduledDate

  return (
    <div className={deleted ? 'opacity-60' : ''}>
      <div className="flex items-center gap-1.5 flex-wrap">
        <StatusBadge tone={workTone(r.status)}>{r.status === 'DONE' ? '완료' : '예정'}</StatusBadge>
        <span className="text-xs font-medium text-[var(--warm-dark)]">{r.kind}</span>
        {shownDate && <span className="text-xs text-[var(--warm-muted)] num">{fmtDateDot(shownDate)}</span>}
        {(r.performer || r.performerName) && (
          <span className="text-xs text-[var(--warm-muted)]">
            {r.performer ? CLEANING_PERFORMER_LABEL[r.performer] : '기록된 이름'}
            {r.performerName ? ` · ${r.performerName}` : ''}
          </span>
        )}
        {/* 되돌린 건은 예정인데도 지출이 그대로 걸려 있다(그래야 재완료가 두 건을 안 만든다).
            형제 행과 같은 말로 가른다 — '예정인데 얼마 나갔다'로 읽히면 안 된다. */}
        {r.cost > 0 && (
          r.status === 'DONE' ? (
            <span className="text-xs font-medium text-[var(--warm-dark)] num">{fmtWon(r.cost)}</span>
          ) : (
            <span className="text-xs text-[var(--warm-muted)] num">기록된 지출 {fmtWon(r.cost)}</span>
          )
        )}

        {/* 여러 건이 붙었으면 그 사실을 말한다. 자재를 여러 날 사면 합계만으로는 왜 이 금액인지 안 선다.
            이 합계는 **시공비 + 그 방에 쓴 자재비**이다. 자재비는 새로 나간 돈이 아니라 살 때
            이미 잡힌 지출을 방별로 쪼갠 것이다(운영자 확인 2026-08-25). */}
        {r.expenseCount > 1 && (
          <span className="text-xs text-[var(--warm-muted)] num">지출 {r.expenseCount}건</span>
        )}
      </div>

      {/* 시공비와 자재비 — §11 보조줄이다(운영자 요청 2026-08-25).
          **칩 줄에 넣었다가 내렸다.** 실측(Pretendard 자, MoveCalendar:57 과 같은 식) 결과
          가장 긴 행이 437px 이 되어 320·360·390 **전부에서 두 줄로 접혔다.** 넣기 전에는
          한 줄이었다. 보조줄은 10.5px 라 같은 문장이 160px 남짓이고 어디서도 한 줄에 든다.
          운영자 원문 — "자리가 비좁거나 잘 안읽히면 나눈거 철회할 수 있으니 감안해줘".
          철회 대신 자리를 옮긴 이유는 합계가 여전히 칩 줄에서 굵게 서 있어 훑을 때는 총액이
          먼저 읽히고, 가르는 정보는 눈이 그 행에 머물 때 읽히면 되기 때문이다.
          **둘 다 있을 때만** 뜬다 — 한쪽이 0이면 위 합계가 이미 그 사실을 다 말한다. */}
      {r.laborCost > 0 && r.materialCost > 0 && (
        <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] num">
          시공비 {fmtWon(r.laborCost)} · 자재비 {fmtWon(r.materialCost)}
        </p>
      )}

      {/* 메모는 §11 보조줄. 길이를 모르는 자유 입력이라 칩 줄에 끼우면 줄이 무너진다. */}
      {r.memo && (
        <p className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] break-words">{r.memo}</p>
      )}

      {!canEdit ? null : deleted ? (
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          <RowActionBtn tone="accent" disabled={pending}
            onClick={() => run(() => restoreRoomWork(r.id), '작업 기록 복원됨', {
              label: '적용취소',
              run: () => { void deleteRoomWork(r.id).then(res => {
                if (res.ok) { pushToast('info', '복원을 취소했습니다'); onChanged() }
                else pushToast('error', res.error)
              }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
            })}>
            복원
          </RowActionBtn>
        </div>
      ) : reschedOpen ? (
        /* 날짜 변경 — 완료 입력과 같은 자리, 같은 문법. 고치는 날짜는 그 행에 보이는 날짜다.
           완료 건은 지나간 일이라 오늘까지로 막고, 예정 건은 앞날을 잡는 자리라 안 막는다. */
        <div className="mt-2 space-y-2">
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            {r.status === 'DONE' ? '완료일' : '예정일'}
            <DatePicker value={reschedDate} onChange={setReschedDate}
              maxDate={r.status === 'DONE' ? kstYmdStr() : undefined} className={DENSE_DATE_CLS} />
          </div>
          <div className="flex gap-1.5 flex-wrap items-center">
            <RowActionBtn tone="accent" disabled={pending || !reschedDate}
              onClick={() => {
                run(() => rescheduleRoomWork({ id: r.id, date: reschedDate }),
                  r.status === 'DONE' ? '완료일 변경됨' : '예정일 변경됨')
                setReschedOpen(false)
              }}>
              저장
            </RowActionBtn>
            <RowActionBtn onClick={() => setReschedOpen(false)}>취소</RowActionBtn>
          </div>
        </div>
      ) : doneOpen ? (
        /* 완료 입력 — 그 줄에서 바로 받는다. 별도 모달을 띄우면 창이 또 쌓인다(형제 행과 같다). */
        <div className="mt-2 space-y-2">
          <div role="radiogroup" aria-label="작업 수행자" className="flex gap-1.5 flex-wrap">
            {PERFORMERS.map(v => (
              <button key={v} type="button" role="radio" aria-checked={performer === v}
                onClick={() => setPerformer(v)}
                className={`rounded-lg px-2 py-1 text-xs ${FOCUS_RING}`}
                style={performer === v
                  ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                  : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
                {CLEANING_PERFORMER_LABEL[v]}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            완료일
            <DatePicker value={doneDate} onChange={setDoneDate} className={DENSE_DATE_CLS} />
          </div>
          <input type="text" value={performerName} onChange={e => setPerformerName(e.target.value)}
            placeholder="업체·사람 이름 (선택)"
            className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs text-[var(--warm-dark)]" />
          {/* 비용 — 넣으면 지출이 **새로** 한 줄 생기고 이 작업에 걸린다.
              **여기 넣을 것은 시공비(이번에 새로 나간 돈)뿐이다.** 자재는 살 때 이미 지출로
              잡혔고, 방별 몫은 그 지출을 쪼갠 행이다(allocationGroupId). 총액을 넣으면 이미
              잡힌 자재값이 한 번 더 지출이 된다 — 운영자 지적 2026-08-25. */}
          {/* 형제 행과 같은 칸이다 — 폭 w-28 · 뒤에 '원'. MoneyInput 정본은 className 을 안 받고
              이 자리는 촘촘한 행이라 형제가 쓰는 문법을 그대로 쓴다. */}
          <label className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            시공비
            <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(Number(e.target.value) || 0)}
              placeholder="0" min={0}
              className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs num" />
            원
          </label>
          {r.expenseCount > 0 ? (
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              이미 지출 {r.expenseCount}건이 걸려 있어 비용을 넣어도 새로 만들지 않습니다. 금액은 지출 화면에서 고칩니다.
            </p>
          ) : cost > 0 ? (
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">지출 한 줄이 수선유지비로 기록되고 이 작업에 걸립니다. 이미 사둔 자재값은 넣지 마세요. 살 때 이미 지출로 잡혔습니다.</p>
          ) : null}
          <div className="flex gap-1.5 flex-wrap items-center">
            <RowActionBtn tone="accent" disabled={pending}
              onClick={() => run(
                () => completeRoomWork({ id: r.id, doneDate, performer, performerName, cost }),
                '작업 완료됨',
                { label: '적용취소', run: () => { void reopenRoomWork(r.id).then(res => {
                    if (res.ok) { pushToast('info', '완료를 취소했습니다'); onChanged() }
                    else pushToast('error', res.error)
                  }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } },
              )}>
              저장
            </RowActionBtn>
            <RowActionBtn onClick={() => setDoneOpen(false)}>취소</RowActionBtn>
          </div>
        </div>
      ) : (
        <div className="mt-1.5 flex gap-1.5 flex-wrap items-center">
          {r.status === 'PLANNED' && (
            <RowActionBtn tone="accent" disabled={pending} onClick={() => setDoneOpen(true)}>완료 처리</RowActionBtn>
          )}
          {/* 날짜 변경 — 예정·완료 둘 다에 선다. 청소 행에는 있는데 여기만 없어서 예정 날짜를
              고칠 길이 아예 없었다(운영자 신고 2026-08-25). 여는 순간 그 행의 현재 날짜를 담는다. */}
          <RowActionBtn disabled={pending}
            onClick={() => {
              setReschedDate((r.status === 'DONE' ? r.doneDate : r.scheduledDate) ?? kstYmdStr())
              setDoneOpen(false)
              setReschedOpen(true)
            }}>
            날짜 변경
          </RowActionBtn>
          {r.status === 'DONE' && (
            <RowActionBtn disabled={pending}
              onClick={() => run(() => reopenRoomWork(r.id), '완료를 되돌렸습니다')}>
              완료 되돌리기
            </RowActionBtn>
          )}
          <RowActionBtn tone="danger" disabled={pending}
            onClick={async () => {
              if (!(await confirmDialog({ title: `${r.kind} 기록을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
              run(() => deleteRoomWork(r.id), '작업 기록 삭제됨', {
                label: '적용취소',
                run: () => { void restoreRoomWork(r.id).then(res => {
                  if (res.ok) { pushToast('info', '삭제를 취소했습니다'); onChanged() }
                  else pushToast('error', res.error)
                }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) },
              })
            }}>
            삭제
          </RowActionBtn>
        </div>
      )}
    </div>
  )
}
