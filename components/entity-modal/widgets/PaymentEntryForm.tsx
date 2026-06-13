'use client'

// 수납 등록 — 일반 (FIFO 자동 충당) + 보증금/청소비 분리 모드.
// 셸의 수납 full 모드와 RoomsClient 양쪽 재사용. RoomsClient 의 handleSavePayment·UI 그대로 이주.
// FIFO 알고리즘은 savePayment 서버액션 내부 (변경 X). 위젯은 입력+호출+토스트.

import { useEffect, useState, useTransition } from 'react'
import {
  savePayment, saveDepositPayment, getTargetMonthOptions, type SavePaymentResult,
} from '@/app/(app)/rooms/actions'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DatePicker } from '@/components/ui/DatePicker'
import { Btn } from '@/components/ui/Btn'
import { kstYmdStr } from '@/lib/kstDate'
import { fmtKorMoney } from '@/lib/fmtMoney'
import { trackSave, pushToast } from '@/lib/saveStatus'

type Room = {
  leaseTermId: string
  tenantId: string | null
  expected: number
  balance: number       // 음수면 미수, 양수면 선납 — 미수 보충 자동 프리필용
  depositAmount: number
  cleaningFee: number
  moveInDate: string | null
}

type TmOption = Awaited<ReturnType<typeof getTargetMonthOptions>>[number]

