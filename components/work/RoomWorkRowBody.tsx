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
import { askWorkLink } from '@/components/work/workLinkPrompt'
import { StatusBadge, type BadgeTone } from '@/components/ui/StatusBadge'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { DatePicker } from '@/components/ui/DatePicker'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast, trackSave, type ToastAction } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { kstYmdStr } from '@/lib/kstDate'
import {
  completeRoomWork, reopenRoomWork, deleteRoomWork, restoreRoomWork, rescheduleRoomWork, unlinkExpensesFromWork, setExpenseCostKind,
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
  // 빈 문자열이다. 숫자 0 으로 두면 칸에 '0' 이 찍혀 뒤에 이어 친 값이 '0140000' 이 된다
  // (운영자 지적 2026-08-27). 형제인 청소 행이 이미 이 문법이다 — 0 은 placeholder 로만 보인다.
  const [cost, setCost] = useState('')
  // 날짜 변경 — 청소 행과 같은 문법(오류신고 2026-08-25, 예정 건에 이 문이 아예 없었다).
  const [reschedOpen, setReschedOpen] = useState(false)
  // 걸린 지출의 시공/자재 표식 — 대부분 손댈 일이 없어 접어 둔다.
  const [kindOpen, setKindOpen] = useState(false)
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

        {/* 여러 건이 붙었으면 그 사실을 말한다. 시공비를 나눠 받으면 합계만으로는 왜 이 금액인지 안 선다. */}
        {r.laborExpenseCount > 1 && (
          <span className="text-xs text-[var(--warm-muted)] num">시공 {r.laborExpenseCount}건</span>
        )}
      </div>

      {/* 걸린 지출을 줄마다 시공/자재로 다시 정한다 — **판정을 글자에서 떼는 자리다**.
          종전에는 품목 이름으로만 갈랐고, 새 작업 종류가 생기면 그 말을 판정어에 더해야 했다
          ('실리콘 시공'은 걸리는데 '실리콘'은 자재로 세어졌다). 여기서 한 번 고르면 글자보다 강하다.
          접어 두는 이유는 대부분의 행에서 손댈 일이 없어서다 — 눌러야 펴진다. */}
      {r.linkedExpenses.length > 0 && (
        kindOpen ? (
          <div className="mt-1 space-y-1">
            {r.linkedExpenses.map(e => (
              <div key={e.id} className="flex items-center gap-1.5 text-[0.65625rem]">
                <span className="min-w-0 flex-1 truncate text-[var(--warm-muted)]">{e.label}</span>
                <span className="shrink-0 num text-[var(--warm-muted)]">{fmtWon(e.amount)}</span>
                <RowActionBtn tone={e.isLabor ? 'accent' : 'neutral'} disabled={pending}
                  onClick={() => run(() => setExpenseCostKind(e.id, e.isLabor ? 'MATERIAL' : 'LABOR'),
                    e.isLabor ? '자재로 바꿨습니다' : '시공으로 바꿨습니다')}>
                  {e.isLabor ? '시공' : '자재'}{e.marked ? '' : ' (자동)'}
                </RowActionBtn>
              </div>
            ))}
            <button type="button" onClick={() => setKindOpen(false)}
              className="text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2">접기</button>
          </div>
        ) : (
          <button type="button" onClick={() => setKindOpen(true)}
            className="mt-1 text-[0.65625rem] text-[var(--warm-muted)] underline decoration-dotted underline-offset-2">
            걸린 지출 {r.linkedExpenses.length}건 · 시공비 정하기
          </button>
        )
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
            <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)}
              placeholder="0" min={0}
              className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs num" />
            원
          </label>
          {r.expenseCount > 0 ? (
            /* 금액은 지출 쪽이 정본이라 여기서 못 고친다. 그런데 종전에는 "지출 화면에서
               고칩니다"라고만 하고 **거기까지 가는 길이 없었다**(운영자 지적 2026-08-27).
               위 '이 방에 든 지출' 줄도 눌리지 않는다. 그 달 지출 화면으로 데려다준다. */
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">
              이미 지출 {r.expenseCount}건이 걸려 있어 비용을 넣어도 새로 만들지 않습니다. 금액은 지출 화면에서 고칩니다.{' '}
              <button type="button"
                onClick={() => { window.location.assign(`/finance?month=${(r.doneDate ?? r.scheduledDate ?? kstYmdStr()).slice(0, 7)}`) }}
                className="underline text-[var(--coral)] font-medium">지출 화면 열기</button>
            </p>
          ) : Number(cost || 0) > 0 ? (
            <p className="text-[0.65625rem] text-[var(--warm-muted)]">지출 한 줄이 수선유지비로 기록되고 이 작업에 걸립니다. 이미 사둔 자재값은 넣지 마세요. 살 때 이미 지출로 잡혔습니다.</p>
          ) : null}
          <div className="flex gap-1.5 flex-wrap items-center">
            <RowActionBtn tone="accent" disabled={pending}
              onClick={async () => {
                const args = { id: r.id, doneDate, performer, performerName, cost: Number(cost || 0) }
                // 먼저 묻는다(mode 기본 'ask'). 걸릴 만한 지출이 있으면 서버가 **아무것도 쓰지 않고**
                // 후보를 돌려준다 — 자동으로 묶는 분기는 어디에도 없다.
                const probe = await completeRoomWork(args)
                let mode: 'link' | 'create' = 'create'
                if (!probe.ok && 'needsChoice' in probe) {
                  const pick = await askWorkLink({ roomNo: r.roomNo ?? '', kind: r.kind, candidates: probe.candidates })
                  if (!pick) return                       // 그만두기 — 아무것도 안 바뀐다(§27.5)
                  mode = pick
                } else if (!probe.ok) { pushToast('error', probe.error); return }
                else { setDoneOpen(false); setPerformerName(''); setCost(''); onChanged(); pushToast('success', '작업 완료됨'); return }

                const linked = mode === 'link' ? probe.candidates.map(c => c.id) : []
                run(
                  async () => {
                    const res = await completeRoomWork({ ...args, mode })
                    // mode 가 정해진 재호출이라 needsChoice 는 안 온다 — run() 의 계약에 맞춘다.
                    return res.ok ? res : { ok: false as const, error: 'error' in res ? res.error : '완료 처리에 실패했습니다.' }
                  },
                  mode === 'link' ? '작업 완료됨 · 이미 있던 지출을 걸었습니다' : '작업 완료됨',
                  { label: '적용취소', run: () => { void (async () => {
                      // 연결부터 되돌리고 완료를 무른다 — 순서가 반대면 되돌린 작업에 지출이 남는다.
                      if (linked.length > 0) await unlinkExpensesFromWork(linked)
                      const res = await reopenRoomWork(r.id)
                      if (res.ok) { pushToast('info', '완료를 취소했습니다'); onChanged() }
                      else pushToast('error', res.error)
                    })().catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } },
                )
                // 폼을 닫는다. 종전에는 이 줄이 없어 배지가 '완료'로 바뀐 뒤에도 저장 버튼이
                // 그대로 살아 있었다(운영자 지적 2026-08-27). 형제인 청소 행은 원래 닫는다.
                setDoneOpen(false); setPerformerName(''); setCost('')
              }}>
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
