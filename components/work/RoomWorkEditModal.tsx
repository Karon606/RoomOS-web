'use client'

// 작업(도배·장판 등) 기록 한 건 수정 Modal — 행 [수정] 이 연다(2026-10-27 운영자 지적·승인 계획 2단계, 가이드 §27.1).
//
// 칸 차례: 날짜(완료 건 완료일·예정 건 예정일) → 종류(CategorySelect addMode auto) → 수행자 칩 + 업체·사람 이름 → 시공비 ₩(완료 건)
// → 결제수단(+카드, 시공비가 있을 때) → 메모. 저장은 서버 updateRoomWork 한 트랜잭션이고 토스트 [적용취소] 가 저장 직전 모습 전체를 되돌린다.
// 걸린 지출이 여러 건이면 금액 칸 대신 읽기 전용 줄 목록을 보이고 줄마다 [금액·업체 고치기](updateWorkExpense, 이 작업 범위) 또는 지출 화면으로 간다(결정 7).
// 지출 날짜는 옮기지 않는다(자재를 여러 날 산 것까지 걸린다). 관리 메뉴는 완료 적용취소(완료 건)·삭제다. 확인창·토스트는 종전 행의 것 그대로다.

import { useEffect, useId, useState } from 'react'
import { RecordEditShell, recordEditUndoAction, type RecordManageItem } from '@/components/ui/RecordEditShell'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { RowActionBtn } from '@/components/ui/RowActionBtn'
import { Btn } from '@/components/ui/Btn'
import CategorySelect from '@/components/ui/CategorySelect'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { PayMethodField } from '@/components/finance/PayMethodField'
import { useWorkPay } from '@/components/work/useWorkPay'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtMDDay } from '@/lib/fmtDate'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtRoomNo } from '@/lib/roomNo'
import {
  updateRoomWork, updateWorkExpense, reopenRoomWork, deleteRoomWork, restoreRoomWork,
  type RoomWorkRow,
} from '@/app/(app)/room-manage/workActions'
import { getWorkKindOptions } from '@/app/(app)/settings/actions'
import { CLEANING_PERFORMER_LABEL, type CleaningPerformer } from '@/app/(app)/room-manage/cleaningConstants'

const LABEL_CLS = 'text-xs font-medium text-[var(--warm-mid)]'
const INPUT_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30 placeholder:text-[var(--warm-muted)]'
const DATE_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/30'
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--tc-text)]'
const DONE_PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']
const PLANNED_PERFORMERS: (CleaningPerformer | '')[] = ['', 'SELF', 'VENDOR', 'THIRD_PARTY']

/** 걸린 지출 한 줄 금액·업체 고치기 — 여러 건 걸린 작업에서만 선다. 저장하면 바로 그 줄만 고치고 토스트 [적용취소] 가 있다. */
function LinkedExpenseLine({ workId, line, kind, onSaved }: {
  workId: string; line: RoomWorkRow['linkedExpenses'][number]; kind: string; onSaved: (next: { amount: number; vendor: string | null }) => void
}) {
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState(line.amount)
  const [vendor, setVendor] = useState(line.vendor ?? '')
  const [busy, setBusy] = useState(false)
  if (!open) {
    return (
      <li className="flex items-center gap-2 py-1.5 text-xs text-[var(--warm-dark)]">
        <span className="min-w-0 flex-1">
          <span className="block break-keep">{line.label}</span>
          {line.vendor && <span className="block text-[0.65625rem] text-[var(--warm-muted)] break-keep">{line.vendor}</span>}
        </span>
        <span className="shrink-0 num">{fmtWon(line.amount)}</span>
        <RowActionBtn tone="neutral" onClick={() => { setAmount(line.amount); setVendor(line.vendor ?? ''); setOpen(true) }}>금액·업체 고치기</RowActionBtn>
      </li>
    )
  }
  const save = async () => {
    if (busy) return
    setBusy(true)
    const release = trackSave()
    try {
      const res = await updateWorkExpense({ workId, expenseId: line.id, amount, vendor })
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `'${line.label}' 지출을 고쳤습니다`, recordEditUndoAction(res.undo, `'${line.label}' 지출`, () => onSaved({ amount: line.amount, vendor: line.vendor })))
      onSaved({ amount, vendor: vendor.trim() || null })
      setOpen(false)
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release(); setBusy(false) }
  }
  return (
    <li className="space-y-2 py-2">
      <p className="text-xs text-[var(--warm-dark)] break-keep">{line.label}</p>
      <MoneyInput value={amount} onChange={setAmount} />
      <input type="text" value={vendor} onChange={e => setVendor(e.target.value)} placeholder="업체 (선택)" aria-label={`${kind} 지출 업체`} className={INPUT_CLS} />
      <div className="flex gap-2">
        <Btn variant="primary" size="sm" disabled={busy || amount <= 0} onClick={save}>저장</Btn>
        <Btn variant="secondary" size="sm" onClick={() => setOpen(false)}>취소</Btn>
      </div>
    </li>
  )
}

