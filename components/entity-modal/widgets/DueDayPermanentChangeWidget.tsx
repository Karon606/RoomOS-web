'use client'

// 납입일 영구 변경 + 일할 정산. 셸의 수납 full 모드와 RoomsClient 양쪽에서 재사용.
// calcProRata 로 일할 계산 → 추가납부(extra) 또는 환급(refund) 미리 보여주고 적용.

import { useState, useTransition } from 'react'
import { changeDueDay } from '@/app/(app)/tenants/actions'
import { calcProRata, PRORATE_BASE_DAYS } from '@/lib/prorate'
import { Btn } from '@/components/ui/Btn'
import { withSave, pushToast } from '@/lib/saveStatus'

export function DueDayPermanentChangeWidget({ leaseTermId, targetMonth, expected, currentDueDay, onChange }: {
  leaseTermId: string
  targetMonth: string
  expected: number
  currentDueDay: string | null
  /** 변경 후 부모가 selectedRoom 을 재조회. */
  onChange?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [input, setInput] = useState('')

  const handleApply = () => {
    if (!input.trim()) return
    const calc = calcProRata(expected, currentDueDay, input, targetMonth)
    if (!calc || calc.type === 'none') return
    const adjustAmount = calc.type === 'extra' ? -calc.amount : calc.amount
    startTransition(async () => {
      const res = await withSave(() => changeDueDay(leaseTermId, input.trim(), targetMonth, adjustAmount), { success: '납입일 변경됨' })
      if (res.ok) {
        if (res.notice) pushToast('info', res.notice)
        setShowForm(false); setInput(''); onChange?.()
      }
    })
  }

  if (!showForm) {
    return (
      <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[var(--warm-mid)]">납입일 영구 변경</p>
            <p className="text-[0.625rem] text-[var(--warm-muted)] mt-0.5">일할 정산 후 다음 달부터 계속 적용</p>
          </div>
          <button type="button" onClick={() => { setShowForm(true); setInput('') }}
            className="text-[0.6875rem] px-2 py-1 rounded transition-colors shrink-0"
            style={{ color: 'var(--coral)', border: '1px solid rgba(160,60,46,0.35)' }}>
            변경
          </button>
        </div>
      </div>
    )
  }

  const calc = input.trim() ? calcProRata(expected, currentDueDay, input, targetMonth) : null
  const canApply = !!calc && calc.type !== 'none'

  return (
    <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold" style={{ color: 'var(--coral)' }}>
          납입일 영구 변경 — {targetMonth} 기준 일할 정산
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">새 납입일</label>
            <input type="text" value={input} onChange={e => setInput(e.target.value)} placeholder="예: 25, 말일"
              className="w-full rounded-lg px-2.5 py-1.5 text-sm outline-none"
              style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }} />
          </div>
          <div className="text-xs pb-1.5" style={{ color: 'var(--warm-muted)' }}>
            현재 {currentDueDay ? (currentDueDay.includes('말') ? '말일' : `${currentDueDay}일`) : '—'}
          </div>
        </div>
        {calc && calc.type !== 'none' && (
          <div className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              background: calc.type === 'extra' ? 'rgba(160,60,46,0.10)' : 'rgba(122,154,82,0.12)',
              color: calc.type === 'extra' ? 'var(--coral-dark)' : '#4e6834',
              border: `1px solid ${calc.type === 'extra' ? 'rgba(160,60,46,0.20)' : 'rgba(122,154,82,0.25)'}`,
            }}>
            {calc.type === 'extra'
              ? `납입일 ${calc.days}일 늦어짐 → 추가납부 ${calc.amount.toLocaleString()}원 발생`
              : `납입일 ${calc.days}일 빨라짐 → 과입금 ${calc.amount.toLocaleString()}원 환급`}
            <span className="block mt-0.5 font-normal" style={{ color: 'var(--warm-muted)' }}>
              월 {expected.toLocaleString()}원 ÷ {PRORATE_BASE_DAYS}일 × {calc.days}일
            </span>
          </div>
        )}
        {calc && calc.type === 'none' && (
          <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>기존 납입일과 동일합니다.</p>
        )}
        {input.trim() && !calc && (
          <p className="text-xs" style={{ color: 'var(--coral)' }}>유효한 날짜를 입력하세요 (1~31 또는 말일)</p>
        )}
        <div className="flex gap-2">
          <Btn type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); setInput('') }} className="flex-1">취소</Btn>
          <Btn type="button" variant="primary" size="sm" disabled={pending || !canApply} onClick={handleApply} className="flex-1 font-semibold">
            {pending ? '처리 중...' : '변경 적용'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
