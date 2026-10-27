'use client'

// 청소 기록 한 건 수정 Modal — 행 [수정] 이 연다(2026-10-27 운영자 지적·승인 계획 2단계, 가이드 §27.1).
//
// 칸 차례: 날짜(완료 건 완료일·그 밖 예정일) → 사유(CategorySelect ask, 예정 등록과 같은 칸) → 수행자 칩 + 업체·사람 이름(완료 건)
// → 비용 ₩(완료 건) → 결제수단 + 계좌·카드(비용이 있을 때) → 받아둔 청소비로 부담(퇴실 청소만) → 메모.
// 저장은 서버 updateCleaning 한 트랜잭션이다. 걸린 지출(1:1)의 날짜·금액·업체·내역·결제수단이 함께 바뀐다(청소 날짜를 바꾸면 지출 날짜가
// 따라가 카드 청구월이 바뀔 수 있다, 결정 8). 비용을 0 으로 바꾸면 연결만 끊고 그 전에 묻는다(결함 D3). 토스트 [적용취소] 가 저장 직전 모습 전체를 되돌린다.
// 부담 표식이 붙은 건을 퇴실 청소 밖으로 옮기려면 같은 폼에서 부담을 끄면 된다. 끄지 않으면 사유 칸 아래 한 줄이 그 사실과 푸는 법을 말하고 저장이 막힌다(§27.8).
// 관리 메뉴는 완료 적용취소·안 하기로·안 함 적용취소·삭제이고 확인창·토스트는 종전 행의 것 그대로다.

import { useEffect, useId, useState } from 'react'
import { RecordEditShell, recordEditUndoAction, confirmDiscardEdits, withDirtyNote, type RecordManageItem } from '@/components/ui/RecordEditShell'
import { DatePicker } from '@/components/ui/DatePicker'
import { MoneyInput } from '@/components/ui/MoneyInput'
import CategorySelect from '@/components/ui/CategorySelect'
import { WhyCaption } from '@/components/ui/WhyCaption'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { useReasonOptions } from '@/components/ui/useReasonOptions'
import { PayMethodField } from '@/components/finance/PayMethodField'
import { useWorkPay } from '@/components/work/useWorkPay'
import { pushToast, trackSave } from '@/lib/saveStatus'
import { fmtWon } from '@/lib/fmtMoney'
import { fmtDateDot } from '@/lib/fmtDate'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtRoomNo } from '@/lib/roomNo'
import {
  updateCleaning, reopenCleaning, skipCleaning, deleteCleaning, restoreCleaning, getCleaningFundStatus,
} from '@/app/(app)/room-manage/cleaningActions'
import {
  CLEANING_PERFORMER_LABEL, CLEANING_REASON_CODES, cleaningReasonLabel,
  type CleaningRow, type CleaningPerformer, type CleaningFundStatus,
} from '@/app/(app)/room-manage/cleaningConstants'

const LABEL_CLS = 'text-xs font-medium text-[var(--warm-mid)]'
const INPUT_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus:ring-2 focus:ring-[var(--tc-text)]/30 placeholder:text-[var(--warm-muted)]'
const DATE_CLS = 'w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2.5 text-sm text-[var(--warm-dark)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--tc-text)]/30'
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--tc-text)]'
const PERFORMERS: CleaningPerformer[] = ['SELF', 'VENDOR', 'THIRD_PARTY']
const STATUS_WORD = { PLANNED: '예정', DONE: '완료', SKIPPED: '안 함' } as const

