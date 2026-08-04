'use client'

// 방 청소 이력 위젯 — 예정 등록·완료 처리·되돌리기 (2026-08-05, 신고 b21e4e98).
//
// "어떤 방이 언제 청소했고 청소를 안 했는지 헷갈린다" 가 신고 본문이다.
// 이 위젯은 돈을 만들지 않는다. 비용 연결은 2단계다.
//
// 완료를 되돌릴 수 있어야 한다. 오탭 한 번에 이력이 굳으면 그게 다음 신고가 된다.

import { useEffect, useState, useTransition } from 'react'
import { Btn } from '@/components/ui/Btn'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { kstYmdStr } from '@/lib/kstDate'
import {
  getRoomCleanings, createCleaning, completeCleaning, reopenCleaning, skipCleaning, deleteCleaning,
} from '@/app/(app)/room-manage/cleaningActions'
import {
  CLEANING_REASON_LABEL, CLEANING_PERFORMER_LABEL,
  type CleaningRow, type CleaningReason, type CleaningPerformer,
} from '@/app/(app)/room-manage/cleaningConstants'

const REASONS: CleaningReason[] = ['CHECKOUT', 'AFTER_WORK', 'DURING_STAY', 'OTHER']
const PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']
const fmt = (d: string | null) => (d ? d.replace(/-/g, '.').slice(2) : '')

