'use client'

// 납부 내역 — 표시 + 편집 + 삭제. 자체 fetch (getPaymentsByLease).
// 편집 가능 항목: 금액·납부일·납부방법·메모·귀속월. 보증금 record 는 귀속월 변경 불가.
// 양도인 record 는 양도인 색 표시.

import { useEffect, useState, useTransition } from 'react'
import { fmtDateDot as fmtDate } from '@/lib/fmtDate'
import { fmtWon } from '@/lib/fmtMoney'
import { SkeletonRows } from '@/components/ui/Skeleton'
import {
  getPaymentsByLease, getTargetMonthOptions, updatePayment, deletePayment, restorePayment, setCashReceiptIssued,
} from '@/app/(app)/rooms/actions'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'
import { withSave, trackSave, pushToast } from '@/lib/saveStatus'
import { confirmDialog } from '@/components/ui/ConfirmDialog'

type Record = Awaited<ReturnType<typeof getPaymentsByLease>>['records'][number]
type TmOption = Awaited<ReturnType<typeof getTargetMonthOptions>>[number]


export function PaymentRecordList({ leaseTermId, targetMonth, canEdit, onChange, reloadSignal }: {
  leaseTermId: string
  targetMonth: string
  canEdit: boolean
  /** 편집·삭제 후 부모가 settlement 재조회. */
  onChange?: () => void
  /** 부모(PaymentBody)에서 수납 등록 등으로 값이 바뀌면 증가 → 리스트 재fetch 트리거. */
  reloadSignal?: number
}) {
  const [records, setRecords] = useState<Record[] | null>(null)
  const [acqDate, setAcqDate] = useState<Date | null>(null)
  const [tmOptions, setTmOptions] = useState<TmOption[]>([])
  const [pending, startTransition] = useTransition()

  // 편집 모드 state
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editAmount, setEditAmount]       = useState<number>(0)
  const [editDate, setEditDate]           = useState<string>('')
  const [editPayMethod, setEditPayMethod] = useState<string>('')
  const [editMemo, setEditMemo]           = useState<string>('')
  const [editTargetMonth, setEditTargetMonth] = useState<string>('')
  const [editCashReceipt, setEditCashReceipt] = useState(false)   // 현금영수증 발행 표시(오류신고 2bd8befa)

  const reload = async () => {
    const { records, acquisitionDate } = await getPaymentsByLease(leaseTermId, targetMonth)
    setRecords(records)
    setAcqDate(acquisitionDate ? new Date(acquisitionDate) : null)
  }
  useEffect(() => { reload() /* eslint-disable-next-line */ }, [leaseTermId, targetMonth, reloadSignal])

  const isPreAcq = (p: Record) => !!(acqDate && new Date(p.payDate) < acqDate)

  const startEdit = (p: Record) => {
    setEditingId(p.id)
    setEditAmount(p.actualAmount)
    setEditDate(kstYmdStr(new Date(p.payDate)))
    setEditPayMethod(p.payMethod ?? '')
    setEditMemo(p.memo ?? '')
    setEditTargetMonth(p.targetMonth)
    setEditCashReceipt(!!p.cashReceiptIssuedAt)
    if (!p.isDeposit) {
      getTargetMonthOptions(leaseTermId, targetMonth).then(setTmOptions).catch(() => {})
    }
  }

  const handleSaveEdit = () => {
    if (!editingId) return
    startTransition(async () => {
      const res = await withSave(() => updatePayment(editingId, {
        actualAmount: editAmount,
        payDate:      editDate,
        payMethod:    editPayMethod,
        memo:         editMemo || undefined,
        targetMonth:  editTargetMonth || undefined,
        cashReceiptIssued: editCashReceipt,
      }), { success: '수납 기록 수정됨' })
      if (!res.ok) return
      await reload()
      setEditingId(null)
      onChange?.()
    })
  }

  const handleDelete = async (p: Record) => {
    const parts = [fmtDate(p.payDate), fmtWon(p.actualAmount), p.isDeposit ? '보증금' : `귀속 ${Number(p.targetMonth.slice(5))}월`]
    if (!(await confirmDialog({ title: '이 수납 기록을 삭제할까요?', message: parts.join(' · '), level: 'danger', confirmLabel: '삭제' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await deletePayment(p.id)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '수납 기록 삭제됨', {
          action: { label: '적용취소', run: () => { void restorePayment(p.id).then(r => { if (r.ok) { reload(); onChange?.() } else pushToast('error', r.error) }) } },
        })
        await reload()
        onChange?.()
      } catch (err) {
        pushToast('error', (err as Error).message ?? '삭제 실패')
      } finally { release() }
    })
  }

  // 현금영수증 원터치 토글 — 수정 폼에 들어가지 않고 발행 표시(오류신고 c0936f89). 적용취소는 원래 시각 복원.
  const handleToggleCashReceipt = (p: Record) => {
    startTransition(async () => {
      const next = !p.cashReceiptIssuedAt
      const res = await setCashReceiptIssued(p.id, next)
      if (!res.ok) { pushToast('error', res.error); return }
      pushToast('success', next ? '현금영수증 발행으로 표시했습니다' : '현금영수증 발행 표시를 해제했습니다', {
        action: { label: '적용취소', run: () => { void setCashReceiptIssued(p.id, res.prevIssuedAt != null, res.prevIssuedAt).then(r => {
          if (r.ok) { reload(); onChange?.() } else pushToast('error', r.error)
        }).catch(() => pushToast('error', '되돌리기 중 통신 오류가 발생했습니다')) } },
      })
      await reload()
      onChange?.()
    })
  }

  if (records === null) return <SkeletonRows rows={2} className="py-1" />
  if (records.length === 0) return <p className="text-xs text-[var(--warm-muted)] py-2">이 달 납부 기록이 없습니다.</p>

  return (
    <div className="space-y-1.5">
      <p className="text-xs font-semibold text-[var(--warm-mid)]">납부 내역 (편집·삭제)</p>
      {records.map((p, idx) => {
        const prevOwner = !p.isDeposit && (isPreAcq(p) || p.isPrevOwner)
        // 화면에 표시되는 "회차"는 viewMonth 안에서 payDate 시간 순. records가 이미 payDate asc 정렬돼 옴.
        // DB seqNo는 귀속월 별로 매겨져서 사용자가 보는 시간 순서와 안 맞을 수 있음 (사용자 피드백 2026-05-31).
        const displaySeq = idx + 1
        if (editingId === p.id) {
          return (
            <div key={p.id} className="rounded-xl border border-[var(--coral)] bg-[var(--canvas)] px-3 py-2.5 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">금액</p>
                  <input type="text" inputMode="numeric" value={editAmount.toLocaleString()}
                    onChange={e => setEditAmount(Number(e.target.value.replace(/[^0-9]/g, '')))}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                </div>
                <div className="space-y-1">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부일</p>
                  <DatePicker value={editDate} onChange={setEditDate}
                    className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">납부방법</p>
                  <select value={editPayMethod} onChange={e => setEditPayMethod(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {!['계좌이체', '현금', '신용카드', '결제선생', '기타'].includes(editPayMethod) && editPayMethod && (
                      <option value={editPayMethod}>{editPayMethod}</option>
                    )}
                    <option value="계좌이체">계좌이체</option>
                    <option value="현금">현금</option>
                    <option value="신용카드">신용카드</option>
                    <option value="결제선생">결제선생</option>
                    <option value="기타">기타</option>
                  </select>
                </div>
                <div className="space-y-1">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">메모</p>
                  <input type="text" value={editMemo} onChange={e => setEditMemo(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
                </div>
              </div>
              {!p.isDeposit && (
                <div className="space-y-1">
                  <p className="text-[0.65625rem] text-[var(--warm-muted)]">귀속월 (이 record가 인식되는 월)</p>
                  <select value={editTargetMonth} onChange={e => setEditTargetMonth(e.target.value)}
                    className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-2 py-1.5 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                    {!tmOptions.some(o => o.month === p.targetMonth) && (
                      <option value={p.targetMonth}>
                        {Number(p.targetMonth.split('-')[0])}년 {Number(p.targetMonth.split('-')[1])}월분 (현재)
                      </option>
                    )}
                    {tmOptions.map(o => {
                      const [y, m] = o.month.split('-')
                      const tag = o.status === 'paid' ? '완납'
                        : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${fmtWon(o.expectedAmount)}`
                        : o.status === 'future' ? '향후' : '미수'
                      return <option key={o.month} value={o.month}>{Number(y)}년 {Number(m)}월분 · {tag}</option>
                    })}
                  </select>
                </div>
              )}
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={editCashReceipt} onChange={e => setEditCashReceipt(e.target.checked)}
                  className="w-3.5 h-3.5 accent-[var(--coral)]" />
                <span className="text-[0.65625rem] text-[var(--warm-dark)]">현금영수증 발행함</span>
              </label>
              <div className="flex gap-2 justify-end">
                <Btn variant="secondary" size="sm" onClick={() => setEditingId(null)}>취소</Btn>
                <Btn variant="primary" size="sm" onClick={handleSaveEdit} disabled={pending}>저장</Btn>
              </div>
            </div>
          )
        }
        return (
          <div key={p.id}
            className={`rounded-sm px-3 py-2.5 space-y-1.5 ${
              p.isDeposit ? 'bg-[var(--deposit-bg)] border border-[var(--deposit-ring)]' :
              prevOwner ? 'bg-[var(--info-bg)] border border-[var(--info-ring)]' : 'bg-[var(--canvas)]'
            }`}>
            {/* 줄1: 회차·날짜·방법 + 금액(우측, 안 줄임) */}
            <div className="flex items-baseline justify-between gap-2">
              <p className={`text-xs ${p.isDeposit ? 'text-[var(--deposit-fg)]' : prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-mid)]'}`}>
                {displaySeq}회차 · {fmtDate(p.payDate)} · {p.payMethod ?? '—'}
              </p>
              <span className={`text-sm font-semibold whitespace-nowrap ${p.isDeposit ? 'text-[var(--deposit-fg)]' : prevOwner ? 'text-[var(--info-fg)]' : 'text-[var(--warm-dark)]'}`}>
                {fmtWon(p.actualAmount)}
              </span>
            </div>
            {/* 줄2: 뱃지들 + 메모 + 액션 버튼 */}
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-1 flex-wrap">
                {p.isDeposit && <span className="text-[0.65625rem] font-semibold bg-[var(--deposit-bg)] text-[var(--deposit-fg)] rounded px-1.5 py-0.5">보증금</span>}
                {prevOwner && <span className="text-[0.65625rem] font-semibold bg-[var(--info-bg)] text-[var(--info-fg)] rounded px-1.5 py-0.5">양도인</span>}
                {!p.isDeposit && (
                  <span className={`text-[0.65625rem] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap ${
                    p.targetMonth === targetMonth
                      ? 'bg-[var(--cream-2)] text-[var(--warm-mid)]'
                      : 'bg-[var(--badge-await-bg)] text-[var(--badge-await-fg)]'
                  }`}>
                    귀속 {Number(p.targetMonth.slice(5))}월
                    {p.targetMonth < targetMonth && ' (지난 미납분)'}
                    {p.targetMonth > targetMonth && ' (선납)'}
                  </span>
                )}
                {/* 현금영수증 — 편집 가능하면 원터치 토글 칩(미발행도 어포던스), 아니면 발행 시에만 표시 */}
                {canEdit ? (
                  <button type="button" disabled={pending} onClick={() => handleToggleCashReceipt(p)}
                    className={`text-[0.65625rem] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap transition-colors disabled:opacity-50 ${
                      p.cashReceiptIssuedAt
                        ? 'bg-[var(--success-bg)] text-[var(--success-fg)]'
                        : 'border border-[var(--warm-border)] text-[var(--warm-muted)] hover:text-[var(--warm-dark)] hover:border-[var(--warm-mid)]'
                    }`}>
                    {p.cashReceiptIssuedAt ? '현금영수증' : '현금영수증 미발행'}
                  </button>
                ) : (
                  p.cashReceiptIssuedAt && <span className="text-[0.65625rem] font-semibold bg-[var(--success-bg)] text-[var(--success-fg)] rounded px-1.5 py-0.5 whitespace-nowrap">현금영수증</span>
                )}
                {p.memo && !p.isDeposit && <span className="text-[0.6875rem] text-[var(--coral)]">· {p.memo}</span>}
              </div>
              {canEdit && (
                <div className="flex gap-1.5">
                  <button onClick={() => startEdit(p)}
                    className="text-[0.65625rem] font-medium px-2 py-1 rounded-lg border transition-colors"
                    style={{ borderColor: 'var(--warm-border)', color: 'var(--warm-mid)' }}>
                    수정
                  </button>
                  <button onClick={() => handleDelete(p)}
                    className="text-[0.65625rem] font-medium px-2 py-1 rounded-lg border border-[var(--danger-ring)] text-[var(--danger-fg)] transition-colors">
                    삭제
                  </button>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
