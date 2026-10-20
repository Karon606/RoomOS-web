'use client'

// 납입일 영구 변경 + 일할 정산. 셸의 수납 full 모드와 RoomsClient 양쪽에서 재사용.
// calcProRata 로 일할 계산 → 추가납부(extra) 또는 환급(refund) 미리 보여주고 적용.
// 협의 금액 칸(선택, 신고 df82ce57 · 운영자 승인 2026-10-20 C안). 비우면 일할 규칙값, 적으면 그 금액으로 조정 행을 만들고
// 메모에 규칙값과 협의 금액이 함께 남는다. 방향은 규칙이 정한 대로다. 자동 절삭 규칙은 두지 않는다(운영자는 수동 수정을 원한다).

import { useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { changeDueDay, undoChangeDueDay } from '@/app/(app)/tenants/actions'
import { calcProRata, PRORATE_BASE_DAYS } from '@/lib/prorate'
import { Btn } from '@/components/ui/Btn'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DUE_DAY_ADJUST_KIND_TEXT } from '@/lib/dueDayAdjust'
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
  const [agreed, setAgreed] = useState(0)

  const handleApply = () => {
    if (!input.trim()) return
    const calc = calcProRata(expected, currentDueDay, input, targetMonth)
    if (!calc || calc.type === 'none') return
    const adjustAmount = calc.type === 'extra' ? -calc.amount : calc.amount
    startTransition(async () => {
      const res = await withSave(() => changeDueDay(leaseTermId, input.trim(), targetMonth, adjustAmount, agreed > 0 ? agreed : null), { success: '납입일 변경됨' })
      if (res.ok && res.undo) {
        const u = res.undo
        pushToast('info', '변경을 취소하려면 적용취소를 누르세요', {
          // 적용취소도 적용과 같이 부모가 다시 읽게 한다(안 그러면 새로고침 전까지 바뀐 납입일이 보인다).
          action: { label: '적용취소', run: () => { void undoChangeDueDay(u).then(r => { if (r.ok) { pushToast('info', '납입일 변경을 적용취소했습니다'); onChange?.() } else pushToast('error', r.error) }) } },
        })
      }
      if (res.ok) {
        if (res.notice) pushToast('info', res.notice)
        setShowForm(false); setInput(''); setAgreed(0); onChange?.()
      }
    })
  }

  if (!showForm) {
    return (
      <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[var(--warm-mid)]">납입일 영구 변경</p>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">일할 정산 후 다음 달부터 계속 적용</p>
          </div>
          <button type="button" onClick={() => { setShowForm(true); setInput(''); setAgreed(0) }}
            className="text-[0.6875rem] px-2 py-1 rounded transition-colors shrink-0"
            style={{ color: 'var(--tc-text)', border: '1px solid color-mix(in srgb, var(--coral) 35%, transparent)' }}>
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
        <p className="text-xs font-semibold" style={{ color: 'var(--tc-text)' }}>
          납입일 영구 변경 · {targetMonth} 기준 일할 정산
        </p>
        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label className="text-xs text-[var(--warm-muted)]">새 납입일</label>
            {/* 상자는 아래 협의 금액 칸(정본 MoneyInput)과 같은 높이다(§12 한 폼 안 입력 높이 혼용 금지). 종전 py-1.5 는 34px 였다. */}
            <input type="text" inputMode="numeric" value={input} onChange={e => setInput(e.target.value)} placeholder="예: 25, 말일"
              className="w-full rounded-sm px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }} />
          </div>
          <div className="text-xs pb-2.5" style={{ color: 'var(--warm-muted)' }}>
            현재 {currentDueDay ? (currentDueDay.includes('말') ? '말일' : `${currentDueDay}일`) : '—'}
          </div>
        </div>
        {calc && calc.type !== 'none' && (
          <div className="rounded-lg px-3 py-2 text-xs font-medium"
            style={{
              background: calc.type === 'extra' ? 'var(--danger-bg)' : 'var(--success-bg)',
              color: calc.type === 'extra' ? 'var(--danger-fg)' : 'var(--success-fg)',
              border: `1px solid ${calc.type === 'extra' ? 'var(--danger-ring)' : 'var(--success-ring)'}`,
            }}>
            {/* 화면 어휘는 조정 묶음의 방향 세그먼트와 같은 말이다. 화살표는 값 전환에만 쓴다(§29). */}
            {calc.type === 'extra'
              ? `납입일이 ${calc.days}일 늦어져 ${DUE_DAY_ADJUST_KIND_TEXT.extra} ${fmtWon(calc.amount)}`
              : `납입일이 ${calc.days}일 빨라져 ${DUE_DAY_ADJUST_KIND_TEXT.refund} ${fmtWon(calc.amount)}`}
            <span className="block mt-0.5 font-normal" style={{ color: 'var(--warm-muted)' }}>
              월 {fmtWon(expected)} ÷ {PRORATE_BASE_DAYS}일 × {calc.days}일
            </span>
          </div>
        )}
        {calc && calc.type !== 'none' && (
          <div className="space-y-1">
            <p className="text-xs text-[var(--warm-muted)]">협의 금액 (선택)</p>
            <MoneyInput value={agreed} onChange={setAgreed} placeholder={`비우면 ${fmtWon(calc.amount)}`} />
            <p className="text-[0.65625rem] break-keep num" style={{ color: 'var(--warm-mid)' }}>
              {agreed > 0 && agreed !== calc.amount
                ? `${DUE_DAY_ADJUST_KIND_TEXT[calc.type === 'extra' ? 'extra' : 'refund']} ${fmtWon(agreed)}으로 기록합니다 · 메모에 일할 ${fmtWon(calc.amount)}과 함께 남습니다.`
                : '비우면 일할 금액 그대로 기록합니다. 원단위를 덜어 내는 등 협의한 금액이 있으면 적으세요.'}
            </p>
          </div>
        )}
        {calc && calc.type === 'none' && (
          <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>기존 납입일과 동일합니다.</p>
        )}
        {input.trim() && !calc && (
          <p className="text-xs" style={{ color: 'var(--tc-text)' }}>유효한 날짜를 입력하세요 (1~31 또는 말일)</p>
        )}
        <div className="flex gap-2">
          <Btn type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); setInput(''); setAgreed(0) }} className="flex-1">취소</Btn>
          <Btn type="button" variant="primary" size="sm" disabled={pending || !canApply} onClick={handleApply} className="flex-1 font-semibold">
            {pending ? '처리 중…' : '변경 적용'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
