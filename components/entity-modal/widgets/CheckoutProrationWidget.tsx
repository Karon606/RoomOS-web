'use client'

// 퇴실 정산(일할) — 선납 모델에서 퇴실 예정일이 기간 중간이면 마지막 달 청구를 사용 일수만큼만.
// 퇴실일 입력 → 서버 미리보기(previewCheckoutProration)로 19일치 등 일할 금액 확인 → '적용'으로 확정·기록.
// 확정 시 status=CHECKOUT_PENDING + expectedMoveOut + 일할액 저장. 청구 엔진이 그 달 청구를 이 값으로 덮어씀.

import { useState, useTransition, useEffect, useRef } from 'react'
import {
  previewCheckoutProration,
  setCheckoutProration,
  clearCheckoutProration,
} from '@/app/(app)/tenants/actions'
import type { CheckoutProrationResult } from '@/lib/prorate'
import { PRORATE_BASE_DAYS } from '@/lib/prorate'
import { DatePicker } from '@/components/ui/DatePicker'
import { confirmDialog } from '@/components/ui/ConfirmDialog'
import { Btn } from '@/components/ui/Btn'
import { trackSave, pushToast } from '@/lib/saveStatus'

const fmtWon = (n: number) => `${n.toLocaleString()}원`
const fmtMonth = (m: string) => { const [y, mm] = m.split('-'); return `${y}년 ${Number(mm)}월` }