export function CleaningEditModal({ row: r, z, fund: fundProp, recentPerformers, onClose, onChanged }: {
  row: CleaningRow
  z: 200 | 260
  /** 받은 청소비 잔고. undefined 면 완료 건을 열 때 그 방 것을 직접 받는다. */
  fund?: CleaningFundStatus | null
  recentPerformers: string[]
  onClose: () => void
  onChanged: () => void
}) {
  const uid = useId()
  const fundWhyId = `${uid}-fund-why`
  const done = r.status === 'DONE'
  // 연 순간의 버전(updatedAt). 열린 동안 부모가 목록을 다시 읽어도 이 값으로 견준다(독립 검수 권고 4·B3).
  const [opened] = useState(() => ({ updatedAt: r.updatedAt, expenseUpdatedAt: r.expenseUpdatedAt }))
  const init = {
    date: (done ? r.doneDate : r.scheduledDate) ?? '',
    reason: r.reason,
    performer: (r.performer ?? 'VENDOR') as CleaningPerformer,
    name: r.performerName ?? '',
    cost: r.cost ?? 0,
    useFund: r.fromCleaningFund,
    memo: r.memo ?? '',
  }
  const [date, setDate] = useState(init.date)
  const [reason, setReason] = useState(init.reason)
  const [reasonToList, setReasonToList] = useState(false)
  const listed = useReasonOptions('cleaningReasons')
  const [performer, setPerformer] = useState<CleaningPerformer>(init.performer)
  const [name, setName] = useState(init.name)
  const [cost, setCost] = useState(init.cost)
  const [useFund, setUseFund] = useState(init.useFund)
  const [memo, setMemo] = useState(init.memo)
  const [pending, setPending] = useState(false)
  const [localFund, setLocalFund] = useState<CleaningFundStatus | null>(null)
  useEffect(() => {
    if (!done || fundProp !== undefined) return
    getCleaningFundStatus(r.roomId).then(setLocalFund).catch(() => setLocalFund(null))
  }, [done, fundProp, r.roomId])
  const fund = fundProp !== undefined ? fundProp : localFund

  const payAsked = done && cost > 0
  const pay = useWorkPay({ kind: 'cleaning', enabled: payAsked, vendor: performer === 'SELF' ? '' : name, vendors: recentPerformers, known: r.cost ? { payMethod: r.payMethod, financialAccountId: r.financialAccountId } : null, existing: !!r.cost })
  // 부담 칸은 퇴실 청소에만 선다. 이미 부담 표식이 붙은 건은 사유를 바꿔도 끌 수 있게 남긴다.
  const fundShown = done && (reason === 'CHECKOUT' || r.fromCleaningFund)
  const fundBlocked = done && r.fromCleaningFund && reason !== 'CHECKOUT' && useFund
  const lease = (() => {
    const id = r.leaseTermId ?? (reason === 'CHECKOUT' ? fund?.checkoutLeaseTermId ?? null : null)
    return (id && fund?.leases.find(l => l.leaseTermId === id)) || null
  })()

  // 보이는 사유가 그대로면 안 바꾼 것이다. 옛 'OTHER' 행에서 '기타(직접 입력)' 을 비운 채 고른 '기타' 도 같은 '기타' 다(이행 없음).
  // 같은 글자라도 직접 입력 글에 '목록에 추가' 를 켰으면 바꾼 것이다(그 글이 목록에 오르고 기록이 맨 글자가 된다).
  const reasonChanged = cleaningReasonLabel(reason) !== cleaningReasonLabel(init.reason) || (reasonToList && reason.startsWith('기타 · '))
  const dirty = date !== init.date || reasonChanged || (done && (performer !== init.performer || name !== init.name || cost !== init.cost || useFund !== init.useFund))
    || memo !== init.memo || pay.changed
  const saveReason = done && !date ? '완료일을 골라야 저장할 수 있습니다 · 완료일을 고르면 됩니다.'
    // 까닭은 사유 칸 아래 캡션이 말한다. 여기는 푸는 법만 보탠다(§27.8 ⑤).
    : fundBlocked ? '받아둔 청소비로 부담을 끄거나 사유를 퇴실 청소로 두면 저장할 수 있습니다.'
    : null
  const subtitle = `${fmtRoomNo(r.roomNo)} · ${init.date ? `${STATUS_WORD[r.status]} ${fmtDateDot(init.date)}` : '예정일 미정'}`

  const save = async () => {
    if (pending || saveReason) return
    if (!dirty) { onClose(); return }
    // 걸린 지출이 있는데 0 으로 저장하면 서버가 연결만 끊는다. 화면이 침묵하면 그 지출이 어느 청소에도 안 걸린 고아가 된다(D3).
    if (done && r.cost != null && r.cost > 0 && cost === 0) {
      if (!(await confirmDialog({
        title: '비용을 0으로 저장할까요?',
        message: `이 청소에 걸린 지출 ${fmtWon(r.cost)}은 지워지지 않고 연결만 끊깁니다. 지출 관리에 남으니 필요 없으면 거기서 지우세요.`,
        confirmLabel: '0으로 저장', level: 'caution',
      }))) return
    }
    setPending(true)
    const release = trackSave()
    try {
      const res = await updateCleaning({
        id: r.id, expectedUpdatedAt: opened.updatedAt, expenseUpdatedAt: opened.expenseUpdatedAt, date: date || null, reason: reasonChanged ? reason : r.reason, addReasonToList: reasonChanged && reasonToList, memo,
        ...(done ? {
          // 걸린 지출이 있으면 비용은 바꿨을 때만 싣는다(지출 화면에서 먼저 고친 금액을 연 값으로 되돌리지 않게, B3).
          performer, performerName: performer === 'SELF' ? null : name, ...(r.cost && cost === init.cost ? {} : { cost }),
          fromCleaningFund: fundShown ? useFund && reason === 'CHECKOUT' && cost > 0 : false,
          ...(payAsked ? pay.payload : {}),
        } : {}),
      })
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', '청소 기록을 고쳤습니다', recordEditUndoAction(res.undo, '청소 기록', onChanged))
      onClose(); onChanged()
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release(); setPending(false) }
  }

  type Res = { ok: true; expenseKept?: boolean } | { ok: false; error: string }
  const runManage = async (fn: () => Promise<Res>, okMsg: string | ((res: { expenseKept?: boolean }) => string), undo?: { run: () => Promise<Res>; msg: string; fail: string }) => {
    const release = trackSave()
    try {
      const res = await fn()
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', typeof okMsg === 'function' ? okMsg(res) : okMsg, undo ? { action: { label: '적용취소', run: () => { void undo.run().then(u => {
        if (u.ok) { pushToast('info', undo.msg); onChanged() }
        else pushToast('error', u.error)
      }).catch(() => pushToast('error', undo.fail)) } } } : undefined)
      onClose(); onChanged()
    } catch { pushToast('error', '처리 중 통신 오류가 발생했습니다') } finally { release() }
  }
  const manage: RecordManageItem[] = [
    ...(r.status === 'PLANNED' ? [{ key: 'skip', label: '안 하기로', onSelect: async (dirty: boolean) => {
      if (!(await confirmDialog({ title: '이 청소를 안 하기로 할까요?', message: withDirtyNote("기록은 남고 상태만 바뀝니다. 관리 메뉴의 '안 함 적용취소'로 되돌릴 수 있습니다.", dirty), confirmLabel: '안 하기로', level: 'caution' }))) return
      void runManage(() => skipCleaning(r.id), '안 하기로 표시됨')
    } }] : []),
    // §16 라벨은 '적용취소' 단일. 완료와 안 함 두 곳에서 뜨니 명사를 보강한다. 지출이 남았는지는 서버가 돌려준 expenseKept 로 말한다.
    ...(r.status !== 'PLANNED' ? [{ key: 'reopen', label: r.status === 'DONE' ? '완료 적용취소' : '안 함 적용취소', onSelect: async (dirty: boolean) => {
      const what = r.status === 'DONE' ? '완료' : '안 함'
      // 확인창이 없던 항목이라 고친 상태일 때만 한 번 묻는다(권고 6).
      if (!(await confirmDiscardEdits(dirty, `${what} 적용취소`))) return
      void runManage(() => reopenCleaning(r.id), res => res.expenseKept ? `${what} 적용취소됨 · 기록된 지출은 그대로 남습니다` : `${what} 적용취소됨`)
    } }] : []),
    { key: 'delete', label: '삭제', danger: true, onSelect: async (dirty: boolean) => {
      // 지출이 걸려 있으면 문구를 가른다(결함 D1). 삭제는 청소 기록만 지우고 지출은 남긴다.
      const linkedCost = r.cost != null && r.cost > 0 ? r.cost : null
      if (!(await confirmDialog({
        title: '이 청소 기록을 삭제할까요?',
        message: withDirtyNote(linkedCost != null
          ? `기록이 목록에서 사라집니다. 함께 기록된 지출 ${fmtWon(linkedCost)}은 지출 관리에 그대로 남습니다.`
          : '기록이 목록에서 사라집니다.', dirty),
        confirmLabel: '삭제', level: 'danger',
      }))) return
      void runManage(() => deleteCleaning(r.id), '삭제됨', { run: () => restoreCleaning(r.id), msg: '청소 기록을 복원했습니다', fail: '복원 중 통신 오류가 발생했습니다' })
    } },
  ]

  return (
    <RecordEditShell title="청소 수정" subtitle={subtitle} z={z} dirty={dirty} pending={pending} saveReason={saveReason}
      onSave={save} onClose={onClose} manage={manage}>
      <div className="space-y-1.5">
        <p className={LABEL_CLS}>{done ? '완료일' : '예정일'}</p>
        {/* 완료 건은 지나간 일이라 오늘까지(서버도 거부). 바꾸면 걸린 지출 날짜도 따라간다. 예정 건은 비울 수 있다(날짜 없는 예정). */}
        <DatePicker value={date} onChange={setDate} maxDate={done ? kstYmdStr() : undefined} className={DATE_CLS} />
        {done && r.cost != null && r.cost > 0 && date !== init.date && (
          <p className="text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep">걸린 지출 날짜도 이 날로 바뀝니다. 카드로 낸 지출이면 청구월이 달라질 수 있습니다.</p>
        )}
      </div>
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-reason`}>사유</label>
        <CategorySelect addMode="ask" id={`${uid}-reason`} ariaLabel="청소 사유" value={reason} onChange={setReason}
          options={[...CLEANING_REASON_CODES, ...listed]} getLabel={cleaningReasonLabel}
          placeholder="사유를 직접 입력하세요" addToList={reasonToList} onAddToListChange={setReasonToList}
          className={INPUT_CLS} />
        {fundBlocked && <WhyCaption id={fundWhyId}>받아둔 청소비로 부담한 건이라 퇴실 청소 밖으로 바꿀 수 없습니다 · 아래 받아둔 청소비로 부담을 끄면 됩니다.</WhyCaption>}
      </div>
      {done && (
        <>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>수행자</p>
            <div role="radiogroup" aria-label="청소 수행자" className="flex gap-1.5 flex-wrap">
              {PERFORMERS.map(pf => (
                <button key={pf} type="button" role="radio" aria-checked={performer === pf}
                  onClick={() => { setPerformer(pf); if (pf !== 'SELF' && !name) setName(recentPerformers[0] ?? '') }}
                  className={`rounded-lg px-3 py-2 text-sm ${FOCUS_RING}`}
                  style={performer === pf
                    ? { background: 'var(--coral)', color: 'var(--on-solid)', border: '1px solid transparent' }
                    : { background: 'var(--canvas)', color: 'var(--seg-ink-off)', border: '1px solid var(--warm-border)' }}>
                  {CLEANING_PERFORMER_LABEL[pf]}
                </button>
              ))}
            </div>
            {/* 직접 청소는 이름 칸이 없다. 저장하면 이름도 비운다(안 보이는 값을 저장하지 않는다). */}
            {performer !== 'SELF' && (recentPerformers.length > 0 ? (
              <CategorySelect value={name} onChange={setName} options={recentPerformers} emptyLabel="업체·사람 이름 (선택)"
                placeholder="업체·사람 이름" ariaLabel="업체·사람 이름" className={INPUT_CLS} />
            ) : (
              <input type="text" value={name} onChange={e => setName(e.target.value)} placeholder="업체·사람 이름 (선택)" aria-label="업체·사람 이름" className={INPUT_CLS} />
            ))}
          </div>
          <div className="space-y-1.5">
            <p className={LABEL_CLS}>비용</p>
            <MoneyInput value={cost} onChange={setCost} />
            <p className="text-[0.65625rem] leading-relaxed text-[var(--warm-muted)] break-keep">
              {r.cost ? '걸린 지출에서 바꾼 칸(날짜·금액·업체·결제수단)만 함께 고칩니다. 0으로 두면 지출은 남기고 연결만 끊습니다.' : '적으면 지출이 함께 기록되어 그 방 비용에 잡힙니다.'}
            </p>
          </div>
          {payAsked && pay.ready && (
            <PayMethodField methods={pay.methods} accounts={pay.accounts} payMethod={pay.payMethod} accountId={pay.accountId} onChange={pay.onChange} />
          )}
          {fundShown && (
            <div className="space-y-1">
              <label className="flex items-center gap-2 cursor-pointer min-h-[44px]">
                <input type="checkbox" checked={useFund} onChange={e => setUseFund(e.target.checked)} aria-describedby={fundBlocked ? fundWhyId : undefined}
                  className="w-4 h-4 accent-[var(--coral)]" />
                <span className="text-sm text-[var(--warm-dark)]">받아둔 청소비로 부담</span>
              </label>
              {lease && lease.realizedIncome > 0 ? (
                <p className="text-[0.65625rem] text-[var(--warm-muted)] num pl-6">이 퇴실 건 받은 청소비 {fmtWon(lease.realizedIncome)}, 남은 {fmtWon(Math.max(0, lease.realizedIncome - lease.fundedExpenseTotal))}.</p>
              ) : lease && lease.contractFee > 0 ? (
                <p className="text-[0.65625rem] text-[var(--warm-muted)] num pl-6">정산 전, 계약 청소비 {fmtWon(lease.contractFee)}.</p>
              ) : null}
            </div>
          )}
        </>
      )}
      <div className="space-y-1.5">
        <label className={LABEL_CLS} htmlFor={`${uid}-memo`}>메모 (선택)</label>
        <input id={`${uid}-memo`} type="text" value={memo} onChange={e => setMemo(e.target.value)} maxLength={500} placeholder="메모 (선택)" className={INPUT_CLS} />
      </div>
    </RecordEditShell>
  )
}
