'use client'
// 고정지출 '지출 기록' 모달 정본 — 지출관리 카드와 대시보드 알림이 함께 쓰는 공용 폼.

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Modal } from '@/components/ui/Modal'
import { Btn } from '@/components/ui/Btn'
import { Badge } from '@/components/ui/Badge'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { fmtWon } from '@/lib/fmtMoney'
import { kstYmdStr } from '@/lib/kstDate'
import { effectiveRecurringAmount } from '@/lib/recurringEstimate'
import {
  recordRecurringExpense, setRecurringPendingAmount, clearRecurringPendingAmount,
  type RecurringExpenseWithStatus,
} from './actions'

// 모달이 필요로 하는 계좌 필드만 — Prisma FinancialAccount·FinanceClient 타입 모두 대입 가능.
export type RecModalAccount = { id: string; type: string; brand: string; alias: string | null }

// 계좌 표시명 — 별칭이 있으면 '브랜드 (별칭)'. 지출 폼 공통(FinanceClient 도 이걸 쓴다).
export function accName(a: { brand: string; alias: string | null } | null) {
  if (!a) return ''
  return a.alias ? `${a.brand} (${a.alias})` : a.brand
}

// 등록된 선불 계정 브랜드를 결제수단 목록에 자동 병합 — 지출 폼 공통 파생.
export function effectivePayMethods(
  paymentMethods: string[],
  accounts: { type: string; brand: string; alias: string | null }[],
) {
  const methods = [...paymentMethods]
  for (const acc of accounts.filter(a => a.type === 'PREPAID')) {
    const name = acc.brand ?? accName(acc)
    if (name && !methods.includes(name)) methods.push(name)
  }
  return methods
}