export function CheckoutProrationWidget({
  leaseTermId, currentDueDay, expectedMoveOut, checkoutProratedAmount, checkoutProratedMonth, autoOpen, onChange,
}: {
  leaseTermId: string
  currentDueDay: string | null
  /** 현재 저장된 퇴실 예정일 'YYYY-MM-DD' | null */
  expectedMoveOut: string | null
  /** 이미 확정된 일할 청구액 (없으면 null) */
  checkoutProratedAmount?: number | null
  checkoutProratedMonth?: string | null
  /** 고객관리 '퇴실 정산?' 팝업의 '예'로 진입 — 폼 자동 펼침 + 날짜 프리필 + 미리보기. */
  autoOpen?: boolean
  /** 적용/해제 후 부모가 재조회. */
  onChange?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [date, setDate] = useState(expectedMoveOut ?? '')
  const [calc, setCalc] = useState<CheckoutProrationResult | null>(null)
  const [calcErr, setCalcErr] = useState<string | null>(null)
  const [amountInput, setAmountInput] = useState('')   // 적용 금액 — 자동 일할액 기본, 운영자가 수정 가능

  const isApplied = checkoutProratedAmount != null && !!checkoutProratedMonth

  // 퇴실일 선택 → 서버 미리보기 (할인까지 반영한 정확한 일할액)
  const handleDate = (v: string) => {
    setDate(v); setCalc(null); setCalcErr(null); setAmountInput('')
    if (!v || v.length < 10) return
    startTransition(async () => {
      const res = await previewCheckoutProration(leaseTermId, v)
      if (res.ok) { setCalc(res.calc); setCalcErr(null); setAmountInput(String(res.calc.amount)) }
      else { setCalc(null); setCalcErr(res.error); setAmountInput('') }
    })
  }

  // autoOpen — 진입 직후 1회: 폼 펼치고 저장된 퇴실일로 미리보기 자동 실행
  const autoOpenedRef = useRef(false)
  useEffect(() => {
    if (!autoOpen || autoOpenedRef.current) return
    autoOpenedRef.current = true
    setShowForm(true)
    if (expectedMoveOut) handleDate(expectedMoveOut)
  }, [autoOpen])  // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = () => {
    if (!date || !calc) return
    const digits = amountInput.replace(/[^0-9]/g, '')
    const manualAmount = digits ? parseInt(digits, 10) : calc.amount
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await setCheckoutProration(leaseTermId, date, manualAmount)
        if (!res.ok) { pushToast('error', res.error); return }
        const adjusted = manualAmount !== res.calc.amount
        pushToast('success', `퇴실 정산 적용 — ${fmtWon(manualAmount)}${adjusted ? ' (수동 조정)' : ` (${res.calc.daysUsed}일치)`}`)
        setShowForm(false); setCalc(null); setAmountInput(''); onChange?.()
      } finally { release() }
    })
  }

  const handleClear = async () => {
    if (!(await confirmDialog({ title: '퇴실 정산을 적용취소할까요?', message: '적용 직전 상태(거주중·퇴실예정일·청구)로 되돌립니다.', confirmLabel: '적용취소' }))) return
    startTransition(async () => {
      const release = trackSave()
      try {
        const res = await clearCheckoutProration(leaseTermId)
        if (!res.ok) { pushToast('error', res.error); return }
        pushToast('success', '퇴실 정산 적용취소됨 — 직전 상태로 복원')
        setShowForm(false); onChange?.()
      } finally { release() }
    })
  }

  // 접힘 상태 — 적용 여부에 따라 요약 표시
  if (!showForm) {
    return (
      <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[var(--warm-mid)]">퇴실 정산 (일할)</p>
            {isApplied ? (
              <p className="text-[0.625rem] mt-0.5" style={{ color: '#4e6834' }}>
                {fmtMonth(checkoutProratedMonth!)} 청구 {fmtWon(checkoutProratedAmount!)} 로 일할 적용됨
                {expectedMoveOut ? ` · 퇴실 ${expectedMoveOut.slice(5).replace('-', '/')}` : ''}
              </p>
            ) : (
              <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">퇴실일 기준 마지막 달을 사용 일수만큼만 청구</p>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            {isApplied && (
              <button type="button" onClick={handleClear} disabled={pending}
                className="text-[0.6875rem] px-2 py-1 rounded transition-colors text-[var(--warm-muted)] hover:bg-[var(--warm-border)] disabled:opacity-40">
                적용취소
              </button>
            )}
            <button type="button" onClick={() => { setShowForm(true); setDate(expectedMoveOut ?? ''); setCalc(null); setCalcErr(null) }}
              className="text-[0.6875rem] px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--coral)', border: '1px solid rgba(160,60,46,0.35)' }}>
              {isApplied ? '다시 정산' : '정산'}
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>
          퇴실 정산 — 일할 청구
        </p>
        <div className="space-y-1.5">
          <label className="text-xs text-[var(--warm-muted)]">퇴실 예정일</label>
          <DatePicker value={date} onChange={handleDate}
            className="bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-[var(--warm-dark)]" />
          <p className="text-[0.625rem] text-[var(--warm-muted)]">
            납부일 {currentDueDay ? (currentDueDay.includes('말') ? '말일' : `${currentDueDay}일`) : '—'} 부터 퇴실일까지(양끝 포함) 일수만큼 청구합니다.
          </p>
        </div>

        {calc && (
          <div className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{ background: 'rgba(122,154,82,0.12)', color: '#4e6834', border: '1px solid rgba(122,154,82,0.25)' }}>
            {fmtMonth(calc.moveOutMonth)} 청구 → <b>{fmtWon(calc.amount)}</b> ({calc.daysUsed}일치)
            <span className="block mt-0.5 font-normal" style={{ color: 'var(--warm-muted)' }}>
              한 달 {fmtWon(calc.fullAmount)} ÷ {PRORATE_BASE_DAYS}일 × {calc.daysUsed}일 · 감액 {fmtWon(calc.reduction)}
            </span>
          </div>
        )}
        {calc && (
          <div className="space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">적용 금액 <span className="text-[0.625rem]">(자동 일할 {fmtWon(calc.amount)} — 필요시 수정)</span></label>
            <div className="flex items-center gap-1.5">
              <input type="text" inputMode="numeric" value={amountInput ? Number(amountInput.replace(/[^0-9]/g, '')).toLocaleString() : ''}
                onChange={e => setAmountInput(e.target.value.replace(/[^0-9]/g, ''))}
                className="flex-1 bg-[var(--canvas)] border border-[var(--warm-border)] rounded-lg px-2.5 py-1.5 text-sm text-right tabular-nums text-[var(--warm-dark)] outline-none focus:border-[var(--coral)]" />
              <span className="text-xs text-[var(--warm-muted)]">원</span>
            </div>
            <p className="text-[0.5625rem] text-[var(--warm-muted)]">하루 더 봐주기·위약금·청소비 차감 등은 이 금액을 직접 조정하세요.</p>
          </div>
        )}
        {calcErr && (
          <p className="text-xs" style={{ color: 'var(--coral)' }}>{calcErr}</p>
        )}

        <div className="flex gap-2">
          <Btn type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); setCalc(null); setCalcErr(null) }} className="flex-1">취소</Btn>
          <Btn type="button" variant="primary" size="sm" disabled={pending || !calc} onClick={handleApply} className="flex-1 font-semibold">
            {pending ? '처리 중...' : '정산 적용'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
