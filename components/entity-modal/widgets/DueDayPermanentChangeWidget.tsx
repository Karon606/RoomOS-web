'use client'

// 납입일 영구 변경. 셸의 수납 full 모드와 RoomsClient 양쪽에서 재사용.
// 두 갈래(운영자 승인 2026-10-21, 504호). 펼치면 맨 위에서 고른다. 고르기 전에는 '변경 적용' 이 꺼져 있다(기본값 없음).
//   기간도 옮김  이용 기간이 새 납입일부터 시작한다. calcProRata 로 늘거나 준 날수의 일할을 미리 보여주고 조정 행으로 남긴다.
//               일할의 옛 값은 지금 이용 기간 시작일(cycleDayOf)이다. 협의 금액 칸(선택, 신고 df82ce57)은 이 갈래에만 있다.
//   납부일만 옮김 이용 기간은 그대로, 돈을 내는 날만 늦춘다. 일할·조정 행이 없고 기간 끝에 퇴실하면 추가 금액이 없다.
//               기간 시작보다 앞으로는 못 옮긴다(서버도 거절한다, tenants/actions changeDueDay).
// 고르는 칸은 §12 상호배타 세그먼트(36px, 선택 --cream + 보더 테라코타)다. 필터·뷰 전환용 SegmentedControl(30px, tablist)이 아니다.

import { useState, useTransition } from 'react'
import { fmtWon } from '@/lib/fmtMoney'
import { changeDueDay, undoChangeDueDay, type DueDayChangeMode } from '@/app/(app)/tenants/actions'
import { calcProRata, PRORATE_BASE_DAYS } from '@/lib/prorate'
import { Btn } from '@/components/ui/Btn'
import { MoneyInput } from '@/components/ui/MoneyInput'
import { DUE_DAY_ADJUST_KIND_TEXT } from '@/lib/dueDayAdjust'
import { cycleDayOf, cyclePeriodLabel, dueDayAfterCycle, dueDayParts, dueOnlyEarlierRefused, sameDueDay } from '@/lib/dueDay'
import { withSave, pushToast } from '@/lib/saveStatus'

const MODE_OPTIONS: { value: DueDayChangeMode; label: string }[] = [
  { value: 'cycle', label: '기간도 옮김' },
  { value: 'dueOnly', label: '납부일만 옮김' },
]
const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--tc-text)]'
const CAPTION = 'text-[0.6875rem] leading-relaxed break-keep'

/** '6' 이면 '6일', '말일' 이면 '말일'. 못 읽으면 빈 문자열. */
const dayText = (v: string | null | undefined) => dueDayParts(v).disp
/** 입력이 날짜(1~31 또는 말일)로 읽히는가. */
function validDay(v: string): boolean {
  const raw = dueDayParts(v.trim()).raw
  const n = Number(raw)
  return raw === '말일' || (Number.isInteger(n) && n >= 1 && n <= 31)
}