export function RoomCleaningPanel({ roomId }: { roomId: string }) {
  const [rows, setRows] = useState<CleaningRow[] | null>(null)
  const [adding, setAdding] = useState(false)
  const [reason, setReason] = useState<CleaningReason>('CHECKOUT')
  const [scheduled, setScheduled] = useState(kstYmdStr())
  const [doneFor, setDoneFor] = useState<string | null>(null)
  const [performer, setPerformer] = useState<CleaningPerformer>('SELF')
  const [performerName, setPerformerName] = useState('')
  const [cost, setCost] = useState('')
  const [pending, startTransition] = useTransition()

  const [loadFailed, setLoadFailed] = useState(false)
  // 실패를 빈 목록으로 삼키지 않는다. 그러면 고장이 '기록 없음' 과 똑같이 보인다.
  const reload = () => {
    void getRoomCleanings(roomId)
      .then(v => { setRows(v); setLoadFailed(false) })
      .catch(() => { setRows([]); setLoadFailed(true) })
  }
  useEffect(reload, [roomId])   // eslint-disable-line react-hooks/exhaustive-deps

  const run = (fn: () => Promise<{ ok: true } | { ok: true; id: string } | { ok: false; error: string }>, okMsg: string) =>
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await fn()
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', okMsg)
        reload()
      } finally { release() }
    })

  const open = rows?.find(r => r.status === 'PLANNED') ?? null

  return (
    <div className="rounded-xl p-3" style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)' }}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
        <h3 className="text-sm font-semibold text-[var(--warm-dark)]">청소 이력</h3>
        {!adding && (
          <Btn variant="secondary" size="sm" onClick={() => { setAdding(true); setReason('CHECKOUT'); setScheduled(kstYmdStr()) }}>
            청소 예정 등록
          </Btn>
        )}
      </div>

      {adding && (
        <div className="rounded-lg p-2.5 mb-2 space-y-2" style={{ background: 'var(--cream)', border: '1px solid var(--warm-border)' }}>
          <div className="flex gap-1.5 flex-wrap">
            {REASONS.map(r => (
              <button key={r} type="button" onClick={() => setReason(r)}
                className="px-2 py-1 rounded-lg text-xs"
                style={reason === r
                  ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                  : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
                {CLEANING_REASON_LABEL[r]}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
            예정일
            <input type="date" value={scheduled} onChange={e => setScheduled(e.target.value)}
              className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs" />
          </label>
          <div className="flex gap-2">
            <Btn variant="primary" size="sm" disabled={pending}
              onClick={() => { run(() => createCleaning({ roomId, reason, scheduledDate: scheduled }), '청소 예정 등록됨'); setAdding(false) }}>
              등록
            </Btn>
            <Btn variant="secondary" size="sm" onClick={() => setAdding(false)}>취소</Btn>
          </div>
        </div>
      )}

      {rows === null ? (
        <p className="text-xs text-[var(--warm-muted)]">불러오는 중…</p>
      ) : loadFailed ? (
        <p className="text-xs text-[var(--danger-fg)]">청소 이력을 불러오지 못했습니다.</p>
      ) : rows.length === 0 ? (
        <p className="text-xs text-[var(--warm-muted)]">청소 기록이 없습니다.</p>
      ) : (
        <ul className="space-y-1.5">
          {rows.map(r => (
            <li key={r.id} className="rounded-lg px-2.5 py-2" style={{ background: 'var(--cream)' }}>
              <div className="flex items-center gap-1.5 flex-wrap">
                {/* 톤은 기존 정본 셋만 쓴다. 새 톤을 만들면 StatusBadge 세 곳을 동시에 고쳐야 한다.
                    완료=paid(끝난 것), 안 함=info(중립), 예정=await(기다리는 것) */}
                <StatusBadge tone={r.status === 'DONE' ? 'paid' : r.status === 'SKIPPED' ? 'info' : 'await'}>
                  {r.status === 'DONE' ? '완료' : r.status === 'SKIPPED' ? '안 함' : '예정'}
                </StatusBadge>
                <span className="text-xs text-[var(--warm-dark)]">{CLEANING_REASON_LABEL[r.reason]}</span>
                <span className="text-xs text-[var(--warm-muted)] num">
                  {r.status === 'DONE' ? fmt(r.doneDate) : fmt(r.scheduledDate)}
                </span>
                {r.performer && (
                  <span className="text-xs text-[var(--warm-muted)]">
                    {CLEANING_PERFORMER_LABEL[r.performer]}{r.performerName ? ` · ${r.performerName}` : ''}
                  </span>
                )}
                {r.cost != null && r.cost > 0 && (
                  <span className="text-xs font-medium text-[var(--warm-dark)] num">{r.cost.toLocaleString()}원</span>
                )}
              </div>

              {/* 완료 입력 — 그 줄에서 바로 받는다. 별도 모달을 띄우면 방 상세 위에 창이 또 쌓인다. */}
              {doneFor === r.id ? (
                <div className="mt-2 space-y-2">
                  <div className="flex gap-1.5 flex-wrap">
                    {PERFORMERS.map(pf => (
                      <button key={pf} type="button" onClick={() => setPerformer(pf)}
                        className="px-2 py-1 rounded-lg text-xs"
                        style={performer === pf
                          ? { background: 'var(--coral)', color: 'var(--on-solid)' }
                          : { background: 'var(--canvas)', color: 'var(--ink-s)', border: '1px solid var(--warm-border)' }}>
                        {CLEANING_PERFORMER_LABEL[pf]}
                      </button>
                    ))}
                  </div>
                  {performer !== 'SELF' && (
                    <>
                      <input type="text" value={performerName} onChange={e => setPerformerName(e.target.value)}
                        placeholder="업체·사람 이름 (선택)"
                        className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs" />
                      {/* 비용을 적으면 지출이 함께 만들어져 그 방 비용에 잡힌다. 비우면 지출을 안 만든다.
                          직접 청소는 비용이 아니라 애초에 이 칸이 안 뜬다. */}
                      <label className="flex items-center gap-2 text-xs text-[var(--ink-s)]">
                        비용
                        <input type="number" inputMode="numeric" value={cost} onChange={e => setCost(e.target.value)}
                          placeholder="0" min={0}
                          className="w-28 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1 text-xs num" />
                        원
                      </label>
                    </>
                  )}
                  <div className="flex gap-2">
                    <Btn variant="primary" size="sm" disabled={pending}
                      onClick={() => {
                        const c = performer === 'SELF' ? 0 : Number(cost || 0)
                        run(() => completeCleaning({ id: r.id, doneDate: kstYmdStr(), performer, performerName, cost: c }),
                          c > 0 ? '청소 완료 · 지출도 함께 기록됨' : '청소 완료로 기록됨')
                        setDoneFor(null); setPerformerName(''); setCost('')
                      }}>
                      오늘 완료
                    </Btn>
                    <Btn variant="secondary" size="sm" onClick={() => setDoneFor(null)}>취소</Btn>
                  </div>
                </div>
              ) : (
                <div className="mt-1.5 flex gap-2 flex-wrap">
                  {r.status === 'PLANNED' && (
                    <>
                      <button type="button" onClick={() => { setDoneFor(r.id); setPerformer('SELF'); setPerformerName(''); setCost('') }}
                        className="text-xs text-[var(--coral)] font-medium">완료 처리</button>
                      <button type="button" disabled={pending}
                        onClick={async () => {
                          if (!(await confirmDialog({ title: '이 청소를 안 하기로 할까요?', message: '기록은 남고 상태만 바뀝니다. 다시 되돌릴 수 있습니다.', confirmLabel: '안 하기로', level: 'caution' }))) return
                          run(() => skipCleaning(r.id), '안 하기로 표시됨')
                        }}
                        className="text-xs text-[var(--warm-muted)]">안 하기로</button>
                    </>
                  )}
                  {r.status !== 'PLANNED' && (
                    <button type="button" disabled={pending}
                      onClick={() => run(() => reopenCleaning(r.id),
                        r.cost ? '예정으로 되돌렸습니다 · 기록된 지출은 그대로 남습니다' : '예정으로 되돌렸습니다')}
                      className="text-xs text-[var(--coral)]">되돌리기</button>
                  )}
                  <button type="button" disabled={pending}
                    onClick={async () => {
                      if (!(await confirmDialog({ title: '이 청소 기록을 삭제할까요?', message: '기록이 목록에서 사라집니다.', confirmLabel: '삭제', level: 'danger' }))) return
                      run(() => deleteCleaning(r.id), '삭제됨')
                    }}
                    className="text-xs text-[var(--warm-muted)] ml-auto">삭제</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {open && (
        <p className="mt-2 text-xs text-[var(--warning-fg)]">청소 예정이 남아 있습니다. 호실 목록에도 표시됩니다.</p>
      )}
    </div>
  )
}