export function RoomWorkEditModal({ row: r, z, recentPerformers, onClose, onChanged }: {
  row: RoomWorkRow
  z: 200 | 260
  recentPerformers: string[]
  onClose: () => void
  onChanged: () => void
}) {
  const uid = useId()
  const done = r.status === 'DONE'
  const only = r.linkedExpenses.length === 1 ? r.linkedExpenses[0] : null
  const many = r.linkedExpenses.length > 1
  const init = {
    date: (done ? r.doneDate : r.scheduledDate) ?? '',
    kind: r.kind,
    performer: (r.performer ?? '') as CleaningPerformer | '',
    name: r.performerName ?? '',
    cost: only ? only.amount : 0,
    memo: r.memo ?? '',
  }
  const [date, setDate] = useState(init.date)
  const [kind, setKind] = useState(init.kind)
  const [kindToList, setKindToList] = useState(true)
  const [kinds, setKinds] = useState<string[]>([])
  const [performer, setPerformer] = useState<CleaningPerformer | ''>(init.performer || (done ? 'VENDOR' : ''))
  const [name, setName] = useState(init.name)
  const [cost, setCost] = useState(init.cost)
  const [memo, setMemo] = useState(init.memo)
  const [lines, setLines] = useState(r.linkedExpenses)
  const [pending, setPending] = useState(false)
  useEffect(() => { getWorkKindOptions().then(setKinds).catch(() => setKinds([])) }, [])

  const showName = done || (performer !== '' && performer !== 'SELF')
  const payAsked = done && !many && cost > 0
  const pay = useWorkPay({ kind: 'work', enabled: payAsked, vendor: name, vendors: recentPerformers, known: only ? { payMethod: only.payMethod, financialAccountId: only.financialAccountId } : null })

  const dirty = date !== init.date || kind !== init.kind || performer !== (init.performer || (done ? 'VENDOR' : '')) || name !== init.name
    || cost !== init.cost || memo !== init.memo || pay.changed
  const saveReason = done && !date ? '완료일을 골라야 저장할 수 있습니다 · 완료일을 고르면 됩니다.'
    : !kind.trim() ? '작업 종류를 골라야 저장할 수 있습니다 · 종류를 고르면 됩니다.'
    : done && only && cost <= 0 ? '걸린 지출이 있어 시공비를 0원으로 둘 수 없습니다 · 지출을 지우려면 지출 화면에서 지우면 됩니다.'
    : null
  const statusWord = done ? '완료' : '예정'
  const subtitle = `${fmtRoomNo(r.roomNo)} · ${init.date ? `${statusWord} ${fmtMDDay(init.date)}` : '예정일 미정'}`

  const save = async () => {
    if (pending || saveReason) return
    if (!dirty) { onClose(); return }
    setPending(true)
    const release = trackSave()
    try {
      const res = await updateRoomWork({
        id: r.id, expectedUpdatedAt: r.updatedAt, date: date || null, kind, addKindToList: kindToList,
        performer: performer || null, performerName: showName ? name : null, memo,
        ...(done && !many ? { cost, ...(payAsked ? pay.payload : {}) } : {}),
      })
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', `${kind} 기록을 고쳤습니다`, recordEditUndoAction(res.undo, `${kind} 기록`, onChanged))
      onClose(); onChanged()
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release(); setPending(false) }
  }

  // 관리 — 이 건의 되돌림·파괴 동작. 확인창·토스트는 종전 행의 것 그대로다. 실행하면 창을 닫는다.
  const runManage = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, okMsg: string, undo?: () => Promise<{ ok: true } | { ok: false; error: string }>, undoMsg?: string) => {
    const release = trackSave()
    try {
      const res = await fn()
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', okMsg, undo ? { action: { label: '적용취소', run: () => { void undo().then(u => {
        if (u.ok) { pushToast('info', undoMsg ?? '적용취소했습니다'); onChanged() }
        else pushToast('error', u.error)
      }).catch(() => pushToast('error', '처리 중 통신 오류가 발생했습니다')) } } } : undefined)
      onClose(); onChanged()
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release() }
  }
  const manage: RecordManageItem[] = [
    ...(done ? [{ key: 'reopen', label: '완료 적용취소', onSelect: async () => {
      if (!(await confirmDialog({
        title: `${r.kind} 완료를 적용취소할까요?`,
        message: r.expenseCount > 0
          ? `예정으로 되돌립니다. 걸린 지출 ${r.expenseCount}건은 그대로 남습니다. 다시 완료해도 두 벌이 안 생깁니다.`
          : '예정으로 되돌립니다. 기록은 남습니다.',
        level: 'caution', confirmLabel: '적용취소',
      }))) return
      void runManage(() => reopenRoomWork(r.id), '완료를 적용취소했습니다')
    } }] : []),
    { key: 'delete', label: '삭제', danger: true, onSelect: async () => {
      if (!(await confirmDialog({ title: `${r.kind} 기록을 삭제할까요?`, level: 'caution', confirmLabel: '삭제' }))) return
      void runManage(() => deleteRoomWork(r.id), '작업 기록 삭제됨', () => restoreRoomWork(r.id), '삭제를 취소했습니다')
    } },
  ]

  return (
    <RecordEditShell title={`${r.kind} 수정`} subtitle={subtitle} z={z} dirty={dirty} pending={pending} saveReason={saveReason}
      onSave={save} onClose={onClose} manage={manage}>
      <div className="space-y-1.5">
        <p className={LABEL_CLS}>{done ? '완료일' : '예정일'}</p>
        {/* 완료 건은 지나간 일이라 오늘까지(lib/completionDate, 서버도 거부), 예정 건은 앞날을 잡는 자리라 안 막고 비울 수 있다. */}
        <DatePicker value={date} onChange={setDate} maxDate={done ? kstYmdStr() : undefined} className={DATE_CLS} />
      </div>
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-kind`}>작업 종류</label>
        <CategorySelect id={`${uid}-kind`} value={kind} onChange={setKind} options={kinds}
          placeholder="작업 종류를 직접 입력하세요" addMode="auto" addLabel="이 종류를 목록에 추가" savedValue={r.kind}
          addToList={kindToList} onAddToListChange={setKindToList} className={INPUT_CLS} />
      </div>
      <div className="space-y-1.5">
        <p className={LABEL_CLS}>{done ? '수행자' : '담당 (선택)'}</p>
        <div role="radiogroup" aria-label={done ? '작업 수행자' : '작업 담당'} className="flex gap-1.5 flex-wrap">
          {(done ? DONE_PERFORMERS : PLANNED_PERFORMERS).map(v => (
            <button key={v || 'none'} type="button" role="radio" aria-checked={performer === v}
              onClick={() => setPerformer(v)}
              className={`rounded-lg px-3 py-2 text-sm ${FOCUS_RING}`}
              style={performer === v && v !== ''
                ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                : { background: 'var(--canvas)', color: 'var(--seg-ink-off)', border: '1px solid var(--warm-border)' }}>
              {v ? CLEANING_PERFORMER_LABEL[v] : '미정'}
            </button>
          ))}
        </div>
        {showName && (recentPerformers.length > 0 ? (
          <CategorySelect value={name} onChange={setName} options={recentPerformers} emptyLabel="업체·사람 이름 (선택)"
            placeholder="업체·사람 이름" ariaLabel="업체·사람 이름" className={INPUT_CLS} />
        ) : (
          <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="업체·사람 이름 (선택)" aria-label="업체·사람 이름" className={INPUT_CLS} />
        ))}
      </div>
      {done && (many ? (
        <div className="space-y-1.5">
          <p className={LABEL_CLS}>걸린 지출 {lines.length}건</p>
          <ul className="divide-y divide-[var(--warm-border)]/60">
            {lines.map(l => (
              <LinkedExpenseLine key={l.id} workId={r.id} line={l} kind={r.kind}
                onSaved={next => { setLines(prev => prev.map(x => x.id === l.id ? { ...x, ...next } : x)); onChanged() }} />
            ))}
          </ul>
          <p className="text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep">
            줄마다 바로 고쳐 저장됩니다. 결제수단은 지출 화면에서 고칩니다.{' '}
            <button type="button" onClick={() => { window.location.assign(`/finance?month=${(r.doneDate ?? kstYmdStr()).slice(0, 7)}`) }}
              className="underline text-[var(--tc-text)] font-medium">지출 화면 열기</button>
          </p>
        </div>
      ) : (
        <>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>시공비</p>
            <MoneyInput value={cost} onChange={setCost} />
            {/* 여기 넣을 것은 시공비(이번에 새로 나간 돈)뿐이다. 자재는 살 때 이미 지출로 잡혔다(domain-room-work). */}
            <p className="text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep">
              {only
                ? '걸린 지출의 금액·업체·결제수단을 함께 고칩니다. 지출 날짜는 그대로입니다.'
                : cost > 0 ? '지출 한 줄이 수선유지비로 기록되고 이 작업에 걸립니다. 이미 사둔 자재값은 넣지 마세요.' : '비워 두면 지출을 만들지 않습니다.'}
            </p>
          </div>
          {payAsked && pay.ready && (
            <PayMethodField methods={pay.methods} accounts={pay.accounts} payMethod={pay.payMethod} accountId={pay.accountId} onChange={pay.onChange} />
          )}
        </>
      ))}
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-memo`}>메모 (선택)</label>
        <input id={`${uid}-memo`} type="text" value={memo} onChange={e => setMemo(e.target.value)} maxLength={500} placeholder="메모 (선택)" className={INPUT_CLS} />
      </div>
    </RecordEditShell>
  )
}