export function DueDayPermanentChangeWidget({ leaseTermId, targetMonth, expected, currentDueDay, cycleDay, onChange }: {
  leaseTermId: string
  targetMonth: string
  expected: number
  currentDueDay: string | null
  /** 계약의 이용 기간 시작일 칸(null 이면 납부일과 같다). */
  cycleDay: string | null
  /** 변경 후 부모가 selectedRoom 을 재조회. */
  onChange?: () => void
}) {
  const [pending, startTransition] = useTransition()
  const [showForm, setShowForm] = useState(false)
  const [mode, setMode] = useState<DueDayChangeMode | null>(null)
  const [input, setInput] = useState('')
  const [agreed, setAgreed] = useState(0)
  const cycle = cycleDayOf({ cycleDay, dueDay: currentDueDay })
  const reset = () => { setMode(null); setInput(''); setAgreed(0) }

  // 기간도 옮김 — 옛 값은 이용 기간 시작일이다(납부일만 옮겨 둔 계약은 기간이 움직인 날수가 일할이다).
  const trimmed = input.trim()
  const calc = mode === 'cycle' && trimmed ? calcProRata(expected, cycle, trimmed, targetMonth) : null
  // 납부일만 옮김 — 같은 달 안에서 기간 시작보다 늦어야 한다. 기간 시작과 같은 날이면 다시 하나로 접힌다.
  const dueOnlyValid = mode === 'dueOnly' && trimmed !== '' && validDay(trimmed)
  const dueOnlyBack = dueOnlyValid && sameDueDay(trimmed, cycle)
  const dueOnlyLater = dueOnlyValid && dueDayAfterCycle(cycle, trimmed)
  const dueOnlyNoop = dueOnlyValid && sameDueDay(trimmed, currentDueDay) && (dueOnlyBack ? !cycleDay : !!cycleDay)
  const canApply = mode === 'cycle'
    ? !!calc && calc.type !== 'none'
    : mode === 'dueOnly' && (dueOnlyLater || dueOnlyBack) && !dueOnlyNoop

  const handleApply = () => {
    if (!mode || !canApply) return
    const adjustAmount = mode === 'cycle' && calc && calc.type !== 'none' ? (calc.type === 'extra' ? -calc.amount : calc.amount) : 0
    const agreedArg = mode === 'cycle' && agreed > 0 ? agreed : null
    startTransition(async () => {
      const res = await withSave(() => changeDueDay(leaseTermId, trimmed, targetMonth, adjustAmount, agreedArg, mode), { success: '납입일 변경됨' })
      if (res.ok && res.undo) {
        const u = res.undo
        pushToast('info', '변경을 취소하려면 적용취소를 누르세요', {
          // 적용취소도 적용과 같이 부모가 다시 읽게 한다(안 그러면 새로고침 전까지 바뀐 납입일이 보인다).
          action: { label: '적용취소', run: () => { void undoChangeDueDay(u).then(r => { if (r.ok) { pushToast('info', '납입일 변경을 적용취소했습니다'); onChange?.() } else pushToast('error', r.error) }) } },
        })
      }
      if (res.ok) {
        if (res.notice) pushToast('info', res.notice)
        setShowForm(false); reset(); onChange?.()
      }
    })
  }

  if (!showForm) {
    return (
      <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-medium text-[var(--warm-mid)]">납입일 영구 변경</p>
            <p className="text-[0.65625rem] text-[var(--warm-muted)] mt-0.5">기간째 옮기거나 납부일만 옮깁니다</p>
          </div>
          <button type="button" onClick={() => { setShowForm(true); reset() }}
            className="text-[0.6875rem] px-2 py-1 rounded transition-colors shrink-0"
            style={{ color: 'var(--tc-text)', border: '1px solid color-mix(in srgb, var(--coral) 35%, transparent)' }}>
            변경
          </button>
        </div>
      </div>
    )
  }

  // 그 계약 숫자로 든 예시(기간도 옮김). 기간 시작에서 5일 뒤로(말일 근처면 5일 앞으로) 옮기는 경우다.
  const cycleNum = dueDayParts(cycle).raw === '말일' ? 31 : Number(dueDayParts(cycle).raw)
  const exampleTo = Number.isInteger(cycleNum) && cycleNum > 0 ? (cycleNum <= 23 ? cycleNum + 5 : cycleNum - 5) : null
  const exampleAmount = Math.floor((expected * 5) / PRORATE_BASE_DAYS)
  const period = cyclePeriodLabel(cycle)
  // 아직 고를 수 있는 날이 아니면(앞당김·같은 날·빈칸) 문장이 그 날로 늦춘다고 말하지 않는다.
  const newDayText = dueOnlyLater ? dayText(trimmed) : '새 날'

  return (
    <div className="border-t border-[var(--warm-border)] px-6 py-3 shrink-0">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold" style={{ color: 'var(--tc-text)' }}>납입일 영구 변경</p>

        {/* §12 상호배타 세그먼트. 고르기 전에는 아무것도 선택되지 않는다(기본값 없음). 선택 보더는 --tc-text 다.
            라이트에서는 --tc 와 같은 #A03C2E 이고 다크에서만 밝아져 카드 위 3:1 을 지킨다(§12 포커스 링과 같은 이유). */}
        <div role="radiogroup" aria-label="변경 방식" className="flex gap-1.5">
          {MODE_OPTIONS.map(o => {
            const on = mode === o.value
            return (
              <button key={o.value} type="button" role="radio" aria-checked={on}
                onClick={() => { setMode(o.value); setAgreed(0) }}
                className={`flex-1 h-9 rounded-sm px-2 text-sm whitespace-nowrap transition-colors ${FOCUS_RING}`}
                style={on
                  ? { background: 'var(--cream)', color: 'var(--warm-dark)', border: '1.5px solid var(--tc-text)', fontWeight: 600 }
                  : { background: 'var(--canvas)', color: 'var(--warm-dark)', border: '1.5px solid var(--warm-border)' }}>
                {o.label}
              </button>
            )
          })}
        </div>

        {mode === 'cycle' && (
          <p className={CAPTION} style={{ color: 'var(--warm-mid)' }}>
            이용 기간이 새 납입일부터 시작합니다. 늘거나 준 날수만큼 일할 정산합니다.
            {exampleTo != null && (
              <span className="block num" style={{ color: 'var(--warm-muted)' }}>
                예) 매월 {dayText(cycle)}에서 {exampleTo}일로 옮기면 5일치 {fmtWon(exampleAmount)}을 {DUE_DAY_ADJUST_KIND_TEXT.extra}으로 기록합니다.
              </span>
            )}
          </p>
        )}
        {mode === 'dueOnly' && (
          <p className={CAPTION} style={{ color: 'var(--warm-mid)' }}>
            이용 기간은 그대로 매월 {period}입니다. 돈을 내는 날만 {newDayText}로 늦춥니다. 일할 정산이 없고, 기간 끝에 퇴실하면 추가 금액이 없습니다.
          </p>
        )}

        <div className="flex items-end gap-3">
          <div className="flex-1 space-y-1">
            <label htmlFor={`due-new-${leaseTermId}`} className="text-xs text-[var(--warm-muted)]">새 납입일</label>
            {/* 상자는 아래 협의 금액 칸(정본 MoneyInput)과 같은 높이다(§12 한 폼 안 입력 높이 혼용 금지). */}
            <input id={`due-new-${leaseTermId}`} type="text" inputMode="numeric" value={input} onChange={e => setInput(e.target.value)} placeholder="예: 25, 말일"
              className="w-full rounded-sm px-3 py-2.5 text-sm outline-none"
              style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }} />
          </div>
          <div className="text-xs pb-2.5 text-right" style={{ color: 'var(--warm-muted)' }}>
            현재 {dayText(currentDueDay) || '없음'}
            {cycleDay && !sameDueDay(cycleDay, currentDueDay) && <span className="block">기간 {period}</span>}
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
              ? `기간이 ${calc.days}일 늦어져 ${DUE_DAY_ADJUST_KIND_TEXT.extra} ${fmtWon(calc.amount)}`
              : `기간이 ${calc.days}일 빨라져 ${DUE_DAY_ADJUST_KIND_TEXT.refund} ${fmtWon(calc.amount)}`}
            {/* 계산식 줄은 상자 글자색 그대로 굵기만 낮춘다(--warm-muted 는 다크 의미색 바탕 위 4.09:1, 하네스 실측). */}
            <span className="block mt-0.5 font-normal">
              {targetMonth} 기준 · 월 {fmtWon(expected)} ÷ {PRORATE_BASE_DAYS}일 × {calc.days}일
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
          <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>{cycleDay ? '이용 기간 시작과 같은 날입니다.' : '기존 납입일과 동일합니다.'}</p>
        )}

        {/* 납부일만 옮김 미리보기 — 돈이 안 움직이므로 의미색이 아닌 중립 상자다. */}
        {mode === 'dueOnly' && dueOnlyLater && !dueOnlyNoop && (
          <div className="rounded-lg px-3 py-2 text-xs num break-keep"
            style={{ background: 'var(--canvas)', border: '1px solid var(--warm-border)', color: 'var(--warm-dark)' }}>
            이용 기간 매월 {period} 그대로 · 납부일 매월 {dayText(trimmed)} · 추가 금액 0원
          </div>
        )}
        {mode === 'dueOnly' && dueOnlyBack && !dueOnlyNoop && (
          <p className={CAPTION} style={{ color: 'var(--warm-mid)' }}>기간 시작과 같은 날이라 납부일과 이용 기간이 다시 하나로 맞춰집니다. 추가 금액은 0원입니다.</p>
        )}
        {mode === 'dueOnly' && dueOnlyValid && !dueOnlyLater && !dueOnlyBack && (
          <p className={CAPTION} style={{ color: 'var(--tc-text)' }}>{dueOnlyEarlierRefused(cycle, true)}</p>
        )}
        {dueOnlyNoop && (
          <p className="text-xs" style={{ color: 'var(--warm-muted)' }}>기존 납입일과 동일합니다.</p>
        )}
        {trimmed && ((mode === 'cycle' && !calc) || (mode === 'dueOnly' && !dueOnlyValid)) && (
          <p className="text-xs" style={{ color: 'var(--tc-text)' }}>유효한 날짜를 입력하세요 (1~31 또는 말일)</p>
        )}

        <div className="flex gap-2">
          <Btn type="button" variant="secondary" size="sm" onClick={() => { setShowForm(false); reset() }} className="flex-1">취소</Btn>
          <Btn type="button" variant="primary" size="sm" disabled={pending || !canApply} onClick={handleApply} className="flex-1 font-semibold">
            {pending ? '처리 중…' : '변경 적용'}
          </Btn>
        </div>
      </div>
    </div>
  )
}