export function RecurringExpenseRecordModal({
  rec, financialAccounts, paymentMethods, defaultDate, onClose, onDone,
}: {
  rec: RecurringExpenseWithStatus
  financialAccounts: RecModalAccount[]
  paymentMethods: string[]
  /** 예정 행에서 열 때 그 행의 납부 예정일('YYYY-MM-DD')을 프리필 — 없으면 오늘(대시보드 알림 등) */
  defaultDate?: string
  onClose: () => void
  /** 지출 기록 성공 시에만 호출 — 닫기·refresh·토스트는 caller 몫 */
  onDone: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dirty, setDirty] = useState(false)   // v2.0 §12 — 지출 기록 폼 입력 보호
  // #1 관리비 묶음: 기록 시 세부항목별 금액(변동은 편집). 비어있으면 단일 금액 모드.
  const [items, setItems] = useState(() => rec.items.map(it => ({ name: it.name, amount: it.amount, isVariable: it.isVariable })))
  // 예약 금액이 있으면 우선 prefill, 없으면 평균 또는 기본 금액. 세부항목이 있으면 그 합이 우선.
  const [amount, setAmount] = useState(() => {
    const sum = rec.items.reduce((s, it) => s + it.amount, 0)
    return sum > 0 ? sum : effectiveRecurringAmount(rec)
  })
  const [date, setDate]           = useState(() => defaultDate ?? kstYmdStr())
  const [memo, setMemo]           = useState(rec.memo ?? '')
  // #6: 가장 최근 실제 기록의 결제수단·계좌를 기본값으로(지난달 처리 방식 자동 대기)
  const [payMethod, setPayMethod] = useState(rec.lastPayMethod ?? rec.payMethod ?? '계좌이체')
  const [accId, setAccId]         = useState(rec.lastFinancialAccountId ?? rec.financialAccountId ?? '')
  const [error, setError]         = useState('')

  const cardAccounts    = financialAccounts.filter(a => a.type === 'CREDIT_CARD' || a.type === 'DEBIT_CARD')
  const bankAccounts    = financialAccounts.filter(a => a.type === 'BANK_ACCOUNT')
  const prepaidAccounts = financialAccounts.filter(a => a.type === 'PREPAID')
  const payMethodOpts   = effectivePayMethods(paymentMethods, financialAccounts)

  return (
    <Modal open width="sm" dirty={dirty}
      onClose={() => { setError(''); setDirty(false); onClose() }}
      title="지출 기록" subtitle={rec.title}>
      <div onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
        {/* 폼 */}
        <div className="space-y-3">
          {items.length > 0 ? (
            <>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-[var(--warm-mid)]">날짜</label>
                <DatePicker value={date} onChange={setDate}
                  className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
              </div>
              {/* #1 관리비 세부항목 — 변동 항목만 편집, 고정은 표시. 합계 자동. */}
              <div className="space-y-1.5 rounded-xl border border-[var(--warm-border)] bg-[var(--cream-soft)] p-3">
                <p className="text-[0.6875rem] font-medium text-[var(--warm-mid)]">세부항목 ({items.length})</p>
                {items.map((it, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <span className="text-xs text-[var(--warm-dark)] flex-1 truncate">
                      {it.name}
                      {it.isVariable
                        ? <Badge tone="pale-amber" className="ml-1">변동</Badge>
                        : <span className="ml-1 text-[0.65625rem] text-[var(--warm-muted)]">고정</span>}
                    </span>
                    {it.isVariable ? (
                      <div className="w-28">
                        <MoneyInput value={it.amount} onChange={v => {
                          setItems(prev => {
                            const next = prev.map((p, j) => j === i ? { ...p, amount: v } : p)
                            setAmount(next.reduce((s, p) => s + p.amount, 0))
                            return next
                          })
                        }} placeholder="0원" />
                      </div>
                    ) : (
                      <span className="text-xs num text-[var(--warm-dark)] w-28 text-right pr-1">{fmtWon(it.amount)}</span>
                    )}
                  </div>
                ))}
                <div className="flex items-center justify-between border-t border-[var(--warm-border)] pt-1.5 mt-1">
                  <span className="text-xs font-semibold text-[var(--warm-dark)]">합계</span>
                  <span className="text-sm font-bold num text-[var(--coral)]">{fmtWon(amount)}</span>
                </div>
              </div>
            </>
          ) : (
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">날짜</label>
              <DatePicker value={date} onChange={setDate}
                className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]" />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">
                금액
                {rec.historicalAvg && (
                  <span className="ml-1 text-[var(--info-fg)] text-[0.65625rem]">평균 {fmtWon(rec.historicalAvg)}</span>
                )}
              </label>
              <MoneyInput value={amount} onChange={v => setAmount(v)} placeholder="0원" />
            </div>
          </div>
          )}
          {/* 카테고리 — 고정지출 설정값이라 읽기 전용. 채워진 값이므로 placeholder 회색이 아닌 본문색. */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--warm-mid)]">카테고리</label>
            <div className="w-full bg-[var(--cream-soft)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)]">
              {rec.category}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">결제수단</label>
              <select value={payMethod} onChange={e => { setPayMethod(e.target.value); setAccId('') }}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                {payMethodOpts.map(m => <option key={m} value={m}>{m}</option>)}
                {!payMethodOpts.includes('계좌이체') && <option value="계좌이체">계좌이체</option>}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">메모</label>
              <input type="text" value={memo} onChange={e => setMemo(e.target.value)}
                placeholder="선택 입력"
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
            </div>
          </div>
          {payMethod === '계좌이체' && bankAccounts.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">출금 계좌</label>
              <select value={accId} onChange={e => setAccId(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                <option value="">선택 안함</option>
                {bankAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
              </select>
            </div>
          )}
          {(payMethod === '신용카드' || payMethod === '체크카드') && cardAccounts.length > 0 && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">카드 선택</label>
              <select value={accId} onChange={e => setAccId(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                <option value="">선택 안함</option>
                {cardAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
              </select>
            </div>
          )}
          {prepaidAccounts.length > 0 && prepaidAccounts.some(a => payMethod === a.brand || payMethod === accName(a)) && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-[var(--warm-mid)]">선불 계정</label>
              <select value={accId} onChange={e => setAccId(e.target.value)}
                className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
                <option value="">선택 안함</option>
                {prepaidAccounts.map(a => <option key={a.id} value={a.id}>{accName(a)}</option>)}
              </select>
            </div>
          )}
          {error && <p className="text-[var(--danger-fg)] text-xs">{error}</p>}
          {rec.pendingAmount != null && (
            <p className="text-[0.65625rem] text-[var(--warm-muted)] -mt-1">
              예약된 금액 {fmtWon(rec.pendingAmount)}이 자동 입력되었습니다.
              <button type="button"
                onClick={() => {
                  startTransition(async () => {
                    await clearRecurringPendingAmount({ recurringExpenseId: rec.id })
                    onClose(); router.refresh()
                  })
                }}
                className="ml-1 underline text-[var(--coral)]">예약 취소</button>
            </p>
          )}
          <div className="flex flex-col gap-2 pt-1">
            <div className="flex gap-2">
              <Btn type="button" variant="secondary" size="md" className="flex-1" onClick={() => { setError(''); onClose() }}>취소</Btn>
              <Btn type="button" variant="primary" size="md" className="flex-1 font-semibold"
                disabled={isPending || !date || amount <= 0}
                onClick={() => {
                  setError('')
                  startTransition(async () => {
                    const res = await recordRecurringExpense({
                      recurringExpenseId: rec.id,
                      amount,
                      date,
                      payMethod: payMethod || undefined,
                      financialAccountId: accId || undefined,
                      memo: memo || undefined,
                      breakdown: items.length > 0 ? items : undefined,
                    })
                    if (!res.ok) { setError(res.error); return }
                    onDone()
                  })
                }}>
                {isPending ? '기록 중…' : '지출로 기록 (납부 완료)'}
              </Btn>
            </div>
            {/* 금액만 저장 — 결제일 전에 금액만 미리 입력해 두는 모드. 지출은 생성하지 않음(정산 안 함). */}
            <button type="button"
              disabled={isPending || amount <= 0}
              onClick={() => {
                setError('')
                startTransition(async () => {
                  const res = await setRecurringPendingAmount({
                    recurringExpenseId: rec.id,
                    amount,
                  })
                  if (!res.ok) { setError(res.error); return }
                  onClose(); router.refresh()
                })
              }}
              className="w-full px-4 py-2.5 bg-[var(--canvas)] border border-dashed border-[var(--coral)]/50 text-[var(--coral)] text-xs font-medium rounded-lg hover:bg-[var(--coral)]/5 disabled:opacity-60 transition-colors">
              금액만 저장 (아직 납부 전)
            </button>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] text-center leading-relaxed">
              ‘지출로 기록’은 바로 정산 처리돼요. 금액만 미리 적어둘 땐 아래 버튼을 쓰세요.
            </p>
          </div>
        </div>
      </div>
    </Modal>
  )
}