export function PaymentEntryForm({ room, targetMonth, onSaved, onCancel }: {
  room: Room
  targetMonth: string
  /** 저장 성공 후 호출 — 부모가 settlement/records 재조회. */
  onSaved?: () => void
  onCancel?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [tmOptions, setTmOptions] = useState<TmOption[]>([])
  const [forcedTm, setForcedTm] = useState<'auto' | string>('auto')
  // 자동 프리필 — 미수가 있으면(balance<0) 그 절댓값(이번 달 보충), 아니면 expected.
  // 사용자가 직접 바꾸면 그대로 유지. room 이 바뀌면 다시 프리필.
  const [payAmount, setPayAmount] = useState<number>(room.balance < 0 ? -room.balance : room.expected)
  useEffect(() => {
    setPayAmount(room.balance < 0 ? -room.balance : room.expected)
  }, [room.balance, room.expected])
  const [payDateVal, setPayDateVal] = useState<string>(kstYmdStr())
  const [payMethod, setPayMethod] = useState<string>('계좌이체')
  const [memo, setMemo] = useState<string>('')
  const [isDepositMode, setIsDepositMode] = useState(false)
  const [isCleaningFeeMode, setIsCleaningFeeMode] = useState(false)
  const [showSpecialModes, setShowSpecialModes] = useState(false) // 보증금/청소비 분리 모드 토글 (기본 숨김)
  const [error, setError] = useState<string>('')

  // lastPayMethod localStorage 동기화
  useEffect(() => {
    const last = typeof window !== 'undefined' ? localStorage.getItem('stayeum-last-pay-method') : null
    if (last) setPayMethod(last)
  }, [])

  // 귀속월 옵션 fetch
  useEffect(() => {
    let active = true
    getTargetMonthOptions(room.leaseTermId, targetMonth).then(opts => { if (active) setTmOptions(opts) })
    return () => { active = false }
  }, [room.leaseTermId, targetMonth])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!room.tenantId) { setError('입주자 정보가 없습니다.'); return }
    setError('')
    startTransition(async () => {
      const release = trackSave()
      try {
        if (isDepositMode || isCleaningFeeMode) {
          await saveDepositPayment({
            leaseTermId:   room.leaseTermId,
            tenantId:      room.tenantId!,
            targetMonth,
            depositAmount: isCleaningFeeMode ? room.cleaningFee : room.depositAmount,
            rentAmount:    room.expected,
            totalPaid:     payAmount,
            payDate:       payDateVal,
            payMethod,
            memo:          isCleaningFeeMode ? (memo || '청소비') : (memo || undefined),
          })
        } else {
          const result: SavePaymentResult = await savePayment({
            leaseTermId:    room.leaseTermId,
            tenantId:       room.tenantId!,
            targetMonth,
            expectedAmount: room.expected,
            actualAmount:   payAmount,
            payDate:        payDateVal,
            payMethod,
            memo,
            forcedTargetMonth: forcedTm === 'auto' ? undefined : forcedTm,
          })
          if (result.allocations.length > 0) {
            const otherMonths = result.allocations.filter(a => a.targetMonth !== result.inputMonth)
            if (otherMonths.length > 0) {
              const summary = otherMonths.map(a => `${Number(a.targetMonth.slice(5))}월분 ${a.amount.toLocaleString()}원`).join(', ')
              pushToast('success', `자동 분배: ${summary} (미수가 가장 오래된 월부터 충당)`)
            }
          }
        }
        if (payMethod) localStorage.setItem('stayeum-last-pay-method', payMethod)
        pushToast('success', isDepositMode ? '보증금 수납됨' : isCleaningFeeMode ? '청소비 수납됨' : '월 이용료 수납됨')
        // 폼 리셋
        setPayAmount(0); setForcedTm('auto'); setIsDepositMode(false); setIsCleaningFeeMode(false); setMemo('')
        setPayDateVal(kstYmdStr())
        onSaved?.()
      } catch (err) {
        const msg = (err as Error).message ?? '저장 실패'
        setError(msg); pushToast('error', msg)
      } finally { release() }
    })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 border-t border-[var(--warm-border)] pt-3 mt-1">
      <p className="text-xs font-semibold text-[var(--coral)]">수납 등록</p>
      {!isDepositMode && !isCleaningFeeMode && (
        <>
          <p className="text-[0.625rem] text-[var(--warm-muted)] bg-[var(--canvas)] rounded-lg px-2.5 py-1.5 leading-relaxed">
            기본은 미수가 있는 가장 오래된 월부터 자동 충당(FIFO·발생주의)입니다. 특정 월로 귀속시키려면 아래에서 직접 선택하세요.
          </p>
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">귀속월</label>
            <select value={forcedTm} onChange={e => setForcedTm(e.target.value as 'auto' | string)}
              className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
              <option value="auto">자동 (FIFO · 가장 오래된 미수월부터)</option>
              {tmOptions.map(o => {
                const [y, m] = o.month.split('-')
                const tag = o.status === 'paid' ? '완납'
                  : o.status === 'partial' ? `일부 ${o.paidAmount.toLocaleString()}/${o.expectedAmount.toLocaleString()}원`
                  : o.status === 'future' ? '향후' : '미수'
                return <option key={o.month} value={o.month}>{Number(y)}년 {Number(m)}월분 — {tag}</option>
              })}
            </select>
            {forcedTm !== 'auto' && (
              <p className="text-[0.625rem] text-amber-600 leading-relaxed">
                FIFO 우회 — 입력 금액이 한 달 이용료를 초과하면 그 다음 달로 이월됩니다.
              </p>
            )}
          </div>
        </>
      )}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className="text-xs text-[var(--warm-muted)]">날짜</label>
          <DatePicker value={payDateVal} onChange={setPayDateVal}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-xl px-3 py-2 text-sm text-[var(--warm-dark)]" />
        </div>
        <div className="space-y-1">
          <label className="text-xs text-[var(--warm-muted)]">금액</label>
          <MoneyInput value={payAmount} onChange={setPayAmount} placeholder="0원" />
        </div>
      </div>
      {/* 보증금/청소비 수납 — 발견성 위해 또렷한 버튼으로. (입주 첫 달 주로 사용) */}
      {(room.depositAmount > 0 || room.cleaningFee > 0) && !showSpecialModes && !isDepositMode && !isCleaningFeeMode && (
        <button type="button" onClick={() => setShowSpecialModes(true)}
          className="w-full text-xs font-medium text-[var(--coral)] border border-[var(--coral)]/35 bg-[var(--coral)]/5 rounded-lg px-3 py-2 hover:bg-[var(--coral)]/10 transition-colors">
          + {room.depositAmount > 0 ? '보증금' : ''}{room.depositAmount > 0 && room.cleaningFee > 0 ? '·' : ''}{room.cleaningFee > 0 ? '청소비' : ''} 수납하기
          {room.depositAmount > 0 && <span className="text-[var(--warm-muted)] font-normal"> · 보증금 {fmtKorMoney(room.depositAmount)}</span>}
        </button>
      )}
      {room.depositAmount > 0 && (showSpecialModes || isDepositMode) && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isDepositMode}
              onChange={e => {
                const checked = e.target.checked
                setIsDepositMode(checked)
                if (checked) {
                  setIsCleaningFeeMode(false)
                  setPayAmount(room.depositAmount + room.expected)
                  setPayDateVal(room.moveInDate ?? kstYmdStr())
                } else {
                  setPayDateVal(kstYmdStr())
                }
              }}
              className="w-4 h-4 accent-[var(--coral)]" />
            <span className="text-xs text-[var(--warm-mid)]">보증금 수납 ({fmtKorMoney(room.depositAmount)})</span>
          </label>
          {isDepositMode && (
            payAmount > room.depositAmount ? (
              <p className="text-xs text-emerald-600">
                보증금 {fmtKorMoney(room.depositAmount)} + 이용료 {fmtKorMoney(payAmount - room.depositAmount)} = {fmtKorMoney(payAmount)}
              </p>
            ) : (
              <p className="text-xs text-[var(--warm-muted)]">
                보증금만 수납 (이용료 포함하려면 금액을 늘리세요 — 초과분은 {targetMonth} 이용료로 처리)
              </p>
            )
          )}
        </div>
      )}
      {room.depositAmount === 0 && room.cleaningFee > 0 && (showSpecialModes || isCleaningFeeMode) && (
        <div className="space-y-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={isCleaningFeeMode}
              onChange={e => {
                const checked = e.target.checked
                setIsCleaningFeeMode(checked)
                if (checked) {
                  setPayAmount(room.cleaningFee + room.expected)
                  setPayDateVal(room.moveInDate ?? kstYmdStr())
                } else {
                  setPayDateVal(kstYmdStr())
                }
              }}
              className="w-4 h-4 accent-[var(--coral)]" />
            <span className="text-xs text-[var(--warm-mid)]">청소비 포함 수납 (청소비 {fmtKorMoney(room.cleaningFee)})</span>
          </label>
          {isCleaningFeeMode && (
            <p className="text-xs text-emerald-600">
              청소비 {fmtKorMoney(room.cleaningFee)} + 이용료 {fmtKorMoney(room.expected)} = {fmtKorMoney(room.cleaningFee + room.expected)}
            </p>
          )}
        </div>
      )}
      <div className="space-y-1">
        <label className="text-xs text-[var(--warm-muted)]">결제 수단</label>
        <select value={payMethod} onChange={e => setPayMethod(e.target.value)}
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]">
          <option value="계좌이체">계좌이체</option>
          <option value="현금">현금</option>
          <option value="신용카드">신용카드</option>
          <option value="기타">기타</option>
        </select>
      </div>
      <div className="space-y-1">
        <label className="text-xs text-[var(--warm-muted)]">메모</label>
        <input type="text" value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모 (선택)"
          className="w-full bg-[var(--canvas)] border border-[var(--warm-border)] rounded-sm px-3 py-2 text-sm text-[var(--warm-dark)] placeholder-gray-600 outline-none focus:border-[var(--coral)]" />
      </div>
      {error && <p className="text-[var(--danger-fg)] text-sm">{error}</p>}
      <div className="flex gap-2">
        {onCancel && <Btn type="button" variant="secondary" onClick={onCancel} fullWidth>취소</Btn>}
        <Btn type="submit" variant="primary" disabled={pending || !(payAmount > 0)} fullWidth>
          {pending ? '저장 중...' : '저장'}
        </Btn>
      </div>
    </form>
  )
}
